/**
 * Applies structured patches and returns recoverable failure context.
 */
import { spawn } from 'node:child_process'
import { generateId } from '@her-text/core'
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
