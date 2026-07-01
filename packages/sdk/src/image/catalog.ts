/**
 * Browser-safe image provider catalog and shared image model types.
 */
export type ImageProviderType =
  | 'openai-image'
  | 'wavespeed'

export type ImageProviderApiStyle =
  | 'openai-images'
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
    value: 'openai-image',
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
    defaultModel: 'bytedance/seedream-v4.5',
    defaultBaseUrl: 'https://api.wavespeed.ai/api/v3',
    generatePath: '/{model}',
    docsUrl: 'https://wavespeed.ai/docs/generate-image',
    defaultApiKeyPlaceholder: 'WAVESPEED_API_KEY',
    capabilities: {
      referenceImages: { supported: true, maxImages: 10, mode: 'json-images' },
      sizeFormat: 'asterisk',
    },
  },
]

export function getImageProviderCatalogEntry(provider: string | undefined): ImageProviderCatalogEntry {
  return IMAGE_PROVIDER_CATALOG.find((entry) => entry.value === provider) ?? IMAGE_PROVIDER_CATALOG[0]
}
