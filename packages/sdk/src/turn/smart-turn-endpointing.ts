/**
 * Smart Turn Endpointing 策略
 *
 * 使用 ML 模型智能判断用户是否说完话，而非固定超时
 * 相比固定超时策略 (400ms)，可以在 ~100ms 内准确判断
 */

import {
  EndpointingConfig,
  TranscriptionFrame,
  UserTurnStoppedParams,
  IEndpointingStrategy,
  DEFAULT_ENDPOINTING_CONFIG,
} from './types.js'
import { SmartTurnAnalyzer, SmartTurnResult } from './smart-turn.js'

/**
 * Smart Turn Endpointing 配置
 */
export interface SmartTurnEndpointingConfig extends EndpointingConfig {
  /** 分析间隔 (毫秒) - 静音后多久开始分析 */
  analyzeIntervalMs: number
  /** 最大分析次数 */
  maxAnalyzeAttempts: number
  /** 分析超时 (毫秒) - 单次分析最长时间 */
  analyzeTimeoutMs: number
}

const DEFAULT_SMART_TURN_CONFIG: SmartTurnEndpointingConfig = {
  ...DEFAULT_ENDPOINTING_CONFIG,
  userSpeechTimeout: 0,
  sttTimeoutMs: DEFAULT_ENDPOINTING_CONFIG.sttTimeoutMs,
  analyzeIntervalMs: 200,       // 200ms 静音后开始分析
  maxAnalyzeAttempts: 10,       // 最多分析 10 次
  analyzeTimeoutMs: 500,        // 单次分析最多 500ms
}

/**
 * Smart Turn Endpointing 策略
 *
 * 工作原理：
 * 1. VAD 检测到静音后，立即调用 turn analyzer
 * 2. analyzer 判断 COMPLETE 后，等待 final TranscriptionFrame 或 STT P99 timeout
 * 3. finalized transcript 可短路 STT timeout 并结束用户轮次
 * 4. 如果 timeout 已过但 final transcript 仍未到，则继续等待 transcript text
 */
export class SmartTurnEndpointingStrategy implements IEndpointingStrategy {
  private config: SmartTurnEndpointingConfig
  private smartTurn: SmartTurnAnalyzer | null = null

  // 状态
  private text = ''
  private vadUserSpeaking = false
  private transcriptFinalized = false
  private vadStoppedTime: number | null = null
  private turnComplete = false
  private sttWaitDone = false
  private sttTimeoutExpired = false

  // 分析状态
  private analyzeAttempts = 0
  private isAnalyzing = false
  private analyzeTimer: ReturnType<typeof setTimeout> | null = null
  private sttTimeoutTimer: ReturnType<typeof setTimeout> | null = null
  private turnStopTriggered = false

  // 回调
  onUserTurnStopped: ((params: UserTurnStoppedParams) => void | Promise<void>) | null = null
  onSmartTurnResult: ((result: SmartTurnResult) => void) | null = null

  constructor(config?: Partial<SmartTurnEndpointingConfig>) {
    this.config = { ...DEFAULT_SMART_TURN_CONFIG, ...config }
  }

  /**
   * 设置 Smart Turn 分析器
   */
  setSmartTurnAnalyzer(analyzer: SmartTurnAnalyzer): void {
    this.smartTurn = analyzer
  }

