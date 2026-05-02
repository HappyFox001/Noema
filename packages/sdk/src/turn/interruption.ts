

import { InterruptionHandler } from './types.js'


export class InterruptionManager {
  private handlers: Set<InterruptionHandler> = new Set()
  private _isInterrupted = false

  
  register(handler: InterruptionHandler): void {
    this.handlers.add(handler)
  }

  
  unregister(handler: InterruptionHandler): void {
    this.handlers.delete(handler)
  }

  
  clear(): void {
    this.handlers.clear()
  }

  
  async triggerInterruption(): Promise<void> {
    if (this._isInterrupted) {
      return
    }

    this._isInterrupted = true

    const handlers = Array.from(this.handlers)

    if (handlers.length === 0) {
      this._isInterrupted = false
      return
    }

    try {
      const results = await Promise.allSettled(
        handlers.map((handler) => handler.onInterruption())
      )

      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        if (result.status === 'rejected') {
          console.error(
            `Interruption handler failed:`,
            result.reason
          )
        }
      }
    } finally {
      this._isInterrupted = false
    }
  }

  
  reset(): void {
    this._isInterrupted = false
  }

  
  get isInterrupted(): boolean {
    return this._isInterrupted
  }

}
