import { FishTTSOfficial, type FishTTSOfficialConfig } from './fish-tts-official.js'
import { ElevenLabsTTSProvider, type ElevenLabsTTSConfig } from './elevenlabs-tts.js'
import { OpenAIASRProvider, type OpenAIASRConfig } from './openai-asr.js'
import { OpenAITTSProvider, type OpenAITTSConfig } from './openai-tts.js'
import { QwenRealtimeASR, type QwenRealtimeASRConfig } from './qwen-realtime-asr.js'
import type { RealtimeWebSocketTransport } from './websocket-transport.js'
import type { STTProvider, TTSProvider } from './providers.js'

export type STTProviderKind = 'qwen-realtime' | 'openai-transcription'
export type TTSProviderKind = 'fish-realtime' | 'openai-speech' | 'elevenlabs-http'

export type STTProviderFactoryConfig =
  | {
      kind: 'qwen-realtime'
      config: QwenRealtimeASRConfig
      transport: RealtimeWebSocketTransport
    }
  | {
      kind: 'openai-transcription'
      config: OpenAIASRConfig
    }

export type TTSProviderFactoryConfig =
  | {
      kind: 'fish-realtime'
      config: FishTTSOfficialConfig
    }
  | {
      kind: 'openai-speech'
      config: OpenAITTSConfig
    }
  | {
      kind: 'elevenlabs-http'
      config: ElevenLabsTTSConfig
    }

export function createSTTProvider(options: STTProviderFactoryConfig): STTProvider {
  switch (options.kind) {
    case 'qwen-realtime':
      return new QwenRealtimeASR(options.config, options.transport)
    case 'openai-transcription':
      return new OpenAIASRProvider(options.config)
  }
}

export function createTTSProvider(options: TTSProviderFactoryConfig): TTSProvider {
  switch (options.kind) {
    case 'fish-realtime':
      return new FishTTSOfficial(options.config)
    case 'openai-speech':
      return new OpenAITTSProvider(options.config)
    case 'elevenlabs-http':
      return new ElevenLabsTTSProvider(options.config)
  }
}
