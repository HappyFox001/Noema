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

export interface ChatAttachment {
  kind: 'image' | 'video'
  name: string
  mimeType: string
  dataUrl?: string
  size?: number
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
  attachments?: ChatAttachment[]
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
      content: buildUserContent(request.input, request.attachments),
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

function buildUserContent(input: string, attachments: ChatAttachment[] | undefined): ChatMessageContent {
  const text = input.trim()
  const normalizedAttachments = Array.isArray(attachments) ? attachments : []
  const imageParts = normalizedAttachments
    .filter((attachment) => attachment.kind === 'image' && attachment.dataUrl)
    .map((attachment): ChatMessageContentPart => ({
      type: 'image_url',
      image_url: { url: attachment.dataUrl! },
    }))
  const videoNotes = normalizedAttachments
    .filter((attachment) => attachment.kind === 'video')
    .map((attachment) => `- ${attachment.name} (${attachment.mimeType}${attachment.size ? `, ${Math.round(attachment.size / 1024)} KB` : ''})`)

  if (!imageParts.length && !videoNotes.length) {
    return text
  }

  const parts: ChatMessageContentPart[] = [{
    type: 'text',
    text: [
      text || 'Please respond to the attached media.',
      videoNotes.length ? `<video_attachments>\n${videoNotes.join('\n')}\n</video_attachments>` : '',
    ].filter(Boolean).join('\n\n'),
  }]
  parts.push(...imageParts)
  return parts
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
