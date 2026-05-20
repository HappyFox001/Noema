/**
 * Work execution primitives that will replace the legacy task loop incrementally.
 */
import { generateId } from '@her-text/core'
import type { Tool } from '@her-text/types'
import type { RuntimeEventBus } from './events.js'
import { ToolOrchestrator, type ToolExecutionResult } from './tool-orchestrator.js'
import { ToolRouter, type RoutedToolCall, type WorkToolCall } from './tool-router.js'
import type { WorkStateStore } from './work-store.js'

export type WorkTaskStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface WorkTask {
  id: string
  threadId: string
  description: string
  status: WorkTaskStatus
  createdAt: number
  updatedAt: number
}

export interface WorkTurn {
  id: string
  taskId: string
  index: number
  startedAt: number
  completedAt?: number
  toolCalls: RoutedToolCall[]
  toolResults: ToolExecutionResult[]
  needsFollowUp: boolean
}

export interface WorkSessionOptions {
  events: RuntimeEventBus
  workState: WorkStateStore
  tools?: Tool[]
}

export class WorkSession {
  private tasks = new Map<string, WorkTask>()
  private router: ToolRouter
  private tools: Tool[]
  private toolOrchestrator: ToolOrchestrator

  constructor(private options: WorkSessionOptions) {
    this.tools = options.tools ?? []
    this.router = new ToolRouter(this.tools)
    this.toolOrchestrator = new ToolOrchestrator({
      events: options.events,
      tools: this.tools,
      router: this.router,
    })
  }

  setTools(tools: Tool[]): void {
    this.tools = tools
    this.router.setTools(tools)
    this.toolOrchestrator.setTools(tools)
  }

  getToolRouter(): ToolRouter {
    return this.router
  }

  createTask(threadId: string, description: string): WorkTask {
    const now = Date.now()
    const task: WorkTask = {
      id: generateId(),
      threadId,
      description,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    }
    this.tasks.set(task.id, task)
    return { ...task }
  }

  startTurn(taskId: string, index: number): WorkTurn {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error(`Unknown work task: ${taskId}`)
    }
    const now = Date.now()
    task.status = 'running'
    task.updatedAt = now
    this.options.events.emit({
      name: 'task.turn.started',
      threadId: task.threadId,
      taskId: task.id,
      payload: {
        turnIndex: index,
        taskDescription: task.description,
      },
    })
    return {
      id: generateId(),
      taskId,
      index,
      startedAt: now,
      toolCalls: [],
      toolResults: [],
      needsFollowUp: false,
    }
  }

  async executeTurnTools(turn: WorkTurn, calls: WorkToolCall[], signal?: AbortSignal): Promise<ToolExecutionResult[]> {
    const task = this.tasks.get(turn.taskId)
    if (!task) {
      throw new Error(`Unknown work task: ${turn.taskId}`)
    }
    return this.toolOrchestrator.executeCalls(calls, {
      threadId: task.threadId,
      taskId: task.id,
      taskDescription: task.description,
      signal,
    })
  }

  completeTurn(turn: WorkTurn, calls: WorkToolCall[], needsFollowUp: boolean, toolResults: ToolExecutionResult[] = []): WorkTurn {
    const task = this.tasks.get(turn.taskId)
    if (!task) {
      throw new Error(`Unknown work task: ${turn.taskId}`)
    }
    const routedCalls = calls.map(call => this.router.route(call))
    const completed: WorkTurn = {
      ...turn,
      completedAt: Date.now(),
      toolCalls: routedCalls,
      toolResults,
      needsFollowUp,
    }
    this.options.events.emit({
      name: 'task.turn.completed',
      threadId: task.threadId,
      taskId: task.id,
      payload: {
        turnIndex: completed.index,
        taskDescription: task.description,
        completed: !needsFollowUp,
        toolCalls: routedCalls.length,
      },
    })
    return completed
  }

  updateTaskStatus(taskId: string, status: WorkTaskStatus): WorkTask | undefined {
    const task = this.tasks.get(taskId)
    if (!task) {
      return undefined
    }
    task.status = status
    task.updatedAt = Date.now()
    return { ...task }
  }
}
