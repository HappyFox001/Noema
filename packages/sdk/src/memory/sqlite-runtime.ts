import Database from 'better-sqlite3'

export async function runSqlite(dbPath: string, sql: string, json = false): Promise<string> {
  const db = new Database(dbPath)
  db.pragma('busy_timeout = 5000')
  try {
    if (!json) {
      db.exec(sql)
      return ''
    }
    return JSON.stringify(db.prepare(sql.trim()).all())
  } finally {
    db.close()
  }
}

export async function runSqliteJson<T>(dbPath: string, sql: string): Promise<T[]> {
  const output = await runSqlite(dbPath, sql, true)
  if (!output) {
    return []
  }

  return JSON.parse(output) as T[]
}

export function sqlText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
