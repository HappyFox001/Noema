import type { ToolSpec, ToolExecutor, ToolResult } from '../types.js'
import { resolveToolPath } from '../node-runtime.js'
import { matchesAnyGlobPattern, matchesGlobPattern, walkFiles } from './search-utils.js'


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
          description: 'The glob pattern to match files against (e.g., "**/*.ts")'
        },
        path: {
          type: 'string',
          description: 'Directory to search in. Defaults to the current working directory.'
        },
        ignore: {
          type: 'array',
          items: { type: 'string' },
          description: 'Glob patterns to exclude from results.'
        }
      },
      required: ['pattern']
    }
  }
}

export class GlobTool implements ToolExecutor {
  spec = globToolSpec

  async execute(args: Record<string, any>): Promise<ToolResult> {
    try {
      const { pattern, path, ignore = [] } = args
      const searchRoot = resolveToolPath(path)
      const files = (await walkFiles(searchRoot))
        .filter(file => matchesGlobPattern(file, searchRoot, pattern))
        .filter(file => !matchesAnyGlobPattern(file, searchRoot, ignore))

      return {
        success: true,
        result: {
          pattern,
          path: searchRoot,
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
