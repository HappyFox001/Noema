/**
 * Endpointing 策略
 * 完整移植自 Pipecat: src/pipecat/turns/user_stop/speech_timeout_user_turn_stop_strategy.py
 *
 * 双计时器策略：
 * - user_speech_timeout: 政策底线 - 给用户继续说话的窗口 (600ms)
 * - stt_timeout: 安全网 - 等待 STT 返回最终结果
 *
 * 只有当两个计时器都完成，且有转录文本时，才触发用户轮次结束。
 */

import {
  EndpointingConfig,
  TranscriptionFrame,
  UserTurnStoppedParams,
  IEndpointingStrategy,
  DEFAULT_ENDPOINTING_CONFIG,
} from './types.js'

/**
 * Endpointing 策略
 *
 * 工作原理：
 * 1. VAD 检测到用户停止说话后，启动两个计时器
 * 2. user_speech_timeout (600ms): 给用户继续说话的窗口，总是运行完成
 * 3. stt_timeout: 等待 STT 返回最终结果，可被 finalized 转录短路
 * 4. 两个计时器都完成 + 有文本 = 触发用户轮次结束
 *
 * Fallback 路径：
 * 当收到转录但没有 VAD 停止事件时，只运行 user_speech_timeout
 * 每次收到新转录都重启计时器
 */
export class EndpointingStrategy implements IEndpointingStrategy {
  private config: EndpointingConfig

  // 状态
  private text = ''
  private vadUserSpeaking = false
  private transcriptFinalized = false
  private vadStoppedTime: number | null = null
  private vadStopSecs = 0 // VAD 确认停止的时间（秒）

  // 计时器
  private userSpeechTimeoutTask: ReturnType<typeof setTimeout> | null = null
  private sttTimeoutTask: ReturnType<typeof setTimeout> | null = null
  private userSpeechWaitDone = false
  private sttWaitDone = false

  // 回调
  onUserTurnStopped: ((params: UserTurnStoppedParams) => void | Promise<void>) | null = null

  constructor(config?: Partial<EndpointingConfig>) {
    this.config = { ...DEFAULT_ENDPOINTING_CONFIG, ...config }
  }

