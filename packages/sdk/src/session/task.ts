/**
 * Task runtime loop.
 *
 * Builds task prompts, injects task context, runs model/tool iterations,
 * compacts long task history, and returns the final task result.
 */
import type { Tool } from '@her-text/types'
import type { LLMProvider } from '@her-text/core'
import type { AgentCore } from '../agent/index.js'
import type { ContextManager } from '../context/index.js'
import type { UserProfile, ConversationSummary } from '../memory/index.js'
import type { PersonalityEngine } from '../personality/index.js'
import { TurnRuntime } from './turn.js'
import { PROMPTS } from '../prompts.js'
import type { TaskPlan, TaskPlanDraft, TaskRunState, TaskStep, TaskStepStatus } from './task-plan.js'

export interface TaskRunResult {
  success: boolean
  iterations: number
  toolCalls: number
  finalMessage: string
  plan?: TaskPlan
  error?: string
}

export interface TaskTurnRecord {
  turnIndex: number
  assistantMessage: string
  toolCalls: Array<{
    id: string
    name: string
    arguments: string
  }>
  toolResults: any[]
  completed: boolean
  stepId?: string
  stepTitle?: string
}

export interface TaskRuntimeHooks {
  onTurnCompleted?: (turn: TaskTurnRecord) => void
  onStatusChanged?: (status: 'running' | 'completed' | 'errored') => void
  onRunStateChanged?: (state: TaskRunState) => void
  onPlanUpdated?: (plan: TaskPlan) => void
  onStepUpdated?: (step: TaskStep, plan: TaskPlan) => void
  onUserInputRequest?: (request: TaskUserInputRequest) => Promise<TaskUserInputResponse>
  onCompact?: (summary: string) => void
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
  }>
}

export type TaskUserInputPersistence = 'temporary' | 'persistent'
export type TaskUserInputKind = 'text' | 'password' | 'textarea' | 'code'
export type TaskUserInputSensitivity = 'normal' | 'secret' | 'verification'

export interface TaskUserInputRequest {
  id: string
  key?: string
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
  label?: string
  description?: string
  placeholder?: string
  inputKind?: TaskUserInputKind
  persistence?: TaskUserInputPersistence
  sensitivity?: TaskUserInputSensitivity
}

