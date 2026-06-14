/**
 * Owns the standalone chat surface interactions and window mode transitions.
 */
import { getImageProviderCatalogEntry, getLLMProviderCatalogEntry } from '../../main/model-provider-catalog'
import {
  buildChatRuntimeTurnRequest,
  buildChatSummaryPrompt,
  getChatMessageOrdinal,
  mergeChatSceneState,
  selectChatSummaryBatch,
  stripChatSceneUpdateMarkup,
  trimChatSummaries,
} from '@noema/sdk/chat/conversation-runtime'
import {
  CHAT_CONTEXT_TURNS_MAX,
  CHAT_CONTEXT_TURNS_MIN,
  CHAT_OUTPUT_TOKEN_MAX,
  CHAT_OUTPUT_TOKEN_MIN,
  CHAT_SUMMARY_BATCH_MESSAGE_COUNT,
  CHAT_SUMMARY_LIMIT_MAX,
  CHAT_SUMMARY_LIMIT_MIN,
  buildConversationPreferencePrompt,
  buildConversationRequestOptions,
  clampNumber,
  getDefaultConversationSettings,
  loadConversationSettings,
  renderConversationSettingsPage,
  saveConversationSettings,
  type ChatConversationSettings,
} from './chat-conversation-settings'
import type {
  CharacterWorkflowModelChoice,
  CharacterResourceRunState,
  CharacterWorkflowFileTab,
  CharacterWorkflowSidePanel,
} from './chat-character-workflow-page'
import { serializeCharacterResourceGraph, type SerializedCharacterResourceLink, type SerializedCharacterResourceLinkKind } from './chat-character-resource-graph-state'
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
  type ChatMemorySummary,
  type ChatMessageAttachment,
  type ChatMessage,
} from './chat-model'
import {
  createDefaultChatModel,
  getActiveChatModelName,
  getAvailableModelNames,
  getChatProviderEntry,
  getChatModelType,
  getEnabledModelNames,
  getLLMProviderEntry,
  mergeModelNames,
  normalizeModelNameList,
  renderChatModelConfigPage,
  renderChatModelLogo,
  renderProviderLogo,
  type ChatModelConfig,
  type ChatSystemConfig,
} from './chat-model-config-page'
import { createChatRenderer } from './chat-renderer'

type ChatResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

type PendingChatAttachment = ChatMessageAttachment
type CharacterWorkflowPageModule = typeof import('./chat-character-workflow-page')

interface CharacterWorkflowEditorState {
  activePanel: CharacterWorkflowSidePanel
  sidebarCollapsed: boolean
  inspectorCollapsed: boolean
  nodeSearchOpen: boolean
}

interface CharacterResourceSlotConnectDetail {
  sourceNodeId: string
  sourceSlotId: string
  sourceSide: string
  sourceType: string
  targetNodeId: string
  targetSlotId: string
  targetSide: string
  targetType: string
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
  let characterPanelCollapsed = false
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
  const characterWorkflowRoot = panel.querySelector<HTMLElement>('.chat-character-workflow-root')
  const characterWorkflowTitle = panel.querySelector<HTMLElement>('[data-chat-character-workflow-title]')
  const chatHistoryPanel = panel.querySelector<HTMLElement>('.chat-history-manager')
  const chatHistorySessionList = panel.querySelector<HTMLElement>('.chat-history-session-list')
  const chatHistoryMessageList = panel.querySelector<HTMLElement>('.chat-history-message-list')
  const chatHistoryTitle = panel.querySelector<HTMLElement>('[data-chat-history-title]')
  const chatHistoryKicker = panel.querySelector<HTMLElement>('[data-chat-history-kicker]')
  const languageButton = panel.querySelector<HTMLButtonElement>('[data-chat-action="language"]')
  const languageMark = panel.querySelector<HTMLElement>('.chat-language-mark')
  const windowCloseButton = panel.querySelector<HTMLButtonElement>('[data-chat-action="window-close"]')
  const windowFullscreenButton = panel.querySelector<HTMLButtonElement>('[data-chat-action="window-fullscreen"]')
  const characterPanelButton = panel.querySelector<HTMLButtonElement>('[data-chat-action="toggle-character-panel"]')
  const fullscreenButtons = Array.from(panel.querySelectorAll<HTMLElement>('[data-chat-action="window-fullscreen"]'))
  const renderer = createChatRenderer({
    panel,
    messageList: options.messageList,
    getLanguage: options.getLanguage,
    escapeHtml: options.escapeHtml,
    getSceneCollapsed: () => sceneStateCollapsed,
  })
  const toast = document.createElement('div')
  const runtimeModelPicker = document.createElement('div')
  const attachmentTray = document.createElement('div')
  let chatSystemConfig: ChatSystemConfig | null = null
  let openChatModelDropdownId = ''
  let openChatProviderDropdownId = ''
  let openChatRuntimeModelPicker = false
  let openChatModelTypePicker = false
  let activeChatRuntimeProvider = ''
  let pendingAttachments: PendingChatAttachment[] = []
  let cameraStream: MediaStream | null = null
  let cameraOverlay: HTMLElement | null = null
  const chatModelOptions = new Map<string, string[]>()
  const chatModelLoading = new Set<string>()
  let conversationSettings = loadConversationSettings()
  let sceneStateCollapsed = false
  let characterWorkflowRenderToken = 0
  let characterWorkflowLazyRenderToken = 0
  let characterWorkflowPageModulePromise: Promise<CharacterWorkflowPageModule> | null = null
  const characterWorkflowConfigOverrides: Record<string, Record<string, unknown>> = {}
  const characterWorkflowPositionOverrides: Record<string, { x: number; y: number }> = {}
  let characterWorkflowRunState: CharacterResourceRunState | null = null
  let characterWorkflowRunCount = 0
  let characterWorkflowActiveTabId = 'workflow'
  let characterWorkflowPackTabOpen = false
  let selectedWorkflowNodeId = 'generation-goal'
  let lastCharacterResourceGraphSnapshot = ''
  let resourceViewStateSnapshot = ''
  let characterResourceDuplicateCount = 0
  let characterWorkflowClipboard: { sourceId: string } | null = null
  const characterResourceUndoStack: CharacterResourceHistorySnapshot[] = []
  const characterResourceRedoStack: CharacterResourceHistorySnapshot[] = []
  const characterResourceViewState = {
    zoom: 0.84,
    panX: 0,
    panY: 0,
    hideLinks: false,
    selectedNodeIds: ['generation-goal'] as string[],
    selectionBox: null as { x: number; y: number; width: number; height: number } | null,
    collapsedNodeIds: new Set<string>(),
    deletedNodeIds: new Set<string>(),
    duplicatedNodes: [] as Array<{ id: string; sourceId: string; offsetX: number; offsetY: number }>,
    addedNodes: [] as Array<{ id: string; type: string; title: string; x: number; y: number }>,
    nodeSizes: {} as Record<string, { width: number; height: number }>,
    selectedLinkId: '',
    linkKinds: {} as Record<string, SerializedCharacterResourceLinkKind>,
    customLinks: [] as SerializedCharacterResourceLink[],
    deletedLinkIds: new Set<string>(),
    replacedTargetSlots: new Set<string>(),
  }
  const characterWorkflowEditorState: CharacterWorkflowEditorState = {
    activePanel: 'workflow',
    sidebarCollapsed: false,
    inspectorCollapsed: false,
    nodeSearchOpen: false,
  }

