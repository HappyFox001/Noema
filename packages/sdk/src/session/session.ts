import type { LLMProvider } from '@her-text/core'
import { generateId } from '@her-text/core'
import type { AgentCore } from '../agent/index.js'
import type { ContextManager } from '../context/index.js'
import type { MemoryEngine } from '../memory/index.js'
import type { PersonalityEngine } from '../personality/index.js'
import { mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import {
  parseJsonValue,
  runSqlite,
  runSqliteJson,
  sqlText,
} from '../memory/sqlite-runtime.js'
import {
  TaskRuntime,
  type TaskContextItem,
  type TaskRunResult,
  type TaskRuntimeConfig,
  type TaskRuntimeHooks,
  type TaskTurnRecord,
} from './task.js'
import type { TaskIntent } from '../dialogue/processors.js'
import type { TaskPlan, TaskRunState } from './task-plan.js'

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
  runState?: TaskRunState
  plan?: TaskPlan | null
  lastError?: string
  finalSummary?: string
}

interface TaskRunRow {
  task_id: string
  status: SessionTaskStatus
  task_description: string
  original_user_input: string
  turn_count: number
  tool_calls: number
  compact_summary: string | null
  runtime_state: TaskRunState | null
  plan_json: string | null
  last_error: string | null
  final_summary: string | null
}

interface TaskTurnRow {
  turn_index: number
  assistant_message: string
  tool_calls: string
  tool_results: string
  completed: number
  step_id: string | null
  step_title: string | null
}

interface ActiveTaskRun {
  taskId: string
  taskIntent: TaskIntent
  originalUserInput: string
  abortController: AbortController
  promise: Promise<TaskRunResult>
}

interface QueuedTaskRun {
  taskId: string
  taskIntent: TaskIntent
  originalUserInput: string
  taskContextItems: TaskContextItem[]
}

interface TaskAdmissionDecision {
  action: 'start_now' | 'keep_active' | 'queue_new' | 'stop_active_start_new'
  reason: string
}

const TASK_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS task_runs (
  task_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'errored')),
  task_description TEXT NOT NULL,
  original_user_input TEXT NOT NULL,
  turn_count INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  compact_summary TEXT,
  runtime_state TEXT,
  plan_json TEXT,
  last_error TEXT,
  final_summary TEXT
);

