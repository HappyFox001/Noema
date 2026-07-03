/**
 * Built-in model provider catalog.
 *
 * Model providers are first-class application capabilities, not runtime
 * plugins. This catalog keeps UI, settings defaults, and runtime creation
 * aligned as more provider implementations are added.
 */
import {
  IMAGE_PROVIDER_CATALOG as SDK_IMAGE_PROVIDER_CATALOG,
  type ImageProviderApiStyle,
  type ImageProviderType,
} from '@noema/sdk/image/catalog'
import {
  TTS_RUNTIME_PROVIDER_CATALOG,
  type ConfiguredTTSProvider,
} from '@noema/sdk/audio/tts-catalog'

export type { ImageProviderType } from '@noema/sdk/image/catalog'
export { filterEditCapableImageModelNames, isImageModelEditCapable } from '@noema/sdk/image/catalog'

export type LLMProviderType =
  | 'openai'
  | 'gemini'
  | 'claude'
  | 'claude-code'
  | 'codex'
  | 'qwen'
  | 'deepseek'
  | 'groq'
  | 'ollama'
  | 'azure-openai'
  | 'openai-compatible'

export type TTSProviderType = ConfiguredTTSProvider

export type ASRProviderType =
  | 'fish'
  | 'elevenlabs'
  | 'qwen'
  | 'openai'
  | 'groq'
  | 'assemblyai'
  | 'google-cloud'
  | 'azure-openai'
  | 'azure-speech'
  | 'openai-compatible'

export type ProviderProtocol =
  | 'fish-realtime'
  | 'qwen-realtime'
  | 'elevenlabs-http'
  | 'openai-transcription'
  | 'openai-chat-completions'
  | 'local-cli-chat'
  | 'anthropic-messages'
  | 'ollama-chat'
  | 'azure-openai-audio'
  | 'elevenlabs-transcription'
  | 'fish-transcription'
  | 'assemblyai-streaming'
  | 'google-cloud-speech'
  | 'azure-speech'

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

export interface LLMProviderCatalogEntry {
  value: LLMProviderType
  label: string
  protocol: ProviderProtocol
  implemented: boolean
  transport?: 'openai_compatible' | 'codex_local' | 'claude_code_local'
  defaultModel: string
  defaultBaseUrl: string
  defaultApiKeyPlaceholder: string
}

export interface ImageProviderCatalogEntry {
  value: ImageProviderType
  label: string
  protocol: 'image-generation'
  apiStyle: ImageProviderApiStyle
  implemented: boolean
  defaultModel: string
  defaultBaseUrl: string
  generatePath: string
  docsUrl: string
  defaultApiKeyPlaceholder: string
}

export const LLM_PROVIDER_CATALOG: LLMProviderCatalogEntry[] = [
  {
    value: 'openai-compatible',
    label: 'OpenAI-compatible',
    protocol: 'openai-chat-completions',
    implemented: true,
    defaultModel: '',
    defaultBaseUrl: '',
    defaultApiKeyPlaceholder: 'API Key',
  },
  {
    value: 'openai',
    label: 'OpenAI',
    protocol: 'openai-chat-completions',
    implemented: true,
    defaultModel: 'gpt-5.1',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultApiKeyPlaceholder: 'sk-...',
  },
  {
    value: 'gemini',
    label: 'Gemini',
    protocol: 'openai-chat-completions',
    implemented: true,
    defaultModel: 'gemini-3.1-pro-preview',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultApiKeyPlaceholder: 'AIza...',
  },
  {
    value: 'claude',
    label: 'Claude',
    protocol: 'anthropic-messages',
    implemented: true,
    defaultModel: 'claude-sonnet-4-5',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultApiKeyPlaceholder: 'sk-ant-...',
  },
  {
    value: 'codex',
    label: 'Codex',
    protocol: 'local-cli-chat',
    implemented: true,
    transport: 'codex_local',
    defaultModel: '',
    defaultBaseUrl: '',
    defaultApiKeyPlaceholder: 'Local CLI',
  },
  {
    value: 'claude-code',
    label: 'Claude Code',
    protocol: 'local-cli-chat',
    implemented: true,
    transport: 'claude_code_local',
    defaultModel: '',
    defaultBaseUrl: '',
    defaultApiKeyPlaceholder: 'Local CLI',
  },
  {
    value: 'qwen',
    label: 'Qwen',
    protocol: 'openai-chat-completions',
    implemented: true,
    defaultModel: 'qwen-plus',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultApiKeyPlaceholder: 'sk-...',
  },
  {
    value: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai-chat-completions',
    implemented: true,
    defaultModel: 'deepseek-chat',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultApiKeyPlaceholder: 'sk-...',
  },
  {
    value: 'groq',
    label: 'Groq',
    protocol: 'openai-chat-completions',
    implemented: true,
    defaultModel: 'openai/gpt-oss-120b',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultApiKeyPlaceholder: 'gsk_...',
  },
  {
    value: 'azure-openai',
    label: 'Azure OpenAI',
    protocol: 'openai-chat-completions',
    implemented: true,
    defaultModel: 'gpt-4.1',
    defaultBaseUrl: 'https://{resource}.openai.azure.com/openai/v1',
    defaultApiKeyPlaceholder: 'Azure API Key',
  },
  {
    value: 'ollama',
    label: 'Ollama',
    protocol: 'openai-chat-completions',
    implemented: true,
    defaultModel: 'llama3.2',
    defaultBaseUrl: 'http://localhost:11434/v1',
    defaultApiKeyPlaceholder: 'ollama',
  },
]

