/**
 * Owns low-level voice runtime helpers that are shared by ASR and endpointing.
 */
import type {
  EndpointingConfig,
  SmartTurnAnalyzer,
  TTSProvider,
  VADParams,
  VoiceConfidenceProvider,
} from '@noema/sdk'
import { createTTSProvider } from '@noema/sdk'
import { getTTSProviderCatalogEntry } from './model-provider-catalog.js'
import { initializeSileroVAD, isSileroVADAvailable } from './silero-vad-helper.js'
import { initializeSmartTurn, isSmartTurnAvailable } from './smart-turn-helper.js'
import type { TTSModelConfig } from './settings-store.js'

export const DEFAULT_VAD_CONFIG: Partial<VADParams> = {
  confidence: 0.7,
  startSecs: 0.2,
  stopSecs: 0.15,
  minVolume: 0.02,
  sampleRate: 16000,
}

export const LOW_LATENCY_VOICE_CONFIG = {
  smartTurnAnalyzeIntervalMs: 100,
  smartTurnSttTimeoutMs: 800,
  smartTurnStopTimeoutMs: 700,
  fallbackUserSpeechTimeoutMs: 400,
  fallbackSttTimeoutMs: 800,
  fallbackUserTurnStopTimeoutMs: 3000,
  asrFallbackCommitGraceMs: 120,
} as const

export const FALLBACK_ENDPOINTING_CONFIG: Partial<EndpointingConfig> = {
  userSpeechTimeout: LOW_LATENCY_VOICE_CONFIG.fallbackUserSpeechTimeoutMs,
  sttTimeoutMs: LOW_LATENCY_VOICE_CONFIG.fallbackSttTimeoutMs,
  userTurnStopTimeout: LOW_LATENCY_VOICE_CONFIG.fallbackUserTurnStopTimeoutMs,
}

export class VoiceRuntimeController {
  private sileroVADProvider: VoiceConfidenceProvider | null = null
  private sileroVADInitPromise: Promise<VoiceConfidenceProvider | null> | null = null
  private smartTurnAnalyzer: SmartTurnAnalyzer | null = null
  private smartTurnInitPromise: Promise<SmartTurnAnalyzer | null> | null = null

  resetLocalAnalyzers(): void {
    this.sileroVADProvider = null
    this.sileroVADInitPromise = null
    this.smartTurnAnalyzer = null
    this.smartTurnInitPromise = null
  }

  async getSileroVADProvider(): Promise<VoiceConfidenceProvider | null> {
    if (this.sileroVADProvider) {
      return this.sileroVADProvider
    }

    if (this.sileroVADInitPromise) {
      return this.sileroVADInitPromise
    }

    this.sileroVADInitPromise = (async () => {
      try {
        if (!await isSileroVADAvailable()) {
          console.log('[VAD] Silero VAD not available, falling back to RMS VAD')
          return null
        }

        console.log('[VAD] Initializing Silero VAD...')
        this.sileroVADProvider = await initializeSileroVAD(16000)
        console.log('[VAD] Silero VAD initialized successfully')
        return this.sileroVADProvider
      } catch (error) {
        console.error('[VAD] Failed to initialize Silero VAD:', error)
        console.log('[VAD] Falling back to RMS VAD')
        return null
      }
    })()

    return this.sileroVADInitPromise
  }

  async getSmartTurnAnalyzer(): Promise<SmartTurnAnalyzer | null> {
    if (this.smartTurnAnalyzer) {
      return this.smartTurnAnalyzer
    }

    if (this.smartTurnInitPromise) {
      return this.smartTurnInitPromise
    }

    this.smartTurnInitPromise = (async () => {
      try {
        if (!await isSmartTurnAvailable()) {
          console.log('[SmartTurn] Smart Turn not available, falling back to fixed timeout')
          return null
        }

        console.log('[SmartTurn] Initializing Smart Turn...')
        this.smartTurnAnalyzer = await initializeSmartTurn(16000)
        console.log('[SmartTurn] Smart Turn initialized successfully')
        return this.smartTurnAnalyzer
      } catch (error) {
        console.error('[SmartTurn] Failed to initialize Smart Turn:', error)
        console.log('[SmartTurn] Falling back to fixed timeout')
        return null
      }
    })()

    return this.smartTurnInitPromise
  }
}

export function normalizeTTSModelName(config: TTSModelConfig | null): string {
  const modelName = config?.modelName?.trim()
  if (modelName) {
    return modelName
  }
  return getTTSProviderCatalogEntry(config?.provider).defaultModel
}

export function createTTSProviderForConfig(config: TTSModelConfig | null): TTSProvider {
  if (!config?.apiKey?.trim()) {
    throw new Error('TTS API key is not configured')
  }

  const providerEntry = getTTSProviderCatalogEntry(config.provider)
  if (!providerEntry.implemented) {
    throw new Error(`${providerEntry.label} TTS is listed in the catalog but is not implemented in the runtime yet`)
  }

  if (providerEntry.protocol === 'elevenlabs-http') {
    return createTTSProvider({
      kind: 'elevenlabs-http',
      config: {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl || providerEntry.defaultBaseUrl,
        model: normalizeTTSModelName(config),
        voiceId: config.voiceId,
        sampleRate: config.sampleRate || providerEntry.sampleRate,
        language: config.language || providerEntry.defaultLanguage,
        extra: config.extra as any,
      },
    })
  }

  if (providerEntry.protocol !== 'fish-realtime') {
    throw new Error(`Unsupported TTS provider protocol: ${providerEntry.protocol}`)
  }

  return createTTSProvider({
    kind: 'fish-realtime',
    config: {
      apiKey: config.apiKey,
      voiceId: config.voiceId,
      model: normalizeTTSModelName(config),
      format: config.format || 'pcm',
      sampleRate: config.sampleRate || providerEntry.sampleRate,
      latency: 'balanced',
      normalize: true,
      prosody: {
        speed: 1.0,
        volume: 0,
      },
    },
  })
}
