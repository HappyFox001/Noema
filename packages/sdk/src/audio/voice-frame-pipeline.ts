/**
 * Minimal ordered frame pipeline for voice input.
 *
 * This is intentionally small: it gives the desktop voice path one serialized
 * frame lane, so audio, ASR append, and VAD/turn detection no longer run as
 * independent async chains with undefined ordering.
 */

export type VoiceFrame =
  | {
      type: 'input_audio'
      sequence: number
      timestamp: number
      samples: Int16Array
    }
  | {
      type: 'transcription'
      timestamp: number
      text: string
      finalized: boolean
    }

export interface VoiceFrameProcessor {
  processFrame(frame: VoiceFrame): Promise<void> | void
}

export class VoiceFramePipeline {
  private queue: Promise<void> = Promise.resolve()
  private processors: VoiceFrameProcessor[] = []
  private stopped = false

  constructor(processors: VoiceFrameProcessor[] = []) {
    this.processors = processors
  }

  setProcessors(processors: VoiceFrameProcessor[]): void {
    this.processors = processors
  }

  queueFrame(frame: VoiceFrame): Promise<void> {
    if (this.stopped) {
      return Promise.resolve()
    }

    const run = this.queue
      .then(async () => {
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

  waitForIdle(): Promise<void> {
    return this.queue
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
