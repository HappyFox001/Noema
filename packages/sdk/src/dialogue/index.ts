import type { UserInput, AgentResponse, Tool } from '@her-text/types'
import type { LLMProvider } from '@her-text/core'
import type { MemoryEngine } from '../memory'
import type { PersonalityEngine } from '../personality'
import type { AgentCore } from '../agent'
import { ContextManager, type ResponseItem, type TruncationPolicy } from '../context'
import { PromptBuilder } from '../prompt'

/**
 * Dialogue Orchestrator - 对话编排器
 * 整合 Context、Prompt、Memory、Personality、Agent
 * 参考 codex /core/src/session/turn.rs run_turn
 */
export class DialogueOrchestrator {
  private context: ContextManager
  private truncationPolicy: TruncationPolicy = {
    maxTokens: 8000,
    maxTurns: 50,
    preserveSystemMessages: true,
    preserveRecentTurns: 10
  }

  constructor(
    private llm: LLMProvider,
    private memory: MemoryEngine,
    private personality: PersonalityEngine,
    private agent: AgentCore
  ) {
    this.context = new ContextManager()

    // 将 LLM 注入 Memory（用于自动总结）
    this.memory.setLLM(llm)
  }

  /**
   * 处理用户输入 - 完整的 Turn 生命周期
   */
  async processUserInput(input: UserInput): Promise<AgentResponse> {
    try {
      // === Phase 1: 准备阶段 ===

      // 1. 记忆检索
      const memoryContext = await this.memory.retrieve(input.text)

      // 2. 记录用户消息到上下文
      const userMessage: ResponseItem = {
        role: 'user',
        content: input.text,
        timestamp: input.timestamp
      }
      this.context.recordItems([userMessage], this.truncationPolicy)

      // === Phase 2: Prompt 构建 ===

      const personality = this.personality.getPersonality()
      const tools = this.agent.getTools()

      const { system, messages, tools: toolSpecs } = PromptBuilder.build(
        this.context.forPrompt(),
        {
          tools,
          personality,
          baseInstructions: {
            system: this.buildBaseInstructions()
          },
          userProfile: memoryContext.userProfile,
          summaries: memoryContext.summaries,
          shortTermKV: memoryContext.shortTermKV,
          parallelToolCalls: true
        }
      )

      // === Phase 3: LLM 调用 ===

      let responseText = ''
      let toolCalls: any[] | undefined

      try {
        const llmOptions: any = {
          maxTokens: 2048
        }

        // 如果有工具，添加到选项
        if (toolSpecs && toolSpecs.length > 0) {
          llmOptions.tools = toolSpecs
        }

        // 构建完整的消息列表
        const fullMessages = [
          { role: 'system', content: system },
          ...messages
        ]

        const llmResponse = await this.llm.chat(fullMessages, llmOptions)

        // 提取工具调用（原生 API 返回）
        toolCalls = llmResponse.toolCalls

        // 解析 XML 格式的响应内容
        const parsed = this.parseXMLResponse(llmResponse.content)
        responseText = parsed.reply

        // 记录思考过程（用于调试）
        if (parsed.thinking) {
          console.log('[Thinking]:', parsed.thinking)
        }
      } catch (error) {
        console.error('LLM call failed:', error)
        responseText = '抱歉，我现在有点不在状态...'
      }

      // === Phase 4: 工具执行 ===

      if (toolCalls && toolCalls.length > 0) {
        try {
          console.log('[Tool Calls]:', toolCalls.map(tc => tc.function.name))

          const toolResults = await this.agent.execute(toolCalls, {
            parallel: false,
            timeout: 30000
          })

          console.log('[Tool Results]:', toolResults)

          // 记录助手的工具调用
          this.context.recordItems([
            {
              role: 'assistant',
              content: responseText || '',
              timestamp: Date.now(),
              toolCalls
            }
          ])

          // 构建工具结果消息（OpenAI 格式）
          const toolResultMessages = toolCalls.map((call, index) => ({
            role: 'tool',
            tool_call_id: call.id,
            name: call.function.name,
            content: JSON.stringify(toolResults[index])
          }))

          // 再次调用 LLM 处理工具结果
          const followUpMessages = [
            { role: 'system', content: system },
            ...messages,
            { role: 'assistant', content: responseText || '', tool_calls: toolCalls },
            ...toolResultMessages
          ]

          const followUpResponse = await this.llm.chat(followUpMessages, {
            maxTokens: 2048
          })

          // 解析最终回复
          const finalParsed = this.parseXMLResponse(followUpResponse.content)
          responseText = finalParsed.reply

          if (finalParsed.thinking) {
            console.log('[Thinking (after tools)]:', finalParsed.thinking)
          }
        } catch (error) {
          console.error('Tool execution failed:', error)
          responseText = '抱歉，工具执行出现了问题...'
        }
      }

      // === Phase 5: 响应处理 ===

      // 记录助手消息到上下文
      const assistantMessage: ResponseItem = {
        role: 'assistant',
        content: responseText,
        timestamp: Date.now()
      }
      this.context.recordItems([assistantMessage])

      // === Phase 6: 记忆更新（异步，不阻塞） ===

      // 使用 setImmediate 确保不阻塞主流程
      setImmediate(async () => {
        try {
          await this.memory.store({
            user: input.text,
            assistant: responseText,
            timestamp: input.timestamp
          })
        } catch (error) {
          console.error('Memory store failed:', error)
        }
      })

      // === Phase 7: 返回响应 ===

      return {
        text: responseText,
        shouldSpeak: true,
        toolCalls
      }
    } catch (error) {
      console.error('Dialogue orchestration failed:', error)

      // 错误恢复
      return {
        text: '抱歉，出现了一些问题...',
        shouldSpeak: true
      }
    }
  }

