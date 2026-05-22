/**
 * SQLite persistence for durable work threads and work-state snapshots.
 */
import { mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { generateId } from '../utils/index.js'
import {
  parseJsonValue,
  runSqlite,
  runSqliteJson,
  sqlText,
} from '../memory/sqlite-runtime.js'
import {
  createEmptyWorkState,
  type WorkArtifact,
  type WorkDecision,
  type WorkFailure,
  type WorkInterruptionSnapshot,
  type WorkNextAction,
  type WorkSignal,
  type WorkState,
  type WorkThread,
  type WorkThreadStatus,
} from './work-state.js'
import type { EmotionalTurnRecord } from './boundaries.js'

interface WorkThreadRow {
  thread_id: string
  status: WorkThreadStatus
  priority: number
  created_at: number
  updated_at: number
  last_focused_at: number | null
  payload_json: string
}

interface WorkStateRow {
  state_id: string
  updated_at: number
  payload_json: string
}

const WORK_STATE_ID = 'current'

const WORK_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS work_threads (
  thread_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_focused_at INTEGER,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_work_threads_status_updated
ON work_threads(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS work_state_snapshots (
  state_id TEXT PRIMARY KEY,
  updated_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_signals (
  signal_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);
`

export class WorkStateStore {
  private dbPath: string
  private persistenceEnabled = false
  private writeQueue: Promise<void> = Promise.resolve()
  private state: WorkState = createEmptyWorkState()

  constructor(storageDir: string) {
    const resolvedStorageDir = isAbsolute(storageDir)
      ? storageDir
      : resolve(process.cwd(), storageDir)
    this.dbPath = resolve(resolvedStorageDir, 'work.sqlite3')
  }

  async initialize(): Promise<void> {
    try {
      await mkdir(dirname(this.dbPath), { recursive: true })
      await runSqlite(this.dbPath, WORK_SCHEMA_SQL)
      this.persistenceEnabled = true
      this.state = await this.loadState()
    } catch (error) {
      console.error('[WorkStateStore] Failed to initialize persistence:', error)
      this.persistenceEnabled = false
      this.state = createEmptyWorkState()
    }
  }

  getSnapshot(): WorkState {
    return cloneWorkState(this.state)
  }

  getThread(threadId: string): WorkThread | undefined {
    const thread = this.findThread(threadId)
    return thread ? cloneWorkThread(thread) : undefined
  }

  async saveThread(thread: WorkThread, reason = 'thread updated'): Promise<WorkState> {
    const nextThread = cloneWorkThread({
      ...thread,
      updatedAt: thread.updatedAt || Date.now(),
    })
    this.state = this.upsertThread(this.state, nextThread)
    await this.persistThread(nextThread)
    await this.persistState(reason)
    return this.getSnapshot()
  }

  async createThread(goal: string, options: {
    id?: string
    priority?: number
    now?: number
  } = {}): Promise<WorkThread> {
    const now = options.now ?? Date.now()
    const thread: WorkThread = {
      id: options.id ?? generateId(),
      goal,
      status: 'active',
      priority: options.priority ?? 0,
      createdAt: now,
      updatedAt: now,
      lastFocusedAt: now,
      userIntentHistory: [],
      emotionalTurnHistory: [],
      observations: [],
      artifacts: [],
      decisions: [],
      failures: [],
      nextActions: [],
    }
    await this.saveThread(thread, 'thread created')
    return cloneWorkThread(thread)
  }

  async focusThread(threadId: string, now = Date.now()): Promise<WorkState> {
    const thread = this.findThread(threadId)
    if (!thread) {
      return this.getSnapshot()
    }
    await this.saveThread({
      ...thread,
      lastFocusedAt: now,
      updatedAt: now,
    }, 'thread focused')
    this.state = {
      ...this.state,
      focusedThreadId: threadId,
      updatedAt: now,
    }
    await this.persistState('thread focused')
    return this.getSnapshot()
  }

  async pauseThread(threadId: string, reason = 'paused', now = Date.now()): Promise<WorkThread | undefined> {
    const thread = this.findThread(threadId)
    if (!thread) {
      return undefined
    }
    const next = {
      ...thread,
      status: 'paused' as const,
      resumeSummary: thread.resumeSummary ?? reason,
      updatedAt: now,
    }
    await this.saveThread(next, reason)
    return cloneWorkThread(next)
  }

  async resumeThread(threadId: string, reason = 'resumed', now = Date.now()): Promise<WorkThread | undefined> {
    const thread = this.findThread(threadId)
    if (!thread) {
      return undefined
    }
    const next = {
      ...thread,
      status: 'active' as const,
      lastFocusedAt: now,
      updatedAt: now,
      nextActions: thread.nextActions.length > 0
        ? thread.nextActions
        : [{
            id: generateId(),
            title: 'Resume previous work',
            reason,
            createdAt: now,
          }],
    }
    await this.saveThread(next, reason)
    this.state = {
      ...this.state,
      focusedThreadId: threadId,
      updatedAt: now,
    }
    await this.persistState(reason)
    return cloneWorkThread(next)
  }

  async abandonThread(threadId: string, reason = 'abandoned', now = Date.now()): Promise<WorkThread | undefined> {
    const thread = this.findThread(threadId)
    if (!thread) {
      return undefined
    }
    const next = {
      ...thread,
      status: 'abandoned' as const,
      abandonReason: reason,
      updatedAt: now,
    }
    await this.saveThread(next, reason)
    return cloneWorkThread(next)
  }

  async recordArtifact(threadId: string, artifact: WorkArtifact): Promise<WorkThread | undefined> {
    const thread = this.findThread(threadId)
    if (!thread) {
      return undefined
    }
    const next = {
      ...thread,
      artifacts: [...thread.artifacts, artifact],
      updatedAt: Date.now(),
    }
    await this.saveThread(next, 'artifact recorded')
    return cloneWorkThread(next)
  }

  async recordDecision(threadId: string, decision: WorkDecision): Promise<WorkThread | undefined> {
    const thread = this.findThread(threadId)
    if (!thread) {
      return undefined
    }
    const next = {
      ...thread,
      decisions: [...thread.decisions, decision],
      updatedAt: Date.now(),
    }
    await this.saveThread(next, 'decision recorded')
    return cloneWorkThread(next)
  }

  async recordFailure(threadId: string, failure: WorkFailure): Promise<WorkThread | undefined> {
    const thread = this.findThread(threadId)
    if (!thread) {
      return undefined
    }
    const next = {
      ...thread,
      failures: [...thread.failures, failure],
      status: thread.status === 'active' ? 'recoverable_failed' as const : thread.status,
      updatedAt: Date.now(),
    }
    await this.saveThread(next, 'failure recorded')
    return cloneWorkThread(next)
  }

  async recordNextAction(threadId: string, action: WorkNextAction): Promise<WorkThread | undefined> {
    const thread = this.findThread(threadId)
    if (!thread) {
      return undefined
    }
    const next = {
      ...thread,
      nextActions: [...thread.nextActions, action],
      updatedAt: Date.now(),
    }
    await this.saveThread(next, 'next action recorded')
    return cloneWorkThread(next)
  }

  async recordModification(threadId: string, modification: string, reason = 'user modification', now = Date.now()): Promise<WorkThread | undefined> {
    const thread = this.findThread(threadId)
    if (!thread) {
      return undefined
    }
    const next = {
      ...thread,
      userIntentHistory: [...thread.userIntentHistory, {
        input: modification,
        intent: 'work.modify',
        createdAt: now,
      }],
      nextActions: [...thread.nextActions, {
        id: generateId(),
        title: 'Apply latest user correction',
        reason,
        stepId: thread.currentStep?.id,
        createdAt: now,
      }],
      resumeSummary: `用户补充约束：${modification}`,
      updatedAt: now,
    }
    await this.saveThread(next, reason)
    return cloneWorkThread(next)
  }

  async recordEmotionalTurn(threadId: string, record: EmotionalTurnRecord): Promise<WorkThread | undefined> {
    const thread = this.findThread(threadId)
    if (!thread) {
      return undefined
    }
    const next = {
      ...thread,
      emotionalTurnHistory: [...thread.emotionalTurnHistory, record],
      updatedAt: Date.now(),
    }
    await this.saveThread(next, 'emotional turn recorded')
    return cloneWorkThread(next)
  }

  async recordInterruptionSnapshot(threadId: string, snapshot: WorkInterruptionSnapshot): Promise<WorkThread | undefined> {
    const thread = this.findThread(threadId)
    if (!thread) {
      return undefined
    }
    const next = {
      ...thread,
      interruptionSnapshot: snapshot,
      resumeSummary: snapshot.resumablePrompt,
      updatedAt: Date.now(),
    }
    await this.saveThread(next, 'interruption snapshot recorded')
    return cloneWorkThread(next)
  }

  async recordSignal(signal: WorkSignal): Promise<void> {
    if (!this.persistenceEnabled) {
      return
    }
    this.enqueuePersist(async () => {
      await runSqlite(
        this.dbPath,
        `
        INSERT OR REPLACE INTO work_signals (
          signal_id,
          thread_id,
          kind,
          severity,
          created_at,
          payload_json
        ) VALUES (
          ${sqlText(signal.id)},
          ${sqlText(signal.threadId)},
          ${sqlText(signal.kind)},
          ${sqlText(signal.severity)},
          ${signal.createdAt},
          ${sqlText(JSON.stringify(signal))}
        );
        `
      )
    })
  }

  async flush(): Promise<void> {
    await this.writeQueue
  }

  private findThread(threadId: string): WorkThread | undefined {
    return [
      ...this.state.activeThreads,
      ...this.state.pausedThreads,
      ...this.state.abandonedThreads,
      ...this.state.completedThreads,
    ].find(thread => thread.id === threadId)
  }

  private upsertThread(state: WorkState, thread: WorkThread): WorkState {
    const withoutThread = (threads: WorkThread[]) =>
      threads.filter(item => item.id !== thread.id)

    const next: WorkState = {
      ...state,
      activeThreads: withoutThread(state.activeThreads),
      pausedThreads: withoutThread(state.pausedThreads),
      abandonedThreads: withoutThread(state.abandonedThreads),
      completedThreads: withoutThread(state.completedThreads),
      updatedAt: thread.updatedAt,
    }

    if (thread.status === 'active' || thread.status === 'waiting_user' || thread.status === 'recoverable_failed') {
      next.activeThreads = sortThreads([...next.activeThreads, thread])
    } else if (thread.status === 'paused') {
      next.pausedThreads = sortThreads([...next.pausedThreads, thread])
    } else if (thread.status === 'abandoned' || thread.status === 'cancelled') {
      next.abandonedThreads = sortThreads([...next.abandonedThreads, thread])
    } else if (thread.status === 'completed') {
      next.completedThreads = sortThreads([...next.completedThreads, thread])
    }

    if (!next.focusedThreadId && next.activeThreads.length > 0) {
      next.focusedThreadId = next.activeThreads[0].id
    }

    return next
  }

  private async loadState(): Promise<WorkState> {
    const rows = await runSqliteJson<WorkStateRow>(
      this.dbPath,
      `
      SELECT state_id, updated_at, payload_json
      FROM work_state_snapshots
      WHERE state_id = ${sqlText(WORK_STATE_ID)}
      LIMIT 1;
      `
    )
    const saved = rows[0]?.payload_json
      ? normalizeWorkState(parseJsonValue(rows[0].payload_json))
      : undefined
    if (saved) {
      return saved
    }

    const threadRows = await runSqliteJson<WorkThreadRow>(
      this.dbPath,
      `
      SELECT thread_id, status, priority, created_at, updated_at, last_focused_at, payload_json
      FROM work_threads
      ORDER BY updated_at DESC;
      `
    )
    return threadRows.reduce((state, row) => {
      const thread = normalizeWorkThread(parseJsonValue(row.payload_json))
      return thread ? this.upsertThread(state, thread) : state
    }, createEmptyWorkState())
  }

  private async persistThread(thread: WorkThread): Promise<void> {
    if (!this.persistenceEnabled) {
      return
    }
    this.enqueuePersist(async () => {
      await runSqlite(
        this.dbPath,
        `
        INSERT OR REPLACE INTO work_threads (
          thread_id,
          status,
          priority,
          created_at,
          updated_at,
          last_focused_at,
          payload_json
        ) VALUES (
          ${sqlText(thread.id)},
          ${sqlText(thread.status)},
          ${thread.priority},
          ${thread.createdAt},
          ${thread.updatedAt},
          ${thread.lastFocusedAt ? thread.lastFocusedAt : 'NULL'},
          ${sqlText(JSON.stringify(thread))}
        );
        `
      )
    })
  }

  private async persistState(_reason: string): Promise<void> {
    if (!this.persistenceEnabled) {
      return
    }
    const snapshot = this.getSnapshot()
    this.enqueuePersist(async () => {
      await runSqlite(
        this.dbPath,
        `
        INSERT OR REPLACE INTO work_state_snapshots (
          state_id,
          updated_at,
          payload_json
        ) VALUES (
          ${sqlText(WORK_STATE_ID)},
          ${snapshot.updatedAt},
          ${sqlText(JSON.stringify(snapshot))}
        );
        `
      )
    })
  }

  private enqueuePersist(task: () => Promise<void>): void {
    this.writeQueue = this.writeQueue
      .then(task)
      .catch((error) => {
        console.error('[WorkStateStore] Persistence write failed:', error)
      })
  }
}

function sortThreads(threads: WorkThread[]): WorkThread[] {
  return [...threads].sort((left, right) => {
    const priority = right.priority - left.priority
    if (priority !== 0) {
      return priority
    }
    return right.updatedAt - left.updatedAt
  })
}

function normalizeWorkState(value: unknown): WorkState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const state = value as Partial<WorkState>
  return {
    activeThreads: normalizeThreads(state.activeThreads),
    pausedThreads: normalizeThreads(state.pausedThreads),
    abandonedThreads: normalizeThreads(state.abandonedThreads),
    completedThreads: normalizeThreads(state.completedThreads),
    focusedThreadId: typeof state.focusedThreadId === 'string' ? state.focusedThreadId : undefined,
    updatedAt: finiteTimestamp(state.updatedAt),
  }
}

function normalizeThreads(value: unknown): WorkThread[] {
  return Array.isArray(value)
    ? value.map(normalizeWorkThread).filter((thread): thread is WorkThread => Boolean(thread))
    : []
}

function normalizeWorkThread(value: unknown): WorkThread | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const thread = value as Partial<WorkThread>
  if (!thread.id || !thread.goal || !thread.status) {
    return undefined
  }
  return {
    id: thread.id,
    goal: thread.goal,
    status: thread.status,
    priority: Number.isFinite(thread.priority) ? Number(thread.priority) : 0,
    createdAt: finiteTimestamp(thread.createdAt),
    updatedAt: finiteTimestamp(thread.updatedAt),
    lastFocusedAt: typeof thread.lastFocusedAt === 'number' ? thread.lastFocusedAt : undefined,
    userIntentHistory: Array.isArray(thread.userIntentHistory) ? thread.userIntentHistory : [],
    emotionalTurnHistory: Array.isArray(thread.emotionalTurnHistory) ? thread.emotionalTurnHistory : [],
    plan: thread.plan,
    currentStep: thread.currentStep,
    executionState: thread.executionState,
    observations: Array.isArray(thread.observations) ? thread.observations : [],
    artifacts: Array.isArray(thread.artifacts) ? thread.artifacts : [],
    decisions: Array.isArray(thread.decisions) ? thread.decisions : [],
    failures: Array.isArray(thread.failures) ? thread.failures : [],
    nextActions: Array.isArray(thread.nextActions) ? thread.nextActions : [],
    interruptionSnapshot: normalizeInterruptionSnapshot(thread.interruptionSnapshot),
    resumeSummary: typeof thread.resumeSummary === 'string' ? thread.resumeSummary : undefined,
    abandonReason: typeof thread.abandonReason === 'string' ? thread.abandonReason : undefined,
  }
}

function normalizeInterruptionSnapshot(value: unknown): WorkInterruptionSnapshot | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const snapshot = value as Partial<WorkInterruptionSnapshot>
  if (!snapshot.id || !snapshot.resumablePrompt) {
    return undefined
  }
  return {
    id: snapshot.id,
    currentStepId: typeof snapshot.currentStepId === 'string' ? snapshot.currentStepId : undefined,
    completedStepIds: Array.isArray(snapshot.completedStepIds) ? snapshot.completedStepIds.filter(isString) : [],
    pendingStepIds: Array.isArray(snapshot.pendingStepIds) ? snapshot.pendingStepIds.filter(isString) : [],
    activeCommandSessions: Array.isArray(snapshot.activeCommandSessions) ? snapshot.activeCommandSessions as WorkInterruptionSnapshot['activeCommandSessions'] : [],
    changedFiles: Array.isArray(snapshot.changedFiles) ? snapshot.changedFiles.filter(isString) : [],
    recentToolOutputs: Array.isArray(snapshot.recentToolOutputs) ? snapshot.recentToolOutputs as WorkInterruptionSnapshot['recentToolOutputs'] : [],
    resumablePrompt: snapshot.resumablePrompt,
    createdAt: finiteTimestamp(snapshot.createdAt),
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function finiteTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Date.now()
}

function cloneWorkState(state: WorkState): WorkState {
  return JSON.parse(JSON.stringify(state)) as WorkState
}

function cloneWorkThread(thread: WorkThread): WorkThread {
  return JSON.parse(JSON.stringify(thread)) as WorkThread
}
