import { invoke } from '@tauri-apps/api/core'
import type { RealtimeWebSocketTransport } from '@her-text/sdk'

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

  async receive(): Promise<Uint8Array | null> {
    return this.receiveWithTimeout(10000)
  }

  async receiveWithTimeout(timeoutMs: number): Promise<Uint8Array | null> {
    const data = await invoke<number[] | null>('realtime_ws_receive', {
      id: this.id,
      timeoutMs,
    })
    return data ? new Uint8Array(data) : null
  }

  async close(): Promise<void> {
    await invoke('realtime_ws_close', { id: this.id })
  }
}
