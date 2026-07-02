/**
 * Persistent desktop settings store.
 *
 * Loads user settings, fills missing system model configuration from `.env`,
 * and writes the merged settings back to Electron user data storage.
 */
import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import {
  getASRProviderCatalogEntry,
  getImageProviderCatalogEntry,
  getLLMProviderCatalogEntry,
  getTTSProviderCatalogEntry,
  type ASRProviderType,
  type ImageProviderType,
  type LLMProviderType,
  type TTSProviderType,
} from './model-provider-catalog.js'


function loadSystemConfigFromEnv(): SystemConfig | null {
  const env = process.env

  const hasEnvConfig = Object.keys(env).some(key =>
    key.startsWith('LLM_') ||
    key.startsWith('CHAT_') ||
    key.startsWith('TASK_') ||
    key.startsWith('TTS_') ||
    key.startsWith('ASR_') ||
    key === 'PROXY_URL'
  )

  if (!hasEnvConfig) {
    return null
  }

  const taskModels: LLMModelConfig[] = []
  for (let i = 1; i <= 10; i++) {
    const modelName = env[`TASK_${i}_MODEL`]
    const apiKey = env[`TASK_${i}_API_KEY`] || env[`LLM_${i}_API_KEY`]
    const baseUrl = env[`TASK_${i}_BASE_URL`] || env[`LLM_${i}_BASE_URL`]
    const provider = env[`TASK_${i}_PROVIDER`] as LLMProviderType | undefined

    if (modelName || apiKey || baseUrl || provider) {
      const providerEntry = getLLMProviderCatalogEntry(provider)
      taskModels.push({
        id: `env-task-${i}`,
        provider: providerEntry.value,
        modelName: modelName || providerEntry.defaultModel || 'gemini-3.1-pro-preview',
        apiKey: apiKey || '',
        baseUrl: baseUrl || providerEntry.defaultBaseUrl
      })
    }
  }

  const llmModels: LLMModelConfig[] = []
  for (let i = 1; i <= 10; i++) {
    const modelName = env[`LLM_${i}_MODEL`]
    const apiKey = env[`LLM_${i}_API_KEY`]
    const baseUrl = env[`LLM_${i}_BASE_URL`]
    const provider = env[`LLM_${i}_PROVIDER`] as LLMProviderType | undefined

    if (modelName || apiKey || baseUrl || provider) {
      const providerEntry = getLLMProviderCatalogEntry(provider)
      llmModels.push({
        id: `env-llm-${i}`,
        provider: providerEntry.value,
        modelName: modelName || providerEntry.defaultModel,
        apiKey: apiKey || '',
        baseUrl: baseUrl || providerEntry.defaultBaseUrl
      })
    }
  }

  const chatModels: ChatModelConfig[] = []
  for (let i = 1; i <= 10; i++) {
    const modelName = env[`CHAT_${i}_MODEL`]
    const apiKey = env[`CHAT_${i}_API_KEY`]
    const baseUrl = env[`CHAT_${i}_BASE_URL`]
    const modelType = env[`CHAT_${i}_TYPE`] === 'image' ? 'image' : 'llm'
    const provider = env[`CHAT_${i}_PROVIDER`]

    if (modelName || apiKey || baseUrl || provider) {
      const providerEntry = modelType === 'image'
        ? getImageProviderCatalogEntry(provider)
        : getLLMProviderCatalogEntry(provider)
      chatModels.push({
        id: `env-chat-${i}`,
        modelType,
        provider: providerEntry.value,
        modelName: modelName || providerEntry.defaultModel,
        enabledModels: [modelName || providerEntry.defaultModel].filter(Boolean),
        availableModels: [],
        apiKey: apiKey || '',
        baseUrl: baseUrl || providerEntry.defaultBaseUrl
      })
    }
  }

  const ttsModels: TTSModelConfig[] = []
  for (let i = 1; i <= 10; i++) {
    const provider = env[`TTS_${i}_PROVIDER`] as TTSProviderType | undefined
    const modelName = env[`TTS_${i}_MODEL`]
    const apiKey = env[`TTS_${i}_API_KEY`]
    const voiceId = env[`TTS_${i}_VOICE_ID`]
    const baseUrl = env[`TTS_${i}_BASE_URL`]
    const language = env[`TTS_${i}_LANGUAGE`]

    if (provider || apiKey) {
      ttsModels.push({
        id: `env-tts-${i}`,
        provider: provider || 'fish',
        modelName: modelName || getTTSProviderCatalogEntry(provider || 'fish').defaultModel,
        apiKey: apiKey || '',
        voiceId: voiceId || '',
        baseUrl: baseUrl || getTTSProviderCatalogEntry(provider || 'fish').defaultBaseUrl,
        language: language || getTTSProviderCatalogEntry(provider || 'fish').defaultLanguage
      })
    }
  }

  const asrModels: ASRModelConfig[] = []
  for (let i = 1; i <= 10; i++) {
    const provider = env[`ASR_${i}_PROVIDER`] as ASRProviderType | undefined
    const modelName = env[`ASR_${i}_MODEL`]
    const apiKey = env[`ASR_${i}_API_KEY`]
    const baseUrl = env[`ASR_${i}_BASE_URL`]
    const language = env[`ASR_${i}_LANGUAGE`]

    if (provider || apiKey) {
      asrModels.push({
        id: `env-asr-${i}`,
        provider: provider || 'qwen',
        modelName: modelName || getASRProviderCatalogEntry(provider || 'qwen').defaultModel,
        apiKey: apiKey || '',
        baseUrl: baseUrl || getASRProviderCatalogEntry(provider || 'qwen').defaultBaseUrl,
        language: language || getASRProviderCatalogEntry(provider || 'qwen').defaultLanguage
      })
    }
  }

  const llmActive = parseInt(env['LLM_ACTIVE'] || '1', 10) - 1
  const chatActive = parseInt(env['CHAT_ACTIVE'] || '1', 10) - 1
  const taskActive = parseInt(env['TASK_ACTIVE'] || '1', 10) - 1
  const ttsActive = parseInt(env['TTS_ACTIVE'] || '1', 10) - 1
  const asrActive = parseInt(env['ASR_ACTIVE'] || '1', 10) - 1

  return {
    proxy: env['PROXY_URL'] || env['HTTPS_PROXY'] || env['HTTP_PROXY'] || '',
    llmModels: llmModels.length > 0 ? llmModels : [],
    activeLLMId: llmModels[llmActive]?.id || llmModels[0]?.id || '',
    chatModels: chatModels.length > 0 ? chatModels : [],
    activeChatId: chatModels[chatActive]?.id || chatModels[0]?.id || '',
    activeChatModelName: chatModels[chatActive]?.enabledModels?.[0] || chatModels[0]?.enabledModels?.[0] || '',
    taskModels: taskModels.length > 0 ? taskModels : [],
    activeTaskId: taskModels[taskActive]?.id || taskModels[0]?.id || '',
    taskRuntime: DEFAULT_TASK_RUNTIME_SETTINGS,
    ttsModels: ttsModels.length > 0 ? ttsModels : [],
    activeTTSId: ttsModels[ttsActive]?.id || ttsModels[0]?.id || '',
    asrModels: asrModels.length > 0 ? asrModels : [],
    activeASRId: asrModels[asrActive]?.id || asrModels[0]?.id || ''
  }
}


