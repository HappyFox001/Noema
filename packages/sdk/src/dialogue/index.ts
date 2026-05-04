/**
 * Dialogue orchestration layer.
 *
 * Coordinates conversational replies, task detection, task-context injection,
 * task runtime execution, plugin hooks, memory writes, and interruption recovery.
 */
import type { UserInput } from '@her-text/types'
import type { LLMProvider } from '@her-text/core'
import type { MemoryEngine } from '../memory/index.js'
import type { PersonalityEngine } from '../personality/index.js'
import type { AgentCore } from '../agent/index.js'
import { ContextManager, type ResponseItem, type TruncationPolicy } from '../context/index.js'
import { TaskSession } from '../session/session.js'
import type { TaskRuntimeConfig, TaskRuntimeHooks } from '../session/task.js'
import { PROMPTS } from '../prompts.js'
import {
  LLMContextAggregator,
  LLMProcessor,
  ToolProcessor,
  buildBaseInstructions,
  throwIfAborted,
} from './processors.js'
import {
  PluginManager,
  type ExpressionFrame,
  type PluginRuntimeContext,
  type SDKPlugin,
  type TextTransformTarget,
} from '../plugins/index.js'


export interface StreamOptions {
  
  signal?: AbortSignal
  
  preserveUserInputOnAbort?: boolean
  
  getInterruptedAssistantText?: () => string | undefined
  
  pluginContext?: PluginRuntimeContext
  
  onTTSChunk?: (text: string) => Promise<void>
  
  onPhaseStart?: (phase: 'reply' | 'task_result') => Promise<void> | void
  
  onPhaseEnd?: (phase: 'reply' | 'task_result', fullText: string) => Promise<void> | void
  
  onDisplayChunk?: (
    phase: 'reply' | 'task_result',
    delta: string,
    fullText: string
  ) => Promise<void> | void
  
  onTaskStart?: (taskDescription: string) => Promise<void> | void
  
  onTaskEnd?: (result: { success: boolean; summary: string; error?: string }) => Promise<void> | void
  
  onExpression?: (frame: ExpressionFrame) => Promise<void> | void
}


export interface TTSChunkConfig {
  
  minChunkChars?: number

  
  maxChunkChars?: number
}


export interface DialogueOrchestratorConfig {
  
  ttsChunk?: TTSChunkConfig
  taskRuntime?: TaskRuntimeConfig
  onTaskUserInputRequest?: TaskRuntimeHooks['onUserInputRequest']
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
  private pluginManager: PluginManager

  private truncationPolicy: TruncationPolicy = {
    maxTokens: 8000,
    maxTurns: 50,
    preserveSystemMessages: true,
    preserveRecentTurns: 10
  }

  constructor(
    llm: LLMProvider,
    taskLLM: LLMProvider,
    private memory: MemoryEngine,
    private personality: PersonalityEngine,
    private agent: AgentCore,
    storageDir: string,
    config?: DialogueOrchestratorConfig,
    plugins: SDKPlugin[] = []
  ) {
    this.context = new ContextManager()
    this.taskSession = new TaskSession(taskLLM, memory, personality, agent, this.context, storageDir, {
      onUserInputRequest: config?.onTaskUserInputRequest
    }, config?.taskRuntime)
    this.contextAggregator = new LLMContextAggregator(memory, personality, agent, this.context, this.truncationPolicy)
    this.llmProcessor = new LLMProcessor(llm)
    this.toolProcessor = new ToolProcessor(this.taskSession)
    this.pluginManager = new PluginManager(plugins)

    this.memory.setLLM(llm)
  }

