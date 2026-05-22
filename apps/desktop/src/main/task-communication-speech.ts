/**
 * Schedules task progress/result speech through the desktop response pipeline.
 */
import {
  ResponseDisplayProcessor,
  ResponseTTSProcessor,
  type PluginRuntimeContext,
} from '@her-text/sdk'

type TaskCommunicationPhase = 'task_progress' | 'task_result'

interface TaskCommunicationDisplayController {
  startPhase(phase: TaskCommunicationPhase): void
  endPhase(phase: TaskCommunicationPhase): Promise<void>
  pushTextDelta(delta: string): void
  startTask(taskDescription: string): void
  endTask(result: { success: boolean; summary: string; error?: string }): void
  pushTTSChunkText(text: string): void
}

export interface TaskCommunicationSpeechSchedulerOptions {
  sanitizeTextForSpeech(text: string): string
  isTurnCancelled(turnId: number): boolean
  isRecoverableTTSError(error: Error): boolean
  getVoiceOutputEnabled(): boolean
  getTTSAvailable(): boolean
  setTTSAvailable(available: boolean): void
  getTTSService(): any
  getSdk(): { transformText(target: 'tts_input' | 'display', text: string, runtime?: PluginRuntimeContext): string } | null
  getCurrentResponseFramePipeline(): any
  setCurrentResponseFramePipeline(pipeline: any): void
  voiceGraphPipeline: {
    createResponseLane(name: string): any
    removeLane(name: string): void
  }
  frameTraceObserver: any
  getPluginRuntimeContext(enabled: boolean): PluginRuntimeContext
  createDisplayController(turnId: number): TaskCommunicationDisplayController
  waitForRendererPlaybackOrAbort(signal: AbortSignal): Promise<void>
  markProgressSpeechScheduled(): void
  nextTTSChunkSequence(): number
}

export class TaskCommunicationSpeechScheduler {
  private queue: Promise<void> = Promise.resolve()

  constructor(private options: TaskCommunicationSpeechSchedulerOptions) {}

  schedule(
    text: string,
    turnId: number,
    phase: TaskCommunicationPhase = 'task_progress'
  ): void {
    const content = this.options.sanitizeTextForSpeech(text)
    if (!content || !this.options.getVoiceOutputEnabled() || !this.options.getTTSAvailable()) {
      return
    }

    this.queue = this.queue
      .catch(() => undefined)
      .then(async () => {
        if (
          this.options.isTurnCancelled(turnId) ||
          !this.options.getTTSAvailable() ||
          !this.options.getVoiceOutputEnabled()
        ) {
          return
        }
        const currentPipeline = this.options.getCurrentResponseFramePipeline()
        if (!currentPipeline) {
          await this.playThroughResponsePipeline(content, turnId, phase)
          this.options.markProgressSpeechScheduled()
          return
        }
        await currentPipeline.queueFrame({
          type: 'phase_start',
          kind: 'control',
          phase,
          timestamp: Date.now(),
        })
        await currentPipeline.queueFrame({
          type: 'tts_text',
          kind: 'data',
          text: content,
          timestamp: Date.now(),
        })
        await currentPipeline.queueFrame({
          type: 'phase_end',
          kind: 'control',
          phase,
          timestamp: Date.now(),
        })
        this.options.markProgressSpeechScheduled()
      })
      .catch((error) => {
        console.warn('[TaskCommunication] Failed to schedule task update speech:', (error as Error).message)
      })
  }

  private async playThroughResponsePipeline(
    content: string,
    turnId: number,
    phase: TaskCommunicationPhase = 'task_progress'
  ): Promise<void> {
    const sdk = this.options.getSdk()
    if (!sdk || !this.options.getTTSAvailable() || !this.options.getVoiceOutputEnabled()) {
      return
    }

    const laneName = `task-feedback:${turnId}:${Date.now()}`
    const responseFramePipeline = this.options.voiceGraphPipeline.createResponseLane(laneName)
    responseFramePipeline.addObserver(this.options.frameTraceObserver)

    const pluginContext = this.options.getPluginRuntimeContext(true)
    const displayController = this.options.createDisplayController(turnId)
    const previousResponseFramePipeline = this.options.getCurrentResponseFramePipeline()
    if (!previousResponseFramePipeline) {
      this.options.setCurrentResponseFramePipeline(responseFramePipeline)
    }

    try {
      responseFramePipeline.setProcessors([
        new ResponseTTSProcessor({
          isCancelled: () => this.options.isTurnCancelled(turnId),
          isEnabled: () => this.options.getVoiceOutputEnabled() && this.options.getTTSAvailable(),
          getService: () => this.options.getTTSService(),
          sanitizeText: this.options.sanitizeTextForSpeech,
          transformTTSInput: (text) => sdk.transformText('tts_input', text, pluginContext),
          toDisplayText: (text) => sdk.transformText('display', text, pluginContext),
          onText: (textFrame, displayText) => {
            const sequence = this.options.nextTTSChunkSequence()
            console.log(`[Main] TTS text frame #${turnId}:${sequence}, pushing:`, JSON.stringify(textFrame))
            displayController.pushTTSChunkText(displayText)
          },
          onError: (error) => {
            if (this.options.isRecoverableTTSError(error)) {
              console.warn('[TTS] Recoverable frame error ignored:', error.message)
              return
            }
            this.options.setTTSAvailable(false)
          },
          waitForPlayback: async (phase) => {
            if (this.options.isTurnCancelled(turnId)) {
              return
            }
            console.log(`[Conversation] Waiting for playback to complete before ending phase "${phase}"...`)
            await this.options.waitForRendererPlaybackOrAbort(new AbortController().signal)
            if (this.options.isTurnCancelled(turnId)) {
              return
            }
            console.log(`[Conversation] Playback complete for phase "${phase}"`)
          },
          log: (message) => console.warn(message),
        }),
        new ResponseDisplayProcessor({
          isCancelled: () => this.options.isTurnCancelled(turnId),
          startPhase: (phase) => displayController.startPhase(phase as TaskCommunicationPhase),
          endPhase: (phase) => displayController.endPhase(phase as TaskCommunicationPhase),
          pushTextDelta: (delta) => displayController.pushTextDelta(delta),
          startTask: (taskDescription) => displayController.startTask(taskDescription),
          endTask: (result) => displayController.endTask(result),
        }),
      ])

      await responseFramePipeline.queueFrame({
        type: 'phase_start',
        kind: 'control',
        phase,
        timestamp: Date.now(),
      })
      await responseFramePipeline.queueFrame({
        type: 'tts_text',
        kind: 'data',
        text: content,
        timestamp: Date.now(),
      })
      await responseFramePipeline.queueFrame({
        type: 'phase_end',
        kind: 'control',
        phase,
        timestamp: Date.now(),
      })
      await responseFramePipeline.waitForIdle()
    } catch (error: any) {
      if (this.options.isRecoverableTTSError(error)) {
        console.warn('[TaskCommunication] Recoverable task feedback TTS error ignored:', error.message)
        return
      }
      this.options.setTTSAvailable(false)
      console.warn('[TaskCommunication] Task feedback response pipeline failed:', error.message)
    } finally {
      if (this.options.getCurrentResponseFramePipeline() === responseFramePipeline) {
        this.options.setCurrentResponseFramePipeline(previousResponseFramePipeline)
      }
      this.options.voiceGraphPipeline.removeLane(laneName)
    }
  }
}
