/**
 * Owns the standalone chat surface interactions and window mode transitions.
 */
import {
  createInitialChatState,
  createLocalAssistantDraft,
  createLocalUserMessage,
  getActiveConversation,
  getCharacterForConversation,
  type ChatConversationSummary,
  type ChatMessage,
} from './chat-model'
import { createChatRenderer } from './chat-renderer'

export interface ChatPanelController {
  open(): Promise<void>
  close(): void
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
  const generateButton = panel.querySelector<HTMLButtonElement>('[data-chat-action="generate-image"]')
  const generateLabel = generateButton?.querySelector<HTMLElement>('span')
  const windowCloseButton = panel.querySelector<HTMLButtonElement>('[data-chat-action="window-close"]')
  const windowFullscreenButton = panel.querySelector<HTMLButtonElement>('[data-chat-action="window-fullscreen"]')
  const fullscreenButtons = Array.from(panel.querySelectorAll<HTMLElement>('[data-chat-action="details"], [data-chat-action="window-fullscreen"]'))
  const renderer = createChatRenderer({
    panel,
    messageList: options.messageList,
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
    const conversation = getActiveConversation(state)
    const character = getCharacterForConversation(state, conversation)
    renderer.renderConversationList(state.conversations, state.characters, conversation.id)
    renderer.renderActiveConversation(conversation, character)
  }

  function refreshConversationList(): void {
    renderer.renderConversationList(state.conversations, state.characters, state.activeConversationId)
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

  function getActiveMutableConversation(): ChatConversationSummary {
    return getActiveConversation(state)
  }

  function setActiveConversation(conversationId: string): void {
    if (!state.conversations.some((conversation) => conversation.id === conversationId)) {
      return
    }
    state.activeConversationId = conversationId
    renderChat()
    showToast(getActiveConversation(state).title)
  }

  function createDraftConversation(): void {
    const draftCharacter = state.characters.find((character) => character.id === 'character-pack-draft') ?? state.characters[0]
    const conversation: ChatConversationSummary = {
      id: `draft-${Date.now()}`,
      characterId: draftCharacter.id,
      title: '新角色资源包',
      preview: '准备创建 manifest、persona、头像和生成配置。',
      updatedLabel: '新建',
      messages: [
        {
          id: `draft-welcome-${Date.now()}`,
          role: 'assistant',
          text: '先告诉我角色名、性格、视觉方向和用途。我会把它整理成角色资源包草稿。',
          createdLabel: '新建',
        },
      ],
    }
    state.conversations.unshift(conversation)
    state.activeConversationId = conversation.id
    renderChat()
  }

  function handleAction(action: string, target: HTMLElement): void {
    switch (action) {
      case 'language': {
        const nextLanguage = languageMark?.textContent === 'US' ? 'CN' : 'US'
        if (languageMark) {
          languageMark.textContent = nextLanguage
        }
        showToast(nextLanguage === 'US' ? 'English preview' : 'Chinese preview')
        break
      }
      case 'new-group':
        createDraftConversation()
        showToast('角色包草稿已创建')
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
      case 'generate-image':
        if (!generateButton || generateButton.classList.contains('is-loading')) {
          return
        }
        generateButton.classList.add('is-loading')
        if (generateLabel) {
          generateLabel.textContent = '生成中...'
        }
        queueLocalAssistantMessage('图片生成请求已进入队列。下一步会把角色视觉设定、参考图和用户描述合成为生成参数。', 'generating_image')
        showToast('图片生成请求已排队')
        window.setTimeout(() => {
          generateButton.classList.remove('is-loading')
          generateButton.classList.add('is-done')
          if (generateLabel) {
            generateLabel.textContent = '生成图片'
          }
          showToast('图片预览待接入')
          window.setTimeout(() => generateButton.classList.remove('is-done'), 1200)
        }, 900)
        break
      default:
        break
    }
  }

  function queueLocalAssistantMessage(text: string, stateOverride?: ChatMessage['state']): void {
    const conversation = getActiveMutableConversation()
    const message = createLocalAssistantDraft(text, getTimeLabel())
    if (stateOverride) {
      message.state = stateOverride
    }
    conversation.messages.push(message)
    conversation.preview = text
    conversation.updatedLabel = '现在'
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
    const userMessage = createLocalUserMessage(text, getTimeLabel())
    conversation.messages.push(userMessage)
    conversation.preview = text
    conversation.updatedLabel = '现在'
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

  return { open, close }
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
