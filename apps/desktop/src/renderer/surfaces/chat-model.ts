/**
 * Defines chat resource manifests and runtime chat state loading.
 */
export type ChatLanguageCode = 'zh-CN' | 'en-US'

export type ChatMessageRole = 'user' | 'assistant' | 'system'

export type ChatActivityState = 'idle' | 'thinking' | 'generating_image' | 'generating_audio' | 'using_tool'

export type ChatLocalizedText = Record<ChatLanguageCode, string>

export interface ChatCharacterResource {
  id: string
  roleCard?: Record<string, unknown>
  openingPanel?: ChatOpeningPanel
  name: ChatLocalizedText
  displayName: ChatLocalizedText
  description: ChatLocalizedText
  story: ChatLocalizedText
  background: ChatLocalizedText
  scene: ChatSceneState
  firstMessage: ChatLocalizedText
  tag: Record<ChatLanguageCode, string[]>
  avatarImage: string
  bodyImage: string
}

export interface ChatOpeningPanel {
  html: string
  css: string
  summary?: string
  layoutKind?: string
  sourceArtifactId?: string
}

export interface ChatConversationSummary {
  id: string
  characterId: string
  title: ChatLocalizedText
  preview: ChatLocalizedText
  updatedLabel: ChatLocalizedText
  sceneState: ChatSceneState
  summaries: ChatMemorySummary[]
  messages: ChatMessage[]
  characterWorkflow?: unknown
  characterResource?: ChatCharacterResource
}

export interface ChatSceneState {
  location?: ChatLocalizedText
  status?: ChatLocalizedText | unknown
  equipment?: unknown[]
  rules?: ChatLocalizedText
  [key: string]: unknown
}

export interface ChatMemorySummary {
  id: string
  text: ChatLocalizedText
  createdLabel: ChatLocalizedText
  messageCount: number
  startMessageIndex: number
  endMessageIndex: number
  sourceMessageIds: string[]
}

export type ChatMediaKind = 'image' | 'video' | 'audio'

export interface ChatMessageMedia {
  id: string
  kind: ChatMediaKind
  name: string
  mimeType: string
  dataUrl?: string
  url?: string
  size?: number
  durationMs?: number
  transcript?: string
  prompt?: string
  origin?: 'user' | 'assistant' | 'tool' | 'generated' | 'external'
  dispatch?: {
    trigger?: 'manual' | 'model' | 'tool' | 'external' | 'probability'
    mode?: 'turn' | 'permanent'
    probability?: number
    externalProbabilityBias?: number
    reason?: string
  }
  context?: {
    mode?: 'auto' | 'visual' | 'text' | 'none'
    summary?: string
  }
  metadata?: Record<string, unknown>
}

export interface ChatMessage {
  id: string
  role: ChatMessageRole
  text: ChatLocalizedText
  createdLabel: ChatLocalizedText
  media?: ChatMessageMedia[]
  openingPanel?: ChatOpeningPanel
  state?: ChatActivityState
}

export interface ChatState {
  activeConversationId: string
  characterResources: ChatCharacterResource[]
  conversations: ChatConversationSummary[]
}

type StoredChatConversationInput = Omit<ChatConversationSummary, 'messages'> & {
  messages?: ChatMessage[]
  workflowState?: unknown
}

export function createInitialChatState(): ChatState {
  return {
    activeConversationId: '',
    characterResources: [],
    conversations: [],
  }
}

