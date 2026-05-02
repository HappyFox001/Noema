

import FFT from 'fft.js'


export interface OnnxInferenceSession {
  run(
    feeds: Record<string, OnnxTensor>,
    options?: unknown
  ): Promise<Record<string, OnnxTensor>>
}

export interface OnnxTensor {
  data: Float32Array | BigInt64Array | number[]
  dims: number[]
}

export interface OnnxTensorFactory {
  create<T extends Float32Array | BigInt64Array>(
    type: 'float32' | 'int64',
    data: T | number[] | bigint[],
    dims: number[]
  ): OnnxTensor
}


export interface WhisperFeatureExtractor {
  extract(audio: Float32Array, sampleRate: number): Promise<Float32Array>
}


export interface SmartTurnConfig {
  
  session: OnnxInferenceSession
  
  tensorFactory: OnnxTensorFactory
  
  featureExtractor: WhisperFeatureExtractor
  
  sampleRate?: number
  
  stopSecs?: number
  
  preSpeechMs?: number
  
  maxDurationSecs?: number
  
  threshold?: number
}


export interface SmartTurnResult {
  
  isComplete: boolean
  
  probability: number
  
  inferenceTimeMs: number
}

const MODEL_SAMPLE_RATE = 16000
const DEFAULT_STOP_SECS = 3.0
const DEFAULT_PRE_SPEECH_MS = 500
const DEFAULT_MAX_DURATION_SECS = 8
const DEFAULT_THRESHOLD = 0.5


export class SmartTurnAnalyzer {
  private session: OnnxInferenceSession
  private tensorFactory: OnnxTensorFactory
  private featureExtractor: WhisperFeatureExtractor
  private sampleRate: number
  private stopSecs: number
  private preSpeechMs: number
  private maxDurationSecs: number
  private threshold: number

  private audioBuffer: Array<{ timestamp: number; audio: Float32Array }> = []
  private speechTriggered = false
  private silenceMs = 0
  private speechStartTime = 0

  constructor(config: SmartTurnConfig) {
    this.session = config.session
    this.tensorFactory = config.tensorFactory
    this.featureExtractor = config.featureExtractor
    this.sampleRate = config.sampleRate ?? MODEL_SAMPLE_RATE
    this.stopSecs = config.stopSecs ?? DEFAULT_STOP_SECS
    this.preSpeechMs = config.preSpeechMs ?? DEFAULT_PRE_SPEECH_MS
    this.maxDurationSecs = config.maxDurationSecs ?? DEFAULT_MAX_DURATION_SECS
    this.threshold = config.threshold ?? DEFAULT_THRESHOLD
  }

  
  appendAudio(audio: Float32Array, isSpeech: boolean): 'incomplete' | 'complete_timeout' | 'ready_for_analysis' {
    const now = Date.now()
    this.audioBuffer.push({ timestamp: now, audio })

    if (isSpeech) {
      this.silenceMs = 0
      this.speechTriggered = true
      if (this.speechStartTime === 0) {
        this.speechStartTime = now
      }
      return 'incomplete'
    }

    if (this.speechTriggered) {
      const chunkDurationMs = (audio.length / this.sampleRate) * 1000
      this.silenceMs += chunkDurationMs

      if (this.silenceMs >= this.stopSecs * 1000) {
        return 'complete_timeout'
      }

      if (this.silenceMs >= 200) {
        return 'ready_for_analysis'
      }
    } else {
      const maxBufferTime = (this.preSpeechMs / 1000) + this.stopSecs + this.maxDurationSecs
      const cutoffTime = now - maxBufferTime * 1000
      while (this.audioBuffer.length > 0 && this.audioBuffer[0].timestamp < cutoffTime) {
        this.audioBuffer.shift()
      }
    }

    return 'incomplete'
  }

  
  async analyze(): Promise<SmartTurnResult> {
    if (this.audioBuffer.length === 0) {
      return {
        isComplete: false,
        probability: 0,
        inferenceTimeMs: 0,
      }
    }

    const startTime = performance.now()

    const startIndex = this.findStartIndex()
    const segmentAudio = this.extractSegment(startIndex)

    if (segmentAudio.length === 0) {
      return {
        isComplete: false,
        probability: 0,
        inferenceTimeMs: 0,
      }
    }

    const resampledAudio = this.resampleTo16kHz(segmentAudio)

    const paddedAudio = this.truncateOrPadTo8Seconds(resampledAudio)

    const features = await this.featureExtractor.extract(paddedAudio, MODEL_SAMPLE_RATE)

    const inputTensor = this.tensorFactory.create('float32', features, [1, 80, 800])
    const outputs = await this.session.run({ input_features: inputTensor })

    const output = outputs['output'] || outputs[Object.keys(outputs)[0]]
    const probability = (output.data as Float32Array)[0]
    const isComplete = probability > this.threshold

    const endTime = performance.now()

    return {
      isComplete,
      probability,
      inferenceTimeMs: endTime - startTime,
    }
  }

  
  reset(): void {
    this.audioBuffer = []
    this.speechTriggered = false
    this.silenceMs = 0
    this.speechStartTime = 0
  }

  
  get isSpeechTriggered(): boolean {
    return this.speechTriggered
  }

