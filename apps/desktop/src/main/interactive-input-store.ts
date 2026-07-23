/**
 * Interactive task input persistence.
 *
 * Stores user-approved reusable values requested during semi-interactive task
 * execution. One-time verification values are intentionally not persisted.
 */
import { mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import Database from 'better-sqlite3'

export interface StoredInteractiveInput {
  key: string
  groupKey: string
  groupLabel: string
  itemKey: string
  itemLabel: string
  label: string
  value: string
  sensitivity: string
  scope: string
  updatedAt: number
}

export interface StoredInteractiveInputGroup {
  groupKey: string
  groupLabel: string
  items: StoredInteractiveInput[]
  updatedAt: number
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS interactive_inputs (
  key TEXT PRIMARY KEY,
  group_key TEXT NOT NULL,
  group_label TEXT NOT NULL,
  item_key TEXT NOT NULL,
  item_label TEXT NOT NULL,
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
      group_key: string
      group_label: string
      item_key: string
      item_label: string
      label: string
      value: string
      sensitivity: string
      scope: string
      updated_at: number
    }>>(this.dbPath, `
      SELECT key, group_key, group_label, item_key, item_label, label, value, sensitivity, scope, updated_at
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
      groupKey: row.group_key,
      groupLabel: row.group_label,
      itemKey: row.item_key,
      itemLabel: row.item_label,
      label: row.label,
      value: row.value,
      sensitivity: row.sensitivity,
      scope: row.scope,
      updatedAt: row.updated_at,
    }
  }

  async set(input: {
    groupKey: string
    groupLabel?: string
    itemKey: string
    itemLabel?: string
    label: string
    value: string
    sensitivity: string
    scope?: string
  }): Promise<void> {
    const now = Date.now()
    const normalized = normalizeInputIdentity(input)
    await runSqlite(this.dbPath, `
      INSERT OR REPLACE INTO interactive_inputs (
        key,
        group_key,
        group_label,
        item_key,
        item_label,
        label,
        value,
        sensitivity,
        scope,
        created_at,
        updated_at
      ) VALUES (
        ${sqlText(normalized.key)},
        ${sqlText(normalized.groupKey)},
        ${sqlText(normalized.groupLabel)},
        ${sqlText(normalized.itemKey)},
        ${sqlText(normalized.itemLabel)},
        ${sqlText(input.label)},
        ${sqlText(input.value)},
        ${sqlText(input.sensitivity)},
        ${sqlText(input.scope || 'global')},
        COALESCE((SELECT created_at FROM interactive_inputs WHERE key = ${sqlText(normalized.key)}), ${now}),
        ${now}
      );
    `)
  }

  async list(): Promise<StoredInteractiveInput[]> {
    const rows = await runSqliteJson<Array<{
      key: string
      group_key: string
      group_label: string
      item_key: string
      item_label: string
      label: string
      value: string
      sensitivity: string
      scope: string
      updated_at: number
    }>>(this.dbPath, `
      SELECT key, group_key, group_label, item_key, item_label, label, value, sensitivity, scope, updated_at
      FROM interactive_inputs
      ORDER BY updated_at DESC;
    `)

    return rows.map(row => this.rowToInput(row))
  }

  async listGroups(): Promise<StoredInteractiveInputGroup[]> {
    const inputs = await this.list()
    const groups = new Map<string, StoredInteractiveInputGroup>()

    for (const input of inputs) {
      const existing = groups.get(input.groupKey)
      if (existing) {
        existing.items.push(input)
        existing.updatedAt = Math.max(existing.updatedAt, input.updatedAt)
        continue
      }

      groups.set(input.groupKey, {
        groupKey: input.groupKey,
        groupLabel: input.groupLabel,
        items: [input],
        updatedAt: input.updatedAt,
      })
    }

    return Array.from(groups.values()).sort((left, right) => right.updatedAt - left.updatedAt)
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

  private rowToInput(row: {
    key: string
    group_key: string
    group_label: string
    item_key: string
    item_label: string
    label: string
    value: string
    sensitivity: string
    scope: string
    updated_at: number
  }): StoredInteractiveInput {
    return {
      key: row.key,
      groupKey: row.group_key,
      groupLabel: row.group_label,
      itemKey: row.item_key,
      itemLabel: row.item_label,
      label: row.label,
      value: row.value,
      sensitivity: row.sensitivity,
      scope: row.scope,
      updatedAt: row.updated_at,
    }
  }
}

function normalizeInputIdentity(input: {
  groupKey: string
  groupLabel?: string
  itemKey: string
  itemLabel?: string
}): {
  key: string
  groupKey: string
  groupLabel: string
  itemKey: string
  itemLabel: string
} {
  const groupKey = cleanKey(input.groupKey)
  const itemKey = cleanKey(input.itemKey)
  if (!groupKey || !itemKey) {
    throw new Error('Interactive input requires groupKey and itemKey')
  }
  return {
    key: `${groupKey}.${itemKey}`,
    groupKey,
    groupLabel: cleanLabel(input.groupLabel) || formatLabel(groupKey),
    itemKey,
    itemLabel: cleanLabel(input.itemLabel) || formatLabel(itemKey),
  }
}

function cleanKey(value: unknown): string | undefined {
  const key = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .replace(/^[_:.-]+|[_:.-]+$/g, '')
  return key || undefined
}

function cleanLabel(value: unknown): string | undefined {
  const label = String(value ?? '').trim().replace(/\s+/g, ' ')
  return label || undefined
}

function formatLabel(key: string): string {
  return key
    .split(/[_.:-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Global'
}

async function runSqlite(dbPath: string, sql: string, json = false): Promise<string> {
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

async function runSqliteJson<T>(dbPath: string, sql: string): Promise<T> {
  const output = await runSqlite(dbPath, sql, true)
  return output ? JSON.parse(output) as T : [] as T
}

function sqlText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