export async function loadChatResourceState(): Promise<ChatState> {
  const [resourceResponse, historyResponse] = await Promise.all([
    window.electronAPI.listChatRoleResources(),
    window.electronAPI.listChatConversations(),
  ])
  if (!resourceResponse.success) {
    throw new Error(resourceResponse.error || 'Failed to load chat role resources')
  }

  const baseCharacterResources = resourceResponse.resources ?? []
  const characterResources = mergeChatCharacterResources(
    baseCharacterResources,
    extractStoredCharacterResources(historyResponse.conversations ?? [])
  )
  const conversations = normalizeStoredConversations(historyResponse.conversations ?? [], characterResources)
  if (conversations[0]) {
    const detail = await loadStoredConversationDetail(conversations[0].id, characterResources)
    if (detail) {
      conversations[0] = detail
    }
  }
  const seededConversations = conversations.length ? conversations : createSeedHistory(characterResources)

  return {
    activeConversationId: seededConversations[0]?.id ?? '',
    characterResources,
    conversations: seededConversations,
  }
}

export async function hydrateChatConversationDetail(
  conversation: ChatConversationSummary,
  characterResources: ChatCharacterResource[]
): Promise<ChatConversationSummary> {
  if (conversation.messages.length > 0) {
    return conversation
  }
  return await loadStoredConversationDetail(conversation.id, characterResources) ?? conversation
}

export async function hydrateChatConversationWorkflowState(
  conversation: ChatConversationSummary,
  characterResources: ChatCharacterResource[]
): Promise<ChatConversationSummary> {
  const detail = await loadStoredConversationDetail(conversation.id, characterResources, { includeWorkflowState: true })
  if (!detail) {
    return conversation
  }
  return {
    ...conversation,
    sceneState: Object.keys(conversation.sceneState).length ? conversation.sceneState : detail.sceneState,
    summaries: conversation.summaries.length ? conversation.summaries : detail.summaries,
    messages: conversation.messages.length ? conversation.messages : detail.messages,
    characterWorkflow: detail.characterWorkflow,
  }
}

export function applyChatResourceState(target: ChatState, source: ChatState): void {
  target.activeConversationId = source.activeConversationId
  target.characterResources = source.characterResources
  target.conversations = source.conversations
}

export function getActiveConversation(state: ChatState): ChatConversationSummary | undefined {
  return state.conversations.find((conversation) => conversation.id === state.activeConversationId)
    ?? state.conversations[0]
}

export function getCharacterForConversation(
  state: ChatState,
  conversation: ChatConversationSummary
): ChatCharacterResource | undefined {
  return state.characterResources.find((character) => character.id === conversation.characterId)
    ?? state.characterResources[0]
}

export function createLocalUserMessage(text: string, createdLabel: string, media: ChatMessageMedia[] = []): ChatMessage {
  return {
    id: `user-${Date.now()}`,
    role: 'user',
    text: { 'zh-CN': text, 'en-US': text },
    createdLabel: { 'zh-CN': createdLabel, 'en-US': createdLabel },
    ...(media.length ? { media: media.map((item) => ({ ...item })) } : {}),
  }
}

export function createLocalAssistantDraft(text: string, createdLabel: string): ChatMessage {
  return {
    id: `assistant-${Date.now()}`,
    role: 'assistant',
    text: { 'zh-CN': text, 'en-US': text },
    createdLabel: { 'zh-CN': createdLabel, 'en-US': createdLabel },
    state: 'thinking',
  }
}

export function localizeChatText(value: ChatLocalizedText, language: ChatLanguageCode): string {
  return value[language] ?? value['zh-CN']
}

function createSeedHistory(characterResources: ChatCharacterResource[]): ChatConversationSummary[] {
  return characterResources
    .filter((character) => character.id === 'chen-qianyu')
    .map((character) => ({
      id: `${character.id}-history`,
      characterId: character.id,
      title: character.displayName,
      preview: character.firstMessage,
      updatedLabel: {
        'zh-CN': '刚刚',
        'en-US': 'Now',
      },
      sceneState: normalizeSceneState(character.scene),
      summaries: [],
      messages: [
        {
          id: `${character.id}-welcome`,
          role: 'assistant',
          text: character.firstMessage,
          createdLabel: {
            'zh-CN': '刚刚',
            'en-US': 'Now',
          },
        },
      ],
      characterWorkflow: null,
    }))
}

