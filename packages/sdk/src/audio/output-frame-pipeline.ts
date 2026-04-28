/**
 * Minimal ordered output frame pipeline.
 *
 * This mirrors the Pipecat idea that output events are frames instead of
 * scattered callbacks. It is intentionally transport-agnostic; Electron main
 * decides how frames are rendered or forwarded.
 */

import { FramePipeline, type Frame, type FrameProcessor } from './frame-pipeline.js'

export type OutputFrame = Frame & (
  | { type: 'tts_started'; contextId: number; providerGeneration: number }
  | { type: 'tts_audio'; contextId: number; providerGeneration: number; audio: Uint8Array }
  | { type: 'tts_stopped'; contextId: number; providerGeneration: number }
  | { type: 'tts_error'; error: string; providerGeneration?: number }
  | { type: 'audio_playback_started' }
  | {
      type: 'interruption'
      turnId: number
      ttsContextId: number
      reason: 'vad_start' | 'transcript_start' | 'manual' | 'provider_switch'
    }
)

export type OutputFrameProcessor = FrameProcessor<OutputFrame>

export class OutputFramePipeline extends FramePipeline<OutputFrame> {}
