import { TurnState, type InterruptionReason, type TranscriptionFrame } from './types.js'

export type UserTurnStartDecision =
  | { action: 'none' }
  | { action: 'start' }
  | { action: 'interrupt'; reason: InterruptionReason; markVADStarted: boolean }

export interface UserTurnStrategyContext {
  state: TurnState
  userTurnActive: boolean
  enableInterruption: boolean
  hasAggregationWindow: boolean
}

export interface UserTurnStartStrategy<TFrame> {
  process(frame: TFrame, context: UserTurnStrategyContext): UserTurnStartDecision
  reset(): void
}

export interface VADSpeechStartFrame {
  type: 'vad_speech_start'
}

export class VADUserTurnStartStrategy implements UserTurnStartStrategy<VADSpeechStartFrame> {
  process(_frame: VADSpeechStartFrame, context: UserTurnStrategyContext): UserTurnStartDecision {
    if (context.hasAggregationWindow) {
      return { action: 'none' }
    }

    if (context.state === TurnState.BOT_THINKING && context.enableInterruption) {
      return { action: 'interrupt', reason: 'vad_start', markVADStarted: true }
    }

    if (context.state === TurnState.BOT_TURN && context.enableInterruption) {
      return { action: 'none' }
    }

    if (!context.userTurnActive) {
      return { action: 'start' }
    }

    return { action: 'none' }
  }

  reset(): void {}
}

export class TranscriptionUserTurnStartStrategy implements UserTurnStartStrategy<TranscriptionFrame> {
  constructor(private readonly options: { useInterim: boolean } = { useInterim: false }) {}

  process(frame: TranscriptionFrame, context: UserTurnStrategyContext): UserTurnStartDecision {
    if (context.userTurnActive || !frame.text.trim()) {
      return { action: 'none' }
    }

    if (!this.options.useInterim && !frame.finalized) {
      return { action: 'none' }
    }

    if (
      (context.state === TurnState.BOT_THINKING || context.state === TurnState.BOT_TURN) &&
      context.enableInterruption
    ) {
      return { action: 'interrupt', reason: 'transcript_start', markVADStarted: false }
    }

    return { action: 'start' }
  }

  reset(): void {}
}