export class TaskRuntime {
  private turnRuntime: TurnRuntime
  private maxTurns = 24
  private compactAfterTurns = 8
  private keepRecentTurns = 4
  private compactSummary = ''
  private turnRecords: TaskTurnRecord[] = []
  private taskPlan: TaskPlan | null = null
  private runState: TaskRunState = 'planning'
  private currentStep: TaskStep | null = null

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
    private signal?: AbortSignal
  ) {
    this.turnRuntime = new TurnRuntime(llm, agent)
  }

  async run(): Promise<TaskRunResult> {
    const tools = this.agent.getTools()
    const toolSpecs = this.buildToolSpecs(tools)
    let messages: any[] = []

    let iterations = 0
    let toolCallsCount = 0
    let finalMessage = ''
    let noOpTurns = 0

    console.log('\n╔══════════════════════════════════════════════════════════════╗')
    console.log('║               🚀 TaskRuntime 开始执行                          ║')
    console.log('╠══════════════════════════════════════════════════════════════╣')
    console.log(`║ 任务描述: ${this.taskDescription.substring(0, 50)}`)
    console.log(`║ 可用工具: ${tools.map(t => t.name).join(', ')}`)
    console.log(`║ 最大轮次: ${this.maxTurns}`)
    console.log('╚══════════════════════════════════════════════════════════════╝\n')

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
          finalMessage = finalMessage || this.buildPlanCompletionMessage()
          this.setRunState('completed')
          this.hooks.onStatusChanged?.('completed')
          this.emitPlanUpdated()
          return {
            success: true,
            iterations,
            toolCalls: toolCallsCount,
            finalMessage,
            plan: this.taskPlan
          }
        }

        this.startStep(step)
        iterations++
        console.log(`\n┌─────────────────────────────────────────────────────────────┐`)
        console.log(`│ 📍 TaskRuntime 迭代 ${iterations}/${this.maxTurns} · ${step.title.substring(0, 24)}                    │`)
        console.log(`└─────────────────────────────────────────────────────────────┘`)

        messages.push({
          role: 'user',
          content: this.renderCurrentStepInstruction(step)
        })

        this.setRunState('step_running')
        const turn = await this.turnRuntime.run(iterations, messages, toolSpecs, {
          signal: this.signal,
          internalTools: {
            update_task_plan: (args) => this.updateTaskPlan(args),
            request_user_input: (args) => this.requestUserInput(args)
          },
          onToolCalling: (toolCalls) => {
            step.toolCalls.push(...toolCalls.map(call => call.function.name))
            this.setRunState('tool_calling')
            this.emitStepUpdated(step)
          },
          onObserving: () => {
            this.setRunState('observing')
            this.emitStepUpdated(step)
          }
        })
        this.throwIfAborted()
        toolCallsCount += turn.toolCalls.length
        this.recordTurn(turn)

        if (step.status === 'completed') {
          finalMessage = step.result || turn.assistantMessage.trim() || finalMessage

          if (this.hasRunnableSteps()) {
            console.log(`[TaskRuntime] 当前步骤已由计划更新标记完成，继续下一步...`)
            this.appendTurnMessages(messages, turn)
            noOpTurns = 0
            await this.maybeCompact(messages)
            this.throwIfAborted()
            continue
          }

          finalMessage = finalMessage || '任务已完成。'
          this.setRunState('completed')
          this.hooks.onStatusChanged?.('completed')
          this.emitPlanUpdated()

          console.log('\n╔══════════════════════════════════════════════════════════════╗')
          console.log('║               ✅ TaskRuntime 执行完成                          ║')
          console.log('╠══════════════════════════════════════════════════════════════╣')
          console.log(`║ 总迭代次数: ${iterations}`)
          console.log(`║ 总工具调用: ${toolCallsCount}`)
          console.log(`║ 最终消息: ${finalMessage.substring(0, 50)}...`)
          console.log('╚══════════════════════════════════════════════════════════════╝\n')

          return {
            success: true,
            iterations,
            toolCalls: toolCallsCount,
            finalMessage,
            plan: this.taskPlan
          }
        }

        if (turn.toolCalls.length === 0 && step.status === 'running') {
          noOpTurns++
          console.warn(`[TaskRuntime] 迭代 ${iterations} 没有工具调用且步骤未完成，要求模型继续执行 (${noOpTurns}/2)`)
          messages.push({
            role: 'assistant',
            content: turn.assistantMessage || ''
          })
          messages.push({
            role: 'user',
            content: [
              '当前步骤还没有完成。',
              '不要只描述计划或说明你将要做什么。',
              '请立刻调用可用工具推进当前步骤；如果步骤已经完成，必须调用 update_task_plan 标记 completed 并写入 result。'
            ].join('\n')
          })

          if (noOpTurns >= 2) {
            this.failCurrentStep('The model produced repeated no-op turns without completing the step')
            noOpTurns = 0
          }

          await this.maybeCompact(messages)
          this.throwIfAborted()
          continue
        }

        noOpTurns = 0

        if (turn.completed) {
          this.completeStep(step, turn.assistantMessage.trim() || '步骤已完成。')
          finalMessage = turn.assistantMessage.trim() || finalMessage

          if (this.hasRunnableSteps()) {
            console.log(`[TaskRuntime] 当前步骤完成，继续下一步...`)
            messages.push({
              role: 'assistant',
              content: turn.assistantMessage || `步骤完成：${step.title}`
            })
            continue
          }

          finalMessage = finalMessage || '任务已完成。'
          this.setRunState('completed')
          this.hooks.onStatusChanged?.('completed')

          console.log('\n╔══════════════════════════════════════════════════════════════╗')
          console.log('║               ✅ TaskRuntime 执行完成                          ║')
          console.log('╠══════════════════════════════════════════════════════════════╣')
          console.log(`║ 总迭代次数: ${iterations}`)
          console.log(`║ 总工具调用: ${toolCallsCount}`)
          console.log(`║ 最终消息: ${finalMessage.substring(0, 50)}...`)
          console.log('╚══════════════════════════════════════════════════════════════╝\n')

          return {
            success: true,
            iterations,
            toolCalls: toolCallsCount,
            finalMessage,
            plan: this.taskPlan
          }
        }

        console.log(`[TaskRuntime] 迭代 ${iterations} 未完成，继续执行...`)

        this.appendTurnMessages(messages, turn)

        await this.maybeCompact(messages)
        this.throwIfAborted()
      }

      console.log('\n╔══════════════════════════════════════════════════════════════╗')
      console.log('║               ⚠️ TaskRuntime 达到最大轮次                       ║')
      console.log('╚══════════════════════════════════════════════════════════════╝\n')

      this.failCurrentStep(`Reached max turns (${this.maxTurns})`)
      this.setRunState('failed')
      this.hooks.onStatusChanged?.('errored')
      return {
        success: false,
        iterations,
        toolCalls: toolCallsCount,
        finalMessage: '任务执行超过最大轮次，已停止。',
        plan: this.taskPlan ?? undefined,
        error: `Reached max turns (${this.maxTurns})`
      }
    } catch (error) {
      if (isAbortError(error) || this.signal?.aborted) {
        console.log('\n╔══════════════════════════════════════════════════════════════╗')
        console.log('║               ⏹️ TaskRuntime 已取消                          ║')
        console.log('╚══════════════════════════════════════════════════════════════╝\n')

        this.failCurrentStep('Task was interrupted by a newer turn')
        this.setRunState('cancelled')
        this.hooks.onStatusChanged?.('errored')
        return {
          success: false,
          iterations,
          toolCalls: toolCallsCount,
          finalMessage: '任务已被新的输入打断。',
          plan: this.taskPlan ?? undefined,
          error: 'Task aborted'
        }
      }

      console.log('\n╔══════════════════════════════════════════════════════════════╗')
      console.log('║               ❌ TaskRuntime 执行出错                          ║')
      console.log(`║ Error: ${(error as Error).message}`)
      console.log('╚══════════════════════════════════════════════════════════════╝\n')

      this.failCurrentStep((error as Error).message)
      this.setRunState('failed')
      this.hooks.onStatusChanged?.('errored')
      return {
        success: false,
        iterations,
        toolCalls: toolCallsCount,
        finalMessage: '任务执行失败。',
        plan: this.taskPlan ?? undefined,
        error: (error as Error).message
      }
    }
  }

  private recordTurn(turn: import('./turn.js').TurnRunResult): void {
    const record: TaskTurnRecord = {
      turnIndex: turn.turnIndex,
      assistantMessage: turn.assistantMessage,
      toolCalls: turn.toolCalls.map(call => ({
        id: call.id,
        name: call.function.name,
        arguments: call.function.arguments
      })),
      toolResults: turn.toolResults,
      completed: turn.completed,
      stepId: this.currentStep?.id,
      stepTitle: this.currentStep?.title
    }

    this.turnRecords.push(record)
    this.hooks.onTurnCompleted?.(record)
  }

  private appendTurnMessages(messages: any[], turn: import('./turn.js').TurnRunResult): void {
    messages.push({
      role: 'assistant',
      content: turn.assistantMessage || '',
      ...(turn.toolCalls.length > 0 ? { tool_calls: turn.toolCalls } : {})
    })

    turn.toolCalls.forEach((call, index) => {
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(turn.toolResults[index])
      })
    })
  }

  private async maybeCompact(messages: any[]): Promise<void> {
    this.throwIfAborted()
    if (this.turnRecords.length < this.compactAfterTurns) {
      return
    }

    const compactBoundary = this.turnRecords.length - this.keepRecentTurns
    if (compactBoundary <= 0) {
      return
    }

    const recordsToCompact = this.turnRecords.slice(0, compactBoundary)
    if (recordsToCompact.length === 0) {
      return
    }

    console.log('\n┌─────────────────────────────────────────────────────────────┐')
    console.log(`│ 📦 Auto Compact: 压缩 ${recordsToCompact.length} 轮历史                          │`)
    console.log('└─────────────────────────────────────────────────────────────┘')

    try {
      const compactInput = recordsToCompact.map(record => {
        const toolLines = record.toolCalls.length > 0
          ? record.toolCalls.map(call => `${call.name}(${call.arguments})`).join(', ')
          : 'none'

        return [
          `Turn ${record.turnIndex}`,
          `Assistant: ${record.assistantMessage || '(empty)'}`,
          `Tools: ${toolLines}`,
          `Results: ${JSON.stringify(record.toolResults)}`
        ].join('\n')
      }).join('\n\n')

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

      this.compactSummary = summaryResponse.content.trim()
      this.hooks.onCompact?.(this.compactSummary)

      const recentMessageCount = this.keepRecentTurns * 2 + 1
      const recentMessages = messages.slice(-recentMessageCount)
      messages.splice(
        0,
        messages.length,
        ...[
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
              PROMPTS.task.continueAfterCompact
            ].filter(Boolean).join('\n\n')
          },
          ...recentMessages
        ].filter(Boolean)
      )

      this.turnRecords = this.turnRecords.slice(compactBoundary)
    } catch (error) {
      console.warn(`[TaskRuntime] Compact failed, continuing with full history: ${(error as Error).message}`)
    }
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
      .map(item => `${item.role}: ${item.content}`)
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
          PROMPTS.task.initialInstruction
        ].join('\n\n')
      }
    ].filter(Boolean)
  }

  private buildToolSpecs(tools: Tool[]): any[] {
    return [
      this.buildTaskPlanUpdateToolSpec(),
      this.buildUserInputRequestToolSpec(),
      ...tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        }
      }))
    ]
  }

  private buildTaskSystemPrompt(): string {
    const personality = this.personality.getPersonality()
    return PROMPTS.task.systemPrompt(
      personality.character.name,
      personality.relationship.type
    )
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
              description: 'Stable storage key decided by the AI for reusable information, such as openai.api_key or github.personal_access_token. Required for persistent values.'
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

  private async createInitialPlan(tools: Tool[]): Promise<TaskPlan> {
    try {
      this.throwIfAborted()
      const response = await this.llm.chat([
        {
          role: 'system',
          content: PROMPTS.task.planningSystem
        },
        {
          role: 'user',
          content: [
            `${PROMPTS.context.userRequestTitle}${this.originalUserInput}`,
            `${PROMPTS.context.currentTaskTitle}${this.taskDescription}`,
            `可用工具：${tools.map(tool => tool.name).join(', ') || '无'}`,
            this.formatMemoryContext()
          ].filter(Boolean).join('\n\n')
        }
      ], {
        max_tokens: 800,
        signal: this.signal
      })

      this.throwIfAborted()
      const draft = parsePlanDraft(response.content)
      return this.normalizePlan(draft)
    } catch (error) {
      console.warn(`[TaskRuntime] Plan generation failed, using fallback plan: ${(error as Error).message}`)
      return this.normalizePlan({
        title: '执行用户任务',
        summary: this.taskDescription,
        steps: [
          {
            title: '完成任务',
            description: this.taskDescription
          }
        ]
      })
    }
  }

  private normalizePlan(draft: TaskPlanDraft): TaskPlan {
    const now = Date.now()
    const rawSteps = Array.isArray(draft.steps) && draft.steps.length > 0
      ? draft.steps.slice(0, 8)
      : [{ title: '完成任务', description: this.taskDescription }]

    const steps: TaskStep[] = rawSteps.map((step, index) => ({
      id: `step-${index + 1}`,
      title: cleanPlanText(step.title) || `步骤 ${index + 1}`,
      description: cleanPlanText(step.description) || cleanPlanText(step.title) || this.taskDescription,
      status: 'pending',
      toolCalls: []
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

  private updateTaskPlan(args: TaskPlanUpdateArgs): any {
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
      const step = update.id
        ? this.taskPlan.steps.find(item => item.id === update.id)
        : null
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
      if (typeof update.result === 'string' && update.result.trim()) {
        target.result = cleanPlanText(update.result)
      }
      if (typeof update.error === 'string' && update.error.trim()) {
        target.error = cleanPlanText(update.error)
      }
      changedSteps.push(target)
    }

    this.touchPlan()
    this.emitPlanUpdated()
    for (const step of changedSteps) {
      this.hooks.onStepUpdated?.(step, this.taskPlan)
    }

    return {
      updated: true,
      explanation: args.explanation || '',
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
      label: cleanPlanText(args.label) || '需要你补充信息',
      description: cleanPlanText(args.description),
      placeholder: cleanPlanText(args.placeholder),
      inputKind: normalizeInputKind(args.inputKind),
      persistence: sensitivity === 'verification' ? 'temporary' : normalizePersistence(args.persistence),
      sensitivity
    }
    if (request.persistence === 'persistent' && !request.key) {
      throw new Error('Persistent user input requires a stable key')
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
      toolCalls: []
    }
    this.taskPlan!.steps.push(step)
    return step
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
    if (step.status !== 'running') {
      step.status = 'running'
      step.startedAt = Date.now()
      this.touchPlan()
      this.emitStepUpdated(step)
    }
  }

  private completeStep(step: TaskStep, result: string): void {
    step.status = 'completed'
    step.result = result
    step.completedAt = Date.now()
    this.touchPlan()
    this.emitStepUpdated(step)
  }

  private failCurrentStep(error: string): void {
    if (!this.currentStep || this.currentStep.status === 'completed') {
      return
    }
    this.currentStep.status = 'failed'
    this.currentStep.error = error
    this.currentStep.completedAt = Date.now()
    this.touchPlan()
    this.emitStepUpdated(this.currentStep)
  }

  private setRunState(state: TaskRunState): void {
    if (this.runState === state) {
      return
    }
    this.runState = state
    this.hooks.onRunStateChanged?.(state)
  }

  private touchPlan(): void {
    if (this.taskPlan) {
      this.taskPlan.updatedAt = Date.now()
    }
  }

  private emitPlanUpdated(): void {
    if (this.taskPlan) {
      this.hooks.onPlanUpdated?.(this.taskPlan)
    }
  }

  private emitStepUpdated(step: TaskStep): void {
    if (this.taskPlan) {
      this.hooks.onStepUpdated?.(step, this.taskPlan)
      this.hooks.onPlanUpdated?.(this.taskPlan)
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
      PROMPTS.task.stepInstruction
    ].join('\n')
  }

  private buildPlanCompletionMessage(): string {
    if (!this.taskPlan) {
      return '任务已完成。'
    }

    const completed = this.taskPlan.steps
      .filter(step => step.status === 'completed')
      .map(step => `- ${step.title}`)
      .join('\n')

    return completed ? `任务已完成：\n${completed}` : '任务已完成。'
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
          .map(summary => `- ${summary.summary}`)
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

function parsePlanDraft(content: string): TaskPlanDraft {
  try {
    return JSON.parse(content) as TaskPlanDraft
  } catch {
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) {
      throw new Error('Plan response did not contain JSON')
    }
    return JSON.parse(match[0]) as TaskPlanDraft
  }
}

function cleanPlanText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
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

function escapeXmlText(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
