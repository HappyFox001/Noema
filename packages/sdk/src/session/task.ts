/**
 * Task runtime loop.
 *
 * Builds task prompts, injects task context, runs model/tool iterations,
 * compacts long task history, and returns the final task result.
 */
import type { Tool } from '../tools/types.js'
import type { LLMProvider } from '../llm/index.js'
import type { AgentCore } from '../agent/index.js'
import type { ContextManager } from '../context/index.js'
import type { UserProfile, ConversationSummary } from '../memory/index.js'
import type { PersonalityEngine } from '../personality/index.js'
import { createRuntimeAwareness, formatAwarenessBlock, formatMessageTime } from '../awareness/index.js'
import { TurnRuntime } from './turn.js'
import { PROMPTS } from '../prompts.js'
import { RuntimeEventBus } from '../runtime/events.js'
import { ToolOrchestrator, type ToolExecutionResult } from '../runtime/tool-orchestrator.js'
import type { ToolRouter } from '../runtime/tool-router.js'
import type { TaskPlan, TaskPlanDraft, TaskRunState, TaskStep, TaskStepStatus } from './task-plan.js'
import {
  applyExecutionObservations,
  blockStepExecution,
  completeStepExecution,
  createExecutionState,
  createTaskObservation,
  ensureStepExecutionState,
  failStepExecution,
  recordStepResult,
  recordStepToolCalls,
  type ExecutionState,
  type TaskObservation
} from './execution-state.js'
import { isDeferredTool, renderDeferredToolSummary, searchDeferredTools } from './tool-discovery.js'
import { renderWorkToolStrategy } from './work-tool-strategy.js'

function verboseLog(message = ''): void {
  if (process.env.HER_TEXT_VERBOSE_LOGS === '1') {
    process.stdout.write(`${message}\n`)
  }
}

function normalizeToolExecutionResult(execution: ToolExecutionResult): any {
  const durationMs = execution.completedAt - execution.startedAt
  if (execution.success) {
    return {
      success: true,
      callId: execution.call.id,
      name: execution.call.name,
      result: execution.result,
      attempts: execution.attempts,
      duration_ms: durationMs,
    }
  }

  return {
    success: false,
    callId: execution.call.id,
    name: execution.call.name,
    result: execution.result,
    error: execution.error?.message ?? 'Tool execution failed',
    normalized_error: execution.error,
    attempts: execution.attempts,
    duration_ms: durationMs,
  }
}

export interface TaskRunResult {
  success: boolean
  iterations: number
  toolCalls: number
  finalMessage: string
  executor?: TaskExecutorKind
  plan?: TaskPlan
  executionState?: ExecutionState
  error?: string
}

export type TaskExecutorKind = 'builtin' | 'adapter' | 'soft_agent' | 'hard_agent'

export interface TaskTurnRecord {
  turnIndex: number
  assistantMessage: string
  toolCalls: Array<{
    id: string
    name: string
    arguments: string
  }>
  toolResults: any[]
  observations?: TaskObservation[]
  completed: boolean
  stepId?: string
  stepTitle?: string
  promptMessageCount?: number
}

export interface TaskRuntimeHookMeta {
  taskDescription: string
  originalUserInput: string
}

export interface TaskRuntimeHooks {
  onTurnCompleted?: (turn: TaskTurnRecord) => void
  onStatusChanged?: (status: 'running' | 'completed' | 'errored') => void
  onRunStateChanged?: (state: TaskRunState, task: TaskRuntimeHookMeta) => void
  onPlanUpdated?: (plan: TaskPlan, task: TaskRuntimeHookMeta) => void
  onStepUpdated?: (step: TaskStep, plan: TaskPlan, task: TaskRuntimeHookMeta) => void
  onUserInputRequest?: (request: TaskUserInputRequest) => Promise<TaskUserInputResponse>
  onCompact?: (summary: string) => void
}

export interface TaskRuntimeConfig {
  adapterId?: string
  llmTransport?: 'openai_compatible' | 'codex_local' | 'claude_code_local'
  maxTurns?: number
  modelContextWindow?: number
  autoCompactTokenLimit?: number
  keepRecentTurns?: number
  cwd?: string
  timeoutMs?: number
  command?: string
  model?: string
  extraArgs?: string[]
  env?: Record<string, string>
}

export interface TaskContextItem {
  id: string
  type: string
  name: string
  path?: string
  content: string
}

interface TaskPlanUpdateArgs {
  explanation?: string
  title?: string
  summary?: string
  steps?: Array<{
    id?: string
    title?: string
    description?: string
    status?: TaskStepStatus
    result?: string
    error?: string
    reason?: string
  }>
}

export type TaskUserInputPersistence = 'temporary' | 'persistent'
export type TaskUserInputKind = 'text' | 'password' | 'textarea' | 'code'
export type TaskUserInputSensitivity = 'normal' | 'secret' | 'verification'

export interface TaskUserInputRequest {
  id: string
  key?: string
  groupKey?: string
  groupLabel?: string
  itemKey?: string
  itemLabel?: string
  label: string
  description?: string
  placeholder?: string
  inputKind: TaskUserInputKind
  persistence: TaskUserInputPersistence
  sensitivity: TaskUserInputSensitivity
}

export interface TaskUserInputResponse {
  value: string
  remembered?: boolean
  fromCache?: boolean
  cancelled?: boolean
}

interface TaskUserInputArgs {
  key?: string
  groupKey?: string
  groupLabel?: string
  itemKey?: string
  itemLabel?: string
  label?: string
  description?: string
  placeholder?: string
  inputKind?: TaskUserInputKind
  persistence?: TaskUserInputPersistence
  sensitivity?: TaskUserInputSensitivity
}

export class TaskRuntime {
  private turnRuntime: TurnRuntime
  private maxTurns: number
  private modelContextWindow: number
  private autoCompactTokenLimit: number
  private keepRecentTurns: number
  private awareness = createRuntimeAwareness()
  private compactSummary = ''
  private turnRecords: TaskTurnRecord[] = []
  private taskPlan: TaskPlan | null = null
  private runState: TaskRunState = 'planning'
  private currentStep: TaskStep | null = null
  private executionState: ExecutionState
  private discoveredDeferredToolNames = new Set<string>()
  private deferredToolSummary = ''
  private availableTools: Tool[] = []

  constructor(
    private llm: LLMProvider,
    private agent: AgentCore,
    private personality: PersonalityEngine,
    private context: ContextManager,
    private taskDescription: string,
    private originalUserInput: string,
    private memoryContext: {
      userProfile: UserProfile
      summaries: ConversationSummary[]
    },
    private taskContextItems: TaskContextItem[] = [],
    private hooks: TaskRuntimeHooks = {},
    config: TaskRuntimeConfig = {},
    private signal?: AbortSignal,
    private taskId: string = 'task-runtime',
    runtimeEvents?: RuntimeEventBus,
    toolRouter?: ToolRouter
  ) {
    this.turnRuntime = new TurnRuntime(llm)
    this.maxTurns = clampInteger(config.maxTurns, 24, 4, 100)
    this.modelContextWindow = clampInteger(config.modelContextWindow, 128000, 4096, 1000000)
    this.autoCompactTokenLimit = resolveAutoCompactTokenLimit(config.autoCompactTokenLimit, this.modelContextWindow)
    this.keepRecentTurns = clampInteger(config.keepRecentTurns, 4, 1, this.maxTurns)
    this.executionState = createExecutionState(this.taskDescription)
    this.toolOrchestrator = new ToolOrchestrator({
      events: runtimeEvents ?? new RuntimeEventBus(50),
      tools: this.agent.getTools(),
      router: toolRouter,
      defaultTimeoutMs: 30000,
    })
  }

  private toolOrchestrator: ToolOrchestrator

