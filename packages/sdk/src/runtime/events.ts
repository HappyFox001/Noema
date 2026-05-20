/**
 * Runtime event backbone shared by dialogue, task, output, and learning layers.
 */
import { generateId } from '@her-text/core'
import type { TaskExecutorKind } from '../session/task.js'
import type { TaskPlan, TaskRunState, TaskStep } from '../session/task-plan.js'
import type { FeedbackDecision } from './boundaries.js'
import type { InteractionIntent, UserInterruptionKind } from './interaction.js'
import type { WorkArtifact, WorkDecision, WorkFailure, WorkSignal, WorkState, WorkThread } from './work-state.js'

export type RuntimeEventName =
  | 'interaction.input.received'
  | 'interaction.turn.started'
  | 'interaction.turn.completed'
  | 'interaction.turn.aborted'
  | 'interaction.intent.resolved'
  | 'interaction.speech.stop_requested'
  | 'interaction.speech.mute_requested'
  | 'interaction.work.modify_requested'
  | 'interaction.work.status_requested'
  | 'interaction.work.resume_requested'
  | 'interaction.work.cancel_requested'
  | 'dialogue.intent.detected'
  | 'dialogue.reply.completed'
  | 'work.thread.created'
  | 'work.thread.focused'
  | 'work.thread.paused'
  | 'work.thread.resumed'
  | 'work.thread.abandoned'
  | 'work.state.snapshot'
  | 'work.signal.emitted'
  | 'work.artifact.created'
  | 'work.decision.recorded'
  | 'work.failure.recorded'
  | 'task.started'
  | 'task.run_state.changed'
  | 'task.plan.updated'
  | 'task.step.updated'
  | 'task.turn.started'
  | 'task.turn.completed'
  | 'task.tool.started'
  | 'task.tool.completed'
  | 'task.tool.failed'
  | 'task.command.started'
  | 'task.command.stdout'
  | 'task.command.stderr'
  | 'task.command.completed'
  | 'task.patch.started'
  | 'task.patch.completed'
  | 'task.patch.failed'
  | 'task.context.compacted'
  | 'task.pending_input.added'
  | 'task.completed'
  | 'task.failed'
  | 'agent.created'
  | 'agent.routed'
  | 'agent.completed'
  | 'runtime.job.queued'
  | 'runtime.job.running'
  | 'runtime.job.completed'
  | 'runtime.job.failed'
  | 'runtime.job.cancelled'

export interface RuntimeEventBase<TName extends RuntimeEventName, TPayload> {
  id: string
  name: TName
  timestamp: number
  correlationId?: string
  turnId?: string
  taskId?: string
  threadId?: string
  goalId?: string
  payload: TPayload
}

