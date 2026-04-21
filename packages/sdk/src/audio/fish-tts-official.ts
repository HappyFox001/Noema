/**
 * Fish Audio TTS using official SDK
 * 基于官方 fish-audio SDK 的实时 TTS 实现
 */

import { FishAudioClient, RealtimeEvents } from 'fish-audio'

export interface FishTTSOfficialConfig {
  apiKey: string
  voiceId?: string
  model?: string // 's1' | 's2-pro'
  format?: 'mp3' | 'pcm' | 'opus'
  sampleRate?: number
  latency?: 'normal' | 'balanced' | 'low'
}

export type FishTTSOfficialEvent =
  | { type: 'connected' }
  | { type: 'audio'; audio: Uint8Array }
  | { type: 'error'; error: Error }
  | { type: 'closed' }

/**
 * 官方 SDK 封装的 Fish TTS 客户端
 */
export class FishTTSOfficial {
  private client: FishAudioClient
  private config: FishTTSOfficialConfig
  private onEvent?: (event: FishTTSOfficialEvent) => void
  private currentConnection: any = null
  private textQueue: string[] = []
  private isStreaming = false

  constructor(config: FishTTSOfficialConfig) {
    this.config = config
    this.client = new FishAudioClient({
      apiKey: config.apiKey,
    })
  }

  setEventHandler(handler: (event: FishTTSOfficialEvent) => void): void {
    this.onEvent = handler
  }

  /**
   * 开始流式 TTS
   */
  async startStreaming(): Promise<void> {
    if (this.isStreaming) {
      console.warn('[FishTTSOfficial] Already streaming')
      return
    }

    this.isStreaming = true
    this.textQueue = []

    // 创建文本流生成器
    const textStream = this.createTextStream()

    // 构建请求
    const request: any = {
      text: '', // 流式模式下必须为空字符串
      format: this.config.format || 'pcm',
    }

    if (this.config.voiceId) {
      request.reference_id = this.config.voiceId
    }

    // 其他参数
    if (this.config.sampleRate) {
      request.sample_rate = this.config.sampleRate
    }

    if (this.config.latency) {
      request.latency = this.config.latency
    }

    console.log('[FishTTSOfficial] Starting streaming with request:', request)

    try {
      // 创建连接
      const connection = await this.client.textToSpeech.convertRealtime(
        request,
        textStream,
        { backend: this.config.model || 's2-pro' } as any
      )

      this.currentConnection = connection

      // 设置事件监听
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
        console.error('[FishTTSOfficial] WebSocket error:', err)
        this.onEvent?.({ type: 'error', error: err })
      })

      connection.on(RealtimeEvents.CLOSE, () => {
        console.log('[FishTTSOfficial] WebSocket closed')
        this.isStreaming = false
        this.currentConnection = null
        this.onEvent?.({ type: 'closed' })
      })
    } catch (error) {
      console.error('[FishTTSOfficial] Failed to start streaming:', error)
      this.isStreaming = false
      throw error
    }
  }

  /**
   * 添加文本到流
   */
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

  /**
   * 结束流式 TTS
   */
  async finishStreaming(): Promise<void> {
    if (!this.isStreaming) {
      return
    }

    console.log('[FishTTSOfficial] Finishing streaming')
    // 标记为结束，文本流生成器会自动完成
    this.isStreaming = false
  }

  /**
   * 停止并关闭连接
   */
  async close(): Promise<void> {
    this.isStreaming = false
    this.textQueue = []
    this.currentConnection = null
  }

  /**
   * 创建文本流生成器
   */
  private async *createTextStream(): AsyncGenerator<string, void, unknown> {
    while (this.isStreaming || this.textQueue.length > 0) {
      if (this.textQueue.length > 0) {
        const text = this.textQueue.shift()!
        yield text
      } else {
        // 等待更多文本
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
  }
}