  async run(): Promise<TaskRunResult> {
    const tools = this.agent.getTools()
    this.availableTools = tools
    this.toolOrchestrator?.setTools(tools)
    this.deferredToolSummary = renderDeferredToolSummary(tools)
    let messages: any[] = []

    let iterations = 0
    let toolCallsCount = 0
    let finalMessage = ''

    verboseLog('\n╔══════════════════════════════════════════════════════════════╗')
    verboseLog('║               🚀 TaskRuntime 开始执行                          ║')
    verboseLog('╠══════════════════════════════════════════════════════════════╣')
    verboseLog(`║ 任务描述: ${this.taskDescription.substring(0, 50)}`)
    verboseLog(`║ 可见工具: ${tools.filter(tool => !isDeferredTool(tool)).map(tool => tool.name).join(', ')}`)
    if (this.deferredToolSummary) {
      verboseLog(`║ 延迟工具: 可通过 tool_search 发现`)
    }
    verboseLog(`║ 最大轮次: ${this.maxTurns}`)
    verboseLog(`║ 自动压缩阈值: ${this.autoCompactTokenLimit}/${this.modelContextWindow} tokens`)
    verboseLog('╚══════════════════════════════════════════════════════════════╝\n')

    try {
      this.hooks.onStatusChanged?.('running')
      this.throwIfAborted()
      this.setRunState('planning')
      this.taskPlan = await this.createInitialPlan(tools)
      this.throwIfAborted()
      this.emitPlanUpdated()
      this.setRunState('plan_ready')
      messages = this.buildInitialMessages()

      while (iterations < this.maxTurns) {
        this.throwIfAborted()
        const step = this.nextRunnableStep()
        if (!step) {
          finalMessage = this.buildPlanCompletionMessage(finalMessage)
          this.setRunState('completed')
          this.hooks.onStatusChanged?.('completed')
          this.emitPlanUpdated()
          return {
            success: true,
            iterations,
            toolCalls: toolCallsCount,
            finalMessage,
            plan: this.taskPlan,
            executionState: this.snapshotExecutionState()
          }
        }

        this.startStep(step)
        iterations++
        verboseLog(`\n┌─────────────────────────────────────────────────────────────┐`)
        verboseLog(`│ 📍 TaskRuntime 迭代 ${iterations}/${this.maxTurns} · ${step.title.substring(0, 24)}                    │`)
        verboseLog(`└─────────────────────────────────────────────────────────────┘`)

        messages.push({
          role: 'user',
          content: this.renderCurrentStepInstruction(step)
        })

        await this.maybeRunPreTurnCompact(messages)
        this.throwIfAborted()

        this.setRunState('step_running')
        const turn = await this.turnRuntime.run(iterations, messages, this.buildToolSpecs(tools), {
          signal: this.signal,
          internalTools: {
            update_task_plan: (args) => this.updateTaskPlan(args),
            request_user_input: (args) => this.requestUserInput(args),
            tool_search: (args) => this.searchTools(args, tools)
          },
          onToolCalling: (toolCalls) => {
            recordStepToolCalls(this.executionState, step, toolCalls.map(call => call.function.name))
            this.setRunState('tool_calling')
            this.emitStepUpdated(step)
          },
          onObserving: () => {
            this.setRunState('observing')
            this.emitStepUpdated(step)
          },
          executeExternalTool: (call) => this.executeExternalTool(call)
        })
        this.throwIfAborted()
        toolCallsCount += turn.toolCalls.length
        const observations = this.observeTurn(turn)
        this.recordTurn(turn, observations)

        if (step.status === 'completed') {
          finalMessage = this.getStepRuntime(step.id)?.result || turn.assistantMessage.trim() || finalMessage

          if (this.hasRunnableSteps()) {
            verboseLog(`[TaskRuntime] 当前步骤已由计划更新标记完成，继续下一步...`)
            this.appendTurnMessages(messages, turn)
            await this.maybeRunMidTurnCompact(messages, turn, true)
            this.throwIfAborted()
            continue
          }

          finalMessage = this.buildPlanCompletionMessage(finalMessage)
          this.setRunState('completed')
          this.hooks.onStatusChanged?.('completed')
          this.emitPlanUpdated()

          verboseLog('\n╔══════════════════════════════════════════════════════════════╗')
          verboseLog('║               ✅ TaskRuntime 执行完成                          ║')
          verboseLog('╠══════════════════════════════════════════════════════════════╣')
          verboseLog(`║ 总迭代次数: ${iterations}`)
          verboseLog(`║ 总工具调用: ${toolCallsCount}`)
          verboseLog(`║ 最终消息: ${finalMessage.substring(0, 50)}...`)
          verboseLog('╚══════════════════════════════════════════════════════════════╝\n')

          return {
            success: true,
            iterations,
            toolCalls: toolCallsCount,
            finalMessage,
            plan: this.taskPlan,
            executionState: this.snapshotExecutionState()
          }
        }

        if (turn.completed) {
          this.completeStep(step, turn.assistantMessage.trim() || '步骤已完成。')
          finalMessage = turn.assistantMessage.trim() || finalMessage

          if (this.hasRunnableSteps()) {
            verboseLog(`[TaskRuntime] 当前步骤完成，继续下一步...`)
            messages.push({
              role: 'assistant',
              content: turn.assistantMessage || `步骤完成：${step.title}`
            })
            await this.maybeRunMidTurnCompact(messages, turn, true)
            this.throwIfAborted()
            continue
          }

          finalMessage = this.buildPlanCompletionMessage(finalMessage)
          this.setRunState('completed')
          this.hooks.onStatusChanged?.('completed')

          verboseLog('\n╔══════════════════════════════════════════════════════════════╗')
          verboseLog('║               ✅ TaskRuntime 执行完成                          ║')
          verboseLog('╠══════════════════════════════════════════════════════════════╣')
          verboseLog(`║ 总迭代次数: ${iterations}`)
          verboseLog(`║ 总工具调用: ${toolCallsCount}`)
          verboseLog(`║ 最终消息: ${finalMessage.substring(0, 50)}...`)
          verboseLog('╚══════════════════════════════════════════════════════════════╝\n')

          return {
            success: true,
            iterations,
            toolCalls: toolCallsCount,
            finalMessage,
            plan: this.taskPlan,
            executionState: this.snapshotExecutionState()
          }
        }

        verboseLog(`[TaskRuntime] 迭代 ${iterations} 未完成，继续执行...`)

        this.appendTurnMessages(messages, turn)

        await this.maybeRunMidTurnCompact(messages, turn, true)
        this.throwIfAborted()
      }

      verboseLog('\n╔══════════════════════════════════════════════════════════════╗')
      verboseLog('║               ⚠️ TaskRuntime 达到最大轮次                       ║')
      verboseLog('╚══════════════════════════════════════════════════════════════╝\n')

      this.failCurrentStep(`Reached max turns (${this.maxTurns})`)
      this.setRunState('failed')
      this.hooks.onStatusChanged?.('errored')
      return {
        success: false,
        iterations,
        toolCalls: toolCallsCount,
        finalMessage: '任务执行超过最大轮次，已停止。',
        plan: this.taskPlan ?? undefined,
        executionState: this.snapshotExecutionState(),
        error: `Reached max turns (${this.maxTurns})`
      }
    } catch (error) {
      if (isAbortError(error) || this.signal?.aborted) {
        verboseLog('\n╔══════════════════════════════════════════════════════════════╗')
        verboseLog('║               ⏹️ TaskRuntime 已取消                          ║')
        verboseLog('╚══════════════════════════════════════════════════════════════╝\n')

        this.failCurrentStep('Task was interrupted by a newer turn')
        this.setRunState('cancelled')
        this.hooks.onStatusChanged?.('errored')
        return {
          success: false,
          iterations,
          toolCalls: toolCallsCount,
          finalMessage: '任务已被新的输入打断。',
          plan: this.taskPlan ?? undefined,
          executionState: this.snapshotExecutionState(),
          error: 'Task aborted'
        }
      }

      verboseLog('\n╔══════════════════════════════════════════════════════════════╗')
      verboseLog('║               ❌ TaskRuntime 执行出错                          ║')
      verboseLog(`║ Error: ${(error as Error).message}`)
      verboseLog('╚══════════════════════════════════════════════════════════════╝\n')

      this.failCurrentStep((error as Error).message)
      this.setRunState('failed')
      this.hooks.onStatusChanged?.('errored')
      return {
        success: false,
        iterations,
        toolCalls: toolCallsCount,
        finalMessage: '任务执行失败。',
        plan: this.taskPlan ?? undefined,
        executionState: this.snapshotExecutionState(),
        error: (error as Error).message
      }
    }
  }

