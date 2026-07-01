/**
 * Shared pure helpers for chat conversation runtime state.
 */
import {
  type ChatCharacterContext,
  type ChatMediaItem,
  type ChatMessageContent,
  type ChatMessageContentPart,
} from './index.js'
import type { ChatRuntimeTurnRequest } from './request-runtime.js'

export type ChatRuntimeRole = 'system' | 'user' | 'assistant'
export type ChatRuntimeLanguage = 'zh-CN' | 'en-US'
export type ChatRuntimeLocalizedText = Record<ChatRuntimeLanguage, string>

export interface ChatRuntimeMessage {
  id: string
  role: ChatRuntimeRole
  text: ChatRuntimeLocalizedText
  media?: ChatRuntimeMediaInput[]
  state?: unknown
}

export interface ChatRuntimeSummary {
  id: string
  text: ChatRuntimeLocalizedText
  createdLabel?: ChatRuntimeLocalizedText
  messageCount?: number
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
  content: ChatMessageContent
}

export interface ChatRuntimeNarrativeSummary {
  startMessageIndex: number
  endMessageIndex: number
  text: string
}

export interface ChatRuntimeCharacterResource {
  id?: string
  roleCard?: Record<string, unknown>
  displayName: ChatRuntimeLocalizedText
  description: ChatRuntimeLocalizedText
  story: ChatRuntimeLocalizedText
  background: ChatRuntimeLocalizedText
  firstMessage: ChatRuntimeLocalizedText
  tag?: Partial<Record<ChatRuntimeLanguage, string[]>>
}

export type ChatRuntimeMediaInput = ChatMediaItem

export interface BuildChatRuntimeTurnRequestOptions {
  input: string
  mediaFallbackInput: string
  language: ChatRuntimeLanguage
  preferencePrompt?: string
  options?: Record<string, unknown>
  runtimeOptions: ChatRuntimeConversationOptions
  media?: ChatRuntimeMediaInput[]
  conversation: ChatRuntimeConversation & { sceneState?: Record<string, unknown> }
  draftMessageId: string
  character?: ChatRuntimeCharacterResource
  sceneImmersion: boolean
}

export interface ChatRuntimeConversationOptions {
  shortTermMessageLimit: number
  summaryLimit: number
  summaryBatchMessageCount?: number
}

export interface SummarizeChatConversationOverflowOptions {
  language: ChatRuntimeLanguage
  runtimeOptions: ChatRuntimeConversationOptions
  force?: boolean
  createdLabel?: string
  createSummaryId?: () => string
  summarize: (prompt: string) => Promise<string>
}

export interface ApplyChatRuntimeTurnResultOptions {
  assistantMessageId: string
  content: string
  language: ChatRuntimeLanguage
  sceneUpdate?: Record<string, unknown>
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
      content: buildChatRuntimeContextContent(
        localizeRuntimeText(item.text, options.language),
        normalizeChatRuntimeMedia(item.media)
      ),
    }))
    .filter((item) => hasChatRuntimeContextContent(item.content))
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
      return `#${ordinal} ${formatChatRuntimeHistoryRole(messageItem.role, options.language)}: ${formatChatRuntimeTranscriptMessage(messageItem, options.language)}`
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
    roleCard: character.roleCard,
    sceneState: localizeChatSceneState(options.sceneState, options.language),
    narrativeSummaries: options.narrativeSummaries,
  }
}

export function buildChatRuntimeTurnRequest(options: BuildChatRuntimeTurnRequestOptions): ChatRuntimeTurnRequest {
  const runtimeOptions = normalizeChatRuntimeConversationOptions(options.runtimeOptions)
  const characterContext = options.character
    ? buildChatCharacterContext(options.character, {
      language: options.language,
      sceneImmersion: options.sceneImmersion,
      sceneState: options.conversation.sceneState,
      narrativeSummaries: buildChatNarrativeSummaries(options.conversation, {
        language: options.language,
        shortTermMessageLimit: runtimeOptions.shortTermMessageLimit,
        summaryLimit: runtimeOptions.summaryLimit,
      }),
    })
    : undefined

  return {
    input: options.input || options.mediaFallbackInput,
    language: options.language,
    preferencePrompt: options.preferencePrompt,
    options: options.options,
    runtimeOptions,
    media: normalizeChatRuntimeMedia(options.media),
    messages: buildChatConversationContextMessages(options.conversation, {
      draftMessageId: options.draftMessageId,
      language: options.language,
      shortTermMessageLimit: runtimeOptions.shortTermMessageLimit,
    }),
    character: characterContext,
  }
}

