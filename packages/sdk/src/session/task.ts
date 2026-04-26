import type { Tool } from '@her-text/types'
import type { LLMProvider } from '@her-text/core'
import type { AgentCore } from '../agent/index.js'
import type { ContextManager } from '../context/index.js'
import type { UserProfile, ConversationSummary } from '../memory/index.js'
import type { PersonalityEngine } from '../personality/index.js'
import { TurnRuntime } from './turn.js'

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
          content: [
            '请把下面这些任务执行轮次压缩成可继续执行的工作摘要。',
            '保留已经完成的步骤、失败点、关键文件/命令、仍未完成事项。',
            '输出纯文本，不要 XML。'
          ].join('\n')
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
        {
          role: 'user',
          content: [
            `用户原始请求：${this.originalUserInput}`,
            `当前要执行的任务：${this.taskDescription}`,
            this.formatMemoryContext(),
            `已压缩的任务进展摘要：\n${this.compactSummary}`,
            '基于这些信息继续完成任务。'
          ].filter(Boolean).join('\n\n')
        },
        ...recentMessages
      )

      this.turnRecords = this.turnRecords.slice(compactBoundary)
    } catch (error) {
      // Compact 是优化操作，失败不应影响任务执行
      // 跳过压缩，继续使用完整历史
      console.warn(`[TaskRuntime] Compact failed, continuing with full history: ${(error as Error).message}`)
    }
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
      {
        role: 'user',
        content: [
          `用户原始请求：${this.originalUserInput}`,
          `当前要执行的任务：${this.taskDescription}`,
          historyText ? `最近对话上下文：\n${historyText}` : '',
          this.formatMemoryContext(),
          '直接执行任务。能用工具就用工具，不要空谈。'
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

    return `你现在处于任务执行模式。

当前角色信息：
- 名称：${personality.character.name}
- 关系定位：${personality.relationship.type}

目标：
- 持续执行，直到任务真正完成
- 优先使用工具获取事实、修改内容、验证结果
- 每轮根据工具结果继续下一轮，不要过早停止

规则：
- 不要扮演陪伴角色，不要抒情
- 不要描述“你将要做什么”，直接做
- 如果需要多步操作，分多轮持续完成
- 只有在任务已经完成，或者确实无法继续时，才给出最终答复
- 最终答复必须简洁明确，说明完成了什么、还有什么未完成
- 当你看到任务进展摘要时，要把它当作之前轮次的真实执行结果继续推进
`
  }

  private formatMemoryContext(): string {
    const sections: string[] = []

    const basicProfile = Object.entries(this.memoryContext.userProfile.basic)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)

    if (basicProfile.length > 0) {
      sections.push(`用户画像：\n${basicProfile.join('\n')}`)
    }

    if (this.memoryContext.summaries.length > 0) {
      sections.push(
        `历史摘要：\n${this.memoryContext.summaries
          .map(summary => `- ${summary.summary}`)
          .join('\n')}`
      )
    }

    return sections.join('\n\n')
  }
}