export interface LLMModelConfig {
  id: string
  provider?: LLMProviderType
  transport?: 'openai_compatible' | 'codex_local' | 'claude_code_local'
  modelName: string
  apiKey: string
  baseUrl: string
}

export interface ChatModelConfig {
  id: string
  modelType: 'llm' | 'image'
  provider?: LLMProviderType | ImageProviderType
  transport?: 'openai_compatible' | 'codex_local' | 'claude_code_local'
  modelName: string
  enabledModels?: string[]
  availableModels?: string[]
  modelsFetchedAt?: number
  apiKey: string
  baseUrl: string
}

export interface TTSModelConfig {
  id: string
  provider: TTSProviderType
  modelName: string
  apiKey: string
  voiceId?: string
  baseUrl?: string
  language?: string
  format?: 'pcm' | 'mp3' | 'opus'
  sampleRate?: number
  extra?: Record<string, unknown>
}


export interface ASRModelConfig {
  id: string
  provider: ASRProviderType
  modelName: string
  apiKey: string
  baseUrl?: string
  language?: string
  sampleRate?: number
  extra?: Record<string, unknown>
}


export interface SystemConfig {
  proxy: string
  llmModels: LLMModelConfig[]
  activeLLMId: string
  chatModels: ChatModelConfig[]
  activeChatId: string
  activeChatModelName: string
  taskModels: LLMModelConfig[]
  activeTaskId: string
  taskRuntime: TaskRuntimeSettings
  ttsModels: TTSModelConfig[]
  activeTTSId: string
  asrModels: ASRModelConfig[]
  activeASRId: string
}

export interface TaskRuntimeSettings {
  adapterId: string
  maxTurns: number
  modelContextWindow: number
  autoCompactTokenLimit: number
  keepRecentTurns: number
  cwd: string
  timeoutMs: number
  command: string
  model: string
  extraArgs: string[]
}

const DEFAULT_TASK_RUNTIME_SETTINGS: TaskRuntimeSettings = {
  adapterId: 'task_runtime',
  maxTurns: 24,
  modelContextWindow: 128000,
  autoCompactTokenLimit: 115200,
  keepRecentTurns: 4,
  cwd: '',
  timeoutMs: 1800000,
  command: '',
  model: '',
  extraArgs: []
}

const DEFAULT_SELECTED_CHARACTER_PROFILE = ''

export interface AppSettings {
  language: 'zh-CN' | 'en-US'
  voiceInputEnabled: boolean
  voiceOutputEnabled: boolean
  volume: number
  appearance: AppearanceSettings
  experimental: ExperimentalSettings
  selectedPersonality: string
  externalRolePaths: string[]
  plugins: Record<string, boolean>
  pluginConfigs: Record<string, Record<string, unknown>>
  pluginPathHistory: Record<string, { mode: 'file' | 'directory'; lastPath: string; recentPaths: string[] }>
  system: SystemConfig
}

export interface AppearanceSettings {
  orbStyle: 'default' | 'advanced' | 'planet'
  theme: 'night' | 'day'
  liquidGlassEnabled: boolean
  dragonCursorEnabled: boolean
}

export interface ExperimentalSettings {
  selfLearningEnabled: boolean
}

const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  orbStyle: 'default',
  theme: 'night',
  liquidGlassEnabled: true,
  dragonCursorEnabled: true
}

const DEFAULT_EXPERIMENTAL_SETTINGS: ExperimentalSettings = {
  selfLearningEnabled: true
}