  /**
   * 流式处理用户输入
   */
  async *processUserInputStream(input: UserInput): AsyncGenerator<string> {
    // 1. 准备阶段
    const memoryContext = await this.memory.retrieve(input.text)

    const userMessage: ResponseItem = {
      role: 'user',
      content: input.text,
      timestamp: input.timestamp
    }
    this.context.recordItems([userMessage], this.truncationPolicy)

    // 2. Prompt 构建
    const personality = this.personality.getPersonality()
    const tools = this.agent.getTools()

    const { system, messages } = PromptBuilder.build(
      this.context.forPrompt(),
      {
        tools,
        personality,
        baseInstructions: {
          system: this.buildBaseInstructions()
        },
        userProfile: memoryContext.userProfile,
        summaries: memoryContext.summaries,
        shortTermKV: memoryContext.shortTermKV
      }
    )

    // 3. 流式 LLM 调用
    const fullMessages = [
      { role: 'system', content: system },
      ...messages
    ]

    let fullResponse = ''
    let inReplyTag = false
    let replyBuffer = ''

    try {
      for await (const chunk of this.llm.streamChat(fullMessages)) {
        fullResponse += chunk

        // 检测是否进入 <reply> 标签
        if (!inReplyTag && fullResponse.includes('<reply>')) {
          inReplyTag = true
          // 提取 <reply> 后的内容
          const startIndex = fullResponse.indexOf('<reply>') + 7
          replyBuffer = fullResponse.substring(startIndex)
        }

        // 如果在 <reply> 标签内，输出内容
        if (inReplyTag) {
          // 检查是否遇到 </reply>
          if (chunk.includes('</reply>')) {
            // 输出剩余内容（去掉 </reply>）
            const endIndex = replyBuffer.indexOf('</reply>')
            if (endIndex !== -1) {
              yield replyBuffer.substring(0, endIndex)
              replyBuffer = replyBuffer.substring(0, endIndex)
            }
            break
          } else {
            // 继续输出
            replyBuffer += chunk
            yield chunk
          }
        }
      }

      // 4. 解析完整响应
      const parsed = this.parseXMLResponse(fullResponse)
      const finalReply = inReplyTag ? replyBuffer : parsed.reply

      // 5. 记录响应
      const assistantMessage: ResponseItem = {
        role: 'assistant',
        content: finalReply,
        timestamp: Date.now()
      }
      this.context.recordItems([assistantMessage])

      // 6. 异步更新记忆
      setImmediate(async () => {
        try {
          await this.memory.store({
            user: input.text,
            assistant: finalReply,
            timestamp: input.timestamp
          })
        } catch (error) {
          console.error('Memory store failed:', error)
        }
      })
    } catch (error) {
      console.error('Streaming failed:', error)
      yield '抱歉，出现了问题...'
    }
  }