  private recordTurn(turn: import('./turn.js').TurnRunResult, observations: TaskObservation[] = []): void {
    const record: TaskTurnRecord = {
      turnIndex: turn.turnIndex,
      assistantMessage: turn.assistantMessage,
      toolCalls: turn.toolCalls.map(call => ({
        id: call.id,
        name: call.function.name,
        arguments: call.function.arguments
      })),
      toolResults: turn.toolResults,
      observations,
      completed: turn.completed,
      stepId: this.currentStep?.id,
      stepTitle: this.currentStep?.title,
      promptMessageCount: countPromptMessagesForTurn(turn)
    }

    this.turnRecords.push(record)
    this.hooks.onTurnCompleted?.(record)
  }

  private observeTurn(turn: import('./turn.js').TurnRunResult): TaskObservation[] {
    const observations = turn.toolCalls.map((call, index) =>
      this.createObservation(turn.turnIndex, index, call.function.name, turn.toolResults[index])
    )
    if (observations.length > 0) {
      this.applyObservations(observations)
    }
    return observations
  }

  private async executeExternalTool(call: import('../tools/types.js').ToolCall): Promise<any> {
    const execution = await this.toolOrchestrator.executeCall(
      {
        id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
      },
      {
        threadId: this.taskId,
        taskId: this.taskId,
        taskDescription: this.taskDescription,
        stepId: this.currentStep?.id,
        signal: this.signal,
      }
    )

    return normalizeToolExecutionResult(execution)
  }

  private createObservation(turnIndex: number, callIndex: number, toolName: string, toolResult: any): TaskObservation {
    return createTaskObservation({
      turnIndex,
      callIndex,
      toolName,
      toolResult,
      stepId: this.currentStep?.id,
      stepTitle: this.currentStep?.title
    })
  }

  private applyObservations(observations: TaskObservation[]): void {
    applyExecutionObservations(this.executionState, observations)
  }

  private snapshotExecutionState(): ExecutionState {
    return JSON.parse(JSON.stringify(this.executionState)) as ExecutionState
  }

