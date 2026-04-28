/**
 * 轮次控制器
 * 移植自 Pipecat: src/pipecat/turns/user_turn_controller.py
 *
 * 管理用户轮次的生命周期，协调 VAD、Endpointing 和打断处理。
 *
 * 状态转移图：
 * ```
 * IDLE ─[VAD speech_start]─→ USER_TURN
 * USER_TURN ─[endpointing 完成]─→ USER_DONE
 * USER_DONE ─[开始 LLM]─→ BOT_THINKING
 * BOT_THINKING ─[真实音频输出]─→ BOT_TURN
 * BOT_TURN ─[TTS 完成]─→ BOT_DONE ─→ IDLE
 *
 * 打断路径：
 * BOT_THINKING ─[VAD speech_start]─→ 取消当前生成 → USER_TURN
 * BOT_TURN ─[VAD speech_start]─→ 触发 Interruption → USER_TURN
 * ```
 */

import { VADState, VADEvent, VADAnalyzer } from '../vad/index.js'
import {
  TurnState,
  TurnControllerEvents,
  EndpointingConfig,
  TranscriptionFrame,
  UserTurnStartedParams,
  UserTurnStoppedParams,
  IEndpointingStrategy,
  SmartTurnOptions,
  DEFAULT_ENDPOINTING_CONFIG,
} from './types.js'
import { EndpointingStrategy } from './endpointing.js'
import { SmartTurnEndpointingStrategy } from './smart-turn-endpointing.js'
import { InterruptionManager } from './interruption.js'

/**
 * 轮次控制器配置
 */
export interface TurnControllerConfig {
  /**
   * Endpointing 配置 (固定超时策略)
   */
  endpointing?: Partial<EndpointingConfig>

  /**
   * Smart Turn 配置 (ML 智能检测策略)
   * 如果提供，将使用 Smart Turn 替代固定超时
   */
  smartTurn?: SmartTurnOptions

  /**
   * 是否启用打断检测
   * @default true
   */
  enableInterruption?: boolean

  /**
   * 机器人说话事件周期（毫秒）
   * 移植自 Pipecat base_output.py 的 _bot_speaking_frame_period
   * @default 200
   */
  botSpeakingPeriod?: number

  /**
   * Bot 播放中检测到用户语音后，必须持续这么久才触发打断。
   * 这避免 TTS 回声或短促噪声立刻打断当前回复。
   * @default 400
   */
  interruptionMinSpeechMs?: number

  /**
   * Bot turn 刚开始后的短暂保护窗口。
   * @default 250
   */
  interruptionInitialGraceMs?: number

  /**
   * 调试模式
   * @default false
   */
  debug?: boolean
}

/**
 * 轮次控制器
 *
 * 核心功能：
 * 1. 管理轮次状态 (IDLE → USER_TURN → USER_DONE → BOT_TURN → BOT_DONE)
 * 2. 处理 VAD 事件
 * 3. 协调 Endpointing 策略
 * 4. 检测和处理打断
 * 5. 触发相关事件回调
 */
export class TurnController {
  private config: Required<Omit<TurnControllerConfig, 'smartTurn'>> & { smartTurn?: SmartTurnOptions }
  private state: TurnState = TurnState.IDLE
  private vadAnalyzer: VADAnalyzer
  private endpointing: IEndpointingStrategy
  private interruptionManager: InterruptionManager
  private useSmartTurn: boolean = false

  // 状态追踪
  private userSpeaking = false
  private userTurnActive = false
  private userTurnStopTimeoutTask: ReturnType<typeof setTimeout> | null = null

  // Bot Speaking 周期计时器 (移植自 Pipecat base_output.py)
  private botSpeakingTimerTask: ReturnType<typeof setInterval> | null = null
  private botTurnStartedAt = 0

  // Bot 播放期间的打断 gate。Pipecat 允许 barge-in，但不能让单个
  // speech_start 噪声直接变成 InterruptionFrame。
  private pendingInterruptionTask: ReturnType<typeof setTimeout> | null = null

  // 聚合窗口：Pipecat 的 stop strategy 自身负责等待/兜底。
  // TurnController 不在 strategy 已经确认 stop 后再额外固定等待，否则会把
  // SmartTurn 的快速 endpointing 变成“每次都多等 1 秒”。
  private aggregationWindowMs = 0
  private aggregationTimeoutTask: ReturnType<typeof setTimeout> | null = null
  private pendingUserTurnStopParams: UserTurnStoppedParams | null = null

  // 事件回调
  private events: TurnControllerEvents = {}

