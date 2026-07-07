import type { ToolCall } from '../tools/types.js'
import type { LLMProvider } from '../llm/index.js'

export interface TurnRunResult {
  turnIndex: number
  assistantMessage: string
  toolCalls: ToolCall[]
  toolResults: any[]
  completed: boolean
  tokenUsage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
}

export interface TurnRuntimeHooks {
  onToolCalling?: (toolCalls: ToolCall[]) => void
  onObserving?: (toolCalls: ToolCall[], toolResults: any[]) => void
}

export type InternalToolHandler = (args: any, call: ToolCall) => Promise<any> | any
export type ExternalToolExecutor = (call: ToolCall) => Promise<any>

export interface TurnRuntimeOptions extends TurnRuntimeHooks {
  signal?: AbortSignal
  internalTools?: Record<string, InternalToolHandler>
  executeExternalTool?: ExternalToolExecutor
}

function verboseLog(message = ''): void {
  if (process.env.NOEMA_VERBOSE_LOGS === '1') {
    process.stdout.write(`${message}\n`)
  }
}

export class TurnRuntime {
  constructor(private llm: LLMProvider) {}

  async run(
    turnIndex: number,
    messages: any[],
    toolSpecs: any[],
    options: TurnRuntimeOptions = {}
  ): Promise<TurnRunResult> {
    verboseLog(`\n========== 🔄 Turn ${turnIndex} 开始 ==========`)
    throwIfAborted(options.signal)

    const response = await this.llm.chat(messages, {
      max_tokens: 2048,
      tools: toolSpecs,
      tool_choice: toolSpecs.length > 0 ? 'auto' : undefined,
      signal: options.signal
    })
    throwIfAborted(options.signal)

    const assistantMessage = response.content || ''
    const toolCalls = (response.toolCalls || []) as ToolCall[]

    verboseLog(`[Turn ${turnIndex}] LLM 响应:`)
    verboseLog(`  📝 Content: ${assistantMessage.substring(0, 100)}${assistantMessage.length > 100 ? '...' : ''}`)
    verboseLog(`  🔧 Tool Calls: ${toolCalls.length > 0 ? toolCalls.map(t => t.function.name).join(', ') : '(无)'}`)

    if (toolCalls.length === 0) {
      verboseLog(`[Turn ${turnIndex}] 无工具调用，结束本次采样但不完成任务步骤`)
      verboseLog(`==========================================\n`)
      return {
        turnIndex,
        assistantMessage,
        toolCalls: [],
        toolResults: [],
        completed: false,
        tokenUsage: response.usage,
      }
    }

    toolCalls.forEach((call, i) => {
      verboseLog(`\n[Turn ${turnIndex}] 🛠️  工具调用 #${i + 1}:`)
      verboseLog(`  Name: ${call.function.name}`)
      verboseLog(`  Args: ${call.function.arguments}`)
    })

    verboseLog(`\n[Turn ${turnIndex}] ⏳ 执行工具...`)
    options.onToolCalling?.(toolCalls)
    const toolResults = await this.executeToolCalls(toolCalls, options)
    throwIfAborted(options.signal)
    options.onObserving?.(toolCalls, toolResults)

    toolResults.forEach((result, i) => {
      const status = result.success ? '✅' : '❌'
      verboseLog(`[Turn ${turnIndex}] ${status} 工具结果 #${i + 1} (${toolCalls[i].function.name}):`)
      verboseLog(`  ${JSON.stringify(result.result || result.error, null, 2).substring(0, 200)}`)
    })

    verboseLog(`[Turn ${turnIndex}] 🔄 需要继续迭代`)
    verboseLog(`==========================================\n`)

    return {
      turnIndex,
      assistantMessage,
      toolCalls,
      toolResults,
      completed: false,
      tokenUsage: response.usage,
    }
  }

  private async executeToolCalls(
    toolCalls: ToolCall[],
    options: TurnRuntimeOptions
  ): Promise<any[]> {
    const internalTools = options.internalTools ?? {}
    const results = []

    for (const call of toolCalls) {
      throwIfAborted(options.signal)
      const handler = internalTools[call.function.name]
      if (!handler) {
        if (!options.executeExternalTool) {
          throw new Error(`External tool executor is required for tool: ${call.function.name}`)
        }
        results.push(await options.executeExternalTool(call))
        continue
      }

      try {
        const args = JSON.parse(call.function.arguments || '{}')
        const result = await handler(args, call)
        results.push({
          success: true,
          callId: call.id,
          name: call.function.name,
          result
        })
      } catch (error) {
        results.push({
          success: false,
          callId: call.id,
          name: call.function.name,
          error: (error as Error).message
        })
      }
    }

    return results
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return
  }
  throw new DOMException('Task turn aborted', 'AbortError')
}