function extractStoredCharacterResources(conversations: StoredChatConversationInput[]): ChatCharacterResource[] {
  return conversations
    .map((conversation) => normalizeStoredCharacterResource(conversation.characterResource))
    .filter(Boolean) as ChatCharacterResource[]
}

function mergeChatCharacterResources(
  baseResources: ChatCharacterResource[],
  storedResources: ChatCharacterResource[]
): ChatCharacterResource[] {
  const merged = [...baseResources]
  for (const resource of storedResources) {
    const existingIndex = merged.findIndex((item) => item.id === resource.id)
    if (existingIndex >= 0) {
      merged[existingIndex] = resource
    } else {
      merged.push(resource)
    }
  }
  return merged
}

function normalizeStoredConversations(
  conversations: StoredChatConversationInput[],
  characterResources: ChatCharacterResource[]
): ChatConversationSummary[] {
  const characterIds = new Set(characterResources.map((character) => character.id))
  return conversations
    .filter((conversation) => conversation.id && characterIds.has(conversation.characterId))
    .map((conversation) => ({
      id: String(conversation.id),
      characterId: String(conversation.characterId),
      title: normalizeLocalizedText(conversation.title),
      preview: normalizeLocalizedText(conversation.preview),
      updatedLabel: normalizeLocalizedText(conversation.updatedLabel),
      sceneState: normalizeSceneState(conversation.sceneState ?? getCharacterScene(characterResources, conversation.characterId)),
      summaries: Array.isArray(conversation.summaries)
        ? conversation.summaries.map(normalizeStoredSummary).filter(Boolean) as ChatMemorySummary[]
        : [],
      messages: Array.isArray(conversation.messages)
        ? conversation.messages.map(normalizeStoredMessage).filter(Boolean) as ChatMessage[]
        : [],
      characterWorkflow: normalizeWorkflowState((conversation as ChatConversationSummary & { workflowState?: unknown }).characterWorkflow ?? (conversation as ChatConversationSummary & { workflowState?: unknown }).workflowState),
      characterResource: normalizeStoredCharacterResource(conversation.characterResource),
    }))
}

function normalizeStoredCharacterResource(value: unknown): ChatCharacterResource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const resource = value as Partial<ChatCharacterResource>
  if (!resource.id) {
    return null
  }
  return {
    id: String(resource.id),
    roleCard: resource.roleCard && typeof resource.roleCard === 'object' && !Array.isArray(resource.roleCard) ? resource.roleCard : undefined,
    openingPanel: normalizeOpeningPanel(resource.openingPanel),
    name: normalizeLocalizedText(resource.name),
    displayName: normalizeLocalizedText(resource.displayName),
    description: normalizeLocalizedText(resource.description),
    story: normalizeLocalizedText(resource.story),
    background: normalizeLocalizedText(resource.background),
    scene: normalizeSceneState(resource.scene),
    firstMessage: normalizeLocalizedText(resource.firstMessage),
    tag: normalizeTagMap(resource.tag),
    avatarImage: typeof resource.avatarImage === 'string' ? resource.avatarImage : '',
    bodyImage: typeof resource.bodyImage === 'string' ? resource.bodyImage : '',
  }
}

async function loadStoredConversationDetail(
  conversationId: string,
  characterResources: ChatCharacterResource[],
  options: { includeWorkflowState?: boolean } = {}
): Promise<ChatConversationSummary | null> {
  const response = await window.electronAPI.getChatConversation(conversationId, {
    includeWorkflowState: Boolean(options.includeWorkflowState),
  })
  if (!response.success) {
    throw new Error(response.error || 'Failed to load chat conversation')
  }
  const [conversation] = normalizeStoredConversations(response.conversation ? [response.conversation] : [], characterResources)
  return conversation?.messages.length ? conversation : null
}

function normalizeWorkflowState(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value
}

