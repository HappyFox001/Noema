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
  /** 最大分析次数 - 超过后回退到超时 */
  maxAnalyzeAttempts: number
  /** 分析超时 (毫秒) - 单次分析最长时间 */
  analyzeTimeoutMs: number
}

const DEFAULT_SMART_TURN_CONFIG: SmartTurnEndpointingConfig = {
  ...DEFAULT_ENDPOINTING_CONFIG,
  userSpeechTimeout: 2000,      // 2秒超时备用
  analyzeIntervalMs: 200,       // 200ms 静音后开始分析
  maxAnalyzeAttempts: 10,       // 最多分析 10 次
  analyzeTimeoutMs: 500,        // 单次分析最多 500ms
}

/**
 * Smart Turn Endpointing 策略
 *
 * 工作原理：
 * 1. VAD 检测到静音后，等待 200ms 开始 ML 分析
 * 2. 如果 ML 判断用户说完 (概率 > 0.5)，立即触发
 * 3. 如果连续分析都是 "未完成"，继续等待
 * 4. 超过 2 秒静音后，强制触发 (备用策略)
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

  // 分析状态
  private analyzeAttempts = 0
  private isAnalyzing = false
  private analyzeTimer: ReturnType<typeof setTimeout> | null = null
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null
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

    this.startSttWaitTimer(stopSecs)

    // 启动分析计时器
    this.scheduleAnalysis()

    // 启动备用超时计时器
    this.startFallbackTimer()
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
    this.mergeTranscriptionText(frame)

    if (frame.finalized) {
      this.transcriptFinalized = true
      this.sttWaitDone = true
      if (this.sttTimeoutTimer) {
        clearTimeout(this.sttTimeoutTimer)
        this.sttTimeoutTimer = null
      }
      this.maybeTriggerUserTurnStopped('smart_turn')
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
   * 安排 ML 分析
   */
  private scheduleAnalysis(): void {
    if (this.isAnalyzing || this.analyzeTimer) return
    if (!this.smartTurn) {
      // 没有 Smart Turn，使用备用超时
      return
    }

    this.analyzeTimer = setTimeout(async () => {
      this.analyzeTimer = null
      await this.runAnalysis()
    }, this.config.analyzeIntervalMs)
  }

  /**
   * 实时 ASR 的 interim/final 文本经常是“当前完整假设”，不是 delta。
   * 对齐 Pipecat TurnAnalyzer 路径的语义，避免把连续 interim 重复累加。
   */
  private mergeTranscriptionText(frame: TranscriptionFrame): void {
    const next = frame.text.trim()
    if (!next) {
      return
    }

    if (!this.text) {
      this.text = next
      return
    }

    if (next === this.text || this.text.includes(next)) {
      return
    }

    if (next.startsWith(this.text)) {
      this.text = next
      return
    }

    this.text += next
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
        console.log('[SmartTurn] Max attempts reached, waiting for fallback timeout')
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
   * 启动备用超时计时器
   */
  private startFallbackTimer(): void {
    if (this.fallbackTimer) return

    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = null
      console.log('[SmartTurn] Fallback timeout triggered')
      this.turnComplete = true
      this.maybeTriggerUserTurnStopped('fallback_timeout')
    }, this.config.userSpeechTimeout)
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
    if (this.transcriptFinalized || effectiveSttWait <= 0) {
      this.sttWaitDone = true
      return
    }

    this.sttWaitDone = false
    this.sttTimeoutTimer = setTimeout(() => {
      this.sttTimeoutTimer = null
      this.sttWaitDone = true
      this.maybeTriggerUserTurnStopped('smart_turn')
    }, effectiveSttWait)
  }

  /**
   * 条件满足时触发用户轮次结束
   */
  private maybeTriggerUserTurnStopped(reason: 'smart_turn' | 'timeout' | 'fallback_timeout'): void {
    if (this.turnStopTriggered) {
      return
    }

    if (this.vadUserSpeaking || !this.turnComplete || !this.sttWaitDone) {
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
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer)
      this.fallbackTimer = null
    }
    if (this.sttTimeoutTimer) {
      clearTimeout(this.sttTimeoutTimer)
      this.sttTimeoutTimer = null
    }
  }
}
