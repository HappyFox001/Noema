/**
 * Built-in local tools for file discovery and content search.
 */
import { readFile } from 'node:fs/promises'
import type { Tool } from './types.js'
import { resolveToolPath } from './local-node-ops.js'
import { matchesAnyGlobPattern, matchesGlobPattern, walkFiles } from './local-search-utils.js'
import { createTool } from './local-tool-factory.js'

export function createSearchTools(): Tool[] {
  return [
    createGlobTool(),
    createGrepTool(),
  ]
}

function createGlobTool(): Tool {
  return createTool({
    name: 'glob',
    description: 'Find files by path pattern. Use before read when locating files by name, extension, or directory.',
    safety: 'read',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'The glob pattern to match files against (e.g., "**/*.ts")',
        },
        path: {
          type: 'string',
          description: 'Directory to search in. Defaults to the current working directory.',
        },
        ignore: {
          type: 'array',
          items: { type: 'string' },
          description: 'Glob patterns to exclude from results.',
        },
      },
      required: ['pattern'],
    },
    execute: async ({ pattern, path, ignore = [] }) => {
      const searchRoot = resolveToolPath(path)
      const ignorePatterns = Array.isArray(ignore) ? ignore : []
      const files = (await walkFiles(searchRoot))
        .filter(file => matchesGlobPattern(file, searchRoot, pattern))
        .filter(file => !matchesAnyGlobPattern(file, searchRoot, ignorePatterns))

      return {
        success: true,
        result: {
          pattern,
          path: searchRoot,
          matches: files,
          count: files.length,
        },
      }
    },
  })
}

function createGrepTool(): Tool {
  return createTool({
    name: 'grep',
    description: 'Search file contents with regex. Prefer this before read when locating symbols, strings, TODOs, settings, or code paths.',
    safety: 'read',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'The regex pattern to search for',
        },
        path: {
          type: 'string',
          description: 'File or directory to search in (defaults to current directory)',
        },
        glob: {
          type: 'string',
          description: 'Glob pattern to filter files (e.g., "*.js", "**/*.ts")',
        },
        case_insensitive: {
          type: 'boolean',
          description: 'Whether to ignore case when matching.',
        },
        output_mode: {
          type: 'string',
          enum: ['files_with_matches', 'content', 'count'],
          description: 'Return matching file paths, matching content lines, or match counts.',
        },
        context_lines: {
          type: 'number',
          description: 'Number of surrounding lines to include for content output.',
        },
        head_limit: {
          type: 'number',
          description: 'Maximum number of matches to return.',
        },
      },
      required: ['pattern'],
    },
    execute: async ({
      pattern,
      path,
      glob,
      case_insensitive = false,
      output_mode = 'files_with_matches',
      context_lines,
      head_limit,
    }) => {
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
          total: matches.length,
        },
      }
    },
  })
}

async function grepFiles(
  files: string[],
  regex: RegExp,
  outputMode: 'files_with_matches' | 'content' | 'count',
  contextLines = 0,
  headLimit?: number
): Promise<Array<Record<string, any>>> {
  const matches: Array<Record<string, any>> = []

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
          line: lines[contextIndex],
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
