/**
 * Provides a replayable event stream for work turns.
 */
import type { RuntimeEvent, RuntimeEventBus, RuntimeEventUnsubscribe } from './events.js'

export type TurnEventStreamHandler = (event: RuntimeEvent) => void | Promise<void>

export interface TurnEventStreamOptions {
  events: RuntimeEventBus
  taskId?: string
  threadId?: string
  replayRecent?: boolean
  maxBufferedEvents?: number
}

export class TurnEventStream {
  private handlers = new Set<TurnEventStreamHandler>()
  private bufferedEvents: RuntimeEvent[] = []
  private unsubscribeFromBus?: RuntimeEventUnsubscribe

  constructor(private options: TurnEventStreamOptions) {
    if (options.replayRecent) {
      for (const event of options.events.getRecentEvents(options.maxBufferedEvents ?? 200)) {
        this.capture(event)
      }
    }
    this.unsubscribeFromBus = options.events.subscribe(event => {
      this.capture(event)
    })
  }

  subscribe(handler: TurnEventStreamHandler, replayBuffered = true): RuntimeEventUnsubscribe {
    this.handlers.add(handler)
    if (replayBuffered) {
      for (const event of this.bufferedEvents) {
        this.deliver(handler, event)
      }
    }
    return () => {
      this.handlers.delete(handler)
    }
  }

  getBufferedEvents(limit = this.options.maxBufferedEvents ?? 200): RuntimeEvent[] {
    return this.bufferedEvents.slice(-Math.max(1, limit))
  }

  close(): void {
    this.unsubscribeFromBus?.()
    this.unsubscribeFromBus = undefined
    this.handlers.clear()
  }

  private capture(event: RuntimeEvent): void {
    if (!this.matches(event)) {
      return
    }
    this.bufferedEvents.push(event)
    const maxBufferedEvents = this.options.maxBufferedEvents ?? 200
    if (this.bufferedEvents.length > maxBufferedEvents) {
      this.bufferedEvents.splice(0, this.bufferedEvents.length - maxBufferedEvents)
    }
    for (const handler of this.handlers) {
      this.deliver(handler, event)
    }
  }

  private matches(event: RuntimeEvent): boolean {
    if (!event.name.startsWith('task.')) {
      return false
    }
    if (this.options.taskId && event.taskId !== this.options.taskId) {
      return false
    }
    if (this.options.threadId && event.threadId !== this.options.threadId) {
      return false
    }
    return true
  }

  private deliver(handler: TurnEventStreamHandler, event: RuntimeEvent): void {
    try {
      Promise.resolve(handler(event)).catch(error => {
        console.warn('[TurnEventStream] Async handler failed:', error instanceof Error ? error.message : String(error))
      })
    } catch (error) {
      console.warn('[TurnEventStream] Handler failed:', error instanceof Error ? error.message : String(error))
    }
  }
}
