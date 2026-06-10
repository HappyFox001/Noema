/**
 * Owns the standalone chat surface interactions and window mode transitions.
 */
import claudeIconUrl from '@lobehub/icons-static-svg/icons/claude-color.svg?url'
import azureAIIconUrl from '@lobehub/icons-static-svg/icons/azureai-color.svg?url'
import deepseekIconUrl from '@lobehub/icons-static-svg/icons/deepseek-color.svg?url'
import geminiIconUrl from '@lobehub/icons-static-svg/icons/gemini-color.svg?url'
import groqIconUrl from '@lobehub/icons-static-svg/icons/groq.svg?url'
import newAPIIconUrl from '@lobehub/icons-static-svg/icons/newapi-color.svg?url'
import ollamaIconUrl from '@lobehub/icons-static-svg/icons/ollama.svg?url'
import openAIIconUrl from '@lobehub/icons-static-svg/icons/openai.svg?url'
import qwenIconUrl from '@lobehub/icons-static-svg/icons/qwen-color.svg?url'
import {
  LLM_PROVIDER_CATALOG,
  getLLMProviderCatalogEntry,
  type LLMProviderType,
} from '../../main/model-provider-catalog'
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
  type ChatMessageAttachment,
  type ChatMessage,
} from './chat-model'
import { createChatRenderer } from './chat-renderer'

type ChatResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

interface ChatModelConfig {
  id: string
  provider?: string
  modelName: string
  apiKey: string
  baseUrl: string
}

interface ChatSystemConfig {
  chatModels: ChatModelConfig[]
  activeChatId: string
  [key: string]: unknown
}

type PendingChatAttachment = ChatMessageAttachment

const CHAT_OUTPUT_TOKEN_MIN = 225
const CHAT_OUTPUT_TOKEN_MAX = 5000
const CHAT_OUTPUT_TOKEN_STEP = 50