const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  proxy: '',
  llmModels: [{
    id: 'default-llm',
    provider: 'openai-compatible',
    modelName: '',
    apiKey: '',
    baseUrl: ''
  }],
  activeLLMId: 'default-llm',
  chatModels: [{
    id: 'default-chat',
    modelType: 'llm',
    provider: 'openai-compatible',
    modelName: '',
    enabledModels: [],
    availableModels: [],
    apiKey: '',
    baseUrl: ''
  }],
  activeChatId: 'default-chat',
  activeChatModelName: '',
  taskModels: [{
    id: 'default-task',
    provider: 'gemini',
    modelName: 'gemini-3.1-pro-preview',
    apiKey: '',
    baseUrl: ''
  }],
  activeTaskId: 'default-task',
  taskRuntime: DEFAULT_TASK_RUNTIME_SETTINGS,
  ttsModels: [{
    id: 'default-tts',
    provider: 'fish',
    modelName: 's2-pro',
    apiKey: '',
    voiceId: '',
    baseUrl: '',
    language: '',
    format: 'pcm',
    sampleRate: 16000
  }],
  activeTTSId: 'default-tts',
  asrModels: [{
    id: 'default-asr',
    provider: 'qwen',
    modelName: 'qwen3-asr-flash-realtime',
    apiKey: '',
    baseUrl: getASRProviderCatalogEntry('qwen').defaultBaseUrl,
    language: 'zh',
    sampleRate: 16000
  }],
  activeASRId: 'default-asr'
}

const DEFAULT_SETTINGS: AppSettings = {
  language: 'zh-CN',
  voiceInputEnabled: true,
  voiceOutputEnabled: true,
  volume: 70,
  appearance: DEFAULT_APPEARANCE_SETTINGS,
  experimental: DEFAULT_EXPERIMENTAL_SETTINGS,
  selectedPersonality: DEFAULT_SELECTED_CHARACTER_PROFILE,
  externalRolePaths: [],
  plugins: {},
  pluginConfigs: {},
  pluginPathHistory: {},
  system: DEFAULT_SYSTEM_CONFIG
}

export class SettingsStore {
  private settings: AppSettings = cloneDefaultSettings()
  private filePath: string
  private persistQueue: Promise<void> = Promise.resolve()

  constructor() {
    this.filePath = join(app.getPath('userData'), 'settings.json')
  }

