/**
 * Task execution state model.
 *
 * Normalizes tool results into observations and keeps the compact state that
 * the task runtime feeds back into later model turns.
 */
import type { TaskStepStatus } from './task-plan.js'

export type TaskObservationKind =
  | 'tool'
  | 'command'
  | 'file'
  | 'patch'
  | 'image'
  | 'user_input'

export interface TaskObservation {
  id: string
  turnIndex: number
  stepId?: string
  stepTitle?: string
  toolName: string
  kind: TaskObservationKind
  status: 'success' | 'failure'
  summary: string
  path?: string
  metadata?: Record<string, unknown>
  createdAt: number
}

export interface ActiveExecSession {
  id: string
  command: string
  cwd?: string
  pid?: number
  status: string
  lastOutput?: string
  startedAt?: number
  updatedAt: number
}

export interface ExecutionState {
  goal: string
  currentStep?: {
    id: string
    title: string
    description: string
    status: TaskStepStatus
  }
  confirmedFacts: string[]
  recentObservations: TaskObservation[]
  recentFailures: string[]
  changedFiles: string[]
  pendingVerification: string[]
  activeSessions: ActiveExecSession[]
  lastObservation?: TaskObservation
  updatedAt: number
}

export function createExecutionState(goal: string): ExecutionState {
  return {
    goal,
    confirmedFacts: [],
    recentObservations: [],
    recentFailures: [],
    changedFiles: [],
    pendingVerification: [],
    activeSessions: [],
    updatedAt: Date.now()
  }
}

export function createTaskObservation(options: {
  turnIndex: number
  callIndex: number
  toolName: string
  toolResult: any
  stepId?: string
  stepTitle?: string
}): TaskObservation {
  const status = options.toolResult?.success === false ? 'failure' : 'success'
  const resultBody = options.toolResult?.result ?? options.toolResult

  return {
    id: `obs-${options.turnIndex}-${options.callIndex + 1}`,
    turnIndex: options.turnIndex,
    stepId: options.stepId,
    stepTitle: options.stepTitle,
    toolName: options.toolName,
    kind: inferObservationKind(options.toolName, resultBody),
    status,
    summary: summarizeObservation(options.toolName, status, resultBody, options.toolResult?.error),
    path: extractObservationPath(resultBody),
    metadata: extractObservationMetadata(resultBody),
    createdAt: Date.now()
  }
}

export function applyExecutionObservations(state: ExecutionState, observations: TaskObservation[]): void {
  for (const observation of observations) {
    state.lastObservation = observation
    state.recentObservations.push(observation)

    if (observation.status === 'failure') {
      appendUniqueLimited(state.recentFailures, observation.summary, 8)
      continue
    }

    if (observation.kind === 'file' || observation.kind === 'patch') {
      const changedFiles = extractChangedFiles(observation)
      for (const file of changedFiles) {
        appendUniqueLimited(state.changedFiles, file, 12)
      }
      if (changedFiles.length > 0) {
        appendUniqueLimited(state.pendingVerification, `验证文件改动：${changedFiles.join(', ')}`, 6)
      }
    }

    if (looksLikeVerificationObservation(observation)) {
      removeMatchingVerification(state.pendingVerification, observation.summary)
    }

    updateActiveSessionState(state, observation)
    appendUniqueLimited(state.confirmedFacts, observation.summary, 10)
  }

  state.activeSessions = state.activeSessions.slice(-8)
  state.recentObservations = state.recentObservations.slice(-12)
  state.updatedAt = Date.now()
}

export function appendUniqueLimited(items: string[], value: string, limit: number): void {
  const clean = cleanStateText(value)
  if (!clean) {
    return
  }
  const existingIndex = items.findIndex(item => item === clean)
  if (existingIndex >= 0) {
    items.splice(existingIndex, 1)
  }
  items.push(clean)
  if (items.length > limit) {
    items.splice(0, items.length - limit)
  }
}

function inferObservationKind(toolName: string, result: unknown): TaskObservationKind {
  if (toolName === 'request_user_input') {
    return 'user_input'
  }
  if (toolName === 'view_image' || hasInlineImage(result)) {
    return 'image'
  }
  if (toolName === 'apply_patch' || toolName.includes('patch')) {
    return 'patch'
  }
  if (toolName === 'bash' || toolName === 'exec_command' || toolName === 'write_stdin' || toolName === 'list_exec_sessions' || hasAnyKey(result, ['stdout', 'stderr', 'exitCode', 'exit_code', 'command', 'sessions'])) {
    return 'command'
  }
  if (
    toolName.includes('read')
    || toolName.includes('write')
    || toolName.includes('edit')
    || toolName.includes('file')
    || hasAnyKey(result, ['path', 'file_path', 'filePath'])
  ) {
    return 'file'
  }
  return 'tool'
}

