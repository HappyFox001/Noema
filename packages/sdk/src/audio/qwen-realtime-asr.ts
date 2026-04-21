import type { RealtimeWebSocketTransport } from './fish-realtime-tts.js'

export interface QwenRealtimeASRConfig {
  apiKey: string
  url?: string
  model?: string
  sampleRate?: number
  language?: string
  receiveTimeoutMs?: number
}

export class QwenRealtimeASR {
  private connected = false

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
  }

  async transcribe(audioData: Int16Array | number[]): Promise<string> {
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

    await this.transport.sendText(JSON.stringify({
      event_id: eventId(),
      type: 'input_audio_buffer.commit',
    }))

    const deadline = Date.now() + (this.config.receiveTimeoutMs || 5000)
    while (Date.now() < deadline) {
      const remaining = Math.max(100, deadline - Date.now())
      const result = await this.transport.receive(remaining)

      if (result.timeout) {
        continue
      }

      if (result.closed) {
        throw new Error('Qwen STT WebSocket closed')
      }

      if (!result.data) {
        continue
      }

      const message = new TextDecoder().decode(result.data)
      const parsed = JSON.parse(message)
      const finalText = extractFinalTranscript(parsed)
      if (finalText) {
        return finalText
      }
    }

    throw new Error('Qwen STT transcription timeout')
  }

  async close(): Promise<void> {
    this.connected = false
    await this.transport.close()
  }
}

function extractFinalTranscript(response: any): string | null {
  if (response?.type === 'conversation.item.input_audio_transcription.completed') {
    return response.transcript || null
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
