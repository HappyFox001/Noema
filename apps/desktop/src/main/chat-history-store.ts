/**
 * Persists standalone chat conversations in normalized local SQLite tables.
 */
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const CHAT_HISTORY_SCHEMA_VERSION = 4

export interface StoredChatConversation {
  id: string
  characterId: string
  title: Record<string, string>
  preview: Record<string, string>
  updatedLabel: Record<string, string>
  sceneState: unknown
  summaries: unknown[]
  messages: unknown[]
  workflowState?: unknown
  characterResource?: unknown
}

export interface StoredChatConversationListItem {
  id: string
  characterId: string
  title: Record<string, string>
  preview: Record<string, string>
  updatedLabel: Record<string, string>
  sceneState: unknown
  summaries: unknown[]
  messages?: unknown[]
  workflowState?: unknown
  characterResource?: unknown
  messageCount: number
  hasWorkflowState: boolean
}

interface ChatConversationRow {
  id: string
  character_id: string
  title_json: string
  preview_json: string
  updated_label_json: string
  scene_state_json: string
  character_resource_json: string | null
}

interface ChatConversationListRow {
  id: string
  character_id: string
  title_json: string
  preview_json: string
  updated_label_json: string
  character_resource_json: string | null
  message_count: number
  has_workflow_state: number
}

interface ChatMessageRow {
  id: string
  role: string
  text_json: string
  created_label_json: string
  media_json: string
  state: string | null
}

interface ChatSummaryRow {
  id: string
  text_json: string
  created_label_json: string
  message_count: number
  start_message_index: number
  end_message_index: number
  source_message_ids_json: string
}

interface ChatWorkflowRow {
  workflow_state_json: string
}

export class ChatHistoryStore {
  private initialized = false
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly dbPath: string) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }
    await mkdir(dirname(this.dbPath), { recursive: true })
    await ensureCurrentSchema(this.dbPath)
    this.initialized = true
  }

  async listConversations(): Promise<StoredChatConversationListItem[]> {
    await this.initialize()
    const rows = await runSqliteJson<ChatConversationListRow>(this.dbPath, `
      SELECT
        c.id,
        c.character_id,
        c.title_json,
        c.preview_json,
        c.updated_label_json,
        c.character_resource_json,
        COUNT(m.id) AS message_count,
        CASE WHEN w.conversation_id IS NULL THEN 0 ELSE 1 END AS has_workflow_state
      FROM chat_conversations c
      LEFT JOIN chat_messages m ON m.conversation_id = c.id
      LEFT JOIN chat_workflow_states w ON w.conversation_id = c.id
      GROUP BY c.id
      ORDER BY c.updated_at DESC;
    `)
    return rows.map(rowToConversationListItem)
  }

  async getConversation(id: string, options: { includeWorkflowState?: boolean } = {}): Promise<StoredChatConversation | null> {
    await this.initialize()
    const rows = await runSqliteJson<ChatConversationRow>(this.dbPath, `
      SELECT id, character_id, title_json, preview_json, updated_label_json, scene_state_json, character_resource_json
      FROM chat_conversations
      WHERE id = ${sqlText(id)}
      LIMIT 1;
    `)
    const conversation = rows[0]
    if (!conversation) {
      return null
    }

    const [messages, summaries, workflowRows] = await Promise.all([
      runSqliteJson<ChatMessageRow>(this.dbPath, `
        SELECT id, role, text_json, created_label_json, media_json, state
        FROM chat_messages
        WHERE conversation_id = ${sqlText(id)}
        ORDER BY ordinal ASC;
      `),
      runSqliteJson<ChatSummaryRow>(this.dbPath, `
        SELECT id, text_json, created_label_json, message_count, start_message_index, end_message_index, source_message_ids_json
        FROM chat_summaries
        WHERE conversation_id = ${sqlText(id)}
        ORDER BY ordinal ASC;
      `),
      options.includeWorkflowState
        ? runSqliteJson<ChatWorkflowRow>(this.dbPath, `
            SELECT workflow_state_json
            FROM chat_workflow_states
            WHERE conversation_id = ${sqlText(id)}
            LIMIT 1;
          `)
        : Promise.resolve([]),
    ])

    return {
      id: conversation.id,
      characterId: conversation.character_id,
      title: parseJsonRecord(conversation.title_json),
      preview: parseJsonRecord(conversation.preview_json),
      updatedLabel: parseJsonRecord(conversation.updated_label_json),
      sceneState: parseJsonObject(conversation.scene_state_json),
      summaries: summaries.map(rowToSummary),
      messages: messages.map(rowToMessage),
      workflowState: parseJsonAny(workflowRows[0]?.workflow_state_json),
      characterResource: parseJsonAny(conversation.character_resource_json ?? undefined),
    }
  }

  async upsertConversation(conversation: StoredChatConversation): Promise<void> {
    await this.initialize()
    await this.enqueueWrite(buildUpsertConversationSql(conversation))
  }

  async deleteConversation(id: string): Promise<void> {
    await this.initialize()
    await this.enqueueWrite(`
      BEGIN IMMEDIATE;
      DELETE FROM chat_workflow_states WHERE conversation_id = ${sqlText(id)};
      DELETE FROM chat_summaries WHERE conversation_id = ${sqlText(id)};
      DELETE FROM chat_messages WHERE conversation_id = ${sqlText(id)};
      DELETE FROM chat_conversations WHERE id = ${sqlText(id)};
      COMMIT;
    `)
  }

  async clearConversations(): Promise<void> {
    await this.initialize()
    await this.enqueueWrite(`
      BEGIN IMMEDIATE;
      DELETE FROM chat_workflow_states;
      DELETE FROM chat_summaries;
      DELETE FROM chat_messages;
      DELETE FROM chat_conversations;
      COMMIT;
    `)
  }

  private enqueueWrite(sql: string): Promise<void> {
    const write = this.writeQueue.then(() => runSqlite(this.dbPath, sql).then(() => undefined))
    this.writeQueue = write.catch(() => undefined)
    return write
  }
}

