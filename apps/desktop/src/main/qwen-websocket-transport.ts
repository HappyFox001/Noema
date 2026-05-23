import WebSocket from 'ws'
import type { RawData } from 'ws'
import type {
  RealtimeWebSocketReceiveResult,
  RealtimeWebSocketTransport
} from '@noema/sdk'

type PendingReceiver = {
  resolve: (value: RealtimeWebSocketReceiveResult) => void
  timeoutId: NodeJS.Timeout
}

export class NodeRealtimeWebSocketTransport implements RealtimeWebSocketTransport {
  private socket: WebSocket | null = null
  private queue: Uint8Array[] = []
  private closed = false
  private pendingReceivers: PendingReceiver[] = []
  private pendingConnectReject: ((error: Error) => void) | null = null

  async connect(options: {
    url: string
    headers: Record<string, string>
  }): Promise<void> {
    await this.close()
    this.closed = false
    this.queue = []

    await new Promise<void>((resolve, reject) => {
      this.pendingConnectReject = reject
      const socket = new WebSocket(options.url, {
        headers: options.headers
      })
      this.socket = socket

      socket.once('open', () => {
        this.pendingConnectReject = null
        resolve()
      })
      socket.once('error', (error: Error) => {
        this.pendingConnectReject = null
        reject(error)
      })

      socket.on('message', (data: RawData) => {
        const normalized = normalizeMessage(data)
        if (!normalized) {
          return
        }

        const receiver = this.pendingReceivers.shift()
        if (receiver) {
          clearTimeout(receiver.timeoutId)
          receiver.resolve({ data: normalized })
        } else {
          this.queue.push(normalized)
        }
      })

      socket.on('close', () => {
        this.closed = true
        if (this.pendingConnectReject) {
          const rejectPendingConnect = this.pendingConnectReject
          this.pendingConnectReject = null
          rejectPendingConnect(new Error('WebSocket was closed before the connection was established'))
        }
        while (this.pendingReceivers.length > 0) {
          const receiver = this.pendingReceivers.shift()!
          clearTimeout(receiver.timeoutId)
          receiver.resolve({ closed: true })
        }
      })
    })
  }

  async sendBinary(data: Uint8Array): Promise<void> {
    if (!this.socket || this.closed) {
      throw new Error('WebSocket is not connected')
    }

    await new Promise<void>((resolve, reject) => {
      this.socket!.send(data, (error?: Error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  async sendText(data: string): Promise<void> {
    if (!this.socket || this.closed) {
      throw new Error('WebSocket is not connected')
    }

    await new Promise<void>((resolve, reject) => {
      this.socket!.send(data, (error?: Error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  async receive(timeoutMs: number = 1000): Promise<RealtimeWebSocketReceiveResult> {
    if (this.queue.length > 0) {
      return { data: this.queue.shift() }
    }

    if (this.closed) {
      return { closed: true }
    }

    return await new Promise<RealtimeWebSocketReceiveResult>((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pendingReceivers = this.pendingReceivers.filter((entry) => entry.timeoutId !== timeoutId)
        resolve({ timeout: true })
      }, timeoutMs)

      this.pendingReceivers.push({ resolve, timeoutId })
    })
  }

  async close(): Promise<void> {
    if (!this.socket) {
      return
    }

    const socket = this.socket
    this.socket = null
    this.closed = true

    if (socket.readyState === WebSocket.CLOSED) {
      return
    }

    if (socket.readyState === WebSocket.CONNECTING) {
      socket.removeAllListeners('message')
      socket.on('error', () => undefined)

      try {
        socket.close()
      } catch {
        try {
          socket.terminate()
        } catch {
        }
      }

      if (this.pendingConnectReject) {
        const rejectPendingConnect = this.pendingConnectReject
        this.pendingConnectReject = null
        rejectPendingConnect(new Error('WebSocket connection aborted'))
      }

      while (this.pendingReceivers.length > 0) {
        const receiver = this.pendingReceivers.shift()!
        clearTimeout(receiver.timeoutId)
        receiver.resolve({ closed: true })
      }
      return
    }

    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve())
      socket.close()
    })
  }
}

function normalizeMessage(data: RawData): Uint8Array | null {
  if (typeof data === 'string') {
    return new TextEncoder().encode(data)
  }

  if (data instanceof Buffer) {
    return new Uint8Array(data)
  }

  if (Array.isArray(data)) {
    return new Uint8Array(Buffer.concat(data))
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }

  return null
}
