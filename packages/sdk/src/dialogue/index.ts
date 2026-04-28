import type { UserInput } from '@her-text/types'
import type { LLMProvider } from '@her-text/core'
import type { MemoryEngine } from '../memory/index.js'
import type { PersonalityEngine } from '../personality/index.js'
import type { AgentCore } from '../agent/index.js'
import { ContextManager, type ResponseItem, type TruncationPolicy } from '../context/index.js'
import { TaskSession } from '../session/session.js'
import { PROMPTS } from '../prompts.js'
import {
  LLMContextAggregator,
  LLMProcessor,
  ToolProcessor,
  buildBaseInstructions,
  throwIfAborted,
} from './processors.js'

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
  private contextAggregator: LLMContextAggregator
  private llmProcessor: LLMProcessor
  private toolProcessor: ToolProcessor

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
    _config?: DialogueOrchestratorConfig
  ) {
    this.context = new ContextManager()
    this.taskSession = new TaskSession(llm, memory, personality, agent, this.context, storageDir)
    this.contextAggregator = new LLMContextAggregator(memory, personality, agent, this.context, this.truncationPolicy)
    this.llmProcessor = new LLMProcessor(llm)
    this.toolProcessor = new ToolProcessor(this.taskSession)

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
    throwIfAborted(options?.signal)
    const contextCheckpoint = this.context.createCheckpoint()
    const turnContext = await this.contextAggregator.prepareUserTurn(input, options?.signal)

    try {
      // === 第一次情感层调用（检测任务） ===
      throwIfAborted(options?.signal)
      const firstResult = await this.llmProcessor.runEmotionalLayer({
        turnContext,
        streamOptions: options,
        phase: 'reply',
        detectTask: true,
        currentContext: this.context.forPrompt(),
        baseInstructions: buildBaseInstructions(),
      })

      throwIfAborted(options?.signal)
      await options?.onPhaseStart?.('reply')

      // 流式输出第一次回复
      for await (const chunk of firstResult.stream) {
        throwIfAborted(options?.signal)
        yield chunk
      }

      throwIfAborted(options?.signal)
      await options?.onPhaseEnd?.('reply', firstResult.reply)

      let combinedReply = firstResult.reply

      // === 如果有任务，执行任务 ===
      if (firstResult.hasTask && firstResult.taskDescription && turnContext.hasTools) {
        throwIfAborted(options?.signal)
        await options?.onTaskStart?.(firstResult.taskDescription)
        console.log('🚀 Reply 已流式输出完毕，开始执行任务...\n')

        const taskResult = await this.toolProcessor.processTask(firstResult.taskDescription, input.text)
        throwIfAborted(options?.signal)
        await options?.onTaskEnd?.({
          success: taskResult.success,
          summary: taskResult.summary,
          ...(taskResult.error ? { error: taskResult.error } : {})
        })

        // 将任务执行结果记录到上下文（作为精简的 tool result）
        this.context.recordItems([{
          role: 'tool',
          content: 'task_runtime_result',
          toolResults: [taskResult.contextResult],
          timestamp: Date.now()
        }])

        console.log('\n========== 📝 任务结果已记录到上下文 ==========')
        console.log(taskResult.contextResult)
        console.log('==========================================\n')

        // === 第二次情感层调用（不检测任务，反馈结果） ===
        const secondResult = await this.llmProcessor.runEmotionalLayer({
          turnContext,
          streamOptions: options,
          phase: 'task_result',
          detectTask: false,  // 不检测任务
          additionalUserMessage: PROMPTS.dialogue.taskResultFeedback,
          currentContext: this.context.forPrompt(),
          baseInstructions: buildBaseInstructions(),
        })

        throwIfAborted(options?.signal)
        await options?.onPhaseStart?.('task_result')

        // 流式输出第二次回复
        for await (const chunk of secondResult.stream) {
          throwIfAborted(options?.signal)
          yield chunk
        }

        throwIfAborted(options?.signal)
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
      if (
        options?.signal?.aborted ||
        (error instanceof DOMException && error.name === 'AbortError') ||
        (error instanceof Error && error.name === 'APIUserAbortError')
      ) {
        this.context.restoreCheckpoint(contextCheckpoint)
        return
      }
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
    this.contextAggregator = new LLMContextAggregator(
      this.memory,
      this.personality,
      this.agent,
      this.context,
      this.truncationPolicy
    )
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

}

export * from '../context/index.js'
export * from '../prompt/index.js'
export * from './processors.js'
