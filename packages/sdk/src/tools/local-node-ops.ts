/**
 * Local filesystem and shell primitives used by the built-in work tools.
 */
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'

interface CommandSession {
  id: string
  command: string
  cwd: string
  child: ChildProcessWithoutNullStreams
  pid: number
  status: 'running' | 'exited' | 'error'
  stdout: string
  stderr: string
  stdoutReadOffset: number
  stderrReadOffset: number
  exitCode: number | null
  signal: string | null
  startedAt: number
  endedAt: number | null
  maxBufferChars: number
}

export interface CommandSessionOutput {
  session_id: string
  command: string
  cwd: string
  pid: number
  status: CommandSession['status']
  running: boolean
  stdout: string
  stderr: string
  stdout_truncated: boolean
  stderr_truncated: boolean
  exit_code: number | null
  signal: string | null
  duration_ms: number
}

const commandSessions = new Map<string, CommandSession>()
let nextCommandSessionId = 1

export function resolveToolPath(inputPath?: string): string {
  if (!inputPath) {
    return process.cwd()
  }

  return isAbsolute(inputPath) ? inputPath : resolve(process.cwd(), inputPath)
}

export async function readTextFile(filePath: string, offset?: number, limit?: number): Promise<{ content: string; lines: number }> {
  const absolutePath = resolveToolPath(filePath)
  const content = await readFile(absolutePath, 'utf8')
  const lines = content.split('\n')
  const start = offset && offset > 0 ? offset - 1 : 0
  const end = limit && limit > 0 ? start + limit : undefined
  const selected = lines.slice(start, end).join('\n')

  return {
    content: selected,
    lines: selected ? selected.split('\n').length : 0,
  }
}

export async function writeTextFile(filePath: string, content: string): Promise<number> {
  const absolutePath = resolveToolPath(filePath)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content, 'utf8')
  return Buffer.byteLength(content, 'utf8')
}

export async function editTextFile(
  filePath: string,
  oldString: string,
  newString: string,
  replaceAll: boolean
): Promise<number> {
  const absolutePath = resolveToolPath(filePath)
  const original = await readFile(absolutePath, 'utf8')

  if (!oldString) {
    throw new Error('old_string must not be empty')
  }

  const occurrences = original.split(oldString).length - 1
  if (occurrences === 0) {
    throw new Error('old_string not found in file')
  }
  if (!replaceAll && occurrences > 1) {
    throw new Error('old_string is not unique in file; set replace_all=true to replace every occurrence')
  }

  const updated = replaceAll
    ? original.split(oldString).join(newString)
    : original.replace(oldString, newString)

  await writeFile(absolutePath, updated, 'utf8')
  return replaceAll ? occurrences : 1
}

export async function deleteFile(filePath: string): Promise<void> {
  const absolutePath = resolveToolPath(filePath)
  await rm(absolutePath, { force: false })
}

export async function readImageFile(filePath: string): Promise<{
  path: string
  base64: string
  mimeType: string
  width?: number
  height?: number
  bytes: number
}> {
  const absolutePath = resolveToolPath(filePath)
  const buffer = await readFile(absolutePath)
  const metadata = detectImageMetadata(buffer, absolutePath)
  return {
    path: absolutePath,
    base64: buffer.toString('base64'),
    mimeType: metadata.mimeType,
    width: metadata.width,
    height: metadata.height,
    bytes: buffer.byteLength,
  }
}

export async function runCommand(command: string, options: { cwd?: string; timeout?: number } = {}): Promise<{
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
  timedOut: boolean
}> {
  const cwd = resolveToolPath(options.cwd)
  const startedAt = Date.now()

  return new Promise((resolvePromise, reject) => {
    execFile('bash', ['-lc', command], {
      cwd,
      timeout: options.timeout,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (!error) {
        resolvePromise({ stdout, stderr, exitCode: 0, durationMs: Date.now() - startedAt, timedOut: false })
        return
      }

      const errorCode = error.code
      const exitCode = typeof errorCode === 'number' ? errorCode : 1
      const timedOut = Boolean(error.killed && String(error.signal || '').trim())

      if (String(error.message || '').includes('spawn bash ENOENT')) {
        reject(error)
        return
      }

      resolvePromise({ stdout, stderr, exitCode, durationMs: Date.now() - startedAt, timedOut })
    })
  })
}

export async function startCommandSession(
  command: string,
  options: { cwd?: string; maxBufferChars?: number; yieldTimeMs?: number; maxOutputChars?: number } = {}
): Promise<CommandSessionOutput> {
  const cwd = resolveToolPath(options.cwd)
  const sessionId = `exec-${nextCommandSessionId++}`
  const maxBufferChars = clampNumber(Number(options.maxBufferChars ?? 200000), 10000, 2000000)
  const child = spawn('bash', ['-c', command], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const session: CommandSession = {
    id: sessionId,
    command,
    cwd,
    child,
    pid: child.pid ?? -1,
    status: 'running',
    stdout: '',
    stderr: '',
    stdoutReadOffset: 0,
    stderrReadOffset: 0,
    exitCode: null,
    signal: null,
    startedAt: Date.now(),
    endedAt: null,
    maxBufferChars,
  }

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => appendSessionOutput(session, 'stdout', String(chunk)))
  child.stderr.on('data', chunk => appendSessionOutput(session, 'stderr', String(chunk)))
  child.on('error', error => {
    session.status = 'error'
    session.endedAt = Date.now()
    appendSessionOutput(session, 'stderr', error.message)
  })
  child.on('close', (code, signal) => {
    session.status = 'exited'
    session.exitCode = typeof code === 'number' ? code : null
    session.signal = signal || null
    session.endedAt = Date.now()
  })

  commandSessions.set(sessionId, session)
  await delay(clampNumber(Number(options.yieldTimeMs ?? 1000), 0, 30000))
  return readCommandSession(sessionId, {
    maxOutputChars: options.maxOutputChars,
  })
}

