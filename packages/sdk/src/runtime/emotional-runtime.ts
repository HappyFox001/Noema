/**
 * Normalizes emotional-layer inputs and outputs into durable runtime records.
 */
import type { ResponseItem } from '../context/index.js'
import type { EmotionalTurnRecord } from './boundaries.js'
import type { WorkSignal, WorkState } from './work-state.js'

export interface EmotionalRuntimeInput {
  userInput: string
  conversationContext: ResponseItem[]
  personality: unknown
  memory: unknown
  workState: WorkState
  workSignals?: WorkSignal[]
  createdAt?: number
}

export interface EmotionalRuntimeOutput {
  replyText: string
  emotionTag?: string
  intentHints: string[]
  record: EmotionalTurnRecord
  createdAt: number
}

export class EmotionalRuntime {
  createOutput(input: EmotionalRuntimeInput, result: {
    replyText: string
    emotionTag?: string
    intentHints?: string[]
  }): EmotionalRuntimeOutput {
    const createdAt = input.createdAt ?? Date.now()
    const intentHints = [...new Set((result.intentHints ?? []).filter(Boolean))]
    const record: EmotionalTurnRecord = {
      userInput: input.userInput,
      replyText: result.replyText,
      ...(result.emotionTag ? { emotionTag: result.emotionTag } : {}),
      ...(intentHints.length > 0 ? { intentHints } : {}),
      createdAt,
    }
    return {
      replyText: result.replyText,
      ...(result.emotionTag ? { emotionTag: result.emotionTag } : {}),
      intentHints,
      record,
      createdAt,
    }
  }
}
