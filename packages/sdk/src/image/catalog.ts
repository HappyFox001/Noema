/**
 * Browser-safe image provider catalog and shared image model types.
 */
export type ImageProviderType =
  | 'openai'
  | 'wavespeed'
  | 'gemini'

export type ImageProviderApiStyle =
  | 'openai-images'
  | 'wavespeed'
  | 'gemini-interactions'

export interface ImageProviderCatalogEntry {
  value: ImageProviderType
  label: string
  apiStyle: ImageProviderApiStyle
  defaultModel: string
  defaultBaseUrl: string
  generatePath: string
  docsUrl: string
  defaultApiKeyPlaceholder: string
  capabilities?: ImageProviderCapabilities
}

export interface ImageProviderCapabilities {
  referenceImages?: {
    supported: boolean
    maxImages: number
    mode: 'json-images' | 'multipart-edit'
  }
  sizeFormat?: 'x' | 'asterisk'
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
  referenceImages?: string[]
  providerResponse?: unknown
}

export const IMAGE_PROVIDER_CATALOG: ImageProviderCatalogEntry[] = [
  {
    value: 'openai',
    label: 'OpenAI Images',
    apiStyle: 'openai-images',
    defaultModel: 'gpt-image-2',
    defaultBaseUrl: 'https://api.openai.com/v1',
    generatePath: '/images/generations',
    docsUrl: 'https://platform.openai.com/docs/guides/image-generation',
    defaultApiKeyPlaceholder: 'sk-...',
    capabilities: {
      referenceImages: { supported: true, maxImages: 10, mode: 'multipart-edit' },
      sizeFormat: 'x',
    },
  },
  {
    value: 'wavespeed',
    label: 'WaveSpeedAI',
    apiStyle: 'wavespeed',
    defaultModel: 'openai/gpt-image-2/text-to-image',
    defaultBaseUrl: 'https://api.wavespeed.ai/api/v3',
    generatePath: '/{model}',
    docsUrl: 'https://wavespeed.ai/docs/docs-api/openai/openai-gpt-image-2-edit',
    defaultApiKeyPlaceholder: 'WAVESPEED_API_KEY',
    capabilities: {
      referenceImages: { supported: true, maxImages: 10, mode: 'json-images' },
      sizeFormat: 'asterisk',
    },
  },
  {
    value: 'gemini',
    label: 'Gemini Images',
    apiStyle: 'gemini-interactions',
    defaultModel: 'gemini-3.1-flash-image',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    generatePath: '/interactions',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/image-generation',
    defaultApiKeyPlaceholder: 'AIza...',
    capabilities: {
      referenceImages: { supported: true, maxImages: 10, mode: 'json-images' },
      sizeFormat: 'x',
    },
  },
]

export function getImageProviderCatalogEntry(provider: string | undefined): ImageProviderCatalogEntry {
  return IMAGE_PROVIDER_CATALOG.find((entry) => entry.value === provider) ?? IMAGE_PROVIDER_CATALOG[0]
}

export function isImageModelEditCapable(provider: string | undefined, modelName: string): boolean {
  const normalizedProvider = String(provider || getImageProviderCatalogEntry(provider).value).toLowerCase()
  const normalized = modelName.trim().replace(/^models\//i, '').replace(/^\/+|\/+$/g, '').toLowerCase()
  if (!normalized) {
    return false
  }
  if (normalizedProvider === 'openai') {
    return isOpenAIEditCapableImageModel(normalized)
  }
  if (normalizedProvider === 'wavespeed') {
    return isWaveSpeedEditCapableImageModel(normalized)
  }
  if (normalizedProvider === 'gemini') {
    return isGeminiEditCapableImageModel(normalized)
  }
  return false
}

export function filterEditCapableImageModelNames(provider: string | undefined, modelNames: unknown): string[] {
  const names = Array.isArray(modelNames)
    ? modelNames.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean)
    : []
  return [...new Set(names)].filter((name) => isImageModelEditCapable(provider, name))
}

function isOpenAIEditCapableImageModel(modelName: string): boolean {
  return /^(?:gpt-image|chatgpt-image)(?:[-\w.]*)?$/i.test(modelName)
}

function isWaveSpeedEditCapableImageModel(modelName: string): boolean {
  if (/^openai\/gpt-image-2\/(?:text-to-image|edit)$/i.test(modelName)) {
    return true
  }
  if (/(?:^|\/)(?:image-to-image|img2img)$/i.test(modelName)) {
    return true
  }
  if (/(?:^|[\/_-])image[-_]?edit(?:$|[\/_-])/i.test(modelName)) {
    return true
  }
  if (/(?:^|[\/_-])edit(?:$|[\/_-])/i.test(modelName) && /image|gpt-image|qwen|glm|grok|flux|kontext|nano-banana/i.test(modelName)) {
    return true
  }
  if (/reference[-_]?to[-_]?image|reference[-_]?images?|character[-_]?reference/i.test(modelName)) {
    return true
  }
  if (/(?:^|[\/_-])modify(?:$|[\/_-])/i.test(modelName) && /image|photon|luma/i.test(modelName)) {
    return true
  }
  return false
}

function isGeminiEditCapableImageModel(modelName: string): boolean {
  return /^gemini-[a-z0-9.-]+-image$/i.test(modelName) || /(?:^|[-_/])nano[-_]?banana(?:$|[-_/])/i.test(modelName)
}
