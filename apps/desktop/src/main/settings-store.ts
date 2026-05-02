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

    if (provider || apiKey) {
      ttsModels.push({
        id: `env-tts-${i}`,
        provider: provider || 'fish',
        modelName: modelName || 's2-pro',
        apiKey: apiKey || '',
        voiceId: voiceId || ''
      })
    }
  }

  const asrModels: ASRModelConfig[] = []
  for (let i = 1; i <= 10; i++) {
    const provider = env[`ASR_${i}_PROVIDER`] as ASRProviderType | undefined
    const modelName = env[`ASR_${i}_MODEL`]
    const apiKey = env[`ASR_${i}_API_KEY`]

    if (provider || apiKey) {
      asrModels.push({
        id: `env-asr-${i}`,
        provider: provider || 'qwen',
        modelName: modelName || 'qwen3-asr-flash-realtime',
        apiKey: apiKey || ''
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
    ttsModels: ttsModels.length > 0 ? ttsModels : [],
    activeTTSId: ttsModels[ttsActive]?.id || ttsModels[0]?.id || '',
    asrModels: asrModels.length > 0 ? asrModels : [],
    activeASRId: asrModels[asrActive]?.id || asrModels[0]?.id || ''
  }
}


export interface LLMModelConfig {
  id: string
  modelName: string
  apiKey: string
  baseUrl: string
}


export type TTSProviderType = 'fish'


export interface TTSModelConfig {
  id: string
  provider: TTSProviderType
  modelName: string
  apiKey: string
  voiceId?: string
}


export type ASRProviderType = 'qwen'


export interface ASRModelConfig {
  id: string
  provider: ASRProviderType
  modelName: string
  apiKey: string
}


export interface SystemConfig {
  proxy: string
  llmModels: LLMModelConfig[]
  activeLLMId: string
  taskModels: LLMModelConfig[]
  activeTaskId: string
  ttsModels: TTSModelConfig[]
  activeTTSId: string
  asrModels: ASRModelConfig[]
  activeASRId: string
}

export interface AppSettings {
  voiceInputEnabled: boolean
  voiceOutputEnabled: boolean
  volume: number
  selectedPersonality: string
  externalRolePaths: string[]
  plugins: Record<string, boolean>
  pluginConfigs: Record<string, Record<string, unknown>>
  system: SystemConfig
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
  ttsModels: [{
    id: 'default-tts',
    provider: 'fish',
    modelName: 's2-pro',
    apiKey: '',
    voiceId: ''
  }],
  activeTTSId: 'default-tts',
  asrModels: [{
    id: 'default-asr',
    provider: 'qwen',
    modelName: 'qwen3-asr-flash-realtime',
    apiKey: ''
  }],
  activeASRId: 'default-asr'
}

const DEFAULT_SETTINGS: AppSettings = {
  voiceInputEnabled: true,
  voiceOutputEnabled: true,
  volume: 70,
  selectedPersonality: 'role:eva',
  externalRolePaths: [],
  plugins: {},
  pluginConfigs: {},
  system: DEFAULT_SYSTEM_CONFIG
}

export class SettingsStore {
  private settings: AppSettings = { ...DEFAULT_SETTINGS }
  private filePath: string

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
          ...DEFAULT_SETTINGS,
          system: this.mergeSystemConfig(DEFAULT_SYSTEM_CONFIG, envConfig)
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

      this.settings = {
        ...DEFAULT_SETTINGS,
        ...parsed,
        externalRolePaths: Array.isArray(parsed.externalRolePaths) ? parsed.externalRolePaths : [],
        plugins: parsed.plugins && typeof parsed.plugins === 'object' ? parsed.plugins : {},
        pluginConfigs: parsed.pluginConfigs && typeof parsed.pluginConfigs === 'object' ? parsed.pluginConfigs : {},
        volume: clampVolume(parsed.volume ?? DEFAULT_SETTINGS.volume),
        system: systemConfig
      }
    } catch (error) {
      console.warn('[SettingsStore] Failed to load settings, using defaults:', error)
      const envConfig = loadSystemConfigFromEnv()
      if (envConfig) {
        this.settings = {
          ...DEFAULT_SETTINGS,
          system: this.mergeSystemConfig(DEFAULT_SYSTEM_CONFIG, envConfig)
        }
      } else {
        this.settings = { ...DEFAULT_SETTINGS }
      }
      await this.persist()
    }
  }

  
  private hasEmptyApiKeys(config: SystemConfig): boolean {
    const llmEmpty = config.llmModels.some(m => !m.apiKey)
    const taskEmpty = config.taskModels.some(m => !m.apiKey)
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
        return { ...model, apiKey: env.ttsModels[index].apiKey }
      }
      if (!model.apiKey && env.ttsModels[0]?.apiKey) {
        return { ...model, apiKey: env.ttsModels[0].apiKey }
      }
      return model
    })

    const useEnvTTS = base.ttsModels.length === 1 &&
      !base.ttsModels[0].apiKey &&
      base.ttsModels[0].id === 'default-tts' &&
      env.ttsModels.length > 0

    const asrModels = base.asrModels.map((model, index) => {
      if (!model.apiKey && env.asrModels[index]?.apiKey) {
        return { ...model, apiKey: env.asrModels[index].apiKey }
      }
      if (!model.apiKey && env.asrModels[0]?.apiKey) {
        return { ...model, apiKey: env.asrModels[0].apiKey }
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
      ttsModels: useEnvTTS ? env.ttsModels : ttsModels,
      activeTTSId: useEnvTTS ? env.activeTTSId : base.activeTTSId,
      asrModels: useEnvASR ? env.asrModels : asrModels,
      activeASRId: useEnvASR ? env.activeASRId : base.activeASRId
    }
  }

  getSettings(): AppSettings {
    return { ...this.settings }
  }

  async update(partial: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = {
      ...this.settings,
      ...partial,
      volume: clampVolume(partial.volume ?? this.settings.volume)
    }
    await this.persist()
    return this.getSettings()
  }

  
  async reloadSystemConfigFromEnv(): Promise<AppSettings> {
    const envConfig = loadSystemConfigFromEnv()
    if (envConfig) {
      console.log('[SettingsStore] Reloading system config from .env')
      this.settings = {
        ...this.settings,
        system: envConfig
      }
      await this.persist()
    } else {
      console.log('[SettingsStore] No .env config found, using defaults')
      this.settings = {
        ...this.settings,
        system: DEFAULT_SYSTEM_CONFIG
      }
      await this.persist()
    }
    return this.getSettings()
  }

  private async persist(): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(this.settings, null, 2), 'utf-8')
  }
}

function clampVolume(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}
