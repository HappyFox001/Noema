/**
 * Built-in model provider catalog.
 *
 * Model providers are first-class application capabilities, not runtime
 * plugins. This catalog keeps UI, settings defaults, and runtime creation
 * aligned as more provider implementations are added.
 */

export type LLMProviderType =
  | 'openai'
  | 'gemini'
  | 'claude'
  | 'qwen'
  | 'deepseek'
  | 'groq'
  | 'ollama'
  | 'azure-openai'
  | 'openai-compatible'

export type ImageProviderType =
  | 'openai-image'
  | 'google-imagen'
  | 'stability'
  | 'replicate'
  | 'fal'
  | 'comfyui'
  | 'automatic1111'
  | 'aliyun-bailian'
  | 'volcengine-ark'
  | 'tencent-hunyuan'
  | 'baidu-qianfan'
  | 'siliconflow'
  | 'huggingface'
  | 'adobe-firefly'
  | 'ideogram'
  | 'recraft'

export type TTSProviderType =
  | 'fish'
  | 'openai'
  | 'elevenlabs'
  | 'minimax'
  | 'groq'
  | 'gemini'
  | 'google-cloud'
  | 'azure-openai'
  | 'azure-speech'
  | 'openai-compatible'

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
  | 'openai-speech'
  | 'elevenlabs-http'
  | 'openai-transcription'
  | 'openai-chat-completions'
  | 'anthropic-messages'
  | 'ollama-chat'
  | 'azure-openai-audio'
  | 'gemini-tts'
  | 'minimax-tts'
  | 'elevenlabs-transcription'
  | 'fish-transcription'
  | 'assemblyai-streaming'
  | 'google-cloud-speech'
  | 'google-cloud-tts'
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
  defaultModel: string
  defaultBaseUrl: string
  defaultApiKeyPlaceholder: string
}

