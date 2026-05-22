/**
 * Runs command sessions for the work runtime with observable lifecycle events.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { generateId } from '../utils/index.js'
import type { RuntimeEventBus } from './events.js'

export type CommandRuntimeMode = 'pipe' | 'pty'
export type CommandSessionStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out'

export interface CommandRunRequest {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string | undefined>
  mode?: CommandRuntimeMode
  timeoutMs?: number
  shell?: boolean | string
  taskId?: string
  threadId?: string
  correlationId?: string
  maxBufferChars?: number
}

export interface CommandInteractRequest {
  sessionId: string
  chars?: string
  terminate?: boolean
  signal?: NodeJS.Signals
  yieldTimeMs?: number
  maxOutputChars?: number
}

export interface CommandSessionSnapshot {
  id: string
  command: string
  args: string[]
  cwd?: string
  mode: CommandRuntimeMode
  status: CommandSessionStatus
  startedAt: number
  completedAt?: number
  exitCode?: number | null
  signal?: NodeJS.Signals | null
  stdout: string
  stderr: string
  error?: string
}

export interface CommandRuntimeOptions {
  events: RuntimeEventBus
  defaultCwd?: string
  defaultEnv?: NodeJS.ProcessEnv
}

export class CommandRuntime {
  private sessions = new Map<string, CommandSession>()

  constructor(private options: CommandRuntimeOptions) {}

  run(request: CommandRunRequest): CommandSessionSnapshot {
    const id = generateId()
    const mode = request.mode ?? 'pipe'
    const args = request.args ?? []
    const spawnSpec = buildCommandSpawnSpec(request.command, args, mode)
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      cwd: request.cwd ?? this.options.defaultCwd,
      env: {
        ...(this.options.defaultEnv ?? process.env),
        ...(request.env ?? {}),
        ...(mode === 'pty' ? { TERM: request.env?.TERM ?? process.env.TERM ?? 'xterm-256color' } : {}),
      },
      shell: request.shell ?? false,
      stdio: 'pipe',
    })
    const now = Date.now()
    const session: CommandSession = {
      snapshot: {
        id,
        command: request.command,
        args,
        cwd: request.cwd ?? this.options.defaultCwd,
        mode,
        status: 'running',
        startedAt: now,
        stdout: '',
        stderr: '',
      },
      child,
      request,
      stdoutReadOffset: 0,
      stderrReadOffset: 0,
      maxBufferChars: clampNumber(Number(request.maxBufferChars ?? 200000), 10000, 2000000),
      completion: undefined as unknown as Promise<void>,
      resolveCompletion: undefined as unknown as () => void,
    }
    session.completion = new Promise(resolve => {
      session.resolveCompletion = resolve
    })
    this.sessions.set(id, session)
    this.emit('task.command.started', session)

    child.stdout.on('data', chunk => {
      const text = String(chunk)
      session.snapshot.stdout += text
      trimSessionOutput(session, 'stdout')
      this.emit('task.command.stdout', session, { chunk: text })
    })

    child.stderr.on('data', chunk => {
      const text = String(chunk)
      session.snapshot.stderr += text
      trimSessionOutput(session, 'stderr')
      this.emit('task.command.stderr', session, { chunk: text })
    })

    child.once('error', error => {
      this.finish(session, 'failed', { error: error.message })
    })

    child.once('close', (exitCode, signal) => {
      if (session.snapshot.status !== 'running') {
        return
      }
      this.finish(session, exitCode === 0 ? 'completed' : 'failed', { exitCode, signal })
    })

    if (request.timeoutMs && request.timeoutMs > 0) {
      session.timeout = setTimeout(() => {
        if (session.snapshot.status === 'running') {
          this.kill(id, 'SIGTERM', 'timed_out')
        }
      }, request.timeoutMs)
    }

    return { ...session.snapshot }
  }

  getSession(id: string): CommandSessionSnapshot | undefined {
    const session = this.sessions.get(id)
    return session ? { ...session.snapshot } : undefined
  }

  listSessions(): CommandSessionSnapshot[] {
    return [...this.sessions.values()].map(session => ({ ...session.snapshot }))
  }

  listActiveCommandSessions(): Array<{ sessionId: string; command: string; cwd?: string; status: CommandSessionStatus }> {
    return this.listSessions()
      .filter(session => session.status === 'running')
      .map(session => ({
        sessionId: session.id,
        command: [session.command, ...session.args].join(' '),
        cwd: session.cwd,
        status: session.status,
      }))
  }

  async interact(request: CommandInteractRequest): Promise<CommandSessionSnapshot & {
    session_id: string
    running: boolean
    stdout_truncated: boolean
    stderr_truncated: boolean
    exit_code?: number | null
    duration_ms: number
  }> {
    const session = this.sessions.get(request.sessionId)
    if (!session) {
      throw new Error(`Unknown command session: ${request.sessionId}`)
    }

    if (typeof request.chars === 'string' && request.chars.length > 0) {
      if (session.snapshot.status !== 'running') {
        throw new Error(`Command session ${request.sessionId} is not running`)
      }
      session.child.stdin.write(request.chars)
    }

    if (request.terminate) {
      this.kill(request.sessionId, request.signal ?? 'SIGTERM')
    }

    await delay(clampNumber(Number(request.yieldTimeMs ?? 1000), 0, 30000))
    return this.formatSession(session, request.maxOutputChars, true)
  }

  async waitForSession(sessionId: string, maxOutputChars?: number): Promise<ReturnType<CommandRuntime['formatSession']>> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Unknown command session: ${sessionId}`)
    }
    await session.completion
    return this.formatSession(session, maxOutputChars, true)
  }

  listFormattedSessions(options: { includeExited?: boolean; maxOutputChars?: number } = {}): Array<ReturnType<CommandRuntime['formatSession']>> {
    return [...this.sessions.values()]
      .filter(session => options.includeExited || session.snapshot.status === 'running')
      .map(session => this.formatSession(session, options.maxOutputChars, false))
  }

  interrupt(id: string): boolean {
    return this.kill(id, 'SIGINT', 'cancelled')
  }

  kill(id: string, signal: NodeJS.Signals = 'SIGTERM', status: CommandSessionStatus = 'cancelled'): boolean {
    const session = this.sessions.get(id)
    if (!session || session.snapshot.status !== 'running') {
      return false
    }
    const killed = session.child.kill(signal)
    if (killed) {
      this.finish(session, status, { signal })
    }
    return killed
  }

  private finish(
    session: CommandSession,
    status: CommandSessionStatus,
    updates: Pick<CommandSessionSnapshot, 'exitCode' | 'signal' | 'error'>,
  ): void {
    if (session.timeout) {
      clearTimeout(session.timeout)
      session.timeout = undefined
    }
    session.snapshot.status = status
    session.snapshot.completedAt = Date.now()
    session.snapshot.exitCode = updates.exitCode
    session.snapshot.signal = updates.signal
    session.snapshot.error = updates.error
    this.emit('task.command.completed', session)
    session.resolveCompletion()
  }

  private formatSession(
    session: CommandSession,
    maxOutputChars = 12000,
    consumeOutput = true
  ): CommandSessionSnapshot & {
    session_id: string
    running: boolean
    stdout_truncated: boolean
    stderr_truncated: boolean
    exit_code?: number | null
    duration_ms: number
  } {
    const limit = clampNumber(Number(maxOutputChars), 1000, 200000)
    const stdout = session.snapshot.stdout.slice(session.stdoutReadOffset)
    const stderr = session.snapshot.stderr.slice(session.stderrReadOffset)
    if (consumeOutput) {
      session.stdoutReadOffset = session.snapshot.stdout.length
      session.stderrReadOffset = session.snapshot.stderr.length
    }
    return {
      ...session.snapshot,
      session_id: session.snapshot.id,
      running: session.snapshot.status === 'running',
      stdout: truncateHead(stdout, limit),
      stderr: truncateHead(stderr, limit),
      stdout_truncated: stdout.length > limit,
      stderr_truncated: stderr.length > limit,
      exit_code: session.snapshot.exitCode,
      duration_ms: (session.snapshot.completedAt ?? Date.now()) - session.snapshot.startedAt,
    }
  }

  private emit(name: CommandRuntimeEventName, session: CommandSession, extra: Record<string, unknown> = {}): void {
    this.options.events.emit({
      name,
      taskId: session.request.taskId,
      threadId: session.request.threadId,
      correlationId: session.request.correlationId,
      payload: {
        sessionId: session.snapshot.id,
        command: session.snapshot.command,
        args: session.snapshot.args,
        cwd: session.snapshot.cwd,
        status: session.snapshot.status,
        exitCode: session.snapshot.exitCode,
        signal: session.snapshot.signal,
        error: session.snapshot.error,
        ...extra,
      },
    })
  }
}

type CommandRuntimeEventName =
  | 'task.command.started'
  | 'task.command.stdout'
  | 'task.command.stderr'
  | 'task.command.completed'

interface CommandSession {
  snapshot: CommandSessionSnapshot
  child: ChildProcessWithoutNullStreams
  request: CommandRunRequest
  timeout?: ReturnType<typeof setTimeout>
  stdoutReadOffset: number
  stderrReadOffset: number
  maxBufferChars: number
  completion: Promise<void>
  resolveCompletion: () => void
}

function trimSessionOutput(session: CommandSession, key: 'stdout' | 'stderr'): void {
  if (session.snapshot[key].length <= session.maxBufferChars) {
    return
  }
  const trimmed = session.snapshot[key].length - session.maxBufferChars
  session.snapshot[key] = session.snapshot[key].slice(trimmed)
  if (key === 'stdout') {
    session.stdoutReadOffset = Math.max(0, session.stdoutReadOffset - trimmed)
  } else {
    session.stderrReadOffset = Math.max(0, session.stderrReadOffset - trimmed)
  }
}

function delay(ms: number): Promise<void> {
  if (!ms) {
    return Promise.resolve()
  }
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
}

function truncateHead(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }
  return value.slice(value.length - maxLength)
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.max(min, Math.min(max, value))
}

function buildCommandSpawnSpec(command: string, args: string[], mode: CommandRuntimeMode): { command: string; args: string[] } {
  if (mode === 'pipe') {
    return { command, args }
  }
  if (!process.stdin.isTTY) {
    return { command, args }
  }
  if (process.platform === 'win32') {
    throw new Error('PTY command sessions are not supported on Windows without a pty provider')
  }
  if (process.platform === 'darwin') {
    return {
      command: 'script',
      args: ['-q', '/dev/null', command, ...args],
    }
  }
  return {
    command: 'script',
    args: ['-q', '-e', '-c', shellQuote([command, ...args]), '/dev/null'],
  }
}

function shellQuote(parts: string[]): string {
  return parts.map(part => `'${part.replace(/'/g, `'\\''`)}'`).join(' ')
}
