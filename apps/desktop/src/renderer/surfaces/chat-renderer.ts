/**
 * Renders chat state into the standalone chat surface DOM.
 */
import type {
  ChatCharacterProfileField,
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
      const tags = character.tags.map((tag) => localizeChatText(tag, language)).join(' ')
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
      headerAvatar.className = `chat-avatar large ${character.avatarClass}`
      headerAvatar.textContent = character.accent
    }
    if (headerName) {
      headerName.textContent = localizeChatText(character.displayName, language)
    }
    if (headerMeta) {
      headerMeta.textContent = `${character.locale} · ${localizeChatText(character.subtitle, language)}`
    }
    if (profileTitle) {
      profileTitle.textContent = localizeChatText(character.displayName, language)
    }
    if (profileCopy) {
      profileCopy.textContent = localizeChatText(character.description, language)
    }
    if (portrait) {
      portrait.innerHTML = `
        <div class="chat-character-stage ${options.escapeHtml(character.avatarClass)}">
          <span>${options.escapeHtml(character.accent)}</span>
        </div>
        <a class="chat-version-pill" href="${options.escapeHtml(character.sourceUrl)}" target="_blank" rel="noreferrer">${options.escapeHtml(character.sourceLabel)}</a>
      `
    }
    if (configMeta) {
      configMeta.innerHTML = character.tags
        .map((item) => `<span>${options.escapeHtml(localizeChatText(item, language))}</span>`)
        .join('')
    }
    if (assetList) {
      assetList.innerHTML = character.profileFields.map(renderProfileField).join('')
    }
    if (suggestionList) {
      suggestionList.innerHTML = character.suggestedPrompts.map((prompt) => `
        <button class="chat-suggestion" type="button" data-chat-action="suggestion" data-message="${options.escapeHtml(localizeChatText(prompt, language))}">
          <span>${options.escapeHtml(localizeChatText(prompt, language))}</span>
        </button>
      `).join('')
    }
    renderMessages(conversation.messages)
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
    return `<span class="chat-avatar ${large ? 'large ' : ''}${options.escapeHtml(character.avatarClass)}">${options.escapeHtml(character.accent)}</span>`
  }

  function renderProfileField(field: ChatCharacterProfileField): string {
    const language = options.getLanguage()
    return `
      <li class="chat-asset-item">
        <span>${options.escapeHtml(localizeChatText(field.label, language))}</span>
        <small>${options.escapeHtml(localizeChatText(field.value, language))}</small>
      </li>
    `
  }

  function scrollToLatest(): void {
    options.messageList.scrollTop = options.messageList.scrollHeight
  }

  return {
    renderConversationList,
    renderActiveConversation,
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
