/**
 * Fish Audio TTS using the official Fish Audio WebSocket example shape.
 *
 * 支持打断处理 (移植自 Pipecat):
 * - 当检测到用户打断时，立即停止播放并清空队列
 * - 实现 InterruptionHandler 接口
 */

import { FishAudioClient, RealtimeEvents } from 'fish-audio'
import type { InterruptionHandler } from '../turn/types.js'
import type { TTSProvider, TTSProviderEvent } from './providers.js'

export interface FishTTSOfficialConfig {
  apiKey: string
  voiceId?: string
  model?: string
  format?: 'mp3' | 'pcm' | 'opus'
  sampleRate?: number
  latency?: 'normal' | 'balanced' | 'low'
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

  // 打断状态 (移植自 Pipecat)
  private _isInterrupted = false

  // Context ID 系统 (移植自 Pipecat)
  // 每个 TTS 流有唯一的 context ID，用于防止旧音频混入
  private _contextId: number = 0
  private _activeContextId: number = 0

  // 关闭操作的 Promise，用于确保 startStreaming 等待上一次关闭完成
  private _closingPromise: Promise<void> | null = null

  constructor(config: FishTTSOfficialConfig) {
    this.config = config
    this.client = new FishAudioClient({
      apiKey: config.apiKey,
      baseUrl: 'https://api.fish.audio',
    })
  }

  /**
   * 是否被打断
   */
  get isInterrupted(): boolean {
    return this._isInterrupted
  }

  /**
   * 重置打断状态
   * 在新的轮次开始时调用
   */
  resetInterruption(): void {
    this._isInterrupted = false
  }

  /**
   * 处理打断 (实现 InterruptionHandler 接口)
   *
   * 移植自 Pipecat:
   * 1. 标记为已打断
   * 2. 使当前 context 失效
   * 3. 清空待处理的文本队列
   * 4. 关闭当前连接
   */
  async onInterruption(): Promise<void> {
    await this.interrupt()
  }

  async interrupt(): Promise<void> {
    const interruptedContextId = this._activeContextId
    console.log(`[FishTTSOfficial] Handling interruption (context #${interruptedContextId})`)

    this._isInterrupted = true
    // 使 context 失效，后续音频会被丢弃
    this._activeContextId = -1
    this.textQueue = [] // 清空待处理文本
    await this.close() // 关闭连接
  }

  setEventHandler(handler: (event: FishTTSOfficialEvent) => void): void {
    this.onEvent = handler
  }

  /**
   * 获取当前活跃的 context ID
   * Renderer 用此 ID 验证音频是否属于当前上下文
   */
  getActiveContextId(): number {
    return this._activeContextId
  }

  async startStreaming(): Promise<void> {
    // 关键：等待上一次 close 操作完成
    // 这防止了 "B 不说话" 的问题
    if (this._closingPromise) {
      console.log('[FishTTSOfficial] Waiting for previous close to complete...')
      await this._closingPromise
      console.log('[FishTTSOfficial] Previous close completed')
    }

    if (this.isStreaming || this.currentConnection) {
      console.warn('[FishTTSOfficial] Previous stream still active, closing before starting a new context')
      this._isInterrupted = true
      this._activeContextId = -1
      this.textQueue = []
      await this.close()
    }

    // 生成新的 context ID (移植自 Pipecat)
    this._contextId++
    this._activeContextId = this._contextId
    const streamContextId = this._activeContextId
    console.log(`[FishTTSOfficial] Starting new context #${streamContextId}`)

    this.isStreaming = true
    this._isInterrupted = false // 重置打断状态
    this.textQueue = []
    this.pushedTextCount = 0
    this.yieldedTextCount = 0
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
    // 被打断后不接受新文本 (移植自 Pipecat)
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
    if (!this.isStreaming && !this.currentConnection) {
      return
    }

    // 记录正在关闭的 context ID
    const closingContextId = this._activeContextId
    console.log(`[FishTTSOfficial] Closing connection (context #${closingContextId})`)

    // 创建 closing promise 供 startStreaming 等待
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

    // 标记关闭完成
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
