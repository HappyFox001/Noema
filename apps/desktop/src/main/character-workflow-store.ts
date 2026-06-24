/**
 * Persists character workflow projects independently from chat history.
 */
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface StoredCharacterWorkflowProject {
  id: string
  name: string
  schemaVersion: number
  createdAt: number
  updatedAt: number
  activeRunId?: string
  runCount: number
  payload: unknown
}

export interface StoredCharacterWorkflowRun {
  projectId: string
  id: string
  title: string
  status: string
  createdAt: number
  completedAt?: number
  payload: unknown
}

interface CharacterWorkflowProjectRow {
  id: string
  name: string
  schema_version: number
  created_at: number
  updated_at: number
  active_run_id: string | null
  run_count: number
  payload_json?: string
}

interface CharacterWorkflowRunRow {
  project_id: string
  id: string
  title: string
  status: string
  created_at: number
  completed_at: number | null
  payload_json?: string
}

const CHARACTER_WORKFLOW_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS character_workflow_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  active_run_id TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_character_workflow_projects_updated
ON character_workflow_projects(updated_at DESC);

CREATE TABLE IF NOT EXISTS character_workflow_runs (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(project_id, id),
  FOREIGN KEY(project_id) REFERENCES character_workflow_projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_character_workflow_runs_project
ON character_workflow_runs(project_id, created_at DESC);
`

export class CharacterWorkflowStore {
  private initialized = false
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly dbPath: string) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }
    await mkdir(dirname(this.dbPath), { recursive: true })
    await runSqlite(this.dbPath, CHARACTER_WORKFLOW_SCHEMA_SQL)
    this.initialized = true
  }

  async listProjects(): Promise<StoredCharacterWorkflowProject[]> {
    await this.writeQueue
    const rows = await this.runJson<CharacterWorkflowProjectRow>(`
      SELECT id, name, schema_version, created_at, updated_at, active_run_id, run_count
      FROM character_workflow_projects
      ORDER BY updated_at DESC;
    `)
    return rows.map((row) => rowToProject(row, false))
  }

  async getProject(id: string): Promise<StoredCharacterWorkflowProject | null> {
    await this.writeQueue
    const rows = await this.runJson<CharacterWorkflowProjectRow>(`
      SELECT id, name, schema_version, created_at, updated_at, active_run_id, run_count, payload_json
      FROM character_workflow_projects
      WHERE id = ${sqlText(id)}
      LIMIT 1;
    `)
    return rows[0] ? rowToProject(rows[0], true) : null
  }

  async getProjectOverview(id: string): Promise<StoredCharacterWorkflowProject | null> {
    await this.writeQueue
    const rows = await this.runJson<CharacterWorkflowProjectRow & {
      runs_json?: string
    }>(`
      SELECT
        p.id,
        p.name,
        p.schema_version,
        p.created_at,
        p.updated_at,
        p.active_run_id,
        p.run_count,
        json_remove(p.payload_json, '$.runs') AS payload_json,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', r.id,
            'title', r.title,
            'status', r.status,
            'createdAt', r.created_at,
            'completedAt', r.completed_at
          ))
          FROM character_workflow_runs r
          WHERE r.project_id = p.id
          ORDER BY r.created_at ASC
        ), '[]') AS runs_json
      FROM character_workflow_projects p
      WHERE p.id = ${sqlText(id)}
      LIMIT 1;
    `)
    const row = rows[0]
    const project = row ? rowToProject(row, true) : null
    if (!project?.payload || typeof project.payload !== 'object' || Array.isArray(project.payload)) {
      return project
    }
    const runSummaries = parseJsonValue(row.runs_json ?? '[]')
    return {
      ...project,
      payload: {
        ...(project.payload as Record<string, unknown>),
        runs: Array.isArray(runSummaries)
          ? runSummaries.map((run) => normalizeRunSummary(run))
          : [],
      },
    }
  }

  async getProjectRun(projectId: string, runId: string): Promise<StoredCharacterWorkflowRun | null> {
    await this.writeQueue
    const rows = await this.runJson<CharacterWorkflowRunRow>(`
      SELECT project_id, id, title, status, created_at, completed_at, payload_json
      FROM character_workflow_runs
      WHERE project_id = ${sqlText(projectId)} AND id = ${sqlText(runId)}
      LIMIT 1;
    `)
    if (rows[0]) {
      return rowToRun(rows[0], true)
    }
    return null
  }

  async upsertProject(project: StoredCharacterWorkflowProject): Promise<void> {
    const payloadRecord = project.payload && typeof project.payload === 'object' && !Array.isArray(project.payload)
      ? project.payload as Record<string, any>
      : {}
    const runs = Array.isArray(payloadRecord.runs) ? payloadRecord.runs : []
    const projectPayload = {
      ...payloadRecord,
      runs: runs.map((run) => normalizeRunSummary(run)),
    }
    const payloadJson = JSON.stringify(projectPayload)
    const runSql = runs.map((run) => createRunUpsertSql(project.id, run)).join('\n')
    const sql = `
      PRAGMA foreign_keys = ON;
      BEGIN IMMEDIATE;
      INSERT INTO character_workflow_projects (
        id, name, schema_version, created_at, updated_at, active_run_id, run_count, payload_json
      ) VALUES (
        ${sqlText(project.id)},
        ${sqlText(project.name)},
        ${Math.max(1, Math.round(project.schemaVersion || 1))},
        ${Math.round(project.createdAt || Date.now())},
        ${Math.round(project.updatedAt || Date.now())},
        ${project.activeRunId ? sqlText(project.activeRunId) : 'NULL'},
        ${Math.max(0, Math.round(project.runCount || 0))},
        ${sqlText(payloadJson)}
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        schema_version = excluded.schema_version,
        updated_at = excluded.updated_at,
        active_run_id = excluded.active_run_id,
        run_count = excluded.run_count,
        payload_json = excluded.payload_json;
      ${runSql}
      COMMIT;
    `
    await this.enqueueWrite(sql)
  }

  async deleteProject(id: string): Promise<void> {
    await this.enqueueWrite(`DELETE FROM character_workflow_projects WHERE id = ${sqlText(id)};`)
  }

  async deleteProjectRun(projectId: string, runId: string): Promise<void> {
    await this.enqueueWrite(`DELETE FROM character_workflow_runs WHERE project_id = ${sqlText(projectId)} AND id = ${sqlText(runId)};`)
  }

  async clearProjects(): Promise<void> {
    await this.enqueueWrite('DELETE FROM character_workflow_projects;')
  }

  private enqueueWrite(sql: string): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await this.run(sql)
    })
    return this.writeQueue
  }

  private async run(sql: string): Promise<string> {
    await mkdir(dirname(this.dbPath), { recursive: true })
    const script = this.initialized ? sql : `${CHARACTER_WORKFLOW_SCHEMA_SQL}\n${sql}`
    const output = await runSqlite(this.dbPath, script)
    this.initialized = true
    return output
  }

  private async runJson<T>(sql: string): Promise<T[]> {
    await mkdir(dirname(this.dbPath), { recursive: true })
    const script = this.initialized ? sql : `${CHARACTER_WORKFLOW_SCHEMA_SQL}\n${sql}`
    const rows = await runSqliteJson<T>(this.dbPath, script)
    this.initialized = true
    return rows
  }
}

function rowToProject(row: CharacterWorkflowProjectRow, includePayload: boolean): StoredCharacterWorkflowProject {
  return {
    id: row.id,
    name: row.name,
    schemaVersion: Number(row.schema_version) || 1,
    createdAt: Number(row.created_at) || Date.now(),
    updatedAt: Number(row.updated_at) || Date.now(),
    activeRunId: row.active_run_id ?? undefined,
    runCount: Number(row.run_count) || 0,
    payload: includePayload && row.payload_json ? parseJsonValue(row.payload_json) : undefined,
  }
}

function rowToRun(row: CharacterWorkflowRunRow, includePayload: boolean): StoredCharacterWorkflowRun {
  return {
    projectId: row.project_id,
    id: row.id,
    title: row.title,
    status: row.status,
    createdAt: Number(row.created_at) || Date.now(),
    completedAt: row.completed_at === null ? undefined : Number(row.completed_at) || undefined,
    payload: includePayload && row.payload_json ? parseJsonValue(row.payload_json) : undefined,
  }
}

function normalizeRunSummary(run: any): Record<string, unknown> {
  const stateRun = run?.runState?.run && typeof run.runState.run === 'object'
    ? run.runState.run
    : undefined
  const id = String(run?.id ?? stateRun?.id ?? '')
  const title = String(run?.title ?? stateRun?.title ?? id)
  const status = String(run?.status ?? stateRun?.status ?? 'idle')
  const createdAt = Number(run?.createdAt) || Date.now()
  const completedAt = Number(run?.completedAt) || undefined
  return {
    id,
    title,
    status,
    createdAt,
    ...(completedAt ? { completedAt } : {}),
    runState: {
      run: {
        ...(stateRun ?? {}),
        id,
        title,
        status,
      },
      steps: [],
      events: [],
      artifacts: [],
    },
  }
}

function createRunUpsertSql(projectId: string, run: any): string {
  const summary = normalizeRunSummary(run)
  const id = String(summary.id || '')
  if (!id) {
    return ''
  }
  return `
    INSERT INTO character_workflow_runs (
      project_id, id, title, status, created_at, completed_at, payload_json
    ) VALUES (
      ${sqlText(projectId)},
      ${sqlText(id)},
      ${sqlText(String(summary.title ?? id))},
      ${sqlText(String(summary.status ?? 'idle'))},
      ${Math.round(Number(summary.createdAt) || Date.now())},
      ${summary.completedAt ? Math.round(Number(summary.completedAt)) : 'NULL'},
      ${sqlText(JSON.stringify(run))}
    )
    ON CONFLICT(project_id, id) DO UPDATE SET
      title = excluded.title,
      status = excluded.status,
      created_at = excluded.created_at,
      completed_at = excluded.completed_at,
      payload_json = excluded.payload_json;
  `
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function sqlText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

async function runSqliteJson<T>(dbPath: string, sql: string): Promise<T[]> {
  const output = await runSqlite(dbPath, sql, true)
  return output ? parseSqliteJsonRows<T>(output) : []
}

function parseSqliteJsonRows<T>(output: string): T[] {
  const trimmed = output.trim()
  if (!trimmed) {
    return []
  }
  try {
    return JSON.parse(trimmed) as T[]
  } catch (error) {
    const lastArrayStart = trimmed.lastIndexOf('\n[')
    if (lastArrayStart >= 0) {
      return JSON.parse(trimmed.slice(lastArrayStart + 1)) as T[]
    }
    throw error
  }
}

async function runSqlite(dbPath: string, sql: string, json = false): Promise<string> {
  const args = json
    ? ['-json', '-cmd', '.timeout 5000', dbPath]
    : ['-cmd', '.timeout 5000', dbPath]
  return new Promise((resolve, reject) => {
    const child = spawn('sqlite3', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) {
        resolve(stdout.trim())
        return
      }
      reject(new Error(stderr.trim() || `sqlite3 exited with code ${code}`))
    })
    child.stdin.write(sql)
    child.stdin.end()
  })
}