CREATE TABLE IF NOT EXISTS task_turns (
  task_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  assistant_message TEXT NOT NULL,
  tool_calls TEXT NOT NULL,
  tool_results TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  step_id TEXT,
  step_title TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, turn_index)
);
`

export class TaskSession {
  private snapshot: SessionTaskSnapshot = {
    taskId: null,
    status: 'idle',
    taskDescription: null,
    originalUserInput: null,
    turnCount: 0,
    toolCalls: 0,
    compactSummary: null,
    recentTurns: [],
    runState: undefined,
    plan: null
  }
  private persistenceEnabled = false
  private persistenceDbPath: string
  private writeQueue: Promise<void> = Promise.resolve()
  private activeTaskRun: ActiveTaskRun | null = null
  private taskQueue: QueuedTaskRun[] = []
  private queueDrainPromise: Promise<void> | null = null
  private queueDrainSuspended = false

  constructor(
    private llm: LLMProvider,
    private memory: MemoryEngine,
    private personality: PersonalityEngine,
    private agent: AgentCore,
    private context: ContextManager,
    storageDir: string,
    private runtimeHooks: Pick<TaskRuntimeHooks, 'onUserInputRequest' | 'onPlanUpdated' | 'onStepUpdated'> = {},
    private taskRuntimeConfig: TaskRuntimeConfig = {}
  ) {
    const resolvedStorageDir = isAbsolute(storageDir)
      ? storageDir
      : resolve(process.cwd(), storageDir)
    this.persistenceDbPath = resolve(resolvedStorageDir, 'tasks.sqlite3')
  }

  async initialize(): Promise<void> {
    try {
      await mkdir(dirname(this.persistenceDbPath), { recursive: true })
      console.log('[TaskSession] Storage directory:', dirname(this.persistenceDbPath))
      console.log('[TaskSession] Database path:', this.persistenceDbPath)
      await runSqlite(this.persistenceDbPath, TASK_SCHEMA_SQL)
      await this.migrateSchema()
      this.persistenceEnabled = true
      await this.recoverLatestSnapshot()
      console.log('[TaskSession] Initialized with SQLite persistence')
    } catch (error) {
      console.error('[TaskSession] Failed to initialize persistence:', error)
      console.log('[TaskSession] Continuing in memory-only mode')
    }
  }

  async runTask(
    taskIntent: TaskIntent,
    originalUserInput: string,
    taskContextItems: TaskContextItem[] = []
  ): Promise<TaskRunResult> {
    if (this.isSameTaskIntent(this.activeTaskRun?.taskIntent, taskIntent) || this.findSameQueuedTask(taskIntent)) {
      console.log('[TaskSession] Keeping existing task by local duplicate check')
      return {
        success: true,
        iterations: 0,
        toolCalls: 0,
        finalMessage: '相同任务已经在执行或队列中，我会继续原来的任务。',
        plan: this.snapshot.plan ?? undefined
      }
    }

    if (this.activeTaskRun) {
      const decision = await this.decideTaskAdmission(taskIntent, originalUserInput)
      if (decision.action === 'keep_active') {
        console.log(`[TaskSession] Keeping active task: ${decision.reason}`)
        return {
          success: true,
          iterations: 0,
          toolCalls: 0,
          finalMessage: '相同任务已经在执行或队列中，我会继续原来的任务。',
          plan: this.snapshot.plan ?? undefined
        }
      }

      if (decision.action === 'queue_new') {
        console.log(`[TaskSession] Queueing new task behind active task: ${decision.reason}`)
        this.enqueueTask(taskIntent, originalUserInput, taskContextItems)
        return {
          success: true,
          iterations: 0,
          toolCalls: 0,
          finalMessage: '这个任务我先排队，等当前任务完成后继续。',
          plan: this.snapshot.plan ?? undefined
        }
      } else if (decision.action === 'stop_active_start_new') {
        console.log(`[TaskSession] Stopping active task before new task: ${decision.reason}`)
        const active = this.activeTaskRun
        this.queueDrainSuspended = true
        active.abortController.abort()
        await active.promise.catch(() => undefined)
        if (this.activeTaskRun?.taskId === active.taskId) {
          this.activeTaskRun = null
        }
        this.queueDrainSuspended = false
      }
    }

    return await this.startTaskRun(taskIntent, originalUserInput, taskContextItems)
  }

  private isSameTaskIntent(existing: TaskIntent | undefined, incoming: TaskIntent): boolean {
    if (!existing) {
      return false
    }
    const existingText = normalizeTaskIntentText(existing.description)
    const incomingText = normalizeTaskIntentText(incoming.description)
    return Boolean(existingText && incomingText && existingText === incomingText)
  }

  private findSameQueuedTask(taskIntent: TaskIntent): QueuedTaskRun | null {
    return this.taskQueue.find(item => this.isSameTaskIntent(item.taskIntent, taskIntent)) ?? null
  }

  private enqueueTask(
    taskIntent: TaskIntent,
    originalUserInput: string,
    taskContextItems: TaskContextItem[]
  ): QueuedTaskRun {
    const queued: QueuedTaskRun = {
      taskId: generateId(),
      taskIntent,
      originalUserInput,
      taskContextItems,
    }
    this.taskQueue.push(queued)
    this.drainTaskQueue()
    return queued
  }

  private drainTaskQueue(): void {
    if (this.queueDrainPromise) {
      return
    }

    this.queueDrainPromise = this.runQueuedTasks()
      .catch((error) => {
        console.error('[TaskSession] Task queue failed:', error)
      })
      .finally(() => {
        this.queueDrainPromise = null
        if (!this.activeTaskRun && this.taskQueue.length > 0) {
          this.drainTaskQueue()
        }
      })
  }

  private async runQueuedTasks(): Promise<void> {
    if (this.activeTaskRun) {
      await this.activeTaskRun.promise.catch(() => undefined)
    }

    while (!this.activeTaskRun && this.taskQueue.length > 0) {
      const next = this.taskQueue.shift()
      if (!next) {
        return
      }

      console.log(`[TaskSession] Starting queued task #${next.taskId}: ${next.taskIntent.description}`)
      await this.startTaskRun(next.taskIntent, next.originalUserInput, next.taskContextItems, next.taskId)
        .catch((error) => {
          console.error(`[TaskSession] Queued task #${next.taskId} failed:`, error)
        })
    }
  }

  private async startTaskRun(
    taskIntent: TaskIntent,
    originalUserInput: string,
    taskContextItems: TaskContextItem[],
    requestedTaskId?: string
  ): Promise<TaskRunResult> {
    const taskId = requestedTaskId ?? generateId()
    const abortController = new AbortController()
    const taskDescription = taskIntent.description
    this.snapshot = {
      taskId,
      status: 'running',
      taskDescription,
      originalUserInput,
      turnCount: 0,
      toolCalls: 0,
      compactSummary: null,
      recentTurns: [],
      runState: 'planning',
      plan: null,
      finalSummary: undefined
    }
    await this.persistSnapshot()

    const runPromise = this.executeTaskRun(
      taskDescription,
      originalUserInput,
      taskContextItems,
      abortController.signal
    )
    this.activeTaskRun = {
      taskId,
      taskIntent,
      originalUserInput,
      abortController,
      promise: runPromise
    }

    try {
      return await runPromise
    } finally {
      if (this.activeTaskRun?.taskId === taskId) {
        this.activeTaskRun = null
        if (!this.queueDrainSuspended) {
          this.drainTaskQueue()
        }
      }
    }
  }

  private async executeTaskRun(
    taskDescription: string,
    originalUserInput: string,
    taskContextItems: TaskContextItem[],
    signal: AbortSignal
  ): Promise<TaskRunResult> {
    const memoryContext = await this.memory.retrieve(originalUserInput)
    const runtime = new TaskRuntime(
      this.llm,
      this.agent,
      this.personality,
      this.context,
      taskDescription,
      originalUserInput,
      memoryContext,
      taskContextItems,
      {
        onTurnCompleted: (turn) => {
          this.snapshot.turnCount = turn.turnIndex
          this.snapshot.toolCalls += turn.toolCalls.length
          this.snapshot.recentTurns = [...this.snapshot.recentTurns, turn].slice(-6)
          this.persistTurn(turn)
          this.persistSnapshot()
        },
        onStatusChanged: (status) => {
          this.snapshot.status = status
          this.persistSnapshot()
        },
        onRunStateChanged: (state) => {
          this.snapshot.runState = state
          this.persistSnapshot()
        },
        onPlanUpdated: (plan) => {
          this.snapshot.plan = cloneTaskPlan(plan)
          this.persistSnapshot()
          this.runtimeHooks.onPlanUpdated?.(cloneTaskPlan(plan))
        },
        onStepUpdated: (step, plan) => {
          this.snapshot.plan = cloneTaskPlan(plan)
          this.persistSnapshot()
          this.runtimeHooks.onStepUpdated?.(JSON.parse(JSON.stringify(step)) as typeof step, cloneTaskPlan(plan))
        },
        onCompact: (summary) => {
          this.snapshot.compactSummary = summary
          this.persistSnapshot()
        },
        onUserInputRequest: this.runtimeHooks.onUserInputRequest
      },
      this.taskRuntimeConfig,
      signal
    )

    const result = await runtime.run()
    if (!result.success) {
      this.snapshot.lastError = result.error
    }
    if (result.plan) {
      this.snapshot.plan = cloneTaskPlan(result.plan)
    }
    this.snapshot.finalSummary = result.finalMessage
    this.persistSnapshot()
    return result
  }

  getSnapshot(): SessionTaskSnapshot {
    return {
      ...this.snapshot,
      recentTurns: [...this.snapshot.recentTurns],
      plan: this.snapshot.plan ? cloneTaskPlan(this.snapshot.plan) : null
    }
  }

  async shutdown(): Promise<void> {
    this.taskQueue = []
    this.activeTaskRun?.abortController.abort()
    await this.queueDrainPromise?.catch(() => undefined)
    await this.writeQueue
  }

  private async decideTaskAdmission(
    newTaskIntent: TaskIntent,
    newUserInput: string
  ): Promise<TaskAdmissionDecision> {
    const active = this.activeTaskRun
    if (!active) {
      return { action: 'start_now', reason: 'no active task' }
    }

    try {
      const response = await this.llm.chat([
        {
          role: 'system',
          content: [
            '你是任务调度器。根据正在执行的任务和新任务，决定任务管理动作。',
            '只输出 JSON object，不要 Markdown。',
            '格式：{"action":"keep_active|queue_new|stop_active_start_new","reason":"一句话原因"}',
            'keep_active：新任务和正在执行或已排队任务是同一目标的重复、催促、补充状态询问或轻微改写。',
            'queue_new：新任务和正在执行、已排队任务都不同，且不紧急，可以等待当前任务完成后执行。',
            'stop_active_start_new：新任务不同且更紧急、替代原目标、或用户明确要求切换。'
          ].join('\n')
        },
        {
          role: 'user',
          content: [
            '正在执行的任务：',
            active.taskIntent.description,
            '',
            '触发原任务的用户输入：',
            active.originalUserInput,
            '',
            '当前任务状态快照：',
            JSON.stringify({
              status: this.snapshot.status,
              runState: this.snapshot.runState,
              plan: this.snapshot.plan,
              recentTurns: this.snapshot.recentTurns.slice(-3).map((turn) => ({
                turnIndex: turn.turnIndex,
                stepTitle: turn.stepTitle,
                completed: turn.completed,
                assistantMessage: turn.assistantMessage.slice(0, 300)
              }))
            }, null, 2),
            '',
            '已排队任务：',
            JSON.stringify(this.taskQueue.map(item => ({
              taskId: item.taskId,
              description: item.taskIntent.description,
              originalUserInput: item.originalUserInput
            })), null, 2),
            '',
            '新任务：',
            newTaskIntent.description,
            '',
            '新用户输入：',
            newUserInput
          ].join('\n')
        }
      ], {
        max_tokens: 200
      })

      return normalizeAdmissionDecision(parseTaskAdmission(response.content))
    } catch (error) {
      console.warn(`[TaskSession] Task admission failed, queueing new task: ${(error as Error).message}`)
      return {
        action: 'queue_new',
        reason: 'admission comparison failed'
      }
    }
  }

  private persistTurn(turn: TaskTurnRecord): void {
    if (!this.persistenceEnabled || !this.snapshot.taskId) {
      return
    }

    this.enqueuePersist(async () => {
      await runSqlite(
        this.persistenceDbPath,
        `
        INSERT OR REPLACE INTO task_turns (
          task_id,
          turn_index,
          assistant_message,
          tool_calls,
          tool_results,
          completed,
          step_id,
          step_title,
          created_at
        ) VALUES (
          ${sqlText(this.snapshot.taskId!)},
          ${turn.turnIndex},
          ${sqlText(turn.assistantMessage)},
          ${sqlText(JSON.stringify(turn.toolCalls))},
          ${sqlText(JSON.stringify(turn.toolResults))},
          ${turn.completed ? 1 : 0},
          ${turn.stepId ? sqlText(turn.stepId) : 'NULL'},
          ${turn.stepTitle ? sqlText(turn.stepTitle) : 'NULL'},
          ${Date.now()}
        );
        `
      )
    })
  }

  private async persistSnapshot(): Promise<void> {
    if (!this.persistenceEnabled || !this.snapshot.taskId) {
      return
    }

    this.enqueuePersist(async () => {
      await runSqlite(
        this.persistenceDbPath,
        `
        INSERT OR REPLACE INTO task_runs (
          task_id,
          created_at,
          updated_at,
          status,
          task_description,
          original_user_input,
          turn_count,
          tool_calls,
          compact_summary,
          runtime_state,
          plan_json,
          last_error,
          final_summary
        ) VALUES (
          ${sqlText(this.snapshot.taskId!)},
          COALESCE(
            (SELECT created_at FROM task_runs WHERE task_id = ${sqlText(this.snapshot.taskId!)}),
            ${Date.now()}
          ),
          ${Date.now()},
          ${sqlText(this.snapshot.status === 'idle' ? 'errored' : this.snapshot.status)},
          ${sqlText(this.snapshot.taskDescription || '')},
          ${sqlText(this.snapshot.originalUserInput || '')},
          ${this.snapshot.turnCount},
          ${this.snapshot.toolCalls},
          ${this.snapshot.compactSummary ? sqlText(this.snapshot.compactSummary) : 'NULL'},
          ${this.snapshot.runState ? sqlText(this.snapshot.runState) : 'NULL'},
          ${this.snapshot.plan ? sqlText(JSON.stringify(this.snapshot.plan)) : 'NULL'},
          ${this.snapshot.lastError ? sqlText(this.snapshot.lastError) : 'NULL'},
          ${this.snapshot.finalSummary ? sqlText(this.snapshot.finalSummary) : 'NULL'}
        );
        `
      )
    })
  }

  private enqueuePersist(task: () => Promise<void>): void {
    this.writeQueue = this.writeQueue
      .then(task)
      .catch((error) => {
        console.error('[TaskSession] Persistence write failed:', error)
      })
  }

  private async migrateSchema(): Promise<void> {
    const migrations = [
      `ALTER TABLE task_runs ADD COLUMN runtime_state TEXT;`,
      `ALTER TABLE task_runs ADD COLUMN plan_json TEXT;`,
      `ALTER TABLE task_turns ADD COLUMN step_id TEXT;`,
      `ALTER TABLE task_turns ADD COLUMN step_title TEXT;`,
    ]

    for (const sql of migrations) {
      try {
        await runSqlite(this.persistenceDbPath, sql)
      } catch (error) {
        const message = (error as Error).message
        if (!message.includes('duplicate column name')) {
          throw error
        }
      }
    }
  }

  private async recoverLatestSnapshot(): Promise<void> {
    if (!this.persistenceEnabled) {
      return
    }

    const rows = await runSqliteJson<TaskRunRow>(
      this.persistenceDbPath,
      `
      SELECT
        task_id,
        status,
        task_description,
        original_user_input,
        turn_count,
        tool_calls,
        compact_summary,
        runtime_state,
        plan_json,
        last_error,
        final_summary
      FROM task_runs
      ORDER BY updated_at DESC
      LIMIT 1;
      `
    )

    const latest = rows[0]
    if (!latest) {
      return
    }

    if (latest.status === 'running') {
      await runSqlite(
        this.persistenceDbPath,
        `
        UPDATE task_runs
        SET
          status = 'errored',
          last_error = ${sqlText('Task session was interrupted before completion')},
          updated_at = ${Date.now()}
        WHERE task_id = ${sqlText(latest.task_id)};
        `
      )
      latest.status = 'errored'
      latest.last_error = 'Task session was interrupted before completion'
    }

    const turnRows = await runSqliteJson<TaskTurnRow>(
      this.persistenceDbPath,
      `
      SELECT
        turn_index,
        assistant_message,
        tool_calls,
        tool_results,
        completed
        , step_id
        , step_title
      FROM task_turns
      WHERE task_id = ${sqlText(latest.task_id)}
      ORDER BY turn_index DESC
      LIMIT 6;
      `
    )

    this.snapshot = {
      taskId: latest.task_id,
      status: latest.status,
      taskDescription: latest.task_description,
      originalUserInput: latest.original_user_input,
      turnCount: latest.turn_count,
      toolCalls: latest.tool_calls,
      compactSummary: latest.compact_summary,
      runState: latest.runtime_state || undefined,
      plan: latest.plan_json ? parseJsonValue(latest.plan_json) as TaskPlan : null,
      recentTurns: turnRows
        .reverse()
        .map((row) => ({
          turnIndex: row.turn_index,
          assistantMessage: row.assistant_message,
          toolCalls: parseJsonValue(row.tool_calls) as TaskTurnRecord['toolCalls'],
          toolResults: parseJsonValue(row.tool_results) as any[],
          completed: Boolean(row.completed),
          stepId: row.step_id || undefined,
          stepTitle: row.step_title || undefined
        })),
      lastError: latest.last_error || undefined,
      finalSummary: latest.final_summary || undefined
    }
  }
}

function cloneTaskPlan(plan: TaskPlan): TaskPlan {
  return JSON.parse(JSON.stringify(plan)) as TaskPlan
}

function parseTaskAdmission(content: string): Partial<TaskAdmissionDecision> {
  try {
    return JSON.parse(content) as Partial<TaskAdmissionDecision>
  } catch {
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) {
      throw new Error('Task admission response did not contain JSON')
    }
    return JSON.parse(match[0]) as Partial<TaskAdmissionDecision>
  }
}

function normalizeAdmissionDecision(value: unknown): TaskAdmissionDecision {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const action = record.action === 'keep_active' ||
    record.action === 'queue_new' ||
    record.action === 'stop_active_start_new'
    ? record.action
    : 'queue_new'
  return {
    action,
    reason: typeof record.reason === 'string' ? record.reason : 'admission decision'
  }
}

function normalizeTaskIntentText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？、,.!?;；:"“”'‘’()（）[\]【】]/g, '')
}
