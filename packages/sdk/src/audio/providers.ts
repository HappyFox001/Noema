export type STTTranscriptEvent = {
  type: 'transcript'
  text: string
  final: boolean
}

export type STTProviderEvent = STTTranscriptEvent

export type STTProviderCapabilities = {
  provider: string
  model?: string
  sampleRate: number
  streamingTranscripts: boolean
  supportsInterimTranscripts: boolean
  supportsFinalTranscripts: boolean
  supportsFlushAudio: boolean
  supportsServerVAD: boolean
  sttTimeoutMs: number
}

export type TTSProviderCapabilities = {
  provider: string
  model?: string
  sampleRate: number
  audioFormat: 'pcm' | 'mp3' | 'opus'
  streaming: boolean
  supportsInterrupt: boolean
}

export interface VoiceProviderLifecycle {
  setup?(): Promise<void>
  start?(): Promise<void>
  updateSettings?(settings: unknown): Promise<void>
  interrupt?(reason?: string): Promise<void>
  stop?(): Promise<void>
  cleanup?(): Promise<void>
}

export interface STTProvider extends VoiceProviderLifecycle {
  readonly streamingTranscripts?: boolean
  getCapabilities(): STTProviderCapabilities
  connect(): Promise<void>
  appendAudio(audioData: Int16Array | number[]): Promise<void>
  flushAudio?(): Promise<void>
  commit(): Promise<string>
  waitForFinalTranscript?(): Promise<string>
  transcribe(audioData: Int16Array | number[]): Promise<string>
  close(): Promise<void>
  clearBufferedTranscripts(): void
  setEventHandler(handler: (event: STTProviderEvent) => void): void
}

export type TTSProviderEvent =
  | { type: 'connected'; contextId: number }
  | { type: 'audio'; audio: Uint8Array; contextId: number }
  | { type: 'error'; error: Error }
  | { type: 'closed'; contextId: number }

export interface TTSProvider extends VoiceProviderLifecycle {
  getCapabilities(): TTSProviderCapabilities
  startStreaming(): Promise<void>
  pushText(text: string): Promise<void>
  finishStreaming(): Promise<void>
  close(): Promise<void>
  interrupt(): Promise<void>
  setEventHandler(handler: (event: TTSProviderEvent) => void): void
  getActiveContextId(): number
}
