/**
 * Dialogue orchestration layer.
 *
 * Coordinates conversational replies, task detection, task-context injection,
 * task runtime execution, plugin hooks, memory writes, and interruption recovery.
 */
import type { UserInput } from '@her-text/types'
import type { LLMProvider } from '@her-text/core'
import { generateId } from '@her-text/core'
import type { MemoryEngine } from '../memory/index.js'
import type { LearningAssetStore } from '../learning/store.js'
import { selectExpressionRoutines } from '../learning/routine-policy.js'
import type { PersonalityEngine } from '../personality/index.js'
import type { AgentCore } from '../agent/index.js'
import type { AgentRunResult, AgentSocietyRuntime } from '../agent-society/index.js'
import { ContextManager, type ResponseItem, type TruncationPolicy } from '../context/index.js'
import { TaskSession } from '../session/session.js'
import type { TaskContextItem, TaskExecutorKind, TaskRuntimeConfig, TaskRuntimeHookMeta, TaskRuntimeHooks } from '../session/task.js'
import type { TaskPlan, TaskStep } from '../session/task-plan.js'
import { PROMPTS } from '../prompts.js'
import {
  LLMContextAggregator,
  LLMProcessor,
  ToolProcessor,
  buildBaseInstructions,
  throwIfAborted,
  type TaskIntent,
  type ToolProcessorResult,
} from './processors.js'
import {
  PluginManager,
  type ExpressionFrame,
  type PluginRuntimeContext,
  type SDKPlugin,
  type TextTransformTarget,
} from '../plugins/index.js'
import { getWorkFeedbackRule, type RuntimeEventBus, type RuntimeJobManager, type RuntimeJobUnregister } from '../runtime/index.js'
import { EmotionalRuntime } from '../runtime/emotional-runtime.js'
import { InteractionRuntime } from '../runtime/interaction-runtime.js'
import type { EmotionalTurnRecord } from '../runtime/boundaries.js'
import type { InteractionIntent, InteractionResolveResult } from '../runtime/interaction.js'
import type { WorkStateStore } from '../runtime/work-store.js'
import type { WorkThread } from '../runtime/work-state.js'


export interface StreamOptions {
  
  signal?: AbortSignal
  
  preserveUserInputOnAbort?: boolean
  
  getInterruptedAssistantText?: () => string | undefined
  
  pluginContext?: PluginRuntimeContext
  
  onTTSChunk?: (text: string) => Promise<void>
  
  onPhaseStart?: (phase: 'reply' | 'task_progress' | 'task_result') => Promise<void> | void
  
  onPhaseEnd?: (
    phase: 'reply' | 'task_progress' | 'task_result',
    fullText: string
  ) => Promise<void> | void
  
