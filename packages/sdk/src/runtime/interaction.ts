/**
 * Interaction intent types that decouple speech, dialogue, and durable work.
 */
import type { EmotionalTurnRecord, OutputStateSnapshot } from './boundaries.js'
import type { WorkSignal, WorkState } from './work-state.js'

export type InteractionIntentKind =
  | 'chat'
  | 'speech.stop'
  | 'speech.mute'
  | 'speech.unmute'
  | 'speech.repeat'
  | 'work.resume'
  | 'work.pause'
  | 'work.modify'
  | 'work.status'
  | 'work.cancel'

export type UserInterruptionKind =
  | 'none'
  | 'speech_stop'
  | 'question'
  | 'constraint'
  | 'correction'
  | 'pause_work'
  | 'cancel_work'

export interface InteractionIntent {
  kind: InteractionIntentKind
  targetThreadId?: string
  workDescription?: string
  modification?: string
  reason: string
}

export interface InteractionResolveInput {
  userInput: string
  emotionalTurn?: EmotionalTurnRecord
  workState: WorkState
  outputState: OutputStateSnapshot
  timestamp: number
}

export interface InteractionResolveResult {
  intents: InteractionIntent[]
  interruptionKind: UserInterruptionKind
}

export interface WorkFeedbackInput {
  signal: WorkSignal
  workState: WorkState
  outputState: OutputStateSnapshot
  timestamp: number
}
