import { EventEmitter } from 'events'
import { FishAudioClient, RealtimeEvents } from 'fish-audio'

export class TTSService extends EventEmitter {
  private client: FishAudioClient
  private voiceId?: string
  private model: string
  private connection: any = null
  private textQueue: string[] = []
  private isStreaming = false

  constructor(apiKey: string, voiceId?: string, model?: string) {
    super()
    this.client = new FishAudioClient({ apiKey })
    this.voiceId = voiceId
    this.model = model || 's2-pro'
  }

  async startStreaming(): Promise<void> {
    if (this.isStreaming) {
      console.warn('[TTSService] Already streaming')
      return
    }

    this.isStreaming = true
    this.textQueue = []

    const request: any = {
      text: '', // 流式模式必须为空
      format: 'pcm',
      sample_rate: 16000,
      latency: 'balanced',
    }

    if (this.voiceId) {
      request.reference_id = this.voiceId
    }

    console.log('[TTSService] Starting streaming with Fish Audio SDK')

    try {
      this.connection = await this.client.textToSpeech.convertRealtime(
        request,
        this.createTextStream(),
        { backend: this.model } as any
      )

      this.connection.on(RealtimeEvents.OPEN, () => {
        console.log('[TTSService] WebSocket opened')
        this.emit('connected')
      })

      this.connection.on(RealtimeEvents.AUDIO_CHUNK, (audio: unknown) => {
        if (audio instanceof Uint8Array || Buffer.isBuffer(audio)) {
          const audioData = audio instanceof Uint8Array ? audio : new Uint8Array(audio)
          console.log('[TTSService] Received audio chunk:', audioData.length, 'bytes')
          this.emit('audio', audioData)
        }
      })

      this.connection.on(RealtimeEvents.ERROR, (err: any) => {
        console.error('[TTSService] Error:', err)
        this.emit('error', err)
      })

      this.connection.on(RealtimeEvents.CLOSE, () => {
        console.log('[TTSService] Connection closed')
        this.isStreaming = false
        this.connection = null
        this.emit('closed')
      })
    } catch (error) {
      console.error('[TTSService] Failed to start streaming:', error)
      this.isStreaming = false
      throw error
    }
  }

  async pushText(text: string): Promise<void> {
    if (!this.isStreaming) {
      console.warn('[TTSService] Not streaming, ignoring text')
      return
    }

    if (!text.trim()) {
      return
    }

    console.log('[TTSService] Pushing text:', text)
    this.textQueue.push(text)
  }

  async finishStreaming(): Promise<void> {
    if (!this.isStreaming) {
      return
    }

    console.log('[TTSService] Finishing streaming')
    this.isStreaming = false
  }

  async stop(): Promise<void> {
    this.isStreaming = false
    this.textQueue = []
    this.connection = null
  }

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
