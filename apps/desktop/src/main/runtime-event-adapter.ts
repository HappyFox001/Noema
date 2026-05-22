/**
 * Adapts SDK runtime events to desktop task communication and renderer frames.
 */
import { logTaskRuntimeEvent } from './runtime-event-log.js'

type RuntimeConversationFrame =
  | { type: 'control.task_end'; success: boolean; summary: string; error?: string }

export interface RuntimeEventAdapterOptions {
  taskCommunicationManager: {
    onTaskStart(taskDescription: string): void
    onRunStateChanged(state: string, task: { taskDescription: string; originalUserInput: string }): void
    onPlanUpdated(plan: any): void
    onStepUpdated(step: any, plan: any): void
    onWorkSignal(signal: any): void
    onTaskEnd(result: { success: boolean; summary: string; error?: string }): void
  }
  handleWorkSurfaceRuntimeEvent(event: any): void
  sendConversationFrame(frame: RuntimeConversationFrame): void
}

export function handleDesktopRuntimeEvent(event: any, options: RuntimeEventAdapterOptions): void {
  logTaskRuntimeEvent(event)
  options.handleWorkSurfaceRuntimeEvent(event)
  if (event.name === 'task.started') {
    options.taskCommunicationManager.onTaskStart(event.payload?.taskDescription || 'Task')
    return
  }
  if (event.name === 'task.run_state.changed' && event.payload?.state) {
    options.taskCommunicationManager.onRunStateChanged(event.payload.state, {
      taskDescription: event.payload.taskDescription || 'Task',
      originalUserInput: event.payload.originalUserInput || '',
    })
    return
  }
  if (event.name === 'task.plan.updated' && event.payload?.plan) {
    options.taskCommunicationManager.onPlanUpdated(event.payload.plan)
    return
  }
  if (event.name === 'task.step.updated' && event.payload?.step && event.payload?.plan) {
    options.taskCommunicationManager.onStepUpdated(event.payload.step, event.payload.plan)
    return
  }
  if (event.name === 'work.signal.emitted' && event.payload?.signal) {
    options.taskCommunicationManager.onWorkSignal(event.payload.signal)
    return
  }
  if (event.name === 'task.completed' || event.name === 'task.failed') {
    const success = event.name === 'task.completed'
    const summary = event.payload?.finalMessage || event.payload?.summary || ''
    const result = {
      success,
      summary,
      ...(event.payload?.error ? { error: event.payload.error } : {}),
    }
    options.taskCommunicationManager.onTaskEnd(result)
    options.sendConversationFrame({
      type: 'control.task_end',
      ...result,
    })
  }
}
