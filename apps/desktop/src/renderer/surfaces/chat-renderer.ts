/**
 * Renders chat state into the standalone chat surface DOM.
 */
import type {
  ChatCharacterResource,
  ChatConversationSummary,
  ChatMessage,
} from './chat-model'
import { localizeChatText, type ChatLanguageCode } from './chat-model'

export interface ChatRendererOptions {
  panel: HTMLElement
  messageList: HTMLElement
  getLanguage(): ChatLanguageCode
  escapeHtml(value: string): string
}

export interface ChatRenderer {
  renderConversationList(conversations: ChatConversationSummary[], characters: ChatCharacterResource[], activeId: string): void
  renderActiveConversation(conversation: ChatConversationSummary, character: ChatCharacterResource): void
  renderEmptyState(): void
  renderMessages(messages: ChatMessage[]): void
  appendMessage(message: ChatMessage): void
  setAssistantMessageState(messageId: string, state: ChatMessage['state']): void
  filterConversations(query: string): void
}

export function createChatRenderer(options: ChatRendererOptions): ChatRenderer {
  const threadList = options.panel.querySelector<HTMLElement>('.chat-thread-list')
  const headerAvatar = options.panel.querySelector<HTMLElement>('.chat-identity .chat-avatar')
  const headerName = options.panel.querySelector<HTMLElement>('.chat-identity h1')
  const headerMeta = options.panel.querySelector<HTMLElement>('.chat-identity .chat-identity-meta')
  const profileTitle = options.panel.querySelector<HTMLElement>('.chat-config-copy h2')
  const profileCopy = options.panel.querySelector<HTMLElement>('.chat-config-copy p')
  const portrait = options.panel.querySelector<HTMLElement>('.chat-config-portrait')
  const configMeta = options.panel.querySelector<HTMLElement>('.chat-config-meta')
  const assetList = options.panel.querySelector<HTMLElement>('.chat-asset-list')
  const suggestionList = options.panel.querySelector<HTMLElement>('.chat-suggestion-list')
  let activeMessageCharacter: ChatCharacterResource | undefined

  function renderConversationList(
    conversations: ChatConversationSummary[],
    characters: ChatCharacterResource[],
    activeId: string
  ): void {
    if (!threadList) return

    const language = options.getLanguage()
    threadList.innerHTML = conversations.map((conversation) => {
      const character = characters.find((item) => item.id === conversation.characterId) ?? characters[0]
      const active = conversation.id === activeId
      const title = localizeChatText(conversation.title, language)
      const preview = localizeChatText(conversation.preview, language)
      const characterName = localizeChatText(character.displayName, language)
      const tags = getCharacterTags(character, language).join(' ')
      return `
        <button class="chat-thread ${active ? 'active is-active' : ''}" type="button" data-conversation-id="${options.escapeHtml(conversation.id)}" data-search="${options.escapeHtml(`${title} ${preview} ${characterName} ${tags}`)}">
          ${renderAvatar(character, false)}
          <span class="chat-thread-copy">
            <strong>${options.escapeHtml(title)}</strong>
            <span>${options.escapeHtml(preview)}</span>
          </span>
          <time>${options.escapeHtml(localizeChatText(conversation.updatedLabel, language))}</time>
        </button>
      `
    }).join('')
  }

  function renderActiveConversation(conversation: ChatConversationSummary, character: ChatCharacterResource): void {
    const language = options.getLanguage()
    activeMessageCharacter = character
    if (headerAvatar) {
      headerAvatar.className = 'chat-avatar large'
      headerAvatar.innerHTML = renderAvatarImage(character, language)
    }
    if (headerName) {
      headerName.textContent = localizeChatText(character.displayName, language)
    }
    if (headerMeta) {
      headerMeta.textContent = getCharacterTags(character, language).slice(0, 3).join(' · ')
    }
    if (profileTitle) {
      profileTitle.textContent = localizeChatText(character.displayName, language)
    }
    if (profileCopy) {
      profileCopy.textContent = `${localizeChatText(character.description, language)}\n\n${localizeChatText(character.background, language)}`
    }
    if (portrait) {
      portrait.innerHTML = `
        <img class="chat-character-image" src="${options.escapeHtml(character.bodyImage)}" alt="${options.escapeHtml(localizeChatText(character.displayName, language))}" />
      `
    }
    if (configMeta) {
      configMeta.innerHTML = getCharacterTags(character, language)
        .map((item) => `<span>${options.escapeHtml(item)}</span>`)
        .join('')
    }
    if (assetList) {
      assetList.innerHTML = ''
    }
    if (suggestionList) {
      suggestionList.innerHTML = ''
    }
    renderMessages(conversation.messages)
  }

  function renderEmptyState(): void {
    const language = options.getLanguage()
    const emptyTitle = language === 'zh-CN' ? '暂无历史角色' : 'No history characters'
    const emptyCopy = language === 'zh-CN'
      ? 'chat 会在角色产生历史对话后读取资源并显示在这里。'
      : 'Chat resources appear here after a character has conversation history.'

    if (headerAvatar) {
      headerAvatar.className = 'chat-avatar large'
      headerAvatar.textContent = 'N'
    }
    if (headerName) {
      headerName.textContent = emptyTitle
    }
    if (headerMeta) {
      headerMeta.textContent = emptyCopy
    }
    if (profileTitle) {
      profileTitle.textContent = emptyTitle
    }
    if (profileCopy) {
      profileCopy.textContent = emptyCopy
    }
    if (portrait) {
      portrait.innerHTML = ''
    }
    if (configMeta) {
      configMeta.innerHTML = ''
    }
    if (assetList) {
      assetList.innerHTML = ''
    }
    if (suggestionList) {
      suggestionList.innerHTML = ''
    }
    activeMessageCharacter = undefined
    options.messageList.innerHTML = ''
  }

  function renderMessages(messages: ChatMessage[]): void {
    options.messageList.innerHTML = messages.map(renderMessage).join('')
    scrollToLatest()
  }

  function appendMessage(message: ChatMessage): void {
    options.messageList.insertAdjacentHTML('beforeend', renderMessage(message))
    scrollToLatest()
  }

  function setAssistantMessageState(messageId: string, state: ChatMessage['state']): void {
    const message = options.messageList.querySelector<HTMLElement>(`[data-message-id="${cssEscape(messageId)}"]`)
    if (!message) return
    if (state) {
      message.dataset.state = state
    } else {
      delete message.dataset.state
    }
  }

  function filterConversations(query: string): void {
    const normalized = query.trim().toLowerCase()
    options.panel.querySelectorAll<HTMLElement>('.chat-thread').forEach((thread) => {
      const haystack = (thread.dataset.search || '').toLowerCase()
      thread.classList.toggle('is-hidden', Boolean(normalized) && !haystack.includes(normalized))
    })
  }

  function renderMessage(message: ChatMessage): string {
    const language = options.getLanguage()
    if (message.state === 'thinking') {
      return renderThinkingMessage(message, language)
    }
    const stateLabel = message.state ? `<em>${options.escapeHtml(formatState(message.state, language))}</em>` : ''
    const assistantAvatar = message.role === 'assistant' && activeMessageCharacter
      ? `<div class="chat-message-avatar">${renderAvatarImage(activeMessageCharacter, language)}</div>`
      : ''
    return `
      <article class="chat-message ${options.escapeHtml(message.role)}" data-message-id="${options.escapeHtml(message.id)}" ${message.state ? `data-state="${options.escapeHtml(message.state)}"` : ''}>
        ${assistantAvatar}
        <div class="chat-message-body">
          ${renderMessageAttachments(message)}
          ${renderMessageContent(message, language)}
          <small>${stateLabel}${options.escapeHtml(localizeChatText(message.createdLabel, language))}</small>
        </div>
      </article>
    `
  }

  function renderMessageContent(message: ChatMessage, language: ChatLanguageCode): string {
    const text = localizeChatText(message.text, language)
    if (message.role === 'assistant' && hasNoemaChatMarkup(text)) {
      const markup = renderNoemaChatMarkup(text)
      return markup || renderNoemaStreamStatus(language)
    }
    return `<p>${options.escapeHtml(text)}</p>`
  }

  function renderNoemaStreamStatus(language: ChatLanguageCode): string {
    const label = language === 'zh-CN' ? '组织回复中' : 'Composing'
    return `
      <span class="chat-thinking-status compact">
        ${options.escapeHtml(label)}
        <span class="chat-thinking-dots" aria-hidden="true">
          <i>.</i><i>.</i><i>.</i>
        </span>
      </span>
    `
  }

  function renderThinkingMessage(message: ChatMessage, language: ChatLanguageCode): string {
    const assistantAvatar = message.role === 'assistant' && activeMessageCharacter
      ? `<div class="chat-message-avatar">${renderAvatarImage(activeMessageCharacter, language)}</div>`
      : ''
    const label = language === 'zh-CN' ? '思考中' : 'Thinking'
    return `
      <article class="chat-message ${options.escapeHtml(message.role)}" data-message-id="${options.escapeHtml(message.id)}" data-state="thinking" aria-live="polite">
        ${assistantAvatar}
        <div class="chat-message-body">
          <span class="chat-thinking-status">
            ${options.escapeHtml(label)}
            <span class="chat-thinking-dots" aria-hidden="true">
              <i>.</i><i>.</i><i>.</i>
            </span>
          </span>
        </div>
      </article>
    `
  }

  function renderMessageAttachments(message: ChatMessage): string {
    if (!message.attachments?.length) {
      return ''
    }
    return `
      <div class="chat-message-attachments">
        ${message.attachments.map((attachment) => {
          if (attachment.kind === 'video' && attachment.dataUrl) {
            return `
              <video class="chat-message-attachment video" src="${options.escapeHtml(attachment.dataUrl)}" controls preload="metadata" title="${options.escapeHtml(attachment.name)}"></video>
            `
          }
          if (attachment.dataUrl) {
            return `
              <img class="chat-message-attachment image" src="${options.escapeHtml(attachment.dataUrl)}" alt="${options.escapeHtml(attachment.name)}" />
            `
          }
          return `<span class="chat-message-attachment file">${options.escapeHtml(attachment.name)}</span>`
        }).join('')}
      </div>
    `
  }

  function renderAvatar(character: ChatCharacterResource, large: boolean): string {
    return `<span class="chat-avatar ${large ? 'large' : ''}">${renderAvatarImage(character, options.getLanguage())}</span>`
  }

  function scrollToLatest(): void {
    options.messageList.scrollTop = options.messageList.scrollHeight
  }

  function renderAvatarImage(character: ChatCharacterResource, language: ChatLanguageCode): string {
    const name = localizeChatText(character.displayName, language)
    return `<img src="${options.escapeHtml(character.avatarImage)}" alt="${options.escapeHtml(name)}" />`
  }

  function getCharacterTags(character: ChatCharacterResource, language: ChatLanguageCode): string[] {
    return character.tag[language] ?? character.tag['zh-CN']
  }

  return {
    renderConversationList,
    renderActiveConversation,
    renderEmptyState,
    renderMessages,
    appendMessage,
    setAssistantMessageState,
    filterConversations,
  }
}

