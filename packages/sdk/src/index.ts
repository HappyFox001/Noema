import type { SDKConfig, UserInput, AgentResponse } from '@her-text/types'
import { MemoryEngine } from './memory'
import { PersonalityEngine } from './personality'
import { AgentCore, AgentRegistry } from './agent'
import { DialogueOrchestrator } from './dialogue'
import { ContextManager } from './context'
import { createLLMProvider, type LLMProvider } from '@her-text/core'

/**
 * Her-Text SDK - 核心 API
 *
 * 功能模块：
 * - Memory: 三层记忆（短期 KV + 用户画像 + 对话摘要）
 * - Personality: 人格系统（Big Five + 角色设定）
 * - Agent: 工具执行（注册/并行/钩子）
 * - Context: 上下文管理（截断/规范化）
 * - Dialogue: 对话编排（完整 Turn 生命周期）
 */
export class HerTextSDK {
  public memory: MemoryEngine
  public personality: PersonalityEngine
  public agent: AgentCore
  public registry: AgentRegistry
  private dialogue: DialogueOrchestrator
  private llm: LLMProvider

  private constructor(config: SDKConfig) {
    this.llm = createLLMProvider(config.llm)

    this.memory = new MemoryEngine(config.memory, this.llm)
    this.personality = new PersonalityEngine(config.personality)
    this.agent = new AgentCore()
    this.registry = new AgentRegistry()

    this.dialogue = new DialogueOrchestrator(
      this.llm,
      this.memory,
      this.personality,
      this.agent
    )
  }

  static async initialize(config: SDKConfig): Promise<HerTextSDK> {
    const sdk = new HerTextSDK(config)
    await sdk.memory.initialize()
    return sdk
  }

  /**
   * 发送消息（阻塞式）
   */
  async chat(input: UserInput): Promise<AgentResponse> {
    return this.dialogue.processUserInput(input)
  }

  /**
   * 发送消息（流式）
   */
  async *chatStream(input: UserInput): AsyncGenerator<string> {
    yield* this.dialogue.processUserInputStream(input)
  }

  /**
   * 获取对话上下文
   */
  getContext(): ContextManager {
    return this.dialogue.getContext()
  }

  /**
   * 获取对话统计
   */
  getStats() {
    return this.dialogue.getStats()
  }

  /**
   * 清空对话历史
   */
  clearHistory(): void {
    this.dialogue.clearHistory()
  }

  /**
   * 获取 LLM Provider（高级用法）
   */
  getLLM(): LLMProvider {
    return this.llm
  }

  /**
   * 关闭 SDK
   */
  async shutdown(): Promise<void> {
    await this.memory.shutdown()
  }
}

// 导出所有子模块
export * from './memory'
export * from './personality'
export * from './agent'
export * from './dialogue'
export * from './context'
export * from './prompt'
export * from './tools'
