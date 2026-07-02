/**
 * Independent text chat runtime built on the generic LLM provider.
 */
import { createLLMProvider, type LLMProvider, type LLMProviderOptions, type LLMResponse } from '../llm/index.js'
import { buildChatOutputConstraintPrompt } from './prompts/output-constraints.js'
import { DEFAULT_CHAT_SYSTEM_PROMPT } from './prompts/system.js'

export * from './prompts/index.js'

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatModelConfig {
  provider?: string
  transport?: 'openai_compatible' | 'codex_local' | 'claude_code_local'
  apiKey: string
  model: string
  baseURL?: string
}

export interface ChatMessage {
  role: ChatRole
  content: ChatMessageContent
}

export type ChatMessageContent = string | ChatMessageContentPart[]

export type ChatMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type ChatMediaKind = 'image' | 'video' | 'audio'
export type ChatMediaOrigin = 'user' | 'assistant' | 'tool' | 'generated' | 'external'
export type ChatMediaDispatchTrigger = 'manual' | 'model' | 'request' | 'auto' | 'tool' | 'external' | 'probability'
export type ChatMediaDispatchMode = 'turn' | 'permanent'
export type ChatMediaContextMode = 'auto' | 'visual' | 'text' | 'none'

export interface ChatMediaDispatchPolicy {
  trigger?: ChatMediaDispatchTrigger
  mode?: ChatMediaDispatchMode
  probability?: number
  externalProbabilityBias?: number
  reason?: string
}

export interface ChatMediaContextPolicy {
  mode?: ChatMediaContextMode
  summary?: string
}

export interface ChatMediaItem {
  id?: string
  kind: ChatMediaKind
  name: string
  mimeType: string
  dataUrl?: string
  url?: string
  size?: number
  durationMs?: number
  transcript?: string
  prompt?: string
  origin?: ChatMediaOrigin
  dispatch?: ChatMediaDispatchPolicy
  context?: ChatMediaContextPolicy
  metadata?: Record<string, unknown>
}

export interface ChatCharacterContext {
  id?: string
  displayName?: string
  description?: string
  story?: string
  background?: string
  firstMessage?: string
  roleCard?: Record<string, unknown>
  tags?: string[]
  instructions?: string
  sceneState?: Record<string, unknown>
  canonMemory?: string[]
  narrativeSummaries?: Array<{
    startMessageIndex?: number
    endMessageIndex?: number
    text: string
  }>
}

export interface ChatTurnRequest {
  input: string
  messages?: ChatMessage[]
  media?: ChatMediaItem[]
  character?: ChatCharacterContext
  language?: string
  preferencePrompt?: string
  options?: Record<string, unknown>
  signal?: AbortSignal
}

export interface ChatTurnResponse {
  content: string
  raw: LLMResponse
}

export interface ChatSessionOptions {
  llm?: LLMProvider
  model?: ChatModelConfig
  llmOptions?: LLMProviderOptions
  systemPrompt?: string
  outputConstraintPrompt?: string
  defaultOptions?: Record<string, unknown>
}

export class ChatSession {
  private llm: LLMProvider
  private systemPrompt: string
  private outputConstraintPrompt: string
  private defaultOptions: Record<string, unknown>

  constructor(options: ChatSessionOptions) {
    if (!options.llm && !options.model) {
      throw new Error('ChatSession requires an LLM provider or model config')
    }

    this.llm = options.llm ?? createLLMProvider(options.model!, options.llmOptions)
    this.systemPrompt = options.systemPrompt ?? DEFAULT_CHAT_SYSTEM_PROMPT
    this.outputConstraintPrompt = options.outputConstraintPrompt ?? buildChatOutputConstraintPrompt()
    this.defaultOptions = options.defaultOptions ?? {}
  }

  async send(request: ChatTurnRequest): Promise<ChatTurnResponse> {
    const response = await this.llm.chat(
      this.createPromptMessages(request),
      this.createRequestOptions(request)
    )
    return {
      content: response.content,
      raw: response,
    }
  }

