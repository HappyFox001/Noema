import { FishRealtimeTTS } from '@her-text/sdk'
import { TauriRealtimeWebSocketTransport } from './realtime-transport'

/**
 * Audio player for TTS output
 * Plays PCM16 audio chunks using Web Audio API
 */

export interface AudioPlayerConfig {
  sampleRate: number
  channelCount: number
  bitsPerSample: number
}

const DEFAULT_CONFIG: AudioPlayerConfig = {
  sampleRate: 16000, // 16kHz
  channelCount: 1, // mono
  bitsPerSample: 16, // 16-bit PCM
}

export class AudioPlayer {
  private audioContext: AudioContext | null = null
  private config: AudioPlayerConfig
  private isPlaying = false
  private audioQueue: AudioBuffer[] = []
  private currentSource: AudioBufferSourceNode | null = null
  private nextStartTime = 0
  private onPlaybackEndCallback: (() => void) | null = null

  constructor(config: Partial<AudioPlayerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Initialize audio player
   */
  async initialize(): Promise<void> {
    try {
      this.audioContext = new AudioContext({
        sampleRate: this.config.sampleRate,
      })
      console.log('Audio player initialized')
    } catch (error) {
      console.error('Failed to initialize audio player:', error)
      throw error
    }
  }

  /**
   * Convert PCM16 bytes to AudioBuffer
   */
  private pcm16ToAudioBuffer(pcm16Bytes: Uint8Array): AudioBuffer {
    if (!this.audioContext) {
      throw new Error('Audio context not initialized')
    }

    // Convert bytes to Int16Array
    const pcm16 = new Int16Array(
      pcm16Bytes.buffer,
      pcm16Bytes.byteOffset,
      pcm16Bytes.byteLength / 2
    )

    // Create audio buffer
    const audioBuffer = this.audioContext.createBuffer(
      this.config.channelCount,
      pcm16.length,
      this.config.sampleRate
    )

    // Convert Int16 to Float32 and copy to buffer
    const channelData = audioBuffer.getChannelData(0)
    for (let i = 0; i < pcm16.length; i++) {
      // Normalize Int16 to Float32 [-1, 1]
      channelData[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7fff)
    }

    return audioBuffer
  }

  /**
   * Play audio buffer
   */
  private playBuffer(buffer: AudioBuffer): void {
    if (!this.audioContext) return

    const source = this.audioContext.createBufferSource()
    source.buffer = buffer
    source.connect(this.audioContext.destination)

    // Calculate start time for seamless playback
    const currentTime = this.audioContext.currentTime
    const startTime = Math.max(currentTime, this.nextStartTime)

    source.start(startTime)
    this.nextStartTime = startTime + buffer.duration

    // Handle playback end
    source.onended = () => {
      if (this.audioQueue.length > 0) {
        // Play next buffer from queue
        const nextBuffer = this.audioQueue.shift()!
        this.playBuffer(nextBuffer)
      } else {
        this.isPlaying = false
        if (this.onPlaybackEndCallback) {
          this.onPlaybackEndCallback()
        }
      }
    }

    this.currentSource = source
  }

  /**
   * Add audio chunk to playback queue
   */
  async addAudioChunk(pcm16Bytes: Uint8Array): Promise<void> {
    try {
      if (this.audioContext?.state === 'suspended') {
        await this.audioContext.resume()
      }

      const audioBuffer = this.pcm16ToAudioBuffer(pcm16Bytes)

      if (this.isPlaying) {
        // Add to queue if already playing
        this.audioQueue.push(audioBuffer)
      } else {
        // Start playing immediately
        this.isPlaying = true
        this.nextStartTime = this.audioContext!.currentTime
        this.playBuffer(audioBuffer)
      }
    } catch (error) {
      console.error('Failed to add audio chunk:', error)
    }
  }

  /**
   * Stop playback
   */
  stop(): void {
    if (this.currentSource) {
      this.currentSource.stop()
      this.currentSource = null
    }
    this.audioQueue = []
    this.isPlaying = false
    this.nextStartTime = 0
  }

  /**
   * Set callback for playback end
   */
  onPlaybackEnd(callback: () => void): void {
    this.onPlaybackEndCallback = callback
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.stop()

    if (this.audioContext) {
      await this.audioContext.close()
      this.audioContext = null
    }

    console.log('Audio player cleaned up')
  }

  isActive(): boolean {
    return this.isPlaying
  }
}

/**
 * TTS manager - integrates text synthesis with audio playback
 */
export class TTSManager {
  private audioPlayer: AudioPlayer
  private isInitialized = false
  private isSynthesizing = false
  private onPlaybackEndCallback: (() => void) | null = null
  private didFinishCurrentPlayback = false
  private apiKey = ''
  private voiceId?: string
  private model?: string
  private tts: FishRealtimeTTS | null = null