  private appendTurnMessages(messages: any[], turn: import('./turn.js').TurnRunResult): void {
    messages.push({
      role: 'assistant',
      content: turn.assistantMessage || '',
      ...(turn.toolCalls.length > 0 ? { tool_calls: turn.toolCalls } : {})
    })

    const imageMessages: any[] = []
    turn.toolCalls.forEach((call, index) => {
      const toolResult = turn.toolResults[index]
      const imageInputs = extractToolResultImages(toolResult, call.function.name)
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(sanitizeToolResultForPrompt(toolResult))
      })

      for (const image of imageInputs) {
        imageMessages.push({
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                `工具 ${call.function.name} 返回了一张图片观察结果。`,
                image.note ? `说明：${image.note}` : '',
                image.path ? `本地路径：${image.path}` : '',
                image.width && image.height ? `尺寸：${image.width}x${image.height}` : ''
              ].filter(Boolean).join('\n')
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${image.mimeType};base64,${image.base64}`
              }
            }
          ]
        })
      }
    })

    messages.push(...imageMessages)
  }

  private async maybeRunPreTurnCompact(messages: any[]): Promise<void> {
    this.throwIfAborted()
    const estimatedTokens = estimateMessagesTokenCount(messages)
    if (estimatedTokens < this.autoCompactTokenLimit) {
      return
    }

    await this.runAutoCompact(messages, 'pre_turn', 'context_limit', estimatedTokens)
  }

  private async maybeRunMidTurnCompact(
    messages: any[],
    turn: import('./turn.js').TurnRunResult,
    needsFollowUp: boolean
  ): Promise<void> {
    this.throwIfAborted()
    if (!needsFollowUp) {
      return
    }

    const turnTokens = finiteNumber(turn.tokenUsage?.totalTokens)
    const estimatedTokens = Math.max(turnTokens ?? 0, estimateMessagesTokenCount(messages))
    if (estimatedTokens < this.autoCompactTokenLimit) {
      return
    }

    await this.runAutoCompact(messages, 'mid_turn', 'context_limit', estimatedTokens)
  }

  private async runAutoCompact(
    messages: any[],
    phase: 'pre_turn' | 'mid_turn',
    reason: 'context_limit',
    tokenCount: number
  ): Promise<void> {
    const compactBoundary = this.turnRecords.length > this.keepRecentTurns
      ? this.turnRecords.length - this.keepRecentTurns
      : this.turnRecords.length - 1
    if (compactBoundary <= 0) {
      return
    }

    const recordsToCompact = this.turnRecords.slice(0, compactBoundary)
    const recordsToKeep = this.turnRecords.slice(compactBoundary)
    if (recordsToCompact.length === 0) {
      return
    }

    verboseLog('\n┌─────────────────────────────────────────────────────────────┐')
    verboseLog(`│ 📦 Auto Compact: ${phase} · ${reason} · ${Math.round(tokenCount)}/${this.autoCompactTokenLimit} tokens`)
    verboseLog(`│ 压缩 ${recordsToCompact.length} 轮历史，保留最近 ${recordsToKeep.length} 轮`)
    verboseLog('└─────────────────────────────────────────────────────────────┘')

    try {
      const compactInput = this.renderCompactInput(recordsToCompact, phase, reason, tokenCount)
      const deterministicSummary = this.buildDeterministicCompactSummary(recordsToCompact)

      const summaryResponse = await this.llm.chat([
        {
          role: 'system',
          content: PROMPTS.task.compactSystem
        },
        { role: 'user', content: compactInput }
      ], {
        max_tokens: 512,
        signal: this.signal
      })

      this.compactSummary = appendCompactSummary(this.compactSummary, summaryResponse.content.trim() || deterministicSummary)
      this.hooks.onCompact?.(this.compactSummary)

      this.rebuildMessagesAfterCompact(messages, recordsToKeep)
      this.turnRecords = recordsToKeep
    } catch (error) {
      console.warn(`[TaskRuntime] Compact model failed, using deterministic compact summary: ${(error as Error).message}`)
      this.compactSummary = appendCompactSummary(this.compactSummary, this.buildDeterministicCompactSummary(recordsToCompact))
      this.hooks.onCompact?.(this.compactSummary)
      this.rebuildMessagesAfterCompact(messages, recordsToKeep)
      this.turnRecords = recordsToKeep
    }
  }

  private rebuildMessagesAfterCompact(messages: any[], recordsToKeep: TaskTurnRecord[]): void {
    const recentMessageCount = countPromptMessagesForRecords(recordsToKeep)
    const recentMessages = messages.slice(-recentMessageCount)
    messages.splice(
      0,
      messages.length,
      ...this.buildCompactedMessages(recentMessages)
    )
  }

  private buildCompactedMessages(recentMessages: any[]): any[] {
    return [
      {
        role: 'system',
        content: this.buildTaskSystemPrompt()
      },
      ...this.buildTaskContextMessages(),
      this.taskPlan ? {
        role: 'user',
        content: this.renderPlanContext(this.taskPlan)
      } : null,
      {
        role: 'user',
        content: [
          `${PROMPTS.context.userRequestTitle}${this.originalUserInput}`,
          `${PROMPTS.context.currentTaskTitle}${this.taskDescription}`,
          this.formatMemoryContext(),
          `${PROMPTS.context.compactSummaryTitle}\n${this.compactSummary}`,
          this.renderExecutionStateContext(),
          PROMPTS.task.continueAfterCompact
        ].filter(Boolean).join('\n\n')
      },
      ...recentMessages
    ].filter(Boolean)
  }

  private renderCompactInput(
    records: TaskTurnRecord[],
    phase: 'pre_turn' | 'mid_turn',
    reason: 'context_limit',
    tokenCount: number
  ): string {
    return [
      `Compaction phase: ${phase}`,
      `Compaction reason: ${reason}`,
      `Token usage estimate: ${Math.round(tokenCount)}/${this.autoCompactTokenLimit} tokens`,
      this.compactSummary ? `Previous compact summary:\n${this.compactSummary}` : '',
      this.taskPlan ? this.renderPlanContext(this.taskPlan) : '',
      this.renderExecutionStateContext(),
      'Turns to compact:',
      records.map(record => this.renderCompactTurnRecord(record)).join('\n\n')
    ].filter(Boolean).join('\n\n')
  }

  private renderCompactTurnRecord(record: TaskTurnRecord): string {
    const tools = record.toolCalls.length > 0
      ? record.toolCalls.map(call => `${call.name}(${call.arguments})`).join(', ')
      : 'none'
    const observations = record.observations && record.observations.length > 0
      ? record.observations.map(item => `- [${item.status}] ${item.toolName}: ${item.summary}`).join('\n')
      : 'none'

    return [
      `Turn ${record.turnIndex}`,
      record.stepTitle ? `Step: ${record.stepTitle}` : '',
      `Assistant: ${record.assistantMessage || '(empty)'}`,
      `Tools: ${tools}`,
      `Observations:\n${observations}`,
      `Completed: ${record.completed ? 'yes' : 'no'}`
    ].filter(Boolean).join('\n')
  }

  private buildDeterministicCompactSummary(records: TaskTurnRecord[]): string {
    const lines = [
      `Task: ${this.taskDescription}`,
      this.taskPlan ? `Plan: ${this.taskPlan.steps.map(step => {
        const runtime = this.getStepRuntime(step.id)
        return `${step.id} ${step.title} (${step.status})${runtime?.result ? `: ${runtime.result}` : ''}`
      }).join('; ')}` : '',
      this.compactSummary ? `Previous summary: ${this.compactSummary}` : '',
      'Compacted observations:',
      ...records.flatMap(record => {
        if (!record.observations || record.observations.length === 0) {
          return [`- Turn ${record.turnIndex}: no tool observation`]
        }
        return record.observations.map(item => `- Turn ${record.turnIndex} [${item.status}] ${item.toolName}: ${item.summary}`)
      })
    ].filter(Boolean)

    return lines.join('\n')
  }

  private buildTaskContextMessages(): any[] {
    return this.taskContextItems.map(item => ({
      role: 'user',
      content: this.renderTaskContextItem(item)
    }))
  }

  private renderTaskContextItem(item: TaskContextItem): string {
    if (item.type === 'skill') {
      return [
        '<skill>',
        `<name>${escapeXmlText(item.name)}</name>`,
        item.path ? `<path>${escapeXmlText(item.path)}</path>` : '',
        item.content,
        '</skill>'
      ].filter(Boolean).join('\n')
    }

    return [
      '<task_context>',
      `<type>${escapeXmlText(item.type)}</type>`,
      `<name>${escapeXmlText(item.name)}</name>`,
      item.path ? `<path>${escapeXmlText(item.path)}</path>` : '',
      item.content,
      '</task_context>'
    ].filter(Boolean).join('\n')
  }

  private buildInitialMessages(): any[] {
    const history = this.context.forPrompt()
    const historyText = history
      .slice(-12)
      .map(item => {
        const time = formatMessageTime(item.timestamp, this.awareness)
        return `${time ? `[${time}] ` : ''}${item.role}: ${item.content}`
      })
      .join('\n')

    return [
        {
          role: 'system',
          content: this.buildTaskSystemPrompt()
        },
        ...this.buildTaskContextMessages(),
        this.taskPlan ? {
          role: 'user',
          content: this.renderPlanContext(this.taskPlan)
        } : null,
        {
          role: 'user',
        content: [
          `${PROMPTS.context.userRequestTitle}${this.originalUserInput}`,
          `${PROMPTS.context.currentTaskTitle}${this.taskDescription}`,
          historyText ? `${PROMPTS.context.recentConversationTitle}\n${historyText}` : '',
          this.formatMemoryContext(),
          this.renderExecutionStateContext(),
          PROMPTS.task.initialInstruction
        ].join('\n\n')
      }
    ].filter(Boolean)
  }

  private buildToolSpecs(tools: Tool[]): any[] {
    const visibleTools = tools.filter(tool => !isDeferredTool(tool) || this.discoveredDeferredToolNames.has(tool.name))
    const hasDeferredTools = tools.some(isDeferredTool)
    return [
      this.buildTaskPlanUpdateToolSpec(),
      this.buildUserInputRequestToolSpec(),
      hasDeferredTools ? this.buildToolSearchSpec() : null,
      ...visibleTools.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        }
      }))
    ].filter(Boolean)
  }

  private buildTaskSystemPrompt(): string {
    const personality = this.personality.getPersonality()
    return [
      PROMPTS.task.systemPrompt(
        personality.character.name,
        personality.relationship.type
      ),
      renderWorkToolStrategy({
        tools: this.availableTools,
        deferredToolSummary: this.deferredToolSummary,
      }),
      this.formatRuntimeAwareness()
    ].join('\n\n')
  }

  private formatRuntimeAwareness(): string {
    return [
      '<runtime_context>',
      formatAwarenessBlock(this.awareness),
      '</runtime_context>'
    ].join('\n')
  }

  private buildTaskPlanUpdateToolSpec(): any {
    return {
      type: 'function',
      function: {
        name: 'update_task_plan',
        description: 'Update the task execution plan after completing a step, learning new facts, or needing to replan.',
        parameters: {
          type: 'object',
          properties: {
            explanation: {
              type: 'string',
              description: 'Brief reason for the plan update.'
            },
            title: {
              type: 'string',
              description: 'Optional revised plan title.'
            },
            summary: {
              type: 'string',
              description: 'Optional revised plan summary.'
            },
            steps: {
              type: 'array',
              description: 'Steps to update or append. Existing steps are matched by id.',
              items: {
                type: 'object',
                properties: {
                  id: {
                    type: 'string',
                    description: 'Existing step id, such as step-1. Omit to append a new step.'
                  },
                  title: {
                    type: 'string',
                    description: 'Step title.'
                  },
                  description: {
                    type: 'string',
                    description: 'Step goal or revised goal.'
                  },
                  status: {
                    type: 'string',
                    enum: ['pending', 'running', 'completed', 'failed', 'skipped'],
                    description: 'Step status.'
                  },
                  result: {
                    type: 'string',
                    description: 'Completion evidence or observed result.'
                  },
                  error: {
                    type: 'string',
                    description: 'Failure reason if the step failed.'
                  },
                  reason: {
                    type: 'string',
                    description: 'Reason for appending a new step or changing the plan.'
                  }
                },
                additionalProperties: false
              }
            }
          },
          required: ['steps'],
          additionalProperties: false
        }
      }
    }
  }

  private buildUserInputRequestToolSpec(): any {
    return {
      type: 'function',
      function: {
        name: 'request_user_input',
        description: 'Ask the user for required information during a task, such as login details, API keys, verification codes, OAuth confirmation, or file paths.',
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Optional derived storage key for display. Persistent values must provide groupKey and itemKey.'
            },
            groupKey: {
              type: 'string',
              description: 'Stable category key for related reusable information, such as google, github, openai, or aws.'
            },
            groupLabel: {
              type: 'string',
              description: 'Human-readable category label, such as Google Account or GitHub.'
            },
            itemKey: {
              type: 'string',
              description: 'Stable item key inside the category, such as email, password, api_key, token, or client_secret.'
            },
            itemLabel: {
              type: 'string',
              description: 'Human-readable item label inside the category, such as Email, Password, or API Key.'
            },
            label: {
              type: 'string',
              description: 'Short input label shown to the user.'
            },
            description: {
              type: 'string',
              description: 'Why this information is needed.'
            },
            placeholder: {
              type: 'string',
              description: 'Input placeholder.'
            },
            inputKind: {
              type: 'string',
              enum: ['text', 'password', 'textarea', 'code'],
              description: 'Input control type.'
            },
            persistence: {
              type: 'string',
              enum: ['temporary', 'persistent'],
              description: 'Use persistent for long-lived values like API keys or reusable account metadata. Use temporary for verification codes and MFA.'
            },
            sensitivity: {
              type: 'string',
              enum: ['normal', 'secret', 'verification'],
              description: 'Secret values may be saved only if the user chooses to remember them. Verification values are never saved.'
            }
          },
          required: ['label', 'persistence', 'sensitivity'],
          additionalProperties: false
        }
      }
    }
  }

  private buildToolSearchSpec(): any {
    return {
      type: 'function',
      function: {
        name: 'tool_search',
        description: [
          '# Tool discovery',
          '',
          'Searches over deferred tool metadata with BM25 and exposes matching tools for the next model turn.',
          '',
          'You have access to tools from the following sources:',
          this.deferredToolSummary || 'None currently enabled.',
          'Use this when the current visible tools do not include the browser, desktop, MCP, skill, or plugin action needed for the task.',
          'Do not use this for ordinary file search; use grep/glob/read when those tools are visible.'
        ].join('\n'),
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query describing the missing capability or action.'
            },
            limit: {
              type: 'number',
              description: 'Maximum number of tools to return. Defaults to 8.'
            }
          },
          required: ['query'],
          additionalProperties: false
        }
      }
    }
  }

  private searchTools(args: { query?: string; limit?: number }, tools: Tool[]): any {
    const query = cleanPlanText(args.query || '')
    if (!query) {
      throw new Error('query must not be empty')
    }
    const requestedLimit = typeof args.limit === 'number' ? args.limit : undefined
    const limit = clampInteger(requestedLimit, 8, 1, 20)
    const matches = searchDeferredTools(tools, query, limit, requestedLimit === undefined)
    for (const match of matches) {
      this.discoveredDeferredToolNames.add(match.name)
    }

    return {
      success: true,
      query,
      tools: matches.map(match => ({
        name: match.name,
        pluginId: match.pluginId,
        description: match.description,
        safety: match.safety,
      })),
      note: matches.length > 0
        ? 'These tools are available in the next model turn.'
        : 'No deferred tools matched. Continue with visible tools or ask the user for more context.'
    }
  }

  private async createInitialPlan(tools: Tool[]): Promise<TaskPlan> {
    try {
      this.throwIfAborted()
      const response = await this.llm.chat([
        {
          role: 'system',
          content: [
            PROMPTS.task.planningSystem,
            renderWorkToolStrategy({
              tools,
              deferredToolSummary: this.deferredToolSummary,
            }),
            this.formatRuntimeAwareness()
          ].join('\n\n')
        },
        {
          role: 'user',
          content: [
            `${PROMPTS.context.userRequestTitle}${this.originalUserInput}`,
            `${PROMPTS.context.currentTaskTitle}${this.taskDescription}`,
            `可见工具：${tools.filter(tool => !isDeferredTool(tool)).map(tool => tool.name).join(', ') || '无'}`,
            this.deferredToolSummary ? `可搜索的延迟工具：\n${this.deferredToolSummary}` : '',
            this.formatMemoryContext()
          ].filter(Boolean).join('\n\n')
        }
      ], {
        response_format: { type: 'json_object' },
        signal: this.signal
      })

      this.throwIfAborted()
      const draft = parsePlanDraft(response.content, (error) => {
        this.logPlanParseFailure(response.content, error, response.finishReason)
      })
      return this.normalizePlan(draft)
    } catch (error) {
      console.warn(`[TaskRuntime] Plan generation failed, using fallback plan: ${(error as Error).message}`)
      return this.normalizePlan(this.createFallbackPlanDraft(tools))
    }
  }

  private createFallbackPlanDraft(tools: Tool[]): TaskPlanDraft {
    const toolNames = new Set(tools.map(tool => tool.name))
    const steps: NonNullable<TaskPlanDraft['steps']> = []

    if (toolNames.has('computer_observe') || toolNames.has('browser_observe') || toolNames.has('view_image')) {
      steps.push({
        title: '观察当前状态',
        description: '获取当前界面或相关视觉状态，确认任务起点。'
      })
    }

    if (toolNames.has('read') || toolNames.has('grep') || toolNames.has('glob')) {
      steps.push({
        title: '定位相关上下文',
        description: '查找并读取和任务相关的文件、页面或已有信息。'
      })
    }

    steps.push({
      title: '执行核心操作',
      description: this.taskDescription
    })

    if (toolNames.has('exec_command') || toolNames.has('bash') || toolNames.has('computer_observe') || toolNames.has('browser_observe')) {
      steps.push({
        title: '验证执行结果',
        description: '通过命令、观察或状态检查确认任务结果符合用户要求。'
      })
    }

    return {
      title: '执行用户任务',
      summary: this.taskDescription,
      steps: dedupeDraftSteps(steps).slice(0, 4)
    }
  }

  private logPlanParseFailure(content: string, error: Error, finishReason?: string | null): void {
    const raw = String(content ?? '')
    const previewLimit = 4000
    console.warn('[TaskRuntime] Plan response parse failed, using fallback plan:', error.message)
    if (finishReason) {
      console.warn(`[TaskRuntime] Plan response finish_reason: ${finishReason}`)
    }
    console.warn(`[TaskRuntime] Raw plan response length: ${raw.length}`)
    console.warn('[TaskRuntime] Raw plan response:')
    console.warn(raw.length > previewLimit ? `${raw.slice(0, previewLimit)}\n...[truncated ${raw.length - previewLimit} chars]` : raw || '(empty)')
  }

  private normalizePlan(draft: TaskPlanDraft): TaskPlan {
    const now = Date.now()
    const rawSteps = Array.isArray(draft.steps) && draft.steps.length > 0
      ? draft.steps.slice(0, 8)
      : this.createFallbackPlanDraft([]).steps ?? [{ title: '执行核心操作', description: this.taskDescription }]

    const steps: TaskStep[] = rawSteps.map((step, index) => ({
      id: `step-${index + 1}`,
      title: cleanPlanText(step.title) || `步骤 ${index + 1}`,
      description: cleanPlanText(step.description) || cleanPlanText(step.title) || this.taskDescription,
      status: 'pending'
    }))

    return {
      id: `plan-${now}`,
      title: cleanPlanText(draft.title) || '任务执行计划',
      summary: cleanPlanText(draft.summary) || this.taskDescription,
      steps,
      createdAt: now,
      updatedAt: now
    }
  }

  private async updateTaskPlan(args: TaskPlanUpdateArgs): Promise<any> {
    if (!this.taskPlan) {
      throw new Error('Task plan is not initialized')
    }

    this.setRunState('replanning')

    if (typeof args.title === 'string' && args.title.trim()) {
      this.taskPlan.title = cleanPlanText(args.title)
    }
    if (typeof args.summary === 'string' && args.summary.trim()) {
      this.taskPlan.summary = cleanPlanText(args.summary)
    }

    const changedSteps: TaskStep[] = []
    for (const update of args.steps ?? []) {
      const step = await this.resolvePlanUpdateTarget(update)
      const target = step ?? this.appendPlanStep(update)

      if (typeof update.title === 'string' && update.title.trim()) {
        target.title = cleanPlanText(update.title)
      }
      if (typeof update.description === 'string' && update.description.trim()) {
        target.description = cleanPlanText(update.description)
      }
      if (update.status && isTaskStepStatus(update.status)) {
        this.applyStepStatus(target, update.status)
      }
      ensureStepExecutionState(this.executionState, target, update.reason)
      const result = typeof update.result === 'string' && update.result.trim()
        ? cleanPlanText(update.result)
        : ''
      const error = typeof update.error === 'string' && update.error.trim()
        ? cleanPlanText(update.error)
        : ''
      const reason = typeof update.reason === 'string' && update.reason.trim()
        ? cleanPlanText(update.reason)
        : ''
      if (result) {
        target.result = result
      }
      if (error) {
        target.error = error
      }
      if (reason) {
        target.reason = reason
      }
      if (typeof update.error === 'string' && update.error.trim()) {
        failStepExecution(this.executionState, target, error)
      }
      if (target.id === this.currentStep?.id) {
        this.updateExecutionCurrentStep(target)
      }
      if (target.status === 'completed') {
        completeStepExecution(this.executionState, target, result || '步骤已完成。')
      } else if (result) {
        recordStepResult(this.executionState, target, result)
      }
      if (target.status === 'failed' && !error) {
        failStepExecution(this.executionState, target, '步骤执行失败。')
      }
      if (target.status === 'skipped' && reason) {
        blockStepExecution(this.executionState, target, reason)
      }
      changedSteps.push(target)
    }

    this.touchPlan()
    this.emitPlanUpdated()
    for (const step of changedSteps) {
      this.hooks.onStepUpdated?.(step, this.taskPlan, this.getHookMeta())
    }

    return {
      updated: true,
      explanation: args.explanation || '',
      rejected: [],
      plan: this.renderPlanSnapshotForTool()
    }
  }

  private async requestUserInput(args: TaskUserInputArgs): Promise<any> {
    this.throwIfAborted()
    if (!this.hooks.onUserInputRequest) {
      throw new Error('User input requests are not supported by this runtime')
    }

    const sensitivity = normalizeSensitivity(args.sensitivity)
    const request: TaskUserInputRequest = {
      id: `input-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      key: cleanInputKey(args.key),
      groupKey: cleanInputKey(args.groupKey),
      groupLabel: cleanPlanText(args.groupLabel),
      itemKey: cleanInputKey(args.itemKey),
      itemLabel: cleanPlanText(args.itemLabel),
      label: cleanPlanText(args.label) || '需要你补充信息',
      description: cleanPlanText(args.description),
      placeholder: cleanPlanText(args.placeholder),
      inputKind: normalizeInputKind(args.inputKind),
      persistence: sensitivity === 'verification' ? 'temporary' : normalizePersistence(args.persistence),
      sensitivity
    }
    if (request.persistence === 'persistent' && (!request.groupKey || !request.itemKey)) {
      throw new Error('Persistent user input requires groupKey plus itemKey')
    }

    const response = await this.hooks.onUserInputRequest(request)
    this.throwIfAborted()
    if (response.cancelled) {
      throw new Error('User cancelled input request')
    }
    if (!response.value) {
      throw new Error('User input request returned an empty value')
    }

    return {
      value: response.value,
      remembered: Boolean(response.remembered),
      fromCache: Boolean(response.fromCache),
      key: request.key,
      groupKey: request.groupKey,
      itemKey: request.itemKey,
      sensitivity: request.sensitivity
    }
  }

  private appendPlanStep(update: NonNullable<TaskPlanUpdateArgs['steps']>[number]): TaskStep {
    const nextId = `step-${this.taskPlan!.steps.length + 1}`
    const step: TaskStep = {
      id: nextId,
      title: cleanPlanText(update.title) || nextId,
      description: cleanPlanText(update.description) || cleanPlanText(update.title) || this.taskDescription,
      status: 'pending',
      ...(typeof update.reason === 'string' && update.reason.trim()
        ? { reason: cleanPlanText(update.reason) }
        : {})
    }
    this.taskPlan!.steps.push(step)
    ensureStepExecutionState(this.executionState, step, update.reason || '模型根据当前执行状态新增计划步骤。')
    return step
  }

  private async resolvePlanUpdateTarget(
    update: NonNullable<TaskPlanUpdateArgs['steps']>[number]
  ): Promise<TaskStep | null> {
    if (!this.taskPlan) {
      return null
    }

    if (update.id) {
      const byId = this.taskPlan.steps.find(item => item.id === update.id)
      if (byId) {
        return byId
      }
    }

    const localMatch = this.findLocalSimilarStep(update)
    if (localMatch) {
      return localMatch
    }

    return await this.findSemanticSimilarStep(update)
  }

  private findLocalSimilarStep(
    update: NonNullable<TaskPlanUpdateArgs['steps']>[number]
  ): TaskStep | null {
    const updateText = normalizeStepText(update.title, update.description)
    if (!updateText) {
      return null
    }

    for (const step of this.taskPlan?.steps ?? []) {
      const stepText = normalizeStepText(step.title, step.description)
      if (!stepText) {
        continue
      }

      if (stepText === updateText || stepText.includes(updateText) || updateText.includes(stepText)) {
        return step
      }

      const score = jaccardSimilarity(tokenizeStepText(stepText), tokenizeStepText(updateText))
      if (score >= 0.72) {
        return step
      }
    }

    return null
  }

  private async findSemanticSimilarStep(
    update: NonNullable<TaskPlanUpdateArgs['steps']>[number]
  ): Promise<TaskStep | null> {
    if (!this.taskPlan || this.taskPlan.steps.length === 0) {
      return null
    }

    const title = cleanPlanText(update.title)
    const description = cleanPlanText(update.description)
    if (!title && !description) {
      return null
    }

    try {
      const response = await this.llm.chat([
        {
          role: 'system',
          content: [
            '你是任务计划 step 去重器。判断新 step 是否和已有 step 表达同一个可执行目标。',
            '必须基于语义判断，不要只比较标题文字。',
            '如果只是同一目标的改写、补充或更具体表述，应匹配已有 step。',
            '如果目标不同或顺序上确实是新的动作，应不匹配。',
            '只输出 JSON object，不要 Markdown。',
            '格式：{"matched":true,"id":"step-id","reason":"一句话原因"} 或 {"matched":false,"id":null,"reason":"一句话原因"}'
          ].join('\n')
        },
        {
          role: 'user',
          content: JSON.stringify({
            newStep: {
              title,
              description,
              status: update.status
            },
            existingSteps: this.taskPlan.steps.map(step => ({
              id: step.id,
              title: step.title,
              description: step.description,
              status: step.status
            }))
          }, null, 2)
        }
      ], {
        max_tokens: 180,
        signal: this.signal
      })

      const decision = parseStepMatchDecision(response.content)
      if (!decision.matched || !decision.id) {
        return null
      }

      const matched = this.taskPlan.steps.find(step => step.id === decision.id)
      if (matched) {
        verboseLog(`[TaskRuntime] 合并重复步骤: ${title || description} -> ${matched.id} (${decision.reason})`)
      }
      return matched ?? null
    } catch (error) {
      console.warn(`[TaskRuntime] Step semantic merge failed: ${(error as Error).message}`)
      return null
    }
  }

  private applyStepStatus(step: TaskStep, status: TaskStepStatus): void {
    const now = Date.now()
    if (status === 'running') {
      for (const item of this.taskPlan?.steps ?? []) {
        if (item.id !== step.id && item.status === 'running') {
          item.status = 'pending'
        }
      }
    }
    step.status = status
    if (status === 'running' && !step.startedAt) {
      step.startedAt = now
    }
    if (status === 'completed' || status === 'failed' || status === 'skipped') {
      step.completedAt = now
    }
  }

  private renderPlanSnapshotForTool(): Array<{
    id: string
    title: string
    status: TaskStepStatus
  }> {
    return this.taskPlan?.steps.map(step => ({
      id: step.id,
      title: step.title,
      status: step.status
    })) ?? []
  }

  private nextRunnableStep(): TaskStep | null {
    return this.taskPlan?.steps.find(step => step.status === 'running')
      ?? this.taskPlan?.steps.find(step => step.status === 'pending')
      ?? null
  }

  private hasRunnableSteps(): boolean {
    return Boolean(this.taskPlan?.steps.some(step => step.status === 'pending' || step.status === 'running'))
  }

  private startStep(step: TaskStep): void {
    this.currentStep = step
    this.updateExecutionCurrentStep(step)
    if (step.status !== 'running') {
      step.status = 'running'
      step.startedAt = Date.now()
      this.updateExecutionCurrentStep(step)
      this.touchPlan()
      this.emitStepUpdated(step)
    }
  }

  private completeStep(step: TaskStep, result: string): void {
    step.status = 'completed'
    step.result = result
    step.completedAt = Date.now()
    this.updateExecutionCurrentStep(step)
    completeStepExecution(this.executionState, step, result)
    this.touchPlan()
    this.emitStepUpdated(step)
  }

  private failCurrentStep(error: string): void {
    if (!this.currentStep || this.currentStep.status === 'completed') {
      return
    }
    this.currentStep.status = 'failed'
    this.currentStep.completedAt = Date.now()
    this.updateExecutionCurrentStep(this.currentStep)
    failStepExecution(this.executionState, this.currentStep, error)
    this.touchPlan()
    this.emitStepUpdated(this.currentStep)
  }

  private updateExecutionCurrentStep(step: TaskStep): void {
    ensureStepExecutionState(this.executionState, step)
    this.executionState.currentStep = {
      id: step.id,
      title: step.title,
      description: step.description,
      status: step.status
    }
    this.executionState.updatedAt = Date.now()
  }

  private getStepRuntime(stepId: string) {
    return this.executionState.steps[stepId]
  }

  private setRunState(state: TaskRunState): void {
    if (this.runState === state) {
      return
    }
    this.runState = state
    this.hooks.onRunStateChanged?.(state, this.getHookMeta())
  }

  private touchPlan(): void {
    if (this.taskPlan) {
      this.taskPlan.updatedAt = Date.now()
    }
  }

  private emitPlanUpdated(): void {
    if (this.taskPlan) {
      this.hooks.onPlanUpdated?.(this.taskPlan, this.getHookMeta())
    }
  }

  private emitStepUpdated(step: TaskStep): void {
    if (this.taskPlan) {
      const meta = this.getHookMeta()
      this.hooks.onStepUpdated?.(step, this.taskPlan, meta)
      this.hooks.onPlanUpdated?.(this.taskPlan, meta)
    }
  }

  private getHookMeta(): TaskRuntimeHookMeta {
    return {
      taskDescription: this.taskDescription,
      originalUserInput: this.originalUserInput,
    }
  }

  private renderPlanContext(plan: TaskPlan): string {
    return [
      '<task_plan>',
      `<title>${escapeXmlText(plan.title)}</title>`,
      `<summary>${escapeXmlText(plan.summary)}</summary>`,
      '<steps>',
      ...plan.steps.map(step =>
        `<step id="${escapeXmlText(step.id)}" status="${step.status}">${escapeXmlText(step.title)}：${escapeXmlText(step.description)}</step>`
      ),
      '</steps>',
      '</task_plan>'
    ].join('\n')
  }

  private renderCurrentStepInstruction(step: TaskStep): string {
    return [
      '<current_step>',
      `<id>${escapeXmlText(step.id)}</id>`,
      `<title>${escapeXmlText(step.title)}</title>`,
      `<description>${escapeXmlText(step.description)}</description>`,
      '</current_step>',
      this.renderExecutionStateContext(),
      PROMPTS.task.stepInstruction
    ].join('\n')
  }

  private renderExecutionStateContext(): string {
    const state = this.executionState
    const lines = [
      '<execution_state>',
      `Goal: ${escapeXmlText(state.goal)}`,
      state.currentStep
        ? `Current step: ${escapeXmlText(state.currentStep.id)} ${escapeXmlText(state.currentStep.title)} (${state.currentStep.status})`
        : '',
      Object.keys(state.steps).length > 0
        ? `Step runtime state:\n${Object.values(state.steps).slice(-8).map(step => [
            `- ${escapeXmlText(step.id)} ${escapeXmlText(step.title)} (${step.status})`,
            step.result ? `result=${escapeXmlText(step.result)}` : '',
            step.error ? `error=${escapeXmlText(step.error)}` : '',
            step.failureCount > 0 ? `failures=${step.failureCount}` : '',
            step.blockedReason ? `blocked=${escapeXmlText(step.blockedReason)}` : '',
            step.addReason ? `added=${escapeXmlText(step.addReason)}` : '',
            step.toolCalls.length > 0 ? `tools=${escapeXmlText(step.toolCalls.slice(-6).join(', '))}` : '',
            step.verificationStatus !== 'not_required' ? `verification=${step.verificationStatus}` : ''
          ].filter(Boolean).join(' ')).join('\n')}`
        : '',
      state.confirmedFacts.length > 0
        ? `Confirmed facts:\n${state.confirmedFacts.slice(-6).map(item => `- ${escapeXmlText(item)}`).join('\n')}`
        : '',
      state.recentObservations.length > 0
        ? `Recent observations:\n${state.recentObservations.slice(-6).map(item => `- [${item.status}] ${escapeXmlText(item.toolName)}: ${escapeXmlText(item.summary)}`).join('\n')}`
        : '',
      state.recentFailures.length > 0
        ? `Recent failures:\n${state.recentFailures.slice(-4).map(item => `- ${escapeXmlText(item)}`).join('\n')}`
        : '',
      state.changedFiles.length > 0
        ? `Changed files:\n${state.changedFiles.slice(-8).map(item => `- ${escapeXmlText(item)}`).join('\n')}`
        : '',
      state.pendingVerification.length > 0
        ? `Pending verification:\n${state.pendingVerification.slice(-4).map(item => `- ${escapeXmlText(item)}`).join('\n')}`
        : '',
      state.activeSessions.length > 0
        ? [
            'Active command sessions:',
            ...state.activeSessions.map(session => [
              `- ${escapeXmlText(session.id)} (${escapeXmlText(session.status)})`,
              session.command ? `cmd=${escapeXmlText(session.command)}` : '',
              session.cwd ? `cwd=${escapeXmlText(session.cwd)}` : '',
              session.lastOutput ? `last_output=${escapeXmlText(session.lastOutput)}` : '',
              'use write_stdin to poll, send input, or terminate when finished'
            ].filter(Boolean).join(' '))
          ].join('\n')
        : '',
      '</execution_state>'
    ].filter(Boolean)

    return lines.join('\n')
  }

  private buildPlanCompletionMessage(fallback = ''): string {
    if (!this.taskPlan) {
      return cleanFinalMessage(fallback) || '任务结束，未记录到具体结果。'
    }

    const completed = this.taskPlan.steps
      .filter(step => step.status === 'completed')
      .map(step => {
        const result = cleanFinalMessage(this.getStepRuntime(step.id)?.result || '')
        return result ? `${step.title}：${result}` : step.title
      })

    if (completed.length === 0) {
      return cleanFinalMessage(fallback) || '任务结束，未记录到具体结果。'
    }

    if (completed.length === 1) {
      return `任务结果：${completed[0]}`
    }

    return `任务结果：\n${completed.map(item => `- ${item}`).join('\n')}`
  }

  private formatMemoryContext(): string {
    const sections: string[] = []

    const basicProfile = Object.entries(this.memoryContext.userProfile.basic)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)

    if (basicProfile.length > 0) {
      sections.push(`${PROMPTS.context.userProfileTitle}\n${basicProfile.join('\n')}`)
    }

    if (this.memoryContext.summaries.length > 0) {
      sections.push(
        `${PROMPTS.context.historySummaryTitle}\n${this.memoryContext.summaries
          .map(summary => {
            const time = formatMessageTime(summary.timestamp, this.awareness)
            return `- ${time ? `[${time}] ` : ''}${summary.summary}`
          })
          .join('\n')}`
      )
    }

    return sections.join('\n\n')
  }