  constructor(
    vadAnalyzer: VADAnalyzer,
    config?: TurnControllerConfig
  ) {
    this.vadAnalyzer = vadAnalyzer
    this.config = {
      endpointing: config?.endpointing ?? {},
      smartTurn: config?.smartTurn,
      enableInterruption: config?.enableInterruption ?? true,
      botSpeakingPeriod: config?.botSpeakingPeriod ?? 200,
      interruptionMinSpeechMs: config?.interruptionMinSpeechMs ?? 400,
      interruptionInitialGraceMs: config?.interruptionInitialGraceMs ?? 250,
      debug: config?.debug ?? false,
    }

    // 初始化 Endpointing 策略
    // 如果提供了 Smart Turn，使用 ML 策略；否则使用固定超时策略
    if (this.config.smartTurn?.analyzer) {
      this.useSmartTurn = true
      const smartTurnStrategy = new SmartTurnEndpointingStrategy({
        userSpeechTimeout: this.config.smartTurn.fallbackTimeoutMs ?? 1000,
        sttTimeoutMs: this.config.smartTurn.sttTimeoutMs ?? DEFAULT_ENDPOINTING_CONFIG.sttTimeoutMs,
        userTurnStopTimeout: 5000,
        analyzeIntervalMs: this.config.smartTurn.analyzeIntervalMs ?? 200,
        maxAnalyzeAttempts: this.config.smartTurn.maxAnalyzeAttempts ?? 10,
        analyzeTimeoutMs: 500,
      })
      smartTurnStrategy.setSmartTurnAnalyzer(this.config.smartTurn.analyzer)
      this.endpointing = smartTurnStrategy
      this.log('Using Smart Turn ML endpointing')
    } else {
      this.useSmartTurn = false
      this.endpointing = new EndpointingStrategy({
        ...DEFAULT_ENDPOINTING_CONFIG,
        ...this.config.endpointing,
      })
      this.log('Using fixed timeout endpointing')
    }

    // 设置 Endpointing 回调
    this.endpointing.onUserTurnStopped = (params) => {
      this.handleEndpointingComplete(params)
    }

    // 初始化打断管理器
    this.interruptionManager = new InterruptionManager()

    // 设置 VAD 事件处理
    this.vadAnalyzer.setEventHandler((event) => {
      this.handleVADEvent(event)
    })
  }

  /**
   * 设置事件回调
   */
  setEvents(events: TurnControllerEvents): void {
    this.events = { ...this.events, ...events }
  }

  /**
   * 获取打断管理器
   * 允许外部注册打断处理器
   */
  getInterruptionManager(): InterruptionManager {
    return this.interruptionManager
  }

  /**
   * 获取当前状态
   */
  getState(): TurnState {
    return this.state
  }

  /**
   * 是否在用户轮次中
   */
  isUserTurn(): boolean {
    return this.state === TurnState.USER_TURN || this.state === TurnState.USER_DONE
  }

  /**
   * 是否在机器人轮次中
   */
  isBotTurn(): boolean {
    return this.state === TurnState.BOT_THINKING || this.state === TurnState.BOT_TURN
  }

  /**
   * 处理音频输入
   * @param samples - 音频样本 (Int16Array)
   */
  async processAudio(samples: Int16Array): Promise<VADState> {
    // VAD 分析
    const vadState = await this.vadAnalyzer.analyze(samples)

    // 如果使用 Smart Turn，将音频数据喂给 ML 模型
    if (this.useSmartTurn && this.endpointing.appendAudio) {
      // 转换 Int16 到 Float32
      const float32Audio = new Float32Array(samples.length)
      for (let i = 0; i < samples.length; i++) {
        float32Audio[i] = samples[i] / 32768.0
      }
      const isSpeech = vadState === VADState.SPEAKING || vadState === VADState.STARTING
      this.endpointing.appendAudio(float32Audio, isSpeech)
    }

    // VAD 事件会通过 handleVADEvent 回调处理
    return vadState
  }

  /**
   * 处理转录
   * @param frame - 转录帧
   */
  processTranscription(frame: TranscriptionFrame): void {
    // 重置用户轮次超时
    this.resetUserTurnStopTimeout()

    // 传递给 Endpointing 策略
    this.endpointing.handleTranscription(frame)
  }

  async startBotThinking(): Promise<void> {
    if (this.state !== TurnState.USER_DONE) {
      this.log(`startBotThinking called in invalid state: ${this.state}`)
      return
    }

    this.state = TurnState.BOT_THINKING
    this.log(`State: BOT_THINKING`)
  }

