import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { ConversationTurn } from '@her-text/types'
import type {
  UserProfile,
  ShortTermKVEntry,
  ConversationSummary
} from './index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Memory Database - SQLite 持久化层
 */
export class MemoryDatabase {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL') // Write-Ahead Logging for better performance
    this.initialize()
  }

  /**
   * 初始化数据库 schema
   */
  private initialize(): void {
    const schemaSQL = readFileSync(join(__dirname, 'schema.sql'), 'utf-8')
    this.db.exec(schemaSQL)
    console.log('[MemoryDB] Database initialized')
  }

  // ========== 对话历史 ==========

  /**
   * 保存对话轮次
   */
  saveConversationTurn(turn: ConversationTurn): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO conversation_turns (id, role, content, timestamp)
      VALUES (?, ?, ?, ?)
    `)
    stmt.run(turn.id, turn.role, turn.content, turn.timestamp)
  }

  /**
   * 批量保存对话
   */
  saveConversationTurns(turns: ConversationTurn[]): void {
    const insert = this.db.transaction((turns: ConversationTurn[]) => {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO conversation_turns (id, role, content, timestamp)
        VALUES (?, ?, ?, ?)
      `)
      for (const turn of turns) {
        stmt.run(turn.id, turn.role, turn.content, turn.timestamp)
      }
    })
    insert(turns)
  }

  /**
   * 获取最近 N 条对话
   */
  getRecentConversations(limit: number = 100): ConversationTurn[] {
    const stmt = this.db.prepare(`
      SELECT id, role, content, timestamp
      FROM conversation_turns
      ORDER BY timestamp DESC
      LIMIT ?
    `)
    const rows = stmt.all(limit) as ConversationTurn[]
    return rows.reverse() // 按时间正序返回
  }

  /**
   * 清空对话历史
   */
  clearConversations(): void {
    this.db.prepare('DELETE FROM conversation_turns').run()
  }

  // ========== 用户画像 ==========

  /**
   * 保存用户基本信息
   */
  saveUserProfile(profile: Record<string, any>): void {
    const insert = this.db.transaction((entries: [string, any][]) => {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO user_profile (key, value, updated_at)
        VALUES (?, ?, strftime('%s', 'now'))
      `)
      for (const [key, value] of entries) {
        stmt.run(key, JSON.stringify(value))
      }
    })
    insert(Object.entries(profile))
  }

  /**
   * 获取用户基本信息
   */
  getUserProfile(): Record<string, any> {
    const stmt = this.db.prepare('SELECT key, value FROM user_profile')
    const rows = stmt.all() as Array<{ key: string; value: string }>

    const profile: Record<string, any> = {}
    for (const row of rows) {
      try {
        profile[row.key] = JSON.parse(row.value)
      } catch {
        profile[row.key] = row.value
      }
    }
    return profile
  }

  /**
   * 保存重要记忆
   */
  saveImportantMemories(memories: Map<string, string>): void {
    // 先清空现有记忆
    this.db.prepare('DELETE FROM important_memories').run()

    // 插入新记忆
    const insert = this.db.transaction((entries: [string, string][]) => {
      const stmt = this.db.prepare(`
        INSERT INTO important_memories (key, value)
        VALUES (?, ?)
      `)
      for (const [key, value] of entries) {
        stmt.run(key, value)
      }
    })
    insert(Array.from(memories.entries()))
  }

  /**
   * 获取重要记忆
   */
  getImportantMemories(): Map<string, string> {
    const stmt = this.db.prepare(`
      SELECT key, value FROM important_memories
      ORDER BY created_at DESC
      LIMIT 20
    `)
    const rows = stmt.all() as Array<{ key: string; value: string }>

    const memories = new Map<string, string>()
    for (const row of rows) {
      memories.set(row.key, row.value)
    }
    return memories
  }

  // ========== 对话摘要 ==========

  /**
   * 保存对话摘要
   */
  saveConversationSummary(summary: ConversationSummary): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO conversation_summaries
      (id, start_turn, end_turn, summary, key_topics, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      summary.id,
      summary.startTurn,
      summary.endTurn,
      summary.summary,
      JSON.stringify(summary.keyTopics),
      summary.timestamp
    )
  }

  /**
   * 获取最近的对话摘要
   */
  getConversationSummaries(limit: number = 50): ConversationSummary[] {
    const stmt = this.db.prepare(`
      SELECT id, start_turn, end_turn, summary, key_topics, timestamp
      FROM conversation_summaries
      ORDER BY timestamp DESC
      LIMIT ?
    `)
    const rows = stmt.all(limit) as Array<{
      id: string
      start_turn: number
      end_turn: number
      summary: string
      key_topics: string
      timestamp: number
    }>

    return rows.map(row => ({
      id: row.id,
      startTurn: row.start_turn,
      endTurn: row.end_turn,
      summary: row.summary,
      keyTopics: JSON.parse(row.key_topics),
      timestamp: row.timestamp
    }))
  }

  /**
   * 清空对话摘要
   */
  clearSummaries(): void {
    this.db.prepare('DELETE FROM conversation_summaries').run()
  }

  // ========== 短期 KV ==========

  /**
   * 保存短期 KV（可选，通常不持久化）
   */
  saveShortTermKV(kvMap: Map<string, ShortTermKVEntry>): void {
    // 先清空
    this.db.prepare('DELETE FROM short_term_kv').run()

    // 插入
    const insert = this.db.transaction((entries: [string, ShortTermKVEntry][]) => {
      const stmt = this.db.prepare(`
        INSERT INTO short_term_kv (key, value, last_mentioned, mention_count)
        VALUES (?, ?, ?, ?)
      `)
      for (const [key, entry] of entries) {
        stmt.run(key, JSON.stringify(entry.value), entry.lastMentioned, entry.mentionCount)
      }
    })
    insert(Array.from(kvMap.entries()))
  }

  /**
   * 获取短期 KV
   */
  getShortTermKV(): Map<string, ShortTermKVEntry> {
    const stmt = this.db.prepare(`
      SELECT key, value, last_mentioned, mention_count FROM short_term_kv
    `)
    const rows = stmt.all() as Array<{
      key: string
      value: string
      last_mentioned: number
      mention_count: number
    }>

    const kvMap = new Map<string, ShortTermKVEntry>()
    for (const row of rows) {
      kvMap.set(row.key, {
        key: row.key,
        value: JSON.parse(row.value),
        lastMentioned: row.last_mentioned,
        mentionCount: row.mention_count
      })
    }
    return kvMap
  }

  // ========== 工具方法 ==========

  /**
   * 获取统计信息
   */
  getStats(): {
    conversationCount: number
    summaryCount: number
    memoryCount: number
  } {
    const conversationCount = (this.db.prepare('SELECT COUNT(*) as count FROM conversation_turns').get() as any).count
    const summaryCount = (this.db.prepare('SELECT COUNT(*) as count FROM conversation_summaries').get() as any).count
    const memoryCount = (this.db.prepare('SELECT COUNT(*) as count FROM important_memories').get() as any).count

    return {
      conversationCount,
      summaryCount,
      memoryCount
    }
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    this.db.close()
    console.log('[MemoryDB] Database closed')
  }

  /**
   * 清空所有数据（危险操作）
   */
  clearAll(): void {
    this.db.prepare('DELETE FROM conversation_turns').run()
    this.db.prepare('DELETE FROM user_profile').run()
    this.db.prepare('DELETE FROM important_memories').run()
    this.db.prepare('DELETE FROM conversation_summaries').run()
    this.db.prepare('DELETE FROM short_term_kv').run()
    console.log('[MemoryDB] All data cleared')
  }
}
