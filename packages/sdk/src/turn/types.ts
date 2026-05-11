

import type { SmartTurnAnalyzer, SmartTurnResult } from './smart-turn.js'


export enum TurnState {
  
  IDLE = 'idle',
  
  USER_TURN = 'user_turn',
  
  USER_DONE = 'user_done',
  
  BOT_THINKING = 'bot_thinking',
  
  BOT_TURN = 'bot_turn',
  
  BOT_DONE = 'bot_done',
}


export interface EndpointingConfig {
  
  userSpeechTimeout: number

  
  sttTimeoutMs: number

  
  userTurnStopTimeout: number
}


export interface UserTurnStartedParams {
  
  enableUserSpeakingFrames?: boolean
}


export interface UserTurnStoppedParams {
  
  enableUserSpeakingFrames?: boolean

  
  text?: string
}


export interface InterruptionHandler {
  
  onInterruption(): Promise<void>
}

export type InterruptionReason = 'vad_start' | 'transcript_start' | 'manual' | 'provider_switch'


export interface IEndpointingStrategy {
  
  onUserTurnStopped: ((params: UserTurnStoppedParams) => void | Promise<void>) | null
  
  setConfig?(config: Partial<EndpointingConfig>): void
  
  handleVADUserStartedSpeaking(): void
  
  handleVADUserStoppedSpeaking(stopSecs: number, timestamp?: number): void
  
  handleTranscription(frame: TranscriptionFrame): void
  
  getText(): string
  
  hasText(): boolean
  
  reset(): void
  
  cleanup(): void
  
  appendAudio?(audio: Float32Array, isSpeech: boolean): void
}


export interface SmartTurnOptions {
  
  analyzer: SmartTurnAnalyzer
  
  analyzeIntervalMs?: number
  
  maxAnalyzeAttempts?: number
  
  sttTimeoutMs?: number

  userTurnStopTimeout?: number
  
  onResult?: (result: SmartTurnResult) => void
}


export interface TurnControllerEvents {
  
  onUserTurnStart?: (params: UserTurnStartedParams) => void | Promise<void>

  
  onUserTurnEnd?: (params: UserTurnStoppedParams) => void | Promise<void>

  
  onBotTurnStart?: () => void | Promise<void>

  
  onBotTurnEnd?: () => void | Promise<void>

  
  onInterruption?: (reason: InterruptionReason) => void | Promise<void>

  
  onUserTurnTimeout?: () => void | Promise<void>

  
  onVADSpeechStop?: () => void | Promise<void>

  
  onBotSpeaking?: () => void | Promise<void>

  
  onUserSpeaking?: () => void | Promise<void>
}


export interface TranscriptionFrame {
  
  text: string
  
  finalized: boolean
  
  timestamp: number
}


export const DEFAULT_ENDPOINTING_CONFIG: EndpointingConfig = {
  userSpeechTimeout: 600, // 600ms
  sttTimeoutMs: 800,
  userTurnStopTimeout: 1500,
}
