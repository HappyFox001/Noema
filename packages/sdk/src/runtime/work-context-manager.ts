/**
 * Maintains model-visible task context with compaction and reinjection support.
 */
import type { RuntimeEventBus } from './events.js'

export type WorkContextRole = 'system' | 'user' | 'assistant' | 'tool'
export type WorkContextCompactionPhase = 'pre_turn' | 'mid_turn'

export interface WorkContextItem {
  id: string
  role: WorkContextRole
  content: string
  createdAt: number
  toolName?: string
  toolCallId?: string
  images?: WorkContextImage[]
  metadata?: Record<string, unknown>
}

export interface WorkContextImage {
  url?: string
  path?: string
  mimeType?: string
  note?: string
}

export interface WorkContextSnapshot {
  items: WorkContextItem[]
  compactedSummaries: WorkContextCompaction[]
  version: number
}

export interface WorkContextCompaction {
  id: string
  phase: WorkContextCompactionPhase
  summary: string
  removedItemIds: string[]
  createdAt: number
}

export interface WorkContextOptions {
  events?: RuntimeEventBus
  maxToolOutputChars?: number
  maxModelItems?: number
  taskId?: string
  threadId?: string
  taskDescription?: string
}

export interface WorkContextForModelOptions {
  includeImages?: boolean
  maxItems?: number
}

export class WorkContextManager {
  private items: WorkContextItem[] = []
  private compactedSummaries: WorkContextCompaction[] = []
  private version = 0
  private nextId = 1

  constructor(private options: WorkContextOptions = {}) {}

  addItem(item: Omit<WorkContextItem, 'id' | 'createdAt'> & { id?: string, createdAt?: number }): WorkContextItem {
    const normalized = this.normalizeItem(item)
    this.items.push(normalized)
    this.version += 1
    return { ...normalized }
  }

  addToolResult(toolName: string, toolCallId: string, result: unknown, metadata?: Record<string, unknown>): WorkContextItem {
    const normalized = normalizeToolResult(result, this.options.maxToolOutputChars ?? 6000)
    return this.addItem({
      role: 'tool',
      content: normalized.content,
      toolName,
      toolCallId,
      images: normalized.images,
      metadata,
    })
  }

  forModel(options: WorkContextForModelOptions = {}): WorkContextItem[] {
    const maxItems = options.maxItems ?? this.options.maxModelItems
    const visible = options.includeImages ? this.items : this.items.map(item => ({ ...item, images: undefined }))
    return (maxItems && visible.length > maxItems ? visible.slice(-maxItems) : visible).map(item => ({ ...item }))
  }

  compactPreTurn(maxItems: number): WorkContextCompaction | undefined {
    return this.compact('pre_turn', maxItems)
  }

  compactMidTurn(maxItems: number): WorkContextCompaction | undefined {
    return this.compact('mid_turn', maxItems)
  }

  reinject(summaryId?: string): WorkContextItem | undefined {
    const summary = summaryId
      ? this.compactedSummaries.find(item => item.id === summaryId)
      : this.compactedSummaries[this.compactedSummaries.length - 1]
    if (!summary) {
      return undefined
    }
    return this.addItem({
      role: 'system',
      content: `Recovered task context:\n${summary.summary}`,
      metadata: {
        reinjectedSummaryId: summary.id,
        compactionPhase: summary.phase,
      },
    })
  }

  createSnapshot(): WorkContextSnapshot {
    return {
      items: this.items.map(item => ({ ...item })),
      compactedSummaries: this.compactedSummaries.map(item => ({ ...item })),
      version: this.version,
    }
  }

  restoreSnapshot(snapshot: WorkContextSnapshot): void {
    this.items = snapshot.items.map(item => ({ ...item }))
    this.compactedSummaries = snapshot.compactedSummaries.map(item => ({ ...item }))
    this.version = snapshot.version + 1
  }

  private compact(phase: WorkContextCompactionPhase, maxItems: number): WorkContextCompaction | undefined {
    if (this.items.length <= maxItems) {
      return undefined
    }
    const keepCount = Math.max(1, maxItems)
    const removed = this.items.splice(0, this.items.length - keepCount)
    const compaction: WorkContextCompaction = {
      id: this.createId(),
      phase,
      summary: summarizeContextItems(removed),
      removedItemIds: removed.map(item => item.id),
      createdAt: Date.now(),
    }
    this.compactedSummaries.push(compaction)
    this.version += 1
    this.options.events?.emit({
      name: 'task.context.compacted',
      taskId: this.options.taskId,
      threadId: this.options.threadId,
      payload: {
        taskDescription: this.options.taskDescription ?? 'work task',
        summary: compaction.summary,
        reason: phase,
      },
    })
    return { ...compaction }
  }

  private normalizeItem(item: Omit<WorkContextItem, 'id' | 'createdAt'> & { id?: string, createdAt?: number }): WorkContextItem {
    return {
      ...item,
      id: item.id ?? this.createId(),
      createdAt: item.createdAt ?? Date.now(),
      content: item.content,
      images: item.images?.map(image => ({ ...image })),
      metadata: item.metadata ? { ...item.metadata } : undefined,
    }
  }

  private createId(): string {
    const id = `work_context_${this.nextId}`
    this.nextId += 1
    return id
  }
}

function normalizeToolResult(result: unknown, maxChars: number): { content: string, images?: WorkContextImage[] } {
  const images = collectImages(result)
  const content = truncateText(stripImagesToText(result), maxChars)
  return {
    content,
    images: images.length > 0 ? images : undefined,
  }
}

function collectImages(value: unknown): WorkContextImage[] {
  const images: WorkContextImage[] = []
  const visit = (item: unknown): void => {
    if (!item || typeof item !== 'object') {
      return
    }
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }
    const record = item as Record<string, unknown>
    const url = readString(record.url) ?? readString(record.imageUrl) ?? readString(record.dataUrl)
    const path = readString(record.path) ?? readString(record.filePath)
    const mimeType = readString(record.mimeType) ?? readString(record.mime)
    if (url || path) {
      images.push({
        url,
        path,
        mimeType,
        note: readString(record.note) ?? readString(record.description),
      })
    }
    for (const value of Object.values(record)) {
      visit(value)
    }
  }
  visit(value)
  return images
}

function stripImagesToText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value, (_key, nested) => {
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        const record = nested as Record<string, unknown>
        if (record.dataUrl || record.imageUrl) {
          return {
            ...record,
            dataUrl: record.dataUrl ? '[image data omitted]' : undefined,
            imageUrl: record.imageUrl ? '[image url omitted]' : undefined,
          }
        }
      }
      return nested
    })
  } catch {
    return String(value)
  }
}

function summarizeContextItems(items: WorkContextItem[]): string {
  return items
    .map(item => {
      const label = item.toolName ? `${item.role}:${item.toolName}` : item.role
      return `- ${label}: ${truncateText(item.content.replace(/\s+/g, ' '), 400)}`
    })
    .join('\n')
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text
  }
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
