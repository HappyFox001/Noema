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

export interface TaskRunResult {
  success: boolean
  iterations: number
  toolCalls: number
  finalMessage: string
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
}

export interface TaskRuntimeHooks {
  onTurnCompleted?: (turn: TaskTurnRecord) => void
  onStatusChanged?: (status: 'running' | 'completed' | 'errored') => void
  onCompact?: (summary: string) => void
}

export interface TaskContextItem {
  id: string
  type: string
  name: string
  path?: string
  content: string
}

export class TaskRuntime {
  private turnRuntime: TurnRuntime
  private maxTurns = 12
  private compactAfterTurns = 4
  private keepRecentTurns = 2
  private compactSummary = ''
  private turnRecords: TaskTurnRecord[] = []

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
    private hooks: TaskRuntimeHooks = {}
  ) {
    this.turnRuntime = new TurnRuntime(llm, agent)
  }

  async run(): Promise<TaskRunResult> {
    const tools = this.agent.getTools()
    const toolSpecs = this.buildToolSpecs(tools)
    const messages = this.buildInitialMessages()

    let iterations = 0
    let toolCallsCount = 0
    let finalMessage = ''

    console.log('\n╔══════════════════════════════════════════════════════════════╗')
    console.log('║               🚀 TaskRuntime 开始执行                          ║')
    console.log('╠══════════════════════════════════════════════════════════════╣')
    console.log(`║ 任务描述: ${this.taskDescription.substring(0, 50)}`)
    console.log(`║ 可用工具: ${tools.map(t => t.name).join(', ')}`)
    console.log(`║ 最大轮次: ${this.maxTurns}`)
    console.log('╚══════════════════════════════════════════════════════════════╝\n')

    try {
      this.hooks.onStatusChanged?.('running')

      while (iterations < this.maxTurns) {
        iterations++
        console.log(`\n┌─────────────────────────────────────────────────────────────┐`)
        console.log(`│ 📍 TaskRuntime 迭代 ${iterations}/${this.maxTurns}                              │`)
        console.log(`└─────────────────────────────────────────────────────────────┘`)

        const turn = await this.turnRuntime.run(iterations, messages, toolSpecs)
        toolCallsCount += turn.toolCalls.length
        this.recordTurn(turn)

        if (turn.completed) {
          finalMessage = turn.assistantMessage.trim() || '任务已完成。'
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
            finalMessage
          }
        }

        console.log(`[TaskRuntime] 迭代 ${iterations} 未完成，继续执行...`)

        messages.push({
          role: 'assistant',
          content: turn.assistantMessage || '',
          tool_calls: turn.toolCalls
        })

        turn.toolCalls.forEach((call, index) => {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.function.name,
            content: JSON.stringify(turn.toolResults[index])
          })
        })

        await this.maybeCompact(messages)
      }

      console.log('\n╔══════════════════════════════════════════════════════════════╗')
      console.log('║               ⚠️ TaskRuntime 达到最大轮次                       ║')
      console.log('╚══════════════════════════════════════════════════════════════╝\n')

      this.hooks.onStatusChanged?.('errored')
      return {
        success: false,
        iterations,
        toolCalls: toolCallsCount,
        finalMessage: '任务执行超过最大轮次，已停止。',
        error: `Reached max turns (${this.maxTurns})`
      }
    } catch (error) {
      console.log('\n╔══════════════════════════════════════════════════════════════╗')
      console.log('║               ❌ TaskRuntime 执行出错                          ║')
      console.log(`║ Error: ${(error as Error).message}`)
      console.log('╚══════════════════════════════════════════════════════════════╝\n')

      this.hooks.onStatusChanged?.('errored')
      return {
        success: false,
        iterations,
        toolCalls: toolCallsCount,
        finalMessage: '任务执行失败。',
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
      completed: turn.completed
    }

    this.turnRecords.push(record)
    this.hooks.onTurnCompleted?.(record)
  }

  private async maybeCompact(messages: any[]): Promise<void> {
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
        max_tokens: 512
      })

      this.compactSummary = summaryResponse.content.trim()
      this.hooks.onCompact?.(this.compactSummary)

      const recentMessageCount = this.keepRecentTurns * 2 + 1
      const recentMessages = messages.slice(-recentMessageCount)
      messages.splice(
        0,
        messages.length,
        {
          role: 'system',
          content: this.buildTaskSystemPrompt()
        },
        ...this.buildTaskContextMessages(),
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
    ]
  }

  private buildToolSpecs(tools: Tool[]): any[] {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }))
  }

  private buildTaskSystemPrompt(): string {
    const personality = this.personality.getPersonality()
    return PROMPTS.task.systemPrompt(
      personality.character.name,
      personality.relationship.type
    )
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
}

function escapeXmlText(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
