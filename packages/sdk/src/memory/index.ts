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
import { PROMPTS } from '../prompts.js'


export interface UserProfile {
  basic: {
    name?: string
    age?: number
    location?: string
    occupation?: string
    interests?: string[]
    [key: string]: any
  }
  importantMemories: Map<string, string>
}


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


export class MemoryEngine {
  private userProfile: UserProfile = {
    basic: {},
    importantMemories: new Map()
  }
  private maxImportantMemories: number = 20

  private conversationSummaries: ConversationSummary[] = []
  private summaryInterval: number = 10

  private workingMemory: ConversationTurn[] = []
  private turnCounter: number = 0

  private llm?: LLMProvider

  private updateQueue: Promise<void> = Promise.resolve()
  private persistenceQueue: Promise<void> = Promise.resolve()

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

  
  async store(turn: {
    user: string
    assistant: string
    timestamp: number
  }): Promise<void> {
    await this.storeMessages([
      {
        role: 'user',
        content: turn.user,
        timestamp: turn.timestamp
      },
      {
        role: 'assistant',
        content: turn.assistant,
        timestamp: turn.timestamp
      }
    ])
  }

  
  async storeMessages(messages: Array<{
    role: ConversationTurn['role']
    content: string
    timestamp: number
  }>): Promise<void> {
    const normalized = messages
      .map((message) => ({
        ...message,
        content: message.content.trim()
      }))
      .filter((message) => message.content.length > 0)

    if (normalized.length === 0) {
      return
    }

    for (const message of normalized) {
      this.workingMemory.push({
        id: generateId(),
        role: message.role,
        content: message.content,
        timestamp: message.timestamp
      })
    }

    this.turnCounter += normalized.filter((message) => message.role === 'user').length
    this.trimWorkingMemory()

    if (this.turnCounter > 0 && this.turnCounter % this.summaryInterval === 0) {
      this.scheduleAsyncUpdate()
    }

    await this.persistToDatabase()
  }

  
  getUserProfile(): UserProfile {
    return {
      basic: { ...this.userProfile.basic },
      importantMemories: new Map(this.userProfile.importantMemories)
    }
  }

  
  getConversationSummaries(limit: number = 5): ConversationSummary[] {
    return this.conversationSummaries
      .slice(-limit)
      .map(s => ({ ...s }))
  }

  
  getWorkingMemory(): ConversationTurn[] {
    return [...this.workingMemory]
  }

  
  async retrieve(query: string): Promise<{
    userProfile: UserProfile
    summaries: ConversationSummary[]
  }> {
    return {
      userProfile: this.getUserProfile(),
      summaries: this.getConversationSummaries(3)
    }
  }

  
  private scheduleAsyncUpdate(): void {
    this.updateQueue = this.updateQueue
      .then(() => this.performAsyncUpdate())
      .catch(error => {
        console.error('Async memory update failed:', error)
      })
  }

  
  private async performAsyncUpdate(): Promise<void> {
    if (!this.llm) {
      console.warn('LLM not available for memory update')
      return
    }

    console.log(`[Memory] Starting async update at turn ${this.turnCounter}`)

    try {
      const recentTurns = this.getRecentTurns(this.summaryInterval)

      await Promise.all([
        this.generateConversationSummary(recentTurns),
        this.updateUserProfileFromConversation(recentTurns)
      ])

      console.log(`[Memory] Async update completed`)

      await this.persistToDatabase()
    } catch (error) {
      console.error('[Memory] Async update error:', error)
    }
  }

  
  private getRecentTurns(n: number): ConversationTurn[] {
    const messageCount = n * 2
    return this.workingMemory.slice(-messageCount)
  }

