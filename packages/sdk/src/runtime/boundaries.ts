/**
 * Runtime layer boundary contracts for emotional, bridge, work, and output flows.
 */

export type RuntimeLayer =
  | 'emotional'
  | 'bridge'
  | 'work'
  | 'output'

export interface EmotionalTurnRecord {
  userInput: string
  replyText: string
  emotionTag?: string
  intentHints?: string[]
  createdAt: number
}

export type FeedbackTiming =
  | 'silent'
  | 'display_only'
  | 'after_current_output'
  | 'after_user_pause'
  | 'speak_now'

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
    emits: ['emotional turn records', 'emotional output', 'task signals'],
    mustNot: ['execute tools', 'invent work facts', 'decide work completion'],
  },
  {
    layer: 'bridge',
    owns: ['cross-layer signal timing', 'cross-layer information shape'],
    consumes: ['emotional task signals', 'work signals', 'task execution events'],
    emits: ['task admission inputs', 'emotional feedback requests'],
    mustNot: ['execute tools', 'generate final prose', 'control TTS playback', 'delay initial emotional speech'],
  },
  {
    layer: 'work',
    owns: ['work state', 'tool execution', 'observations', 'artifacts', 'verification'],
    consumes: ['task admission inputs', 'emotional turn records', 'tool results'],
    emits: ['work snapshots', 'work signals', 'task execution events'],
    mustNot: ['speak directly to the user', 'style emotional output', 'treat speech stop as cancellation'],
  },
  {
    layer: 'output',
    owns: ['display frames', 'TTS frames', 'expression frames', 'playback state'],
    consumes: ['emotional output'],
    emits: ['playback state events'],
    mustNot: ['cancel work by itself', 'rewrite work facts'],
  },
]
