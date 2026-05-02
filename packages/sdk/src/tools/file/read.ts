import type { ToolSpec, ToolExecutor, ToolResult } from '../types.js'
import { readTextFile, resolveToolPath } from '../node-runtime.js'


export const readToolSpec: ToolSpec = {
  type: 'function',
  function: {
    name: 'read',
    description: 'Read the contents of a file from the filesystem. Use this to examine existing files.',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'The absolute or relative path to the file to read'
        },
        offset: {
          type: 'number',
          description: 'Optional line number to start reading from (1-indexed). Use this to read large files in chunks.'
        },
        limit: {
          type: 'number',
          description: 'Optional number of lines to read. Use with offset to paginate through large files.'
        }
      },
      required: ['file_path']
    }
  }
}


export class ReadTool implements ToolExecutor {
  spec = readToolSpec

  async execute(args: Record<string, any>): Promise<ToolResult> {
    try {
      const { file_path, offset, limit } = args

      const absolutePath = resolveToolPath(file_path)
      const { content, lines } = await readTextFile(absolutePath, offset, limit)

      return {
        success: true,
        result: {
          file_path: absolutePath,
          content,
          lines
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