  async initialize(): Promise<void> {
    await mkdir(app.getPath('userData'), { recursive: true })

    const isFirstRun = !existsSync(this.filePath)

    if (isFirstRun) {
      const envConfig = loadSystemConfigFromEnv()
      if (envConfig) {
        console.log('[SettingsStore] First run: loading config from .env')
        this.settings = {
          ...cloneDefaultSettings(),
          system: normalizeSystemConfig(this.mergeSystemConfig(DEFAULT_SYSTEM_CONFIG, envConfig), DEFAULT_SYSTEM_CONFIG)
        }
      }
      await this.persist()
      return
    }

    try {
      const raw = await readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<AppSettings>

      let systemConfig: SystemConfig = {
        ...DEFAULT_SYSTEM_CONFIG,
        ...(parsed.system ?? {}),
        llmModels: parsed.system?.llmModels?.length ? parsed.system.llmModels : DEFAULT_SYSTEM_CONFIG.llmModels,
        chatModels: parsed.system?.chatModels?.length ? parsed.system.chatModels : DEFAULT_SYSTEM_CONFIG.chatModels,
        taskModels: parsed.system?.taskModels?.length ? parsed.system.taskModels : DEFAULT_SYSTEM_CONFIG.taskModels,
        taskRuntime: normalizeTaskRuntimeSettings(parsed.system?.taskRuntime),
        ttsModels: parsed.system?.ttsModels?.length ? parsed.system.ttsModels : DEFAULT_SYSTEM_CONFIG.ttsModels,
        asrModels: parsed.system?.asrModels?.length ? parsed.system.asrModels : DEFAULT_SYSTEM_CONFIG.asrModels,
      }

      const hasEmptyApiKeys = this.hasEmptyApiKeys(systemConfig)
      if (hasEmptyApiKeys) {
        const envConfig = loadSystemConfigFromEnv()
        if (envConfig) {
          console.log('[SettingsStore] Filling empty API keys from .env')
          systemConfig = this.mergeSystemConfig(systemConfig, envConfig)
        }
      }
      systemConfig = normalizeSystemConfig(systemConfig, DEFAULT_SYSTEM_CONFIG)

      this.settings = {
        ...cloneDefaultSettings(),
        ...parsed,
        language: normalizeLanguage(parsed.language),
        appearance: normalizeAppearanceSettings(parsed.appearance),
        experimental: normalizeExperimentalSettings(parsed.experimental),
        selectedPersonality: normalizeSelectedCharacterProfile(parsed.selectedPersonality),
        externalRolePaths: normalizeExternalRolePaths(parsed.externalRolePaths),
        plugins: parsed.plugins && typeof parsed.plugins === 'object' ? parsed.plugins : {},
        pluginConfigs: parsed.pluginConfigs && typeof parsed.pluginConfigs === 'object' ? parsed.pluginConfigs : {},
        pluginPathHistory: parsed.pluginPathHistory && typeof parsed.pluginPathHistory === 'object' ? parsed.pluginPathHistory : {},
        volume: clampVolume(parsed.volume ?? DEFAULT_SETTINGS.volume),
        system: systemConfig
      }
    } catch (error) {
      console.warn('[SettingsStore] Failed to load settings, using defaults:', error)
      const envConfig = loadSystemConfigFromEnv()
      if (envConfig) {
        this.settings = {
          ...cloneDefaultSettings(),
          system: normalizeSystemConfig(this.mergeSystemConfig(DEFAULT_SYSTEM_CONFIG, envConfig), DEFAULT_SYSTEM_CONFIG)
        }
      } else {
        this.settings = cloneDefaultSettings()
      }
      await this.persist()
    }
  }

  
  private hasEmptyApiKeys(config: SystemConfig): boolean {
    const llmEmpty = config.llmModels.some(m => !m.apiKey)
    const chatEmpty = config.chatModels.some(m => !m.apiKey)
    const taskEmpty = config.taskModels.some(m => (m.transport ?? 'openai_compatible') === 'openai_compatible' && !m.apiKey)
    const ttsEmpty = config.ttsModels.some(m => !m.apiKey)
    const asrEmpty = config.asrModels.some(m => !m.apiKey)
    return llmEmpty || chatEmpty || taskEmpty || ttsEmpty || asrEmpty
  }

  
  private mergeSystemConfig(base: SystemConfig, env: SystemConfig): SystemConfig {
    const proxy = base.proxy || env.proxy

    const llmModels = base.llmModels.map((model, index) => {
      if (!model.apiKey && env.llmModels[index]?.apiKey) {
        return { ...model, apiKey: env.llmModels[index].apiKey }
      }
      if (!model.apiKey && env.llmModels[0]?.apiKey) {
        return { ...model, apiKey: env.llmModels[0].apiKey }
      }
      return model
    })

    const useEnvLLM = base.llmModels.length === 1 &&
      !base.llmModels[0].apiKey &&
      base.llmModels[0].id === 'default-llm' &&
      env.llmModels.length > 0

    const chatModels = base.chatModels.map((model, index) => {
      if (!model.apiKey && env.chatModels[index]?.apiKey) {
        return {
          ...model,
          apiKey: env.chatModels[index].apiKey,
          baseUrl: model.baseUrl || env.chatModels[index].baseUrl,
        }
      }
      if (!model.apiKey && env.chatModels[0]?.apiKey) {
        return {
          ...model,
          apiKey: env.chatModels[0].apiKey,
          baseUrl: model.baseUrl || env.chatModels[0].baseUrl,
        }
      }
      return model
    })

    const useEnvChat = base.chatModels.length === 1 &&
      !base.chatModels[0].apiKey &&
      base.chatModels[0].id === 'default-chat' &&
      env.chatModels.length > 0

    const taskModels = base.taskModels.map((model, index) => {
      if (!model.apiKey && env.taskModels[index]?.apiKey) {
        return {
          ...model,
          apiKey: env.taskModels[index].apiKey,
          baseUrl: model.baseUrl || env.taskModels[index].baseUrl,
        }
      }
      if (!model.apiKey && env.taskModels[0]?.apiKey) {
        return {
          ...model,
          apiKey: env.taskModels[0].apiKey,
          baseUrl: model.baseUrl || env.taskModels[0].baseUrl,
        }
      }
      return model
    })

    const useEnvTask = base.taskModels.length === 1 &&
      !base.taskModels[0].apiKey &&
      base.taskModels[0].id === 'default-task' &&
      env.taskModels.length > 0

    const ttsModels = base.ttsModels.map((model, index) => {
      if (!model.apiKey && env.ttsModels[index]?.apiKey) {
        return {
          ...model,
          apiKey: env.ttsModels[index].apiKey,
          baseUrl: model.baseUrl || env.ttsModels[index].baseUrl,
          language: model.language || env.ttsModels[index].language,
        }
      }
      if (!model.apiKey && env.ttsModels[0]?.apiKey) {
        return {
          ...model,
          apiKey: env.ttsModels[0].apiKey,
          baseUrl: model.baseUrl || env.ttsModels[0].baseUrl,
          language: model.language || env.ttsModels[0].language,
        }
      }
      return model
    })

    const useEnvTTS = base.ttsModels.length === 1 &&
      !base.ttsModels[0].apiKey &&
      base.ttsModels[0].id === 'default-tts' &&
      env.ttsModels.length > 0

    const asrModels = base.asrModels.map((model, index) => {
      if (!model.apiKey && env.asrModels[index]?.apiKey) {
        return {
          ...model,
          apiKey: env.asrModels[index].apiKey,
          baseUrl: model.baseUrl || env.asrModels[index].baseUrl,
          language: model.language || env.asrModels[index].language,
        }
      }
      if (!model.apiKey && env.asrModels[0]?.apiKey) {
        return {
          ...model,
          apiKey: env.asrModels[0].apiKey,
          baseUrl: model.baseUrl || env.asrModels[0].baseUrl,
          language: model.language || env.asrModels[0].language,
        }
      }
      return model
    })

    const useEnvASR = base.asrModels.length === 1 &&
      !base.asrModels[0].apiKey &&
      base.asrModels[0].id === 'default-asr' &&
      env.asrModels.length > 0

    const mergedChatModels = useEnvChat ? env.chatModels : chatModels
    const mergedActiveChatId = useEnvChat ? env.activeChatId : base.activeChatId

    return {
      proxy,
      llmModels: useEnvLLM ? env.llmModels : llmModels,
      activeLLMId: useEnvLLM ? env.activeLLMId : base.activeLLMId,
      chatModels: mergedChatModels,
      activeChatId: mergedActiveChatId,
      activeChatModelName: normalizeActiveChatModelName(base.activeChatModelName || env.activeChatModelName, mergedChatModels, mergedActiveChatId),
      taskModels: useEnvTask ? env.taskModels : taskModels,
      activeTaskId: useEnvTask ? env.activeTaskId : base.activeTaskId,
      taskRuntime: normalizeTaskRuntimeSettings(base.taskRuntime),
      ttsModels: useEnvTTS ? env.ttsModels : ttsModels,
      activeTTSId: useEnvTTS ? env.activeTTSId : base.activeTTSId,
      asrModels: useEnvASR ? env.asrModels : asrModels,
      activeASRId: useEnvASR ? env.activeASRId : base.activeASRId
    }
  }

  getSettings(): AppSettings {
    return cloneSettings(this.settings)
  }

