/**
 * Minimal ordered output frame pipeline.
 *
 * This mirrors the Pipecat idea that output events are frames instead of
 * scattered callbacks. It is intentionally transport-agnostic; Electron main
 * decides how frames are rendered or forwarded.
 */

import { FramePipeline, type Frame, type FrameProcessor } from './frame-pipeline.js'

export type OutputFrame = Frame & (
  | { type: 'tts_started'; contextId: number }
  | { type: 'tts_audio'; contextId: number; audio: Uint8Array }
  | { type: 'tts_stopped'; contextId: number }
  | { type: 'tts_error'; error: string }
  | { type: 'interruption'; turnId: number; ttsContextId: number }
)

export type OutputFrameProcessor = FrameProcessor<OutputFrame>

export class OutputFramePipeline extends FramePipeline<OutputFrame> {}
