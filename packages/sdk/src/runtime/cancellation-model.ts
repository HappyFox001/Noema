/**
 * Records cancellation intent separately from task state mutation.
 */
import { generateId } from '../utils/index.js'
import type { RuntimeEventBus } from './events.js'

export type CancellationKind =
  | 'output'
  | 'user_interruption'
  | 'task_pause'
  | 'task_cancel'
  | 'tool_abort'

export interface CancellationRecord {
  id: string
  kind: CancellationKind
  threadId?: string
  taskId?: string
  toolCallId?: string
  commandSessionId?: string
  reason: string
  createdAt: number
  backgroundCommands: BackgroundCommandFact[]
}

export interface BackgroundCommandFact {
  sessionId: string
  command: string
  status: 'running' | 'interrupting' | 'cancelled' | 'completed' | 'failed'
  recordedAt: number
}

export interface CancellationModelOptions {
  events: RuntimeEventBus
}

export class CancellationModel {
  private records: CancellationRecord[] = []
  private controllers = new Map<string, AbortController>()
  private backgroundCommands = new Map<string, BackgroundCommandFact>()

  constructor(private options: CancellationModelOptions) {}

  createAbortSignal(scopeId: string): AbortSignal {
    const controller = new AbortController()
    this.controllers.set(scopeId, controller)
    return controller.signal
  }

  requestOutputCancellation(reason: string, threadId?: string, taskId?: string): CancellationRecord {
    return this.record('output', reason, { threadId, taskId })
  }

  recordUserInterruption(reason: string, threadId?: string, taskId?: string): CancellationRecord {
    return this.record('user_interruption', reason, { threadId, taskId })
  }

  pauseTask(taskId: string, reason: string, threadId?: string): CancellationRecord {
    return this.record('task_pause', reason, { threadId, taskId })
  }

  cancelTask(taskId: string, reason: string, threadId?: string): CancellationRecord {
    const record = this.record('task_cancel', reason, { threadId, taskId })
    this.abortScope(taskId, reason)
    return record
  }

  abortTool(taskId: string, toolCallId: string, reason: string, threadId?: string): CancellationRecord {
    const record = this.record('tool_abort', reason, { threadId, taskId, toolCallId })
    this.abortScope(toolCallId, reason)
    return record
  }

  recordBackgroundCommand(sessionId: string, command: string, status: BackgroundCommandFact['status'] = 'running'): BackgroundCommandFact {
    const fact: BackgroundCommandFact = {
      sessionId,
      command,
      status,
      recordedAt: Date.now(),
    }
    this.backgroundCommands.set(sessionId, fact)
    return { ...fact }
  }

  updateBackgroundCommand(sessionId: string, status: BackgroundCommandFact['status']): BackgroundCommandFact | undefined {
    const existing = this.backgroundCommands.get(sessionId)
    if (!existing) {
      return undefined
    }
    const updated = {
      ...existing,
      status,
      recordedAt: Date.now(),
    }
    this.backgroundCommands.set(sessionId, updated)
    return { ...updated }
  }

  getRecords(): CancellationRecord[] {
    return this.records.map(record => ({
      ...record,
      backgroundCommands: record.backgroundCommands.map(command => ({ ...command })),
    }))
  }

  getBackgroundCommands(): BackgroundCommandFact[] {
    return [...this.backgroundCommands.values()].map(command => ({ ...command }))
  }

  private abortScope(scopeId: string, reason: string): void {
    const controller = this.controllers.get(scopeId)
    if (!controller || controller.signal.aborted) {
      return
    }
    controller.abort(reason)
  }

  private record(
    kind: CancellationKind,
    reason: string,
    fields: Pick<CancellationRecord, 'threadId' | 'taskId' | 'toolCallId' | 'commandSessionId'>,
  ): CancellationRecord {
    const record: CancellationRecord = {
      id: generateId(),
      kind,
      threadId: fields.threadId,
      taskId: fields.taskId,
      toolCallId: fields.toolCallId,
      commandSessionId: fields.commandSessionId,
      reason,
      createdAt: Date.now(),
      backgroundCommands: this.getBackgroundCommands(),
    }
    this.records.push(record)
    this.options.events.emit({
      name: 'task.cancellation.recorded',
      threadId: record.threadId,
      taskId: record.taskId,
      payload: {
        id: record.id,
        kind: record.kind,
        reason: record.reason,
        toolCallId: record.toolCallId,
        commandSessionId: record.commandSessionId,
        backgroundCommands: record.backgroundCommands,
      },
    })
    return {
      ...record,
      backgroundCommands: record.backgroundCommands.map(command => ({ ...command })),
    }
  }
}
