/**
 * Normalizes generated game panel style tokens for chat and workflow previews.
 */

export interface ChatGamePanelStyle {
  frame: 'glass' | 'dossier' | 'ritual' | 'noir' | 'intimate' | 'mist'
  density: 'compact' | 'balanced' | 'airy'
  meter: 'capsule' | 'line' | 'etched' | 'warm-bar'
  accent: string
  accentSoft: string
  surface: string
  surfaceAlt: string
  track: string
  border: string
  text: string
  muted: string
  radiusPx: number
  cellRadiusPx: number
}

export function getGamePanelStyleRecord(data: Record<string, unknown>): Record<string, unknown> {
  const direct = objectRecordValue(data.panelStyle)
  if (Object.keys(direct).length) {
    return direct
  }
  const uiStyle = objectRecordValue(objectRecordValue(data.ui).panelStyle)
  if (Object.keys(uiStyle).length) {
    return uiStyle
  }
  return objectRecordValue(objectRecordValue(objectRecordValue(data.sections).cssDesign).panelStyle)
}

export function normalizeGamePanelStyle(data: Record<string, unknown>): ChatGamePanelStyle | null {
  const style = getGamePanelStyleRecord(data)
  if (!Object.keys(style).length) {
    return null
  }
  const radiusPx = readFiniteNumber(style.radiusPx)
  const cellRadiusPx = readFiniteNumber(style.cellRadiusPx)
  return {
    frame: enumValue(style.frame, ['glass', 'dossier', 'ritual', 'noir', 'intimate', 'mist'], 'glass'),
    density: enumValue(style.density, ['compact', 'balanced', 'airy'], 'balanced'),
    meter: enumValue(style.meter, ['capsule', 'line', 'etched', 'warm-bar'], 'capsule'),
    accent: sanitizeCssColor(stringValue(style.accent)) || '#c7d8d0',
    accentSoft: sanitizeCssColor(stringValue(style.accentSoft)) || 'rgba(199, 216, 208, 0.16)',
    surface: sanitizeCssColor(stringValue(style.surface)) || 'rgba(12, 15, 14, 0.76)',
    surfaceAlt: sanitizeCssColor(stringValue(style.surfaceAlt)) || 'rgba(39, 71, 46, 0.28)',
    track: sanitizeCssColor(stringValue(style.track)) || 'rgba(255, 255, 255, 0.11)',
    border: sanitizeCssColor(stringValue(style.border)) || 'rgba(159, 199, 185, 0.18)',
    text: sanitizeCssColor(stringValue(style.text)) || 'rgba(248, 250, 250, 0.84)',
    muted: sanitizeCssColor(stringValue(style.muted)) || 'rgba(220, 229, 226, 0.62)',
    radiusPx: clampNumber(radiusPx ?? 12, 8, 28),
    cellRadiusPx: clampNumber(cellRadiusPx ?? 9, 6, 24),
  }
}

export function renderGamePanelClassNames(style: ChatGamePanelStyle, baseClass: string): string {
  return [
    baseClass,
    'has-game-panel-style',
    `game-panel-frame-${style.frame}`,
    `game-panel-density-${style.density}`,
    `game-panel-meter-${style.meter}`,
  ].join(' ')
}

export function renderGamePanelInlineStyle(style: ChatGamePanelStyle): string {
  return [
    `--game-panel-accent:${style.accent}`,
    `--game-panel-accent-soft:${style.accentSoft}`,
    `--game-panel-surface:${style.surface}`,
    `--game-panel-surface-alt:${style.surfaceAlt}`,
    `--game-panel-track:${style.track}`,
    `--game-panel-border:${style.border}`,
    `--game-panel-text:${style.text}`,
    `--game-panel-muted:${style.muted}`,
    `--game-panel-radius:${Math.round(style.radiusPx)}px`,
    `--game-panel-cell-radius:${Math.round(style.cellRadiusPx)}px`,
  ].join(';')
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function objectRecordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? value as T
    : fallback
}

function readFiniteNumber(value: unknown): number | null {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(numberValue) ? numberValue : null
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function sanitizeCssColor(value: string): string {
  const trimmed = value.trim()
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) {
    return trimmed
  }
  if (/^hsla?\(\s*[\d.]+(?:deg|rad|turn)?\s+[\d.]+%\s+[\d.]+%(?:\s*\/\s*(?:[\d.]+|[\d.]+%))?\s*\)$/i.test(trimmed)) {
    return trimmed
  }
  if (/^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?(?:\s*,\s*[\d.]+)?\s*\)$/i.test(trimmed)) {
    return trimmed
  }
  return ''
}