  /**
   * 开始机器人说话阶段。
   * 对齐 Pipecat：只有真实 TTS audio 开始输出后才算 BotStartedSpeaking。
   */
  async startBotTurn(): Promise<void> {
    if (this.state === TurnState.BOT_TURN) {
      return
    }

    if (this.state !== TurnState.BOT_THINKING && this.state !== TurnState.USER_DONE) {
      this.log(`startBotTurn called in invalid state: ${this.state}`)
      return
    }

    this.state = TurnState.BOT_TURN
    this.botTurnStartedAt = Date.now()
    this.log(`State: BOT_TURN`)

    // 重置打断状态
    this.interruptionManager.reset()

    // 启动 Bot Speaking 周期计时器 (移植自 Pipecat base_output.py)
    this.startBotSpeakingTimer()

    // 触发事件
    await this.callEventHandler('onBotTurnStart')
  }

  /**
   * 结束机器人轮次
   * 调用此方法表示机器人完成回复
   */
  async endBotTurn(): Promise<void> {
    if (this.state === TurnState.BOT_THINKING) {
      this.state = TurnState.IDLE
      this.log(`State: IDLE`)
      return
    }

    if (this.state !== TurnState.BOT_TURN) {
      if (this.state !== TurnState.USER_TURN) {
        this.log(`endBotTurn ignored in state: ${this.state}`)
      }
      return
    }

    // 停止 Bot Speaking 计时器
    this.stopBotSpeakingTimer()
    this.cancelPendingInterruption()

    this.state = TurnState.BOT_DONE
    this.log(`State: BOT_DONE`)

    // 触发事件
    await this.callEventHandler('onBotTurnEnd')

    // 返回 IDLE 状态
    this.state = TurnState.IDLE
    this.log(`State: IDLE`)
  }

  /**
   * 强制结束用户轮次
   * 在超时或外部触发时使用
   */
  async forceEndUserTurn(): Promise<void> {
    if (!this.userTurnActive) {
      return
    }

    const text = this.endpointing.getText()
    await this.triggerUserTurnStop({
      text,
      enableUserSpeakingFrames: true,
    })
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.state = TurnState.IDLE
    this.userSpeaking = false
    this.userTurnActive = false
    this.vadAnalyzer.reset()
    this.endpointing.reset()
    this.interruptionManager.reset()
    this.cancelUserTurnStopTimeout()
    this.stopBotSpeakingTimer()
    this.cancelPendingInterruption()
    this.log(`Reset to IDLE`)
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.cancelUserTurnStopTimeout()
    this.stopBotSpeakingTimer()
    this.cancelPendingInterruption()
    this.cancelAggregationWindow()
    this.vadAnalyzer.cleanup()
    this.endpointing.cleanup()
    this.interruptionManager.clear()
  }

  /**
   * 取消聚合窗口计时器
   */
  private cancelAggregationWindow(): void {
    if (this.aggregationTimeoutTask) {
      clearTimeout(this.aggregationTimeoutTask)
      this.aggregationTimeoutTask = null
    }
    this.pendingUserTurnStopParams = null
  }

  private cancelPendingInterruption(): void {
    if (this.pendingInterruptionTask) {
      clearTimeout(this.pendingInterruptionTask)
      this.pendingInterruptionTask = null
    }
  }

  /**
   * 处理 VAD 事件
   */
  private handleVADEvent(event: VADEvent): void {
    switch (event.type) {
      case 'speech_start':
        this.handleVADSpeechStart()
        break
      case 'speech_stop':
        this.handleVADSpeechStop(event.stopSecs ?? 0.2, event.timestamp)
        break
      case 'speech_activity':
        // 用户正在说话 - 触发 UI 更新事件
        // 移植自 Pipecat: speech_activity 事件用于 UI 显示用户说话状态
        this.callEventHandler('onUserSpeaking')
        break
    }
  }