function formatState(state: NonNullable<ChatMessage['state']>, language: ChatLanguageCode): string {
  switch (state) {
    case 'generating_image':
      return language === 'zh-CN' ? '生成图片中 · ' : 'Generating image · '
    case 'using_tool':
      return language === 'zh-CN' ? '调用工具中 · ' : 'Using tool · '
    case 'thinking':
      return language === 'zh-CN' ? '思考中 · ' : 'Thinking · '
    default:
      return ''
  }
}

function hasNoemaChatMarkup(value: string): boolean {
  return /<noema_chat\b/i.test(value)
}

function renderNoemaChatMarkup(value: string): string {
  const reply = extractNoemaReply(value)
  if (!reply.trim()) {
    return ''
  }
  return renderNoemaBlocks(reply)
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

function renderNoemaBlocks(source: string): string {
  const blocks: string[] = []
  const blockPattern = /<(section|card|code)\b([^>]*)>([\s\S]*?)<\/\1>/gi
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = blockPattern.exec(source)) !== null) {
    blocks.push(renderNoemaParagraphs(source.slice(cursor, match.index)))
    const tag = match[1].toLowerCase()
    const attrs = readNoemaAttributes(match[2])
    const content = match[3]
    if (tag === 'section') {
      blocks.push(renderNoemaSection(attrs, content))
    } else if (tag === 'card') {
      blocks.push(renderNoemaCard(attrs, content))
    } else if (tag === 'code') {
      blocks.push(renderNoemaCode(attrs, content))
    }
    cursor = match.index + match[0].length
  }
  blocks.push(renderNoemaParagraphs(source.slice(cursor)))
  return blocks.filter(Boolean).join('')
}

