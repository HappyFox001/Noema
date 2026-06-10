/**
 * Persists standalone chat conversations in a local SQLite database.
 */
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface StoredChatConversation {
  id: string
  characterId: string
  title: Record<string, string>
  preview: Record<string, string>
  updatedLabel: Record<string, string>
  messages: unknown[]
}

interface ChatConversationRow {
  id: string
  character_id: string
  title_json: string
  preview_json: string
  updated_label_json: string
  messages_json: string
}

export class ChatHistoryStore {
  private initialized = false

  constructor(private readonly dbPath: string) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }
    await mkdir(dirname(this.dbPath), { recursive: true })
    await runSqlite(this.dbPath, `
      CREATE TABLE IF NOT EXISTS chat_conversations (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL,
        title_json TEXT NOT NULL,
        preview_json TEXT NOT NULL,
        updated_label_json TEXT NOT NULL,
        messages_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated_at ON chat_conversations(updated_at DESC);
    `)
    this.initialized = true
  }

  async listConversations(): Promise<StoredChatConversation[]> {
    await this.initialize()
    const rows = await runSqliteJson<ChatConversationRow>(this.dbPath, `
      SELECT id, character_id, title_json, preview_json, updated_label_json, messages_json
      FROM chat_conversations
      ORDER BY updated_at DESC;
    `)
    return rows.map(rowToConversation)
  }

  async upsertConversation(conversation: StoredChatConversation): Promise<void> {
    await this.initialize()
    await runSqlite(this.dbPath, `
      INSERT INTO chat_conversations (
        id,
        character_id,
        title_json,
        preview_json,
        updated_label_json,
        messages_json,
        updated_at
      ) VALUES (
        ${sqlText(conversation.id)},
        ${sqlText(conversation.characterId)},
        ${sqlText(JSON.stringify(conversation.title ?? {}))},
        ${sqlText(JSON.stringify(conversation.preview ?? {}))},
        ${sqlText(JSON.stringify(conversation.updatedLabel ?? {}))},
        ${sqlText(JSON.stringify(conversation.messages ?? []))},
        ${Date.now()}
      )
      ON CONFLICT(id) DO UPDATE SET
        character_id = excluded.character_id,
        title_json = excluded.title_json,
        preview_json = excluded.preview_json,
        updated_label_json = excluded.updated_label_json,
        messages_json = excluded.messages_json,
        updated_at = excluded.updated_at;
    `)
  }

  async deleteConversation(id: string): Promise<void> {
    await this.initialize()
    await runSqlite(this.dbPath, `DELETE FROM chat_conversations WHERE id = ${sqlText(id)};`)
  }

  async clearConversations(): Promise<void> {
    await this.initialize()
    await runSqlite(this.dbPath, 'DELETE FROM chat_conversations;')
  }
}

function rowToConversation(row: ChatConversationRow): StoredChatConversation {
  return {
    id: row.id,
    characterId: row.character_id,
    title: parseJsonRecord(row.title_json),
    preview: parseJsonRecord(row.preview_json),
    updatedLabel: parseJsonRecord(row.updated_label_json),
    messages: parseJsonArray(row.messages_json),
  }
}

function parseJsonRecord(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function sqlText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

async function runSqliteJson<T>(dbPath: string, sql: string): Promise<T[]> {
  const output = await runSqlite(dbPath, sql, true)
  return output ? JSON.parse(output) as T[] : []
}

async function runSqlite(dbPath: string, sql: string, json = false): Promise<string> {
  const args = json ? ['-json', dbPath] : [dbPath]
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
