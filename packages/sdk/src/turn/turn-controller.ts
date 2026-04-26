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
 * USER_DONE ─[开始 LLM]─→ BOT_TURN
 * BOT_TURN ─[TTS 完成]─→ BOT_DONE ─→ IDLE
 *
 * 打断路径：
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
  DEFAULT_ENDPOINTING_CONFIG,
} from './types.js'
import { EndpointingStrategy } from './endpointing.js'
import { InterruptionManager } from './interruption.js'

/**
 * 轮次控制器配置
 */
export interface TurnControllerConfig {
  /**
   * Endpointing 配置
   */
  endpointing?: Partial<EndpointingConfig>

  /**
   * 是否启用打断检测
   * @default true
   */
  enableInterruption?: boolean

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
  private config: Required<TurnControllerConfig>
  private state: TurnState = TurnState.IDLE
  private vadAnalyzer: VADAnalyzer
  private endpointing: EndpointingStrategy
  private interruptionManager: InterruptionManager

  // 状态追踪
  private userSpeaking = false
  private userTurnActive = false
  private userTurnStopTimeoutTask: ReturnType<typeof setTimeout> | null = null

  // 事件回调
  private events: TurnControllerEvents = {}

  constructor(
    vadAnalyzer: VADAnalyzer,
    config?: TurnControllerConfig
  ) {
    this.vadAnalyzer = vadAnalyzer
    this.config = {
      endpointing: config?.endpointing ?? {},
      enableInterruption: config?.enableInterruption ?? true,
      debug: config?.debug ?? false,
    }

    // 初始化 Endpointing 策略
    this.endpointing = new EndpointingStrategy({
      ...DEFAULT_ENDPOINTING_CONFIG,
      ...this.config.endpointing,
    })

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
    return this.state === TurnState.BOT_TURN
  }

  /**
   * 处理音频输入
   * @param samples - 音频样本 (Int16Array)
   */
  async processAudio(samples: Int16Array): Promise<VADState> {
    // VAD 分析
    const vadState = await this.vadAnalyzer.analyze(samples)

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

  /**
   * 开始机器人轮次
   * 调用此方法表示开始处理用户输入并生成回复
   */
  async startBotTurn(): Promise<void> {
    if (this.state !== TurnState.USER_DONE) {
      this.log(`startBotTurn called in invalid state: ${this.state}`)
      return
    }

    this.state = TurnState.BOT_TURN
    this.log(`State: BOT_TURN`)

    // 重置打断状态
    this.interruptionManager.reset()

    // 触发事件
    await this.callEventHandler('onBotTurnStart')
  }

  /**
   * 结束机器人轮次
   * 调用此方法表示机器人完成回复
   */
  async endBotTurn(): Promise<void> {
    if (this.state !== TurnState.BOT_TURN) {
      this.log(`endBotTurn called in invalid state: ${this.state}`)
      return
    }

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
    this.log(`Reset to IDLE`)
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.cancelUserTurnStopTimeout()
    this.endpointing.cleanup()
    this.interruptionManager.clear()
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
        // 可选：用于 UI 更新
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

    // 检查是否需要打断
    if (this.state === TurnState.BOT_TURN && this.config.enableInterruption) {
      this.log(`Interruption detected!`)
      this.triggerInterruption()
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
    this.resetUserTurnStopTimeout()

    this.log(`VAD: speech_stop, stopSecs: ${stopSecs}`)

    // 通知 Endpointing
    this.endpointing.handleVADUserStoppedSpeaking(stopSecs, timestamp)
  }

  /**
   * 触发用户轮次开始
   */
  private async triggerUserTurnStart(params: UserTurnStartedParams): Promise<void> {
    if (this.userTurnActive) {
      return
    }

    this.userTurnActive = true
    this.state = TurnState.USER_TURN
    this.log(`State: USER_TURN`)

    // 重置 Endpointing
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
   */
  private handleEndpointingComplete(params: UserTurnStoppedParams): void {
    this.log(`Endpointing complete, text: ${params.text?.slice(0, 50)}...`)
    this.triggerUserTurnStop(params)
  }

  /**
   * 触发打断
   */
  private async triggerInterruption(): Promise<void> {
    // 触发打断事件
    await this.callEventHandler('onInterruption')

    // 通知所有打断处理器
    await this.interruptionManager.triggerInterruption()

    // 切换到用户轮次
    this.state = TurnState.USER_TURN
    this.userTurnActive = true

    // 重置 Endpointing
    this.endpointing.reset()
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
   * 调试日志
   */
  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[TurnController] ${message}`)
    }
  }
}
