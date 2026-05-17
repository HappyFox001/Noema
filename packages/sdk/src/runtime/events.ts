/**
 * Runtime event backbone shared by dialogue, task, output, and learning layers.
 */
import { generateId } from '@her-text/core'
import type { TaskPlan, TaskRunState, TaskStep } from '../session/task-plan.js'

export type RuntimeEventName =
  | 'interaction.turn.started'
  | 'interaction.turn.completed'
  | 'interaction.turn.aborted'
  | 'dialogue.intent.detected'
  | 'dialogue.reply.completed'
  | 'task.started'
  | 'task.run_state.changed'
  | 'task.plan.updated'
  | 'task.step.updated'
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
  payload: TPayload
}

export type RuntimeEvent =
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
  | RuntimeEventBase<'task.completed', {
      taskDescription: string
      originalUserInput: string
      finalMessage: string
      iterations: number
      toolCalls: number
    }>
  | RuntimeEventBase<'task.failed', {
      taskDescription: string
      originalUserInput: string
      finalMessage: string
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