  /**
   * 更新配置
   */
  setConfig(config: Partial<SmartTurnEndpointingConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * 获取当前配置
   */
  getConfig(): SmartTurnEndpointingConfig {
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
    this.turnComplete = false
    this.sttWaitDone = false
    this.sttTimeoutExpired = false
    this.analyzeAttempts = 0
    this.isAnalyzing = false
    this.turnStopTriggered = false
    this.cancelAllTimers()
    this.smartTurn?.reset()
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.cancelAllTimers()
    this.onUserTurnStopped = null
    this.onSmartTurnResult = null
  }

  /**
   * 处理 VAD 用户开始说话事件
   */
  handleVADUserStartedSpeaking(): void {
    this.vadUserSpeaking = true
    this.transcriptFinalized = false
    this.vadStoppedTime = null
    this.turnComplete = false
    this.sttWaitDone = false
    this.sttTimeoutExpired = false
    this.analyzeAttempts = 0
    this.isAnalyzing = false
    this.cancelAllTimers()
  }

  /**
   * 处理 VAD 用户停止说话事件
   */
  handleVADUserStoppedSpeaking(stopSecs: number, timestamp?: number): void {
    this.vadUserSpeaking = false
    this.vadStoppedTime = timestamp ?? Date.now()
    // 每次新的 VAD stop 都需要等待“本次停顿之后”的 STT final。
    // 不能复用前一次短停顿已经到达的 final，否则连续说话时会过早 endpoint。
    this.transcriptFinalized = false
    this.sttTimeoutExpired = false

    this.startSttWaitTimer(stopSecs)

    // Pipecat 的 TurnAnalyzerUserTurnStopStrategy 在收到
    // VADUserStoppedSpeakingFrame 时会立刻 analyze_end_of_turn()。
    // analyzeIntervalMs 只用于还没正式 VAD stop、但已有足够静音的提前分析。
    this.scheduleAnalysis(0)

  }

  /**
   * 添加音频数据到 Smart Turn 分析器
   */
  appendAudio(audio: Float32Array, isSpeech: boolean): void {
    if (!this.smartTurn) return

    const state = this.smartTurn.appendAudio(audio, isSpeech)

    if (state === 'complete_timeout') {
      // SmartTurn 内部静音超时，按 completed turn 处理，仍等待 STT final/timeout
      this.turnComplete = true
      this.maybeTriggerUserTurnStopped('timeout')
    } else if (state === 'ready_for_analysis' && !this.isAnalyzing) {
      // 有足够静音，安排分析
      this.scheduleAnalysis()
    }
  }

  /**
   * 处理转录
   */
  handleTranscription(frame: TranscriptionFrame): void {
    if (!frame.finalized) {
      return
    }

    this.mergeTranscriptionText(frame)
    this.transcriptFinalized = true
    this.sttWaitDone = true
    if (this.sttTimeoutTimer) {
      clearTimeout(this.sttTimeoutTimer)
      this.sttTimeoutTimer = null
    }

    // Pipecat TurnAnalyzerUserTurnStopStrategy fallback: a transcript can
    // arrive without a VAD stop when VAD missed soft speech. In that case the
    // transcript itself proves a user turn exists; treat it as complete and
    // let the finalized transcript short-circuit the wait.
    if (!this.vadUserSpeaking && this.vadStoppedTime === null) {
      this.turnComplete = true
    }

    this.maybeTriggerUserTurnStopped('smart_turn')
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
   * 安排 ML 分析
   */
  private scheduleAnalysis(delayMs = this.config.analyzeIntervalMs): void {
    if (this.isAnalyzing || this.analyzeTimer) return
    if (!this.smartTurn) {
      // 没有 Smart Turn，使用备用超时
      return
    }

    this.analyzeTimer = setTimeout(async () => {
      this.analyzeTimer = null
      await this.runAnalysis()
    }, delayMs)
  }

  /**
   * 对齐 Pipecat TurnAnalyzerUserTurnStopStrategy：只保存最终
   * TranscriptionFrame 的文本，不把滑动 interim 当成用户最终输入。
   */
  private mergeTranscriptionText(frame: TranscriptionFrame): void {
    const next = frame.text.trim()
    if (!next) {
      return
    }

    this.text = next
  }

  /**
   * 运行 ML 分析
   */
  private async runAnalysis(): Promise<void> {
    if (!this.smartTurn || this.vadUserSpeaking) return

    this.isAnalyzing = true
    this.analyzeAttempts++

    try {
      // 设置分析超时
      const timeoutPromise = new Promise<SmartTurnResult>((_, reject) => {
        setTimeout(() => reject(new Error('Analysis timeout')), this.config.analyzeTimeoutMs)
      })

      const result = await Promise.race([
        this.smartTurn.analyze(),
        timeoutPromise,
      ])

      // 通知分析结果
      this.onSmartTurnResult?.(result)

      console.log(`[SmartTurn] Analysis #${this.analyzeAttempts}: ` +
        `complete=${result.isComplete}, prob=${result.probability.toFixed(3)}, ` +
        `time=${result.inferenceTimeMs.toFixed(1)}ms`)

      if (result.isComplete) {
        // ML 判断用户说完了
        this.turnComplete = true
        this.maybeTriggerUserTurnStopped('smart_turn')
        return
      }

      // 继续分析，除非达到最大次数
      if (this.analyzeAttempts < this.config.maxAnalyzeAttempts) {
        this.isAnalyzing = false
        this.scheduleAnalysis()
      } else {
        console.log('[SmartTurn] Max attempts reached, waiting for analyzer completion or transcription')
        this.isAnalyzing = false
      }
    } catch (error) {
      console.warn('[SmartTurn] Analysis failed:', error)
      this.isAnalyzing = false

      // 失败后继续尝试
      if (this.analyzeAttempts < this.config.maxAnalyzeAttempts) {
        this.scheduleAnalysis()
      }
    }
  }

  /**
   * 启动 STT 等待计时器。
   *
   * 对齐 Pipecat TurnAnalyzerUserTurnStopStrategy：
   * SmartTurn 判定完成后，还需要等待 STT final，或等待 STT P99 timeout 兜底。
   */
  private startSttWaitTimer(stopSecs: number): void {
    if (this.sttTimeoutTimer) {
      clearTimeout(this.sttTimeoutTimer)
      this.sttTimeoutTimer = null
    }

    const effectiveSttWait = Math.max(0, this.config.sttTimeoutMs - stopSecs * 1000)
    console.log(`[SmartTurn] STT wait timer: ${effectiveSttWait.toFixed(0)}ms (sttTimeout=${this.config.sttTimeoutMs}ms, stopSecs=${stopSecs})`)
    if (this.transcriptFinalized || effectiveSttWait <= 0) {
      this.sttWaitDone = true
      return
    }

    this.sttWaitDone = false
    this.sttTimeoutTimer = setTimeout(() => {
      this.sttTimeoutTimer = null
      this.sttTimeoutExpired = true
      this.sttWaitDone = true
      console.log('[SmartTurn] STT wait timeout expired')
      this.maybeTriggerUserTurnStopped('smart_turn')
    }, effectiveSttWait)
  }

  /**
   * 条件满足时触发用户轮次结束
   */
  private maybeTriggerUserTurnStopped(reason: 'smart_turn' | 'timeout'): void {
    if (this.turnStopTriggered) {
      return
    }

    if (this.vadUserSpeaking || !this.turnComplete || !this.sttWaitDone || !this.text.trim()) {
      if (this.turnComplete && this.sttWaitDone && !this.text.trim()) {
        console.log('[SmartTurn] Waiting for transcription text before stopping user turn')
      }
      return
    }

    this.turnStopTriggered = true
    this.cancelAllTimers()

    if (this.onUserTurnStopped) {
      const params: UserTurnStoppedParams = {
        text: this.text,
        enableUserSpeakingFrames: true,
      }

      console.log(`[SmartTurn] User turn stopped (reason: ${reason})`)

      Promise.resolve(this.onUserTurnStopped(params)).catch((error) => {
        console.error('onUserTurnStopped callback failed:', error)
      })
    }
  }

  /**
   * 取消所有计时器
   */
  private cancelAllTimers(): void {
    if (this.analyzeTimer) {
      clearTimeout(this.analyzeTimer)
      this.analyzeTimer = null
    }
    if (this.sttTimeoutTimer) {
      clearTimeout(this.sttTimeoutTimer)
      this.sttTimeoutTimer = null
    }
  }
}
