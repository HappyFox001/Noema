import type { Tool, ToolCall } from '@her-text/types'
import type { LLMProvider, StreamChunk } from '@her-text/core'
import type { AgentCore } from './index.js'

/**
 * Agent Loop 配置
 */
export interface AgentLoopConfig {
  maxIterations: number      // 最大循环次数，防止无限循环
  timeout: number            // 单次工具执行超时 (ms)
  parallelToolCalls: boolean // 是否并行执行工具
}

/**
 * Agent Loop 执行结果
 */
export interface AgentLoopResult {
  success: boolean
  iterations: number
  toolCallsCount: number
  finalResult: string        // 最终执行结果摘要
  error?: string
}

/**
 * 累积的工具调用
 */
interface AccumulatedToolCall {
  id: string
  function: {
    name: string
    arguments: string
  }
}

const DEFAULT_CONFIG: AgentLoopConfig = {
  maxIterations: 10,
  timeout: 30000,
  parallelToolCalls: false
}

/**
 * Agent Loop - Codex 风格的工具执行循环
 *
 * 特点：
 * - 纯工具执行，无情感干扰
 * - 循环直到任务完成 (needs_follow_up = false)
 * - 支持多轮工具调用
 */
export class AgentLoop {
  private config: AgentLoopConfig

  constructor(
    private llm: LLMProvider,
    private agent: AgentCore,
    private tools: Tool[],
    config: Partial<AgentLoopConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 执行 Agent Loop
   * @param taskDescription 任务描述
   * @param onProgress 进度回调（可选）
   */
  async execute(
    taskDescription: string,
    onProgress?: (message: string) => void
  ): Promise<AgentLoopResult> {
    const result: AgentLoopResult = {
      success: false,
      iterations: 0,
      toolCallsCount: 0,
      finalResult: ''
    }

    // 构建执行层 system prompt（纯工具执行，无情感）
    const systemPrompt = this.buildExecutorSystemPrompt()

    // 对话历史
    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `请完成以下任务：${taskDescription}` }
    ]

    // 构建工具规范
    const toolSpecs = this.tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }))

    try {
      // 主循环
      while (result.iterations < this.config.maxIterations) {
        result.iterations++
        onProgress?.(`[Agent Loop] 迭代 ${result.iterations}`)

        // 调用 LLM
        const { content, toolCalls } = await this.runSamplingRequest(
          messages,
          toolSpecs
        )

        console.log(`\n[Agent Loop] 迭代 ${result.iterations}:`)
        console.log('  Content:', content || '(无)')
        console.log('  Tool Calls:', toolCalls.length > 0 ? toolCalls.map(t => t.function.name).join(', ') : '(无)')

        // 判断是否需要继续 (needs_follow_up)
        const needsFollowUp = toolCalls.length > 0

        if (!needsFollowUp) {
          // 无工具调用，任务完成
          result.success = true
          result.finalResult = content || '任务已完成'
          break
        }

        // 执行工具
        result.toolCallsCount += toolCalls.length
        onProgress?.(`[Agent Loop] 执行 ${toolCalls.length} 个工具调用`)

        const toolResults = await this.executeTools(toolCalls)

        // 记录助手消息和工具调用
        messages.push({
          role: 'assistant',
          content: content || `正在执行工具: ${toolCalls.map(t => t.function.name).join(', ')}`
        })

        // 构建工具结果消息（Gemini 兼容格式）
        const toolResultsSummary = toolCalls.map((call, index) => {
          const r = toolResults[index]
          return `[${call.function.name}] ${r.success ? '成功' : '失败'}: ${JSON.stringify(r.result || r.error)}`
        }).join('\n')

        messages.push({
          role: 'user',
          content: `工具执行结果:\n${toolResultsSummary}\n\n请继续完成任务，或者如果任务已完成，直接回复完成状态。`
        })
      }

      // 检查是否达到最大迭代次数
      if (result.iterations >= this.config.maxIterations && !result.success) {
        result.error = `达到最大迭代次数 (${this.config.maxIterations})`
        result.finalResult = '任务执行超过最大迭代次数，已终止'
      }

    } catch (error) {
      result.error = (error as Error).message
      result.finalResult = `执行出错: ${result.error}`
    }

    console.log('\n[Agent Loop] 完成:', result)
    return result
  }

  /**
   * 执行单次采样请求
   */
  private async runSamplingRequest(
    messages: any[],
    toolSpecs: any[]
  ): Promise<{ content: string; toolCalls: ToolCall[] }> {
    let content = ''
    const accumulatedToolCalls: Map<number, AccumulatedToolCall> = new Map()

    const llmOptions: any = {
      max_tokens: 2048,
      tools: toolSpecs,
      tool_choice: 'auto'
    }

    // 流式调用
    for await (const chunk of this.llm.streamChatWithTools(messages, llmOptions)) {
      if (chunk.type === 'content' && chunk.content) {
        content += chunk.content
      } else if (chunk.type === 'tool_call' && chunk.toolCall) {
        const tc = chunk.toolCall
        if (!accumulatedToolCalls.has(tc.index)) {
          accumulatedToolCalls.set(tc.index, {
            id: tc.id || `call_${tc.index}`,
            function: {
              name: tc.function.name || '',
              arguments: tc.function.arguments || ''
            }
          })
        } else {
          const existing = accumulatedToolCalls.get(tc.index)!
          if (tc.id) existing.id = tc.id
          if (tc.function.name) existing.function.name = tc.function.name
          if (tc.function.arguments) existing.function.arguments += tc.function.arguments
        }
      }
    }

    // 转换为 ToolCall 格式
    const toolCalls: ToolCall[] = Array.from(accumulatedToolCalls.values()).map(tc => ({
      id: tc.id,
      type: 'function' as const,
      function: tc.function
    }))

    return { content, toolCalls }
  }

  /**
   * 执行工具调用
   */
  private async executeTools(toolCalls: ToolCall[]): Promise<any[]> {
    if (this.config.parallelToolCalls) {
      return this.agent.executeParallel(toolCalls, {
        timeout: this.config.timeout
      })
    } else {
      return this.agent.execute(toolCalls, {
        timeout: this.config.timeout
      })
    }
  }

  /**
   * 构建执行层 system prompt（纯工具执行）
   */
  private buildExecutorSystemPrompt(): string {
    return `你是一个任务执行助手。你的职责是使用提供的工具来完成用户的任务。

规则：
1. 专注于完成任务，不需要情感交流
2. 每次只做必要的工具调用
3. 如果任务完成，直接说明结果
4. 如果遇到错误，尝试修复或报告问题
5. 不要解释你要做什么，直接执行

可用工具会通过 function calling 机制提供给你。`
  }
}
