/**
 * Runs command sessions for the work runtime with observable lifecycle events.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { generateId } from '@her-text/core'
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
    }
    this.sessions.set(id, session)
    this.emit('task.command.started', session)

    child.stdout.on('data', chunk => {
      const text = String(chunk)
      session.snapshot.stdout += text
      this.emit('task.command.stdout', session, { chunk: text })
    })

    child.stderr.on('data', chunk => {
      const text = String(chunk)
      session.snapshot.stderr += text
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
