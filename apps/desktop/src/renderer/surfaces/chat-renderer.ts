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
    const stateLabel = message.state ? `<em>${options.escapeHtml(formatState(message.state, language))}</em>` : ''
    return `
      <article class="chat-message ${options.escapeHtml(message.role)}" data-message-id="${options.escapeHtml(message.id)}" ${message.state ? `data-state="${options.escapeHtml(message.state)}"` : ''}>
        <p>${options.escapeHtml(localizeChatText(message.text, language))}</p>
        <span>${stateLabel}${options.escapeHtml(localizeChatText(message.createdLabel, language))}</span>
      </article>
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

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(value)
  }
  return value.replace(/["\\]/g, '\\$&')
}
