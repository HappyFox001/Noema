/**
 * Owns the standalone chat surface interactions and window mode transitions.
 */
import { getImageProviderCatalogEntry, getLLMProviderCatalogEntry, getTTSProviderCatalogEntry } from '../../main/model-provider-catalog'
import {
  applyChatRuntimeTurnResult,
  buildChatRuntimeTurnRequest,
  decideRoleplayMediaDispatch,
  extractRoleplayMediaIntent,
  getChatMessageOrdinal,
  summarizeChatConversationOverflow,
  stripChatSceneUpdateMarkup,
  trimChatSummaries,
  type RoleplayMediaIntent,
} from '@noema/sdk/chat/conversation-runtime'
import {
  CHAT_MEDIA_IMAGE_COOLDOWN_MAX,
  CHAT_MEDIA_IMAGE_COOLDOWN_MIN,
  CHAT_MEDIA_IMAGE_PROBABILITY_MAX,
  CHAT_MEDIA_IMAGE_PROBABILITY_MIN,
  CHAT_CONTEXT_TURNS_MAX,
  CHAT_CONTEXT_TURNS_MIN,
  CHAT_OUTPUT_TOKEN_MAX,
  CHAT_OUTPUT_TOKEN_MIN,
  CHAT_SUMMARY_BATCH_MESSAGE_COUNT,
  CHAT_SUMMARY_LIMIT_MAX,
  CHAT_SUMMARY_LIMIT_MIN,
  buildConversationPreferencePrompt,
  buildConversationMediaPolicy,
  buildConversationRequestOptions,
  clampNumber,
  getDefaultConversationSettings,
  loadConversationSettings,
  renderConversationSettingsPage,
  saveConversationSettings,
  type ConversationSettingsModelOption,
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
  hydrateChatConversationDetail,
  hydrateChatConversationWorkflowState,
  loadChatResourceState,
  localizeChatText,
  type ChatConversationSummary,
  type ChatCharacterResource,
  type ChatLocalizedText,
  type ChatMemorySummary,
  type ChatMessageMedia,
  type ChatMessage,
  type ChatOpeningPanel,
} from './chat-model'
import {
  createDefaultChatModel,
  getActiveChatModelName,
  getAvailableModelNames,
  getChatProviderEntry,
  getChatModelType,
  getEnabledModelNames,
  getLLMProviderEntry,
  getLocalLLMTransport,
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

type PendingChatMedia = ChatMessageMedia
type CharacterWorkflowPageModule = typeof import('./chat-character-workflow-page')
type CharacterWorkflowTemplateId = 'character-card'

interface ChatTTSModelConfig {
  id: string
  provider: string
  modelName: string
  apiKey: string
  voiceId?: string
  baseUrl?: string
  language?: string
  format?: 'pcm' | 'mp3' | 'opus'
  sampleRate?: number
  extra?: Record<string, unknown>
}

interface ChatImageModelChoice {
  ref: string
  api: ChatModelConfig
  modelName: string
  providerLabel: string
}

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
  schemaVersion?: number
  createdAt: number
  updatedAt: number
  loadState?: 'index' | 'loading-detail' | 'ready-overview' | 'ready' | 'error'
  configOverrides: Record<string, Record<string, unknown>>
  positionOverrides: Record<string, { x: number; y: number }>
  viewState: CharacterWorkflowProjectViewState
  runCount: number
  activeRunId?: string
  runs: CharacterWorkflowProjectRunRecord[]
  goalSession?: CharacterWorkflowGoalSession
}

interface CharacterWorkflowGoalSession {
  objective: string
  plan: string[]
  completedSteps: string[]
  currentStep?: string
  nextStep?: string
  status: 'active' | 'paused' | 'needs-user' | 'blocked' | 'complete'
  pendingDecision?: CharacterWorkflowAgentDecision
  history: Array<{
    id?: string
    stepIndex?: number
    tool?: string
    userRequest: string
    summary: string
    status: string
    operations: number
    currentStep?: string
    nextStep?: string
    createdAt: number
  }>
  updatedAt: number
}

interface CharacterWorkflowAgentDecision {
  id: string
  title: string
  description?: string
  options: CharacterWorkflowAgentDecisionOption[]
  defaultOptionId?: string
  allowSkip?: boolean
}

interface CharacterWorkflowAgentDecisionOption {
  id: string
  label: string
  detail?: string
  patchHint?: string
}

interface CharacterWorkflowProjectRunRecord {
  id: string
  title: string
  status: NonNullable<CharacterResourceRunState['run']>['status']
  createdAt: number
  completedAt?: number
  runState: CharacterResourceRunState
}

type CharacterWorkflowScopedRunAction = 'retry' | 'reroll' | 'resume' | 'repair'

