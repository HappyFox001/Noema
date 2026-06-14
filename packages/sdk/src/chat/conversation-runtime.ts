/**
 * Shared pure helpers for chat conversation runtime state.
 */
import type { ChatCharacterContext } from './index.js'

export type ChatRuntimeRole = 'system' | 'user' | 'assistant'
export type ChatRuntimeLanguage = 'zh-CN' | 'en-US'
export type ChatRuntimeLocalizedText = Record<ChatRuntimeLanguage, string>

export interface ChatRuntimeMessage {
  id: string
  role: ChatRuntimeRole
  text: ChatRuntimeLocalizedText
  state?: unknown
}

export interface ChatRuntimeSummary {
  id: string
  text: ChatRuntimeLocalizedText
  startMessageIndex: number
  endMessageIndex: number
  sourceMessageIds: string[]
}

export interface ChatRuntimeConversation {
  messages: ChatRuntimeMessage[]
  summaries: ChatRuntimeSummary[]
}

export interface ChatRuntimeContextMessage {
  role: ChatRuntimeRole
  content: string
}

export interface ChatRuntimeNarrativeSummary {
  startMessageIndex: number
  endMessageIndex: number
  text: string
}

export interface ChatRuntimeCharacterResource {
  id?: string
  displayName: ChatRuntimeLocalizedText
  description: ChatRuntimeLocalizedText
  story: ChatRuntimeLocalizedText
  background: ChatRuntimeLocalizedText
  firstMessage: ChatRuntimeLocalizedText
  tag?: Partial<Record<ChatRuntimeLanguage, string[]>>
}

export interface ChatRuntimeSummaryBatch {
  messages: ChatRuntimeMessage[]
  startMessageIndex: number
  endMessageIndex: number
  transcript: string
}

export function buildChatSummaryPrompt(
  batch: Pick<ChatRuntimeSummaryBatch, 'startMessageIndex' | 'endMessageIndex' | 'transcript'>,
  language: ChatRuntimeLanguage
): string {
  return language === 'zh-CN'
    ? [
        '请把下面这段历史对话压缩成短期上下文摘要。',
        `这是原始对话第 ${batch.startMessageIndex} -> ${batch.endMessageIndex} 条消息的摘要。`,
        '要求：保留事实、关系变化、未完成承诺、用户偏好、角色状态和重要情绪；不要加入新剧情；用 3-6 条紧凑要点。',
        '',
        batch.transcript,
      ].join('\n')
    : [
        'Compress the following chat history into a short-term context summary.',
        `This summary covers original conversation messages ${batch.startMessageIndex} -> ${batch.endMessageIndex}.`,
        'Keep facts, relationship changes, unresolved commitments, user preferences, character state, and important emotions. Do not invent new events. Use 3-6 compact bullets.',
        '',
        batch.transcript,
      ].join('\n')
}

export function buildChatConversationContextMessages(
  conversation: Pick<ChatRuntimeConversation, 'messages'>,
  options: {
    draftMessageId: string
    language: ChatRuntimeLanguage
    shortTermMessageLimit: number
  }
): ChatRuntimeContextMessage[] {
  const sourceMessages = conversation.messages
    .filter((item) => item.id !== options.draftMessageId && item.state === undefined)
    .slice(0, -1)
  return sourceMessages
    .slice(-normalizeMessageLimit(options.shortTermMessageLimit))
    .map((item) => ({
      role: normalizeRuntimeRole(item.role),
      content: localizeRuntimeText(item.text, options.language),
    }))
}

export function selectChatSummaryBatch(
  conversation: ChatRuntimeConversation,
  options: {
    language: ChatRuntimeLanguage
    shortTermMessageLimit: number
    batchMessageCount: number
    summaryLimit: number
    force?: boolean
  }
): ChatRuntimeSummaryBatch | null {
  const keepMessages = normalizeMessageLimit(options.shortTermMessageLimit)
  const summarizedIds = new Set(conversation.summaries.flatMap((summary) => summary.sourceMessageIds))
  const stableMessages = conversation.messages.filter((messageItem) => messageItem.state === undefined)
  const candidateMessages = stableMessages.filter((messageItem) => !summarizedIds.has(messageItem.id))
  const overflowCount = candidateMessages.length - keepMessages
  const configuredBatchSize = Math.max(0, Math.round(options.batchMessageCount))
  const batchSize = options.force
    ? Math.min(configuredBatchSize, Math.max(0, overflowCount))
    : configuredBatchSize

  if (overflowCount < batchSize || batchSize <= 0 || Math.round(options.summaryLimit) <= 0) {
    return null
  }

  const messages = candidateMessages.slice(0, batchSize)
  const startMessageIndex = getChatMessageOrdinal(conversation, messages[0]?.id)
  const endMessageIndex = getChatMessageOrdinal(conversation, messages[messages.length - 1]?.id)
  const transcript = messages
    .map((messageItem) => {
      const ordinal = getChatMessageOrdinal(conversation, messageItem.id)
      return `#${ordinal} ${formatChatRuntimeHistoryRole(messageItem.role, options.language)}: ${localizeRuntimeText(messageItem.text, options.language)}`
    })
    .join('\n\n')

  return transcript.trim()
    ? { messages, startMessageIndex, endMessageIndex, transcript }
    : null
}

