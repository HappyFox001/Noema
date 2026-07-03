/**
 * Renders chat state into the standalone chat surface DOM.
 */
import type {
  ChatCharacterResource,
  ChatConversationSummary,
  ChatMessage,
} from './chat-model'
import { Image as ImageIcon, Trash2, Volume2, createIcons } from 'lucide'
import { localizeChatText, type ChatLanguageCode } from './chat-model'
import { hasRoleplayChatMarkup, renderRoleplayChatMarkup } from './roleplay-chat-markup'

export interface ChatRendererOptions {
  panel: HTMLElement
  messageList: HTMLElement
  getLanguage(): ChatLanguageCode
  escapeHtml(value: string): string
  getSceneCollapsed?(): boolean
}

export interface ChatRenderer {
  renderConversationList(conversations: ChatConversationSummary[], characters: ChatCharacterResource[], activeId: string): void
  renderActiveConversation(conversation: ChatConversationSummary, character: ChatCharacterResource): void
  renderEmptyState(): void
  renderMessages(messages: ChatMessage[], scrollMode?: ChatRenderScrollMode): void
  appendMessage(message: ChatMessage): void
  replaceMessage(message: ChatMessage): void
  setAssistantMessageState(messageId: string, state: ChatMessage['state']): void
  filterConversations(query: string): void
}

type ChatRenderScrollMode = 'auto' | 'force' | 'preserve'

