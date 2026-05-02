

import {
  VADState,
  VADParams,
  VADEvent,
  VADAnalyzerInterface,
  VoiceConfidenceProvider,
  DEFAULT_VAD_PARAMS,
  calculateRmsVolume,
  int16ToFloat32,
} from './types.js'


function expSmoothing(value: number, prevValue: number, factor: number): number {
  return factor * value + (1 - factor) * prevValue
}


export interface VADControllerConfig {
  
  speechActivityPeriod: number

  
  audioIdleTimeout: number
}

export const DEFAULT_VAD_CONTROLLER_CONFIG: VADControllerConfig = {
  speechActivityPeriod: 200,
  audioIdleTimeout: 1000,
}


export class VADAnalyzer implements VADAnalyzerInterface {
  private params: VADParams
  private controllerConfig: VADControllerConfig
  private confidenceProvider: VoiceConfidenceProvider

  private vadState: VADState = VADState.QUIET
  private vadBuffer: Float32Array = new Float32Array(0)

  private vadStartingCount = 0
  private vadStoppingCount = 0

  private vadFrames = 0
  private vadStartFrames = 0
  private vadStopFrames = 0

  private smoothingFactor = 0.2
  private prevVolume = 0

  private eventHandler: ((event: VADEvent) => void) | null = null

  private prevState: VADState = VADState.QUIET

  private lastSpeechActivityTime = 0