  private throwIfAborted(): void {
    if (!this.signal?.aborted) {
      return
    }
    throw new DOMException('Task aborted', 'AbortError')
  }
}

function cleanFinalMessage(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
}

function resolveAutoCompactTokenLimit(value: unknown, modelContextWindow: number): number {
  const contextLimit = Math.floor(modelContextWindow * 0.9)
  const configured = Number(value)
  if (!Number.isFinite(configured) || configured <= 0) {
    return contextLimit
  }
  return Math.min(Math.round(configured), contextLimit)
}

function estimateMessagesTokenCount(messages: any[]): number {
  const text = messages.map(message => messageToTokenText(message)).join('\n')
  return estimateTextTokens(text)
}

function messageToTokenText(message: any): string {
  if (!message || typeof message !== 'object') {
    return String(message ?? '')
  }
  if (typeof message.content === 'string') {
    return `${message.role ?? ''}: ${message.content}`
  }
  return JSON.stringify(sanitizeToolResultForPrompt(message))
}

function estimateTextTokens(text: string): number {
  if (!text) {
    return 0
  }
  const asciiChars = text.replace(/[^\x00-\x7F]/g, '').length
  const nonAsciiChars = text.length - asciiChars
  return Math.ceil(asciiChars / 4 + nonAsciiChars * 0.8)
}

