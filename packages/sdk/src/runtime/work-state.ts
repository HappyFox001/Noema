/**
 * Durable work-state types shared by task execution and interaction routing.
 */
import type { TaskPlan, TaskStep } from '../session/task-plan.js'
import type { ExecutionState, TaskObservation } from '../session/execution-state.js'
import type { EmotionalTurnRecord } from './boundaries.js'

export type WorkThreadStatus =
  | 'active'
  | 'paused'
  | 'waiting_user'
  | 'recoverable_failed'
  | 'abandoned'
  | 'completed'
  | 'cancelled'

export interface UserIntentRecord {
  input: string
  intent: string
  createdAt: number
}

export interface WorkArtifact {
  id: string
  type: 'file' | 'command' | 'browser' | 'desktop' | 'summary' | 'custom'
  path?: string
  description: string
  sourceStepId?: string
  verified?: boolean
  createdAt: number
}

export interface WorkDecision {
  id: string
  title: string
  facts: string[]
  alternatives?: string[]
  createdAt: number
}

export interface WorkFailure {
  id: string
  message: string
  evidence: string[]
  attemptedRoute?: string
  avoidNextTime?: string
  createdAt: number
}

export interface WorkNextAction {
  id: string
  title: string
  reason: string
  stepId?: string
  createdAt: number
}

export interface WorkThread {
  id: string
  goal: string
  status: WorkThreadStatus
  priority: number
  createdAt: number
  updatedAt: number
  lastFocusedAt?: number
  userIntentHistory: UserIntentRecord[]
  emotionalTurnHistory: EmotionalTurnRecord[]
  plan?: TaskPlan
  currentStep?: TaskStep
  executionState?: ExecutionState
  observations: TaskObservation[]
  artifacts: WorkArtifact[]
  decisions: WorkDecision[]
  failures: WorkFailure[]
  nextActions: WorkNextAction[]
  resumeSummary?: string
  abandonReason?: string
}

export interface WorkState {
  activeThreads: WorkThread[]
  pausedThreads: WorkThread[]
  abandonedThreads: WorkThread[]
  completedThreads: WorkThread[]
  focusedThreadId?: string
  updatedAt: number
}

export type WorkSignalKind =
  | 'progress'
  | 'blocked'
  | 'needs_user'
  | 'risk'
  | 'completed'
  | 'failed'
  | 'resumed'
  | 'abandoned'

export type WorkSignalSeverity =
  | 'silent'
  | 'ambient'
  | 'speak'
  | 'interrupt'

export interface WorkSignal {
  id: string
  threadId: string
  kind: WorkSignalKind
  severity: WorkSignalSeverity
  facts: Record<string, unknown>
  createdAt: number
}

export function createEmptyWorkState(timestamp = Date.now()): WorkState {
  return {
    activeThreads: [],
    pausedThreads: [],
    abandonedThreads: [],
    completedThreads: [],
    updatedAt: timestamp,
  }
}

