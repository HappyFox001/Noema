export type STTTranscriptEvent = {
  type: 'transcript'
  text: string
  final: boolean
}

export type STTProviderEvent = STTTranscriptEvent

export interface STTProvider {
  readonly streamingTranscripts?: boolean
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

export interface TTSProvider {
  startStreaming(): Promise<void>
  pushText(text: string): Promise<void>
  finishStreaming(): Promise<void>
  close(): Promise<void>
  interrupt(): Promise<void>
  setEventHandler(handler: (event: TTSProviderEvent) => void): void
  getActiveContextId(): number
}
