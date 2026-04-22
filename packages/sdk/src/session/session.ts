import type { LLMProvider } from '@her-text/core'
import { generateId } from '@her-text/core'
import type { AgentCore } from '../agent/index.js'
import type { ContextManager } from '../context/index.js'
import type { MemoryEngine } from '../memory/index.js'
import type { PersonalityEngine } from '../personality/index.js'
import {
  TaskRuntime,
  type TaskRunResult,
  type TaskTurnRecord,
} from './task.js'

export type SessionTaskStatus = 'idle' | 'running' | 'completed' | 'errored'

export interface SessionTaskSnapshot {
  taskId: string | null
  status: SessionTaskStatus
  taskDescription: string | null
  originalUserInput: string | null
  turnCount: number
  toolCalls: number
  compactSummary: string | null
  recentTurns: TaskTurnRecord[]
  lastError?: string
}

export class TaskSession {
  private snapshot: SessionTaskSnapshot = {
    taskId: null,
    status: 'idle',
    taskDescription: null,
    originalUserInput: null,
    turnCount: 0,
    toolCalls: 0,
    compactSummary: null,
    recentTurns: []
  }

  constructor(
    private llm: LLMProvider,
    private memory: MemoryEngine,
    private personality: PersonalityEngine,
    private agent: AgentCore,
    private context: ContextManager
  ) {}

  async runTask(taskDescription: string, originalUserInput: string): Promise<TaskRunResult> {
    this.snapshot = {
      taskId: generateId(),
      status: 'running',
      taskDescription,
      originalUserInput,
      turnCount: 0,
      toolCalls: 0,
      compactSummary: null,
      recentTurns: []
    }

    const memoryContext = await this.memory.retrieve(originalUserInput)
    const runtime = new TaskRuntime(
      this.llm,
      this.agent,
      this.personality,
      this.context,
      taskDescription,
      originalUserInput,
      memoryContext,
      {
        onTurnCompleted: (turn) => {
          this.snapshot.turnCount = turn.turnIndex
          this.snapshot.toolCalls += turn.toolCalls.length
          this.snapshot.recentTurns = [...this.snapshot.recentTurns, turn].slice(-6)
        },
        onStatusChanged: (status) => {
          this.snapshot.status = status
        },
        onCompact: (summary) => {
          this.snapshot.compactSummary = summary
        }
      }
    )

    const result = await runtime.run()
    if (!result.success) {
      this.snapshot.lastError = result.error
    }
    return result
  }

  getSnapshot(): SessionTaskSnapshot {
    return {
      ...this.snapshot,
      recentTurns: [...this.snapshot.recentTurns]
    }
  }
}
