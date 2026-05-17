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
  type TaskExecutorKind,
  type TaskRunResult,
  type TaskRuntimeConfig,
  type TaskRuntimeHooks,
  type TaskTurnRecord,
} from './task.js'
import {
  BUILTIN_TASK_RUNTIME_ADAPTER_ID,
  type TaskRuntimeAdapter,
  type TaskRuntimeAdapterHooks,
  type TaskRuntimeRequest,
} from './runtime-adapter.js'
import type { TaskIntent } from '../dialogue/processors.js'
import type { TaskPlan, TaskRunState } from './task-plan.js'
import type { RuntimeEventBus } from '../runtime/index.js'

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

interface TaskSessionRuntimeHooks extends Pick<
  TaskRuntimeHooks,
  'onUserInputRequest' | 'onRunStateChanged' | 'onPlanUpdated' | 'onStepUpdated' | 'resolveToolStrategyHints'
> {
  runtimeEvents?: RuntimeEventBus
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
  private runtimeAdapters: TaskRuntimeAdapter[] = [createBuiltinTaskRuntimeAdapter()]

  constructor(
    private llm: LLMProvider,
    private memory: MemoryEngine,
    private personality: PersonalityEngine,
    private agent: AgentCore,
    private context: ContextManager,
    storageDir: string,
    private runtimeHooks: TaskSessionRuntimeHooks = {},
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

  setRuntimeAdapters(adapters: TaskRuntimeAdapter[]): void {
    this.runtimeAdapters = [
      createBuiltinTaskRuntimeAdapter(),
      ...adapters.filter(adapter => adapter.id !== BUILTIN_TASK_RUNTIME_ADAPTER_ID),
    ]
  }

  setLLM(llm: LLMProvider): void {
    this.llm = llm
  }

  async runTask(
    taskIntent: TaskIntent,
    originalUserInput: string,
    taskContextItems: TaskContextItem[] = [],
    signal?: AbortSignal
  ): Promise<TaskRunResult> {
    if (this.activeTaskRun) {
      throw new Error('TaskSession received a task while another task is active; task scheduling must happen in RuntimeJobManager.')
    }

    return await this.startTaskRun(taskIntent, originalUserInput, taskContextItems, undefined, signal)
  }

  private async startTaskRun(
    taskIntent: TaskIntent,
    originalUserInput: string,
    taskContextItems: TaskContextItem[],
    requestedTaskId?: string,
    signal?: AbortSignal
  ): Promise<TaskRunResult> {
    const taskId = requestedTaskId ?? generateId()
    const abortController = new AbortController()
    const abortFromParent = () => abortController.abort(signal?.reason)
    signal?.addEventListener('abort', abortFromParent, { once: true })
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
    this.runtimeHooks.runtimeEvents?.emit({
      name: 'task.started',
      taskId,
      payload: {
        taskDescription,
        originalUserInput,
      },
    })
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
      signal?.removeEventListener('abort', abortFromParent)
      if (this.activeTaskRun?.taskId === taskId) {
        this.activeTaskRun = null
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
    const taskMeta = { taskDescription, originalUserInput }
    const hooks: TaskRuntimeAdapterHooks = {
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
        this.runtimeHooks.runtimeEvents?.emit({
          name: 'task.run_state.changed',
          taskId: this.snapshot.taskId ?? undefined,
          payload: {
            state,
            taskDescription,
            originalUserInput,
          },
        })
        this.runtimeHooks.onRunStateChanged?.(state, taskMeta)
      },
      onPlanUpdated: (plan) => {
        this.snapshot.plan = cloneTaskPlan(plan)
        this.persistSnapshot()
        this.runtimeHooks.runtimeEvents?.emit({
          name: 'task.plan.updated',
          taskId: this.snapshot.taskId ?? undefined,
          payload: {
            plan: cloneTaskPlan(plan),
            taskDescription,
            originalUserInput,
          },
        })
        this.runtimeHooks.onPlanUpdated?.(cloneTaskPlan(plan), taskMeta)
      },
      onStepUpdated: (step, plan) => {
        this.snapshot.plan = cloneTaskPlan(plan)
        this.persistSnapshot()
        const stepSnapshot = JSON.parse(JSON.stringify(step)) as typeof step
        const planSnapshot = cloneTaskPlan(plan)
        this.runtimeHooks.runtimeEvents?.emit({
          name: 'task.step.updated',
          taskId: this.snapshot.taskId ?? undefined,
          payload: {
            step: stepSnapshot,
            plan: planSnapshot,
            taskDescription,
            originalUserInput,
          },
        })
        this.runtimeHooks.onStepUpdated?.(stepSnapshot, planSnapshot, taskMeta)
      },
      onCompact: (summary) => {
        this.snapshot.compactSummary = summary
        this.persistSnapshot()
      },
      onUserInputRequest: this.runtimeHooks.onUserInputRequest,
      resolveToolStrategyHints: this.runtimeHooks.resolveToolStrategyHints,
    }
    const request: TaskRuntimeRequest = {
      taskId: this.snapshot.taskId ?? generateId(),
      taskDescription,
      originalUserInput,
      memoryContext,
      taskContextItems,
      config: this.taskRuntimeConfig,
      signal,
      dependencies: {
        llm: this.llm,
        agent: this.agent,
        personality: this.personality,
        context: this.context,
      },
    }

    const adapter = await this.selectRuntimeAdapter(request)
    const executor = getExecutorKind(adapter)
    console.log(`[TaskSession] Using task runtime adapter: ${adapter.id}`)
    const result = await adapter.run(request, hooks)
    if (!result.success) {
      this.snapshot.lastError = result.error
    }
    if (result.plan) {
      this.snapshot.plan = cloneTaskPlan(result.plan)
    }
    this.snapshot.finalSummary = result.finalMessage
    if (result.success) {
      this.runtimeHooks.runtimeEvents?.emit({
        name: 'task.completed',
        taskId: this.snapshot.taskId ?? undefined,
        payload: {
          taskDescription,
          originalUserInput,
          finalMessage: result.finalMessage,
          executor,
          iterations: result.iterations,
          toolCalls: result.toolCalls,
        },
      })
    } else {
      this.runtimeHooks.runtimeEvents?.emit({
        name: 'task.failed',
        taskId: this.snapshot.taskId ?? undefined,
        payload: {
          taskDescription,
          originalUserInput,
          finalMessage: result.finalMessage,
          executor,
          ...(result.error ? { error: result.error } : {}),
          iterations: result.iterations,
          toolCalls: result.toolCalls,
        },
      })
    }
    this.persistSnapshot()
    return {
      ...result,
      executor,
    }
  }

  private async selectRuntimeAdapter(request: TaskRuntimeRequest): Promise<TaskRuntimeAdapter> {
    const configuredId = request.config.adapterId?.trim()
    const candidates = configuredId
      ? this.runtimeAdapters.filter(adapter => adapter.id === configuredId)
      : this.runtimeAdapters.filter(adapter => adapter.id === BUILTIN_TASK_RUNTIME_ADAPTER_ID)

    for (const adapter of candidates) {
      if (!adapter.canHandle || await adapter.canHandle(request)) {
        return adapter
      }
    }

    if (configuredId) {
      console.warn(`[TaskSession] Task runtime adapter "${configuredId}" is unavailable; falling back to builtin`)
    }
    return this.runtimeAdapters.find(adapter => adapter.id === BUILTIN_TASK_RUNTIME_ADAPTER_ID)
      ?? createBuiltinTaskRuntimeAdapter()
  }

  getSnapshot(): SessionTaskSnapshot {
    return {
      ...this.snapshot,
      recentTurns: [...this.snapshot.recentTurns],
      plan: this.snapshot.plan ? cloneTaskPlan(this.snapshot.plan) : null
    }
  }

  async shutdown(): Promise<void> {
    this.activeTaskRun?.abortController.abort()
    await this.writeQueue
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

function createBuiltinTaskRuntimeAdapter(): TaskRuntimeAdapter {
  return {
    id: BUILTIN_TASK_RUNTIME_ADAPTER_ID,
    label: 'Built-in tool loop',
    async run(request, hooks) {
      const runtime = new TaskRuntime(
        request.dependencies.llm,
        request.dependencies.agent,
        request.dependencies.personality,
        request.dependencies.context,
        request.taskDescription,
        request.originalUserInput,
        request.memoryContext,
        request.taskContextItems,
        {
          onTurnCompleted: hooks.onTurnCompleted,
          onStatusChanged: hooks.onStatusChanged,
          onRunStateChanged: (state) => hooks.onRunStateChanged?.(state),
          onPlanUpdated: (plan) => hooks.onPlanUpdated?.(plan),
          onStepUpdated: (step, plan) => hooks.onStepUpdated?.(step, plan),
          onCompact: hooks.onCompact,
          onUserInputRequest: hooks.onUserInputRequest,
          resolveToolStrategyHints: hooks.resolveToolStrategyHints,
        },
        request.config,
        request.signal
      )
      return runtime.run()
    },
  }
}

function getExecutorKind(adapter: TaskRuntimeAdapter): TaskExecutorKind {
  return adapter.id === BUILTIN_TASK_RUNTIME_ADAPTER_ID ? 'builtin' : 'adapter'
}
