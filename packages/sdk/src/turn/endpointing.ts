

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
    } else {
      this.sttTimeoutTask = setTimeout(() => {
        this.sttTimeoutTask = null
        this.sttWaitDone = true
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

    this.userSpeechTimeoutTask = setTimeout(() => {
      this.userSpeechTimeoutTask = null
      this.userSpeechWaitDone = true
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
      }

      Promise.resolve(this.onUserTurnStopped(params)).catch((error) => {
        console.error('onUserTurnStopped callback failed:', error)
      })
    }
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