  async update(partial: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = normalizeSettingsPatch(this.settings, partial)
    await this.persist()
    return this.getSettings()
  }

  
  async reloadSystemConfigFromEnv(): Promise<AppSettings> {
    const envConfig = loadSystemConfigFromEnv()
    if (envConfig) {
      console.log('[SettingsStore] Reloading system config from .env')
      this.settings = {
        ...this.settings,
        system: {
          ...envConfig,
          taskRuntime: normalizeTaskRuntimeSettings(this.settings.system.taskRuntime)
        }
      }
      await this.persist()
    } else {
      console.log('[SettingsStore] No .env config found, using defaults')
      this.settings = {
        ...this.settings,
        system: {
          ...DEFAULT_SYSTEM_CONFIG,
          taskRuntime: normalizeTaskRuntimeSettings(this.settings.system.taskRuntime)
        }
      }
      await this.persist()
    }
    return this.getSettings()
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify(this.settings, null, 2)
    const write = this.persistQueue.then(() => writeFile(this.filePath, snapshot, 'utf-8'))
    this.persistQueue = write.catch(() => undefined)
    await write
  }
}

function cloneDefaultSettings(): AppSettings {
  return cloneSettings({
    ...DEFAULT_SETTINGS,
    appearance: DEFAULT_APPEARANCE_SETTINGS,
    experimental: DEFAULT_EXPERIMENTAL_SETTINGS,
    externalRolePaths: [],
    plugins: {},
    pluginConfigs: {},
    pluginPathHistory: {},
    system: DEFAULT_SYSTEM_CONFIG
  })
}

function cloneSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    appearance: { ...settings.appearance },
    experimental: { ...settings.experimental },
    externalRolePaths: [...settings.externalRolePaths],
    plugins: { ...settings.plugins },
    pluginConfigs: Object.fromEntries(
      Object.entries(settings.pluginConfigs).map(([pluginId, config]) => [pluginId, { ...config }])
    ),
    pluginPathHistory: Object.fromEntries(
      Object.entries(settings.pluginPathHistory).map(([key, history]) => [
        key,
        {
          ...history,
          recentPaths: [...history.recentPaths],
        },
      ])
    ),
    system: cloneSystemConfig(settings.system)
  }
}

function cloneSystemConfig(config: SystemConfig): SystemConfig {
  return {
    ...config,
    llmModels: config.llmModels.map(model => ({ ...model })),
    chatModels: config.chatModels.map(model => ({ ...model })),
    taskModels: config.taskModels.map(model => ({ ...model })),
    taskRuntime: {
      ...config.taskRuntime,
      extraArgs: [...config.taskRuntime.extraArgs]
    },
    ttsModels: config.ttsModels.map(model => ({
      ...model,
      extra: model.extra ? { ...model.extra } : undefined
    })),
    asrModels: config.asrModels.map(model => ({
      ...model,
      extra: model.extra ? { ...model.extra } : undefined
    }))
  }
}

function normalizeSettingsPatch(current: AppSettings, partial: Partial<AppSettings>): AppSettings {
  return {
    ...current,
    ...partial,
    language: partial.language !== undefined ? normalizeLanguage(partial.language) : current.language,
    voiceInputEnabled: typeof partial.voiceInputEnabled === 'boolean'
      ? partial.voiceInputEnabled
      : current.voiceInputEnabled,
    voiceOutputEnabled: typeof partial.voiceOutputEnabled === 'boolean'
      ? partial.voiceOutputEnabled
      : current.voiceOutputEnabled,
    volume: clampVolume(partial.volume ?? current.volume),
    appearance: normalizeAppearanceSettings(partial.appearance, current.appearance),
    experimental: normalizeExperimentalSettings(partial.experimental, current.experimental),
    selectedPersonality: partial.selectedPersonality !== undefined
      ? normalizeSelectedCharacterProfile(partial.selectedPersonality)
      : current.selectedPersonality,
    externalRolePaths: partial.externalRolePaths !== undefined
      ? normalizeExternalRolePaths(partial.externalRolePaths)
      : current.externalRolePaths,
    plugins: partial.plugins && typeof partial.plugins === 'object'
      ? partial.plugins
      : current.plugins,
    pluginConfigs: partial.pluginConfigs && typeof partial.pluginConfigs === 'object'
      ? partial.pluginConfigs
      : current.pluginConfigs,
    pluginPathHistory: partial.pluginPathHistory && typeof partial.pluginPathHistory === 'object'
      ? partial.pluginPathHistory
      : current.pluginPathHistory,
    system: partial.system ? normalizeSystemConfig(partial.system, current.system) : current.system
  }
}

