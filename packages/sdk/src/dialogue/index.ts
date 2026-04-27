import type { UserInput } from '@her-text/types'
import type { LLMProvider } from '@her-text/core'
import type { MemoryEngine } from '../memory/index.js'
import type { PersonalityEngine } from '../personality/index.js'
import type { AgentCore } from '../agent/index.js'
import { ContextManager, type ResponseItem, type TruncationPolicy } from '../context/index.js'
import { PromptBuilder } from '../prompt/index.js'
import { TaskSession } from '../session/session.js'
import { PROMPTS } from '../prompts.js'

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
  /** 取消当前流式回复，用于语音打断 */
  signal?: AbortSignal
  /** TTS 文本块回调（SDK 自动处理分句） */
  onTTSChunk?: (text: string) => Promise<void>
  /** 回复阶段开始 */
  onPhaseStart?: (phase: 'reply' | 'task_result') => Promise<void> | void
  /** 回复阶段结束，可用于等待播放/显示完成 */
  onPhaseEnd?: (phase: 'reply' | 'task_result', fullText: string) => Promise<void> | void
  /** 文本显示块回调 */
  onDisplayChunk?: (
    phase: 'reply' | 'task_result',
    delta: string,
    fullText: string
  ) => Promise<void> | void
  /** 任务执行开始 */
  onTaskStart?: (taskDescription: string) => Promise<void> | void
  /** 任务执行结束 */
  onTaskEnd?: (result: { success: boolean; summary: string; error?: string }) => Promise<void> | void
}

/**
 * TTS 分块配置
 */
export interface TTSChunkConfig {
  /**
   * 最小 TTS 块字符数
   * 太短的句子不单独发送，等待更多内容
   * @default 8
   */
  minChunkChars?: number

  /**
   * 最大 TTS 块字符数
   * 超过此长度强制分割（在句子边界或标点处）
   * @default 60
   */
  maxChunkChars?: number
}

/**
 * DialogueOrchestrator 配置
 */
export interface DialogueOrchestratorConfig {
  /**
   * TTS 分块配置
   */
  ttsChunk?: TTSChunkConfig
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

  // TTS 分块参数：只按句子边界分割，不按逗号分割
  // minTTSChunkChars: 太短的句子不单独发送，等待更多内容
  // maxTTSChunkChars: 超过此长度强制分割（在句子边界或标点处）
  private readonly minTTSChunkChars: number
  private readonly maxTTSChunkChars: number

  // 句子边界正则：中文、日文、韩文、英文句号/感叹号/问号
  // 包括：。！？.!? 以及日文的 〜（波浪号可表示语气结束）
  private readonly sentenceBoundaryRegex = /[。！？.!?〜]["'"'」』）)\]】〕]*\s*/
  private readonly sentenceEndingChars = /[。！？.!?〜]/g

  // 从句边界（用于强制分割时的降级）
  // 包括：中文逗号、顿号、分号、冒号；日文中点、长音符；韩文也类似
  private readonly clauseBoundaryChars = /[，、,；：;:・ー]/g

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
    private agent: AgentCore,
    storageDir: string,
    config?: DialogueOrchestratorConfig
  ) {
    // TTS 分句参数：10-30 字，保持自然口语节奏
    this.minTTSChunkChars = config?.ttsChunk?.minChunkChars ?? 10
    this.maxTTSChunkChars = config?.ttsChunk?.maxChunkChars ?? 30
    this.context = new ContextManager()
    this.taskSession = new TaskSession(llm, memory, personality, agent, this.context, storageDir)

    this.memory.setLLM(llm)
  }

  async initialize(): Promise<void> {
    await this.taskSession.initialize()
  }

  async shutdown(): Promise<void> {
    await this.taskSession.shutdown()
  }

