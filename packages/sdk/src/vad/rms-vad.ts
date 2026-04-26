/**
 * RMS VAD 实现
 * 基于 RMS（均方根）音量的简单 VAD
 * 作为 Silero VAD 的 fallback
 */

import { VoiceConfidenceProvider, calculateRmsVolume } from './types.js'

/**
 * RMS VAD 配置
 */
export interface RmsVADConfig {
  /**
   * 语音检测的 RMS 阈值 (0-1)
   * 高于此值认为有语音
   * @default 0.02
   */
  speechThreshold: number

  /**
   * 静音的 RMS 阈值 (0-1)
   * 低于此值认为是静音
   * @default 0.01
   */
  silenceThreshold: number

  /**
   * 是否启用自适应阈值
   * 启用后会根据环境噪音动态调整阈值
   * @default true
   */
  adaptiveThreshold: boolean

  /**
   * 自适应阈值的平滑因子
   * @default 0.95
   */
  adaptiveSmoothingFactor: number
}

const DEFAULT_RMS_VAD_CONFIG: RmsVADConfig = {
  speechThreshold: 0.02,
  silenceThreshold: 0.01,
  adaptiveThreshold: true,
  adaptiveSmoothingFactor: 0.95,
}

/**
 * 基于 RMS 的 VAD 置信度提供者
 *
 * 这是一个简单但有效的 VAD 实现：
 * - 计算音频的 RMS 音量
 * - 将音量映射到 0-1 的置信度
 * - 可选的自适应阈值（根据环境噪音调整）
 *
 * 优点：
 * - 零依赖，纯计算
 * - 速度快，CPU 占用低
 * - 无需模型文件
 *
 * 缺点：
 * - 对非语音噪音敏感
 * - 无法区分语音和其他声音
 */
export class RmsVAD implements VoiceConfidenceProvider {
  private config: RmsVADConfig

  // 自适应阈值状态
  private noiseFloor = 0 // 估计的环境噪音水平
  private initialized = false

  constructor(config?: Partial<RmsVADConfig>) {
    this.config = { ...DEFAULT_RMS_VAD_CONFIG, ...config }
  }

  /**
   * 重置内部状态
   */
  reset(): void {
    this.noiseFloor = 0
    this.initialized = false
  }

  /**
   * 更新噪音底值（自适应阈值）
   */
  private updateNoiseFloor(rms: number): void {
    if (!this.config.adaptiveThreshold) return

    if (!this.initialized) {
      this.noiseFloor = rms
      this.initialized = true
    } else {
      // 只有当 RMS 低于当前阈值时才更新噪音底值
      // 这样在有语音时不会错误地提高阈值
      const currentThreshold = this.getAdaptiveThreshold()
      if (rms < currentThreshold * 0.5) {
        this.noiseFloor =
          this.config.adaptiveSmoothingFactor * this.noiseFloor +
          (1 - this.config.adaptiveSmoothingFactor) * rms
      }
    }
  }

  /**
   * 获取自适应阈值
   */
  private getAdaptiveThreshold(): number {
    if (!this.config.adaptiveThreshold || !this.initialized) {
      return this.config.speechThreshold
    }
    // 阈值 = 噪音底值 * 倍数
    // 这样在嘈杂环境中阈值会自动提高
    return Math.max(this.config.speechThreshold, this.noiseFloor * 2)
  }

  /**
   * 计算语音置信度
   * @param audio - Float32 音频数据
   * @returns 0-1 之间的置信度
   */
  async getVoiceConfidence(audio: Float32Array): Promise<number> {
    // 计算 RMS
    const rms = calculateRmsVolume(audio)

    // 更新自适应阈值
    this.updateNoiseFloor(rms)

    // 获取当前阈值
    const speechThreshold = this.getAdaptiveThreshold()
    const silenceThreshold = Math.min(
      this.config.silenceThreshold,
      speechThreshold * 0.5
    )

    // 计算置信度
    // 使用 sigmoid 风格的映射，使转换更平滑
    if (rms <= silenceThreshold) {
      return 0
    } else if (rms >= speechThreshold) {
      // 高于阈值，返回高置信度
      // 越高越接近 1，但不超过 1
      const excess = (rms - speechThreshold) / speechThreshold
      return Math.min(1, 0.7 + 0.3 * Math.tanh(excess * 2))
    } else {
      // 在阈值之间，线性插值
      const ratio = (rms - silenceThreshold) / (speechThreshold - silenceThreshold)
      return 0.3 + 0.4 * ratio
    }
  }
}

/**
 * 创建 RMS VAD 实例
 */
export function createRmsVAD(config?: Partial<RmsVADConfig>): VoiceConfidenceProvider {
  return new RmsVAD(config)
}
