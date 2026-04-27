/**
 * Silero VAD (Voice Activity Detection) 实现
 * 移植自 Pipecat: src/pipecat/audio/vad/silero.py
 *
 * 使用预训练的 Silero ONNX 模型进行高精度语音活动检测
 * 支持 8kHz 和 16kHz 采样率
 */

import type { VoiceConfidenceProvider } from './types.js'

// 模型状态重置周期（秒）
const MODEL_RESET_STATES_TIME = 5.0

/**
 * ONNX Runtime 会话接口
 * 由外部注入（如 onnxruntime-node）
 */
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

/**
 * 创建 ONNX Tensor 的工厂函数接口
 */
export interface OnnxTensorFactory {
  create<T extends Float32Array | BigInt64Array>(
    type: 'float32' | 'int64',
    data: T | number[] | bigint[],
    dims: number[]
  ): OnnxTensor
}

/**
 * Silero ONNX 模型包装器
 *
 * 处理模型推理和状态管理
 */
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

  /**
   * 重置内部状态
   */
  resetStates(batchSize = 1): void {
    this.state = new Float32Array(2 * batchSize * 128)
    this.context = new Float32Array(0)
    this.lastSr = 0
    this.lastBatchSize = 0
  }

  /**
   * 处理音频并返回语音置信度
   */
  async process(audio: Float32Array, sampleRate: number): Promise<number> {
    // 验证采样率
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

    // 检查是否需要重置状态
    if (!this.lastBatchSize) {
      this.resetStates(batchSize)
    }
    if (this.lastSr && this.lastSr !== sampleRate) {
      this.resetStates(batchSize)
    }
    if (this.lastBatchSize && this.lastBatchSize !== batchSize) {
      this.resetStates(batchSize)
    }

    // 初始化上下文
    if (this.context.length === 0) {
      this.context = new Float32Array(contextSize)
    }

    // 拼接上下文和音频
    const inputLength = this.context.length + audio.length
    const input = new Float32Array(inputLength)
    input.set(this.context, 0)
    input.set(audio, this.context.length)

    // 准备输入 tensors
    const inputTensor = this.tensorFactory.create('float32', input, [1, inputLength])
    const stateTensor = this.tensorFactory.create('float32', this.state, [2, 1, 128])
    const srTensor = this.tensorFactory.create('int64', [BigInt(sampleRate)], [])

    // 运行推理
    const outputs = await this.session.run({
      input: inputTensor,
      state: stateTensor,
      sr: srTensor,
    })

    // 更新状态
    const outputState = outputs['stateN'] || outputs['state']
    if (outputState && outputState.data instanceof Float32Array) {
      this.state = outputState.data
    }

    // 更新上下文（保留最后 contextSize 个样本）
    this.context = input.slice(-contextSize)
    this.lastSr = sampleRate
    this.lastBatchSize = batchSize

    // 返回置信度
    const output = outputs['output']
    if (output && output.data) {
      return (output.data as Float32Array)[0]
    }

    return 0
  }
}

/**
 * Silero VAD 配置
 */
export interface SileroVADConfig {
  /** ONNX 推理会话 */
  session: OnnxInferenceSession
  /** Tensor 工厂 */
  tensorFactory: OnnxTensorFactory
  /** 采样率 (8000 或 16000) */
  sampleRate?: number
}

/**
 * Silero VAD 语音置信度提供者
 *
 * 使用 Silero ONNX 模型进行高精度语音活动检测
 */
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

  /**
   * 获取所需的音频帧数
   */
  getNumFramesRequired(): number {
    return this.numFramesRequired
  }

  /**
   * 计算语音置信度
   */
  async getVoiceConfidence(audio: Float32Array): Promise<number> {
    try {
      // 确保音频长度正确
      if (audio.length !== this.numFramesRequired) {
        // 如果音频长度不对，截取或填充
        const adjusted = new Float32Array(this.numFramesRequired)
        const copyLength = Math.min(audio.length, this.numFramesRequired)
        adjusted.set(audio.subarray(0, copyLength), 0)
        audio = adjusted
      }

      const confidence = await this.model.process(audio, this.sampleRate)

      // 定期重置模型状态以防止内存增长
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

  /**
   * 重置内部状态
   */
  reset(): void {
    this.model.resetStates()
    this.lastResetTime = Date.now() / 1000
  }
}

/**
 * 创建 Silero VAD 的辅助函数
 * 需要外部提供 ONNX runtime
 */
export function createSileroVAD(config: SileroVADConfig): SileroVAD {
  return new SileroVAD(config)
}