  /**
   * 处理 VAD 检测到语音开始
   */
  private handleVADSpeechStart(): void {
    this.userSpeaking = true
    this.resetUserTurnStopTimeout()

    this.log(`VAD: speech_start, state: ${this.state}`)

    // 关键：取消聚合窗口计时器 (移植自 Pipecat)
    // 如果用户在聚合窗口内恢复说话，取消触发 onUserTurnEnd
    if (this.aggregationTimeoutTask || this.state === TurnState.USER_DONE) {
      this.log('User resumed speaking, cancelling aggregation window and continuing turn')
      this.cancelAggregationWindow()
      // 状态从 USER_DONE 变回 USER_TURN
      this.state = TurnState.USER_TURN
      this.log(`State: USER_TURN (resumed)`)
      // 重置 endpointing 计时器（但保留累积的文本）
      this.endpointing.handleVADUserStartedSpeaking()
      // 不需要开始新轮次，继续当前轮次
      // userTurnActive 仍然是 true
      return
    }

    // LLM/TTS 还在准备时，用户继续说话不算 bot speaking barge-in。
    // 取消当前生成并回到用户轮次，避免把短停顿后的续说切成新 bot 打断。
    if (this.state === TurnState.BOT_THINKING && this.config.enableInterruption) {
      this.log('User continued speaking while bot was thinking')
      void this.triggerInterruption()
      return
    }

    // 检查是否需要打断
    if (this.state === TurnState.BOT_TURN && this.config.enableInterruption) {
      this.scheduleInterruptionIfSpeechContinues()
      return
    }

    // 如果不在用户轮次中，开始用户轮次
    if (!this.userTurnActive) {
      this.triggerUserTurnStart({
        enableUserSpeakingFrames: true,
      })
    }

    // 通知 Endpointing
    this.endpointing.handleVADUserStartedSpeaking()
  }

  /**
   * 处理 VAD 检测到语音停止
   */
  private handleVADSpeechStop(stopSecs: number, timestamp: number): void {
    this.userSpeaking = false
    this.cancelPendingInterruption()
    this.resetUserTurnStopTimeout()

    this.log(`VAD: speech_stop, stopSecs: ${stopSecs}`)

    // 触发 VAD 静音检测事件（用于延迟追踪）
    this.callEventHandler('onVADSpeechStop')

    // 通知 Endpointing
    this.endpointing.handleVADUserStoppedSpeaking(stopSecs, timestamp)
  }

  /**
   * 触发用户轮次开始
   * 移植自 Pipecat: 同时重置所有策略（start + stop）
   */
  private async triggerUserTurnStart(params: UserTurnStartedParams): Promise<void> {
    if (this.userTurnActive) {
      return
    }

    this.userTurnActive = true
    this.state = TurnState.USER_TURN
    this.log(`State: USER_TURN`)

    // 重置所有策略 (移植自 Pipecat user_turn_controller.py:268-273)
    // VAD 分析器不需要完全重置（会丢失状态），只重置计数器
    this.endpointing.reset()

    // 启动用户轮次超时
    this.startUserTurnStopTimeout()

    // 触发事件
    await this.callEventHandler('onUserTurnStart', params)
  }

  /**
   * 触发用户轮次结束
   */
  private async triggerUserTurnStop(params: UserTurnStoppedParams): Promise<void> {
    if (!this.userTurnActive) {
      return
    }

    this.userTurnActive = false
    this.state = TurnState.USER_DONE
    this.log(`State: USER_DONE, text: ${params.text?.slice(0, 50)}...`)

    // 取消超时
    this.cancelUserTurnStopTimeout()

    // 重置 Endpointing
    this.endpointing.reset()

    // 触发事件
    await this.callEventHandler('onUserTurnEnd', params)
  }

  /**
   * 处理 Endpointing 完成
   *
   * 移植自 Pipecat: stop strategy 决定何时结束用户轮次。
   * SmartTurn 完成时直接结束；speech timeout 作为兜底策略等待用户续说。
   */
  private handleEndpointingComplete(params: UserTurnStoppedParams): void {
    this.log(`Endpointing complete, text: ${params.text?.slice(0, 50)}...`)

    if (!this.userTurnActive) {
      this.log('Endpointing complete ignored: no active user turn')
      return
    }

    if (this.aggregationWindowMs <= 0) {
      this.triggerUserTurnStop(params)
      return
    }

    // 如果启用了额外聚合窗口且已经在窗口中，更新参数但不重启计时器
    if (this.aggregationTimeoutTask) {
      this.log('Already in aggregation window, updating params')
      this.pendingUserTurnStopParams = params
      return
    }

    // 保存参数，启动聚合窗口
    this.pendingUserTurnStopParams = params

    // 进入 USER_DONE 状态，但不设置 userTurnActive = false
    // 这样用户恢复说话时可以继续当前轮次
    this.state = TurnState.USER_DONE
    this.log(`State: USER_DONE (aggregation window started, ${this.aggregationWindowMs}ms)`)

    // 启动聚合窗口计时器
    this.aggregationTimeoutTask = setTimeout(() => {
      this.aggregationTimeoutTask = null
      this.log('Aggregation window expired, triggering user turn stop')

      // 窗口过期，真正触发用户轮次结束
      if (this.pendingUserTurnStopParams) {
        this.triggerUserTurnStop(this.pendingUserTurnStopParams)
        this.pendingUserTurnStopParams = null
      }
    }, this.aggregationWindowMs)
  }