function renderNoemaSection(attrs: Record<string, string>, content: string): string {
  const title = attrs.title?.trim()
  return `
    <section class="noema-chat-section">
      ${title ? `<h4>${escapeHtml(title)}</h4>` : ''}
      ${renderNoemaBlocks(content)}
    </section>
  `
}

function renderNoemaCard(attrs: Record<string, string>, content: string): string {
  const tone = normalizeNoemaTone(attrs.tone)
  const title = attrs.title?.trim()
  return `
    <aside class="noema-chat-card ${tone}">
      ${title ? `<strong>${escapeHtml(title)}</strong>` : ''}
      ${renderNoemaBlocks(content)}
    </aside>
  `
}

function renderNoemaCode(attrs: Record<string, string>, content: string): string {
  const language = attrs.lang?.trim()
  return `
    <pre class="noema-chat-code"${language ? ` data-language="${escapeHtml(language)}"` : ''}><code>${escapeHtml(decodeNoemaEntities(stripNoemaTags(content).trim()))}</code></pre>
  `
}

function renderNoemaParagraphs(source: string): string {
  const text = decodeNoemaEntities(stripNoemaTags(source)).trim()
  if (!text) {
    return ''
  }
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('')
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
  return value.replace(/<\/?[a-zA-Z_][^>]*>/g, '')
}

function decodeNoemaEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(value)
  }
  return value.replace(/["\\]/g, '\\$&')
}
