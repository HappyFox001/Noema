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
    await runSqliteIgnoreDuplicateColumn(this.dbPath, 'ALTER TABLE character_workflow_projects ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;')
    this.initialized = true
  }

  async listProjects(): Promise<StoredCharacterWorkflowProject[]> {
    await this.initialize()
    const rows = await runSqliteJson<CharacterWorkflowProjectRow>(this.dbPath, `
      SELECT id, name, schema_version, created_at, updated_at, active_run_id, run_count
      FROM character_workflow_projects
      ORDER BY updated_at DESC;
    `)
    return rows.map((row) => rowToProject(row, false))
  }

  async getProject(id: string): Promise<StoredCharacterWorkflowProject | null> {
    await this.initialize()
    const rows = await runSqliteJson<CharacterWorkflowProjectRow>(this.dbPath, `
      SELECT id, name, schema_version, created_at, updated_at, active_run_id, run_count, payload_json
      FROM character_workflow_projects
      WHERE id = ${sqlText(id)}
      LIMIT 1;
    `)
    return rows[0] ? rowToProject(rows[0], true) : null
  }

  async upsertProject(project: StoredCharacterWorkflowProject): Promise<void> {
    await this.initialize()
    const payloadJson = JSON.stringify(project.payload ?? {})
    const sql = `
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
    `
    await this.enqueueWrite(sql)
  }

  async deleteProject(id: string): Promise<void> {
    await this.initialize()
    await this.enqueueWrite(`DELETE FROM character_workflow_projects WHERE id = ${sqlText(id)};`)
  }

  async clearProjects(): Promise<void> {
    await this.initialize()
    await this.enqueueWrite('DELETE FROM character_workflow_projects;')
  }

  private enqueueWrite(sql: string): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await runSqlite(this.dbPath, sql)
    })
    return this.writeQueue
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

async function runSqliteIgnoreDuplicateColumn(dbPath: string, sql: string): Promise<void> {
  try {
    await runSqlite(dbPath, sql)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/duplicate column name/i.test(message)) {
      throw error
    }
  }
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