function getCharacterScene(characterResources: ChatCharacterResource[], characterId: string): ChatSceneState {
  return characterResources.find((character) => character.id === characterId)?.scene ?? {}
}

function normalizeStoredSummary(summary: ChatMemorySummary): ChatMemorySummary | null {
  if (!summary?.id) {
    return null
  }
  return {
    id: String(summary.id),
    text: normalizeLocalizedText(summary.text),
    createdLabel: normalizeLocalizedText(summary.createdLabel),
    messageCount: Math.max(0, Math.round(Number(summary.messageCount) || 0)),
    startMessageIndex: Math.max(1, Math.round(Number(summary.startMessageIndex) || 1)),
    endMessageIndex: Math.max(1, Math.round(Number(summary.endMessageIndex) || Number(summary.messageCount) || 1)),
    sourceMessageIds: Array.isArray(summary.sourceMessageIds)
      ? summary.sourceMessageIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : [],
  }
}

function normalizeSceneState(value: ChatSceneState | undefined): ChatSceneState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const normalized: ChatSceneState = {}
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'objective' || key === 'items') {
      continue
    }
    normalized[key] = normalizeSceneValue(entry)
  }
  return normalized
}

function normalizeSceneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeSceneValue).filter((item) => {
      if (item === null || item === undefined || item === '') {
        return false
      }
      return !(typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length === 0)
    })
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record['zh-CN'] === 'string' || typeof record['en-US'] === 'string') {
      return normalizeLocalizedText(record as ChatLocalizedText)
    }
    const normalized: Record<string, unknown> = {}
    for (const [key, childValue] of Object.entries(record)) {
      const nextValue = normalizeSceneValue(childValue)
      if (nextValue !== null && nextValue !== undefined && nextValue !== '') {
        normalized[key] = nextValue
      }
    }
    return normalized
  }
  return value
}

function normalizeStoredMessage(message: ChatMessage): ChatMessage | null {
  if (!message?.id || (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'system')) {
    return null
  }
  return {
    id: String(message.id),
    role: message.role,
    text: normalizeLocalizedText(message.text),
    createdLabel: normalizeLocalizedText(message.createdLabel),
    ...(Array.isArray(message.media) ? { media: normalizeStoredMedia(message.media) } : {}),
    ...(normalizeOpeningPanel(message.openingPanel) ? { openingPanel: normalizeOpeningPanel(message.openingPanel)! } : {}),
  }
}