export function buildChatNarrativeSummaries(
  conversation: ChatRuntimeConversation,
  options: {
    language: ChatRuntimeLanguage
    shortTermMessageLimit: number
    summaryLimit: number
  }
): ChatRuntimeNarrativeSummary[] {
  const keepMessages = normalizeMessageLimit(options.shortTermMessageLimit)
  const recentIds = new Set(
    conversation.messages
      .filter((item) => item.state === undefined)
      .slice(-keepMessages)
      .map((item) => item.id)
  )
  return trimChatSummaries(conversation.summaries, options.summaryLimit)
    .filter((summary) => !summary.sourceMessageIds.some((id) => recentIds.has(id)))
    .map((summary) => ({
      startMessageIndex: summary.startMessageIndex,
      endMessageIndex: summary.endMessageIndex,
      text: localizeRuntimeText(summary.text, options.language),
    }))
    .filter((summary) => summary.text.trim())
}

export function buildChatCharacterContext(
  character: ChatRuntimeCharacterResource,
  options: {
    language: ChatRuntimeLanguage
    sceneImmersion: boolean
    sceneState?: Record<string, unknown>
    narrativeSummaries?: ChatRuntimeNarrativeSummary[]
  }
): ChatCharacterContext {
  return {
    id: character.id,
    displayName: localizeRuntimeText(character.displayName, options.language),
    description: localizeRuntimeText(character.description, options.language),
    story: localizeRuntimeText(character.story, options.language),
    background: options.sceneImmersion ? localizeRuntimeText(character.background, options.language) : '',
    firstMessage: options.sceneImmersion ? localizeRuntimeText(character.firstMessage, options.language) : '',
    tags: character.tag?.[options.language] ?? character.tag?.['zh-CN'],
    sceneState: localizeChatSceneState(options.sceneState, options.language),
    narrativeSummaries: options.narrativeSummaries,
  }
}

export function trimChatSummaries<T>(summaries: T[], summaryLimit: number): T[] {
  const limit = Math.round(summaryLimit)
  return limit <= 0 ? [] : summaries.slice(-limit)
}

export function getChatMessageOrdinal(
  conversation: Pick<ChatRuntimeConversation, 'messages'>,
  messageId: string | undefined
): number {
  if (!messageId) {
    return 1
  }
  const index = conversation.messages.findIndex((messageItem) => messageItem.id === messageId)
  return index >= 0 ? index + 1 : 1
}

export function extractChatSceneUpdate(text: string): { text: string; update: Record<string, unknown> | null } {
  const match = text.match(/<scene_update>\s*([\s\S]*?)\s*<\/scene_update>/i)
  if (!match) {
    return { text: stripChatSceneUpdateMarkup(text).trim(), update: null }
  }
  try {
    const parsed = JSON.parse(match[1])
    return {
      text: text.replace(match[0], '').trim(),
      update: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null,
    }
  } catch {
    return { text: text.replace(match[0], '').trim(), update: null }
  }
}

export function stripChatSceneUpdateMarkup(text: string): string {
  return text
    .replace(/<scene_update>\s*[\s\S]*?<\/scene_update>/gi, '')
    .replace(/<scene_update[\s\S]*$/i, '')
}

export function mergeChatSceneState(
  current: Record<string, unknown> | undefined,
  update: Record<string, unknown>,
  language: ChatRuntimeLanguage
): Record<string, unknown> {
  const next = { ...(current ?? {}) }
  for (const [key, value] of Object.entries(update)) {
    if (key === 'objective' || key === 'items') {
      continue
    }
    if (value === null || value === undefined || value === '') {
      continue
    }
    next[key] = normalizeSceneUpdateValue(value, language, next[key])
  }
  return next
}

export function localizeChatSceneState(
  sceneState: Record<string, unknown> | undefined,
  language: ChatRuntimeLanguage
): Record<string, unknown> {
  const localized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(sceneState ?? {})) {
    if (key === 'objective' || key === 'items') {
      continue
    }
    localized[key] = localizeChatSceneValue(value, language)
  }
  return localized
}

export function localizeRuntimeText(value: ChatRuntimeLocalizedText, language: ChatRuntimeLanguage): string {
  return value[language] ?? value['zh-CN'] ?? value['en-US'] ?? ''
}

export function formatChatRuntimeHistoryRole(role: ChatRuntimeRole, language: ChatRuntimeLanguage): string {
  if (language === 'zh-CN') {
    return role === 'assistant' ? '角色' : role === 'user' ? '用户' : '系统'
  }
  return role === 'assistant' ? 'Assistant' : role === 'user' ? 'User' : 'System'
}

function normalizeRuntimeRole(role: ChatRuntimeRole): ChatRuntimeRole {
  return role === 'system' || role === 'assistant' ? role : 'user'
}

function normalizeMessageLimit(value: number): number {
  return Math.max(2, Math.round(Number(value) || 0))
}

function normalizeSceneUpdateValue(value: unknown, language: ChatRuntimeLanguage, existing?: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSceneUpdateValue(item, language))
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record['zh-CN'] === 'string' || typeof record['en-US'] === 'string') {
      return record
    }
    const normalized: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(record)) {
      normalized[childKey] = normalizeSceneUpdateValue(childValue, language)
    }
    return normalized
  }
  const localized = existing && !Array.isArray(existing) && typeof existing === 'object'
    ? { ...(existing as Record<string, string>) }
    : { 'zh-CN': '', 'en-US': '' }
  localized[language] = String(value)
  return localized
}

function localizeChatSceneValue(value: unknown, language: ChatRuntimeLanguage): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => localizeChatSceneValue(item, language))
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record['zh-CN'] === 'string' || typeof record['en-US'] === 'string') {
      return localizeRuntimeText(record as ChatRuntimeLocalizedText, language)
    }
    const localized: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(record)) {
      localized[childKey] = localizeChatSceneValue(childValue, language)
    }
    return localized
  }
  return value
}