interface CharacterWorkflowScopedRunRequest {
  instruction?: string
  action: CharacterWorkflowScopedRunAction
  scope: {
    targetNodeIds?: string[]
    requirementIds?: string[]
    artifactIds?: string[]
    parentAttemptId?: string
  }
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
  sourceAccepts?: string
  targetNodeId: string
  targetSlotId: string
  targetSide: string
  targetType: string
  targetAccepts?: string
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
  let chatTTSModels: ChatTTSModelConfig[] = []
  let openChatModelLibraryId = ''
  let chatModelLibrarySearch = ''
  let openChatProviderDropdownId = ''
  let openChatRuntimeModelPicker = false
  let openChatModelTypePicker = false
  let activeChatRuntimeProvider = ''
  let pendingMedia: PendingChatMedia[] = []
  let cameraStream: MediaStream | null = null
  let cameraOverlay: HTMLElement | null = null
  const chatModelOptions = new Map<string, string[]>()
  const chatModelLoading = new Set<string>()
  const visibleChatApiKeys = new Set<string>()
  let conversationSettings = loadConversationSettings()
  let sceneStateCollapsed = false
  let chatResourcesHydrated = false
  let chatResourcesHydratePromise: Promise<void> | null = null
  let chatModelConfigLoadPromise: Promise<void> | null = null
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
  let characterWorkflowAssistantStatusExpanded = false
  let characterWorkflowBuilderBusy = false
  let characterWorkflowAssistantRunToken = 0
  let characterWorkflowAssistantActiveRunToken = 0
  const characterWorkflowAssistantInterruptedRuns = new Set<number>()
  let characterWorkflowTemplateMenuOpen = false
  let characterWorkflowRunState: CharacterResourceRunState | null = null
  let characterWorkflowExecutingProjectId = ''
  let characterWorkflowExecutingRunState: CharacterResourceRunState | null = null
  let characterWorkflowRunOpenToken = 0
  let characterWorkflowRunCount = 0
  let characterWorkflowActiveTabId = 'workflow'
  let characterWorkflowContentLoaded = false
  let characterWorkflowProjectsHydrated = false
  let characterWorkflowProjectsHydratePromise: Promise<void> | null = null
  const characterWorkflowProjectDetailPromises = new Map<string, Promise<CharacterWorkflowProjectRecord | null>>()
  const characterWorkflowProjectPersistTimers = new Map<string, number>()
  const characterWorkflowPerfMarks = new Map<string, { label: string; startedAt: number; lastAt: number }>()
  let activeCharacterWorkflowPerfId = ''
  let characterWorkflowDirty = false
  let characterWorkflowPersistTimer: number | undefined
  let characterWorkflowRunRenderFrame: number | undefined
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
  attachmentTray.setAttribute('aria-label', 'Selected media')
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
      void ensureChatModelConfigLoaded()
    }
    if (button.dataset.chatNav === 'character-workflow') {
      characterWorkflowContentLoaded = true
      renderCharacterWorkflow()
      void ensureCharacterWorkflowProjectsHydrated()
        .then(() => renderCharacterWorkflow())
      void ensureChatModelConfigLoaded()
      void ensureChatResourcesHydrated()
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

  function upsertConversationCharacterResource(conversation: ChatConversationSummary): void {
    const resource = conversation.characterResource
    if (!resource) {
      return
    }
    const existingIndex = state.characterResources.findIndex((item) => item.id === resource.id)
    if (existingIndex >= 0) {
      state.characterResources[existingIndex] = resource
    } else {
      state.characterResources = [resource, ...state.characterResources]
    }
  }

  async function setActiveConversation(conversationId: string): Promise<void> {
    const conversationIndex = state.conversations.findIndex((conversation) => conversation.id === conversationId)
    if (conversationIndex < 0) {
      return
    }
    state.activeConversationId = conversationId
    const selectedConversation = state.conversations[conversationIndex]
    if (selectedConversation.messages.length === 0) {
      try {
        state.conversations[conversationIndex] = await hydrateChatConversationDetail(selectedConversation, state.characterResources)
        upsertConversationCharacterResource(state.conversations[conversationIndex])
      } catch (error) {
        console.warn('[ChatHistory] Failed to hydrate conversation:', error)
        showToast(options.getLanguage() === 'zh-CN' ? '对话详情加载失败' : 'Failed to load conversation')
      }
    }
    restoreCharacterWorkflowStateFromConversation(getActiveConversation(state))
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
        void createChatConversation()
        break
      case 'add-chat-model':
        openChatModelTypePicker = !openChatModelTypePicker
        openChatModelLibraryId = ''
        chatModelLibrarySearch = ''
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
      if (response.canceled || !response.media?.length) {
        return
      }
      addPendingMedia(response.media.map(toPendingMedia))
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
    addPendingMedia([{
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

  function addPendingMedia(media: PendingChatMedia[]): void {
    pendingMedia = [...pendingMedia, ...media].slice(0, 8)
    renderPendingMedia()
    options.composeInput.focus()
  }

  function renderPendingMedia(): void {
    attachmentTray.classList.toggle('visible', pendingMedia.length > 0)
    attachmentTray.innerHTML = pendingMedia.map((item) => `
      <div class="chat-attachment-chip" data-chat-media-id="${options.escapeHtml(item.id)}">
        ${renderPendingMediaPreview(item)}
        <span>${options.escapeHtml(item.name)}</span>
        <button type="button" aria-label="Remove media" data-chat-media-remove="${options.escapeHtml(item.id)}">×</button>
      </div>
    `).join('')
  }

  function renderPendingMediaPreview(item: PendingChatMedia): string {
    const source = options.escapeHtml(item.dataUrl || item.url || '')
    if (item.kind === 'video') {
      return `<video src="${source}" muted preload="metadata"></video>`
    }
    if (item.kind === 'audio') {
      return `<span class="chat-attachment-audio-thumb">AUDIO</span>`
    }
    return `<img src="${source}" alt="${options.escapeHtml(item.name)}" />`
  }

  function toPendingMedia(item: Omit<PendingChatMedia, 'id'> & { id?: string }): PendingChatMedia {
    return {
      id: item.id || `media-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      kind: item.kind,
      name: item.name,
      mimeType: item.mimeType,
      dataUrl: item.dataUrl,
      url: item.url,
      size: item.size,
      durationMs: item.durationMs,
      transcript: item.transcript,
      prompt: item.prompt,
      origin: item.origin ?? 'user',
      dispatch: item.dispatch ?? { trigger: 'manual', mode: 'turn', probability: 1 },
      context: item.context ?? { mode: item.kind === 'audio' ? 'text' : 'auto' },
      metadata: item.metadata,
    }
  }

  async function queueAssistantReply(userText: string, media: ChatMessageMedia[] = []): Promise<void> {
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
      mediaFallbackInput: uiLanguage === 'zh-CN' ? '请根据这次发送的媒体内容进行回复。' : 'Please respond to the media sent in this turn.',
      language,
      preferencePrompt: buildConversationPreferencePrompt(conversationSettings, language),
      options: buildConversationRequestOptions(conversationSettings),
      runtimeOptions: {
        shortTermMessageLimit: getShortTermMessageLimit(),
        summaryLimit: conversationSettings.summaryLimit,
      },
      media,
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
      const mediaIntentResult = response.success ? extractRoleplayMediaIntent(reply) : { text: reply, intent: null as RoleplayMediaIntent | null }
      const visibleFinalReply = mediaIntentResult.intent ? mediaIntentResult.text : reply
      const snapshot = applyChatRuntimeTurnResult(conversation, {
        assistantMessageId: message.id,
        content: visibleFinalReply,
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
      if (response.success) {
        void generateTurnMedia(conversation, {
          assistantMessageId: message.id,
          userText,
          assistantText: visibleFinalReply,
          intent: mediaIntentResult.intent,
          userMedia: media,
        })
      }
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

  async function generateTurnMedia(
    conversation: ChatConversationSummary,
    input: {
      assistantMessageId: string
      userText: string
      assistantText: string
      intent?: RoleplayMediaIntent | null
      userMedia?: ChatMessageMedia[]
    }
  ): Promise<void> {
    const character = getCharacterForConversation(state, conversation)
    const language = getEffectiveConversationLanguage()
    const decision = decideRoleplayMediaDispatch({
      userText: input.userText,
      assistantText: input.assistantText,
      language,
      policy: buildConversationMediaPolicy(conversationSettings),
      intent: input.intent,
      character,
      sceneState: conversation.sceneState,
      recentMessages: conversation.messages,
      externalProbabilityBias: getExternalMediaProbabilityBias(input.userMedia ?? []),
      random: Math.random,
    })
    if (decision.audio) {
      await generateAssistantAudio(conversation, input.assistantMessageId, decision.audio, false)
    }
    if (decision.image) {
      await generateAssistantImage(conversation, decision.image, false)
    }
  }

  async function handleManualMessageMediaAction(action: 'image' | 'audio', messageId: string): Promise<void> {
    const conversation = getActiveMutableConversation()
    if (!conversation) {
      return
    }
    const message = conversation.messages.find((item) => item.id === messageId && item.role === 'assistant')
    if (!message || message.state) {
      return
    }
    const language = getEffectiveConversationLanguage()
    const assistantText = localizeChatText(message.text, language).trim()
    const userText = getPreviousUserMessageText(conversation, messageId, language)
    const character = getCharacterForConversation(state, conversation)
    const basePolicy = buildConversationMediaPolicy(conversationSettings)
    const decision = decideRoleplayMediaDispatch({
      userText,
      assistantText,
      language,
      policy: {
        ...basePolicy,
        imageMode: action === 'image' ? 'always' : 'off',
        voiceMode: action === 'audio' ? 'assistant' : 'off',
        imageCooldownTurns: 0,
      },
      character,
      sceneState: conversation.sceneState,
      recentMessages: conversation.messages,
      random: () => 0,
    })
    if (action === 'image' && decision.image) {
      await generateAssistantImage(conversation, { ...decision.image, trigger: 'manual', reason: 'manual_message_action' }, true)
    } else if (action === 'audio' && decision.audio) {
      await generateAssistantAudio(conversation, messageId, { ...decision.audio, trigger: 'manual', reason: 'manual_message_action' }, true)
    }
  }

  async function generateAssistantAudio(
    conversation: ChatConversationSummary,
    assistantMessageId: string,
    dispatch: {
      text: string
      trigger: 'manual' | 'model'
      permanent: boolean
      reason: string
    },
    notifyOnMissing: boolean
  ): Promise<void> {
    const model = getSelectedTTSModel()
    if (!model) {
      if (notifyOnMissing) {
        showToast(options.getLanguage() === 'zh-CN' ? '请先配置可用 TTS 模型' : 'Configure a usable TTS model first')
      }
      return
    }
    const message = conversation.messages.find((item) => item.id === assistantMessageId)
    if (!message) {
      return
    }
    const previousState = message.state
    message.state = 'generating_audio'
    renderer.replaceMessage(message)
    await persistConversation(conversation)
    try {
      const response = await window.electronAPI.synthesizeChatAudioMedia({
        model,
        text: dispatch.text,
        name: `${conversation.characterId || 'character'}-voice-${Date.now()}`,
      })
      if (!response.success || !response.media) {
        throw new Error(response.error || 'TTS generation failed')
      }
      message.media = [
        ...(message.media ?? []),
        decorateGeneratedMedia(response.media, {
          trigger: dispatch.trigger,
          mode: dispatch.permanent ? 'permanent' : 'turn',
          reason: dispatch.reason,
          summary: dispatch.text,
        }),
      ]
      message.state = previousState === 'generating_audio' ? undefined : previousState
      renderer.replaceMessage(message)
      await persistConversation(conversation)
      if (conversationSettings.mediaVoiceAutoplay) {
        playGeneratedAudio(assistantMessageId)
      }
    } catch (error: any) {
      message.state = previousState === 'generating_audio' ? undefined : previousState
      renderer.replaceMessage(message)
      await persistConversation(conversation)
      if (notifyOnMissing || dispatch.trigger === 'model') {
        showToast(error?.message || String(error))
      }
    }
  }

  async function generateAssistantImage(
    conversation: ChatConversationSummary,
    dispatch: {
      prompt: string
      trigger: 'manual' | 'model' | 'probability'
      probability: number
      permanent: boolean
      reason: string
      referenceImages: string[]
    },
    notifyOnMissing: boolean
  ): Promise<void> {
    const choice = getSelectedImageModelChoice()
    if (!choice) {
      if (notifyOnMissing) {
        showToast(options.getLanguage() === 'zh-CN' ? '请先配置可用生图模型' : 'Configure a usable image model first')
      }
      return
    }
    const imageMessage = createGeneratedMediaMessage(
      options.getLanguage() === 'zh-CN' ? '生成画面中...' : 'Generating image...',
      'generating_image'
    )
    conversation.messages.push(imageMessage)
    renderer.appendMessage(imageMessage)
    await persistConversation(conversation)
    try {
      const response = await window.electronAPI.generateChatImageMedia({
        model: {
          ...choice.api,
          modelType: 'image',
          modelName: choice.modelName,
        },
        modelName: choice.modelName,
        prompt: dispatch.prompt,
        referenceImages: dispatch.referenceImages,
        size: conversationSettings.mediaImageSize,
        name: `${conversation.characterId || 'character'}-image-${Date.now()}.png`,
      })
      if (!response.success || !response.media) {
        throw new Error(response.error || 'Image generation failed')
      }
      imageMessage.media = [decorateGeneratedMedia(response.media, {
        trigger: dispatch.trigger,
        mode: dispatch.permanent ? 'permanent' : 'turn',
        probability: dispatch.probability,
        reason: dispatch.reason,
        summary: dispatch.prompt,
      })]
      imageMessage.text = { 'zh-CN': '', 'en-US': '' }
      imageMessage.state = undefined
      renderer.replaceMessage(imageMessage)
      await persistConversation(conversation)
    } catch (error: any) {
      const errorText = options.getLanguage() === 'zh-CN'
        ? `图片生成失败：${error?.message || String(error)}`
        : `Image generation failed: ${error?.message || String(error)}`
      imageMessage.text = { 'zh-CN': errorText, 'en-US': errorText }
      imageMessage.state = undefined
      renderer.replaceMessage(imageMessage)
      await persistConversation(conversation)
      if (notifyOnMissing || dispatch.trigger === 'model') {
        showToast(error?.message || String(error))
      }
    }
  }

  function createGeneratedMediaMessage(text: string, stateValue: ChatMessage['state']): ChatMessage {
    const label = getTimeLabel()
    return {
      id: `assistant-media-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      role: 'assistant',
      text: { 'zh-CN': text, 'en-US': text },
      createdLabel: { 'zh-CN': label, 'en-US': label },
      state: stateValue,
    }
  }

  function decorateGeneratedMedia(
    item: ChatMessageMedia,
    optionsValue: {
      trigger: 'manual' | 'model' | 'probability'
      mode: 'turn' | 'permanent'
      probability?: number
      reason: string
      summary: string
    }
  ): ChatMessageMedia {
    return {
      ...item,
      id: item.id || `generated-media-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      origin: 'generated',
      dispatch: {
        ...(item.dispatch ?? {}),
        trigger: optionsValue.trigger,
        mode: optionsValue.mode,
        ...(typeof optionsValue.probability === 'number' ? { probability: optionsValue.probability } : {}),
        reason: optionsValue.reason,
      },
      context: optionsValue.mode === 'permanent'
        ? { mode: 'text', summary: optionsValue.summary.slice(0, 420) }
        : { mode: 'none' },
      metadata: {
        ...(item.metadata ?? {}),
        generatedAt: Date.now(),
      },
    }
  }

  function getExternalMediaProbabilityBias(media: ChatMessageMedia[]): number {
    return media.reduce((total, item) => total + (Number(item.dispatch?.externalProbabilityBias) || 0), 0)
  }

  function getPreviousUserMessageText(
    conversation: ChatConversationSummary,
    assistantMessageId: string,
    language: 'zh-CN' | 'en-US'
  ): string {
    const assistantIndex = conversation.messages.findIndex((item) => item.id === assistantMessageId)
    for (let index = assistantIndex - 1; index >= 0; index -= 1) {
      const message = conversation.messages[index]
      if (message.role === 'user') {
        return localizeChatText(message.text, language)
      }
    }
    return ''
  }

  function playGeneratedAudio(messageId: string): void {
    window.requestAnimationFrame(() => {
      const selector = `[data-message-id="${cssEscapeForSelector(messageId)}"] audio`
      const audio = options.messageList.querySelector<HTMLAudioElement>(selector)
      void audio?.play().catch(() => undefined)
    })
  }

  function cssEscapeForSelector(value: string): string {
    if (typeof CSS !== 'undefined' && CSS.escape) {
      return CSS.escape(value)
    }
    return value.replace(/["\\]/g, '\\$&')
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
      chatTTSModels = (settings.system.ttsModels || []).map((model) => ({
        ...model,
        extra: model.extra ? { ...model.extra } : undefined,
      }))
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
      renderConversationSettings()
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
    const chatChoices = config.chatModels.flatMap((model) => {
      const kind = getChatModelType(model)
      const provider = getChatProviderEntry(model)
      return getChatModelChoiceNames(model).map((choice) => ({
        id: `${model.id}::${choice.modelRef}`,
        kind,
        apiId: model.id,
        modelName: choice.label,
        provider: provider.value,
        providerLabel: provider.label,
        logoHtml: renderChatModelLogo(model),
      }))
    })
    const taskChoices = (config.taskModels ?? []).flatMap((model): CharacterWorkflowModelChoice[] => {
      const transport = getWorkflowTaskTransport(model)
      if (transport === 'openai_compatible') {
        return []
      }
      const rawModelName = String(model.modelName || '').trim()
      const modelName = transport === 'openai_compatible' ? rawModelName : ''
      const modelRef = modelName || '__default__'
      if (!modelName && (transport !== 'codex_local' && transport !== 'claude_code_local')) {
        return []
      }
      const providerLabel = workflowTaskTransportLabel(transport)
      const displayName = modelName || `${providerLabel} default`
      const providerKey = transport === 'claude_code_local' ? 'claude-code' : 'codex'
      return [{
        id: `${model.id}::${modelRef}`,
        kind: 'llm',
        apiId: model.id,
        modelName: displayName,
        provider: transport,
        providerLabel,
        logoHtml: renderProviderLogo(providerKey),
      }]
    })
    return [...taskChoices, ...chatChoices]
  }

  function getWorkflowTaskTransport(model: { provider?: string; transport?: unknown }): 'openai_compatible' | 'codex_local' | 'claude_code_local' {
    if (model.transport === 'codex_local' || model.transport === 'claude_code_local') {
      return model.transport
    }
    return getLLMProviderCatalogEntry(model.provider).transport ?? 'openai_compatible'
  }

  function workflowTaskTransportLabel(value: 'codex_local' | 'claude_code_local'): string {
    return value === 'claude_code_local' ? 'Claude Code' : 'Codex'
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
        getChatModelChoiceNames(model).forEach((choice) => {
          group.models.push({ api: model, modelName: choice.label })
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
    const localCli = getLocalLLMTransport(model) !== 'openai_compatible'
    const hasModelName = localCli || getEnabledModelNames(model).length > 0
    const hasCredential = Boolean(model.apiKey.trim()) || provider.value === 'ollama'
    const hasEndpoint = Boolean(model.baseUrl.trim()) || provider.value === 'openai'
    return localCli || (hasModelName && hasCredential && hasEndpoint)
  }

  function getChatModelChoiceNames(model: ChatModelConfig): Array<{ modelRef: string; label: string }> {
    const enabled = getEnabledModelNames(model)
    if (enabled.length) {
      return enabled.map((name) => ({ modelRef: name, label: name }))
    }
    if (getChatModelType(model) === 'llm' && getLocalLLMTransport(model) !== 'openai_compatible') {
      return [{ modelRef: '__default__', label: 'CLI default' }]
    }
    return []
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

  function createConversationForCharacter(character: ChatCharacterResource): ChatConversationSummary {
    const now = getTimeLabel()
    return {
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
        ...(character.openingPanel ? { openingPanel: character.openingPanel } : {}),
      }],
    }
  }

  function ensureWorkflowConversation(): ChatConversationSummary | null {
    const existing = getActiveMutableConversation()
    if (existing) {
      return existing
    }
    const character = state.characterResources[0]
    if (!character) {
      showToast(options.getLanguage() === 'zh-CN' ? '角色资源尚未加载' : 'Character resources are not loaded')
      return null
    }
    const conversation = createConversationForCharacter(character)
    state.conversations = [conversation, ...state.conversations]
    state.activeConversationId = conversation.id
    return conversation
  }

  async function createChatConversation(): Promise<void> {
    const character = state.characterResources.find((item) => item.id === getActiveConversation(state)?.characterId)
      ?? state.characterResources[0]
    if (!character) {
      showToast(options.getLanguage() === 'zh-CN' ? '角色资源尚未加载' : 'Character resources are not loaded')
      return
    }
    const conversation = createConversationForCharacter(character)
    state.conversations = [conversation, ...state.conversations]
    state.activeConversationId = conversation.id
    await persistConversation(conversation)
    renderChat()
    renderChatHistoryManager()
  }

  async function openCharacterWorkflowRunDraftInChat(): Promise<void> {
    if (!characterWorkflowRunState?.run) {
      showToast(options.getLanguage() === 'zh-CN' ? '当前没有运行草稿' : 'No run draft is selected')
      return
    }
    try {
      const character = createChatCharacterFromRunDraft(characterWorkflowRunState)
      const existingIndex = state.characterResources.findIndex((item) => item.id === character.id)
      if (existingIndex >= 0) {
        state.characterResources[existingIndex] = character
      } else {
        state.characterResources = [character, ...state.characterResources]
      }
      const now = getTimeLabel()
      const openingText = getRoleChatOpeningText(character.firstMessage)
      const conversation: ChatConversationSummary = {
        id: `${character.id}-chat-${Date.now()}`,
        characterId: character.id,
        title: character.displayName,
        preview: openingText,
        updatedLabel: { 'zh-CN': '刚刚', 'en-US': 'Now' },
        sceneState: character.scene,
        summaries: [],
        messages: [{
          id: `${character.id}-welcome-${Date.now()}`,
          role: 'assistant',
          text: openingText,
          createdLabel: { 'zh-CN': now, 'en-US': now },
          ...(character.openingPanel ? { openingPanel: character.openingPanel } : {}),
        }],
        characterWorkflow: createPersistedCharacterWorkflowState(),
        characterResource: character,
      }
      state.conversations = [conversation, ...state.conversations]
      state.activeConversationId = conversation.id
      await persistConversation(conversation)
      const sessionButton = panel.querySelector<HTMLButtonElement>('[data-chat-nav="session"]')
      if (sessionButton) {
        setActiveNav(sessionButton)
      } else {
        panel.dataset.chatView = 'session'
        syncChatView()
      }
      renderChat()
      renderChatHistoryManager()
      showToast(options.getLanguage() === 'zh-CN' ? '已进入聊天测试' : 'Opened chat test')
    } catch (error: any) {
      showToast(error?.message || String(error))
    }
  }

  async function downloadActiveCharacterWorkflowRunDraft(): Promise<void> {
    if (!characterWorkflowRunState?.run) {
      showToast(options.getLanguage() === 'zh-CN' ? '当前没有可下载的运行草稿' : 'No run draft is available to download')
      return
    }
    const fields = extractCharacterCardFieldsFromRunDraft(characterWorkflowRunState)
    const baseName = sanitizeChatResourceId(stringField(fields.name) || characterWorkflowRunState.run.title || characterWorkflowRunState.run.id || 'character')
    const images = await collectRunDraftImagePackageFiles(characterWorkflowRunState)
    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      source: {
        app: 'Noema',
        runId: characterWorkflowRunState.run.id,
        runTitle: characterWorkflowRunState.run.title,
      },
      roleCard: fields,
      chat: {
        name: stringField(fields.name),
        description: stringField(fields.description),
        appearance: stringField(fields.appearance),
        personality: stringField(fields.personality),
        background: stringField(fields.background) || stringField(fields.story),
        scenario: stringField(fields.scenario),
        firstMessage: normalizeRoleChatMarkup(stringField(fields.firstMessage)),
        dialogueStyle: stringField(fields.dialogueStyle),
        worldContext: stringField(fields.worldContext),
      },
      images: images.manifest,
    }
    const files: ZipPackageFile[] = [
      {
        path: 'character.json',
        data: new TextEncoder().encode(JSON.stringify(payload, null, 2)),
      },
      ...images.files,
    ]
    const blob = createStoredZipBlob(files)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${baseName}.noema-character.zip`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    showToast(options.getLanguage() === 'zh-CN' ? '角色文件包已开始下载' : 'Character package download started')
  }

  function createChatCharacterFromRunDraft(runState: CharacterResourceRunState): ChatCharacterResource {
    const fields = extractCharacterCardFieldsFromRunDraft(runState)
    const name = stringField(fields.name)
    const firstMessage = normalizeRoleChatMarkup(stringField(fields.firstMessage))
    if (!name || !firstMessage) {
      throw new Error(options.getLanguage() === 'zh-CN'
        ? '运行草稿缺少聊天必要字段：name / firstMessage'
        : 'Run draft is missing required chat fields: name / firstMessage')
    }
    const description = stringField(fields.description)
    const story = stringField(fields.story)
    const background = stringField(fields.background)
    const avatarImage = findRunDraftImage(runState, ['avatar', 'portrait', 'character'])
    const bodyImage = findRunDraftImage(runState, ['body', 'full-body', 'character']) || avatarImage
    const openingPanel = extractOpeningPanelFromRunDraft(runState)
    const id = `workflow-run-${sanitizeChatResourceId(runState.run?.id ?? name)}`
    return {
      id,
      roleCard: {
        ...fields,
        firstMessage,
        ...(openingPanel ? { openingPanel } : {}),
      },
      ...(openingPanel ? { openingPanel } : {}),
      name: localizedText(name),
      displayName: localizedText(name),
      description: localizedText(description),
      story: localizedText(story),
      background: localizedText(background),
      scene: {},
      firstMessage: localizedText(firstMessage),
      tag: {
        'zh-CN': ['workflow', 'run-draft'],
        'en-US': ['workflow', 'run-draft'],
      },
      avatarImage,
      bodyImage,
    }
  }

  function extractOpeningPanelFromRunDraft(runState: CharacterResourceRunState): ChatOpeningPanel | undefined {
    const artifact = [...(runState.artifacts ?? [])].reverse().find((item) => item.type === 'opening-layout')
    const data = artifact?.data && typeof artifact.data === 'object' && !Array.isArray(artifact.data)
      ? artifact.data as Record<string, unknown>
      : null
    if (!data) {
      return undefined
    }
    const html = typeof data.html === 'string' ? data.html : ''
    const css = typeof data.css === 'string' ? data.css : ''
    if (!html && !css) {
      return undefined
    }
    return {
      html,
      css,
      summary: typeof data.summary === 'string' ? data.summary : artifact?.summary,
      layoutKind: typeof data.layoutKind === 'string' ? data.layoutKind : undefined,
      sourceArtifactId: artifact?.id,
    }
  }

  function normalizeRoleChatMarkup(value: string): string {
    const text = value.trim()
    const match = text.match(/<chat>([\s\S]*?)<\/chat>/i)
    if (match) {
      return `<chat>${match[1].trim()}</chat>`
    }
    return `<chat>${text.replace(/<\/?chat>/gi, '').trim()}</chat>`
  }

  function getRoleChatOpeningText(value: ChatLocalizedText): ChatLocalizedText {
    return {
      'zh-CN': extractRoleChatOpeningText(value['zh-CN']),
      'en-US': extractRoleChatOpeningText(value['en-US']),
    }
  }

  function extractRoleChatOpeningText(value: string): string {
    const match = value.match(/<chat>([\s\S]*?)<\/chat>/i)
    return (match ? match[1] : value).trim()
  }

  interface ZipPackageFile {
    path: string
    data: Uint8Array
  }

  interface CharacterPackageImageEntry {
    id?: string
    title?: string
    role?: string
    sourceNodeId?: string
    path?: string
    url?: string
  }

  async function collectRunDraftImagePackageFiles(runState: CharacterResourceRunState): Promise<{
    manifest: CharacterPackageImageEntry[]
    files: ZipPackageFile[]
  }> {
    const files: ZipPackageFile[] = []
    const manifest: CharacterPackageImageEntry[] = []
    const imageArtifacts = (runState.artifacts ?? []).filter((artifact) => artifact.type === 'image-asset')
    for (let index = 0; index < imageArtifacts.length; index += 1) {
      const artifact = imageArtifacts[index]
      const imageUrl = getRunDraftImageUrl(artifact.data)
      const imageRole = getRunDraftImageRole(artifact.data)
      const title = artifact.title || imageRole || `image-${index + 1}`
      const baseFileName = sanitizeChatResourceId(imageRole || title || `image-${index + 1}`)
      const entry: CharacterPackageImageEntry = {
        id: artifact.id,
        title,
        role: imageRole,
        sourceNodeId: artifact.sourceNodeId,
      }
      const imageFile = imageUrl ? await resolveCharacterPackageImageFile(imageUrl, `images/${baseFileName || `image-${index + 1}`}`) : null
      if (imageFile) {
        files.push(imageFile)
        entry.path = imageFile.path
      } else if (imageUrl) {
        entry.url = imageUrl
      }
      manifest.push(entry)
    }
    return { manifest, files }
  }

  function getRunDraftImageRole(data: unknown): string {
    if (!data || typeof data !== 'object') return ''
    const record = data as Record<string, unknown>
    return typeof record.imageRole === 'string'
      ? record.imageRole
      : typeof record.targetTitle === 'string'
        ? record.targetTitle
        : ''
  }

  async function resolveCharacterPackageImageFile(url: string, basePath: string): Promise<ZipPackageFile | null> {
    if (url.startsWith('data:')) {
      const parsed = dataUrlToBytes(url)
      return parsed ? { path: `${basePath}.${extensionForMimeType(parsed.mimeType)}`, data: parsed.data } : null
    }
    try {
      const response = await fetch(url)
      if (!response.ok) return null
      const blob = await response.blob()
      return {
        path: `${basePath}.${extensionForMimeType(blob.type)}`,
        data: new Uint8Array(await blob.arrayBuffer()),
      }
    } catch {
      return null
    }
  }

  function dataUrlToBytes(url: string): { mimeType: string; data: Uint8Array } | null {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url)
    if (!match) return null
    const mimeType = match[1] || 'application/octet-stream'
    const encoded = match[3] || ''
    if (match[2]) {
      const binary = atob(encoded)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
      }
      return { mimeType, data: bytes }
    }
    return { mimeType, data: new TextEncoder().encode(decodeURIComponent(encoded)) }
  }

  function extensionForMimeType(mimeType: string): string {
    const normalized = mimeType.toLowerCase()
    if (normalized.includes('png')) return 'png'
    if (normalized.includes('webp')) return 'webp'
    if (normalized.includes('gif')) return 'gif'
    if (normalized.includes('svg')) return 'svg'
    if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg'
    return 'bin'
  }

  function createStoredZipBlob(files: ZipPackageFile[]): Blob {
    const encoder = new TextEncoder()
    const localParts: Uint8Array[] = []
    const centralParts: Uint8Array[] = []
    let offset = 0
    for (const file of files) {
      const name = encoder.encode(file.path)
      const crc = crc32(file.data)
      const local = createZipLocalHeader(name, file.data.length, crc)
      localParts.push(local, name, file.data)
      centralParts.push(createZipCentralHeader(name, file.data.length, crc, offset), name)
      offset += local.length + name.length + file.data.length
    }
    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
    const end = createZipEndRecord(files.length, centralSize, offset)
    return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' })
  }

  function createZipLocalHeader(name: Uint8Array, size: number, crc: number): Uint8Array {
    const header = new Uint8Array(30)
    const view = new DataView(header.buffer)
    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 0x0800, true)
    view.setUint16(8, 0, true)
    view.setUint16(10, 0, true)
    view.setUint16(12, 0, true)
    view.setUint32(14, crc, true)
    view.setUint32(18, size, true)
    view.setUint32(22, size, true)
    view.setUint16(26, name.length, true)
    view.setUint16(28, 0, true)
    return header
  }

  function createZipCentralHeader(name: Uint8Array, size: number, crc: number, offset: number): Uint8Array {
    const header = new Uint8Array(46)
    const view = new DataView(header.buffer)
    view.setUint32(0, 0x02014b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 20, true)
    view.setUint16(8, 0x0800, true)
    view.setUint16(10, 0, true)
    view.setUint16(12, 0, true)
    view.setUint16(14, 0, true)
    view.setUint32(16, crc, true)
    view.setUint32(20, size, true)
    view.setUint32(24, size, true)
    view.setUint16(28, name.length, true)
    view.setUint16(30, 0, true)
    view.setUint16(32, 0, true)
    view.setUint16(34, 0, true)
    view.setUint16(36, 0, true)
    view.setUint32(38, 0, true)
    view.setUint32(42, offset, true)
    return header
  }

  function createZipEndRecord(fileCount: number, centralSize: number, centralOffset: number): Uint8Array {
    const end = new Uint8Array(22)
    const view = new DataView(end.buffer)
    view.setUint32(0, 0x06054b50, true)
    view.setUint16(8, fileCount, true)
    view.setUint16(10, fileCount, true)
    view.setUint32(12, centralSize, true)
    view.setUint32(16, centralOffset, true)
    view.setUint16(20, 0, true)
    return end
  }

  function crc32(data: Uint8Array): number {
    let crc = 0xffffffff
    for (const byte of data) {
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff]
    }
    return (crc ^ 0xffffffff) >>> 0
  }

  const CRC32_TABLE = new Uint32Array(Array.from({ length: 256 }, (_, index) => {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
    }
    return value >>> 0
  }))

  function extractCharacterCardFieldsFromRunDraft(runState: CharacterResourceRunState): Record<string, unknown> {
    const fields: Record<string, unknown> = {}
    for (const artifact of runState.artifacts ?? []) {
      if (artifact.type === 'character-card-final' && artifact.data && typeof artifact.data === 'object') {
        Object.assign(fields, artifact.data as Record<string, unknown>)
      }
    }
    for (const artifact of runState.artifacts ?? []) {
      const data = artifact.data && typeof artifact.data === 'object' ? artifact.data as Record<string, unknown> : undefined
      const field = typeof data?.field === 'string' ? data.field : ''
      if (artifact.type === 'character-card-field' && field && data && 'value' in data && fields[field] === undefined) {
        fields[field] = data.value
      }
    }
    return fields
  }

  function findRunDraftImage(runState: CharacterResourceRunState, preferredTerms: string[]): string {
    const imageArtifacts = (runState.artifacts ?? []).filter((artifact) => artifact.type.includes('image'))
    for (const term of preferredTerms) {
      const matched = imageArtifacts.find((artifact) => `${artifact.title ?? ''} ${artifact.summary ?? ''}`.toLowerCase().includes(term))
      const image = matched ? getRunDraftImageUrl(matched.data) : ''
      if (image) return image
    }
    for (const artifact of imageArtifacts) {
      const image = getRunDraftImageUrl(artifact.data)
      if (image) return image
    }
    return ''
  }

  function getRunDraftImageUrl(data: unknown): string {
    if (!data || typeof data !== 'object') return ''
    const record = data as Record<string, any>
    const direct = record.url ?? record.imageUrl ?? record.dataUrl
    if (typeof direct === 'string') return direct
    const images = Array.isArray(record.images) ? record.images : []
    for (const image of images) {
      if (typeof image === 'string') return image
      if (image && typeof image === 'object') {
        const nested = (image as Record<string, any>).url ?? (image as Record<string, any>).imageUrl ?? (image as Record<string, any>).dataUrl
        if (typeof nested === 'string') return nested
      }
    }
    return ''
  }

  function localizedText(value: string): ChatLocalizedText {
    return { 'zh-CN': value, 'en-US': value }
  }

  function stringField(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
  }

  function sanitizeChatResourceId(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || `run-${Date.now()}`
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
      imageModels: getConversationImageModelOptions(),
      ttsModels: getConversationTTSModelOptions(),
    })
  }

  function getConversationImageModelOptions(): ConversationSettingsModelOption[] {
    return getImageModelChoices(true).map((choice) => {
      const missing = getImageModelMissingParts(choice.api, choice.modelName)
      return {
        value: choice.ref,
        label: `${choice.providerLabel} / ${choice.modelName}`,
        detail: missing.length ? missing.join(', ') : choice.api.id,
        disabled: missing.length > 0,
      }
    })
  }

  function getConversationTTSModelOptions(): ConversationSettingsModelOption[] {
    return chatTTSModels.map((model) => {
      const provider = getTTSProviderCatalogEntry(model.provider)
      const missing = getTTSModelMissingParts(model)
      return {
        value: model.id,
        label: `${provider.label} / ${model.modelName || provider.defaultModel}`,
        detail: missing.length ? missing.join(', ') : (model.voiceId || model.id),
        disabled: missing.length > 0,
      }
    })
  }

  function getImageModelChoices(includeIncomplete = false): ChatImageModelChoice[] {
    const config = chatSystemConfig
    if (!config) {
      return []
    }
    return config.chatModels.flatMap((api) => {
      if (getChatModelType(api) !== 'image') {
        return []
      }
      const provider = getImageProviderCatalogEntry(api.provider)
      const modelNames = getEnabledModelNames(api).length ? getEnabledModelNames(api) : [api.modelName].filter(Boolean)
      return modelNames.flatMap((modelName): ChatImageModelChoice[] => {
        if (!includeIncomplete && getImageModelMissingParts(api, modelName).length) {
          return []
        }
        return [{
          ref: `${api.id}::${modelName}`,
          api,
          modelName,
          providerLabel: provider.label,
        }]
      })
    })
  }

  function getImageModelMissingParts(api: ChatModelConfig, modelName: string): string[] {
    const missing: string[] = []
    if (!modelName.trim()) missing.push(options.getLanguage() === 'zh-CN' ? '模型名' : 'model')
    if (!api.apiKey.trim()) missing.push(options.getLanguage() === 'zh-CN' ? '密钥' : 'key')
    if (!api.baseUrl.trim()) missing.push(options.getLanguage() === 'zh-CN' ? '地址' : 'url')
    return missing
  }

  function getTTSModelMissingParts(model: ChatTTSModelConfig): string[] {
    const missing: string[] = []
    const provider = getTTSProviderCatalogEntry(model.provider)
    if (!(model.modelName || provider.defaultModel).trim()) missing.push(options.getLanguage() === 'zh-CN' ? '模型名' : 'model')
    if (!model.apiKey.trim()) missing.push(options.getLanguage() === 'zh-CN' ? '密钥' : 'key')
    if (provider.requiresVoiceId && !String(model.voiceId || '').trim()) missing.push(options.getLanguage() === 'zh-CN' ? '音色' : 'voice')
    return missing
  }

  function getSelectedImageModelChoice(): ChatImageModelChoice | null {
    const choices = getImageModelChoices(false)
    return choices.find((choice) => choice.ref === conversationSettings.mediaImageModelRef)
      ?? choices[0]
      ?? null
  }

  function getSelectedTTSModel(): ChatTTSModelConfig | null {
    const usable = chatTTSModels.filter((model) => getTTSModelMissingParts(model).length === 0)
    return usable.find((model) => model.id === conversationSettings.mediaTtsModelId)
      ?? usable[0]
      ?? null
  }

  function updateConversationSetting(control: HTMLInputElement | HTMLSelectElement): void {
    const key = control.dataset.chatSetting as keyof ChatConversationSettings | undefined
    if (!key) {
      return
    }
    if (key === 'textStreaming' || key === 'sceneImmersion' || key === 'mediaVoiceAutoplay') {
      conversationSettings = { ...conversationSettings, [key]: (control as HTMLInputElement).checked }
    } else if (key === 'language') {
      const value = control.value === 'zh-CN' || control.value === 'en-US' ? control.value : 'auto'
      conversationSettings = { ...conversationSettings, language: value }
    } else if (key === 'mediaImageMode') {
      const value = control.value === 'off' || control.value === 'requested' || control.value === 'balanced' || control.value === 'always'
        ? control.value
        : 'off'
      conversationSettings = { ...conversationSettings, mediaImageMode: value }
    } else if (key === 'mediaVoiceMode') {
      const value = control.value === 'off' || control.value === 'requested' || control.value === 'assistant'
        ? control.value
        : 'off'
      conversationSettings = { ...conversationSettings, mediaVoiceMode: value }
    } else if (key === 'mediaImageModelRef' || key === 'mediaTtsModelId') {
      conversationSettings = { ...conversationSettings, [key]: control.value.trim() }
    } else if (key === 'mediaImageSize') {
      const value = control.value === '1024x1024' || control.value === '1024x1536' || control.value === '1536x1024'
        ? control.value
        : '1024x1024'
      conversationSettings = { ...conversationSettings, mediaImageSize: value }
    } else if (key === 'mediaImageReferenceMode') {
      conversationSettings = { ...conversationSettings, mediaImageReferenceMode: control.value === 'none' ? 'none' : 'character' }
    } else if (key === 'mediaPersistence') {
      conversationSettings = { ...conversationSettings, mediaPersistence: control.value === 'turn' ? 'turn' : 'permanent' }
    } else if (key === 'outputTokenBudget') {
      conversationSettings = {
        ...conversationSettings,
        outputTokenBudget: clampNumber(Number(control.value), CHAT_OUTPUT_TOKEN_MIN, CHAT_OUTPUT_TOKEN_MAX),
      }
    } else if (key === 'temperature' || key === 'diversity') {
      conversationSettings = { ...conversationSettings, [key]: clampNumber(Number(control.value), 0, 1) }
    } else if (key === 'mediaImageProbability') {
      conversationSettings = {
        ...conversationSettings,
        mediaImageProbability: clampNumber(Number(control.value), CHAT_MEDIA_IMAGE_PROBABILITY_MIN, CHAT_MEDIA_IMAGE_PROBABILITY_MAX),
      }
    } else if (key === 'mediaImageCooldownTurns') {
      conversationSettings = {
        ...conversationSettings,
        mediaImageCooldownTurns: Math.round(clampNumber(Number(control.value), CHAT_MEDIA_IMAGE_COOLDOWN_MIN, CHAT_MEDIA_IMAGE_COOLDOWN_MAX)),
      }
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
      openModelLibraryId: openChatModelLibraryId,
      modelLibrarySearch: chatModelLibrarySearch,
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

  function ensureChatResourcesHydrated(): Promise<void> {
    if (chatResourcesHydrated) {
      return Promise.resolve()
    }
    chatResourcesHydratePromise ??= hydrateChatResources().finally(() => {
      chatResourcesHydratePromise = null
    })
    return chatResourcesHydratePromise
  }

  function ensureCharacterWorkflowProjectsHydrated(): Promise<void> {
    if (characterWorkflowProjectsHydrated) {
      return Promise.resolve()
    }
    characterWorkflowProjectsHydratePromise ??= hydrateCharacterWorkflowProjects().finally(() => {
      characterWorkflowProjectsHydratePromise = null
    })
    return characterWorkflowProjectsHydratePromise
  }

  function ensureChatModelConfigLoaded(): Promise<void> {
    if (chatSystemConfig) {
      return Promise.resolve()
    }
    chatModelConfigLoadPromise ??= loadChatModelConfig().finally(() => {
      chatModelConfigLoadPromise = null
    })
    return chatModelConfigLoadPromise
  }

  async function ensureActiveConversationWorkflowStateLoaded(): Promise<void> {
    const conversation = getActiveConversation(state)
    if (!conversation) {
      return
    }
    const conversationIndex = state.conversations.findIndex((item) => item.id === conversation.id)
    if (conversationIndex < 0) {
      return
    }
    await ensureCharacterWorkflowProjectsHydrated()
    state.conversations[conversationIndex] = await hydrateChatConversationWorkflowState(conversation, state.characterResources)
    upsertConversationCharacterResource(state.conversations[conversationIndex])
    restoreCharacterWorkflowStateFromConversation(state.conversations[conversationIndex])
    if (activeCharacterWorkflowProjectId) {
      await ensureCharacterWorkflowProjectDetailLoaded(activeCharacterWorkflowProjectId).catch(() => null)
      restoreCharacterWorkflowStateFromConversation(state.conversations[conversationIndex])
    }
  }

  function renderCharacterWorkflowLoadingState(): string {
    return `<div class="chat-workflow-loading"><span>${options.escapeHtml(options.getLanguage() === 'zh-CN' ? '正在加载角色资源图...' : 'Loading character resource graph...')}</span></div>`
  }

  function renderCharacterWorkflow(): void {
    void renderCharacterWorkflowAsync()
  }

  function startCharacterWorkflowPerf(label: string): string {
    const now = performance.now()
    const id = `workflow-perf-${Date.now()}-${Math.random().toString(16).slice(2)}`
    characterWorkflowPerfMarks.set(id, { label, startedAt: now, lastAt: now })
    activeCharacterWorkflowPerfId = id
    console.info(`[WorkflowPerf] ${label} start`)
    return id
  }

  function markCharacterWorkflowPerf(id: string, step: string): void {
    const trace = characterWorkflowPerfMarks.get(id)
    if (!trace) {
      return
    }
    const now = performance.now()
    console.info(`[WorkflowPerf] ${trace.label} ${step}: +${Math.round(now - trace.lastAt)}ms (${Math.round(now - trace.startedAt)}ms total)`)
    trace.lastAt = now
  }

  function finishCharacterWorkflowPerf(id: string, step = 'done'): void {
    markCharacterWorkflowPerf(id, step)
    characterWorkflowPerfMarks.delete(id)
    if (activeCharacterWorkflowPerfId === id) {
      activeCharacterWorkflowPerfId = ''
    }
  }

  function scheduleCharacterWorkflowRunRender(): void {
    if (characterWorkflowRunRenderFrame !== undefined) {
      return
    }
    characterWorkflowRunRenderFrame = window.requestAnimationFrame(() => {
      characterWorkflowRunRenderFrame = undefined
      void patchCharacterWorkflowRunDraft()
    })
  }

  async function patchCharacterWorkflowRunDraft(): Promise<void> {
    if (!characterWorkflowRoot || characterWorkflowActiveTabId !== 'run-draft') {
      renderCharacterWorkflow()
      return
    }
    const activeProject = characterWorkflowProjects.find((project) => project.id === activeCharacterWorkflowProjectId)
    const runViewport = characterWorkflowRoot.querySelector<HTMLElement>('.chat-resource-run-viewport')
    if (!activeProject || !runViewport) {
      renderCharacterWorkflow()
      return
    }
    const renderToken = ++characterWorkflowLazyRenderToken
    const workflowPage = await loadCharacterWorkflowPageModule()
    if (renderToken !== characterWorkflowLazyRenderToken || !characterWorkflowRoot?.isConnected) {
      return
    }
    const pageOptions = createCharacterWorkflowPageOptions(activeProject)
    const nextViewportHtml = workflowPage.renderCharacterWorkflowRunDraftViewport(pageOptions)
    replaceCharacterWorkflowRunViewport(runViewport, nextViewportHtml)

    const controls = characterWorkflowRoot.querySelector<HTMLElement>('.chat-resource-run-controls')
    if (controls) {
      controls.outerHTML = workflowPage.renderCharacterWorkflowRunDraftControls(pageOptions)
    }

    const inspector = characterWorkflowRoot.querySelector<HTMLElement>('.chat-run-character-inspector')
    if (inspector && !characterWorkflowEditorState.inspectorCollapsed) {
      patchCharacterWorkflowRunInspector(inspector, workflowPage.renderCharacterWorkflowRunDraftInspector(pageOptions))
    }

    workflowPage.initializeCharacterResourceWorkbench(characterWorkflowRoot)
  }

  function replaceCharacterWorkflowRunViewport(currentViewport: HTMLElement, nextViewportHtml: string): void {
    const nextViewport = parseCharacterWorkflowElement<HTMLElement>(nextViewportHtml, '.chat-resource-run-viewport')
    const shouldPrimeRunMotion = currentViewport.dataset.runDraftInitialized === 'true'
      && nextViewport.classList.contains('run-status-running')
      && !(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
    if (!shouldPrimeRunMotion) {
      currentViewport.replaceWith(nextViewport)
      return
    }
    const existingNodeIds = new Set(
      Array.from(currentViewport.querySelectorAll<HTMLElement>('.chat-resource-node'))
        .map((node) => node.dataset.chatWorkflowNodeId ?? '')
        .filter(Boolean)
    )
    const existingLinkIds = new Set(
      Array.from(currentViewport.querySelectorAll<SVGGElement>('.chat-resource-link'))
        .map((link) => link.getAttribute('data-chat-resource-link-id') ?? '')
        .filter(Boolean)
    )
    const newNodeIds = new Set<string>()
    nextViewport.querySelectorAll<HTMLElement>('.chat-resource-node').forEach((node) => {
      const nodeId = node.dataset.chatWorkflowNodeId ?? ''
      if (nodeId && !existingNodeIds.has(nodeId)) {
        newNodeIds.add(nodeId)
        node.style.opacity = '0'
        node.style.visibility = 'hidden'
        node.style.transformOrigin = '50% 0%'
      }
    })
    nextViewport.querySelectorAll<SVGGElement>('.chat-resource-link').forEach((link) => {
      const linkId = link.getAttribute('data-chat-resource-link-id') ?? ''
      const targetNodeId = link.getAttribute('data-run-link-target-node-id') ?? ''
      if (!existingLinkIds.has(linkId) || (targetNodeId && newNodeIds.has(targetNodeId))) {
        link.style.opacity = '0'
        link.style.visibility = 'hidden'
        link.querySelectorAll<SVGPathElement>('path:not(.hit-area)').forEach((path) => {
          const length = Math.max(1, Math.ceil(path.getTotalLength()))
          path.style.opacity = '0'
          path.style.strokeDasharray = `${length}`
          path.style.strokeDashoffset = `${length}`
        })
      }
    })
    currentViewport.replaceWith(nextViewport)
  }

  function patchCharacterWorkflowRunInspector(currentInspector: HTMLElement, nextInspectorHtml: string): void {
    const nextInspector = parseCharacterWorkflowElement<HTMLElement>(nextInspectorHtml, '.chat-run-character-inspector')
    copyElementAttributes(currentInspector, nextInspector)
    patchCharacterWorkflowRunHero(
      requireCharacterWorkflowElement(currentInspector, '.chat-run-character-hero'),
      requireCharacterWorkflowElement(nextInspector, '.chat-run-character-hero')
    )
    patchKeyedChildren(
      requireCharacterWorkflowElement(currentInspector, '[data-run-character-fields]'),
      requireCharacterWorkflowElement(nextInspector, '[data-run-character-fields]'),
      'runCharacterFieldKey'
    )
    const currentImages = currentInspector.querySelector<HTMLElement>('[data-run-character-images]')
    const nextImages = nextInspector.querySelector<HTMLElement>('[data-run-character-images]')
    if (currentImages && nextImages) {
      patchKeyedChildren(currentImages, nextImages, 'runCharacterImageKey')
    } else if (!nextImages && currentImages) {
      currentImages.remove()
    } else if (nextImages && !currentImages) {
      requireCharacterWorkflowElement<HTMLElement>(currentInspector, '.chat-run-character-scroll').append(nextImages)
    }
  }

  function patchCharacterWorkflowRunHero(currentHero: HTMLElement, nextHero: HTMLElement): void {
    let changed = false
    const currentImage = requireCharacterWorkflowElement<HTMLImageElement>(currentHero, ':scope > img')
    const nextImage = requireCharacterWorkflowElement<HTMLImageElement>(nextHero, ':scope > img')
    if (currentImage.src !== nextImage.src || currentImage.alt !== nextImage.alt) {
      currentImage.src = nextImage.src
      currentImage.alt = nextImage.alt
      changed = true
    }
    for (const selector of ['.chat-run-character-hero-copy', '.chat-run-character-actions']) {
      const current = requireCharacterWorkflowElement<HTMLElement>(currentHero, selector)
      const next = requireCharacterWorkflowElement<HTMLElement>(nextHero, selector)
      if (current.innerHTML !== next.innerHTML) {
        current.innerHTML = next.innerHTML
        changed = true
      }
    }
    if (changed) {
      flashRunPreviewElement(currentHero)
    }
  }

  function patchKeyedChildren(currentContainer: HTMLElement, nextContainer: HTMLElement, datasetKey: string): void {
    copyElementAttributes(currentContainer, nextContainer)
    const currentByKey = new Map<string, HTMLElement>()
    Array.from(currentContainer.children).forEach((child) => {
      if (!(child instanceof HTMLElement)) return
      const key = child.dataset[datasetKey] ?? ''
      if (key) currentByKey.set(key, child)
    })
    Array.from(nextContainer.children).forEach((nextChild) => {
      if (!(nextChild instanceof HTMLElement)) return
      const key = nextChild.dataset[datasetKey] ?? ''
      const currentChild = key ? currentByKey.get(key) : null
      if (!currentChild) {
        const clone = nextChild.cloneNode(true) as HTMLElement
        clone.classList.add('is-entering')
        currentContainer.append(clone)
        window.setTimeout(() => clone.classList.remove('is-entering'), 320)
        return
      }
      currentByKey.delete(key)
      const changed = currentChild.innerHTML !== nextChild.innerHTML || currentChild.className !== nextChild.className
      copyElementAttributes(currentChild, nextChild)
      if (currentChild.innerHTML !== nextChild.innerHTML) {
        currentChild.innerHTML = nextChild.innerHTML
      }
      currentContainer.append(currentChild)
      if (changed) {
        flashRunPreviewElement(currentChild)
      }
    })
    currentByKey.forEach((child) => child.remove())
  }

  function flashRunPreviewElement(element: HTMLElement): void {
    element.classList.remove('is-updated')
    void element.offsetWidth
    element.classList.add('is-updated')
    window.setTimeout(() => element.classList.remove('is-updated'), 560)
  }

  function copyElementAttributes(target: HTMLElement, source: HTMLElement): void {
    Array.from(target.attributes).forEach((attribute) => {
      if (!source.hasAttribute(attribute.name)) {
        target.removeAttribute(attribute.name)
      }
    })
    Array.from(source.attributes).forEach((attribute) => {
      target.setAttribute(attribute.name, attribute.value)
    })
  }

  function parseCharacterWorkflowElement<T extends Element>(html: string, selector: string): T {
    const template = document.createElement('template')
    template.innerHTML = html.trim()
    const element = template.content.querySelector<T>(selector)
    if (!element) {
      throw new Error(`Expected generated character workflow markup to contain ${selector}`)
    }
    return element
  }

  function requireCharacterWorkflowElement<T extends Element>(root: ParentNode, selector: string): T {
    const element = root.querySelector<T>(selector)
    if (!element) {
      throw new Error(`Expected character workflow DOM to contain ${selector}`)
    }
    return element
  }

  function updateCharacterWorkflowViewportDom(): void {
    const viewport = panel.querySelector<HTMLElement>('.chat-workflow-canvas-viewport.active')
    if (!viewport) {
      return
    }
    const plane = viewport.querySelector<HTMLElement>('.chat-resource-graph-plane')
    plane?.style.setProperty('--resource-zoom', String(characterResourceViewState.zoom))
    plane?.style.setProperty('--resource-pan-x', `${characterResourceViewState.panX}px`)
    plane?.style.setProperty('--resource-pan-y', `${characterResourceViewState.panY}px`)
    viewport.dataset.resourceViewport = JSON.stringify({
      x: characterResourceViewState.panX,
      y: characterResourceViewState.panY,
      zoom: characterResourceViewState.zoom,
    })
    panel.querySelectorAll<HTMLElement>('.chat-resource-zoom-label').forEach((label) => {
      label.textContent = `${Math.round(characterResourceViewState.zoom * 100)}%`
    })
  }

  async function renderCharacterWorkflowAsync(): Promise<void> {
    if (!characterWorkflowRoot) {
      return
    }
    const renderToken = ++characterWorkflowLazyRenderToken
    if (!characterWorkflowRoot.childElementCount) {
      characterWorkflowRoot.innerHTML = renderCharacterWorkflowLibraryShell(renderCharacterWorkflowLibraryEmptyState())
    }
    if (!characterWorkflowProjectsHydrated) {
      characterWorkflowRoot.innerHTML = renderCharacterWorkflowLibraryShell(renderCharacterWorkflowLibraryEmptyState())
      return
    }
    if (!activeCharacterWorkflowProjectId) {
      characterWorkflowRoot.innerHTML = renderCharacterWorkflowLibraryShell(renderCharacterWorkflowLibraryEmptyState())
      return
    }
    const activeProject = characterWorkflowProjects.find((project) => project.id === activeCharacterWorkflowProjectId)
    if (!activeProject) {
      activeCharacterWorkflowProjectId = ''
      characterWorkflowRoot.innerHTML = renderCharacterWorkflowLibraryShell(renderCharacterWorkflowLibraryEmptyState())
      return
    }
    const canRenderActiveProject = activeProject.loadState === 'ready' || (activeProject.loadState === 'ready-overview' && characterWorkflowActiveTabId !== 'run-draft')
    if (!canRenderActiveProject) {
      characterWorkflowRoot.innerHTML = renderCharacterWorkflowLibraryShell(renderCharacterWorkflowProjectLoadingState(activeProject), activeProject)
      return
    }
    if (!characterWorkflowContentLoaded) {
      characterWorkflowRoot.innerHTML = renderCharacterWorkflowLibraryShell(renderCharacterWorkflowLibraryEmptyState(), activeProject)
      return
    }
    const perfId = activeCharacterWorkflowPerfId
    if (perfId) markCharacterWorkflowPerf(perfId, 'before dynamic import')
    const workflowPage = await loadCharacterWorkflowPageModule()
    if (perfId) markCharacterWorkflowPerf(perfId, 'dynamic import complete')
    if (renderToken !== characterWorkflowLazyRenderToken) {
      return
    }
    if (perfId) markCharacterWorkflowPerf(perfId, 'before render markup')
    const workflowMarkup = workflowPage.renderCharacterWorkflowPage(createCharacterWorkflowPageOptions(activeProject))
    if (perfId) markCharacterWorkflowPerf(perfId, 'render markup complete')
    characterWorkflowRoot.innerHTML = renderCharacterWorkflowLibraryShell(workflowMarkup, activeProject)
    if (perfId) markCharacterWorkflowPerf(perfId, 'dom commit complete')
    workflowPage.initializeCharacterResourceWorkbench(characterWorkflowRoot)
    syncWorkflowAssistantStatusScroll()
    if (perfId) finishCharacterWorkflowPerf(perfId, 'workbench init complete')
  }

  function syncWorkflowAssistantStatusScroll(): void {
    if (!characterWorkflowAssistantStatusExpanded || !characterWorkflowRoot) {
      return
    }
    const statusBody = characterWorkflowRoot.querySelector<HTMLElement>('[data-chat-workflow-agent-records]')
    const latestRecord = statusBody?.querySelector<HTMLElement>('.chat-workflow-canvas-assistant-record.latest')
    if (!statusBody || !latestRecord) {
      return
    }
    window.requestAnimationFrame(() => {
      if (!statusBody.isConnected || !latestRecord.isConnected) {
        return
      }
      const latestHeight = Math.ceil(latestRecord.getBoundingClientRect().height)
      statusBody.style.setProperty('--workflow-agent-latest-height', `${latestHeight}px`)
      statusBody.scrollTop = statusBody.scrollHeight
    })
  }

  function renderCharacterWorkflowProjectLoadingState(project: CharacterWorkflowProjectRecord): string {
    const zh = options.getLanguage() === 'zh-CN'
    const failed = project.loadState === 'error'
    return `
      <section class="chat-workflow-builder-main">
        <div class="chat-workflow-builder-card">
          <div class="chat-workflow-builder-head">
            <span>${options.escapeHtml(zh ? 'Workflow' : 'Workflow')}</span>
            <strong>${options.escapeHtml(project.name)}</strong>
          </div>
          <div class="chat-workflow-builder-box">
            <div class="chat-workflow-builder-label">
              <strong>${options.escapeHtml(failed ? (zh ? '加载失败' : 'Failed to load') : (zh ? '正在加载项目内容' : 'Loading project detail'))}</strong>
              <span>${options.escapeHtml(failed ? (zh ? '请重新选择该资源图。' : 'Select this workflow again to retry.') : (zh ? '侧边栏已就绪，画布内容按需加载。' : 'Sidebar is ready. Canvas detail loads on demand.'))}</span>
            </div>
          </div>
        </div>
      </section>
    `
  }

  function createCharacterWorkflowPageOptions(activeProject: CharacterWorkflowProjectRecord): Parameters<CharacterWorkflowPageModule['renderCharacterWorkflowPage']>[0] {
    return {
      language: options.getLanguage(),
      escapeHtml: options.escapeHtml,
      t: options.t,
      modelChoices: getCharacterWorkflowModelChoices(),
      configOverrides: characterWorkflowConfigOverrides,
      positionOverrides: characterWorkflowPositionOverrides,
      runState: characterWorkflowRunState,
      runDrafts: activeProject.runs.map((run) => ({
        id: run.id,
        title: run.title,
        status: run.status,
        createdAt: run.createdAt,
        completedAt: run.completedAt,
      })),
      tabs: getCharacterWorkflowTabs(),
      activeTabId: characterWorkflowActiveTabId,
      selectedNodeId: selectedWorkflowNodeId,
      activePanel: characterWorkflowEditorState.activePanel,
      sidebarCollapsed: characterWorkflowEditorState.sidebarCollapsed,
      workflowLibraryCollapsed: characterWorkflowEditorState.workflowLibraryCollapsed,
      inspectorCollapsed: characterWorkflowEditorState.inspectorCollapsed,
      nodeSearchOpen: characterWorkflowEditorState.nodeSearchOpen,
      workflowAssistantHtml: characterWorkflowActiveTabId === 'workflow' ? renderCharacterWorkflowAssistant() : '',
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
    }
  }

  function getCharacterWorkflowTabs(): CharacterWorkflowFileTab[] {
    const activeWorkflow = characterWorkflowProjects.find((project) => project.id === activeCharacterWorkflowProjectId)
    const activeRun = characterWorkflowRunState?.run
    const runStatus = activeRun?.status
    const workflowState = runStatus === 'running'
      ? 'running'
      : runStatus === 'failed' || runStatus === 'needs_action'
        ? 'failed'
        : undefined
    const tabs: CharacterWorkflowFileTab[] = [{
      id: 'workflow',
      title: formatCharacterWorkflowFileTitle(activeWorkflow),
      kind: 'workflow',
      state: workflowState,
    }]
    if (activeRun) {
      tabs.push({
        id: 'run-draft',
        title: activeRun.title,
        kind: 'run',
        state: runStatus === 'running' ? 'running' : runStatus === 'failed' || runStatus === 'needs_action' ? 'failed' : undefined,
      })
    }
    return tabs
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
              <span>${options.escapeHtml(zh ? '运行草稿' : 'Run drafts')}</span>
              <small>${activeProject.runs.length}</small>
            </div>
            <div class="chat-workflow-library-run-list">
              ${activeProject.runs.length ? activeProject.runs.slice().reverse().map((run) => renderCharacterWorkflowRunRow(activeProject.id, run, zh)).join('') : `
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
            'character-card-target': { includeFields: ['name', 'description', 'appearance', 'personality', 'background', 'scenario', 'firstMessage', 'dialogueStyle', 'worldContext'], includeSupportFields: ['appearancePrompt'] },
            'opening-field-target': { fields: ['firstMessage'] },
            'opening-field-control': { lengthPolicy: 'medium' },
            'avatar-image-target': { imageRole: 'avatar', assetPurpose: 'Final avatar.jpg for the role card: one polished single-character role-card portrait with one clear face, visible body silhouette, strong appeal, and stable identity cues.' },
            'avatar-image-control': { targetImageCount: 1, imageStyleDomain: 'auto', shotType: 'knee-up', consistencyMode: 'same-character', seedMode: 'lock-character' },
            'overview-sheet-image-target': { imageRole: 'character-overview-sheet', assetPurpose: 'Generate one large production character overview sheet using linked avatar reference image inputs. Required contents: full-body front view, full-body back view, side or three-quarter view, one main portrait or half-body crop, 3 expression callouts, eye close-up, nose and mouth close-up, hairstyle detail, hand pose detail, leg shape close-up, hip and rear silhouette close-up, feet or shoes detail, outfit fabric, accessory, hemline, and silhouette details. Preserve avatar outfit construction unless explicitly requesting outfit variants. No written labels.' },
            'overview-sheet-image-control': { targetImageCount: 1, imageStyleDomain: 'auto', shotType: 'full-body', aspectRatio: '16:9', consistencyMode: 'same-character', seedMode: 'lock-character' },
            'opening-panel-image-target': { imageRole: 'character-base-image', assetPurpose: 'Free-form character sample images for the opening CSS panel. Use the avatar reference to preserve identity while showing distinct roleplay scenes, actions, moods, outfit usage, or prop interactions as panel visual material.' },
            'opening-panel-image-control': { targetImageCount: 2, imageStyleDomain: 'auto', shotType: 'auto', aspectRatio: '3:4', consistencyMode: 'same-character', seedMode: 'vary-slightly' },
            'opening-layout-target': { layoutKind: 'immersive-card-css', includeSections: ['title', 'tags', 'opening', 'coverImage', 'supportImages'], layoutPrompt: 'Create an immersive CSS-style opening card layout that combines the character title, tags, opening text, and generated images into one readable role-card presentation.' },
            'generation-strategy': { mode: 'branch-and-refine', branchCount: 3, priorityAssets: ['role-card', 'opening', 'opening-layout', 'image-pack'] },
            'quality-gate': { minimumScore: 0.84 },
          },
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
      <div class="chat-workflow-library-run-row ${run.id === characterWorkflowRunState?.run?.id ? 'active' : ''}">
        <button class="chat-workflow-library-run-open" type="button" data-chat-workflow-run-open="${options.escapeHtml(projectId)}:${options.escapeHtml(run.id)}">
          <span class="chat-workflow-library-run-status ${options.escapeHtml(run.status)}"></span>
          <span>
            <strong>${options.escapeHtml(run.title)}</strong>
            <small>${options.escapeHtml(`${run.status} · ${formatWorkflowProjectTime(run.completedAt ?? run.createdAt, zh)}`)}</small>
          </span>
        </button>
        <button class="chat-workflow-library-run-delete" type="button" data-chat-workflow-run-delete="${options.escapeHtml(projectId)}:${options.escapeHtml(run.id)}" aria-label="${options.escapeHtml(zh ? '删除运行草稿' : 'Delete run draft')}">x</button>
      </div>
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
    const statusLabel = zh ? 'Agent 记录' : 'Agent records'
    const copyLabel = zh ? '复制记录' : 'Copy records'
    const toggleLabel = characterWorkflowAssistantStatusExpanded
      ? (zh ? '收起记录' : 'Collapse records')
      : (zh ? '展开记录' : 'Expand records')
    const records = getWorkflowAssistantStatusRecords()
    const latestRecord = records[0]
    const previousRecords = characterWorkflowAssistantStatusExpanded ? records.slice(1, 8).reverse() : []
    const project = characterWorkflowProjects.find((item) => item.id === activeCharacterWorkflowProjectId)
    const session = normalizeCharacterWorkflowGoalSession(project?.goalSession)
    const pendingDecision = session?.pendingDecision
    const hasRecords = records.length > 0
    const canContinue = Boolean(session?.nextStep && !pendingDecision && session.status !== 'paused' && session.status !== 'blocked' && session.status !== 'complete' && !characterWorkflowBuilderBusy)
    const canPause = Boolean(session && session.status === 'active')
    const canResume = Boolean(session && session.status === 'paused' && !characterWorkflowBuilderBusy)
    const canStop = Boolean(session && session.status !== 'complete')
    return `
      <form class="chat-workflow-canvas-assistant ${characterWorkflowBuilderBusy ? 'is-busy' : ''}" data-chat-workflow-assistant-form>
        ${renderChatRuntimeModelPickerMarkup('workflow-assistant')}
        ${hasRecords ? `
          <section class="chat-workflow-canvas-assistant-status ${characterWorkflowAssistantStatusExpanded ? 'expanded' : ''}" aria-live="polite">
            <div class="chat-workflow-canvas-assistant-status-head">
              <span>${options.escapeHtml(`${statusLabel} · ${records.length}`)}</span>
              <div class="chat-workflow-canvas-assistant-status-actions">
                <button type="button" data-chat-workflow-assistant-status-action="continue" aria-label="${options.escapeHtml(zh ? '继续下一步' : 'Continue next step')}" title="${options.escapeHtml(zh ? '继续下一步' : 'Continue next step')}" ${canContinue ? '' : 'disabled'}>${options.escapeHtml(zh ? '继续' : 'Next')}</button>
                <button type="button" data-chat-workflow-assistant-status-action="pause" aria-label="${options.escapeHtml(zh ? '暂停目标' : 'Pause goal')}" title="${options.escapeHtml(zh ? '暂停目标' : 'Pause goal')}" ${canPause ? '' : 'disabled'}>${options.escapeHtml(zh ? '暂停' : 'Pause')}</button>
                <button type="button" data-chat-workflow-assistant-status-action="resume" aria-label="${options.escapeHtml(zh ? '恢复目标' : 'Resume goal')}" title="${options.escapeHtml(zh ? '恢复目标' : 'Resume goal')}" ${canResume ? '' : 'disabled'}>${options.escapeHtml(zh ? '恢复' : 'Resume')}</button>
                <button type="button" data-chat-workflow-assistant-status-action="stop" aria-label="${options.escapeHtml(zh ? '停止目标' : 'Stop goal')}" title="${options.escapeHtml(zh ? '停止目标' : 'Stop goal')}" ${canStop ? '' : 'disabled'}>${options.escapeHtml(zh ? '停止' : 'Stop')}</button>
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
            <div class="chat-workflow-canvas-assistant-status-body" data-chat-workflow-agent-records>
              ${latestRecord ? `
                ${previousRecords.map((record, index) => renderWorkflowAssistantStatusRecord(record, 'previous', index + 1)).join('')}
                ${renderWorkflowAssistantStatusRecord(latestRecord, 'latest', 0)}
              ` : ''}
            </div>
          </section>
        ` : ''}
        ${pendingDecision ? `
          <section class="chat-workflow-canvas-assistant-decision" aria-live="polite">
            <header>
              <span>${options.escapeHtml(zh ? '需要选择' : 'Decision needed')}</span>
              <strong>${options.escapeHtml(pendingDecision.title)}</strong>
            </header>
            ${pendingDecision.description ? `<p>${options.escapeHtml(pendingDecision.description)}</p>` : ''}
            <div class="chat-workflow-canvas-assistant-decision-options">
              ${pendingDecision.options.map((optionItem) => `
                <button type="button" data-chat-workflow-decision-option="${options.escapeHtml(optionItem.id)}" ${characterWorkflowBuilderBusy ? 'disabled' : ''}>
                  <strong>${options.escapeHtml(optionItem.label)}</strong>
                  ${optionItem.detail ? `<span>${options.escapeHtml(optionItem.detail)}</span>` : ''}
                </button>
              `).join('')}
              ${pendingDecision.allowSkip ? `
                <button type="button" class="secondary" data-chat-workflow-decision-option="__skip" ${characterWorkflowBuilderBusy ? 'disabled' : ''}>
                  <strong>${options.escapeHtml(zh ? '交给 Agent 决定' : 'Let agent decide')}</strong>
                  <span>${options.escapeHtml(zh ? '继续使用合理默认偏好编辑资源图' : 'Continue with a reasonable default editing preference')}</span>
                </button>
              ` : ''}
            </div>
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

  function renderWorkflowAssistantStatusRecord(
    record: { title: string; meta: string; body: string },
    role: 'latest' | 'previous',
    index: number
  ): string {
    return `
      <article class="chat-workflow-canvas-assistant-record ${role}" style="--workflow-agent-record-index: ${index}">
        <header>
          <strong>${options.escapeHtml(record.title)}</strong>
          <span>${options.escapeHtml(record.meta)}</span>
        </header>
        <p>${options.escapeHtml(record.body)}</p>
      </article>
    `
  }

  function getWorkflowAssistantStatusRecords(): Array<{ title: string; meta: string; body: string }> {
    const zh = options.getLanguage() === 'zh-CN'
    const project = characterWorkflowProjects.find((item) => item.id === activeCharacterWorkflowProjectId)
    const session = normalizeCharacterWorkflowGoalSession(project?.goalSession)
    const records = (session?.history ?? []).map((item, index) => ({
      title: item.stepIndex
        ? `${zh ? '步骤' : 'Step'} ${item.stepIndex}`
        : `${zh ? '交互' : 'Turn'} ${index + 1}`,
      meta: [
        item.status || 'applied',
        item.tool || '',
        item.operations ? `${item.operations} ${zh ? '项修改' : 'edits'}` : '',
        formatWorkflowProjectTime(item.createdAt, zh),
      ].filter(Boolean).join(' · '),
      body: [
        item.currentStep ? `${zh ? '当前' : 'Current'}: ${item.currentStep}` : '',
        item.summary || item.userRequest,
        item.nextStep ? `${zh ? '下一步' : 'Next'}: ${item.nextStep}` : '',
      ].filter(Boolean).join('\n'),
    })).filter((item) => item.body.trim())
    const current = characterWorkflowBuilderStatus.trim()
    if (current && !records.some((item) => item.body === current)) {
      records.push({
        title: zh ? '当前状态' : 'Current status',
        meta: characterWorkflowBuilderBusy ? (zh ? '运行中' : 'running') : (zh ? '最新' : 'latest'),
        body: current,
      })
    }
    return records.slice(-8).reverse()
  }

  function getWorkflowAssistantStatusText(): string {
    return getWorkflowAssistantStatusRecords()
      .map((record) => [`${record.title} · ${record.meta}`, record.body].filter(Boolean).join('\n'))
      .join('\n\n')
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

  function cloneCharacterWorkflowRunState(runState: CharacterResourceRunState): CharacterResourceRunState {
    return JSON.parse(JSON.stringify(runState)) as CharacterResourceRunState
  }

  function mergeCharacterWorkflowRunArtifacts(
    existing: NonNullable<CharacterResourceRunState['artifacts']>,
    incoming: NonNullable<CharacterResourceRunState['artifacts']>,
    scopedRun?: CharacterWorkflowScopedRunRequest,
    scopedSucceeded = false
  ): NonNullable<CharacterResourceRunState['artifacts']> {
    const existingIds = new Set(existing.map((artifact) => artifact.id || '').filter(Boolean))
    const successfulScopedTargetIds = scopedRun && scopedSucceeded
      ? new Set(incoming
        .filter((artifact) => artifact.type === 'image-asset')
        .map(getRunImageArtifactTargetNodeId)
        .filter(Boolean))
      : new Set<string>()
    const merged = existing
      .filter((artifact) => {
        if (!successfulScopedTargetIds.size) {
          return true
        }
        if (!isFailedRunImageAttempt(artifact)) {
          return true
        }
        return !successfulScopedTargetIds.has(getRunImageArtifactTargetNodeId(artifact))
      })
      .map((artifact) => ({ ...artifact }))
    for (const artifact of incoming) {
      if (
        successfulScopedTargetIds.size
        && existingIds.has(artifact.id || '')
        && isFailedRunImageAttempt(artifact)
        && successfulScopedTargetIds.has(getRunImageArtifactTargetNodeId(artifact))
      ) {
        continue
      }
      const index = artifact.id ? merged.findIndex((item) => item.id === artifact.id) : -1
      if (index >= 0) {
        merged[index] = artifact
      } else {
        merged.push(artifact)
      }
    }
    return pruneSupersededFailedImageAttempts(merged)
  }

  function isFailedRunImageAttempt(artifact: NonNullable<CharacterResourceRunState['artifacts']>[number]): boolean {
    const data = artifact.data && typeof artifact.data === 'object' && !Array.isArray(artifact.data)
      ? artifact.data as Record<string, unknown>
      : {}
    return artifact.type === 'image-attempt' && data.status === 'failed'
  }

  function pruneSupersededFailedImageAttempts(
    artifacts: NonNullable<CharacterResourceRunState['artifacts']>
  ): NonNullable<CharacterResourceRunState['artifacts']> {
    const successfulImageTargets = new Set(artifacts
      .filter((artifact) => artifact.type === 'image-asset')
      .map(getRunImageArtifactTargetNodeId)
      .filter(Boolean))
    if (!successfulImageTargets.size) {
      return artifacts
    }
    return artifacts.filter((artifact) => (
      !isFailedRunImageAttempt(artifact) || !successfulImageTargets.has(getRunImageArtifactTargetNodeId(artifact))
    ))
  }

  function getLatestScopedImageArtifactNodeId(
    artifacts: NonNullable<CharacterResourceRunState['artifacts']>,
    scopedRun: CharacterWorkflowScopedRunRequest | undefined
  ): string {
    if (!scopedRun) {
      return ''
    }
    const targetIds = new Set(scopedRun.scope.targetNodeIds ?? [])
    const latest = [...artifacts].reverse().find((artifact) => (
      artifact.type === 'image-asset'
      && (!targetIds.size || targetIds.has(getRunImageArtifactTargetNodeId(artifact)))
    ))
    return latest?.id ? `run-artifact-${sanitizeRunResourceId(latest.id)}` : ''
  }

  function sanitizeRunResourceId(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || `resource-${Date.now()}`
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

  function createDefaultWorkflowProjectViewState(): CharacterWorkflowProjectViewState {
    return {
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
      addedNodes: [],
      nodeSizes: {},
      linkKinds: {},
      customLinks: [],
      deletedLinkIds: [],
      replacedTargetSlots: [],
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

  function applyCharacterWorkflowProjectState(project: CharacterWorkflowProjectRecord, options: { includeRunState?: boolean } = {}): void {
    replaceRecord(characterWorkflowConfigOverrides, cloneRecord(project.configOverrides ?? {}))
    replaceRecord(characterWorkflowPositionOverrides, cloneRecord(project.positionOverrides ?? {}))
    applyWorkflowProjectViewState(project.viewState)
    characterWorkflowRunCount = Math.max(0, Math.round(Number(project.runCount) || 0))
    const selectedRunState = project.runs.find((run) => run.id === project.activeRunId)?.runState
      ?? project.runs[project.runs.length - 1]?.runState
      ?? null
    const selectedRunId = selectedRunState?.run?.id ?? project.activeRunId ?? project.runs[project.runs.length - 1]?.id ?? ''
    if (options.includeRunState) {
      const liveRunState = getExecutingWorkflowRunState(project.id, selectedRunId)
      characterWorkflowRunState = liveRunState
        ? cloneCharacterWorkflowRunState(liveRunState)
        : normalizePersistedCharacterWorkflowRunState(selectedRunState, true, project.id)
    } else {
      characterWorkflowRunState = null
    }
  }

  function saveActiveWorkflowProjectSnapshot(markDirty = true, immediate = false): void {
    const project = characterWorkflowProjects.find((item) => item.id === activeCharacterWorkflowProjectId)
    if (!project) {
      return
    }
    if (project.loadState !== 'ready' && project.loadState !== 'ready-overview') {
      return
    }
    if (characterWorkflowRunState) {
      upsertWorkflowProjectRunState(project, characterWorkflowRunState)
    }
    project.configOverrides = cloneRecord(characterWorkflowConfigOverrides)
    project.positionOverrides = cloneRecord(characterWorkflowPositionOverrides)
    project.viewState = createWorkflowProjectViewState()
    project.runCount = characterWorkflowRunCount
    project.activeRunId = characterWorkflowRunState?.run?.id
    project.updatedAt = Date.now()
    persistCharacterWorkflowProject(project, immediate)
    if (markDirty) {
      markActiveWorkflowDirty()
    }
  }

  function upsertWorkflowProjectRunState(project: CharacterWorkflowProjectRecord, runState: CharacterResourceRunState): void {
    if (!runState.run) {
      return
    }
    const normalizedRunState = normalizePersistedCharacterWorkflowRunState(runState, false)
    const run = normalizedRunState.run
    if (!run) {
      return
    }
    const existingIndex = project.runs.findIndex((item) => item.id === run.id)
    const existing = existingIndex >= 0 ? project.runs[existingIndex] : undefined
    const now = Date.now()
    const runRecord: CharacterWorkflowProjectRunRecord = {
      id: run.id,
      title: run.title,
      status: run.status,
      createdAt: existing?.createdAt ?? now,
      completedAt: run.status === 'done' || run.status === 'failed' || run.status === 'needs_action' ? existing?.completedAt ?? now : existing?.completedAt,
      runState: cloneCharacterWorkflowRunState(normalizedRunState),
    }
    if (existingIndex >= 0) {
      project.runs[existingIndex] = runRecord
    } else {
      project.runs.push(runRecord)
    }
  }

  function syncExecutingWorkflowRunState(immediate = false): void {
    if (!characterWorkflowExecutingRunState?.run || !characterWorkflowExecutingProjectId) {
      return
    }
    const project = characterWorkflowProjects.find((item) => item.id === characterWorkflowExecutingProjectId)
    if (!project) {
      return
    }
    upsertWorkflowProjectRunState(project, characterWorkflowExecutingRunState)
    if (isViewingWorkflowRun(project.id, characterWorkflowExecutingRunState.run.id)) {
      project.activeRunId = characterWorkflowExecutingRunState.run.id
    }
    project.runCount = Math.max(project.runCount, characterWorkflowRunCount)
    project.updatedAt = Date.now()
    persistCharacterWorkflowProject(project, immediate)
  }

  function cancelExecutingWorkflowRun(projectId?: string, runId?: string): boolean {
    if (!characterWorkflowExecutingRunState?.run || !characterWorkflowExecutingProjectId) {
      return false
    }
    if (projectId && characterWorkflowExecutingProjectId !== projectId) {
      return false
    }
    if (runId && characterWorkflowExecutingRunState.run.id !== runId) {
      return false
    }
    const currentStepId = characterWorkflowExecutingRunState.run.currentStepId
    characterWorkflowExecutingRunState = {
      ...characterWorkflowExecutingRunState,
      run: {
        ...characterWorkflowExecutingRunState.run,
        status: 'canceled',
      },
      steps: (characterWorkflowExecutingRunState.steps ?? []).map((step) => (
        step.id === currentStepId
          ? {
              ...step,
              status: 'failed',
              detail: options.getLanguage() === 'zh-CN' ? '已手动停止。' : 'Stopped manually.',
            }
          : step
      )),
    }
    const canceledProjectId = characterWorkflowExecutingProjectId
    const canceledRunState = characterWorkflowExecutingRunState
    const canceledRunId = canceledRunState.run.id
    syncExecutingWorkflowRunState(true)
    syncVisibleWorkflowRunState(canceledProjectId, canceledRunState)
    characterWorkflowExecutingRunState = null
    characterWorkflowExecutingProjectId = ''
    characterWorkflowRenderToken += 1
    return isViewingWorkflowRun(canceledProjectId, canceledRunId)
  }

  function isViewingWorkflowRun(projectId: string, runId: string): boolean {
    return activeCharacterWorkflowProjectId === projectId
      && characterWorkflowActiveTabId === 'run-draft'
      && characterWorkflowRunState?.run?.id === runId
  }

  function syncVisibleWorkflowRunState(projectId: string, runState: CharacterResourceRunState): void {
    const runId = runState.run?.id
    if (!runId || !isViewingWorkflowRun(projectId, runId)) {
      return
    }
    characterWorkflowRunState = cloneCharacterWorkflowRunState(runState)
  }

  function isExecutingWorkflowRun(projectId: string, runId: string): boolean {
    if (!runId || !characterWorkflowExecutingRunState?.run) {
      return false
    }
    return characterWorkflowExecutingRunState.run.id === runId
      && (!projectId || !characterWorkflowExecutingProjectId || characterWorkflowExecutingProjectId === projectId)
  }

  function getExecutingWorkflowRunState(projectId: string, runId: string): CharacterResourceRunState | null {
    return isExecutingWorkflowRun(projectId, runId) && characterWorkflowExecutingRunState
      ? characterWorkflowExecutingRunState
      : null
  }

  function normalizePersistedCharacterWorkflowRunState(
    runState: CharacterResourceRunState | undefined | null,
    finalizeRunning = true,
    projectId = ''
  ): CharacterResourceRunState | null {
    if (!runState || typeof runState !== 'object') {
      return null
    }
    const normalized = cloneCharacterWorkflowRunState(runState)
    const isCurrentlyExecutingRun = isExecutingWorkflowRun(projectId, normalized.run?.id ?? '')
    if (finalizeRunning && normalized.run?.status === 'running' && !isCurrentlyExecutingRun) {
      const interruptedSummary = options.getLanguage() === 'zh-CN'
        ? '上次运行在完成前中断，已自动标记为失败。'
        : 'The previous run was interrupted before completion and was marked failed.'
      normalized.run = {
        ...normalized.run,
        status: 'failed',
      }
      const currentStepId = normalized.run.currentStepId
      normalized.steps = (normalized.steps ?? []).map((step) => {
        if (step.status === 'running' || step.id === currentStepId) {
          return {
            ...step,
            status: 'failed',
            detail: step.detail || interruptedSummary,
          }
        }
        return step
      })
      normalized.events = [
        ...(normalized.events ?? []),
        {
          type: 'run.interrupted',
          timestamp: Date.now(),
          status: 'failed',
          summary: interruptedSummary,
        },
      ]
    }
    return normalized
  }

  function normalizePersistedCharacterWorkflowProject(project: CharacterWorkflowProjectRecord): CharacterWorkflowProjectRecord {
    const runs = (Array.isArray(project.runs) ? project.runs : []).flatMap((run): CharacterWorkflowProjectRunRecord[] => {
      const runId = run.runState?.run?.id ?? run.id
      const liveRunState = getExecutingWorkflowRunState(project.id, runId)
      const runState = liveRunState
        ? cloneCharacterWorkflowRunState(liveRunState)
        : normalizePersistedCharacterWorkflowRunState(run.runState, true, project.id)
      const stateRun = runState?.run
      if (!stateRun) {
        return []
      }
      const status = stateRun.status
      return [{
        ...run,
        id: stateRun.id || run.id,
        title: stateRun.title || run.title,
        status,
        completedAt: status === 'done' || status === 'failed' || status === 'needs_action' ? run.completedAt ?? Date.now() : run.completedAt,
        runState,
      }]
    })
    const activeRunId = runs.some((run) => run.id === project.activeRunId)
      ? project.activeRunId
      : runs[runs.length - 1]?.id
    return {
      ...project,
      schemaVersion: Math.max(1, Math.round(Number(project.schemaVersion) || 1)),
      loadState: 'ready',
      configOverrides: cloneRecord(project.configOverrides ?? {}),
      positionOverrides: cloneRecord(project.positionOverrides ?? {}),
      viewState: project.viewState ?? createDefaultWorkflowProjectViewState(),
      runCount: Math.max(Number(project.runCount) || 0, runs.length),
      activeRunId,
      runs,
      goalSession: normalizeCharacterWorkflowGoalSession(project.goalSession),
    }
  }

  function selectRicherWorkflowRunRecord(
    candidate: CharacterWorkflowProjectRunRecord,
    fallback: CharacterWorkflowProjectRunRecord | undefined
  ): CharacterWorkflowProjectRunRecord {
    if (!fallback) {
      return candidate
    }
    return workflowRunRecordPayloadScore(fallback) > workflowRunRecordPayloadScore(candidate)
      ? fallback
      : candidate
  }

  function workflowRunRecordPayloadScore(run: CharacterWorkflowProjectRunRecord | undefined): number {
    const runState = run?.runState
    if (!runState?.run) {
      return 0
    }
    return 1
      + ((runState.steps ?? []).length * 2)
      + ((runState.events ?? []).length * 2)
      + ((runState.artifacts ?? []).length * 4)
  }

  function createIndexedCharacterWorkflowProject(item: {
    id: string
    name: string
    schemaVersion?: number
    createdAt: number
    updatedAt: number
    activeRunId?: string
    runCount: number
  }): CharacterWorkflowProjectRecord {
    return {
      id: item.id,
      name: item.name,
      schemaVersion: item.schemaVersion,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      loadState: 'index',
      configOverrides: {},
      positionOverrides: {},
      viewState: createDefaultWorkflowProjectViewState(),
      runCount: item.runCount,
      activeRunId: item.activeRunId,
      runs: [],
    }
  }

  async function ensureCharacterWorkflowProjectDetailLoaded(projectId: string, options: { includeRuns?: boolean } = {}): Promise<CharacterWorkflowProjectRecord | null> {
    const includeRuns = Boolean(options.includeRuns)
    const perfId = activeCharacterWorkflowPerfId
    const existing = characterWorkflowProjects.find((project) => project.id === projectId)
    if (!existing) {
      return null
    }
    if (existing.loadState === 'ready' || (!includeRuns && existing.loadState === 'ready-overview')) {
      if (perfId) markCharacterWorkflowPerf(perfId, 'project detail already ready')
      return existing
    }
    const promiseKey = `${projectId}:${includeRuns ? 'full' : 'overview'}`
    const currentPromise = characterWorkflowProjectDetailPromises.get(promiseKey)
    if (currentPromise) {
      if (perfId) markCharacterWorkflowPerf(perfId, 'reuse project detail promise')
      return currentPromise
    }
    existing.loadState = 'loading-detail'
    if (perfId) markCharacterWorkflowPerf(perfId, 'before getProject IPC')
    const promise = (includeRuns
      ? window.electronAPI.getCharacterWorkflowProject(projectId)
      : window.electronAPI.getCharacterWorkflowProjectOverview(projectId))
      .then((detailResponse) => {
        if (perfId) markCharacterWorkflowPerf(perfId, includeRuns ? 'getProject IPC complete' : 'getProjectOverview IPC complete')
        if (!detailResponse.success) {
          throw new Error(detailResponse.error || 'Failed to load character workflow project')
        }
        const payload = detailResponse.project?.payload
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          throw new Error('Character workflow project payload is missing')
        }
        if (perfId) markCharacterWorkflowPerf(perfId, 'before normalize project')
        const normalized = normalizePersistedCharacterWorkflowProject(payload as CharacterWorkflowProjectRecord)
        normalized.loadState = includeRuns ? 'ready' : 'ready-overview'
        if (perfId) markCharacterWorkflowPerf(perfId, 'normalize project complete')
        const index = characterWorkflowProjects.findIndex((project) => project.id === projectId)
        if (index >= 0) {
          characterWorkflowProjects[index] = normalized
        }
        if (perfId) markCharacterWorkflowPerf(perfId, 'project state replaced')
        return normalized
      })
      .catch((error) => {
        const project = characterWorkflowProjects.find((item) => item.id === projectId)
        if (project) {
          project.loadState = 'error'
        }
        console.warn('[CharacterWorkflowStore] Failed to load workflow project detail:', error)
        throw error
      })
      .finally(() => {
        characterWorkflowProjectDetailPromises.delete(promiseKey)
      })
    characterWorkflowProjectDetailPromises.set(promiseKey, promise)
    return promise
  }

  function normalizeCharacterWorkflowGoalSession(session: CharacterWorkflowGoalSession | undefined): CharacterWorkflowGoalSession | undefined {
    if (!session || typeof session !== 'object') {
      return undefined
    }
    const status = session.status === 'paused' || session.status === 'needs-user' || session.status === 'blocked' || session.status === 'complete'
      ? session.status
      : 'active'
    return {
      objective: typeof session.objective === 'string' ? session.objective : '',
      plan: Array.isArray(session.plan) ? session.plan.filter((item): item is string => typeof item === 'string') : [],
      completedSteps: Array.isArray(session.completedSteps) ? session.completedSteps.filter((item): item is string => typeof item === 'string') : [],
      currentStep: typeof session.currentStep === 'string' ? session.currentStep : undefined,
      nextStep: typeof session.nextStep === 'string' ? session.nextStep : undefined,
      status,
      pendingDecision: normalizeWorkflowAgentDecision((session as CharacterWorkflowGoalSession & { pendingDecision?: unknown }).pendingDecision),
      history: Array.isArray(session.history)
        ? session.history.flatMap((item): CharacterWorkflowGoalSession['history'] => {
          if (!item || typeof item !== 'object') return []
          const record = item as CharacterWorkflowGoalSession['history'][number]
          return [{
            id: typeof record.id === 'string' ? record.id : undefined,
            stepIndex: Math.max(0, Math.round(Number(record.stepIndex) || 0)) || undefined,
            tool: typeof record.tool === 'string' ? record.tool : undefined,
            userRequest: typeof record.userRequest === 'string' ? record.userRequest : '',
            summary: typeof record.summary === 'string' ? record.summary : '',
            status: typeof record.status === 'string' ? record.status : 'applied',
            operations: Math.max(0, Math.round(Number(record.operations) || 0)),
            currentStep: typeof record.currentStep === 'string' ? record.currentStep : undefined,
            nextStep: typeof record.nextStep === 'string' ? record.nextStep : undefined,
            createdAt: Math.max(0, Math.round(Number(record.createdAt) || Date.now())),
          }]
        }).slice(-12)
        : [],
      updatedAt: Math.max(0, Math.round(Number(session.updatedAt) || Date.now())),
    }
  }

  function normalizeWorkflowAgentDecision(value: unknown): CharacterWorkflowAgentDecision | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined
    }
    const record = value as Record<string, unknown>
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    const rawOptions = Array.isArray(record.options) ? record.options : []
    const decisionOptions = rawOptions.flatMap((item, index): CharacterWorkflowAgentDecisionOption[] => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return []
      }
      const option = item as Record<string, unknown>
      const label = typeof option.label === 'string' ? option.label.trim() : ''
      if (!label) {
        return []
      }
      return [{
        id: typeof option.id === 'string' && option.id.trim() ? option.id.trim() : `option-${index + 1}`,
        label,
        detail: typeof option.detail === 'string' && option.detail.trim() ? option.detail.trim() : undefined,
        patchHint: typeof option.patchHint === 'string' && option.patchHint.trim() ? option.patchHint.trim() : undefined,
      }]
    }).slice(0, 6)
    if (!title || decisionOptions.length < 2) {
      return undefined
    }
    const defaultOptionId = typeof record.defaultOptionId === 'string' ? record.defaultOptionId.trim() : ''
    return {
      id: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `decision-${Date.now()}`,
      title,
      description: typeof record.description === 'string' && record.description.trim() ? record.description.trim() : undefined,
      options: decisionOptions,
      defaultOptionId: decisionOptions.some((option) => option.id === defaultOptionId) ? defaultOptionId : decisionOptions[0]?.id,
      allowSkip: typeof record.allowSkip === 'boolean' ? record.allowSkip : true,
    }
  }

  function clearCharacterWorkflowTransientStatus(options: { clearBuilderPrompt?: boolean; clearAssistantPrompt?: boolean } = {}): void {
    characterWorkflowBuilderStatus = ''
    if (options.clearBuilderPrompt) {
      characterWorkflowBuilderPrompt = ''
    }
    if (options.clearAssistantPrompt ?? true) {
      characterWorkflowAssistantPrompt = ''
    }
  }

  async function createCharacterWorkflowDraft(): Promise<void> {
    await ensureChatResourcesHydrated()
    saveActiveWorkflowProjectSnapshot(false, true)
    characterWorkflowTemplateMenuOpen = false
    clearCharacterWorkflowTransientStatus({ clearAssistantPrompt: true })
    createCharacterWorkflowDraftFromSpec({})
  }

  async function createCharacterWorkflowDraftFromTemplate(templateId: string): Promise<void> {
    await ensureChatResourcesHydrated()
    const template = getCharacterWorkflowTemplates(options.getLanguage() === 'zh-CN')
      .find((item) => item.id === templateId)
    if (!template) {
      return
    }
    saveActiveWorkflowProjectSnapshot()
    characterWorkflowTemplateMenuOpen = false
    clearCharacterWorkflowTransientStatus({ clearAssistantPrompt: true })
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
    agentWork?: {
      objective: string
      status: 'active' | 'needs-user' | 'blocked' | 'complete'
      plan: string[]
      completedSteps: string[]
      currentStep?: string
      nextStep?: string
      updatedAt: number
      steps: Array<{
        id: string
        index: number
        tool?: string
        userRequest: string
        summary: string
        status: string
        operations: Array<Record<string, unknown>>
        uiConfigOverrides: Record<string, Record<string, unknown>>
        currentStep?: string
        nextStep?: string
        createdAt: number
      }>
    }
  }): void {
    const now = Date.now()
    const configOverrides: Record<string, Record<string, unknown>> = Object.fromEntries(
      Object.entries(cloneRecord(spec.configOverrides ?? {})).map(([nodeId, config]) => [nodeId, deriveCharacterWorkflowConfig(config)])
    )
    const operationPatch = createInitialWorkflowPatchFromOperations(spec.operations ?? [])
    for (const [nodeId, config] of Object.entries(operationPatch.configOverrides)) {
      configOverrides[nodeId] = {
        ...(configOverrides[nodeId] ?? {}),
        ...deriveCharacterWorkflowConfig(config),
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
        notes: spec.sourceNotes,
        materials: [],
      }
    }
    const project: CharacterWorkflowProjectRecord = {
      id: `workflow-draft-${now}-${Math.random().toString(16).slice(2)}`,
      name: spec.name || (options.getLanguage() === 'zh-CN' ? `角色草稿 ${characterWorkflowProjects.length + 1}` : `Character Draft ${characterWorkflowProjects.length + 1}`),
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      loadState: 'ready',
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
      goalSession: spec.agentWork ? createWorkflowGoalSessionFromAgentWork(spec.agentWork, spec.name || '') : undefined,
    }
    characterWorkflowProjects = [project, ...characterWorkflowProjects]
    activeCharacterWorkflowProjectId = project.id
    characterWorkflowActiveTabId = 'workflow'
    clearCharacterWorkflowTransientStatus({ clearBuilderPrompt: false, clearAssistantPrompt: true })
    applyCharacterWorkflowProjectState(project)
    persistCharacterWorkflowProject(project)
    renderCharacterWorkflow()
    if (ensureWorkflowConversation()) {
      characterWorkflowDirty = true
      persistActiveConversationWorkflowState()
    }
  }

  function createWorkflowGoalSessionFromAgentWork(agentWork: {
    objective: string
    status: 'active' | 'needs-user' | 'blocked' | 'complete'
    plan: string[]
    completedSteps: string[]
    currentStep?: string
    nextStep?: string
    decision?: CharacterWorkflowAgentDecision
    updatedAt: number
    steps: Array<{
      id: string
      index: number
      tool?: string
      userRequest: string
      summary: string
      status: string
      operations: Array<Record<string, unknown>>
      uiConfigOverrides: Record<string, Record<string, unknown>>
      currentStep?: string
      nextStep?: string
      decision?: CharacterWorkflowAgentDecision
      createdAt: number
    }>
  }, fallbackObjective: string): CharacterWorkflowGoalSession {
    const lastDecision = normalizeWorkflowAgentDecision(agentWork.decision ?? agentWork.steps[agentWork.steps.length - 1]?.decision)
    return {
      objective: agentWork.objective || fallbackObjective,
      plan: Array.isArray(agentWork.plan) ? agentWork.plan.filter((item): item is string => typeof item === 'string') : [],
      completedSteps: Array.isArray(agentWork.completedSteps) ? agentWork.completedSteps.filter((item): item is string => typeof item === 'string') : [],
      currentStep: agentWork.currentStep,
      nextStep: agentWork.nextStep,
      status: agentWork.status,
      pendingDecision: agentWork.status === 'needs-user' ? lastDecision : undefined,
      history: agentWork.steps.map((step) => ({
        id: step.id,
        stepIndex: step.index,
        tool: step.tool,
        userRequest: step.userRequest,
        summary: step.summary,
        status: step.status,
        operations: step.operations.length + Object.keys(step.uiConfigOverrides ?? {}).length,
        currentStep: step.currentStep,
        nextStep: step.nextStep,
        createdAt: step.createdAt || Date.now(),
      })).slice(-16),
      updatedAt: Math.max(0, Math.round(Number(agentWork.updatedAt) || Date.now())),
    }
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
            ...deriveCharacterWorkflowConfig(operation.config as Record<string, unknown>),
          }
        }
      } else if (type === 'update-node-config') {
        const nodeId = typeof operation.nodeId === 'string' ? operation.nodeId.trim() : ''
        if (!nodeId || !operation.config || typeof operation.config !== 'object' || Array.isArray(operation.config)) continue
        configOverrides[nodeId] = {
          ...(configOverrides[nodeId] ?? {}),
          ...deriveCharacterWorkflowConfig(operation.config as Record<string, unknown>),
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

  function getActiveWorkflowGoalSession(userPrompt: string): CharacterWorkflowGoalSession | undefined {
    const project = characterWorkflowProjects.find((item) => item.id === activeCharacterWorkflowProjectId)
    if (!project) {
      return undefined
    }
    const existing = normalizeCharacterWorkflowGoalSession(project.goalSession)
    if (existing?.objective) {
      project.goalSession = existing
      return existing
    }
    const now = Date.now()
    const created: CharacterWorkflowGoalSession = {
      objective: userPrompt,
      plan: [],
      completedSteps: [],
      status: 'active',
      history: [],
      updatedAt: now,
    }
    project.goalSession = created
    return created
  }

  function updateActiveWorkflowGoalSession(
    userPrompt: string,
    response: {
      spec?: {
        summary?: string
        plan?: string[]
        completedSteps?: string[]
        currentStep?: string
        nextStep?: string
        decision?: CharacterWorkflowAgentDecision
        status?: string
        operations?: Array<Record<string, unknown>>
      }
      uiConfigOverrides?: Record<string, Record<string, unknown>>
      agentWork?: {
        id: string
        mode?: 'create' | 'edit'
        objective: string
        status: 'active' | 'needs-user' | 'blocked' | 'complete'
        plan: string[]
        completedSteps: string[]
        currentStep?: string
        nextStep?: string
        decision?: CharacterWorkflowAgentDecision
        updatedAt: number
        steps: Array<{
          id: string
          index: number
          tool?: string
          userRequest: string
          summary: string
          status: string
          operations: Array<Record<string, unknown>>
          uiConfigOverrides: Record<string, Record<string, unknown>>
          currentStep?: string
          nextStep?: string
          decision?: CharacterWorkflowAgentDecision
          createdAt: number
        }>
      }
    }
  ): void {
    const project = characterWorkflowProjects.find((item) => item.id === activeCharacterWorkflowProjectId)
    if (!project) {
      return
    }
    const current = getActiveWorkflowGoalSession(userPrompt)
    if (!current) {
      return
    }
    const spec = response.spec ?? {}
    const agentWork = response.agentWork
    if (agentWork) {
      const status = agentWork.status === 'complete' ? 'complete' : agentWork.status
      const lastDecision = normalizeWorkflowAgentDecision(agentWork.decision ?? agentWork.steps[agentWork.steps.length - 1]?.decision)
      project.goalSession = {
        ...current,
        objective: agentWork.objective || current.objective,
        plan: Array.isArray(agentWork.plan) ? agentWork.plan.filter((item): item is string => typeof item === 'string') : current.plan,
        completedSteps: Array.isArray(agentWork.completedSteps) ? agentWork.completedSteps.filter((item): item is string => typeof item === 'string') : current.completedSteps,
        currentStep: typeof agentWork.currentStep === 'string' && agentWork.currentStep.trim() ? agentWork.currentStep.trim() : current.currentStep,
        nextStep: typeof agentWork.nextStep === 'string' && agentWork.nextStep.trim() ? agentWork.nextStep.trim() : undefined,
        status,
        pendingDecision: status === 'needs-user' ? lastDecision : undefined,
        history: [
          ...dedupeWorkflowGoalHistory([
            ...current.history,
            ...agentWork.steps.map((step) => ({
            id: step.id,
            stepIndex: step.index,
            tool: step.tool,
            userRequest: step.userRequest || userPrompt,
            summary: step.summary,
            status: step.status,
            operations: step.operations.length + Object.keys(step.uiConfigOverrides ?? {}).length,
            currentStep: step.currentStep,
            nextStep: step.nextStep,
            createdAt: step.createdAt || Date.now(),
          })),
          ]),
        ].slice(-16),
        updatedAt: Math.max(0, Math.round(Number(agentWork.updatedAt) || Date.now())),
      }
      return
    }
    const status = spec.status === 'needs-user'
      ? 'needs-user'
      : spec.status === 'blocked'
        ? 'blocked'
        : 'active'
    const operationCount = (Array.isArray(spec.operations) ? spec.operations.length : 0)
      + Object.keys(response.uiConfigOverrides ?? {}).length
    project.goalSession = {
      ...current,
      plan: Array.isArray(spec.plan) && spec.plan.length ? spec.plan.filter((item): item is string => typeof item === 'string') : current.plan,
      completedSteps: Array.isArray(spec.completedSteps) ? spec.completedSteps.filter((item): item is string => typeof item === 'string') : current.completedSteps,
      currentStep: typeof spec.currentStep === 'string' && spec.currentStep.trim() ? spec.currentStep.trim() : current.currentStep,
      nextStep: typeof spec.nextStep === 'string' && spec.nextStep.trim() ? spec.nextStep.trim() : current.nextStep,
      status,
        pendingDecision: status === 'needs-user' ? normalizeWorkflowAgentDecision(spec.decision) : undefined,
      history: [
        ...current.history,
        {
          userRequest: userPrompt,
          summary: typeof spec.summary === 'string' ? spec.summary : '',
          status: typeof spec.status === 'string' ? spec.status : 'applied',
          operations: operationCount,
          currentStep: typeof spec.currentStep === 'string' ? spec.currentStep : undefined,
          nextStep: typeof spec.nextStep === 'string' ? spec.nextStep : undefined,
          createdAt: Date.now(),
        },
      ].slice(-12),
      updatedAt: Date.now(),
    }
  }

  function applyWorkflowAgentStepEvent(userPrompt: string, event: {
    type: string
    mode?: 'create' | 'edit'
    step?: {
      id: string
      index: number
      tool?: string
      userRequest?: string
      summary?: string
      status?: string
      plan?: string[]
      completedSteps?: string[]
      currentStep?: string
      nextStep?: string
      decision?: CharacterWorkflowAgentDecision
      operations?: Array<Record<string, unknown>>
      uiConfigOverrides?: Record<string, Record<string, unknown>>
      createdAt?: number
    }
  }): boolean {
    if (event.type !== 'workflow-agent.step' || !event.step || event.mode !== 'edit') {
      return false
    }
    const project = characterWorkflowProjects.find((item) => item.id === activeCharacterWorkflowProjectId)
    const current = getActiveWorkflowGoalSession(userPrompt)
    if (!project || !current) {
      return false
    }
    const step = event.step
    const fakeSpec = {
      summary: step.summary,
      plan: step.plan,
      completedSteps: step.completedSteps,
      currentStep: step.currentStep,
      nextStep: step.nextStep,
      decision: step.decision,
      status: step.status,
      operations: step.operations,
    }
    const changed = applyCharacterWorkflowAssistantResult({
      spec: fakeSpec,
      uiConfigOverrides: step.uiConfigOverrides,
    })
    const status = step.status === 'needs-user'
      ? 'needs-user'
      : step.status === 'blocked'
        ? 'blocked'
        : 'active'
    project.goalSession = {
      ...current,
      plan: Array.isArray(step.plan) && step.plan.length ? step.plan.filter((item): item is string => typeof item === 'string') : current.plan,
      completedSteps: Array.isArray(step.completedSteps) ? step.completedSteps.filter((item): item is string => typeof item === 'string') : current.completedSteps,
      currentStep: typeof step.currentStep === 'string' && step.currentStep.trim() ? step.currentStep.trim() : current.currentStep,
      nextStep: typeof step.nextStep === 'string' && step.nextStep.trim() ? step.nextStep.trim() : current.nextStep,
      status,
      pendingDecision: status === 'needs-user' ? normalizeWorkflowAgentDecision(step.decision) : undefined,
      history: dedupeWorkflowGoalHistory([
        ...current.history,
        {
          id: step.id,
          stepIndex: step.index,
          tool: step.tool,
          userRequest: step.userRequest || userPrompt,
          summary: step.summary || '',
          status: step.status || 'applied',
          operations: (step.operations ?? []).length + Object.keys(step.uiConfigOverrides ?? {}).length,
          currentStep: step.currentStep,
          nextStep: step.nextStep,
          createdAt: step.createdAt || Date.now(),
        },
      ]).slice(-16),
      updatedAt: Date.now(),
    }
    characterWorkflowBuilderStatus = formatWorkflowGoalSessionStatus(project.goalSession, step.summary)
    saveActiveWorkflowProjectSnapshot()
    renderCharacterWorkflow()
    return changed
  }

  function dedupeWorkflowGoalHistory(history: CharacterWorkflowGoalSession['history']): CharacterWorkflowGoalSession['history'] {
    const seen = new Set<string>()
    const deduped: CharacterWorkflowGoalSession['history'] = []
    for (const item of history) {
      const key = item.id || `${item.stepIndex ?? ''}:${item.tool ?? ''}:${item.createdAt}:${item.summary}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      deduped.push(item)
    }
    return deduped
  }

  function formatWorkflowGoalSessionStatus(session: CharacterWorkflowGoalSession | undefined, fallbackSummary?: string): string {
    const parts = [
      typeof fallbackSummary === 'string' && fallbackSummary.trim() ? fallbackSummary.trim() : '',
      session?.currentStep ? `${options.getLanguage() === 'zh-CN' ? '当前步骤' : 'Current step'}: ${session.currentStep}` : '',
      session?.nextStep ? `${options.getLanguage() === 'zh-CN' ? '下一步' : 'Next step'}: ${session.nextStep}` : '',
    ].filter(Boolean)
    if (session?.plan?.length) {
      const title = options.getLanguage() === 'zh-CN' ? '计划' : 'Plan'
      parts.push(`${title}:\n${session.plan.map((item, index) => `${index + 1}. ${item}`).join('\n')}`)
    }
    return parts.join('\n\n')
  }

  function interruptActiveWorkflowAssistantRun(): void {
    if (!characterWorkflowBuilderBusy || !characterWorkflowAssistantActiveRunToken) {
      return
    }
    characterWorkflowAssistantInterruptedRuns.add(characterWorkflowAssistantActiveRunToken)
    characterWorkflowAssistantActiveRunToken = 0
    characterWorkflowBuilderBusy = false
  }

  function isWorkflowAssistantRunInterrupted(runToken: number): boolean {
    return characterWorkflowAssistantInterruptedRuns.has(runToken)
  }

  function setActiveWorkflowGoalSessionStatus(status: CharacterWorkflowGoalSession['status']): void {
    const project = characterWorkflowProjects.find((item) => item.id === activeCharacterWorkflowProjectId)
    const session = normalizeCharacterWorkflowGoalSession(project?.goalSession)
    if (!project || !session) {
      return
    }
    if (status === 'paused' || status === 'complete') {
      interruptActiveWorkflowAssistantRun()
    }
    project.goalSession = {
      ...session,
      status,
      nextStep: status === 'complete' ? undefined : session.nextStep,
      pendingDecision: status === 'complete' ? undefined : session.pendingDecision,
      history: [
        ...session.history,
        {
          userRequest: status,
          summary: options.getLanguage() === 'zh-CN'
            ? `Workflow Agent 目标已${status === 'paused' ? '暂停' : status === 'active' ? '恢复' : '停止'}。`
            : `Workflow Agent goal ${status === 'paused' ? 'paused' : status === 'active' ? 'resumed' : 'stopped'}.`,
          status,
          operations: 0,
          createdAt: Date.now(),
        },
      ].slice(-16),
      updatedAt: Date.now(),
    }
    saveActiveWorkflowProjectSnapshot()
    renderCharacterWorkflow()
  }

  function continueActiveWorkflowGoalSession(): void {
    const project = characterWorkflowProjects.find((item) => item.id === activeCharacterWorkflowProjectId)
    const session = normalizeCharacterWorkflowGoalSession(project?.goalSession)
    if (!session?.nextStep || session.pendingDecision || session.status === 'paused' || session.status === 'blocked' || session.status === 'complete') {
      return
    }
    characterWorkflowAssistantPrompt = session.nextStep
    void applyCharacterWorkflowAssistantPrompt()
  }

  function chooseWorkflowAgentDecisionOption(optionId: string): void {
    const project = characterWorkflowProjects.find((item) => item.id === activeCharacterWorkflowProjectId)
    const session = normalizeCharacterWorkflowGoalSession(project?.goalSession)
    const decision = session?.pendingDecision
    if (!project || !session || !decision || characterWorkflowBuilderBusy) {
      return
    }
    const zh = options.getLanguage() === 'zh-CN'
    const optionItem = optionId === '__skip'
      ? undefined
      : decision.options.find((item) => item.id === optionId)
    if (optionId !== '__skip' && !optionItem) {
      return
    }
    const choiceLabel = optionItem?.label ?? (zh ? '交给 Agent 决定' : 'Let agent decide')
    const choiceDetail = optionItem?.detail ? `\n${optionItem.detail}` : ''
    const patchHint = optionItem?.patchHint || session.nextStep || ''
    characterWorkflowAssistantPrompt = [
      zh ? `用户选择：${choiceLabel}` : `User selected: ${choiceLabel}`,
      choiceDetail,
      patchHint ? `${zh ? '继续编辑方向' : 'Continue editing direction'}: ${patchHint}` : '',
    ].filter(Boolean).join('\n')
    project.goalSession = {
      ...session,
      pendingDecision: undefined,
      status: 'active',
      nextStep: patchHint || session.nextStep,
      history: [
        ...session.history,
        {
          userRequest: choiceLabel,
          summary: zh
            ? `已选择「${choiceLabel}」，Agent 将据此继续编辑资源图。`
            : `Selected "${choiceLabel}"; the agent will continue editing the workflow from this preference.`,
          status: 'decision-selected',
          operations: 0,
          currentStep: session.currentStep,
          nextStep: patchHint || session.nextStep,
          createdAt: Date.now(),
        },
      ].slice(-16),
      updatedAt: Date.now(),
    }
    saveActiveWorkflowProjectSnapshot()
    void applyCharacterWorkflowAssistantPrompt()
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
        agentWork: response.agentWork,
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
    const runToken = ++characterWorkflowAssistantRunToken
    characterWorkflowAssistantActiveRunToken = runToken
    characterWorkflowAssistantInterruptedRuns.delete(runToken)
    characterWorkflowBuilderStatus = options.getLanguage() === 'zh-CN' ? 'Agent 正在调整当前资源图...' : 'Agent editing current resource graph...'
    renderCharacterWorkflow()
    try {
      const workflowPage = await loadCharacterWorkflowPageModule()
      const goalSession = getActiveWorkflowGoalSession(userPrompt)
      const buildRequest = {
        prompt: userPrompt,
        language: options.getLanguage(),
        mode: 'edit',
        editorSession: goalSession ? {
          objective: goalSession.objective,
          plan: goalSession.plan,
          completedSteps: goalSession.completedSteps,
          currentStep: goalSession.currentStep,
          history: goalSession.history.map((item) => ({
            userRequest: item.userRequest,
            summary: item.summary,
            status: item.status,
            operations: item.operations,
          })),
        } : undefined,
        graph: createCharacterWorkflowAssistantGraph(workflowPage),
      } as const
      pushCharacterResourceUndoSnapshot()
      let streamedChanged = false
      let streamedSteps = 0
      const response = typeof window.electronAPI.streamBuildCharacterWorkflow === 'function'
        ? await window.electronAPI.streamBuildCharacterWorkflow(buildRequest, {
            onEvent: (event) => {
              if (isWorkflowAssistantRunInterrupted(runToken)) {
                return
              }
              if (applyWorkflowAgentStepEvent(userPrompt, event)) {
                streamedChanged = true
              }
              if (event.type === 'workflow-agent.step') {
                streamedSteps += 1
              }
            },
          })
        : await window.electronAPI.buildCharacterWorkflow(buildRequest)
      if (isWorkflowAssistantRunInterrupted(runToken)) {
        return
      }
      if (!response.success) {
        throw new Error(response.error || 'Workflow agent failed')
      }
      const changed = streamedSteps > 0
        ? streamedChanged
        : applyCharacterWorkflowAssistantResult(response)
      updateActiveWorkflowGoalSession(userPrompt, response)
      saveActiveWorkflowProjectSnapshot()
      if (!changed) {
        characterWorkflowBuilderStatus = typeof response.spec?.summary === 'string' && response.spec.summary.trim()
          ? response.spec.summary.trim()
          : options.getLanguage() === 'zh-CN' ? 'Agent 没有返回可应用的修改' : 'Agent returned no applicable changes'
      } else {
        characterWorkflowAssistantPrompt = ''
        characterWorkflowBuilderStatus = formatWorkflowGoalSessionStatus(characterWorkflowProjects.find((item) => item.id === activeCharacterWorkflowProjectId)?.goalSession, response.spec?.summary)
        showToast(options.getLanguage() === 'zh-CN' ? '已应用资源图修改' : 'Applied graph edits')
      }
    } catch (error: any) {
      if (isWorkflowAssistantRunInterrupted(runToken)) {
        return
      }
      const message = error?.message || String(error)
      characterWorkflowBuilderStatus = message
      showToast(message)
    } finally {
      if (characterWorkflowAssistantActiveRunToken === runToken) {
        characterWorkflowAssistantActiveRunToken = 0
        characterWorkflowBuilderBusy = false
      }
      if (isWorkflowAssistantRunInterrupted(runToken)) {
        characterWorkflowAssistantInterruptedRuns.delete(runToken)
      }
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
      parameters: Array<{
        id: string
        type: string
        defaultValue?: unknown
        options?: Array<{ value: string; label: string }>
      }>
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
        parameters: Array.isArray(node.parameters)
          ? node.parameters.map((parameterItem: any) => ({
            id: String(parameterItem.id || ''),
            type: String(parameterItem.type || ''),
            defaultValue: parameterItem.defaultValue,
            ...(Array.isArray(parameterItem.options)
              ? { options: parameterItem.options.map((optionItem: any) => ({
                value: String(optionItem.value || ''),
                label: String(optionItem.label || optionItem.value || ''),
              })) }
              : {}),
          })).filter((parameterItem: any) => parameterItem.id)
          : [],
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
      decision?: CharacterWorkflowAgentDecision
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
      const nextConfig = deriveCharacterWorkflowConfig(config)
      const entries = Object.entries(nextConfig).filter(([key, value]) => {
        if (Array.isArray(value)) return value.length > 0
        if (value === '' && key === 'stylePrompt' && typeof nextConfig.preset === 'string') return true
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
          ...deriveCharacterWorkflowConfig(operation.config as Record<string, unknown>),
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
        ...deriveCharacterWorkflowConfig(operation.config as Record<string, unknown>),
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

  async function openCharacterWorkflowDraft(projectId: string): Promise<void> {
    const perfId = startCharacterWorkflowPerf(`open project ${projectId}`)
    characterWorkflowRunOpenToken += 1
    saveActiveWorkflowProjectSnapshot()
    markCharacterWorkflowPerf(perfId, 'save current snapshot scheduled')
    const projectIndex = characterWorkflowProjects.findIndex((item) => item.id === projectId)
    if (projectIndex < 0) {
      finishCharacterWorkflowPerf(perfId, 'project missing')
      return
    }
    clearCharacterWorkflowTransientStatus({ clearAssistantPrompt: true })
    activeCharacterWorkflowProjectId = projectId
    characterWorkflowContentLoaded = true
    characterWorkflowActiveTabId = 'workflow'
    const indexedProject = characterWorkflowProjects[projectIndex]
    if (indexedProject.loadState === 'ready' || indexedProject.loadState === 'ready-overview') {
      applyCharacterWorkflowProjectState(indexedProject)
    } else {
      replaceRecord(characterWorkflowConfigOverrides, {})
      replaceRecord(characterWorkflowPositionOverrides, {})
      applyWorkflowProjectViewState(undefined)
      characterWorkflowRunCount = 0
      characterWorkflowRunState = null
    }
    renderCharacterWorkflow()
    markCharacterWorkflowPerf(perfId, 'loading render scheduled')
    const project = await ensureCharacterWorkflowProjectDetailLoaded(projectId).catch((error) => {
      showToast(error instanceof Error ? error.message : String(error))
      return null
    })
    markCharacterWorkflowPerf(perfId, 'detail await complete')
    if (!project || activeCharacterWorkflowProjectId !== projectId) {
      renderCharacterWorkflow()
      finishCharacterWorkflowPerf(perfId, 'detail unavailable or stale')
      return
    }
    activeCharacterWorkflowProjectId = project.id
    markCharacterWorkflowPerf(perfId, 'before apply project state')
    applyCharacterWorkflowProjectState(project)
    characterWorkflowActiveTabId = 'workflow'
    markCharacterWorkflowPerf(perfId, 'project state applied')
    renderCharacterWorkflow()
    void ensureCharacterWorkflowProjectDetailLoaded(projectId, { includeRuns: true }).catch((error) => {
      console.warn('[CharacterWorkflowStore] Failed to preload full workflow project:', error)
    })
  }

  async function openCharacterWorkflowRun(projectId: string, runId: string): Promise<void> {
    const perfId = startCharacterWorkflowPerf(`open run ${projectId}:${runId}`)
    const liveRunState = getExecutingWorkflowRunState(projectId, runId)
    if (liveRunState) {
      clearCharacterWorkflowTransientStatus({ clearAssistantPrompt: true })
      activeCharacterWorkflowProjectId = projectId
      characterWorkflowContentLoaded = true
      characterWorkflowActiveTabId = 'run-draft'
      characterWorkflowRunState = cloneCharacterWorkflowRunState(liveRunState)
      renderCharacterWorkflow()
      finishCharacterWorkflowPerf(perfId, 'opened live executing run')
      return
    }
    const openToken = ++characterWorkflowRunOpenToken
    saveActiveWorkflowProjectSnapshot()
    markCharacterWorkflowPerf(perfId, 'save current snapshot scheduled')
    activeCharacterWorkflowProjectId = projectId
    clearCharacterWorkflowTransientStatus({ clearAssistantPrompt: true })
    characterWorkflowContentLoaded = true
    characterWorkflowActiveTabId = 'run-draft'
    const cachedProject = characterWorkflowProjects.find((item) => item.id === projectId)
    const cachedRun = cachedProject?.runs.find((item) => item.id === runId)
    characterWorkflowRunState = cachedRun?.runState
      ? normalizePersistedCharacterWorkflowRunState(cachedRun.runState, true, projectId)
      : null
    renderCharacterWorkflow()
    markCharacterWorkflowPerf(perfId, 'loading render scheduled')
    const project = await ensureCharacterWorkflowProjectDetailLoaded(projectId).catch((error) => {
      showToast(error instanceof Error ? error.message : String(error))
      return null
    })
    markCharacterWorkflowPerf(perfId, 'project overview await complete')
    markCharacterWorkflowPerf(perfId, 'before getRun IPC')
    const runResponse = project
      ? await window.electronAPI.getCharacterWorkflowRun(projectId, runId)
      : { success: false, error: 'Project not loaded' }
    markCharacterWorkflowPerf(perfId, 'getRun IPC complete')
    if (openToken !== characterWorkflowRunOpenToken) {
      finishCharacterWorkflowPerf(perfId, 'stale run load ignored')
      return
    }
    if (!runResponse.success) {
      showToast(runResponse.error || 'Failed to load run draft')
    }
    const storedRun = runResponse.success && runResponse.run && typeof runResponse.run === 'object'
      ? runResponse.run as { payload?: unknown }
      : undefined
    const run = storedRun?.payload && typeof storedRun.payload === 'object'
      ? selectRicherWorkflowRunRecord(storedRun.payload as CharacterWorkflowProjectRunRecord, cachedRun)
      : project?.runs.find((item) => item.id === runId)
    if (!project || !run || activeCharacterWorkflowProjectId !== projectId || openToken !== characterWorkflowRunOpenToken) {
      renderCharacterWorkflow()
      finishCharacterWorkflowPerf(perfId, 'run unavailable or stale')
      return
    }
    project.loadState = 'ready'
    project.activeRunId = run.id
    const runIndex = project.runs.findIndex((item) => item.id === run.id)
    if (runIndex >= 0) {
      project.runs[runIndex] = run
    } else {
      project.runs.push(run)
    }
    markCharacterWorkflowPerf(perfId, 'before apply run state')
    applyCharacterWorkflowProjectState(project)
    characterWorkflowRunState = normalizePersistedCharacterWorkflowRunState(run.runState, true, projectId)
    characterWorkflowActiveTabId = 'run-draft'
    markCharacterWorkflowPerf(perfId, 'run state applied')
    renderCharacterWorkflow()
  }

  function deleteActiveCharacterWorkflowRunDraft(): void {
    const project = characterWorkflowProjects.find((item) => item.id === activeCharacterWorkflowProjectId)
    const activeRunId = characterWorkflowRunState?.run?.id ?? project?.activeRunId ?? ''
    if (project && activeRunId) {
      deleteCharacterWorkflowRunDraft(project.id, activeRunId)
    }
  }

  function deleteCharacterWorkflowRunDraft(projectId: string, runId: string): void {
    const project = characterWorkflowProjects.find((item) => item.id === projectId)
    if (!project || !runId) {
      return
    }
    const deletedIndex = project.runs.findIndex((run) => run.id === runId)
    if (deletedIndex < 0) {
      return
    }
    characterWorkflowRunOpenToken += 1
    const wasActiveProject = activeCharacterWorkflowProjectId === project.id
    const wasActiveRun = project.activeRunId === runId || (wasActiveProject && characterWorkflowRunState?.run?.id === runId)
    const wasExecutingRun = characterWorkflowExecutingProjectId === project.id && characterWorkflowExecutingRunState?.run?.id === runId
    if (wasExecutingRun) {
      characterWorkflowRenderToken += 1
      characterWorkflowExecutingProjectId = ''
      characterWorkflowExecutingRunState = null
    }
    project.runs.splice(deletedIndex, 1)
    void window.electronAPI.deleteCharacterWorkflowRun(project.id, runId).catch((error) => {
      console.warn('[CharacterWorkflowStore] Failed to delete workflow run:', error)
    })
    if (wasActiveRun) {
      const nextRun = project.runs[Math.min(deletedIndex, project.runs.length - 1)] ?? project.runs[deletedIndex - 1]
      project.activeRunId = nextRun?.id
      if (wasActiveProject) {
        characterWorkflowRunState = nextRun
          ? normalizePersistedCharacterWorkflowRunState(nextRun.runState, true, project.id)
          : null
        characterWorkflowActiveTabId = characterWorkflowRunState ? 'run-draft' : 'workflow'
      }
    } else if (!project.runs.some((run) => run.id === project.activeRunId)) {
      project.activeRunId = project.runs[project.runs.length - 1]?.id
    }
    project.updatedAt = Date.now()
    persistCharacterWorkflowProject(project)
    markActiveWorkflowDirty()
    renderCharacterWorkflow()
    showToast(options.getLanguage() === 'zh-CN' ? '已删除运行草稿' : 'Run draft deleted')
  }

  async function duplicateCharacterWorkflowDraft(projectId: string): Promise<void> {
    saveActiveWorkflowProjectSnapshot()
    const source = await ensureCharacterWorkflowProjectDetailLoaded(projectId)
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
      loadState: 'ready',
    }
    characterWorkflowProjects = [copy, ...characterWorkflowProjects]
    persistCharacterWorkflowProject(copy)
    void openCharacterWorkflowDraft(copy.id)
  }

  async function renameCharacterWorkflowDraft(projectId: string): Promise<void> {
    const project = await ensureCharacterWorkflowProjectDetailLoaded(projectId)
    if (!project) {
      return
    }
    const nextName = window.prompt(options.getLanguage() === 'zh-CN' ? '重命名角色草稿' : 'Rename character draft', project.name)?.trim()
    if (!nextName) {
      return
    }
    project.name = nextName
    project.updatedAt = Date.now()
    persistCharacterWorkflowProject(project)
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
    if (characterWorkflowExecutingProjectId === projectId) {
      characterWorkflowRenderToken += 1
      characterWorkflowExecutingProjectId = ''
      characterWorkflowExecutingRunState = null
    }
    characterWorkflowRunOpenToken += 1
    const pendingPersist = characterWorkflowProjectPersistTimers.get(projectId)
    if (pendingPersist !== undefined) {
      window.clearTimeout(pendingPersist)
      characterWorkflowProjectPersistTimers.delete(projectId)
    }
    characterWorkflowProjects = characterWorkflowProjects.filter((item) => item.id !== projectId)
    void window.electronAPI.deleteCharacterWorkflowProject(projectId).catch((error) => {
      console.warn('[CharacterWorkflowStore] Failed to delete workflow project:', error)
    })
    if (activeCharacterWorkflowProjectId === projectId) {
      activeCharacterWorkflowProjectId = ''
      clearCharacterWorkflowTransientStatus({ clearAssistantPrompt: true })
      replaceRecord(characterWorkflowConfigOverrides, {})
      replaceRecord(characterWorkflowPositionOverrides, {})
      applyWorkflowProjectViewState(undefined)
      characterWorkflowRunCount = 0
      characterWorkflowRunState = null
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
    saveActiveWorkflowProjectSnapshot(false)
    return {
      activeWorkflowId: activeCharacterWorkflowProjectId,
      workflows: [],
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
    characterWorkflowDirty = false
    void persistConversation(conversation)
  }

  function markActiveWorkflowDirty(): void {
    characterWorkflowDirty = true
    scheduleActiveConversationWorkflowPersist()
  }

  function scheduleActiveConversationWorkflowPersist(): void {
    if (!characterWorkflowDirty) {
      return
    }
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
      clearCharacterWorkflowTransientStatus({ clearAssistantPrompt: true })
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
    activeCharacterWorkflowProjectId = typeof record.activeWorkflowId === 'string' && characterWorkflowProjects.some((project) => project.id === record.activeWorkflowId)
      ? record.activeWorkflowId
      : ''
    const activeProject = characterWorkflowProjects.find((project) => project.id === activeCharacterWorkflowProjectId)
    if (activeProject) {
      applyCharacterWorkflowProjectState(activeProject, { includeRunState: true })
    } else {
      clearCharacterWorkflowTransientStatus({ clearAssistantPrompt: true })
      replaceRecord(characterWorkflowConfigOverrides, {})
      replaceRecord(characterWorkflowPositionOverrides, {})
      applyWorkflowProjectViewState(undefined)
      characterWorkflowRunCount = 0
      characterWorkflowRunState = null
    }
    characterWorkflowActiveTabId = record.activeTabId === 'run-draft' ? 'run-draft' : 'workflow'
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
        void runCharacterWorkflow()
        break
      case 'delete-run-draft':
        deleteActiveCharacterWorkflowRunDraft()
        break
      case 'stop':
        if (cancelExecutingWorkflowRun()) {
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
      case 'add-materials':
        void addCharacterWorkflowMaterials(target?.dataset.chatWorkflowNode || selectedWorkflowNodeId)
        break
      case 'remove-material':
        removeCharacterWorkflowMaterial(target?.dataset.chatWorkflowNode || selectedWorkflowNodeId, target?.dataset.materialId || '')
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
        const graphSnapshot = characterWorkflowRoot?.querySelector<HTMLElement>('.chat-resource-serializer')?.dataset.graphSnapshot ?? '{}'
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
          graphSnapshot,
        })
        showToast(options.getLanguage() === 'zh-CN' ? '资源图前端状态已保存到本地快照' : 'Resource graph frontend state saved to local snapshot')
      },
      'fit-view': () => {
        pushCharacterResourceUndoSnapshot()
        characterResourceViewState.zoom = 0.72
        characterResourceViewState.panX = -42
        characterResourceViewState.panY = -24
        updateCharacterWorkflowViewportDom()
        saveCharacterResourceViewStateSnapshot()
      },
      'reset-view': () => {
        pushCharacterResourceUndoSnapshot()
        characterResourceViewState.zoom = 0.84
        characterResourceViewState.panX = 0
        characterResourceViewState.panY = 0
        updateCharacterWorkflowViewportDom()
        saveCharacterResourceViewStateSnapshot()
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
      'chat-test': () => {
        void openCharacterWorkflowRunDraftInChat()
      },
      'download-run-draft': () => {
        void downloadActiveCharacterWorkflowRunDraft()
      },
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

  async function runCharacterWorkflow(scopedRun?: CharacterWorkflowScopedRunRequest): Promise<void> {
    if (characterWorkflowExecutingRunState?.run?.status === 'running') {
      showToast(options.getLanguage() === 'zh-CN' ? '已有运行草稿正在执行' : 'A run draft is already running')
      return
    }
    const scoped = Boolean(scopedRun)
    const scopedBaseRunState = scoped ? characterWorkflowRunState : null
    if (scoped && !scopedBaseRunState?.run) {
      showToast(options.getLanguage() === 'zh-CN' ? '当前没有可局部重跑的运行草稿' : 'No run draft is available for scoped rerun')
      return
    }
    characterWorkflowRunOpenToken += 1
    const renderToken = ++characterWorkflowRenderToken
    const workflowPage = await loadCharacterWorkflowPageModule()
    if (renderToken !== characterWorkflowRenderToken) {
      return
    }
    if (!scoped) {
      characterWorkflowRunCount += 1
    }
    const draftRunState = scoped && scopedBaseRunState?.run
      ? {
          ...cloneCharacterWorkflowRunState(scopedBaseRunState),
          run: {
            ...scopedBaseRunState.run,
            status: 'running' as const,
            currentStepId: 'agent',
          },
          steps: scopedBaseRunState.steps?.length
            ? scopedBaseRunState.steps.map((step) => step.id === 'agent' ? { ...step, status: 'running' as const, detail: scopedRun?.instruction || step.detail } : step)
            : workflowPage.createCharacterResourceRunSteps(options.getLanguage()),
        }
      : workflowPage.createDraftCharacterResourceRunState(characterWorkflowRunCount, 'running', options.getLanguage())
    characterWorkflowExecutingProjectId = activeCharacterWorkflowProjectId
    characterWorkflowExecutingRunState = cloneCharacterWorkflowRunState(draftRunState)
    characterWorkflowRunState = cloneCharacterWorkflowRunState(draftRunState)
    saveActiveWorkflowProjectSnapshot()
    characterWorkflowActiveTabId = 'run-draft'
    characterWorkflowEditorState.inspectorCollapsed = false
    const updateRunStep = (
      stepId: string,
      status: NonNullable<CharacterResourceRunState['steps']>[number]['status'],
      detail?: string
    ) => {
      if (!characterWorkflowExecutingRunState) {
        return
      }
      const steps = characterWorkflowExecutingRunState.steps?.length
        ? characterWorkflowExecutingRunState.steps
        : workflowPage.createCharacterResourceRunSteps(options.getLanguage())
      const targetIndex = steps.findIndex((step) => step.id === stepId)
      characterWorkflowExecutingRunState.steps = steps.map((step, index) => {
        if (index < targetIndex && step.status !== 'failed') {
          return { ...step, status: 'done' }
        }
        if (step.id === stepId) {
          return { ...step, status, ...(detail ? { detail } : {}) }
        }
        return step
      })
      if (characterWorkflowExecutingRunState.run) {
        characterWorkflowExecutingRunState.run.currentStepId = stepId
      }
      syncExecutingWorkflowRunState(true)
      syncVisibleWorkflowRunState(characterWorkflowExecutingProjectId, characterWorkflowExecutingRunState)
      if (isViewingWorkflowRun(characterWorkflowExecutingProjectId, characterWorkflowExecutingRunState.run?.id ?? '')) {
        scheduleCharacterWorkflowRunRender()
      }
    }
    updateRunStep('snapshot', 'running')
    renderCharacterWorkflow()
    showToast(scoped
      ? (options.getLanguage() === 'zh-CN' ? 'Agent 正在局部重跑运行草稿' : 'Agent rerunning scoped draft target')
      : (options.getLanguage() === 'zh-CN' ? 'Agent 正在生成角色资源' : 'Agent generating character resources'))
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
        runState: characterWorkflowExecutingRunState,
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
      const workflowRunRequest = {
        workflow,
        language: options.getLanguage(),
        ...(scopedRun ? {
          scopedRun: {
            ...scopedRun,
            seedArtifacts: scopedBaseRunState?.artifacts ?? [],
          },
        } : {}),
      }
      const response = typeof window.electronAPI.streamCharacterWorkflow === 'function'
        ? await window.electronAPI.streamCharacterWorkflow(workflowRunRequest, {
            onEvent: (event) => applyCharacterWorkflowAgentEvent(event),
          })
        : await window.electronAPI.runCharacterWorkflow(workflowRunRequest)
      if (!response.success) {
        throw new Error(response.error || 'Character workflow failed')
      }
      updateRunStep('collect', 'running')
      const finalStatus = response.status === 'needs_action' ? 'needs_action' : 'done'
      const currentRunState = characterWorkflowExecutingRunState
        ? cloneCharacterWorkflowRunState(characterWorkflowExecutingRunState)
        : cloneCharacterWorkflowRunState(draftRunState)
      const currentRun = currentRunState.run ?? draftRunState.run
      const responseArtifacts: NonNullable<CharacterResourceRunState['artifacts']> = (response.artifacts ?? []).map((artifact) => ({
        id: artifact.id,
        type: artifact.kind,
        sourceNodeId: artifact.sourceNodeId || 'agent-policy',
        title: artifact.title,
        summary: artifact.summary,
        data: artifact.data,
      }))
      const scopedImageSucceeded = Boolean(scopedRun && responseArtifacts.some((artifact) => artifact.type === 'image-asset'))
      const mergedArtifacts = mergeCharacterWorkflowRunArtifacts(currentRunState.artifacts ?? [], responseArtifacts, scopedRun, scopedImageSucceeded)
      const selectedScopedImageNodeId = getLatestScopedImageArtifactNodeId(mergedArtifacts, scopedRun)
      if (selectedScopedImageNodeId) {
        characterResourceViewState.selectedNodeIds = [selectedScopedImageNodeId]
        selectedWorkflowNodeId = selectedScopedImageNodeId
      }
      const finalSteps = (currentRunState.steps ?? workflowPage.createCharacterResourceRunSteps(options.getLanguage())).map((step) => ({
        ...step,
        status: finalStatus === 'needs_action' && (step.id === 'agent' || step.id === 'collect') ? 'failed' as const : 'done' as const,
        ...(finalStatus === 'needs_action' && step.id === 'agent'
          ? { detail: response.title || (options.getLanguage() === 'zh-CN' ? '图片生成需要处理' : 'Image generation needs action') }
          : {}),
      }))
      characterWorkflowExecutingRunState = {
        run: {
          id: scoped ? currentRun?.id || draftRunState.run?.id || response.runId || `resource-run-${Date.now()}` : draftRunState.run?.id || currentRun?.id || response.runId || `resource-run-${Date.now()}`,
          title: scoped ? currentRun?.title || draftRunState.run?.title || response.title || 'Resource Draft.run' : response.title || currentRun?.title || draftRunState.run?.title || 'Resource Draft.run',
          status: finalStatus,
          currentStepId: finalStatus === 'needs_action' ? 'agent' : 'finish',
        },
        steps: finalSteps,
        events: currentRunState.events ?? [],
        artifacts: mergedArtifacts,
      }
      const completedProjectId = characterWorkflowExecutingProjectId
      const completedRunId = characterWorkflowExecutingRunState.run?.id ?? ''
      const wasViewingCompletedRun = isViewingWorkflowRun(completedProjectId, completedRunId)
      syncExecutingWorkflowRunState(true)
      syncVisibleWorkflowRunState(characterWorkflowExecutingProjectId, characterWorkflowExecutingRunState)
      characterWorkflowExecutingRunState = null
      characterWorkflowExecutingProjectId = ''
      if (wasViewingCompletedRun) {
        scheduleCharacterWorkflowRunRender()
      }
      showToast(finalStatus === 'needs_action'
        ? (options.getLanguage() === 'zh-CN' ? '运行草稿需要处理：图片生成失败' : 'Run draft needs action: image generation failed')
        : scoped
          ? (options.getLanguage() === 'zh-CN' ? '局部重跑完成' : 'Scoped rerun completed')
          : (options.getLanguage() === 'zh-CN' ? '角色资源生成完成' : 'Character resources generated'))
    } catch (error) {
      console.warn('[CharacterResourceGraph] Failed to run agent lifecycle:', error)
      if (renderToken === characterWorkflowRenderToken) {
        const failedRunState = characterWorkflowExecutingRunState
          ? cloneCharacterWorkflowRunState(characterWorkflowExecutingRunState)
          : cloneCharacterWorkflowRunState(draftRunState)
        const failedRun = failedRunState.run ?? draftRunState.run
        const failedStepId = failedRun?.currentStepId ?? draftRunState.run?.currentStepId
        characterWorkflowExecutingRunState = failedRun
          ? {
              ...failedRunState,
              run: { ...failedRun, status: 'failed' },
              steps: (failedRunState.steps ?? draftRunState.steps ?? workflowPage.createCharacterResourceRunSteps(options.getLanguage())).map((step) => (
                step.id === failedStepId
                  ? { ...step, status: 'failed' }
                  : step
              )),
            }
          : draftRunState
        const failedProjectId = characterWorkflowExecutingProjectId
        const failedRunId = characterWorkflowExecutingRunState.run?.id ?? ''
        const wasViewingFailedRun = isViewingWorkflowRun(failedProjectId, failedRunId)
        syncExecutingWorkflowRunState(true)
        syncVisibleWorkflowRunState(characterWorkflowExecutingProjectId, characterWorkflowExecutingRunState)
        characterWorkflowExecutingRunState = null
        characterWorkflowExecutingProjectId = ''
        if (wasViewingFailedRun) {
          scheduleCharacterWorkflowRunRender()
        }
        showToast(error instanceof Error ? error.message : (options.getLanguage() === 'zh-CN' ? '角色资源生成失败' : 'Character resource generation failed'))
      }
    }
  }

  function handleCharacterWorkflowRunImageAction(target: HTMLElement): void {
    const action = target.dataset.chatWorkflowRunImageAction || ''
    const artifactId = target.dataset.runArtifactId || ''
    const targetNodeId = target.dataset.runTargetNodeId || findRunImageArtifactTargetNodeId(artifactId)
    const attemptId = target.dataset.runAttemptId || findRunImageArtifactAttemptId(artifactId)
    if (!artifactId && !targetNodeId) {
      return
    }
    if (action === 'accept') {
      acceptCharacterWorkflowRunImageArtifact(artifactId, targetNodeId)
      return
    }
    if (action !== 'retry' && action !== 'reroll') {
      return
    }
    if (!targetNodeId) {
      showToast(options.getLanguage() === 'zh-CN' ? '找不到图片目标节点，无法局部重跑' : 'Missing image target node for scoped rerun')
      return
    }
    const zh = options.getLanguage() === 'zh-CN'
    const promptValue = action === 'reroll'
      ? window.prompt(zh ? '这次 reroll 要调整什么？' : 'What should this reroll change?', '')
      : ''
    if (action === 'reroll' && promptValue === null) {
      return
    }
    const instruction = action === 'reroll'
      ? (promptValue || '').trim() || (zh ? '重新生成一版，保持 workflow 目标、参考图依赖和角色身份一致。' : 'Generate another version while preserving the workflow target, reference-image dependencies, and character identity.')
      : (zh ? '按同一 workflow 目标、提示词、参考图和模型重试失败或已选图片。' : 'Retry this image target with the same workflow target, prompt, reference images, and model.')
    void runCharacterWorkflow({
      action,
      instruction,
      scope: {
        targetNodeIds: [targetNodeId],
        artifactIds: artifactId ? [artifactId] : [],
        parentAttemptId: attemptId || undefined,
      },
    })
  }

  function handleRunDraftArtifactContextRequest(node: HTMLElement): void {
    if (!characterWorkflowRunState?.run) {
      return
    }
    const artifactId = node.dataset.runArtifactId || ''
    const artifact = characterWorkflowRunState.artifacts?.find((item) => item.id === artifactId)
    if (!artifact) {
      return
    }
    const zh = options.getLanguage() === 'zh-CN'
    const message = window.prompt(
      zh ? '你想如何修改这个运行结果？' : 'How should this run result change?',
      ''
    )
    if (message === null) {
      return
    }
    const instruction = message.trim()
    if (!instruction) {
      return
    }
    const targetNodeId = getRunImageArtifactTargetNodeId(artifact)
    const isImageArtifact = artifact.type === 'image-asset' || artifact.type === 'image-attempt' || artifact.type === 'stale-marker'
    void runCharacterWorkflow({
      action: isImageArtifact ? 'reroll' : 'repair',
      instruction,
      scope: {
        targetNodeIds: isImageArtifact && targetNodeId ? [targetNodeId] : [],
        artifactIds: artifactId ? [artifactId] : [],
        parentAttemptId: isImageArtifact ? findRunImageArtifactAttemptId(artifactId) || undefined : undefined,
      },
    })
  }

  function acceptCharacterWorkflowRunImageArtifact(artifactId: string, targetNodeId: string): void {
    if (!characterWorkflowRunState?.artifacts?.length || !artifactId) {
      return
    }
    const selectedTargetNodeId = targetNodeId || findRunImageArtifactTargetNodeId(artifactId)
    characterWorkflowRunState = {
      ...characterWorkflowRunState,
      artifacts: characterWorkflowRunState.artifacts.map((artifact) => {
        if (artifact.type !== 'image-asset') {
          return artifact
        }
        const sameTarget = selectedTargetNodeId
          ? findRunImageArtifactTargetNodeId(artifact.id || '') === selectedTargetNodeId || getRunImageArtifactTargetNodeId(artifact) === selectedTargetNodeId
          : artifact.id === artifactId
        if (!sameTarget && artifact.id !== artifactId) {
          return artifact
        }
        const data = artifact.data && typeof artifact.data === 'object' && !Array.isArray(artifact.data)
          ? { ...(artifact.data as Record<string, unknown>) }
          : {}
        return {
          ...artifact,
          data: {
            ...data,
            accepted: artifact.id === artifactId,
          },
        }
      }),
    }
    saveActiveWorkflowProjectSnapshot(true, true)
    renderCharacterWorkflow()
    showToast(options.getLanguage() === 'zh-CN' ? '已选中这张运行草稿图片' : 'Selected this run draft image')
  }

  function findRunImageArtifactTargetNodeId(artifactId: string): string {
    const artifact = characterWorkflowRunState?.artifacts?.find((item) => item.id === artifactId)
    return artifact ? getRunImageArtifactTargetNodeId(artifact) : ''
  }

  function findRunImageArtifactAttemptId(artifactId: string): string {
    const artifact = characterWorkflowRunState?.artifacts?.find((item) => item.id === artifactId)
    if (!artifact) {
      return ''
    }
    const data = artifact.data && typeof artifact.data === 'object' && !Array.isArray(artifact.data)
      ? artifact.data as Record<string, unknown>
      : {}
    return typeof data.attemptId === 'string'
      ? data.attemptId
      : artifact.type === 'image-attempt'
        ? artifact.id || ''
        : typeof data.parentAttemptId === 'string'
          ? data.parentAttemptId
          : ''
  }

  function getRunImageArtifactTargetNodeId(artifact: NonNullable<CharacterResourceRunState['artifacts']>[number]): string {
    const data = artifact.data && typeof artifact.data === 'object' && !Array.isArray(artifact.data)
      ? artifact.data as Record<string, unknown>
      : {}
    return typeof data.targetNodeId === 'string'
      ? data.targetNodeId
      : typeof data.staleTargetNodeId === 'string'
        ? data.staleTargetNodeId
        : artifact.sourceNodeId
  }

  function createRunDraftImageEditScope(prompt: string): CharacterWorkflowScopedRunRequest['scope'] | null {
    const artifacts = characterWorkflowRunState?.artifacts ?? []
    const imageArtifacts = artifacts.filter((artifact) => artifact.type === 'image-asset' || artifact.type === 'image-attempt')
    if (!imageArtifacts.length) {
      return null
    }
    if (!isRunDraftImageEditPrompt(prompt, imageArtifacts.length > 0)) {
      return null
    }
    const acceptedImageArtifacts = imageArtifacts.filter((artifact) => artifact.type === 'image-asset' && isAcceptedRunImageArtifact(artifact))
    const scopedArtifacts = acceptedImageArtifacts.length ? acceptedImageArtifacts : imageArtifacts
    const targetNodeIds = [...new Set(scopedArtifacts.map(getRunImageArtifactTargetNodeId).filter(Boolean))]
    if (!targetNodeIds.length) {
      return null
    }
    const artifactIds = scopedArtifacts.map((artifact) => artifact.id || '').filter(Boolean)
    const parentAttemptIds = [...new Set(scopedArtifacts.map((artifact) => findRunImageArtifactAttemptId(artifact.id || '')).filter(Boolean))]
    return {
      targetNodeIds,
      artifactIds,
      parentAttemptId: parentAttemptIds.length === 1 ? parentAttemptIds[0] : undefined,
    }
  }

  function isRunDraftImageEditPrompt(prompt: string, hasRunImages: boolean): boolean {
    const normalized = prompt.trim().toLowerCase()
    if (!normalized) {
      return false
    }
    const imageWords = ['图', '图片', '照片', '画面', '生图', '头像', '立绘', 'avatar', 'image', 'picture', 'visual', 'art']
    const editWords = ['丑', '难看', '不好看', '好看', '更好看', '精致', '细腻', '高级', '二次元', '动漫', '日系', 'anime', 'manga', 'style', '风格', '重画', '重炼', 'reroll', '重新生成', '优化', '漂亮', '美型']
    const hasImageWord = imageWords.some((word) => normalized.includes(word))
    const hasEditWord = editWords.some((word) => normalized.includes(word))
    return hasEditWord && (hasImageWord || hasRunImages)
  }

  function isAcceptedRunImageArtifact(artifact: NonNullable<CharacterResourceRunState['artifacts']>[number]): boolean {
    const data = artifact.data && typeof artifact.data === 'object' && !Array.isArray(artifact.data)
      ? artifact.data as Record<string, unknown>
      : {}
    return data.accepted !== false
  }

  function applyCharacterWorkflowAgentEvent(event: Record<string, unknown>): void {
    if (!characterWorkflowExecutingRunState) {
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
    const errorMessage = typeof event.error === 'string' ? event.error : undefined
    const eventSummary = typeof event.summary === 'string' ? event.summary : undefined
    const toolName = typeof event.toolName === 'string'
      ? event.toolName
      : typeof record?.toolName === 'string'
        ? record.toolName
        : undefined
    logCharacterWorkflowImageAttemptFailure(type, artifact)
    characterWorkflowExecutingRunState.events = [
      ...(characterWorkflowExecutingRunState.events ?? []),
      {
        type,
        timestamp,
        phase,
        toolName,
        title: typeof artifact?.title === 'string' ? artifact.title : undefined,
        summary: typeof artifact?.summary === 'string'
          ? artifact.summary
          : errorMessage || eventSummary || (typeof result?.summary === 'string' ? result.summary : undefined),
        status: type === 'run.failed' || type === 'run.needs_action'
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
      if (stepId && characterWorkflowExecutingRunState.run) {
        characterWorkflowExecutingRunState.run.currentStepId = stepId
        characterWorkflowExecutingRunState.steps = (characterWorkflowExecutingRunState.steps ?? []).map((step) => {
          if (step.id === stepId) {
            const failed = type === 'run.failed' || type === 'run.needs_action'
            return { ...step, status: failed ? 'failed' : 'running', ...(failed && (errorMessage || eventSummary) ? { detail: errorMessage || eventSummary } : {}) }
          }
          return step
        })
      }
    }
    if (characterWorkflowExecutingRunState.run) {
      if (type === 'run.failed') {
        characterWorkflowExecutingRunState.run.status = 'failed'
      } else if (type === 'run.needs_action') {
        characterWorkflowExecutingRunState.run.status = 'needs_action'
        characterWorkflowExecutingRunState.run.currentStepId = 'agent'
      } else if (type === 'run.completed') {
        characterWorkflowExecutingRunState.run.status = 'done'
        characterWorkflowExecutingRunState.run.currentStepId = 'finish'
      }
    }
    if (artifact) {
      const artifactId = typeof artifact.id === 'string' ? artifact.id : ''
      const existing = characterWorkflowExecutingRunState.artifacts ?? []
      if (!artifactId || !existing.some((item) => item.id === artifactId)) {
        characterWorkflowExecutingRunState.artifacts = pruneSupersededFailedImageAttempts([
          ...existing,
          {
            id: artifactId,
            type: typeof artifact.kind === 'string' ? artifact.kind : 'artifact',
            sourceNodeId: typeof artifact.sourceNodeId === 'string' ? artifact.sourceNodeId : 'agent-policy',
            title: typeof artifact.title === 'string' ? artifact.title : undefined,
            summary: typeof artifact.summary === 'string' ? artifact.summary : undefined,
            data: artifact.data,
          },
        ])
      }
    }
    syncExecutingWorkflowRunState()
    syncVisibleWorkflowRunState(characterWorkflowExecutingProjectId, characterWorkflowExecutingRunState)
    if (isViewingWorkflowRun(characterWorkflowExecutingProjectId, characterWorkflowExecutingRunState.run?.id ?? '')) {
      if (!patchCharacterWorkflowRunProgress(type, phase, toolName, artifact, result, characterWorkflowExecutingRunState)) {
        scheduleCharacterWorkflowRunRender()
      }
    }
  }

  function logCharacterWorkflowImageAttemptFailure(type: string, artifact: Record<string, any> | undefined): void {
    if (type !== 'artifact.created' || !artifact || artifact.kind !== 'image-attempt') {
      return
    }
    const data = artifact.data && typeof artifact.data === 'object' ? artifact.data as Record<string, any> : {}
    if (data.status !== 'failed') {
      return
    }
    const model = data.model && typeof data.model === 'object' ? data.model as Record<string, unknown> : {}
    console.warn('[CharacterWorkflow] Image attempt failed:', {
      artifactId: typeof artifact.id === 'string' ? artifact.id : undefined,
      targetNodeId: data.targetNodeId,
      targetTitle: data.targetTitle,
      imageRole: data.imageRole,
      provider: model.provider,
      modelName: model.modelName,
      apiId: model.apiId,
      size: data.size,
      action: data.action,
      parentAttemptId: data.parentAttemptId,
      error: data.error || artifact.summary,
    })
  }

  function patchCharacterWorkflowRunProgress(
    type: string,
    phase: string | undefined,
    toolName: string | undefined,
    artifact: Record<string, any> | undefined,
    result: Record<string, any> | undefined,
    runState: CharacterResourceRunState
  ): boolean {
    if (type === 'artifact.created' || type === 'run.completed' || type === 'run.failed' || type === 'run.needs_action') {
      return false
    }
    const root = characterWorkflowRoot?.querySelector<HTMLElement>('.chat-resource-run-progress')
    if (!root || !runState.run) {
      return false
    }
    const zh = options.getLanguage() === 'zh-CN'
    const setText = (selector: string, value: string) => {
      const target = root.querySelector<HTMLElement>(selector)
      if (target) {
        target.textContent = value
      }
    }
    setText('[data-run-progress-status]', formatRuntimeRunStatus(runState.run.status, zh))
    setText('[data-run-progress-phase]', phase || runState.run.currentStepId || '-')
    setText('[data-run-progress-tool]', toolName || '-')
    setText('[data-run-progress-artifact]', typeof artifact?.title === 'string' ? artifact.title : typeof artifact?.kind === 'string' ? artifact.kind : '-')
    setText('[data-run-progress-summary]', typeof result?.summary === 'string'
      ? result.summary
      : type === 'tool.call.started'
        ? (zh ? `正在调用工具：${toolName || '-'}` : `Calling tool: ${toolName || '-'}`)
        : type === 'run.phase.changed'
          ? (zh ? `进入阶段：${phase || '-'}` : `Phase: ${phase || '-'}`)
          : type)
    return true
  }

  function formatRuntimeRunStatus(status: NonNullable<CharacterResourceRunState['run']>['status'], zh: boolean): string {
    const labels: Record<string, [string, string]> = {
      idle: ['待运行', 'Idle'],
      running: ['运行中', 'Running'],
      paused: ['已暂停', 'Paused'],
      done: ['已完成', 'Done'],
      needs_action: ['需要处理', 'Needs action'],
      failed: ['失败', 'Failed'],
      canceled: ['已取消', 'Canceled'],
    }
    const label = labels[status] ?? [status, status]
    return zh ? label[0] : label[1]
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
    if (paramId === 'preset') {
      characterWorkflowConfigOverrides[nodeId].stylePrompt = createProseStylePresetPrompt(control.value)
    }
    renderCharacterWorkflow()
  }

  async function addCharacterWorkflowMaterials(nodeId: string): Promise<void> {
    if (!nodeId) {
      return
    }
    try {
      const response = await window.electronAPI.selectChatMaterials()
      if (!response.success) {
        throw new Error(response.error || 'Failed to select materials')
      }
      if (response.canceled || !response.materials?.length) {
        return
      }
      pushCharacterResourceUndoSnapshot()
      characterWorkflowConfigOverrides[nodeId] ??= {}
      const current = normalizeWorkflowMaterialConfig(characterWorkflowConfigOverrides[nodeId].materials)
      const incoming = response.materials.map((material, index) => ({
        id: `${Date.now().toString(36)}-${index}-${sanitizeWorkflowResourceId(material.name || material.kind)}`,
        ...material,
      }))
      characterWorkflowConfigOverrides[nodeId].materials = dedupeWorkflowMaterials([...current, ...incoming])
      selectedWorkflowNodeId = nodeId
      characterResourceViewState.selectedNodeIds = [nodeId]
      characterResourceViewState.selectedLinkId = ''
      saveActiveWorkflowProjectSnapshot()
      renderCharacterWorkflow()
      showToast(options.getLanguage() === 'zh-CN' ? `已添加 ${incoming.length} 个素材` : `Added ${incoming.length} material(s)`)
    } catch (error: any) {
      showToast(error?.message || String(error))
    }
  }

  function removeCharacterWorkflowMaterial(nodeId: string, materialId: string): void {
    if (!nodeId || !materialId) {
      return
    }
    const ownerNodeId = nodeId.startsWith('source-material-item-') ? 'source-material' : nodeId
    const current = normalizeWorkflowMaterialConfig(characterWorkflowConfigOverrides[ownerNodeId]?.materials)
    const next = current.filter((material) => material.id !== materialId)
    if (next.length === current.length) {
      return
    }
    pushCharacterResourceUndoSnapshot()
    characterWorkflowConfigOverrides[ownerNodeId] ??= {}
    characterWorkflowConfigOverrides[ownerNodeId].materials = next
    selectedWorkflowNodeId = ownerNodeId
    characterResourceViewState.selectedNodeIds = [ownerNodeId]
    saveActiveWorkflowProjectSnapshot()
    renderCharacterWorkflow()
  }

  function normalizeWorkflowMaterialConfig(value: unknown): Array<Record<string, any>> {
    return Array.isArray(value)
      ? value.filter((item): item is Record<string, any> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      : []
  }

  function dedupeWorkflowMaterials(materials: Array<Record<string, any>>): Array<Record<string, any>> {
    const seen = new Set<string>()
    return materials.filter((material) => {
      const key = [material.kind, material.name, material.mimeType, material.size].join(':')
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
  }

  function deriveCharacterWorkflowConfig(config: Record<string, unknown>): Record<string, unknown> {
    const nextConfig = { ...config }
    if (typeof nextConfig.preset === 'string' && !Object.prototype.hasOwnProperty.call(nextConfig, 'stylePrompt')) {
      nextConfig.stylePrompt = createProseStylePresetPrompt(nextConfig.preset)
    }
    return nextConfig
  }

  function formatImageStylePresetLabel(value: string): string {
    return value
      .split('-')
      .filter(Boolean)
      .map((part) => /^[0-9]+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  }

  function createProseStylePresetPrompt(value: string): string {
    if (!value || value === 'custom') {
      return ''
    }
    const label = formatImageStylePresetLabel(value)
    const lower = value.toLowerCase()
    if (/(plain-natural|sillytavern|scenario-card|ali-chat|w-plus-plus|chat-log)/.test(lower)) {
      return `${label}: write clean natural roleplay card prose, prioritize usable character behavior, speech patterns, scenario hooks, and model-readable details over decorative literary flourish.`
    }
    if (/(second-person|third-person|first-person|journal|epistolary|dialogue-forward)/.test(lower)) {
      return `${label}: control narration perspective and format tightly, keep voice consistent, make dialogue and action beats easy to continue in chat.`
    }
    if (/(romance|lovers|devotion|jealousy|marriage|companion|hurt|comfort|family|mentor|monster|paranormal|yandere|toxic|taboo|adult|power-imbalance)/.test(lower)) {
      return `${label}: emphasize relationship tension, emotional stakes, boundaries, attraction, trust shifts, vulnerability, and long-form roleplay hooks without becoming explicit or instruction-like.`
    }
    if (/(fantasy|wuxia|xianxia|isekai|sorcery|mythic|fairytale|occult|gothic|grimdark|horror|liminal|cosmic)/.test(lower)) {
      return `${label}: use genre-rich atmosphere, mythic or supernatural texture, sensory scene detail, and conflict-ready world pressure while keeping character-card fields concrete.`
    }
    if (/(sci-fi|cyberpunk|space|dystopian|post-apocalyptic|military)/.test(lower)) {
      return `${label}: use speculative setting texture, social pressure, technology or survival stakes, and sharp environmental details that support roleplay continuity.`
    }
    if (/(mystery|thriller|crime|legal|medical|political|suspense|noir|domestic)/.test(lower)) {
      return `${label}: use controlled suspense, secrets, investigative hooks, moral ambiguity, and grounded dramatic tension with precise cause-and-effect.`
    }
    if (/(slice|healing|wholesome|cozy|slow-life|comedic|dry-wit|satirical|soap|melodrama)/.test(lower)) {
      return `${label}: shape the prose around everyday scene momentum, readable emotional beats, recurring interaction loops, and a clear conversational rhythm.`
    }
    if (/(minimalist|precise|lush|poetic|sensory|cinematic|novelistic|surreal|picaresque)/.test(lower)) {
      return `${label}: apply this prose texture consistently through sentence rhythm, imagery density, pacing, and scene framing without copying the style label into final fields.`
    }
    return `${label}: apply a consistent prose voice, genre texture, pacing pressure, and relationship flavor to all connected target fields.`
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
    if (tabId !== 'workflow' && tabId !== 'run-draft') {
      return
    }
    if (tabId === 'run-draft') {
      const liveRunState = getExecutingWorkflowRunState(activeCharacterWorkflowProjectId, characterWorkflowRunState?.run?.id ?? '')
        ?? (characterWorkflowExecutingProjectId === activeCharacterWorkflowProjectId ? characterWorkflowExecutingRunState : null)
      if (liveRunState?.run) {
        characterWorkflowRunState = cloneCharacterWorkflowRunState(liveRunState)
      }
    }
    if (tabId === 'run-draft' && !characterWorkflowRunState?.run) {
      const project = characterWorkflowProjects.find((item) => item.id === activeCharacterWorkflowProjectId)
      const run = project?.runs.find((item) => item.id === project.activeRunId) ?? project?.runs[project.runs.length - 1]
      if (project && run) {
        void openCharacterWorkflowRun(project.id, run.id)
      }
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
    return [
      'target',
      'imageTarget',
      'fieldTarget',
      'imageControl',
      'referenceImage',
      'imageAsset',
      'fieldControl',
      'continuity',
      'relationship',
      'style',
      'constraint',
    ].includes(inputSlotId)
  }

  function parseCharacterResourceSlotAccepts(value: string | undefined, fallbackType: string): string[] {
    if (typeof value === 'string' && value.trim()) {
      return value.split(',').map((item) => item.trim()).filter(Boolean)
    }
    return fallbackType ? [fallbackType] : []
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
    const inputAccepts = sourceIsOutput
      ? parseCharacterResourceSlotAccepts(detail.targetAccepts, input.type)
      : parseCharacterResourceSlotAccepts(detail.sourceAccepts, input.type)
    if (!output.nodeId || !output.slotId || !input.nodeId || !input.slotId || !inputAccepts.includes(output.type)) {
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
    return deleteCharacterResourceLink(linkId)
  }

  function deleteCharacterResourceLink(linkId: string): boolean {
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
      if (characterWorkflowExecutingProjectId === activeCharacterWorkflowProjectId) {
        characterWorkflowRenderToken += 1
        characterWorkflowExecutingProjectId = ''
        characterWorkflowExecutingRunState = null
      }
      characterWorkflowRunOpenToken += 1
      saveActiveWorkflowProjectSnapshot()
      activeCharacterWorkflowProjectId = ''
      clearCharacterWorkflowTransientStatus({ clearAssistantPrompt: true })
      characterWorkflowRunState = null
      characterWorkflowRunCount = 0
      characterWorkflowActiveTabId = 'workflow'
      replaceRecord(characterWorkflowConfigOverrides, {})
      replaceRecord(characterWorkflowPositionOverrides, {})
      applyWorkflowProjectViewState(undefined)
      renderCharacterWorkflow()
      return
    }
    if (tabId === 'run-draft') {
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
    const nextX = Math.round(characterWorkflowDragging.originX + event.clientX - characterWorkflowDragging.startX)
    const nextY = Math.round(characterWorkflowDragging.originY + event.clientY - characterWorkflowDragging.startY)
    characterWorkflowPositionOverrides[characterWorkflowDragging.nodeId] = { x: nextX, y: nextY }
    const node = panel.querySelector<HTMLElement>(`[data-chat-workflow-node-id="${CSS.escape(characterWorkflowDragging.nodeId)}"]`)
    if (node) {
      node.style.setProperty('--node-x', `${nextX}px`)
      node.style.setProperty('--node-y', `${nextY}px`)
    }
    refreshCharacterResourceGroupBounds()
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
    saveActiveWorkflowProjectSnapshot()
    renderCharacterWorkflow()
  }

  function refreshCharacterResourceGroupBounds(): void {
    panel.querySelectorAll<HTMLElement>('.chat-resource-group[data-resource-group-node-ids]').forEach((group) => {
      const nodeIds = (group.dataset.resourceGroupNodeIds ?? '').split(',').map((item) => item.trim()).filter(Boolean)
      const nodes = nodeIds
        .map((nodeId) => panel.querySelector<HTMLElement>(`[data-chat-workflow-node-id="${CSS.escape(nodeId)}"]`))
        .filter((node): node is HTMLElement => Boolean(node))
      if (!nodes.length) {
        return
      }
      const left = Math.min(...nodes.map((node) => Number.parseFloat(node.style.getPropertyValue('--node-x')) || 0)) - 24
      const top = Math.min(...nodes.map((node) => Number.parseFloat(node.style.getPropertyValue('--node-y')) || 0)) - 34
      const right = Math.max(...nodes.map((node) => {
        const x = Number.parseFloat(node.style.getPropertyValue('--node-x')) || 0
        const width = Number.parseFloat(node.style.getPropertyValue('--node-w')) || node.offsetWidth
        return x + width
      })) + 24
      const bottom = Math.max(...nodes.map((node) => {
        const y = Number.parseFloat(node.style.getPropertyValue('--node-y')) || 0
        const height = Number.parseFloat(node.style.getPropertyValue('--node-h')) || node.offsetHeight
        return y + height
      })) + 24
      group.style.left = `${left}px`
      group.style.top = `${top}px`
      group.style.width = `${right - left}px`
      group.style.height = `${bottom - top}px`
    })
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
    markActiveWorkflowDirty()
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
    if (scrollWorkflowAssistantStatusRecords(event)) {
      return
    }
    const viewport = (event.target as HTMLElement | null)?.closest<HTMLElement>('.chat-workflow-canvas-viewport.active')
    if (!viewport || !panel.contains(viewport)) {
      return
    }
    event.preventDefault()
    const nextZoom = Math.min(1.4, Math.max(0.46, characterResourceViewState.zoom + (event.deltaY > 0 ? -0.05 : 0.05)))
    characterResourceViewState.zoom = Math.round(nextZoom * 100) / 100
    updateCharacterWorkflowViewportDom()
    saveCharacterResourceViewStateSnapshot()
  }

  function scrollWorkflowAssistantStatusRecords(event: WheelEvent): boolean {
    const statusBody = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-chat-workflow-agent-records]')
    if (!statusBody || !panel.contains(statusBody) || !characterWorkflowAssistantStatusExpanded) {
      return false
    }
    event.preventDefault()
    event.stopPropagation()
    const deltaMultiplier = event.deltaMode === 1
      ? 16
      : event.deltaMode === 2
        ? statusBody.clientHeight
        : 1
    statusBody.scrollTop += event.deltaY * deltaMultiplier
    return true
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
    updateCharacterWorkflowViewportDom()
    saveCharacterResourceViewStateSnapshot()
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
    chatTTSModels = (settings.system.ttsModels || []).map((model) => ({
      ...model,
      extra: model.extra ? { ...model.extra } : undefined,
    }))
    renderChatRuntimeModelPicker()
    renderConversationSettings()
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
    const previousProvider = getChatProviderEntry(model).value
    const entry = getChatModelType(model) === 'image'
      ? getImageProviderCatalogEntry(provider)
      : getLLMProviderCatalogEntry(provider)
    const providerChanged = previousProvider !== entry.value
    model.provider = entry.value
    if (getChatModelType(model) === 'llm') {
      model.transport = entry.transport ?? 'openai_compatible'
    }
    if (providerChanged) {
      model.modelName = entry.defaultModel
      model.enabledModels = entry.defaultModel ? [entry.defaultModel] : []
      model.availableModels = []
      model.modelsFetchedAt = undefined
    } else {
      model.modelName = model.modelName.trim() || entry.defaultModel
      model.enabledModels = getEnabledModelNames(model).length
        ? getEnabledModelNames(model)
        : [model.modelName].filter(Boolean)
    }
    model.baseUrl = entry.defaultBaseUrl
    if (getLocalLLMTransport(model) !== 'openai_compatible') {
      model.apiKey = ''
      model.baseUrl = ''
      model.enabledModels = model.modelName.trim() ? [model.modelName.trim()] : []
    }
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
    openChatModelLibraryId = id
    chatModelLoading.add(id)
    renderChatModelConfig()
    try {
      if (getLocalLLMTransport(model) !== 'openai_compatible') {
        throw new Error(options.getLanguage() === 'zh-CN' ? '本地 CLI 模型不支持拉取模型列表' : 'Local CLI models do not support fetching model lists')
      }
      const response = await window.electronAPI.listChatModels({
        provider: model.provider,
        modelType: getChatModelType(model),
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

  async function addManualChatModel(id: string): Promise<void> {
    if (!chatSystemConfig) {
      return
    }
    const card = getChatModelCard(id)
    const input = card?.querySelector<HTMLInputElement>('[data-chat-manual-model-input]')
    const name = input?.value.trim() || ''
    if (!name) {
      return
    }
    await setChatApiModelEnabled(id, name, true)
  }

  async function removeChatApiEnabledModel(id: string, modelName: string): Promise<void> {
    await setChatApiModelEnabled(id, modelName, false)
  }

  async function toggleChatApiEnabledModel(id: string, modelName: string): Promise<void> {
    if (!chatSystemConfig) {
      return
    }
    const model = chatSystemConfig.chatModels.find((item) => item.id === id)
    const name = modelName.trim()
    if (!model || !name) {
      return
    }
    await setChatApiModelEnabled(id, name, !getEnabledModelNames(model).includes(name))
  }

  async function setChatApiModelEnabled(id: string, modelName: string, enabled: boolean): Promise<void> {
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
    const next = enabled
      ? mergeModelNames(current, [name])
      : current.filter((item) => item !== name)
    model.enabledModels = next
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

  function openChatModelLibrary(id: string): void {
    openChatModelLibraryId = id
    openChatProviderDropdownId = ''
    chatModelLibrarySearch = ''
    renderChatModelConfig()
  }

  function closeChatModelLibrary(): void {
    openChatModelLibraryId = ''
    chatModelLibrarySearch = ''
    renderChatModelConfig()
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
    if (openChatModelLibraryId === id) {
      openChatModelLibraryId = ''
      chatModelLibrarySearch = ''
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
    void Promise.all([
      ensureChatResourcesHydrated(),
      ensureCharacterWorkflowProjectsHydrated(),
      ensureChatModelConfigLoaded(),
    ])
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
    const media = pendingMedia.map((item) => ({ ...item }))
    if (!text && media.length === 0) {
      return
    }
    const conversation = getActiveMutableConversation()
    if (!conversation) {
      showToast(options.getLanguage() === 'zh-CN' ? '角色资源尚未加载' : 'Character resources are not loaded')
      return
    }
    const displayText = text || (options.getLanguage() === 'zh-CN' ? '已发送媒体' : 'Sent media')
    const userMessage = createLocalUserMessage(displayText, getTimeLabel(), media)
    conversation.messages.push(userMessage)
    conversation.preview = { 'zh-CN': displayText, 'en-US': displayText }
    conversation.updatedLabel = { 'zh-CN': '现在', 'en-US': 'Now' }
    renderer.appendMessage(userMessage)
    refreshConversationList()
    options.composeInput.value = ''
    options.composeInput.style.height = 'auto'
    pendingMedia = []
    renderPendingMedia()
    void persistConversation(conversation)
    void queueAssistantReply(text, media)
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

  panel.addEventListener('contextmenu', (event) => {
    const target = event.target as HTMLElement | null
    const node = target?.closest<HTMLElement>('.chat-resource-node[data-run-artifact-id]')
    if (!node || !panel.contains(node) || characterWorkflowActiveTabId !== 'run-draft') {
      return
    }
    const artifactId = node.dataset.runArtifactId || ''
    if (!artifactId) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const nodeId = node.dataset.chatWorkflowNodeId || ''
    if (nodeId) {
      characterResourceViewState.selectedNodeIds = [nodeId]
      selectedWorkflowNodeId = nodeId
      renderCharacterWorkflow()
    }
    handleRunDraftArtifactContextRequest(node)
  }, true)

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

  panel.addEventListener('character-resource-node-context', (event) => {
    const nodeId = (event as CustomEvent<{ nodeId?: string }>).detail?.nodeId ?? ''
    if (!nodeId) {
      return
    }
    selectedWorkflowNodeId = nodeId
    characterResourceViewState.selectedNodeIds = [nodeId]
    characterResourceViewState.selectedLinkId = ''
    characterWorkflowEditorState.nodeSearchOpen = false
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

    const workflowDecisionOption = eventTarget.closest<HTMLElement>('[data-chat-workflow-decision-option]')
    if (workflowDecisionOption && panel.contains(workflowDecisionOption)) {
      chooseWorkflowAgentDecisionOption(workflowDecisionOption.dataset.chatWorkflowDecisionOption || '')
      return
    }

    const workflowAssistantStatusAction = eventTarget.closest<HTMLElement>('[data-chat-workflow-assistant-status-action]')
    if (workflowAssistantStatusAction && panel.contains(workflowAssistantStatusAction)) {
      const action = workflowAssistantStatusAction.dataset.chatWorkflowAssistantStatusAction || ''
      if (action === 'toggle') {
        characterWorkflowAssistantStatusExpanded = !characterWorkflowAssistantStatusExpanded
        renderCharacterWorkflow()
      } else if (action === 'copy') {
        void navigator.clipboard.writeText(getWorkflowAssistantStatusText()).then(
          () => showToast(options.getLanguage() === 'zh-CN' ? '已复制 Agent 记录' : 'Agent records copied'),
          (error: unknown) => showToast(error instanceof Error ? error.message : String(error))
        )
      } else if (action === 'continue') {
        continueActiveWorkflowGoalSession()
      } else if (action === 'pause') {
        setActiveWorkflowGoalSessionStatus('paused')
      } else if (action === 'resume') {
        setActiveWorkflowGoalSessionStatus('active')
      } else if (action === 'stop') {
        setActiveWorkflowGoalSessionStatus('complete')
      }
      return
    }

    const historyConversation = eventTarget.closest<HTMLElement>('[data-chat-history-conversation]')
    if (historyConversation && panel.contains(historyConversation)) {
      void setActiveConversation(historyConversation.dataset.chatHistoryConversation || '').then(() => renderChatHistoryManager())
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

    const mediaRemove = eventTarget.closest<HTMLElement>('[data-chat-media-remove]')
    if (mediaRemove && panel.contains(mediaRemove)) {
      const id = mediaRemove.dataset.chatMediaRemove || ''
      pendingMedia = pendingMedia.filter((item) => item.id !== id)
      renderPendingMedia()
      return
    }

    const messageMediaAction = eventTarget.closest<HTMLElement>('[data-chat-message-media-action]')
    if (messageMediaAction && panel.contains(messageMediaAction)) {
      const action = messageMediaAction.dataset.chatMessageMediaAction
      if (action === 'image' || action === 'audio') {
        void handleManualMessageMediaAction(action, messageMediaAction.dataset.chatMessageId || '')
      }
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
      if (modelAction.dataset.chatModelAction === 'close-model-library') {
        if (eventTarget.closest('.chat-model-library') && !eventTarget.closest('.chat-model-library-close')) {
          return
        }
        closeChatModelLibrary()
        return
      }
      const card = modelAction.closest<HTMLElement>('[data-chat-model-id]')
      const modelId = card?.dataset.chatModelId || ''
      if (modelId && modelAction.dataset.chatModelAction === 'toggle-providers') {
        openChatProviderDropdownId = openChatProviderDropdownId === modelId ? '' : modelId
        openChatModelLibraryId = ''
        chatModelLibrarySearch = ''
        renderChatModelConfig()
      }
      if (modelId && modelAction.dataset.chatModelAction === 'toggle-api-key') {
        toggleChatApiKeyVisibility(modelId)
      }
      if (modelId && modelAction.dataset.chatModelAction === 'open-model-library') {
        openChatModelLibrary(modelId)
      }
      if (modelId && modelAction.dataset.chatModelAction === 'get-models') {
        void fetchChatModels(modelId)
      }
      if (modelId && modelAction.dataset.chatModelAction === 'add-manual-model') {
        void addManualChatModel(modelId)
      }
      if (modelId && modelAction.dataset.chatModelAction === 'toggle-enabled-model') {
        void toggleChatApiEnabledModel(modelId, modelAction.dataset.chatModelName || '')
      }
      if (modelId && modelAction.dataset.chatModelAction === 'remove-enabled-model') {
        void removeChatApiEnabledModel(modelId, modelAction.dataset.chatModelName || '')
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
        void createCharacterWorkflowDraft()
      } else if (action === 'create-template') {
        void createCharacterWorkflowDraftFromTemplate(workflowLibraryAction.dataset.chatWorkflowTemplateId || '')
      } else if (action === 'rename') {
        void renameCharacterWorkflowDraft(workflowId)
      } else if (action === 'duplicate') {
        void duplicateCharacterWorkflowDraft(workflowId)
      } else if (action === 'delete') {
        deleteCharacterWorkflowDraft(workflowId)
      }
      return
    }

    const workflowOpen = eventTarget.closest<HTMLElement>('[data-chat-workflow-open]')
    if (workflowOpen && panel.contains(workflowOpen)) {
      void openCharacterWorkflowDraft(workflowOpen.dataset.chatWorkflowOpen || '')
      return
    }

    const workflowRunOpen = eventTarget.closest<HTMLElement>('[data-chat-workflow-run-open]')
    if (workflowRunOpen && panel.contains(workflowRunOpen)) {
      const [workflowId, runId] = (workflowRunOpen.dataset.chatWorkflowRunOpen || '').split(':')
      void openCharacterWorkflowRun(workflowId || '', runId || '')
      return
    }

    const workflowRunDelete = eventTarget.closest<HTMLElement>('[data-chat-workflow-run-delete]')
    if (workflowRunDelete && panel.contains(workflowRunDelete)) {
      const [workflowId, runId] = (workflowRunDelete.dataset.chatWorkflowRunDelete || '').split(':')
      deleteCharacterWorkflowRunDraft(workflowId || '', runId || '')
      return
    }

    const workflowCloseTab = eventTarget.closest<HTMLElement>('[data-chat-workflow-close-tab]')
    if (workflowCloseTab && panel.contains(workflowCloseTab)) {
      closeCharacterWorkflowTab(workflowCloseTab.dataset.chatWorkflowCloseTab || '')
      return
    }

    const workflowLinkDisconnect = eventTarget.closest<HTMLElement>('[data-chat-workflow-link-disconnect]')
    if (workflowLinkDisconnect && panel.contains(workflowLinkDisconnect)) {
      event.preventDefault()
      const linkId = workflowLinkDisconnect.dataset.chatWorkflowLinkDisconnect || ''
      characterResourceViewState.selectedLinkId = linkId
      characterResourceViewState.selectedNodeIds = []
      deleteCharacterResourceLink(linkId)
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

    const runImageAction = eventTarget.closest<HTMLElement>('[data-chat-workflow-run-image-action]')
    if (runImageAction && panel.contains(runImageAction)) {
      handleCharacterWorkflowRunImageAction(runImageAction)
      return
    }

    const workflowNodeSelect = eventTarget.closest<HTMLElement>('[data-chat-workflow-node-select]')
    if (workflowNodeSelect && panel.contains(workflowNodeSelect) && !eventTarget.closest<HTMLElement>('[data-chat-workflow-action]')) {
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
      void setActiveConversation(thread.dataset.conversationId || '')
      return
    }

    const target = eventTarget.closest<HTMLElement>('[data-chat-action]')
    if (!target || !panel.contains(target)) {
      return
    }
    handleAction(target.dataset.chatAction || '', target)
  })

  panel.addEventListener('change', (event) => {
    const workflowRunSelect = (event.target as HTMLElement | null)?.closest<HTMLSelectElement>('[data-chat-workflow-run-select]')
    if (workflowRunSelect && panel.contains(workflowRunSelect)) {
      if (workflowRunSelect.value) {
        void openCharacterWorkflowRun(activeCharacterWorkflowProjectId, workflowRunSelect.value)
      }
      return
    }
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
    const modelLibrarySearch = (event.target as HTMLElement | null)?.closest<HTMLInputElement>('[data-chat-model-library-search]')
    if (modelLibrarySearch && panel.contains(modelLibrarySearch)) {
      chatModelLibrarySearch = modelLibrarySearch.value
      renderChatModelConfig()
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
    const manualModelInput = (event.target as HTMLElement | null)?.closest<HTMLInputElement>('[data-chat-manual-model-input]')
    if (manualModelInput && panel.contains(manualModelInput) && event.key === 'Enter') {
      const modelId = manualModelInput.closest<HTMLElement>('[data-chat-model-id]')?.dataset.chatModelId || ''
      if (modelId) {
        event.preventDefault()
        void addManualChatModel(modelId)
      }
      return
    }
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
    if (resourceShortcut && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault()
      executeCharacterResourceCommand('delete-selection')
      return
    }
    if (event.key === 'Escape' && conversationSettingsPanel?.classList.contains('visible')) {
      closeConversationSettings()
    }
    if (event.key === 'Escape' && chatHistoryPanel?.classList.contains('visible')) {
      closeChatHistoryManager()
    }
    if (event.key === 'Escape' && openChatModelLibraryId) {
      closeChatModelLibrary()
    }
    if (event.key === 'Escape' && characterWorkflowEditorState.nodeSearchOpen) {
      characterWorkflowEditorState.nodeSearchOpen = false
      renderCharacterWorkflow()
    }
  })

  renderChat()

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
      chatResourcesHydrated = true
      renderChat()
      if (panel.dataset.chatView === 'character-workflow') {
        renderCharacterWorkflow()
      }
    } catch (error) {
      chatResourcesHydrated = true
      console.warn('[Chat] Failed to load chat resources:', error)
      showToast(options.getLanguage() === 'zh-CN' ? '角色资源加载失败' : 'Failed to load character resources')
      if (panel.dataset.chatView === 'character-workflow') {
        renderCharacterWorkflow()
      }
    }
  }

  async function hydrateCharacterWorkflowProjects(): Promise<void> {
    try {
      const listResponse = await window.electronAPI.listCharacterWorkflowProjects()
      if (!listResponse.success) {
        throw new Error(listResponse.error || 'Failed to list character workflow projects')
      }
      characterWorkflowProjects = (listResponse.projects ?? [])
        .map((item) => createIndexedCharacterWorkflowProject(item))
        .sort((a, b) => b.updatedAt - a.updatedAt)
      restoreCharacterWorkflowStateFromConversation(getActiveConversation(state))
      characterWorkflowProjectsHydrated = true
      if (panel.dataset.chatView === 'character-workflow') {
        renderCharacterWorkflow()
      }
      if (activeCharacterWorkflowProjectId) {
        try {
          await ensureCharacterWorkflowProjectDetailLoaded(activeCharacterWorkflowProjectId)
          restoreCharacterWorkflowStateFromConversation(getActiveConversation(state))
        } catch {
          // Detail errors are reflected on the project row and the main loading state.
        }
        if (panel.dataset.chatView === 'character-workflow') {
          renderCharacterWorkflow()
        }
      }
    } catch (error) {
      characterWorkflowProjectsHydrated = true
      console.warn('[CharacterWorkflowStore] Failed to load workflow projects:', error)
      showToast(options.getLanguage() === 'zh-CN' ? '角色资源图加载失败' : 'Failed to load workflow projects')
      if (panel.dataset.chatView === 'character-workflow') {
        renderCharacterWorkflow()
      }
    }
  }

  function persistCharacterWorkflowProject(project: CharacterWorkflowProjectRecord, immediate = false): void {
    if (project.loadState !== 'ready' && project.loadState !== 'ready-overview') {
      return
    }
    const existingTimer = characterWorkflowProjectPersistTimers.get(project.id)
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer)
    }
    const snapshot = {
      id: project.id,
      name: project.name,
      schemaVersion: Math.max(1, Math.round(Number(project.schemaVersion) || 1)),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      activeRunId: project.activeRunId,
      runCount: project.runCount,
      payload: JSON.parse(JSON.stringify(project)) as CharacterWorkflowProjectRecord,
    }
    if (immediate) {
      characterWorkflowProjectPersistTimers.delete(project.id)
      void window.electronAPI.saveCharacterWorkflowProject(snapshot).then((response) => {
        if (!response.success) {
          console.warn('[CharacterWorkflowStore] Failed to save workflow project:', response.error)
        }
      }).catch((error) => {
        console.warn('[CharacterWorkflowStore] Failed to save workflow project:', error)
      })
      return
    }
    const timer = window.setTimeout(() => {
      characterWorkflowProjectPersistTimers.delete(project.id)
      void window.electronAPI.saveCharacterWorkflowProject(snapshot).then((response) => {
        if (!response.success) {
          console.warn('[CharacterWorkflowStore] Failed to save workflow project:', response.error)
        }
      }).catch((error) => {
        console.warn('[CharacterWorkflowStore] Failed to save workflow project:', error)
      })
    }, 650)
    characterWorkflowProjectPersistTimers.set(project.id, timer)
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
      characterResource: conversation.characterResource,
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
