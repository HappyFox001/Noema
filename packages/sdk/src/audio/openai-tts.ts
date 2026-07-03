/**
 * Dormant OpenAI-compatible HTTP text-to-speech provider.
 *
 * This implementation is retained for future re-enablement, but it is not
 * exported from the audio barrel or registered in the current TTS factory.
 */
import type { TTSProvider, TTSProviderCapabilities, TTSProviderEvent } from './providers.js'

export interface OpenAITTSConfig {
  apiKey: string
  baseUrl?: string
  model?: string
  voiceId?: string
  sampleRate?: number
  providerSampleRate?: number
  instructions?: string
  speed?: number
}

export class OpenAITTSProvider implements TTSProvider {
  private config: OpenAITTSConfig
  private onEvent?: (event: TTSProviderEvent) => void
  private textBuffer = ''
  private contextId = 0
  private activeContextId = 0
  private abortController: AbortController | null = null
  private streaming = false

  constructor(config: OpenAITTSConfig) {
    this.config = config
  }

  getCapabilities(): TTSProviderCapabilities {
    return {
      provider: 'openai',
      model: this.config.model || 'gpt-4o-mini-tts',
      sampleRate: this.config.sampleRate || 16000,
      audioFormat: 'pcm',
      supportedAudioFormats: ['pcm'],
      streaming: false,
      supportsInterrupt: true,
      supportsVoiceSelection: true,
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
      ...(settings as Partial<OpenAITTSConfig>),
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
      const audio = await this.requestSpeech(text)
      if (this.activeContextId !== contextId || contextId < 0) {
        return
      }
      this.onEvent?.({ type: 'audio', audio, contextId })
      this.onEvent?.({ type: 'closed', contextId })
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

  private async requestSpeech(text: string): Promise<Uint8Array> {
    const baseUrl = normalizeBaseUrl(this.config.baseUrl)
    const response = await fetch(`${baseUrl}/audio/speech`, {
      method: 'POST',
      signal: this.abortController?.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model || 'gpt-4o-mini-tts',
        voice: this.config.voiceId || 'alloy',
        input: text,
        response_format: 'pcm',
        ...(this.config.instructions ? { instructions: this.config.instructions } : {}),
        ...(this.config.speed ? { speed: this.config.speed } : {}),
      }),
    })

    const body = new Uint8Array(await response.arrayBuffer())
    if (!response.ok) {
      throw new Error(decodeErrorBody(body) || `OpenAI TTS request failed with HTTP ${response.status}`)
    }

    const sourceRate = this.config.providerSampleRate || 24000
    const targetRate = this.config.sampleRate || 16000
    return sourceRate === targetRate ? body : resamplePcm16(body, sourceRate, targetRate)
  }
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '')
}

function decodeErrorBody(body: Uint8Array): string {
  const text = new TextDecoder().decode(body).trim()
  if (!text) {
    return ''
  }
  try {
    const json = JSON.parse(text)
    return json?.error?.message || text.slice(0, 300)
  } catch {
    return text.slice(0, 300)
  }
}

function resamplePcm16(bytes: Uint8Array, sourceRate: number, targetRate: number): Uint8Array {
  const input = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2))
  const outputLength = Math.max(1, Math.round(input.length * targetRate / sourceRate))
  const output = new Int16Array(outputLength)
  const ratio = sourceRate / targetRate

  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = i * ratio
    const left = Math.floor(sourceIndex)
    const right = Math.min(input.length - 1, left + 1)
    const weight = sourceIndex - left
    output[i] = Math.round(input[left] * (1 - weight) + input[right] * weight)
  }

  return new Uint8Array(output.buffer)
}
