/**
 * Builds ASR providers from desktop ASR model settings.
 */
import { createSTTProvider, type STTProvider } from '@noema/sdk'
import type { ASRModelConfig } from './settings-store.js'
import { getASRProviderCatalogEntry } from './model-provider-catalog.js'
import { NodeRealtimeWebSocketTransport } from './qwen-websocket-transport.js'
import {
  ReconnectingWebSocketTransport,
  type ConnectionState,
} from './reconnecting-websocket-transport.js'
import { LOW_LATENCY_VOICE_CONFIG } from './voice-runtime-controller.js'

export function normalizeASRModelName(modelName?: string): string {
  const normalized = modelName?.trim()
  if (!normalized || normalized === 'realtime' || normalized === 'qwen-realtime') {
    return 'qwen3-asr-flash-realtime'
  }
  return normalized
}

export function normalizeASRLanguage(config: ASRModelConfig | null): string {
  return config?.language?.trim() || getASRProviderCatalogEntry(config?.provider).defaultLanguage
}

export function normalizeQwenRealtimeUrl(baseUrl?: string): string {
  const defaultUrl = getASRProviderCatalogEntry('qwen').defaultBaseUrl
  const normalized = baseUrl?.trim()
  if (!normalized) {
    return defaultUrl
  }

  if (normalized.startsWith('ws://') || normalized.startsWith('wss://')) {
    return normalized
  }

  try {
    const url = new URL(normalized)
    if (url.hostname.includes('dashscope.aliyuncs.com')) {
      return defaultUrl
    }
  } catch {
    return defaultUrl
  }

  console.warn('[ASR] Ignoring non-WebSocket Qwen Realtime Base URL. Leave it blank to use the default DashScope endpoint.')
  return defaultUrl
}

export function createASRProviderForConfig(
  config: ASRModelConfig | null,
  callbacks?: {
    onConnectionStateChange?: (state: ConnectionState) => void
    onReconnectAttempt?: (attempt: number, maxRetries: number) => void
  }
): STTProvider {
  if (!config?.apiKey?.trim()) {
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
    maxRetries: callbacks ? 5 : 0,
    initialRetryDelayMs: callbacks ? 1000 : 500,
    maxRetryDelayMs: 16000,
    onConnectionStateChange: callbacks?.onConnectionStateChange,
    onReconnectAttempt: callbacks?.onReconnectAttempt,
  })

  return createSTTProvider({
    kind: 'qwen-realtime',
    config: {
      apiKey: config.apiKey,
      url: normalizeQwenRealtimeUrl(config.baseUrl),
      model: normalizeASRModelName(config.modelName),
      sampleRate: config.sampleRate || providerEntry.sampleRate,
      language: normalizeASRLanguage(config),
      receiveTimeoutMs: callbacks ? 1000 : 5000,
      fallbackTranscriptCommitGraceMs: LOW_LATENCY_VOICE_CONFIG.asrFallbackCommitGraceMs,
    },
    transport: reconnectingTransport,
  })
}
