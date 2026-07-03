/**
 * Renders the roleplay chat markup protocol into safe chat message HTML.
 */
export interface RoleplayMarkupRenderOptions {
  escapeHtml(value: string): string
  renderSpeechAudio?(speechText: string, index: number): string
  getSpeechAudioAttributes?(speechText: string, index: number): string
}

interface RoleplayTagMatch {
  index: number
  length: number
  name: RoleplayMarkupTag
}

type RoleplayMarkupTag = 'role_chat'

export function hasRoleplayChatMarkup(value: string): boolean {
  return /<(chat|role_chat)\b/i.test(value)
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
  return value
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

    if (tag.name === 'role_chat') {
      blocks.push(renderRoleplaySpeech(content, complete, options))
    }

    if (!complete) {
      break
    }
    cursor = close + tag.name.length + 3
  }

  return blocks.filter(Boolean).join('')
}

function findNextRoleplayTag(source: string, start: number): RoleplayTagMatch | null {
  const open = /<(role_chat)\b([^>]*)>/gi
  open.lastIndex = start
  const match = open.exec(source)
  if (!match) {
    return null
  }
  return {
    index: match.index,
    length: match[0].length,
    name: match[1].toLowerCase() as RoleplayTagMatch['name'],
  }
}

function findClosingTag(source: string, tag: string, start: number): number {
  const close = new RegExp(`</${tag}>`, 'i')
  const match = close.exec(source.slice(start))
  return match ? start + match.index : -1
}

function renderRoleplaySpeech(
  content: string,
  complete: boolean,
  options: RoleplayMarkupRenderOptions
): string {
  return `
    <div class="roleplay-chat-speech ${complete ? '' : 'is-streaming'}">
      ${renderRoleplaySpeechParagraphs(content, options)}
    </div>
  `
}

function renderRoleplayParagraphs(source: string, options: RoleplayMarkupRenderOptions): string {
  const text = decodeRoleplayEntities(stripRoleplayTags(trimTrailingIncompleteTag(source))).trim()
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

function renderRoleplaySpeechParagraphs(source: string, options: RoleplayMarkupRenderOptions): string {
  const speechItems = extractRoleplaySpeechParagraphs(source)
  if (!speechItems.length) {
    return ''
  }
  return speechItems
    .map((line, index) => {
      const audioAttributes = options.getSpeechAudioAttributes?.(line, index) ?? ''
      const audioButton = audioAttributes
        ? `<button class="chat-inline-audio-trigger" type="button" ${audioAttributes}><i data-lucide="volume-2" aria-hidden="true"></i></button>`
        : ''
      return `<p class="roleplay-chat-speech-row">${audioButton}<span class="roleplay-chat-quote">“${options.escapeHtml(line).replace(/\n/g, '<br>')}”</span>${options.renderSpeechAudio?.(line, index) ?? ''}</p>`
    })
    .join('')
}

export function extractRoleplaySpeechTexts(value: string): string[] {
  const content = extractRoleplayChatContent(value)
  if (!content.trim()) {
    return []
  }
  const texts: string[] = []
  let cursor = 0
  while (cursor < content.length) {
    const tag = findNextRoleplayTag(content, cursor)
    if (!tag) {
      break
    }
    const contentStart = tag.index + tag.length
    const close = findClosingTag(content, tag.name, contentStart)
    const speechSource = close >= 0 ? content.slice(contentStart, close) : trimTrailingIncompleteTag(content.slice(contentStart))
    texts.push(...extractRoleplaySpeechParagraphs(speechSource))
    if (close < 0) {
      break
    }
    cursor = close + tag.name.length + 3
  }
  return texts
}

function extractRoleplaySpeechParagraphs(source: string): string[] {
  const text = decodeRoleplayEntities(stripRoleplayTags(trimTrailingIncompleteTag(source))).trim()
  if (!text) {
    return []
  }
  return text
    .split(/\n{2,}/)
    .map((paragraph) => stripWrappingQuotes(paragraph.trim()))
    .filter(Boolean)
}

function trimTrailingIncompleteTag(value: string): string {
  const lastOpen = value.lastIndexOf('<')
  if (lastOpen < 0) {
    return value
  }
  const lastClose = value.lastIndexOf('>')
  return lastClose > lastOpen ? value : value.slice(0, lastOpen)
}

function stripWrappingQuotes(value: string): string {
  return value
    .replace(/^["“”]+/, '')
    .replace(/["“”]+$/, '')
}

function stripRoleplayTags(value: string): string {
  return value.replace(/<\/?[a-zA-Z_][\w-]*(?:\s[^>]*)?>/g, '')
}

function decodeRoleplayEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
