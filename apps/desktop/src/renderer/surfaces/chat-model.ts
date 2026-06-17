/**
 * Defines chat resource manifests and runtime chat state loading.
 */
export type ChatLanguageCode = 'zh-CN' | 'en-US'

export type ChatMessageRole = 'user' | 'assistant' | 'system'

export type ChatActivityState = 'idle' | 'thinking' | 'generating_image' | 'using_tool'

export type ChatLocalizedText = Record<ChatLanguageCode, string>

export interface ChatCharacterResource {
  id: string
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

export interface ChatMessageAttachment {
  id: string
  kind: 'image' | 'video'
  name: string
  mimeType: string
  dataUrl?: string
  size?: number
}

export interface ChatMessage {
  id: string
  role: ChatMessageRole
  text: ChatLocalizedText
  createdLabel: ChatLocalizedText
  attachments?: ChatMessageAttachment[]
  state?: ChatActivityState
}

export interface ChatState {
  activeConversationId: string
  characterResources: ChatCharacterResource[]
  conversations: ChatConversationSummary[]
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

  const characterResources = resourceResponse.resources ?? []
  const conversations = normalizeStoredConversations(historyResponse.conversations ?? [], characterResources)
  const seededConversations = conversations.length ? conversations : createSeedHistory(characterResources)

  return {
    activeConversationId: seededConversations[0]?.id ?? '',
    characterResources,
    conversations: seededConversations,
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

export function createLocalUserMessage(text: string, createdLabel: string, attachments: ChatMessageAttachment[] = []): ChatMessage {
  return {
    id: `user-${Date.now()}`,
    role: 'user',
    text: { 'zh-CN': text, 'en-US': text },
    createdLabel: { 'zh-CN': createdLabel, 'en-US': createdLabel },
    ...(attachments.length ? { attachments: attachments.map((attachment) => ({ ...attachment })) } : {}),
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

function normalizeStoredConversations(
  conversations: ChatConversationSummary[],
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
    }))
    .filter((conversation) => conversation.messages.length > 0)
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
    ...(Array.isArray(message.attachments) ? { attachments: message.attachments } : {}),
  }
}

function normalizeLocalizedText(value: ChatLocalizedText | undefined): ChatLocalizedText {
  const zh = typeof value?.['zh-CN'] === 'string' ? value['zh-CN'] : ''
  const en = typeof value?.['en-US'] === 'string' ? value['en-US'] : zh
  return { 'zh-CN': zh, 'en-US': en }
}