export function normalizeChatRuntimeConversationOptions(options: ChatRuntimeConversationOptions): Required<ChatRuntimeConversationOptions> {
  return {
    shortTermMessageLimit: normalizeMessageLimit(options.shortTermMessageLimit),
    summaryLimit: Math.max(0, Math.round(Number(options.summaryLimit) || 0)),
    summaryBatchMessageCount: Math.max(0, Math.round(Number(options.summaryBatchMessageCount) || 0)),
  }
}

export async function summarizeChatConversationOverflow(
  conversation: ChatRuntimeConversation,
  options: SummarizeChatConversationOverflowOptions
): Promise<ChatRuntimeSummary | null> {
  const runtimeOptions = normalizeChatRuntimeConversationOptions(options.runtimeOptions)
  const batch = selectChatSummaryBatch(conversation, {
    language: options.language,
    shortTermMessageLimit: runtimeOptions.shortTermMessageLimit,
    batchMessageCount: runtimeOptions.summaryBatchMessageCount,
    summaryLimit: runtimeOptions.summaryLimit,
    force: options.force,
  })
  if (!batch) {
    return null
  }

  const summaryText = (await options.summarize(buildChatSummaryPrompt(batch, options.language))).trim()
  if (!summaryText) {
    return null
  }
  const createdLabel = options.createdLabel ?? ''
  return {
    id: options.createSummaryId?.() ?? `summary-${Date.now()}`,
    text: { 'zh-CN': summaryText, 'en-US': summaryText },
    ...(createdLabel ? { createdLabel: { 'zh-CN': createdLabel, 'en-US': createdLabel } } : {}),
    messageCount: batch.messages.length,
    startMessageIndex: batch.startMessageIndex,
    endMessageIndex: batch.endMessageIndex,
    sourceMessageIds: batch.messages.map((messageItem) => messageItem.id),
  }
}

export function applyChatRuntimeTurnResult<
  T extends ChatRuntimeConversation & {
    sceneState?: Record<string, unknown>
    preview?: ChatRuntimeLocalizedText
  }
