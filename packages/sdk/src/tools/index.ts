import type { Tool } from '@her-text/types'

/**
 * Her-Text 工具系统
 *
 * 架构：
 * - TypeScript: 工具规范（ToolSpec）+ Node 执行层
 * - Node.js: 直接执行文件系统和 Shell 操作
 * - LLM: 自动选择和调用工具
 */

// 类型定义
export * from './types.js'

// 文件操作工具
export { ReadTool, readToolSpec } from './file/read.js'
export { WriteTool, writeToolSpec } from './file/write.js'
export { EditTool, editToolSpec } from './file/edit.js'
export { GlobTool, globToolSpec } from './file/glob.js'
export { GrepTool, grepToolSpec } from './file/grep.js'

// Shell 工具
export { BashTool, bashToolSpec } from './shell/bash.js'

// 导入工具类
import { ReadTool } from './file/read.js'
import { WriteTool } from './file/write.js'
import { EditTool } from './file/edit.js'
import { GlobTool } from './file/glob.js'
import { GrepTool } from './file/grep.js'
import { BashTool } from './shell/bash.js'

/**
 * 创建默认工具列表（给 AgentCore 注册）
 */
export function createDefaultTools(): Tool[] {
  const executors = [
    new ReadTool(),
    new WriteTool(),
    new EditTool(),
    new GlobTool(),
    new GrepTool(),
    new BashTool()
  ]

  return executors.map(executor => ({
    name: executor.spec.function.name,
    description: executor.spec.function.description,
    parameters: executor.spec.function.parameters,
    execute: async (params: any) => executor.execute(params)
  }))
}
