

import {
  EndpointingConfig,
  TranscriptionFrame,
  UserTurnStoppedParams,
  IEndpointingStrategy,
  DEFAULT_ENDPOINTING_CONFIG,
} from './types.js'
import { SmartTurnAnalyzer, SmartTurnResult } from './smart-turn.js'
import { mergeFinalTranscriptText } from './transcription-text.js'


export interface SmartTurnEndpointingConfig extends EndpointingConfig {
  
  analyzeIntervalMs: number
  
  maxAnalyzeAttempts: number
  
  analyzeTimeoutMs: number
}

const DEFAULT_SMART_TURN_CONFIG: SmartTurnEndpointingConfig = {
  ...DEFAULT_ENDPOINTING_CONFIG,
  userSpeechTimeout: 0,
  sttTimeoutMs: DEFAULT_ENDPOINTING_CONFIG.sttTimeoutMs,
  analyzeIntervalMs: 200,
  maxAnalyzeAttempts: 10,
  analyzeTimeoutMs: 500,
}


export class SmartTurnEndpointingStrategy implements IEndpointingStrategy {
  private config: SmartTurnEndpointingConfig
  private smartTurn: SmartTurnAnalyzer | null = null

  private text = ''
  private vadUserSpeaking = false
  private transcriptFinalized = false
  private vadStoppedTime: number | null = null
  private turnComplete = false
  private sttWaitDone = false
  private turnCompleteReason: 'smart_turn_result' | 'audio_complete_timeout' | null = null
  private sttWaitReason: 'final_transcript' | 'stt_wait_timeout' | 'no_stt_wait_needed' | null = null

  private analyzeAttempts = 0
  private isAnalyzing = false
  private analyzeTimer: ReturnType<typeof setTimeout> | null = null
  private sttTimeoutTimer: ReturnType<typeof setTimeout> | null = null
  private turnStopTriggered = false

  onUserTurnStopped: ((params: UserTurnStoppedParams) => void | Promise<void>) | null = null
  onSmartTurnResult: ((result: SmartTurnResult) => void) | null = null

  constructor(config?: Partial<SmartTurnEndpointingConfig>) {
    this.config = { ...DEFAULT_SMART_TURN_CONFIG, ...config }
  }

  
  setSmartTurnAnalyzer(analyzer: SmartTurnAnalyzer): void {
    this.smartTurn = analyzer
  }

  
  setConfig(config: Partial<SmartTurnEndpointingConfig>): void {
    this.config = { ...this.config, ...config }
  }

  
  getConfig(): SmartTurnEndpointingConfig {
    return { ...this.config }
  }

  
  reset(): void {
    this.text = ''
    this.vadUserSpeaking = false
    this.transcriptFinalized = false
    this.vadStoppedTime = null
    this.turnComplete = false
    this.sttWaitDone = false
    this.turnCompleteReason = null
    this.sttWaitReason = null
    this.analyzeAttempts = 0
    this.isAnalyzing = false
    this.turnStopTriggered = false
    this.cancelAllTimers()
    this.smartTurn?.reset()
  }

  
  cleanup(): void {
    this.cancelAllTimers()
    this.onUserTurnStopped = null
    this.onSmartTurnResult = null
  }

  
  handleVADUserStartedSpeaking(): void {
    this.vadUserSpeaking = true
    this.transcriptFinalized = false
    this.vadStoppedTime = null
    this.turnComplete = false
    this.sttWaitDone = false
    this.turnCompleteReason = null
    this.sttWaitReason = null
    this.analyzeAttempts = 0
    this.isAnalyzing = false
    this.cancelAllTimers()
  }

  
  handleVADUserStoppedSpeaking(stopSecs: number, timestamp?: number): void {
    this.vadUserSpeaking = false
    this.vadStoppedTime = timestamp ?? Date.now()
    this.transcriptFinalized = false

    this.startSttWaitTimer(stopSecs)

    this.scheduleAnalysis(0)

  }

  
  appendAudio(audio: Float32Array, isSpeech: boolean): void {
    if (!this.smartTurn) return

    const state = this.smartTurn.appendAudio(audio, isSpeech)

    if (state === 'complete_timeout') {
      this.turnComplete = true
      this.turnCompleteReason = 'audio_complete_timeout'
      this.maybeTriggerUserTurnStopped('timeout')
    } else if (state === 'ready_for_analysis' && !this.isAnalyzing) {
      this.scheduleAnalysis()
    }
  }

  
  handleTranscription(frame: TranscriptionFrame): void {
    if (!frame.finalized) {
      return
    }

    this.mergeTranscriptionText(frame)
    this.transcriptFinalized = true
    this.sttWaitDone = true
    this.sttWaitReason = 'final_transcript'
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
      this.turnCompleteReason = 'smart_turn_result'
    }

