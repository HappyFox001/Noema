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

export function normalizeGamePanelStyle(data: Record<string, unknown>, fallbackSource: string): ChatGamePanelStyle {
  const style = getGamePanelStyleRecord(data)
  const fallback = createFallbackGamePanelStyle(fallbackSource)
  const radiusPx = readFiniteNumber(style.radiusPx)
  const cellRadiusPx = readFiniteNumber(style.cellRadiusPx)
  return {
    frame: enumValue(style.frame, ['glass', 'dossier', 'ritual', 'noir', 'intimate', 'mist'], fallback.frame),
    density: enumValue(style.density, ['compact', 'balanced', 'airy'], fallback.density),
    meter: enumValue(style.meter, ['capsule', 'line', 'etched', 'warm-bar'], fallback.meter),
    accent: sanitizeCssColor(stringValue(style.accent)) || fallback.accent,
    accentSoft: sanitizeCssColor(stringValue(style.accentSoft)) || fallback.accentSoft,
    surface: sanitizeCssColor(stringValue(style.surface)) || fallback.surface,
    surfaceAlt: sanitizeCssColor(stringValue(style.surfaceAlt)) || fallback.surfaceAlt,
    track: sanitizeCssColor(stringValue(style.track)) || fallback.track,
    border: sanitizeCssColor(stringValue(style.border)) || fallback.border,
    text: sanitizeCssColor(stringValue(style.text)) || fallback.text,
    muted: sanitizeCssColor(stringValue(style.muted)) || fallback.muted,
    radiusPx: clampNumber(radiusPx ?? fallback.radiusPx, 8, 28),
    cellRadiusPx: clampNumber(cellRadiusPx ?? fallback.cellRadiusPx, 6, 24),
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

function createFallbackGamePanelStyle(source: string): ChatGamePanelStyle {
  const seed = hashText(source)
  const hue = normalizeHue(seed % 360)
  const surfaceHue = normalizeHue(hue + 212)
  const saturation = 38 + (seed % 28)
  const accentLightness = 54 + (seed % 14)
  const frameOptions: ChatGamePanelStyle['frame'][] = ['glass', 'dossier', 'ritual', 'noir', 'intimate', 'mist']
  const densityOptions: ChatGamePanelStyle['density'][] = ['compact', 'balanced', 'airy']
  const meterOptions: ChatGamePanelStyle['meter'][] = ['capsule', 'line', 'etched', 'warm-bar']
  const frame = frameOptions[seed % frameOptions.length] ?? 'glass'
  const radiusPx = frame === 'dossier' || frame === 'noir' ? 10 : frame === 'mist' || frame === 'intimate' ? 20 : 14
  return {
    frame,
    density: densityOptions[Math.floor(seed / 7) % densityOptions.length] ?? 'balanced',
    meter: meterOptions[Math.floor(seed / 13) % meterOptions.length] ?? 'capsule',
    accent: `hsl(${hue} ${saturation}% ${accentLightness}%)`,
    accentSoft: `hsla(${hue} ${saturation}% ${accentLightness}% / 0.17)`,
    surface: `hsla(${surfaceHue} 18% 8% / 0.88)`,
    surfaceAlt: `hsla(${normalizeHue(surfaceHue + 22)} 22% 14% / 0.54)`,
    track: `hsla(${surfaceHue} 14% 82% / 0.14)`,
    border: `hsla(${hue} ${saturation}% ${accentLightness}% / 0.26)`,
    text: `hsla(${surfaceHue} 18% 92% / 0.88)`,
    muted: `hsla(${surfaceHue} 14% 78% / 0.58)`,
    radiusPx,
    cellRadiusPx: Math.max(7, radiusPx - 4),
  }
}

function hashText(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function normalizeHue(value: number): number {
  return Math.round(((value % 360) + 360) % 360)
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
