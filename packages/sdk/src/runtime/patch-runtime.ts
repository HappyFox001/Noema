/**
 * Applies structured patches and returns recoverable failure context.
 */
import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { generateId } from '../utils/index.js'
import type { RuntimeEventBus } from './events.js'

export interface PatchApplyRequest {
  patch: string
  cwd: string
  taskId?: string
  threadId?: string
  correlationId?: string
  checkOnly?: boolean
}

export interface PatchApplyResult {
  id: string
  success: boolean
  changedFiles: string[]
  stdout: string
  stderr: string
  error?: PatchFailureContext
}

export interface PatchFailureContext {
  stage: 'parse' | 'check' | 'apply'
  message: string
  changedFiles: string[]
  patchPreview: string
  stdout?: string
  stderr?: string
}

export interface PatchRuntimeOptions {
  events: RuntimeEventBus
}

export class PatchRuntime {
  constructor(private options: PatchRuntimeOptions) {}

  async applyStructured(request: PatchApplyRequest): Promise<PatchApplyResult> {
    const id = generateId()
    const changedFiles = parseStructuredChangedFiles(request.patch)
    this.emitStarted(request, id, changedFiles)

    if (changedFiles.length === 0) {
      const error = createPatchFailure('parse', 'Patch does not contain any changed files', request.patch, changedFiles)
      this.emitFailed(request, id, changedFiles, error.message)
      return { id, success: false, changedFiles, stdout: '', stderr: '', error }
    }

    try {
      const sections = parseStructuredPatch(request.patch)
      if (!request.checkOnly) {
        await applyStructuredSections(request.cwd, sections)
      }
      this.emitCompleted(request, id, changedFiles)
      return { id, success: true, changedFiles, stdout: '', stderr: '' }
    } catch (error) {
      const failure = createPatchFailure(
        'apply',
        error instanceof Error ? error.message : String(error),
        request.patch,
        changedFiles
      )
      this.emitFailed(request, id, changedFiles, failure.message)
      return { id, success: false, changedFiles, stdout: '', stderr: '', error: failure }
    }
  }

  async apply(request: PatchApplyRequest): Promise<PatchApplyResult> {
    const id = generateId()
    const changedFiles = parseChangedFiles(request.patch)
    this.emitStarted(request, id, changedFiles)

    if (changedFiles.length === 0) {
      const error = createPatchFailure('parse', 'Patch does not contain any changed files', request.patch, changedFiles)
      this.emitFailed(request, id, changedFiles, error.message)
      return { id, success: false, changedFiles, stdout: '', stderr: '', error }
    }

    const check = await runGitApply(request.cwd, request.patch, ['--check'])
    if (check.exitCode !== 0) {
      const error = createPatchFailure('check', 'Patch failed validation', request.patch, changedFiles, check.stdout, check.stderr)
      this.emitFailed(request, id, changedFiles, error.message)
      return { id, success: false, changedFiles, stdout: check.stdout, stderr: check.stderr, error }
    }

    if (request.checkOnly) {
      this.emitCompleted(request, id, changedFiles)
      return { id, success: true, changedFiles, stdout: check.stdout, stderr: check.stderr }
    }

    const applied = await runGitApply(request.cwd, request.patch, [])
    if (applied.exitCode !== 0) {
      const error = createPatchFailure('apply', 'Patch could not be applied after validation', request.patch, changedFiles, applied.stdout, applied.stderr)
      this.emitFailed(request, id, changedFiles, error.message)
      return { id, success: false, changedFiles, stdout: applied.stdout, stderr: applied.stderr, error }
    }

    this.emitCompleted(request, id, changedFiles)
    return { id, success: true, changedFiles, stdout: applied.stdout, stderr: applied.stderr }
  }

  private emitStarted(request: PatchApplyRequest, patchId: string, changedFiles: string[]): void {
    this.options.events.emit({
      name: 'task.patch.started',
      taskId: request.taskId,
      threadId: request.threadId,
      correlationId: request.correlationId,
      payload: {
        patchId,
        changedFiles,
        checkOnly: Boolean(request.checkOnly),
      },
    })
  }

  private emitCompleted(request: PatchApplyRequest, patchId: string, changedFiles: string[]): void {
    this.options.events.emit({
      name: 'task.patch.completed',
      taskId: request.taskId,
      threadId: request.threadId,
      correlationId: request.correlationId,
      payload: {
        patchId,
        changedFiles,
        checkOnly: Boolean(request.checkOnly),
      },
    })
  }

