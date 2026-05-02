

import { VoiceConfidenceProvider, calculateRmsVolume } from './types.js'


export interface RmsVADConfig {
  
  speechThreshold: number

  
  silenceThreshold: number

  
  adaptiveThreshold: boolean

  
  adaptiveSmoothingFactor: number
}

const DEFAULT_RMS_VAD_CONFIG: RmsVADConfig = {
  speechThreshold: 0.02,
  silenceThreshold: 0.01,
  adaptiveThreshold: true,
  adaptiveSmoothingFactor: 0.95,
}


export class RmsVAD implements VoiceConfidenceProvider {
  private config: RmsVADConfig

  private noiseFloor = 0
  private initialized = false

  constructor(config?: Partial<RmsVADConfig>) {
    this.config = { ...DEFAULT_RMS_VAD_CONFIG, ...config }
  }

  
  reset(): void {
    this.noiseFloor = 0
    this.initialized = false
  }

  
  private updateNoiseFloor(rms: number): void {
    if (!this.config.adaptiveThreshold) return

    if (!this.initialized) {
      this.noiseFloor = rms
      this.initialized = true
    } else {
      const currentThreshold = this.getAdaptiveThreshold()
      if (rms < currentThreshold * 0.5) {
        this.noiseFloor =
          this.config.adaptiveSmoothingFactor * this.noiseFloor +
          (1 - this.config.adaptiveSmoothingFactor) * rms
      }
    }
  }

  
  private getAdaptiveThreshold(): number {
    if (!this.config.adaptiveThreshold || !this.initialized) {
      return this.config.speechThreshold
    }
    return Math.max(this.config.speechThreshold, this.noiseFloor * 2)
  }

  
  async getVoiceConfidence(audio: Float32Array): Promise<number> {
    const rms = calculateRmsVolume(audio)

    this.updateNoiseFloor(rms)

    const speechThreshold = this.getAdaptiveThreshold()
    const silenceThreshold = Math.min(
      this.config.silenceThreshold,
      speechThreshold * 0.5
    )

    if (rms <= silenceThreshold) {
      return 0
    } else if (rms >= speechThreshold) {
      const excess = (rms - speechThreshold) / speechThreshold
      return Math.min(1, 0.7 + 0.3 * Math.tanh(excess * 2))
    } else {
      const ratio = (rms - silenceThreshold) / (speechThreshold - silenceThreshold)
      return 0.3 + 0.4 * ratio
    }
  }
}


export function createRmsVAD(config?: Partial<RmsVADConfig>): VoiceConfidenceProvider {
  return new RmsVAD(config)
}
