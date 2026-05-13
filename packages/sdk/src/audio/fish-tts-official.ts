

import { FishAudioClient, RealtimeEvents } from 'fish-audio'
import type { InterruptionHandler } from '../turn/types.js'
import type { TTSProvider, TTSProviderCapabilities, TTSProviderEvent } from './providers.js'

export interface FishTTSOfficialConfig {
  apiKey: string
  voiceId?: string
  model?: string
  format?: 'mp3' | 'pcm' | 'opus'
  sampleRate?: number
  latency?: 'normal' | 'balanced' | 'low'
  normalize?: boolean
  prosody?: {
    speed?: number
    volume?: number
  }
}

export type FishTTSOfficialEvent = TTSProviderEvent

export class FishTTSOfficial implements TTSProvider, InterruptionHandler {
  private client: FishAudioClient
  private config: FishTTSOfficialConfig
  private onEvent?: (event: FishTTSOfficialEvent) => void
  private currentConnection: any = null
  private textQueue: string[] = []
  private pushedTextCount = 0
  private yieldedTextCount = 0
  private isStreaming = false
  private closePromise: Promise<void> | null = null
  private closeResolver: (() => void) | null = null
  private startStreamingPromise: Promise<void> | null = null

  private _isInterrupted = false

  private _contextId: number = 0
  private _activeContextId: number = 0

  private _closingPromise: Promise<void> | null = null

  constructor(config: FishTTSOfficialConfig) {
    this.config = config
    this.client = new FishAudioClient({
      apiKey: config.apiKey,
      baseUrl: 'https://api.fish.audio',
    })
  }

  getCapabilities(): TTSProviderCapabilities {
    return {
      provider: 'fish-audio',
      model: this.config.model,
      sampleRate: this.config.sampleRate || 16000,
      audioFormat: this.config.format || 'pcm',
      streaming: true,
      supportsInterrupt: true,
    }
  }

  async setup(): Promise<void> {
    // No-op: Fish realtime connections are created per stream.
  }

  async start(): Promise<void> {
    await this.startStreaming()
  }

  async updateSettings(settings: unknown): Promise<void> {
    this.config = {
      ...this.config,
      ...(settings as Partial<FishTTSOfficialConfig>),
    }
  }

  async stop(): Promise<void> {
    await this.close()
  }

  async cleanup(): Promise<void> {
    await this.close()
  }

  
  get isInterrupted(): boolean {
    return this._isInterrupted
  }

  
  resetInterruption(): void {
    this._isInterrupted = false
  }

  
  async onInterruption(): Promise<void> {
    await this.interrupt()
  }

  async interrupt(): Promise<void> {
    const interruptedContextId = this._activeContextId
    console.log(`[FishTTSOfficial] Handling interruption (context #${interruptedContextId})`)

    this._isInterrupted = true
    this._activeContextId = -1
    this.textQueue = []
    await this.close()
  }

  setEventHandler(handler: (event: FishTTSOfficialEvent) => void): void {
    this.onEvent = handler
  }

  
  getActiveContextId(): number {
    return this._activeContextId
  }

  async startStreaming(): Promise<void> {
    if (this.startStreamingPromise) {
      await this.startStreamingPromise
      return
    }

    if (this.isStreaming && this.currentConnection) {
      return
    }

    this.startStreamingPromise = this.openStreamingConnection()
    try {
      await this.startStreamingPromise
    } finally {
      this.startStreamingPromise = null
    }
  }

