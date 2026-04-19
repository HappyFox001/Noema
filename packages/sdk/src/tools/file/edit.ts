import type { ToolSpec, ToolExecutor, ToolResult } from '../types.js'
import { invoke } from '@tauri-apps/api/core'

/**
 * Edit 工具规范
 */
export const editToolSpec: ToolSpec = {
  type: 'function',
  function: {
    name: 'edit',
    description: 'Perform exact string replacement in a file. The old_string must match exactly (including whitespace and indentation). Use this to modify specific parts of existing files.',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'The absolute path to the file to modify'
        },
        old_string: {
          type: 'string',
          description: 'The exact text to replace (must be unique in the file unless replace_all is true)'
        },
        new_string: {
          type: 'string',
          description: 'The text to replace it with (must be different from old_string)'
        },
        replace_all: {
          type: 'boolean',
          description: 'Replace all occurrences of old_string. Default: false',
          default: false
        }
      },
      required: ['file_path', 'old_string', 'new_string']
    }
  }
}

/**
 * Edit 工具执行器
 */
export class EditTool implements ToolExecutor {
  spec = editToolSpec

  async execute(args: Record<string, any>): Promise<ToolResult> {
    try {
      const { file_path, old_string, new_string, replace_all = false } = args

      await invoke('edit_file', {
        path: file_path,
        oldString: old_string,
        newString: new_string,
        replaceAll: replace_all
      })

      return {
        success: true,
        result: {
          file_path,
          replaced: true
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