  async initialize(): Promise<void> {
    await this.pluginManager.setup()
    const pluginTools = await this.pluginManager.getTools({ runtime: {} })
    for (const tool of pluginTools) {
      this.agent.registerTool(tool)
    }
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
    const pluginRuntime = options?.pluginContext ?? {}

    try {
      const firstPromptAdditions = this.pluginManager.getPromptAdditions({
        runtime: pluginRuntime,
        phase: 'reply',
        detectTask: true,
        hasTools: turnContext.hasTools,
      })

      throwIfAborted(options?.signal)
      const firstResult = await this.llmProcessor.runEmotionalLayer({
        turnContext,
        streamOptions: options,
        phase: 'reply',
        detectTask: true,
        currentContext: this.context.forPrompt(),
        baseInstructions: buildBaseInstructions(),
        pluginPromptAdditions: firstPromptAdditions,
      })

      throwIfAborted(options?.signal)
      await options?.onPhaseStart?.('reply')

      for await (const chunk of firstResult.stream) {
        throwIfAborted(options?.signal)
        yield chunk
      }

      await this.emitExpression(options, pluginRuntime, 'reply', {
        replyText: firstResult.reply,
        emotionTag: firstResult.emotionTag,
      })
      throwIfAborted(options?.signal)
      await options?.onPhaseEnd?.('reply', firstResult.reply)
      throwIfAborted(options?.signal)

      let combinedReply = this.transformText('memory', firstResult.reply, pluginRuntime)

      if (firstResult.hasTask && firstResult.taskDescription && firstResult.taskIntent && turnContext.hasTools) {
        throwIfAborted(options?.signal)
        const taskContextItems = await this.resolveTaskContext(
          input.text,
          firstResult.taskDescription,
          pluginRuntime
        )
        throwIfAborted(options?.signal)
        await options?.onTaskStart?.(firstResult.taskDescription)
        console.log('🚀 Reply 已流式输出完毕，开始执行任务...\n')

        const taskResult = await this.toolProcessor.processTask(
          firstResult.taskIntent,
          input.text,
          taskContextItems
        )
        throwIfAborted(options?.signal)
        await options?.onTaskEnd?.({
          success: taskResult.success,
          summary: taskResult.summary,
          ...(taskResult.error ? { error: taskResult.error } : {})
        })
        throwIfAborted(options?.signal)

        this.context.recordItems([{
          role: 'tool',
          content: 'task_runtime_result',
          toolResults: [taskResult.contextResult],
          timestamp: Date.now()
        }])

        console.log('\n========== 📝 任务结果已记录到上下文 ==========')
        console.log(taskResult.contextResult)
        console.log('==========================================\n')

        const secondPromptAdditions = this.pluginManager.getPromptAdditions({
          runtime: pluginRuntime,
          phase: 'task_result',
          detectTask: false,
          hasTools: turnContext.hasTools,
        })

        const secondResult = await this.llmProcessor.runEmotionalLayer({
          turnContext,
          streamOptions: options,
          phase: 'task_result',
          detectTask: false,
          additionalUserMessage: PROMPTS.dialogue.taskResultFeedback,
          currentContext: this.context.forPrompt(),
          baseInstructions: buildBaseInstructions(),
          pluginPromptAdditions: secondPromptAdditions,
        })

        throwIfAborted(options?.signal)
        await options?.onPhaseStart?.('task_result')

        for await (const chunk of secondResult.stream) {
          throwIfAborted(options?.signal)
          yield chunk
        }

        await this.emitExpression(options, pluginRuntime, 'task_result', {
          replyText: secondResult.reply,
          emotionTag: secondResult.emotionTag,
        })
        throwIfAborted(options?.signal)
        await options?.onPhaseEnd?.('task_result', secondResult.reply)
        throwIfAborted(options?.signal)

        combinedReply = [
          this.transformText('memory', firstResult.reply, pluginRuntime),
          this.transformText('memory', secondResult.reply, pluginRuntime),
        ].filter(Boolean).join('\n\n')
      }

      const assistantMessage: ResponseItem = {
        role: 'assistant',
        content: combinedReply,
        timestamp: Date.now()
      }
      this.context.recordItems([assistantMessage])

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
        if (options?.preserveUserInputOnAbort) {
          this.recordInterruptedTurn(input, options, pluginRuntime)
        }
        return
      }
      console.error('Streaming failed:', error)
      yield '抱歉，出现了问题...'
    }
  }

  transformText(
    target: TextTransformTarget,
    text: string,
    runtime: PluginRuntimeContext = {}
  ): string {
    return this.pluginManager.transformText(text, {
      runtime,
      target,
    })
  }

  private async emitExpression(
    options: StreamOptions | undefined,
    runtime: PluginRuntimeContext,
    phase: 'reply' | 'task_result',
    result: { replyText: string; emotionTag?: string }
  ): Promise<void> {
    const frame = this.pluginManager.selectExpression({
      runtime,
      phase,
      replyText: result.replyText,
      emotionTag: result.emotionTag,
    })

    if (frame) {
      await options?.onExpression?.(frame)
    }
  }

  private async resolveTaskContext(
    userInput: string,
    taskDescription: string,
    runtime: PluginRuntimeContext
  ) {
    console.log('\n========== 🧩 Task Context 层调用 ==========')
    const contextItems = await this.pluginManager.resolveTaskContextInjections({
      runtime,
      userInput,
      taskDescription,
      maxItems: 1,
    })

    if (contextItems.length === 0) {
      console.log('  Selected: (none)')
      console.log('==========================================\n')
      return []
    }

    for (const item of contextItems) {
      console.log(`  Selected: ${item.type}/${item.name}${item.reason ? ` (${item.reason})` : ''}`)
    }
    console.log('==========================================\n')

    return contextItems.map(item => ({
      id: item.id,
      type: item.type,
      name: item.name,
      path: item.path,
      content: item.content,
    }))
  }

  private recordInterruptedTurn(
    input: UserInput,
    options: StreamOptions,
    pluginRuntime: PluginRuntimeContext
  ): void {
    const items: ResponseItem[] = [{
      role: 'user',
      content: input.text,
      timestamp: input.timestamp,
    }]

    const assistantText = this.transformText(
      'interrupted_assistant',
      options.getInterruptedAssistantText?.()?.trim() ?? '',
      pluginRuntime
    )
    if (assistantText) {
      items.push({
        role: 'assistant',
        content: assistantText,
        timestamp: Date.now(),
      })
    }

    this.context.recordItems(items, this.truncationPolicy)

    scheduleAsyncTask(async () => {
      const memoryItems = items.filter(
        (item): item is ResponseItem & { role: 'user' | 'assistant' } =>
          item.role === 'user' || item.role === 'assistant'
      )

      await this.memory.storeMessages(memoryItems.map((item) => ({
        role: item.role,
        content: item.content,
        timestamp: item.timestamp,
      })))
    })
  }


  
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

  
  getContext(): ContextManager {
    return this.context
  }

  
  clearHistory(): void {
    this.context.clear()
  }

  
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
