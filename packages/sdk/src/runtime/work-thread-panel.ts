/**
 * Builds a task-panel view model from durable work threads.
 */
import type { TaskPlan } from '../session/task-plan.js'
import type { WorkState, WorkThread, WorkThreadStatus } from './work-state.js'

export interface WorkThreadPanelPlan {
  id: string
  title: string
  summary: string
  steps: Array<{
    id: string
    title: string
    description: string
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
    result?: string
    error?: string
  }>
  threads: WorkThreadPanelItem[]
  currentThread?: WorkThreadPanelItem
  currentStep?: string
  lastObservation?: string
  nextAction?: string
}

export interface WorkThreadPanelItem {
  id: string
  goal: string
  status: WorkThreadStatus
  bucket: 'active' | 'paused' | 'waiting' | 'recoverable_failed' | 'completed' | 'abandoned'
  focused: boolean
  updatedAt: number
}

export function buildWorkThreadPanelPlan(state: WorkState, fallbackPlan?: TaskPlan): WorkThreadPanelPlan {
  const threads = collectPanelThreads(state)
  const focused = threads.find(thread => thread.focused) ?? threads[0]
  const sourceThread = findWorkThread(state, focused?.id)
  const plan = sourceThread?.plan ?? fallbackPlan
  return {
    id: plan?.id ?? focused?.id ?? 'work-threads',
    title: focused ? 'Work Threads' : 'Task',
    summary: focused?.goal ?? plan?.title ?? 'No active work thread',
    steps: (plan?.steps ?? []).map(step => ({
      id: step.id,
      title: step.title,
      description: step.description,
      status: step.status,
      result: step.result,
      error: step.error,
    })),
    threads,
    currentThread: focused,
    currentStep: sourceThread?.currentStep?.title,
    lastObservation: sourceThread?.observations.at(-1)?.summary,
    nextAction: sourceThread?.nextActions.at(-1)?.title,
  }
}

function collectPanelThreads(state: WorkState): WorkThreadPanelItem[] {
  return [
    ...state.activeThreads.map(thread => toPanelThread(thread, state.focusedThreadId, thread.status === 'waiting_user' ? 'waiting' : 'active')),
    ...state.pausedThreads.map(thread => toPanelThread(thread, state.focusedThreadId, thread.status === 'recoverable_failed' ? 'recoverable_failed' : 'paused')),
    ...state.completedThreads.map(thread => toPanelThread(thread, state.focusedThreadId, 'completed')),
    ...state.abandonedThreads.map(thread => toPanelThread(thread, state.focusedThreadId, 'abandoned')),
  ].sort((left, right) => Number(right.focused) - Number(left.focused) || right.updatedAt - left.updatedAt)
}

function toPanelThread(thread: WorkThread, focusedThreadId: string | undefined, bucket: WorkThreadPanelItem['bucket']): WorkThreadPanelItem {
  return {
    id: thread.id,
    goal: thread.goal,
    status: thread.status,
    bucket,
    focused: thread.id === focusedThreadId,
    updatedAt: thread.updatedAt,
  }
}

function findWorkThread(state: WorkState, id?: string): WorkThread | undefined {
  if (!id) {
    return undefined
  }
  return [
    ...state.activeThreads,
    ...state.pausedThreads,
    ...state.completedThreads,
    ...state.abandonedThreads,
  ].find(thread => thread.id === id)
}