  interface CharacterResourceHistorySnapshot {
    selectedWorkflowNodeId: string
    selectedNodeIds: string[]
    selectedLinkId: string
    configOverrides: Record<string, Record<string, unknown>>
    positionOverrides: Record<string, { x: number; y: number }>
    duplicatedNodes: Array<{ id: string; sourceId: string; offsetX: number; offsetY: number }>
    addedNodes: Array<{ id: string; type: string; title: string; x: number; y: number }>
    deletedNodeIds: string[]
    collapsedNodeIds: string[]
    nodeSizes: Record<string, { width: number; height: number }>
    customLinks: SerializedCharacterResourceLink[]
    deletedLinkIds: string[]
    replacedTargetSlots: string[]
    linkKinds: Record<string, SerializedCharacterResourceLinkKind>
  }
  let characterWorkflowDragging: {
    nodeId: string
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null = null
  let characterResourceViewportDrag: {
    mode: 'pan' | 'select'
    pointerId: number
    startX: number
    startY: number
    originPanX: number
    originPanY: number
  } | null = null
  let characterResourceNodeResize: {
    nodeId: string
    pointerId: number
    startX: number
    startY: number
    originWidth: number
    originHeight: number
  } | null = null

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
    const sceneChanged = ensureConversationSceneDefaults(conversation, character)
    renderer.renderConversationList(state.conversations, state.characterResources, conversation.id)
    renderer.renderActiveConversation(conversation, character)
    if (sceneChanged) {
      void persistConversation(conversation)
    }
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
    if (button.dataset.chatNav === 'character-workflow') {
      renderCharacterWorkflow()
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

  function setCharacterPanelCollapsed(collapsed: boolean): void {
    characterPanelCollapsed = collapsed
    shell?.classList.toggle('profile-collapsed', characterPanelCollapsed)
    characterPanelButton?.classList.toggle('is-active', characterPanelCollapsed)
    characterPanelButton?.setAttribute('aria-expanded', characterPanelCollapsed ? 'false' : 'true')
    characterPanelButton?.setAttribute(
      'aria-label',
      characterPanelCollapsed ? 'Show character panel' : 'Hide character panel'
    )
    characterPanelButton?.setAttribute(
      'title',
      characterPanelCollapsed ? 'Show character panel' : 'Hide character panel'
    )
  }

  function isInteractiveTarget(target: EventTarget | null): boolean {
    return Boolean((target as HTMLElement | null)?.closest(
      'button, input, textarea, select, a, .chat-thread-list, .chat-composer, .chat-config-portrait, .chat-config-copy, .chat-asset-list, .chat-resize-handle'
      + ', .chat-character-workflow-body'
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
        openChatModelTypePicker = !openChatModelTypePicker
        openChatModelDropdownId = ''
        openChatProviderDropdownId = ''
        renderChatModelConfig()
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
      case 'close-character-workflow':
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
      case 'toggle-character-panel':
        setCharacterPanelCollapsed(!characterPanelCollapsed)
        break
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
    if (character && ensureConversationSceneDefaults(conversation, character)) {
      void persistConversation(conversation)
    }
    const uiLanguage = options.getLanguage()
    const language = getEffectiveConversationLanguage()
    const message = createLocalAssistantDraft('', getTimeLabel())
    conversation.messages.push(message)
    conversation.preview = { 'zh-CN': '思考中...', 'en-US': 'Thinking...' }
    conversation.updatedLabel = { 'zh-CN': '现在', 'en-US': 'Now' }
    renderer.appendMessage(message)
    refreshConversationList()
    const request = buildChatRuntimeTurnRequest({
      input: userText,
      mediaFallbackInput: uiLanguage === 'zh-CN' ? '请根据附件进行回复。' : 'Please respond to the attached media.',
      language,
      preferencePrompt: buildConversationPreferencePrompt(conversationSettings, language),
      options: buildConversationRequestOptions(conversationSettings),
      attachments,
      conversation,
      draftMessageId: message.id,
      character,
      sceneImmersion: conversationSettings.sceneImmersion,
      shortTermMessageLimit: getShortTermMessageLimit(),
      summaryLimit: conversationSettings.summaryLimit,
    })
    let completeReply = ''
    let visibleReply = ''
    let pendingReveal = ''
    let revealFrame = 0
    const renderVisibleReply = (): void => {
      const displayReply = stripChatSceneUpdateMarkup(visibleReply)
      message.text = { 'zh-CN': displayReply, 'en-US': displayReply }
      message.state = displayReply ? undefined : 'thinking'
      conversation.preview = { 'zh-CN': displayReply || '思考中...', 'en-US': displayReply || 'Thinking...' }
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
      if (response.success && response.sceneUpdate) {
        conversation.sceneState = mergeChatSceneState(conversation.sceneState, response.sceneUpdate, language)
      }
      message.text = { 'zh-CN': reply, 'en-US': reply }
      message.state = undefined
      conversation.preview = { 'zh-CN': reply, 'en-US': reply }
      renderer.renderMessages(conversation.messages)
      refreshConversationList()
      void persistConversation(conversation)
      void summarizeConversationOverflow(conversation, language)
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

  async function summarizeConversationOverflow(
    conversation: ChatConversationSummary,
    language: 'zh-CN' | 'en-US',
    force = false
  ): Promise<void> {
    const batch = selectChatSummaryBatch(conversation, {
      language,
      shortTermMessageLimit: getShortTermMessageLimit(),
      batchMessageCount: CHAT_SUMMARY_BATCH_MESSAGE_COUNT,
      summaryLimit: conversationSettings.summaryLimit,
      force,
    })
    if (!batch) {
      return
    }

    try {
      const response = await window.electronAPI.sendChatMessage({
        input: buildChatSummaryPrompt(batch, language),
        language,
        options: {
          temperature: 0.2,
          top_p: 0.5,
          max_tokens: 420,
        },
      })
      const summaryText = response.success ? (response.response || '').trim() : ''
      if (!summaryText) {
        return
      }
      const summary: ChatMemorySummary = {
        id: `summary-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        text: { 'zh-CN': summaryText, 'en-US': summaryText },
        createdLabel: { 'zh-CN': getTimeLabel(), 'en-US': getTimeLabel() },
        messageCount: batch.messages.length,
        startMessageIndex: batch.startMessageIndex,
        endMessageIndex: batch.endMessageIndex,
        sourceMessageIds: batch.messages.map((messageItem) => messageItem.id),
      }
      conversation.summaries = trimSummaries([...conversation.summaries, summary])
      await persistConversation(conversation)
      if (chatHistoryPanel?.classList.contains('visible')) {
        renderChatHistoryManager()
      }
    } catch (error) {
      console.warn('[ChatSummary] Failed to summarize overflow context:', error)
    }
  }

  function getShortTermMessageLimit(): number {
    return Math.max(2, Math.round(conversationSettings.shortTermTurns) * 2)
  }

  function getConversationMessageOrdinal(conversation: ChatConversationSummary, messageId: string | undefined): number {
    return getChatMessageOrdinal(conversation, messageId)
  }

  function getRetainedSummaries(conversation: ChatConversationSummary): ChatMemorySummary[] {
    return trimSummaries(conversation.summaries)
  }

  function trimSummaries(summaries: ChatMemorySummary[]): ChatMemorySummary[] {
    return trimChatSummaries(summaries, conversationSettings.summaryLimit)
  }

  function ensureConversationSceneDefaults(
    conversation: ChatConversationSummary,
    character: ChatCharacterResource
  ): boolean {
    let changed = false
    const scene = { ...(conversation.sceneState ?? {}) }
    for (const [key, value] of Object.entries(character.scene ?? {})) {
      if (key === 'objective' || key === 'items') {
        continue
      }
      if (scene[key] === undefined || scene[key] === null || scene[key] === '') {
        scene[key] = structuredClone(value)
        changed = true
      }
    }
    if (changed) {
      conversation.sceneState = scene
    }
    return changed
  }

  async function loadChatModelConfig(): Promise<void> {
    try {
      const settings = await window.electronAPI.getSettings()
      chatSystemConfig = {
        ...settings.system,
        chatModels: settings.system.chatModels.length ? settings.system.chatModels.map((model) => ({ ...model })) : [createDefaultChatModel()],
        activeChatId: settings.system.activeChatId || settings.system.chatModels[0]?.id || 'default-chat',
        activeChatModelName: settings.system.activeChatModelName,
      }
      if (!chatSystemConfig.chatModels.some((model) => model.id === chatSystemConfig!.activeChatId)) {
        chatSystemConfig.activeChatId = chatSystemConfig.chatModels[0]?.id || ''
      }
      chatModelOptions.clear()
      chatSystemConfig.chatModels.forEach((model) => {
        const cachedModels = normalizeModelNameList(model.availableModels)
        if (cachedModels.length) {
          chatModelOptions.set(model.id, cachedModels)
        }
      })
      renderChatModelConfig()
      renderChatRuntimeModelPicker()
      refreshCharacterWorkflowModelsIfVisible()
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
    const activeModel = groups.flatMap((group) => group.models).find((model) => model.api.id === config.activeChatId && model.modelName === getActiveChatModelName(config))
      ?? groups[0]?.models[0]
      ?? null
    if (activeModel && (config.activeChatId !== activeModel.api.id || getActiveChatModelName(config) !== activeModel.modelName)) {
      config.activeChatId = activeModel.api.id
      config.activeChatModelName = activeModel.modelName
      activeModel.api.modelName = activeModel.modelName
      void saveChatModelConfig()
    }
    const activeProvider = activeChatRuntimeProvider && groups.some((group) => group.provider.value === activeChatRuntimeProvider)
      ? activeChatRuntimeProvider
      : getLLMProviderEntry(activeModel?.provider).value
    activeChatRuntimeProvider = activeProvider
    const activeProviderGroup = groups.find((group) => group.provider.value === activeProvider) ?? groups[0]
    runtimeModelPicker.innerHTML = `
      <div class="chat-runtime-model-shell ${openChatRuntimeModelPicker ? 'open' : ''}">
        <button class="chat-runtime-model-current" type="button" data-chat-runtime-action="toggle-model-picker" ${groups.length ? '' : 'disabled'}>
          <span class="chat-runtime-model-icon">${activeModel ? renderChatModelLogo(activeModel.api) : renderProviderLogo('openai-compatible')}</span>
          <span class="chat-runtime-model-copy">
            <strong>${options.escapeHtml(activeModel?.modelName || (options.getLanguage() === 'zh-CN' ? '无模型' : 'No model'))}</strong>
            <small>${options.escapeHtml(activeModel ? getLLMProviderEntry(activeModel.api.provider).label : (options.getLanguage() === 'zh-CN' ? '模型页添加' : 'Add in models'))}</small>
          </span>
          <span class="chat-runtime-model-chevron"></span>
        </button>
        ${openChatRuntimeModelPicker ? renderChatRuntimeModelMenu(groups, activeProviderGroup, activeModel) : ''}
      </div>
    `
  }

  function renderChatRuntimeModelMenu(
    groups: ChatRuntimeModelGroup[],
    activeProviderGroup: ChatRuntimeModelGroup | undefined,
    activeModel: ChatRuntimeModelOption | null
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
            <button class="${activeModel && model.api.id === activeModel.api.id && model.modelName === activeModel.modelName ? 'selected' : ''}" type="button" data-chat-runtime-model-id="${options.escapeHtml(model.api.id)}" data-chat-runtime-model-name="${options.escapeHtml(model.modelName)}">
              <strong>${options.escapeHtml(model.modelName)}</strong>
              <small>${options.escapeHtml(getLLMProviderEntry(model.api.provider).label)}</small>
            </button>
          `).join('')}
        </div>
      </div>
    `
  }

  type ChatRuntimeModelOption = { api: ChatModelConfig; modelName: string }

  type ChatRuntimeModelGroup = { provider: ReturnType<typeof getLLMProviderEntry>; models: ChatRuntimeModelOption[] }

  function getCharacterWorkflowModelChoices(): CharacterWorkflowModelChoice[] {
    const config = chatSystemConfig
    if (!config) {
      return []
    }
    return config.chatModels.flatMap((model) => {
      const kind = getChatModelType(model)
      const provider = getChatProviderEntry(model)
      return getEnabledModelNames(model).map((modelName) => ({
        id: `${model.id}::${modelName}`,
        kind,
        apiId: model.id,
        modelName,
        provider: provider.value,
        providerLabel: provider.label,
        logoHtml: renderChatModelLogo(model),
      }))
    })
  }

  function refreshCharacterWorkflowModelsIfVisible(): void {
    if (panel.dataset.chatView === 'character-workflow') {
      renderCharacterWorkflow()
    }
  }

  function getUsableChatModelGroups(config: ChatSystemConfig): ChatRuntimeModelGroup[] {
    const grouped = new Map<string, ChatRuntimeModelGroup>()
    config.chatModels
      .forEach((model) => {
        if (!isUsableChatApi(model)) {
          return
        }
        const provider = getLLMProviderEntry(model.provider)
        const group = grouped.get(provider.value) ?? { provider, models: [] }
        getEnabledModelNames(model).forEach((modelName) => {
          group.models.push({ api: model, modelName })
        })
        grouped.set(provider.value, group)
      })
    return [...grouped.values()]
  }

  function isUsableChatApi(model: ChatModelConfig): boolean {
    if (getChatModelType(model) !== 'llm') {
      return false
    }
    const provider = getLLMProviderEntry(model.provider)
    const hasModelName = getEnabledModelNames(model).length > 0
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
    const zh = language === 'zh-CN'
    const activeConversation = getActiveConversation(state)
    if (!activeConversation) {
      chatHistorySessionList.innerHTML = ''
      chatHistoryMessageList.innerHTML = `<div class="chat-history-empty">${options.escapeHtml(zh ? '暂无可管理的对话' : 'No conversation to manage')}</div>`
      return
    }

    const stableMessages = activeConversation.messages.filter((messageItem) => messageItem.state === undefined)
    const keepMessages = getShortTermMessageLimit()
    const recentMessages = stableMessages.slice(-keepMessages)
    const retainedSummaries = getRetainedSummaries(activeConversation)
    const archivedCount = Math.max(0, stableMessages.length - recentMessages.length)
    const summaryCovered = retainedSummaries.reduce((count, summary) => count + summary.messageCount, 0)
    chatHistorySessionList.innerHTML = `
      <section class="chat-context-brief">
        <div>
          <span>${options.escapeHtml(zh ? '当前对话' : 'Current thread')}</span>
          <strong>${options.escapeHtml(localizeChatText(activeConversation.title, language))}</strong>
          <p>${options.escapeHtml(localizeChatText(activeConversation.preview, language))}</p>
        </div>
        <button type="button" data-chat-history-action="delete-conversation" data-chat-history-id="${options.escapeHtml(activeConversation.id)}">
          ${options.escapeHtml(zh ? '删除整段' : 'Delete thread')}
        </button>
      </section>
      <section class="chat-context-controls">
        ${renderContextControl(
          'shortTermTurns',
          zh ? '短期完整轮数' : 'Short-term turns',
          zh ? '最近这些轮次会原样进入模型上下文。' : 'The latest turns are sent as full messages.',
          CHAT_CONTEXT_TURNS_MIN,
          CHAT_CONTEXT_TURNS_MAX,
          1,
          conversationSettings.shortTermTurns,
          zh ? '轮' : 'turns'
        )}
        ${renderContextControl(
          'summaryLimit',
          zh ? '摘要保留条数' : 'Summary limit',
          zh ? '旧上下文会压缩为摘要，并按此上限保留。' : 'Older context is compressed and kept up to this limit.',
          CHAT_SUMMARY_LIMIT_MIN,
          CHAT_SUMMARY_LIMIT_MAX,
          1,
          conversationSettings.summaryLimit,
          zh ? '条' : 'items'
        )}
      </section>
      <section class="chat-context-metrics">
        <span><b>${options.escapeHtml(String(recentMessages.length))}</b>${options.escapeHtml(zh ? '完整消息' : 'full messages')}</span>
        <span><b>${options.escapeHtml(String(retainedSummaries.length))}</b>${options.escapeHtml(zh ? '摘要' : 'summaries')}</span>
        <span><b>${options.escapeHtml(String(summaryCovered))}</b>${options.escapeHtml(zh ? '已压缩消息' : 'compressed')}</span>
        <span><b>${options.escapeHtml(String(archivedCount))}</b>${options.escapeHtml(zh ? '候选旧消息' : 'older')}</span>
      </section>
    `

    chatHistoryMessageList.innerHTML = `
      <section class="chat-context-section">
        <div class="chat-context-section-head">
          <div>
            <span>${options.escapeHtml(zh ? '长期摘要' : 'Long-term summaries')}</span>
            <strong>${options.escapeHtml(zh ? '摘要管理' : 'Summary management')}</strong>
          </div>
          <button type="button" data-chat-history-action="summarize-now">${options.escapeHtml(zh ? '立即整理' : 'Summarize')}</button>
        </div>
        <div class="chat-history-summaries">
          ${retainedSummaries.length
            ? retainedSummaries.slice().reverse().map((summary) => `
              <article class="chat-history-summary">
                <div>
                  <strong>${options.escapeHtml(localizeChatText(summary.createdLabel, language))}</strong>
                  <span>${options.escapeHtml(formatSummaryRange(summary, language))}</span>
                </div>
                <p>${options.escapeHtml(localizeChatText(summary.text, language))}</p>
                <button type="button" data-chat-history-action="delete-summary" data-chat-history-summary="${options.escapeHtml(summary.id)}">
                  ${options.escapeHtml(zh ? '删除摘要' : 'Remove summary')}
                </button>
              </article>
            `).join('')
            : `<div class="chat-history-empty compact">${options.escapeHtml(zh ? '旧消息超过短期范围后，会在回复完成时自动生成摘要。' : 'Summaries appear automatically after older messages exceed the short-term range.')}</div>`}
        </div>
      </section>
      <section class="chat-context-section">
        <div class="chat-context-section-head">
          <div>
            <span>${options.escapeHtml(zh ? '短期上下文' : 'Short-term context')}</span>
            <strong>${options.escapeHtml(zh ? '保留的完整消息' : 'Full messages kept')}</strong>
          </div>
          <small>${options.escapeHtml(String(recentMessages.length))} / ${options.escapeHtml(String(stableMessages.length))}</small>
        </div>
        <div class="chat-history-messages">
          ${recentMessages.length ? recentMessages.map((messageItem) => `
          <article class="chat-history-message ${options.escapeHtml(messageItem.role)}">
            <div>
              <strong>${options.escapeHtml(formatChatHistoryRole(messageItem.role, language))}</strong>
              <time>${options.escapeHtml(localizeChatText(messageItem.createdLabel, language))}</time>
            </div>
            <p>${options.escapeHtml(localizeChatText(messageItem.text, language))}</p>
            <button type="button" data-chat-history-action="delete-message" data-chat-history-message="${options.escapeHtml(messageItem.id)}">
              ${options.escapeHtml(zh ? '删除' : 'Remove')}
            </button>
          </article>
        `).join('') : `<div class="chat-history-empty compact">${options.escapeHtml(zh ? '暂无短期消息' : 'No short-term messages')}</div>`}
        </div>
      </section>
    `
  }

  function renderContextControl(
    key: 'shortTermTurns' | 'summaryLimit',
    title: string,
    copy: string,
    min: number,
    max: number,
    step: number,
    value: number,
    unit: string
  ): string {
    const progress = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
    return `
      <label class="chat-context-control" style="--chat-context-progress: ${progress}%">
        <span>
          <strong>${options.escapeHtml(title)}</strong>
          <small>${options.escapeHtml(copy)}</small>
        </span>
        <output>${options.escapeHtml(String(value))}<em>${options.escapeHtml(unit)}</em></output>
        <input type="range" data-chat-setting="${options.escapeHtml(key)}" min="${min}" max="${max}" step="${step}" value="${options.escapeHtml(String(value))}" />
      </label>
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
    conversation.summaries = conversation.summaries.filter((summary) => !summary.sourceMessageIds.includes(messageId))
    const lastMessage = conversation.messages[conversation.messages.length - 1]
    conversation.preview = lastMessage?.text ?? { 'zh-CN': '', 'en-US': '' }
    conversation.updatedLabel = { 'zh-CN': '现在', 'en-US': 'Now' }
    await persistConversation(conversation)
    renderChat()
    renderChatHistoryManager()
  }

  async function deleteChatHistorySummary(summaryId: string): Promise<void> {
    const conversation = getActiveConversation(state)
    if (!conversation) {
      return
    }
    conversation.summaries = conversation.summaries.filter((summary) => summary.id !== summaryId)
    await persistConversation(conversation)
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
      sceneState: character.scene,
      summaries: [],
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
    conversationSettingsBody.innerHTML = renderConversationSettingsPage(conversationSettings, {
      language: options.getLanguage(),
      escapeHtml: options.escapeHtml,
    })
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
    } else if (key === 'shortTermTurns') {
      conversationSettings = {
        ...conversationSettings,
        shortTermTurns: Math.round(clampNumber(Number(control.value), CHAT_CONTEXT_TURNS_MIN, CHAT_CONTEXT_TURNS_MAX)),
      }
    } else if (key === 'summaryLimit') {
      conversationSettings = {
        ...conversationSettings,
        summaryLimit: Math.round(clampNumber(Number(control.value), CHAT_SUMMARY_LIMIT_MIN, CHAT_SUMMARY_LIMIT_MAX)),
      }
      const conversation = getActiveMutableConversation()
      if (conversation) {
        conversation.summaries = trimSummaries(conversation.summaries)
        void persistConversation(conversation)
      }
    }
    saveConversationSettings(conversationSettings)
    renderConversationSettings()
    if (chatHistoryPanel?.classList.contains('visible')) {
      renderChatHistoryManager()
    }
  }

  function getEffectiveConversationLanguage(): 'zh-CN' | 'en-US' {
    return conversationSettings.language === 'auto' ? options.getLanguage() : conversationSettings.language
  }

  function renderChatModelConfig(): void {
    if (!modelList) {
      return
    }
    modelList.innerHTML = renderChatModelConfigPage(chatSystemConfig, {
      language: options.getLanguage(),
      escapeHtml: options.escapeHtml,
      openTypePicker: openChatModelTypePicker,
      openModelDropdownId: openChatModelDropdownId,
      openProviderDropdownId: openChatProviderDropdownId,
      loadingModelIds: chatModelLoading,
      modelOptions: chatModelOptions,
    })
  }

  function loadCharacterWorkflowPageModule(): Promise<CharacterWorkflowPageModule> {
    characterWorkflowPageModulePromise ??= import('./chat-character-workflow-page')
    return characterWorkflowPageModulePromise
  }

  function renderCharacterWorkflow(): void {
    void renderCharacterWorkflowAsync()
  }

  async function renderCharacterWorkflowAsync(): Promise<void> {
    if (!characterWorkflowRoot) {
      return
    }
    const renderToken = ++characterWorkflowLazyRenderToken
    if (!characterWorkflowRoot.childElementCount) {
      characterWorkflowRoot.innerHTML = `<div class="chat-workflow-loading"><span>${options.escapeHtml(options.getLanguage() === 'zh-CN' ? '正在加载角色资源图...' : 'Loading character resource graph...')}</span></div>`
    }
    const workflowPage = await loadCharacterWorkflowPageModule()
    if (renderToken !== characterWorkflowLazyRenderToken) {
      return
    }
    characterWorkflowRoot.innerHTML = workflowPage.renderCharacterWorkflowPage({
      language: options.getLanguage(),
      escapeHtml: options.escapeHtml,
      modelChoices: getCharacterWorkflowModelChoices(),
      configOverrides: characterWorkflowConfigOverrides,
      positionOverrides: characterWorkflowPositionOverrides,
      runState: characterWorkflowRunState,
      tabs: getCharacterWorkflowTabs(),
      activeTabId: characterWorkflowActiveTabId,
      selectedNodeId: selectedWorkflowNodeId,
      activePanel: characterWorkflowEditorState.activePanel,
      sidebarCollapsed: characterWorkflowEditorState.sidebarCollapsed,
      inspectorCollapsed: characterWorkflowEditorState.inspectorCollapsed,
      nodeSearchOpen: characterWorkflowEditorState.nodeSearchOpen,
      viewState: {
        zoom: characterResourceViewState.zoom,
        panX: characterResourceViewState.panX,
        panY: characterResourceViewState.panY,
        hideLinks: characterResourceViewState.hideLinks,
        selectedNodeIds: characterResourceViewState.selectedNodeIds,
        selectionBox: characterResourceViewState.selectionBox,
        collapsedNodeIds: [...characterResourceViewState.collapsedNodeIds],
        deletedNodeIds: [...characterResourceViewState.deletedNodeIds],
        duplicatedNodes: characterResourceViewState.duplicatedNodes,
        addedNodes: characterResourceViewState.addedNodes,
        nodeSizes: characterResourceViewState.nodeSizes,
        selectedLinkId: characterResourceViewState.selectedLinkId,
        linkKinds: characterResourceViewState.linkKinds,
        customLinks: characterResourceViewState.customLinks,
        deletedLinkIds: [...characterResourceViewState.deletedLinkIds],
        replacedTargetSlots: [...characterResourceViewState.replacedTargetSlots],
      },
    })
    workflowPage.initializeCharacterResourceWorkbench(characterWorkflowRoot)
  }

  function getCharacterWorkflowTabs(): CharacterWorkflowFileTab[] {
    const tabs: CharacterWorkflowFileTab[] = [{
      id: 'workflow',
      title: options.getLanguage() === 'zh-CN' ? '草稿 01.resourcegraph' : 'Draft 01.resourcegraph',
      kind: 'workflow',
    }]
    if (characterWorkflowRunState) {
      tabs.push({
        id: characterWorkflowRunState.run.id,
        title: characterWorkflowRunState.run.title,
        kind: 'run',
        state: characterWorkflowRunState.run.status === 'running' ? 'running' : characterWorkflowRunState.run.status === 'failed' ? 'failed' : undefined,
      })
    }
    if (characterWorkflowPackTabOpen && characterWorkflowRunState?.artifacts.some((artifact) => artifact.type === 'export-target')) {
      tabs.push({
        id: 'package-preview',
        title: options.getLanguage() === 'zh-CN' ? '候选包.preview' : 'Candidate Pack.preview',
        kind: 'character',
      })
    }
    return tabs
  }

  function cloneRecord<T>(record: Record<string, T>): Record<string, T> {
    return JSON.parse(JSON.stringify(record)) as Record<string, T>
  }

  function createCharacterResourceHistorySnapshot(): CharacterResourceHistorySnapshot {
    return {
      selectedWorkflowNodeId,
      selectedNodeIds: [...characterResourceViewState.selectedNodeIds],
      selectedLinkId: characterResourceViewState.selectedLinkId,
      configOverrides: cloneRecord(characterWorkflowConfigOverrides),
      positionOverrides: cloneRecord(characterWorkflowPositionOverrides),
      duplicatedNodes: JSON.parse(JSON.stringify(characterResourceViewState.duplicatedNodes)) as CharacterResourceHistorySnapshot['duplicatedNodes'],
      addedNodes: JSON.parse(JSON.stringify(characterResourceViewState.addedNodes)) as CharacterResourceHistorySnapshot['addedNodes'],
      deletedNodeIds: [...characterResourceViewState.deletedNodeIds],
      collapsedNodeIds: [...characterResourceViewState.collapsedNodeIds],
      nodeSizes: cloneRecord(characterResourceViewState.nodeSizes),
      customLinks: JSON.parse(JSON.stringify(characterResourceViewState.customLinks)) as SerializedCharacterResourceLink[],
      deletedLinkIds: [...characterResourceViewState.deletedLinkIds],
      replacedTargetSlots: [...characterResourceViewState.replacedTargetSlots],
      linkKinds: { ...characterResourceViewState.linkKinds },
    }
  }

  function replaceRecord<T>(target: Record<string, T>, source: Record<string, T>): void {
    Object.keys(target).forEach((key) => delete target[key])
    Object.assign(target, source)
  }

  function restoreCharacterResourceHistorySnapshot(snapshot: CharacterResourceHistorySnapshot): void {
    selectedWorkflowNodeId = snapshot.selectedWorkflowNodeId
    characterResourceViewState.selectedNodeIds = [...snapshot.selectedNodeIds]
    characterResourceViewState.selectedLinkId = snapshot.selectedLinkId
    replaceRecord(characterWorkflowConfigOverrides, cloneRecord(snapshot.configOverrides))
    replaceRecord(characterWorkflowPositionOverrides, cloneRecord(snapshot.positionOverrides))
    characterResourceViewState.duplicatedNodes = JSON.parse(JSON.stringify(snapshot.duplicatedNodes)) as CharacterResourceHistorySnapshot['duplicatedNodes']
    characterResourceViewState.addedNodes = JSON.parse(JSON.stringify(snapshot.addedNodes)) as CharacterResourceHistorySnapshot['addedNodes']
    characterResourceViewState.deletedNodeIds = new Set(snapshot.deletedNodeIds)
    characterResourceViewState.collapsedNodeIds = new Set(snapshot.collapsedNodeIds)
    characterResourceViewState.nodeSizes = cloneRecord(snapshot.nodeSizes)
    characterResourceViewState.customLinks = JSON.parse(JSON.stringify(snapshot.customLinks)) as SerializedCharacterResourceLink[]
    characterResourceViewState.deletedLinkIds = new Set(snapshot.deletedLinkIds)
    characterResourceViewState.replacedTargetSlots = new Set(snapshot.replacedTargetSlots)
    characterResourceViewState.linkKinds = { ...snapshot.linkKinds }
  }

  function pushCharacterResourceUndoSnapshot(): void {
    characterResourceUndoStack.push(createCharacterResourceHistorySnapshot())
    if (characterResourceUndoStack.length > 80) {
      characterResourceUndoStack.shift()
    }
    characterResourceRedoStack.length = 0
  }

  function handleCharacterWorkflowAction(action: string, target?: HTMLElement): void {
    switch (action) {
      case 'run':
        void runCharacterWorkflow(false)
        break
      case 'new-run':
        void runCharacterWorkflow(true)
        break
      case 'stop':
        characterWorkflowRenderToken += 1
        if (characterWorkflowRunState?.run.status === 'running') {
          characterWorkflowRunState.run.status = 'idle'
          renderCharacterWorkflow()
        }
        showToast(options.getLanguage() === 'zh-CN' ? '已停止 Agent mock trace' : 'Stopped agent mock trace')
        break
      case 'export':
        if (characterWorkflowRunState?.artifacts.some((artifact) => artifact.type === 'export-target')) {
          characterWorkflowPackTabOpen = true
          characterWorkflowActiveTabId = 'package-preview'
          renderCharacterWorkflow()
          showToast(options.getLanguage() === 'zh-CN' ? '已打开候选包预览' : 'Candidate pack preview opened')
        } else {
          showToast(options.getLanguage() === 'zh-CN' ? '请先运行 Agent mock trace 生成导出目标' : 'Run the agent mock trace before export')
        }
        break
      case 'toggle-inspector':
        toggleCharacterWorkflowInspector()
        break
      case 'toggle-sidebar':
        toggleCharacterWorkflowSidebar()
        break
      default:
        if (!executeCharacterResourceCommand(action, target)) {
          showToast(options.getLanguage() === 'zh-CN' ? '资源图操作待接入' : 'Resource graph action pending')
        }
        break
    }
  }

  function executeCharacterResourceCommand(action: string, target?: HTMLElement): boolean {
    const commands: Record<string, () => void> = {
      'save-graph': () => {
        const yjsSnapshot = characterWorkflowRoot?.querySelector<HTMLElement>('.chat-resource-serializer')?.dataset.yjsSnapshot ?? '{}'
        saveCharacterResourceViewStateSnapshot()
        lastCharacterResourceGraphSnapshot = serializeCharacterResourceGraph({
          graphId: 'draft-character-resource-graph',
          activeTabId: characterWorkflowActiveTabId,
          selectedNodeId: selectedWorkflowNodeId,
          viewState: {
            zoom: characterResourceViewState.zoom,
            panX: characterResourceViewState.panX,
            panY: characterResourceViewState.panY,
            hideLinks: characterResourceViewState.hideLinks,
            selectedNodeIds: characterResourceViewState.selectedNodeIds,
            selectionBox: characterResourceViewState.selectionBox,
            collapsedNodeIds: [...characterResourceViewState.collapsedNodeIds],
            deletedNodeIds: [...characterResourceViewState.deletedNodeIds],
            duplicatedNodes: characterResourceViewState.duplicatedNodes,
            addedNodes: characterResourceViewState.addedNodes,
            nodeSizes: characterResourceViewState.nodeSizes,
            selectedLinkId: characterResourceViewState.selectedLinkId,
            linkKinds: characterResourceViewState.linkKinds,
            customLinks: characterResourceViewState.customLinks,
            deletedLinkIds: [...characterResourceViewState.deletedLinkIds],
            replacedTargetSlots: [...characterResourceViewState.replacedTargetSlots],
          },
          configOverrides: characterWorkflowConfigOverrides,
          positionOverrides: characterWorkflowPositionOverrides,
          yjsSnapshot,
        })
        showToast(options.getLanguage() === 'zh-CN' ? '资源图前端状态已保存到本地快照' : 'Resource graph frontend state saved to local snapshot')
      },
      'fit-view': () => {
        pushCharacterResourceUndoSnapshot()
        characterResourceViewState.zoom = 0.72
        characterResourceViewState.panX = -42
        characterResourceViewState.panY = -24
        renderCharacterWorkflow()
      },
      'reset-view': () => {
        pushCharacterResourceUndoSnapshot()
        characterResourceViewState.zoom = 0.84
        characterResourceViewState.panX = 0
        characterResourceViewState.panY = 0
        renderCharacterWorkflow()
      },
      'toggle-links': () => {
        pushCharacterResourceUndoSnapshot()
        characterResourceViewState.hideLinks = !characterResourceViewState.hideLinks
        renderCharacterWorkflow()
      },
      'toggle-node-collapse': () => {
        const nodeId = target?.closest<HTMLElement>('[data-chat-workflow-node-id]')?.dataset.chatWorkflowNodeId || selectedWorkflowNodeId
        if (!nodeId) {
          return
        }
        pushCharacterResourceUndoSnapshot()
        if (characterResourceViewState.collapsedNodeIds.has(nodeId)) {
          characterResourceViewState.collapsedNodeIds.delete(nodeId)
        } else {
          characterResourceViewState.collapsedNodeIds.add(nodeId)
        }
        selectedWorkflowNodeId = nodeId
        renderCharacterWorkflow()
      },
      'duplicate-selection': () => {
        const sourceId = selectedWorkflowNodeId
        if (!sourceId || characterResourceViewState.deletedNodeIds.has(sourceId)) {
          return
        }
        pushCharacterResourceUndoSnapshot()
        characterResourceDuplicateCount += 1
        const duplicateId = `${sourceId}-copy-${characterResourceDuplicateCount}`
        characterResourceViewState.duplicatedNodes.push({
          id: duplicateId,
          sourceId,
          offsetX: 34 * characterResourceDuplicateCount,
          offsetY: 28 * characterResourceDuplicateCount,
        })
        selectedWorkflowNodeId = duplicateId
        characterResourceViewState.selectedNodeIds = [duplicateId]
        renderCharacterWorkflow()
      },
      'delete-selection': () => {
        if (deleteSelectedCharacterResourceLink()) {
          return
        }
        if (!selectedWorkflowNodeId || selectedWorkflowNodeId === 'generation-goal') {
          showToast(options.getLanguage() === 'zh-CN' ? '目标节点不能删除' : 'Goal node cannot be deleted')
          return
        }
        pushCharacterResourceUndoSnapshot()
        characterResourceViewState.deletedNodeIds.add(selectedWorkflowNodeId)
        selectedWorkflowNodeId = 'generation-goal'
        characterResourceViewState.selectedNodeIds = ['generation-goal']
        renderCharacterWorkflow()
      },
      'open-node-search': () => {
        characterWorkflowEditorState.activePanel = 'nodes'
        characterWorkflowEditorState.nodeSearchOpen = true
        renderCharacterWorkflow()
      },
      'copy-selection': () => {
        if (!selectedWorkflowNodeId || characterResourceViewState.deletedNodeIds.has(selectedWorkflowNodeId)) {
          return
        }
        characterWorkflowClipboard = { sourceId: selectedWorkflowNodeId }
        showToast(options.getLanguage() === 'zh-CN' ? '已复制节点' : 'Node copied')
      },
      'paste-selection': () => {
        const sourceId = characterWorkflowClipboard?.sourceId
        if (!sourceId || characterResourceViewState.deletedNodeIds.has(sourceId)) {
          showToast(options.getLanguage() === 'zh-CN' ? '没有可粘贴节点' : 'No node to paste')
          return
        }
        pushCharacterResourceUndoSnapshot()
        characterResourceDuplicateCount += 1
        const duplicateId = `${sourceId}-paste-${characterResourceDuplicateCount}`
        characterResourceViewState.duplicatedNodes.push({
          id: duplicateId,
          sourceId,
          offsetX: 42 * characterResourceDuplicateCount,
          offsetY: 32 * characterResourceDuplicateCount,
        })
        selectedWorkflowNodeId = duplicateId
        characterResourceViewState.selectedNodeIds = [duplicateId]
        renderCharacterWorkflow()
      },
      'undo-graph': () => {
        const previous = characterResourceUndoStack.pop()
        if (!previous) {
          return
        }
        characterResourceRedoStack.push(createCharacterResourceHistorySnapshot())
        restoreCharacterResourceHistorySnapshot(previous)
        renderCharacterWorkflow()
      },
      'redo-graph': () => {
        const next = characterResourceRedoStack.pop()
        if (!next) {
          return
        }
        characterResourceUndoStack.push(createCharacterResourceHistorySnapshot())
        restoreCharacterResourceHistorySnapshot(next)
        renderCharacterWorkflow()
      },
      'align-left': () => alignSelectedCharacterResourceNodes('left'),
      'align-top': () => alignSelectedCharacterResourceNodes('top'),
      'reconnect-link': () => {
        if (!characterResourceViewState.selectedLinkId) {
          return
        }
        characterWorkflowEditorState.activePanel = 'nodes'
        characterWorkflowEditorState.nodeSearchOpen = true
        showToast(options.getLanguage() === 'zh-CN' ? '选择兼容节点以重连端点' : 'Choose a compatible node to reconnect the endpoint')
        renderCharacterWorkflow()
      },
      'reset-parameter': () => {
        const nodeId = target?.dataset.chatWorkflowNode || ''
        const paramId = target?.dataset.chatWorkflowParamReset || ''
        if (!nodeId || !paramId || !characterWorkflowConfigOverrides[nodeId]) {
          return
        }
        pushCharacterResourceUndoSnapshot()
        delete characterWorkflowConfigOverrides[nodeId][paramId]
        if (Object.keys(characterWorkflowConfigOverrides[nodeId]).length === 0) {
          delete characterWorkflowConfigOverrides[nodeId]
        }
        selectedWorkflowNodeId = nodeId
        renderCharacterWorkflow()
      },
      'chat-test': () => showToast(options.getLanguage() === 'zh-CN' ? '聊天测试入口已准备，但不调用真实聊天' : 'Chat test entry is ready without calling real chat'),
      'set-link-kind': () => {
        const kind = target?.dataset.resourceLinkKind || ''
        const allowedKinds = new Set(['guides', 'constrains', 'provides', 'enables', 'grounds', 'weights', 'routes', 'evaluates', 'refines', 'exports'])
        if (!characterResourceViewState.selectedLinkId || !kind) {
          showToast(options.getLanguage() === 'zh-CN' ? '请选择具体连线后修改类型' : 'Select a concrete link before changing kind')
          return
        }
        if (!allowedKinds.has(kind)) {
          return
        }
        characterResourceViewState.linkKinds[characterResourceViewState.selectedLinkId] = kind as SerializedCharacterResourceLinkKind
        const customLink = characterResourceViewState.customLinks.find((linkItem) => linkItem.id === characterResourceViewState.selectedLinkId)
        if (customLink) {
          customLink.kind = kind as SerializedCharacterResourceLinkKind
        }
        renderCharacterWorkflow()
      },
    }
    const command = commands[action]
    if (!command) {
      return false
    }
    command()
    return true
  }

  function saveCharacterResourceViewStateSnapshot(): void {
    resourceViewStateSnapshot = JSON.stringify({
      zoom: characterResourceViewState.zoom,
      panX: characterResourceViewState.panX,
      panY: characterResourceViewState.panY,
      selectedNodeIds: characterResourceViewState.selectedNodeIds,
      selectedLinkId: characterResourceViewState.selectedLinkId,
      collapsedNodeIds: [...characterResourceViewState.collapsedNodeIds],
    })
  }

  function alignSelectedCharacterResourceNodes(direction: 'left' | 'top'): void {
    const selected = characterResourceViewState.selectedNodeIds.filter((nodeId) => !characterResourceViewState.deletedNodeIds.has(nodeId))
    if (selected.length < 2) {
      return
    }
    pushCharacterResourceUndoSnapshot()
    const positions = selected.map((nodeId) => characterWorkflowPositionOverrides[nodeId] ?? getRenderedCharacterResourceNodePosition(nodeId))
    const target = direction === 'left'
      ? Math.min(...positions.map((position) => position.x))
      : Math.min(...positions.map((position) => position.y))
    selected.forEach((nodeId, index) => {
      const current = positions[index]
      characterWorkflowPositionOverrides[nodeId] = direction === 'left'
        ? { ...current, x: target }
        : { ...current, y: target }
    })
    renderCharacterWorkflow()
  }

  function getRenderedCharacterResourceNodePosition(nodeId: string): { x: number; y: number } {
    const node = panel.querySelector<HTMLElement>(`[data-chat-workflow-node-id="${CSS.escape(nodeId)}"]`)
    return {
      x: Number.parseFloat(node?.style.getPropertyValue('--node-x') ?? '') || 0,
      y: Number.parseFloat(node?.style.getPropertyValue('--node-y') ?? '') || 0,
    }
  }

  async function runCharacterWorkflow(newRun: boolean): Promise<void> {
    const renderToken = ++characterWorkflowRenderToken
    const workflowPage = await loadCharacterWorkflowPageModule()
    if (renderToken !== characterWorkflowRenderToken) {
      return
    }
    if (newRun) {
      characterWorkflowRunState = null
      characterWorkflowPackTabOpen = false
    }
    characterWorkflowRunCount += 1
    const draftRunState = workflowPage.createDraftCharacterResourceRunState(characterWorkflowRunCount, 'running')
    characterWorkflowRunState = draftRunState
    characterWorkflowActiveTabId = draftRunState.run?.id ?? 'run-draft'
    renderCharacterWorkflow()
    showToast(options.getLanguage() === 'zh-CN' ? 'Agent 正在生成角色资源' : 'Agent generating character resources')
    try {
      if (renderToken !== characterWorkflowRenderToken) {
        return
      }
      const workflow = workflowPage.createCharacterAgentWorkflowSnapshot({
        language: options.getLanguage(),
        escapeHtml: options.escapeHtml,
        modelChoices: getCharacterWorkflowModelChoices(),
        configOverrides: characterWorkflowConfigOverrides,
        positionOverrides: characterWorkflowPositionOverrides,
        runState: characterWorkflowRunState,
        tabs: getCharacterWorkflowTabs(),
        activeTabId: characterWorkflowActiveTabId,
        selectedNodeId: selectedWorkflowNodeId,
        activePanel: characterWorkflowEditorState.activePanel,
        sidebarCollapsed: characterWorkflowEditorState.sidebarCollapsed,
        inspectorCollapsed: characterWorkflowEditorState.inspectorCollapsed,
        nodeSearchOpen: characterWorkflowEditorState.nodeSearchOpen,
        viewState: {
          zoom: characterResourceViewState.zoom,
          panX: characterResourceViewState.panX,
          panY: characterResourceViewState.panY,
          hideLinks: characterResourceViewState.hideLinks,
          selectedNodeIds: characterResourceViewState.selectedNodeIds,
          selectionBox: characterResourceViewState.selectionBox,
          collapsedNodeIds: [...characterResourceViewState.collapsedNodeIds],
          deletedNodeIds: [...characterResourceViewState.deletedNodeIds],
          duplicatedNodes: characterResourceViewState.duplicatedNodes,
          addedNodes: characterResourceViewState.addedNodes,
          nodeSizes: characterResourceViewState.nodeSizes,
          selectedLinkId: characterResourceViewState.selectedLinkId,
          linkKinds: characterResourceViewState.linkKinds,
          customLinks: characterResourceViewState.customLinks,
          deletedLinkIds: [...characterResourceViewState.deletedLinkIds],
          replacedTargetSlots: [...characterResourceViewState.replacedTargetSlots],
        },
      })
      const response = await window.electronAPI.runCharacterWorkflow({ workflow, language: options.getLanguage() })
      if (!response.success) {
        throw new Error(response.error || 'Character workflow failed')
      }
      characterWorkflowRunState = {
        run: {
          id: response.runId || draftRunState.run?.id || `resource-run-${Date.now()}`,
          title: response.title || draftRunState.run?.title || 'Resource Draft.run',
          status: 'done',
        },
        artifacts: (response.artifacts ?? []).map((artifact) => ({
          id: artifact.id,
          type: artifact.kind,
          sourceNodeId: artifact.sourceNodeId || 'agent-policy',
          title: artifact.title,
          summary: artifact.summary,
        })),
      }
      characterWorkflowActiveTabId = characterWorkflowRunState.run?.id ?? 'run-draft'
      renderCharacterWorkflow()
      showToast(options.getLanguage() === 'zh-CN' ? '角色资源生成完成' : 'Character resources generated')
    } catch (error) {
      console.warn('[CharacterResourceGraph] Failed to run agent lifecycle:', error)
      if (renderToken === characterWorkflowRenderToken) {
        characterWorkflowRunState = draftRunState.run
          ? { ...draftRunState, run: { ...draftRunState.run, status: 'failed' } }
          : draftRunState
        showToast(error instanceof Error ? error.message : (options.getLanguage() === 'zh-CN' ? '角色资源生成失败' : 'Character resource generation failed'))
      }
    }
  }

  function updateCharacterWorkflowParameter(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void {
    const nodeId = control.dataset.chatWorkflowNode || ''
    const paramId = control.dataset.chatWorkflowParam || ''
    const paramType = control.dataset.chatWorkflowParamType || ''
    if (!nodeId || !paramId) {
      return
    }
    selectedWorkflowNodeId = nodeId
    pushCharacterResourceUndoSnapshot()
    characterWorkflowConfigOverrides[nodeId] ??= {}
    if (control instanceof HTMLInputElement && control.type === 'checkbox') {
      characterWorkflowConfigOverrides[nodeId][paramId] = control.checked
    } else if (paramType === 'number' || paramType === 'integer') {
      characterWorkflowConfigOverrides[nodeId][paramId] = Number(control.value)
    } else if (paramType === 'string-list' || paramType === 'multi-select') {
      characterWorkflowConfigOverrides[nodeId][paramId] = control.value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    } else {
      characterWorkflowConfigOverrides[nodeId][paramId] = control.value
    }
    renderCharacterWorkflow()
  }

  function updateCharacterWorkflowModelChoice(choice: HTMLElement): void {
    const nodeId = choice.dataset.chatWorkflowNode || ''
    const paramId = choice.dataset.chatWorkflowParam || ''
    const modelValue = choice.dataset.chatWorkflowModelValue || ''
    if (!nodeId || !paramId || !modelValue) {
      return
    }
    selectedWorkflowNodeId = nodeId
    characterResourceViewState.selectedNodeIds = [nodeId]
    characterResourceViewState.selectedLinkId = ''
    pushCharacterResourceUndoSnapshot()
    characterWorkflowConfigOverrides[nodeId] ??= {}
    characterWorkflowConfigOverrides[nodeId][paramId] = modelValue
    renderCharacterWorkflow()
  }

  function selectCharacterWorkflowTab(tabId: string): void {
    if (!getCharacterWorkflowTabs().some((tab) => tab.id === tabId)) {
      return
    }
    characterWorkflowActiveTabId = tabId
    renderCharacterWorkflow()
  }

  function selectWorkflowNode(nodeId: string, additive = false): void {
    if (!nodeId) {
      return
    }
    selectedWorkflowNodeId = nodeId
    characterResourceViewState.selectedLinkId = ''
    if (additive) {
      const current = new Set(characterResourceViewState.selectedNodeIds)
      if (current.has(nodeId)) {
        current.delete(nodeId)
      } else {
        current.add(nodeId)
      }
      characterResourceViewState.selectedNodeIds = current.size ? [...current] : [nodeId]
    } else {
      characterResourceViewState.selectedNodeIds = [nodeId]
    }
    renderCharacterWorkflow()
  }

  function addCharacterResourceNodeFromLibrary(card: HTMLElement): void {
    const type = card.dataset.resourceNodeAddType || ''
    const title = card.dataset.resourcePreviewTitle || type
    if (!type) {
      return
    }
    pushCharacterResourceUndoSnapshot()
    characterResourceDuplicateCount += 1
    const nodeId = `${type}-${Date.now().toString(36)}-${characterResourceDuplicateCount}`
    const visibleX = Math.max(48, Math.round((96 - characterResourceViewState.panX) / characterResourceViewState.zoom))
    const visibleY = Math.max(70, Math.round((86 - characterResourceViewState.panY) / characterResourceViewState.zoom))
    characterResourceViewState.addedNodes.push({
      id: nodeId,
      type,
      title,
      x: visibleX + characterResourceDuplicateCount * 18,
      y: visibleY + characterResourceDuplicateCount * 18,
    })
    selectedWorkflowNodeId = nodeId
    characterResourceViewState.selectedNodeIds = [nodeId]
    characterResourceViewState.selectedLinkId = ''
    characterWorkflowEditorState.nodeSearchOpen = false
    characterWorkflowEditorState.activePanel = 'nodes'
    renderCharacterWorkflow()
    showToast(options.getLanguage() === 'zh-CN' ? '已添加节点' : 'Node added')
  }

  function getCharacterResourceTargetSlotKey(linkItem: Pick<SerializedCharacterResourceLink, 'targetNodeId' | 'targetSlotId'>): string {
    return `${linkItem.targetNodeId}:${linkItem.targetSlotId}`
  }

  function inferCharacterResourceLinkKind(sourceType: string, targetType: string): SerializedCharacterResourceLinkKind {
    if (sourceType === 'model-capability' || sourceType === 'image-capability' || sourceType === 'retrieval-capability' || sourceType === 'voice-capability') {
      return 'enables'
    }
    if (targetType === 'hard-constraint' || targetType === 'agent-policy') {
      return sourceType === 'hard-constraint' ? 'constrains' : 'guides'
    }
    if (sourceType === 'source-context') {
      return 'grounds'
    }
    if (sourceType === 'style-signal') {
      return 'weights'
    }
    if (targetType === 'validation-report') {
      return 'evaluates'
    }
    if (sourceType === 'validation-report' || sourceType === 'critique-policy') {
      return 'refines'
    }
    if (targetType === 'export-target') {
      return 'exports'
    }
    if (sourceType === 'strategy-policy') {
      return 'routes'
    }
    return 'guides'
  }

  function upsertCharacterResourceLink(detail: CharacterResourceSlotConnectDetail): void {
    const sourceIsOutput = detail.sourceSide === 'output'
    const output = sourceIsOutput
      ? { nodeId: detail.sourceNodeId, slotId: detail.sourceSlotId, type: detail.sourceType }
      : { nodeId: detail.targetNodeId, slotId: detail.targetSlotId, type: detail.targetType }
    const input = sourceIsOutput
      ? { nodeId: detail.targetNodeId, slotId: detail.targetSlotId, type: detail.targetType }
      : { nodeId: detail.sourceNodeId, slotId: detail.sourceSlotId, type: detail.sourceType }
    if (!output.nodeId || !output.slotId || !input.nodeId || !input.slotId || output.type !== input.type) {
      showToast(options.getLanguage() === 'zh-CN' ? 'slot 类型不兼容，未创建连接' : 'Slot types are incompatible; no link was created')
      return
    }
    pushCharacterResourceUndoSnapshot()
    const targetKey = `${input.nodeId}:${input.slotId}`
    const linkId = `${output.nodeId}:${output.slotId}->${input.nodeId}:${input.slotId}`
    const nextLink: SerializedCharacterResourceLink = {
      id: linkId,
      sourceNodeId: output.nodeId,
      sourceSlotId: output.slotId,
      targetNodeId: input.nodeId,
      targetSlotId: input.slotId,
      kind: inferCharacterResourceLinkKind(output.type, input.type),
    }
    const movingLinkId = characterResourceViewState.selectedLinkId
    if (movingLinkId && movingLinkId !== linkId) {
      const movingCustomIndex = characterResourceViewState.customLinks.findIndex((linkItem) => linkItem.id === movingLinkId)
      if (movingCustomIndex >= 0) {
        characterResourceViewState.customLinks.splice(movingCustomIndex, 1)
      } else {
        characterResourceViewState.deletedLinkIds.add(movingLinkId)
      }
      delete characterResourceViewState.linkKinds[movingLinkId]
    }
    characterResourceViewState.replacedTargetSlots.add(targetKey)
    characterResourceViewState.deletedLinkIds.delete(linkId)
    const existingIndex = characterResourceViewState.customLinks.findIndex((linkItem) => getCharacterResourceTargetSlotKey(linkItem) === targetKey)
    if (existingIndex >= 0) {
      characterResourceViewState.customLinks[existingIndex] = {
        ...nextLink,
        kind: characterResourceViewState.customLinks[existingIndex].kind,
      }
    } else {
      characterResourceViewState.customLinks.push(nextLink)
    }
    characterResourceViewState.selectedLinkId = linkId
    characterResourceViewState.selectedNodeIds = []
    renderCharacterWorkflow()
  }

  function deleteSelectedCharacterResourceLink(): boolean {
    const linkId = characterResourceViewState.selectedLinkId
    if (!linkId) {
      return false
    }
    pushCharacterResourceUndoSnapshot()
    const customIndex = characterResourceViewState.customLinks.findIndex((linkItem) => linkItem.id === linkId)
    if (customIndex >= 0) {
      characterResourceViewState.customLinks.splice(customIndex, 1)
    } else {
      characterResourceViewState.deletedLinkIds.add(linkId)
    }
    delete characterResourceViewState.linkKinds[linkId]
    characterResourceViewState.selectedLinkId = ''
    renderCharacterWorkflow()
    return true
  }

  function setCharacterWorkflowPanel(panelId: string): void {
    if (panelId !== 'workflow' && panelId !== 'assets' && panelId !== 'nodes') {
      return
    }
    characterWorkflowEditorState.activePanel = panelId
    if (panelId !== 'nodes') {
      characterWorkflowEditorState.nodeSearchOpen = false
    }
    renderCharacterWorkflow()
  }

  function toggleCharacterWorkflowInspector(): void {
    characterWorkflowEditorState.inspectorCollapsed = !characterWorkflowEditorState.inspectorCollapsed
    renderCharacterWorkflow()
  }

  function toggleCharacterWorkflowSidebar(): void {
    characterWorkflowEditorState.sidebarCollapsed = !characterWorkflowEditorState.sidebarCollapsed
    renderCharacterWorkflow()
  }

  function closeCharacterWorkflowTab(tabId: string): void {
    if (tabId === 'workflow') {
      return
    }
    if (tabId === characterWorkflowRunState?.run.id) {
      characterWorkflowRunState = null
      characterWorkflowPackTabOpen = false
    }
    if (tabId === 'package-preview') {
      characterWorkflowPackTabOpen = false
      characterWorkflowActiveTabId = characterWorkflowRunState?.run.id ?? 'workflow'
    }
    if (!getCharacterWorkflowTabs().some((tab) => tab.id === characterWorkflowActiveTabId)) {
      characterWorkflowActiveTabId = 'workflow'
    }
    renderCharacterWorkflow()
  }

  function beginCharacterWorkflowNodeDrag(event: PointerEvent): void {
    const handle = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-chat-workflow-drag-handle]')
    const node = handle?.closest<HTMLElement>('[data-chat-workflow-node-id]')
    if (!handle || !node || !panel.contains(node) || event.button !== 0) {
      return
    }
    const nodeId = node.dataset.chatWorkflowNodeId || ''
    if (!nodeId) {
      return
    }
    const origin = characterWorkflowPositionOverrides[nodeId] ?? {
      x: Number.parseFloat(node.style.getPropertyValue('--node-x')) || 0,
      y: Number.parseFloat(node.style.getPropertyValue('--node-y')) || 0,
    }
    characterWorkflowDragging = {
      nodeId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: origin.x,
      originY: origin.y,
    }
    node.setPointerCapture?.(event.pointerId)
    node.classList.add('is-dragging')
    node.style.zIndex = '50'
    event.preventDefault()
    event.stopPropagation()
  }

  function updateCharacterWorkflowNodeDrag(event: PointerEvent): void {
    if (!characterWorkflowDragging || characterWorkflowDragging.pointerId !== event.pointerId) {
      return
    }
    const nextX = Math.max(0, Math.round(characterWorkflowDragging.originX + event.clientX - characterWorkflowDragging.startX))
    const nextY = Math.max(0, Math.round(characterWorkflowDragging.originY + event.clientY - characterWorkflowDragging.startY))
    characterWorkflowPositionOverrides[characterWorkflowDragging.nodeId] = { x: nextX, y: nextY }
    const node = panel.querySelector<HTMLElement>(`[data-chat-workflow-node-id="${CSS.escape(characterWorkflowDragging.nodeId)}"]`)
    if (node) {
      node.style.setProperty('--node-x', `${nextX}px`)
      node.style.setProperty('--node-y', `${nextY}px`)
    }
  }

  function endCharacterWorkflowNodeDrag(event: PointerEvent): void {
    if (!characterWorkflowDragging || characterWorkflowDragging.pointerId !== event.pointerId) {
      return
    }
    const node = panel.querySelector<HTMLElement>(`[data-chat-workflow-node-id="${CSS.escape(characterWorkflowDragging.nodeId)}"]`)
    node?.classList.remove('is-dragging')
    if (node) {
      node.style.zIndex = '20'
    }
    characterWorkflowDragging = null
  }

  function beginCharacterResourceNodeResize(event: PointerEvent): void {
    const handle = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-resource-node-resize]')
    const node = handle?.closest<HTMLElement>('[data-chat-workflow-node-id]')
    if (!handle || !node || !panel.contains(node) || event.button !== 0) {
      return
    }
    const nodeId = node.dataset.chatWorkflowNodeId || ''
    if (!nodeId) {
      return
    }
    const originWidth = characterResourceViewState.nodeSizes[nodeId]?.width
      ?? Number.parseFloat(node.style.getPropertyValue('--node-w'))
      ?? 268
    const originHeight = characterResourceViewState.nodeSizes[nodeId]?.height
      ?? Number.parseFloat(node.style.getPropertyValue('--node-h'))
      ?? 226
    characterResourceNodeResize = {
      nodeId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originWidth,
      originHeight,
    }
    selectedWorkflowNodeId = nodeId
    characterResourceViewState.selectedNodeIds = [nodeId]
    node.classList.add('is-resizing')
    node.setPointerCapture?.(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }

  function updateCharacterResourceNodeResize(event: PointerEvent): void {
    if (!characterResourceNodeResize || characterResourceNodeResize.pointerId !== event.pointerId) {
      return
    }
    const nextWidth = Math.max(220, Math.round(characterResourceNodeResize.originWidth + event.clientX - characterResourceNodeResize.startX))
    const nextHeight = Math.max(84, Math.round(characterResourceNodeResize.originHeight + event.clientY - characterResourceNodeResize.startY))
    characterResourceViewState.nodeSizes[characterResourceNodeResize.nodeId] = {
      width: nextWidth,
      height: nextHeight,
    }
    const node = panel.querySelector<HTMLElement>(`[data-chat-workflow-node-id="${CSS.escape(characterResourceNodeResize.nodeId)}"]`)
    if (node) {
      node.style.setProperty('--node-w', `${nextWidth}px`)
      node.style.setProperty('--node-h', `${nextHeight}px`)
    }
  }

  function endCharacterResourceNodeResize(event: PointerEvent): void {
    if (!characterResourceNodeResize || characterResourceNodeResize.pointerId !== event.pointerId) {
      return
    }
    const node = panel.querySelector<HTMLElement>(`[data-chat-workflow-node-id="${CSS.escape(characterResourceNodeResize.nodeId)}"]`)
    node?.classList.remove('is-resizing')
    characterResourceNodeResize = null
  }

  function beginCharacterResourceViewportDrag(event: PointerEvent): void {
    if (characterWorkflowDragging || characterResourceNodeResize || event.button !== 0) {
      return
    }
    const target = event.target as HTMLElement | null
    const viewport = target?.closest<HTMLElement>('.chat-workflow-canvas-viewport.active')
    if (!viewport || target?.closest('[data-chat-workflow-node-id], button, input, textarea, select, .chat-resource-tab-panel')) {
      return
    }
    characterResourceViewportDrag = {
      mode: event.shiftKey ? 'select' : 'pan',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originPanX: characterResourceViewState.panX,
      originPanY: characterResourceViewState.panY,
    }
    if (characterResourceViewportDrag.mode === 'select') {
      characterResourceViewState.selectionBox = { x: event.offsetX, y: event.offsetY, width: 0, height: 0 }
      characterResourceViewState.selectedNodeIds = []
    } else {
      pushCharacterResourceUndoSnapshot()
    }
    viewport.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }

  function updateCharacterResourceViewportDrag(event: PointerEvent): void {
    if (!characterResourceViewportDrag || characterResourceViewportDrag.pointerId !== event.pointerId) {
      return
    }
    if (characterResourceViewportDrag.mode === 'pan') {
      characterResourceViewState.panX = Math.round(characterResourceViewportDrag.originPanX + event.clientX - characterResourceViewportDrag.startX)
      characterResourceViewState.panY = Math.round(characterResourceViewportDrag.originPanY + event.clientY - characterResourceViewportDrag.startY)
      const plane = panel.querySelector<HTMLElement>('.chat-resource-graph-plane')
      plane?.style.setProperty('--resource-pan-x', `${characterResourceViewState.panX}px`)
      plane?.style.setProperty('--resource-pan-y', `${characterResourceViewState.panY}px`)
      return
    }
    const startX = characterResourceViewportDrag.startX
    const startY = characterResourceViewportDrag.startY
    const left = Math.min(startX, event.clientX)
    const top = Math.min(startY, event.clientY)
    const width = Math.abs(event.clientX - startX)
    const height = Math.abs(event.clientY - startY)
    const viewport = panel.querySelector<HTMLElement>('.chat-workflow-canvas-viewport.active')
    const rect = viewport?.getBoundingClientRect()
    if (!rect) {
      return
    }
    characterResourceViewState.selectionBox = {
      x: Math.round((left - rect.left - characterResourceViewState.panX) / characterResourceViewState.zoom),
      y: Math.round((top - rect.top - characterResourceViewState.panY) / characterResourceViewState.zoom),
      width: Math.round(width / characterResourceViewState.zoom),
      height: Math.round(height / characterResourceViewState.zoom),
    }
    const box = panel.querySelector<HTMLElement>('.chat-resource-selection-box')
    if (box) {
      box.style.left = `${characterResourceViewState.selectionBox.x}px`
      box.style.top = `${characterResourceViewState.selectionBox.y}px`
      box.style.width = `${characterResourceViewState.selectionBox.width}px`
      box.style.height = `${characterResourceViewState.selectionBox.height}px`
    }
  }

  function endCharacterResourceViewportDrag(event: PointerEvent): void {
    if (!characterResourceViewportDrag || characterResourceViewportDrag.pointerId !== event.pointerId) {
      return
    }
    if (characterResourceViewportDrag.mode === 'select' && characterResourceViewState.selectionBox) {
      const box = characterResourceViewState.selectionBox
      const selected = Array.from(panel.querySelectorAll<HTMLElement>('[data-chat-workflow-node-id]')).filter((node) => {
        const x = Number.parseFloat(node.style.getPropertyValue('--node-x')) || 0
        const y = Number.parseFloat(node.style.getPropertyValue('--node-y')) || 0
        const width = Number.parseFloat(node.style.getPropertyValue('--node-w')) || 268
        const height = Number.parseFloat(node.style.getPropertyValue('--node-h')) || 226
        return x < box.x + box.width && x + width > box.x && y < box.y + box.height && y + height > box.y
      }).map((node) => node.dataset.chatWorkflowNodeId || '').filter(Boolean)
      characterResourceViewState.selectedNodeIds = selected.length ? selected : ['generation-goal']
      selectedWorkflowNodeId = characterResourceViewState.selectedNodeIds[0] ?? 'generation-goal'
      characterResourceViewState.selectionBox = null
      renderCharacterWorkflow()
    }
    saveCharacterResourceViewStateSnapshot()
    characterResourceViewportDrag = null
  }

  function updateCharacterResourceViewportZoom(event: WheelEvent): void {
    const viewport = (event.target as HTMLElement | null)?.closest<HTMLElement>('.chat-workflow-canvas-viewport.active')
    if (!viewport || !panel.contains(viewport)) {
      return
    }
    event.preventDefault()
    const nextZoom = Math.min(1.4, Math.max(0.46, characterResourceViewState.zoom + (event.deltaY > 0 ? -0.05 : 0.05)))
    characterResourceViewState.zoom = Math.round(nextZoom * 100) / 100
    saveCharacterResourceViewStateSnapshot()
    renderCharacterWorkflow()
  }

  function beginCharacterResourceMinimapPointer(event: PointerEvent): void {
    const minimap = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-resource-minimap]')
    if (!minimap || !panel.contains(minimap) || event.button !== 0) {
      return
    }
    event.preventDefault()
    const minimapRect = minimap.getBoundingClientRect()
    const localX = event.clientX - minimapRect.left
    const localY = event.clientY - minimapRect.top
    pushCharacterResourceUndoSnapshot()
    characterResourceViewState.panX = Math.round(120 - localX * 24 * characterResourceViewState.zoom)
    characterResourceViewState.panY = Math.round(86 - localY * 24 * characterResourceViewState.zoom)
    saveCharacterResourceViewStateSnapshot()
    renderCharacterWorkflow()
  }

  function getChatModelCard(modelId: string): HTMLElement | null {
    if (!modelList) {
      return null
    }
    return Array.from(modelList.querySelectorAll<HTMLElement>('.chat-model-card'))
      .find((card) => card.dataset.chatModelId === modelId) ?? null
  }

  function getChatApiModelOptions(modelId: string): HTMLElement | null {
    return getChatModelCard(modelId)?.querySelector<HTMLElement>('.chat-api-model-options') ?? null
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
      activeChatModelName: settings.system.activeChatModelName,
    }
    renderChatRuntimeModelPicker()
    refreshCharacterWorkflowModelsIfVisible()
  }

  async function selectRuntimeChatModel(id: string, modelName: string): Promise<void> {
    const api = chatSystemConfig?.chatModels.find((model) => model.id === id)
    if (!chatSystemConfig || !api || !isUsableChatApi(api) || !getEnabledModelNames(api).includes(modelName)) {
      return
    }
    chatSystemConfig.activeChatId = id
    chatSystemConfig.activeChatModelName = modelName
    api.modelName = modelName
    openChatRuntimeModelPicker = false
    await saveChatModelConfig()
    renderChatRuntimeModelPicker()
  }

  async function addChatModel(modelType: 'llm' | 'image' = 'llm'): Promise<void> {
    if (!chatSystemConfig) {
      await loadChatModelConfig()
    }
    if (!chatSystemConfig) {
      return
    }
    const nextModel = createDefaultChatModel(`chat-${Date.now()}`, modelType)
    chatSystemConfig.chatModels.push(nextModel)
    if (!chatSystemConfig.activeChatId) {
      chatSystemConfig.activeChatId = nextModel.id
      chatSystemConfig.activeChatModelName = nextModel.enabledModels[0] || ''
    }
    openChatModelTypePicker = false
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
    ;(model[field] as string) = value
    if (field === 'modelName' && value.trim()) {
      model.enabledModels = mergeModelNames(model.enabledModels, [value.trim()])
    }
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
    const entry = getChatModelType(model) === 'image'
      ? getImageProviderCatalogEntry(provider)
      : getLLMProviderCatalogEntry(provider)
    model.provider = entry.value
    model.modelName = model.modelName.trim() || entry.defaultModel
    model.enabledModels = [model.modelName]
    model.availableModels = []
    model.modelsFetchedAt = undefined
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
    if (getChatModelType(model) === 'image') {
      showToast(options.getLanguage() === 'zh-CN' ? '生图模型请手动填写模型名或工作流名称' : 'Enter image model or workflow names manually')
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
      const models = normalizeModelNameList(response.models || [])
      chatModelOptions.set(id, models)
      model.availableModels = models
      model.modelsFetchedAt = Date.now()
      model.enabledModels = mergeModelNames(model.enabledModels, getEnabledModelNames(model).length ? [] : models.slice(0, 1))
      if (!models.length) {
        showToast(options.getLanguage() === 'zh-CN' ? '没有返回可用模型' : 'No models returned')
      }
      await saveChatModelConfig()
    } catch (error: any) {
      showToast(error?.message || String(error))
    } finally {
      chatModelLoading.delete(id)
      renderChatModelConfig()
      renderChatRuntimeModelPicker()
    }
  }

  async function toggleChatApiEnabledModel(id: string, modelName: string): Promise<void> {
    if (!chatSystemConfig) {
      return
    }
    const modelOptionsScrollTop = getChatApiModelOptions(id)?.scrollTop ?? 0
    const model = chatSystemConfig.chatModels.find((item) => item.id === id)
    const name = modelName.trim()
    if (!model || !name) {
      return
    }
    const current = getEnabledModelNames(model)
    const next = current.includes(name)
      ? current.filter((item) => item !== name)
      : [...current, name]
    model.enabledModels = next.length ? next : [name]
    model.availableModels = mergeModelNames(model.availableModels, [name])
    if (!model.enabledModels.includes(model.modelName)) {
      model.modelName = model.enabledModels[0] || ''
    }
    if (chatSystemConfig.activeChatId === id && !model.enabledModels.includes(getActiveChatModelName(chatSystemConfig))) {
      chatSystemConfig.activeChatModelName = model.modelName
    }
    await saveChatModelConfig()
    renderChatModelConfig()
    const modelOptions = getChatApiModelOptions(id)
    if (modelOptions) {
      modelOptions.scrollTop = modelOptionsScrollTop
    }
    renderChatRuntimeModelPicker()
  }

  async function deleteChatModel(id: string): Promise<void> {
    if (!chatSystemConfig || chatSystemConfig.chatModels.length <= 1) {
      return
    }
    chatSystemConfig.chatModels = chatSystemConfig.chatModels.filter((model) => model.id !== id)
    if (chatSystemConfig.activeChatId === id) {
      chatSystemConfig.activeChatId = chatSystemConfig.chatModels[0]?.id || ''
      chatSystemConfig.activeChatModelName = chatSystemConfig.chatModels[0]?.enabledModels[0] || ''
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

  panel.addEventListener('character-resource-slot-connect', (event) => {
    const detail = (event as CustomEvent<CharacterResourceSlotConnectDetail>).detail
    upsertCharacterResourceLink(detail)
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
      } else if (action === 'delete-summary') {
        void deleteChatHistorySummary(historyAction.dataset.chatHistorySummary || '')
      } else if (action === 'summarize-now') {
        const conversation = getActiveMutableConversation()
        if (conversation) {
          void summarizeConversationOverflow(conversation, getEffectiveConversationLanguage(), true)
        }
      }
      return
    }

    const settingsReset = eventTarget.closest<HTMLElement>('[data-chat-setting-reset]')
    if (settingsReset && panel.contains(settingsReset)) {
      conversationSettings = getDefaultConversationSettings()
      saveConversationSettings(conversationSettings)
      renderConversationSettings()
      if (chatHistoryPanel?.classList.contains('visible')) {
        renderChatHistoryManager()
      }
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

    if (eventTarget.closest<HTMLElement>('[data-chat-action="toggle-scene-state"]')) {
      sceneStateCollapsed = !sceneStateCollapsed
      const conversation = getActiveConversation(state)
      if (conversation) {
        renderer.renderMessages(conversation.messages)
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
      void selectRuntimeChatModel(runtimeModel.dataset.chatRuntimeModelId || '', runtimeModel.dataset.chatRuntimeModelName || '')
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
      if (modelId && modelAction.dataset.chatModelAction === 'toggle-enabled-model') {
        void toggleChatApiEnabledModel(modelId, modelAction.dataset.chatModelName || '')
      }
      if (modelId && modelAction.dataset.chatModelAction === 'delete') {
        void deleteChatModel(modelId)
      }
      return
    }

    const addModelTypeAction = eventTarget.closest<HTMLElement>('[data-chat-add-model-type]')
    if (addModelTypeAction && panel.contains(addModelTypeAction)) {
      const modelType = addModelTypeAction.dataset.chatAddModelType
      if (modelType === 'llm' || modelType === 'image') {
        void addChatModel(modelType)
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

    const workflowCloseTab = eventTarget.closest<HTMLElement>('[data-chat-workflow-close-tab]')
    if (workflowCloseTab && panel.contains(workflowCloseTab)) {
      closeCharacterWorkflowTab(workflowCloseTab.dataset.chatWorkflowCloseTab || '')
      return
    }

    const workflowLinkSelect = eventTarget.closest<HTMLElement>('[data-chat-workflow-link-select]')
    if (workflowLinkSelect && panel.contains(workflowLinkSelect)) {
      characterResourceViewState.selectedLinkId = workflowLinkSelect.dataset.chatWorkflowLinkSelect || ''
      characterResourceViewState.selectedNodeIds = []
      characterWorkflowEditorState.nodeSearchOpen = false
      renderCharacterWorkflow()
      return
    }

    const resourceLibraryCard = eventTarget.closest<HTMLElement>('[data-resource-library-card][data-resource-node-add-type]')
    if (resourceLibraryCard && panel.contains(resourceLibraryCard)) {
      addCharacterResourceNodeFromLibrary(resourceLibraryCard)
      return
    }

    const workflowModelChoice = eventTarget.closest<HTMLElement>('[data-chat-workflow-model-choice]')
    if (workflowModelChoice && panel.contains(workflowModelChoice)) {
      updateCharacterWorkflowModelChoice(workflowModelChoice)
      return
    }

    const workflowNodeSelect = eventTarget.closest<HTMLElement>('[data-chat-workflow-node-select]')
    if (workflowNodeSelect && panel.contains(workflowNodeSelect)) {
      characterResourceViewState.selectedLinkId = ''
      characterWorkflowEditorState.nodeSearchOpen = false
      const panelId = workflowNodeSelect.dataset.chatWorkflowPanel
      if (panelId) {
        setCharacterWorkflowPanel(panelId)
      }
      if (!eventTarget.closest('[data-chat-workflow-param]')) {
        selectWorkflowNode(workflowNodeSelect.dataset.chatWorkflowNodeSelect || '', event.metaKey || event.ctrlKey || event.shiftKey)
      }
      return
    }

    const workflowPanel = eventTarget.closest<HTMLElement>('[data-chat-workflow-panel]')
    if (workflowPanel && panel.contains(workflowPanel)) {
      setCharacterWorkflowPanel(workflowPanel.dataset.chatWorkflowPanel || '')
      return
    }

    const workflowTab = eventTarget.closest<HTMLElement>('[data-chat-workflow-tab]')
    if (workflowTab && panel.contains(workflowTab)) {
      selectCharacterWorkflowTab(workflowTab.dataset.chatWorkflowTab || '')
      return
    }

    const workflowAction = eventTarget.closest<HTMLElement>('[data-chat-workflow-action]')
    if (workflowAction && panel.contains(workflowAction)) {
      handleCharacterWorkflowAction(workflowAction.dataset.chatWorkflowAction || '', workflowAction)
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
    const workflowParam = (event.target as HTMLElement | null)?.closest<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-chat-workflow-param]')
    if (workflowParam && panel.contains(workflowParam)) {
      updateCharacterWorkflowParameter(workflowParam)
      return
    }
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
  panel.addEventListener('pointerdown', beginCharacterResourceNodeResize)
  panel.addEventListener('pointerdown', beginCharacterWorkflowNodeDrag)
  panel.addEventListener('pointerdown', beginCharacterResourceViewportDrag)
  panel.addEventListener('pointerdown', beginCharacterResourceMinimapPointer)
  panel.addEventListener('wheel', updateCharacterResourceViewportZoom, { passive: false })
  panel.addEventListener('pointerdown', beginManualDrag)
  window.addEventListener('pointermove', updateChatResize)
  window.addEventListener('pointermove', updateCharacterResourceNodeResize)
  window.addEventListener('pointermove', updateCharacterWorkflowNodeDrag)
  window.addEventListener('pointermove', updateCharacterResourceViewportDrag)
  window.addEventListener('pointermove', updateManualDrag)
  window.addEventListener('pointerup', endChatResize)
  window.addEventListener('pointerup', endCharacterResourceNodeResize)
  window.addEventListener('pointerup', endCharacterWorkflowNodeDrag)
  window.addEventListener('pointerup', endCharacterResourceViewportDrag)
  window.addEventListener('pointerup', endManualDrag)
  window.addEventListener('pointercancel', endChatResize)
  window.addEventListener('pointercancel', endCharacterResourceNodeResize)
  window.addEventListener('pointercancel', endCharacterWorkflowNodeDrag)
  window.addEventListener('pointercancel', endCharacterResourceViewportDrag)
  window.addEventListener('pointercancel', endManualDrag)
  window.addEventListener('keydown', (event) => {
    const resourceShortcut = panel.dataset.chatView === 'character-workflow' && !((event.target as HTMLElement | null)?.closest('input, textarea, select'))
    if (resourceShortcut && (event.metaKey || event.ctrlKey) && event.key === 'z') {
      event.preventDefault()
      executeCharacterResourceCommand(event.shiftKey ? 'redo-graph' : 'undo-graph')
      return
    }
    if (resourceShortcut && (event.metaKey || event.ctrlKey) && event.key === 'c') {
      event.preventDefault()
      executeCharacterResourceCommand('copy-selection')
      return
    }
    if (resourceShortcut && (event.metaKey || event.ctrlKey) && event.key === 'v') {
      event.preventDefault()
      executeCharacterResourceCommand('paste-selection')
      return
    }
    if (event.key === 'Escape' && conversationSettingsPanel?.classList.contains('visible')) {
      closeConversationSettings()
    }
    if (event.key === 'Escape' && chatHistoryPanel?.classList.contains('visible')) {
      closeChatHistoryManager()
    }
    if (event.key === 'Escape' && characterWorkflowEditorState.nodeSearchOpen) {
      characterWorkflowEditorState.nodeSearchOpen = false
      renderCharacterWorkflow()
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
    if (characterWorkflowTitle) {
      characterWorkflowTitle.textContent = language === 'zh-CN' ? '角色资源图' : 'Character Resource Graph'
    }
    if (chatHistoryTitle) {
      chatHistoryTitle.textContent = language === 'zh-CN' ? '对话管理' : 'Conversation management'
    }
    if (chatHistoryKicker) {
      chatHistoryKicker.textContent = language === 'zh-CN' ? 'Context memory' : 'Context memory'
    }
    if (conversationSettingsPanel?.classList.contains('visible')) {
      renderConversationSettings()
    }
    if (chatHistoryPanel?.classList.contains('visible')) {
      renderChatHistoryManager()
    }
    if (panel.dataset.chatView === 'character-workflow') {
      renderCharacterWorkflow()
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
      sceneState: conversation.sceneState,
      summaries: conversation.summaries.map((summary) => ({ ...summary })),
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

function formatChatHistoryRole(role: ChatMessage['role'], language: 'zh-CN' | 'en-US'): string {
  if (role === 'user') {
    return language === 'zh-CN' ? '你' : 'You'
  }
  if (role === 'system') {
    return 'System'
  }
  return language === 'zh-CN' ? '角色' : 'Character'
}

function formatSummaryRange(summary: ChatMemorySummary, language: 'zh-CN' | 'en-US'): string {
  const start = Math.max(1, Math.round(Number(summary.startMessageIndex) || 1))
  const end = Math.max(start, Math.round(Number(summary.endMessageIndex) || start))
  return language === 'zh-CN'
    ? `${start} -> ${end} 原始消息摘要`
    : `messages ${start} -> ${end}`
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
