/**
 * Coordinates renderer audio playback completion waits for the main process.
 */
export class RendererPlaybackCoordinator {
  private requestIdCounter = 0
  private readonly resolvers = new Map<number, () => void>()

  constructor(
    private readonly options: {
      sendToRenderer(channel: string, ...args: unknown[]): void
      hasRenderer(): boolean
      onPlaybackComplete?(): void
    }
  ) {}

  async waitForPlayback(timeoutMs = 30000): Promise<void> {
    if (!this.options.hasRenderer()) {
      return
    }

    const requestId = ++this.requestIdCounter
    console.log('[Playback] Requesting playback complete wait, requestId:', requestId)

    return new Promise((resolve) => {
      this.resolvers.set(requestId, resolve)
      this.options.sendToRenderer('playback:waitRequest', requestId)

      setTimeout(() => {
        if (this.resolvers.has(requestId)) {
          console.log('[Playback] Wait timeout, requestId:', requestId)
          this.resolvers.delete(requestId)
          resolve()
        }
      }, timeoutMs)
    })
  }

  async waitForPlaybackOrAbort(signal: AbortSignal, timeoutMs = 30000): Promise<void> {
    if (!this.options.hasRenderer() || signal.aborted) {
      return
    }

    const requestId = ++this.requestIdCounter
    console.log('[Playback] Requesting abortable playback complete wait, requestId:', requestId)

    return new Promise((resolve) => {
      let settled = false
      let timeout: ReturnType<typeof setTimeout> | null = null

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout)
          timeout = null
        }
        signal.removeEventListener('abort', onAbort)
        this.resolvers.delete(requestId)
      }
      const settle = () => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        resolve()
      }
      const onAbort = () => {
        console.log('[Playback] Wait aborted, requestId:', requestId)
        settle()
      }

      this.resolvers.set(requestId, settle)
      signal.addEventListener('abort', onAbort, { once: true })
      this.options.sendToRenderer('playback:waitRequest', requestId)

      timeout = setTimeout(() => {
        if (!settled) {
          console.log('[Playback] Wait timeout, requestId:', requestId)
          settle()
        }
      }, timeoutMs)
    })
  }

  complete(requestId: number): void {
    console.log('[Playback] Received complete notification, requestId:', requestId)
    const resolver = this.resolvers.get(requestId)
    if (resolver) {
      this.resolvers.delete(requestId)
      resolver()
    }
    this.options.onPlaybackComplete?.()
  }
}
