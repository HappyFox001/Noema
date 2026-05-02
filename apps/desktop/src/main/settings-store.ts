import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'

/**
 * 从 .env 读取系统配置
 * 支持多模型配置，格式如下：
 *
 * PROXY_URL=http://127.0.0.1:7890
 *
 * LLM_1_NAME=GPT-4
 * LLM_1_API_KEY=sk-xxx
 * LLM_1_BASE_URL=https://api.openai.com/v1
 * LLM_ACTIVE=1
 *
 * TASK_1_MODEL=gemini-3.1-pro-preview
 * TASK_1_API_KEY=sk-xxx
 * TASK_1_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
 * TASK_ACTIVE=1
 *
 * TTS_1_NAME=Fish Audio
 * TTS_1_API_KEY=xxx
 * TTS_ACTIVE=1
 *
 * ASR_1_MODEL=qwen3-asr-flash-realtime
 * ASR_1_API_KEY=xxx
 * ASR_ACTIVE=1
 */
function loadSystemConfigFromEnv(): SystemConfig | null {
  const env = process.env

  // 检查是否有任何相关的环境变量
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

  // 解析任务模型
  // 格式: TASK_1_MODEL, TASK_1_API_KEY, TASK_1_BASE_URL
  // API Key / Base URL 为空时复用同序号 LLM 配置，便于同一供应商下只切任务模型名。
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

  // 解析 LLM 模型
  // 格式: LLM_1_MODEL, LLM_1_API_KEY, LLM_1_BASE_URL
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

  // 解析 TTS 模型
  // 格式: TTS_1_PROVIDER, TTS_1_MODEL, TTS_1_API_KEY, TTS_1_VOICE_ID
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

  // 解析 ASR 模型
  // 格式: ASR_1_PROVIDER, ASR_1_MODEL, ASR_1_API_KEY
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

  // 获取激活的模型索引
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

/** LLM 模型配置 */
export interface LLMModelConfig {
  id: string
  modelName: string   // 模型名称，如 deepseek-chat, gpt-4（也是 API 参数）
  apiKey: string
  baseUrl: string
}

/** TTS Provider 类型 */
export type TTSProviderType = 'fish'

/** TTS 模型配置 */
export interface TTSModelConfig {
  id: string
  provider: TTSProviderType  // Provider 类型
  modelName: string          // 模型名称，如 s2-pro
  apiKey: string
  voiceId?: string           // Fish Audio 的音色 ID
}

/** ASR Provider 类型 */
export type ASRProviderType = 'qwen'

/** ASR 模型配置 */
export interface ASRModelConfig {
  id: string
  provider: ASRProviderType  // Provider 类型
  modelName: string          // 模型名称，如 qwen3-asr-flash-realtime
  apiKey: string
}

/** 系统配置 */
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
      // 首次运行，尝试从 .env 读取配置
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

      // 检查是否需要从 .env 填充空的 API Key
      let systemConfig: SystemConfig = {
        ...DEFAULT_SYSTEM_CONFIG,
        ...(parsed.system ?? {}),
        llmModels: parsed.system?.llmModels?.length ? parsed.system.llmModels : DEFAULT_SYSTEM_CONFIG.llmModels,
        taskModels: parsed.system?.taskModels?.length ? parsed.system.taskModels : DEFAULT_SYSTEM_CONFIG.taskModels,
        ttsModels: parsed.system?.ttsModels?.length ? parsed.system.ttsModels : DEFAULT_SYSTEM_CONFIG.ttsModels,
        asrModels: parsed.system?.asrModels?.length ? parsed.system.asrModels : DEFAULT_SYSTEM_CONFIG.asrModels,
      }

      // 如果配置中的 API Key 为空，尝试从 .env 填充
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
      // 尝试从 .env 读取
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

  /**
   * 检查系统配置中是否有空的 API Key
   */
  private hasEmptyApiKeys(config: SystemConfig): boolean {
    const llmEmpty = config.llmModels.some(m => !m.apiKey)
    const taskEmpty = config.taskModels.some(m => !m.apiKey)
    const ttsEmpty = config.ttsModels.some(m => !m.apiKey)
    const asrEmpty = config.asrModels.some(m => !m.apiKey)
    return llmEmpty || taskEmpty || ttsEmpty || asrEmpty
  }

  /**
   * 合并系统配置，.env 配置填充空值
   */
  private mergeSystemConfig(base: SystemConfig, env: SystemConfig): SystemConfig {
    // Proxy: 如果 base 为空，使用 env
    const proxy = base.proxy || env.proxy

    // LLM: 如果 base 的 API Key 为空，尝试从 env 找到对应的填充
    const llmModels = base.llmModels.map((model, index) => {
      if (!model.apiKey && env.llmModels[index]?.apiKey) {
        return { ...model, apiKey: env.llmModels[index].apiKey }
      }
      if (!model.apiKey && env.llmModels[0]?.apiKey) {
        return { ...model, apiKey: env.llmModels[0].apiKey }
      }
      return model
    })

    // 如果 base 只有空的默认配置，且 env 有配置，使用 env 的
    const useEnvLLM = base.llmModels.length === 1 &&
      !base.llmModels[0].apiKey &&
      base.llmModels[0].id === 'default-llm' &&
      env.llmModels.length > 0

    // Task LLM: 如果 base 的 API Key 为空，尝试从 TASK env 找到对应的填充。
    // TASK env 未单独提供凭据时，loadSystemConfigFromEnv 已经会复用同序号 LLM 凭据。
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

    // TTS: 同上
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

    // ASR: 同上
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

  /**
   * 从 .env 重新加载系统配置
   */
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
