/**
 * Fish Audio TTS using the official Fish Audio WebSocket example shape.
 */

import { FishAudioClient, RealtimeEvents } from 'fish-audio'

export interface FishTTSOfficialConfig {
  apiKey: string
  voiceId?: string
  model?: string
  format?: 'mp3' | 'pcm' | 'opus'
  sampleRate?: number
  latency?: 'normal' | 'balanced' | 'low'
}

export type FishTTSOfficialEvent =
  | { type: 'connected' }
  | { type: 'audio'; audio: Uint8Array }
  | { type: 'error'; error: Error }
  | { type: 'closed' }

export class FishTTSOfficial {
  private client: FishAudioClient
  private config: FishTTSOfficialConfig
  private onEvent?: (event: FishTTSOfficialEvent) => void
  private currentConnection: any = null
  private textQueue: string[] = []
  private isStreaming = false
  private closePromise: Promise<void> | null = null
  private closeResolver: (() => void) | null = null

  constructor(config: FishTTSOfficialConfig) {
    this.config = config
    this.client = new FishAudioClient({
      apiKey: config.apiKey,
      baseUrl: 'https://api.fish.audio',
    })
  }

  setEventHandler(handler: (event: FishTTSOfficialEvent) => void): void {
    this.onEvent = handler
  }

  async startStreaming(): Promise<void> {
    if (this.isStreaming) {
      console.warn('[FishTTSOfficial] Already streaming')
      return
    }

    this.isStreaming = true
    this.textQueue = []
    this.closePromise = new Promise((resolve) => {
      this.closeResolver = resolve
    })

    const request: Record<string, unknown> = {
      text: '',
      format: this.config.format || 'pcm',
    }

    if (this.config.voiceId) {
      request.reference_id = this.config.voiceId
    }

    if (this.config.sampleRate) {
      request.sample_rate = this.config.sampleRate
    }

    const latency = this.normalizeLatency(this.config.latency)
    if (latency) {
      request.latency = latency
    }

    console.log('[FishTTSOfficial] Starting streaming with request:', request)

    try {
      const connection = await this.client.textToSpeech.convertRealtime(
        request as any,
        this.createTextStream()
      )

      this.currentConnection = connection

      connection.on(RealtimeEvents.OPEN, () => {
        console.log('[FishTTSOfficial] WebSocket opened')
        this.onEvent?.({ type: 'connected' })
      })

      connection.on(RealtimeEvents.AUDIO_CHUNK, (audio: unknown) => {
        if (audio instanceof Uint8Array || Buffer.isBuffer(audio)) {
          const audioData = audio instanceof Uint8Array ? audio : new Uint8Array(audio)
          console.log('[FishTTSOfficial] Received audio chunk:', audioData.length, 'bytes')
          this.onEvent?.({ type: 'audio', audio: audioData })
        }
      })

      connection.on(RealtimeEvents.ERROR, (err: any) => {
        const normalizedError = err instanceof Error ? err : new Error(String(err))
        console.error('[FishTTSOfficial] WebSocket error:', normalizedError)
        this.onEvent?.({ type: 'error', error: normalizedError })
      })

      connection.on(RealtimeEvents.CLOSE, () => {
        console.log('[FishTTSOfficial] WebSocket closed')
        this.resetStreamingState()
        this.currentConnection = null
        this.onEvent?.({ type: 'closed' })

        if (this.closeResolver) {
          this.closeResolver()
          this.closeResolver = null
          this.closePromise = null
        }
      })
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      console.error('[FishTTSOfficial] Failed to start streaming:', normalizedError)
      this.resetStreamingState()
      this.onEvent?.({ type: 'error', error: normalizedError })
      throw normalizedError
    }
  }

  async pushText(text: string): Promise<void> {
    if (!this.isStreaming) {
      console.warn('[FishTTSOfficial] Not streaming, ignoring text')
      return
    }

    if (!text.trim()) {
      return
    }

    console.log('[FishTTSOfficial] Pushing text:', text)
    this.textQueue.push(text)
  }

  async finishStreaming(): Promise<void> {
    if (!this.isStreaming) {
      return
    }

    console.log('[FishTTSOfficial] Finishing streaming')
    this.isStreaming = false

    if (this.closePromise) {
      await Promise.race([
        this.closePromise,
        new Promise((resolve) => setTimeout(resolve, 5000))
      ])
    }
  }

  async close(): Promise<void> {
    if (!this.isStreaming && !this.currentConnection) {
      return
    }

    console.log('[FishTTSOfficial] Closing connection')
    this.resetStreamingState()

    try {
      this.currentConnection?.close?.()
    } catch (error) {
      console.warn('[FishTTSOfficial] Failed to close websocket connection:', error)
    }

    if (this.closePromise) {
      await Promise.race([
        this.closePromise,
        new Promise((resolve) => setTimeout(resolve, 3000))
      ])
    }

    this.currentConnection = null
  }

  private async *createTextStream(): AsyncGenerator<string, void, unknown> {
    while (this.isStreaming || this.textQueue.length > 0) {
      if (this.textQueue.length > 0) {
        const text = this.textQueue.shift()!
        yield text
      } else {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
  }

  private normalizeLatency(
    latency?: FishTTSOfficialConfig['latency']
  ): 'normal' | 'balanced' | undefined {
    if (latency === 'normal' || latency === 'balanced') {
      return latency
    }

    return undefined
  }

  private resetStreamingState(): void {
    this.isStreaming = false
    this.textQueue = []
  }
}
