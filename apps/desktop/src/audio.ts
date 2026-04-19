import { invoke } from '@tauri-apps/api/core'

/**
 * Audio capture and processing utilities
 * Based on sensory-server's audio pipeline
 */

export interface AudioConfig {
  sampleRate: number
  channelCount: number
  bitsPerSample: number
  bufferSize: number
}

const DEFAULT_CONFIG: AudioConfig = {
  sampleRate: 16000, // 16kHz as per sensory-server
  channelCount: 1, // mono
  bitsPerSample: 16, // 16-bit PCM
  bufferSize: 2048, // samples per frame
}

export class AudioCapture {
  private audioContext: AudioContext | null = null
  private mediaStream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private config: AudioConfig
  private isRecording = false
  private onAudioCallback: ((data: Int16Array) => void) | null = null

  constructor(config: Partial<AudioConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Initialize audio capture
   */
  async initialize(): Promise<void> {
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          'Microphone capture is not available in this WebView context. On macOS, make sure the app has NSMicrophoneUsageDescription and the audio-input entitlement, then restart the Tauri app.'
        )
      }

      // Request microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.config.sampleRate,
          channelCount: this.config.channelCount,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      // Create audio context
      this.audioContext = new AudioContext({
        sampleRate: this.config.sampleRate,
      })

      // Create source from microphone
      this.source = this.audioContext.createMediaStreamSource(this.mediaStream)

      // Create script processor for audio processing
      this.processor = this.audioContext.createScriptProcessor(
        this.config.bufferSize,
        this.config.channelCount,
        this.config.channelCount
      )

      // Set up audio processing
      this.processor.onaudioprocess = (e) => {
        if (!this.isRecording || !this.onAudioCallback) return

        const inputData = e.inputBuffer.getChannelData(0)

        // Convert Float32 to Int16 (PCM16 format)
        const pcm16 = new Int16Array(inputData.length)
        for (let i = 0; i < inputData.length; i++) {
          // Clamp to [-1, 1] and convert to 16-bit
          const s = Math.max(-1, Math.min(1, inputData[i]))
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
        }

        this.onAudioCallback(pcm16)
      }

      // Connect the audio graph
      this.source.connect(this.processor)
      this.processor.connect(this.audioContext.destination)

      console.log('Audio capture initialized')
    } catch (error) {
      console.error('Failed to initialize audio capture:', error)
      throw error
    }
  }

  /**
   * Start recording
   */
  start(callback: (data: Int16Array) => void): void {
    if (!this.audioContext || !this.processor) {
      throw new Error('Audio capture not initialized')
    }

    this.onAudioCallback = callback
    this.isRecording = true
    console.log('Audio capture started')
  }

  /**
   * Stop recording
   */
  stop(): void {
    this.isRecording = false
    this.onAudioCallback = null
    console.log('Audio capture stopped')
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.stop()

    if (this.processor) {
      this.processor.disconnect()
      this.processor = null
    }

    if (this.source) {
      this.source.disconnect()
      this.source = null
    }

    if (this.audioContext) {
      await this.audioContext.close()
      this.audioContext = null
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop())
      this.mediaStream = null
    }

    console.log('Audio capture cleaned up')
  }

  isActive(): boolean {
    return this.isRecording
  }
}

/**
 * Voice input manager - integrates audio capture with VAD and STT
 */
export class VoiceInputManager {
  private audioCapture: AudioCapture
  private audioBuffer: number[] = []
  private isInitialized = false
  private isListening = false
  private onTranscriptCallback: ((text: string) => void) | null = null

  constructor() {
    this.audioCapture = new AudioCapture()
  }

  /**
   * Initialize with STT API key
   */
  async initialize(apiKey: string): Promise<void> {
    try {
      // Initialize audio capture
      await this.audioCapture.initialize()

      // Initialize STT service
      await invoke('init_stt', { apiKey })

      this.isInitialized = true
      console.log('Voice input manager initialized')
    } catch (error) {
      console.error('Failed to initialize voice input:', error)
      throw error
    }
  }

  /**
   * Start listening for voice input
   */
  startListening(onTranscript: (text: string) => void): void {
    if (!this.isInitialized) {
      throw new Error('Voice input manager not initialized')
    }

    this.onTranscriptCallback = onTranscript
    this.isListening = true
    this.audioBuffer = []

    this.audioCapture.start(async (pcm16) => {
      if (!this.isListening) return

      try {
        // Convert Int16Array to regular array for Tauri
        const audioData = Array.from(pcm16)

        // Check for voice activity
        const isSpeech = await invoke<boolean>('process_audio', { audioData })

        if (isSpeech) {
          // Accumulate audio while speech is detected
          this.audioBuffer.push(...audioData)

          // Limit buffer size (max 5 seconds at 16kHz)
          const maxBufferSize = 16000 * 5
          if (this.audioBuffer.length > maxBufferSize) {
            this.audioBuffer = this.audioBuffer.slice(-maxBufferSize)
          }
        } else if (this.audioBuffer.length > 0) {
          // Speech ended, transcribe accumulated audio
          console.log('Speech ended, transcribing...')

          try {
            const text = await invoke<string>('transcribe_audio', {
              audioData: this.audioBuffer,
            })

            if (text && this.onTranscriptCallback) {
              this.onTranscriptCallback(text)
            }
          } catch (error) {
            console.error('Transcription failed:', error)
          }

          // Clear buffer
          this.audioBuffer = []
        }
      } catch (error) {
        console.error('Audio processing error:', error)
      }
    })

    console.log('Started listening for voice input')
  }

  /**
   * Stop listening
   */
  stopListening(): void {
    this.isListening = false
    this.audioCapture.stop()
    this.audioBuffer = []
    console.log('Stopped listening')
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.stopListening()
    await this.audioCapture.cleanup()

    try {
      await invoke('shutdown_audio')
    } catch (error) {
      console.error('Failed to shutdown audio:', error)
    }

    this.isInitialized = false
    console.log('Voice input manager cleaned up')
  }

  isActive(): boolean {
    return this.isListening
  }
}