  constructor() {
    this.audioPlayer = new AudioPlayer()
  }

  /**
   * Initialize with Fish Audio API key
   */
  async initialize(apiKey: string, voiceId?: string, model?: string): Promise<void> {
    try {
      if (!apiKey.trim()) {
        throw new Error('Fish Audio API key is not configured')
      }

      // Initialize audio player
      await this.audioPlayer.initialize()

      this.apiKey = apiKey
      this.voiceId = voiceId
      this.model = model
      this.isInitialized = true
      console.log('TTS manager initialized')
    } catch (error) {
      console.error('Failed to initialize TTS:', error)
      throw error
    }
  }

  /**
   * Synthesize text and play audio
   */
  async speak(text: string): Promise<void> {
    await this.startStreaming()
    await this.pushText(text)
    await this.flush()
    await this.finishStreaming()
  }

  async startStreaming(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('TTS manager not initialized')
    }

    this.didFinishCurrentPlayback = false

    this.isSynthesizing = true

    this.audioPlayer.onPlaybackEnd(() => {
      this.isSynthesizing = false
      this.finishPlayback()
    })

    this.tts = new FishRealtimeTTS(
      {
        apiKey: this.apiKey,
        voiceId: this.voiceId,
        model: this.model || 's2-pro',
        format: 'pcm',
        sampleRate: 16000,
        latency: 'balanced',
      },
      new TauriRealtimeWebSocketTransport()
    )

    this.tts.setEventHandler((event) => {
      if (event.type === 'audio') {
        void this.audioPlayer.addAudioChunk(event.audio)
      } else if (event.type === 'finish') {
        console.log('[FishRealtimeTTS] finish:', event)
      } else if (event.type === 'event') {
        console.log('[FishRealtimeTTS] event:', event.event, event.payload)
      } else if (event.type === 'error') {
        console.error('[FishRealtimeTTS] error:', event.error)
      } else if (event.type === 'close') {
        this.isSynthesizing = false
        if (!this.audioPlayer.isActive()) {
          this.finishPlayback()
        }
      }
    })

    try {
      await this.tts.start()
    } catch (error) {
      this.isSynthesizing = false
      throw error
    }
  }

  async pushText(text: string): Promise<void> {
    if (!this.isInitialized || !this.isSynthesizing) {
      return
    }

    if (!text.trim()) {
      return
    }

    try {
      await this.tts?.sendText(text)
    } catch (error) {
      this.isSynthesizing = false
      console.error('TTS text streaming failed:', error)
      throw error
    }
  }

  async flush(): Promise<void> {
    if (!this.isInitialized || !this.isSynthesizing) {
      return
    }

    await this.tts?.flush()
  }

  async pushTextAndFlush(text: string): Promise<void> {
    if (!this.isInitialized || !this.isSynthesizing) {
      return
    }

    if (!text.trim()) {
      return
    }

    try {
      await this.tts?.sendTextAndFlush(text)
    } catch (error) {
      this.isSynthesizing = false
      console.error('TTS text streaming failed:', error)
      throw error
    }
  }

  async finishStreaming(): Promise<void> {
    if (!this.isInitialized || !this.isSynthesizing) {
      return
    }

    await this.tts?.stop()
  }

  /**
   * Stop speaking
   */
  stop(): void {
    this.isSynthesizing = false
    this.audioPlayer.stop()
    void this.tts?.close()
    this.tts = null
    this.didFinishCurrentPlayback = true
  }

  /**
   * Set callback for playback end
   */
  onPlaybackEnd(callback: () => void): void {
    this.onPlaybackEndCallback = callback
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.stop()
    await this.audioPlayer.cleanup()

    this.isInitialized = false
    console.log('TTS manager cleaned up')
  }

  isActive(): boolean {
    return this.isSynthesizing || this.audioPlayer.isActive()
  }

  isReady(): boolean {
    return this.isInitialized
  }

  private finishPlayback(): void {
    if (this.didFinishCurrentPlayback) {
      return
    }

    this.didFinishCurrentPlayback = true
    if (this.onPlaybackEndCallback) {
      this.onPlaybackEndCallback()
    }
  }
}
