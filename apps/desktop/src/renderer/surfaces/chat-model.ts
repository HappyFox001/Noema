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

const CHAT_RESOURCE_MANIFESTS = [
  '/chat-resources/chen-qianyu/manifest.json',
]

export function createInitialChatState(): ChatState {
  return {
    activeConversationId: '',
    characterResources: [],
    conversations: [],
  }
}

export async function loadChatResourceState(): Promise<ChatState> {
  const characterResources = await Promise.all(CHAT_RESOURCE_MANIFESTS.map(loadChatResourceManifest))
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
      preview: {
        'zh-CN': '已导入角色资源，可用于历史对话列表测试。',
        'en-US': 'Character resource imported for history list testing.',
      },
      updatedLabel: {
        'zh-CN': '测试',
        'en-US': 'Test',
      },
      messages: [
        {
          id: `${character.id}-welcome`,
          role: 'assistant',
          text: {
            'zh-CN': '陈千语角色资源已接入。当前 chat 列表只展示有历史对话的角色。',
            'en-US': 'Chen Qianyu character resource is connected. The chat list now shows only characters with conversation history.',
          },
          createdLabel: {
            'zh-CN': '测试',
            'en-US': 'Test',
          },
        },
      ],
    }))
}

async function loadChatResourceManifest(path: string): Promise<ChatCharacterResource> {
  const response = await fetch(path)
  if (!response.ok) {
    throw new Error(`Failed to load chat resource manifest: ${path}`)
  }
  return await response.json() as ChatCharacterResource
}