  private emitFailed(request: PatchApplyRequest, patchId: string, changedFiles: string[], error: string): void {
    this.options.events.emit({
      name: 'task.patch.failed',
      taskId: request.taskId,
      threadId: request.threadId,
      correlationId: request.correlationId,
      payload: {
        patchId,
        changedFiles,
        error,
      },
    })
  }
}

interface StructuredPatchSection {
  type: 'add' | 'delete' | 'update'
  file: string
  content?: string
  hunks?: StructuredPatchHunk[]
}

interface StructuredPatchHunk {
  oldText: string
  newText: string
}

async function applyStructuredSections(cwd: string, sections: StructuredPatchSection[]): Promise<void> {
  for (const section of sections) {
    if (section.type === 'add') {
      const filePath = resolvePatchPath(cwd, section.file)
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, section.content ?? '', 'utf8')
      continue
    }

    if (section.type === 'delete') {
      await rm(resolvePatchPath(cwd, section.file), { force: false })
      continue
    }

    const filePath = resolvePatchPath(cwd, section.file)
    let content = await readFile(filePath, 'utf8')
    for (const hunk of section.hunks ?? []) {
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
    await writeFile(filePath, content, 'utf8')
  }
}

function parseStructuredChangedFiles(patch: string): string[] {
  const files: string[] = []
  for (const line of patch.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('*** Add File: ')) {
      files.push(line.slice('*** Add File: '.length).trim())
    } else if (line.startsWith('*** Delete File: ')) {
      files.push(line.slice('*** Delete File: '.length).trim())
    } else if (line.startsWith('*** Update File: ')) {
      files.push(line.slice('*** Update File: '.length).trim())
    }
  }
  return [...new Set(files.filter(Boolean))].sort()
}

function parseStructuredPatch(patch: string): StructuredPatchSection[] {
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

  const sections: StructuredPatchSection[] = []
  let index = 1
  while (index < lines.length - 1) {
    const line = lines[index]
    if (line.startsWith('*** Add File: ')) {
      const file = line.slice('*** Add File: '.length).trim()
      index += 1
      const contentLines: string[] = []
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
      const hunks: StructuredPatchHunk[] = []
      while (index < lines.length - 1 && !lines[index].startsWith('*** ')) {
        if (lines[index].startsWith('@@')) {
          index += 1
          const hunkLines: string[] = []
          while (index < lines.length - 1 && !lines[index].startsWith('@@') && !lines[index].startsWith('*** ')) {
            hunkLines.push(lines[index])
            index += 1
          }
          hunks.push(parseStructuredHunk(hunkLines))
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

function parseStructuredHunk(lines: string[]): StructuredPatchHunk {
  const oldLines: string[] = []
  const newLines: string[] = []
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

function resolvePatchPath(cwd: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(cwd || process.cwd(), filePath)
}

function parseChangedFiles(patch: string): string[] {
  const files = new Set<string>()
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('+++ b/')) {
      files.add(line.slice('+++ b/'.length))
    } else if (line.startsWith('--- a/')) {
      files.add(line.slice('--- a/'.length))
    } else if (line.startsWith('diff --git ')) {
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line)
      if (match) {
        files.add(match[1])
        files.add(match[2])
      }
    }
  }
  files.delete('/dev/null')
  return [...files].sort()
}

function createPatchFailure(
  stage: PatchFailureContext['stage'],
  message: string,
  patch: string,
  changedFiles: string[],
  stdout = '',
  stderr = '',
): PatchFailureContext {
  return {
    stage,
    message,
    changedFiles,
    patchPreview: patch.slice(0, 4000),
    stdout,
    stderr,
  }
}

function runGitApply(cwd: string, patch: string, args: string[]): Promise<{ exitCode: number | null, stdout: string, stderr: string }> {
  return new Promise(resolve => {
    const child = spawn('git', ['apply', ...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += String(chunk)
    })
    child.stderr.on('data', chunk => {
      stderr += String(chunk)
    })
    child.once('error', error => {
      resolve({ exitCode: 1, stdout, stderr: stderr + error.message })
    })
    child.once('close', exitCode => {
      resolve({ exitCode, stdout, stderr })
    })
    child.stdin.end(patch)
  })
}
