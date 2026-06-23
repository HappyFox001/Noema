/**
 * IPC handlers and utilities for local model status and provider connection tests.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import { type IpcMain } from 'electron'
import { createSTTProvider, type STTProvider } from '@noema/sdk'
import { type ASRModelConfig, type LLMModelConfig, type TTSModelConfig } from './settings-store.js'
import {
  getLLMProviderCatalogEntry,
  getASRProviderCatalogEntry,
  getTTSProviderCatalogEntry,
} from './model-provider-catalog.js'
import {
  createTTSProviderForConfig,
  LOW_LATENCY_VOICE_CONFIG,
} from './voice-runtime-controller.js'
import {
  normalizeASRModelName,
  normalizeQwenRealtimeUrl,
} from './asr-provider-factory.js'
import { downloadMissingLocalModels, getLocalModelStatuses } from './local-models.js'
import { NodeRealtimeWebSocketTransport } from './qwen-websocket-transport.js'
import { ReconnectingWebSocketTransport } from './reconnecting-websocket-transport.js'

const execFileAsync = promisify(execFile)

type ApiModelTestKind = 'llm' | 'task' | 'tts' | 'asr'

export function registerModelIpcHandlers(
  ipcMain: IpcMain,
  options: {
    resetLocalAnalyzers(): void
  }
): void {
  ipcMain.handle('models:localStatus', async () => {
    try {
      return {
        success: true,
        models: await getLocalModelStatuses(),
      }
    } catch (error: any) {
      return { success: false, error: error.message, models: [] }
    }
  })

  ipcMain.handle('models:downloadMissing', async () => {
    try {
      return {
        success: true,
        models: await downloadMissingLocalModels(options.resetLocalAnalyzers),
      }
    } catch (error: any) {
      return { success: false, error: error.message, models: [] }
    }
  })

  ipcMain.handle('models:testApi', async (_event, kind: ApiModelTestKind, model: unknown) => {
    try {
      await testApiModel(kind, model)
      return { success: true, message: '连接正常' }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
}

async function testApiModel(kind: ApiModelTestKind, model: unknown): Promise<void> {
  switch (kind) {
    case 'llm':
      await testOpenAICompatibleModel(readLLMTestConfig(model))
      return
    case 'task':
      await testTaskModel(model)
      return
    case 'tts':
      await testFishTTSModel(readTTSTestConfig(model))
      return
    case 'asr':
      await testQwenASRModel(readASRTestConfig(model))
      return
  }
}

async function testTaskModel(model: unknown): Promise<void> {
  const transport = readTaskTransport(model)
  if (transport === 'openai_compatible') {
    await testOpenAICompatibleModel(readLLMTestConfig(model))
    return
  }

  const command = transport === 'claude_code_local' ? 'claude' : 'codex'
  await execFileAsync(command, ['--version'], { timeout: 5000 })
}

function readTaskTransport(model: unknown): 'openai_compatible' | 'codex_local' | 'claude_code_local' {
  const value = model as Partial<LLMModelConfig>
  return value.transport === 'codex_local' || value.transport === 'claude_code_local'
    ? value.transport
    : 'openai_compatible'
}

function readLLMTestConfig(model: unknown): LLMModelConfig {
  const value = model as Partial<LLMModelConfig>
  const provider = getLLMProviderCatalogEntry(String(value.provider ?? 'openai-compatible')).value
  const modelName = String(value.modelName ?? '').trim()
  const apiKey = String(value.apiKey ?? '').trim()
  const baseUrl = String(value.baseUrl ?? '').trim().replace(/\/+$/, '')

  if (!modelName) {
    throw new Error('Model name is required')
  }
  if (!apiKey) {
    throw new Error('API Key is required')
  }
  if (!baseUrl) {
    throw new Error('Base URL is required')
  }

  return {
    id: String(value.id ?? 'test'),
    provider,
    modelName,
    apiKey,
    baseUrl,
  }
}

function readTTSTestConfig(model: unknown): TTSModelConfig {
  const value = model as Partial<TTSModelConfig>
  const provider = getTTSProviderCatalogEntry(String(value.provider ?? 'fish')).value
  const modelName = String(value.modelName ?? '').trim()
  const apiKey = String(value.apiKey ?? '').trim()
  const voiceId = String(value.voiceId ?? '').trim()
  const baseUrl = String(value.baseUrl ?? '').trim().replace(/\/+$/, '')
  const language = String(value.language ?? '').trim()

  if (!modelName) {
    throw new Error('TTS model name is required')
  }
  if (!apiKey) {
    throw new Error('TTS API Key is required')
  }

  return {
    id: String(value.id ?? 'test'),
    provider,
    modelName,
    apiKey,
    voiceId,
    baseUrl,
    language,
    sampleRate: Number(value.sampleRate) || 16000,
  }
}

function readASRTestConfig(model: unknown): ASRModelConfig {
  const value = model as Partial<ASRModelConfig>
  const provider = getASRProviderCatalogEntry(String(value.provider ?? 'qwen')).value
  const modelName = String(value.modelName ?? '').trim()
  const apiKey = String(value.apiKey ?? '').trim()
  const baseUrl = String(value.baseUrl ?? '').trim().replace(/\/+$/, '')
  const language = String(value.language ?? '').trim()

  if (!modelName) {
    throw new Error('ASR model name is required')
  }
  if (!apiKey) {
    throw new Error('ASR API Key is required')
  }

  return {
    id: String(value.id ?? 'test'),
    provider,
    modelName,
    apiKey,
    baseUrl,
    language,
    sampleRate: Number(value.sampleRate) || 16000,
  }
}

function createASRProviderForConfig(config: ASRModelConfig): STTProvider {
  if (!config.apiKey?.trim()) {
    throw new Error('ASR API key is not configured')
  }

  const providerEntry = getASRProviderCatalogEntry(config.provider)
  if (!providerEntry.implemented) {
    throw new Error(`${providerEntry.label} ASR is listed in the catalog but is not implemented in the runtime yet`)
  }

  if (providerEntry.protocol === 'openai-transcription') {
    return createSTTProvider({
      kind: 'openai-transcription',
      config: {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl || providerEntry.defaultBaseUrl,
        model: config.modelName || providerEntry.defaultModel,
        sampleRate: config.sampleRate || providerEntry.sampleRate,
        language: config.language?.trim() || undefined,
        receiveTimeoutMs: 20000,
      },
    })
  }

  if (providerEntry.protocol !== 'qwen-realtime') {
    throw new Error(`Unsupported ASR provider protocol: ${providerEntry.protocol}`)
  }

  const baseTransport = new NodeRealtimeWebSocketTransport()
  const reconnectingTransport = new ReconnectingWebSocketTransport(baseTransport, {
    maxRetries: 0,
    initialRetryDelayMs: 500,
    maxRetryDelayMs: 16000,
  })

  return createSTTProvider({
    kind: 'qwen-realtime',
    config: {
      apiKey: config.apiKey,
      url: normalizeQwenRealtimeUrl(config.baseUrl),
      model: normalizeASRModelName(config.modelName),
      sampleRate: config.sampleRate || providerEntry.sampleRate,
      language: config.language?.trim() || providerEntry.defaultLanguage,
      receiveTimeoutMs: 5000,
      fallbackTranscriptCommitGraceMs: LOW_LATENCY_VOICE_CONFIG.asrFallbackCommitGraceMs,
    },
    transport: reconnectingTransport,
  })
}

async function testOpenAICompatibleModel(model: LLMModelConfig): Promise<void> {
  const providerEntry = getLLMProviderCatalogEntry(model.provider)
  if (providerEntry.protocol === 'anthropic-messages') {
    await testAnthropicMessagesModel(model)
    return
  }
  if (providerEntry.protocol !== 'openai-chat-completions') {
    throw new Error(`${providerEntry.label} LLM is listed in the catalog but is not implemented in API testing yet`)
  }

  const response = await runWithTimeout(
    fetch(`${model.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${model.apiKey}`,
      },
      body: JSON.stringify({
        model: model.modelName,
        max_tokens: 8,
        messages: [
          { role: 'user', content: 'Reply with exactly: OK' },
        ],
      }),
    }),
    20000,
    'LLM connection test timed out'
  )

  const bodyText = await response.text()
  let body: any = null
  try {
    body = JSON.parse(bodyText)
  } catch {
    body = null
  }

  if (!response.ok) {
    throw new Error(body?.error?.message || bodyText.slice(0, 300) || `HTTP ${response.status}`)
  }

  const content = body?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('Model response did not contain a chat completion message')
  }
}

async function testAnthropicMessagesModel(model: LLMModelConfig): Promise<void> {
  const response = await runWithTimeout(
    fetch(`${model.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': model.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model.modelName,
        max_tokens: 8,
        messages: [
          { role: 'user', content: 'Reply with exactly: OK' },
        ],
      }),
    }),
    20000,
    'LLM connection test timed out'
  )

  const bodyText = await response.text()
  let body: any = null
  try {
    body = JSON.parse(bodyText)
  } catch {
    body = null
  }

  if (!response.ok) {
    throw new Error(body?.error?.message || bodyText.slice(0, 300) || `HTTP ${response.status}`)
  }

  if (!Array.isArray(body?.content)) {
    throw new Error('Model response did not contain an Anthropic message content block')
  }
}

async function testFishTTSModel(model: TTSModelConfig): Promise<void> {
  const provider = createTTSProviderForConfig(model)

  try {
    await runWithTimeout(
      (async () => {
        await provider.startStreaming()
        await provider.pushText('测试。')
        await provider.finishStreaming()
      })(),
      20000,
      'TTS connection test timed out'
    )
  } finally {
    await provider.close().catch(() => undefined)
  }
}

async function testQwenASRModel(model: ASRModelConfig): Promise<void> {
  const provider = createASRProviderForConfig(model)

  try {
    if (getASRProviderCatalogEntry(model.provider).protocol === 'openai-transcription') {
      await runWithTimeout(
        provider.transcribe(new Int16Array(1600)),
        20000,
        'ASR transcription test timed out'
      )
    } else {
      await runWithTimeout(
        provider.connect(),
        15000,
        'ASR connection test timed out'
      )
    }
  } finally {
    await provider.close().catch(() => undefined)
  }
}

async function runWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}
