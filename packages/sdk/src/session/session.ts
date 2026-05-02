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
  type TaskTurnRecord,
} from './task.js'
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

  constructor(
    private llm: LLMProvider,
    private memory: MemoryEngine,
    private personality: PersonalityEngine,
    private agent: AgentCore,
    private context: ContextManager,
    storageDir: string
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
    taskDescription: string,
    originalUserInput: string,
    taskContextItems: TaskContextItem[] = []
  ): Promise<TaskRunResult> {
    this.snapshot = {
      taskId: generateId(),
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
        },
        onStepUpdated: (_step, plan) => {
          this.snapshot.plan = cloneTaskPlan(plan)
          this.persistSnapshot()
        },
        onCompact: (summary) => {
          this.snapshot.compactSummary = summary
          this.persistSnapshot()
        }
      }
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
