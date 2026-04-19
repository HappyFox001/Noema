import type { ToolSpec, ToolExecutor, ToolResult } from '../types.js'
import { invoke } from '@tauri-apps/api/core'

/**
 * Glob 工具规范
 */
export const globToolSpec: ToolSpec = {
  type: 'function',
  function: {
    name: 'glob',
    description: 'Find files matching a glob pattern (e.g., "**/*.ts", "src/**/*.js"). Fast file pattern matching tool.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'The glob pattern to match files against (e.g., "**/*.ts" for all TypeScript files)'
        },
        path: {
          type: 'string',
          description: 'The directory to search in (defaults to current working directory)'
        },
        ignore: {
          type: 'array',
          description: 'Patterns to ignore (e.g., ["node_modules/**", ".git/**"])',
          items: {
            type: 'string',
            description: 'Pattern to ignore'
          }
        }
      },
      required: ['pattern']
    }
  }
}

/**
 * Glob 工具执行器
 */
export class GlobTool implements ToolExecutor {
  spec = globToolSpec

  async execute(args: Record<string, any>): Promise<ToolResult> {
    try {
      const { pattern, path, ignore = [] } = args

      const files = await invoke<string[]>('glob_files', {
        pattern,
        path,
        ignore
      })

      return {
        success: true,
        result: {
          pattern,
          matches: files,
          count: files.length
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
