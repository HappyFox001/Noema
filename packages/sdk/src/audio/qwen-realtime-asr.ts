import type { RealtimeWebSocketTransport } from './websocket-transport.js'
import type { STTProvider, STTProviderCapabilities, STTProviderEvent } from './providers.js'
import { mergeFinalTranscriptText } from '../turn/transcription-text.js'

export interface QwenRealtimeASRConfig {
  apiKey: string
  url?: string
  model?: string
  sampleRate?: number
  language?: string
  receiveTimeoutMs?: number
  fallbackTranscriptCommitGraceMs?: number
  
  onInterimTranscript?: (text: string, isFinal: boolean) => void
}

type PendingCommit = {
  resolve: (text: string) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout> | null
}

export class QwenRealtimeASR implements STTProvider {
  readonly streamingTranscripts = true

  private connected = false
  private receiveLoop: Promise<void> | null = null
  private pendingCommits: PendingCommit[] = []
  private latestFinalTranscript: string | null = null
  private latestFallbackTranscript: string | null = null
  private dropLateFinalAfterFallbackCommit = false
  private onEvent?: (event: STTProviderEvent) => void

  constructor(
    private config: QwenRealtimeASRConfig,
    private transport: RealtimeWebSocketTransport
  ) {}

  setEventHandler(handler: (event: STTProviderEvent) => void): void {
    this.onEvent = handler
  }

  getCapabilities(): STTProviderCapabilities {
    return {
      provider: 'qwen-realtime',
      model: this.config.model || 'qwen3-asr-flash-realtime',
      sampleRate: this.config.sampleRate || 16000,
      streamingTranscripts: true,
      supportsInterimTranscripts: true,
      supportsFinalTranscripts: true,
      supportsFlushAudio: true,
      supportsServerVAD: false,
      sttTimeoutMs: this.config.receiveTimeoutMs || 5000,
    }
  }

  async setup(): Promise<void> {
    // No-op: this provider opens the websocket in start/connect.
  }

  async start(): Promise<void> {
    await this.connect()
  }

  async interrupt(_reason?: string): Promise<void> {
    this.clearBufferedTranscripts()
  }

  async updateSettings(settings: unknown): Promise<void> {
    this.config = {
      ...this.config,
      ...(settings as Partial<QwenRealtimeASRConfig>),
    }
  }

  async stop(): Promise<void> {
    await this.close()
  }

  async cleanup(): Promise<void> {
    await this.close()
  }

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
        enable_input_audio_transcription: true,
        transcription: {
          language: this.config.language || 'zh',
          sample_rate: this.config.sampleRate || 16000,
          input_audio_format: 'pcm',
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
    return await new Promise<string>((resolve, reject) => {
      const pendingCommit: PendingCommit = {
        resolve,
        reject,
        timeoutId: null,
      }

      this.pendingCommits.push(pendingCommit)
      this.armPendingCommitTimeout(
        pendingCommit,
        this.latestFallbackTranscript?.trim()
          ? this.getFallbackCommitGraceMs()
          : timeoutMs
      )
    })
  }

  async flushAudio(): Promise<void> {
    if (!this.connected) {
      await this.connect()
    }

    await this.transport.sendText(JSON.stringify({
      event_id: eventId(),
      type: 'input_audio_buffer.commit',
    }))
  }

  async close(): Promise<void> {
    const error = new Error('Qwen STT WebSocket closed')
    for (const pending of this.pendingCommits) {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId)
      }
      pending.reject(error)
    }
    this.pendingCommits = []
    this.latestFinalTranscript = null
    this.latestFallbackTranscript = null
    this.dropLateFinalAfterFallbackCommit = false
    this.connected = false
    await this.transport.close()
    await this.receiveLoop?.catch(() => undefined)
    this.receiveLoop = null
  }

  clearBufferedTranscripts(): void {
    this.latestFinalTranscript = null
    this.latestFallbackTranscript = null
    this.dropLateFinalAfterFallbackCommit = false
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
          if (pending.timeoutId) {
            clearTimeout(pending.timeoutId)
          }
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
        const pending = this.pendingCommits.shift()
        if (pending) {
          if (pending.timeoutId) {
            clearTimeout(pending.timeoutId)
          }
          this.latestFallbackTranscript = null
          this.dropLateFinalAfterFallbackCommit = false
          pending.resolve(normalizedFinalText)
        } else if (this.dropLateFinalAfterFallbackCommit) {
          this.dropLateFinalAfterFallbackCommit = false
        } else {
          this.config.onInterimTranscript?.(normalizedFinalText, true)
          this.onEvent?.({
            type: 'transcript',
            text: normalizedFinalText,
            final: true,
          })
          this.latestFinalTranscript = mergeFinalTranscriptText(
            this.latestFinalTranscript ?? '',
            normalizedFinalText
          )
        }
        continue
      }

      const fallbackText = extractFallbackTranscript(parsed)
      if (fallbackText) {
        this.latestFallbackTranscript = fallbackText
        this.armFirstPendingCommitForFallback()
        this.config.onInterimTranscript?.(fallbackText, false)
        this.onEvent?.({
          type: 'transcript',
          text: fallbackText,
          final: false,
        })
        continue
      }

      const eventType = typeof parsed?.type === 'string' ? parsed.type : ''
      if (eventType.includes('input_audio_transcription')) {
        console.log(`[QwenRealtimeASR] Unhandled transcription event: ${eventType}`, parsed)
      }
    }
  }

  private getFallbackCommitGraceMs(): number {
    const configured = this.config.fallbackTranscriptCommitGraceMs
    return Number.isFinite(configured) && configured !== undefined
      ? Math.max(0, configured)
      : 300
  }

  private armFirstPendingCommitForFallback(): void {
    const pending = this.pendingCommits[0]
    if (!pending) {
      return
    }
    this.armPendingCommitTimeout(pending, this.getFallbackCommitGraceMs())
  }

  private armPendingCommitTimeout(pending: PendingCommit, timeoutMs: number): void {
    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId)
    }

    pending.timeoutId = setTimeout(() => {
      this.pendingCommits = this.pendingCommits.filter((entry) => entry !== pending)
      pending.timeoutId = null
      if (this.latestFallbackTranscript?.trim()) {
        const text = this.latestFallbackTranscript.trim()
        this.latestFallbackTranscript = null
        this.dropLateFinalAfterFallbackCommit = true
        pending.resolve(text)
        return
      }
      pending.reject(new Error('Qwen STT transcription timeout'))
    }, timeoutMs)
  }
}

function extractFinalTranscript(response: any): string | null {
  if (response?.type === 'conversation.item.input_audio_transcription.completed') {
    return response.transcript || null
  }

  return null
}

function extractFallbackTranscript(response: any): string | null {
  if (response?.type === 'conversation.item.input_audio_transcription.text') {
    return response.stash || null
  }

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