function normalizeStoredMedia(media: ChatMessageMedia[]): ChatMessageMedia[] {
  return media
    .map((item) => ({
      id: typeof item.id === 'string' && item.id.trim() ? item.id : `media-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      kind: item.kind === 'audio' || item.kind === 'video' ? item.kind : 'image',
      name: typeof item.name === 'string' && item.name.trim() ? item.name : 'media',
      mimeType: typeof item.mimeType === 'string' && item.mimeType.trim() ? item.mimeType : defaultMediaMimeType(item.kind),
      dataUrl: typeof item.dataUrl === 'string' && item.dataUrl.trim() ? item.dataUrl : undefined,
      url: typeof item.url === 'string' && item.url.trim() ? item.url : undefined,
      size: typeof item.size === 'number' && Number.isFinite(item.size) && item.size > 0 ? item.size : undefined,
      durationMs: typeof item.durationMs === 'number' && Number.isFinite(item.durationMs) && item.durationMs > 0 ? item.durationMs : undefined,
      transcript: typeof item.transcript === 'string' && item.transcript.trim() ? item.transcript.trim() : undefined,
      prompt: typeof item.prompt === 'string' && item.prompt.trim() ? item.prompt.trim() : undefined,
      origin: item.origin === 'assistant' || item.origin === 'tool' || item.origin === 'generated' || item.origin === 'external' || item.origin === 'user'
        ? item.origin
        : undefined,
      dispatch: normalizeStoredMediaDispatch(item.dispatch),
      context: normalizeStoredMediaContext(item.context),
      metadata: item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
        ? item.metadata
        : undefined,
    }))
    .filter((item) => Boolean(item.dataUrl || item.url || item.transcript || item.prompt))
}

function normalizeStoredMediaDispatch(dispatch: ChatMessageMedia['dispatch']): ChatMessageMedia['dispatch'] {
  if (!dispatch || typeof dispatch !== 'object' || Array.isArray(dispatch)) {
    return undefined
  }
  const normalized: NonNullable<ChatMessageMedia['dispatch']> = {}
  if (dispatch.trigger === 'manual' || dispatch.trigger === 'model' || dispatch.trigger === 'tool' || dispatch.trigger === 'external' || dispatch.trigger === 'probability') {
    normalized.trigger = dispatch.trigger
  }
  if (dispatch.mode === 'turn' || dispatch.mode === 'permanent') {
    normalized.mode = dispatch.mode
  }
  if (typeof dispatch.probability === 'number' && Number.isFinite(dispatch.probability)) {
    normalized.probability = Math.min(1, Math.max(0, dispatch.probability))
  }
  if (typeof dispatch.externalProbabilityBias === 'number' && Number.isFinite(dispatch.externalProbabilityBias)) {
    normalized.externalProbabilityBias = Math.min(1, Math.max(-1, dispatch.externalProbabilityBias))
  }
  if (typeof dispatch.reason === 'string' && dispatch.reason.trim()) {
    normalized.reason = dispatch.reason.trim()
  }
  return Object.keys(normalized).length ? normalized : undefined
}

function normalizeStoredMediaContext(context: ChatMessageMedia['context']): ChatMessageMedia['context'] {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return undefined
  }
  const normalized: NonNullable<ChatMessageMedia['context']> = {}
  if (context.mode === 'auto' || context.mode === 'visual' || context.mode === 'text' || context.mode === 'none') {
    normalized.mode = context.mode
  }
  if (typeof context.summary === 'string' && context.summary.trim()) {
    normalized.summary = context.summary.trim()
  }
  return Object.keys(normalized).length ? normalized : undefined
}

function defaultMediaMimeType(kind: ChatMediaKind): string {
  if (kind === 'video') {
    return 'video/mp4'
  }
  if (kind === 'audio') {
    return 'audio/mpeg'
  }
  return 'image/png'
}

function normalizeOpeningPanel(value: unknown): ChatOpeningPanel | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const record = value as Record<string, unknown>
  const html = typeof record.html === 'string' ? record.html : ''
  const css = typeof record.css === 'string' ? record.css : ''
  if (!html && !css) {
    return undefined
  }
  return {
    html,
    css,
    summary: typeof record.summary === 'string' ? record.summary : undefined,
    layoutKind: typeof record.layoutKind === 'string' ? record.layoutKind : undefined,
    sourceArtifactId: typeof record.sourceArtifactId === 'string' ? record.sourceArtifactId : undefined,
  }
}

function normalizeTagMap(value: unknown): Record<ChatLanguageCode, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { 'zh-CN': [], 'en-US': [] }
  }
  const record = value as Record<string, unknown>
  const zh = Array.isArray(record['zh-CN'])
    ? record['zh-CN'].filter((item): item is string => typeof item === 'string')
    : []
  const en = Array.isArray(record['en-US'])
    ? record['en-US'].filter((item): item is string => typeof item === 'string')
    : zh
  return { 'zh-CN': zh, 'en-US': en }
}

function normalizeLocalizedText(value: ChatLocalizedText | undefined): ChatLocalizedText {
  const zh = typeof value?.['zh-CN'] === 'string' ? value['zh-CN'] : ''
  const en = typeof value?.['en-US'] === 'string' ? value['en-US'] : zh
  return { 'zh-CN': zh, 'en-US': en }
}
