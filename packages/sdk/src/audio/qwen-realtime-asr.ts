import type { RealtimeWebSocketTransport } from './websocket-transport.js'

export interface QwenRealtimeASRConfig {
  apiKey: string
  url?: string
  model?: string
  sampleRate?: number
  language?: string
  receiveTimeoutMs?: number
  /**
   * 中间转录结果回调
   * 用于 endpointing 策略的文本累积
   */
  onInterimTranscript?: (text: string, isFinal: boolean) => void
}

type PendingCommit = {
  resolve: (text: string) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
  fallbackText: string | null
}

export class QwenRealtimeASR {
  private connected = false
  private receiveLoop: Promise<void> | null = null
  private pendingCommits: PendingCommit[] = []
  private latestFinalTranscript: string | null = null
  private latestFallbackTranscript: string | null = null

  constructor(
    private config: QwenRealtimeASRConfig,
    private transport: RealtimeWebSocketTransport
  ) {}

  async connect(): Promise<void> {
    if (!this.config.apiKey.trim()) {
      throw new Error('Qwen STT API key is not configured')
    }

    const baseUrl = (this.config.url || 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime')
      .replace(/\/$/, '')
    const model = this.config.model || 'qwen3-asr-flash-realtime'

    await this.transport.connect({
      url: `${baseUrl}?model=${encodeURIComponent(model)}`,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    })

    this.connected = true
    await this.transport.sendText(JSON.stringify({
      event_id: eventId(),
      type: 'session.update',
      session: {
        modalities: ['text'],
        input_audio_format: 'pcm',
        sample_rate: this.config.sampleRate || 16000,
        input_audio_transcription: {
          language: this.config.language || 'zh',
        },
        turn_detection: null,
      },
    }))

    this.receiveLoop = this.runReceiveLoop()
  }

  async transcribe(audioData: Int16Array | number[]): Promise<string> {
    if (!this.connected) {
      await this.connect()
    }

    await this.appendAudio(audioData)
    return await this.commit()
  }

  async appendAudio(audioData: Int16Array | number[]): Promise<void> {
    if (!this.connected) {
      await this.connect()
    }

    const samples = audioData instanceof Int16Array
      ? audioData
      : Int16Array.from(audioData)
    const bytes = int16ToBytes(samples)

    for (let offset = 0; offset < bytes.length; offset += 3200) {
      const chunk = bytes.slice(offset, offset + 3200)
      await this.transport.sendText(JSON.stringify({
        event_id: eventId(),
        type: 'input_audio_buffer.append',
        audio: base64Encode(chunk),
      }))
    }
  }

  async commit(): Promise<string> {
    if (!this.connected) {
      await this.connect()
    }

    if (this.latestFinalTranscript?.trim()) {
      const text = this.latestFinalTranscript.trim()
      this.latestFinalTranscript = null
      this.latestFallbackTranscript = null
      return text
    }

    const timeoutMs = this.config.receiveTimeoutMs || 5000
    const transcriptPromise = new Promise<string>((resolve, reject) => {
      const pendingCommit: PendingCommit = {
        resolve,
        reject,
        fallbackText: this.latestFallbackTranscript,
        timeoutId: setTimeout(() => {
          this.pendingCommits = this.pendingCommits.filter((entry) => entry !== pendingCommit)
          if (pendingCommit.fallbackText?.trim()) {
            this.latestFallbackTranscript = null
            resolve(pendingCommit.fallbackText.trim())
            return
          }
          reject(new Error('Qwen STT transcription timeout'))
        }, timeoutMs)
      }

      this.pendingCommits.push(pendingCommit)
    })

    await this.transport.sendText(JSON.stringify({
      event_id: eventId(),
      type: 'input_audio_buffer.commit',
    }))

    return await transcriptPromise
  }

  async close(): Promise<void> {
    const error = new Error('Qwen STT WebSocket closed')
    for (const pending of this.pendingCommits) {
      clearTimeout(pending.timeoutId)
      pending.reject(error)
    }
    this.pendingCommits = []
    this.latestFinalTranscript = null
    this.latestFallbackTranscript = null
    this.connected = false
    await this.transport.close()
    await this.receiveLoop?.catch(() => undefined)
    this.receiveLoop = null
  }

  clearBufferedTranscripts(): void {
    this.latestFinalTranscript = null
    this.latestFallbackTranscript = null
  }

  private async runReceiveLoop(): Promise<void> {
    while (this.connected) {
      const result = await this.transport.receive(1000)

      if (result.timeout) {
        continue
      }

      if (result.closed) {
        this.connected = false
        const error = new Error('Qwen STT WebSocket closed')
        for (const pending of this.pendingCommits) {
          clearTimeout(pending.timeoutId)
          pending.reject(error)
        }
        this.pendingCommits = []
        return
      }

      if (!result.data) {
        continue
      }

      let parsed: any
      try {
        parsed = JSON.parse(new TextDecoder().decode(result.data))
      } catch {
        continue
      }

      const finalText = extractFinalTranscript(parsed)
      if (finalText) {
        const normalizedFinalText = finalText.trim()
        // 通知最终转录结果
        this.config.onInterimTranscript?.(normalizedFinalText, true)

        const pending = this.pendingCommits.shift()
        if (pending) {
          clearTimeout(pending.timeoutId)
          this.latestFallbackTranscript = null
          pending.resolve(normalizedFinalText)
        } else {
          this.latestFinalTranscript = normalizedFinalText
        }
        continue
      }

      const fallbackText = extractFallbackTranscript(parsed)
      if (fallbackText) {
        this.latestFallbackTranscript = fallbackText
        // 通知中间转录结果（用于 endpointing）
        this.config.onInterimTranscript?.(fallbackText, false)

        const pending = this.pendingCommits[0]
        if (pending) {
          pending.fallbackText = fallbackText
        }
      }
    }
  }
}

function extractFinalTranscript(response: any): string | null {
  if (response?.type === 'conversation.item.input_audio_transcription.completed') {
    return response.transcript || null
  }

  return null
}

function extractFallbackTranscript(response: any): string | null {
  if (response?.output?.sentence?.text) {
    return response.output.sentence.text
  }

  return null
}

function int16ToBytes(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]
    bytes[i * 2] = sample & 0xff
    bytes[i * 2 + 1] = (sample >> 8) & 0xff
  }
  return bytes
}

function base64Encode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function eventId(): string {
  return `event_${Date.now()}_${Math.random().toString(36).slice(2)}`
}
