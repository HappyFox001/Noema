export function normalizeUrl(rawUrl) {
  const value = String(rawUrl || '').trim()
  if (!value) {
    throw new Error('URL is required')
  }
  if (/^https?:\/\//i.test(value)) {
    return value
  }
  return `https://${value}`
}

export function parseDomains(value) {
  return value
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
}

export function domainMatches(hostname, pattern) {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2)
    return hostname === suffix || hostname.endsWith(`.${suffix}`)
  }
  return hostname === pattern || hostname.endsWith(`.${pattern}`)
}

export function normalizeModifier(value) {
  const key = String(value || '').toLowerCase()
  if (key === 'cmd' || key === 'command' || key === 'meta') return 'meta'
  if (key === 'ctrl' || key === 'control') return 'control'
  if (key === 'alt' || key === 'option') return 'alt'
  if (key === 'shift') return 'shift'
  return undefined
}

export function normalizeKey(value) {
  const lower = String(value || '').toLowerCase()
  const aliases = {
    enter: 'Enter',
    escape: 'Escape',
    esc: 'Escape',
    tab: 'Tab',
    backspace: 'Backspace',
    delete: 'Delete',
    space: 'Space',
    arrowup: 'ArrowUp',
    arrowdown: 'ArrowDown',
    arrowleft: 'ArrowLeft',
    arrowright: 'ArrowRight',
  }
  return aliases[lower] || String(value || '')
}

export function getPlatformSelectModifier() {
  return process.platform === 'darwin' ? 'Meta' : 'Control'
}

export function clampInteger(value, min, max) {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.max(min, Math.min(max, Math.round(value)))
}

export function truncate(value, maxChars) {
  const text = String(value ?? '')
  if (text.length <= maxChars) {
    return text
  }
  return `${text.slice(0, maxChars)}...`
}
