/**
 * Turn 管理类型定义
 * 移植自 Pipecat: src/pipecat/turns/
 */

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
  /** 机器人正在回应 */
  BOT_TURN = 'bot_turn',
  /** 机器人回应完成 */
  BOT_DONE = 'bot_done',
}

/**
 * 处理帧的结果
 */
export enum ProcessFrameResult {
  /** 继续处理后续策略 */
  CONTINUE = 'continue',
  /** 停止处理后续策略 */
  STOP = 'stop',
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
  onInterruption?: () => void | Promise<void>

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
