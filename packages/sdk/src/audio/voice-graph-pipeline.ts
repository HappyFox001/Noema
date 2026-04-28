import { FramePipeline, type Frame } from './frame-pipeline.js'
import { VoiceFrame, VoiceFramePipeline } from './voice-frame-pipeline.js'
import { ResponseFrame, ResponseFramePipeline } from './response-frame-pipeline.js'
import { OutputFrame, OutputFramePipeline } from './output-frame-pipeline.js'

export type VoiceGraphFrame = VoiceFrame | ResponseFrame | OutputFrame

export class VoiceGraphPipeline {
  private lanes = new Map<string, FramePipeline<any>>()

  createInputLane(name = 'input'): VoiceFramePipeline {
    return this.registerLane(name, new VoiceFramePipeline())
  }

  createResponseLane(name = 'response'): ResponseFramePipeline {
    return this.registerLane(name, new ResponseFramePipeline())
  }

  createOutputLane(name = 'output'): OutputFramePipeline {
    return this.registerLane(name, new OutputFramePipeline())
  }

  registerLane<TFrame extends Frame, TPipeline extends FramePipeline<TFrame>>(
    name: string,
    pipeline: TPipeline
  ): TPipeline {
    this.lanes.set(name, pipeline)
    return pipeline
  }

  removeLane(name: string): void {
    const lane = this.lanes.get(name)
    lane?.stop()
    this.lanes.delete(name)
  }

  broadcastInterruption(): void {
    for (const lane of this.lanes.values()) {
      lane.interrupt()
    }
  }

  stop(): void {
    for (const lane of this.lanes.values()) {
      lane.stop()
    }
    this.lanes.clear()
  }
}
