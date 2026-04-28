/**
 * Shared ordered frame pipeline.
 *
 * Pipecat's core abstraction is not "voice callback vs TTS callback", but a
 * single ordered processor model where every event is a frame. Feature-specific
 * files define frame unions; this class provides the common processor/task lane.
 */

export type FrameKind = 'system' | 'control' | 'data'

export interface Frame {
  type: string
  kind: FrameKind
  timestamp: number
}

export function createFrame<TFrame extends Frame>(
  frame: Omit<TFrame, 'timestamp'> & { timestamp?: number }
): TFrame {
  return {
    ...frame,
    timestamp: frame.timestamp ?? Date.now(),
  } as TFrame
}

export interface FrameProcessor<TFrame extends Frame = Frame> {
  processFrame(frame: TFrame, context: FrameProcessContext): Promise<void> | void
}

export interface FrameObserver<TFrame extends Frame = Frame> {
  onFrame(frame: TFrame): void
}

export interface FramePipelineOptions {
  interruptFrameTypes?: string[]
}

export interface FrameProcessContext {
  signal: AbortSignal
}

export class FramePipeline<TFrame extends Frame = Frame> {
  private queue: Promise<void> = Promise.resolve()
  private processors: FrameProcessor<TFrame>[] = []
  private observers: FrameObserver<TFrame>[] = []
  private stopped = false
  private currentTaskAbortController: AbortController | null = null
  private readonly interruptFrameTypes: Set<string>

  constructor(
    processors: FrameProcessor<TFrame>[] = [],
    options: FramePipelineOptions = {}
  ) {
    this.processors = processors
    this.interruptFrameTypes = new Set(options.interruptFrameTypes ?? [
      'interruption',
      'response_interruption',
    ])
  }

  setProcessors(processors: FrameProcessor<TFrame>[]): void {
    this.processors = processors
  }

  addObserver(observer: FrameObserver<TFrame>): () => void {
    this.observers.push(observer)
    return () => {
      this.observers = this.observers.filter((entry) => entry !== observer)
    }
  }

  queueFrame(frame: TFrame): Promise<void> {
    if (this.stopped) {
      return Promise.resolve()
    }

    if (frame.kind === 'system' || this.interruptFrameTypes.has(frame.type)) {
      this.currentTaskAbortController?.abort()
      this.currentTaskAbortController = null
      this.queue = Promise.resolve()
    }

    const run = this.queue.then(async () => {
      if (this.stopped) {
        return
      }

      const taskAbortController = new AbortController()
      this.currentTaskAbortController = taskAbortController
      const context: FrameProcessContext = {
        signal: taskAbortController.signal,
      }

      try {
        for (const observer of this.observers) {
          observer.onFrame(frame)
        }

        for (const processor of this.processors) {
          if (context.signal.aborted) {
            return
          }

          await processor.processFrame(frame, context)

          if (this.stopped || context.signal.aborted) {
            return
          }
        }
      } finally {
        if (this.currentTaskAbortController === taskAbortController) {
          this.currentTaskAbortController = null
        }
      }
    })

    this.queue = run.catch(() => undefined)
    return run
  }

  waitForIdle(): Promise<void> {
    return this.queue
  }

  interrupt(): void {
    this.currentTaskAbortController?.abort()
    this.currentTaskAbortController = null
    this.queue = Promise.resolve()
  }

  reset(): void {
    this.interrupt()
    this.queue = Promise.resolve()
    this.stopped = false
  }

  stop(): void {
    this.interrupt()
    this.stopped = true
    this.queue = Promise.resolve()
  }
}