  private async openStreamingConnection(): Promise<void> {
    if (this._closingPromise) {
      console.log('[FishTTSOfficial] Waiting for previous close to complete...')
      await this._closingPromise
      console.log('[FishTTSOfficial] Previous close completed')
    }

    if (this.isStreaming && this.currentConnection) {
      return
    }

    if (this.isStreaming || this.currentConnection) {
      console.warn('[FishTTSOfficial] Previous stream still active, closing before starting a new context')
      this._isInterrupted = true
      this._activeContextId = -1
      this.textQueue = []
      await this.close()
    }

    this._contextId++
    this._activeContextId = this._contextId
    const streamContextId = this._activeContextId
    console.log(`[FishTTSOfficial] Starting new context #${streamContextId}`)

    this.isStreaming = true
    this._isInterrupted = false
    this.textQueue = []
    this.pushedTextCount = 0
    this.yieldedTextCount = 0
    this.closePromise = new Promise((resolve) => {
      this.closeResolver = resolve
    })

    const request: Record<string, unknown> = {
      text: '',
      format: this.config.format || 'pcm',
      normalize: this.config.normalize ?? true,
      prosody: {
        speed: this.config.prosody?.speed ?? 1.0,
        volume: this.config.prosody?.volume ?? 0,
      },
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
        this.createTextStream(streamContextId)
      )

      this.currentConnection = connection

      connection.on(RealtimeEvents.OPEN, () => {
        if (this.currentConnection !== connection || this._activeContextId !== streamContextId) {
          return
        }
        console.log('[FishTTSOfficial] WebSocket opened')
        this.onEvent?.({ type: 'connected', contextId: streamContextId })
      })

      connection.on(RealtimeEvents.AUDIO_CHUNK, (audio: unknown) => {
        if (this.currentConnection !== connection || this._activeContextId !== streamContextId) {
          console.log(`[FishTTSOfficial] Dropping stale audio chunk from context #${streamContextId}`)
          return
        }
        if (audio instanceof Uint8Array || Buffer.isBuffer(audio)) {
          const audioData = audio instanceof Uint8Array ? audio : new Uint8Array(audio)
          console.log('[FishTTSOfficial] Received audio chunk:', audioData.length, 'bytes')
          this.onEvent?.({ type: 'audio', audio: audioData, contextId: streamContextId })
        }
      })

      connection.on(RealtimeEvents.ERROR, (err: any) => {
        if (this.currentConnection !== connection || this._activeContextId !== streamContextId) {
          return
        }
        const normalizedError = err instanceof Error ? err : new Error(String(err))
        console.error('[FishTTSOfficial] WebSocket error:', normalizedError)
        this.onEvent?.({ type: 'error', error: normalizedError })
      })

      connection.on(RealtimeEvents.CLOSE, () => {
        console.log(`[FishTTSOfficial] WebSocket closed (context #${streamContextId})`)
        const isCurrentContext = this.currentConnection === connection && this._activeContextId === streamContextId
        if (this.currentConnection === connection) {
          this.resetStreamingState()
          this.currentConnection = null
        }
        if (isCurrentContext) {
          this.onEvent?.({ type: 'closed', contextId: streamContextId })
        }

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
    if (this._isInterrupted) {
      console.log('[FishTTSOfficial] Interrupted, ignoring text')
      return
    }

    if (!this.isStreaming) {
      console.warn('[FishTTSOfficial] Not streaming, ignoring text')
      return
    }

    if (!text.trim()) {
      return
    }

    this.pushedTextCount += 1
    console.log(`[FishTTSOfficial] Queued text #${this.pushedTextCount}:`, JSON.stringify(text))
    this.textQueue.push(text)
  }

  async finishStreaming(): Promise<void> {
    if (!this.isStreaming) {
      return
    }

    console.log('[FishTTSOfficial] Finishing streaming')
    this.isStreaming = false

    if (this.closePromise) {
      const timedOut = Symbol('tts-finish-timeout')
      const result = await Promise.race([
        this.closePromise,
        new Promise((resolve) => setTimeout(() => resolve(timedOut), 60000))
      ])

      if (result === timedOut) {
        console.warn('[FishTTSOfficial] Timed out waiting for TTS stream to close')
      }
    }
  }

  async close(): Promise<void> {
    await this.startStreamingPromise?.catch(() => undefined)

    if (!this.isStreaming && !this.currentConnection) {
      return
    }

    const closingContextId = this._activeContextId
    console.log(`[FishTTSOfficial] Closing connection (context #${closingContextId})`)

    let closingResolve: () => void
    this._closingPromise = new Promise((resolve) => {
      closingResolve = resolve
    })

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

    closingResolve!()
    this._closingPromise = null
    console.log(`[FishTTSOfficial] Close completed (context #${closingContextId})`)
  }

  private async *createTextStream(contextId: number): AsyncGenerator<string, void, unknown> {
    while (this._activeContextId === contextId && (this.isStreaming || this.textQueue.length > 0)) {
      if (this.textQueue.length > 0) {
        const text = this.textQueue.shift()!
        this.yieldedTextCount += 1
        console.log(`[FishTTSOfficial] Yielding text #${this.yieldedTextCount} to context #${contextId}:`, JSON.stringify(text))
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
    this.pushedTextCount = 0
    this.yieldedTextCount = 0
  }
}
