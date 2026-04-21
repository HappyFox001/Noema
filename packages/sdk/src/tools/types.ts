/**
 * 工具系统类型定义
 * 符合 OpenAI/Anthropic Responses API Function Calling 格式
 */

/**
 * 工具规范 - 发送给 LLM 的工具定义
 * 参考: https://platform.openai.com/docs/guides/function-calling
 */
export interface ToolSpec {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, ParameterSchema>
      required?: string[]
      additionalProperties?: boolean
    }
  }
}

/**
 * 参数 Schema（JSON Schema 子集）
 */
export interface ParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  description?: string
  enum?: string[]
  items?: ParameterSchema
  properties?: Record<string, ParameterSchema>
  required?: string[]
  default?: any
}

/**
 * 工具调用请求（从 LLM 返回）
 */
export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string // JSON 字符串
  }
}

/**
 * 工具执行结果
 */
export interface ToolResult {
  success: boolean
  result?: any
  error?: string
}

/**
 * 工具执行器接口
 */
export interface ToolExecutor {
  /**
   * 工具规范（给 LLM 看）
   */
  spec: ToolSpec

  /**
   * 执行工具（直接调用 Node.js 运行时）
   */
  execute(args: Record<string, any>): Promise<ToolResult>
}
