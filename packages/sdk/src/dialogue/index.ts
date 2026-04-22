import type { UserInput, AgentResponse, Tool } from '@her-text/types'
import type { LLMProvider, StreamChunk } from '@her-text/core'
import type { MemoryEngine } from '../memory/index.js'
import type { PersonalityEngine } from '../personality/index.js'
import type { AgentCore } from '../agent/index.js'
import { AgentLoop } from '../agent/loop.js'
import { ContextManager, type ResponseItem, type TruncationPolicy } from '../context/index.js'
import { PromptBuilder } from '../prompt/index.js'

/**
 * 解析后的 LLM 响应（情感层）
 */
interface ParsedEmotionalResponse {
  reply: string
  hasTask: boolean
  taskDescription?: string
}

/**
 * 流式输出选项
 */
export interface StreamOptions {
  /** TTS 文本块回调（SDK 自动处理分句） */
  onTTSChunk?: (text: string) => Promise<void>
}

function scheduleAsyncTask(task: () => Promise<void>): void {
  const run = () => {
    void task().catch((error) => {
      console.error('Scheduled async task failed:', error)
    })
  }

  if (typeof globalThis.queueMicrotask === 'function') {
    globalThis.queueMicrotask(run)
    return
  }

  globalThis.setTimeout(run, 0)
}

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

      // 🔍 DEBUG: 输出完整的 Prompt
      console.log('\n========== 🔍 DEBUG: LLM Request ==========')
      console.log('📋 System Prompt:')
      console.log(system)
      console.log('\n💬 Messages:', JSON.stringify(messages, null, 2))
      console.log('\n🛠️  Tools Count:', toolSpecs?.length || 0)
      if (toolSpecs && toolSpecs.length > 0) {
        console.log('🛠️  Available Tools:', toolSpecs.map(t => t.function.name).join(', '))
        console.log('\n🛠️  Tool Specs (full):', JSON.stringify(toolSpecs, null, 2))
      }
      console.log('==========================================\n')

      // === Phase 3: LLM 调用 ===

      let responseText = ''
      let toolCalls: any[] | undefined

      try {
        const llmOptions: any = {
          max_tokens: 2048
        }

        // 如果有工具，添加到选项
        if (toolSpecs && toolSpecs.length > 0) {
          llmOptions.tools = toolSpecs
          llmOptions.tool_choice = 'auto'  // 明确告诉模型可以自动选择使用工具
        }

        // 构建完整的消息列表
        const fullMessages = [
          { role: 'system', content: system },
          ...messages
        ]

        const llmResponse = await this.llm.chat(fullMessages, llmOptions)

        // 🔍 DEBUG: 输出原始 LLM 响应
        console.log('\n========== 🔍 DEBUG: LLM Response ==========')
        console.log('📝 Raw Response Content:')
        console.log(llmResponse.content)
        console.log('\n🔧 Tool Calls:', llmResponse.toolCalls ? JSON.stringify(llmResponse.toolCalls, null, 2) : 'None')
        console.log('==========================================\n')

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
          console.log('\n========== 🔍 DEBUG: Tool Execution ==========')
          console.log('🛠️  Tool Calls:', JSON.stringify(toolCalls, null, 2))

          const toolResults = await this.agent.execute(toolCalls, {
            parallel: false,
            timeout: 30000
          })

          console.log('\n✅ Tool Results:', JSON.stringify(toolResults, null, 2))
          console.log('==========================================\n')

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
            max_tokens: 2048
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

      scheduleAsyncTask(async () => {
        await this.memory.store({
          user: input.text,
          assistant: responseText,
          timestamp: input.timestamp
        })
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
   * 流式处理用户输入（双层架构：情感层 + 执行层）
   *
   * 流程：
   * 1. 情感层 LLM 调用 → 返回 <reply> + <task>
   * 2. 流式输出 <reply> 给用户
   * 3. 如果 has_task = true，进入 Agent Loop 执行任务
   * 4. 任务完成后，情感层 LLM 包装结果
   */
  async *processUserInputStream(
    input: UserInput,
    options?: StreamOptions
  ): AsyncGenerator<string> {
    // === Phase 1: 准备阶段 ===
    const memoryContext = await this.memory.retrieve(input.text)

    const userMessage: ResponseItem = {
      role: 'user',
      content: input.text,
      timestamp: input.timestamp
    }
    this.context.recordItems([userMessage], this.truncationPolicy)

    // === Phase 2: Prompt 构建（情感层） ===
    const personality = this.personality.getPersonality()
    const tools = this.agent.getTools()
    const hasTools = tools.length > 0

    const { system, messages } = PromptBuilder.build(
      this.context.forPrompt(),
      {
        tools,  // 传递工具信息，让 LLM 知道可以做什么
        personality,
        baseInstructions: {
          system: this.buildBaseInstructions()
        },
        userProfile: memoryContext.userProfile,
        summaries: memoryContext.summaries,
        shortTermKV: memoryContext.shortTermKV
      }
    )

    console.log('\n========== 🎭 情感层 LLM 调用 ==========')
    console.log('📋 System Prompt:', system.substring(0, 500) + '...')
    console.log('🛠️  Has Tools:', hasTools)
    console.log('==========================================\n')

    // === Phase 3: 情感层 LLM 流式调用 ===
    const fullMessages = [
      { role: 'system', content: system },
      ...messages
    ]

    let fullResponse = ''
    let ttsBuffer = ''
    let emittedReplyLength = 0

    try {
      // 流式接收响应
      for await (const chunk of this.llm.streamChat(fullMessages, { max_tokens: 2048 })) {
        fullResponse += chunk

        // 实时解析并输出 <reply> 内容
        const replyStart = fullResponse.indexOf('<reply>')
        if (replyStart !== -1) {
          const contentStart = replyStart + '<reply>'.length
          const replyEnd = fullResponse.indexOf('</reply>', contentStart)

          const rawVisibleReply = replyEnd === -1
            ? fullResponse.slice(contentStart)
            : fullResponse.slice(contentStart, replyEnd)

          // 移除可能的未完成 XML 标签
          const visibleReply = this.stripTrailingXmlFragment(rawVisibleReply)
          const delta = visibleReply.slice(emittedReplyLength)

          if (delta) {
            emittedReplyLength = visibleReply.length
            yield delta

            // TTS 处理
            if (options?.onTTSChunk) {
              ttsBuffer += delta
              if (this.shouldFlushTTS(ttsBuffer)) {
                console.log('[SDK] Flushing TTS chunk:', ttsBuffer)
                await options.onTTSChunk(ttsBuffer)
                ttsBuffer = ''
              }
            }
          }
        }
      }

      // 推送剩余的 TTS 文本
      if (options?.onTTSChunk && ttsBuffer.trim()) {
        console.log('[SDK] Flushing remaining TTS chunk:', ttsBuffer)
        await options.onTTSChunk(ttsBuffer)
      }

      // === Phase 4: 解析完整响应 ===
      const parsed = this.parseEmotionalResponse(fullResponse)

      console.log('\n========== 🎭 情感层响应解析 ==========')
      console.log('📝 Reply:', parsed.reply.substring(0, 100) + '...')
      console.log('📋 Has Task:', parsed.hasTask)
      if (parsed.hasTask) {
        console.log('📋 Task Description:', parsed.taskDescription)
      }
      console.log('==========================================\n')

      // === Phase 5: 如果有任务，进入 Agent Loop ===
      let taskResult: string | null = null

      if (parsed.hasTask && parsed.taskDescription && hasTools) {
        console.log('\n========== 🔧 进入 Agent Loop ==========')

        const agentLoop = new AgentLoop(this.llm, this.agent, tools, {
          maxIterations: 10,
          timeout: 30000,
          parallelToolCalls: false
        })

        const loopResult = await agentLoop.execute(parsed.taskDescription)

        console.log('Agent Loop 结果:', loopResult)
        console.log('==========================================\n')

        if (loopResult.success) {
          taskResult = loopResult.finalResult
        } else {
          taskResult = `任务执行失败: ${loopResult.error || '未知错误'}`
        }

        // === Phase 6: 情感层包装任务结果 ===
        console.log('\n========== 🎭 情感层包装结果 ==========')

        const wrapMessages = [
          { role: 'system', content: this.buildResultWrapperPrompt(personality) },
          {
            role: 'user',
            content: `用户的原始请求: ${input.text}\n\n任务执行结果: ${taskResult}\n\n请用简洁温暖的语气告诉用户任务完成情况。`
          }
        ]

        let wrapResponse = ''
        let wrapTTSBuffer = ''

        for await (const chunk of this.llm.streamChat(wrapMessages, { max_tokens: 512 })) {
          wrapResponse += chunk
          yield chunk

          // TTS 处理
          if (options?.onTTSChunk) {
            wrapTTSBuffer += chunk
            if (this.shouldFlushTTS(wrapTTSBuffer)) {
              await options.onTTSChunk(wrapTTSBuffer)
              wrapTTSBuffer = ''
            }
          }
        }

        if (options?.onTTSChunk && wrapTTSBuffer.trim()) {
          await options.onTTSChunk(wrapTTSBuffer)
        }

        console.log('包装后回复:', wrapResponse)
        console.log('==========================================\n')

        // 合并回复
        parsed.reply = parsed.reply + '\n\n' + wrapResponse
      }

      // === Phase 7: 记录响应和更新记忆 ===
      const assistantMessage: ResponseItem = {
        role: 'assistant',
        content: parsed.reply,
        timestamp: Date.now()
      }
      this.context.recordItems([assistantMessage])

      scheduleAsyncTask(async () => {
        await this.memory.store({
          user: input.text,
          assistant: parsed.reply,
          timestamp: input.timestamp
        })
      })

    } catch (error) {
      console.error('Streaming failed:', error)
      yield '抱歉，出现了问题...'
    }
  }

  /**
   * 解析情感层 LLM 响应
   */
  private parseEmotionalResponse(response: string): ParsedEmotionalResponse {
    const result: ParsedEmotionalResponse = {
      reply: response,  // 默认返回原文
      hasTask: false
    }

    try {
      // 提取 <reply>
      const replyMatch = response.match(/<reply>([\s\S]*?)<\/reply>/)
      if (replyMatch) {
        result.reply = replyMatch[1].trim()
      }

      // 提取 <task>
      const taskMatch = response.match(/<task>([\s\S]*?)<\/task>/)
      if (taskMatch) {
        const taskContent = taskMatch[1]

        // 提取 has_task
        const hasTaskMatch = taskContent.match(/<has_task>(true|false)<\/has_task>/)
        if (hasTaskMatch) {
          result.hasTask = hasTaskMatch[1] === 'true'
        }

        // 提取 description
        if (result.hasTask) {
          const descMatch = taskContent.match(/<description>([\s\S]*?)<\/description>/)
          if (descMatch) {
            result.taskDescription = descMatch[1].trim()
          }
        }
      }
    } catch (error) {
      console.warn('Failed to parse emotional response:', error)
    }

    return result
  }

  /**
   * 构建结果包装 prompt
   */
  private buildResultWrapperPrompt(personality: any): string {
    const name = personality?.character?.name || 'Luna'
    return `你是 ${name}，一个温暖的 AI 伴侣。

用户刚刚请求你帮忙完成一个任务，任务已经执行完毕。
请用简洁、温暖的语气告诉用户结果。

规则：
- 直接输出回复，不需要任何 XML 标签
- 保持简洁，1-2 句话即可
- 语气要自然亲切
- 如果任务成功，表达开心；如果失败，表达歉意并说明原因`
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
   * 判断是否应该推送 TTS 文本
   * 策略：达到一定长度或遇到句子结束符
   */
  private shouldFlushTTS(buffer: string): boolean {
    const trimmed = buffer.trim()
    // 至少 18 个字符，或者遇到句子结束符
    return trimmed.length >= 18 || /[。！？.!?]\s*$/.test(trimmed)
  }

  private stripTrailingXmlFragment(text: string): string {
    return text.replace(/<[^>]*$/, '')
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

export * from '../context/index.js'
export * from '../prompt/index.js'
