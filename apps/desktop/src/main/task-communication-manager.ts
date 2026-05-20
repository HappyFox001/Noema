/**
 * Coordinates user-facing communication during task execution.
 *
 * The task runtime remains the source of truth. This manager only translates
 * structured lifecycle events into throttled UI, display, and optional speech
 * signals for the desktop shell.
 */
import type {
  TaskPlan,
  TaskRunState,
  TaskRuntimeHookMeta,
  TaskStep,
  TaskUserInputRequest,
  WorkThreadPanelPlan,
} from '@her-text/sdk'

export type TaskCommunicationSeverity = 'silent' | 'info' | 'important' | 'blocking' | 'final'

export interface TaskCommunicationFrame {
  type: 'control.task_status'
  status: string
  message?: string
  severity: TaskCommunicationSeverity
}

export interface TaskCommunicationTurn {
  isCancelled: () => boolean
  sendPlan: (plan: TaskPlan | WorkThreadPanelPlan) => void
  sendStatus: (frame: TaskCommunicationFrame) => void
  displayText: (text: string) => void
  speak?: (text: string) => void
}

interface TaskCommunicationState {
  activeTask?: TaskRuntimeHookMeta
  taskStartedAt: number
  lastSpeechCompletedAt: number
  lastDisplayedAt: number
  lastStepId?: string
  lastStepStatus?: string
  spokenProgressStepIds: Set<string>
  displayedKeys: Set<string>
}

const DISPLAY_INTERVAL_MS = 8000
const PROGRESS_SPEECH_INTERVAL_MS = 12000

export class TaskCommunicationManager {
  private turn: TaskCommunicationTurn | null = null
  private state: TaskCommunicationState = this.createState()
  private planDecorator?: (plan: TaskPlan) => TaskPlan | WorkThreadPanelPlan

  bindTurn(turn: TaskCommunicationTurn): void {
    this.turn = turn
    this.state = this.createState()
  }

  setPlanDecorator(decorator: ((plan: TaskPlan) => TaskPlan | WorkThreadPanelPlan) | undefined): void {
    this.planDecorator = decorator
  }

  clearTurn(turn: TaskCommunicationTurn): void {
    if (this.turn === turn) {
      this.turn = null
      this.state = this.createState()
    }
  }

  onTaskStart(taskDescription: string): void {
    this.state = this.createState()
    this.emitStatus('Working', `正在处理：${taskDescription}`, 'silent', {
      display: false,
      speak: false,
    })
  }

  markSpeechBaseline(timestamp = Date.now()): void {
    this.state.lastSpeechCompletedAt = timestamp
  }

  markProgressSpeechScheduled(timestamp = Date.now()): void {
    this.state.lastSpeechCompletedAt = timestamp
  }

  onRunStateChanged(state: TaskRunState, task: TaskRuntimeHookMeta): void {
    this.state.activeTask = task

    if (state === 'tool_calling') {
      this.emitStatus('Working', undefined, 'silent')
      return
    }
    if (state === 'observing') {
      this.emitStatus('Observing', undefined, 'silent')
      return
    }
    if (state === 'completed') {
      this.emitStatus('Done', undefined, 'final')
      return
    }
    if (state === 'failed') {
      this.emitStatus('Failed', '任务执行失败。', 'final', {
        display: false,
        speak: false,
      })
      return
    }
    if (state === 'cancelled') {
      this.emitStatus('Cancelled', '任务已取消。', 'important')
      return
    }

    this.emitStatus('Working', undefined, 'silent')
  }

  onPlanUpdated(plan: TaskPlan): void {
    if (this.isUnavailable()) {
      return
    }
    this.turn?.sendPlan(this.decoratePlan(plan))
  }

  onStepUpdated(step: TaskStep, plan: TaskPlan): void {
    if (this.isUnavailable()) {
      return
    }

    this.turn?.sendPlan(this.decoratePlan(plan))

    const key = `${step.id}:${step.status}`
    if (step.status === 'running' && this.state.lastStepId !== step.id) {
      this.emitStatus('Working', `正在处理：${step.title}`, 'info', {
        key,
        display: false,
        speak: false,
      })
    } else if (step.status === 'completed') {
      this.emitStatus('Working', undefined, 'silent', {
        key,
        display: false,
        speak: false,
      })
    } else if (step.status === 'failed') {
      this.emitStatus('Working', `这个步骤没有成功：${step.title}`, 'important', {
        key,
        speak: true,
      })
    }

    this.state.lastStepId = step.id
    this.state.lastStepStatus = step.status
  }

  onWaitingUser(request: TaskUserInputRequest): void {
    const label = request.label || '需要补充信息'
    this.emitStatus('Need input', `我需要你补充：${label}`, 'blocking', {
      key: `waiting:${request.id}`,
      speak: true,
      forceDisplay: true,
    })
  }

  onTaskEnd(result: { success: boolean; summary: string; error?: string }): void {
    if (result.success) {
      this.emitStatus('Done', undefined, 'final')
      return
    }

    this.emitStatus('Failed', result.error || result.summary || '任务执行失败。', 'final', {
      key: 'task-end-failed',
      speak: false,
      display: false,
      forceDisplay: true,
    })
  }

  private shouldSpeakProgress(step: TaskStep): boolean {
    if (this.state.spokenProgressStepIds.has(step.id)) {
      return false
    }

    const now = Date.now()
    const elapsedSinceSpeech = now - this.state.lastSpeechCompletedAt

    return elapsedSinceSpeech >= PROGRESS_SPEECH_INTERVAL_MS
  }

  private emitStatus(
    status: string,
    message: string | undefined,
    severity: TaskCommunicationSeverity,
    options: { key?: string; display?: boolean; speak?: boolean; forceDisplay?: boolean } = {}
  ): void {
    if (this.isUnavailable()) {
      return
    }

    this.turn?.sendStatus({
      type: 'control.task_status',
      status,
      ...(message ? { message } : {}),
      severity,
    })

    if (!message) {
      return
    }

    const key = options.key || `${status}:${message}`
    const now = Date.now()
    const canSpeak = options.speak &&
      (severity === 'blocking' || severity === 'important' || severity === 'info')
    const canDisplay = options.display !== false && !canSpeak && (options.forceDisplay ||
      (!this.state.displayedKeys.has(key) && now - this.state.lastDisplayedAt >= DISPLAY_INTERVAL_MS)
    )
    if (canDisplay) {
      this.state.displayedKeys.add(key)
      this.state.lastDisplayedAt = now
      this.turn?.displayText(message)
    }

    if (canSpeak) {
      this.turn?.speak?.(message)
    }
  }

  private isUnavailable(): boolean {
    return !this.turn || this.turn.isCancelled()
  }

  private decoratePlan(plan: TaskPlan): TaskPlan | WorkThreadPanelPlan {
    return this.planDecorator?.(plan) ?? plan
  }

  private createState(): TaskCommunicationState {
    return {
      taskStartedAt: Date.now(),
      lastSpeechCompletedAt: Date.now(),
      lastDisplayedAt: 0,
      spokenProgressStepIds: new Set(),
      displayedKeys: new Set(),
    }
  }
}
