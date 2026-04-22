import type { UserInput } from '@her-text/types'
import type { LLMProvider } from '@her-text/core'
import type { MemoryEngine } from '../memory/index.js'
import type { PersonalityEngine } from '../personality/index.js'
import type { AgentCore } from '../agent/index.js'
import { ContextManager, type ResponseItem, type TruncationPolicy } from '../context/index.js'
import { PromptBuilder } from '../prompt/index.js'
import { TaskSession } from '../session/session.js'

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

export class DialogueOrchestrator {
  private context: ContextManager
  private taskSession: TaskSession
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
    this.taskSession = new TaskSession(llm, memory, personality, agent, this.context)

    this.memory.setLLM(llm)
  }

  async *processUserInputStream(
    input: UserInput,
    options?: StreamOptions
  ): AsyncGenerator<string> {
    const memoryContext = await this.memory.retrieve(input.text)

    // 记录用户消息
    const userMessage: ResponseItem = {
      role: 'user',
      content: input.text,
      timestamp: input.timestamp
    }
    this.context.recordItems([userMessage], this.truncationPolicy)

    const personality = this.personality.getPersonality()
    const tools = this.agent.getTools()
    const hasTools = tools.length > 0

    try {
      // === 第一次情感层调用（检测任务） ===
      const firstResult = await this.runEmotionalLayer({
        memoryContext,
        personality,
        tools,
        streamOptions: options,
        detectTask: true,
        yieldChunks: (chunk) => chunk  // 直接返回，外层 yield
      })

      // 流式输出第一次回复
      for await (const chunk of firstResult.stream) {
        yield chunk
      }

      let combinedReply = firstResult.reply

      // === 如果有任务，执行任务 ===
      if (firstResult.hasTask && firstResult.taskDescription && hasTools) {
        console.log('🚀 Reply 已流式输出完毕，开始执行任务...\n')

        const taskResult = await this.taskSession.runTask(firstResult.taskDescription, input.text)

        // 将任务执行结果记录到上下文（作为系统消息）
        const taskResultContext = this.formatTaskResultForContext(taskResult)
        this.context.recordItems([{
          role: 'system',
          content: taskResultContext,
          timestamp: Date.now()
        }])

        console.log('\n========== 📝 任务结果已记录到上下文 ==========')
        console.log(taskResultContext)
        console.log('==========================================\n')

        // === 第二次情感层调用（不检测任务，反馈结果） ===
        const secondResult = await this.runEmotionalLayer({
          memoryContext,
          personality,
          tools,
          streamOptions: options,
          detectTask: false,  // 不检测任务
          additionalUserMessage: '请根据刚才的任务执行结果，用简洁亲切的口吻告诉我结果。'
        })

        // 流式输出第二次回复
        for await (const chunk of secondResult.stream) {
          yield chunk
        }

        combinedReply = firstResult.reply + '\n\n' + secondResult.reply
      }

      // 记录最终响应
      const assistantMessage: ResponseItem = {
        role: 'assistant',
        content: combinedReply,
        timestamp: Date.now()
      }
      this.context.recordItems([assistantMessage])

      // 异步更新记忆
      scheduleAsyncTask(async () => {
        await this.memory.store({
          user: input.text,
          assistant: combinedReply,
          timestamp: input.timestamp
        })
      })

    } catch (error) {
      console.error('Streaming failed:', error)
      yield '抱歉，出现了问题...'
    }
  }

  /**
   * 统一的情感层调用
   */
  private async runEmotionalLayer(params: {
    memoryContext: Awaited<ReturnType<MemoryEngine['retrieve']>>
    personality: ReturnType<PersonalityEngine['getPersonality']>
    tools: ReturnType<AgentCore['getTools']>
    streamOptions?: StreamOptions
    detectTask: boolean
    additionalUserMessage?: string
    yieldChunks?: (chunk: string) => string
  }): Promise<{
    stream: AsyncGenerator<string>
    reply: string
    hasTask: boolean
    taskDescription?: string
  }> {
    const { memoryContext, personality, tools, streamOptions, detectTask, additionalUserMessage } = params

    // 构建 Prompt
    const { system, messages } = PromptBuilder.build(
      this.context.forPrompt(),
      {
        tools: detectTask ? tools : [],  // 不检测任务时不传工具
        personality,
        baseInstructions: {
          system: this.buildBaseInstructions()
        },
        userProfile: memoryContext.userProfile,
        summaries: memoryContext.summaries
      }
    )

    const fullMessages = [
      { role: 'system', content: system },
      ...messages
    ]

    // 如果有额外的用户消息（如请求反馈结果）
    if (additionalUserMessage) {
      fullMessages.push({ role: 'user', content: additionalUserMessage })
    }

    console.log(`\n========== 🎭 情感层调用 (detectTask: ${detectTask}) ==========`)

    // 创建流式生成器
    const self = this
    let fullResponse = ''
    let finalReply = ''
    let hasTask = false
    let taskDescription: string | undefined

    async function* streamGenerator(): AsyncGenerator<string> {
      let ttsBuffer = ''
      let emittedReplyLength = 0

      for await (const chunk of self.llm.streamChat(fullMessages, { max_tokens: 2048 })) {
        fullResponse += chunk

        const replyStart = fullResponse.indexOf('<reply>')
        if (replyStart !== -1) {
          const contentStart = replyStart + '<reply>'.length
          const replyEnd = fullResponse.indexOf('</reply>', contentStart)

          const rawVisibleReply = replyEnd === -1
            ? fullResponse.slice(contentStart)
            : fullResponse.slice(contentStart, replyEnd)

          const visibleReply = self.stripTrailingXmlFragment(rawVisibleReply)
          const delta = visibleReply.slice(emittedReplyLength)

          if (delta) {
            emittedReplyLength = visibleReply.length
            yield delta

            // TTS 处理
            if (streamOptions?.onTTSChunk) {
              ttsBuffer += delta
              if (self.shouldFlushTTS(ttsBuffer)) {
                console.log('[SDK] Flushing TTS chunk:', ttsBuffer)
                await streamOptions.onTTSChunk(ttsBuffer)
                ttsBuffer = ''
              }
            }
          }
        }
      }

      // 推送剩余的 TTS
      if (streamOptions?.onTTSChunk && ttsBuffer.trim()) {
        console.log('[SDK] Flushing remaining TTS chunk:', ttsBuffer)
        await streamOptions.onTTSChunk(ttsBuffer)
      }

      // 解析完整响应
      const parsed = self.parseEmotionalResponse(fullResponse, detectTask)
      finalReply = parsed.reply
      hasTask = parsed.hasTask
      taskDescription = parsed.taskDescription

      console.log('解析结果:')
      console.log('  Reply:', parsed.reply.substring(0, 50) + (parsed.reply.length > 50 ? '...' : ''))
      console.log('  Has Task:', parsed.hasTask)
      console.log('  Task Description:', parsed.taskDescription || '(无)')
      console.log('==========================================\n')
    }

    // 执行流并收集结果
    const stream = streamGenerator()

    return {
      stream,
      get reply() { return finalReply },
      get hasTask() { return hasTask },
      get taskDescription() { return taskDescription }
    }
  }

  /**
   * 格式化任务结果为上下文
   */
  private formatTaskResultForContext(taskResult: Awaited<ReturnType<TaskSession['runTask']>>): string {
    const lines = [
      `[任务执行完成]`,
      `状态: ${taskResult.success ? '成功' : '失败'}`,
      `执行轮次: ${taskResult.iterations}`,
      `工具调用次数: ${taskResult.toolCalls}`,
      `结果: ${taskResult.finalMessage}`
    ]

    if (taskResult.error) {
      lines.push(`错误: ${taskResult.error}`)
    }

    return lines.join('\n')
  }

  /**
   * 解析情感层 LLM 响应
   * @param response LLM 响应
   * @param detectTask 是否检测任务（false 时跳过 task 解析）
   */
  private parseEmotionalResponse(response: string, detectTask: boolean = true): ParsedEmotionalResponse {
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

      // 只有在 detectTask = true 时才解析 <task>
      if (detectTask) {
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
      }
    } catch (error) {
      console.warn('Failed to parse emotional response:', error)
    }

    return result
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
    task: import('../session/session.js').SessionTaskSnapshot
  } {
    return {
      turns: this.context.getItems().length,
      tokens: this.context.estimateTokenCount(),
      historyVersion: this.context.getHistoryVersion(),
      task: this.taskSession.getSnapshot()
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

  private shouldFlushTTS(buffer: string): boolean {
    const trimmed = buffer.trim()
    return trimmed.length >= 18 || /[。！？.!?]\s*$/.test(trimmed)
  }

  private stripTrailingXmlFragment(text: string): string {
    return text.replace(/<[^>]*$/, '')
  }

}

export * from '../context/index.js'
export * from '../prompt/index.js'
