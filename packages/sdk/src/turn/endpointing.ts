

import {
  EndpointingConfig,
  TranscriptionFrame,
  UserTurnStoppedParams,
  IEndpointingStrategy,
  DEFAULT_ENDPOINTING_CONFIG,
} from './types.js'
import { mergeFinalTranscriptText } from './transcription-text.js'


export class EndpointingStrategy implements IEndpointingStrategy {
  private config: EndpointingConfig

  private text = ''
  private vadUserSpeaking = false
  private transcriptFinalized = false
  private vadStoppedTime: number | null = null

  private userSpeechTimeoutTask: ReturnType<typeof setTimeout> | null = null
  private sttTimeoutTask: ReturnType<typeof setTimeout> | null = null
  private userSpeechWaitDone = false
  private sttWaitDone = false
  private turnStopTriggered = false
  private userSpeechWaitReason: 'user_speech_timeout' | null = null
  private sttWaitReason:
    | 'final_transcript'
    | 'final_transcript_without_vad_stop'
    | 'stt_wait_timeout'
    | 'no_stt_wait_needed'
    | null = null

  onUserTurnStopped: ((params: UserTurnStoppedParams) => void | Promise<void>) | null = null

  constructor(config?: Partial<EndpointingConfig>) {
    this.config = { ...DEFAULT_ENDPOINTING_CONFIG, ...config }
  }

  
  setConfig(config: Partial<EndpointingConfig>): void {
    this.config = { ...this.config, ...config }
  }

  
  getConfig(): EndpointingConfig {
    return { ...this.config }
  }

  
  reset(): void {
    this.text = ''
    this.vadUserSpeaking = false
    this.transcriptFinalized = false
    this.vadStoppedTime = null
    this.userSpeechWaitDone = false
    this.sttWaitDone = false
    this.turnStopTriggered = false
    this.userSpeechWaitReason = null
    this.sttWaitReason = null
    this.cancelAllTasks()
  }

  
  cleanup(): void {
    this.cancelAllTasks()
    this.onUserTurnStopped = null
  }

  
  handleVADUserStartedSpeaking(): void {
    this.vadUserSpeaking = true
    this.transcriptFinalized = false
    this.vadStoppedTime = null
    this.userSpeechWaitDone = false
    this.sttWaitDone = false
    this.userSpeechWaitReason = null
    this.sttWaitReason = null
    this.cancelAllTasks()
  }

  
  handleVADUserStoppedSpeaking(stopSecs: number, timestamp?: number): void {
    this.vadUserSpeaking = false
    this.vadStoppedTime = timestamp ?? Date.now()

    this.restartUserSpeechTimer()

    this.sttWaitDone = false

    // Wait less for STT when VAD already observed enough trailing silence.
    const effectiveSttWait = Math.max(
      0,
      this.config.sttTimeoutMs - stopSecs * 1000
    )

    if (this.transcriptFinalized || effectiveSttWait <= 0) {
      this.sttWaitDone = true
      this.sttWaitReason = this.transcriptFinalized ? 'final_transcript' : 'no_stt_wait_needed'
    } else {
      this.sttTimeoutTask = setTimeout(() => {
        this.sttTimeoutTask = null
        this.sttWaitDone = true
        this.sttWaitReason = 'stt_wait_timeout'
        this.maybeTriggerUserTurnStopped()
      }, effectiveSttWait)
    }
  }

  
  handleTranscription(frame: TranscriptionFrame): void {
    if (frame.finalized) {
      this.mergeTranscriptionText(frame)
      this.transcriptFinalized = true

      if (!this.sttWaitDone) {
        this.sttWaitDone = true
        this.sttWaitReason = 'final_transcript'
        if (this.sttTimeoutTask) {
          clearTimeout(this.sttTimeoutTask)
          this.sttTimeoutTask = null
        }
      }
    }

    if (this.userSpeechWaitDone && this.sttWaitDone) {
      this.maybeTriggerUserTurnStopped()
      return
    }

    if (!this.vadUserSpeaking && this.vadStoppedTime === null) {
      this.sttWaitDone = true
      this.sttWaitReason = 'final_transcript_without_vad_stop'
      this.restartUserSpeechTimer()
    }
  }

  
  getText(): string {
    return this.text
  }

  
  hasText(): boolean {
    return this.text.length > 0
  }

  
  private restartUserSpeechTimer(): void {
    if (this.userSpeechTimeoutTask) {
      clearTimeout(this.userSpeechTimeoutTask)
      this.userSpeechTimeoutTask = null
    }

    this.userSpeechWaitDone = false
    this.userSpeechWaitReason = null

    this.userSpeechTimeoutTask = setTimeout(() => {
      this.userSpeechTimeoutTask = null
      this.userSpeechWaitDone = true
      this.userSpeechWaitReason = 'user_speech_timeout'
      this.maybeTriggerUserTurnStopped()
    }, this.config.userSpeechTimeout)
  }

  
  private mergeTranscriptionText(frame: TranscriptionFrame): void {
    this.text = mergeFinalTranscriptText(this.text, frame.text)
  }

  
  private maybeTriggerUserTurnStopped(): void {
    if (this.vadUserSpeaking) {
      return
    }

    if (this.turnStopTriggered) {
      return
    }

    if (this.config.sttTimeoutMs > 0 && !this.text) {
      return
    }

    if (!this.userSpeechWaitDone || !this.sttWaitDone) {
      return
    }

    if (this.onUserTurnStopped) {
      this.turnStopTriggered = true
      const params: UserTurnStoppedParams = {
        text: this.text,
        enableUserSpeakingFrames: true,
        endpointing: {
          strategy: 'fixed_timeout',
          reason: this.describeStopReason(),
        },
      }

      Promise.resolve(this.onUserTurnStopped(params)).catch((error) => {
        console.error('onUserTurnStopped callback failed:', error)
      })
    }
  }

  private describeStopReason(): string {
    const userSpeechReason = this.userSpeechWaitReason ?? 'unknown_user_speech_wait'
    const sttReason = this.sttWaitReason ?? (this.transcriptFinalized ? 'final_transcript' : 'unknown_stt_wait')
    return `${userSpeechReason}+${sttReason}`
  }

  
  private cancelAllTasks(): void {
    if (this.userSpeechTimeoutTask) {
      clearTimeout(this.userSpeechTimeoutTask)
      this.userSpeechTimeoutTask = null
    }
    if (this.sttTimeoutTask) {
      clearTimeout(this.sttTimeoutTask)
      this.sttTimeoutTask = null
    }
  }
}