export async function interactCommandSession(
  sessionId: string,
  options: { chars?: string; terminate?: boolean; close?: boolean; signal?: string; yieldTimeMs?: number; maxOutputChars?: number } = {}
): Promise<CommandSessionOutput> {
  const session = commandSessions.get(sessionId)
  if (!session) {
    throw new Error(`Unknown exec session: ${sessionId}`)
  }

  if (typeof options.chars === 'string' && options.chars.length > 0) {
    if (session.status !== 'running') {
      throw new Error(`Exec session ${sessionId} is not running`)
    }
    session.child.stdin.write(options.chars)
  }

  if (options.terminate === true || options.close === true) {
    terminateCommandSession(session, options.signal)
  }

  await delay(clampNumber(Number(options.yieldTimeMs ?? 1000), 0, 30000))
  return readCommandSession(sessionId, {
    maxOutputChars: options.maxOutputChars,
  })
}

export function listCommandSessions(options: { includeExited?: boolean; maxOutputChars?: number } = {}): CommandSessionOutput[] {
  const includeExited = options.includeExited === true
  const maxOutputChars = clampNumber(Number(options.maxOutputChars ?? 2000), 200, 50000)
  const sessions: CommandSessionOutput[] = []

  for (const session of commandSessions.values()) {
    if (!includeExited && session.status !== 'running') {
      continue
    }
    sessions.push(formatCommandSession(session, {
      maxOutputChars,
      consumeOutput: false,
    }))
  }

  return sessions
}

export function readCommandSession(sessionId: string, options: { maxOutputChars?: number } = {}): CommandSessionOutput {
  const session = commandSessions.get(sessionId)
  if (!session) {
    throw new Error(`Unknown exec session: ${sessionId}`)
  }

  const output = formatCommandSession(session, {
    maxOutputChars: clampNumber(Number(options.maxOutputChars ?? 12000), 1000, 200000),
    consumeOutput: true,
  })

  cleanupEndedSessions()
  return output
}

function formatCommandSession(
  session: CommandSession,
  options: { maxOutputChars?: number; consumeOutput?: boolean } = {}
): CommandSessionOutput {
  const maxOutputChars = clampNumber(Number(options.maxOutputChars ?? 12000), 1000, 200000)
  const stdout = session.stdout.slice(session.stdoutReadOffset)
  const stderr = session.stderr.slice(session.stderrReadOffset)
  if (options.consumeOutput !== false) {
    session.stdoutReadOffset = session.stdout.length
    session.stderrReadOffset = session.stderr.length
  }

  return {
    session_id: session.id,
    command: session.command,
    cwd: session.cwd,
    pid: session.pid,
    status: session.status,
    running: session.status === 'running',
    stdout: truncateHead(stdout, maxOutputChars),
    stderr: truncateHead(stderr, maxOutputChars),
    stdout_truncated: stdout.length > maxOutputChars,
    stderr_truncated: stderr.length > maxOutputChars,
    exit_code: session.exitCode,
    signal: session.signal,
    duration_ms: (session.endedAt ?? Date.now()) - session.startedAt,
  }
}

function cleanupEndedSessions(): void {
  for (const [sessionId, session] of commandSessions) {
    if (session.status !== 'running' && session.endedAt && Date.now() - session.endedAt > 60000) {
      commandSessions.delete(sessionId)
    }
  }
}

function appendSessionOutput(session: CommandSession, key: 'stdout' | 'stderr', chunk: string): void {
  session[key] += chunk
  if (session[key].length <= session.maxBufferChars) {
    return
  }
  const trimmed = session[key].length - session.maxBufferChars
  session[key] = session[key].slice(trimmed)
  if (key === 'stdout') {
    session.stdoutReadOffset = Math.max(0, session.stdoutReadOffset - trimmed)
  } else {
    session.stderrReadOffset = Math.max(0, session.stderrReadOffset - trimmed)
  }
}

function terminateCommandSession(session: CommandSession, signal = 'SIGTERM'): void {
  if (session.status !== 'running') {
    return
  }
  session.child.kill((signal || 'SIGTERM') as NodeJS.Signals)
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

function detectImageMetadata(buffer: Buffer, filePath: string): { mimeType: string; width?: number; height?: number } {
  const png = detectPng(buffer)
  if (png) {
    return png
  }

  const jpeg = detectJpeg(buffer)
  if (jpeg) {
    return jpeg
  }

  const extension = filePath.toLowerCase().split('.').pop()
  if (extension === 'webp') {
    return { mimeType: 'image/webp' }
  }
  if (extension === 'gif') {
    return { mimeType: 'image/gif' }
  }

  return { mimeType: 'application/octet-stream' }
}

function detectPng(buffer: Buffer): { mimeType: string; width: number; height: number } | null {
  if (
    buffer.length < 24 ||
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47
  ) {
    return null
  }

  return {
    mimeType: 'image/png',
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

function detectJpeg(buffer: Buffer): { mimeType: string; width?: number; height?: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null
  }

  let offset = 2
  while (offset < buffer.length - 9) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }

    const marker = buffer[offset + 1]
    const length = buffer.readUInt16BE(offset + 2)
    if (length < 2) {
      break
    }

    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        mimeType: 'image/jpeg',
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      }
    }

    offset += 2 + length
  }

  return { mimeType: 'image/jpeg' }
}