function summarizeObservation(
  toolName: string,
  status: TaskObservation['status'],
  result: unknown,
  error?: unknown
): string {
  if (toolName === 'request_user_input' && status === 'success') {
    const groupKey = readNestedString(result, ['groupKey'])
    const itemKey = readNestedString(result, ['itemKey'])
    return groupKey && itemKey
      ? `已获取用户输入：${groupKey}.${itemKey}`
      : '已获取用户输入。'
  }

  if (status === 'failure') {
    return truncateText(firstString(error, readNestedString(result, ['error']), readNestedString(result, ['message'])) || `${toolName} 执行失败`, 360)
  }

  const sessionId = readNestedString(result, ['session_id'])
  if (sessionId) {
    const command = readNestedString(result, ['command'])
    const sessionStatus = readNestedString(result, ['status']) || (readNestedValue(result, ['running']) === true ? 'running' : 'unknown')
    const stdout = readNestedString(result, ['stdout'])
    const stderr = readNestedString(result, ['stderr'])
    const output = firstString(stdout, stderr)
    return truncateText([
      `命令会话 ${sessionId} ${sessionStatus}`,
      command ? `命令：${command}` : '',
      output ? `输出：${output}` : ''
    ].filter(Boolean).join('；'), 420)
  }

  const summary = firstString(
    readNestedString(result, ['summary']),
    readNestedString(result, ['result', 'summary']),
    readNestedString(result, ['note']),
    readNestedString(result, ['description'])
  )
  if (summary) {
    return truncateText(summary, 360)
  }

  const command = firstString(readNestedString(result, ['command']), readNestedString(result, ['result', 'command']))
  const stdout = firstString(readNestedString(result, ['stdout']), readNestedString(result, ['result', 'stdout']))
  const stderr = firstString(readNestedString(result, ['stderr']), readNestedString(result, ['result', 'stderr']))
  if (command || stdout || stderr) {
    return truncateText([
      command ? `命令：${command}` : '',
      stdout ? `stdout: ${stdout}` : '',
      stderr ? `stderr: ${stderr}` : ''
    ].filter(Boolean).join('；'), 420)
  }

  const path = extractObservationPath(result)
  if (path) {
    return `${toolName} 处理了 ${path}`
  }

  return truncateText(`${toolName} 执行成功：${JSON.stringify(stripInlineImages(result))}`, 360)
}

function extractObservationPath(result: unknown): string | undefined {
  return firstString(
    readNestedString(result, ['path']),
    readNestedString(result, ['file_path']),
    readNestedString(result, ['filePath']),
    readNestedString(result, ['result', 'path']),
    readNestedString(result, ['result', 'file_path']),
    readNestedString(result, ['result', 'filePath'])
  )
}