function normalizeSystemConfig(value: Partial<SystemConfig>, fallback: SystemConfig): SystemConfig {
  const llmModels = Array.isArray(value.llmModels) && value.llmModels.length
    ? value.llmModels.map((model, index) => normalizeLLMModelConfig(model, fallback.llmModels[index] ?? fallback.llmModels[0], index))
    : fallback.llmModels.map((model, index) => normalizeLLMModelConfig(model, DEFAULT_SYSTEM_CONFIG.llmModels[index] ?? DEFAULT_SYSTEM_CONFIG.llmModels[0], index))
  const chatModels = Array.isArray(value.chatModels) && value.chatModels.length
    ? value.chatModels.map((model, index) => normalizeChatModelConfig(model, fallback.chatModels[index] ?? fallback.chatModels[0], index))
    : fallback.chatModels.map((model, index) => normalizeChatModelConfig(model, DEFAULT_SYSTEM_CONFIG.chatModels[index] ?? DEFAULT_SYSTEM_CONFIG.chatModels[0], index))
  const taskModels = Array.isArray(value.taskModels) && value.taskModels.length
    ? value.taskModels.map((model, index) => normalizeTaskModelConfig(model, fallback.taskModels[index] ?? fallback.taskModels[0], index))
    : fallback.taskModels.map((model, index) => normalizeTaskModelConfig(model, DEFAULT_SYSTEM_CONFIG.taskModels[index] ?? DEFAULT_SYSTEM_CONFIG.taskModels[0], index))
  const ttsModels = Array.isArray(value.ttsModels) && value.ttsModels.length
    ? value.ttsModels.map((model, index) => normalizeTTSModelConfig(model, fallback.ttsModels[index] ?? fallback.ttsModels[0], index))
    : fallback.ttsModels.map((model, index) => normalizeTTSModelConfig(model, DEFAULT_SYSTEM_CONFIG.ttsModels[index] ?? DEFAULT_SYSTEM_CONFIG.ttsModels[0], index))
  const asrModels = Array.isArray(value.asrModels) && value.asrModels.length
    ? value.asrModels.map((model, index) => normalizeASRModelConfig(model, fallback.asrModels[index] ?? fallback.asrModels[0], index))
    : fallback.asrModels.map((model, index) => normalizeASRModelConfig(model, DEFAULT_SYSTEM_CONFIG.asrModels[index] ?? DEFAULT_SYSTEM_CONFIG.asrModels[0], index))
  const activeChatId = normalizeActiveModelId(value.activeChatId, fallback.activeChatId, chatModels)

  return {
    ...fallback,
    ...value,
    proxy: typeof value.proxy === 'string' ? value.proxy : fallback.proxy,
    llmModels,
    activeLLMId: normalizeActiveModelId(value.activeLLMId, fallback.activeLLMId, llmModels),
    chatModels,
    activeChatId,
    activeChatModelName: normalizeActiveChatModelName(value.activeChatModelName, chatModels, activeChatId),
    taskModels,
    activeTaskId: normalizeActiveModelId(value.activeTaskId, fallback.activeTaskId, taskModels),
    taskRuntime: normalizeTaskRuntimeSettings(value.taskRuntime ?? fallback.taskRuntime),
    ttsModels,
    activeTTSId: normalizeActiveModelId(value.activeTTSId, fallback.activeTTSId, ttsModels),
    asrModels,
    activeASRId: normalizeActiveModelId(value.activeASRId, fallback.activeASRId, asrModels)
  }
}

function normalizeActiveModelId<T extends { id: string }>(
  value: unknown,
  fallback: string,
  models: T[]
): string {
  const preferred = typeof value === 'string' ? value : fallback
  return models.some(model => model.id === preferred) ? preferred : models[0]?.id ?? ''
}

function normalizeLLMModelConfig(value: unknown, fallback: LLMModelConfig, index: number): LLMModelConfig {
  const source = value && typeof value === 'object' ? value as Partial<LLMModelConfig> : {}
  const provider = normalizeLLMProvider(source.provider, fallback?.provider)
  const providerEntry = getLLMProviderCatalogEntry(provider)
  const transport = source.transport === 'codex_local' || source.transport === 'claude_code_local'
    ? source.transport
    : providerEntry.transport ?? 'openai_compatible'
  const modelName = transport === 'openai_compatible'
    ? typeof source.modelName === 'string'
      ? source.modelName
      : fallback?.modelName || providerEntry.defaultModel
    : ''
  return {
    id: typeof source.id === 'string' && source.id ? source.id : fallback?.id || `llm-${index + 1}`,
    provider,
    transport,
    modelName,
    apiKey: transport === 'openai_compatible' && typeof source.apiKey === 'string' ? source.apiKey : transport === 'openai_compatible' ? fallback?.apiKey || '' : '',
    baseUrl: transport === 'openai_compatible' && typeof source.baseUrl === 'string' ? source.baseUrl : transport === 'openai_compatible' ? fallback?.baseUrl || providerEntry.defaultBaseUrl : ''
  }
}

function normalizeChatModelConfig(value: unknown, fallback: ChatModelConfig, index: number): ChatModelConfig {
  const source = value && typeof value === 'object' ? value as Partial<ChatModelConfig> : {}
  const modelType = source.modelType === 'image' ? 'image' : 'llm'
  if (modelType === 'image') {
    const provider = normalizeImageProvider(source.provider, fallback?.provider)
    const providerEntry = getImageProviderCatalogEntry(provider)
    const modelName = typeof source.modelName === 'string'
      ? source.modelName
      : fallback?.modelName || providerEntry.defaultModel
    return {
      id: typeof source.id === 'string' && source.id ? source.id : fallback?.id || `chat-${index + 1}`,
      modelType,
      provider,
      modelName,
      enabledModels: normalizeChatEnabledModels(source.enabledModels, modelName),
      availableModels: normalizeStringList(source.availableModels),
      modelsFetchedAt: normalizeTimestamp(source.modelsFetchedAt),
      apiKey: typeof source.apiKey === 'string' ? source.apiKey : fallback?.apiKey || '',
      baseUrl: typeof source.baseUrl === 'string' ? source.baseUrl : fallback?.baseUrl || providerEntry.defaultBaseUrl,
    }
  }

  const provider = normalizeLLMProvider(source.provider, fallback?.provider)
  const providerEntry = getLLMProviderCatalogEntry(provider)
  const transport = source.transport === 'codex_local' || source.transport === 'claude_code_local'
    ? source.transport
    : providerEntry.transport ?? 'openai_compatible'
  const modelName = transport === 'openai_compatible'
    ? typeof source.modelName === 'string'
      ? source.modelName
      : fallback?.modelName || providerEntry.defaultModel
    : ''
  return {
    id: typeof source.id === 'string' && source.id ? source.id : fallback?.id || `chat-${index + 1}`,
    modelType,
    provider,
    transport,
    modelName,
    enabledModels: normalizeChatEnabledModels(source.enabledModels, modelName),
    availableModels: normalizeStringList(source.availableModels),
    modelsFetchedAt: normalizeTimestamp(source.modelsFetchedAt),
    apiKey: transport === 'openai_compatible' && typeof source.apiKey === 'string' ? source.apiKey : transport === 'openai_compatible' ? fallback?.apiKey || '' : '',
    baseUrl: transport === 'openai_compatible' && typeof source.baseUrl === 'string' ? source.baseUrl : transport === 'openai_compatible' ? fallback?.baseUrl || providerEntry.defaultBaseUrl : '',
  }
}

