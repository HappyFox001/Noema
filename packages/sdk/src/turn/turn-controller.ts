

import { VADState, VADEvent, VADAnalyzer } from '../vad/index.js'
import type { STTProviderCapabilities } from '../audio/providers.js'
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
  type InterruptionReason,
} from './types.js'
import { EndpointingStrategy } from './endpointing.js'
import { SmartTurnEndpointingStrategy } from './smart-turn-endpointing.js'
import {
  VADUserTurnStartStrategy,
  TranscriptionUserTurnStartStrategy,
  type UserTurnStrategyContext,
} from './user-turn-strategies.js'


export interface TurnControllerConfig {
  
  endpointing?: Partial<EndpointingConfig>

  
  smartTurn?: SmartTurnOptions

  
  enableInterruption?: boolean

  
  botSpeakingPeriod?: number

  
  interruptionMinSpeechMs?: number

  
  interruptionInitialGraceMs?: number

  
  debug?: boolean
}


export class TurnController {
  private config: Required<Omit<TurnControllerConfig, 'smartTurn'>> & { smartTurn?: SmartTurnOptions }
  private state: TurnState = TurnState.IDLE
  private vadAnalyzer: VADAnalyzer
  private endpointing: IEndpointingStrategy
  private vadStartStrategy = new VADUserTurnStartStrategy()
  private transcriptionStartStrategy = new TranscriptionUserTurnStartStrategy({ useInterim: false })
  private useSmartTurn: boolean = false

  private userSpeaking = false
  private userTurnActive = false
  private userTurnStopTimeoutTask: ReturnType<typeof setTimeout> | null = null

  private botSpeakingTimerTask: ReturnType<typeof setInterval> | null = null
  private botTurnStartedAt = 0

  private pendingInterruptionTask: ReturnType<typeof setTimeout> | null = null

  private aggregationWindowMs = 0
  private aggregationTimeoutTask: ReturnType<typeof setTimeout> | null = null
  private pendingUserTurnStopParams: UserTurnStoppedParams | null = null

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

    if (this.config.smartTurn?.analyzer) {
      this.useSmartTurn = true
      const smartTurnStrategy = new SmartTurnEndpointingStrategy({
        sttTimeoutMs: this.config.smartTurn.sttTimeoutMs ?? DEFAULT_ENDPOINTING_CONFIG.sttTimeoutMs,
        userTurnStopTimeout: this.config.smartTurn.userTurnStopTimeout ?? 1000,
        analyzeIntervalMs: this.config.smartTurn.analyzeIntervalMs ?? 200,
        maxAnalyzeAttempts: this.config.smartTurn.maxAnalyzeAttempts ?? 10,
        analyzeTimeoutMs: 500,
      })
      smartTurnStrategy.setSmartTurnAnalyzer(this.config.smartTurn.analyzer)
      smartTurnStrategy.onSmartTurnResult = this.config.smartTurn.onResult ?? null
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

    this.endpointing.onUserTurnStopped = (params) => {
      this.handleEndpointingComplete(params)
    }

    this.vadAnalyzer.setEventHandler((event) => {
      this.handleVADEvent(event)
    })
  }

  
  setEvents(events: TurnControllerEvents): void {
    this.events = { ...this.events, ...events }
  }

  
  getState(): TurnState {
    return this.state
  }

  
  updateSTTProviderCapabilities(capabilities: STTProviderCapabilities): void {
    this.endpointing.setConfig?.({
      sttTimeoutMs: capabilities.sttTimeoutMs,
    })
    this.log(
      `STT capabilities: provider=${capabilities.provider}, streaming=${capabilities.streamingTranscripts}, sttTimeoutMs=${capabilities.sttTimeoutMs}`
    )
  }

  
  isUserTurn(): boolean {
    return this.state === TurnState.USER_TURN || this.state === TurnState.USER_DONE
  }

  
  isBotTurn(): boolean {
    return this.state === TurnState.BOT_THINKING || this.state === TurnState.BOT_TURN
  }

  
  async processAudio(samples: Int16Array): Promise<VADState> {
    const vadState = await this.vadAnalyzer.analyze(samples)

    if (this.useSmartTurn && this.endpointing.appendAudio) {
      const float32Audio = new Float32Array(samples.length)
      for (let i = 0; i < samples.length; i++) {
        float32Audio[i] = samples[i] / 32768.0
      }
      const isSpeech = vadState === VADState.SPEAKING || vadState === VADState.STARTING
      this.endpointing.appendAudio(float32Audio, isSpeech)
    }

    return vadState
  }

  
  async processTranscription(frame: TranscriptionFrame): Promise<void> {
    if (!this.userTurnActive) {
      await this.startUserTurnFromTranscription(frame)
    }

    this.resetUserTurnStopTimeout()

    this.endpointing.handleTranscription(frame)
  }

  
  private async startUserTurnFromTranscription(frame: TranscriptionFrame): Promise<void> {
    this.log(`Transcription started user turn, state: ${this.state}`)

    const decision = this.transcriptionStartStrategy.process(
      frame,
      this.getStrategyContext()
    )

    if (decision.action === 'interrupt') {
      await this.triggerInterruption({
        markVADStarted: decision.markVADStarted,
        reason: decision.reason,
      })
      return
    }

    if (decision.action === 'start') {
      await this.triggerUserTurnStart({
        enableUserSpeakingFrames: true,
      })
    }
  }