    this.maybeTriggerUserTurnStopped('smart_turn')
  }

  
  getText(): string {
    return this.text
  }

  
  hasText(): boolean {
    return this.text.length > 0
  }

  
  private scheduleAnalysis(delayMs = this.config.analyzeIntervalMs): void {
    if (this.isAnalyzing || this.analyzeTimer) return
    if (!this.smartTurn) {
      return
    }

    this.analyzeTimer = setTimeout(async () => {
      this.analyzeTimer = null
      await this.runAnalysis()
    }, delayMs)
  }

  
  private mergeTranscriptionText(frame: TranscriptionFrame): void {
    this.text = mergeFinalTranscriptText(this.text, frame.text)
  }

  
  private async runAnalysis(): Promise<void> {
    if (!this.smartTurn || this.vadUserSpeaking) return

    this.isAnalyzing = true
    this.analyzeAttempts++

    try {
      const timeoutPromise = new Promise<SmartTurnResult>((_, reject) => {
        setTimeout(() => reject(new Error('Analysis timeout')), this.config.analyzeTimeoutMs)
      })

      const result = await Promise.race([
        this.smartTurn.analyze(),
        timeoutPromise,
      ])

      this.onSmartTurnResult?.(result)

      console.log(`[SmartTurn] Analysis #${this.analyzeAttempts}: ` +
        `complete=${result.isComplete}, prob=${result.probability.toFixed(3)}, ` +
        `time=${result.inferenceTimeMs.toFixed(1)}ms`)

      if (result.isComplete) {
        this.turnComplete = true
        this.turnCompleteReason = 'smart_turn_result'
        this.maybeTriggerUserTurnStopped('smart_turn')
        return
      }

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

      if (this.analyzeAttempts < this.config.maxAnalyzeAttempts) {
        this.scheduleAnalysis()
      }
    }
  }

  
  private startSttWaitTimer(stopSecs: number): void {
    if (this.sttTimeoutTimer) {
      clearTimeout(this.sttTimeoutTimer)
      this.sttTimeoutTimer = null
    }

    const effectiveSttWait = Math.max(0, this.config.sttTimeoutMs - stopSecs * 1000)
    console.log(`[SmartTurn] STT wait timer: ${effectiveSttWait.toFixed(0)}ms (sttTimeout=${this.config.sttTimeoutMs}ms, stopSecs=${stopSecs})`)
    if (this.transcriptFinalized || effectiveSttWait <= 0) {
      this.sttWaitDone = true
      this.sttWaitReason = this.transcriptFinalized ? 'final_transcript' : 'no_stt_wait_needed'
      return
    }

    this.sttWaitDone = false
    this.sttWaitReason = null
    this.sttTimeoutTimer = setTimeout(() => {
      this.sttTimeoutTimer = null
      this.sttWaitDone = true
      this.sttWaitReason = 'stt_wait_timeout'
      console.log('[SmartTurn] STT wait timeout expired')
      this.maybeTriggerUserTurnStopped('smart_turn')
    }, effectiveSttWait)
  }

  
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
        endpointing: {
          strategy: 'smart_turn',
          reason: this.describeStopReason(reason),
        },
      }

      console.log(`[SmartTurn] User turn stopped (reason: ${reason})`)

      Promise.resolve(this.onUserTurnStopped(params)).catch((error) => {
        console.error('onUserTurnStopped callback failed:', error)
      })
    }
  }

  private describeStopReason(reason: 'smart_turn' | 'timeout'): string {
    const turnReason = this.turnCompleteReason ?? (
      reason === 'timeout' ? 'audio_complete_timeout' : 'smart_turn_result'
    )
    const sttReason = this.sttWaitReason ?? 'unknown_stt_wait'
    return `${turnReason}+${sttReason}`
  }

  
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