function normalizeStringList(value: unknown): string[] {
  const list = Array.isArray(value)
    ? value
      .map(item => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean)
    : []
  const unique = [...new Set(list)]
  if (unique.length > 0) {
    return unique
  }
  return []
}

function normalizeChatEnabledModels(value: unknown, modelName: string): string[] {
  const enabledModels = normalizeStringList(value)
  if (enabledModels.length > 0) {
    return enabledModels
  }
  const current = modelName.trim()
  return current ? [current] : []
}

function normalizeActiveChatModelName(value: unknown, models: ChatModelConfig[], activeChatId: unknown): string {
  const activeApiId = typeof activeChatId === 'string' ? activeChatId : ''
  const activeApi = models.find(model => model.id === activeApiId) ?? models[0]
  const enabledModels = normalizeStringList(activeApi?.enabledModels)
  const preferred = typeof value === 'string' ? value.trim() : ''
  return preferred && enabledModels.includes(preferred) ? preferred : enabledModels[0] ?? ''
}

function normalizeTimestamp(value: unknown): number | undefined {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : undefined
}

function normalizeTaskModelConfig(value: unknown, fallback: LLMModelConfig, index: number): LLMModelConfig {
  const model = normalizeLLMModelConfig(value, fallback, index)
  const source = value && typeof value === 'object' ? value as Partial<LLMModelConfig> : {}
  const transport = source.transport === 'codex_local' || source.transport === 'claude_code_local'
    ? source.transport
    : model.transport ?? 'openai_compatible'
  return {
    ...model,
    transport,
    modelName: transport === 'openai_compatible'
      ? model.modelName || 'gemini-3.1-pro-preview'
      : model.modelName,
    baseUrl: transport === 'openai_compatible'
      ? model.baseUrl
      : model.baseUrl
  }
}

function normalizeTTSModelConfig(value: unknown, fallback: TTSModelConfig, index: number): TTSModelConfig {
  const source = value && typeof value === 'object' ? value as Partial<TTSModelConfig> : {}
  const provider = normalizeTTSProvider(source.provider, fallback?.provider)
  const providerEntry = getTTSProviderCatalogEntry(provider)
  const baseUrl = normalizeTTSBaseUrl(provider, source.baseUrl)

  return {
    id: typeof source.id === 'string' && source.id ? source.id : fallback?.id || `tts-${index + 1}`,
    provider,
    modelName: typeof source.modelName === 'string' && source.modelName.trim()
      ? source.modelName
      : providerEntry.defaultModel,
    apiKey: typeof source.apiKey === 'string' ? source.apiKey : fallback?.apiKey || '',
    voiceId: typeof source.voiceId === 'string'
      ? source.voiceId
      : providerEntry.defaultVoiceId || '',
    baseUrl,
    language: typeof source.language === 'string' && source.language.trim()
      ? source.language
      : providerEntry.defaultLanguage,
    format: source.format === 'mp3' || source.format === 'opus' ? source.format : 'pcm',
    sampleRate: clampInteger(source.sampleRate, providerEntry.sampleRate, 8000, 48000),
    extra: source.extra && typeof source.extra === 'object' ? { ...source.extra } : undefined
  }
}

function normalizeASRModelConfig(value: unknown, fallback: ASRModelConfig, index: number): ASRModelConfig {
  const source = value && typeof value === 'object' ? value as Partial<ASRModelConfig> : {}
  const provider = normalizeASRProvider(source.provider, fallback?.provider)
  const providerEntry = getASRProviderCatalogEntry(provider)
  const sourceBaseUrl = typeof source.baseUrl === 'string' && source.baseUrl.trim()
    ? source.baseUrl
    : ''
  const baseUrl = normalizeASRBaseUrl(provider, sourceBaseUrl)

  return {
    id: typeof source.id === 'string' && source.id ? source.id : fallback?.id || `asr-${index + 1}`,
    provider,
    modelName: typeof source.modelName === 'string' && source.modelName.trim()
      ? source.modelName
      : providerEntry.defaultModel,
    apiKey: typeof source.apiKey === 'string' ? source.apiKey : fallback?.apiKey || '',
    baseUrl,
    language: typeof source.language === 'string' && source.language.trim()
      ? source.language
      : providerEntry.defaultLanguage,
    sampleRate: clampInteger(source.sampleRate, providerEntry.sampleRate, 8000, 48000),
    extra: source.extra && typeof source.extra === 'object' ? { ...source.extra } : undefined
  }
}

function normalizeLLMProvider(value: unknown, fallback: unknown): LLMProviderType {
  const candidate = typeof value === 'string' ? value : fallback
  return getLLMProviderCatalogEntry(typeof candidate === 'string' ? candidate : undefined).value
}

function normalizeImageProvider(value: unknown, fallback: unknown): ImageProviderType {
  const candidate = typeof value === 'string' ? value : fallback
  return getImageProviderCatalogEntry(typeof candidate === 'string' ? candidate : undefined).value
}

function normalizeTTSProvider(value: unknown, fallback: unknown): TTSProviderType {
  const candidate = typeof value === 'string' ? value : fallback
  return getTTSProviderCatalogEntry(typeof candidate === 'string' ? candidate : undefined).value
}

