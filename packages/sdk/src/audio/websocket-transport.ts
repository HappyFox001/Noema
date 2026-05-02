
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
