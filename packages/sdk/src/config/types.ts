/**
 * SDK configuration contract.
 */
import type { Personality } from '../personality/index.js'

export interface SDKConfig {
  llm: {
    provider?: string
    apiKey: string
    model: string
    baseURL?: string
  }

  taskLLM?: {
    provider?: string
    apiKey: string
    model: string
    baseURL?: string
  }

  taskRuntime?: {
    adapterId?: string
    llmTransport?: 'openai_compatible' | 'codex_local' | 'claude_code_local'
    maxTurns?: number
    modelContextWindow?: number
    autoCompactTokenLimit?: number
    keepRecentTurns?: number
    cwd?: string
    timeoutMs?: number
    command?: string
    model?: string
    extraArgs?: string[]
    env?: Record<string, string>
  }

  network?: {
    proxyUrl?: string
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