function normalizeASRProvider(value: unknown, fallback: unknown): ASRProviderType {
  const candidate = typeof value === 'string' ? value : fallback
  return getASRProviderCatalogEntry(typeof candidate === 'string' ? candidate : undefined).value
}

function normalizeTTSBaseUrl(provider: TTSProviderType, value: unknown): string {
  const providerEntry = getTTSProviderCatalogEntry(provider)
  const baseUrl = typeof value === 'string' ? value.trim() : ''
  if (provider === 'fish') {
    return providerEntry.defaultBaseUrl
  }
  if (!baseUrl) {
    return providerEntry.defaultBaseUrl
  }
  if (provider === 'elevenlabs' && baseUrl.includes('api.openai.com')) {
    return providerEntry.defaultBaseUrl
  }
  return baseUrl
}

function normalizeASRBaseUrl(provider: ASRProviderType, value: unknown): string {
  const providerEntry = getASRProviderCatalogEntry(provider)
  const baseUrl = typeof value === 'string' ? value.trim() : ''
  if (!baseUrl) {
    return providerEntry.defaultBaseUrl
  }
  if (provider === 'qwen') {
    return baseUrl.startsWith('ws://') || baseUrl.startsWith('wss://')
      ? baseUrl
      : providerEntry.defaultBaseUrl
  }
  if ((provider === 'openai' || provider === 'openai-compatible' || provider === 'azure-openai') && baseUrl.startsWith('wss://')) {
    return providerEntry.defaultBaseUrl
  }
  if (provider === 'groq' && (baseUrl.startsWith('wss://') || baseUrl.includes('api.openai.com'))) {
    return providerEntry.defaultBaseUrl
  }
  return baseUrl
}

function normalizeSelectedCharacterProfile(value: unknown): string {
  const ref = typeof value === 'string' ? value.trim() : ''
  if (!ref) {
    return ''
  }
  if (ref.startsWith('chat:') || (ref.startsWith('file:') && ref.toLowerCase().endsWith('.json'))) {
    return ref
  }
  return DEFAULT_SELECTED_CHARACTER_PROFILE
}

function normalizeExternalRolePaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => item.toLowerCase().endsWith('.json')))]
}

function normalizeLanguage(value: unknown): AppSettings['language'] {
  return value === 'en-US' ? 'en-US' : 'zh-CN'
}

function normalizeAppearanceSettings(value: unknown, fallback: AppearanceSettings = DEFAULT_APPEARANCE_SETTINGS): AppearanceSettings {
  const source = value && typeof value === 'object'
    ? value as Partial<AppearanceSettings>
    : {}
  return {
    orbStyle: source.orbStyle === 'default' || source.orbStyle === 'advanced' || source.orbStyle === 'planet'
      ? source.orbStyle
      : fallback.orbStyle,
    theme: source.theme === 'day' || source.theme === 'night' ? source.theme : fallback.theme,
    liquidGlassEnabled: typeof source.liquidGlassEnabled === 'boolean'
      ? source.liquidGlassEnabled
      : fallback.liquidGlassEnabled,
    dragonCursorEnabled: typeof source.dragonCursorEnabled === 'boolean'
      ? source.dragonCursorEnabled
      : fallback.dragonCursorEnabled
  }
}

function normalizeExperimentalSettings(
  value: unknown,
  fallback: ExperimentalSettings = DEFAULT_EXPERIMENTAL_SETTINGS
): ExperimentalSettings {
  const source = value && typeof value === 'object'
    ? value as Partial<ExperimentalSettings>
    : {}
  return {
    selfLearningEnabled: typeof source.selfLearningEnabled === 'boolean'
      ? source.selfLearningEnabled
      : fallback.selfLearningEnabled
  }
}

function clampVolume(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.round(numeric)))
}

function normalizeTaskRuntimeSettings(value: unknown): TaskRuntimeSettings {
  const source = value && typeof value === 'object'
    ? value as Partial<TaskRuntimeSettings>
    : {}
  const maxTurns = clampInteger(source.maxTurns, DEFAULT_TASK_RUNTIME_SETTINGS.maxTurns, 4, 100)
  const modelContextWindow = clampInteger(
    source.modelContextWindow,
    DEFAULT_TASK_RUNTIME_SETTINGS.modelContextWindow,
    4096,
    1000000
  )
  const autoCompactTokenLimit = Math.min(
    clampInteger(
      source.autoCompactTokenLimit,
      Math.floor(modelContextWindow * 0.9),
      1000,
      modelContextWindow
    ),
    Math.floor(modelContextWindow * 0.9)
  )
  const keepRecentTurns = clampInteger(
    source.keepRecentTurns,
    DEFAULT_TASK_RUNTIME_SETTINGS.keepRecentTurns,
    1,
    maxTurns
  )

  return {
    adapterId: typeof source.adapterId === 'string' && source.adapterId.trim()
      ? source.adapterId.trim()
      : DEFAULT_TASK_RUNTIME_SETTINGS.adapterId,
    maxTurns,
    modelContextWindow,
    autoCompactTokenLimit,
    keepRecentTurns,
    cwd: typeof source.cwd === 'string' ? source.cwd : '',
    timeoutMs: clampInteger(source.timeoutMs, DEFAULT_TASK_RUNTIME_SETTINGS.timeoutMs, 1000, 24 * 60 * 60 * 1000),
    command: typeof source.command === 'string' ? source.command : '',
    model: typeof source.model === 'string' ? source.model : '',
    extraArgs: Array.isArray(source.extraArgs)
      ? source.extraArgs.filter((value): value is string => typeof value === 'string')
      : []
  }
}
