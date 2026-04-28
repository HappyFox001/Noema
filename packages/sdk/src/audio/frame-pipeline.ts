/**
 * Shared ordered frame pipeline.
 *
 * Pipecat's core abstraction is not "voice callback vs TTS callback", but a
 * single ordered processor model where every event is a frame. Feature-specific
 * files define frame unions; this class provides the common processor/task lane.
 */

export interface Frame {
  type: string
  timestamp: number
}

export interface FrameProcessor<TFrame extends Frame = Frame> {
  processFrame(frame: TFrame, context: FrameProcessContext): Promise<void> | void
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

  queueFrame(frame: TFrame): Promise<void> {
    if (this.stopped) {
      return Promise.resolve()
    }

    if (this.interruptFrameTypes.has(frame.type)) {
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

  reset(): void {
    this.currentTaskAbortController?.abort()
    this.currentTaskAbortController = null
    this.queue = Promise.resolve()
    this.stopped = false
  }

  stop(): void {
    this.currentTaskAbortController?.abort()
    this.currentTaskAbortController = null
    this.stopped = true
    this.queue = Promise.resolve()
  }
}