export function createChatRenderer(options: ChatRendererOptions): ChatRenderer {
  const threadList = options.panel.querySelector<HTMLElement>('.chat-thread-list')
  const headerAvatar = options.panel.querySelector<HTMLElement>('.chat-identity .chat-avatar')
  const headerName = options.panel.querySelector<HTMLElement>('.chat-identity h1')
  const headerMeta = options.panel.querySelector<HTMLElement>('.chat-identity .chat-identity-meta')
  const profileTitle = options.panel.querySelector<HTMLElement>('.chat-config-copy h2')
  const profileCopy = options.panel.querySelector<HTMLElement>('.chat-config-copy p')
  const portrait = options.panel.querySelector<HTMLElement>('.chat-config-portrait')
  const assetList = options.panel.querySelector<HTMLElement>('.chat-asset-list')
  const assetTitle = assetList?.closest<HTMLElement>('.chat-config-section')?.querySelector<HTMLElement>('h3')
  const suggestionList = options.panel.querySelector<HTMLElement>('.chat-suggestion-list')
  let activeMessageCharacter: ChatCharacterResource | undefined
  let activeConversation: ChatConversationSummary | undefined
  let actionSourceMessageId = ''

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
    activeConversation = conversation
    activeMessageCharacter = character
    if (headerAvatar) {
      headerAvatar.className = 'chat-avatar large'
      headerAvatar.innerHTML = renderAvatarImage(character, language)
    }
    if (headerName) {
      headerName.textContent = localizeChatText(character.displayName, language)
    }
    if (headerMeta) {
      headerMeta.textContent = ''
      headerMeta.hidden = true
    }
    if (profileTitle) {
      profileTitle.textContent = localizeChatText(character.displayName, language)
    }
    if (profileCopy) {
      profileCopy.textContent = [
        localizeChatText(character.description, language),
        localizeChatText(character.story, language),
        localizeChatText(character.background, language),
      ].filter(Boolean).join('\n\n')
    }
    if (portrait) {
      const characterName = localizeChatText(character.displayName, language)
      const profileImage = character.avatarImage || character.bodyImage
      portrait.innerHTML = profileImage
        ? `<img class="chat-character-image" src="${options.escapeHtml(profileImage)}" alt="${options.escapeHtml(characterName)}" onerror="this.replaceWith(document.createTextNode(this.alt || 'No image'))" />`
        : options.escapeHtml(characterName)
    }
    if (assetList) {
      assetList.innerHTML = renderCharacterActionEntrances(language)
      renderActionIcons(assetList)
    }
    if (assetTitle) {
      assetTitle.textContent = language === 'zh-CN' ? '管理' : 'Manage'
    }
    if (suggestionList) {
      suggestionList.innerHTML = ''
    }
    renderMessages(conversation.messages, 'force')
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
      headerMeta.hidden = false
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
    if (assetList) {
      assetList.innerHTML = ''
    }
    if (assetTitle) {
      assetTitle.textContent = language === 'zh-CN' ? '管理' : 'Manage'
    }
    if (suggestionList) {
      suggestionList.innerHTML = ''
    }
    activeMessageCharacter = undefined
    activeConversation = undefined
    actionSourceMessageId = ''
    options.messageList.innerHTML = ''
  }

  function renderMessages(messages: ChatMessage[], scrollMode: ChatRenderScrollMode = 'auto'): void {
    const shouldFollow = scrollMode === 'force' || (scrollMode === 'auto' && shouldAutoFollowScroll())
    const previousScrollTop = options.messageList.scrollTop
    const language = options.getLanguage()
    actionSourceMessageId = findLastActionableAssistantMessageId(messages, language)
    options.messageList.innerHTML = messages.map((message) => {
      const isLatestAssistantReply = message.id === actionSourceMessageId
      return renderMessage(message, isLatestAssistantReply, isLatestAssistantReply, actionSourceMessageId)
    }).join('')
    renderActionIcons(options.messageList)
    applyScrollAfterRender(shouldFollow, previousScrollTop)
  }

  function appendMessage(message: ChatMessage): void {
    const shouldFollow = shouldAutoFollowScroll()
    if (message.role === 'user' || message.state === 'thinking') {
      clearRenderedLatestTurnAddons()
      actionSourceMessageId = ''
    }
    const isLatestAssistantReply = message.id === actionSourceMessageId
    options.messageList.insertAdjacentHTML('beforeend', renderMessage(message, isLatestAssistantReply, isLatestAssistantReply, actionSourceMessageId))
    const rendered = options.messageList.lastElementChild
    if (rendered) {
      renderActionIcons(rendered)
    }
    if (shouldFollow) {
      scrollToLatest()
    }
  }

  function replaceMessage(message: ChatMessage): void {
    const existing = options.messageList.querySelector<HTMLElement>(`[data-message-id="${cssEscape(message.id)}"]`)
    if (!existing) {
      appendMessage(message)
      return
    }
    const shouldFollow = shouldAutoFollowScroll()
    const previousScrollTop = options.messageList.scrollTop
    const isLatestAssistantReply = message.id === actionSourceMessageId
    existing.outerHTML = renderMessage(message, isLatestAssistantReply, isLatestAssistantReply, actionSourceMessageId)
    const rendered = options.messageList.querySelector<HTMLElement>(`[data-message-id="${cssEscape(message.id)}"]`)
    if (rendered) {
      renderActionIcons(rendered)
    }
    if (shouldFollow) {
      scrollToLatest()
    } else {
      options.messageList.scrollTop = previousScrollTop
    }
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

  function renderMessage(message: ChatMessage, includeSceneState: boolean, includeActions: boolean, actionMessageId: string): string {
    const language = options.getLanguage()
    if (message.state === 'thinking') {
      return renderThinkingMessage(message, language)
    }
    const contentState = message.state && message.state !== 'generating_audio' ? message.state : undefined
    const stateLabel = contentState ? `<em>${options.escapeHtml(formatState(contentState, language))}</em>` : ''
    const assistantAvatar = message.role === 'assistant' && activeMessageCharacter
      ? `<div class="chat-message-avatar">${renderAvatarImage(activeMessageCharacter, language)}</div>`
      : ''
    return `
      <article class="chat-message ${options.escapeHtml(message.role)}" data-message-id="${options.escapeHtml(message.id)}" ${contentState ? `data-state="${options.escapeHtml(contentState)}"` : ''} ${message.state === 'generating_audio' ? 'data-audio-state="generating"' : ''}>
        ${assistantAvatar}
        <div class="chat-message-body">
          ${renderMessageAttachments(message)}
          ${renderOpeningPanel(message)}
          ${renderMessageContent(message, language)}
          ${renderInlineVoice(message, language)}
          ${includeSceneState ? renderInlineSceneState(language) : ''}
          ${renderMessageActions(message, language, includeActions, actionMessageId)}
          <small>${stateLabel}${options.escapeHtml(localizeChatText(message.createdLabel, language))}</small>
        </div>
      </article>
    `
  }

  function findLastActionableAssistantMessageId(messages: ChatMessage[], language: ChatLanguageCode): string {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (isActionableAssistantMessage(message, language)) {
        return message.id
      }
    }
    return ''
  }

  function isActionableAssistantMessage(message: ChatMessage, language: ChatLanguageCode): boolean {
    return message.role === 'assistant'
      && (message.state === undefined || message.state === 'generating_audio')
      && !message.id.startsWith('assistant-media-')
      && Boolean(localizeChatText(message.text, language).trim())
  }

  function renderInlineSceneState(language: ChatLanguageCode): string {
    if (!activeConversation?.sceneState) {
      return ''
    }
    const collapsed = options.getSceneCollapsed?.() ?? false
    const scene = localizeSceneState(activeConversation.sceneState, language)
    const location = String(scene.location || '')
    const statusItems = normalizeSceneStatus(scene.status)
    const equipment = normalizeSceneEquipment(scene.equipment)
    if (!location && !statusItems.length && !equipment.length) {
      return ''
    }
    return `
      <section class="chat-inline-scene">
        <div class="chat-inline-scene-lines">
          ${renderInlineSceneLine(language === 'zh-CN' ? '地点' : 'Place', location || (language === 'zh-CN' ? '未设定' : 'Unset'))}
          <div class="chat-inline-scene-line">
            <span>${options.escapeHtml(language === 'zh-CN' ? '状态' : 'Status')}</span>
            <div class="chat-inline-scene-status">
              ${statusItems.length ? statusItems.map((item) => `<em>${options.escapeHtml(item)}</em>`).join('') : `<em>${options.escapeHtml(language === 'zh-CN' ? '平稳' : 'steady')}</em>`}
            </div>
          </div>
        </div>
        <button class="chat-inline-equipment-toggle" type="button" data-chat-action="toggle-scene-state" aria-expanded="${collapsed ? 'false' : 'true'}">
          <span>${options.escapeHtml(language === 'zh-CN' ? '装备栏' : 'Equipment')}</span>
          <em>${options.escapeHtml(String(equipment.length))}</em>
          <strong aria-hidden="true">${collapsed ? options.escapeHtml(language === 'zh-CN' ? '展开' : 'Open') : options.escapeHtml(language === 'zh-CN' ? '收起' : 'Close')}</strong>
        </button>
        <div class="chat-inline-equipment ${collapsed ? 'is-collapsed' : ''}">
          <table>
            <thead>
              <tr>
                <th>${options.escapeHtml(language === 'zh-CN' ? '装备名称' : 'Name')}</th>
                <th>${options.escapeHtml(language === 'zh-CN' ? '能力' : 'Ability')}</th>
                <th>${options.escapeHtml(language === 'zh-CN' ? '数量' : 'Qty')}</th>
              </tr>
            </thead>
            <tbody>
              ${equipment.length ? equipment.map((item) => `
                <tr>
                  <td>${options.escapeHtml(item.name)}</td>
                  <td>${options.escapeHtml(item.ability)}</td>
                  <td>${options.escapeHtml(item.quantity)}</td>
                </tr>
              `).join('') : `
                <tr>
                  <td colspan="3">${options.escapeHtml(language === 'zh-CN' ? '暂无装备记录' : 'No equipment recorded')}</td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      </section>
    `
  }

  function renderInlineSceneLine(label: string, value: string): string {
    return `
      <div class="chat-inline-scene-line">
        <span>${options.escapeHtml(label)}</span>
        <strong>${options.escapeHtml(value)}</strong>
      </div>
    `
  }

  function normalizeSceneStatus(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map(formatSceneStatusItem).filter(Boolean)
    }
    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => `${key} ${formatSceneScalar(item)}`.trim())
        .filter(Boolean)
    }
    return String(value || '')
      .split(/\s{2,}|[，,；;]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  function formatSceneStatusItem(value: unknown): string {
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      const emoji = formatSceneScalar(record.emoji)
      const name = formatSceneScalar(record.name ?? record.label ?? record.key)
      const amount = formatSceneScalar(record.value ?? record.amount ?? record.level)
      return [emoji, name, amount].filter(Boolean).join(' ')
    }
    return formatSceneScalar(value)
  }

  function normalizeSceneEquipment(value: unknown): Array<{ name: string; ability: string; quantity: string }> {
    if (!Array.isArray(value)) {
      return []
    }
    return value
      .map((item) => {
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>
          return {
            name: formatSceneScalar(record.name) || '-',
            ability: formatSceneScalar(record.ability) || '-',
            quantity: formatSceneScalar(record.quantity ?? record.count) || '1',
          }
        }
        return {
          name: formatSceneScalar(item) || '-',
          ability: '-',
          quantity: '1',
        }
      })
      .filter((item) => item.name !== '-')
  }

  function formatSceneScalar(value: unknown): string {
    if (value === null || value === undefined) {
      return ''
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }
    return ''
  }

  function localizeSceneState(sceneState: ChatConversationSummary['sceneState'], language: ChatLanguageCode): Record<string, unknown> {
    const localized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(sceneState ?? {})) {
      localized[key] = localizeSceneValue(value, language)
    }
    return localized
  }

  function localizeSceneValue(value: unknown, language: ChatLanguageCode): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => localizeSceneValue(item, language))
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      if (typeof record['zh-CN'] === 'string' || typeof record['en-US'] === 'string') {
        return localizeChatText(record as any, language)
      }
      const localized: Record<string, unknown> = {}
      for (const [key, childValue] of Object.entries(record)) {
        localized[key] = localizeSceneValue(childValue, language)
      }
      return localized
    }
    return value
  }

  function renderCharacterActionEntrances(language: ChatLanguageCode): string {
    const items: Array<{ action: string; title: string; danger?: boolean }> = language === 'zh-CN'
      ? [
        { action: 'conversation-management', title: '对话管理' },
        { action: 'conversation-settings', title: '对话设置' },
        { action: 'memory-management', title: '记忆管理' },
        { action: 'delete-character', title: '删除角色', danger: true },
      ]
      : [
        { action: 'conversation-management', title: 'Chats' },
        { action: 'conversation-settings', title: 'Settings' },
        { action: 'memory-management', title: 'Memory' },
        { action: 'delete-character', title: 'Delete character', danger: true },
      ]
    return items.map((item) => `
      <li class="chat-side-entry">
        <button class="${item.danger ? 'danger' : ''}" type="button" data-chat-side-action="${options.escapeHtml(item.action)}" aria-label="${options.escapeHtml(item.title)}">
          <span class="chat-side-entry-copy">
            ${item.danger ? '<i data-lucide="trash-2" aria-hidden="true"></i>' : ''}
            <strong>${options.escapeHtml(item.title)}</strong>
          </span>
          <span class="chat-side-entry-arrow" aria-hidden="true">›</span>
        </button>
      </li>
    `).join('')
  }

  function renderMessageContent(message: ChatMessage, language: ChatLanguageCode): string {
    const text = localizeChatText(message.text, language)
    if (!text.trim() && message.media?.length) {
      return ''
    }
    const voiceAttributes = getInlineVoiceTargetAttributes(message, language)
    if (message.role === 'assistant' && hasRoleplayChatMarkup(text)) {
      const markup = renderRoleplayChatMarkup(text, {
        escapeHtml: options.escapeHtml,
        speechAudioAttributes: voiceAttributes,
      })
      return markup || renderNoemaStreamStatus(language)
    }
    const voiceClass = voiceAttributes ? ' class="chat-inline-audio-target"' : ''
    const voiceAttrs = voiceAttributes ? ` ${voiceAttributes}` : ''
    return `<p${voiceClass}${voiceAttrs}>${options.escapeHtml(text)}</p>`
  }

  function renderOpeningPanel(message: ChatMessage): string {
    const panel = message.openingPanel
    if (!panel || (!panel.html && !panel.css)) {
      return ''
    }
    const html = sanitizeOpeningPanelHtml(panel.html)
    const css = sanitizeOpeningPanelCss(panel.css)
    return `
      <div class="chat-opening-panel" data-chat-opening-panel="${options.escapeHtml(panel.sourceArtifactId ?? '')}">
        ${css ? `<style>${css}</style>` : ''}
        ${html}
      </div>
    `
  }

  function sanitizeOpeningPanelHtml(value: string): string {
    return value
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
      .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, '')
  }

  function sanitizeOpeningPanelCss(value: string): string {
    return value
      .replace(/<\/?style[\s\S]*?>/gi, '')
      .replace(/@import[^;]+;/gi, '')
      .replace(/url\(\s*(['"]?)javascript:[^)]+\)/gi, 'none')
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
    const attachments = (message.media ?? []).filter((item) => item.kind !== 'audio')
    if (!attachments.length) {
      return ''
    }
    return `
      <div class="chat-message-attachments">
        ${attachments.map((item) => {
          const source = item.dataUrl || item.url || ''
          if (item.kind === 'video' && source) {
            return `
              <video class="chat-message-attachment video" src="${options.escapeHtml(source)}" controls preload="metadata" title="${options.escapeHtml(item.name)}"></video>
            `
          }
          if (source) {
            return `
              <img class="chat-message-attachment image ${item.origin === 'generated' ? 'generated' : ''}" src="${options.escapeHtml(source)}" alt="${options.escapeHtml(item.name)}" />
            `
          }
          return `<span class="chat-message-attachment file">${options.escapeHtml(item.name)}</span>`
        }).join('')}
      </div>
    `
  }

  function renderInlineVoice(message: ChatMessage, language: ChatLanguageCode): string {
    if (!canUseInlineVoice(message, language)) {
      return ''
    }
    const audioItems = getMessageAudioItems(message)
    if (audioItems.length) {
      return `
        <div class="chat-inline-audio" data-chat-inline-audio-bar>
          ${audioItems.map((item) => {
            const source = item.dataUrl || item.url || ''
            return `
              <div class="chat-inline-audio-item">
                <i data-lucide="volume-2" aria-hidden="true"></i>
                <audio src="${options.escapeHtml(source)}" controls preload="metadata" title="${options.escapeHtml(item.name)}"></audio>
              </div>
            `
          }).join('')}
        </div>
      `
    }
    if (message.state !== 'generating_audio') {
      return ''
    }
    const label = language === 'zh-CN' ? '生成语音中' : 'Generating voice'
    return `
      <div class="chat-inline-audio pending" aria-live="polite">
        <span>
          <i data-lucide="volume-2" aria-hidden="true"></i>
          ${options.escapeHtml(label)}
        </span>
      </div>
    `
  }

  function getInlineVoiceTargetAttributes(message: ChatMessage, language: ChatLanguageCode): string {
    if (!canUseInlineVoice(message, language)) {
      return ''
    }
    const hasAudio = getMessageAudioItems(message).length > 0
    const label = hasAudio
      ? language === 'zh-CN' ? '播放语音' : 'Play voice'
      : language === 'zh-CN' ? '生成语音' : 'Generate voice'
    return [
      'data-chat-inline-audio="true"',
      `data-chat-message-id="${options.escapeHtml(message.id)}"`,
      'role="button"',
      'tabindex="0"',
      `title="${options.escapeHtml(label)}"`,
      `aria-label="${options.escapeHtml(label)}"`,
    ].join(' ')
  }

  function canUseInlineVoice(message: ChatMessage, language: ChatLanguageCode): boolean {
    return message.role === 'assistant'
      && !message.id.startsWith('assistant-media-')
      && Boolean(localizeChatText(message.text, language).trim())
      && (message.state === undefined || message.state === 'generating_audio')
  }

  function getMessageAudioItems(message: ChatMessage): ChatMessage['media'] {
    return (message.media ?? []).filter((item) => {
      const source = item.dataUrl || item.url || ''
      return item.kind === 'audio' && Boolean(source)
    })
  }

  function renderMessageActions(message: ChatMessage, language: ChatLanguageCode, includeActions: boolean, actionMessageId: string): string {
    if (message.state === 'thinking' || message.role === 'system') {
      return ''
    }
    const canGenerateImage = includeActions
      && actionMessageId
      && message.id === actionMessageId
      && isActionableAssistantMessage(message, language)
    const deleteMessageId = message.id || actionMessageId
    const imageLabel = language === 'zh-CN' ? '生成图片' : 'Generate image'
    const deleteLabel = language === 'zh-CN' ? '删除回复' : 'Delete reply'
    return `
      <div class="chat-message-actions" role="toolbar" aria-label="${options.escapeHtml(language === 'zh-CN' ? '回复操作' : 'Reply actions')}">
        ${canGenerateImage ? `<button class="chat-message-action" type="button" data-chat-message-action="image" data-chat-message-id="${options.escapeHtml(actionMessageId)}" title="${options.escapeHtml(imageLabel)}" aria-label="${options.escapeHtml(imageLabel)}">
          <i data-lucide="image" aria-hidden="true"></i>
        </button>` : ''}
        <button class="chat-message-action danger" type="button" data-chat-message-action="delete" data-chat-message-id="${options.escapeHtml(deleteMessageId)}" title="${options.escapeHtml(deleteLabel)}" aria-label="${options.escapeHtml(deleteLabel)}">
          <i data-lucide="trash-2" aria-hidden="true"></i>
        </button>
      </div>
    `
  }

  function clearRenderedLatestTurnAddons(): void {
    options.messageList.querySelectorAll('.chat-inline-scene').forEach((element) => element.remove())
    options.messageList.querySelectorAll('[data-chat-message-action="image"]').forEach((element) => element.remove())
    options.messageList.querySelectorAll('.chat-message-actions').forEach((element) => {
      if (!element.querySelector('.chat-message-action')) {
        element.remove()
      }
    })
  }

  function renderActionIcons(root: HTMLElement): void {
    createIcons({
      icons: {
        Image: ImageIcon,
        Trash2,
        Volume2,
      },
      root,
      attrs: {
        width: 15,
        height: 15,
        'stroke-width': 2.2,
      },
    })
  }

  function renderAvatar(character: ChatCharacterResource, large: boolean): string {
    return `<span class="chat-avatar ${large ? 'large' : ''}">${renderAvatarImage(character, options.getLanguage())}</span>`
  }

  function shouldAutoFollowScroll(): boolean {
    const list = options.messageList
    if (list.childElementCount === 0) {
      return true
    }
    return list.scrollHeight - list.scrollTop - list.clientHeight < 96
  }

  function applyScrollAfterRender(shouldFollow: boolean, previousScrollTop: number): void {
    if (shouldFollow) {
      scrollToLatest()
      return
    }
    options.messageList.scrollTop = previousScrollTop
  }

  function scrollToLatest(): void {
    options.messageList.scrollTop = options.messageList.scrollHeight
  }

  function renderAvatarImage(character: ChatCharacterResource, language: ChatLanguageCode): string {
    const name = localizeChatText(character.displayName, language)
    const fallback = options.escapeHtml(name.slice(0, 1).toUpperCase() || 'N')
    if (!character.avatarImage) {
      return fallback
    }
    return `<img src="${options.escapeHtml(character.avatarImage)}" alt="${options.escapeHtml(name)}" onerror="this.replaceWith(document.createTextNode('${fallback}'))" />`
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
    replaceMessage,
    setAssistantMessageState,
    filterConversations,
  }
}

function formatState(state: NonNullable<ChatMessage['state']>, language: ChatLanguageCode): string {
  switch (state) {
    case 'generating_image':
      return language === 'zh-CN' ? '生成图片中 · ' : 'Generating image · '
    case 'generating_audio':
      return language === 'zh-CN' ? '生成语音中 · ' : 'Generating voice · '
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