export const IMAGE_PROVIDER_CATALOG: ImageProviderCatalogEntry[] = SDK_IMAGE_PROVIDER_CATALOG.map((entry) => ({
  ...entry,
  protocol: 'image-generation',
  implemented: true,
}))

export type TTSProviderCatalogEntry = VoiceProviderCatalogEntry & { value: TTSProviderType }
export type ASRProviderCatalogEntry = VoiceProviderCatalogEntry & { value: ASRProviderType }

export const TTS_PROVIDER_CATALOG: TTSProviderCatalogEntry[] = TTS_RUNTIME_PROVIDER_CATALOG.map((entry) => ({
  ...entry,
  implemented: true,
}))

export const ASR_PROVIDER_CATALOG: ASRProviderCatalogEntry[] = [
  {
    value: 'fish',
    label: 'Fish Audio STT',
    protocol: 'fish-transcription',
    implemented: false,
    defaultModel: 's2-pro',
    defaultBaseUrl: 'https://api.fish.audio',
    defaultLanguage: 'zh',
    requiresVoiceId: false,
    sampleRate: 16000,
  },
  {
    value: 'elevenlabs',
    label: 'ElevenLabs Scribe',
    protocol: 'elevenlabs-transcription',
    implemented: false,
    defaultModel: 'scribe_v1',
    defaultBaseUrl: 'https://api.elevenlabs.io',
    defaultLanguage: 'zh',
    requiresVoiceId: false,
    sampleRate: 16000,
  },
  {
    value: 'qwen',
    label: 'Qwen Realtime',
    protocol: 'qwen-realtime',
    implemented: true,
    defaultModel: 'qwen3-asr-flash-realtime',
    defaultBaseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
    defaultLanguage: 'zh',
    requiresVoiceId: false,
    sampleRate: 16000,
  },
  {
    value: 'openai',
    label: 'OpenAI',
    protocol: 'openai-transcription',
    implemented: true,
    defaultModel: 'gpt-4o-transcribe',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultLanguage: 'zh',
    requiresVoiceId: false,
    sampleRate: 16000,
  },
  {
    value: 'azure-openai',
    label: 'Azure OpenAI',
    protocol: 'azure-openai-audio',
    implemented: false,
    defaultModel: 'gpt-4o-transcribe',
    defaultBaseUrl: 'https://{resource}.openai.azure.com/openai/v1',
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
  {
    value: 'openai-compatible',
    label: 'OpenAI-compatible ASR',
    protocol: 'openai-transcription',
    implemented: true,
    defaultModel: 'whisper-1',
    defaultBaseUrl: '',
    defaultLanguage: 'zh',
    requiresVoiceId: false,
    sampleRate: 16000,
  },
  {
    value: 'assemblyai',
    label: 'AssemblyAI',
    protocol: 'assemblyai-streaming',
    implemented: false,
    defaultModel: 'universal-streaming',
    defaultBaseUrl: 'wss://streaming.assemblyai.com/v3/ws',
    defaultLanguage: 'zh',
    requiresVoiceId: false,
    sampleRate: 16000,
  },
  {
    value: 'google-cloud',
    label: 'Google Cloud STT',
    protocol: 'google-cloud-speech',
    implemented: false,
    defaultModel: 'chirp_3',
    defaultBaseUrl: 'https://speech.googleapis.com/v2',
    defaultLanguage: 'zh-CN',
    requiresVoiceId: false,
    sampleRate: 16000,
  },
  {
    value: 'azure-speech',
    label: 'Azure Speech',
    protocol: 'azure-speech',
    implemented: false,
    defaultModel: 'fast-transcription',
    defaultBaseUrl: 'https://{region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1',
    defaultLanguage: 'zh-CN',
    requiresVoiceId: false,
    sampleRate: 16000,
  },
]

export function getLLMProviderCatalogEntry(provider: string | undefined): LLMProviderCatalogEntry {
  return LLM_PROVIDER_CATALOG.find(entry => entry.value === provider)
    ?? LLM_PROVIDER_CATALOG.find(entry => entry.value === 'openai-compatible')
    ?? LLM_PROVIDER_CATALOG[0]
}

export function getImageProviderCatalogEntry(provider: string | undefined): ImageProviderCatalogEntry {
  return IMAGE_PROVIDER_CATALOG.find(entry => entry.value === provider) ?? IMAGE_PROVIDER_CATALOG[0]
}

export function getTTSProviderCatalogEntry(provider: string | undefined): TTSProviderCatalogEntry {
  return TTS_PROVIDER_CATALOG.find(entry => entry.value === provider) ?? TTS_PROVIDER_CATALOG[0]
}

export function getASRProviderCatalogEntry(provider: string | undefined): ASRProviderCatalogEntry {
  return ASR_PROVIDER_CATALOG.find(entry => entry.value === provider) ?? ASR_PROVIDER_CATALOG[0]
}
