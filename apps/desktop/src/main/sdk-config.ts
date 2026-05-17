import { app } from 'electron'
import { join } from 'path'
import type { SDKConfig } from '@her-text/types'
import type { LLMModelConfig, TaskRuntimeSettings } from './settings-store.js'

let personalityManager: any = null
let activeLLMConfig: LLMModelConfig | null = null
let activeTaskLLMConfig: LLMModelConfig | null = null
let activeTaskRuntimeConfig: TaskRuntimeSettings | null = null


export function setActiveLLMConfig(config: LLMModelConfig | null): void {
  activeLLMConfig = config
}

export function setActiveTaskLLMConfig(config: LLMModelConfig | null): void {
  activeTaskLLMConfig = config
}

export function setActiveTaskRuntimeConfig(config: TaskRuntimeSettings | null): void {
  activeTaskRuntimeConfig = config
}

export function getStorageDir(): string {
  const appDataDir = app.getPath('userData')
  return join(appDataDir, 'her-text-data')
}

export async function initializePersonalityManager(): Promise<void> {
  const { PersonalityManager } = await import('./personality-manager.js')
  personalityManager = new PersonalityManager()
  await personalityManager.initialize()
}

export function getPersonalityManager(): any {
  if (!personalityManager) {
    throw new Error('PersonalityManager not initialized')
  }
  return personalityManager
}

export async function buildSDKConfig(): Promise<SDKConfig> {
  if (!personalityManager) {
    throw new Error(
      'PersonalityManager not initialized. Call initializePersonalityManager() first.'
    )
  }

  const llmApiKey = activeLLMConfig?.apiKey || process.env.LLM_API_KEY || ''
  const llmModel = activeLLMConfig?.modelName || process.env.LLM_MODEL || 'deepseek-chat'
  const llmBaseURL = activeLLMConfig?.baseUrl || process.env.LLM_BASE_URL || 'https://api.deepseek.com'
  const taskLLMApiKey = activeTaskLLMConfig?.apiKey || llmApiKey
  const taskLLMModel = activeTaskLLMConfig?.modelName || 'gemini-3.1-pro-preview'
  const taskLLMBaseURL = activeTaskLLMConfig?.baseUrl || llmBaseURL
  const taskRuntime = {
    ...(activeTaskRuntimeConfig ?? {}),
    llmTransport: activeTaskLLMConfig?.transport ?? 'openai_compatible',
    model: activeTaskLLMConfig?.transport === 'openai_compatible'
      ? activeTaskRuntimeConfig?.model
      : activeTaskLLMConfig?.modelName,
  }

  return {
    llm: {
      apiKey: llmApiKey,
      model: llmModel,
      baseURL: llmBaseURL
    },
    taskLLM: {
      apiKey: taskLLMApiKey,
      model: taskLLMModel,
      baseURL: taskLLMBaseURL
    },
    taskRuntime,
    memory: {
      storageDir: getStorageDir()
    },
    personality: personalityManager.getCurrentPersonality()
  }
}
