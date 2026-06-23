/**
 * Browser-safe image provider catalog and shared image model types.
 */
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
  | 'wavespeed'

export type ImageProviderApiStyle =
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
  | 'wavespeed'

export interface ImageProviderCatalogEntry {
  value: ImageProviderType
  label: string
  apiStyle: ImageProviderApiStyle
  defaultModel: string
  defaultBaseUrl: string
  generatePath: string
  docsUrl: string
  defaultApiKeyPlaceholder: string
}

export interface ImageGenerationConfiguredModel {
  id: string
  provider?: ImageProviderType | string
  modelName: string
  apiKey: string
  baseUrl: string
}

export interface ImageGenerationResult {
  provider: string
  model: string
  prompt: string
  mimeType?: string
  dataUrl?: string
  url?: string
  providerResponse?: unknown
}

export const IMAGE_PROVIDER_CATALOG: ImageProviderCatalogEntry[] = [
  {
    value: 'openai-image',
    label: 'OpenAI Images',
    apiStyle: 'openai-images',
    defaultModel: 'gpt-image-2',
    defaultBaseUrl: 'https://api.openai.com/v1',
    generatePath: '/images/generations',
    docsUrl: 'https://platform.openai.com/docs/guides/image-generation',
    defaultApiKeyPlaceholder: 'sk-...',
  },
  {
    value: 'google-imagen',
    label: 'Google Imagen',
    apiStyle: 'google-imagen',
    defaultModel: 'imagen-4.0-generate-001',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    generatePath: '/models/{model}:predict',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/imagen',
    defaultApiKeyPlaceholder: 'AIza...',
  },
  {
    value: 'stability',
    label: 'Stability AI',
    apiStyle: 'stability-v2',
    defaultModel: 'stable-image-core',
    defaultBaseUrl: 'https://api.stability.ai',
    generatePath: '/v2beta/stable-image/generate/core',
    docsUrl: 'https://platform.stability.ai/docs/api-reference',
    defaultApiKeyPlaceholder: 'sk-...',
  },
  {
    value: 'replicate',
    label: 'Replicate',
    apiStyle: 'replicate-predictions',
    defaultModel: 'black-forest-labs/flux-schnell',
    defaultBaseUrl: 'https://api.replicate.com/v1',
    generatePath: '/predictions',
    docsUrl: 'https://replicate.com/docs/reference/http',
    defaultApiKeyPlaceholder: 'r8_...',
  },
  {
    value: 'fal',
    label: 'fal.ai',
    apiStyle: 'fal-run',
    defaultModel: 'fal-ai/flux/schnell',
    defaultBaseUrl: 'https://fal.run',
    generatePath: '/{model}',
    docsUrl: 'https://fal.ai/docs/model-endpoints',
    defaultApiKeyPlaceholder: 'fal_...',
  },
  {
    value: 'comfyui',
    label: 'ComfyUI',
    apiStyle: 'comfyui-workflow',
    defaultModel: 'workflow',
    defaultBaseUrl: 'http://127.0.0.1:8188',
    generatePath: '/prompt',
    docsUrl: 'https://github.com/comfyanonymous/ComfyUI/blob/master/script_examples/websockets_api_example.py',
    defaultApiKeyPlaceholder: 'optional',
  },
  {
    value: 'automatic1111',
    label: 'AUTOMATIC1111',
    apiStyle: 'automatic1111-sdapi',
    defaultModel: 'sdxl',
    defaultBaseUrl: 'http://127.0.0.1:7860',
    generatePath: '/sdapi/v1/txt2img',
    docsUrl: 'https://github.com/AUTOMATIC1111/stable-diffusion-webui/wiki/API',
    defaultApiKeyPlaceholder: 'optional',
  },
  {
    value: 'aliyun-bailian',
    label: '阿里云百炼 / 通义万相',
    apiStyle: 'dashscope-wanx',
    defaultModel: 'wanx2.1-t2i-turbo',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com',
    generatePath: '/api/v1/services/aigc/text2image/image-synthesis',
    docsUrl: 'https://help.aliyun.com/zh/model-studio/text-to-image',
    defaultApiKeyPlaceholder: 'sk-...',
  },
  {
    value: 'volcengine-ark',
    label: '火山方舟 / Seedream',
    apiStyle: 'volcengine-ark-images',
    defaultModel: 'doubao-seedream-3-0-t2i-250415',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    generatePath: '/images/generations',
    docsUrl: 'https://www.volcengine.com/docs/82379/1541523',
    defaultApiKeyPlaceholder: 'API Key',
  },
  {
    value: 'tencent-hunyuan',
    label: '腾讯混元生图',
    apiStyle: 'tencent-cloud-action',
    defaultModel: 'hunyuan-image',
    defaultBaseUrl: 'https://hunyuan.tencentcloudapi.com',
    generatePath: '/?Action=TextToImage',
    docsUrl: 'https://cloud.tencent.com/document/product/1729/101842',
    defaultApiKeyPlaceholder: 'SecretId / SecretKey',
  },
  {
    value: 'baidu-qianfan',
    label: '百度千帆',
    apiStyle: 'baidu-qianfan-images',
    defaultModel: 'irag-1.0',
    defaultBaseUrl: 'https://qianfan.baidubce.com',
    generatePath: '/v2/images/generations',
    docsUrl: 'https://cloud.baidu.com/doc/qianfan-api/s/8m7u6un8a',
    defaultApiKeyPlaceholder: 'API Key',
  },
  {
    value: 'siliconflow',
    label: 'SiliconFlow',
    apiStyle: 'openai-images',
    defaultModel: 'black-forest-labs/FLUX.1-schnell',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    generatePath: '/images/generations',
    docsUrl: 'https://docs.siliconflow.cn/cn/api-reference/images/images-generations',
    defaultApiKeyPlaceholder: 'sk-...',
  },
  {
    value: 'huggingface',
    label: 'Hugging Face',
    apiStyle: 'huggingface-inference',
    defaultModel: 'black-forest-labs/FLUX.1-schnell',
    defaultBaseUrl: 'https://api-inference.huggingface.co/models',
    generatePath: '/{model}',
    docsUrl: 'https://huggingface.co/docs/api-inference/tasks/text-to-image',
    defaultApiKeyPlaceholder: 'hf_...',
  },
  {
    value: 'adobe-firefly',
    label: 'Adobe Firefly',
    apiStyle: 'adobe-firefly',
    defaultModel: 'firefly-image-3',
    defaultBaseUrl: 'https://firefly-api.adobe.io',
    generatePath: '/v3/images/generate',
    docsUrl: 'https://developer.adobe.com/firefly-services/docs/firefly-api/api/',
    defaultApiKeyPlaceholder: 'API Key',
  },
  {
    value: 'ideogram',
    label: 'Ideogram',
    apiStyle: 'ideogram',
    defaultModel: 'V_3',
    defaultBaseUrl: 'https://api.ideogram.ai/v1',
    generatePath: '/ideogram-v3/generate',
    docsUrl: 'https://developer.ideogram.ai/api-reference/api-reference/generate-v3',
    defaultApiKeyPlaceholder: 'API Key',
  },
  {
    value: 'recraft',
    label: 'Recraft',
    apiStyle: 'recraft',
    defaultModel: 'recraftv3',
    defaultBaseUrl: 'https://external.api.recraft.ai/v1',
    generatePath: '/images/generations',
    docsUrl: 'https://www.recraft.ai/docs',
    defaultApiKeyPlaceholder: 'API Key',
  },
  {
    value: 'wavespeed',
    label: 'WaveSpeedAI',
    apiStyle: 'wavespeed',
    defaultModel: 'wavespeed-ai/flux-dev',
    defaultBaseUrl: 'https://api.wavespeed.ai/api/v3',
    generatePath: '/{model}',
    docsUrl: 'https://wavespeed.ai/docs/generate-image',
    defaultApiKeyPlaceholder: 'WAVESPEED_API_KEY',
  },
]

export function getImageProviderCatalogEntry(provider: string | undefined): ImageProviderCatalogEntry {
  return IMAGE_PROVIDER_CATALOG.find((entry) => entry.value === provider) ?? IMAGE_PROVIDER_CATALOG[0]
}