  async *stream(request: ChatTurnRequest): AsyncGenerator<string> {
    yield* this.llm.streamChat(
      this.createPromptMessages(request),
      this.createRequestOptions(request)
    )
  }

  createPromptMessages(request: ChatTurnRequest): ChatMessage[] {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: this.buildSystemPrompt(request),
      },
    ]

    for (const message of request.messages ?? []) {
      const content = normalizeMessageContent(message.content)
      if (!content) {
        continue
      }
      messages.push({
        role: normalizeRole(message.role),
        content,
      })
    }

    messages.push({
      role: 'user',
      content: buildChatMessageContent(request.input, request.media, { includeImageInputs: true }),
    })

    return mergeAdjacentMessages(messages)
  }

  private buildSystemPrompt(request: ChatTurnRequest): string {
    const parts = [this.systemPrompt.trim(), this.outputConstraintPrompt.trim()]
    const character = request.character
    if (character) {
      parts.push(formatCharacterContext(character))
    }
    if (request.language) {
      parts.push(`Reply in ${request.language} unless the user clearly asks for another language.`)
    }
    if (request.preferencePrompt) {
      parts.push(request.preferencePrompt.trim())
    }
    return parts.filter(Boolean).join('\n\n')
  }

  private createRequestOptions(request: ChatTurnRequest): Record<string, unknown> {
    return {
      temperature: 0.8,
      ...this.defaultOptions,
      ...(request.options ?? {}),
      ...(request.signal ? { signal: request.signal } : {}),
    }
  }
}

export function createChatSessionFromModel(
  model: ChatModelConfig,
  options: Omit<ChatSessionOptions, 'llm' | 'model'> = {}
): ChatSession {
  return new ChatSession({
    ...options,
    model,
  })
}

function formatCharacterContext(character: ChatCharacterContext): string {
  const lines = ['<character>']
  appendTag(lines, 'id', character.id)
  appendTag(lines, 'display_name', character.displayName)
  appendTag(lines, 'description', character.description)
  appendTag(lines, 'story', character.story)
  appendTag(lines, 'background', character.background)
  appendTag(lines, 'first_message', character.firstMessage)
  if (character.roleCard && Object.keys(character.roleCard).length) {
    appendTag(lines, 'role_card', JSON.stringify(character.roleCard))
  }
  if (character.tags?.length) {
    appendTag(lines, 'tags', character.tags.join(', '))
  }
  appendTag(lines, 'instructions', character.instructions)
  lines.push('</character>')
  appendSceneState(lines, character.sceneState)
  appendCanonMemory(lines, character.canonMemory)
  appendNarrativeSummaries(lines, character.narrativeSummaries)
  return lines.join('\n')
}

function appendCanonMemory(lines: string[], memory: string[] | undefined): void {
  const entries = memory?.map((item) => item.trim()).filter(Boolean) ?? []
  if (!entries.length) {
    return
  }
  lines.push('<canon_memory>')
  for (const item of entries) {
    lines.push(`<memory>${escapeXml(item)}</memory>`)
  }
  lines.push('</canon_memory>')
}

function appendSceneState(lines: string[], sceneState: Record<string, unknown> | undefined): void {
  if (!sceneState || typeof sceneState !== 'object') {
    return
  }
  const entries = Object.entries(sceneState).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
  if (!entries.length) {
    return
  }
  lines.push('<scene_state>')
  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      lines.push(`<${key}>${escapeXml(value.map((item) => String(item)).join(', '))}</${key}>`)
    } else {
      appendTag(lines, key, String(value))
    }
  }
  lines.push('</scene_state>')
}

