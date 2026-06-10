/**
 * Renders the roleplay chat markup protocol into safe chat message HTML.
 */
export interface RoleplayMarkupRenderOptions {
  escapeHtml(value: string): string
}

interface NoemaTagMatch {
  index: number
  length: number
  name: RoleplayMarkupTag
  attrs: Record<string, string>
}

type RoleplayMarkupTag =
  | 'thinking'
  | 'think'
  | 'narration'
  | 'role_think'
  | 'role_chat'
  | 'role_action'
  | 'scene'
  | 'ooc'
  | 'section'
  | 'card'
  | 'code'

export function hasRoleplayChatMarkup(value: string): boolean {
  return /<(chat|noema_chat|thinking|think|role_think|role_chat|role_action|scene|ooc)\b/i.test(value)
}

export function renderRoleplayChatMarkup(value: string, options: RoleplayMarkupRenderOptions): string {
  const content = extractRoleplayChatContent(value)
  if (!content.trim()) {
    return ''
  }
  const rendered = renderRoleplayBlocks(content, options)
  return rendered ? `<div class="roleplay-chat-frame">${rendered}</div>` : ''
}

function extractRoleplayChatContent(value: string): string {
  const chatOpen = /<chat\b[^>]*>/i.exec(value)
  if (chatOpen) {
    const start = chatOpen.index + chatOpen[0].length
    const close = value.slice(start).search(/<\/chat>/i)
    return close >= 0 ? value.slice(start, start + close) : value.slice(start)
  }

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

function renderRoleplayBlocks(source: string, options: RoleplayMarkupRenderOptions): string {
  const blocks: string[] = []
  let cursor = 0

  while (cursor < source.length) {
    const tag = findNextRoleplayTag(source, cursor)
    if (!tag) {
      blocks.push(renderRoleplayParagraphs(source.slice(cursor), options))
      break
    }

    blocks.push(renderRoleplayParagraphs(source.slice(cursor, tag.index), options))

    const contentStart = tag.index + tag.length
    const close = findClosingTag(source, tag.name, contentStart)
    const complete = close >= 0
    const content = complete ? source.slice(contentStart, close) : trimTrailingIncompleteTag(source.slice(contentStart))

    if (tag.name === 'thinking' || tag.name === 'think') {
      blocks.push(renderRoleplayNote('thinking', tag.attrs, content, complete, options))
    } else if (tag.name === 'narration') {
      blocks.push(renderRoleplayNarration(content, complete, options))
    } else if (tag.name === 'role_think') {
      blocks.push(renderRoleplayNote('role-think', tag.attrs, content, complete, options))
    } else if (tag.name === 'role_chat') {
      blocks.push(renderRoleplaySpeech(tag.attrs, content, complete, options))
    } else if (tag.name === 'role_action') {
      blocks.push(renderRoleplayNote('role-action', tag.attrs, content, complete, options))
    } else if (tag.name === 'scene') {
      blocks.push(renderRoleplayNote('scene', tag.attrs, content, complete, options))
    } else if (tag.name === 'ooc') {
      blocks.push(renderRoleplayNote('ooc', tag.attrs, content, complete, options))
    } else if (tag.name === 'section') {
      blocks.push(renderRoleplaySection(tag.attrs, content, complete, options))
    } else if (tag.name === 'card') {
      blocks.push(renderRoleplayCard(tag.attrs, content, complete, options))
    } else if (tag.name === 'code') {
      blocks.push(renderRoleplayCode(tag.attrs, content, complete, options))
    }

    if (!complete) {
      break
    }
    cursor = close + tag.name.length + 3
  }

  return blocks.filter(Boolean).join('')
}

function findNextRoleplayTag(source: string, start: number): NoemaTagMatch | null {
  const open = /<(thinking|think|narration|role_think|role_chat|role_action|scene|ooc|section|card|code)\b([^>]*)>/gi
  open.lastIndex = start
  const match = open.exec(source)
  if (!match) {
    return null
  }
  return {
    index: match.index,
    length: match[0].length,
    name: match[1].toLowerCase() as NoemaTagMatch['name'],
    attrs: readRoleplayAttributes(match[2]),
  }
}

function findClosingTag(source: string, tag: string, start: number): number {
  const close = new RegExp(`</${tag}>`, 'i')
  const match = close.exec(source.slice(start))
  return match ? start + match.index : -1
}

function renderRoleplayNarration(
  content: string,
  complete: boolean,
  options: RoleplayMarkupRenderOptions
): string {
  return `
    <div class="roleplay-chat-narration ${complete ? '' : 'is-streaming'}">
      ${renderRoleplayParagraphs(content, options)}
    </div>
  `
}

function renderRoleplayNote(
  kind: string,
  attrs: Record<string, string>,
  content: string,
  complete: boolean,
  options: RoleplayMarkupRenderOptions
): string {
  const label = attrs.title?.trim() || defaultRoleplayNoteLabel(kind)
  return `
    <aside class="roleplay-chat-note ${kind} ${complete ? '' : 'is-streaming'}">
      <strong>${options.escapeHtml(label)}</strong>
      ${renderRoleplayParagraphs(content, options)}
    </aside>
  `
}

function renderRoleplaySpeech(
  attrs: Record<string, string>,
  content: string,
  complete: boolean,
  options: RoleplayMarkupRenderOptions
): string {
  const speaker = attrs.name?.trim() || attrs.title?.trim()
  return `
    <div class="roleplay-chat-speech ${speaker ? 'has-speaker' : 'no-speaker'} ${complete ? '' : 'is-streaming'}">
      ${speaker ? `<strong class="roleplay-chat-speaker">${options.escapeHtml(speaker)}:</strong>` : ''}
      ${renderRoleplayBlocks(content, options)}
    </div>
  `
}

function renderRoleplaySection(
  attrs: Record<string, string>,
  content: string,
  complete: boolean,
  options: RoleplayMarkupRenderOptions
): string {
  const title = attrs.title?.trim()
  return `
    <section class="noema-chat-section ${complete ? '' : 'is-streaming'}">
      ${title ? `<h4>${options.escapeHtml(title)}</h4>` : ''}
      ${renderRoleplayBlocks(content, options)}
    </section>
  `
}

function renderRoleplayCard(
  attrs: Record<string, string>,
  content: string,
  complete: boolean,
  options: RoleplayMarkupRenderOptions
): string {
  const tone = normalizeNoemaTone(attrs.tone)
  const title = attrs.title?.trim()
  return `
    <aside class="noema-chat-card ${tone} ${complete ? '' : 'is-streaming'}">
      ${title ? `<strong>${options.escapeHtml(title)}</strong>` : ''}
      ${renderRoleplayBlocks(content, options)}
    </aside>
  `
}

function renderRoleplayCode(
  attrs: Record<string, string>,
  content: string,
  complete: boolean,
  options: RoleplayMarkupRenderOptions
): string {
  const language = attrs.lang?.trim()
  const code = decodeNoemaEntities(stripRoleplayTags(trimTrailingIncompleteTag(content))).trim()
  return `
    <pre class="noema-chat-code ${complete ? '' : 'is-streaming'}"${language ? ` data-language="${options.escapeHtml(language)}"` : ''}><code>${options.escapeHtml(code)}</code></pre>
  `
}

function renderRoleplayParagraphs(source: string, options: RoleplayMarkupRenderOptions): string {
  const text = decodeNoemaEntities(stripRoleplayTags(trimTrailingIncompleteTag(source))).trim()
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

function readRoleplayAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const attrPattern = /\b(title|tone|lang|name)="([^"]*)"/gi
  let match: RegExpExecArray | null
  while ((match = attrPattern.exec(source)) !== null) {
    attrs[match[1].toLowerCase()] = decodeNoemaEntities(match[2])
  }
  return attrs
}

function defaultRoleplayNoteLabel(kind: string): string {
  switch (kind) {
    case 'thinking':
      return '思考'
    case 'role-think':
      return '内心'
    case 'role-action':
      return '动作'
    case 'scene':
      return '场景'
    case 'ooc':
      return 'OOC'
    default:
      return ''
  }
}

function normalizeNoemaTone(value: string | undefined): string {
  return value === 'success' || value === 'warning' || value === 'danger' ? value : 'info'
}

function stripRoleplayTags(value: string): string {
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
