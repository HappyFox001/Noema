import { FishTTSOfficial, type FishTTSOfficialConfig } from './fish-tts-official.js'
import { QwenRealtimeASR, type QwenRealtimeASRConfig } from './qwen-realtime-asr.js'
import type { RealtimeWebSocketTransport } from './websocket-transport.js'
import type { STTProvider, TTSProvider } from './providers.js'

export type STTProviderKind = 'qwen-realtime'
export type TTSProviderKind = 'fish-realtime'

export interface STTProviderFactoryConfig {
  kind: STTProviderKind
  config: QwenRealtimeASRConfig
  transport: RealtimeWebSocketTransport
}

export interface TTSProviderFactoryConfig {
  kind: TTSProviderKind
  config: FishTTSOfficialConfig
}

export function createSTTProvider(options: STTProviderFactoryConfig): STTProvider {
  switch (options.kind) {
    case 'qwen-realtime':
      return new QwenRealtimeASR(options.config, options.transport)
  }
}

export function createTTSProvider(options: TTSProviderFactoryConfig): TTSProvider {
  switch (options.kind) {
    case 'fish-realtime':
      return new FishTTSOfficial(options.config)
  }
}