>(conversation: T, options: ApplyChatRuntimeTurnResultOptions): T {
  const sceneState = options.sceneUpdate
    ? mergeChatSceneState(conversation.sceneState, options.sceneUpdate, options.language)
    : conversation.sceneState
  return {
    ...conversation,
    ...(sceneState ? { sceneState } : {}),
    preview: { 'zh-CN': options.content, 'en-US': options.content },
    messages: conversation.messages.map((messageItem) => messageItem.id === options.assistantMessageId
      ? {
          ...messageItem,
          text: { 'zh-CN': options.content, 'en-US': options.content },
          state: undefined,
        }
      : messageItem),
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

function hasChatRuntimeContextContent(content: ChatMessageContent): boolean {
  if (typeof content === 'string') {
    return Boolean(content.trim())
  }
  return content.length > 0
}

function buildChatRuntimeContextContent(input: string, media: ChatRuntimeMediaInput[]): ChatMessageContent {
  const text = input.trim()
  const mediaNotes = media.map(formatChatRuntimeContextMediaItem).filter(Boolean)
  if (!mediaNotes.length) {
    return text
  }
  const parts: ChatMessageContentPart[] = [{
    type: 'text',
    text: [
      text,
      `<message_media>\n${mediaNotes.join('\n')}\n</message_media>`,
    ].filter(Boolean).join('\n\n'),
  }]
  return parts
}

function formatChatRuntimeContextMediaItem(item: ChatRuntimeMediaInput): string {
  if (item.context?.mode === 'none') {
    return ''
  }
  const fields: Record<string, unknown> = {
    kind: item.kind,
    name: item.name,
    mimeType: item.mimeType,
  }
  if (item.id) fields.id = item.id
  if (item.size) fields.size = item.size
  if (item.durationMs) fields.durationMs = item.durationMs
  if (item.origin) fields.origin = item.origin
  if (item.prompt?.trim()) fields.prompt = item.prompt.trim()
  if (item.transcript?.trim()) fields.transcript = item.transcript.trim()
  if (item.context?.summary?.trim()) fields.summary = item.context.summary.trim()
  if (item.dispatch) {
    const dispatch = normalizeRuntimeMediaDispatchForContext(item.dispatch)
    if (Object.keys(dispatch).length) {
      fields.dispatch = dispatch
    }
  }
  if (item.dataUrl || item.url) {
    fields.context = item.kind === 'image' ? 'text_anchor' : 'transcript_or_metadata'
  }
  return JSON.stringify(fields)
}

function normalizeChatRuntimeMedia(media: ChatRuntimeMediaInput[] | undefined): ChatRuntimeMediaInput[] {
  if (!Array.isArray(media)) {
    return []
  }
  return media
    .map((item): ChatRuntimeMediaInput => {
      const kind: ChatRuntimeMediaInput['kind'] = item.kind === 'video' || item.kind === 'audio' ? item.kind : 'image'
      return {
        id: optionalString(item.id),
        kind,
        name: optionalString(item.name) ?? 'media',
        mimeType: optionalString(item.mimeType) ?? defaultRuntimeMediaMimeType(kind),
        dataUrl: optionalString(item.dataUrl),
        url: optionalString(item.url),
        size: positiveNumber(item.size),
        durationMs: positiveNumber(item.durationMs),
        transcript: optionalString(item.transcript),
        prompt: optionalString(item.prompt),
        origin: item.origin === 'assistant' || item.origin === 'tool' || item.origin === 'generated' || item.origin === 'external' || item.origin === 'user'
          ? item.origin
          : undefined,
        dispatch: normalizeRuntimeMediaDispatch(item.dispatch),
        context: normalizeRuntimeMediaContext(item.context),
        metadata: item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
          ? item.metadata
          : undefined,
      }
    })
    .filter((item) => Boolean(item.dataUrl || item.url || item.transcript || item.prompt))
}

function defaultRuntimeMediaMimeType(kind: ChatRuntimeMediaInput['kind']): string {
  if (kind === 'video') {
    return 'video/mp4'
  }
  if (kind === 'audio') {
    return 'audio/mpeg'
  }
  return 'image/png'
}

function normalizeRuntimeMediaDispatch(dispatch: ChatRuntimeMediaInput['dispatch']): ChatRuntimeMediaInput['dispatch'] {
  if (!dispatch || typeof dispatch !== 'object' || Array.isArray(dispatch)) {
    return undefined
  }
  const normalized: NonNullable<ChatRuntimeMediaInput['dispatch']> = {}
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
  if (dispatch.reason?.trim()) {
    normalized.reason = dispatch.reason.trim()
  }
  return Object.keys(normalized).length ? normalized : undefined
}

function normalizeRuntimeMediaDispatchForContext(dispatch: NonNullable<ChatRuntimeMediaInput['dispatch']>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  if (dispatch.trigger) normalized.trigger = dispatch.trigger
  if (dispatch.mode) normalized.mode = dispatch.mode
  if (typeof dispatch.probability === 'number' && Number.isFinite(dispatch.probability)) {
    normalized.probability = Math.min(1, Math.max(0, dispatch.probability))
  }
  if (typeof dispatch.externalProbabilityBias === 'number' && Number.isFinite(dispatch.externalProbabilityBias)) {
    normalized.externalProbabilityBias = Math.min(1, Math.max(-1, dispatch.externalProbabilityBias))
  }
  if (dispatch.reason?.trim()) normalized.reason = dispatch.reason.trim()
  return normalized
}

function normalizeRuntimeMediaContext(context: ChatRuntimeMediaInput['context']): ChatRuntimeMediaInput['context'] {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return undefined
  }
  const normalized: NonNullable<ChatRuntimeMediaInput['context']> = {}
  if (context.mode === 'auto' || context.mode === 'visual' || context.mode === 'text' || context.mode === 'none') {
    normalized.mode = context.mode
  }
  if (context.summary?.trim()) {
    normalized.summary = context.summary.trim()
  }
  return Object.keys(normalized).length ? normalized : undefined
}

function formatChatRuntimeTranscriptMessage(message: ChatRuntimeMessage, language: ChatRuntimeLanguage): string {
  const text = localizeRuntimeText(message.text, language)
  const media = formatChatRuntimeTranscriptMedia(message.media)
  return [text, media].filter(Boolean).join('\n')
}

function formatChatRuntimeTranscriptMedia(media: ChatRuntimeMediaInput[] | undefined): string {
  const normalized = normalizeChatRuntimeMedia(media)
  if (!normalized.length) {
    return ''
  }
  return normalized
    .map((item) => {
      const details = [
        item.mimeType,
        item.size ? `${Math.round(item.size / 1024)} KB` : '',
        item.durationMs ? `${Math.round(item.durationMs / 1000)}s` : '',
        item.dispatch?.mode === 'permanent' ? 'permanent' : '',
      ].filter(Boolean).join(', ')
      const prompt = item.prompt ? ` prompt="${item.prompt}"` : ''
      const transcript = item.transcript ? ` transcript="${item.transcript}"` : ''
      const summary = item.context?.summary ? ` summary="${item.context.summary}"` : ''
      return `- ${item.kind}: ${item.name}${details ? ` (${details})` : ''}${prompt}${transcript}${summary}`
    })
    .join('\n')
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function positiveNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
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
