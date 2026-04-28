import type { Tool, ToolCall } from '@her-text/types'

export interface ToolExecutionHooks {
  preToolUse?: (call: ToolCall) => Promise<void> | void
  postToolUse?: (call: ToolCall, result: any) => Promise<void> | void
  onError?: (call: ToolCall, error: Error) => Promise<void> | void
}

export interface ToolExecutionOptions {
  parallel?: boolean
  hooks?: ToolExecutionHooks
  timeout?: number
}

/**
 * AgentCore - 工具注册和执行
 * 参考 codex /core/src/tools/registry.rs
 */
export class AgentCore {
  private tools: Map<string, Tool> = new Map()

  registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool)
  }

  unregisterTool(name: string): boolean {
    return this.tools.delete(name)
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  getTools(): Tool[] {
    return Array.from(this.tools.values())
  }

  /**
   * 顺序执行工具调用
   */
  async execute(
    toolCalls: ToolCall[],
    options?: ToolExecutionOptions
  ): Promise<any[]> {
    const results = []
    const hooks = options?.hooks

    for (const call of toolCalls) {
      try {
        // 前置钩子
        await hooks?.preToolUse?.(call)

        const toolName = call.function.name
        const tool = this.tools.get(toolName)
        if (!tool) {
          throw new Error(`Tool not found: ${toolName}`)
        }

        // 解析参数
        const args = JSON.parse(call.function.arguments)

        // 执行工具（带超时）
        const result = options?.timeout
          ? await this.executeWithTimeout(tool, call, options.timeout)
          : await tool.execute(args)

        // 后置钩子
        await hooks?.postToolUse?.(call, result)

        results.push({
          success: true,
          callId: call.id,
          name: call.function.name,
          result
        })
      } catch (error) {
        // 错误钩子
        await hooks?.onError?.(call, error as Error)

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

  private async executeWithTimeout(
    tool: Tool,
    call: ToolCall,
    timeout: number
  ): Promise<any> {
    const args = JSON.parse(call.function.arguments)
    return Promise.race([
      tool.execute(args),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Tool execution timeout')), timeout)
      )
    ])
  }
}
