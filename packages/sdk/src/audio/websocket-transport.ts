/**
 * WebSocket 传输层接口
 * 用于实时音频通信（TTS、ASR 等）
 */
export interface RealtimeWebSocketTransport {
  connect(options: {
    url: string
    headers: Record<string, string>
  }): Promise<void>
  sendBinary(data: Uint8Array): Promise<void>
  sendText(data: string): Promise<void>
  receive(timeoutMs?: number): Promise<RealtimeWebSocketReceiveResult>
  close(): Promise<void>
}

export interface RealtimeWebSocketReceiveResult {
  data?: Uint8Array
  timeout?: boolean
  closed?: boolean
}
