/**
 * Task runtime adapter contract.
 *
 * Lets the task lifecycle keep one model while swapping the execution backend.
 */
import type { LLMProvider } from '@her-text/core'
import type { AgentCore } from '../agent/index.js'
import type { ContextManager } from '../context/index.js'
import type { ConversationSummary, UserProfile } from '../memory/index.js'
import type { PersonalityEngine } from '../personality/index.js'
import type { RuntimeEventBus } from '../runtime/events.js'
import type { ToolRouter } from '../runtime/tool-router.js'
import type { WorkStateStore } from '../runtime/work-store.js'
import type {
  TaskContextItem,
  TaskRunResult,
  TaskRuntimeConfig,
  TaskRuntimeHooks,
  TaskTurnRecord,
} from './task.js'
import type { TaskPlan, TaskRunState, TaskStep } from './task-plan.js'

export interface TaskRuntimeRequest {
  taskId: string
  taskDescription: string
  originalUserInput: string
  taskContextItems: TaskContextItem[]
  memoryContext: {
    userProfile: UserProfile
    summaries: ConversationSummary[]
  }
  config: TaskRuntimeConfig
  signal: AbortSignal
  dependencies: {
    llm: LLMProvider
    agent: AgentCore
    personality: PersonalityEngine
    context: ContextManager
    runtimeEvents?: RuntimeEventBus
    workState?: WorkStateStore
    toolRouter?: ToolRouter
  }
}

export interface TaskRuntimeAdapterHooks {
  onTurnCompleted?: (turn: TaskTurnRecord) => void
  onStatusChanged?: TaskRuntimeHooks['onStatusChanged']
  onRunStateChanged?: (state: TaskRunState) => void
  onPlanUpdated?: (plan: TaskPlan) => void
  onStepUpdated?: (step: TaskStep, plan: TaskPlan) => void
  onCompact?: (summary: string) => void
  onLog?: (chunk: { stream: 'stdout' | 'stderr' | 'system'; text: string }) => void
  onUserInputRequest?: TaskRuntimeHooks['onUserInputRequest']
}

export interface TaskRuntimeAdapter {
  id: string
  label?: string
  canHandle?(request: TaskRuntimeRequest): boolean | Promise<boolean>
  run(request: TaskRuntimeRequest, hooks: TaskRuntimeAdapterHooks): Promise<TaskRunResult>
}

export const WORK_TASK_RUNTIME_ADAPTER_ID = 'work_runtime'
export const LEGACY_TASK_RUNTIME_ADAPTER_ID = 'legacy_tool_loop'
export const BUILTIN_TASK_RUNTIME_ADAPTER_ID = LEGACY_TASK_RUNTIME_ADAPTER_ID
export const LEGACY_TASK_RUNTIME_ADAPTER_ALIASES = ['builtin_tool_loop']
