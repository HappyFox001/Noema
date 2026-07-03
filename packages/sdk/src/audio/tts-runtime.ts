/**
 * Shared TTS runtime helpers for configured Fish Audio and ElevenLabs models.
 */
import { Buffer } from 'buffer'
import { createTTSProvider } from './provider-factory.js'
import type { TTSProvider, TTSProviderEvent } from './providers.js'
import {
  getTTSRuntimeProviderCatalogEntry,
  normalizeConfiguredTTSModelName,
  type ConfiguredTTSModel,
} from './tts-catalog.js'

export interface SynthesizedTTSMedia {
  dataUrl: string
  mimeType: string
  size: number
  sampleRate: number
  audioFormat: 'pcm' | 'mp3' | 'opus'
}

export function createTTSProviderForConfiguredModel(config: ConfiguredTTSModel | null | undefined): TTSProvider {
  if (!config?.apiKey?.trim()) {
    throw new Error('TTS API key is not configured')
  }

  const providerEntry = getTTSRuntimeProviderCatalogEntry(config.provider)
  const model = normalizeConfiguredTTSModelName(config)

  if (providerEntry.protocol === 'elevenlabs-http') {
    return createTTSProvider({
      kind: 'elevenlabs-http',
      config: {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl || providerEntry.defaultBaseUrl,
        model,
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
      model,
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

export async function synthesizeTTSWithConfiguredModel(
  model: ConfiguredTTSModel,
  text: string,
  options: { timeoutMs?: number } = {}
): Promise<SynthesizedTTSMedia> {
  const provider = createTTSProviderForConfiguredModel(model)
  const chunks: Uint8Array[] = []
  let eventError: Error | null = null

  provider.setEventHandler((event: TTSProviderEvent) => {
    if (event.type === 'audio' && event.audio.length > 0) {
      chunks.push(event.audio)
    } else if (event.type === 'error') {
      eventError = event.error
    }
  })

  try {
    await runWithTimeout(
      (async () => {
        await provider.startStreaming()
        await provider.pushText(text)
        await provider.finishStreaming()
      })(),
      options.timeoutMs ?? 90_000,
      'TTS synthesis timed out'
    )

    if (eventError) {
      throw eventError
    }
    if (!chunks.length) {
      throw new Error('TTS provider returned no audio')
    }

    const capabilities = provider.getCapabilities()
    const raw = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)))
    const audioFormat = capabilities.audioFormat
    const sampleRate = capabilities.sampleRate || model.sampleRate || 16000
    const playable = audioFormat === 'pcm' ? wrapPcm16LeAsWav(raw, sampleRate) : raw
    const mimeType = mimeTypeForTTSAudioFormat(audioFormat)

    return {
      dataUrl: `data:${mimeType};base64,${playable.toString('base64')}`,
      mimeType,
      size: playable.length,
      sampleRate,
      audioFormat,
    }
  } finally {
    await provider.close().catch(() => undefined)
  }
}

export function mimeTypeForTTSAudioFormat(format: 'pcm' | 'mp3' | 'opus'): string {
  if (format === 'pcm') {
    return 'audio/wav'
  }
  if (format === 'mp3') {
    return 'audio/mpeg'
  }
  return 'audio/ogg; codecs=opus'
}

export function audioExtensionForMimeType(mimeType: string): string {
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) {
    return 'mp3'
  }
  if (mimeType.includes('ogg') || mimeType.includes('opus')) {
    return 'ogg'
  }
  return 'wav'
}

export function wrapPcm16LeAsWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44)
  const channels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * channels * bitsPerSample / 8
  const blockAlign = channels * bitsPerSample / 8

  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcm.length, 40)

  return Buffer.concat([header, pcm])
}

async function runWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}
