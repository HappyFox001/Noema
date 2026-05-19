/**
 * Helpers for converting common runtime outputs into work surface components.
 */
import type {
  ArtifactGrid,
  ChartView,
  ComponentNode,
  DataTable,
  MarkdownBlock,
  RuntimeBinding,
} from './types.js'

export interface ResultRenderOptions {
  idPrefix?: string
  title?: string
  bindings?: RuntimeBinding[]
  maxRows?: number
}

export function resultToComponent(result: unknown, options: ResultRenderOptions = {}): ComponentNode {
  const idPrefix = sanitizeId(options.idPrefix ?? 'result')
  const bindings = options.bindings ?? []

  if (typeof result === 'string') {
    return createMarkdownComponent(`${idPrefix}-markdown`, result, options.title, bindings)
  }

  if (Array.isArray(result)) {
    if (result.every(value => typeof value === 'number')) {
      return createChartComponent(`${idPrefix}-chart`, result as number[], options.title, bindings)
    }
    if (result.every(isRecord)) {
      return createTableComponent(
        `${idPrefix}-table`,
        result as Array<Record<string, unknown>>,
        options.title,
        bindings,
        options.maxRows
      )
    }
    return createMarkdownComponent(`${idPrefix}-list`, JSON.stringify(result, null, 2), options.title, bindings)
  }

  if (isRecord(result)) {
    const path = extractPath(result)
    if (path) {
      return createArtifactComponent(`${idPrefix}-artifact`, path, options.title, bindings)
    }

    const rows = Object.entries(result).map(([key, value]) => ({ key, value: formatCellValue(value) }))
    return createTableComponent(`${idPrefix}-object`, rows, options.title, bindings, options.maxRows)
  }

  return createMarkdownComponent(`${idPrefix}-value`, String(result ?? ''), options.title, bindings)
}

function createChartComponent(
  id: string,
  values: number[],
  title?: string,
  bindings?: RuntimeBinding[]
): ChartView {
  return {
    id,
    kind: 'chart',
    title,
    bindings,
    chart: {
      type: 'line',
      xKey: 'index',
      yKey: 'value',
      data: values.slice(0, 200).map((value, index) => ({ index, value })),
    },
  }
}

function createMarkdownComponent(
  id: string,
  markdown: string,
  title?: string,
  bindings?: RuntimeBinding[]
): MarkdownBlock {
  return {
    id,
    kind: 'markdown',
    title,
    markdown,
    bindings,
  }
}

function createTableComponent(
  id: string,
  records: Array<Record<string, unknown>>,
  title?: string,
  bindings?: RuntimeBinding[],
  maxRows = 100
): DataTable {
  const visibleRows = records.slice(0, Math.max(1, maxRows))
  const columnIds = Array.from(new Set(visibleRows.flatMap(record => Object.keys(record)))).slice(0, 12)
  return {
    id,
    kind: 'table',
    title,
    bindings,
    selectionMode: 'single',
    columns: columnIds.map(columnId => ({
      id: columnId,
      label: humanizeKey(columnId),
      type: inferColumnType(columnId, visibleRows.map(row => row[columnId])),
      sortable: true,
    })),
    rows: visibleRows.map((record, index) => ({
      id: `${id}-row-${index + 1}`,
      cells: Object.fromEntries(columnIds.map(columnId => [columnId, formatCellValue(record[columnId])])),
      bindings,
    })),
  }
}

function createArtifactComponent(
  id: string,
  path: string,
  title?: string,
  bindings?: RuntimeBinding[]
): ArtifactGrid {
  return {
    id,
    kind: 'artifacts',
    title,
    bindings,
    artifacts: [{
      id: `${id}-item-1`,
      title: title ?? path.split('/').pop() ?? path,
      path,
      kind: inferArtifactKind(path),
      bindings: bindings?.length ? [{ kind: 'file', path }, ...bindings] : [{ kind: 'file', path }],
    }],
  }
}

function extractPath(record: Record<string, unknown>): string | null {
  for (const key of ['path', 'filePath', 'filename', 'src']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }
  return null
}

function inferColumnType(columnId: string, values: unknown[]): DataTable['columns'][number]['type'] {
  const normalized = columnId.toLowerCase()
  if (normalized.includes('date') || normalized.includes('time')) return 'date'
  if (normalized.includes('status') || normalized.includes('state')) return 'status'
  if (normalized.includes('path') || normalized.includes('file')) return 'file'
  if (normalized.includes('url') || normalized.includes('link')) return 'link'
  if (values.some(value => typeof value === 'number')) return 'number'
  return 'text'
}

function inferArtifactKind(path: string): ArtifactGrid['artifacts'][number]['kind'] {
  const lower = path.toLowerCase()
  if (/\.(png|jpg|jpeg|gif|webp|svg)$/.test(lower)) return 'image'
  if (/\.(md|pdf|docx|pptx|xlsx|html)$/.test(lower)) return 'report'
  return 'file'
}

function formatCellValue(value: unknown): unknown {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return JSON.stringify(value)
}

function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, char => char.toUpperCase())
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'result'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
