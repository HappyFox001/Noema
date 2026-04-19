import { invoke } from '@tauri-apps/api/core'

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
  addAudioChunk(pcm16Bytes: Uint8Array): void {
    try {
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

  constructor() {
    this.audioPlayer = new AudioPlayer()
  }

  /**
   * Initialize with Fish Audio API key
   */
  async initialize(apiKey: string, voiceId?: string): Promise<void> {
    try {
      if (!apiKey.trim()) {
        throw new Error('Fish Audio API key is not configured')
      }

      // Initialize audio player
      await this.audioPlayer.initialize()

      // Initialize TTS service
      await invoke('init_tts', { apiKey, voiceId: voiceId || null })

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
    if (!this.isInitialized) {
      throw new Error('TTS manager not initialized')
    }

    this.isSynthesizing = true

    try {
      // Start synthesis
      await invoke('synthesize_text', { text })

      // Receive and play audio chunks
      const receiveLoop = async () => {
        while (this.isSynthesizing) {
          try {
            const audioData = await invoke<number[] | null>('receive_tts_audio')

            if (audioData) {
              // Convert to Uint8Array
              const pcm16Bytes = new Uint8Array(audioData)
              this.audioPlayer.addAudioChunk(pcm16Bytes)
            } else {
              // No more audio chunks
              break
            }
          } catch (error) {
            console.error('Failed to receive TTS audio:', error)
            break
          }
        }
      }

      // Start receiving audio chunks
      receiveLoop()

      // Set up playback end callback
      this.audioPlayer.onPlaybackEnd(() => {
        this.isSynthesizing = false
        if (this.onPlaybackEndCallback) {
          this.onPlaybackEndCallback()
        }
      })
    } catch (error) {
      this.isSynthesizing = false
      console.error('TTS synthesis failed:', error)
      throw error
    }
  }

  /**
   * Stop speaking
   */
  stop(): void {
    this.isSynthesizing = false
    this.audioPlayer.stop()
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

    try {
      await invoke('shutdown_audio')
    } catch (error) {
      console.error('Failed to shutdown audio:', error)
    }

    this.isInitialized = false
    console.log('TTS manager cleaned up')
  }

  isActive(): boolean {
    return this.isSynthesizing || this.audioPlayer.isActive()
  }
}