  private findStartIndex(): number {
    if (this.speechStartTime === 0) return 0

    const startTime = this.speechStartTime - this.preSpeechMs
    for (let i = 0; i < this.audioBuffer.length; i++) {
      if (this.audioBuffer[i].timestamp >= startTime) {
        return i
      }
    }
    return 0
  }

  private extractSegment(startIndex: number): Float32Array {
    const chunks = this.audioBuffer.slice(startIndex).map(b => b.audio)
    if (chunks.length === 0) return new Float32Array(0)

    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
    const result = new Float32Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }

    const maxSamples = Math.floor(this.maxDurationSecs * this.sampleRate)
    if (result.length > maxSamples) {
      return result.slice(-maxSamples)
    }

    return result
  }

  private resampleTo16kHz(audio: Float32Array): Float32Array {
    if (this.sampleRate === MODEL_SAMPLE_RATE) {
      return audio
    }

    const ratio = MODEL_SAMPLE_RATE / this.sampleRate
    const newLength = Math.floor(audio.length * ratio)
    const result = new Float32Array(newLength)

    for (let i = 0; i < newLength; i++) {
      const srcIndex = i / ratio
      const srcIndexFloor = Math.floor(srcIndex)
      const srcIndexCeil = Math.min(srcIndexFloor + 1, audio.length - 1)
      const t = srcIndex - srcIndexFloor
      result[i] = audio[srcIndexFloor] * (1 - t) + audio[srcIndexCeil] * t
    }

    return result
  }

  private truncateOrPadTo8Seconds(audio: Float32Array): Float32Array {
    const targetLength = 8 * MODEL_SAMPLE_RATE

    if (audio.length > targetLength) {
      return audio.slice(-targetLength)
    } else if (audio.length < targetLength) {
      const padded = new Float32Array(targetLength)
      const padding = targetLength - audio.length
      padded.set(audio, padding)
      return padded
    }

    return audio
  }
}


export class SimpleWhisperFeatureExtractor implements WhisperFeatureExtractor {
  private readonly nMels = 80
  private readonly nFft = 400
  private readonly fftSize = 512  // Power of 2 >= nFft for FFT
  private readonly hopLength = 160
  private readonly targetFrames = 800

  // FFT instance (reused for performance)
  private fft: InstanceType<typeof FFT>
  private fftOutput: number[]
  private hanningWindow: Float32Array

