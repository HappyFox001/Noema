import { invoke } from '@tauri-apps/api/core'
import type {
  RealtimeWebSocketReceiveResult,
  RealtimeWebSocketTransport,
} from '@her-text/sdk'

interface TauriRealtimeWebSocketReceiveResult {
  data?: number[] | null
  timeout: boolean
  closed: boolean
}

export class TauriRealtimeWebSocketTransport implements RealtimeWebSocketTransport {
  private readonly id = `realtime_${Date.now()}_${Math.random().toString(36).slice(2)}`

  async connect(options: {
    url: string
    headers: Record<string, string>
  }): Promise<void> {
    await invoke('realtime_ws_connect', {
      id: this.id,
      url: options.url,
      headers: options.headers,
    })
  }

  async sendBinary(data: Uint8Array): Promise<void> {
    await invoke('realtime_ws_send_binary', {
      id: this.id,
      data: Array.from(data),
    })
  }

  async sendText(data: string): Promise<void> {
    await invoke('realtime_ws_send_text', {
      id: this.id,
      data,
    })
  }

  async receive(timeoutMs = 10000): Promise<RealtimeWebSocketReceiveResult> {
    const result = await invoke<TauriRealtimeWebSocketReceiveResult>('realtime_ws_receive', {
      id: this.id,
      timeoutMs,
    })
    return {
      data: result.data ? new Uint8Array(result.data) : undefined,
      timeout: result.timeout,
      closed: result.closed,
    }
  }

  async close(): Promise<void> {
    await invoke('realtime_ws_close', { id: this.id })
  }
}
