/**
 * Defines the renderer-side chat model used by the chat surface.
 */
export type ChatMessageRole = 'user' | 'assistant' | 'system'

export type ChatActivityState = 'idle' | 'thinking' | 'generating_image' | 'using_tool'

export interface ChatCharacterPackSummary {
  id: string
  name: string
  displayName: string
  description: string
  avatarClass: string
  accent: string
  language: string
  packVersion: string
  source: 'built-in' | 'local' | 'draft'
  tags: string[]
  capabilities: Array<'text' | 'voice' | 'image' | 'tools'>
  assets: ChatCharacterAssetSummary[]
  suggestedPrompts: string[]
}

export interface ChatCharacterAssetSummary {
  id: string
  label: string
  kind: 'portrait' | 'expression' | 'reference' | 'voice' | 'prompt'
  status: 'ready' | 'missing' | 'draft'
}

export interface ChatConversationSummary {
  id: string
  characterId: string
  title: string
  preview: string
  updatedLabel: string
  messages: ChatMessage[]
}

export interface ChatMessage {
  id: string
  role: ChatMessageRole
  text: string
  createdLabel: string
  state?: ChatActivityState
}

export interface ChatState {
  activeConversationId: string
  characters: ChatCharacterPackSummary[]
  conversations: ChatConversationSummary[]
}

const EVA_CHARACTER: ChatCharacterPackSummary = {
  id: 'eva',
  name: 'EVA',
  displayName: '陈知遥 / EVA',
  description: '熟悉、轻松、反应快的陪伴角色。默认短句回应，保留分寸，不把普通聊天写成故事。',
  avatarClass: 'eva-avatar',
  accent: 'EVA',
  language: 'zh-CN',
  packVersion: 'local-yaml',
  source: 'built-in',
  tags: ['companion', 'voice-ready', 'zh-CN'],
  capabilities: ['text', 'voice', 'tools'],
  assets: [
    { id: 'persona', label: 'persona.yaml', kind: 'prompt', status: 'ready' },
    { id: 'voice', label: 'Voice preset', kind: 'voice', status: 'draft' },
    { id: 'portrait', label: 'Portrait', kind: 'portrait', status: 'missing' },
    { id: 'expressions', label: 'Expression set', kind: 'expression', status: 'draft' },
  ],
  suggestedPrompts: ['今天聊点轻松的', '帮我整理一下现在的想法', '生成一张角色头像草稿'],
}

const DESIGN_DRAFT_CHARACTER: ChatCharacterPackSummary = {
  id: 'character-pack-draft',
  name: '角色包草稿',
  displayName: 'Character Pack Draft',
  description: '用于验证角色资源包创建流程的草稿角色，覆盖 manifest、persona、头像、声音和图片生成配置。',
  avatarClass: 'pack-avatar',
  accent: 'CP',
  language: 'zh-CN',
  packVersion: 'draft',
  source: 'draft',
  tags: ['draft', 'image-ready', 'schema'],
  capabilities: ['text', 'image', 'tools'],
  assets: [
    { id: 'manifest', label: 'manifest.json', kind: 'prompt', status: 'draft' },
    { id: 'generation', label: 'generation.json', kind: 'reference', status: 'draft' },
    { id: 'cover', label: 'cover.png', kind: 'portrait', status: 'missing' },
    { id: 'voice', label: 'voice.json', kind: 'voice', status: 'draft' },
  ],
  suggestedPrompts: ['创建一个新角色资源包', '导入已有角色卡', '检查资源包缺失项'],
}

const LOCAL_ASSISTANT_CHARACTER: ChatCharacterPackSummary = {
  id: 'runtime-assistant',
  name: 'Runtime',
  displayName: 'Noema Runtime',
  description: '面向工具调用和任务执行的运行时角色，用于展示流式文本、工具状态和本地任务结果。',
  avatarClass: 'runtime-avatar',
  accent: 'RT',
  language: 'zh-CN',
  packVersion: 'system',
  source: 'local',
  tags: ['tools', 'runtime', 'streaming'],
  capabilities: ['text', 'tools'],
  assets: [
    { id: 'tools', label: 'tools.json', kind: 'prompt', status: 'ready' },
    { id: 'memory', label: 'memory_seed.md', kind: 'prompt', status: 'draft' },
    { id: 'references', label: 'references/', kind: 'reference', status: 'missing' },
  ],
  suggestedPrompts: ['总结当前项目结构', '展示一次工具调用状态', '把结果保存到会话'],
}

export function createInitialChatState(): ChatState {
  const characters = [EVA_CHARACTER, DESIGN_DRAFT_CHARACTER, LOCAL_ASSISTANT_CHARACTER]
  return {
    activeConversationId: 'eva-main',
    characters,
    conversations: [
      {
        id: 'eva-main',
        characterId: EVA_CHARACTER.id,
        title: EVA_CHARACTER.displayName,
        preview: '嗯，我在。你想先聊角色包，还是先改 chat 页面？',
        updatedLabel: '现在',
        messages: [
          {
            id: 'eva-welcome',
            role: 'assistant',
            text: '嗯，我在。你想先聊角色包，还是先改 chat 页面？',
            createdLabel: '现在',
          },
        ],
      },
      {
        id: 'pack-design',
        characterId: DESIGN_DRAFT_CHARACTER.id,
        title: DESIGN_DRAFT_CHARACTER.displayName,
        preview: '资源包草稿已准备，下一步可以补 manifest 和资产校验。',
        updatedLabel: '草稿',
        messages: [
          {
            id: 'pack-welcome',
            role: 'assistant',
            text: '资源包草稿已准备。下一步可以补 manifest、persona、头像和图片生成配置。',
            createdLabel: '草稿',
          },
        ],
      },
      {
        id: 'runtime-flow',
        characterId: LOCAL_ASSISTANT_CHARACTER.id,
        title: LOCAL_ASSISTANT_CHARACTER.displayName,
        preview: '这里用于预览流式渲染、工具调用和本地任务消息。',
        updatedLabel: '预览',
        messages: [
          {
            id: 'runtime-welcome',
            role: 'assistant',
            text: '这里用于预览流式渲染、工具调用和本地任务消息。实际执行仍由 runtime 负责。',
            createdLabel: '预览',
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
): ChatCharacterPackSummary {
  return state.characters.find((character) => character.id === conversation.characterId)
    ?? state.characters[0]
}

export function createLocalUserMessage(text: string, createdLabel: string): ChatMessage {
  return {
    id: `user-${Date.now()}`,
    role: 'user',
    text,
    createdLabel,
  }
}

export function createLocalAssistantDraft(text: string, createdLabel: string): ChatMessage {
  return {
    id: `assistant-${Date.now()}`,
    role: 'assistant',
    text,
    createdLabel,
    state: 'thinking',
  }
}