async function ensureCurrentSchema(dbPath: string): Promise<void> {
  const rows = await runSqliteJson<{ user_version: number }>(dbPath, 'PRAGMA user_version;')
  const currentVersion = Math.round(Number(rows[0]?.user_version) || 0)
  if (currentVersion !== CHAT_HISTORY_SCHEMA_VERSION) {
    await resetSchema(dbPath)
    return
  }
  await createCurrentSchema(dbPath)
}

async function resetSchema(dbPath: string): Promise<void> {
  await runSqlite(dbPath, `
    PRAGMA foreign_keys = OFF;
    DROP TABLE IF EXISTS chat_workflow_states;
    DROP TABLE IF EXISTS chat_summaries;
    DROP TABLE IF EXISTS chat_messages;
    DROP TABLE IF EXISTS chat_conversations;
    PRAGMA foreign_keys = ON;
  `)
  await createCurrentSchema(dbPath)
}

async function createCurrentSchema(dbPath: string): Promise<void> {
  await runSqlite(dbPath, `
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS chat_conversations (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      title_json TEXT NOT NULL,
      preview_json TEXT NOT NULL,
      updated_label_json TEXT NOT NULL,
      scene_state_json TEXT NOT NULL,
      character_resource_json TEXT,
      updated_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      role TEXT NOT NULL,
      text_json TEXT NOT NULL,
      created_label_json TEXT NOT NULL,
      media_json TEXT NOT NULL,
      state TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, id),
      FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS chat_summaries (
      id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      text_json TEXT NOT NULL,
      created_label_json TEXT NOT NULL,
      message_count INTEGER NOT NULL,
      start_message_index INTEGER NOT NULL,
      end_message_index INTEGER NOT NULL,
      source_message_ids_json TEXT NOT NULL,
      PRIMARY KEY (conversation_id, id),
      FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS chat_workflow_states (
      conversation_id TEXT PRIMARY KEY,
      workflow_state_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated_at ON chat_conversations(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_ordinal ON chat_messages(conversation_id, ordinal);
    CREATE INDEX IF NOT EXISTS idx_chat_summaries_conversation_ordinal ON chat_summaries(conversation_id, ordinal);
    PRAGMA user_version = ${CHAT_HISTORY_SCHEMA_VERSION};
  `)
}