  async *processUserInputStream(
    input: UserInput,
    options?: StreamOptions
  ): AsyncGenerator<string> {
    const throwIfAborted = () => {
      if (options?.signal?.aborted) {
        throw new DOMException('Interrupted', 'AbortError')
      }
    }

    throwIfAborted()
    const memoryContext = await this.memory.retrieve(input.text)
    throwIfAborted()

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
      throwIfAborted()
      const firstResult = await this.runEmotionalLayer({
        memoryContext,
        personality,
        tools,
        streamOptions: options,
        phase: 'reply',
        detectTask: true,
        yieldChunks: (chunk) => chunk  // 直接返回，外层 yield
      })

      throwIfAborted()
      await options?.onPhaseStart?.('reply')

      // 流式输出第一次回复
      for await (const chunk of firstResult.stream) {
        throwIfAborted()
        yield chunk
      }

      throwIfAborted()
      await options?.onPhaseEnd?.('reply', firstResult.reply)

      let combinedReply = firstResult.reply

      // === 如果有任务，执行任务 ===
      if (firstResult.hasTask && firstResult.taskDescription && hasTools) {
        throwIfAborted()
        await options?.onTaskStart?.(firstResult.taskDescription)
        console.log('🚀 Reply 已流式输出完毕，开始执行任务...\n')

        const taskResult = await this.taskSession.runTask(firstResult.taskDescription, input.text)
        throwIfAborted()
        await options?.onTaskEnd?.({
          success: taskResult.success,
          summary: taskResult.finalMessage,
          ...(taskResult.error ? { error: taskResult.error } : {})
        })

        // 将任务执行结果记录到上下文（作为精简的 tool result）
        const taskResultContext = this.formatTaskResultForContext(firstResult.taskDescription, taskResult)
        this.context.recordItems([{
          role: 'tool',
          content: 'task_runtime_result',
          toolResults: [taskResultContext],
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
          phase: 'task_result',
          detectTask: false,  // 不检测任务
          additionalUserMessage: PROMPTS.dialogue.taskResultFeedback
        })

        throwIfAborted()
        await options?.onPhaseStart?.('task_result')

        // 流式输出第二次回复
        for await (const chunk of secondResult.stream) {
          throwIfAborted()
          yield chunk
        }

        throwIfAborted()
        await options?.onPhaseEnd?.('task_result', secondResult.reply)

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
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }
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
    phase: 'reply' | 'task_result'
    detectTask: boolean
    additionalUserMessage?: string
    yieldChunks?: (chunk: string) => string
  }): Promise<{
    stream: AsyncGenerator<string>
    reply: string
    hasTask: boolean
    taskDescription?: string
  }> {
    const { memoryContext, personality, tools, streamOptions, phase, detectTask, additionalUserMessage } = params

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
      const throwIfAborted = () => {
        if (streamOptions?.signal?.aborted) {
          throw new DOMException('Interrupted', 'AbortError')
        }
      }

      let ttsBuffer = ''
      let emittedReplyLength = 0
      let ttsChunkCount = 0
      const flushedTTSChunks: string[] = []
      const flushTTSChunk = async (text: string, kind: 'normal' | 'remaining') => {
        // 过滤掉 emoji 和异常符号，只保留正常文字和标点
        const sanitizedText = self.sanitizeForTTS(text)
        if (!sanitizedText) {
          return
        }

        ttsChunkCount += 1
        flushedTTSChunks.push(sanitizedText)

        if (kind === 'remaining') {
          console.log(`[SDK] Flushing remaining TTS chunk #${ttsChunkCount}:`, JSON.stringify(sanitizedText))
        } else {
          console.log(`[SDK] Flushing TTS chunk #${ttsChunkCount}:`, JSON.stringify(sanitizedText))
        }

        await streamOptions?.onTTSChunk?.(sanitizedText)
      }

      for await (const chunk of self.llm.streamChat(fullMessages, {
        max_tokens: 2048,
        signal: streamOptions?.signal,
      })) {
        throwIfAborted()
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
            finalReply = visibleReply
            await streamOptions?.onDisplayChunk?.(phase, delta, visibleReply)
            throwIfAborted()
            yield delta

            // TTS 处理
            if (streamOptions?.onTTSChunk) {
              ttsBuffer += delta

              const extractedChunks = self.extractFlushableTTSChunks(ttsBuffer)
              for (const nextChunk of extractedChunks.chunks) {
                throwIfAborted()
                await flushTTSChunk(nextChunk, 'normal')
              }
              ttsBuffer = extractedChunks.remaining
            }
          }
        }
      }

      // 推送剩余的 TTS
      if (streamOptions?.onTTSChunk && ttsBuffer.trim()) {
        throwIfAborted()
        await flushTTSChunk(ttsBuffer, 'remaining')
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
      if (flushedTTSChunks.length > 0) {
        console.log('  TTS Chunks:')
        flushedTTSChunks.forEach((chunkText, index) => {
          console.log(`    [${index + 1}] ${JSON.stringify(chunkText)}`)
        })
      }
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
  private formatTaskResultForContext(
    task: string,
    taskResult: Awaited<ReturnType<TaskSession['runTask']>>
  ): {
    task: string
    success: boolean
    summary: string
    error?: string
  } {
    return {
      task,
      success: taskResult.success,
      summary: taskResult.finalMessage,
      ...(taskResult.error ? { error: taskResult.error } : {})
    }
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
    return PROMPTS.dialogue.basePersonality
  }

  private extractFlushableTTSChunks(buffer: string): {
    chunks: string[]
    remaining: string
  } {
    const chunks: string[] = []
    let working = buffer

    while (true) {
      const boundaryIndex = this.findTTSBoundaryIndex(working)
      if (boundaryIndex === -1) {
        break
      }

      const candidate = working.slice(0, boundaryIndex).trim()
      if (candidate) {
        chunks.push(candidate)
      }
      working = working.slice(boundaryIndex)
    }

    const trimmedRemaining = working.trim()
    if (trimmedRemaining.length >= this.maxTTSChunkChars) {
      const splitIndex = this.findForcedTTSBoundaryIndex(working)
      const candidate = working.slice(0, splitIndex).trim()
      if (candidate) {
        chunks.push(candidate)
      }
      working = working.slice(splitIndex)
    }

    return {
      chunks,
      remaining: working
    }
  }

  /**
   * 查找 TTS 边界索引
   * 只使用句子边界（句号、感叹号、问号），不使用逗号等从句边界
   * 因为逗号会导致语义断开，影响 TTS 的自然度
   *
   * 支持的句子边界符号：
   * - 中文/日文：。！？〜
   * - 英文：.!?
   * - 配对引号/括号：」』）】〕"'
   */
  private findTTSBoundaryIndex(text: string): number {
    const trimmed = text.trimStart()
    const leadingOffset = text.length - trimmed.length
    if (!trimmed) {
      return -1
    }

    // 使用 sentenceBoundaryRegex 查找句子边界
    const sentenceBoundary = trimmed.search(this.sentenceBoundaryRegex)
    if (sentenceBoundary !== -1) {
      const prefix = trimmed.slice(0, sentenceBoundary)
      if (prefix.trim().length < this.minTTSChunkChars) {
        return -1
      }
      const matchRegex = new RegExp('^' + this.sentenceBoundaryRegex.source)
      const matched = trimmed.slice(sentenceBoundary).match(matchRegex)
      if (matched) {
        const boundaryIndex = leadingOffset + sentenceBoundary + matched[0].length
        return this.clampTTSBoundaryIndex(text, boundaryIndex)
      }
    }

    return -1
  }

  private clampTTSBoundaryIndex(text: string, boundaryIndex: number): number {
    const candidate = text.slice(0, boundaryIndex).trim()
    if (candidate.length > this.maxTTSChunkChars) {
      return this.findForcedTTSBoundaryIndex(text)
    }
    return boundaryIndex
  }

  /**
   * 强制分割时查找边界索引
   * 优先使用句子边界，其次使用逗号等从句边界作为降级
   *
   * 支持的标点符号：
   * - 句子边界：。！？.!?〜
   * - 从句边界（降级）：，、,；：;:・ー
   */
  private findForcedTTSBoundaryIndex(text: string): number {
    const trimmed = text.trimStart()
    const leadingOffset = text.length - trimmed.length
    if (!trimmed) {
      return text.length
    }

    const limited = Array.from(trimmed).slice(0, this.maxTTSChunkChars).join('')

    // 优先在句子边界分割（使用预定义的正则）
    const sentenceMatches = [...limited.matchAll(this.sentenceEndingChars)]
    if (sentenceMatches.length > 0) {
      const lastMatch = sentenceMatches[sentenceMatches.length - 1]
      const matchIndex = lastMatch.index ?? limited.length - 1
      return leadingOffset + matchIndex + lastMatch[0].length
    }

    // 降级：在从句边界分割（使用预定义的正则）
    const clauseMatches = [...limited.matchAll(this.clauseBoundaryChars)]
    if (clauseMatches.length > 0) {
      const lastMatch = clauseMatches[clauseMatches.length - 1]
      const matchIndex = lastMatch.index ?? limited.length - 1
      return leadingOffset + matchIndex + lastMatch[0].length
    }

    // 最后降级：直接在最大长度处分割
    return leadingOffset + limited.length
  }

  private stripTrailingXmlFragment(text: string): string {
    return text.replace(/<[^>]*$/, '')
  }

  /**
   * 过滤 TTS 文字，去除 emoji 和异常符号
   * 保留：中文、英文、数字、常用标点
   */
  private sanitizeForTTS(text: string): string {
    // 移除 emoji 和特殊符号
    // 保留：中文字符、英文字母、数字、常用中英文标点、空格
    const sanitized = text
      .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')  // Emoji
      .replace(/[\u{2600}-\u{26FF}]/gu, '')    // 杂项符号
      .replace(/[\u{2700}-\u{27BF}]/gu, '')    // 装饰符号
      .replace(/[\u{FE00}-\u{FE0F}]/gu, '')    // 变体选择符
      .replace(/[\u{1F000}-\u{1F02F}]/gu, '')  // 麻将牌
      .replace(/[\u{1F0A0}-\u{1F0FF}]/gu, '')  // 扑克牌
      .replace(/[\u{200D}]/gu, '')              // 零宽连接符
      .replace(/[\u{20E3}]/gu, '')              // 组合用封闭键帽
      .replace(/[\u{E0020}-\u{E007F}]/gu, '')  // 标签字符
      .replace(/[★☆●○◆◇■□▲△▼▽◎※]/g, '')      // 常见特殊符号
      .replace(/[♪♫♬♩♭♮♯]/g, '')              // 音乐符号
      .replace(/[←→↑↓↔↕↖↗↘↙]/g, '')          // 箭头符号
      .replace(/\s+/g, ' ')                     // 合并多余空格
      .trim()

    return sanitized
  }

}

export * from '../context/index.js'
export * from '../prompt/index.js'
