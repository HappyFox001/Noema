import type { SDKConfig, UserInput, AgentResponse } from '@her-text/types'
import { MemoryEngine } from './memory/index.js'
import { PersonalityEngine } from './personality/index.js'
import { AgentCore } from './agent/index.js'
import { DialogueOrchestrator } from './dialogue/index.js'
import { ContextManager } from './context/index.js'
import { createLLMProvider, type LLMProvider } from '@her-text/core'
import { createDefaultTools } from './tools/index.js'

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
  private dialogue: DialogueOrchestrator
  private llm: LLMProvider

  private constructor(config: SDKConfig) {
    this.llm = createLLMProvider(config.llm)

    this.memory = new MemoryEngine(config.memory, this.llm)
    this.personality = new PersonalityEngine(config.personality)
    this.agent = new AgentCore()
    createDefaultTools().forEach(tool => this.agent.registerTool(tool))

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
    const chunks: string[] = []
    for await (const chunk of this.dialogue.processUserInputStream(input)) {
      chunks.push(chunk)
    }

    return {
      text: chunks.join(''),
      shouldSpeak: true
    }
  }

  /**
   * 发送消息（流式）
   */
  async *chatStream(
    input: UserInput,
    options?: import('./dialogue/index.js').StreamOptions
  ): AsyncGenerator<string> {
    yield* this.dialogue.processUserInputStream(input, options)
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

// 导出所有子模块（明确指定文件以兼容 Node.js ES modules）
export * from './memory/index.js'
export * from './personality/index.js'
export * from './agent/index.js'
export * from './dialogue/index.js'
export * from './context/index.js'
export * from './prompt/index.js'
export * from './tools/index.js'
export * from './audio/index.js'
export * from './session/session.js'
