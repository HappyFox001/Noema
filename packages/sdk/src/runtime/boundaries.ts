/**
 * Runtime layer boundary contracts for emotional, interaction, work, and output flows.
 */

export type RuntimeLayer =
  | 'emotional'
  | 'interaction'
  | 'work'
  | 'output'

export interface EmotionalTurnRecord {
  userInput: string
  replyText: string
  emotionTag?: string
  intentHints?: string[]
  createdAt: number
}

export interface OutputStateSnapshot {
  speaking: boolean
  muted: boolean
  currentPhase?: 'reply' | 'task_progress' | 'task_result'
  lastSpeechStartedAt?: number
  lastSpeechEndedAt?: number
}

export type FeedbackTiming =
  | 'silent'
  | 'display_only'
  | 'after_current_output'
  | 'after_user_pause'
  | 'speak_now'
  | 'interrupt_output'

export interface FeedbackDecision {
  timing: FeedbackTiming
  reason: string
}

export interface RuntimeBoundaryContract {
  layer: RuntimeLayer
  owns: string[]
  consumes: string[]
  emits: string[]
  mustNot: string[]
}

export const RUNTIME_BOUNDARY_CONTRACTS: RuntimeBoundaryContract[] = [
  {
    layer: 'emotional',
    owns: ['relationship-aware wording', 'emotion tags', 'visible reply shape'],
    consumes: ['user input', 'conversation memory', 'selected work facts'],
    emits: ['emotional turn records', 'emotional output'],
    mustNot: ['execute tools', 'invent work facts', 'decide work completion'],
  },
  {
    layer: 'interaction',
    owns: ['intent routing', 'work focus policy', 'feedback timing'],
    consumes: ['user input', 'emotional turn records', 'work state', 'output state'],
    emits: ['speech intents', 'work intents', 'feedback decisions'],
    mustNot: ['execute tools', 'generate final prose', 'store source-of-truth work facts'],
  },
  {
    layer: 'work',
    owns: ['work state', 'tool execution', 'observations', 'artifacts', 'verification'],
    consumes: ['work intents', 'emotional turn records', 'tool results'],
    emits: ['work snapshots', 'work signals', 'task execution events'],
    mustNot: ['speak directly to the user', 'style emotional output', 'treat speech stop as cancellation'],
  },
  {
    layer: 'output',
    owns: ['display frames', 'TTS frames', 'expression frames', 'playback state'],
    consumes: ['emotional output', 'feedback decisions', 'speech intents'],
    emits: ['playback state events'],
    mustNot: ['cancel work by itself', 'rewrite work facts'],
  },
]