function countPromptMessagesForTurn(turn: import('./turn.js').TurnRunResult): number {
  const toolMessages = turn.toolCalls.length
  const imageMessages = turn.toolCalls.reduce((count, call, index) => (
    count + extractToolResultImages(turn.toolResults[index], call.function.name).length
  ), 0)

  return 1 + toolMessages + imageMessages
}

function countPromptMessagesForRecords(records: TaskTurnRecord[]): number {
  return records.reduce((sum, record) => (
    sum + (record.promptMessageCount ?? 1 + record.toolCalls.length)
  ), 0)
}

function appendCompactSummary(previous: string, next: string): string {
  const sections = [previous.trim(), next.trim()].filter(Boolean)
  const combined = sections.join('\n\n')
  const maxLength = 8000
  if (combined.length <= maxLength) {
    return combined
  }
  return combined.slice(combined.length - maxLength).trim()
}

function parsePlanDraft(content: string, onParseFailure?: (error: Error) => void): TaskPlanDraft {
  try {
    return JSON.parse(content) as TaskPlanDraft
  } catch (error) {
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) {
      onParseFailure?.(error instanceof Error ? error : new Error('Plan response did not contain JSON'))
      throw new Error('Plan response did not contain JSON')
    }
    try {
      return JSON.parse(match[0]) as TaskPlanDraft
    } catch (nestedError) {
      onParseFailure?.(nestedError instanceof Error ? nestedError : new Error('Plan JSON parse failed'))
      throw nestedError
    }
  }
}

