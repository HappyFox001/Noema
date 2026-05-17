/**
 * Async job manager for internal runtime capabilities.
 */
import { generateId } from '@her-text/core'
import type { RuntimeEventBus } from './events.js'

export type RuntimeJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface RuntimeJobRecord<TInput = unknown, TResult = unknown> {
  id: string
  kind: string
  status: RuntimeJobStatus
  input: TInput
  result?: TResult
  error?: string
  createdAt: number
  updatedAt: number
  startedAt?: number
  completedAt?: number
}

export interface RuntimeJobContext<TInput = unknown> {
  job: RuntimeJobRecord<TInput>
  signal: AbortSignal
}

export type RuntimeJobHandler<TInput = unknown, TResult = unknown> = (
  input: TInput,
  context: RuntimeJobContext<TInput>
) => Promise<TResult> | TResult

export type RuntimeJobUnregister = () => void

interface RuntimeJobEntry {
  record: RuntimeJobRecord
  controller: AbortController
  listeners: Array<(record: RuntimeJobRecord) => void>
}

export class RuntimeJobManager {
  private handlers = new Map<string, RuntimeJobHandler>()
  private jobs = new Map<string, RuntimeJobEntry>()
  private pending: RuntimeJobEntry[] = []
  private active: RuntimeJobEntry | null = null
  private drainPromise: Promise<void> | null = null

  constructor(private readonly runtimeEvents?: RuntimeEventBus) {}

  register<TInput = unknown, TResult = unknown>(
    kind: string,
    handler: RuntimeJobHandler<TInput, TResult>
  ): RuntimeJobUnregister {
    this.handlers.set(kind, handler as RuntimeJobHandler)
    return () => {
      if (this.handlers.get(kind) === handler) {
        this.handlers.delete(kind)
      }
    }
  }

  submit<TInput = unknown>(kind: string, input: TInput): RuntimeJobRecord<TInput> {
    if (!this.handlers.has(kind)) {
      throw new Error(`Runtime job handler is not registered: ${kind}`)
    }

    const now = Date.now()
    const entry: RuntimeJobEntry = {
      record: {
        id: generateId(),
        kind,
        status: 'queued',
        input,
        createdAt: now,
        updatedAt: now,
      },
      controller: new AbortController(),
      listeners: [],
    }
    this.jobs.set(entry.record.id, entry)
    this.pending.push(entry)
    this.emitJobEvent('runtime.job.queued', entry.record)
    this.drain()
    return entry.record as RuntimeJobRecord<TInput>
  }

  get(id: string): RuntimeJobRecord | null {
    return this.jobs.get(id)?.record ?? null
  }

  list(status?: RuntimeJobStatus): RuntimeJobRecord[] {
    return Array.from(this.jobs.values())
      .map(entry => entry.record)
      .filter(job => !status || job.status === status)
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }

  cancel(id: string, reason = 'Runtime job cancelled'): boolean {
    const entry = this.jobs.get(id)
    if (!entry || entry.record.status === 'completed' || entry.record.status === 'failed' || entry.record.status === 'cancelled') {
      return false
    }

    entry.controller.abort(reason)
    if (entry.record.status === 'queued') {
      this.pending = this.pending.filter(item => item.record.id !== id)
      this.updateRecord(entry, {
        status: 'cancelled',
        error: reason,
        completedAt: Date.now(),
      })
      this.emitJobEvent('runtime.job.cancelled', entry.record)
    }
    return true
  }

  async waitForIdle(): Promise<void> {
    await this.drainPromise
  }

  async waitForJob<TResult = unknown>(id: string): Promise<RuntimeJobRecord<unknown, TResult>> {
    const entry = this.jobs.get(id)
    if (!entry) {
      throw new Error(`Runtime job not found: ${id}`)
    }
    if (isTerminalStatus(entry.record.status)) {
      return entry.record as RuntimeJobRecord<unknown, TResult>
    }

    return new Promise((resolve) => {
      entry.listeners.push((record) => {
        if (isTerminalStatus(record.status)) {
          resolve(record as RuntimeJobRecord<unknown, TResult>)
        }
      })
    })
  }

