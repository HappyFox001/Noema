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
  private globalHooks?: ToolExecutionHooks

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

  setGlobalHooks(hooks: ToolExecutionHooks): void {
    this.globalHooks = hooks
  }

  /**
   * 顺序执行工具调用
   */
  async execute(
    toolCalls: ToolCall[],
    options?: ToolExecutionOptions
  ): Promise<any[]> {
    const results = []
    const hooks = options?.hooks || this.globalHooks

    for (const call of toolCalls) {
      try {
        // 前置钩子
        await hooks?.preToolUse?.(call)

        const tool = this.tools.get(call.name)
        if (!tool) {
          throw new Error(`Tool not found: ${call.name}`)
        }

        // 执行工具（带超时）
        const result = options?.timeout
          ? await this.executeWithTimeout(tool, call, options.timeout)
          : await tool.execute(call.arguments)

        // 后置钩子
        await hooks?.postToolUse?.(call, result)

        results.push({
          success: true,
          callId: call.id,
          name: call.name,
          result
        })
      } catch (error) {
        // 错误钩子
        await hooks?.onError?.(call, error as Error)

        results.push({
          success: false,
          callId: call.id,
          name: call.name,
          error: (error as Error).message
        })
      }
    }

    return results
  }

  /**
   * 并行执行工具调用
   */
  async executeParallel(
    toolCalls: ToolCall[],
    options?: ToolExecutionOptions
  ): Promise<any[]> {
    const hooks = options?.hooks || this.globalHooks

    const promises = toolCalls.map(async (call) => {
      try {
        await hooks?.preToolUse?.(call)

        const tool = this.tools.get(call.name)
        if (!tool) {
          throw new Error(`Tool not found: ${call.name}`)
        }

        const result = options?.timeout
          ? await this.executeWithTimeout(tool, call, options.timeout)
          : await tool.execute(call.arguments)

        await hooks?.postToolUse?.(call, result)

        return {
          success: true,
          callId: call.id,
          name: call.name,
          result
        }
      } catch (error) {
        await hooks?.onError?.(call, error as Error)

        return {
          success: false,
          callId: call.id,
          name: call.name,
          error: (error as Error).message
        }
      }
    })

    return Promise.all(promises)
  }

  private async executeWithTimeout(
    tool: Tool,
    call: ToolCall,
    timeout: number
  ): Promise<any> {
    return Promise.race([
      tool.execute(call.arguments),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Tool execution timeout')), timeout)
      )
    ])
  }

  /**
   * 检查工具是否可变更状态
   */
  isMutating(toolName: string): boolean {
    const tool = this.tools.get(toolName)
    // TODO: 实现工具元数据系统
    return false
  }
}

export * from './lifecycle'
