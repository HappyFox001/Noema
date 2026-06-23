/**
 * Owns the standalone chat surface interactions and window mode transitions.
 */
import { getImageProviderCatalogEntry, getLLMProviderCatalogEntry } from '../../main/model-provider-catalog'
import {
  applyChatRuntimeTurnResult,
  buildChatRuntimeTurnRequest,
  getChatMessageOrdinal,
  summarizeChatConversationOverflow,
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
type CharacterWorkflowTemplateId = 'character-card' | 'world-card'

const CHARACTER_WORKFLOW_LIBRARY_MIN_WIDTH = 148
const CHARACTER_WORKFLOW_LIBRARY_DEFAULT_WIDTH = 176
const CHARACTER_WORKFLOW_LIBRARY_MAX_WIDTH = 260

interface CharacterWorkflowEditorState {
  activePanel: CharacterWorkflowSidePanel
  sidebarCollapsed: boolean
  inspectorCollapsed: boolean
  nodeSearchOpen: boolean
  workflowLibraryWidth: number
  workflowLibraryCollapsed: boolean
}

interface PersistedCharacterWorkflowState {
  activeWorkflowId?: string
  workflows?: CharacterWorkflowProjectRecord[]
  activeTabId: string
  editorState: CharacterWorkflowEditorState
}

interface CharacterWorkflowProjectRecord {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  configOverrides: Record<string, Record<string, unknown>>
  positionOverrides: Record<string, { x: number; y: number }>
  viewState: CharacterWorkflowProjectViewState
  runCount: number
  activeRunId?: string
  runs: CharacterWorkflowProjectRunRecord[]
}

interface CharacterWorkflowProjectRunRecord {
  id: string
  title: string
  status: NonNullable<CharacterResourceRunState['run']>['status']
  createdAt: number
  completedAt?: number
  runState: CharacterResourceRunState
}

interface CharacterWorkflowProjectViewState {
  selectedWorkflowNodeId: string
  selectedNodeIds: string[]
  selectedLinkId: string
  zoom: number
  panX: number
  panY: number
  hideLinks: boolean
  collapsedNodeIds: string[]
  deletedNodeIds: string[]
  duplicatedNodes: Array<{ id: string; sourceId: string; offsetX: number; offsetY: number }>
  addedNodes: Array<{ id: string; type: string; title: string; x: number; y: number }>
  nodeSizes: Record<string, { width: number; height: number }>
  linkKinds: Record<string, SerializedCharacterResourceLinkKind>
  customLinks: SerializedCharacterResourceLink[]
  deletedLinkIds: string[]
  replacedTargetSlots: string[]
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
  t?(key: string): string
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
  const visibleChatApiKeys = new Set<string>()
  let conversationSettings = loadConversationSettings()
  let sceneStateCollapsed = false
  let characterWorkflowRenderToken = 0
  let characterWorkflowLazyRenderToken = 0
  let characterWorkflowPageModulePromise: Promise<CharacterWorkflowPageModule> | null = null
  const characterWorkflowConfigOverrides: Record<string, Record<string, unknown>> = {}
  const characterWorkflowPositionOverrides: Record<string, { x: number; y: number }> = {}
  let characterWorkflowProjects: CharacterWorkflowProjectRecord[] = []
  let activeCharacterWorkflowProjectId = ''
  let characterWorkflowLibrarySearch = ''
  let characterWorkflowBuilderPrompt = ''
  let characterWorkflowAssistantPrompt = ''
  let characterWorkflowBuilderStatus = ''
  let characterWorkflowAssistantStatusExpanded = true
  let characterWorkflowBuilderBusy = false
  let characterWorkflowTemplateMenuOpen = false
  let characterWorkflowRunState: CharacterResourceRunState | null = null
  let characterWorkflowRunCount = 0
  let characterWorkflowActiveTabId = 'workflow'
  let characterWorkflowPersistTimer: number | undefined
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
    workflowLibraryWidth: 176,
    workflowLibraryCollapsed: false,
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
  let characterWorkflowLibraryResize: {
    pointerId: number
    startX: number
    originWidth: number
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
    restoreCharacterWorkflowStateFromConversation(getActiveConversation(state))
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
      runtimeOptions: {
        shortTermMessageLimit: getShortTermMessageLimit(),
        summaryLimit: conversationSettings.summaryLimit,
      },
      attachments,
      conversation,
      draftMessageId: message.id,
      character,
      sceneImmersion: conversationSettings.sceneImmersion,
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
      const snapshot = applyChatRuntimeTurnResult(conversation, {
        assistantMessageId: message.id,
        content: reply,
        language,
        sceneUpdate: response.success ? response.sceneUpdate : undefined,
      })
      conversation.messages = snapshot.messages as ChatMessage[]
      conversation.sceneState = snapshot.sceneState ?? conversation.sceneState
      conversation.preview = snapshot.preview ?? conversation.preview
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
    try {
      const summary = await summarizeChatConversationOverflow(conversation, {
        language,
        runtimeOptions: {
          shortTermMessageLimit: getShortTermMessageLimit(),
          summaryLimit: conversationSettings.summaryLimit,
          summaryBatchMessageCount: CHAT_SUMMARY_BATCH_MESSAGE_COUNT,
        },
        force,
        createdLabel: getTimeLabel(),
        createSummaryId: () => `summary-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        summarize: async (prompt) => {
          const response = await window.electronAPI.sendChatMessage({
            input: prompt,
            language,
            options: {
              temperature: 0.2,
              top_p: 0.5,
              max_tokens: 420,
            },
          })
          return response.success ? response.response || '' : ''
        },
      }) as ChatMemorySummary | null
      if (!summary) {
        return
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
    runtimeModelPicker.innerHTML = renderChatRuntimeModelPickerMarkup()
    refreshCharacterWorkflowRuntimeModelPickers()
  }

  function renderChatRuntimeModelPickerMarkup(extraClass = ''): string {
    const config = chatSystemConfig
    if (!config) {
      return ''
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
    return `
      <div class="chat-runtime-model-shell ${extraClass} ${openChatRuntimeModelPicker ? 'open' : ''}">
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

  function refreshCharacterWorkflowRuntimeModelPickers(): void {
    const shells = characterWorkflowRoot?.querySelectorAll<HTMLElement>('.chat-runtime-model-shell.workflow-builder, .chat-runtime-model-shell.workflow-assistant')
    if (!shells?.length) {
      return
    }
    shells.forEach((shell) => {
      const extraClass = shell.classList.contains('workflow-assistant') ? 'workflow-assistant' : 'workflow-builder'
      const wrapper = document.createElement('div')
      wrapper.innerHTML = renderChatRuntimeModelPickerMarkup(extraClass)
      const nextShell = wrapper.firstElementChild
      if (nextShell) {
        shell.replaceWith(nextShell)
      }
    })
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
      if (activeCharacterWorkflowProjectId) {
        renderCharacterWorkflow()
      } else {
        refreshCharacterWorkflowRuntimeModelPickers()
      }
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
      visibleApiKeyIds: visibleChatApiKeys,
      loadingModelIds: chatModelLoading,
      modelOptions: chatModelOptions,
    })
  }

  function loadCharacterWorkflowPageModule(): Promise<CharacterWorkflowPageModule> {
    characterWorkflowPageModulePromise ??= import('./chat-character-workflow-page')
    return characterWorkflowPageModulePromise
  }

  function renderCharacterWorkflow(): void {
    scheduleActiveConversationWorkflowPersist()
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
    if (!activeCharacterWorkflowProjectId) {
      characterWorkflowRoot.innerHTML = renderCharacterWorkflowLibraryShell(renderCharacterWorkflowLibraryEmptyState())
      return
    }
    const workflowPage = await loadCharacterWorkflowPageModule()
    if (renderToken !== characterWorkflowLazyRenderToken) {
      return
    }
    const activeProject = characterWorkflowProjects.find((project) => project.id === activeCharacterWorkflowProjectId)
    if (!activeProject) {
      activeCharacterWorkflowProjectId = ''
      characterWorkflowRoot.innerHTML = renderCharacterWorkflowLibraryShell(renderCharacterWorkflowLibraryEmptyState())
      return
    }
    const workflowMarkup = workflowPage.renderCharacterWorkflowPage({
      language: options.getLanguage(),
      escapeHtml: options.escapeHtml,
      t: options.t,
      modelChoices: getCharacterWorkflowModelChoices(),
      configOverrides: characterWorkflowConfigOverrides,
      positionOverrides: characterWorkflowPositionOverrides,
      runState: characterWorkflowRunState,
      tabs: getCharacterWorkflowTabs(),
      activeTabId: characterWorkflowActiveTabId,
      selectedNodeId: selectedWorkflowNodeId,
      activePanel: characterWorkflowEditorState.activePanel,
      sidebarCollapsed: characterWorkflowEditorState.sidebarCollapsed,
      workflowLibraryCollapsed: characterWorkflowEditorState.workflowLibraryCollapsed,
      inspectorCollapsed: characterWorkflowEditorState.inspectorCollapsed,
      nodeSearchOpen: characterWorkflowEditorState.nodeSearchOpen,
      workflowAssistantHtml: renderCharacterWorkflowAssistant(),
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
    characterWorkflowRoot.innerHTML = renderCharacterWorkflowLibraryShell(workflowMarkup, activeProject)
    workflowPage.initializeCharacterResourceWorkbench(characterWorkflowRoot)
  }

  function getCharacterWorkflowTabs(): CharacterWorkflowFileTab[] {
    const activeWorkflow = characterWorkflowProjects.find((project) => project.id === activeCharacterWorkflowProjectId)
    const runStatus = characterWorkflowRunState?.run?.status
    const state = runStatus === 'running'
      ? 'running'
      : runStatus === 'failed'
        ? 'failed'
        : undefined
    return [{
      id: 'workflow',
      title: formatCharacterWorkflowFileTitle(activeWorkflow),
      kind: 'workflow',
      state,
    }]
  }

  function formatCharacterWorkflowFileTitle(workflow: CharacterWorkflowProjectRecord | undefined): string {
    const fallback = options.getLanguage() === 'zh-CN' ? '未命名草稿' : 'Untitled Draft'
    const name = (workflow?.name || fallback).trim()
    return name.endsWith('.resourcegraph') ? name : `${name}.resourcegraph`
  }

  function renderCharacterWorkflowLibraryShell(content: string, activeProject?: CharacterWorkflowProjectRecord): string {
    const libraryWidth = clampCharacterWorkflowLibraryWidth(characterWorkflowEditorState.workflowLibraryWidth)
    const collapsed = characterWorkflowEditorState.workflowLibraryCollapsed
    return `
      <section class="chat-workflow-library-shell ${collapsed ? 'library-collapsed' : ''}" style="--workflow-library-width: ${collapsed ? 0 : libraryWidth}px">
        ${renderCharacterWorkflowLibrarySidebar(activeProject)}
        <div class="chat-workflow-library-gutter" data-chat-workflow-library-resize aria-hidden="true"></div>
        <main class="chat-workflow-library-main">
          ${content}
        </main>
      </section>
    `
  }

  function renderCharacterWorkflowLibrarySidebar(activeProject?: CharacterWorkflowProjectRecord): string {
    const zh = options.getLanguage() === 'zh-CN'
    const sorted = [...characterWorkflowProjects].sort((a, b) => b.updatedAt - a.updatedAt)
    const query = characterWorkflowLibrarySearch.trim().toLocaleLowerCase()
    const filtered = query
      ? sorted.filter((project) => `${project.name} ${project.runs.at(-1)?.title ?? ''}`.toLocaleLowerCase().includes(query))
      : sorted
    const totalRuns = sorted.reduce((sum, project) => sum + project.runs.length, 0)
    return `
      <aside class="chat-workflow-library-sidebar">
        <header class="chat-workflow-library-head">
          <div>
            <span>${options.escapeHtml(zh ? 'Workflows' : 'Workflows')}</span>
            <strong>${options.escapeHtml(zh ? '角色草稿' : 'Character drafts')}</strong>
          </div>
          <div class="chat-workflow-library-head-actions">
            <button type="button" data-chat-workflow-library-action="create-menu" aria-label="${options.escapeHtml(zh ? '新建草稿' : 'New draft')}">+</button>
          </div>
          ${characterWorkflowTemplateMenuOpen ? renderCharacterWorkflowTemplateMenu(zh) : ''}
        </header>
        <div class="chat-workflow-library-search">
          <input type="search" value="${options.escapeHtml(characterWorkflowLibrarySearch)}" placeholder="${options.escapeHtml(zh ? '搜索草稿' : 'Search drafts')}" data-chat-workflow-library-search />
        </div>
        <section class="chat-workflow-library-section">
          <div class="chat-workflow-library-divider">
            <span>${options.escapeHtml(zh ? '草稿' : 'Drafts')}</span>
            <small>${sorted.length} / ${totalRuns}</small>
          </div>
          <div class="chat-workflow-library-list">
            ${filtered.length ? filtered.map((project) => renderCharacterWorkflowLibraryRow(project, zh)).join('') : `
              <div class="chat-workflow-library-empty-row">
                ${options.escapeHtml(query ? (zh ? '没有匹配草稿' : 'No matching drafts') : (zh ? '还没有草稿' : 'No drafts yet'))}
              </div>
            `}
          </div>
        </section>
        <section class="chat-workflow-library-section">
          <div class="chat-workflow-library-divider">
            <span>${options.escapeHtml(zh ? '当前工作流' : 'Current workflow')}</span>
          </div>
          <div class="chat-workflow-library-current">
            ${activeProject ? `
              <strong>${options.escapeHtml(activeProject.name)}</strong>
              <span>${options.escapeHtml(formatWorkflowProjectTime(activeProject.updatedAt, zh))}</span>
            ` : `
              <strong>${options.escapeHtml(zh ? '未打开草稿' : 'No draft open')}</strong>
              <span>${options.escapeHtml(zh ? '选择或新建一个角色草稿' : 'Select or create a character draft')}</span>
            `}
          </div>
        </section>
        ${activeProject ? `
          <section class="chat-workflow-library-section run-history">
            <div class="chat-workflow-library-divider">
              <span>${options.escapeHtml(zh ? '运行历史' : 'Run history')}</span>
              <small>${activeProject.runs.length}</small>
            </div>
            <div class="chat-workflow-library-run-list">
              ${activeProject.runs.length ? activeProject.runs.slice().reverse().slice(0, 8).map((run) => renderCharacterWorkflowRunRow(activeProject.id, run, zh)).join('') : `
                <div class="chat-workflow-library-empty-row">${options.escapeHtml(zh ? '暂无运行' : 'No runs yet')}</div>
              `}
            </div>
          </section>
        ` : ''}
      </aside>
    `
  }

  function renderCharacterWorkflowTemplateMenu(zh: boolean): string {
    return `
      <div class="chat-workflow-template-menu">
        <button type="button" data-chat-workflow-library-action="create" data-chat-workflow-template-id="blank">
          <strong>${options.escapeHtml(zh ? '空白草稿' : 'Blank draft')}</strong>
          <span>${options.escapeHtml(zh ? '只保留基础流图' : 'Base graph only')}</span>
        </button>
        ${getCharacterWorkflowTemplates(zh).map((template) => `
          <button type="button" data-chat-workflow-library-action="create-template" data-chat-workflow-template-id="${options.escapeHtml(template.id)}">
            <strong>${options.escapeHtml(template.name)}</strong>
            <span>${options.escapeHtml(template.caption)}</span>
          </button>
        `).join('')}
      </div>
    `
  }

  function getCharacterWorkflowTemplates(zh: boolean): Array<{
    id: CharacterWorkflowTemplateId
    name: string
    caption: string
    category: string
    label: string
    spec: Parameters<typeof createCharacterWorkflowDraftFromSpec>[0]
  }> {
    return [
      {
        id: 'character-card',
        name: zh ? '角色卡' : 'Character card',
        caption: zh ? '角色卡、开场白、图片、报告' : 'Card, opening, image, report',
        category: 'character',
        label: zh ? '角色' : 'Character',
        spec: {
          name: 'Character Card Draft',
          goalPrompt: '',
          configOverrides: {
            'character-card-target': { includeFields: ['name', 'description', 'appearance', 'personality', 'background', 'scenario', 'firstMessage', 'dialogueStyle', 'worldContext'], includeSupportFields: ['memoryStrategy', 'imagePrompt'] },
            'opening-field-target': { field: 'firstMessage' },
            'opening-field-control': { lengthPolicy: 'medium' },
            'image-target': { imageRole: 'avatar' },
            'image-control': { targetImageCount: 1, imageType: 'avatar', composition: 'upper-body-portrait', consistencyMode: 'same-character' },
            'generation-strategy': { mode: 'branch-and-refine', branchCount: 3, priorityAssets: ['role-card', 'opening', 'image-pack'] },
            'quality-gate': { minimumScore: 0.84 },
          },
        },
      },
      {
        id: 'world-card',
        name: zh ? '世界卡' : 'World card',
        caption: zh ? '主线、多个 NPC、场景资源' : 'Story arc, NPCs, scenes',
        category: 'world',
        label: zh ? '世界' : 'World',
        spec: {
          name: 'World Card Draft',
          goalPrompt: '',
          configOverrides: {
            'source-material': { sourceKind: 'notes' },
            'world-card-target': { worldSections: ['setting', 'rules', 'factions', 'relationship-network', 'plot-hooks'] },
            'npc-pack-target': { npcCount: 4 },
            'primary-npc-target': {},
            'plot-arc-target': { arcShape: 'slow-burn', milestoneCount: 8 },
            'scene-card-target': { sceneCount: 4 },
            'continuity-control': { progressionPacing: 'slow-burn', forbidResettingFacts: true },
            'relationship-control': { relationshipMode: 'ambiguous-ally' },
            'image-target': { imageRole: 'scene' },
            'image-control': { targetImageCount: 2, imageType: 'scene', composition: 'environmental-scene', consistencyMode: 'same-world' },
            'world-reference-image-target': { imageRole: 'reference' },
            'world-reference-image-control': { targetImageCount: 2, imageType: 'reference', composition: 'character-focused', consistencyMode: 'same-world' },
            'generation-strategy': { mode: 'explore-then-converge', branchCount: 4, priorityAssets: ['world-context', 'npc-pack', 'scene-context', 'image-pack'] },
            'quality-gate': { minimumScore: 0.86 },
          },
          addedNodes: [
            { id: 'world-card-target', type: 'world-card-target', title: 'World Card Target', x: 730, y: 640 },
            { id: 'npc-pack-target', type: 'npc-pack-target', title: 'NPC Pack Target', x: 1060, y: 640 },
            { id: 'primary-npc-target', type: 'npc-target', title: 'Primary NPC Target', x: 1390, y: 640 },
            { id: 'plot-arc-target', type: 'plot-arc-target', title: 'Plot Arc Target', x: 1390, y: 860 },
            { id: 'scene-card-target', type: 'scene-card-target', title: 'Scene Card Target', x: 1720, y: 760 },
            { id: 'continuity-control', type: 'continuity-control', title: 'Continuity Control', x: 1060, y: 860 },
            { id: 'relationship-control', type: 'relationship-control', title: 'Relationship Control', x: 730, y: 860 },
            { id: 'world-reference-image-target', type: 'image-target', title: 'Reference Image Target', x: 730, y: 1080 },
            { id: 'world-reference-image-control', type: 'image-generation-control', title: 'Reference Image Control', x: 1060, y: 1080 },
          ],
          customLinks: [
            { id: 'world-goal', sourceNodeId: 'generation-goal', sourceSlotId: 'goal', targetNodeId: 'world-card-target', targetSlotId: 'goal', kind: 'guides' },
            { id: 'world-source', sourceNodeId: 'source-material', sourceSlotId: 'source', targetNodeId: 'world-card-target', targetSlotId: 'source', kind: 'grounds' },
            { id: 'world-style', sourceNodeId: 'style-pressure', sourceSlotId: 'style', targetNodeId: 'world-card-target', targetSlotId: 'style', kind: 'weights' },
            { id: 'world-constraint', sourceNodeId: 'hard-constraints', sourceSlotId: 'constraint', targetNodeId: 'world-card-target', targetSlotId: 'constraint', kind: 'constrains' },
            { id: 'world-npc-pack', sourceNodeId: 'world-card-target', sourceSlotId: 'world', targetNodeId: 'npc-pack-target', targetSlotId: 'world', kind: 'guides' },
            { id: 'relationship-npc-pack', sourceNodeId: 'relationship-control', sourceSlotId: 'relationship', targetNodeId: 'npc-pack-target', targetSlotId: 'relationship', kind: 'guides' },
            { id: 'npc-pack-primary', sourceNodeId: 'npc-pack-target', sourceSlotId: 'npcPack', targetNodeId: 'primary-npc-target', targetSlotId: 'npcPack', kind: 'guides' },
            { id: 'relationship-primary-npc', sourceNodeId: 'relationship-control', sourceSlotId: 'relationship', targetNodeId: 'primary-npc-target', targetSlotId: 'relationship', kind: 'guides' },
            { id: 'world-plot', sourceNodeId: 'world-card-target', sourceSlotId: 'world', targetNodeId: 'plot-arc-target', targetSlotId: 'world', kind: 'guides' },
            { id: 'npc-pack-plot', sourceNodeId: 'npc-pack-target', sourceSlotId: 'npcPack', targetNodeId: 'plot-arc-target', targetSlotId: 'npcPack', kind: 'guides' },
            { id: 'continuity-plot', sourceNodeId: 'continuity-control', sourceSlotId: 'continuity', targetNodeId: 'plot-arc-target', targetSlotId: 'continuity', kind: 'guides' },
            { id: 'world-scene', sourceNodeId: 'world-card-target', sourceSlotId: 'world', targetNodeId: 'scene-card-target', targetSlotId: 'world', kind: 'guides' },
            { id: 'plot-scene', sourceNodeId: 'plot-arc-target', sourceSlotId: 'plot', targetNodeId: 'scene-card-target', targetSlotId: 'plot', kind: 'guides' },
            { id: 'world-reference-card', sourceNodeId: 'character-card-target', sourceSlotId: 'target', targetNodeId: 'world-reference-image-target', targetSlotId: 'card', kind: 'guides' },
            { id: 'world-reference-tool', sourceNodeId: 'image-capability', sourceSlotId: 'image', targetNodeId: 'world-reference-image-target', targetSlotId: 'image', kind: 'enables' },
            { id: 'world-reference-control-target', sourceNodeId: 'world-reference-image-target', sourceSlotId: 'imageAsset', targetNodeId: 'world-reference-image-control', targetSlotId: 'imageTarget', kind: 'guides' },
            { id: 'world-reference-control', sourceNodeId: 'world-reference-image-control', sourceSlotId: 'imageControl', targetNodeId: 'world-reference-image-target', targetSlotId: 'imageControl', kind: 'guides' },
            { id: 'world-reference-style', sourceNodeId: 'style-pressure', sourceSlotId: 'style', targetNodeId: 'world-reference-image-target', targetSlotId: 'style', kind: 'weights' },
            { id: 'world-reference-constraint', sourceNodeId: 'hard-constraints', sourceSlotId: 'constraint', targetNodeId: 'world-reference-image-target', targetSlotId: 'constraint', kind: 'constrains' },
          ],
        },
      },
    ]
  }

  function renderCharacterWorkflowLibraryRow(project: CharacterWorkflowProjectRecord, zh: boolean): string {
    const latestRun = project.runs[project.runs.length - 1]
    const status = latestRun?.status ?? 'idle'
    return `
      <div class="chat-workflow-library-row ${project.id === activeCharacterWorkflowProjectId ? 'active' : ''}" data-chat-workflow-open="${options.escapeHtml(project.id)}">
        <button class="chat-workflow-library-row-open" type="button" data-chat-workflow-open="${options.escapeHtml(project.id)}">
        <span class="chat-workflow-library-dot ${options.escapeHtml(status)}"></span>
        <span class="chat-workflow-library-row-body">
          <strong>${options.escapeHtml(project.name)}</strong>
          <small>${options.escapeHtml(latestRun ? `${latestRun.title} · ${latestRun.status}` : (zh ? '未运行' : 'Not run'))}</small>
        </span>
        <span class="chat-workflow-library-row-meta">${project.runs.length}</span>
        </button>
        <span class="chat-workflow-library-row-actions">
          <button type="button" data-chat-workflow-library-action="rename" data-chat-workflow-id="${options.escapeHtml(project.id)}" aria-label="${options.escapeHtml(zh ? '重命名' : 'Rename')}">R</button>
          <button type="button" data-chat-workflow-library-action="duplicate" data-chat-workflow-id="${options.escapeHtml(project.id)}" aria-label="${options.escapeHtml(zh ? '复制' : 'Duplicate')}">D</button>
          <button type="button" data-chat-workflow-library-action="delete" data-chat-workflow-id="${options.escapeHtml(project.id)}" aria-label="${options.escapeHtml(zh ? '删除' : 'Delete')}">x</button>
        </span>
      </div>
    `
  }

  function renderCharacterWorkflowRunRow(projectId: string, run: CharacterWorkflowProjectRunRecord, zh: boolean): string {
    return `
      <button class="chat-workflow-library-run-row ${run.id === characterWorkflowRunState?.run?.id ? 'active' : ''}" type="button" data-chat-workflow-run-open="${options.escapeHtml(projectId)}:${options.escapeHtml(run.id)}">
        <span class="chat-workflow-library-run-status ${options.escapeHtml(run.status)}"></span>
        <span>
          <strong>${options.escapeHtml(run.title)}</strong>
          <small>${options.escapeHtml(`${run.status} · ${formatWorkflowProjectTime(run.completedAt ?? run.createdAt, zh)}`)}</small>
        </span>
      </button>
    `
  }

  function renderCharacterWorkflowLibraryEmptyState(): string {
    const zh = options.getLanguage() === 'zh-CN'
    return `
      <section class="chat-workflow-builder-main">
        <div class="chat-workflow-builder-card">
          <div class="chat-workflow-builder-head">
            <span>${options.escapeHtml(zh ? '新建资源图' : 'New resource graph')}</span>
            <strong>${options.escapeHtml(zh ? '从设想开始' : 'Start from an idea')}</strong>
          </div>
          <form class="chat-workflow-builder-box" data-chat-workflow-builder-form>
            <div class="chat-workflow-builder-label">
              <strong>${options.escapeHtml(zh ? '描述' : 'Describe')}</strong>
              <span>${options.escapeHtml(zh ? '让模型规划初始流图' : 'Let the model draft the graph')}</span>
            </div>
            <textarea data-chat-workflow-builder-input rows="4" placeholder="${options.escapeHtml(zh ? '校园恋爱，长期 RP，克制暧昧，角色主动推进关系，需要头像图和开场白' : 'Campus romance, long-form RP, restrained tension, proactive character, avatar and opening message')}" ${characterWorkflowBuilderBusy ? 'disabled' : ''}>${options.escapeHtml(characterWorkflowBuilderPrompt)}</textarea>
            <div class="chat-workflow-builder-footer">
              ${renderChatRuntimeModelPickerMarkup('workflow-builder')}
              <button type="submit" ${characterWorkflowBuilderBusy ? 'disabled' : ''}>${options.escapeHtml(characterWorkflowBuilderBusy ? (zh ? '创建中' : 'Creating') : (zh ? '创建' : 'Create'))}</button>
            </div>
            ${characterWorkflowBuilderStatus ? `<small class="chat-workflow-builder-status">${options.escapeHtml(characterWorkflowBuilderStatus)}</small>` : ''}
          </form>
        </div>
      </section>
    `
  }

  function renderCharacterWorkflowAssistant(): string {
    const zh = options.getLanguage() === 'zh-CN'
    const label = zh ? '应用资源图修改' : 'Apply graph edits'
    const statusLabel = zh ? 'Agent 信息' : 'Agent message'
    const copyLabel = zh ? '复制信息' : 'Copy message'
    const toggleLabel = characterWorkflowAssistantStatusExpanded
      ? (zh ? '收起信息' : 'Collapse message')
      : (zh ? '展开信息' : 'Expand message')
    return `
      <form class="chat-workflow-canvas-assistant ${characterWorkflowBuilderBusy ? 'is-busy' : ''}" data-chat-workflow-assistant-form>
        ${renderChatRuntimeModelPickerMarkup('workflow-assistant')}
        ${characterWorkflowBuilderStatus ? `
          <section class="chat-workflow-canvas-assistant-status ${characterWorkflowAssistantStatusExpanded ? 'expanded' : ''}" aria-live="polite">
            <div class="chat-workflow-canvas-assistant-status-head">
              <span>${options.escapeHtml(statusLabel)}</span>
              <div class="chat-workflow-canvas-assistant-status-actions">
                <button type="button" data-chat-workflow-assistant-status-action="copy" aria-label="${options.escapeHtml(copyLabel)}" title="${options.escapeHtml(copyLabel)}">
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M7 6.5V4.8c0-.9.6-1.5 1.5-1.5h5c.9 0 1.5.6 1.5 1.5v7c0 .9-.6 1.5-1.5 1.5H12"></path>
                    <path d="M5.5 6.7h5c.9 0 1.5.6 1.5 1.5v7c0 .9-.6 1.5-1.5 1.5h-5c-.9 0-1.5-.6-1.5-1.5v-7c0-.9.6-1.5 1.5-1.5Z"></path>
                  </svg>
                </button>
                <button type="button" data-chat-workflow-assistant-status-action="toggle" aria-label="${options.escapeHtml(toggleLabel)}" title="${options.escapeHtml(toggleLabel)}" aria-expanded="${characterWorkflowAssistantStatusExpanded ? 'true' : 'false'}">
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    ${characterWorkflowAssistantStatusExpanded
                      ? '<path d="m5.5 12.2 4.5-4.4 4.5 4.4"></path>'
                      : '<path d="m5.5 7.8 4.5 4.4 4.5-4.4"></path>'}
                  </svg>
                </button>
              </div>
            </div>
            <pre class="chat-workflow-canvas-assistant-status-body">${options.escapeHtml(characterWorkflowBuilderStatus)}</pre>
          </section>
        ` : ''}
        <div class="chat-workflow-canvas-assistant-row">
          <textarea data-chat-workflow-assistant-input rows="1" aria-label="${options.escapeHtml(zh ? '资源图 Agent 输入' : 'Resource graph agent input')}" ${characterWorkflowBuilderBusy ? 'disabled' : ''}>${options.escapeHtml(characterWorkflowAssistantPrompt)}</textarea>
          <button type="submit" aria-label="${options.escapeHtml(label)}" title="${options.escapeHtml(label)}" ${characterWorkflowBuilderBusy ? 'disabled' : ''}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M3.4 10H15.1"></path>
              <path d="M10.7 5.6 15.1 10l-4.4 4.4"></path>
            </svg>
          </button>
        </div>
      </form>
    `
  }

  function formatWorkflowProjectTime(value: number | undefined, zh: boolean): string {
    if (!value) {
      return zh ? '无' : 'None'
    }
    return new Date(value).toLocaleString(zh ? 'zh-CN' : 'en-US', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function clampCharacterWorkflowLibraryWidth(value: number | undefined): number {
    return Math.max(
      CHARACTER_WORKFLOW_LIBRARY_MIN_WIDTH,
      Math.min(CHARACTER_WORKFLOW_LIBRARY_MAX_WIDTH, Math.round(Number(value) || CHARACTER_WORKFLOW_LIBRARY_DEFAULT_WIDTH))
    )
  }

  function toggleCharacterWorkflowLibraryCollapsed(): void {
    characterWorkflowEditorState.workflowLibraryCollapsed = !characterWorkflowEditorState.workflowLibraryCollapsed
    renderCharacterWorkflow()
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

  function createWorkflowProjectViewState(): CharacterWorkflowProjectViewState {
    return {
      selectedWorkflowNodeId,
      selectedNodeIds: [...characterResourceViewState.selectedNodeIds],
      selectedLinkId: characterResourceViewState.selectedLinkId,
      zoom: characterResourceViewState.zoom,
      panX: characterResourceViewState.panX,
      panY: characterResourceViewState.panY,
      hideLinks: characterResourceViewState.hideLinks,
      collapsedNodeIds: [...characterResourceViewState.collapsedNodeIds],
      deletedNodeIds: [...characterResourceViewState.deletedNodeIds],
      duplicatedNodes: JSON.parse(JSON.stringify(characterResourceViewState.duplicatedNodes)) as CharacterWorkflowProjectViewState['duplicatedNodes'],
      addedNodes: JSON.parse(JSON.stringify(characterResourceViewState.addedNodes)) as CharacterWorkflowProjectViewState['addedNodes'],
      nodeSizes: cloneRecord(characterResourceViewState.nodeSizes),
      linkKinds: { ...characterResourceViewState.linkKinds },
      customLinks: JSON.parse(JSON.stringify(characterResourceViewState.customLinks)) as SerializedCharacterResourceLink[],
      deletedLinkIds: [...characterResourceViewState.deletedLinkIds],
      replacedTargetSlots: [...characterResourceViewState.replacedTargetSlots],
    }
  }

  function applyWorkflowProjectViewState(viewState: Partial<CharacterWorkflowProjectViewState> | undefined): void {
    selectedWorkflowNodeId = typeof viewState?.selectedWorkflowNodeId === 'string' ? viewState.selectedWorkflowNodeId : 'generation-goal'
    characterResourceViewState.selectedNodeIds = Array.isArray(viewState?.selectedNodeIds) && viewState.selectedNodeIds.length ? [...viewState.selectedNodeIds] : ['generation-goal']
    characterResourceViewState.selectedLinkId = typeof viewState?.selectedLinkId === 'string' ? viewState.selectedLinkId : ''
    characterResourceViewState.zoom = Number(viewState?.zoom) || 0.84
    characterResourceViewState.panX = Number(viewState?.panX) || 0
    characterResourceViewState.panY = Number(viewState?.panY) || 0
    characterResourceViewState.hideLinks = Boolean(viewState?.hideLinks)
    characterResourceViewState.collapsedNodeIds = new Set(viewState?.collapsedNodeIds ?? [])
    characterResourceViewState.deletedNodeIds = new Set(viewState?.deletedNodeIds ?? [])
    characterResourceViewState.duplicatedNodes = JSON.parse(JSON.stringify(viewState?.duplicatedNodes ?? [])) as CharacterWorkflowProjectViewState['duplicatedNodes']
    characterResourceViewState.addedNodes = JSON.parse(JSON.stringify(viewState?.addedNodes ?? [])) as CharacterWorkflowProjectViewState['addedNodes']
    characterResourceViewState.nodeSizes = cloneRecord(viewState?.nodeSizes ?? {})
    characterResourceViewState.linkKinds = { ...(viewState?.linkKinds ?? {}) }
    characterResourceViewState.customLinks = JSON.parse(JSON.stringify(viewState?.customLinks ?? [])) as SerializedCharacterResourceLink[]
    characterResourceViewState.deletedLinkIds = new Set(viewState?.deletedLinkIds ?? [])
    characterResourceViewState.replacedTargetSlots = new Set(viewState?.replacedTargetSlots ?? [])
  }

  function saveActiveWorkflowProjectSnapshot(): void {
    const project = characterWorkflowProjects.find((item) => item.id === activeCharacterWorkflowProjectId)
    if (!project) {
      return
    }
    upsertWorkflowProjectRunSnapshot(project)
    project.configOverrides = cloneRecord(characterWorkflowConfigOverrides)
    project.positionOverrides = cloneRecord(characterWorkflowPositionOverrides)
    project.viewState = createWorkflowProjectViewState()
    project.runCount = characterWorkflowRunCount
    project.activeRunId = characterWorkflowRunState?.run?.id
    project.updatedAt = Date.now()
  }

  function upsertWorkflowProjectRunSnapshot(project: CharacterWorkflowProjectRecord): void {
    if (!characterWorkflowRunState?.run) {
      return
    }
    const run = characterWorkflowRunState.run
    const existingIndex = project.runs.findIndex((item) => item.id === run.id)
    const existing = existingIndex >= 0 ? project.runs[existingIndex] : undefined
    const now = Date.now()
    const runRecord: CharacterWorkflowProjectRunRecord = {
      id: run.id,
      title: run.title,
      status: run.status,
      createdAt: existing?.createdAt ?? now,
      completedAt: run.status === 'done' || run.status === 'failed' ? existing?.completedAt ?? now : existing?.completedAt,
      runState: JSON.parse(JSON.stringify(characterWorkflowRunState)) as CharacterResourceRunState,
    }
    if (existingIndex >= 0) {
      project.runs[existingIndex] = runRecord
    } else {
      project.runs.push(runRecord)
    }
  }

  function createCharacterWorkflowDraft(): void {
    saveActiveWorkflowProjectSnapshot()
    characterWorkflowTemplateMenuOpen = false
    createCharacterWorkflowDraftFromSpec({})
  }

  function createCharacterWorkflowDraftFromTemplate(templateId: string): void {
    const template = getCharacterWorkflowTemplates(options.getLanguage() === 'zh-CN')
      .find((item) => item.id === templateId)
    if (!template) {
      return
    }
    saveActiveWorkflowProjectSnapshot()
    characterWorkflowTemplateMenuOpen = false
    createCharacterWorkflowDraftFromSpec(template.spec)
  }

  function createCharacterWorkflowDraftFromSpec(spec: {
    name?: string
    goalPrompt?: string
    targetAudience?: string
    stylePrompt?: string
    preset?: string
    intensity?: number
    mustHave?: string[]
    mustNot?: string[]
    sourceNotes?: string
    configOverrides?: Record<string, Record<string, unknown>>
    addedNodes?: Array<{ id: string; type: string; title: string; x: number; y: number }>
    customLinks?: SerializedCharacterResourceLink[]
    operations?: Array<Record<string, unknown>>
  }): void {
    const now = Date.now()
    const configOverrides: Record<string, Record<string, unknown>> = cloneRecord(spec.configOverrides ?? {})
    const operationPatch = createInitialWorkflowPatchFromOperations(spec.operations ?? [])
    for (const [nodeId, config] of Object.entries(operationPatch.configOverrides)) {
      configOverrides[nodeId] = {
        ...(configOverrides[nodeId] ?? {}),
        ...config,
      }
    }
    if ((spec.goalPrompt || spec.targetAudience) && !configOverrides['generation-goal']) {
      configOverrides['generation-goal'] = {
        ...(spec.goalPrompt ? { goalPrompt: spec.goalPrompt } : {}),
        ...(spec.targetAudience ? { targetAudience: spec.targetAudience } : {}),
        allowAgentExpansion: true,
      }
    }
    if ((spec.stylePrompt || spec.preset || typeof spec.intensity === 'number') && !configOverrides['style-pressure']) {
      configOverrides['style-pressure'] = {
        ...(spec.preset ? { preset: spec.preset } : {}),
        ...(typeof spec.intensity === 'number' ? { intensity: Math.max(0, Math.min(1, spec.intensity)) } : {}),
        ...(spec.stylePrompt ? { stylePrompt: spec.stylePrompt } : {}),
      }
    }
    if ((spec.mustHave?.length || spec.mustNot?.length) && !configOverrides['hard-constraints']) {
      configOverrides['hard-constraints'] = {
        ...(spec.mustHave?.length ? { mustHave: spec.mustHave } : {}),
        ...(spec.mustNot?.length ? { mustNot: spec.mustNot } : {}),
      }
    }
    if (spec.sourceNotes && !configOverrides['source-material']) {
      configOverrides['source-material'] = {
        sourceKind: 'notes',
        notes: spec.sourceNotes,
      }
    }
    const project: CharacterWorkflowProjectRecord = {
      id: `workflow-draft-${now}-${Math.random().toString(16).slice(2)}`,
      name: spec.name || (options.getLanguage() === 'zh-CN' ? `角色草稿 ${characterWorkflowProjects.length + 1}` : `Character Draft ${characterWorkflowProjects.length + 1}`),
      createdAt: now,
      updatedAt: now,
      configOverrides,
      positionOverrides: {},
      viewState: {
        selectedWorkflowNodeId: 'generation-goal',
        selectedNodeIds: ['generation-goal'],
        selectedLinkId: '',
        zoom: 0.84,
        panX: 0,
        panY: 0,
        hideLinks: false,
        collapsedNodeIds: [],
        deletedNodeIds: [],
        duplicatedNodes: [],
        addedNodes: JSON.parse(JSON.stringify([...(spec.addedNodes ?? []), ...operationPatch.addedNodes])) as CharacterWorkflowProjectViewState['addedNodes'],
        nodeSizes: {},
        linkKinds: {},
        customLinks: JSON.parse(JSON.stringify([...(spec.customLinks ?? []), ...operationPatch.customLinks])) as SerializedCharacterResourceLink[],
        deletedLinkIds: [],
        replacedTargetSlots: [],
      },
      runCount: 0,
      runs: [],
    }
    characterWorkflowProjects = [project, ...characterWorkflowProjects]
    openCharacterWorkflowDraft(project.id)
  }

  function createInitialWorkflowPatchFromOperations(operations: Array<Record<string, unknown>>): {
    addedNodes: Array<{ id: string; type: string; title: string; x: number; y: number }>
    customLinks: SerializedCharacterResourceLink[]
    configOverrides: Record<string, Record<string, unknown>>
  } {
    const addedNodes: Array<{ id: string; type: string; title: string; x: number; y: number }> = []
    const customLinks: SerializedCharacterResourceLink[] = []
    const configOverrides: Record<string, Record<string, unknown>> = {}
    for (const operation of operations) {
      const type = typeof operation.type === 'string' ? operation.type : ''
      if (type === 'add-node') {
        const nodeType = typeof operation.nodeType === 'string' ? operation.nodeType.trim() : ''
        if (!nodeType) continue
        const nodeId = typeof operation.nodeId === 'string' && operation.nodeId.trim()
          ? sanitizeWorkflowResourceId(operation.nodeId.trim())
          : `${nodeType}-${Date.now().toString(36)}-${addedNodes.length + 1}`
        if (!addedNodes.some((node) => node.id === nodeId)) {
          addedNodes.push({
            id: nodeId,
            type: nodeType,
            title: typeof operation.title === 'string' && operation.title.trim() ? operation.title.trim() : nodeType,
            x: typeof operation.x === 'number' ? operation.x : 720 + addedNodes.length * 36,
            y: typeof operation.y === 'number' ? operation.y : 420 + addedNodes.length * 220,
          })
        }
        if (operation.config && typeof operation.config === 'object' && !Array.isArray(operation.config)) {
          configOverrides[nodeId] = {
            ...(configOverrides[nodeId] ?? {}),
            ...(operation.config as Record<string, unknown>),
          }
        }
      } else if (type === 'update-node-config') {
        const nodeId = typeof operation.nodeId === 'string' ? operation.nodeId.trim() : ''
        if (!nodeId || !operation.config || typeof operation.config !== 'object' || Array.isArray(operation.config)) continue
        configOverrides[nodeId] = {
          ...(configOverrides[nodeId] ?? {}),
          ...(operation.config as Record<string, unknown>),
        }
      } else if (type === 'add-link') {
        const sourceNodeId = typeof operation.sourceNodeId === 'string' ? operation.sourceNodeId.trim() : ''
        const sourceSlotId = typeof operation.sourceSlotId === 'string' ? operation.sourceSlotId.trim() : ''
        const targetNodeId = typeof operation.targetNodeId === 'string' ? operation.targetNodeId.trim() : ''
        const targetSlotId = typeof operation.targetSlotId === 'string' ? operation.targetSlotId.trim() : ''
        if (!sourceNodeId || !sourceSlotId || !targetNodeId || !targetSlotId) continue
        const kind = isSerializedCharacterResourceLinkKind(operation.kind) ? operation.kind : 'guides'
        const id = `${sourceNodeId}:${sourceSlotId}->${targetNodeId}:${targetSlotId}`
        if (!customLinks.some((link) => link.id === id)) {
          customLinks.push({ id, sourceNodeId, sourceSlotId, targetNodeId, targetSlotId, kind })
        }
      }
    }
    return { addedNodes, customLinks, configOverrides }
  }

  async function buildCharacterWorkflowFromPrompt(): Promise<void> {
    const prompt = characterWorkflowBuilderPrompt.trim()
    if (!prompt || characterWorkflowBuilderBusy) {
      return
    }
    characterWorkflowBuilderBusy = true
    characterWorkflowBuilderStatus = options.getLanguage() === 'zh-CN' ? '正在让模型规划资源图...' : 'Planning resource graph with model...'
    renderCharacterWorkflow()
    try {
      const zh = options.getLanguage() === 'zh-CN'
      const response = await window.electronAPI.buildCharacterWorkflow({
        prompt,
        language: options.getLanguage(),
      })
      if (!response.success) {
        throw new Error(response.error || 'Workflow builder failed')
      }
      createCharacterWorkflowDraftFromSpec({
        name: response.spec?.name,
        goalPrompt: response.spec?.goalPrompt,
        targetAudience: response.spec?.targetAudience,
        stylePrompt: response.spec?.stylePrompt,
        preset: response.spec?.preset,
        intensity: response.spec?.intensity,
        mustHave: response.spec?.mustHave,
        mustNot: response.spec?.mustNot,
        sourceNotes: response.spec?.sourceNotes,
        configOverrides: response.uiConfigOverrides,
        operations: response.spec?.operations,
      })
      characterWorkflowBuilderPrompt = ''
      characterWorkflowBuilderStatus = ''
      showToast(zh ? '已创建资源图草稿' : 'Resource graph draft created')
    } catch (error: any) {
      const message = error?.message || String(error)
      characterWorkflowBuilderStatus = message
      showToast(message)
    } finally {
      characterWorkflowBuilderBusy = false
      renderCharacterWorkflow()
    }
  }

  async function applyCharacterWorkflowAssistantPrompt(): Promise<void> {
    const userPrompt = characterWorkflowAssistantPrompt.trim()
    if (!userPrompt || characterWorkflowBuilderBusy || !activeCharacterWorkflowProjectId) {
      return
    }
    characterWorkflowBuilderBusy = true
    characterWorkflowBuilderStatus = options.getLanguage() === 'zh-CN' ? 'Agent 正在调整当前资源图...' : 'Agent editing current resource graph...'
    renderCharacterWorkflow()
    try {
      const workflowPage = await loadCharacterWorkflowPageModule()
      const response = await window.electronAPI.buildCharacterWorkflow({
        prompt: userPrompt,
        language: options.getLanguage(),
        mode: 'edit',
        graph: createCharacterWorkflowAssistantGraph(workflowPage),
      })
      if (!response.success) {
        throw new Error(response.error || 'Workflow agent failed')
      }
      pushCharacterResourceUndoSnapshot()
      const changed = applyCharacterWorkflowAssistantResult(response)
      if (!changed) {
        characterWorkflowBuilderStatus = options.getLanguage() === 'zh-CN' ? 'Agent 没有返回可应用的修改' : 'Agent returned no applicable changes'
      } else {
        characterWorkflowAssistantPrompt = ''
        characterWorkflowBuilderStatus = typeof response.spec?.summary === 'string' && response.spec.summary.trim()
          ? response.spec.summary.trim()
          : ''
        showToast(options.getLanguage() === 'zh-CN' ? '已应用资源图修改' : 'Applied graph edits')
      }
    } catch (error: any) {
      const message = error?.message || String(error)
      characterWorkflowBuilderStatus = message
      showToast(message)
    } finally {
      characterWorkflowBuilderBusy = false
      renderCharacterWorkflow()
    }
  }

  function createCharacterWorkflowAssistantGraph(workflowPage: CharacterWorkflowPageModule): {
    selectedNodeId: string
    nodes: Array<{
      id: string
      type: string
      title: string
      config: Record<string, unknown>
      inputs: string[]
      outputs: string[]
    }>
    edges: Array<{
      id?: string
      from: { nodeId: string; port: string }
      to: { nodeId: string; port: string }
      kind?: string
    }>
  } {
    const snapshot = workflowPage.createCharacterAgentWorkflowSnapshot({
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
    }) as Record<string, any>
    return {
      selectedNodeId: selectedWorkflowNodeId,
      nodes: (snapshot.nodes ?? []).map((node: any) => ({
        id: node.id,
        type: node.type,
        title: node.title,
        config: node.config,
        inputs: Object.keys(node.inputs ?? {}),
        outputs: Object.keys(node.outputs ?? {}),
      })),
      edges: snapshot.edges ?? [],
    }
  }

  function applyCharacterWorkflowAssistantResult(response: {
    spec?: {
      summary?: string
      plan?: string[]
      confidence?: number
      status?: string
      operations?: Array<Record<string, unknown>>
    }
    uiConfigOverrides?: Record<string, Record<string, unknown>>
  }): boolean {
    let changed = false
    const feedback = {
      nodeIds: new Set<string>(),
      linkIds: new Set<string>(),
      deletedNodeIds: new Set<string>(),
      deletedLinkIds: new Set<string>(),
      nodeActions: new Map<string, string>(),
      linkActions: new Map<string, string>(),
    }
    for (const [nodeId, config] of Object.entries(response.uiConfigOverrides ?? {})) {
      const entries = Object.entries(config).filter(([, value]) => {
        if (Array.isArray(value)) return value.length > 0
        return value !== '' && value !== undefined && value !== null
      })
      if (!entries.length) continue
      characterWorkflowConfigOverrides[nodeId] ??= {}
      Object.assign(characterWorkflowConfigOverrides[nodeId], Object.fromEntries(entries))
      feedback.nodeIds.add(nodeId)
      feedback.nodeActions.set(nodeId, options.getLanguage() === 'zh-CN' ? '编辑' : 'Edited')
      changed = true
    }
    const operations = Array.isArray(response.spec?.operations) ? response.spec.operations : []
    for (const operation of operations) {
      changed = applyCharacterWorkflowAssistantOperation(operation, feedback) || changed
    }
    saveActiveWorkflowProjectSnapshot()
    if (changed) {
      characterResourceViewState.agentHighlights = {
        nodeIds: [...feedback.nodeIds],
        linkIds: [...feedback.linkIds],
        deletedNodeIds: [...feedback.deletedNodeIds],
        deletedLinkIds: [...feedback.deletedLinkIds],
        nodeActions: Object.fromEntries(feedback.nodeActions),
        linkActions: Object.fromEntries(feedback.linkActions),
      }
      const summary = typeof response.spec?.summary === 'string' ? response.spec.summary.trim() : ''
      if (summary) {
        characterWorkflowBuilderStatus = summary
      }
      window.setTimeout(() => {
        if (!characterResourceViewState.agentHighlights) {
          return
        }
        characterResourceViewState.agentHighlights = undefined
        renderCharacterWorkflow()
      }, 1900)
    }
    return changed
  }

  function applyCharacterWorkflowAssistantOperation(
    operation: Record<string, unknown>,
    feedback?: {
      nodeIds: Set<string>
      linkIds: Set<string>
      deletedNodeIds: Set<string>
      deletedLinkIds: Set<string>
      nodeActions: Map<string, string>
      linkActions: Map<string, string>
    }
  ): boolean {
    const zh = options.getLanguage() === 'zh-CN'
    const type = typeof operation.type === 'string' ? operation.type : ''
    if (type === 'add-node') {
      const nodeType = typeof operation.nodeType === 'string' ? operation.nodeType.trim() : ''
      if (!nodeType) return false
      characterResourceDuplicateCount += 1
      const nodeId = typeof operation.nodeId === 'string' && operation.nodeId.trim()
        ? sanitizeWorkflowResourceId(operation.nodeId.trim())
        : `${nodeType}-${Date.now().toString(36)}-${characterResourceDuplicateCount}`
      characterResourceViewState.deletedNodeIds.delete(nodeId)
      if (!characterResourceViewState.addedNodes.some((node) => node.id === nodeId)) {
        characterResourceViewState.addedNodes.push({
          id: nodeId,
          type: nodeType,
          title: typeof operation.title === 'string' && operation.title.trim() ? operation.title.trim() : nodeType,
          x: typeof operation.x === 'number' ? operation.x : 280 + characterResourceDuplicateCount * 24,
          y: typeof operation.y === 'number' ? operation.y : 220 + characterResourceDuplicateCount * 24,
        })
      }
      if (operation.config && typeof operation.config === 'object' && !Array.isArray(operation.config)) {
        characterWorkflowConfigOverrides[nodeId] = {
          ...(characterWorkflowConfigOverrides[nodeId] ?? {}),
          ...(operation.config as Record<string, unknown>),
        }
      }
      selectedWorkflowNodeId = nodeId
      characterResourceViewState.selectedNodeIds = [nodeId]
      feedback?.nodeIds.add(nodeId)
      feedback?.nodeActions.set(nodeId, zh ? '创建' : 'Created')
      return true
    }
    if (type === 'update-node-config') {
      const nodeId = typeof operation.nodeId === 'string' ? operation.nodeId.trim() : ''
      if (!nodeId || !operation.config || typeof operation.config !== 'object' || Array.isArray(operation.config)) return false
      characterWorkflowConfigOverrides[nodeId] = {
        ...(characterWorkflowConfigOverrides[nodeId] ?? {}),
        ...(operation.config as Record<string, unknown>),
      }
      selectedWorkflowNodeId = nodeId
      characterResourceViewState.selectedNodeIds = [nodeId]
      feedback?.nodeIds.add(nodeId)
      feedback?.nodeActions.set(nodeId, zh ? '编辑' : 'Edited')
      return true
    }
    if (type === 'move-node') {
      const nodeId = typeof operation.nodeId === 'string' ? operation.nodeId.trim() : ''
      const x = typeof operation.x === 'number' ? operation.x : Number(operation.x)
      const y = typeof operation.y === 'number' ? operation.y : Number(operation.y)
      if (!nodeId || !Number.isFinite(x) || !Number.isFinite(y)) return false
      characterWorkflowPositionOverrides[nodeId] = { x: Math.round(x), y: Math.round(y) }
      selectedWorkflowNodeId = nodeId
      characterResourceViewState.selectedNodeIds = [nodeId]
      feedback?.nodeIds.add(nodeId)
      feedback?.nodeActions.set(nodeId, zh ? '移动' : 'Moved')
      return true
    }
    if (type === 'resize-node') {
      const nodeId = typeof operation.nodeId === 'string' ? operation.nodeId.trim() : ''
      const width = typeof operation.width === 'number' ? operation.width : Number(operation.width)
      const height = typeof operation.height === 'number' ? operation.height : Number(operation.height)
      if (!nodeId || !Number.isFinite(width) || !Number.isFinite(height)) return false
      characterResourceViewState.nodeSizes ??= {}
      characterResourceViewState.nodeSizes[nodeId] = {
        width: Math.max(190, Math.min(520, Math.round(width))),
        height: Math.max(120, Math.min(720, Math.round(height))),
      }
      selectedWorkflowNodeId = nodeId
      characterResourceViewState.selectedNodeIds = [nodeId]
      feedback?.nodeIds.add(nodeId)
      feedback?.nodeActions.set(nodeId, zh ? '缩放' : 'Resized')
      return true
    }
    if (type === 'select-node') {
      const nodeId = typeof operation.nodeId === 'string' ? operation.nodeId.trim() : ''
      if (!nodeId) return false
      selectedWorkflowNodeId = nodeId
      characterResourceViewState.selectedNodeIds = [nodeId]
      feedback?.nodeIds.add(nodeId)
      feedback?.nodeActions.set(nodeId, zh ? '选择' : 'Selected')
      return true
    }
    if (type === 'set-node-collapsed') {
      const nodeId = typeof operation.nodeId === 'string' ? operation.nodeId.trim() : ''
      if (!nodeId || typeof operation.collapsed !== 'boolean') return false
      const collapsed = new Set(characterResourceViewState.collapsedNodeIds)
      if (operation.collapsed) {
        collapsed.add(nodeId)
      } else {
        collapsed.delete(nodeId)
      }
      characterResourceViewState.collapsedNodeIds = collapsed
      feedback?.nodeIds.add(nodeId)
      feedback?.nodeActions.set(nodeId, operation.collapsed ? (zh ? '折叠' : 'Collapsed') : (zh ? '展开' : 'Expanded'))
      return true
    }
    if (type === 'delete-node') {
      const nodeId = typeof operation.nodeId === 'string' ? operation.nodeId.trim() : ''
      if (!nodeId || nodeId === 'generation-goal') return false
      characterResourceViewState.deletedNodeIds.add(nodeId)
      if (selectedWorkflowNodeId === nodeId) {
        selectedWorkflowNodeId = 'generation-goal'
        characterResourceViewState.selectedNodeIds = ['generation-goal']
      }
      feedback?.deletedNodeIds.add(nodeId)
      return true
    }
    if (type === 'add-link') {
      const sourceNodeId = typeof operation.sourceNodeId === 'string' ? operation.sourceNodeId.trim() : ''
      const sourceSlotId = typeof operation.sourceSlotId === 'string' ? operation.sourceSlotId.trim() : ''
      const targetNodeId = typeof operation.targetNodeId === 'string' ? operation.targetNodeId.trim() : ''
      const targetSlotId = typeof operation.targetSlotId === 'string' ? operation.targetSlotId.trim() : ''
      if (!sourceNodeId || !sourceSlotId || !targetNodeId || !targetSlotId) return false
      const linkId = `${sourceNodeId}:${sourceSlotId}->${targetNodeId}:${targetSlotId}`
      const kind = isSerializedCharacterResourceLinkKind(operation.kind) ? operation.kind : 'guides'
      const link = { id: linkId, sourceNodeId, sourceSlotId, targetNodeId, targetSlotId, kind } satisfies SerializedCharacterResourceLink
      const existingIndex = characterResourceViewState.customLinks.findIndex((item) => item.id === linkId)
      if (existingIndex >= 0) {
        characterResourceViewState.customLinks[existingIndex] = link
      } else {
        characterResourceViewState.customLinks.push(link)
      }
      characterResourceViewState.deletedLinkIds.delete(linkId)
      characterResourceViewState.selectedLinkId = linkId
      characterResourceViewState.selectedNodeIds = []
      feedback?.linkIds.add(linkId)
      feedback?.linkActions.set(linkId, zh ? '连线' : 'Linked')
      return true
    }
    if (type === 'delete-link') {
      const linkId = typeof operation.linkId === 'string' && operation.linkId.trim()
        ? operation.linkId.trim()
        : `${String(operation.sourceNodeId ?? '')}:${String(operation.sourceSlotId ?? '')}->${String(operation.targetNodeId ?? '')}:${String(operation.targetSlotId ?? '')}`
      if (!linkId.includes('->')) return false
      const customIndex = characterResourceViewState.customLinks.findIndex((item) => item.id === linkId)
      if (customIndex >= 0) {
        characterResourceViewState.customLinks.splice(customIndex, 1)
      } else {
        characterResourceViewState.deletedLinkIds.add(linkId)
      }
      if (characterResourceViewState.selectedLinkId === linkId) {
        characterResourceViewState.selectedLinkId = ''
      }
      feedback?.deletedLinkIds.add(linkId)
      return true
    }
    return false
  }

  function openCharacterWorkflowDraft(projectId: string): void {
    saveActiveWorkflowProjectSnapshot()
    const project = characterWorkflowProjects.find((item) => item.id === projectId)
    if (!project) {
      return
    }
    activeCharacterWorkflowProjectId = project.id
    replaceRecord(characterWorkflowConfigOverrides, cloneRecord(project.configOverrides))
    replaceRecord(characterWorkflowPositionOverrides, cloneRecord(project.positionOverrides))
    applyWorkflowProjectViewState(project.viewState)
    characterWorkflowRunCount = project.runCount
    characterWorkflowRunState = project.runs.find((run) => run.id === project.activeRunId)?.runState
      ?? project.runs[project.runs.length - 1]?.runState
      ?? null
    characterWorkflowActiveTabId = 'workflow'
    renderCharacterWorkflow()
  }

  function openCharacterWorkflowRun(projectId: string, runId: string): void {
    saveActiveWorkflowProjectSnapshot()
    const project = characterWorkflowProjects.find((item) => item.id === projectId)
    const run = project?.runs.find((item) => item.id === runId)
    if (!project || !run) {
      return
    }
    activeCharacterWorkflowProjectId = project.id
    project.activeRunId = run.id
    replaceRecord(characterWorkflowConfigOverrides, cloneRecord(project.configOverrides))
    replaceRecord(characterWorkflowPositionOverrides, cloneRecord(project.positionOverrides))
    applyWorkflowProjectViewState(project.viewState)
    characterWorkflowRunCount = project.runCount
    characterWorkflowRunState = JSON.parse(JSON.stringify(run.runState)) as CharacterResourceRunState
    characterWorkflowActiveTabId = 'run-draft'
    renderCharacterWorkflow()
  }

  function duplicateCharacterWorkflowDraft(projectId: string): void {
    saveActiveWorkflowProjectSnapshot()
    const source = characterWorkflowProjects.find((item) => item.id === projectId)
    if (!source) {
      return
    }
    const now = Date.now()
    const copy: CharacterWorkflowProjectRecord = {
      ...JSON.parse(JSON.stringify(source)) as CharacterWorkflowProjectRecord,
      id: `workflow-draft-${now}-${Math.random().toString(16).slice(2)}`,
      name: options.getLanguage() === 'zh-CN' ? `${source.name} 副本` : `${source.name} Copy`,
      createdAt: now,
      updatedAt: now,
    }
    characterWorkflowProjects = [copy, ...characterWorkflowProjects]
    openCharacterWorkflowDraft(copy.id)
  }

  function renameCharacterWorkflowDraft(projectId: string): void {
    const project = characterWorkflowProjects.find((item) => item.id === projectId)
    if (!project) {
      return
    }
    const nextName = window.prompt(options.getLanguage() === 'zh-CN' ? '重命名角色草稿' : 'Rename character draft', project.name)?.trim()
    if (!nextName) {
      return
    }
    project.name = nextName
    project.updatedAt = Date.now()
    renderCharacterWorkflow()
  }

  function deleteCharacterWorkflowDraft(projectId: string): void {
    const project = characterWorkflowProjects.find((item) => item.id === projectId)
    if (!project) {
      return
    }
    const ok = window.confirm(options.getLanguage() === 'zh-CN' ? `删除“${project.name}”？` : `Delete "${project.name}"?`)
    if (!ok) {
      return
    }
    characterWorkflowProjects = characterWorkflowProjects.filter((item) => item.id !== projectId)
    if (activeCharacterWorkflowProjectId === projectId) {
      activeCharacterWorkflowProjectId = characterWorkflowProjects[0]?.id ?? ''
      const next = characterWorkflowProjects.find((item) => item.id === activeCharacterWorkflowProjectId)
      if (next) {
        replaceRecord(characterWorkflowConfigOverrides, cloneRecord(next.configOverrides))
        replaceRecord(characterWorkflowPositionOverrides, cloneRecord(next.positionOverrides))
        applyWorkflowProjectViewState(next.viewState)
        characterWorkflowRunCount = next.runCount
        characterWorkflowRunState = next.runs.find((run) => run.id === next.activeRunId)?.runState
          ?? next.runs[next.runs.length - 1]?.runState
          ?? null
      } else {
        replaceRecord(characterWorkflowConfigOverrides, {})
        replaceRecord(characterWorkflowPositionOverrides, {})
        applyWorkflowProjectViewState(undefined)
        characterWorkflowRunCount = 0
        characterWorkflowRunState = null
      }
    }
    characterWorkflowActiveTabId = 'workflow'
    renderCharacterWorkflow()
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

  function createPersistedCharacterWorkflowState(): PersistedCharacterWorkflowState {
    saveActiveWorkflowProjectSnapshot()
    return {
      activeWorkflowId: activeCharacterWorkflowProjectId,
      workflows: JSON.parse(JSON.stringify(characterWorkflowProjects)) as CharacterWorkflowProjectRecord[],
      activeTabId: characterWorkflowActiveTabId,
      editorState: {
        activePanel: characterWorkflowEditorState.activePanel,
        sidebarCollapsed: characterWorkflowEditorState.sidebarCollapsed,
        inspectorCollapsed: characterWorkflowEditorState.inspectorCollapsed,
        nodeSearchOpen: false,
        workflowLibraryWidth: characterWorkflowEditorState.workflowLibraryWidth,
        workflowLibraryCollapsed: characterWorkflowEditorState.workflowLibraryCollapsed,
      },
    }
  }

  function persistActiveConversationWorkflowState(): void {
    if (characterWorkflowPersistTimer !== undefined) {
      window.clearTimeout(characterWorkflowPersistTimer)
      characterWorkflowPersistTimer = undefined
    }
    const conversation = getActiveMutableConversation()
    if (!conversation) {
      return
    }
    conversation.characterWorkflow = createPersistedCharacterWorkflowState()
    void persistConversation(conversation)
  }

  function scheduleActiveConversationWorkflowPersist(): void {
    const conversation = getActiveMutableConversation()
    if (!conversation) {
      return
    }
    conversation.characterWorkflow = createPersistedCharacterWorkflowState()
    if (characterWorkflowPersistTimer !== undefined) {
      window.clearTimeout(characterWorkflowPersistTimer)
    }
    characterWorkflowPersistTimer = window.setTimeout(() => {
      characterWorkflowPersistTimer = undefined
      persistActiveConversationWorkflowState()
    }, 450)
  }

  function restoreCharacterWorkflowStateFromConversation(conversation: ChatConversationSummary | undefined): void {
    const persisted = conversation?.characterWorkflow
    if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) {
      activeCharacterWorkflowProjectId = ''
      characterWorkflowProjects = []
      characterWorkflowRunState = null
      characterWorkflowRunCount = 0
      characterWorkflowActiveTabId = 'workflow'
      characterWorkflowEditorState.activePanel = 'workflow'
      characterWorkflowEditorState.sidebarCollapsed = false
      characterWorkflowEditorState.inspectorCollapsed = false
      characterWorkflowEditorState.nodeSearchOpen = false
      characterWorkflowEditorState.workflowLibraryWidth = CHARACTER_WORKFLOW_LIBRARY_DEFAULT_WIDTH
      characterWorkflowEditorState.workflowLibraryCollapsed = false
      replaceRecord(characterWorkflowConfigOverrides, {})
      replaceRecord(characterWorkflowPositionOverrides, {})
      applyWorkflowProjectViewState(undefined)
      return
    }
    const record = persisted as Partial<PersistedCharacterWorkflowState>
    characterWorkflowProjects = Array.isArray(record.workflows)
      ? JSON.parse(JSON.stringify(record.workflows)) as CharacterWorkflowProjectRecord[]
      : []
    activeCharacterWorkflowProjectId = typeof record.activeWorkflowId === 'string' ? record.activeWorkflowId : characterWorkflowProjects[0]?.id ?? ''
    const activeProject = characterWorkflowProjects.find((project) => project.id === activeCharacterWorkflowProjectId)
    if (activeProject) {
      replaceRecord(characterWorkflowConfigOverrides, cloneRecord(activeProject.configOverrides ?? {}))
      replaceRecord(characterWorkflowPositionOverrides, cloneRecord(activeProject.positionOverrides ?? {}))
      applyWorkflowProjectViewState(activeProject.viewState)
      characterWorkflowRunCount = Math.max(0, Math.round(Number(activeProject.runCount) || 0))
      characterWorkflowRunState = activeProject.runs.find((run) => run.id === activeProject.activeRunId)?.runState
        ?? activeProject.runs[activeProject.runs.length - 1]?.runState
        ?? null
    } else {
      replaceRecord(characterWorkflowConfigOverrides, {})
      replaceRecord(characterWorkflowPositionOverrides, {})
      applyWorkflowProjectViewState(undefined)
      characterWorkflowRunCount = 0
      characterWorkflowRunState = null
    }
    characterWorkflowActiveTabId = typeof record.activeTabId === 'string'
      ? record.activeTabId
      : characterWorkflowRunState?.run?.id ?? 'workflow'
    if (characterWorkflowActiveTabId === characterWorkflowRunState?.run?.id) {
      characterWorkflowActiveTabId = 'run-draft'
    }
    if (record.editorState && typeof record.editorState === 'object') {
      characterWorkflowEditorState.activePanel = record.editorState.activePanel === 'assets' || record.editorState.activePanel === 'nodes'
        ? record.editorState.activePanel
        : 'workflow'
      characterWorkflowEditorState.sidebarCollapsed = Boolean(record.editorState.sidebarCollapsed)
      characterWorkflowEditorState.inspectorCollapsed = Boolean(record.editorState.inspectorCollapsed)
      characterWorkflowEditorState.nodeSearchOpen = false
      characterWorkflowEditorState.workflowLibraryWidth = clampCharacterWorkflowLibraryWidth(record.editorState.workflowLibraryWidth)
      characterWorkflowEditorState.workflowLibraryCollapsed = Boolean(record.editorState.workflowLibraryCollapsed)
    }
    if (characterWorkflowActiveTabId !== 'workflow' && characterWorkflowActiveTabId !== 'run-draft') {
      characterWorkflowActiveTabId = characterWorkflowRunState ? 'run-draft' : 'workflow'
    }
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
          const currentStepId = characterWorkflowRunState.run.currentStepId
          characterWorkflowRunState.run.status = 'idle'
          if (currentStepId) {
            characterWorkflowRunState.steps = characterWorkflowRunState.steps?.map((step) => (
              step.id === currentStepId
                ? {
                    ...step,
                    status: 'failed',
                    detail: options.getLanguage() === 'zh-CN' ? '已手动停止。' : 'Stopped manually.',
                  }
                : step
            ))
          }
          renderCharacterWorkflow()
        }
        showToast(options.getLanguage() === 'zh-CN' ? '已停止 Agent 运行' : 'Stopped agent run')
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
    }
    characterWorkflowRunCount += 1
    const draftRunState = workflowPage.createDraftCharacterResourceRunState(characterWorkflowRunCount, 'running', options.getLanguage())
    characterWorkflowRunState = draftRunState
    characterWorkflowActiveTabId = 'run-draft'
    characterWorkflowEditorState.inspectorCollapsed = false
    const updateRunStep = (
      stepId: string,
      status: NonNullable<CharacterResourceRunState['steps']>[number]['status'],
      detail?: string
    ) => {
      if (!characterWorkflowRunState) {
        return
      }
      const steps = characterWorkflowRunState.steps?.length
        ? characterWorkflowRunState.steps
        : workflowPage.createCharacterResourceRunSteps(options.getLanguage())
      const targetIndex = steps.findIndex((step) => step.id === stepId)
      characterWorkflowRunState.steps = steps.map((step, index) => {
        if (index < targetIndex && step.status !== 'failed') {
          return { ...step, status: 'done' }
        }
        if (step.id === stepId) {
          return { ...step, status, ...(detail ? { detail } : {}) }
        }
        return step
      })
      if (characterWorkflowRunState.run) {
        characterWorkflowRunState.run.currentStepId = stepId
      }
      renderCharacterWorkflow()
    }
    updateRunStep('snapshot', 'running')
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
      updateRunStep('dispatch', 'running')
      updateRunStep('agent', 'running')
      const response = typeof window.electronAPI.streamCharacterWorkflow === 'function'
        ? await window.electronAPI.streamCharacterWorkflow({ workflow, language: options.getLanguage() }, {
            onEvent: (event) => applyCharacterWorkflowAgentEvent(event),
          })
        : await window.electronAPI.runCharacterWorkflow({ workflow, language: options.getLanguage() })
      if (!response.success) {
        throw new Error(response.error || 'Character workflow failed')
      }
      updateRunStep('collect', 'running')
      characterWorkflowRunState = {
        run: {
          id: response.runId || draftRunState.run?.id || `resource-run-${Date.now()}`,
          title: draftRunState.run?.title || 'Resource Draft.run',
          status: 'done',
          currentStepId: 'finish',
        },
        steps: (characterWorkflowRunState?.steps ?? workflowPage.createCharacterResourceRunSteps(options.getLanguage())).map((step) => ({
          ...step,
          status: 'done',
        })),
        events: characterWorkflowRunState?.events ?? [],
        artifacts: (response.artifacts ?? []).map((artifact) => ({
          id: artifact.id,
          type: artifact.kind,
          sourceNodeId: artifact.sourceNodeId || 'agent-policy',
          title: artifact.title,
          summary: artifact.summary,
          data: artifact.data,
        })),
      }
      characterWorkflowActiveTabId = 'run-draft'
      renderCharacterWorkflow()
      showToast(options.getLanguage() === 'zh-CN' ? '角色资源生成完成' : 'Character resources generated')
    } catch (error) {
      console.warn('[CharacterResourceGraph] Failed to run agent lifecycle:', error)
      if (renderToken === characterWorkflowRenderToken) {
        characterWorkflowRunState = draftRunState.run
          ? {
              ...draftRunState,
              run: { ...draftRunState.run, status: 'failed' },
              steps: (characterWorkflowRunState?.steps ?? draftRunState.steps ?? workflowPage.createCharacterResourceRunSteps(options.getLanguage())).map((step) => (
                step.id === (characterWorkflowRunState?.run?.currentStepId ?? draftRunState.run?.currentStepId)
                  ? { ...step, status: 'failed' }
                  : step
              )),
            }
          : draftRunState
        renderCharacterWorkflow()
        showToast(error instanceof Error ? error.message : (options.getLanguage() === 'zh-CN' ? '角色资源生成失败' : 'Character resource generation failed'))
      }
    }
  }

  function applyCharacterWorkflowAgentEvent(event: Record<string, unknown>): void {
    if (!characterWorkflowRunState) {
      return
    }
    const type = typeof event.type === 'string' ? event.type : 'agent.event'
    const timestamp = typeof event.timestamp === 'number' ? event.timestamp : Date.now()
    const phase = typeof event.phase === 'string' ? event.phase : undefined
    const artifact = event.artifact && typeof event.artifact === 'object'
      ? event.artifact as Record<string, any>
      : undefined
    const record = event.record && typeof event.record === 'object'
      ? event.record as Record<string, any>
      : undefined
    const result = event.result && typeof event.result === 'object'
      ? event.result as Record<string, any>
      : undefined
    const toolName = typeof event.toolName === 'string'
      ? event.toolName
      : typeof record?.toolName === 'string'
        ? record.toolName
        : undefined
    characterWorkflowRunState.events = [
      ...(characterWorkflowRunState.events ?? []),
      {
        type,
        timestamp,
        phase,
        toolName,
        title: typeof artifact?.title === 'string' ? artifact.title : undefined,
        summary: typeof artifact?.summary === 'string'
          ? artifact.summary
          : typeof result?.summary === 'string'
            ? result.summary
            : undefined,
        status: type === 'run.failed'
          ? 'failed'
          : type === 'tool.call.started' || type === 'run.phase.changed'
            ? 'running'
            : 'done',
        artifact: artifact
          ? {
              id: typeof artifact.id === 'string' ? artifact.id : undefined,
              kind: typeof artifact.kind === 'string' ? artifact.kind : undefined,
              title: typeof artifact.title === 'string' ? artifact.title : undefined,
              summary: typeof artifact.summary === 'string' ? artifact.summary : undefined,
              sourceNodeId: typeof artifact.sourceNodeId === 'string' ? artifact.sourceNodeId : undefined,
              data: artifact.data,
            }
          : undefined,
        raw: event,
      },
    ]
    if (phase) {
      const stepId = phaseToRunStepId(phase)
      if (stepId) {
        characterWorkflowRunState.run!.currentStepId = stepId
        characterWorkflowRunState.steps = (characterWorkflowRunState.steps ?? []).map((step) => {
          if (step.id === stepId) {
            return { ...step, status: type === 'run.failed' ? 'failed' : 'running' }
          }
          return step
        })
      }
    }
    if (artifact) {
      const artifactId = typeof artifact.id === 'string' ? artifact.id : ''
      const existing = characterWorkflowRunState.artifacts ?? []
      if (!artifactId || !existing.some((item) => item.id === artifactId)) {
        characterWorkflowRunState.artifacts = [
          ...existing,
          {
            id: artifactId,
            type: typeof artifact.kind === 'string' ? artifact.kind : 'artifact',
            sourceNodeId: typeof artifact.sourceNodeId === 'string' ? artifact.sourceNodeId : 'agent-policy',
            title: typeof artifact.title === 'string' ? artifact.title : undefined,
            summary: typeof artifact.summary === 'string' ? artifact.summary : undefined,
            data: artifact.data,
          },
        ]
      }
    }
    renderCharacterWorkflow()
  }

  function phaseToRunStepId(phase: string): string {
    if (phase === 'interpret' || phase === 'plan') {
      return 'dispatch'
    }
    if (phase === 'produce' || phase === 'inspect' || phase === 'repair') {
      return 'agent'
    }
    if (phase === 'package' || phase === 'report') {
      return 'collect'
    }
    if (phase === 'completed') {
      return 'finish'
    }
    return ''
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
    const normalizedTabId = tabId === characterWorkflowRunState?.run?.id ? 'run-draft' : tabId
    if (normalizedTabId !== 'workflow' && normalizedTabId !== 'run-draft') {
      return
    }
    characterWorkflowActiveTabId = normalizedTabId
    renderCharacterWorkflow()
  }

  function selectWorkflowNode(nodeId: string, additive = false): void {
    if (!nodeId) {
      return
    }
    selectedWorkflowNodeId = nodeId
    characterResourceViewState.selectedLinkId = ''
    characterWorkflowEditorState.inspectorCollapsed = false
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

  function sanitizeWorkflowResourceId(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || `node-${Date.now().toString(36)}`
  }

  function isSerializedCharacterResourceLinkKind(value: unknown): value is SerializedCharacterResourceLinkKind {
    return typeof value === 'string' && [
      'guides',
      'constrains',
      'provides',
      'enables',
      'grounds',
      'weights',
      'routes',
      'evaluates',
      'refines',
      'exports',
    ].includes(value)
  }

  function allowsMultipleCharacterResourceIncomingLinks(inputType: string, inputSlotId: string): boolean {
    if (inputType === 'style-signal' || inputType === 'hard-constraint') {
      return true
    }
    if (inputType !== 'asset-target') {
      return false
    }
    return [
      'target',
      'imageTarget',
      'fieldTarget',
      'imageControl',
      'fieldControl',
      'continuity',
      'relationship',
      'style',
      'constraint',
    ].includes(inputSlotId)
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
    const multiInput = allowsMultipleCharacterResourceIncomingLinks(input.type, input.slotId)
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
    characterResourceViewState.deletedLinkIds.delete(linkId)
    if (!multiInput) {
      characterResourceViewState.replacedTargetSlots.add(targetKey)
    }
    const existingIndex = characterResourceViewState.customLinks.findIndex((linkItem) => (
      multiInput ? linkItem.id === linkId : getCharacterResourceTargetSlotKey(linkItem) === targetKey
    ))
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
      saveActiveWorkflowProjectSnapshot()
      activeCharacterWorkflowProjectId = ''
      characterWorkflowRunState = null
      characterWorkflowRunCount = 0
      characterWorkflowActiveTabId = 'workflow'
      replaceRecord(characterWorkflowConfigOverrides, {})
      replaceRecord(characterWorkflowPositionOverrides, {})
      applyWorkflowProjectViewState(undefined)
      renderCharacterWorkflow()
      return
    }
    if (tabId === characterWorkflowRunState?.run.id) {
      characterWorkflowRunState = null
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

  function beginCharacterWorkflowLibraryResize(event: PointerEvent): void {
    const handle = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-chat-workflow-library-resize]')
    if (!handle || !panel.contains(handle) || event.button !== 0 || characterWorkflowEditorState.workflowLibraryCollapsed) {
      return
    }
    characterWorkflowLibraryResize = {
      pointerId: event.pointerId,
      startX: event.clientX,
      originWidth: clampCharacterWorkflowLibraryWidth(characterWorkflowEditorState.workflowLibraryWidth),
    }
    handle.setPointerCapture?.(event.pointerId)
    handle.classList.add('is-resizing')
    document.body.classList.add('chat-workflow-library-resizing')
    event.preventDefault()
    event.stopPropagation()
  }

  function updateCharacterWorkflowLibraryResize(event: PointerEvent): void {
    if (!characterWorkflowLibraryResize || characterWorkflowLibraryResize.pointerId !== event.pointerId) {
      return
    }
    const nextWidth = clampCharacterWorkflowLibraryWidth(characterWorkflowLibraryResize.originWidth + event.clientX - characterWorkflowLibraryResize.startX)
    characterWorkflowEditorState.workflowLibraryWidth = nextWidth
    characterWorkflowEditorState.workflowLibraryCollapsed = false
    const shell = panel.querySelector<HTMLElement>('.chat-workflow-library-shell')
    shell?.style.setProperty('--workflow-library-width', `${nextWidth}px`)
  }

  function endCharacterWorkflowLibraryResize(event: PointerEvent): void {
    if (!characterWorkflowLibraryResize || characterWorkflowLibraryResize.pointerId !== event.pointerId) {
      return
    }
    panel.querySelector<HTMLElement>('[data-chat-workflow-library-resize]')?.classList.remove('is-resizing')
    document.body.classList.remove('chat-workflow-library-resizing')
    characterWorkflowLibraryResize = null
    scheduleActiveConversationWorkflowPersist()
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
    renderChatRuntimeModelPicker()
    refreshCharacterWorkflowModelsIfVisible()
    await saveChatModelConfig()
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

  function toggleChatApiKeyVisibility(id: string): void {
    if (!id) {
      return
    }
    if (visibleChatApiKeys.has(id)) {
      visibleChatApiKeys.delete(id)
    } else {
      visibleChatApiKeys.add(id)
    }
    renderChatModelConfig()
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
    visibleChatApiKeys.delete(id)
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

  panel.addEventListener('submit', (event) => {
    const assistantForm = (event.target as HTMLElement | null)?.closest<HTMLFormElement>('[data-chat-workflow-assistant-form]')
    if (assistantForm && panel.contains(assistantForm)) {
      event.preventDefault()
      void applyCharacterWorkflowAssistantPrompt()
      return
    }
    const form = (event.target as HTMLElement | null)?.closest<HTMLFormElement>('[data-chat-workflow-builder-form]')
    if (!form || !panel.contains(form)) {
      return
    }
    event.preventDefault()
    void buildCharacterWorkflowFromPrompt()
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

    const workflowAssistantStatusAction = eventTarget.closest<HTMLElement>('[data-chat-workflow-assistant-status-action]')
    if (workflowAssistantStatusAction && panel.contains(workflowAssistantStatusAction)) {
      const action = workflowAssistantStatusAction.dataset.chatWorkflowAssistantStatusAction || ''
      if (action === 'toggle') {
        characterWorkflowAssistantStatusExpanded = !characterWorkflowAssistantStatusExpanded
        renderCharacterWorkflow()
      } else if (action === 'copy') {
        void navigator.clipboard.writeText(characterWorkflowBuilderStatus).then(
          () => showToast(options.getLanguage() === 'zh-CN' ? '已复制 Agent 信息' : 'Agent message copied'),
          (error: unknown) => showToast(error instanceof Error ? error.message : String(error))
        )
      }
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
      if (modelId && modelAction.dataset.chatModelAction === 'toggle-api-key') {
        toggleChatApiKeyVisibility(modelId)
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

    const workflowLibraryAction = eventTarget.closest<HTMLElement>('[data-chat-workflow-library-action]')
    if (workflowLibraryAction && panel.contains(workflowLibraryAction)) {
      const action = workflowLibraryAction.dataset.chatWorkflowLibraryAction || ''
      const workflowId = workflowLibraryAction.dataset.chatWorkflowId || ''
      if (action === 'create-menu') {
        characterWorkflowTemplateMenuOpen = !characterWorkflowTemplateMenuOpen
        renderCharacterWorkflow()
      } else if (action === 'toggle-width') {
        toggleCharacterWorkflowLibraryCollapsed()
      } else if (action === 'create') {
        createCharacterWorkflowDraft()
      } else if (action === 'create-template') {
        createCharacterWorkflowDraftFromTemplate(workflowLibraryAction.dataset.chatWorkflowTemplateId || '')
      } else if (action === 'rename') {
        renameCharacterWorkflowDraft(workflowId)
      } else if (action === 'duplicate') {
        duplicateCharacterWorkflowDraft(workflowId)
      } else if (action === 'delete') {
        deleteCharacterWorkflowDraft(workflowId)
      }
      return
    }

    const workflowOpen = eventTarget.closest<HTMLElement>('[data-chat-workflow-open]')
    if (workflowOpen && panel.contains(workflowOpen)) {
      openCharacterWorkflowDraft(workflowOpen.dataset.chatWorkflowOpen || '')
      return
    }

    const workflowRunOpen = eventTarget.closest<HTMLElement>('[data-chat-workflow-run-open]')
    if (workflowRunOpen && panel.contains(workflowRunOpen)) {
      const [workflowId, runId] = (workflowRunOpen.dataset.chatWorkflowRunOpen || '').split(':')
      openCharacterWorkflowRun(workflowId || '', runId || '')
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
      const nodeId = workflowNodeSelect.dataset.chatWorkflowNodeSelect || ''
      const editingSelectedNode = Boolean(eventTarget.closest('[data-chat-workflow-param]'))
        && characterResourceViewState.selectedNodeIds.includes(nodeId)
      if (!editingSelectedNode) {
        selectWorkflowNode(nodeId, event.metaKey || event.ctrlKey || event.shiftKey)
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
    const workflowAssistantInput = (event.target as HTMLElement | null)?.closest<HTMLTextAreaElement>('[data-chat-workflow-assistant-input]')
    if (workflowAssistantInput && panel.contains(workflowAssistantInput)) {
      characterWorkflowAssistantPrompt = workflowAssistantInput.value
      return
    }
    const workflowBuilderInput = (event.target as HTMLElement | null)?.closest<HTMLTextAreaElement>('[data-chat-workflow-builder-input]')
    if (workflowBuilderInput && panel.contains(workflowBuilderInput)) {
      characterWorkflowBuilderPrompt = workflowBuilderInput.value
      return
    }
    const workflowLibrarySearch = (event.target as HTMLElement | null)?.closest<HTMLInputElement>('[data-chat-workflow-library-search]')
    if (workflowLibrarySearch && panel.contains(workflowLibrarySearch)) {
      characterWorkflowLibrarySearch = workflowLibrarySearch.value
      renderCharacterWorkflow()
      return
    }
    const settingsControl = (event.target as HTMLElement | null)?.closest<HTMLInputElement>('[data-chat-setting]')
    if (!settingsControl || !panel.contains(settingsControl)) {
      return
    }
    updateConversationSetting(settingsControl)
  })

  panel.addEventListener('pointerdown', beginChatResize)
  panel.addEventListener('pointerdown', beginCharacterWorkflowLibraryResize)
  panel.addEventListener('pointerdown', beginCharacterResourceNodeResize)
  panel.addEventListener('pointerdown', beginCharacterWorkflowNodeDrag)
  panel.addEventListener('pointerdown', beginCharacterResourceViewportDrag)
  panel.addEventListener('pointerdown', beginCharacterResourceMinimapPointer)
  panel.addEventListener('wheel', updateCharacterResourceViewportZoom, { passive: false })
  panel.addEventListener('pointerdown', beginManualDrag)
  window.addEventListener('pointermove', updateChatResize)
  window.addEventListener('pointermove', updateCharacterWorkflowLibraryResize)
  window.addEventListener('pointermove', updateCharacterResourceNodeResize)
  window.addEventListener('pointermove', updateCharacterWorkflowNodeDrag)
  window.addEventListener('pointermove', updateCharacterResourceViewportDrag)
  window.addEventListener('pointermove', updateManualDrag)
  window.addEventListener('pointerup', endChatResize)
  window.addEventListener('pointerup', endCharacterWorkflowLibraryResize)
  window.addEventListener('pointerup', endCharacterResourceNodeResize)
  window.addEventListener('pointerup', endCharacterWorkflowNodeDrag)
  window.addEventListener('pointerup', endCharacterResourceViewportDrag)
  window.addEventListener('pointerup', endManualDrag)
  window.addEventListener('pointercancel', endChatResize)
  window.addEventListener('pointercancel', endCharacterWorkflowLibraryResize)
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
      restoreCharacterWorkflowStateFromConversation(getActiveConversation(state))
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
      workflowState: conversation.characterWorkflow ?? createPersistedCharacterWorkflowState(),
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