  async startBotThinking(): Promise<void> {
    if (this.state !== TurnState.USER_DONE) {
      this.log(`startBotThinking called in invalid state: ${this.state}`)
      return
    }

    this.state = TurnState.BOT_THINKING
    this.log(`State: BOT_THINKING`)
  }

  
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

    this.startBotSpeakingTimer()

    await this.callEventHandler('onBotTurnStart')
  }

  async endBotThinking(): Promise<void> {
    if (this.state !== TurnState.BOT_THINKING) {
      return
    }

    this.log('State: BOT_THINKING_END')
  }

  
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

    this.stopBotSpeakingTimer()
    this.cancelPendingInterruption()

    this.state = TurnState.BOT_DONE
    this.log(`State: BOT_DONE`)

    await this.callEventHandler('onBotTurnEnd')

    this.state = TurnState.IDLE
    this.log(`State: IDLE`)
  }

  
  async forceEndUserTurn(): Promise<void> {
    if (!this.userTurnActive) {
      return
    }

    const text = this.endpointing.getText()
    await this.triggerUserTurnStop({
      text,
      enableUserSpeakingFrames: true,
      endpointing: {
        strategy: 'forced_timeout',
        reason: this.useSmartTurn
          ? 'user_turn_stop_timeout_after_smart_turn_wait'
          : 'user_turn_stop_timeout_after_fixed_endpointing_wait',
      },
    })
  }

  
  reset(): void {
    this.state = TurnState.IDLE
    this.userSpeaking = false
    this.userTurnActive = false
    this.vadAnalyzer.reset()
    this.endpointing.reset()
    this.vadStartStrategy.reset()
    this.transcriptionStartStrategy.reset()
    this.cancelUserTurnStopTimeout()
    this.stopBotSpeakingTimer()
    this.cancelPendingInterruption()
    this.log(`Reset to IDLE`)
  }

  
  cleanup(): void {
    this.cancelUserTurnStopTimeout()
    this.stopBotSpeakingTimer()
    this.cancelPendingInterruption()
    this.cancelAggregationWindow()
    this.vadAnalyzer.cleanup()
    this.endpointing.cleanup()
  }

  
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

  
  private handleVADEvent(event: VADEvent): void {
    switch (event.type) {
      case 'speech_start':
        this.handleVADSpeechStart()
        break
      case 'speech_stop':
        this.handleVADSpeechStop(event.stopSecs ?? 0.2, event.timestamp)
        break
      case 'speech_activity':
        this.callEventHandler('onUserSpeaking')
        break
    }
  }

  
  private handleVADSpeechStart(): void {
    this.userSpeaking = true
    this.resetUserTurnStopTimeout()

    this.log(`VAD: speech_start, state: ${this.state}`)

    if (this.aggregationTimeoutTask) {
      this.log('User resumed speaking, cancelling aggregation window and continuing turn')
      this.cancelAggregationWindow()
      this.state = TurnState.USER_TURN
      this.log(`State: USER_TURN (resumed)`)
      this.endpointing.handleVADUserStartedSpeaking()
      return
    }

    const vadStartDecision = this.vadStartStrategy.process(
      { type: 'vad_speech_start' },
      this.getStrategyContext()
    )

    if (vadStartDecision.action === 'interrupt') {
      this.log('User continued speaking while bot was thinking')
      void this.triggerInterruption({
        reason: vadStartDecision.reason,
        markVADStarted: vadStartDecision.markVADStarted,
      })
      return
    }

    if (this.state === TurnState.BOT_TURN && this.config.enableInterruption) {
      this.scheduleInterruptionIfSpeechContinues()
      return
    }

    if (vadStartDecision.action === 'start') {
      this.triggerUserTurnStart({
        enableUserSpeakingFrames: true,
      })
    }

    this.endpointing.handleVADUserStartedSpeaking()
  }

  
  private handleVADSpeechStop(stopSecs: number, timestamp: number): void {
    this.userSpeaking = false
    this.cancelPendingInterruption()
    this.resetUserTurnStopTimeout()

    this.log(`VAD: speech_stop, stopSecs: ${stopSecs}`)

    this.callEventHandler('onVADSpeechStop')

    this.endpointing.handleVADUserStoppedSpeaking(stopSecs, timestamp)
  }

  
  private async triggerUserTurnStart(params: UserTurnStartedParams): Promise<void> {
    if (this.userTurnActive) {
      return
    }

    this.userTurnActive = true
    this.state = TurnState.USER_TURN
    this.log(`State: USER_TURN`)

    this.endpointing.reset()

    this.startUserTurnStopTimeout()

    await this.callEventHandler('onUserTurnStart', params)
  }

  
  private async triggerUserTurnStop(params: UserTurnStoppedParams): Promise<void> {
    if (!this.userTurnActive) {
      return
    }

    this.userTurnActive = false
    this.state = TurnState.USER_DONE
    this.log(`State: USER_DONE, text: ${params.text?.slice(0, 50)}...`)

    this.cancelUserTurnStopTimeout()

    this.endpointing.reset()

    await this.callEventHandler('onUserTurnEnd', params)
  }

  
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

    if (this.aggregationTimeoutTask) {
      this.log('Already in aggregation window, updating params')
      this.pendingUserTurnStopParams = params
      return
    }

    this.pendingUserTurnStopParams = params

    this.state = TurnState.USER_DONE
    this.log(`State: USER_DONE (aggregation window started, ${this.aggregationWindowMs}ms)`)

    this.aggregationTimeoutTask = setTimeout(() => {
      this.aggregationTimeoutTask = null
      this.log('Aggregation window expired, triggering user turn stop')

      if (this.pendingUserTurnStopParams) {
        this.triggerUserTurnStop(this.pendingUserTurnStopParams)
        this.pendingUserTurnStopParams = null
      }
    }, this.aggregationWindowMs)
  }

  
  private async triggerInterruption(
    options: { markVADStarted?: boolean; reason?: InterruptionReason } = {}
  ): Promise<void> {
    const markVADStarted = options.markVADStarted ?? true
    const reason = options.reason ?? 'vad_start'
    this.cancelPendingInterruption()

    this.stopBotSpeakingTimer()

    this.cancelAggregationWindow()

    this.state = TurnState.USER_TURN
    this.userTurnActive = true

    this.endpointing.reset()
    this.startUserTurnStopTimeout()
    await this.callEventHandler('onUserTurnStart', {
      enableUserSpeakingFrames: true,
    })
    if (markVADStarted) {
      this.endpointing.handleVADUserStartedSpeaking()
    }

    await this.callEventHandler('onInterruption', reason)

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
      void this.triggerInterruption({ reason: 'vad_start' })
    }, delay)
  }

  
  private startUserTurnStopTimeout(): void {
    this.cancelUserTurnStopTimeout()

    const timeout = this.useSmartTurn
      ? this.config.smartTurn?.userTurnStopTimeout ?? 1000
      : this.config.endpointing?.userTurnStopTimeout ?? DEFAULT_ENDPOINTING_CONFIG.userTurnStopTimeout

    this.userTurnStopTimeoutTask = setTimeout(async () => {
      this.userTurnStopTimeoutTask = null

      if (this.userTurnActive && !this.userSpeaking) {
        this.log(`User turn stop timeout`)
        await this.callEventHandler('onUserTurnTimeout')
        await this.forceEndUserTurn()
      }
    }, timeout)
  }

  
  private resetUserTurnStopTimeout(): void {
    if (this.userTurnActive) {
      this.startUserTurnStopTimeout()
    }
  }

  
  private cancelUserTurnStopTimeout(): void {
    if (this.userTurnStopTimeoutTask) {
      clearTimeout(this.userTurnStopTimeoutTask)
      this.userTurnStopTimeoutTask = null
    }
  }

  private getStrategyContext(): UserTurnStrategyContext {
    return {
      state: this.state,
      userTurnActive: this.userTurnActive,
      enableInterruption: this.config.enableInterruption,
      hasAggregationWindow: Boolean(this.aggregationTimeoutTask),
    }
  }

  
  private async callEventHandler<K extends keyof TurnControllerEvents>(
    event: K,
    ...args: Parameters<NonNullable<TurnControllerEvents[K]>>
  ): Promise<void> {
    const handler = this.events[event] as
      | ((...handlerArgs: Parameters<NonNullable<TurnControllerEvents[K]>>) => unknown)
      | undefined
    if (handler) {
      try {
        await Promise.resolve(handler(...args))
      } catch (error) {
        console.error(`Event handler ${event} failed:`, error)
      }
    }
  }

  
  private startBotSpeakingTimer(): void {
    this.stopBotSpeakingTimer()

    this.botSpeakingTimerTask = setInterval(() => {
      if (this.state === TurnState.BOT_TURN) {
        this.callEventHandler('onBotSpeaking')
      }
    }, this.config.botSpeakingPeriod)
  }

  
  private stopBotSpeakingTimer(): void {
    if (this.botSpeakingTimerTask) {
      clearInterval(this.botSpeakingTimerTask)
      this.botSpeakingTimerTask = null
    }
  }

  
  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[TurnController] ${message}`)
    }
  }
}
