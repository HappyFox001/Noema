/**
 * Defines the renderer-side chat resources and seeded history.
 */
export type ChatLanguageCode = 'zh-CN' | 'en-US'

export type ChatMessageRole = 'user' | 'assistant' | 'system'

export type ChatActivityState = 'idle' | 'thinking' | 'generating_image' | 'using_tool'

export type ChatLocalizedText = Record<ChatLanguageCode, string>

export interface ChatCharacterResource {
  id: string
  displayName: ChatLocalizedText
  nativeName: string
  subtitle: ChatLocalizedText
  description: ChatLocalizedText
  avatarClass: string
  accent: string
  locale: string
  sourceUrl: string
  sourceLabel: string
  tags: ChatLocalizedText[]
  profileFields: ChatCharacterProfileField[]
  suggestedPrompts: ChatLocalizedText[]
}

export interface ChatCharacterProfileField {
  id: string
  label: ChatLocalizedText
  value: ChatLocalizedText
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

const CHEN_QIANYU_RESOURCE: ChatCharacterResource = {
  id: 'chen-qianyu',
  displayName: {
    'zh-CN': '陈千语',
    'en-US': 'Chen Qianyu',
  },
  nativeName: '陈千语',
  subtitle: {
    'zh-CN': '明日方舟：终末地 · 角色资料测试',
    'en-US': 'Arknights: Endfield · profile test resource',
  },
  description: {
    'zh-CN': '终末地工业特勤干员，剑术与身体能力突出。这个资源只保留基础身份字段、简短描述和来源链接，用于 chat 历史角色列表测试。',
    'en-US': 'An Endfield Industries specialist operator known for sword practice and strong physical ability. This test resource keeps only basic identity fields, a short note, and source links.',
  },
  avatarClass: 'chen-qianyu-avatar',
  accent: 'CQ',
  locale: 'zh-CN',
  sourceUrl: 'https://end.wiki/zh-Hans/characters/chr-0005-chen/',
  sourceLabel: 'end.wiki',
  tags: [
    { 'zh-CN': '历史对话', 'en-US': 'history' },
    { 'zh-CN': '物理', 'en-US': 'physical' },
    { 'zh-CN': '近卫', 'en-US': 'guard' },
    { 'zh-CN': '剑', 'en-US': 'sword' },
  ],
  profileFields: [
    {
      id: 'source',
      label: { 'zh-CN': '来源', 'en-US': 'Source' },
      value: { 'zh-CN': '明日方舟：终末地', 'en-US': 'Arknights: Endfield' },
    },
    {
      id: 'rarity',
      label: { 'zh-CN': '稀有度', 'en-US': 'Rarity' },
      value: { 'zh-CN': '5 星', 'en-US': '5-star' },
    },
    {
      id: 'role',
      label: { 'zh-CN': '定位', 'en-US': 'Role' },
      value: { 'zh-CN': '物理 / 近卫 / 剑', 'en-US': 'Physical / Guard / Sword' },
    },
    {
      id: 'faction',
      label: { 'zh-CN': '阵营', 'en-US': 'Faction' },
      value: { 'zh-CN': '终末地工业', 'en-US': 'Endfield Industries' },
    },
    {
      id: 'birthday',
      label: { 'zh-CN': '生日', 'en-US': 'Birthday' },
      value: { 'zh-CN': '8 月 18 日', 'en-US': 'August 18' },
    },
    {
      id: 'trait',
      label: { 'zh-CN': '基础特征', 'en-US': 'Profile note' },
      value: {
        'zh-CN': '武术训练、宏山剑术、耐力训练',
        'en-US': 'Martial arts, Hongshan swordmancy, endurance training',
      },
    },
  ],
  suggestedPrompts: [
    {
      'zh-CN': '用基础字段生成一段角色开场白',
      'en-US': 'Draft an intro from the basic profile',
    },
    {
      'zh-CN': '把这套资料整理成角色资源 JSON',
      'en-US': 'Turn this profile into character JSON',
    },
    {
      'zh-CN': '只保留聊天需要的字段',
      'en-US': 'Keep only chat-facing fields',
    },
  ],
}

export function createInitialChatState(): ChatState {
  return {
    activeConversationId: 'chen-qianyu-history',
    characterResources: [CHEN_QIANYU_RESOURCE],
    conversations: [
      {
        id: 'chen-qianyu-history',
        characterId: CHEN_QIANYU_RESOURCE.id,
        title: CHEN_QIANYU_RESOURCE.displayName,
        preview: {
          'zh-CN': '已导入基础资料，可用于角色资源和历史对话列表测试。',
          'en-US': 'Basic profile imported for character resource and history list testing.',
        },
        updatedLabel: {
          'zh-CN': '测试',
          'en-US': 'Test',
        },
        messages: [
          {
            id: 'chen-qianyu-welcome',
            role: 'assistant',
            text: {
              'zh-CN': '陈千语基础资料已接入。当前 chat 列表只展示有历史对话的角色。',
              'en-US': 'Chen Qianyu basic profile is connected. The chat list now shows only characters with conversation history.',
            },
            createdLabel: {
              'zh-CN': '测试',
              'en-US': 'Test',
            },
          },
        ],
      },
    ],
  }
}

export function getActiveConversation(state: ChatState): ChatConversationSummary {
  return state.conversations.find((conversation) => conversation.id === state.activeConversationId)
    ?? state.conversations[0]
}

export function getCharacterForConversation(
  state: ChatState,
  conversation: ChatConversationSummary
): ChatCharacterResource {
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