  private drain(): void {
    if (this.drainPromise) {
      return
    }

    this.drainPromise = this.runPending()
      .catch((error) => {
        console.warn('[RuntimeJobManager] Drain failed:', formatJobError(error))
      })
      .finally(() => {
        this.drainPromise = null
        if (this.pending.length > 0) {
          this.drain()
        }
      })
  }

  private async runPending(): Promise<void> {
    while (!this.active && this.pending.length > 0) {
      const entry = this.pending.shift()
      if (!entry) {
        return
      }

      const handler = this.handlers.get(entry.record.kind)
      if (!handler) {
        this.updateRecord(entry, {
          status: 'failed',
          error: `Runtime job handler is no longer registered: ${entry.record.kind}`,
          completedAt: Date.now(),
        })
        this.emitJobEvent('runtime.job.failed', entry.record)
        continue
      }

      this.active = entry
      this.updateRecord(entry, {
        status: 'running',
        startedAt: Date.now(),
      })
      this.emitJobEvent('runtime.job.running', entry.record)

      try {
        const result = await handler(entry.record.input, {
          job: entry.record,
          signal: entry.controller.signal,
        })
        if (entry.controller.signal.aborted) {
          this.updateRecord(entry, {
            status: 'cancelled',
            error: formatAbortReason(entry.controller.signal.reason),
            completedAt: Date.now(),
          })
          this.emitJobEvent('runtime.job.cancelled', entry.record)
        } else {
          this.updateRecord(entry, {
            status: 'completed',
            result,
            completedAt: Date.now(),
          })
          this.emitJobEvent('runtime.job.completed', entry.record)
        }
      } catch (error) {
        this.updateRecord(entry, {
          status: entry.controller.signal.aborted ? 'cancelled' : 'failed',
          error: formatJobError(error),
          completedAt: Date.now(),
        })
        this.emitJobEvent(
          entry.record.status === 'cancelled' ? 'runtime.job.cancelled' : 'runtime.job.failed',
          entry.record
        )
      } finally {
        this.active = null
      }
    }
  }

  private updateRecord(entry: RuntimeJobEntry, patch: Partial<RuntimeJobRecord>): void {
    entry.record = {
      ...entry.record,
      ...patch,
      updatedAt: Date.now(),
    }
    this.jobs.set(entry.record.id, entry)
    for (const listener of entry.listeners) {
      listener(entry.record)
    }
    if (isTerminalStatus(entry.record.status)) {
      entry.listeners = []
    }
  }

  private emitJobEvent(name: RuntimeJobEventName, record: RuntimeJobRecord): void {
    const base = {
      jobId: record.id,
      kind: record.kind,
    }

    if (name === 'runtime.job.queued') {
      this.runtimeEvents?.emit({ name, payload: { ...base, status: 'queued' } })
    } else if (name === 'runtime.job.running') {
      this.runtimeEvents?.emit({ name, payload: { ...base, status: 'running' } })
    } else if (name === 'runtime.job.completed') {
      this.runtimeEvents?.emit({ name, payload: { ...base, status: 'completed' } })
    } else if (name === 'runtime.job.failed') {
      this.runtimeEvents?.emit({
        name,
        payload: { ...base, status: 'failed', ...(record.error ? { error: record.error } : {}) },
      })
    } else {
      this.runtimeEvents?.emit({
        name,
        payload: { ...base, status: 'cancelled', ...(record.error ? { error: record.error } : {}) },
      })
    }
  }
}

type RuntimeJobEventName =
  | 'runtime.job.queued'
  | 'runtime.job.running'
  | 'runtime.job.completed'
  | 'runtime.job.failed'
  | 'runtime.job.cancelled'

function formatJobError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatAbortReason(reason: unknown): string {
  return typeof reason === 'string' ? reason : 'Runtime job cancelled'
}

function isTerminalStatus(status: RuntimeJobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}
