/**
 * Browser-safe TTS provider catalog and configured model types.
 */
export type ConfiguredTTSProvider = 'fish' | 'elevenlabs'
export type ConfiguredTTSProviderProtocol = 'fish-realtime' | 'elevenlabs-http'

export interface ConfiguredTTSModel {
  id?: string
  provider?: ConfiguredTTSProvider | string
  modelName?: string
  apiKey?: string
  voiceId?: string
  baseUrl?: string
  language?: string
  format?: 'pcm' | 'mp3' | 'opus'
  sampleRate?: number
  extra?: Record<string, unknown>
}

export interface TTSRuntimeProviderCatalogEntry {
  value: ConfiguredTTSProvider
  label: string
  protocol: ConfiguredTTSProviderProtocol
  defaultModel: string
  defaultBaseUrl: string
  defaultLanguage: string
  requiresVoiceId: boolean
  sampleRate: number
}

export const TTS_RUNTIME_PROVIDER_CATALOG: TTSRuntimeProviderCatalogEntry[] = [
  {
    value: 'fish',
    label: 'Fish Audio',
    protocol: 'fish-realtime',
    defaultModel: 's2-pro',
    defaultBaseUrl: '',
    defaultLanguage: '',
    requiresVoiceId: true,
    sampleRate: 16000,
  },
  {
    value: 'elevenlabs',
    label: 'ElevenLabs HTTP',
    protocol: 'elevenlabs-http',
    defaultModel: 'eleven_turbo_v2_5',
    defaultBaseUrl: 'https://api.elevenlabs.io',
    defaultLanguage: 'zh',
    requiresVoiceId: true,
    sampleRate: 16000,
  },
]

export function getTTSRuntimeProviderCatalogEntry(provider: string | undefined): TTSRuntimeProviderCatalogEntry {
  if (!provider) {
    return TTS_RUNTIME_PROVIDER_CATALOG[0]
  }
  const entry = TTS_RUNTIME_PROVIDER_CATALOG.find((item) => item.value === provider)
  if (!entry) {
    throw new Error(`Unsupported TTS provider: ${provider}`)
  }
  return entry
}

export function normalizeConfiguredTTSModelName(config: ConfiguredTTSModel | null | undefined): string {
  const modelName = config?.modelName?.trim()
  if (modelName) {
    return modelName
  }
  return getTTSRuntimeProviderCatalogEntry(config?.provider).defaultModel
}
