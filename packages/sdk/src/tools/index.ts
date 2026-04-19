/**
 * Her-Text 工具系统
 *
 * 架构：
 * - TypeScript: 工具规范（ToolSpec）+ 薄执行层（调用 Tauri）
 * - Rust: 实际工具逻辑实现
 * - LLM: 自动选择和调用工具
 */

// 类型定义
export * from './types.js'

// 工具注册表
export * from './registry.js'

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
import { ToolRegistry } from './registry.js'
import type { ToolSpec } from './types.js'

/**
 * 创建包含所有内置工具的注册表
 */
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry()

  // 注册所有内置工具
  registry.registerAll([
    new ReadTool(),
    new WriteTool(),
    new EditTool(),
    new GlobTool(),
    new GrepTool(),
    new BashTool()
  ])

  return registry
}

/**
 * 获取所有内置工具规范（给 LLM 用）
 */
export function getAllToolSpecs(): ToolSpec[] {
  const registry = createDefaultToolRegistry()
  return registry.getAllSpecs()
}

/**
 * 工具类别
 */
export const TOOL_CATEGORIES = {
  FILE: ['read', 'write', 'edit', 'glob', 'grep'],
  SHELL: ['bash'],
  ALL: ['read', 'write', 'edit', 'glob', 'grep', 'bash']
} as const
