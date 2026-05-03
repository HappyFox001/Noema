/**
 * Interactive task input persistence.
 *
 * Stores user-approved reusable values requested during semi-interactive task
 * execution. One-time verification values are intentionally not persisted.
 */
import { mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { spawn } from 'node:child_process'

export interface StoredInteractiveInput {
  key: string
  label: string
  value: string
  sensitivity: string
  scope: string
  updatedAt: number
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS interactive_inputs (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  sensitivity TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`

export class InteractiveInputStore {
  private dbPath: string

  constructor(storageDir: string) {
    const resolvedStorageDir = isAbsolute(storageDir)
      ? storageDir
      : resolve(process.cwd(), storageDir)
    this.dbPath = resolve(resolvedStorageDir, 'interactive-inputs.sqlite3')
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.dbPath), { recursive: true })
    await runSqlite(this.dbPath, SCHEMA_SQL)
  }

  async get(key: string): Promise<StoredInteractiveInput | null> {
    const rows = await runSqliteJson<Array<{
      key: string
      label: string
      value: string
      sensitivity: string
      scope: string
      updated_at: number
    }>>(this.dbPath, `
      SELECT key, label, value, sensitivity, scope, updated_at
      FROM interactive_inputs
      WHERE key = ${sqlText(key)}
      LIMIT 1;
    `)

    const row = rows[0]
    if (!row) {
      return null
    }

    return {
      key: row.key,
      label: row.label,
      value: row.value,
      sensitivity: row.sensitivity,
      scope: row.scope,
      updatedAt: row.updated_at,
    }
  }

  async set(input: {
    key: string
    label: string
    value: string
    sensitivity: string
    scope?: string
  }): Promise<void> {
    const now = Date.now()
    await runSqlite(this.dbPath, `
      INSERT OR REPLACE INTO interactive_inputs (
        key,
        label,
        value,
        sensitivity,
        scope,
        created_at,
        updated_at
      ) VALUES (
        ${sqlText(input.key)},
        ${sqlText(input.label)},
        ${sqlText(input.value)},
        ${sqlText(input.sensitivity)},
        ${sqlText(input.scope || 'global')},
        COALESCE((SELECT created_at FROM interactive_inputs WHERE key = ${sqlText(input.key)}), ${now}),
        ${now}
      );
    `)
  }

  async list(): Promise<StoredInteractiveInput[]> {
    const rows = await runSqliteJson<Array<{
      key: string
      label: string
      value: string
      sensitivity: string
      scope: string
      updated_at: number
    }>>(this.dbPath, `
      SELECT key, label, value, sensitivity, scope, updated_at
      FROM interactive_inputs
      ORDER BY updated_at DESC;
    `)

    return rows.map(row => ({
      key: row.key,
      label: row.label,
      value: row.value,
      sensitivity: row.sensitivity,
      scope: row.scope,
      updatedAt: row.updated_at,
    }))
  }

  async delete(key: string): Promise<void> {
    await runSqlite(this.dbPath, `
      DELETE FROM interactive_inputs
      WHERE key = ${sqlText(key)};
    `)
  }

  async clear(): Promise<void> {
    await runSqlite(this.dbPath, `
      DELETE FROM interactive_inputs;
    `)
  }
}

async function runSqlite(dbPath: string, sql: string, json = false): Promise<string> {
  const args = json ? ['-json', dbPath] : [dbPath]

  return new Promise((resolvePromise, reject) => {
    const child = spawn('sqlite3', args, {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise(stdout.trim())
        return
      }
      reject(new Error(stderr.trim() || `sqlite3 exited with code ${code}`))
    })

    child.stdin.write(sql)
    child.stdin.end()
  })
}

async function runSqliteJson<T>(dbPath: string, sql: string): Promise<T> {
  const output = await runSqlite(dbPath, sql, true)
  return output ? JSON.parse(output) as T : [] as T
}

function sqlText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
