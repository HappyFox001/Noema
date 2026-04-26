/**
 * VAD (Voice Activity Detection) 类型定义
 * 移植自 Pipecat: src/pipecat/audio/vad/vad_analyzer.py
 */

/**
 * VAD 状态枚举
 *
 * 状态转移图：
 * ```
 * QUIET ─[speaking detected]─→ STARTING ─[持续 startSecs]─→ SPEAKING
 *   ↑                              ↓                           │
 *   └──────────[no speech]─────────┘                          │
 *                                                   [silence detected]
 *                                                        ↓
 *                                   STOPPING ←──────────┤
 *                                        ↓
 *                                   [stopSecs elapsed]
 *                                        ↓
 *                                      QUIET
 * ```
 */
export enum VADState {
  /** 没有语音活动 */
  QUIET = 'quiet',
  /** 检测到声音开始，等待确认 (需要持续 startSecs) */
  STARTING = 'starting',
  /** 确认有语音活动 */
  SPEAKING = 'speaking',
  /** 检测到语音结束，等待确认 (需要持续 stopSecs) */
  STOPPING = 'stopping',
}

/**
 * VAD 配置参数
 */
export interface VADParams {
  /**
   * 语音置信度阈值 (0-1)
   * 模型输出的置信度必须 >= 此值才认为有语音
   * @default 0.7
   */
  confidence: number

  /**
   * 确认开始说话需要的持续时长（秒）
   * 防止脉冲噪音误触发
   * @default 0.2
   */
  startSecs: number

  /**
   * 确认停止说话需要的持续时长（秒）
   * 避免短暂停顿被误判为结束
   * @default 0.2
   */
  stopSecs: number

  /**
   * 最小音量阈值 (0-1)
   * 即使置信度高，音量也必须 >= 此值
   * 用于过滤低音量噪音
   * @default 0.6
   */
  minVolume: number

  /**
   * 音频采样率
   * @default 16000
   */
  sampleRate: number
}

/**
 * VAD 事件类型
 */
export interface VADEvent {
  /** 事件类型 */
  type: 'speech_start' | 'speech_stop' | 'speech_activity'
  /** 事件发生的时间戳 (ms) */
  timestamp: number
  /**
   * 仅 speech_stop 时携带
   * 表示 VAD 用于确认停止的时长（秒）
   * Endpointing 策略需要此值来计算等待时间
   */
  stopSecs?: number
}

/**
 * VAD 分析器接口
 */
export interface VADAnalyzerInterface {
  /**
   * 分析音频数据并返回当前 VAD 状态
   * @param audio - PCM 音频数据 (Int16Array 或 Float32Array)
   * @returns 当前 VAD 状态
   */
  analyze(audio: Int16Array | Float32Array): Promise<VADState>

  /**
   * 获取当前状态
   */
  getState(): VADState

  /**
   * 重置状态机
   */
  reset(): void

  /**
   * 设置事件处理器
   */
  setEventHandler(handler: (event: VADEvent) => void): void
}

/**
 * 语音置信度提供者接口
 * 可以是 Silero VAD、RMS 计算等不同实现
 */
export interface VoiceConfidenceProvider {
  /**
   * 计算音频的语音置信度
   * @param audio - PCM 音频数据
   * @returns 0-1 之间的置信度
   */
  getVoiceConfidence(audio: Float32Array): Promise<number>

  /**
   * 重置内部状态（如果有）
   */
  reset(): void
}

/**
 * 默认 VAD 参数
 * 来自 Pipecat 的推荐值
 */
export const DEFAULT_VAD_PARAMS: VADParams = {
  confidence: 0.7,
  startSecs: 0.2,
  stopSecs: 0.2,
  minVolume: 0.6,
  sampleRate: 16000,
}

/**
 * 计算音频样本的 RMS（均方根）音量
 * @param samples - PCM 音频样本
 * @returns 0-1 之间的归一化音量
 */
export function calculateRmsVolume(samples: Int16Array | Float32Array): number {
  if (samples.length === 0) return 0

  let sum = 0
  const isInt16 = samples instanceof Int16Array
  const maxValue = isInt16 ? 32768 : 1

  for (let i = 0; i < samples.length; i++) {
    const normalized = samples[i] / maxValue
    sum += normalized * normalized
  }

  return Math.sqrt(sum / samples.length)
}

/**
 * Int16 转 Float32
 */
export function int16ToFloat32(samples: Int16Array): Float32Array {
  const float32 = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    float32[i] = samples[i] / 32768
  }
  return float32
}
