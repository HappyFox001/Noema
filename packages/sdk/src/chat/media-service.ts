/**
 * SDK-owned media generation service for roleplay chat turns.
 */
import type { ConfiguredTTSModel } from '../audio/tts-catalog.js'
import { audioExtensionForMimeType, synthesizeTTSWithConfiguredModel } from '../audio/tts-runtime.js'
import {
  generateImageWithConfiguredProvider,
  type ImageGenerationConfiguredModel,
} from '../image/index.js'
import type { ChatMediaItem } from './index.js'

export interface ChatMediaServiceOptions {
  getProxyUrl?: () => string | undefined
}

export interface ChatMediaImageModel extends ImageGenerationConfiguredModel {
  modelType?: 'image' | string
}

export interface ChatMediaGenerateImageRequest {
  model: ChatMediaImageModel
  modelName?: string
  prompt: string
  referenceImages?: string[]
  size?: string
  name?: string
}

export interface ChatMediaSynthesizeAudioRequest {
  model: ConfiguredTTSModel
  text: string
  name?: string
}

export interface ChatMediaGeneration {
  media: ChatMediaItem
  provider?: string
  model?: string
}

export class ChatMediaService {
  constructor(private options: ChatMediaServiceOptions = {}) {}

  async generateImage(request: ChatMediaGenerateImageRequest): Promise<ChatMediaGeneration> {
    const modelName = String(request?.modelName || request?.model?.modelName || '').trim()
    const prompt = String(request?.prompt || '').trim()
    if (!request?.model || (request.model.modelType && request.model.modelType !== 'image')) {
      throw new Error('Image model is not configured')
    }
    if (!prompt) {
      throw new Error('Image prompt is empty')
    }

    const result = await generateImageWithConfiguredProvider({
      model: {
        id: request.model.id,
        provider: request.model.provider,
        modelName,
        apiKey: request.model.apiKey,
        baseUrl: request.model.baseUrl,
      },
      modelName,
      prompt,
      proxyUrl: this.options.getProxyUrl?.(),
      referenceImages: request.referenceImages,
      size: request.size,
    })
    const mimeType = result.mimeType || inferDataUrlMimeType(result.dataUrl) || 'image/png'

    return {
      provider: result.provider,
      model: result.model,
      media: {
        kind: 'image',
        name: request.name || `${result.model || modelName || 'image'}.png`,
        mimeType,
        dataUrl: result.dataUrl,
        url: result.url,
        prompt: result.prompt || prompt,
        origin: 'generated',
        context: {
          mode: 'text',
          summary: prompt.slice(0, 420),
        },
        metadata: {
          provider: result.provider,
          model: result.model,
          referenceImages: result.referenceImages ?? request.referenceImages ?? [],
          size: request.size,
        },
      },
    }
  }

  async synthesizeAudio(request: ChatMediaSynthesizeAudioRequest): Promise<ChatMediaGeneration> {
    const text = String(request?.text || '').trim()
    if (!text) {
      throw new Error('TTS text is empty')
    }

    const result = await synthesizeTTSWithConfiguredModel(request.model, text)
    return {
      provider: request.model.provider,
      model: request.model.modelName,
      media: {
        kind: 'audio',
        name: request.name || `${request.model.modelName || request.model.provider || 'voice'}.${audioExtensionForMimeType(result.mimeType)}`,
        mimeType: result.mimeType,
        dataUrl: result.dataUrl,
        size: result.size,
        transcript: text,
        origin: 'generated',
        context: {
          mode: 'text',
          summary: text.slice(0, 420),
        },
        metadata: {
          provider: request.model.provider,
          model: request.model.modelName,
          voiceId: request.model.voiceId,
          sampleRate: result.sampleRate,
          audioFormat: result.audioFormat,
        },
      },
    }
  }
}

function inferDataUrlMimeType(dataUrl: string | undefined): string {
  const match = String(dataUrl || '').match(/^data:([^;,]+)[;,]/)
  return match?.[1] || ''
}
