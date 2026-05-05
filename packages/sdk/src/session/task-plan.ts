/**
 * Task planning model.
 *
 * Defines the runtime plan, step statuses, and state graph used by task
 * execution. The model is intentionally small so tools, browser automation,
 * MCP, and skills can all attach to the same task lifecycle.
 */

export type TaskRunState =
  | 'planning'
  | 'plan_ready'
  | 'step_running'
  | 'tool_calling'
  | 'observing'
  | 'replanning'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type TaskStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'

export interface TaskStep {
  id: string
  title: string
  description: string
  status: TaskStepStatus
  startedAt?: number
  completedAt?: number
}

export interface TaskPlan {
  id: string
  title: string
  summary: string
  steps: TaskStep[]
  createdAt: number
  updatedAt: number
}

export interface TaskPlanDraft {
  title?: string
  summary?: string
  steps?: Array<{
    title?: string
    description?: string
  }>
}
