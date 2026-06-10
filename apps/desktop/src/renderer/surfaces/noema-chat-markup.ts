/**
 * Renders the Noema chat markup protocol into safe chat message HTML.
 */
export interface NoemaMarkupRenderOptions {
  escapeHtml(value: string): string
}

interface NoemaTagMatch {
  index: number
  length: number
  name: 'section' | 'card' | 'code'
  attrs: Record<string, string>
}

export function hasNoemaChatMarkup(value: string): boolean {
  return /<noema_chat\b/i.test(value)
}

export function renderNoemaChatMarkup(value: string, options: NoemaMarkupRenderOptions): string {
  const reply = extractNoemaReply(value)
  if (!reply.trim()) {
    return ''
  }
  return renderNoemaBlocks(reply, options)
}

function extractNoemaReply(value: string): string {
  const replyOpen = /<reply\b[^>]*>/i.exec(value)
  if (replyOpen) {
    const start = replyOpen.index + replyOpen[0].length
    const close = value.slice(start).search(/<\/reply>/i)
    return close >= 0 ? value.slice(start, start + close) : value.slice(start)
  }

  const rootOpen = /<noema_chat\b[^>]*>/i.exec(value)
  if (!rootOpen) {
    return value
  }
  const start = rootOpen.index + rootOpen[0].length
  const close = value.slice(start).search(/<\/noema_chat>/i)
  return close >= 0 ? value.slice(start, start + close) : value.slice(start)
}

function renderNoemaBlocks(source: string, options: NoemaMarkupRenderOptions): string {
  const blocks: string[] = []
  let cursor = 0

  while (cursor < source.length) {
    const tag = findNextNoemaTag(source, cursor)
    if (!tag) {
      blocks.push(renderNoemaParagraphs(source.slice(cursor), options))
      break
    }

    blocks.push(renderNoemaParagraphs(source.slice(cursor, tag.index), options))

    const contentStart = tag.index + tag.length
    const close = findClosingTag(source, tag.name, contentStart)
    const complete = close >= 0
    const content = complete ? source.slice(contentStart, close) : trimTrailingIncompleteTag(source.slice(contentStart))

    if (tag.name === 'section') {
      blocks.push(renderNoemaSection(tag.attrs, content, complete, options))
    } else if (tag.name === 'card') {
      blocks.push(renderNoemaCard(tag.attrs, content, complete, options))
    } else {
      blocks.push(renderNoemaCode(tag.attrs, content, complete, options))
    }

    if (!complete) {
      break
    }
    cursor = close + tag.name.length + 3
  }

  return blocks.filter(Boolean).join('')
}

function findNextNoemaTag(source: string, start: number): NoemaTagMatch | null {
  const open = /<(section|card|code)\b([^>]*)>/gi
  open.lastIndex = start
  const match = open.exec(source)
  if (!match) {
    return null
  }
  return {
    index: match.index,
    length: match[0].length,
    name: match[1].toLowerCase() as NoemaTagMatch['name'],
    attrs: readNoemaAttributes(match[2]),
  }
}

function findClosingTag(source: string, tag: string, start: number): number {
  const close = new RegExp(`</${tag}>`, 'i')
  const match = close.exec(source.slice(start))
  return match ? start + match.index : -1
}

function renderNoemaSection(
  attrs: Record<string, string>,
  content: string,
  complete: boolean,
  options: NoemaMarkupRenderOptions
): string {
  const title = attrs.title?.trim()
  return `
    <section class="noema-chat-section ${complete ? '' : 'is-streaming'}">
      ${title ? `<h4>${options.escapeHtml(title)}</h4>` : ''}
      ${renderNoemaBlocks(content, options)}
    </section>
  `
}

function renderNoemaCard(
  attrs: Record<string, string>,
  content: string,
  complete: boolean,
  options: NoemaMarkupRenderOptions
): string {
  const tone = normalizeNoemaTone(attrs.tone)
  const title = attrs.title?.trim()
  return `
    <aside class="noema-chat-card ${tone} ${complete ? '' : 'is-streaming'}">
      ${title ? `<strong>${options.escapeHtml(title)}</strong>` : ''}
      ${renderNoemaBlocks(content, options)}
    </aside>
  `
}

function renderNoemaCode(
  attrs: Record<string, string>,
  content: string,
  complete: boolean,
  options: NoemaMarkupRenderOptions
): string {
  const language = attrs.lang?.trim()
  const code = decodeNoemaEntities(stripNoemaTags(trimTrailingIncompleteTag(content))).trim()
  return `
    <pre class="noema-chat-code ${complete ? '' : 'is-streaming'}"${language ? ` data-language="${options.escapeHtml(language)}"` : ''}><code>${options.escapeHtml(code)}</code></pre>
  `
}

function renderNoemaParagraphs(source: string, options: NoemaMarkupRenderOptions): string {
  const text = decodeNoemaEntities(stripNoemaTags(trimTrailingIncompleteTag(source))).trim()
  if (!text) {
    return ''
  }
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${options.escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

function trimTrailingIncompleteTag(value: string): string {
  const lastOpen = value.lastIndexOf('<')
  if (lastOpen < 0) {
    return value
  }
  const lastClose = value.lastIndexOf('>')
  return lastClose > lastOpen ? value : value.slice(0, lastOpen)
}

function readNoemaAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const attrPattern = /\b(title|tone|lang)="([^"]*)"/gi
  let match: RegExpExecArray | null
  while ((match = attrPattern.exec(source)) !== null) {
    attrs[match[1].toLowerCase()] = decodeNoemaEntities(match[2])
  }
  return attrs
}

function normalizeNoemaTone(value: string | undefined): string {
  return value === 'success' || value === 'warning' || value === 'danger' ? value : 'info'
}

function stripNoemaTags(value: string): string {
  return value.replace(/<\/?[a-zA-Z_][\w-]*(?:\s[^>]*)?>/g, '')
}

function decodeNoemaEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
