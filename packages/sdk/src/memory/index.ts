import type {
  ConversationTurn,
  SDKConfig
} from '@her-text/types'
import { generateId } from '@her-text/core'
import type { LLMProvider } from '@her-text/core'
import { mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import {
  parseJsonArray,
  runSqlite,
  runSqliteJson,
  sqlText,
} from './sqlite-runtime.js'

/**
 * 用户画像
 */
export interface UserProfile {
  basic: {
    name?: string
    age?: number
    location?: string
    occupation?: string
    interests?: string[]
    [key: string]: any
  }
  importantMemories: Map<string, string>  // 最多 20 条 KV
}

/**
 * 对话摘要
 */
export interface ConversationSummary {
  id: string
  startTurn: number
  endTurn: number
  summary: string
  keyTopics: string[]
  timestamp: number
}

const MEMORY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS conversation_turns (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_profile (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS important_memories (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_summaries (
  id TEXT PRIMARY KEY,
  start_turn INTEGER NOT NULL,
  end_turn INTEGER NOT NULL,
  summary TEXT NOT NULL,
  key_topics TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`


/**
 * Memory Engine - 记忆系统
 *
 * Part 1: 用户画像 - Profile + 重要记忆 (自动总结)
 * Part 2: 对话摘要 - 每 10 轮总结
 */
export class MemoryEngine {
  // Part 1: 用户画像
  private userProfile: UserProfile = {
    basic: {},
    importantMemories: new Map()
  }
  private maxImportantMemories: number = 20

  // Part 3: 对话摘要
  private conversationSummaries: ConversationSummary[] = []
  private summaryInterval: number = 10  // 每 10 轮总结

  // 工作记忆（原始对话）
  private workingMemory: ConversationTurn[] = []
  private turnCounter: number = 0

  // LLM（用于异步总结）
  private llm?: LLMProvider

  // 异步更新队列（防止阻塞主流程）
  private updateQueue: Promise<void> = Promise.resolve()

  // SQLite 持久化状态
  private persistenceEnabled: boolean = false
  private persistenceDbPath: string

  constructor(
    private config: SDKConfig['memory'],
    llm?: LLMProvider
  ) {
    this.llm = llm
    const storageDir = isAbsolute(config.storageDir)
      ? config.storageDir
      : resolve(process.cwd(), config.storageDir)
    this.persistenceDbPath = resolve(storageDir, 'memory.sqlite3')
  }

  async initialize(): Promise<void> {
    try {
      await mkdir(dirname(this.persistenceDbPath), { recursive: true })
      console.log('[MemoryEngine] Storage directory:', dirname(this.persistenceDbPath))
      console.log('[MemoryEngine] Database path:', this.persistenceDbPath)
      await this.ensureDatabase()
      await this.loadFromDatabase()
      this.persistenceEnabled = true
      console.log('[MemoryEngine] Initialized with SQLite persistence')
    } catch (error) {
      console.error('[MemoryEngine] Failed to initialize persistence:', error)
      console.log('[MemoryEngine] Continuing in memory-only mode')
    }
  }

  setLLM(llm: LLMProvider): void {
    this.llm = llm
  }

  /**
   * 存储对话轮次
   */
  async store(turn: {
    user: string
    assistant: string
    timestamp: number
  }): Promise<void> {
    // 存储到工作记忆
    this.workingMemory.push({
      id: generateId(),
      role: 'user',
      content: turn.user,
      timestamp: turn.timestamp
    })

    this.workingMemory.push({
      id: generateId(),
      role: 'assistant',
      content: turn.assistant,
      timestamp: turn.timestamp
    })

    this.turnCounter++

    // 限制工作记忆大小（保留最近 50 轮）
    if (this.workingMemory.length > 100) {  // 50 轮 = 100 条消息
      this.workingMemory.splice(0, this.workingMemory.length - 100)
    }

    // 每 10 轮触发异步更新（不阻塞）
    if (this.turnCounter % this.summaryInterval === 0) {
      this.scheduleAsyncUpdate()
    }
  }

  /**
   * 更新用户画像的基本信息
   */
  updateUserBasicProfile(updates: Partial<UserProfile['basic']>): void {
    this.userProfile.basic = {
      ...this.userProfile.basic,
      ...updates
    }
  }

  /**
   * Part 2: 添加/更新重要记忆
   */
  addImportantMemory(key: string, value: string): void {
    this.userProfile.importantMemories.set(key, value)

    // 限制数量（FIFO，最多 20 条）
    if (this.userProfile.importantMemories.size > this.maxImportantMemories) {
      const firstKey = this.userProfile.importantMemories.keys().next().value
      if (firstKey !== undefined) {
        this.userProfile.importantMemories.delete(firstKey)
      }
    }
  }

  /**
   * 获取用户画像
   */
  getUserProfile(): UserProfile {
    return {
      basic: { ...this.userProfile.basic },
      importantMemories: new Map(this.userProfile.importantMemories)
    }
  }

  /**
   * Part 3: 获取对话摘要
   */
  getConversationSummaries(limit: number = 5): ConversationSummary[] {
    return this.conversationSummaries
      .slice(-limit)
      .map(s => ({ ...s }))
  }

  /**
   * 获取工作记忆（最近对话）
   */
  getWorkingMemory(): ConversationTurn[] {
    return [...this.workingMemory]
  }

  /**
   * 检索相关记忆（用于上下文）
   */
  async retrieve(query: string): Promise<{
    userProfile: UserProfile
    summaries: ConversationSummary[]
  }> {
    return {
      userProfile: this.getUserProfile(),
      summaries: this.getConversationSummaries(3)
    }
  }

  /**
   * 异步更新调度（不阻塞主流程）
   */
  private scheduleAsyncUpdate(): void {
    // 链式 Promise，确保串行执行
    this.updateQueue = this.updateQueue
      .then(() => this.performAsyncUpdate())
      .catch(error => {
        console.error('Async memory update failed:', error)
      })
  }

  /**
   * 执行异步更新（每 10 轮触发）
   */
  private async performAsyncUpdate(): Promise<void> {
    if (!this.llm) {
      console.warn('LLM not available for memory update')
      return
    }

    console.log(`[Memory] Starting async update at turn ${this.turnCounter}`)

    try {
      // 获取最近 10 轮对话
      const recentTurns = this.getRecentTurns(this.summaryInterval)

      // 并行执行两个任务
      await Promise.all([
        this.generateConversationSummary(recentTurns),
        this.updateUserProfileFromConversation(recentTurns)
      ])

      console.log(`[Memory] Async update completed`)

      // 自动保存到数据库
      if (this.persistenceEnabled) {
        await this.saveToDatabase()
      }
    } catch (error) {
      console.error('[Memory] Async update error:', error)
    }
  }

  /**
   * 获取最近 N 轮对话
   */
  private getRecentTurns(n: number): ConversationTurn[] {
    const messageCount = n * 2  // 每轮 2 条消息（user + assistant）
    return this.workingMemory.slice(-messageCount)
  }

  /**
   * 生成对话摘要（Part 3）
   */
  private async generateConversationSummary(turns: ConversationTurn[]): Promise<void> {
    if (turns.length === 0) return

    const conversationText = turns
      .map(t => `${t.role === 'user' ? '用户' : 'AI'}: ${t.content}`)
      .join('\n')

    const prompt = `请总结以下对话，提取关键信息和主题。

对话内容：
${conversationText}

请以 JSON 格式返回：
{
  "summary": "对话的简洁总结（1-2 句话）",
  "keyTopics": ["主题1", "主题2", ...]
}
`

    try {
      const response = await this.llm!.chat([
        { role: 'user', content: prompt }
      ])

      const parsed = this.parseJSONResponse(response.content)

      const summary: ConversationSummary = {
        id: generateId(),
        startTurn: this.turnCounter - this.summaryInterval + 1,
        endTurn: this.turnCounter,
        summary: parsed.summary || '无摘要',
        keyTopics: parsed.keyTopics || [],
        timestamp: Date.now()
      }

      this.conversationSummaries.push(summary)

      // 限制摘要数量（保留最近 50 个）
      if (this.conversationSummaries.length > 50) {
        this.conversationSummaries.splice(0, this.conversationSummaries.length - 50)
      }
    } catch (error) {
      console.error('Failed to generate conversation summary:', error)
    }
  }

  /**
   * 从对话更新用户画像（Part 2）
   */
  private async updateUserProfileFromConversation(turns: ConversationTurn[]): Promise<void> {
    if (turns.length === 0) return

    const conversationText = turns
      .map(t => `${t.role === 'user' ? '用户' : 'AI'}: ${t.content}`)
      .join('\n')

    const prompt = `请从以下对话中提取用户的信息和重要记忆。

对话内容：
${conversationText}

请以 JSON 格式返回：
{
  "basicProfile": {
    "name": "提取到的姓名（如果有）",
    "location": "提取到的地点（如果有）",
    "occupation": "提取到的职业（如果有）",
    ...其他基本信息
  },
  "importantMemories": {
    "偏好": "提取到的偏好信息",
    "习惯": "提取到的习惯信息",
    ...其他重要记忆（键值对形式）
  }
}


注意：
- 只提取明确提到的信息，不要猜测
- 如果某项信息没有提及，不要返回该字段
- 重要记忆用简洁的键值对表示
`

    try {
      const response = await this.llm!.chat([
        { role: 'user', content: prompt }
      ])

      const parsed = this.parseJSONResponse(response.content)

      // 更新基本画像
      if (parsed.basicProfile) {
        this.updateUserBasicProfile(parsed.basicProfile)
      }

      // 更新重要记忆
      if (parsed.importantMemories) {
        Object.entries(parsed.importantMemories).forEach(([key, value]) => {
          this.addImportantMemory(key, String(value))
        })
      }

      console.log('[Memory] User profile updated:', {
        basic: Object.keys(parsed.basicProfile || {}),
        memories: Object.keys(parsed.importantMemories || {})
      })
    } catch (error) {
      console.error('Failed to update user profile:', error)
    }
  }

  /**
   * 解析 JSON 响应（容错）
   */
  private parseJSONResponse(response: string): any {
    try {
      // 尝试提取 JSON（可能包含其他文本）
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0])
      }
      return JSON.parse(response)
    } catch {
      console.warn('Failed to parse JSON response:', response)
      return {}
    }
  }

  /**
   * 手动触发巩固（用于测试）
   */
  async consolidate(): Promise<void> {
    await this.performAsyncUpdate()
  }

  /**
   * 关闭引擎
   */
  async shutdown(): Promise<void> {
    try {
      // 等待所有异步更新完成
      await this.updateQueue

      // 保存到数据库
      if (this.persistenceEnabled) {
        await this.saveToDatabase()
      }

      console.log('[MemoryEngine] Shutdown complete')
    } catch (error) {
      console.error('[MemoryEngine] Error during shutdown:', error)
    }
  }

  /**
   * 初始化 SQLite 表结构
   */
  private async ensureDatabase(): Promise<void> {
    await runSqlite(this.persistenceDbPath, MEMORY_SCHEMA_SQL)
  }

  /**
   * 从数据库加载记忆
   */
  private async loadFromDatabase(): Promise<void> {
    try {
      this.workingMemory = await runSqliteJson<ConversationTurn>(
        this.persistenceDbPath,
        `
        SELECT id, role, content, timestamp
        FROM (
          SELECT id, role, content, timestamp
          FROM conversation_turns
          ORDER BY timestamp DESC
          LIMIT 100
        )
        ORDER BY timestamp ASC;
        `
      )

      const profileRows = await runSqliteJson<{ key: string, value: string }>(
        this.persistenceDbPath,
        'SELECT key, value FROM user_profile ORDER BY key ASC;'
      )
      this.userProfile.basic = {}
      for (const row of profileRows) {
        try {
          this.userProfile.basic[row.key] = JSON.parse(row.value)
        } catch {
          this.userProfile.basic[row.key] = row.value
        }
      }

      const memoryRows = await runSqliteJson<{ key: string, value: string }>(
        this.persistenceDbPath,
        'SELECT key, value FROM important_memories ORDER BY key ASC;'
      )
      this.userProfile.importantMemories = new Map(memoryRows.map(row => [row.key, row.value]))

      const summaryRows = await runSqliteJson<{
        id: string
        start_turn: number
        end_turn: number
        summary: string
        key_topics: string
        timestamp: number
      }>(
        this.persistenceDbPath,
        `
        SELECT id, start_turn, end_turn, summary, key_topics, timestamp
        FROM conversation_summaries
        ORDER BY timestamp ASC;
        `
      )
      this.conversationSummaries = summaryRows.map(row => ({
        id: row.id,
        startTurn: row.start_turn,
        endTurn: row.end_turn,
        summary: row.summary,
        keyTopics: parseJsonArray(row.key_topics),
        timestamp: row.timestamp
      }))

      const metadataRows = await runSqliteJson<{ value: string }>(
        this.persistenceDbPath,
        "SELECT value FROM metadata WHERE key = 'turn_counter' LIMIT 1;"
      )
      this.turnCounter = metadataRows[0]
        ? Number(metadataRows[0].value)
        : Math.floor(this.workingMemory.length / 2)

      console.log('[MemoryEngine] Loaded from SQLite:', {
        turns: this.workingMemory.length,
        profileKeys: Object.keys(this.userProfile.basic).length,
        importantMemories: this.userProfile.importantMemories.size,
        summaries: this.conversationSummaries.length
      })
    } catch (error) {
      console.error('[MemoryEngine] Failed to load from SQLite:', error)
      throw error
    }
  }

  /**
   * 保存记忆到数据库
   */
  private async saveToDatabase(): Promise<void> {
    try {
      const statements: string[] = ['BEGIN;']

      statements.push('DELETE FROM conversation_turns;')
      for (const turn of this.workingMemory.slice(-100)) {
        statements.push(
          `INSERT INTO conversation_turns (id, role, content, timestamp) VALUES (${sqlText(turn.id)}, ${sqlText(turn.role)}, ${sqlText(turn.content)}, ${turn.timestamp});`
        )
      }

      statements.push('DELETE FROM user_profile;')
      for (const [key, value] of Object.entries(this.userProfile.basic)) {
        statements.push(
          `INSERT INTO user_profile (key, value) VALUES (${sqlText(key)}, ${sqlText(JSON.stringify(value))});`
        )
      }

      statements.push('DELETE FROM important_memories;')
      for (const [key, value] of this.userProfile.importantMemories.entries()) {
        statements.push(
          `INSERT INTO important_memories (key, value) VALUES (${sqlText(key)}, ${sqlText(value)});`
        )
      }

      statements.push('DELETE FROM conversation_summaries;')
      for (const summary of this.conversationSummaries.slice(-50)) {
        statements.push(
          `INSERT INTO conversation_summaries (id, start_turn, end_turn, summary, key_topics, timestamp) VALUES (${sqlText(summary.id)}, ${summary.startTurn}, ${summary.endTurn}, ${sqlText(summary.summary)}, ${sqlText(JSON.stringify(summary.keyTopics))}, ${summary.timestamp});`
        )
      }

      statements.push(
        `INSERT INTO metadata (key, value) VALUES ('turn_counter', ${sqlText(String(this.turnCounter))})
         ON CONFLICT(key) DO UPDATE SET value = excluded.value;`
      )

      statements.push('COMMIT;')
      await runSqlite(this.persistenceDbPath, statements.join('\n'))
      console.log('[MemoryEngine] Saved to SQLite')
    } catch (error) {
      console.error('[MemoryEngine] Failed to save to SQLite:', error)
    }
  }
}