export type RuntimeEvent =
  | RuntimeEventBase<'interaction.input.received', {
      userInput: string
      inputTimestamp: number
      source?: 'text' | 'voice' | 'system'
    }>
  | RuntimeEventBase<'interaction.turn.started', {
      userInput: string
      inputTimestamp: number
    }>
  | RuntimeEventBase<'interaction.turn.completed', {
      userInput: string
      assistantText: string
    }>
  | RuntimeEventBase<'interaction.turn.aborted', {
      userInput: string
      preservedUserInput: boolean
    }>
  | RuntimeEventBase<'interaction.intent.resolved', {
      userInput: string
      intents: InteractionIntent[]
      interruptionKind: UserInterruptionKind
      feedbackDecision?: FeedbackDecision
    }>
  | RuntimeEventBase<'interaction.speech.stop_requested', {
      reason: string
    }>
  | RuntimeEventBase<'interaction.speech.mute_requested', {
      muted: boolean
      reason: string
    }>
  | RuntimeEventBase<'interaction.work.modify_requested', {
      targetThreadId?: string
      modification: string
      reason: string
    }>
  | RuntimeEventBase<'interaction.work.status_requested', {
      targetThreadId?: string
      reason: string
    }>
  | RuntimeEventBase<'interaction.work.resume_requested', {
      targetThreadId?: string
      reason: string
    }>
  | RuntimeEventBase<'interaction.work.cancel_requested', {
      targetThreadId?: string
      reason: string
    }>
  | RuntimeEventBase<'dialogue.intent.detected', {
      hasTask: boolean
      taskDescription?: string
      hasTools: boolean
      emotionTag?: string
    }>
  | RuntimeEventBase<'dialogue.reply.completed', {
      phase: 'reply' | 'task_progress' | 'task_result'
      text: string
      emotionTag?: string
    }>
  | RuntimeEventBase<'work.thread.created', {
      thread: WorkThread
    }>
  | RuntimeEventBase<'work.thread.focused', {
      threadId: string
      previousThreadId?: string
      reason: string
    }>
  | RuntimeEventBase<'work.thread.paused', {
      threadId: string
      reason: string
      snapshot: WorkThread
    }>
  | RuntimeEventBase<'work.thread.resumed', {
      threadId: string
      reason: string
      snapshot: WorkThread
    }>
  | RuntimeEventBase<'work.thread.abandoned', {
      threadId: string
      reason: string
      snapshot: WorkThread
    }>
  | RuntimeEventBase<'work.state.snapshot', {
      state: WorkState
      reason: string
    }>
  | RuntimeEventBase<'work.signal.emitted', {
      signal: WorkSignal
    }>
  | RuntimeEventBase<'work.artifact.created', {
      threadId: string
      artifact: WorkArtifact
    }>
  | RuntimeEventBase<'work.decision.recorded', {
      threadId: string
      decision: WorkDecision
    }>
  | RuntimeEventBase<'work.failure.recorded', {
      threadId: string
      failure: WorkFailure
    }>
  | RuntimeEventBase<'task.started', {
      taskDescription: string
      originalUserInput: string
    }>
  | RuntimeEventBase<'task.run_state.changed', {
      state: TaskRunState
      taskDescription: string
      originalUserInput: string
    }>
  | RuntimeEventBase<'task.plan.updated', {
      plan: TaskPlan
      taskDescription: string
      originalUserInput: string
    }>
  | RuntimeEventBase<'task.step.updated', {
      step: TaskStep
      plan: TaskPlan
      taskDescription: string
      originalUserInput: string
    }>
  | RuntimeEventBase<'task.turn.started', {
      turnIndex: number
      taskDescription: string
      stepId?: string
      stepTitle?: string
    }>
  | RuntimeEventBase<'task.turn.completed', {
      turnIndex: number
      taskDescription: string
      completed: boolean
      toolCalls: number
    }>
  | RuntimeEventBase<'task.tool.started', {
      toolName: string
      callId: string
      taskDescription: string
      stepId?: string
    }>
  | RuntimeEventBase<'task.tool.completed', {
      toolName: string
      callId: string
      taskDescription: string
      success: boolean
      summary?: string
    }>
  | RuntimeEventBase<'task.tool.failed', {
      toolName: string
      callId: string
      taskDescription: string
      error: string
    }>
  | RuntimeEventBase<'task.command.started', {
      sessionId: string
      command: string
      args: string[]
      cwd?: string
      status: string
    }>
  | RuntimeEventBase<'task.command.stdout', {
      sessionId: string
      command: string
      args: string[]
      cwd?: string
      status: string
      chunk: string
    }>
  | RuntimeEventBase<'task.command.stderr', {
      sessionId: string
      command: string
      args: string[]
      cwd?: string
      status: string
      chunk: string
    }>
  | RuntimeEventBase<'task.command.completed', {
      sessionId: string
      command: string
      args: string[]
      cwd?: string
      status: string
      exitCode?: number | null
      signal?: NodeJS.Signals | null
      error?: string
    }>
  | RuntimeEventBase<'task.patch.started', {
      patchId: string
      changedFiles: string[]
      checkOnly: boolean
    }>
  | RuntimeEventBase<'task.patch.completed', {
      patchId: string
      changedFiles: string[]
      checkOnly: boolean
    }>
  | RuntimeEventBase<'task.patch.failed', {
      patchId: string
      changedFiles: string[]
      error: string
    }>
  | RuntimeEventBase<'task.context.compacted', {
      taskDescription: string
      summary: string
      reason: string
    }>
  | RuntimeEventBase<'task.pending_input.added', {
      taskDescription: string
      inputKind: string
      label: string
    }>
  | RuntimeEventBase<'task.completed', {
      taskDescription: string
      originalUserInput: string
      finalMessage: string
      executor?: TaskExecutorKind
      iterations: number
      toolCalls: number
    }>
  | RuntimeEventBase<'task.failed', {
      taskDescription: string
      originalUserInput: string
      finalMessage: string
      executor?: TaskExecutorKind
      error?: string
      iterations: number
      toolCalls: number
    }>
  | RuntimeEventBase<'agent.created', {
      agentId: string
      mode: 'soft' | 'hard'
      status: string
      purpose: string
    }>
  | RuntimeEventBase<'agent.routed', {
      agentId: string
      task: string
    }>
  | RuntimeEventBase<'agent.completed', {
      agentId: string
      success: boolean
      summary: string
      error?: string
    }>
  | RuntimeEventBase<'runtime.job.queued', {
      jobId: string
      kind: string
      status: 'queued'
    }>
  | RuntimeEventBase<'runtime.job.running', {
      jobId: string
      kind: string
      status: 'running'
    }>
  | RuntimeEventBase<'runtime.job.completed', {
      jobId: string
      kind: string
      status: 'completed'
    }>
  | RuntimeEventBase<'runtime.job.failed', {
      jobId: string
      kind: string
      status: 'failed'
      error?: string
    }>
  | RuntimeEventBase<'runtime.job.cancelled', {
      jobId: string
      kind: string
      status: 'cancelled'
      error?: string
    }>

export type RuntimeEventInput<TEvent extends RuntimeEvent = RuntimeEvent> =
  Omit<TEvent, 'id' | 'timestamp'>

export type RuntimeEventHandler = (event: RuntimeEvent) => void | Promise<void>
export type RuntimeEventUnsubscribe = () => void

export class RuntimeEventBus {
  private handlers = new Set<RuntimeEventHandler>()
  private recentEvents: RuntimeEvent[] = []

  constructor(private maxRecentEvents = 500) {}

  subscribe(handler: RuntimeEventHandler): RuntimeEventUnsubscribe {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  emit<TEvent extends RuntimeEvent>(input: RuntimeEventInput<TEvent>): TEvent {
    const event = {
      ...input,
      id: generateId(),
      timestamp: Date.now(),
    } as TEvent

    this.recentEvents.push(event)
    if (this.recentEvents.length > this.maxRecentEvents) {
      this.recentEvents.splice(0, this.recentEvents.length - this.maxRecentEvents)
    }

    for (const handler of this.handlers) {
      try {
        Promise.resolve(handler(event)).catch((error) => {
          console.warn('[RuntimeEventBus] Async event handler failed:', formatRuntimeEventError(error))
        })
      } catch (error) {
        console.warn('[RuntimeEventBus] Event handler failed:', formatRuntimeEventError(error))
      }
    }

    return event
  }

  getRecentEvents(limit = this.maxRecentEvents): RuntimeEvent[] {
    return this.recentEvents.slice(-Math.max(1, Math.min(this.maxRecentEvents, limit)))
  }

  clearRecentEvents(): void {
    this.recentEvents = []
  }
}

function formatRuntimeEventError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
