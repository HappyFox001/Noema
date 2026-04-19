import type { ToolSpec, ToolExecutor, ToolCall, ToolResult } from './types.js'

/**
 * 工具注册表
 * 管理所有工具的规范和执行
 */
export class ToolRegistry {
  private executors: Map<string, ToolExecutor> = new Map()

  /**
   * 注册工具
   */
  register(executor: ToolExecutor): void {
    const name = executor.spec.function.name
    if (this.executors.has(name)) {
      throw new Error(`Tool already registered: ${name}`)
    }
    this.executors.set(name, executor)
  }

  /**
   * 批量注册工具
   */
  registerAll(executors: ToolExecutor[]): void {
    for (const executor of executors) {
      this.register(executor)
    }
  }

  /**
   * 获取所有工具规范（发送给 LLM）
   */
  getAllSpecs(): ToolSpec[] {
    return Array.from(this.executors.values()).map(e => e.spec)
  }

  /**
   * 获取工具名称列表
   */
  getToolNames(): string[] {
    return Array.from(this.executors.keys())
  }

  /**
   * 检查工具是否存在
   */
  hasTool(name: string): boolean {
    return this.executors.has(name)
  }

  /**
   * 执行单个工具调用
   */
  async executeToolCall(call: ToolCall): Promise<ToolResult> {
    const toolName = call.function.name
    const executor = this.executors.get(toolName)

    if (!executor) {
      return {
        success: false,
        error: `Tool not found: ${toolName}`
      }
    }

    try {
      // 解析参数（从 JSON 字符串）
      const args = JSON.parse(call.function.arguments)

      // 执行工具
      return await executor.execute(args)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * 批量执行工具调用（顺序）
   */
  async executeToolCallsSequential(calls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = []
    for (const call of calls) {
      const result = await this.executeToolCall(call)
      results.push(result)
    }
    return results
  }

  /**
   * 批量执行工具调用（并行）
   */
  async executeToolCallsParallel(calls: ToolCall[]): Promise<ToolResult[]> {
    return Promise.all(calls.map(call => this.executeToolCall(call)))
  }

  /**
   * 格式化工具结果为 LLM 消息
   */
  formatToolResult(call: ToolCall, result: ToolResult): string {
    if (result.success) {
      return typeof result.result === 'string'
        ? result.result
        : JSON.stringify(result.result, null, 2)
    } else {
      return `Error: ${result.error}`
    }
  }
}
