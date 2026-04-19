import type { ToolSpec, ToolExecutor, ToolResult } from '../types.js'
import { invoke } from '@tauri-apps/api/core'

/**
 * Bash 工具规范
 */
export const bashToolSpec: ToolSpec = {
  type: 'function',
  function: {
    name: 'bash',
    description: 'Execute a shell command and return its output. Use for terminal operations like git, npm, docker, etc. DO NOT use for file operations - use dedicated Read/Write/Edit tools instead.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The command to execute'
        },
        description: {
          type: 'string',
          description: 'Clear, concise description of what this command does (for logging and user feedback)'
        },
        cwd: {
          type: 'string',
          description: 'Working directory to execute the command in (defaults to current directory)'
        },
        timeout: {
          type: 'number',
          description: 'Optional timeout in milliseconds (max 600000ms / 10 minutes). Default: 120000',
          default: 120000
        },
        run_in_background: {
          type: 'boolean',
          description: 'Set to true to run this command in the background',
          default: false
        }
      },
      required: ['command']
    }
  }
}

interface CommandOutput {
  stdout: string
  stderr: string
  exit_code: number
}

/**
 * Bash 工具执行器
 */
export class BashTool implements ToolExecutor {
  spec = bashToolSpec

  async execute(args: Record<string, any>): Promise<ToolResult> {
    try {
      const {
        command,
        description,
        cwd,
        timeout = 120000,
        run_in_background = false
      } = args

      if (run_in_background) {
        // 后台执行
        const taskId = await invoke<string>('run_command_background', {
          command,
          cwd
        })

        return {
          success: true,
          result: {
            background: true,
            task_id: taskId,
            message: 'Command started in background'
          }
        }
      }

      // 前台执行
      const output = await invoke<CommandOutput>('run_command', {
        command,
        cwd,
        timeout
      })

      return {
        success: output.exit_code === 0,
        result: {
          command,
          description,
          stdout: output.stdout,
          stderr: output.stderr,
          exit_code: output.exit_code
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