  onDisplayChunk?: (
    phase: 'reply' | 'task_progress' | 'task_result',
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
  runtimeEvents?: RuntimeEventBus
  runtimeJobs?: RuntimeJobManager
  workState?: WorkStateStore
  learning?: LearningAssetStore
  agentSociety?: AgentSocietyRuntime
  taskRuntime?: TaskRuntimeConfig
  onTaskUserInputRequest?: TaskRuntimeHooks['onUserInputRequest']
  onTaskRunStateChanged?: TaskRuntimeHooks['onRunStateChanged']
  onTaskPlanUpdated?: TaskRuntimeHooks['onPlanUpdated']
  onTaskStepUpdated?: TaskRuntimeHooks['onStepUpdated']
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

function buildResumeTaskDescription(thread: WorkThread): string {
  const nextAction = thread.nextActions.at(-1)?.title
  const currentStep = thread.currentStep?.title
  const focus = nextAction || currentStep || thread.resumeSummary || thread.goal
  return `Continue the saved work thread "${thread.goal}". Resume from: ${focus}`
}

function buildResumeTaskContext(thread: WorkThread): TaskContextItem {
  return {
    id: `resume-${thread.id}`,
    type: 'work_thread_resume',
    name: `Resume context for ${thread.goal}`,
    content: JSON.stringify({
      threadId: thread.id,
      goal: thread.goal,
      status: thread.status,
      resumeSummary: thread.resumeSummary,
      currentStep: thread.currentStep,
      nextActions: thread.nextActions.slice(-5),
      failures: thread.failures.slice(-3),
      decisions: thread.decisions.slice(-5),
      artifacts: thread.artifacts.slice(-10),
      executionState: thread.executionState,
      interruptionSnapshot: thread.interruptionSnapshot,
    }, null, 2),
  }
}

function buildEmotionalTurnTaskContext(record: EmotionalTurnRecord): TaskContextItem {
  return {
    id: `emotional-turn-${record.createdAt}`,
    type: 'emotional_turn_record',
    name: 'Emotional turn record',
    content: JSON.stringify(record, null, 2),
  }
}

interface ActiveTaskProgressContext {
  turnContext: Awaited<ReturnType<LLMContextAggregator['prepareUserTurn']>>
  streamOptions?: StreamOptions
  pluginRuntime: PluginRuntimeContext
  queue: Promise<void>
  lastEmittedAt: number
  emittedStepIds: Set<string>
}

interface TaskRunJobInput {
  taskIntent: TaskIntent
  originalUserInput: string
  taskContextItems: TaskContextItem[]
}

const TASK_PROGRESS_MIN_INTERVAL_MS = 12000

export class DialogueOrchestrator {
  private context: ContextManager
  private taskSession: TaskSession
  private contextAggregator: LLMContextAggregator
  private llmProcessor: LLMProcessor
  private toolProcessor: ToolProcessor
  private pluginManager: PluginManager
  private runtimeEvents?: RuntimeEventBus
  private runtimeJobs?: RuntimeJobManager
  private unregisterTaskRunJob?: RuntimeJobUnregister
  private workState?: WorkStateStore
  private emotionalRuntime = new EmotionalRuntime()
  private interactionRuntime = new InteractionRuntime()
  private learning?: LearningAssetStore
  private agentSociety?: AgentSocietyRuntime
  private activeTaskProgressContext: ActiveTaskProgressContext | null = null

  private truncationPolicy: TruncationPolicy = {
    maxTokens: 8000,
    maxTurns: 50,
    preserveSystemMessages: true,
    preserveRecentTurns: 10
  }

  constructor(
    llm: LLMProvider,
    private taskLLM: LLMProvider,
    private memory: MemoryEngine,
    private personality: PersonalityEngine,
    private agent: AgentCore,
    storageDir: string,
    config?: DialogueOrchestratorConfig,
    plugins: SDKPlugin[] = []
  ) {
    this.context = new ContextManager()
    this.runtimeEvents = config?.runtimeEvents
    this.runtimeJobs = config?.runtimeJobs
    this.workState = config?.workState
    this.learning = config?.learning
    this.agentSociety = config?.agentSociety
    this.pluginManager = new PluginManager(plugins)
    this.taskSession = new TaskSession(this.taskLLM, memory, personality, agent, this.context, storageDir, {
      runtimeEvents: config?.runtimeEvents,
      workState: config?.workState,
      onUserInputRequest: config?.onTaskUserInputRequest,
      onRunStateChanged: (state, task) => {
        config?.onTaskRunStateChanged?.(state, task)
        void this.pluginManager.notifyTaskRunStateChanged({
          runtime: {},
          taskDescription: task.taskDescription,
          originalUserInput: task.originalUserInput,
          state,
        })
      },
      onPlanUpdated: (plan, task) => {
        config?.onTaskPlanUpdated?.(plan, task)
        void this.pluginManager.notifyTaskPlanUpdated({
          runtime: {},
          taskDescription: task.taskDescription,
          originalUserInput: task.originalUserInput,
          plan,
        })
      },
      onStepUpdated: (step, plan, task) => {
        config?.onTaskStepUpdated?.(step, plan, task)
        void this.pluginManager.notifyTaskStepUpdated({
          runtime: {},
          taskDescription: task.taskDescription,
          originalUserInput: task.originalUserInput,
          plan,
          step,
        })
        this.scheduleTaskProgressFeedback(step, plan, task)
      },
        resolveToolStrategyHints: (context) => this.pluginManager.getToolStrategyHints({
          runtime: {},
          taskDescription: context.taskDescription,
          availableTools: context.availableTools,
        }),
      }, config?.taskRuntime)
    this.contextAggregator = new LLMContextAggregator(memory, personality, agent, this.context, this.truncationPolicy)
    this.llmProcessor = new LLMProcessor(llm)
    this.toolProcessor = new ToolProcessor(this.taskSession)

    this.memory.setLLM(llm)
  }

  async initialize(): Promise<void> {
    await this.pluginManager.setup()
    this.taskLLM = await this.pluginManager.wrapTaskLLM(this.taskLLM, { runtime: {} })
    this.taskSession.setLLM(this.taskLLM)
    const pluginTools = await this.pluginManager.getTools({ runtime: {} })
    for (const tool of pluginTools) {
      this.agent.registerTool(tool)
    }
    this.taskSession.setTools(this.agent.getTools())
    this.taskSession.setRuntimeAdapters(await this.pluginManager.getTaskRuntimes({ runtime: {} }))
    await this.taskSession.initialize()
    this.unregisterTaskRunJob = this.runtimeJobs?.register<TaskRunJobInput, ToolProcessorResult>(
      'task.run',
      async (input, context) => this.executeTaskRunJob(input, context.signal),
      { concurrency: 1 }
    )
  }

  async shutdown(): Promise<void> {
    this.unregisterTaskRunJob?.()
    this.unregisterTaskRunJob = undefined
    await this.taskSession.shutdown()
    await this.pluginManager.shutdown()
  }

  async *processUserInputStream(
    input: UserInput,
    options?: StreamOptions
  ): AsyncGenerator<string> {
    throwIfAborted(options?.signal)
    const turnId = generateId()
    this.runtimeEvents?.emit({
      name: 'interaction.turn.started',
      turnId,
      correlationId: turnId,
      payload: {
        userInput: input.text,
        inputTimestamp: input.timestamp,
      },
    })
    this.runtimeEvents?.emit({
      name: 'interaction.input.received',
      turnId,
      correlationId: turnId,
      payload: {
        userInput: input.text,
        inputTimestamp: input.timestamp,
        source: input.audioData ? 'voice' : 'text',
      },
    })
    const contextCheckpoint = this.context.createCheckpoint()
    const turnContext = await this.contextAggregator.prepareUserTurn(input, options?.signal)
    const pluginRuntime = options?.pluginContext ?? {}
    await this.pluginManager.notifyConversationTurnStart({
      runtime: pluginRuntime,
      userInput: input.text,
      timestamp: input.timestamp,
    })

    try {
      const firstPromptAdditions = await this.getPromptAdditionsWithRoutines({
        pluginRuntime,
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
      this.runtimeEvents?.emit({
        name: 'dialogue.intent.detected',
        turnId,
        correlationId: turnId,
        payload: {
          hasTask: firstResult.hasTask,
          ...(firstResult.taskDescription ? { taskDescription: firstResult.taskDescription } : {}),
          hasTools: turnContext.hasTools,
          ...(firstResult.emotionTag ? { emotionTag: firstResult.emotionTag } : {}),
        },
      })
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
      const emotionalOutput = this.emotionalRuntime.createOutput({
        userInput: input.text,
        conversationContext: this.context.forPrompt(),
        personality: turnContext.personality,
        memory: turnContext.memoryContext,
        workState: this.workState?.getSnapshot() ?? {
          activeThreads: [],
          pausedThreads: [],
          abandonedThreads: [],
          completedThreads: [],
          updatedAt: Date.now(),
        },
      }, {
        replyText: firstResult.reply,
        emotionTag: firstResult.emotionTag,
        intentHints: firstResult.taskDescription ? [firstResult.taskDescription] : [],
      })
      this.runtimeEvents?.emit({
        name: 'emotional.output.emitted',
        turnId,
        correlationId: turnId,
        payload: {
          phase: 'reply',
          output: emotionalOutput,
        },
      })
      const interaction = this.resolveInteractionAfterEmotionalOutput(
        input,
        emotionalOutput.record,
        turnId
      )
      void this.recordEmotionalTurn(emotionalOutput.record)
      this.runtimeEvents?.emit({
        name: 'dialogue.reply.completed',
        turnId,
        correlationId: turnId,
        payload: {
          phase: 'reply',
          text: firstResult.reply,
          ...(firstResult.emotionTag ? { emotionTag: firstResult.emotionTag } : {}),
        },
      })
      throwIfAborted(options?.signal)

      let combinedReply = this.transformText('memory', firstResult.reply, pluginRuntime)

      const workStartIntent = this.selectWorkStartIntent(interaction)
      if (firstResult.hasTask && firstResult.taskDescription && firstResult.taskIntent && turnContext.hasTools && workStartIntent) {
        throwIfAborted(options?.signal)
        await this.applyPreStartWorkIntents(interaction)
        const taskContextItems: TaskContextItem[] = await this.resolveTaskContext(
          input.text,
          workStartIntent.workDescription || firstResult.taskDescription,
          pluginRuntime
        )
        taskContextItems.push(buildEmotionalTurnTaskContext(emotionalOutput.record))
        throwIfAborted(options?.signal)
        await this.pluginManager.notifyTaskStart({
          runtime: pluginRuntime,
          taskDescription: workStartIntent.workDescription || firstResult.taskDescription,
          originalUserInput: input.text,
        })
        await options?.onTaskStart?.(workStartIntent.workDescription || firstResult.taskDescription)
        console.log('🚀 Reply 已流式输出完毕，开始执行任务...\n')

        this.startDetachedTaskRun({
          taskIntent: {
            ...firstResult.taskIntent,
            description: workStartIntent.workDescription || firstResult.taskIntent.description,
          },
          originalUserInput: input.text,
          taskContextItems,
          pluginRuntime,
          streamOptions: options,
        })

        this.context.recordItems([{
          role: 'tool',
          content: 'task_runtime_accepted',
          toolResults: [{
            task: workStartIntent.workDescription || firstResult.taskDescription,
            success: true,
            summary: 'Task accepted and running in the work runtime.',
            iterations: 0,
            toolCalls: 0,
          }],
          timestamp: Date.now()
        }])
      }

      const assistantMessage: ResponseItem = {
        role: 'assistant',
        content: combinedReply,
        timestamp: Date.now()
      }
      await this.pluginManager.notifyConversationTurnEnd({
        runtime: pluginRuntime,
        userInput: input.text,
        timestamp: input.timestamp,
        assistantText: combinedReply,
      })
      this.runtimeEvents?.emit({
        name: 'interaction.turn.completed',
        turnId,
        correlationId: turnId,
        payload: {
          userInput: input.text,
          assistantText: combinedReply,
        },
      })
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
        this.runtimeEvents?.emit({
          name: 'interaction.turn.aborted',
          turnId,
          correlationId: turnId,
          payload: {
            userInput: input.text,
            preservedUserInput: Boolean(options?.preserveUserInputOnAbort),
          },
        })
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

  private scheduleTaskProgressFeedback(
    step: TaskStep,
    plan: TaskPlan,
    task: TaskRuntimeHookMeta
  ): void {
    const context = this.activeTaskProgressContext
    if (!context || step.status !== 'completed' || context.emittedStepIds.has(step.id)) {
      return
    }

    const hasRemainingSteps = plan.steps.some(item =>
      item.id !== step.id && (item.status === 'pending' || item.status === 'running')
    )
    if (!hasRemainingSteps) {
      return
    }

    const now = Date.now()
    if (now - context.lastEmittedAt < TASK_PROGRESS_MIN_INTERVAL_MS) {
      return
    }

    const feedbackRule = getWorkFeedbackRule('progress', 'ambient')
    if (feedbackRule.timing === 'silent' || feedbackRule.timing === 'display_only') {
      return
    }

    context.emittedStepIds.add(step.id)
    context.lastEmittedAt = now
    context.queue = context.queue
      .then(() => this.emitTaskProgressFeedback(step, plan, task, context))
      .catch((error) => {
        console.warn('[Dialogue] Task progress emotional feedback failed:', (error as Error).message)
      })
  }

  private async waitForTaskProgressIdle(signal?: AbortSignal): Promise<void> {
    const context = this.activeTaskProgressContext
    if (!context) {
      return
    }

    await context.queue
    throwIfAborted(signal)
  }

  private resolveInteractionAfterEmotionalOutput(
    input: UserInput,
    emotionalTurn: EmotionalTurnRecord,
    turnId: string
  ): InteractionResolveResult {
    const fallbackWorkState = {
      activeThreads: [],
      pausedThreads: [],
      abandonedThreads: [],
      completedThreads: [],
      updatedAt: Date.now(),
    }
    const result = this.interactionRuntime.resolve({
      userInput: input.text,
      emotionalTurn,
      workState: this.workState?.getSnapshot() ?? fallbackWorkState,
      outputState: { speaking: false, muted: false },
      timestamp: input.timestamp,
    })
    this.runtimeEvents?.emit({
      name: 'interaction.intent.resolved',
      turnId,
      correlationId: turnId,
      payload: {
        userInput: input.text,
        intents: result.intents,
        interruptionKind: result.interruptionKind,
      },
    })
    return result
  }

  private selectWorkStartIntent(interaction: InteractionResolveResult): InteractionIntent | null {
    return interaction.intents.find(intent =>
      intent.kind === 'work.start' ||
      intent.kind === 'work.queue_new' ||
      intent.kind === 'work.start_parallel'
    ) ?? null
  }

  private async applyPreStartWorkIntents(interaction: InteractionResolveResult): Promise<void> {
    if (!this.workState) {
      return
    }
    for (const intent of interaction.intents) {
      if (intent.kind === 'work.pause' && intent.targetThreadId) {
        await this.workState.pauseThread(intent.targetThreadId, intent.reason)
      } else if (intent.kind === 'work.modify' && intent.targetThreadId) {
        await this.workState.recordModification(
          intent.targetThreadId,
          intent.modification || intent.reason,
          intent.reason
        )
      }
    }
  }

  private startDetachedTaskRun(options: {
    taskIntent: TaskIntent
    originalUserInput: string
    taskContextItems: TaskContextItem[]
    pluginRuntime: PluginRuntimeContext
    streamOptions?: StreamOptions
  }): void {
    scheduleAsyncTask(async () => {
      const result = await this.runTaskThroughRuntimeJob(
        options.taskIntent,
        options.originalUserInput,
        options.taskContextItems
      )
      await this.waitForTaskProgressIdle()
      await this.pluginManager.notifyTaskEnd({
        runtime: options.pluginRuntime,
        taskDescription: options.taskIntent.description,
        originalUserInput: options.originalUserInput,
        success: result.success,
        summary: result.summary,
        ...(result.error ? { error: result.error } : {}),
        plan: result.contextResult.plan,
        iterations: result.contextResult.iterations,
        toolCalls: result.contextResult.toolCalls,
      })
      await options.streamOptions?.onTaskEnd?.({
        success: result.success,
        summary: result.summary,
        ...(result.error ? { error: result.error } : {}),
      })

      this.context.recordItems([{
        role: 'tool',
        content: 'task_runtime_result',
        toolResults: [result.contextResult],
        timestamp: Date.now(),
      }])
    })
  }

  private async recordEmotionalTurn(record: EmotionalTurnRecord): Promise<void> {
    if (!this.workState) {
      return
    }
    const snapshot = this.workState.getSnapshot()
    const targetThreadId = snapshot.focusedThreadId ?? snapshot.activeThreads[0]?.id
    if (!targetThreadId) {
      return
    }
    await this.workState.recordEmotionalTurn(targetThreadId, record)
  }

  async resumeWorkThread(threadId?: string, reason = 'User asked to resume prior work.'): Promise<WorkThread | null> {
    if (!this.workState) {
      return null
    }

    const target = this.selectResumableThread(threadId)
    if (!target) {
      return null
    }

    const resumed = await this.workState.resumeThread(target.id, reason)
    if (!resumed) {
      return null
    }

    this.startDetachedTaskRun({
      taskIntent: { description: buildResumeTaskDescription(resumed) },
      originalUserInput: `Resume work: ${resumed.goal}`,
      taskContextItems: [buildResumeTaskContext(resumed)],
      pluginRuntime: {},
    })
    return resumed
  }

  private selectResumableThread(threadId?: string): WorkThread | null {
    if (!this.workState) {
      return null
    }

    if (threadId) {
      return this.workState.getThread(threadId) ?? null
    }

    const snapshot = this.workState.getSnapshot()
    if (snapshot.focusedThreadId) {
      const focused = this.workState.getThread(snapshot.focusedThreadId)
      if (focused && focused.status !== 'completed' && focused.status !== 'abandoned') {
        return focused
      }
    }

    const candidates = [
      ...snapshot.pausedThreads,
      ...snapshot.activeThreads.filter(thread => thread.status === 'recoverable_failed' || thread.status === 'waiting_user'),
    ].sort((a, b) => b.updatedAt - a.updatedAt)

    return candidates[0] ?? null
  }

  private async emitTaskProgressFeedback(
    step: TaskStep,
    plan: TaskPlan,
    task: TaskRuntimeHookMeta,
    context: ActiveTaskProgressContext
  ): Promise<void> {
    throwIfAborted(context.streamOptions?.signal)

    const remainingSteps = plan.steps
      .filter(item => item.id !== step.id && (item.status === 'pending' || item.status === 'running'))
      .map(item => item.title)
      .slice(0, 3)

    const promptAdditions = await this.getPromptAdditionsWithRoutines({
      pluginRuntime: context.pluginRuntime,
      phase: 'task_progress',
      detectTask: false,
      hasTools: context.turnContext.hasTools,
    })

    const result = await this.llmProcessor.runEmotionalLayer({
      turnContext: context.turnContext,
      streamOptions: context.streamOptions,
      phase: 'task_progress',
      detectTask: false,
      additionalUserMessage: PROMPTS.dialogue.taskProgressFeedback({
        taskDescription: task.taskDescription,
        stepTitle: step.title,
        stepResult: step.result,
        remainingSteps,
      }),
      currentContext: this.context.forPrompt(),
      baseInstructions: buildBaseInstructions(),
      pluginPromptAdditions: promptAdditions,
    })

    await context.streamOptions?.onPhaseStart?.('task_progress')
    for await (const _chunk of result.stream) {
      throwIfAborted(context.streamOptions?.signal)
    }
    await context.streamOptions?.onPhaseEnd?.('task_progress', result.reply)
    this.runtimeEvents?.emit({
      name: 'dialogue.reply.completed',
      payload: {
        phase: 'task_progress',
        text: result.reply,
        ...(result.emotionTag ? { emotionTag: result.emotionTag } : {}),
      },
    })
  }

  private async emitExpression(
    options: StreamOptions | undefined,
    runtime: PluginRuntimeContext,
    phase: 'reply' | 'task_progress' | 'task_result',
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

  private async getPromptAdditionsWithRoutines(options: {
    pluginRuntime: PluginRuntimeContext
    phase: 'reply' | 'task_progress' | 'task_result'
    detectTask: boolean
    hasTools: boolean
  }): Promise<string[]> {
    const additions = this.pluginManager.getPromptAdditions({
      runtime: options.pluginRuntime,
      phase: options.phase,
      detectTask: options.detectTask,
      hasTools: options.hasTools,
    })

    if (!this.learning) {
      return additions
    }

    const scope = options.phase === 'task_progress' || options.phase === 'task_result'
      ? 'output'
      : 'dialogue'
    const routineAssets = await this.learning.listActiveRoutines(scope)
    const routineAddition = selectExpressionRoutines(routineAssets, scope).promptAddition
    return routineAddition ? [...additions, routineAddition] : additions
  }

  private async runTaskThroughRuntimeJob(
    taskIntent: TaskIntent,
    originalUserInput: string,
    taskContextItems: TaskContextItem[],
    signal?: AbortSignal
  ): Promise<ToolProcessorResult> {
    if (!this.runtimeJobs) {
      return this.executeTaskRunJob({ taskIntent, originalUserInput, taskContextItems })
    }

    const job = this.runtimeJobs.submit('task.run', {
      taskIntent,
      originalUserInput,
      taskContextItems,
    } satisfies TaskRunJobInput)
    const cancelOnAbort = () => {
      this.runtimeJobs?.cancel(job.id, 'Task job cancelled by dialogue abort')
    }
    signal?.addEventListener('abort', cancelOnAbort, { once: true })
    const completedJob = await this.runtimeJobs.waitForJob<ToolProcessorResult>(job.id)
    signal?.removeEventListener('abort', cancelOnAbort)
    if (completedJob.status === 'completed' && completedJob.result) {
      return completedJob.result
    }

    const error = completedJob.error ?? `Task job ${completedJob.status}.`
    return {
      success: false,
      summary: error,
      error,
      contextResult: {
        task: taskIntent.description,
        success: false,
        summary: error,
        error,
        iterations: 0,
        toolCalls: 0,
      },
    }
  }

  private async executeTaskRunJob(input: TaskRunJobInput, signal?: AbortSignal): Promise<ToolProcessorResult> {
    const { taskIntent, originalUserInput, taskContextItems } = input
    return this.processTaskWithOptionalAgentRoute(taskIntent, originalUserInput, taskContextItems, signal)
  }

  private async processTaskWithOptionalAgentRoute(
    taskIntent: TaskIntent,
    originalUserInput: string,
    taskContextItems: TaskContextItem[],
    signal?: AbortSignal
  ): Promise<ToolProcessorResult> {
    const route = await this.agentSociety?.selectAgentForTask(taskIntent.description)
    if (!route || !this.runtimeJobs) {
      return this.toolProcessor.processTask(taskIntent, originalUserInput, taskContextItems, signal)
    }

    const taskId = generateId()
    this.runtimeEvents?.emit({
      name: 'task.started',
      taskId,
      payload: {
        taskDescription: taskIntent.description,
        originalUserInput,
      },
    })

    const job = this.runtimeJobs.submit('agent.run', {
      agentId: route.agent.id,
      task: taskIntent.description,
      taskId,
      context: {
        originalUserInput,
        taskContextItems,
        routingReason: route.reason,
        routingScore: route.score,
      },
    })
    const cancelAgentOnAbort = () => {
      this.runtimeJobs?.cancel(job.id, 'Agent job cancelled by task abort')
    }
    signal?.addEventListener('abort', cancelAgentOnAbort, { once: true })
    const completedJob = await this.runtimeJobs.waitForJob<AgentRunResult>(job.id)
    signal?.removeEventListener('abort', cancelAgentOnAbort)
    const result = completedJob.status === 'completed' && completedJob.result
      ? completedJob.result
      : {
          agentId: route.agent.id,
          success: false,
          summary: completedJob.error ?? `Agent job ${completedJob.status}.`,
          error: completedJob.error ?? `Agent job ${completedJob.status}.`,
        }

    const finalMessage = result.success
      ? result.summary
      : result.error ?? result.summary
    const executor: TaskExecutorKind = route.agent.mode === 'soft' ? 'soft_agent' : 'hard_agent'

    this.runtimeEvents?.emit({
      name: result.success ? 'task.completed' : 'task.failed',
      taskId,
      payload: {
        taskDescription: taskIntent.description,
        originalUserInput,
        finalMessage,
        executor,
        ...(result.error ? { error: result.error } : {}),
        iterations: 1,
        toolCalls: 0,
      },
    })

    const contextResult = {
      task: taskIntent.description,
      success: result.success,
      summary: finalMessage,
      ...(result.error ? { error: result.error } : {}),
      executor,
      iterations: 1,
      toolCalls: 0,
    }

    return {
      success: result.success,
      summary: finalMessage,
      ...(result.error ? { error: result.error } : {}),
      contextResult,
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