  /**
   * 更新配置
   */
  setConfig(config: Partial<EndpointingConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * 获取当前配置
   */
  getConfig(): EndpointingConfig {
    return { ...this.config }
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.text = ''
    this.vadUserSpeaking = false
    this.transcriptFinalized = false
    this.vadStoppedTime = null
    this.userSpeechWaitDone = false
    this.sttWaitDone = false
    this.cancelAllTasks()
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.cancelAllTasks()
    this.onUserTurnStopped = null
  }

  /**
   * 处理 VAD 用户开始说话事件
   */
  handleVADUserStartedSpeaking(): void {
    this.vadUserSpeaking = true
    this.transcriptFinalized = false
    this.vadStoppedTime = null
    this.userSpeechWaitDone = false
    this.sttWaitDone = false
    this.cancelAllTasks()
  }

  /**
   * 处理 VAD 用户停止说话事件
   * @param stopSecs - VAD 确认停止的时间（秒）
   * @param timestamp - 事件时间戳
   */
  handleVADUserStoppedSpeaking(stopSecs: number, timestamp?: number): void {
    this.vadUserSpeaking = false
    this.vadStopSecs = stopSecs
    this.vadStoppedTime = timestamp ?? Date.now()

    // 启动 user_speech_timeout 计时器（政策底线，总是运行）
    this.restartUserSpeechTimer()

    // 启动 stt_timeout 计时器（安全网）
    this.sttWaitDone = false

    // 计算有效的 STT 等待时间
    // = max(0, sttTimeout - vadStopSecs * 1000)
    const effectiveSttWait = Math.max(
      0,
      this.config.sttTimeoutMs - stopSecs * 1000
    )

    if (this.transcriptFinalized || effectiveSttWait <= 0) {
      // 快速路径：已经有最终转录，或不需要等待
      this.sttWaitDone = true
    } else {
      // 启动 STT 超时计时器
      this.sttTimeoutTask = setTimeout(() => {
        this.sttTimeoutTask = null
        this.sttWaitDone = true
        this.maybeTriggerUserTurnStopped()
      }, effectiveSttWait)
    }
  }

  /**
   * 处理转录
   * @param frame - 转录帧
   */
  handleTranscription(frame: TranscriptionFrame): void {
    this.text += frame.text

    if (frame.finalized) {
      this.transcriptFinalized = true

      // 短路 STT 超时计时器：STT 已经告诉我们没有更多内容了
      if (!this.sttWaitDone) {
        this.sttWaitDone = true
        if (this.sttTimeoutTask) {
          clearTimeout(this.sttTimeoutTask)
          this.sttTimeoutTask = null
        }
      }
    }

    // 如果两个等待都已完成，立即触发
    if (this.userSpeechWaitDone && this.sttWaitDone) {
      this.maybeTriggerUserTurnStopped()
      return
    }

    // Fallback 路径：收到转录但没有 VAD 停止事件
    // 测量自上次转录以来的不活动时间
    // stt_timeout 在这里没有意义（它是相对于 VAD 停止定义的）
    // 所以立即标记 stt 等待完成
    if (!this.vadUserSpeaking && this.vadStoppedTime === null) {
      this.sttWaitDone = true
      this.restartUserSpeechTimer()
    }
  }

  /**
   * 获取累积的文本
   */
  getText(): string {
    return this.text
  }

  /**
   * 检查是否有文本
   */
  hasText(): boolean {
    return this.text.length > 0
  }

  /**
   * 重启 user_speech 计时器
   */
  private restartUserSpeechTimer(): void {
    // 取消现有计时器
    if (this.userSpeechTimeoutTask) {
      clearTimeout(this.userSpeechTimeoutTask)
      this.userSpeechTimeoutTask = null
    }

    this.userSpeechWaitDone = false

    // 启动新计时器
    this.userSpeechTimeoutTask = setTimeout(() => {
      this.userSpeechTimeoutTask = null
      this.userSpeechWaitDone = true
      this.maybeTriggerUserTurnStopped()
    }, this.config.userSpeechTimeout)
  }

  /**
   * 尝试触发用户轮次结束
   * 只有当所有条件都满足时才触发
   */
  private maybeTriggerUserTurnStopped(): void {
    // 检查条件：
    // 1. 用户不在说话
    // 2. 有文本（或 sttTimeoutMs = 0 时跳过此检查，因为 ASR 无中间结果）
    // 3. user_speech 等待完成
    // 4. stt 等待完成
    if (this.vadUserSpeaking) {
      return
    }

    // 如果 sttTimeoutMs > 0，需要有文本才能触发
    // 如果 sttTimeoutMs = 0，说明 ASR 不支持中间结果，直接触发
    if (this.config.sttTimeoutMs > 0 && !this.text) {
      return
    }

    if (!this.userSpeechWaitDone || !this.sttWaitDone) {
      return
    }

    // 触发回调
    if (this.onUserTurnStopped) {
      const params: UserTurnStoppedParams = {
        text: this.text,
        enableUserSpeakingFrames: true,
      }

      // 异步调用，不阻塞
      Promise.resolve(this.onUserTurnStopped(params)).catch((error) => {
        console.error('onUserTurnStopped callback failed:', error)
      })
    }
  }

  /**
   * 取消所有计时器
   */
  private cancelAllTasks(): void {
    if (this.userSpeechTimeoutTask) {
      clearTimeout(this.userSpeechTimeoutTask)
      this.userSpeechTimeoutTask = null
    }
    if (this.sttTimeoutTask) {
      clearTimeout(this.sttTimeoutTask)
      this.sttTimeoutTask = null
    }
  }
}
