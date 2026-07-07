/**
 * Sanitizes generated atmosphere CSS before injecting it into the chat surface.
 */

export function sanitizeAtmosphereScopeClass(value: string | undefined): string {
  const normalized = String(value || '').trim()
  return /^noema-atmosphere-[a-z0-9_-]+$/.test(normalized) ? normalized : ''
}

export function sanitizeAtmosphereCss(css: string | undefined, scopeClass: string): string {
  if (!css || !scopeClass || !css.includes(`.${scopeClass}`)) {
    return ''
  }
  const blocked = /@import|@font-face|@keyframes|url\s*\(|position\s*:\s*fixed|<\/style/i
  if (blocked.test(css)) {
    return ''
  }
  return sanitizeCssRuleList(stripCssComments(css), scopeClass).trim()
}

function sanitizeCssRuleList(css: string, scopeClass: string): string {
  const rules: string[] = []
  let index = 0
  while (index < css.length) {
    const open = css.indexOf('{', index)
    if (open < 0) {
      break
    }
    const prelude = css.slice(index, open).trim()
    const close = findMatchingCssBrace(css, open)
    if (close < 0) {
      break
    }
    const body = css.slice(open + 1, close).trim()
    index = close + 1
    if (!prelude || !body) {
      continue
    }
    if (prelude.startsWith('@')) {
      const atRule = prelude.toLowerCase()
      if (!atRule.startsWith('@media') && !atRule.startsWith('@supports')) {
        continue
      }
      const nested = sanitizeCssRuleList(body, scopeClass)
      if (nested) {
        rules.push(`${prelude}{${nested}}`)
      }
      continue
    }
    const selectors = splitCssSelectorList(prelude)
      .map((selector) => selector.trim())
      .filter((selector) => isScopedAtmosphereSelector(selector, scopeClass))
    if (selectors.length) {
      rules.push(`${selectors.join(', ')}{${body}}`)
    }
  }
  return rules.join('\n')
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function findMatchingCssBrace(css: string, openIndex: number): number {
  let depth = 0
  for (let index = openIndex; index < css.length; index += 1) {
    const char = css[index]
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return index
      }
    }
  }
  return -1
}

function splitCssSelectorList(selectorList: string): string[] {
  const selectors: string[] = []
  let current = ''
  let depth = 0
  for (const char of selectorList) {
    if (char === '(' || char === '[') {
      depth += 1
    } else if (char === ')' || char === ']') {
      depth = Math.max(0, depth - 1)
    }
    if (char === ',' && depth === 0) {
      selectors.push(current)
      current = ''
      continue
    }
    current += char
  }
  selectors.push(current)
  return selectors
}

function isScopedAtmosphereSelector(selector: string, scopeClass: string): boolean {
  const normalized = selector.trim()
  const scopePrefix = `.${scopeClass}`
  if (normalized === scopePrefix) {
    return true
  }
  if (!normalized.startsWith(scopePrefix)) {
    return false
  }
  if (normalized.includes('.chat-inline-game') || normalized.includes('.chat-inline-equipment')) {
    return false
  }
  const remainder = normalized.slice(scopePrefix.length)
  if (!/[\s>+~]/.test(remainder)) {
    return remainder.startsWith('.') || remainder.startsWith(':')
  }
  return [
    '.roleplay-chat',
    '.chat-message',
    '.chat-inline-',
  ].some((token) => normalized.includes(token))
}
