import { spawn } from 'node:child_process'

export async function runSqlite(dbPath: string, sql: string, json = false): Promise<string> {
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
