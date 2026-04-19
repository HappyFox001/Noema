import type {
  ConversationTurn,
  SDKConfig
} from '@her-text/types'
import { generateId } from '@her-text/core'
import type { LLMProvider } from '@her-text/core'

// Tauri commands (只在 Tauri 环境下可用)
declare const window: any

const isTauri = typeof window !== 'undefined' && window.__TAURI__

async function invokeCommand(cmd: string, args?: any): Promise<any> {
  if (!isTauri) {
    throw new Error('Tauri commands not available in browser mode')
  }
  return window.__TAURI__.core.invoke(cmd, args)
}

/**
 * 短期 KV 条目（外部数据引入）
 */
export interface ShortTermKVEntry {
  key: string
  value: any
  lastMentioned: number  // 最后提及时间
  mentionCount: number   // 提及次数
}

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

/**
 * Memory Engine - 三层记忆系统
 *
 * Part 1: 短期 KV - 最近几轮提到的外部数据
 * Part 2: 用户画像 - Profile + 重要记忆 (自动总结)
 * Part 3: 对话摘要 - 每 10 轮总结
 */
export class MemoryEngine {
  // Part 1: 短期 KV 存储
  private shortTermKV: Map<string, ShortTermKVEntry> = new Map()
  private shortTermWindowSize: number = 5  // 保留最近 5 轮提到的

  // Part 2: 用户画像
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

  // 数据库持久化状态
  private persistenceEnabled: boolean = false

  constructor(
    private config: SDKConfig['memory'],
    llm?: LLMProvider
  ) {
    this.llm = llm
  }

  async initialize(): Promise<void> {
    if (!isTauri) {
      console.log('[MemoryEngine] Initialized (browser mode, no persistence)')
      return
    }

    try {
      // 从数据库加载记忆
      await this.loadFromDatabase()
      this.persistenceEnabled = true
      console.log('[MemoryEngine] Initialized with SQLite persistence')
    } catch (error) {
      console.error('[MemoryEngine] Failed to initialize database:', error)
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
   * Part 1: 添加短期 KV（外部数据）
   */
  addShortTermKV(key: string, value: any): void {
    const existing = this.shortTermKV.get(key)

    if (existing) {
      existing.value = value
      existing.lastMentioned = Date.now()
      existing.mentionCount++
    } else {
      this.shortTermKV.set(key, {
        key,
        value,
        lastMentioned: Date.now(),
        mentionCount: 1
      })
    }

    // 清理过期的 KV（超过窗口大小）
    this.cleanupShortTermKV()
  }

  /**
   * 清理短期 KV（只保留最近提到的）
   */
  private cleanupShortTermKV(): void {
    const entries = Array.from(this.shortTermKV.values())
      .sort((a, b) => b.lastMentioned - a.lastMentioned)

    if (entries.length > this.shortTermWindowSize) {
      const toRemove = entries.slice(this.shortTermWindowSize)
      toRemove.forEach(entry => this.shortTermKV.delete(entry.key))
    }
  }

  /**
   * 获取短期 KV（用于上下文注入）
   */
  getShortTermKV(): Record<string, any> {
    const result: Record<string, any> = {}
    this.shortTermKV.forEach((entry, key) => {
      result[key] = entry.value
    })
    return result
  }

  /**
   * Part 2: 更新用户画像的基本信息
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
    shortTermKV: Record<string, any>
    userProfile: UserProfile
    summaries: ConversationSummary[]
  }> {
    return {
      shortTermKV: this.getShortTermKV(),
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
   * 从数据库加载记忆
   */
  private async loadFromDatabase(): Promise<void> {
    try {
      // 加载工作记忆
      const turns = await invokeCommand('get_recent_conversations', { limit: 100 })
      this.workingMemory = turns as ConversationTurn[]

      // 加载用户画像
      const profileEntries = await invokeCommand('get_user_profile')
      this.userProfile.basic = {}
      for (const entry of profileEntries) {
        try {
          this.userProfile.basic[entry.key] = JSON.parse(entry.value)
        } catch {
          this.userProfile.basic[entry.key] = entry.value
        }
      }

      // 加载重要记忆
      const memories = await invokeCommand('get_important_memories')
      this.userProfile.importantMemories = new Map()
      for (const mem of memories) {
        this.userProfile.importantMemories.set(mem.key, mem.value)
      }

      // 加载对话摘要
      const summaries = await invokeCommand('get_conversation_summaries', { limit: 50 })
      this.conversationSummaries = summaries.map((s: any) => ({
        id: s.id,
        startTurn: s.start_turn,
        endTurn: s.end_turn,
        summary: s.summary,
        keyTopics: s.key_topics,
        timestamp: s.timestamp
      }))

      // 计算轮次计数器
      this.turnCounter = Math.floor(this.workingMemory.length / 2)

      // 获取统计信息
      const stats = await invokeCommand('get_memory_stats')
      console.log('[MemoryEngine] Loaded from database:', stats)
    } catch (error) {
      console.error('[MemoryEngine] Failed to load from database:', error)
      throw error
    }
  }

  /**
   * 保存记忆到数据库
   */
  private async saveToDatabase(): Promise<void> {
    try {
      // 保存工作记忆（最近 100 条）
      const recentTurns = this.workingMemory.slice(-100)
      for (const turn of recentTurns) {
        await invokeCommand('save_conversation_turn', { turn })
      }

      // 保存用户画像
      for (const [key, value] of Object.entries(this.userProfile.basic)) {
        await invokeCommand('save_user_profile_entry', {
          key,
          value: JSON.stringify(value)
        })
      }

      // 保存重要记忆
      for (const [key, value] of this.userProfile.importantMemories.entries()) {
        await invokeCommand('save_important_memory', { key, value })
      }

      // 保存对话摘要
      for (const summary of this.conversationSummaries) {
        await invokeCommand('save_conversation_summary', {
          summary: {
            id: summary.id,
            start_turn: summary.startTurn,
            end_turn: summary.endTurn,
            summary: summary.summary,
            key_topics: summary.keyTopics,
            timestamp: summary.timestamp
          }
        })
      }

      console.log('[MemoryEngine] Saved to database')
    } catch (error) {
      console.error('[MemoryEngine] Failed to save to database:', error)
    }
  }
}