function appendNarrativeSummaries(
  lines: string[],
  summaries: ChatCharacterContext['narrativeSummaries']
): void {
  if (!summaries?.length) {
    return
  }
  lines.push('<narrative_summaries>')
  for (const summary of summaries) {
    const text = summary.text?.trim()
    if (!text) {
      continue
    }
    lines.push(`<summary source_messages="${summary.startMessageIndex ?? '?'}->${summary.endMessageIndex ?? '?'}">`)
    lines.push(escapeXml(text))
    lines.push('</summary>')
  }
  lines.push('</narrative_summaries>')
}

function appendTag(lines: string[], tag: string, value: string | undefined): void {
  const normalized = value?.trim()
  if (!normalized) {
    return
  }
  lines.push(`<${tag}>${escapeXml(normalized)}</${tag}>`)
}

function normalizeRole(role: ChatRole): ChatRole {
  return role === 'system' || role === 'assistant' ? role : 'user'
}

function normalizeMessageContent(content: ChatMessageContent): ChatMessageContent {
  if (typeof content === 'string') {
    return content.trim()
  }
  const parts = content
    .map((part) => {
      if (part.type === 'text') {
        return { ...part, text: part.text.trim() }
      }
      return part
    })
    .filter((part) => part.type !== 'text' || part.text)
  return parts.length ? parts : ''
}

export function buildChatMessageContent(
  input: string,
  media: ChatMediaItem[] | undefined,
  options: { includeImageInputs?: boolean } = {}
): ChatMessageContent {
  const text = input.trim()
  const normalizedMedia = Array.isArray(media) ? media : []
  const imageInputUrls = new Set(normalizedMedia
    .filter((item) => shouldIncludeImageInput(item, options.includeImageInputs === true))
    .map((item) => item.dataUrl || item.url!)
  )
  const imageParts = [...imageInputUrls]
    .map((url): ChatMessageContentPart => ({
      type: 'image_url',
      image_url: { url },
    }))
  const mediaNotes = normalizedMedia.map((item) => formatChatMediaContextItem(item, {
    visualInput: imageInputUrls.has(item.dataUrl || item.url || ''),
  })).filter(Boolean)

  if (!imageParts.length && !mediaNotes.length) {
    return text
  }

  const parts: ChatMessageContentPart[] = [{
    type: 'text',
    text: [
      text || 'Please respond to the media sent in this turn.',
      mediaNotes.length ? `<message_media>\n${mediaNotes.join('\n')}\n</message_media>` : '',
    ].filter(Boolean).join('\n\n'),
  }]
  parts.push(...imageParts)
  return parts
}

function shouldIncludeImageInput(item: ChatMediaItem, includeImageInputs: boolean): boolean {
  if (item.kind !== 'image' || !(item.dataUrl || item.url)) {
    return false
  }
  if (item.context?.mode === 'none' || item.context?.mode === 'text') {
    return false
  }
  return includeImageInputs || item.context?.mode === 'visual'
}

function formatChatMediaContextItem(item: ChatMediaItem, options: { visualInput: boolean }): string {
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
    const dispatch = normalizeChatMediaDispatchForContext(item.dispatch)
    if (Object.keys(dispatch).length) {
      fields.dispatch = dispatch
    }
  }
  if (options.visualInput) {
    fields.modelInput = 'image_url'
  } else if (item.dataUrl || item.url) {
    fields.context = item.kind === 'image' ? 'text_anchor' : 'transcript_or_metadata'
  }
  return JSON.stringify(fields)
}

function normalizeChatMediaDispatchForContext(dispatch: ChatMediaDispatchPolicy): Record<string, unknown> {
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

function mergeAdjacentMessages(messages: ChatMessage[]): ChatMessage[] {
  const merged: ChatMessage[] = []
  for (const message of messages) {
    const previous = merged[merged.length - 1]
    if (previous?.role === message.role && typeof previous.content === 'string' && typeof message.content === 'string') {
      previous.content = `${previous.content}\n\n${message.content}`
    } else {
      merged.push({ ...message })
    }
  }
  return merged
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
