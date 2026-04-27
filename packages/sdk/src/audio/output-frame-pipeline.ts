/**
 * Minimal ordered output frame pipeline.
 *
 * This mirrors the Pipecat idea that output events are frames instead of
 * scattered callbacks. It is intentionally transport-agnostic; Electron main
 * decides how frames are rendered or forwarded.
 */

export type OutputFrame =
  | { type: 'tts_started'; contextId: number; timestamp: number }
  | { type: 'tts_audio'; contextId: number; audio: Uint8Array; timestamp: number }
  | { type: 'tts_stopped'; contextId: number; timestamp: number }
  | { type: 'tts_error'; error: string; timestamp: number }
  | { type: 'interruption'; turnId: number; ttsContextId: number; timestamp: number }

export interface OutputFrameProcessor {
  processFrame(frame: OutputFrame): Promise<void> | void
}

export class OutputFramePipeline {
  private queue: Promise<void> = Promise.resolve()
  private processors: OutputFrameProcessor[] = []
  private stopped = false

  constructor(processors: OutputFrameProcessor[] = []) {
    this.processors = processors
  }

  setProcessors(processors: OutputFrameProcessor[]): void {
    this.processors = processors
  }

  queueFrame(frame: OutputFrame): Promise<void> {
    if (this.stopped) {
      return Promise.resolve()
    }

    if (frame.type === 'interruption') {
      this.queue = Promise.resolve()
    }

    const run = this.queue.then(async () => {
      if (this.stopped) {
        return
      }

      for (const processor of this.processors) {
        await processor.processFrame(frame)
        if (this.stopped) {
          return
        }
      }
    })

    this.queue = run.catch(() => undefined)
    return run
  }

  reset(): void {
    this.queue = Promise.resolve()
    this.stopped = false
  }

  stop(): void {
    this.stopped = true
    this.queue = Promise.resolve()
  }
}