  private trimWorkingMemory(): void {
    if (this.workingMemory.length > 100) {
      this.workingMemory.splice(0, this.workingMemory.length - 100)
    }
  }

  
  private async generateConversationSummary(turns: ConversationTurn[]): Promise<void> {
    if (turns.length === 0) return

    const conversationText = turns
      .map(t => `${t.role === 'user' ? '用户' : 'AI'}: ${t.content}`)
      .join('\n')

    const prompt = `${PROMPTS.memory.summarizeConversation}

对话内容：
${conversationText}`

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

      if (this.conversationSummaries.length > 50) {
        this.conversationSummaries.splice(0, this.conversationSummaries.length - 50)
      }
    } catch (error) {
      console.error('Failed to generate conversation summary:', error)
    }
  }

  
  private async updateUserProfileFromConversation(turns: ConversationTurn[]): Promise<void> {
    if (turns.length === 0) return

    const conversationText = turns
      .map(t => `${t.role === 'user' ? '用户' : 'AI'}: ${t.content}`)
      .join('\n')

    const currentProfile = {
      name: this.userProfile.basic.name,
      nickname: this.userProfile.basic.nickname,
      age: this.userProfile.basic.age,
      gender: this.userProfile.basic.gender,
      location: this.userProfile.basic.location,
      occupation: this.userProfile.basic.occupation,
    }
    const filteredProfile = Object.fromEntries(
      Object.entries(currentProfile).filter(([_, v]) => v !== undefined)
    ) as typeof currentProfile

    const currentMemories = Object.fromEntries(this.userProfile.importantMemories)

    const prompt = `${PROMPTS.memory.updateUserProfile(filteredProfile, currentMemories)}

## 最近对话
${conversationText}`

    try {
      const response = await this.llm!.chat([
        { role: 'user', content: prompt }
      ])

      const parsed = this.parseJSONResponse(response.content)
      let profileChanges = 0
      let memoryChanges = 0

      if (parsed.profile) {
        if (parsed.profile.update) {
          const allowedFields = ['name', 'nickname', 'age', 'gender', 'location', 'occupation']
          for (const [key, value] of Object.entries(parsed.profile.update)) {
            if (allowedFields.includes(key) && value !== undefined && value !== null) {
              (this.userProfile.basic as any)[key] = value
              profileChanges++
            }
          }
        }
        if (Array.isArray(parsed.profile.delete)) {
          for (const key of parsed.profile.delete) {
            if (key in this.userProfile.basic) {
              delete (this.userProfile.basic as any)[key]
              profileChanges++
            }
          }
        }
      }

      if (parsed.memories) {
        if (parsed.memories.add) {
          for (const [key, value] of Object.entries(parsed.memories.add)) {
            if (!this.userProfile.importantMemories.has(key)) {
              this.userProfile.importantMemories.set(key, String(value))
              memoryChanges++
            }
          }
        }
        if (parsed.memories.update) {
          for (const [key, value] of Object.entries(parsed.memories.update)) {
            if (this.userProfile.importantMemories.has(key)) {
              this.userProfile.importantMemories.set(key, String(value))
              memoryChanges++
            }
          }
        }
        if (Array.isArray(parsed.memories.delete)) {
          for (const key of parsed.memories.delete) {
            if (this.userProfile.importantMemories.delete(key)) {
              memoryChanges++
            }
          }
        }

        if (this.userProfile.importantMemories.size > this.maxImportantMemories) {
          const entries = Array.from(this.userProfile.importantMemories.entries())
          const toRemove = entries.slice(0, entries.length - this.maxImportantMemories)
          for (const [key] of toRemove) {
            this.userProfile.importantMemories.delete(key)
          }
        }
      }

      console.log('[Memory] Profile update:', {
        profileChanges,
        memoryChanges,
        operations: parsed
      })
    } catch (error) {
      console.error('Failed to update user profile:', error)
    }
  }

  
  private parseJSONResponse(response: string): any {
    try {
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

  
  async shutdown(): Promise<void> {
    try {
      await this.updateQueue
      await this.persistenceQueue

      await this.persistToDatabase()

      console.log('[MemoryEngine] Shutdown complete')
    } catch (error) {
      console.error('[MemoryEngine] Error during shutdown:', error)
    }
  }

  async clearAll(): Promise<void> {
    this.workingMemory = []
    this.turnCounter = 0
    this.userProfile = {
      basic: {},
      importantMemories: new Map()
    }
    this.conversationSummaries = []

    if (!this.persistenceEnabled) {
      return
    }

    await runSqlite(this.persistenceDbPath, `
      DELETE FROM conversation_turns;
      DELETE FROM user_profile;
      DELETE FROM important_memories;
      DELETE FROM conversation_summaries;
      DELETE FROM metadata;
    `)
  }

  async clearUserProfile(): Promise<void> {
    this.userProfile = {
      basic: {},
      importantMemories: new Map()
    }

    if (!this.persistenceEnabled) {
      return
    }

    await runSqlite(this.persistenceDbPath, `
      DELETE FROM user_profile;
      DELETE FROM important_memories;
    `)
  }

  
  async updateUserProfileBasic(updates: Partial<UserProfile['basic']>): Promise<void> {
    this.userProfile.basic = {
      ...this.userProfile.basic,
      ...updates
    }

    for (const key of Object.keys(this.userProfile.basic)) {
      if (this.userProfile.basic[key as keyof typeof this.userProfile.basic] === '') {
        delete this.userProfile.basic[key as keyof typeof this.userProfile.basic]
      }
    }

    if (this.persistenceEnabled) {
      await this.saveToDatabase()
    }
  }

  
  async addImportantMemory(key: string, value: string): Promise<void> {
    this.userProfile.importantMemories.set(key, value)

    if (this.userProfile.importantMemories.size > 20) {
      const firstKey = this.userProfile.importantMemories.keys().next().value
      if (firstKey) {
        this.userProfile.importantMemories.delete(firstKey)
      }
    }

    if (this.persistenceEnabled) {
      await this.saveToDatabase()
    }
  }

  
  async deleteImportantMemory(key: string): Promise<void> {
    this.userProfile.importantMemories.delete(key)

    if (this.persistenceEnabled) {
      await runSqlite(this.persistenceDbPath, `
        DELETE FROM important_memories WHERE key = ${sqlText(key)};
      `)
    }
  }

  
  getAllConversationSummaries(): ConversationSummary[] {
    return this.conversationSummaries.map(s => ({ ...s }))
  }

  
  async deleteConversationSummary(id: string): Promise<void> {
    this.conversationSummaries = this.conversationSummaries.filter(s => s.id !== id)

    if (this.persistenceEnabled) {
      await runSqlite(this.persistenceDbPath, `
        DELETE FROM conversation_summaries WHERE id = ${sqlText(id)};
      `)
    }
  }

  
  async deleteConversationTurn(id: string): Promise<void> {
    this.workingMemory = this.workingMemory.filter(t => t.id !== id)

    if (this.persistenceEnabled) {
      await runSqlite(this.persistenceDbPath, `
        DELETE FROM conversation_turns WHERE id = ${sqlText(id)};
      `)
    }
  }

  
  async deleteProfileField(field: string): Promise<void> {
    delete (this.userProfile.basic as any)[field]

    if (this.persistenceEnabled) {
      await runSqlite(this.persistenceDbPath, `
        DELETE FROM user_profile WHERE key = ${sqlText(field)};
      `)
    }
  }

  
  async clearImportantMemories(): Promise<void> {
    this.userProfile.importantMemories.clear()

    if (this.persistenceEnabled) {
      await runSqlite(this.persistenceDbPath, `
        DELETE FROM important_memories;
      `)
    }
  }

  
  async clearConversationSummaries(): Promise<void> {
    this.conversationSummaries = []

    if (this.persistenceEnabled) {
      await runSqlite(this.persistenceDbPath, `
        DELETE FROM conversation_summaries;
      `)
    }
  }

  
  async clearWorkingMemory(): Promise<void> {
    this.workingMemory = []
    this.turnCounter = 0

    if (this.persistenceEnabled) {
      await runSqlite(this.persistenceDbPath, `
        DELETE FROM conversation_turns;
        DELETE FROM metadata WHERE key = 'turn_counter';
      `)
    }
  }

  
  private async ensureDatabase(): Promise<void> {
    await runSqlite(this.persistenceDbPath, MEMORY_SCHEMA_SQL)
  }

  
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

  private async persistToDatabase(): Promise<void> {
    if (!this.persistenceEnabled) {
      return
    }

    const saveTask = this.persistenceQueue
      .catch(() => undefined)
      .then(() => this.saveToDatabase())

    this.persistenceQueue = saveTask.catch(() => undefined)
    await saveTask
  }
}
