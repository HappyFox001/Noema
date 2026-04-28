/**
 * Turn 管理类型定义
 * 移植自 Pipecat: src/pipecat/turns/
 */

import type { SmartTurnAnalyzer, SmartTurnResult } from './smart-turn.js'

/**
 * 用户轮次状态
 */
export enum TurnState {
  /** 空闲状态，等待用户说话 */
  IDLE = 'idle',
  /** 用户正在说话 */
  USER_TURN = 'user_turn',
  /** 用户说完了，准备处理 */
  USER_DONE = 'user_done',
  /** 机器人正在生成回复，但还没有真实输出音频 */
  BOT_THINKING = 'bot_thinking',
  /** 机器人正在真实输出音频 */
  BOT_TURN = 'bot_turn',
  /** 机器人回应完成 */
  BOT_DONE = 'bot_done',
}

/**
 * Endpointing 配置
 *
 * 双计时器策略：
 * - userSpeechTimeout: 政策底线 - 给用户继续说话的窗口
 * - sttTimeoutMs: 安全网 - 等待 STT 返回最终结果
 */
export interface EndpointingConfig {
  /**
   * 用户说话超时（毫秒）
   * VAD 检测到停止后，等待用户可能继续说话的时间窗口
   * @default 600
   */
  userSpeechTimeout: number

  /**
   * STT 超时（毫秒）
   * STT 服务的 P99 延迟，用于安全网计时器
   * 实际等待时间 = max(0, sttTimeoutMs - vadStopSecs * 1000)
   * @default 800
   */
  sttTimeoutMs: number

  /**
   * 用户轮次停止总超时（毫秒）
   * 如果超过此时间仍未触发停止，强制停止
   * @default 5000
   */
  userTurnStopTimeout: number
}

/**
 * 用户轮次开始参数
 */
export interface UserTurnStartedParams {
  /**
   * 是否启用用户说话帧
   * 用于控制是否触发打断
   */
  enableUserSpeakingFrames?: boolean
}

/**
 * 用户轮次停止参数
 */
export interface UserTurnStoppedParams {
  /**
   * 是否启用用户说话帧
   */
  enableUserSpeakingFrames?: boolean

  /**
   * 用户说的文本
   */
  text?: string
}

/**
 * 打断处理器接口
 */
export interface InterruptionHandler {
  /**
   * 打断发生时的回调
   * 应该尽快完成，不应该阻塞
   */
  onInterruption(): Promise<void>
}

export type InterruptionReason = 'vad_start' | 'transcript_start' | 'manual' | 'provider_switch'

/**
 * Endpointing 策略接口
 * 支持固定超时策略和 Smart Turn ML 策略
 */
export interface IEndpointingStrategy {
  /** 用户轮次结束回调 */
  onUserTurnStopped: ((params: UserTurnStoppedParams) => void | Promise<void>) | null
  /** 更新策略配置 */
  setConfig?(config: Partial<EndpointingConfig>): void
  /** 处理 VAD 用户开始说话 */
  handleVADUserStartedSpeaking(): void
  /** 处理 VAD 用户停止说话 */
  handleVADUserStoppedSpeaking(stopSecs: number, timestamp?: number): void
  /** 处理转录 */
  handleTranscription(frame: TranscriptionFrame): void
  /** 获取累积文本 */
  getText(): string
  /** 是否有文本 */
  hasText(): boolean
  /** 重置状态 */
  reset(): void
  /** 清理资源 */
  cleanup(): void
  /** 添加音频数据 (Smart Turn 需要) */
  appendAudio?(audio: Float32Array, isSpeech: boolean): void
}

/**
 * Smart Turn 配置
 */
export interface SmartTurnOptions {
  /** Smart Turn 分析器实例 */
  analyzer: SmartTurnAnalyzer
  /** 分析间隔 (毫秒) */
  analyzeIntervalMs?: number
  /** 最大分析次数 */
  maxAnalyzeAttempts?: number
  /** STT 最终转录等待时间 (毫秒)，用于等待 finalized TranscriptionFrame。 */
  sttTimeoutMs?: number
  /** SmartTurn 单次分析结果回调，用于观测和延迟打点。 */
  onResult?: (result: SmartTurnResult) => void
}

/**
 * 轮次控制器事件
 */
export interface TurnControllerEvents {
  /**
   * 用户轮次开始
   */
  onUserTurnStart?: (params: UserTurnStartedParams) => void | Promise<void>

  /**
   * 用户轮次结束
   */
  onUserTurnEnd?: (params: UserTurnStoppedParams) => void | Promise<void>

  /**
   * 机器人轮次开始
   */
  onBotTurnStart?: () => void | Promise<void>

  /**
   * 机器人轮次结束
   */
  onBotTurnEnd?: () => void | Promise<void>

  /**
   * 打断发生（用户在机器人说话时开始说话）
   */
  onInterruption?: (reason: InterruptionReason) => void | Promise<void>

  /**
   * 用户轮次超时（无活动）
   */
  onUserTurnTimeout?: () => void | Promise<void>

  /**
   * VAD 检测到用户停止说话
   * 这是静音检测的即时事件，早于 endpointing 确认
   */
  onVADSpeechStop?: () => void | Promise<void>

  /**
   * 机器人正在说话（周期性事件）
   * 移植自 Pipecat base_output.py 的 BotSpeakingFrame
   * 用于 UI 显示机器人说话状态
   */
  onBotSpeaking?: () => void | Promise<void>

  /**
   * 用户正在说话（周期性事件）
   * 移植自 Pipecat 的 speech_activity
   */
  onUserSpeaking?: () => void | Promise<void>
}

/**
 * 转录帧
 */
export interface TranscriptionFrame {
  /** 转录的文本 */
  text: string
  /** 是否是最终结果 */
  finalized: boolean
  /** 时间戳 */
  timestamp: number
}

/**
 * 默认 Endpointing 配置
 * 来自 Pipecat 的推荐值
 */
export const DEFAULT_ENDPOINTING_CONFIG: EndpointingConfig = {
  userSpeechTimeout: 600, // 600ms
  sttTimeoutMs: 800, // 800ms (STT P99 延迟)
  userTurnStopTimeout: 1500, // 1.5s (降低延迟，双计时器应该在 ~800ms 内触发)
}
