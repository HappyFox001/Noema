/**
 * Base file and shell tool implementations.
 */
import { readFile } from 'node:fs/promises'
import {
  deleteFile,
  editTextFile,
  readImageFile,
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
    createExecCommandTool(),
    createApplyPatchTool(),
    createViewImageTool(),
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

function createExecCommandTool() {
  return createTool({
    name: 'exec_command',
    description: 'Run a shell command with Codex-style arguments. Prefer this for terminal operations when you need cwd, timeout, output truncation, or background execution.',
    safety: 'external',
    parameters: {
      type: 'object',
      properties: {
        cmd: {
          type: 'string',
          description: 'Shell command to execute.',
        },
        workdir: {
          type: 'string',
          description: 'Working directory. Defaults to the current process working directory.',
        },
        timeout_ms: {
          type: 'number',
          description: 'Timeout in milliseconds. Defaults to 120000.',
          default: 120000,
        },
        max_output_chars: {
          type: 'number',
          description: 'Maximum stdout/stderr characters to return. Defaults to 12000.',
          default: 12000,
        },
        background: {
          type: 'boolean',
          description: 'Run command in background and return immediately.',
          default: false,
        },
      },
      required: ['cmd'],
    },
    execute: async ({
      cmd,
      workdir,
      timeout_ms = 120000,
      max_output_chars = 12000,
      background = false,
    }) => {
      if (background) {
        const pid = runCommandInBackground(cmd, workdir)
        return {
          success: true,
          result: {
            command: cmd,
            cwd: resolveToolPath(workdir),
            background: true,
            pid,
          },
        }
      }

      const output = await runCommand(cmd, { cwd: workdir, timeout: timeout_ms })
      return {
        success: output.exitCode === 0,
        result: {
          command: cmd,
          cwd: resolveToolPath(workdir),
          stdout: truncateText(output.stdout, max_output_chars),
          stderr: truncateText(output.stderr, max_output_chars),
          stdout_truncated: output.stdout.length > max_output_chars,
          stderr_truncated: output.stderr.length > max_output_chars,
          exit_code: output.exitCode,
        },
      }
    },
  })
}

function createApplyPatchTool() {
  return createTool({
    name: 'apply_patch',
    description: 'Apply a Codex-style patch to local files. The patch must use *** Begin Patch / *** End Patch with Add File, Delete File, or Update File sections.',
    safety: 'write',
    parameters: {
      type: 'object',
      properties: {
        patch: {
          type: 'string',
          description: 'The complete patch text.',
        },
      },
      required: ['patch'],
    },
    execute: async ({ patch }) => applyPatch(String(patch || '')),
  })
}

function createViewImageTool() {
  return createTool({
    name: 'view_image',
    description: 'Attach a local image file to the next model turn for visual inspection. Use this for screenshots, UI captures, diagrams, and image assets.',
    safety: 'read',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Local image file path.',
        },
        detail: {
          type: 'string',
          enum: ['auto', 'original'],
          description: 'Optional detail preference. original requests full-resolution interpretation when supported.',
        },
      },
      required: ['path'],
    },
    execute: async ({ path, detail = 'auto' }) => {
      const image = await readImageFile(path)
      return {
        success: true,
        result: {
          type: 'image',
          path: image.path,
          mime_type: image.mimeType,
          image_base64: image.base64,
          width: image.width,
          height: image.height,
          bytes: image.bytes,
          note: detail === 'original' ? 'Original-detail local image attachment.' : 'Local image attachment.',
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

async function applyPatch(patch) {
  const sections = parsePatch(patch)
  const changes = []

  for (const section of sections) {
    if (section.type === 'add') {
      const filePath = resolveToolPath(section.file)
      await writeTextFile(filePath, section.content)
      changes.push({ type: 'add', file_path: filePath })
      continue
    }

    if (section.type === 'delete') {
      const filePath = resolveToolPath(section.file)
      await deleteFile(filePath)
      changes.push({ type: 'delete', file_path: filePath })
      continue
    }

    const filePath = resolveToolPath(section.file)
    let content = (await readTextFile(filePath)).content
    for (const hunk of section.hunks) {
      if (!hunk.oldText) {
        throw new Error(`Update hunk for ${section.file} has no removable/context text`)
      }
      const count = content.split(hunk.oldText).length - 1
      if (count === 0) {
        throw new Error(`Patch hunk did not match ${section.file}`)
      }
      if (count > 1) {
        throw new Error(`Patch hunk matched multiple locations in ${section.file}`)
      }
      content = content.replace(hunk.oldText, hunk.newText)
    }
    await writeTextFile(filePath, content)
    changes.push({ type: 'update', file_path: filePath, hunks: section.hunks.length })
  }

  return {
    success: true,
    result: {
      changes,
    },
  }
}

function parsePatch(patch) {
  const lines = patch.replace(/\r\n/g, '\n').split('\n')
  if (lines[0] !== '*** Begin Patch') {
    throw new Error('Patch must start with "*** Begin Patch"')
  }
  if (lines[lines.length - 1] === '') {
    lines.pop()
  }
  if (lines[lines.length - 1] !== '*** End Patch') {
    throw new Error('Patch must end with "*** End Patch"')
  }

  const sections = []
  let index = 1
  while (index < lines.length - 1) {
    const line = lines[index]
    if (line.startsWith('*** Add File: ')) {
      const file = line.slice('*** Add File: '.length).trim()
      index += 1
      const contentLines = []
      while (index < lines.length - 1 && !lines[index].startsWith('*** ')) {
        if (!lines[index].startsWith('+')) {
          throw new Error(`Add File lines must start with + for ${file}`)
        }
        contentLines.push(lines[index].slice(1))
        index += 1
      }
      sections.push({ type: 'add', file, content: contentLines.join('\n') + '\n' })
      continue
    }

    if (line.startsWith('*** Delete File: ')) {
      sections.push({ type: 'delete', file: line.slice('*** Delete File: '.length).trim() })
      index += 1
      continue
    }

    if (line.startsWith('*** Update File: ')) {
      const file = line.slice('*** Update File: '.length).trim()
      index += 1
      const hunks = []
      while (index < lines.length - 1 && !lines[index].startsWith('*** ')) {
        if (lines[index].startsWith('@@')) {
          index += 1
          const hunkLines = []
          while (index < lines.length - 1 && !lines[index].startsWith('@@') && !lines[index].startsWith('*** ')) {
            hunkLines.push(lines[index])
            index += 1
          }
          hunks.push(parseHunk(hunkLines))
          continue
        }
        index += 1
      }
      if (hunks.length === 0) {
        throw new Error(`Update File requires at least one @@ hunk for ${file}`)
      }
      sections.push({ type: 'update', file, hunks })
      continue
    }

    throw new Error(`Unknown patch directive: ${line}`)
  }

  return sections
}

function parseHunk(lines) {
  const oldLines = []
  const newLines = []
  for (const line of lines) {
    if (line.startsWith(' ')) {
      oldLines.push(line.slice(1))
      newLines.push(line.slice(1))
    } else if (line.startsWith('-')) {
      oldLines.push(line.slice(1))
    } else if (line.startsWith('+')) {
      newLines.push(line.slice(1))
    } else if (line === '') {
      oldLines.push('')
      newLines.push('')
    } else {
      throw new Error(`Invalid hunk line: ${line}`)
    }
  }
  return {
    oldText: oldLines.join('\n') + '\n',
    newText: newLines.join('\n') + '\n',
  }
}

function truncateText(text, maxChars) {
  const limit = Number.isFinite(Number(maxChars)) ? Math.max(1000, Number(maxChars)) : 12000
  if (typeof text !== 'string' || text.length <= limit) {
    return text
  }
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} chars]`
}