interface ChatConversationSettings {
  textStreaming: boolean
  sceneImmersion: boolean
  language: 'auto' | 'zh-CN' | 'en-US'
  outputTokenBudget: number
  temperature: number
  diversity: number
}

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
  let resizing = false
  let resizeEdge: ChatResizeEdge | '' = ''
  let lastDragX = 0
  let lastDragY = 0
  const state = createInitialChatState()
  const panel = options.panel
  const shell = panel.querySelector<HTMLElement>('.chat-shell')
  const navItems = Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-chat-nav]'))
  const searchInput = panel.querySelector<HTMLInputElement>('.chat-search input')
  const modelList = panel.querySelector<HTMLElement>('.chat-model-list')
  const conversationSettingsPanel = panel.querySelector<HTMLElement>('.chat-conversation-settings-page')
  const conversationSettingsBody = panel.querySelector<HTMLElement>('.chat-conversation-settings-body')
  const conversationSettingsTitle = panel.querySelector<HTMLElement>('[data-chat-settings-title]')
  const conversationSettingsKicker = panel.querySelector<HTMLElement>('[data-chat-settings-kicker]')
  const conversationSettingsClose = panel.querySelector<HTMLElement>('[data-chat-settings-close]')
  const chatHistoryPanel = panel.querySelector<HTMLElement>('.chat-history-manager')
  const chatHistorySessionList = panel.querySelector<HTMLElement>('.chat-history-session-list')
  const chatHistoryMessageList = panel.querySelector<HTMLElement>('.chat-history-message-list')
  const chatHistoryTitle = panel.querySelector<HTMLElement>('[data-chat-history-title]')
  const chatHistoryKicker = panel.querySelector<HTMLElement>('[data-chat-history-kicker]')
  const languageButton = panel.querySelector<HTMLButtonElement>('[data-chat-action="language"]')
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
  const runtimeModelPicker = document.createElement('div')
  const attachmentTray = document.createElement('div')
  let chatSystemConfig: ChatSystemConfig | null = null
  let openChatModelDropdownId = ''
  let openChatProviderDropdownId = ''
  let openChatRuntimeModelPicker = false
  let activeChatRuntimeProvider = ''
  let pendingAttachments: PendingChatAttachment[] = []
  let cameraStream: MediaStream | null = null
  let cameraOverlay: HTMLElement | null = null
  const chatModelOptions = new Map<string, string[]>()
  const chatModelLoading = new Set<string>()
  let conversationSettings = loadConversationSettings()

  toast.className = 'chat-status-toast'
  toast.setAttribute('role', 'status')
  panel.appendChild(toast)
  runtimeModelPicker.className = 'chat-runtime-model-picker'
  runtimeModelPicker.setAttribute('aria-label', 'Chat model selector')
  options.composeForm.parentElement?.insertBefore(runtimeModelPicker, options.composeForm)
  attachmentTray.className = 'chat-attachment-tray'
  attachmentTray.setAttribute('aria-label', 'Selected attachments')
  options.composeForm.insertBefore(attachmentTray, options.composeForm.firstElementChild)

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
    syncChatView()
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
    panel.dataset.chatView = button.dataset.chatNav || 'session'
    syncSideActionState('')
    syncChatView()
    if (button.dataset.chatNav === 'models') {
      void loadChatModelConfig()
    }
    const label = button.getAttribute('aria-label') || 'Section'
    showToast(`${label} view`)
  }

  function syncChatView(): void {
    if (!panel.dataset.chatView) {
      panel.dataset.chatView = 'session'
    }
  }

  function setFullscreenState(active: boolean): void {
    fullscreen = active
    document.body.classList.toggle('chat-fullscreen', fullscreen)
    fullscreenButtons.forEach((button) => {
      button.classList.toggle('is-active', fullscreen)
      button.setAttribute('aria-label', fullscreen ? 'Exit fullscreen' : 'Toggle fullscreen')
    })
  }

  function setChatFullscreen(active: boolean): void {
    setFullscreenState(active)
    void window.electronAPI.setChatWindowMode(true, fullscreen).catch((error) => {
      console.warn('[Window] Failed to toggle chat fullscreen mode:', error)
    })
    showToast(fullscreen ? 'Fullscreen chat' : 'Windowed chat')
  }

  function isInteractiveTarget(target: EventTarget | null): boolean {
    return Boolean((target as HTMLElement | null)?.closest(
      'button, input, textarea, select, a, .chat-thread-list, .chat-composer, .chat-config-portrait, .chat-config-copy, .chat-asset-list, .chat-resize-handle'
    ))
  }

  function beginManualDrag(event: PointerEvent): void {
    if (event.button !== 0 || fullscreen || resizing || isInteractiveTarget(event.target)) {
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

  function isChatResizeEdge(value: string | undefined): value is ChatResizeEdge {
    return value === 'n'
      || value === 's'
      || value === 'e'
      || value === 'w'
      || value === 'ne'
      || value === 'nw'
      || value === 'se'
      || value === 'sw'
  }

  function beginChatResize(event: PointerEvent): void {
    const handle = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-chat-resize-edge]')
    if (event.button !== 0 || !handle || !panel.contains(handle)) {
      return
    }

    const edge = handle.dataset.chatResizeEdge
    if (!isChatResizeEdge(edge)) {
      return
    }

    resizing = true
    resizeEdge = edge
    lastDragX = event.screenX
    lastDragY = event.screenY
    panel.classList.add('is-resizing')
    handle.setPointerCapture?.(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }

  function updateChatResize(event: PointerEvent): void {
    if (!resizing || !resizeEdge) {
      return
    }

    const deltaX = Math.round(event.screenX - lastDragX)
    const deltaY = Math.round(event.screenY - lastDragY)
    lastDragX = event.screenX
    lastDragY = event.screenY
    if (deltaX === 0 && deltaY === 0) {
      return
    }

    void window.electronAPI.resizeChatWindow(resizeEdge, deltaX, deltaY).then((response) => {
      if (response.success) {
        setFullscreenState(Boolean(response.fullscreen))
      }
    }).catch((error) => {
      console.warn('[Window] Failed to resize chat window:', error)
    })
  }

  function endChatResize(): void {
    if (!resizing) {
      return
    }
    resizing = false
    resizeEdge = ''
    panel.classList.remove('is-resizing')
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
    void persistConversation(conversation)
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
        void createChatConversation()
        break
      case 'add-chat-model':
        void addChatModel()
        break
      case 'toggle-threads':
        toggleThreadsRail()
        break
      case 'close-chat-models':
        panel.dataset.chatView = 'session'
        navItems.forEach((item) => item.classList.toggle('active', item.dataset.chatNav === 'session'))
        navItems.forEach((item) => item.classList.toggle('is-active', item.dataset.chatNav === 'session'))
        syncSideActionState('')
        break
      case 'close-conversation-settings':
        closeConversationSettings()
        break
      case 'close-chat-history':
        closeChatHistoryManager()
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
        void selectLocalMedia()
        break
      case 'attach-video':
        void openCameraCapture()
        break
      case 'character-profile': {
        showToast(options.getLanguage() === 'zh-CN' ? '正在显示角色资料' : 'Showing character profile')
        break
      }
      default:
        break
    }
  }

  function toggleThreadsRail(): void {
    if (!shell) {
      return
    }
    const collapsed = !shell.classList.contains('threads-collapsed')
    shell.classList.toggle('threads-collapsed', collapsed)
    showToast(collapsed
      ? (options.getLanguage() === 'zh-CN' ? '会话栏已收起' : 'Conversation rail collapsed')
      : (options.getLanguage() === 'zh-CN' ? '会话栏已展开' : 'Conversation rail expanded'))
  }

  async function selectLocalMedia(): Promise<void> {
    try {
      const response = await window.electronAPI.selectChatMedia({ kind: 'media' })
      if (!response.success) {
        throw new Error(response.error || 'Failed to select media')
      }
      if (response.canceled || !response.attachments?.length) {
        return
      }
      addPendingAttachments(response.attachments.map(toPendingAttachment))
    } catch (error: any) {
      showToast(error?.message || String(error))
    }
  }

  async function openCameraCapture(): Promise<void> {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(options.getLanguage() === 'zh-CN' ? '当前环境不支持摄像头' : 'Camera is not available')
      }
      await closeCameraCapture()
      const permission = await window.electronAPI.requestChatCameraPermission()
      if (!permission.success || !permission.granted) {
        throw new Error(permission.openedSettings
          ? (options.getLanguage() === 'zh-CN' ? '请在系统设置中允许摄像头权限' : 'Enable camera permission in System Settings')
          : (permission.error || (options.getLanguage() === 'zh-CN' ? '摄像头权限未授予' : 'Camera permission was not granted')))
      }
      cameraOverlay = createCameraOverlay()
      panel.appendChild(cameraOverlay)
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      })
      const video = cameraOverlay.querySelector<HTMLVideoElement>('video')
      if (!video) {
        throw new Error('Camera preview is missing')
      }
      video.srcObject = cameraStream
      await waitForCameraReady(video, cameraOverlay)
      await video.play()
      setCameraReady(cameraOverlay, true)
    } catch (error: any) {
      await closeCameraCapture()
      showToast(error?.message || String(error))
    }
  }

  function createCameraOverlay(): HTMLElement {
    const overlay = document.createElement('div')
    overlay.className = 'chat-camera-overlay'
    overlay.dataset.ready = 'false'
    overlay.innerHTML = `
      <div class="chat-camera-panel">
        <div class="chat-camera-head">
          <span>${options.escapeHtml(options.getLanguage() === 'zh-CN' ? '摄像头' : 'Camera')}</span>
          <small data-chat-camera-status>${options.escapeHtml(options.getLanguage() === 'zh-CN' ? '正在启动' : 'Starting')}</small>
        </div>
        <div class="chat-camera-frame">
          <video class="chat-camera-preview" autoplay playsinline muted></video>
          <span class="chat-camera-loading">${options.escapeHtml(options.getLanguage() === 'zh-CN' ? '等待画面' : 'Waiting for video')}</span>
        </div>
        <div class="chat-camera-actions">
          <button type="button" data-chat-camera-action="close">${options.escapeHtml(options.getLanguage() === 'zh-CN' ? '关闭' : 'Close')}</button>
          <button class="primary" type="button" data-chat-camera-action="capture" disabled>${options.escapeHtml(options.getLanguage() === 'zh-CN' ? '拍照' : 'Capture')}</button>
        </div>
      </div>
    `
    overlay.addEventListener('click', (event) => {
      const action = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-chat-camera-action]')?.dataset.chatCameraAction
      if (action === 'close') {
        void closeCameraCapture()
      }
      if (action === 'capture') {
        captureCameraFrame(overlay.querySelector<HTMLVideoElement>('video'))
      }
    })
    return overlay
  }

  function waitForCameraReady(video: HTMLVideoElement, overlay: HTMLElement): Promise<void> {
    return new Promise((resolve, reject) => {
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth && video.videoHeight) {
        setCameraStatus(overlay, options.getLanguage() === 'zh-CN' ? '已就绪' : 'Ready')
        resolve()
        return
      }
      const timeout = window.setTimeout(() => {
        cleanup()
        reject(new Error(options.getLanguage() === 'zh-CN' ? '摄像头启动超时' : 'Camera startup timed out'))
      }, 8000)
      const cleanup = () => {
        window.clearTimeout(timeout)
        video.removeEventListener('loadedmetadata', onReady)
        video.removeEventListener('canplay', onReady)
        video.removeEventListener('error', onError)
      }
      const onReady = () => {
        if (video.readyState < HTMLMediaElement.HAVE_METADATA || !video.videoWidth || !video.videoHeight) {
          return
        }
        setCameraStatus(overlay, options.getLanguage() === 'zh-CN' ? '已就绪' : 'Ready')
        cleanup()
        resolve()
      }
      const onError = () => {
        cleanup()
        reject(new Error(options.getLanguage() === 'zh-CN' ? '摄像头预览失败' : 'Camera preview failed'))
      }
      video.addEventListener('loadedmetadata', onReady)
      video.addEventListener('canplay', onReady)
      video.addEventListener('error', onError)
    })
  }

  function setCameraReady(overlay: HTMLElement, ready: boolean): void {
    overlay.dataset.ready = ready ? 'true' : 'false'
    overlay.querySelector<HTMLButtonElement>('[data-chat-camera-action="capture"]')?.toggleAttribute('disabled', !ready)
  }

  function setCameraStatus(overlay: HTMLElement, text: string): void {
    const status = overlay.querySelector<HTMLElement>('[data-chat-camera-status]')
    if (status) {
      status.textContent = text
    }
  }

  function captureCameraFrame(video: HTMLVideoElement | null): void {
    if (!video || !video.videoWidth || !video.videoHeight) {
      showToast(options.getLanguage() === 'zh-CN' ? '摄像头尚未准备好' : 'Camera is not ready')
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) {
      return
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    addPendingAttachments([{
      id: `camera-${Date.now()}`,
      kind: 'image',
      name: `camera-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`,
      mimeType: 'image/jpeg',
      dataUrl,
      size: Math.round((dataUrl.length * 3) / 4),
    }])
    void closeCameraCapture()
  }

  async function closeCameraCapture(): Promise<void> {
    cameraStream?.getTracks().forEach((track) => track.stop())
    cameraStream = null
    cameraOverlay?.remove()
    cameraOverlay = null
  }

  function addPendingAttachments(attachments: PendingChatAttachment[]): void {
    pendingAttachments = [...pendingAttachments, ...attachments].slice(0, 8)
    renderPendingAttachments()
    options.composeInput.focus()
  }

  function renderPendingAttachments(): void {
    attachmentTray.classList.toggle('visible', pendingAttachments.length > 0)
    attachmentTray.innerHTML = pendingAttachments.map((attachment) => `
      <div class="chat-attachment-chip" data-chat-attachment-id="${options.escapeHtml(attachment.id)}">
        ${attachment.kind === 'video'
          ? `<video src="${options.escapeHtml(attachment.dataUrl || '')}" muted preload="metadata"></video>`
          : `<img src="${options.escapeHtml(attachment.dataUrl || '')}" alt="${options.escapeHtml(attachment.name)}" />`}
        <span>${options.escapeHtml(attachment.name)}</span>
        <button type="button" aria-label="Remove attachment" data-chat-attachment-remove="${options.escapeHtml(attachment.id)}">×</button>
      </div>
    `).join('')
  }

  function toPendingAttachment(attachment: Omit<PendingChatAttachment, 'id'> & { id?: string }): PendingChatAttachment {
    return {
      id: attachment.id || `attachment-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      kind: attachment.kind,
      name: attachment.name,
      mimeType: attachment.mimeType,
      dataUrl: attachment.dataUrl,
      size: attachment.size,
    }
  }

  async function queueAssistantReply(userText: string, attachments: ChatMessageAttachment[] = []): Promise<void> {
    const conversation = getActiveMutableConversation()
    if (!conversation) {
      showToast(options.getLanguage() === 'zh-CN' ? '角色资源尚未加载' : 'Character resources are not loaded')
      return
    }
    const character = getCharacterForConversation(state, conversation)
    const uiLanguage = options.getLanguage()
    const language = getEffectiveConversationLanguage()
    const message = createLocalAssistantDraft('', getTimeLabel())
    conversation.messages.push(message)
    conversation.preview = { 'zh-CN': '思考中...', 'en-US': 'Thinking...' }
    conversation.updatedLabel = { 'zh-CN': '现在', 'en-US': 'Now' }
    renderer.appendMessage(message)
    refreshConversationList()
    const request = {
      input: userText || (uiLanguage === 'zh-CN' ? '请根据附件进行回复。' : 'Please respond to the attached media.'),
      language,
      preferencePrompt: buildConversationPreferencePrompt(conversationSettings, language),
      options: buildConversationRequestOptions(conversationSettings),
      attachments: attachments.map((attachment) => ({
        kind: attachment.kind,
        name: attachment.name,
        mimeType: attachment.mimeType,
        dataUrl: attachment.dataUrl,
        size: attachment.size,
      })),
      messages: conversation.messages
        .filter((item) => item.id !== message.id)
        .slice(0, -1)
        .map((item) => ({
          role: item.role,
          content: localizeChatText(item.text, language),
        })),
      character: character ? {
        id: character.id,
        displayName: localizeChatText(character.displayName, language),
        description: localizeChatText(character.description, language),
        background: conversationSettings.sceneImmersion ? localizeChatText(character.background, language) : '',
        firstMessage: conversationSettings.sceneImmersion ? localizeChatText(character.firstMessage, language) : '',
        tags: character.tag[language] ?? character.tag['zh-CN'],
      } : undefined,
    }
    let completeReply = ''
    let visibleReply = ''
    let pendingReveal = ''
    let revealFrame = 0
    const renderVisibleReply = (): void => {
      message.text = { 'zh-CN': visibleReply, 'en-US': visibleReply }
      message.state = visibleReply ? undefined : 'thinking'
      conversation.preview = { 'zh-CN': visibleReply || '思考中...', 'en-US': visibleReply || 'Thinking...' }
      renderer.replaceMessage(message)
      refreshConversationList()
    }
    const revealNextReplySlice = (continueScheduling = true): void => {
      revealFrame = 0
      if (!pendingReveal) {
        return
      }
      const size = getStreamRevealSliceSize(pendingReveal)
      visibleReply += pendingReveal.slice(0, size)
      pendingReveal = pendingReveal.slice(size)
      renderVisibleReply()
      if (continueScheduling) {
        scheduleStreamReveal()
      }
    }
    const scheduleStreamReveal = (): void => {
      if (revealFrame || !pendingReveal) {
        return
      }
      revealFrame = window.requestAnimationFrame(revealNextReplySlice)
    }
    const enqueueStreamDelta = (delta: string): void => {
      completeReply += delta
      pendingReveal += delta
      scheduleStreamReveal()
    }
    const revealPendingReply = async (): Promise<void> => {
      while (pendingReveal) {
        await new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => {
            revealNextReplySlice(false)
            resolve()
          })
        })
      }
    }
    try {
      const response = conversationSettings.textStreaming && typeof window.electronAPI.streamChatMessage === 'function'
        ? await window.electronAPI.streamChatMessage(request, {
          onDelta(delta) {
            enqueueStreamDelta(delta)
          },
        })
        : await window.electronAPI.sendChatMessage(request)
      const responseReply = response.success ? response.response || '' : ''
      if (responseReply && responseReply !== completeReply) {
        enqueueStreamDelta(responseReply.slice(completeReply.length))
      }
      if (revealFrame) {
        window.cancelAnimationFrame(revealFrame)
        revealFrame = 0
      }
      await revealPendingReply()
      const reply = response.success
        ? (response.response || completeReply || visibleReply || '')
        : (response.error || 'Chat model failed')
      message.text = { 'zh-CN': reply, 'en-US': reply }
      message.state = undefined
      conversation.preview = { 'zh-CN': reply, 'en-US': reply }
      renderer.renderMessages(conversation.messages)
      refreshConversationList()
      void persistConversation(conversation)
      if (!response.success) {
        showToast(response.error || 'Chat model failed')
      }
    } catch (error: any) {
      const errorText = error?.message || String(error)
      message.text = { 'zh-CN': errorText, 'en-US': errorText }
      message.state = undefined
      conversation.preview = { 'zh-CN': errorText, 'en-US': errorText }
      renderer.renderMessages(conversation.messages)
      refreshConversationList()
      void persistConversation(conversation)
      showToast(errorText)
    }
  }

  async function loadChatModelConfig(): Promise<void> {
    try {
      const settings = await window.electronAPI.getSettings()
      chatSystemConfig = {
        ...settings.system,
        chatModels: settings.system.chatModels.length ? settings.system.chatModels.map((model) => ({ ...model })) : [createDefaultChatModel()],
        activeChatId: settings.system.activeChatId || settings.system.chatModels[0]?.id || 'default-chat',
      }
      if (!chatSystemConfig.chatModels.some((model) => model.id === chatSystemConfig!.activeChatId)) {
        chatSystemConfig.activeChatId = chatSystemConfig.chatModels[0]?.id || ''
      }
      renderChatModelConfig()
      renderChatRuntimeModelPicker()
    } catch (error: any) {
      showToast(error?.message || String(error))
    }
  }

  function renderChatRuntimeModelPicker(): void {
    const config = chatSystemConfig
    if (!config) {
      runtimeModelPicker.innerHTML = ''
      return
    }
    const groups = getUsableChatModelGroups(config)
    const activeModel = groups.flatMap((group) => group.models).find((model) => model.id === config.activeChatId)
      ?? groups[0]?.models[0]
      ?? null
    if (activeModel && config.activeChatId !== activeModel.id) {
      config.activeChatId = activeModel.id
      void saveChatModelConfig()
    }
    const activeProvider = activeChatRuntimeProvider && groups.some((group) => group.provider.value === activeChatRuntimeProvider)
      ? activeChatRuntimeProvider
      : getProviderEntry(activeModel?.provider).value
    activeChatRuntimeProvider = activeProvider
    const activeProviderGroup = groups.find((group) => group.provider.value === activeProvider) ?? groups[0]
    runtimeModelPicker.innerHTML = `
      <div class="chat-runtime-model-shell ${openChatRuntimeModelPicker ? 'open' : ''}">
        <button class="chat-runtime-model-current" type="button" data-chat-runtime-action="toggle-model-picker" ${groups.length ? '' : 'disabled'}>
          <span class="chat-runtime-model-icon">${activeModel ? renderChatModelLogo(activeModel) : renderProviderLogo('openai-compatible')}</span>
          <span class="chat-runtime-model-copy">
            <strong>${options.escapeHtml(activeModel?.modelName || (options.getLanguage() === 'zh-CN' ? '无模型' : 'No model'))}</strong>
            <small>${options.escapeHtml(activeModel ? getProviderEntry(activeModel.provider).label : (options.getLanguage() === 'zh-CN' ? '模型页添加' : 'Add in models'))}</small>
          </span>
          <span class="chat-runtime-model-chevron"></span>
        </button>
        ${openChatRuntimeModelPicker ? renderChatRuntimeModelMenu(groups, activeProviderGroup, activeModel?.id || '') : ''}
      </div>
    `
  }

  function renderChatRuntimeModelMenu(
    groups: Array<{ provider: ReturnType<typeof getProviderEntry>; models: ChatModelConfig[] }>,
    activeProviderGroup: { provider: ReturnType<typeof getProviderEntry>; models: ChatModelConfig[] } | undefined,
    activeModelId: string
  ): string {
    if (!groups.length || !activeProviderGroup) {
      return `
        <div class="chat-runtime-model-menu empty">
          <span>${options.escapeHtml(options.getLanguage() === 'zh-CN' ? '暂无可用模型' : 'No available models')}</span>
        </div>
      `
    }
    return `
      <div class="chat-runtime-model-menu">
        <div class="chat-runtime-provider-tabs">
          ${groups.map((group) => `
            <button class="${group.provider.value === activeProviderGroup.provider.value ? 'active' : ''}" type="button" data-chat-runtime-provider="${options.escapeHtml(group.provider.value)}">
              <span>${renderProviderLogo(group.provider.value)}</span>
              <strong>${options.escapeHtml(group.provider.label)}</strong>
              <small>${options.escapeHtml(String(group.models.length))}</small>
            </button>
          `).join('')}
        </div>
        <div class="chat-runtime-model-options">
          ${activeProviderGroup.models.map((model) => `
            <button class="${model.id === activeModelId ? 'selected' : ''}" type="button" data-chat-runtime-model-id="${options.escapeHtml(model.id)}">
              <strong>${options.escapeHtml(model.modelName)}</strong>
              <small>${options.escapeHtml(getProviderEntry(model.provider).label)}</small>
            </button>
          `).join('')}
        </div>
      </div>
    `
  }

  function getUsableChatModelGroups(config: ChatSystemConfig): Array<{ provider: ReturnType<typeof getProviderEntry>; models: ChatModelConfig[] }> {
    const grouped = new Map<string, { provider: ReturnType<typeof getProviderEntry>; models: ChatModelConfig[] }>()
    config.chatModels
      .filter(isUsableChatModel)
      .forEach((model) => {
        const provider = getProviderEntry(model.provider)
        const group = grouped.get(provider.value) ?? { provider, models: [] }
        group.models.push(model)
        grouped.set(provider.value, group)
      })
    return [...grouped.values()]
  }

  function isUsableChatModel(model: ChatModelConfig): boolean {
    const provider = getProviderEntry(model.provider)
    const hasModelName = Boolean(model.modelName.trim())
    const hasCredential = Boolean(model.apiKey.trim()) || provider.value === 'ollama'
    const hasEndpoint = Boolean(model.baseUrl.trim()) || provider.value === 'openai'
    return hasModelName && hasCredential && hasEndpoint
  }

  function openConversationSettings(): void {
    conversationSettingsPanel?.classList.add('visible')
    conversationSettingsPanel?.setAttribute('aria-hidden', 'false')
    syncSideActionState('conversation-settings')
    renderConversationSettings()
  }

  function closeConversationSettings(): void {
    conversationSettingsPanel?.classList.remove('visible')
    conversationSettingsPanel?.setAttribute('aria-hidden', 'true')
    syncSideActionState('')
  }

  function openChatHistoryManager(): void {
    chatHistoryPanel?.classList.add('visible')
    chatHistoryPanel?.setAttribute('aria-hidden', 'false')
    syncSideActionState('conversation-management')
    renderChatHistoryManager()
  }

  function closeChatHistoryManager(): void {
    chatHistoryPanel?.classList.remove('visible')
    chatHistoryPanel?.setAttribute('aria-hidden', 'true')
    syncSideActionState('')
  }

  function renderChatHistoryManager(): void {
    if (!chatHistorySessionList || !chatHistoryMessageList) {
      return
    }
    const language = options.getLanguage()
    const activeConversation = getActiveConversation(state)
    chatHistorySessionList.innerHTML = state.conversations.length
      ? state.conversations.map((conversation) => `
          <button class="chat-history-session ${conversation.id === state.activeConversationId ? 'is-active' : ''}" type="button" data-chat-history-conversation="${options.escapeHtml(conversation.id)}">
            <strong>${options.escapeHtml(localizeChatText(conversation.title, language))}</strong>
            <span>${options.escapeHtml(localizeChatText(conversation.preview, language))}</span>
            <small>${options.escapeHtml(localizeChatText(conversation.updatedLabel, language))}</small>
          </button>
        `).join('')
      : `<div class="chat-history-empty">${options.escapeHtml(language === 'zh-CN' ? '暂无历史对话' : 'No conversations')}</div>`

    if (!activeConversation) {
      chatHistoryMessageList.innerHTML = `<div class="chat-history-empty">${options.escapeHtml(language === 'zh-CN' ? '选择一段对话查看消息' : 'Select a conversation')}</div>`
      return
    }

    chatHistoryMessageList.innerHTML = `
      <div class="chat-history-thread-head">
        <div>
          <strong>${options.escapeHtml(localizeChatText(activeConversation.title, language))}</strong>
          <span>${options.escapeHtml(String(activeConversation.messages.length))} ${options.escapeHtml(language === 'zh-CN' ? '条消息' : 'messages')}</span>
        </div>
        <button type="button" data-chat-history-action="delete-conversation" data-chat-history-id="${options.escapeHtml(activeConversation.id)}">
          ${options.escapeHtml(language === 'zh-CN' ? '删除对话' : 'Delete')}
        </button>
      </div>
      <div class="chat-history-messages">
        ${activeConversation.messages.map((messageItem) => `
          <article class="chat-history-message ${options.escapeHtml(messageItem.role)}">
            <div>
              <strong>${options.escapeHtml(formatChatHistoryRole(messageItem.role, language))}</strong>
              <time>${options.escapeHtml(localizeChatText(messageItem.createdLabel, language))}</time>
            </div>
            <p>${options.escapeHtml(localizeChatText(messageItem.text, language))}</p>
            <button type="button" data-chat-history-action="delete-message" data-chat-history-message="${options.escapeHtml(messageItem.id)}">
              ${options.escapeHtml(language === 'zh-CN' ? '删除' : 'Remove')}
            </button>
          </article>
        `).join('')}
      </div>
    `
  }

  async function deleteActiveChatHistoryConversation(id: string): Promise<void> {
    state.conversations = state.conversations.filter((conversation) => conversation.id !== id)
    if (state.activeConversationId === id) {
      state.activeConversationId = state.conversations[0]?.id ?? ''
    }
    await window.electronAPI.deleteChatConversation(id)
    renderChat()
    renderChatHistoryManager()
  }

  async function deleteChatHistoryMessage(messageId: string): Promise<void> {
    const conversation = getActiveConversation(state)
    if (!conversation) {
      return
    }
    conversation.messages = conversation.messages.filter((message) => message.id !== messageId)
    const lastMessage = conversation.messages[conversation.messages.length - 1]
    conversation.preview = lastMessage?.text ?? { 'zh-CN': '', 'en-US': '' }
    conversation.updatedLabel = { 'zh-CN': '现在', 'en-US': 'Now' }
    await persistConversation(conversation)
    renderChat()
    renderChatHistoryManager()
  }

  async function clearChatHistory(): Promise<void> {
    state.conversations = []
    state.activeConversationId = ''
    await window.electronAPI.clearChatConversations()
    renderChat()
    renderChatHistoryManager()
  }

  async function createChatConversation(): Promise<void> {
    const character = state.characterResources.find((item) => item.id === getActiveConversation(state)?.characterId)
      ?? state.characterResources[0]
    if (!character) {
      showToast(options.getLanguage() === 'zh-CN' ? '角色资源尚未加载' : 'Character resources are not loaded')
      return
    }
    const now = getTimeLabel()
    const conversation: ChatConversationSummary = {
      id: `${character.id}-${Date.now()}`,
      characterId: character.id,
      title: character.displayName,
      preview: character.firstMessage,
      updatedLabel: { 'zh-CN': '刚刚', 'en-US': 'Now' },
      messages: [{
        id: `${character.id}-welcome-${Date.now()}`,
        role: 'assistant',
        text: character.firstMessage,
        createdLabel: { 'zh-CN': now, 'en-US': now },
      }],
    }
    state.conversations = [conversation, ...state.conversations]
    state.activeConversationId = conversation.id
    await persistConversation(conversation)
    renderChat()
    renderChatHistoryManager()
  }

  function syncSideActionState(activeAction: string): void {
    panel.querySelectorAll<HTMLElement>('[data-chat-side-action]').forEach((button) => {
      const active = button.dataset.chatSideAction === activeAction
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-pressed', active ? 'true' : 'false')
    })
  }

  function renderConversationSettings(): void {
    if (!conversationSettingsBody) {
      return
    }
    const language = options.getLanguage()
    const zh = language === 'zh-CN'
    conversationSettingsBody.innerHTML = `
      <div class="chat-settings-stage">
        <section class="chat-settings-intro" aria-label="${options.escapeHtml(zh ? '常规设置' : 'General settings')}">
          <span>${options.escapeHtml(zh ? '偏好' : 'Preferences')}</span>
          <p>${options.escapeHtml(zh
            ? '只影响当前设备上的 chat 对话偏好；不会打断正在进行的对话。'
            : 'Device-local chat preferences. The current conversation stays in place.')}</p>
        </section>

        <div class="chat-settings-toggles">
          ${renderConversationToggle('textStreaming', zh ? '文字流' : 'Text stream', zh ? '逐字呈现回复' : 'Progressive reveal')}
          ${renderConversationToggle('sceneImmersion', zh ? '场景化体验' : 'Scene mode', zh ? '引入角色场景与示例' : 'Use character scenes')}
        </div>

        <section class="chat-settings-language-panel">
          <div>
            <span class="chat-settings-section-label">${options.escapeHtml(zh ? '语言' : 'Language')}</span>
            <p>${options.escapeHtml(zh ? '用于角色资料与回复格式。' : 'For profile and response formatting.')}</p>
          </div>
          <label class="chat-settings-select-wrap">
            <select data-chat-setting="language" aria-label="${options.escapeHtml(zh ? '语言' : 'Language')}">
              ${renderConversationLanguageOption('auto', zh ? '跟随界面' : 'Follow UI')}
              ${renderConversationLanguageOption('zh-CN', zh ? '简体中文' : 'Simplified Chinese')}
              ${renderConversationLanguageOption('en-US', zh ? 'English' : 'English')}
            </select>
            <span aria-hidden="true"></span>
          </label>
        </section>

        <section class="chat-settings-budget-panel">
          <div class="chat-settings-panel-head">
            <div>
              <span class="chat-settings-section-label">${options.escapeHtml(zh ? '输出长度' : 'Output length')}</span>
              <p>${options.escapeHtml(zh ? '动态强调本次回复的目标输出 token。' : 'Dynamically emphasizes the target output tokens.')}</p>
            </div>
            <output>${options.escapeHtml(String(conversationSettings.outputTokenBudget))}</output>
          </div>
          ${renderConversationRange('outputTokenBudget', CHAT_OUTPUT_TOKEN_MIN, CHAT_OUTPUT_TOKEN_MAX, CHAT_OUTPUT_TOKEN_STEP, conversationSettings.outputTokenBudget, [
            { value: 225, label: zh ? '轻量' : 'Lean' },
            { value: 1000, label: zh ? '日常' : 'Daily' },
            { value: 2500, label: zh ? '长文' : 'Long' },
            { value: 5000, label: zh ? '深记忆' : 'Deep' },
          ])}
        </section>

        <section class="chat-settings-parameter-panel">
          <div class="chat-settings-panel-head compact">
            <div>
              <span class="chat-settings-section-label">${options.escapeHtml(zh ? '参数' : 'Parameters')}</span>
              <p>${options.escapeHtml(zh ? '创作空间与稳定性。' : 'Room and stability.')}</p>
            </div>
            <button type="button" data-chat-setting-reset>${options.escapeHtml(zh ? '重置' : 'Reset')}</button>
          </div>
          <div class="chat-settings-parameter-grid">
            ${renderConversationParameter('temperature', zh ? '温度' : 'Temperature', zh ? '克制' : 'Precise', zh ? '灵动' : 'Expressive')}
            ${renderConversationParameter('diversity', zh ? '内容多样性' : 'Diversity', zh ? '稳定' : 'Stable', zh ? '丰富' : 'Varied')}
          </div>
        </section>
      </div>
    `
  }

  function renderConversationToggle(key: 'textStreaming' | 'sceneImmersion', title: string, copy: string): string {
    const checked = conversationSettings[key]
    return `
      <label class="chat-settings-toggle-row">
        <span>
          <strong>${options.escapeHtml(title)}</strong>
          <small>${options.escapeHtml(copy)}</small>
        </span>
        <input type="checkbox" data-chat-setting="${key}" ${checked ? 'checked' : ''} />
        <i aria-hidden="true"></i>
      </label>
    `
  }

  function renderConversationLanguageOption(value: ChatConversationSettings['language'], label: string): string {
    return `<option value="${options.escapeHtml(value)}" ${conversationSettings.language === value ? 'selected' : ''}>${options.escapeHtml(label)}</option>`
  }

  function renderConversationRange(
    key: keyof Pick<ChatConversationSettings, 'outputTokenBudget' | 'temperature' | 'diversity'>,
    min: number,
    max: number,
    step: number,
    value: number,
    markers: Array<{ value: number; label: string }>
  ): string {
    const progress = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
    return `
      <div class="chat-settings-range" style="--chat-setting-progress: ${progress}%">
        <input type="range" data-chat-setting="${options.escapeHtml(key)}" min="${min}" max="${max}" step="${step}" value="${options.escapeHtml(String(value))}" />
        <div class="chat-settings-range-markers">
          ${markers.map((marker) => `
            <span style="left: ${Math.max(0, Math.min(100, ((marker.value - min) / (max - min)) * 100))}%">
              <b>${options.escapeHtml(String(marker.value))}</b>
              <em>${options.escapeHtml(marker.label)}</em>
            </span>
          `).join('')}
        </div>
      </div>
    `
  }

  function renderConversationParameter(key: 'temperature' | 'diversity', title: string, minLabel: string, maxLabel: string): string {
    const value = conversationSettings[key]
    return `
      <article class="chat-settings-parameter">
        <div>
          <strong>${options.escapeHtml(title)}</strong>
          <output>${options.escapeHtml(value.toFixed(2))}</output>
        </div>
        ${renderConversationRange(key, 0, 1, 0.05, value, [
          { value: 0, label: minLabel },
          { value: 1, label: maxLabel },
        ])}
      </article>
    `
  }

  function updateConversationSetting(control: HTMLInputElement | HTMLSelectElement): void {
    const key = control.dataset.chatSetting as keyof ChatConversationSettings | undefined
    if (!key) {
      return
    }
    if (key === 'textStreaming' || key === 'sceneImmersion') {
      conversationSettings = { ...conversationSettings, [key]: (control as HTMLInputElement).checked }
    } else if (key === 'language') {
      const value = control.value === 'zh-CN' || control.value === 'en-US' ? control.value : 'auto'
      conversationSettings = { ...conversationSettings, language: value }
    } else if (key === 'outputTokenBudget') {
      conversationSettings = {
        ...conversationSettings,
        outputTokenBudget: clampNumber(Number(control.value), CHAT_OUTPUT_TOKEN_MIN, CHAT_OUTPUT_TOKEN_MAX),
      }
    } else if (key === 'temperature' || key === 'diversity') {
      conversationSettings = { ...conversationSettings, [key]: clampNumber(Number(control.value), 0, 1) }
    }
    saveConversationSettings(conversationSettings)
    renderConversationSettings()
  }

  function getEffectiveConversationLanguage(): 'zh-CN' | 'en-US' {
    return conversationSettings.language === 'auto' ? options.getLanguage() : conversationSettings.language
  }

  function buildConversationRequestOptions(settings: ChatConversationSettings): Record<string, unknown> {
    return {
      temperature: settings.temperature,
      top_p: settings.diversity,
      max_tokens: Math.round(settings.outputTokenBudget),
    }
  }

  function buildConversationPreferencePrompt(settings: ChatConversationSettings, language: 'zh-CN' | 'en-US'): string {
    const targetTokens = Math.round(settings.outputTokenBudget)
    const outputLength = language === 'zh-CN'
      ? [
        '<conversation_preferences>',
        `本次回复的目标输出长度约为 ${targetTokens} tokens。`,
        `请主动围绕这个 token 预算组织回复的密度、段落数量和叙事推进速度。`,
        '如果用户明确要求更短或更长，以用户本轮要求优先；否则不要明显少于该预算，也不要为了凑长度重复内容。',
        settings.sceneImmersion
          ? '场景化体验已开启：可以使用角色背景、场景信息、示例对话和感官细节来推进故事。'
          : '场景化体验已关闭：不要主动扩写大段场景背景，优先保持直接、紧凑、围绕当前对话。',
        '</conversation_preferences>',
      ]
      : [
        '<conversation_preferences>',
        `Target this reply at roughly ${targetTokens} output tokens.`,
        'Use that token budget to decide density, paragraph count, and narrative pacing.',
        'If the user explicitly asks for a shorter or longer answer, follow the user; otherwise do not undershoot the budget noticeably and do not pad with repetition.',
        settings.sceneImmersion
          ? 'Scene mode is enabled: use character background, scene context, example dialogue, and sensory detail to move the story forward.'
          : 'Scene mode is disabled: do not proactively expand long scene background; stay direct, compact, and centered on the current exchange.',
        '</conversation_preferences>',
      ]
    return outputLength.join('\n')
  }

  function renderChatModelConfig(): void {
    if (!modelList) {
      return
    }
    const config = chatSystemConfig
    if (!config || config.chatModels.length === 0) {
      modelList.innerHTML = `<div class="chat-model-empty">${options.escapeHtml(options.getLanguage() === 'zh-CN' ? '暂无 chat 模型配置' : 'No chat model configured')}</div>`
      return
    }

    modelList.innerHTML = `
      <div class="chat-model-list-head">
        <span>${options.escapeHtml(options.getLanguage() === 'zh-CN' ? 'API 路由' : 'API routes')}</span>
        <small>${options.escapeHtml(options.getLanguage() === 'zh-CN' ? '管理 provider、模型名、密钥和地址。' : 'Manage provider, model name, key, and URL.')}</small>
      </div>
      ${config.chatModels.map((model) => renderChatModelCard(model, config)).join('')}
    `
  }

  function renderChatModelCard(model: ChatModelConfig, config: ChatSystemConfig): string {
    const canDelete = config.chatModels.length > 1
    const providerEntry = getProviderEntry(model.provider)
    return `
      <article class="chat-model-card" data-chat-model-id="${options.escapeHtml(model.id)}">
        <div class="chat-model-route">
          <span class="chat-model-logo">${renderChatModelLogo(model)}</span>
          <div class="chat-model-title">
            ${renderChatModelCombobox(model, providerEntry.defaultModel || 'model-name')}
            <span class="chat-model-provider-name">${options.escapeHtml(providerEntry.label)}</span>
          </div>
        </div>
        ${renderChatProviderSelect(model)}
        <div class="chat-model-fields">
          <div class="chat-model-field">
            <label>${options.escapeHtml(options.getLanguage() === 'zh-CN' ? '密钥' : 'Key')}</label>
            <input class="chat-model-input" type="password" data-chat-model-field="apiKey" value="${options.escapeHtml(model.apiKey)}" placeholder="${options.escapeHtml(providerEntry.defaultApiKeyPlaceholder)}" />
          </div>
          <div class="chat-model-field">
            <label>${options.escapeHtml(options.getLanguage() === 'zh-CN' ? '地址' : 'URL')}</label>
            <input class="chat-model-input" type="text" data-chat-model-field="baseUrl" value="${options.escapeHtml(model.baseUrl)}" placeholder="${options.escapeHtml(providerEntry.defaultBaseUrl)}" />
          </div>
          <div class="chat-model-actions" aria-label="Model actions">
            ${canDelete ? `<button class="danger" type="button" data-chat-model-action="delete">${options.escapeHtml(options.getLanguage() === 'zh-CN' ? '移除' : 'Remove')}</button>` : ''}
          </div>
        </div>
      </article>
    `
  }

  function renderChatModelCombobox(model: ChatModelConfig, placeholder: string): string {
    const open = openChatModelDropdownId === model.id
    return `
      <div class="chat-model-combo ${open ? 'open' : ''}">
        <input class="chat-model-input" type="text" data-chat-model-field="modelName" value="${options.escapeHtml(model.modelName)}" placeholder="${options.escapeHtml(placeholder)}" autocomplete="off" />
        <button class="chat-model-combo-trigger" type="button" data-chat-model-action="toggle-models" aria-label="${options.escapeHtml(options.getLanguage() === 'zh-CN' ? '选择模型' : 'Choose model')}"></button>
        ${open ? renderChatModelDropdown(model) : ''}
      </div>
    `
  }

  function renderChatModelDropdown(model: ChatModelConfig): string {
    const loading = chatModelLoading.has(model.id)
    const models = chatModelOptions.get(model.id) || []
    const emptyText = options.getLanguage() === 'zh-CN'
      ? '可手动输入，或从接口拉取模型列表。'
      : 'Type manually, or fetch available models.'
    return `
      <div class="chat-model-dropdown">
        <button class="chat-model-fetch" type="button" data-chat-model-action="get-models">
          ${options.escapeHtml(loading ? (options.getLanguage() === 'zh-CN' ? '获取中...' : 'Loading...') : 'Get models')}
        </button>
        ${models.length
          ? `<div class="chat-model-options">
              ${models.map((name) => `
                <button type="button" data-chat-model-action="choose-model" data-chat-model-name="${options.escapeHtml(name)}">
                  ${options.escapeHtml(name)}
                </button>
              `).join('')}
            </div>`
          : `<span class="chat-model-dropdown-empty">${options.escapeHtml(emptyText)}</span>`}
      </div>
    `
  }

  function renderChatProviderSelect(model: ChatModelConfig): string {
    const current = getProviderEntry(model.provider)
    const open = openChatProviderDropdownId === model.id
    return `
      <div class="chat-provider-select ${open ? 'open' : ''}">
        <button class="chat-provider-current" type="button" data-chat-model-action="toggle-providers" aria-label="${options.escapeHtml(options.getLanguage() === 'zh-CN' ? '选择服务商' : 'Choose provider')}">
          <span class="chat-provider-current-icon">${renderProviderLogo(current.value)}</span>
          <span class="chat-provider-current-copy">
            <strong>${options.escapeHtml(current.label)}</strong>
            <small>${options.escapeHtml(current.value)}</small>
          </span>
          <span class="chat-provider-current-chevron"></span>
        </button>
        ${open ? `<div class="chat-provider-menu" aria-label="Provider">
          ${LLM_PROVIDER_CATALOG.map((provider) => renderChatProviderOption(provider.value, model)).join('')}
        </div>` : ''}
      </div>
    `
  }

  function renderChatProviderOption(provider: LLMProviderType, model: ChatModelConfig): string {
    const selected = getProviderEntry(model.provider).value === provider
    const entry = getLLMProviderCatalogEntry(provider)
    return `
      <button class="chat-provider-option ${selected ? 'selected' : ''}" type="button" title="${options.escapeHtml(entry.label)}" data-chat-provider="${options.escapeHtml(provider)}">
        ${renderProviderLogo(provider)}
        <span>
          <strong>${options.escapeHtml(entry.label)}</strong>
          <small>${options.escapeHtml(entry.value)}</small>
        </span>
      </button>
    `
  }

  async function saveChatModelConfig(): Promise<void> {
    if (!chatSystemConfig) {
      return
    }
    const settings = await window.electronAPI.updateSettings({ system: chatSystemConfig as any })
    chatSystemConfig = {
      ...settings.system,
      chatModels: settings.system.chatModels.map((model) => ({ ...model })),
      activeChatId: settings.system.activeChatId,
    }
    renderChatRuntimeModelPicker()
  }

  async function selectRuntimeChatModel(id: string): Promise<void> {
    if (!chatSystemConfig || !chatSystemConfig.chatModels.some((model) => model.id === id && isUsableChatModel(model))) {
      return
    }
    chatSystemConfig.activeChatId = id
    openChatRuntimeModelPicker = false
    await saveChatModelConfig()
    renderChatRuntimeModelPicker()
  }

  async function addChatModel(): Promise<void> {
    if (!chatSystemConfig) {
      await loadChatModelConfig()
    }
    if (!chatSystemConfig) {
      return
    }
    const nextModel = createDefaultChatModel(`chat-${Date.now()}`)
    chatSystemConfig.chatModels.push(nextModel)
    if (!chatSystemConfig.activeChatId) {
      chatSystemConfig.activeChatId = nextModel.id
    }
    await saveChatModelConfig()
    renderChatModelConfig()
    renderChatRuntimeModelPicker()
  }

  async function updateChatModel(id: string, field: keyof ChatModelConfig, value: string): Promise<void> {
    if (!chatSystemConfig) {
      return
    }
    const model = chatSystemConfig.chatModels.find((item) => item.id === id)
    if (!model) {
      return
    }
    if (field === 'id') {
      return
    }
    model[field] = value
    await saveChatModelConfig()
    renderChatModelConfig()
    renderChatRuntimeModelPicker()
  }

  async function updateChatProvider(id: string, provider: string): Promise<void> {
    if (!chatSystemConfig) {
      return
    }
    const model = chatSystemConfig.chatModels.find((item) => item.id === id)
    if (!model) {
      return
    }
    const entry = getProviderEntry(provider)
    model.provider = entry.value
    model.modelName = model.modelName.trim() || entry.defaultModel
    model.baseUrl = entry.defaultBaseUrl
    openChatProviderDropdownId = ''
    await saveChatModelConfig()
    renderChatModelConfig()
    renderChatRuntimeModelPicker()
  }

  async function fetchChatModels(id: string): Promise<void> {
    if (!chatSystemConfig) {
      return
    }
    const model = chatSystemConfig.chatModels.find((item) => item.id === id)
    if (!model || chatModelLoading.has(id)) {
      return
    }
    openChatModelDropdownId = id
    chatModelLoading.add(id)
    renderChatModelConfig()
    try {
      const response = await window.electronAPI.listChatModels({
        provider: model.provider,
        apiKey: model.apiKey,
        baseUrl: model.baseUrl,
      })
      if (!response.success) {
        throw new Error(response.error || 'Failed to get models')
      }
      chatModelOptions.set(id, response.models || [])
      if (!response.models?.length) {
        showToast(options.getLanguage() === 'zh-CN' ? '没有返回可用模型' : 'No models returned')
      }
    } catch (error: any) {
      showToast(error?.message || String(error))
    } finally {
      chatModelLoading.delete(id)
      renderChatModelConfig()
      renderChatRuntimeModelPicker()
    }
  }

  async function deleteChatModel(id: string): Promise<void> {
    if (!chatSystemConfig || chatSystemConfig.chatModels.length <= 1) {
      return
    }
    chatSystemConfig.chatModels = chatSystemConfig.chatModels.filter((model) => model.id !== id)
    if (chatSystemConfig.activeChatId === id) {
      chatSystemConfig.activeChatId = chatSystemConfig.chatModels[0]?.id || ''
    }
    chatModelOptions.delete(id)
    if (openChatModelDropdownId === id) {
      openChatModelDropdownId = ''
    }
    if (openChatProviderDropdownId === id) {
      openChatProviderDropdownId = ''
    }
    await saveChatModelConfig()
    renderChatModelConfig()
    renderChatRuntimeModelPicker()
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
    void loadChatModelConfig()
  }

  function close(): void {
    if (!document.body.classList.contains('chat-open')) {
      return
    }
    void closeCameraCapture()
    setFullscreenState(false)
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
    const attachments = pendingAttachments.map((attachment) => ({ ...attachment }))
    if (!text && attachments.length === 0) {
      return
    }
    const conversation = getActiveMutableConversation()
    if (!conversation) {
      showToast(options.getLanguage() === 'zh-CN' ? '角色资源尚未加载' : 'Character resources are not loaded')
      return
    }
    const displayText = text || (options.getLanguage() === 'zh-CN' ? '已发送附件' : 'Sent attachment')
    const userMessage = createLocalUserMessage(displayText, getTimeLabel(), attachments)
    conversation.messages.push(userMessage)
    conversation.preview = { 'zh-CN': displayText, 'en-US': displayText }
    conversation.updatedLabel = { 'zh-CN': '现在', 'en-US': 'Now' }
    renderer.appendMessage(userMessage)
    refreshConversationList()
    options.composeInput.value = ''
    options.composeInput.style.height = 'auto'
    pendingAttachments = []
    renderPendingAttachments()
    void persistConversation(conversation)
    void queueAssistantReply(text, attachments)
  })

  navItems.forEach((button) => {
    button.addEventListener('click', () => setActiveNav(button))
  })

  searchInput?.addEventListener('input', () => {
    renderer.filterConversations(searchInput.value)
  })

  panel.addEventListener('click', (event) => {
    const eventTarget = event.target as HTMLElement
    if (eventTarget === conversationSettingsPanel) {
      closeConversationSettings()
      return
    }
    if (eventTarget === chatHistoryPanel) {
      closeChatHistoryManager()
      return
    }

    const historyConversation = eventTarget.closest<HTMLElement>('[data-chat-history-conversation]')
    if (historyConversation && panel.contains(historyConversation)) {
      setActiveConversation(historyConversation.dataset.chatHistoryConversation || '')
      renderChatHistoryManager()
      return
    }

    const historyAction = eventTarget.closest<HTMLElement>('[data-chat-history-action]')
    if (historyAction && panel.contains(historyAction)) {
      const action = historyAction.dataset.chatHistoryAction || ''
      if (action === 'clear') {
        void clearChatHistory()
      } else if (action === 'delete-conversation') {
        void deleteActiveChatHistoryConversation(historyAction.dataset.chatHistoryId || '')
      } else if (action === 'delete-message') {
        void deleteChatHistoryMessage(historyAction.dataset.chatHistoryMessage || '')
      }
      return
    }

    const settingsReset = eventTarget.closest<HTMLElement>('[data-chat-setting-reset]')
    if (settingsReset && panel.contains(settingsReset)) {
      conversationSettings = getDefaultConversationSettings()
      saveConversationSettings(conversationSettings)
      renderConversationSettings()
      showToast(options.getLanguage() === 'zh-CN' ? '对话设置已重置' : 'Conversation settings reset')
      return
    }

    const attachmentRemove = eventTarget.closest<HTMLElement>('[data-chat-attachment-remove]')
    if (attachmentRemove && panel.contains(attachmentRemove)) {
      const id = attachmentRemove.dataset.chatAttachmentRemove || ''
      pendingAttachments = pendingAttachments.filter((attachment) => attachment.id !== id)
      renderPendingAttachments()
      return
    }

    const runtimeAction = eventTarget.closest<HTMLElement>('[data-chat-runtime-action]')
    if (runtimeAction && panel.contains(runtimeAction)) {
      if (runtimeAction.dataset.chatRuntimeAction === 'toggle-model-picker') {
        openChatRuntimeModelPicker = !openChatRuntimeModelPicker
        renderChatRuntimeModelPicker()
      }
      return
    }

    const sideAction = eventTarget.closest<HTMLElement>('[data-chat-side-action]')
    if (sideAction && panel.contains(sideAction)) {
      if (sideAction.dataset.chatSideAction === 'conversation-management') {
        openChatHistoryManager()
        return
      }
      if (sideAction.dataset.chatSideAction === 'conversation-settings') {
        openConversationSettings()
        return
      }
      const labels = getChatSideActionLabels(options.getLanguage())
      const label = labels[sideAction.dataset.chatSideAction || ''] || ''
      showToast(label)
      return
    }

    const runtimeProvider = eventTarget.closest<HTMLElement>('[data-chat-runtime-provider]')
    if (runtimeProvider && panel.contains(runtimeProvider)) {
      activeChatRuntimeProvider = runtimeProvider.dataset.chatRuntimeProvider || activeChatRuntimeProvider
      openChatRuntimeModelPicker = true
      renderChatRuntimeModelPicker()
      return
    }

    const runtimeModel = eventTarget.closest<HTMLElement>('[data-chat-runtime-model-id]')
    if (runtimeModel && panel.contains(runtimeModel)) {
      void selectRuntimeChatModel(runtimeModel.dataset.chatRuntimeModelId || '')
      return
    }

    const modelAction = eventTarget.closest<HTMLElement>('[data-chat-model-action]')
    if (modelAction && panel.contains(modelAction)) {
      const card = modelAction.closest<HTMLElement>('[data-chat-model-id]')
      const modelId = card?.dataset.chatModelId || ''
      if (modelId && modelAction.dataset.chatModelAction === 'toggle-models') {
        openChatModelDropdownId = openChatModelDropdownId === modelId ? '' : modelId
        openChatProviderDropdownId = ''
        renderChatModelConfig()
      }
      if (modelId && modelAction.dataset.chatModelAction === 'toggle-providers') {
        openChatProviderDropdownId = openChatProviderDropdownId === modelId ? '' : modelId
        openChatModelDropdownId = ''
        renderChatModelConfig()
      }
      if (modelId && modelAction.dataset.chatModelAction === 'get-models') {
        void fetchChatModels(modelId)
      }
      if (modelId && modelAction.dataset.chatModelAction === 'choose-model') {
        void updateChatModel(modelId, 'modelName', modelAction.dataset.chatModelName || '')
      }
      if (modelId && modelAction.dataset.chatModelAction === 'delete') {
        void deleteChatModel(modelId)
      }
      return
    }

    const providerAction = eventTarget.closest<HTMLElement>('[data-chat-provider]')
    if (providerAction && panel.contains(providerAction)) {
      const card = providerAction.closest<HTMLElement>('[data-chat-model-id]')
      const modelId = card?.dataset.chatModelId || ''
      const provider = providerAction.dataset.chatProvider || ''
      if (modelId && provider) {
        void updateChatProvider(modelId, provider)
      }
      return
    }

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

  panel.addEventListener('change', (event) => {
    const settingsControl = (event.target as HTMLElement | null)?.closest<HTMLInputElement | HTMLSelectElement>('[data-chat-setting]')
    if (settingsControl && panel.contains(settingsControl)) {
      updateConversationSetting(settingsControl)
      return
    }
    const input = (event.target as HTMLElement | null)?.closest<HTMLInputElement>('[data-chat-model-field]')
    if (!input || !panel.contains(input)) {
      return
    }
    const card = input.closest<HTMLElement>('[data-chat-model-id]')
    const modelId = card?.dataset.chatModelId || ''
    const field = input.dataset.chatModelField as keyof ChatModelConfig | undefined
    if (!modelId || !field) {
      return
    }
    void updateChatModel(modelId, field, input.value.trim())
  })

  panel.addEventListener('input', (event) => {
    const settingsControl = (event.target as HTMLElement | null)?.closest<HTMLInputElement>('[data-chat-setting]')
    if (!settingsControl || !panel.contains(settingsControl)) {
      return
    }
    updateConversationSetting(settingsControl)
  })

  panel.addEventListener('pointerdown', beginChatResize)
  panel.addEventListener('pointerdown', beginManualDrag)
  window.addEventListener('pointermove', updateChatResize)
  window.addEventListener('pointermove', updateManualDrag)
  window.addEventListener('pointerup', endChatResize)
  window.addEventListener('pointerup', endManualDrag)
  window.addEventListener('pointercancel', endChatResize)
  window.addEventListener('pointercancel', endManualDrag)
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && conversationSettingsPanel?.classList.contains('visible')) {
      closeConversationSettings()
    }
    if (event.key === 'Escape' && chatHistoryPanel?.classList.contains('visible')) {
      closeChatHistoryManager()
    }
  })

  renderChat()
  void hydrateChatResources()
  void loadChatModelConfig()

  return { open, close, refreshLanguage: renderChat }

  function syncLanguageControl(): void {
    const language = options.getLanguage()
    syncNavLabels(language)
    languageButton?.setAttribute('aria-pressed', language === 'en-US' ? 'true' : 'false')
    languageButton?.setAttribute('aria-label', language === 'zh-CN' ? '切换到英文' : 'Switch to Chinese')
    languageButton?.setAttribute('title', language === 'zh-CN' ? 'Switch to English' : '切换到中文')
    if (!languageMark) {
      return
    }
    languageMark.dataset.language = language
  }

  function syncNavLabels(language: ReturnType<ChatPanelOptions['getLanguage']>): void {
    panel.querySelectorAll<HTMLElement>('[data-chat-label-zh][data-chat-label-en]').forEach((label) => {
      label.textContent = language === 'zh-CN' ? label.dataset.chatLabelZh ?? '' : label.dataset.chatLabelEn ?? ''
    })
    navItems.forEach((item) => {
      const label = item.querySelector<HTMLElement>('[data-chat-label-zh][data-chat-label-en]')
      const text = label?.textContent?.trim()
      if (!text) {
        return
      }
      item.setAttribute('aria-label', text)
      item.setAttribute('title', text)
    })
    if (conversationSettingsTitle) {
      conversationSettingsTitle.textContent = language === 'zh-CN' ? '对话设置' : 'Conversation settings'
    }
    if (conversationSettingsKicker) {
      conversationSettingsKicker.textContent = language === 'zh-CN' ? 'Conversation design' : 'Conversation design'
    }
    if (conversationSettingsClose) {
      conversationSettingsClose.textContent = language === 'zh-CN' ? '返回' : 'Back'
    }
    if (chatHistoryTitle) {
      chatHistoryTitle.textContent = language === 'zh-CN' ? '对话管理' : 'Conversation management'
    }
    if (chatHistoryKicker) {
      chatHistoryKicker.textContent = language === 'zh-CN' ? 'Archive' : 'Archive'
    }
    if (conversationSettingsPanel?.classList.contains('visible')) {
      renderConversationSettings()
    }
    if (chatHistoryPanel?.classList.contains('visible')) {
      renderChatHistoryManager()
    }
  }

  async function hydrateChatResources(): Promise<void> {
    try {
      applyChatResourceState(state, await loadChatResourceState())
      renderChat()
      await Promise.all(state.conversations.map((conversation) => persistConversation(conversation)))
    } catch (error) {
      console.warn('[Chat] Failed to load chat resources:', error)
      showToast(options.getLanguage() === 'zh-CN' ? '角色资源加载失败' : 'Failed to load character resources')
    }
  }

  async function persistConversation(conversation: ChatConversationSummary | undefined): Promise<void> {
    if (!conversation) {
      return
    }
    const response = await window.electronAPI.saveChatConversation({
      id: conversation.id,
      characterId: conversation.characterId,
      title: conversation.title,
      preview: conversation.preview,
      updatedLabel: conversation.updatedLabel,
      messages: conversation.messages.map((messageItem) => ({
        ...messageItem,
        state: undefined,
      })),
    })
    if (!response.success) {
      console.warn('[ChatHistory] Failed to persist conversation:', response.error)
    }
  }
}

function createDefaultChatModel(id = 'default-chat'): ChatModelConfig {
  const provider = getLLMProviderCatalogEntry('openai-compatible')
  return {
    id,
    provider: provider.value,
    modelName: provider.defaultModel,
    apiKey: '',
    baseUrl: provider.defaultBaseUrl,
  }
}

function getDefaultConversationSettings(): ChatConversationSettings {
  return {
    textStreaming: true,
    sceneImmersion: false,
    language: 'auto',
    outputTokenBudget: 450,
    temperature: 0.7,
    diversity: 0.7,
  }
}

function loadConversationSettings(): ChatConversationSettings {
  const defaults = getDefaultConversationSettings()
  try {
    const raw = window.localStorage.getItem('noema.chat.conversationSettings')
    if (!raw) {
      return defaults
    }
    const parsed = JSON.parse(raw) as Partial<ChatConversationSettings> & { contextBudget?: number }
    const savedOutputTokenBudget = parsed.outputTokenBudget ?? parsed.contextBudget
    return {
      textStreaming: typeof parsed.textStreaming === 'boolean' ? parsed.textStreaming : defaults.textStreaming,
      sceneImmersion: typeof parsed.sceneImmersion === 'boolean' ? parsed.sceneImmersion : defaults.sceneImmersion,
      language: parsed.language === 'zh-CN' || parsed.language === 'en-US' || parsed.language === 'auto' ? parsed.language : defaults.language,
      outputTokenBudget: Number.isFinite(Number(savedOutputTokenBudget))
        ? clampNumber(Number(savedOutputTokenBudget), CHAT_OUTPUT_TOKEN_MIN, CHAT_OUTPUT_TOKEN_MAX)
        : defaults.outputTokenBudget,
      temperature: Number.isFinite(Number(parsed.temperature)) ? clampNumber(Number(parsed.temperature), 0, 1) : defaults.temperature,
      diversity: Number.isFinite(Number(parsed.diversity)) ? clampNumber(Number(parsed.diversity), 0, 1) : defaults.diversity,
    }
  } catch {
    return defaults
  }
}

function saveConversationSettings(settings: ChatConversationSettings): void {
  try {
    window.localStorage.setItem('noema.chat.conversationSettings', JSON.stringify(settings))
  } catch {
    // Local storage may be unavailable in restricted renderer contexts.
  }
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.min(max, Math.max(min, value))
}

function formatChatHistoryRole(role: ChatMessage['role'], language: 'zh-CN' | 'en-US'): string {
  if (role === 'user') {
    return language === 'zh-CN' ? '你' : 'You'
  }
  if (role === 'system') {
    return 'System'
  }
  return language === 'zh-CN' ? '角色' : 'Character'
}

function getChatSideActionLabels(language: 'zh-CN' | 'en-US'): Record<string, string> {
  if (language === 'zh-CN') {
    return {
      'conversation-management': '对话管理',
      'conversation-settings': '对话设置',
      'memory-management': '记忆管理',
    }
  }
  return {
    'conversation-management': 'Chats',
    'conversation-settings': 'Settings',
    'memory-management': 'Memory',
  }
}

function getStreamRevealSliceSize(pending: string): number {
  if (pending.length > 1200) {
    return 24
  }
  if (pending.length > 480) {
    return 16
  }
  if (pending.length > 160) {
    return 10
  }
  return 5
}

function getProviderEntry(provider: string | undefined) {
  return getLLMProviderCatalogEntry(provider as LLMProviderType | undefined)
}

function renderChatModelLogo(model: ChatModelConfig | undefined): string {
  if (!model) {
    return renderProviderLogo('openai-compatible')
  }
  const provider = getProviderEntry(model.provider).value
  return renderProviderLogo(provider)
}

function renderProviderLogo(provider: LLMProviderType): string {
  const logo = getProviderLogo(provider)
  return `<img src="${logo.src}" alt="${logo.alt}" />`
}

function getProviderLogo(provider: LLMProviderType): { src: string; alt: string } {
  switch (provider) {
    case 'gemini':
      return { src: geminiIconUrl, alt: 'Gemini' }
    case 'claude':
      return { src: claudeIconUrl, alt: 'Claude' }
    case 'qwen':
      return { src: qwenIconUrl, alt: 'Qwen' }
    case 'deepseek':
      return { src: deepseekIconUrl, alt: 'DeepSeek' }
    case 'groq':
      return { src: groqIconUrl, alt: 'Groq' }
    case 'ollama':
      return { src: ollamaIconUrl, alt: 'Ollama' }
    case 'azure-openai':
      return { src: azureAIIconUrl, alt: 'Azure OpenAI' }
    case 'openai-compatible':
      return { src: newAPIIconUrl, alt: 'New API' }
    case 'openai':
    default:
      return { src: openAIIconUrl, alt: 'OpenAI' }
  }
}