function dedupeDraftSteps(steps: NonNullable<TaskPlanDraft['steps']>): NonNullable<TaskPlanDraft['steps']> {
  const seen = new Set<string>()
  const output: NonNullable<TaskPlanDraft['steps']> = []
  for (const step of steps) {
    const key = normalizeStepText(step.title, step.description)
    if (!key || seen.has(key)) {
      continue
    }
    seen.add(key)
    output.push(step)
  }
  return output
}

function cleanPlanText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

function normalizeStepText(title: unknown, description: unknown): string {
  return `${cleanPlanText(title)} ${cleanPlanText(description)}`
    .toLowerCase()
    .replace(/[，。！？、,.!?;；:"“”'‘’()（）[\]【】]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeStepText(value: string): string[] {
  const compact = value.replace(/\s+/g, '')
  const tokens = new Set<string>()
  for (const word of value.split(/\s+/).filter(Boolean)) {
    tokens.add(word)
  }
  for (let index = 0; index < compact.length - 1; index++) {
    tokens.add(compact.slice(index, index + 2))
  }
  return Array.from(tokens)
}

function jaccardSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0
  }
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  let intersection = 0
  for (const item of leftSet) {
    if (rightSet.has(item)) {
      intersection++
    }
  }
  const union = new Set([...leftSet, ...rightSet]).size
  return union > 0 ? intersection / union : 0
}

