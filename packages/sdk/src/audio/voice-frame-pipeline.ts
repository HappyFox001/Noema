/**
 * Minimal ordered frame pipeline for voice input.
 *
 * This is intentionally small: it gives the desktop voice path one serialized
 * frame lane, so audio, ASR append, and VAD/turn detection no longer run as
 * independent async chains with undefined ordering.
 */

import type { UserTurnStoppedParams } from '../turn/types.js'
import type { STTProviderCapabilities } from './providers.js'
import { FramePipeline, type Frame, type FrameProcessor } from './frame-pipeline.js'

export type VoiceFrame = Frame & (
  | {
      type: 'stt_metadata'
      providerGeneration: number
      capabilities: STTProviderCapabilities
    }
  | {
      type: 'input_audio'
      sequence: number
      samples: Int16Array
    }
  | {
      type: 'transcription'
      providerGeneration: number
      voiceTurnId: number
      text: string
      finalized: boolean
    }
  | {
      type: 'vad_speech_stop'
      voiceTurnId: number
    }
  | {
      type: 'user_turn_start'
      voiceTurnId: number
    }
  | {
      type: 'user_turn_end'
      voiceTurnId: number
      params: UserTurnStoppedParams
    }
  | {
      type: 'interruption'
      voiceTurnId: number
      reason: 'vad_start' | 'transcript_start' | 'manual' | 'provider_switch'
    }
  | {
      type: 'user_turn_timeout'
      voiceTurnId: number
    }
  | {
      type: 'bot_thinking_start'
    }
  | {
      type: 'bot_thinking_end'
    }
  | {
      type: 'bot_started_speaking'
    }
  | {
      type: 'bot_stopped_speaking'
    }
)

export type VoiceFrameProcessor = FrameProcessor<VoiceFrame>

export class VoiceFramePipeline extends FramePipeline<VoiceFrame> {}