export interface ImageProviderCatalogEntry {
  value: ImageProviderType
  label: string
  protocol: 'image-generation'
  apiStyle:
    | 'openai-images'
    | 'google-imagen'
    | 'stability-v2'
    | 'replicate-predictions'
    | 'fal-run'
    | 'comfyui-workflow'
    | 'automatic1111-sdapi'
    | 'dashscope-wanx'
    | 'volcengine-ark-images'
    | 'tencent-cloud-action'
    | 'baidu-qianfan-images'
    | 'huggingface-inference'
    | 'adobe-firefly'
    | 'ideogram'
    | 'recraft'
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

export const IMAGE_PROVIDER_CATALOG: ImageProviderCatalogEntry[] = [
  {
    value: 'openai-image',
    label: 'OpenAI Images',
    protocol: 'image-generation',
    apiStyle: 'openai-images',
    implemented: false,
    defaultModel: 'gpt-image-2',
    defaultBaseUrl: 'https://api.openai.com/v1',
    generatePath: '/images/generations',
    docsUrl: 'https://platform.openai.com/docs/guides/image-generation',
    defaultApiKeyPlaceholder: 'sk-...',
  },
  {
    value: 'google-imagen',
    label: 'Google Imagen',
    protocol: 'image-generation',
    apiStyle: 'google-imagen',
    implemented: false,
    defaultModel: 'imagen-4.0-generate-001',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    generatePath: '/models/{model}:predict',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/imagen',
    defaultApiKeyPlaceholder: 'AIza...',
  },
  {
    value: 'stability',
    label: 'Stability AI',
    protocol: 'image-generation',
    apiStyle: 'stability-v2',
    implemented: false,
    defaultModel: 'stable-image-core',
    defaultBaseUrl: 'https://api.stability.ai',
    generatePath: '/v2beta/stable-image/generate/core',
    docsUrl: 'https://platform.stability.ai/docs/api-reference#tag/Generate',
    defaultApiKeyPlaceholder: 'sk-...',
  },
  {
    value: 'replicate',
    label: 'Replicate',
    protocol: 'image-generation',
    apiStyle: 'replicate-predictions',
    implemented: false,
    defaultModel: 'black-forest-labs/flux-schnell',
    defaultBaseUrl: 'https://api.replicate.com/v1',
    generatePath: '/predictions',
    docsUrl: 'https://replicate.com/docs/reference/http',
    defaultApiKeyPlaceholder: 'r8_...',
  },
  {
    value: 'fal',
    label: 'fal.ai',
    protocol: 'image-generation',
    apiStyle: 'fal-run',
    implemented: false,
    defaultModel: 'fal-ai/flux/schnell',
    defaultBaseUrl: 'https://fal.run',
    generatePath: '/{model}',
    docsUrl: 'https://fal.ai/docs/model-endpoints',
    defaultApiKeyPlaceholder: 'fal_...',
  },
  {
    value: 'comfyui',
    label: 'ComfyUI',
    protocol: 'image-generation',
    apiStyle: 'comfyui-workflow',
    implemented: false,
    defaultModel: 'workflow',
    defaultBaseUrl: 'http://127.0.0.1:8188',
    generatePath: '/prompt',
    docsUrl: 'https://github.com/comfyanonymous/ComfyUI/blob/master/script_examples/websockets_api_example.py',
    defaultApiKeyPlaceholder: 'optional',
  },
  {
    value: 'automatic1111',
    label: 'AUTOMATIC1111',
    protocol: 'image-generation',
    apiStyle: 'automatic1111-sdapi',
    implemented: false,
    defaultModel: 'sdxl',
    defaultBaseUrl: 'http://127.0.0.1:7860',
    generatePath: '/sdapi/v1/txt2img',
    docsUrl: 'https://github.com/AUTOMATIC1111/stable-diffusion-webui/wiki/API',
    defaultApiKeyPlaceholder: 'optional',
  },
  {
    value: 'aliyun-bailian',
    label: '阿里云百炼 / 通义万相',
    protocol: 'image-generation',
    apiStyle: 'dashscope-wanx',
    implemented: false,
    defaultModel: 'wanx2.1-t2i-turbo',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com',
    generatePath: '/api/v1/services/aigc/text2image/image-synthesis',
    docsUrl: 'https://help.aliyun.com/zh/model-studio/text-to-image',
    defaultApiKeyPlaceholder: 'sk-...',
  },
  {
    value: 'volcengine-ark',
    label: '火山方舟 / Seedream',
    protocol: 'image-generation',
    apiStyle: 'volcengine-ark-images',
    implemented: false,
    defaultModel: 'doubao-seedream-3-0-t2i-250415',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    generatePath: '/images/generations',
    docsUrl: 'https://www.volcengine.com/docs/82379/1541523',
    defaultApiKeyPlaceholder: 'API Key',
  },
  {
    value: 'tencent-hunyuan',
    label: '腾讯混元生图',
    protocol: 'image-generation',
    apiStyle: 'tencent-cloud-action',
    implemented: false,
    defaultModel: 'hunyuan-image',
    defaultBaseUrl: 'https://hunyuan.tencentcloudapi.com',
    generatePath: '/?Action=TextToImage',
    docsUrl: 'https://cloud.tencent.com/document/product/1729/101842',
    defaultApiKeyPlaceholder: 'SecretId / SecretKey',
  },
  {
    value: 'baidu-qianfan',
    label: '百度千帆',
    protocol: 'image-generation',
    apiStyle: 'baidu-qianfan-images',
    implemented: false,
    defaultModel: 'irag-1.0',
    defaultBaseUrl: 'https://qianfan.baidubce.com',
    generatePath: '/v2/images/generations',
    docsUrl: 'https://cloud.baidu.com/doc/qianfan-api/s/8m7u6un8a',
    defaultApiKeyPlaceholder: 'API Key',
  },
  {
    value: 'siliconflow',
    label: 'SiliconFlow',
    protocol: 'image-generation',
    apiStyle: 'openai-images',
    implemented: false,
    defaultModel: 'black-forest-labs/FLUX.1-schnell',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    generatePath: '/images/generations',
    docsUrl: 'https://docs.siliconflow.cn/cn/api-reference/images/images-generations',
    defaultApiKeyPlaceholder: 'sk-...',
  },
  {
    value: 'huggingface',
    label: 'Hugging Face',
    protocol: 'image-generation',
    apiStyle: 'huggingface-inference',
    implemented: false,
    defaultModel: 'black-forest-labs/FLUX.1-schnell',
    defaultBaseUrl: 'https://api-inference.huggingface.co/models',
    generatePath: '/{model}',
    docsUrl: 'https://huggingface.co/docs/api-inference/tasks/text-to-image',
    defaultApiKeyPlaceholder: 'hf_...',
  },
  {
    value: 'adobe-firefly',
    label: 'Adobe Firefly',
    protocol: 'image-generation',
    apiStyle: 'adobe-firefly',
    implemented: false,
    defaultModel: 'firefly-image-3',
    defaultBaseUrl: 'https://firefly-api.adobe.io',
    generatePath: '/v3/images/generate',
    docsUrl: 'https://developer.adobe.com/firefly-services/docs/firefly-api/guides/api/image_generation/V3/',
    defaultApiKeyPlaceholder: 'API Key',
  },
  {
    value: 'ideogram',
    label: 'Ideogram',
    protocol: 'image-generation',
    apiStyle: 'ideogram',
    implemented: false,
    defaultModel: 'V_3',
    defaultBaseUrl: 'https://api.ideogram.ai',
    generatePath: '/generate',
    docsUrl: 'https://developer.ideogram.ai/api-reference/api-reference/generate-v3',
    defaultApiKeyPlaceholder: 'API Key',
  },
  {
    value: 'recraft',
    label: 'Recraft',
    protocol: 'image-generation',
    apiStyle: 'recraft',
    implemented: false,
    defaultModel: 'recraftv3',
    defaultBaseUrl: 'https://external.api.recraft.ai/v1',
    generatePath: '/images/generations',
    docsUrl: 'https://www.recraft.ai/docs',
    defaultApiKeyPlaceholder: 'API Key',
  },
]

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
    label: 'OpenAI',
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
    value: 'azure-openai',
    label: 'Azure OpenAI',
    protocol: 'azure-openai-audio',
    implemented: false,
    defaultModel: 'gpt-4o-mini-tts',
    defaultBaseUrl: 'https://{resource}.openai.azure.com/openai/v1',
    defaultLanguage: '',
    defaultVoiceId: 'alloy',
    requiresVoiceId: false,
    sampleRate: 16000,
  },
  {
    value: 'groq',
    label: 'Groq TTS',
    protocol: 'openai-speech',
    implemented: true,
    defaultModel: 'playai-tts',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultLanguage: '',
    defaultVoiceId: 'Fritz-PlayAI',
    requiresVoiceId: false,
    sampleRate: 16000,
  },
  {
    value: 'gemini',
    label: 'Gemini TTS',
    protocol: 'gemini-tts',
    implemented: false,
    defaultModel: 'gemini-2.5-flash-tts',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultLanguage: '',
    defaultVoiceId: 'Kore',
    requiresVoiceId: false,
    sampleRate: 16000,
  },
  {
    value: 'openai-compatible',
    label: 'OpenAI-compatible TTS',
    protocol: 'openai-speech',
    implemented: true,
    defaultModel: 'tts-1',
    defaultBaseUrl: '',
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
  {
    value: 'minimax',
    label: 'MiniMax',
    protocol: 'minimax-tts',
    implemented: false,
    defaultModel: 'speech-02-hd',
    defaultBaseUrl: 'https://api.minimax.io/v1',
    defaultLanguage: 'zh',
    defaultVoiceId: '',
    requiresVoiceId: true,
    sampleRate: 16000,
  },
  {
    value: 'google-cloud',
    label: 'Google Cloud TTS',
    protocol: 'google-cloud-tts',
    implemented: false,
    defaultModel: 'chirp3-hd',
    defaultBaseUrl: 'https://texttospeech.googleapis.com/v1',
    defaultLanguage: 'zh-CN',
    defaultVoiceId: 'zh-CN-Chirp3-HD-Kore',
    requiresVoiceId: true,
    sampleRate: 16000,
  },
  {
    value: 'azure-speech',
    label: 'Azure Speech',
    protocol: 'azure-speech',
    implemented: false,
    defaultModel: 'neural',
    defaultBaseUrl: 'https://{region}.tts.speech.microsoft.com/cognitiveservices/v1',
    defaultLanguage: 'zh-CN',
    defaultVoiceId: 'zh-CN-XiaoxiaoNeural',
    requiresVoiceId: true,
    sampleRate: 16000,
  },
]

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
