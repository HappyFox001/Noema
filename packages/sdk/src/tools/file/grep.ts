import type { ToolSpec, ToolExecutor, ToolResult } from '../types.js'
import { readFile } from 'node:fs/promises'
import { resolveToolPath } from '../node-runtime.js'
import { matchesGlobPattern, walkFiles } from './search-utils.js'

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
      const searchRoot = resolveToolPath(path)
      const regex = new RegExp(pattern, case_insensitive ? 'gi' : 'g')
      const files = (await walkFiles(searchRoot))
        .filter(file => matchesGlobPattern(file, searchRoot, glob))
      const matches = await grepFiles(files, regex, output_mode, context_lines, head_limit)

      return {
        success: true,
        result: {
          pattern,
          path: searchRoot,
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

async function grepFiles(
  files: string[],
  regex: RegExp,
  outputMode: string,
  contextLines = 0,
  headLimit?: number
): Promise<GrepMatch[]> {
  const matches: GrepMatch[] = []

  for (const file of files) {
    if (typeof headLimit === 'number' && headLimit > 0 && matches.length >= headLimit) {
      break
    }

    const content = await readFile(file, 'utf8')
    const lines = content.split('\n')

    if (outputMode === 'files_with_matches') {
      if (lines.some(line => testLine(line, regex))) {
        matches.push({ file })
      }
      continue
    }

    if (outputMode === 'count') {
      const count = lines.reduce((total, line) => total + countLineMatches(line, regex), 0)
      if (count > 0) {
        matches.push({ file, count })
      }
      continue
    }

    for (let index = 0; index < lines.length; index++) {
      if (!testLine(lines[index], regex)) {
        continue
      }

      const start = Math.max(0, index - contextLines)
      const end = Math.min(lines.length, index + contextLines + 1)
      for (let contextIndex = start; contextIndex < end; contextIndex++) {
        matches.push({
          file,
          line_number: contextIndex + 1,
          line: lines[contextIndex]
        })

        if (typeof headLimit === 'number' && headLimit > 0 && matches.length >= headLimit) {
          return matches
        }
      }
    }
  }

  return matches
}

function testLine(line: string, regex: RegExp): boolean {
  regex.lastIndex = 0
  return regex.test(line)
}

function countLineMatches(line: string, regex: RegExp): number {
  regex.lastIndex = 0
  const matched = line.match(regex)
  return matched ? matched.length : 0
}