  /**
   * 设置截断策略
   */
  setTruncationPolicy(policy: Partial<TruncationPolicy>): void {
    this.truncationPolicy = {
      ...this.truncationPolicy,
      ...policy
    }
  }

  /**
   * 获取上下文管理器
   */
  getContext(): ContextManager {
    return this.context
  }

  /**
   * 清空对话历史
   */
  clearHistory(): void {
    this.context.clear()
  }

  /**
   * 获取对话统计
   */
  getStats(): {
    turns: number
    tokens: number
    historyVersion: number
  } {
    return {
      turns: this.context.getItems().length,
      tokens: this.context.estimateTokenCount(),
      historyVersion: this.context.getHistoryVersion()
    }
  }

  // === 私有方法 ===

  private buildBaseInstructions(): string {
    return `你是一个独立人格的 AI 伴侣。

核心原则：
- 以自然、真实的方式回应用户
- 展现你独特的个性和价值观
- 记住之前的对话内容和用户的偏好
- 在合适的时候主动关心用户

回复风格：
- 简洁自然，避免冗长
- 适当使用口语化表达
- 避免生硬的 AI 腔调`
  }

  /**
   * 解析 XML 格式的响应
   */
  private parseXMLResponse(response: string): {
    thinking?: string
    reply: string
  } {
    const result: {
      thinking?: string
      reply: string
    } = {
      reply: response  // 默认返回原文
    }

    try {
      // 提取 <thinking>
      const thinkingMatch = response.match(/<thinking>([\s\S]*?)<\/thinking>/)
      if (thinkingMatch) {
        result.thinking = thinkingMatch[1].trim()
      }

      // 提取 <reply>
      const replyMatch = response.match(/<reply>([\s\S]*?)<\/reply>/)
      if (replyMatch) {
        result.reply = replyMatch[1].trim()
      } else {
        // 如果没有 <reply> 标签，尝试提取 <response> 内的所有内容
        const responseMatch = response.match(/<response>([\s\S]*?)<\/response>/)
        if (responseMatch) {
          // 移除 thinking 和 tool_use 后的剩余内容
          let content = responseMatch[1]
          content = content.replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
          content = content.replace(/<tool_use>[\s\S]*?<\/tool_use>/g, '')
          result.reply = content.trim()
        }
      }
    } catch (error) {
      console.warn('Failed to parse XML response:', error)
      // 保持默认的 reply = response
    }

    return result
  }

  /**
   * 流式解析 XML 响应
   */
  private *parseXMLStream(fullResponse: string): Generator<string> {
    // 简单实现：逐步提取 <reply> 内容
    const replyMatch = fullResponse.match(/<reply>([\s\S]*?)(<\/reply>)?$/)

    if (replyMatch) {
      yield replyMatch[1]
    } else {
      // 如果还没到 </reply>，先输出已有内容
      const partialMatch = fullResponse.match(/<reply>([\s\S]*)$/)
      if (partialMatch) {
        yield partialMatch[1]
      }
    }
  }
}

export * from '../context'
export * from '../prompt'
