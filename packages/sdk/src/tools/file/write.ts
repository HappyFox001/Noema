import type { ToolSpec, ToolExecutor, ToolResult } from '../types.js'
import { resolveToolPath, writeTextFile } from '../node-runtime.js'

/**
 * Write 工具规范
 */
export const writeToolSpec: ToolSpec = {
  type: 'function',
  function: {
    name: 'write',
    description: 'Write content to a file, creating it if it doesn\'t exist or overwriting if it does. Use this to create new files or completely replace file contents.',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'The absolute path to the file to write'
        },
        content: {
          type: 'string',
          description: 'The content to write to the file'
        }
      },
      required: ['file_path', 'content']
    }
  }
}

/**
 * Write 工具执行器
 */
export class WriteTool implements ToolExecutor {
  spec = writeToolSpec

  async execute(args: Record<string, any>): Promise<ToolResult> {
    try {
      const { file_path, content } = args

      const absolutePath = resolveToolPath(file_path)
      const bytesWritten = await writeTextFile(absolutePath, content)

      return {
        success: true,
        result: {
          file_path: absolutePath,
          bytes_written: bytesWritten
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
