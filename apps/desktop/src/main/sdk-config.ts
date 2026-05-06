import { app } from 'electron'
import { join } from 'path'
import type { SDKConfig } from '@her-text/types'
import type { LLMModelConfig, TaskRuntimeSettings } from './settings-store.js'

let personalityManager: any = null
let activeLLMConfig: LLMModelConfig | null = null
let activeTaskLLMConfig: LLMModelConfig | null = null
let activeTaskRuntimeConfig: TaskRuntimeSettings | null = null
let activePluginConfigs: Record<string, Record<string, unknown>> = {}


export function setActiveLLMConfig(config: LLMModelConfig | null): void {
  activeLLMConfig = config
}

export function setActiveTaskLLMConfig(config: LLMModelConfig | null): void {
  activeTaskLLMConfig = config
}

export function setActiveTaskRuntimeConfig(config: TaskRuntimeSettings | null): void {
  activeTaskRuntimeConfig = config
}

export function setActivePluginConfigs(configs: Record<string, Record<string, unknown>>): void {
  activePluginConfigs = configs
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

  const taskRuntime = activeTaskRuntimeConfig
    ? resolveTaskRuntimeConfig(activeTaskRuntimeConfig)
    : undefined

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

function resolveTaskRuntimeConfig(config: TaskRuntimeSettings): TaskRuntimeSettings {
  if (process.env.HER_TEXT_TASK_RUNTIME_CLI_ENABLED === 'false') {
    return config
  }
  const pluginConfig = activePluginConfigs['task-runtime-cli'] ?? {}
  const configured = pluginConfig.activeRuntime
  if (!isCliTaskRuntime(configured)) {
    return config
  }
  return {
    ...config,
    adapterId: configured,
    cwd: normalizeString(pluginConfig.cwd),
    command: normalizeString(pluginConfig.command),
    model: normalizeString(pluginConfig.model),
    timeoutMs: normalizePositiveNumber(pluginConfig.timeoutMs, config.timeoutMs || 1800000),
    extraArgs: parseRuntimeExtraArgs(pluginConfig.extraArgs),
  }
}

function isCliTaskRuntime(value: unknown): value is 'codex_local' | 'claude_code_local' {
  return value === 'codex_local' || value === 'claude_code_local'
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : fallback
}

function parseRuntimeExtraArgs(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean)
  }
  if (typeof value !== 'string') {
    return []
  }
  return value
    .split(/\s+/)
    .map(item => item.trim())
    .filter(Boolean)
}