function extractObservationMetadata(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== 'object') {
    return undefined
  }
  const metadata: Record<string, unknown> = {}
  for (const key of ['session_id', 'command', 'status', 'running', 'pid', 'signal', 'sessions', 'exitCode', 'exit_code', 'timedOut', 'timed_out', 'durationMs', 'duration_ms', 'cwd', 'stdout', 'stderr', 'bytes', 'width', 'height', 'files', 'changedFiles', 'changed_files']) {
    const value = readNestedValue(result, [key]) ?? readNestedValue(result, ['result', key])
    if (value !== undefined) {
      metadata[key] = value
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined
}

function updateActiveSessionState(state: ExecutionState, observation: TaskObservation): void {
  if (observation.kind !== 'command') {
    return
  }

  const sessions = observation.metadata?.sessions
  if (Array.isArray(sessions)) {
    const listedIds = new Set<string>()
    for (const item of sessions) {
      if (!item || typeof item !== 'object') {
        continue
      }
      const metadata = item as Record<string, unknown>
      const sessionId = readMetadataString(metadata, 'session_id')
      if (!sessionId) {
        continue
      }
      listedIds.add(sessionId)
      upsertActiveSession(state, metadata, sessionId)
    }
    state.activeSessions = state.activeSessions.filter(session => listedIds.has(session.id))
    return
  }

  const sessionId = readMetadataString(observation.metadata, 'session_id')
  if (!sessionId) {
    return
  }
  upsertActiveSession(state, observation.metadata, sessionId, observation.toolName)
}

function upsertActiveSession(
  state: ExecutionState,
  metadata: Record<string, unknown> | undefined,
  sessionId: string,
  fallbackCommand = 'exec session'
): void {
  const running = metadata?.running === true
  const existingIndex = state.activeSessions.findIndex(session => session.id === sessionId)
  if (!running) {
    if (existingIndex >= 0) {
      state.activeSessions.splice(existingIndex, 1)
    }
    return
  }

  const stdout = readMetadataString(metadata, 'stdout')
  const stderr = readMetadataString(metadata, 'stderr')
  const nextSession: ActiveExecSession = {
    id: sessionId,
    command: readMetadataString(metadata, 'command') || fallbackCommand,
    cwd: readMetadataString(metadata, 'cwd'),
    pid: readMetadataNumber(metadata, 'pid'),
    status: readMetadataString(metadata, 'status') || 'running',
    lastOutput: firstString(stdout, stderr),
    updatedAt: Date.now()
  }

  if (existingIndex >= 0) {
    state.activeSessions[existingIndex] = {
      ...state.activeSessions[existingIndex],
      ...nextSession,
      lastOutput: nextSession.lastOutput || state.activeSessions[existingIndex].lastOutput
    }
    return
  }

  nextSession.startedAt = Date.now()
  state.activeSessions.push(nextSession)
}

function readMetadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function readMetadataNumber(metadata: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function extractChangedFiles(observation: TaskObservation): string[] {
  const files = new Set<string>()
  if (observation.path) {
    files.add(observation.path)
  }
  const rawFiles = observation.metadata?.files
    ?? observation.metadata?.changedFiles
    ?? observation.metadata?.changed_files
  if (Array.isArray(rawFiles)) {
    for (const file of rawFiles) {
      if (typeof file === 'string' && file.trim()) {
        files.add(file.trim())
      }
    }
  }

  const pathMatches = observation.summary.match(/(?:[\w.-]+\/)+[\w.-]+/g) ?? []
  for (const match of pathMatches.slice(0, 8)) {
    files.add(match)
  }
  return Array.from(files)
}

function looksLikeVerificationObservation(observation: TaskObservation): boolean {
  if (observation.kind !== 'command' || observation.status !== 'success') {
    return false
  }
  return looksLikeVerificationText(observation.summary)
}

function removeMatchingVerification(items: string[], summary: string): void {
  if (items.length === 0 || !looksLikeVerificationText(summary)) {
    return
  }
  items.splice(0, items.length)
}

function looksLikeVerificationText(value: string): boolean {
  return /\b(test|build|check|lint|typecheck|tsc|vitest|jest|playwright)\b/i.test(value)
}

function hasAnyKey(value: unknown, keys: string[]): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  return keys.some(key => Object.prototype.hasOwnProperty.call(record, key))
    || Boolean(record.result && typeof record.result === 'object' && keys.some(key => Object.prototype.hasOwnProperty.call(record.result as Record<string, unknown>, key)))
}

function hasInlineImage(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }
  if (Array.isArray(value)) {
    return value.some(item => hasInlineImage(item))
  }
  const record = value as Record<string, unknown>
  for (const [key, child] of Object.entries(record)) {
    if (isInlineImageKey(key) && typeof child === 'string' && child.length > 80) {
      return true
    }
    if (child && typeof child === 'object' && hasInlineImage(child)) {
      return true
    }
  }
  return false
}

function stripInlineImages(value: unknown): unknown {
  const seenObjects = new WeakSet<object>()
  const visit = (item: unknown): unknown => {
    if (!item || typeof item !== 'object') {
      return item
    }
    if (seenObjects.has(item)) {
      return '[Circular]'
    }
    seenObjects.add(item)
    if (Array.isArray(item)) {
      return item.map(child => visit(child))
    }
    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      output[key] = isInlineImageKey(key) && typeof child === 'string'
        ? `[omitted ${child.length} base64 chars]`
        : visit(child)
    }
    return output
  }
  return visit(value)
}

function isInlineImageKey(key: string): boolean {
  return key === 'image_base64'
    || key === 'screenshot_base64'
    || key === 'annotated_image_base64'
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }
  return undefined
}

function readNestedString(value: unknown, path: string[]): string | undefined {
  const nested = readNestedValue(value, path)
  return typeof nested === 'string' && nested.trim() ? nested : undefined
}

function readNestedValue(value: unknown, path: string[]): unknown {
  let current = value
  for (const key of path) {
    if (!current || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function truncateText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxLength) {
    return compact
  }
  return `${compact.slice(0, maxLength - 1)}…`
}

function cleanStateText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}