  /**
   * 触发打断
   * 移植自 Pipecat: 打断时重置所有策略
   */
  private async triggerInterruption(): Promise<void> {
    this.cancelPendingInterruption()

    // 停止 Bot Speaking 计时器
    this.stopBotSpeakingTimer()

    // 取消聚合窗口
    this.cancelAggregationWindow()

    // 触发打断事件
    await this.callEventHandler('onInterruption')

    // 通知所有打断处理器
    await this.interruptionManager.triggerInterruption()

    // 切换到用户轮次
    this.state = TurnState.USER_TURN
    this.userTurnActive = true

    // 重置所有策略 (移植自 Pipecat)
    this.endpointing.reset()
    // VAD 分析器的状态会在下一次 processAudio 时自然更新
  }

  private scheduleInterruptionIfSpeechContinues(): void {
    if (this.pendingInterruptionTask) {
      return
    }

    const elapsedSinceBotTurnStart = Date.now() - this.botTurnStartedAt
    const graceDelay = Math.max(0, this.config.interruptionInitialGraceMs - elapsedSinceBotTurnStart)
    const delay = Math.max(this.config.interruptionMinSpeechMs, graceDelay)

    this.log(`Interruption candidate, waiting ${delay}ms for sustained speech`)

    this.pendingInterruptionTask = setTimeout(() => {
      this.pendingInterruptionTask = null

      if (
        this.state !== TurnState.BOT_TURN ||
        !this.config.enableInterruption ||
        !this.userSpeaking
      ) {
        this.log('Interruption candidate cancelled')
        return
      }

      this.log('Interruption confirmed after sustained speech')
      void this.triggerInterruption()
    }, delay)
  }

  /**
   * 启动用户轮次超时计时器
   */
  private startUserTurnStopTimeout(): void {
    this.cancelUserTurnStopTimeout()

    const timeout = this.config.endpointing?.userTurnStopTimeout ??
      DEFAULT_ENDPOINTING_CONFIG.userTurnStopTimeout

    this.userTurnStopTimeoutTask = setTimeout(async () => {
      this.userTurnStopTimeoutTask = null

      if (this.userTurnActive && !this.userSpeaking) {
        this.log(`User turn stop timeout`)
        await this.callEventHandler('onUserTurnTimeout')
        await this.forceEndUserTurn()
      }
    }, timeout)
  }

  /**
   * 重置用户轮次超时计时器
   */
  private resetUserTurnStopTimeout(): void {
    if (this.userTurnActive) {
      this.startUserTurnStopTimeout()
    }
  }

  /**
   * 取消用户轮次超时计时器
   */
  private cancelUserTurnStopTimeout(): void {
    if (this.userTurnStopTimeoutTask) {
      clearTimeout(this.userTurnStopTimeoutTask)
      this.userTurnStopTimeoutTask = null
    }
  }

  /**
   * 调用事件处理器
   */
  private async callEventHandler<K extends keyof TurnControllerEvents>(
    event: K,
    ...args: Parameters<NonNullable<TurnControllerEvents[K]>>
  ): Promise<void> {
    const handler = this.events[event]
    if (handler) {
      try {
        // @ts-ignore - TypeScript 对 spread 参数的类型推断有限制
        await Promise.resolve(handler(...args))
      } catch (error) {
        console.error(`Event handler ${event} failed:`, error)
      }
    }
  }

  /**
   * 启动 Bot Speaking 周期计时器
   * 移植自 Pipecat base_output.py 的 _bot_speaking_frame_period
   * 用于周期性触发 onBotSpeaking 事件，供 UI 显示机器人说话状态
   */
  private startBotSpeakingTimer(): void {
    this.stopBotSpeakingTimer()

    this.botSpeakingTimerTask = setInterval(() => {
      if (this.state === TurnState.BOT_TURN) {
        this.callEventHandler('onBotSpeaking')
      }
    }, this.config.botSpeakingPeriod)
  }

  /**
   * 停止 Bot Speaking 周期计时器
   */
  private stopBotSpeakingTimer(): void {
    if (this.botSpeakingTimerTask) {
      clearInterval(this.botSpeakingTimerTask)
      this.botSpeakingTimerTask = null
    }
  }

  /**
   * 调试日志
   */
  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[TurnController] ${message}`)
    }
  }
}