  private lastAudioTime = 0
  private audioIdleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    confidenceProvider: VoiceConfidenceProvider,
    params?: Partial<VADParams>,
    controllerConfig?: Partial<VADControllerConfig>
  ) {
    this.confidenceProvider = confidenceProvider
    this.params = { ...DEFAULT_VAD_PARAMS, ...params }
    this.controllerConfig = { ...DEFAULT_VAD_CONTROLLER_CONFIG, ...controllerConfig }
    this.calculateFrameThresholds()
  }

  
  private calculateFrameThresholds(): void {
    this.vadFrames = 512

    const framesPerSec = this.params.sampleRate / this.vadFrames

    this.vadStartFrames = Math.round(this.params.startSecs * framesPerSec)
    this.vadStopFrames = Math.round(this.params.stopSecs * framesPerSec)

    this.vadStartFrames = Math.max(1, this.vadStartFrames)
    this.vadStopFrames = Math.max(1, this.vadStopFrames)
  }

  
  setParams(params: Partial<VADParams>): void {
    this.params = { ...this.params, ...params }
    this.calculateFrameThresholds()
    this.reset()
  }

  
  getParams(): VADParams {
    return { ...this.params }
  }

  
  setEventHandler(handler: (event: VADEvent) => void): void {
    this.eventHandler = handler
  }

  
  getState(): VADState {
    return this.vadState
  }

  
  reset(): void {
    this.vadState = VADState.QUIET
    this.prevState = VADState.QUIET
    this.vadBuffer = new Float32Array(0)
    this.vadStartingCount = 0
    this.vadStoppingCount = 0
    this.prevVolume = 0
    this.lastSpeechActivityTime = 0
    this.lastAudioTime = 0
    this.stopAudioIdleTimer()
    this.confidenceProvider.reset()
  }

  
  cleanup(): void {
    this.stopAudioIdleTimer()
  }

  
  private stopAudioIdleTimer(): void {
    if (this.audioIdleTimer) {
      clearTimeout(this.audioIdleTimer)
      this.audioIdleTimer = null
    }
  }

  
  private restartAudioIdleTimer(): void {
    this.stopAudioIdleTimer()

    if (this.vadState !== VADState.SPEAKING) {
      return
    }

    this.audioIdleTimer = setTimeout(() => {
      this.audioIdleTimer = null

      if (this.vadState === VADState.SPEAKING) {
        console.warn('[VAD] Audio idle timeout, forcing speech stop')
        this.vadState = VADState.QUIET
        this.vadStoppingCount = 0
        this.emitEvent('speech_stop', this.params.stopSecs)
        this.prevState = VADState.QUIET
      }
    }, this.controllerConfig.audioIdleTimeout)
  }

  
  private getSmoothedVolume(audio: Float32Array): number {
    const volume = calculateRmsVolume(audio)
    const smoothed = expSmoothing(volume, this.prevVolume, this.smoothingFactor)
    this.prevVolume = smoothed
    return smoothed
  }

  
  private emitEvent(type: VADEvent['type'], stopSecs?: number): void {
    if (this.eventHandler) {
      const event: VADEvent = {
        type,
        timestamp: Date.now(),
      }
      if (stopSecs !== undefined) {
        event.stopSecs = stopSecs
      }
      this.eventHandler(event)
    }
  }

  
  private checkStateChange(): void {
    const now = Date.now()

    if (
      this.vadState === VADState.SPEAKING &&
      (this.prevState === VADState.QUIET || this.prevState === VADState.STARTING)
    ) {
      this.emitEvent('speech_start')
      this.restartAudioIdleTimer()
    }

    if (
      this.vadState === VADState.QUIET &&
      (this.prevState === VADState.SPEAKING || this.prevState === VADState.STOPPING)
    ) {
      this.emitEvent('speech_stop', this.params.stopSecs)
      this.stopAudioIdleTimer()
    }

    if (this.vadState === VADState.SPEAKING && this.prevState === VADState.SPEAKING) {
      if (now - this.lastSpeechActivityTime >= this.controllerConfig.speechActivityPeriod) {
        this.lastSpeechActivityTime = now
        this.emitEvent('speech_activity')
      }
    }

    this.prevState = this.vadState
  }

  
  async analyze(audio: Int16Array | Float32Array): Promise<VADState> {
    this.lastAudioTime = Date.now()

    if (this.vadState === VADState.SPEAKING) {
      this.restartAudioIdleTimer()
    }

    const float32Audio =
      audio instanceof Int16Array ? int16ToFloat32(audio) : audio

    const newBuffer = new Float32Array(this.vadBuffer.length + float32Audio.length)
    newBuffer.set(this.vadBuffer)
    newBuffer.set(float32Audio, this.vadBuffer.length)
    this.vadBuffer = newBuffer

    const numRequiredSamples = this.vadFrames
    if (this.vadBuffer.length < numRequiredSamples) {
      return this.vadState
    }

    while (this.vadBuffer.length >= numRequiredSamples) {
      const audioFrame = this.vadBuffer.slice(0, numRequiredSamples)
      this.vadBuffer = this.vadBuffer.slice(numRequiredSamples)

      const confidence = await this.confidenceProvider.getVoiceConfidence(audioFrame)
      const volume = this.getSmoothedVolume(audioFrame)

      const speaking =
        confidence >= this.params.confidence && volume >= this.params.minVolume

      if (speaking) {
        switch (this.vadState) {
          case VADState.QUIET:
            this.vadState = VADState.STARTING
            this.vadStartingCount = 1
            break
          case VADState.STARTING:
            this.vadStartingCount++
            break
          case VADState.STOPPING:
            this.vadState = VADState.SPEAKING
            this.vadStoppingCount = 0
            break
        }
      } else {
        switch (this.vadState) {
          case VADState.STARTING:
            this.vadState = VADState.QUIET
            this.vadStartingCount = 0
            break
          case VADState.SPEAKING:
            this.vadState = VADState.STOPPING
            this.vadStoppingCount = 1
            break
          case VADState.STOPPING:
            this.vadStoppingCount++
            break
        }
      }
    }

    if (
      this.vadState === VADState.STARTING &&
      this.vadStartingCount >= this.vadStartFrames
    ) {
      this.vadState = VADState.SPEAKING
      this.vadStartingCount = 0
    }

    if (
      this.vadState === VADState.STOPPING &&
      this.vadStoppingCount >= this.vadStopFrames
    ) {
      this.vadState = VADState.QUIET
      this.vadStoppingCount = 0
    }

    this.checkStateChange()

    return this.vadState
  }
}
