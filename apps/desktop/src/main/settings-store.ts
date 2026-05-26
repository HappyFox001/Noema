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
  getTTSProviderCatalogEntry,
  type ASRProviderType,
  type TTSProviderType,
} from './model-provider-catalog.js'


function loadSystemConfigFromEnv(): SystemConfig | null {
  const env = process.env

  const hasEnvConfig = Object.keys(env).some(key =>
    key.startsWith('LLM_') ||
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

    if (modelName || apiKey || baseUrl) {
      taskModels.push({
        id: `env-task-${i}`,
        modelName: modelName || 'gemini-3.1-pro-preview',
        apiKey: apiKey || '',
        baseUrl: baseUrl || ''
      })
    }
  }

  const llmModels: LLMModelConfig[] = []
  for (let i = 1; i <= 10; i++) {
    const modelName = env[`LLM_${i}_MODEL`]
    const apiKey = env[`LLM_${i}_API_KEY`]
    const baseUrl = env[`LLM_${i}_BASE_URL`]

    if (modelName || apiKey) {
      llmModels.push({
        id: `env-llm-${i}`,
        modelName: modelName || '',
        apiKey: apiKey || '',
        baseUrl: baseUrl || ''
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
  const taskActive = parseInt(env['TASK_ACTIVE'] || '1', 10) - 1
  const ttsActive = parseInt(env['TTS_ACTIVE'] || '1', 10) - 1
  const asrActive = parseInt(env['ASR_ACTIVE'] || '1', 10) - 1

  return {
    proxy: env['PROXY_URL'] || env['HTTPS_PROXY'] || env['HTTP_PROXY'] || '',
    llmModels: llmModels.length > 0 ? llmModels : [],
    activeLLMId: llmModels[llmActive]?.id || llmModels[0]?.id || '',
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
  transport?: 'openai_compatible' | 'codex_local' | 'claude_code_local'
  modelName: string
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
}

export interface ExperimentalSettings {
  selfLearningEnabled: boolean
}

const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  orbStyle: 'default',
  theme: 'night',
  liquidGlassEnabled: true
}

const DEFAULT_EXPERIMENTAL_SETTINGS: ExperimentalSettings = {
  selfLearningEnabled: true
}

const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  proxy: '',
  llmModels: [{
    id: 'default-llm',
    modelName: '',
    apiKey: '',
    baseUrl: ''
  }],
  activeLLMId: 'default-llm',
  taskModels: [{
    id: 'default-task',
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
  selectedPersonality: 'role:eva',
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
        externalRolePaths: Array.isArray(parsed.externalRolePaths) ? parsed.externalRolePaths : [],
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
    const taskEmpty = config.taskModels.some(m => (m.transport ?? 'openai_compatible') === 'openai_compatible' && !m.apiKey)
    const ttsEmpty = config.ttsModels.some(m => !m.apiKey)
    const asrEmpty = config.asrModels.some(m => !m.apiKey)
    return llmEmpty || taskEmpty || ttsEmpty || asrEmpty
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

    return {
      proxy,
      llmModels: useEnvLLM ? env.llmModels : llmModels,
      activeLLMId: useEnvLLM ? env.activeLLMId : base.activeLLMId,
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
    externalRolePaths: Array.isArray(partial.externalRolePaths)
      ? partial.externalRolePaths
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
  const taskModels = Array.isArray(value.taskModels) && value.taskModels.length
    ? value.taskModels.map((model, index) => normalizeTaskModelConfig(model, fallback.taskModels[index] ?? fallback.taskModels[0], index))
    : fallback.taskModels.map((model, index) => normalizeTaskModelConfig(model, DEFAULT_SYSTEM_CONFIG.taskModels[index] ?? DEFAULT_SYSTEM_CONFIG.taskModels[0], index))
  const ttsModels = Array.isArray(value.ttsModels) && value.ttsModels.length
    ? value.ttsModels.map((model, index) => normalizeTTSModelConfig(model, fallback.ttsModels[index] ?? fallback.ttsModels[0], index))
    : fallback.ttsModels.map((model, index) => normalizeTTSModelConfig(model, DEFAULT_SYSTEM_CONFIG.ttsModels[index] ?? DEFAULT_SYSTEM_CONFIG.ttsModels[0], index))
  const asrModels = Array.isArray(value.asrModels) && value.asrModels.length
    ? value.asrModels.map((model, index) => normalizeASRModelConfig(model, fallback.asrModels[index] ?? fallback.asrModels[0], index))
    : fallback.asrModels.map((model, index) => normalizeASRModelConfig(model, DEFAULT_SYSTEM_CONFIG.asrModels[index] ?? DEFAULT_SYSTEM_CONFIG.asrModels[0], index))

  return {
    ...fallback,
    ...value,
    proxy: typeof value.proxy === 'string' ? value.proxy : fallback.proxy,
    llmModels,
    activeLLMId: normalizeActiveModelId(value.activeLLMId, fallback.activeLLMId, llmModels),
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
  return {
    id: typeof source.id === 'string' && source.id ? source.id : fallback?.id || `llm-${index + 1}`,
    modelName: typeof source.modelName === 'string' ? source.modelName : fallback?.modelName || '',
    apiKey: typeof source.apiKey === 'string' ? source.apiKey : fallback?.apiKey || '',
    baseUrl: typeof source.baseUrl === 'string' ? source.baseUrl : fallback?.baseUrl || ''
  }
}

function normalizeTaskModelConfig(value: unknown, fallback: LLMModelConfig, index: number): LLMModelConfig {
  const model = normalizeLLMModelConfig(value, fallback, index)
  const source = value && typeof value === 'object' ? value as Partial<LLMModelConfig> : {}
  const transport = source.transport === 'codex_local' || source.transport === 'claude_code_local'
    ? source.transport
    : 'openai_compatible'
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
  const provider = source.provider === 'openai' || source.provider === 'elevenlabs' || source.provider === 'fish'
    ? source.provider
    : fallback?.provider || 'fish'
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
  const provider = source.provider === 'openai' || source.provider === 'groq' || source.provider === 'qwen'
    ? source.provider
    : fallback?.provider || 'qwen'
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

function normalizeTTSBaseUrl(provider: TTSProviderType, value: unknown): string {
  const providerEntry = getTTSProviderCatalogEntry(provider)
  const baseUrl = typeof value === 'string' ? value.trim() : ''
  if (provider === 'fish') {
    return providerEntry.defaultBaseUrl
  }
  if (!baseUrl) {
    return providerEntry.defaultBaseUrl
  }
  if (provider === 'openai' && baseUrl.includes('api.elevenlabs.io')) {
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
  if (provider === 'openai' && baseUrl.startsWith('wss://')) {
    return providerEntry.defaultBaseUrl
  }
  if (provider === 'groq' && (baseUrl.startsWith('wss://') || baseUrl.includes('api.openai.com'))) {
    return providerEntry.defaultBaseUrl
  }
  return baseUrl
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
      : fallback.liquidGlassEnabled
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
