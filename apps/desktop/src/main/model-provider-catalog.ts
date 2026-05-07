/**
 * Built-in model provider catalog.
 *
 * Model providers are first-class application capabilities, not runtime
 * plugins. This catalog keeps UI, settings defaults, and runtime creation
 * aligned as more provider implementations are added.
 */

export type TTSProviderType = 'fish' | 'openai' | 'elevenlabs'
export type ASRProviderType = 'qwen' | 'openai' | 'groq'

export type ProviderProtocol =
  | 'fish-realtime'
  | 'qwen-realtime'
  | 'openai-speech'
  | 'elevenlabs-http'
  | 'openai-transcription'

export interface VoiceProviderCatalogEntry {
  value: string
  label: string
  protocol: ProviderProtocol
  implemented: boolean
  defaultModel: string
  defaultBaseUrl: string
  defaultLanguage: string
  defaultVoiceId?: string
  requiresVoiceId: boolean
  sampleRate: number
}

export type TTSProviderCatalogEntry = VoiceProviderCatalogEntry & { value: TTSProviderType }
export type ASRProviderCatalogEntry = VoiceProviderCatalogEntry & { value: ASRProviderType }

export const TTS_PROVIDER_CATALOG: TTSProviderCatalogEntry[] = [
  {
    value: 'fish',
    label: 'Fish Audio',
    protocol: 'fish-realtime',
    implemented: true,
    defaultModel: 's2-pro',
    defaultBaseUrl: '',
    defaultLanguage: '',
    requiresVoiceId: true,
    sampleRate: 16000,
  },
  {
    value: 'openai',
    label: 'OpenAI-compatible',
    protocol: 'openai-speech',
    implemented: true,
    defaultModel: 'gpt-4o-mini-tts',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultLanguage: '',
    defaultVoiceId: 'alloy',
    requiresVoiceId: false,
    sampleRate: 16000,
  },
  {
    value: 'elevenlabs',
    label: 'ElevenLabs HTTP',
    protocol: 'elevenlabs-http',
    implemented: true,
    defaultModel: 'eleven_turbo_v2_5',
    defaultBaseUrl: 'https://api.elevenlabs.io',
    defaultLanguage: 'zh',
    requiresVoiceId: true,
    sampleRate: 16000,
  },
]

export const ASR_PROVIDER_CATALOG: ASRProviderCatalogEntry[] = [
  {
    value: 'qwen',
    label: 'Qwen Realtime',
    protocol: 'qwen-realtime',
    implemented: true,
    defaultModel: 'qwen3-asr-flash-realtime',
    defaultBaseUrl: '',
    defaultLanguage: 'zh',
    requiresVoiceId: false,
    sampleRate: 16000,
  },
  {
    value: 'openai',
    label: 'OpenAI-compatible',
    protocol: 'openai-transcription',
    implemented: true,
    defaultModel: 'gpt-4o-transcribe',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultLanguage: 'zh',
    requiresVoiceId: false,
    sampleRate: 16000,
  },
  {
    value: 'groq',
    label: 'Groq Whisper',
    protocol: 'openai-transcription',
    implemented: true,
    defaultModel: 'whisper-large-v3-turbo',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultLanguage: 'zh',
    requiresVoiceId: false,
    sampleRate: 16000,
  },
]

export function getTTSProviderCatalogEntry(provider: string | undefined): TTSProviderCatalogEntry {
  return TTS_PROVIDER_CATALOG.find(entry => entry.value === provider) ?? TTS_PROVIDER_CATALOG[0]
}

export function getASRProviderCatalogEntry(provider: string | undefined): ASRProviderCatalogEntry {
  return ASR_PROVIDER_CATALOG.find(entry => entry.value === provider) ?? ASR_PROVIDER_CATALOG[0]
}
