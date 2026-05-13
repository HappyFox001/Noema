/**
 * ElevenLabs HTTP text-to-speech provider.
 *
 * Mirrors Pipecat's HTTP ElevenLabs path: stream/with-timestamps, PCM output
 * format by sample rate, and voice settings from provider-specific extras.
 */
import type { TTSProvider, TTSProviderCapabilities, TTSProviderEvent } from './providers.js'

export interface ElevenLabsTTSConfig {
  apiKey: string
  baseUrl?: string
  model?: string
  voiceId?: string
  sampleRate?: number
  language?: string
  extra?: {
    optimize_streaming_latency?: number
    stability?: number
    similarity_boost?: number
    style?: number
    use_speaker_boost?: boolean
    speed?: number
    apply_text_normalization?: 'auto' | 'on' | 'off'
    enable_logging?: boolean
  }
}

const ELEVENLABS_MULTILINGUAL_MODELS = new Set([
  'eleven_flash_v2_5',
  'eleven_turbo_v2_5',
])

export class ElevenLabsTTSProvider implements TTSProvider {
  private config: ElevenLabsTTSConfig
  private onEvent?: (event: TTSProviderEvent) => void
  private textBuffer = ''
  private contextId = 0
  private activeContextId = 0
  private abortController: AbortController | null = null
  private streaming = false

  constructor(config: ElevenLabsTTSConfig) {
    this.config = config
  }

  getCapabilities(): TTSProviderCapabilities {
    return {
      provider: 'elevenlabs',
      model: this.config.model || 'eleven_turbo_v2_5',
      sampleRate: this.config.sampleRate || 16000,
      audioFormat: 'pcm',
      supportedAudioFormats: ['pcm'],
      streaming: true,
      supportsInterrupt: true,
      supportsVoiceSelection: true,
      supportedLanguages: [
        'ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fil',
        'fr', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'ms', 'nl',
        'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sv', 'ta', 'tr', 'uk',
        'vi', 'zh',
      ],
    }
  }

  setEventHandler(handler: (event: TTSProviderEvent) => void): void {
    this.onEvent = handler
  }

  async setup(): Promise<void> {
    // No setup is required for HTTP streaming.
  }

  async start(): Promise<void> {
    await this.startStreaming()
  }

  async updateSettings(settings: unknown): Promise<void> {
    this.config = {
      ...this.config,
      ...(settings as Partial<ElevenLabsTTSConfig>),
    }
  }

  async startStreaming(): Promise<void> {
    if (this.streaming) {
      return
    }

    await this.close()
    this.contextId += 1
    this.activeContextId = this.contextId
    this.textBuffer = ''
    this.streaming = true
    this.abortController = new AbortController()
    this.onEvent?.({ type: 'connected', contextId: this.activeContextId })
  }

  async pushText(text: string): Promise<void> {
    if (!this.streaming || !text.trim()) {
      return
    }
    this.textBuffer += text
  }

  async finishStreaming(): Promise<void> {
    if (!this.streaming) {
      return
    }

    const text = this.textBuffer.trim()
    const contextId = this.activeContextId
    this.streaming = false
    this.textBuffer = ''

    if (!text) {
      this.onEvent?.({ type: 'closed', contextId })
      return
    }

    try {
      await this.requestSpeech(text, contextId)
      if (this.activeContextId === contextId && contextId >= 0) {
        this.onEvent?.({ type: 'closed', contextId })
      }
    } catch (error) {
      if (this.abortController?.signal.aborted) {
        return
      }
      this.onEvent?.({
        type: 'error',
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  async interrupt(): Promise<void> {
    this.activeContextId = -1
    this.textBuffer = ''
    this.streaming = false
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
    this.streaming = false
    this.textBuffer = ''
    this.abortController?.abort()
    this.abortController = null
  }

  getActiveContextId(): number {
    return this.activeContextId
  }

  private async requestSpeech(text: string, contextId: number): Promise<void> {
    const voiceId = this.config.voiceId?.trim()
    if (!voiceId) {
      throw new Error('ElevenLabs voice ID is required')
    }

    const baseUrl = normalizeBaseUrl(this.config.baseUrl)
    const url = new URL(`${baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream/with-timestamps`)
    url.searchParams.set('output_format', outputFormatFromSampleRate(this.config.sampleRate || 16000))

    const optimizeStreamingLatency = this.config.extra?.optimize_streaming_latency
    if (typeof optimizeStreamingLatency === 'number') {
      url.searchParams.set('optimize_streaming_latency', String(optimizeStreamingLatency))
    }
    if (typeof this.config.extra?.enable_logging === 'boolean') {
      url.searchParams.set('enable_logging', String(this.config.extra.enable_logging))
    }

    const model = this.config.model || 'eleven_turbo_v2_5'
    const payload: Record<string, unknown> = {
      text,
      model_id: model,
    }

    const voiceSettings = buildVoiceSettings(this.config.extra)
    if (voiceSettings) {
      payload.voice_settings = voiceSettings
    }

    if (this.config.extra?.apply_text_normalization) {
      payload.apply_text_normalization = this.config.extra.apply_text_normalization
    }

    if (ELEVENLABS_MULTILINGUAL_MODELS.has(model) && this.config.language) {
      payload.language_code = this.config.language
    }

    const response = await fetch(url, {
      method: 'POST',
      signal: this.abortController?.signal,
      headers: {
        'content-type': 'application/json',
        'xi-api-key': this.config.apiKey,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(body.slice(0, 300) || `ElevenLabs TTS request failed with HTTP ${response.status}`)
    }

    if (!response.body) {
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (this.activeContextId === contextId && contextId >= 0) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        this.handleStreamLine(line, contextId)
      }
    }

    if (buffer.trim()) {
      this.handleStreamLine(buffer, contextId)
    }
  }

  private handleStreamLine(line: string, contextId: number): void {
    const trimmed = line.trim()
    if (!trimmed) {
      return
    }

    let data: any
    try {
      data = JSON.parse(trimmed)
    } catch {
      return
    }

    if (typeof data?.audio_base64 !== 'string') {
      return
    }

    const audio = base64Decode(data.audio_base64)
    if (audio.length > 0 && this.activeContextId === contextId) {
      this.onEvent?.({ type: 'audio', audio, contextId })
    }
  }
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl?.trim() || 'https://api.elevenlabs.io').replace(/\/+$/, '')
}

function outputFormatFromSampleRate(sampleRate: number): string {
  switch (sampleRate) {
    case 8000:
      return 'pcm_8000'
    case 16000:
      return 'pcm_16000'
    case 22050:
      return 'pcm_22050'
    case 24000:
      return 'pcm_24000'
    case 32000:
      return 'pcm_32000'
    case 44100:
      return 'pcm_44100'
    case 48000:
      return 'pcm_48000'
    default:
      return 'pcm_16000'
  }
}

function buildVoiceSettings(extra: ElevenLabsTTSConfig['extra']): Record<string, number | boolean> | null {
  if (!extra) {
    return null
  }

  const settings: Record<string, number | boolean> = {}
  for (const key of ['stability', 'similarity_boost', 'style', 'speed'] as const) {
    if (typeof extra[key] === 'number') {
      settings[key] = extra[key]
    }
  }
  if (typeof extra.use_speaker_boost === 'boolean') {
    settings.use_speaker_boost = extra.use_speaker_boost
  }

  return Object.keys(settings).length > 0 ? settings : null
}

function base64Decode(value: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'base64'))
  }

  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
