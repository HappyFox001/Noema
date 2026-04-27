/**
 * 支持自动重连的 WebSocket 传输层
 *
 * 特性：
 * - 指数退避重连（1s, 2s, 4s, 8s, 16s...）
 * - 最大重试次数限制
 * - 连接状态回调
 * - 发送失败自动重连
 */

import type {
  RealtimeWebSocketTransport,
  RealtimeWebSocketReceiveResult,
} from '@her-text/sdk'

export interface ReconnectingTransportConfig {
  /** 最大重试次数，默认 5 */
  maxRetries?: number
  /** 初始重试延迟（毫秒），默认 1000 */
  initialRetryDelayMs?: number
  /** 最大重试延迟（毫秒），默认 30000 */
  maxRetryDelayMs?: number
  /** 连接状态回调 */
  onConnectionStateChange?: (state: ConnectionState) => void
  /** 重连尝试回调 */
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
      // 重连后重试一次
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
      // 重连后重试一次
      await this.baseTransport.sendText(data)
    }
  }

  async receive(timeoutMs?: number): Promise<RealtimeWebSocketReceiveResult> {
    const result = await this.baseTransport.receive(timeoutMs)

    // 如果连接被关闭且不是主动关闭，尝试重连
    if (result.closed && !this.closed) {
      console.log('[ReconnectingWS] Connection closed unexpectedly, attempting reconnect')
      try {
        await this.reconnect()
        // 重连成功，返回超时结果让调用者重试
        return { timeout: true }
      } catch (error) {
        // 重连失败，返回关闭状态
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

  /**
   * 获取当前连接状态
   */
  getConnectionState(): ConnectionState {
    return this.connectionState
  }

  /**
   * 手动触发重连
   */
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
      // 等待正在进行的重连
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

        // 计算指数退避延迟
        const delay = Math.min(
          this.config.initialRetryDelayMs * Math.pow(2, this.retryCount - 1),
          this.config.maxRetryDelayMs
        )

        if (this.retryCount > 1) {
          console.log(`[ReconnectingWS] Waiting ${delay}ms before retry`)
          await this.delay(delay)
        }

        // 如果在等待期间被关闭，停止重连
        if (this.closed) {
          throw new Error('Transport closed during reconnection')
        }

        try {
          // 先关闭旧连接
          await this.baseTransport.close().catch(() => undefined)

          // 尝试重新连接
          await this.baseTransport.connect(this.connectionOptions)

          // 重连成功
          this.setConnectionState('connected')
          this.retryCount = 0
          console.log('[ReconnectingWS] Reconnection successful')
          return
        } catch (error) {
          console.warn(`[ReconnectingWS] Reconnection attempt ${this.retryCount} failed:`, error)
        }
      }

      // 达到最大重试次数
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

/**
 * 创建支持重连的 WebSocket 传输层
 */
export function createReconnectingTransport(
  baseTransport: RealtimeWebSocketTransport,
  config?: ReconnectingTransportConfig
): ReconnectingWebSocketTransport {
  return new ReconnectingWebSocketTransport(baseTransport, config)
}
