export interface Personality {
  character: {
    name: string
    chineseName?: string
    englishAlias?: string
    ageAtPreservation?: number
    gender?: string
    birthday?: string
    hometown?: string
    formerOccupation?: string
    currentState?: string
    appearanceImpression?: string
    personalityTraits?: string[]
    background: string
    coreMemories?: string[]
    values: string[]
    worldview?: string
    speakingStyle: string
    behaviorRules?: string[]
    likes?: string[]
    dislikes?: string[]
  }

  relationship: {
    type: 'companion' | 'assistant' | 'friend'
    intimacy: number
    trust: number
    dynamic?: string
  }
}

export interface ConversationTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface UserInput {
  text: string
  timestamp: number
  audioData?: ArrayBuffer
}

export interface AgentResponse {
  text: string
  shouldSpeak: boolean
  audioData?: ArrayBuffer
  toolCalls?: ToolCall[]
}

export interface Tool {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
  pluginId?: string
  safety?: 'safe' | 'read' | 'write' | 'external' | 'destructive' | 'computer'
  requiresApproval?: boolean
  timeoutMs?: number
  execute: (params: any) => Promise<any>
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface SDKConfig {
  llm: {
    apiKey: string
    model: string
    baseURL?: string
  }

  taskLLM?: {
    apiKey: string
    model: string
    baseURL?: string
  }

  memory: {
    vectorDB?: 'chroma' | 'lancedb'
    storageDir: string
  }

  personality: Personality

  audio?: {
    asr?: {
      provider: 'whisper' | 'azure'
      apiKey?: string
    }
    tts?: {
      provider: 'elevenlabs' | 'azure'
      apiKey?: string
      voiceId?: string
    }
  }
}

export type TriggerType =
  | 'time_based'
  | 'inactivity'
  | 'reminder'
  | 'manual'

export interface ProactiveTrigger {
  type: TriggerType
  timestamp: number
  context?: any
}

export interface OrbState {
  mode: 'idle' | 'listening' | 'thinking' | 'speaking'
  size: number
  color: string
  glow: number
  ripple: number
}

export interface AudioConfig {
  sampleRate: number
  channels: number
  bufferSize: number
}

export enum VadResult {
  Silence = 'silence',
  Speaking = 'speaking',
  Stopped = 'stopped'
}
