/**
 * OpenAI-compatible buffered speech-to-text provider.
 *
 * Collects PCM input during a user turn, wraps it as WAV, and sends it to
 * /audio/transcriptions when the turn is finalized.
 */
import type { STTProvider, STTProviderCapabilities, STTProviderEvent } from './providers.js'

export interface OpenAIASRConfig {
  apiKey: string
  baseUrl?: string
  model?: string
  sampleRate?: number
  language?: string
  receiveTimeoutMs?: number
  prompt?: string
}

export class OpenAIASRProvider implements STTProvider {
  readonly streamingTranscripts = false

  private config: OpenAIASRConfig
  private onEvent?: (event: STTProviderEvent) => void
  private chunks: Int16Array[] = []
  private connected = false
  private abortController: AbortController | null = null

  constructor(config: OpenAIASRConfig) {
    this.config = config
  }

  getCapabilities(): STTProviderCapabilities {
    return {
      provider: 'openai',
      model: this.config.model || 'whisper-1',
      sampleRate: this.config.sampleRate || 16000,
      inputAudioFormat: 'pcm_s16le',
      streamingTranscripts: false,
      supportsInterimTranscripts: false,
      supportsFinalTranscripts: true,
      supportsFlushAudio: false,
      supportsServerVAD: false,
      supportsFileTranscription: true,
      supportedLanguages: this.config.language ? [this.config.language] : undefined,
      sttTimeoutMs: this.config.receiveTimeoutMs || 20000,
    }
  }

  setEventHandler(handler: (event: STTProviderEvent) => void): void {
    this.onEvent = handler
  }

  async setup(): Promise<void> {
    // No setup is required for HTTP transcription.
  }

  async start(): Promise<void> {
    await this.connect()
  }

  async connect(): Promise<void> {
    if (!this.config.apiKey.trim()) {
      throw new Error('OpenAI ASR API key is not configured')
    }
    this.connected = true
  }

  async updateSettings(settings: unknown): Promise<void> {
    this.config = {
      ...this.config,
      ...(settings as Partial<OpenAIASRConfig>),
    }
  }

  async appendAudio(audioData: Int16Array | number[]): Promise<void> {
    if (!this.connected) {
      await this.connect()
    }
    this.chunks.push(audioData instanceof Int16Array ? audioData.slice() : Int16Array.from(audioData))
  }

  async transcribe(audioData: Int16Array | number[]): Promise<string> {
    this.clearBufferedTranscripts()
    await this.appendAudio(audioData)
    return await this.commit()
  }

  async commit(): Promise<string> {
    if (!this.connected) {
      await this.connect()
    }

    const samples = concatChunks(this.chunks)
    this.chunks = []
    if (samples.length === 0) {
      return ''
    }

    const text = await this.requestTranscription(samples)
    if (text) {
      this.onEvent?.({ type: 'transcript', text, final: true })
    }
    return text
  }

  async waitForFinalTranscript(): Promise<string> {
    return await this.commit()
  }

  clearBufferedTranscripts(): void {
    this.chunks = []
  }

  async interrupt(_reason?: string): Promise<void> {
    this.clearBufferedTranscripts()
    this.abortController?.abort()
    this.abortController = null
  }

  async stop(): Promise<void> {
    await this.close()
  }

  async cleanup(): Promise<void> {
    await this.close()
  }

  async close(): Promise<void> {
    this.connected = false
    this.clearBufferedTranscripts()
    this.abortController?.abort()
    this.abortController = null
  }

  private async requestTranscription(samples: Int16Array): Promise<string> {
    const baseUrl = normalizeBaseUrl(this.config.baseUrl)
    const wav = pcm16ToWav(samples, this.config.sampleRate || 16000)
    const form = new FormData()
    form.set('model', this.config.model || 'whisper-1')
    form.set('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav')
    form.set('response_format', 'json')
    if (this.config.language) {
      form.set('language', this.config.language)
    }
    if (this.config.prompt) {
      form.set('prompt', this.config.prompt)
    }

    this.abortController = new AbortController()
    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      signal: this.abortController.signal,
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: form,
    })
    this.abortController = null

    const bodyText = await response.text()
    let body: any = null
    try {
      body = JSON.parse(bodyText)
    } catch {
      body = null
    }

    if (!response.ok) {
      throw new Error(body?.error?.message || bodyText.slice(0, 300) || `OpenAI ASR request failed with HTTP ${response.status}`)
    }

    const text = typeof body?.text === 'string' ? body.text : ''
    return text.trim()
  }
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '')
}

function concatChunks(chunks: Int16Array[]): Int16Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Int16Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function pcm16ToWav(samples: Int16Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  let offset = 44
  for (const sample of samples) {
    view.setInt16(offset, sample, true)
    offset += 2
  }

  return new Uint8Array(buffer)
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i))
  }
}
