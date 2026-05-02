

import type { VoiceConfidenceProvider } from './types.js'

const MODEL_RESET_STATES_TIME = 5.0


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


export class SileroOnnxModel {
  private session: OnnxInferenceSession
  private tensorFactory: OnnxTensorFactory
  private state: Float32Array
  private context: Float32Array
  private lastSr = 0
  private lastBatchSize = 0
  private readonly sampleRates = [8000, 16000]

  constructor(session: OnnxInferenceSession, tensorFactory: OnnxTensorFactory) {
    this.session = session
    this.tensorFactory = tensorFactory
    this.state = new Float32Array(2 * 1 * 128)
    this.context = new Float32Array(0)
  }

  
  resetStates(batchSize = 1): void {
    this.state = new Float32Array(2 * batchSize * 128)
    this.context = new Float32Array(0)
    this.lastSr = 0
    this.lastBatchSize = 0
  }

  
  async process(audio: Float32Array, sampleRate: number): Promise<number> {
    if (!this.sampleRates.includes(sampleRate)) {
      throw new Error(`Unsupported sample rate: ${sampleRate}. Supported: ${this.sampleRates}`)
    }

    const numSamples = sampleRate === 16000 ? 512 : 256
    if (audio.length !== numSamples) {
      throw new Error(
        `Invalid audio length: ${audio.length}. Expected: ${numSamples} for ${sampleRate}Hz`
      )
    }

    const batchSize = 1
    const contextSize = sampleRate === 16000 ? 64 : 32

    if (!this.lastBatchSize) {
      this.resetStates(batchSize)
    }
    if (this.lastSr && this.lastSr !== sampleRate) {
      this.resetStates(batchSize)
    }
    if (this.lastBatchSize && this.lastBatchSize !== batchSize) {
      this.resetStates(batchSize)
    }

    if (this.context.length === 0) {
      this.context = new Float32Array(contextSize)
    }

    const inputLength = this.context.length + audio.length
    const input = new Float32Array(inputLength)
    input.set(this.context, 0)
    input.set(audio, this.context.length)

    const inputTensor = this.tensorFactory.create('float32', input, [1, inputLength])
    const stateTensor = this.tensorFactory.create('float32', this.state, [2, 1, 128])
    const srTensor = this.tensorFactory.create('int64', [BigInt(sampleRate)], [])

    const outputs = await this.session.run({
      input: inputTensor,
      state: stateTensor,
      sr: srTensor,
    })

    const outputState = outputs['stateN'] || outputs['state']
    if (outputState && outputState.data instanceof Float32Array) {
      this.state = outputState.data
    }

    this.context = input.slice(-contextSize)
    this.lastSr = sampleRate
    this.lastBatchSize = batchSize

    const output = outputs['output']
    if (output && output.data) {
      return (output.data as Float32Array)[0]
    }

    return 0
  }
}


export interface SileroVADConfig {
  
  session: OnnxInferenceSession
  
  tensorFactory: OnnxTensorFactory
  
  sampleRate?: number
}


export class SileroVAD implements VoiceConfidenceProvider {
  private model: SileroOnnxModel
  private sampleRate: number
  private lastResetTime = 0
  private readonly numFramesRequired: number

  constructor(config: SileroVADConfig) {
    this.model = new SileroOnnxModel(config.session, config.tensorFactory)
    this.sampleRate = config.sampleRate ?? 16000

    if (this.sampleRate !== 8000 && this.sampleRate !== 16000) {
      throw new Error(`Silero VAD sample rate must be 8000 or 16000 (got: ${this.sampleRate})`)
    }

    this.numFramesRequired = this.sampleRate === 16000 ? 512 : 256
  }

  
  getNumFramesRequired(): number {
    return this.numFramesRequired
  }

  
  async getVoiceConfidence(audio: Float32Array): Promise<number> {
    try {
      if (audio.length !== this.numFramesRequired) {
        const adjusted = new Float32Array(this.numFramesRequired)
        const copyLength = Math.min(audio.length, this.numFramesRequired)
        adjusted.set(audio.subarray(0, copyLength), 0)
        audio = adjusted
      }

      const confidence = await this.model.process(audio, this.sampleRate)

      const currentTime = Date.now() / 1000
      if (currentTime - this.lastResetTime >= MODEL_RESET_STATES_TIME) {
        this.model.resetStates()
        this.lastResetTime = currentTime
      }

      return confidence
    } catch (error) {
      console.error('Silero VAD error:', error)
      return 0
    }
  }

  
  reset(): void {
    this.model.resetStates()
    this.lastResetTime = Date.now() / 1000
  }
}


export function createSileroVAD(config: SileroVADConfig): SileroVAD {
  return new SileroVAD(config)
}