  constructor() {
    this.fft = new FFT(this.fftSize)
    this.fftOutput = this.fft.createComplexArray()
    // Pre-compute Hanning window
    this.hanningWindow = new Float32Array(this.nFft)
    for (let i = 0; i < this.nFft; i++) {
      this.hanningWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (this.nFft - 1)))
    }
  }

  async extract(audio: Float32Array, sampleRate: number): Promise<Float32Array> {
    const nFrames = Math.ceil(audio.length / this.hopLength)

    const features = new Float32Array(this.nMels * this.targetFrames)

    // Reusable buffer for FFT input
    const fftInput = new Float32Array(this.fftSize)

    for (let frame = 0; frame < Math.min(nFrames, this.targetFrames); frame++) {
      const start = frame * this.hopLength
      const end = Math.min(start + this.nFft, audio.length)

      // Zero-fill and apply Hanning window
      fftInput.fill(0)
      for (let i = 0; i < end - start; i++) {
        fftInput[i] = audio[start + i] * this.hanningWindow[i]
      }

      const powerSpectrum = this.computePowerSpectrum(fftInput)

      const melSpectrum = this.powerToMel(powerSpectrum, sampleRate)

      for (let m = 0; m < this.nMels; m++) {
        features[m * this.targetFrames + frame] = melSpectrum[m]
      }
    }

    this.normalize(features)

    return features
  }

  private computePowerSpectrum(frame: Float32Array): Float32Array {
    // Use radix-4 FFT (O(n log n) instead of O(n²))
    this.fft.realTransform(this.fftOutput, frame)
    this.fft.completeSpectrum(this.fftOutput)

    // Extract power spectrum from complex output
    // fftOutput is interleaved [real0, imag0, real1, imag1, ...]
    const spectrum = new Float32Array(this.fftSize / 2 + 1)
    for (let k = 0; k <= this.fftSize / 2; k++) {
      const real = this.fftOutput[k * 2]
      const imag = this.fftOutput[k * 2 + 1]
      spectrum[k] = (real * real + imag * imag) / this.fftSize
    }

    return spectrum
  }

  private powerToMel(powerSpectrum: Float32Array, sampleRate: number): Float32Array {
    const melSpectrum = new Float32Array(this.nMels)
    const fftBins = powerSpectrum.length

    const melMin = this.hzToMel(0)
    const melMax = this.hzToMel(sampleRate / 2)
    const melPoints = new Float32Array(this.nMels + 2)

    for (let i = 0; i < this.nMels + 2; i++) {
      melPoints[i] = melMin + (i * (melMax - melMin)) / (this.nMels + 1)
    }

    const hzPoints = melPoints.map(m => this.melToHz(m))
    const binPoints = hzPoints.map(hz => Math.floor((hz / (sampleRate / 2)) * (fftBins - 1)))

    for (let m = 0; m < this.nMels; m++) {
      const startBin = binPoints[m]
      const centerBin = binPoints[m + 1]
      const endBin = binPoints[m + 2]

      let sum = 0
      for (let k = startBin; k < centerBin; k++) {
        const weight = (k - startBin) / (centerBin - startBin)
        sum += powerSpectrum[k] * weight
      }
      for (let k = centerBin; k < endBin; k++) {
        const weight = (endBin - k) / (endBin - centerBin)
        sum += powerSpectrum[k] * weight
      }

      // Log mel
      melSpectrum[m] = Math.log(Math.max(sum, 1e-10))
    }

    return melSpectrum
  }

  private hzToMel(hz: number): number {
    return 2595 * Math.log10(1 + hz / 700)
  }

  private melToHz(mel: number): number {
    return 700 * (Math.pow(10, mel / 2595) - 1)
  }

  private normalize(features: Float32Array): void {
    let sum = 0
    for (let i = 0; i < features.length; i++) {
      sum += features[i]
    }
    const mean = sum / features.length

    let sumSq = 0
    for (let i = 0; i < features.length; i++) {
      sumSq += (features[i] - mean) ** 2
    }
    const std = Math.sqrt(sumSq / features.length) || 1

    for (let i = 0; i < features.length; i++) {
      features[i] = (features[i] - mean) / std
    }
  }
}
