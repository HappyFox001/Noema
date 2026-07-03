/**
 * Owns low-level voice runtime helpers that are shared by ASR and endpointing.
 */
import type {
  EndpointingConfig,
  SmartTurnAnalyzer,
  VADParams,
  VoiceConfidenceProvider,
} from '@noema/sdk'
import { initializeSileroVAD, isSileroVADAvailable } from './silero-vad-helper.js'
import { initializeSmartTurn, isSmartTurnAvailable } from './smart-turn-helper.js'

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
