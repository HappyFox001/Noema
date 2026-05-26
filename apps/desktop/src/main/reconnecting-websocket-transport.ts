

import type {
  RealtimeWebSocketTransport,
  RealtimeWebSocketReceiveResult,
} from '@noema/sdk'

export interface ReconnectingTransportConfig {
  
  maxRetries?: number
  
  initialRetryDelayMs?: number
  
  maxRetryDelayMs?: number
  
  onConnectionStateChange?: (state: ConnectionState) => void
  
  onReconnectAttempt?: (attempt: number, maxRetries: number) => void
}

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed'

export class ReconnectingWebSocketTransport implements RealtimeWebSocketTransport {
  private baseTransport: RealtimeWebSocketTransport
  private config: Required<Omit<ReconnectingTransportConfig, 'onConnectionStateChange' | 'onReconnectAttempt'>> & ReconnectingTransportConfig
  private connectionOptions: { url: string; headers: Record<string, string> } | null = null
  private connectionState: ConnectionState = 'disconnected'
  private retryCount = 0
  private reconnecting = false
  private closed = false

  constructor(
    baseTransport: RealtimeWebSocketTransport,
    config: ReconnectingTransportConfig = {}
  ) {
    this.baseTransport = baseTransport
    this.config = {
      maxRetries: config.maxRetries ?? 5,
      initialRetryDelayMs: config.initialRetryDelayMs ?? 1000,
      maxRetryDelayMs: config.maxRetryDelayMs ?? 30000,
      onConnectionStateChange: config.onConnectionStateChange,
      onReconnectAttempt: config.onReconnectAttempt,
    }
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState !== state) {
      this.connectionState = state
      console.log(`[ReconnectingWS] Connection state: ${state}`)
      this.config.onConnectionStateChange?.(state)
    }
  }

  async connect(options: { url: string; headers: Record<string, string> }): Promise<void> {
    this.connectionOptions = options
    this.closed = false
    this.retryCount = 0
    this.setConnectionState('connecting')

    try {
      await this.baseTransport.connect(options)
      this.setConnectionState('connected')
    } catch (error) {
      if (this.closed && error instanceof Error && error.message === 'WebSocket connection aborted') {
        this.setConnectionState('disconnected')
        return
      }
      console.error('[ReconnectingWS] Initial connection failed:', error)
      this.setConnectionState('disconnected')
      throw error
    }
  }

  async sendBinary(data: Uint8Array): Promise<void> {
    await this.ensureConnected()
    try {
      await this.baseTransport.sendBinary(data)
    } catch (error) {
      console.warn('[ReconnectingWS] Send binary failed, attempting reconnect:', error)
      await this.reconnect()
      await this.baseTransport.sendBinary(data)
    }
  }

  async sendText(data: string): Promise<void> {
    await this.ensureConnected()
    try {
      await this.baseTransport.sendText(data)
    } catch (error) {
      console.warn('[ReconnectingWS] Send text failed, attempting reconnect:', error)
      await this.reconnect()
      await this.baseTransport.sendText(data)
    }
  }

  async receive(timeoutMs?: number): Promise<RealtimeWebSocketReceiveResult> {
    const result = await this.baseTransport.receive(timeoutMs)

    if (result.closed && !this.closed) {
      console.log('[ReconnectingWS] Connection closed unexpectedly, attempting reconnect')
      try {
        await this.reconnect()
        return { timeout: true }
      } catch (error) {
        return { closed: true }
      }
    }

    return result
  }

  async close(): Promise<void> {
    this.closed = true
    this.setConnectionState('disconnected')
    await this.baseTransport.close()
  }

  
  getConnectionState(): ConnectionState {
    return this.connectionState
  }

  
  async forceReconnect(): Promise<void> {
    this.retryCount = 0
    await this.reconnect()
  }

  private async ensureConnected(): Promise<void> {
    if (this.connectionState !== 'connected' && !this.reconnecting) {
      if (this.connectionOptions) {
        await this.reconnect()
      } else {
        throw new Error('WebSocket not connected and no connection options available')
      }
    }
  }

  private async reconnect(): Promise<void> {
    if (this.reconnecting) {
      while (this.reconnecting) {
        await this.delay(100)
      }
      if (this.connectionState === 'connected') {
        return
      }
      throw new Error('Reconnection failed')
    }

    if (!this.connectionOptions) {
      throw new Error('No connection options available for reconnection')
    }

    if (this.closed) {
      throw new Error('Transport is closed')
    }

    this.reconnecting = true
    this.setConnectionState('reconnecting')

    try {
      while (this.retryCount < this.config.maxRetries) {
        this.retryCount++
        this.config.onReconnectAttempt?.(this.retryCount, this.config.maxRetries)
        console.log(`[ReconnectingWS] Reconnection attempt ${this.retryCount}/${this.config.maxRetries}`)

        const delay = Math.min(
          this.config.initialRetryDelayMs * Math.pow(2, this.retryCount - 1),
          this.config.maxRetryDelayMs
        )

        if (this.retryCount > 1) {
          console.log(`[ReconnectingWS] Waiting ${delay}ms before retry`)
          await this.delay(delay)
        }

        if (this.closed) {
          throw new Error('Transport closed during reconnection')
        }

        try {
          await this.baseTransport.close().catch(() => undefined)

          await this.baseTransport.connect(this.connectionOptions)

          this.setConnectionState('connected')
          this.retryCount = 0
          console.log('[ReconnectingWS] Reconnection successful')
          return
        } catch (error) {
          console.warn(`[ReconnectingWS] Reconnection attempt ${this.retryCount} failed:`, error)
        }
      }

      console.error(`[ReconnectingWS] Max retries (${this.config.maxRetries}) reached, giving up`)
      this.setConnectionState('failed')
      throw new Error(`WebSocket reconnection failed after ${this.config.maxRetries} attempts`)
    } finally {
      this.reconnecting = false
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}


export function createReconnectingTransport(
  baseTransport: RealtimeWebSocketTransport,
  config?: ReconnectingTransportConfig
): ReconnectingWebSocketTransport {
  return new ReconnectingWebSocketTransport(baseTransport, config)
}
