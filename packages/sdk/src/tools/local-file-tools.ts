/**
 * Built-in local tools for exact file reads and writes.
 */
import type { Tool } from '@her-text/types'
import { editTextFile, readTextFile, resolveToolPath, writeTextFile } from './local-node-ops.js'
import { createTool } from './local-tool-factory.js'

export function createFileTools(): Tool[] {
  return [
    createReadTool(),
    createWriteTool(),
    createEditTool(),
  ]
}

function createReadTool(): Tool {
  return createTool({
    name: 'read',
    description: 'Read file contents. Use after glob/grep identifies a relevant path, before editing existing files, and after failed patches to inspect nearby context.',
    safety: 'read',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'The absolute or relative path to the file to read',
        },
        offset: {
          type: 'number',
          description: 'Optional line number to start reading from (1-indexed). Use this to read large files in chunks.',
        },
        limit: {
          type: 'number',
          description: 'Optional number of lines to read. Use with offset to paginate through large files.',
        },
      },
      required: ['file_path'],
    },
    execute: async ({ file_path, offset, limit }) => {
      const absolutePath = resolveToolPath(file_path)
      const { content, lines } = await readTextFile(absolutePath, offset, limit)
      return {
        success: true,
        result: {
          file_path: absolutePath,
          content,
          lines,
        },
      }
    },
  })
}

function createWriteTool(): Tool {
  return createTool({
    name: 'write',
    description: 'Write a complete file, creating or replacing it. Prefer apply_patch/edit for targeted modifications to existing files.',
    safety: 'write',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'The absolute path to the file to write',
        },
        content: {
          type: 'string',
          description: 'The content to write to the file',
        },
      },
      required: ['file_path', 'content'],
    },
    execute: async ({ file_path, content }) => {
      const absolutePath = resolveToolPath(file_path)
      const bytesWritten = await writeTextFile(absolutePath, content)
      return {
        success: true,
        result: {
          file_path: absolutePath,
          bytes_written: bytesWritten,
        },
      }
    },
  })
}

function createEditTool(): Tool {
  return createTool({
    name: 'edit',
    description: 'Perform exact string replacement in a file. Read the target context first; if matching fails, read nearby lines and retry with a smaller exact replacement.',
    safety: 'write',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'The absolute path to the file to modify',
        },
        old_string: {
          type: 'string',
          description: 'The exact text to replace (must be unique in the file unless replace_all is true)',
        },
        new_string: {
          type: 'string',
          description: 'The text to replace it with (must be different from old_string)',
        },
        replace_all: {
          type: 'boolean',
          description: 'Replace all occurrences of old_string. Default: false',
          default: false,
        },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
    execute: async ({ file_path, old_string, new_string, replace_all = false }) => {
      const absolutePath = resolveToolPath(file_path)
      const replacedCount = await editTextFile(absolutePath, old_string, new_string, replace_all)
      return {
        success: true,
        result: {
          file_path: absolutePath,
          replaced: true,
          replaced_count: replacedCount,
        },
      }
    },
  })
}
