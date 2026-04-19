import type { ToolSpec, ToolExecutor, ToolResult } from '../types.js'
import { invoke } from '@tauri-apps/api/core'

/**
 * Grep 工具规范
 */
export const grepToolSpec: ToolSpec = {
  type: 'function',
  function: {
    name: 'grep',
    description: 'Search for a pattern in file contents using regex. Powerful content search tool with multiple output modes.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'The regex pattern to search for'
        },
        path: {
          type: 'string',
          description: 'File or directory to search in (defaults to current directory)'
        },
        glob: {
          type: 'string',
          description: 'Glob pattern to filter files (e.g., "*.js", "**/*.ts")'
        },
        case_insensitive: {
          type: 'boolean',
          description: 'Case insensitive search. Default: false',
          default: false
        },
        output_mode: {
          type: 'string',
          description: 'Output mode: "content" (matching lines), "files_with_matches" (file paths only), "count" (match counts)',
          enum: ['content', 'files_with_matches', 'count'],
          default: 'files_with_matches'
        },
        context_lines: {
          type: 'number',
          description: 'Number of context lines to show before and after matches (only for content mode)'
        },
        head_limit: {
          type: 'number',
          description: 'Limit output to first N results'
        }
      },
      required: ['pattern']
    }
  }
}

interface GrepMatch {
  file: string
  line_number?: number
  line?: string
  count?: number
}

/**
 * Grep 工具执行器
 */
export class GrepTool implements ToolExecutor {
  spec = grepToolSpec

  async execute(args: Record<string, any>): Promise<ToolResult> {
    try {
      const {
        pattern,
        path,
        glob,
        case_insensitive = false,
        output_mode = 'files_with_matches',
        context_lines,
        head_limit
      } = args

      const matches = await invoke<GrepMatch[]>('grep_files', {
        pattern,
        path,
        glob,
        caseInsensitive: case_insensitive,
        outputMode: output_mode,
        contextLines: context_lines,
        limit: head_limit
      })

      return {
        success: true,
        result: {
          pattern,
          output_mode,
          matches,
          total: matches.length
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
