/**
 * Base file and shell tool implementations.
 */
import { readFile } from 'node:fs/promises'
import {
  editTextFile,
  readTextFile,
  resolveToolPath,
  runCommand,
  runCommandInBackground,
  writeTextFile,
} from './node-ops.mjs'
import { matchesAnyGlobPattern, matchesGlobPattern, walkFiles } from './search-utils.mjs'

export function createBaseTools() {
  return [
    createReadTool(),
    createWriteTool(),
    createEditTool(),
    createGlobTool(),
    createGrepTool(),
    createBashTool(),
  ]
}

function createReadTool() {
  return createTool({
    name: 'read',
    description: 'Read the contents of a file from the filesystem. Use this to examine existing files.',
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

function createWriteTool() {
  return createTool({
    name: 'write',
    description: 'Write content to a file, creating it if it does not exist or overwriting if it does. Use this to create new files or completely replace file contents.',
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

function createEditTool() {
  return createTool({
    name: 'edit',
    description: 'Perform exact string replacement in a file. The old_string must match exactly (including whitespace and indentation). Use this to modify specific parts of existing files.',
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

function createGlobTool() {
  return createTool({
    name: 'glob',
    description: 'Find files matching a glob pattern (e.g., "**/*.ts", "src/**/*.js"). Fast file pattern matching tool.',
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
      const files = (await walkFiles(searchRoot))
        .filter(file => matchesGlobPattern(file, searchRoot, pattern))
        .filter(file => !matchesAnyGlobPattern(file, searchRoot, ignore))

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

function createGrepTool() {
  return createTool({
    name: 'grep',
    description: 'Search for a pattern in file contents using regex. Powerful content search tool with multiple output modes.',
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
          enum: ['files_with_matches', 'content'],
          description: 'Return matching file paths or matching content lines.',
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

function createBashTool() {
  return createTool({
    name: 'bash',
    description: 'Execute a shell command and return its output. Use for terminal operations like git, npm, docker, etc. DO NOT use for file operations - use dedicated Read/Write/Edit tools instead.',
    safety: 'external',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The command to execute',
        },
        description: {
          type: 'string',
          description: 'Clear, concise description of what this command does (for logging and user feedback)',
        },
        cwd: {
          type: 'string',
          description: 'Working directory to execute the command in (defaults to current directory)',
        },
        timeout: {
          type: 'number',
          description: 'Optional timeout in milliseconds (max 600000ms / 10 minutes). Default: 120000',
          default: 120000,
        },
        run_in_background: {
          type: 'boolean',
          description: 'Set to true to run this command in the background',
          default: false,
        },
      },
      required: ['command'],
    },
    execute: async ({
      command,
      description,
      cwd,
      timeout = 120000,
      run_in_background = false,
    }) => {
      if (run_in_background) {
        const pid = runCommandInBackground(command, cwd)
        return {
          success: true,
          result: {
            background: true,
            pid,
            message: 'Command started in background',
          },
        }
      }

      const output = await runCommand(command, { cwd, timeout })
      return {
        success: output.exitCode === 0,
        result: {
          command,
          description,
          cwd: resolveToolPath(cwd),
          stdout: output.stdout,
          stderr: output.stderr,
          exit_code: output.exitCode,
        },
      }
    },
  })
}

function createTool({ name, description, parameters, safety, execute }) {
  return {
    name,
    description,
    parameters,
    pluginId: 'base-tools',
    safety,
    execute: async (params) => {
      try {
        return await execute(params || {})
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}

async function grepFiles(files, regex, outputMode, contextLines = 0, headLimit) {
  const matches = []

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

function testLine(line, regex) {
  regex.lastIndex = 0
  return regex.test(line)
}

function countLineMatches(line, regex) {
  regex.lastIndex = 0
  const matched = line.match(regex)
  return matched ? matched.length : 0
}
