/**
 * Desktop main-process log storage, persistence, and renderer streaming.
 */
import { dirname } from 'path'
import { mkdir, readFile, writeFile } from 'fs/promises'

export type AppLogLevel = 'debug' | 'info' | 'warn' | 'error'
export type AppLogType =
  | 'app'
  | 'asr'
  | 'audio'
  | 'conversation'
  | 'latency'
  | 'llm'
  | 'memory'
  | 'plugin'
  | 'settings'
  | 'task'
  | 'tts'
  | 'turn'
  | 'vad'

export type AppLogEntry = {
  id: number
  time: number
  level: AppLogLevel
  type: AppLogType
  message: string
}

export interface AppLogStoreOptions {
  sendToRenderer?: (channel: string, ...args: unknown[]) => void
  warn?: (...args: unknown[]) => void
}

export class AppLogStore {
  private entries: AppLogEntry[] = []
  private sequence = 0
  private readonly maxEntries = 1200
  private persistencePath: string | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null
  private pendingBroadcast: AppLogEntry[] = []
  private writeQueue: Promise<void> = Promise.resolve()
  private rendererStreaming = false

  constructor(private options: AppLogStoreOptions = {}) {}

  add(level: AppLogLevel, args: unknown[]): void {
    if (this.shouldSkip(level, args)) {
      return
    }

    const message = args.map(formatLogArg).join(' ')
    if (!message.trim()) {
      return
    }

    const entry: AppLogEntry = {
      id: ++this.sequence,
      time: Date.now(),
      level,
      type: inferLogType(message),
      message,
    }

    this.entries.push(entry)
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries)
    }

    this.queueBroadcast(entry)
    this.schedulePersist()
  }

  list(limit = this.maxEntries): AppLogEntry[] {
    return this.entries.slice(-Math.max(1, Math.min(this.maxEntries, limit)))
  }

  clear(): void {
    this.entries = []
    this.sequence = 0
    this.options.sendToRenderer?.('logs:cleared')
    this.schedulePersist(0)
  }

  setRendererStreaming(streaming: boolean): void {
    this.rendererStreaming = streaming
    if (!streaming && this.broadcastTimer) {
      clearTimeout(this.broadcastTimer)
      this.broadcastTimer = null
      this.pendingBroadcast = []
    }
  }

  async initializePersistence(filePath: string): Promise<void> {
    this.persistencePath = filePath
    await mkdir(dirname(filePath), { recursive: true })

    const bootEntries = this.entries
    let storedEntries: AppLogEntry[] = []
    try {
      const raw = await readFile(filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        storedEntries = parsed.filter(isAppLogEntry)
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        this.warn('[Logs] Failed to load persisted logs:', error.message ?? String(error))
      }
    }

    this.entries = [...storedEntries, ...bootEntries]
      .sort((a, b) => a.time - b.time || a.id - b.id)
      .slice(-this.maxEntries)
    this.sequence = this.entries.reduce((max, entry) => Math.max(max, entry.id), 0)
    await this.persistNow()
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    await this.persistNow()
    await this.writeQueue
  }

  private schedulePersist(delayMs = 250): void {
    if (!this.persistencePath) {
      return
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.persistNow()
    }, delayMs)
  }

  private persistNow(): Promise<void> {
    if (!this.persistencePath) {
      return Promise.resolve()
    }

    const filePath = this.persistencePath
    const data = JSON.stringify(this.entries.slice(-this.maxEntries))
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(() => writeFile(filePath, data, 'utf-8'))
      .catch((error) => {
        this.warn('[Logs] Failed to persist logs:', error instanceof Error ? error.message : String(error))
      })
    return this.writeQueue
  }

  private queueBroadcast(entry: AppLogEntry): void {
    if (!this.rendererStreaming || !this.options.sendToRenderer) {
      return
    }

    this.pendingBroadcast.push(entry)
    if (this.broadcastTimer) {
      return
    }

    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null
      const batch = this.pendingBroadcast
      this.pendingBroadcast = []
      if (batch.length === 1) {
        this.options.sendToRenderer?.('logs:new', batch[0])
        return
      }
      this.options.sendToRenderer?.('logs:batch', batch)
    }, 100)
  }

  private shouldSkip(level: AppLogLevel, args: unknown[]): boolean {
    if (process.env.HER_TEXT_VERBOSE_LOGS === '1') {
      return false
    }
    if (level === 'warn' || level === 'error') {
      return false
    }

    const first = typeof args[0] === 'string' ? args[0] : ''
    return isHighFrequencyLogMessage(first)
  }

  private warn(...args: unknown[]): void {
    this.options.warn?.(...args)
  }
}

function isHighFrequencyLogMessage(message: string): boolean {
  return (
    message.startsWith('[AudioPlayer]') ||
    message.startsWith('[VoiceRecorder]') ||
    message.startsWith('[Latency]') ||
    message.startsWith('[TTS] Audio chunk') ||
    message.startsWith('[UI] Received TTS audio') ||
    message.startsWith('[Main] TTS text frame') ||
    message.startsWith('[TaskRuntime] 迭代') ||
    message.startsWith('[TaskRuntime] 当前步骤') ||
    message.startsWith('[Turn] Started new turn') ||
    message.startsWith('[Playback] Requesting') ||
    message.startsWith('[Playback] Received complete')
  )
}

function isAppLogEntry(value: unknown): value is AppLogEntry {
  const item = value as Partial<AppLogEntry>
  return Boolean(
    item &&
    typeof item.id === 'number' &&
    typeof item.time === 'number' &&
    isAppLogLevel(item.level) &&
    isAppLogType(item.type) &&
    typeof item.message === 'string'
  )
}

function isAppLogLevel(value: unknown): value is AppLogLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error'
}

function isAppLogType(value: unknown): value is AppLogType {
  return (
    value === 'app' ||
    value === 'asr' ||
    value === 'audio' ||
    value === 'conversation' ||
    value === 'latency' ||
    value === 'llm' ||
    value === 'memory' ||
    value === 'plugin' ||
    value === 'settings' ||
    value === 'task' ||
    value === 'tts' ||
    value === 'turn' ||
    value === 'vad'
  )
}

function formatLogArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.stack || arg.message
  }
  if (typeof arg === 'string') {
    return arg
  }
  if (typeof arg === 'number' || typeof arg === 'boolean' || arg === null || arg === undefined) {
    return String(arg)
  }
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

function inferLogType(message: string): AppLogType {
  const tag = message.match(/^\[([^\]]+)\]/)?.[1]?.toLowerCase() ?? ''
  if (tag.includes('latency')) return 'latency'
  if (tag.includes('tts') || tag.includes('fish')) return 'tts'
  if (tag.includes('asr') || tag.includes('speech') || tag.includes('qwen')) return 'asr'
  if (tag.includes('vad') || tag.includes('smartturn') || tag.includes('smart turn')) return 'vad'
  if (tag.includes('turn')) return 'turn'
  if (tag.includes('task')) return 'task'
  if (tag.includes('plugin')) return 'plugin'
  if (tag.includes('memory')) return 'memory'
  if (tag.includes('llm')) return 'llm'
  if (tag.includes('audio') || tag.includes('playback')) return 'audio'
  if (tag.includes('settings') || tag.includes('env') || tag.includes('models')) return 'settings'
  if (tag.includes('conversation') || tag.includes('chat')) return 'conversation'
  return 'app'
}
