


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


export interface ParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  description?: string
  enum?: string[]
  items?: ParameterSchema
  properties?: Record<string, ParameterSchema>
  required?: string[]
  default?: any
}


export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}


export interface ToolResult {
  success: boolean
  result?: any
  error?: string
}


export interface ToolExecutor {
  
  spec: ToolSpec

  
  execute(args: Record<string, any>): Promise<ToolResult>
}
