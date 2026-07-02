import { app } from 'electron'
import { join } from 'path'
import type { SDKConfig } from '@noema/sdk'
import type { LLMModelConfig, TaskRuntimeSettings } from './settings-store.js'

let personalityManager: any = null
let activeLLMConfig: LLMModelConfig | null = null
let activeTaskLLMConfig: LLMModelConfig | null = null
let activeTaskRuntimeConfig: TaskRuntimeSettings | null = null
let activeProxyUrl = ''


export function setActiveLLMConfig(config: LLMModelConfig | null): void {
  activeLLMConfig = config
}

export function setActiveTaskLLMConfig(config: LLMModelConfig | null): void {
  activeTaskLLMConfig = config
}

export function setActiveTaskRuntimeConfig(config: TaskRuntimeSettings | null): void {
  activeTaskRuntimeConfig = config
}

export function setActiveProxyUrl(proxyUrl: string): void {
  activeProxyUrl = proxyUrl.trim()
}

export function getStorageDir(): string {
  const appDataDir = app.getPath('userData')
  return join(appDataDir, 'noema-data')
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

  const llmTransport = activeLLMConfig?.transport ?? 'openai_compatible'
  const taskLLMTransport = activeTaskLLMConfig?.transport ?? 'openai_compatible'
  const llmApiKey = activeLLMConfig?.apiKey || process.env.LLM_API_KEY || ''
  const llmModel = llmTransport === 'openai_compatible'
    ? activeLLMConfig?.modelName || process.env.LLM_MODEL || 'deepseek-chat'
    : activeLLMConfig?.modelName || ''
  const llmBaseURL = activeLLMConfig?.baseUrl || process.env.LLM_BASE_URL || 'https://api.deepseek.com'
  const taskLLMApiKey = activeTaskLLMConfig?.apiKey || llmApiKey
  const taskLLMModel = taskLLMTransport === 'openai_compatible'
    ? activeTaskLLMConfig?.modelName || 'gemini-3.1-pro-preview'
    : activeTaskLLMConfig?.modelName || ''
  const taskLLMBaseURL = activeTaskLLMConfig?.baseUrl || llmBaseURL
  const taskRuntime = {
    ...(activeTaskRuntimeConfig ?? {}),
    llmTransport: taskLLMTransport,
    model: activeTaskLLMConfig?.modelName || activeTaskRuntimeConfig?.model,
  }

  return {
    llm: {
      ...(activeLLMConfig?.provider ? { provider: activeLLMConfig.provider } : {}),
      transport: llmTransport,
      apiKey: llmApiKey,
      model: llmModel,
      baseURL: llmBaseURL
    },
    taskLLM: {
      ...(activeTaskLLMConfig?.provider ? { provider: activeTaskLLMConfig.provider } : {}),
      transport: taskLLMTransport,
      apiKey: taskLLMApiKey,
      model: taskLLMModel,
      baseURL: taskLLMBaseURL
    },
    taskRuntime,
    network: {
      proxyUrl: activeProxyUrl
    },
    memory: {
      storageDir: getStorageDir()
    },
    characterProfile: personalityManager.getCurrentCharacterProfileOrNull()
  }
}