function parseStepMatchDecision(content: string): {
  matched: boolean
  id: string | null
  reason: string
} {
  let parsed: any
  try {
    parsed = JSON.parse(content)
  } catch {
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) {
      return { matched: false, id: null, reason: 'no JSON returned' }
    }
    parsed = JSON.parse(match[0])
  }

  return {
    matched: parsed?.matched === true,
    id: typeof parsed?.id === 'string' && parsed.id.trim() ? parsed.id.trim() : null,
    reason: typeof parsed?.reason === 'string' ? parsed.reason : 'semantic step match decision'
  }
}

interface PromptImageInput {
  base64: string
  mimeType: string
  note?: string
  path?: string
  width?: number
  height?: number
}

function extractToolResultImages(value: unknown, toolName: string): PromptImageInput[] {
  const images: PromptImageInput[] = []
  const seenObjects = new WeakSet<object>()
  const seenImages = new Set<string>()

  const visit = (item: unknown): void => {
    if (!item || typeof item !== 'object') {
      return
    }
    if (seenObjects.has(item)) {
      return
    }
    seenObjects.add(item)

    if (Array.isArray(item)) {
      for (const child of item) {
        visit(child)
      }
      return
    }

    const record = item as Record<string, any>
    const base64 = firstString(record.image_base64, record.screenshot_base64, record.annotated_image_base64)
    if (base64 && looksLikeImageBase64(base64)) {
      const signature = base64.slice(0, 96)
      if (!seenImages.has(signature)) {
        seenImages.add(signature)
        images.push({
          base64,
          mimeType: firstString(record.mime_type, record.mimeType) || 'image/png',
          note: firstString(record.note, record.description) || `Image observation from ${toolName}`,
          path: firstString(record.path, record.file_path),
          width: finiteNumber(record.width),
          height: finiteNumber(record.height)
        })
      }
    }

    for (const child of Object.values(record)) {
      visit(child)
    }
  }

  visit(value)
  return images
}

function sanitizeToolResultForPrompt(value: unknown): unknown {
  const seenObjects = new WeakSet<object>()

  const sanitize = (item: unknown): unknown => {
    if (!item || typeof item !== 'object') {
      return item
    }
    if (seenObjects.has(item)) {
      return '[Circular]'
    }
    seenObjects.add(item)

    if (Array.isArray(item)) {
      return item.map(child => sanitize(child))
    }

    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (isInlineImageKey(key) && typeof child === 'string') {
        output[key] = `[omitted ${child.length} base64 chars; image attached separately]`
        continue
      }

      if (key === 'image_url' && typeof child === 'string' && child.startsWith('data:image/')) {
        output[key] = '[omitted data image URL; image attached separately]'
        continue
      }

      output[key] = sanitize(child)
    }
    return output
  }

  return sanitize(value)
}

function isInlineImageKey(key: string): boolean {
  return key === 'image_base64'
    || key === 'screenshot_base64'
    || key === 'annotated_image_base64'
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }
  return undefined
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function looksLikeImageBase64(value: string): boolean {
  if (value.length < 80) {
    return false
  }
  return /^[A-Za-z0-9+/=\r\n]+$/.test(value)
}

function isTaskStepStatus(value: unknown): value is TaskStepStatus {
  return value === 'pending'
    || value === 'running'
    || value === 'completed'
    || value === 'failed'
    || value === 'skipped'
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && (error.name === 'AbortError' || error.name === 'APIUserAbortError')
}

function normalizeInputKind(value: unknown): TaskUserInputKind {
  return value === 'password' || value === 'textarea' || value === 'code'
    ? value
    : 'text'
}

function normalizePersistence(value: unknown): TaskUserInputPersistence {
  return value === 'persistent' ? 'persistent' : 'temporary'
}

function normalizeSensitivity(value: unknown): TaskUserInputSensitivity {
  if (value === 'secret' || value === 'verification') {
    return value
  }
  return 'normal'
}

function cleanInputKey(value: unknown): string | undefined {
  const key = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return key || undefined
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.round(numeric)))
}

function escapeXmlText(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
