/**
 * Owns the standalone chat surface interactions and window mode transitions.
 */
import {
  applyChatResourceState,
  createInitialChatState,
  createLocalAssistantDraft,
  createLocalUserMessage,
  getActiveConversation,
  getCharacterForConversation,
  loadChatResourceState,
  localizeChatText,
  type ChatConversationSummary,
  type ChatMessage,
} from './chat-model'
import { createChatRenderer } from './chat-renderer'

export interface ChatPanelController {
  open(): Promise<void>
  close(): void
  refreshLanguage(): void
}

export interface ChatPanelOptions {
  panel: HTMLElement
  closeButton: HTMLButtonElement
  composeForm: HTMLFormElement
  composeInput: HTMLTextAreaElement
  messageList: HTMLElement
  mainView: HTMLElement
  settingsPanel: HTMLElement
  getLanguage(): 'zh-CN' | 'en-US'
  setLanguage(language: 'zh-CN' | 'en-US'): Promise<void> | void
  escapeHtml(value: string): string
  waitForNextPaint(): Promise<void>
  enterFullWindowMode(): Promise<void>
  restoreCompactWindowMode(): Promise<void>
  pausePresence(): void
  resumePresence(): void
  onBeforeOpen?(): void
}

export function initializeChatPanel(options: ChatPanelOptions): ChatPanelController {
  let closeAnimationTimer: number | undefined
  let toastTimer: number | undefined
  let fullscreen = false
  let dragging = false
  let lastDragX = 0
  let lastDragY = 0
  const state = createInitialChatState()
  const panel = options.panel
  const navItems = Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-chat-nav]'))
  const searchInput = panel.querySelector<HTMLInputElement>('.chat-search input')
  const languageMark = panel.querySelector<HTMLElement>('.chat-language-mark')
  const windowCloseButton = panel.querySelector<HTMLButtonElement>('[data-chat-action="window-close"]')
  const windowFullscreenButton = panel.querySelector<HTMLButtonElement>('[data-chat-action="window-fullscreen"]')
  const fullscreenButtons = Array.from(panel.querySelectorAll<HTMLElement>('[data-chat-action="details"], [data-chat-action="window-fullscreen"]'))
  const renderer = createChatRenderer({
    panel,
    messageList: options.messageList,
    getLanguage: options.getLanguage,
    escapeHtml: options.escapeHtml,
  })
  const toast = document.createElement('div')

  toast.className = 'chat-status-toast'
  toast.setAttribute('role', 'status')
  panel.appendChild(toast)

  function showToast(message: string): void {
    toast.textContent = message
    toast.classList.add('visible')
    if (toastTimer !== undefined) {
      window.clearTimeout(toastTimer)
    }
    toastTimer = window.setTimeout(() => {
      toast.classList.remove('visible')
      toastTimer = undefined
    }, 1500)
  }

  function renderChat(): void {
    syncLanguageControl()
    const conversation = getActiveConversation(state)
    if (!conversation) {
      renderer.renderConversationList([], [], '')
      renderer.renderEmptyState()
      return
    }
    const character = getCharacterForConversation(state, conversation)
    if (!character) {
      renderer.renderConversationList([], [], '')
      renderer.renderEmptyState()
      return
    }
    renderer.renderConversationList(state.conversations, state.characterResources, conversation.id)
    renderer.renderActiveConversation(conversation, character)
  }

  function refreshConversationList(): void {
    renderer.renderConversationList(state.conversations, state.characterResources, state.activeConversationId)
    if (searchInput?.value) {
      renderer.filterConversations(searchInput.value)
    }
  }

  function setActiveNav(button: HTMLButtonElement): void {
    navItems.forEach((item) => item.classList.toggle('active', item === button))
    navItems.forEach((item) => item.classList.toggle('is-active', item === button))
    const label = button.getAttribute('aria-label') || 'Section'
    showToast(`${label} view`)
  }

  function setChatFullscreen(active: boolean): void {
    fullscreen = active
    document.body.classList.toggle('chat-fullscreen', fullscreen)
    fullscreenButtons.forEach((button) => {
      button.classList.toggle('is-active', fullscreen)
      button.setAttribute('aria-label', fullscreen ? 'Exit fullscreen' : 'Toggle fullscreen')
    })
    void window.electronAPI.setChatWindowMode(true, fullscreen).catch((error) => {
      console.warn('[Window] Failed to toggle chat fullscreen mode:', error)
    })
    showToast(fullscreen ? 'Fullscreen chat' : 'Windowed chat')
  }

  function isInteractiveTarget(target: EventTarget | null): boolean {
    return Boolean((target as HTMLElement | null)?.closest(
      'button, input, textarea, select, a, .chat-thread-list, .chat-composer, .chat-config-portrait, .chat-config-copy, .chat-asset-list'
    ))
  }

  function beginManualDrag(event: PointerEvent): void {
    if (event.button !== 0 || fullscreen || isInteractiveTarget(event.target)) {
      return
    }

    dragging = true
    lastDragX = event.screenX
    lastDragY = event.screenY
    event.preventDefault()
  }

  function updateManualDrag(event: PointerEvent): void {
    if (!dragging) {
      return
    }

    const deltaX = Math.round(event.screenX - lastDragX)
    const deltaY = Math.round(event.screenY - lastDragY)
    lastDragX = event.screenX
    lastDragY = event.screenY
    if (deltaX !== 0 || deltaY !== 0) {
      window.electronAPI.moveWindow(deltaX, deltaY)
    }
  }

  function endManualDrag(): void {
    dragging = false
  }

  function getTimeLabel(): string {
    return new Date().toLocaleTimeString(options.getLanguage() === 'zh-CN' ? 'zh-CN' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function getActiveMutableConversation(): ChatConversationSummary | undefined {
    return getActiveConversation(state)
  }

  function setActiveConversation(conversationId: string): void {
    if (!state.conversations.some((conversation) => conversation.id === conversationId)) {
      return
    }
    state.activeConversationId = conversationId
    renderChat()
    const conversation = getActiveConversation(state)
    if (conversation) {
      showToast(localizeChatText(conversation.title, options.getLanguage()))
    }
  }

  function handleAction(action: string, target: HTMLElement): void {
    switch (action) {
      case 'language': {
        const nextLanguage = options.getLanguage() === 'zh-CN' ? 'en-US' : 'zh-CN'
        void Promise.resolve(options.setLanguage(nextLanguage)).then(() => {
          syncLanguageControl()
          showToast(nextLanguage === 'zh-CN' ? '已切换中文' : 'Switched to English')
        })
        break
      }
      case 'new-group':
        showToast(options.getLanguage() === 'zh-CN' ? '先开始一次对话，角色才会进入历史列表' : 'Start a conversation before adding a character to history')
        break
      case 'voice-call':
        target.classList.toggle('is-active')
        showToast(target.classList.contains('is-active') ? 'Voice call ready' : 'Voice call closed')
        break
      case 'more':
        target.classList.toggle('is-active')
        showToast('Conversation actions')
        break
      case 'details':
      case 'window-fullscreen':
        setChatFullscreen(!fullscreen)
        break
      case 'window-close':
        close()
        break
      case 'video-play':
      case 'video-more':
        showToast('媒体预览将在图片生成接入后启用')
        break
      case 'suggestion':
        options.composeInput.value = target.dataset.message || ''
        options.composeInput.focus()
        options.composeInput.dispatchEvent(new Event('input'))
        break
      case 'attach-image':
      case 'attach-video':
        target.classList.toggle('is-active')
        showToast(action === 'attach-image' ? 'Image attachment selected' : 'Video attachment selected')
        break
      case 'character-profile': {
        showToast(options.getLanguage() === 'zh-CN' ? '正在显示角色资料' : 'Showing character profile')
        break
      }
      default:
        break
    }
  }

  function queueLocalAssistantMessage(text: string, stateOverride?: ChatMessage['state']): void {
    const conversation = getActiveMutableConversation()
    if (!conversation) {
      showToast(options.getLanguage() === 'zh-CN' ? '角色资源尚未加载' : 'Character resources are not loaded')
      return
    }
    const message = createLocalAssistantDraft(text, getTimeLabel())
    if (stateOverride) {
      message.state = stateOverride
    }
    conversation.messages.push(message)
    conversation.preview = { 'zh-CN': text, 'en-US': text }
    conversation.updatedLabel = { 'zh-CN': '现在', 'en-US': 'Now' }
    renderer.appendMessage(message)
    refreshConversationList()
    window.setTimeout(() => {
      message.state = undefined
      renderer.setAssistantMessageState(message.id, undefined)
    }, 700)
  }

  async function open(): Promise<void> {
    if (closeAnimationTimer !== undefined) {
      window.clearTimeout(closeAnimationTimer)
      closeAnimationTimer = undefined
    }

    options.onBeforeOpen?.()
    document.body.classList.add('window-mode-changing')
    options.pausePresence()
    let windowHiddenForResize = false
    try {
      await window.electronAPI.setWindowOpacity(0.01)
      windowHiddenForResize = true
      await options.enterFullWindowMode()
      document.body.classList.remove('settings-open', 'settings-closing')
      options.settingsPanel.classList.remove('visible', 'warping-in', 'warping-out')
      document.body.classList.add('chat-open')
      document.body.classList.remove('window-mode-changing')
      options.panel.classList.add('visible')
      options.panel.setAttribute('aria-hidden', 'false')
      options.mainView.setAttribute('aria-hidden', 'true')
      await options.waitForNextPaint()
    } finally {
      if (windowHiddenForResize) {
        await window.electronAPI.setWindowOpacity(1).catch((error) => {
          console.warn('[Window] Failed to restore window opacity:', error)
        })
      }
    }

    window.requestAnimationFrame(() => {
      options.messageList.scrollTop = options.messageList.scrollHeight
      options.composeInput.focus()
    })
  }

  function close(): void {
    if (!document.body.classList.contains('chat-open')) {
      return
    }
    fullscreen = false
    document.body.classList.remove('chat-fullscreen')
    fullscreenButtons.forEach((button) => button.classList.remove('is-active'))
    options.panel.classList.remove('visible')
    options.panel.setAttribute('aria-hidden', 'true')
    if (closeAnimationTimer !== undefined) {
      window.clearTimeout(closeAnimationTimer)
    }
    closeAnimationTimer = window.setTimeout(() => {
      void finishClose()
    }, 220)
  }

  async function finishClose(): Promise<void> {
    document.body.classList.add('window-mode-changing')
    try {
      await options.restoreCompactWindowMode()
    } catch (error) {
      console.warn('[Window] Failed to leave chat window mode:', error)
    } finally {
      document.body.classList.remove('chat-open', 'window-mode-changing')
      options.mainView.removeAttribute('aria-hidden')
      options.resumePresence()
      closeAnimationTimer = undefined
    }
  }

  options.closeButton.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    event.stopPropagation()
    close()
  })
  options.closeButton.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    close()
  })

  windowCloseButton?.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    event.stopPropagation()
  })
  windowCloseButton?.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    close()
  })

  windowFullscreenButton?.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    event.stopPropagation()
  })
  windowFullscreenButton?.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    setChatFullscreen(!fullscreen)
  })

  options.composeInput.addEventListener('input', () => {
    options.composeInput.style.height = 'auto'
    options.composeInput.style.height = `${Math.min(options.composeInput.scrollHeight, 120)}px`
  })

  options.composeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      options.composeForm.requestSubmit()
    }
  })

  options.composeForm.addEventListener('submit', (event) => {
    event.preventDefault()
    const text = options.composeInput.value.trim()
    if (!text) {
      return
    }
    const conversation = getActiveMutableConversation()
    if (!conversation) {
      showToast(options.getLanguage() === 'zh-CN' ? '角色资源尚未加载' : 'Character resources are not loaded')
      return
    }
    const userMessage = createLocalUserMessage(text, getTimeLabel())
    conversation.messages.push(userMessage)
    conversation.preview = { 'zh-CN': text, 'en-US': text }
    conversation.updatedLabel = { 'zh-CN': '现在', 'en-US': 'Now' }
    renderer.appendMessage(userMessage)
    refreshConversationList()
    options.composeInput.value = ''
    options.composeInput.style.height = 'auto'
    queueLocalAssistantMessage(buildLocalAssistantReply(text))
  })

  navItems.forEach((button) => {
    button.addEventListener('click', () => setActiveNav(button))
  })

  searchInput?.addEventListener('input', () => {
    renderer.filterConversations(searchInput.value)
  })

  panel.addEventListener('click', (event) => {
    const eventTarget = event.target as HTMLElement
    const thread = eventTarget.closest<HTMLElement>('[data-conversation-id]')
    if (thread && panel.contains(thread)) {
      setActiveConversation(thread.dataset.conversationId || '')
      return
    }

    const target = eventTarget.closest<HTMLElement>('[data-chat-action]')
    if (!target || !panel.contains(target)) {
      return
    }
    handleAction(target.dataset.chatAction || '', target)
  })

  panel.addEventListener('pointerdown', beginManualDrag)
  window.addEventListener('pointermove', updateManualDrag)
  window.addEventListener('pointerup', endManualDrag)
  window.addEventListener('pointercancel', endManualDrag)

  renderChat()
  void hydrateChatResources()

  return { open, close, refreshLanguage: renderChat }

  function syncLanguageControl(): void {
    if (!languageMark) {
      return
    }
    languageMark.dataset.language = options.getLanguage()
  }

  async function hydrateChatResources(): Promise<void> {
    try {
      applyChatResourceState(state, await loadChatResourceState())
      renderChat()
    } catch (error) {
      console.warn('[Chat] Failed to load chat resources:', error)
      showToast(options.getLanguage() === 'zh-CN' ? '角色资源加载失败' : 'Failed to load character resources')
    }
  }
}

function buildLocalAssistantReply(userText: string): string {
  if (/图片|头像|画|生成/.test(userText)) {
    return '我先把这条当作图片生成意图记录下来。真正接入后会从角色包里取视觉设定、参考图和 generation.json。'
  }
  if (/角色包|manifest|persona|导入|资源/.test(userText)) {
    return '可以。这里会走角色资源包流程：先补 manifest 和 persona，再校验资产路径，最后保存到本地角色库。'
  }
  if (/工具|执行|项目|文件/.test(userText)) {
    return '这类消息后续会交给 runtime 执行，chat 页面只展示流式文本、工具状态和最终结果。'
  }
  return '嗯，我记下了。现在这个 chat 页面先把消息、角色状态和资源包信息接起来，后面再接真实流式 runtime。'
}
