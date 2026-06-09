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
  background: ChatLocalizedText
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
  messages: ChatMessage[]
}

export interface ChatMessage {
  id: string
  role: ChatMessageRole
  text: ChatLocalizedText
  createdLabel: ChatLocalizedText
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
  const response = await window.electronAPI.listChatRoleResources()
  if (!response.success) {
    throw new Error(response.error || 'Failed to load chat role resources')
  }

  const characterResources = response.resources ?? []
  const conversations = createSeedHistory(characterResources)

  return {
    activeConversationId: conversations[0]?.id ?? '',
    characterResources,
    conversations,
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

export function createLocalUserMessage(text: string, createdLabel: string): ChatMessage {
  return {
    id: `user-${Date.now()}`,
    role: 'user',
    text: { 'zh-CN': text, 'en-US': text },
    createdLabel: { 'zh-CN': createdLabel, 'en-US': createdLabel },
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
    }))
}
