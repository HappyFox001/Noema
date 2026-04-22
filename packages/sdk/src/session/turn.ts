import type { ToolCall } from '@her-text/types'
import type { LLMProvider } from '@her-text/core'
import type { AgentCore } from '../agent/index.js'

export interface TurnRunResult {
  turnIndex: number
  assistantMessage: string
  toolCalls: ToolCall[]
  toolResults: any[]
  completed: boolean
}

export class TurnRuntime {
  constructor(
    private llm: LLMProvider,
    private agent: AgentCore
  ) {}

  async run(turnIndex: number, messages: any[], toolSpecs: any[]): Promise<TurnRunResult> {
    console.log(`\n========== 🔄 Turn ${turnIndex} 开始 ==========`)

    const response = await this.llm.chat(messages, {
      max_tokens: 2048,
      tools: toolSpecs,
      tool_choice: toolSpecs.length > 0 ? 'auto' : undefined
    })

    const assistantMessage = response.content || ''
    const toolCalls = (response.toolCalls || []) as ToolCall[]

    console.log(`[Turn ${turnIndex}] LLM 响应:`)
    console.log(`  📝 Content: ${assistantMessage.substring(0, 100)}${assistantMessage.length > 100 ? '...' : ''}`)
    console.log(`  🔧 Tool Calls: ${toolCalls.length > 0 ? toolCalls.map(t => t.function.name).join(', ') : '(无)'}`)

    if (toolCalls.length === 0) {
      console.log(`[Turn ${turnIndex}] ✅ 无工具调用，任务完成`)
      console.log(`==========================================\n`)
      return {
        turnIndex,
        assistantMessage,
        toolCalls: [],
        toolResults: [],
        completed: true
      }
    }

    // 打印工具调用详情
    toolCalls.forEach((call, i) => {
      console.log(`\n[Turn ${turnIndex}] 🛠️  工具调用 #${i + 1}:`)
      console.log(`  Name: ${call.function.name}`)
      console.log(`  Args: ${call.function.arguments}`)
    })

    console.log(`\n[Turn ${turnIndex}] ⏳ 执行工具...`)
    const toolResults = await this.agent.execute(toolCalls, {
      timeout: 30000
    })

    // 打印工具执行结果
    toolResults.forEach((result, i) => {
      const status = result.success ? '✅' : '❌'
      console.log(`[Turn ${turnIndex}] ${status} 工具结果 #${i + 1} (${toolCalls[i].function.name}):`)
      console.log(`  ${JSON.stringify(result.result || result.error, null, 2).substring(0, 200)}`)
    })

    console.log(`[Turn ${turnIndex}] 🔄 需要继续迭代`)
    console.log(`==========================================\n`)

    return {
      turnIndex,
      assistantMessage,
      toolCalls,
      toolResults,
      completed: false
    }
  }
}