function buildUpsertConversationSql(conversation: StoredChatConversation): string {
  const now = Date.now()
  const messageValues = (conversation.messages ?? [])
    .map((message, index) => messageToInsertValue(conversation.id, message, index, now))
    .filter(Boolean)
  const summaryValues = (conversation.summaries ?? [])
    .map((summary, index) => summaryToInsertValue(conversation.id, summary, index))
    .filter(Boolean)
  const workflowSql = conversation.workflowState && typeof conversation.workflowState === 'object'
    ? `
      INSERT INTO chat_workflow_states (conversation_id, workflow_state_json, updated_at)
      VALUES (${sqlText(conversation.id)}, ${sqlText(JSON.stringify(conversation.workflowState))}, ${now})
      ON CONFLICT(conversation_id) DO UPDATE SET
        workflow_state_json = excluded.workflow_state_json,
        updated_at = excluded.updated_at;
    `
    : `DELETE FROM chat_workflow_states WHERE conversation_id = ${sqlText(conversation.id)};`

  return `
    PRAGMA foreign_keys = ON;
    BEGIN IMMEDIATE;
    INSERT INTO chat_conversations (
      id,
      character_id,
      title_json,
      preview_json,
      updated_label_json,
      scene_state_json,
      character_resource_json,
      updated_at,
      created_at
    ) VALUES (
      ${sqlText(conversation.id)},
      ${sqlText(conversation.characterId)},
      ${sqlText(JSON.stringify(conversation.title ?? {}))},
      ${sqlText(JSON.stringify(conversation.preview ?? {}))},
      ${sqlText(JSON.stringify(conversation.updatedLabel ?? {}))},
      ${sqlText(JSON.stringify(conversation.sceneState ?? {}))},
      ${conversation.characterResource ? sqlText(JSON.stringify(conversation.characterResource)) : 'NULL'},
      ${now},
      ${now}
    )
    ON CONFLICT(id) DO UPDATE SET
      character_id = excluded.character_id,
      title_json = excluded.title_json,
      preview_json = excluded.preview_json,
      updated_label_json = excluded.updated_label_json,
      scene_state_json = excluded.scene_state_json,
      character_resource_json = excluded.character_resource_json,
      updated_at = excluded.updated_at;
    DELETE FROM chat_messages WHERE conversation_id = ${sqlText(conversation.id)};
    ${messageValues.length
      ? `INSERT INTO chat_messages (id, conversation_id, ordinal, role, text_json, created_label_json, media_json, state, created_at) VALUES ${messageValues.join(',\n')};`
      : ''}
    DELETE FROM chat_summaries WHERE conversation_id = ${sqlText(conversation.id)};
    ${summaryValues.length
      ? `INSERT INTO chat_summaries (id, conversation_id, ordinal, text_json, created_label_json, message_count, start_message_index, end_message_index, source_message_ids_json) VALUES ${summaryValues.join(',\n')};`
      : ''}
    ${workflowSql}
    COMMIT;
  `
}

function rowToConversationListItem(row: ChatConversationListRow): StoredChatConversationListItem {
  return {
    id: row.id,
    characterId: row.character_id,
    title: parseJsonRecord(row.title_json),
    preview: parseJsonRecord(row.preview_json),
    updatedLabel: parseJsonRecord(row.updated_label_json),
    sceneState: {},
    summaries: [],
    messages: undefined,
    workflowState: undefined,
    characterResource: parseJsonAny(row.character_resource_json ?? undefined),
    messageCount: Math.max(0, Math.round(Number(row.message_count) || 0)),
    hasWorkflowState: Number(row.has_workflow_state) === 1,
  }
}

function rowToMessage(row: ChatMessageRow): Record<string, unknown> {
  return {
    id: row.id,
    role: row.role,
    text: parseJsonRecord(row.text_json),
    createdLabel: parseJsonRecord(row.created_label_json),
    media: parseJsonArray(row.media_json),
    ...(row.state ? { state: row.state } : {}),
  }
}

function rowToSummary(row: ChatSummaryRow): Record<string, unknown> {
  return {
    id: row.id,
    text: parseJsonRecord(row.text_json),
    createdLabel: parseJsonRecord(row.created_label_json),
    messageCount: Math.max(0, Math.round(Number(row.message_count) || 0)),
    startMessageIndex: Math.max(1, Math.round(Number(row.start_message_index) || 1)),
    endMessageIndex: Math.max(1, Math.round(Number(row.end_message_index) || 1)),
    sourceMessageIds: parseJsonArray(row.source_message_ids_json),
  }
}

function messageToInsertValue(conversationId: string, value: unknown, index: number, now: number): string {
  const message = objectRecord(value)
  const id = stringValue(message.id) || `message-${index}`
  return `(
    ${sqlText(id)},
    ${sqlText(conversationId)},
    ${index},
    ${sqlText(stringValue(message.role) || 'assistant')},
    ${sqlText(JSON.stringify(message.text ?? {}))},
    ${sqlText(JSON.stringify(message.createdLabel ?? {}))},
    ${sqlText(JSON.stringify(Array.isArray(message.media) ? message.media : []))},
    ${message.state ? sqlText(String(message.state)) : 'NULL'},
    ${now + index}
  )`
}

function summaryToInsertValue(conversationId: string, value: unknown, index: number): string {
  const summary = objectRecord(value)
  const id = stringValue(summary.id) || `summary-${index}`
  return `(
    ${sqlText(id)},
    ${sqlText(conversationId)},
    ${index},
    ${sqlText(JSON.stringify(summary.text ?? {}))},
    ${sqlText(JSON.stringify(summary.createdLabel ?? {}))},
    ${Math.max(0, Math.round(Number(summary.messageCount) || 0))},
    ${Math.max(1, Math.round(Number(summary.startMessageIndex) || 1))},
    ${Math.max(1, Math.round(Number(summary.endMessageIndex) || 1))},
    ${sqlText(JSON.stringify(Array.isArray(summary.sourceMessageIds) ? summary.sourceMessageIds : []))}
  )`
}

function objectRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseJsonAny(value: string | undefined): unknown {
  if (!value) {
    return undefined
  }
  try {
    return JSON.parse(value)
  } catch {
    return undefined
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

function parseJsonObject(value: string): Record<string, unknown> {
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
