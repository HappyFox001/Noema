/**
 * Renders chat state into the standalone chat surface DOM.
 */
import type {
  ChatCharacterAssetSummary,
  ChatCharacterPackSummary,
  ChatConversationSummary,
  ChatMessage,
} from './chat-model'

export interface ChatRendererOptions {
  panel: HTMLElement
  messageList: HTMLElement
  escapeHtml(value: string): string
}

export interface ChatRenderer {
  renderConversationList(conversations: ChatConversationSummary[], characters: ChatCharacterPackSummary[], activeId: string): void
  renderActiveConversation(conversation: ChatConversationSummary, character: ChatCharacterPackSummary): void
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
    characters: ChatCharacterPackSummary[],
    activeId: string
  ): void {
    if (!threadList) return

    threadList.innerHTML = conversations.map((conversation) => {
      const character = characters.find((item) => item.id === conversation.characterId) ?? characters[0]
      const active = conversation.id === activeId
      return `
        <button class="chat-thread ${active ? 'active is-active' : ''}" type="button" data-conversation-id="${options.escapeHtml(conversation.id)}" data-search="${options.escapeHtml(`${conversation.title} ${conversation.preview} ${character.displayName} ${character.tags.join(' ')}`)}">
          ${renderAvatar(character, false)}
          <span class="chat-thread-copy">
            <strong>${options.escapeHtml(conversation.title)}</strong>
            <span>${options.escapeHtml(conversation.preview)}</span>
          </span>
          <time>${options.escapeHtml(conversation.updatedLabel)}</time>
        </button>
      `
    }).join('')
  }

  function renderActiveConversation(conversation: ChatConversationSummary, character: ChatCharacterPackSummary): void {
    if (headerAvatar) {
      headerAvatar.className = `chat-avatar large ${character.avatarClass}`
      headerAvatar.textContent = character.accent
    }
    if (headerName) {
      headerName.textContent = character.name
    }
    if (headerMeta) {
      headerMeta.textContent = `${character.language} · ${character.packVersion}`
    }
    if (profileTitle) {
      profileTitle.textContent = character.displayName
    }
    if (profileCopy) {
      profileCopy.textContent = character.description
    }
    if (portrait) {
      portrait.innerHTML = `
        <div class="chat-character-stage ${options.escapeHtml(character.avatarClass)}">
          <span>${options.escapeHtml(character.accent)}</span>
        </div>
        <span class="chat-version-pill">${options.escapeHtml(character.packVersion)}</span>
      `
    }
    if (configMeta) {
      configMeta.innerHTML = [
        character.source,
        ...character.tags,
        ...character.capabilities.map((capability) => `cap:${capability}`),
      ].map((item) => `<span>${options.escapeHtml(item)}</span>`).join('')
    }
    if (assetList) {
      assetList.innerHTML = character.assets.map(renderAsset).join('')
    }
    if (suggestionList) {
      suggestionList.innerHTML = character.suggestedPrompts.map((prompt) => `
        <button class="chat-suggestion" type="button" data-chat-action="suggestion" data-message="${options.escapeHtml(prompt)}">
          <span>${options.escapeHtml(prompt)}</span>
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
    const stateLabel = message.state ? `<em>${options.escapeHtml(formatState(message.state))}</em>` : ''
    return `
      <article class="chat-message ${options.escapeHtml(message.role)}" data-message-id="${options.escapeHtml(message.id)}" ${message.state ? `data-state="${options.escapeHtml(message.state)}"` : ''}>
        <p>${options.escapeHtml(message.text)}</p>
        <span>${stateLabel}${options.escapeHtml(message.createdLabel)}</span>
      </article>
    `
  }

  function renderAvatar(character: ChatCharacterPackSummary, large: boolean): string {
    return `<span class="chat-avatar ${large ? 'large ' : ''}${options.escapeHtml(character.avatarClass)}">${options.escapeHtml(character.accent)}</span>`
  }

  function renderAsset(asset: ChatCharacterAssetSummary): string {
    return `
      <li class="chat-asset-item" data-status="${options.escapeHtml(asset.status)}">
        <span>${options.escapeHtml(asset.label)}</span>
        <small>${options.escapeHtml(asset.kind)} · ${options.escapeHtml(asset.status)}</small>
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

function formatState(state: NonNullable<ChatMessage['state']>): string {
  switch (state) {
    case 'generating_image':
      return '生成图片中 · '
    case 'using_tool':
      return '调用工具中 · '
    case 'thinking':
      return '思考中 · '
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
