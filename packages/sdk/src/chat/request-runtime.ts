/**
 * Runtime adapters for configured chat model turns.
 */
import {
  createChatSessionFromModel,
  type ChatAttachment,
  type ChatCharacterContext,
  type ChatMessage,
  type ChatModelConfig,
  type ChatSession,
  type ChatSessionOptions,
  type ChatTurnRequest,
  type ChatTurnResponse,
} from './index.js'

export interface ConfiguredChatModel {
  provider?: string
  modelName: string
  apiKey: string
  baseUrl?: string
}

export interface ChatRuntimeTurnRequest {
  conversationId?: string
  input?: string
  stream?: boolean
  language?: string
  preferencePrompt?: string
  runtimeOptions?: Record<string, unknown>
  options?: Record<string, unknown>
  messages?: ChatMessage[]
  attachments?: ChatAttachment[]
  character?: ChatCharacterContext
}

export interface ConfiguredChatTurnRequest extends ChatRuntimeTurnRequest {
  signal?: AbortSignal
}

export interface NormalizedChatRuntimeTurnRequest extends ChatTurnRequest {
  conversationId?: string
  stream: boolean
  runtimeOptions?: Record<string, unknown>
}

export interface ConfiguredChatRuntimeOptions extends Omit<ChatSessionOptions, 'llm' | 'model'> {}

export interface ChatRuntimeServiceOptions {
  modelConfig: ConfiguredChatModel | null
  options?: ConfiguredChatRuntimeOptions
}

export type ChatRuntimeEvent =
  | { type: 'message.started' }
  | { type: 'message.delta'; delta: string }
  | { type: 'message.completed'; content: string }
  | { type: 'scene.updated'; patch: Record<string, unknown> }
  | { type: 'summary.created'; summary: unknown }
  | { type: 'artifact.created'; artifact: unknown }
  | { type: 'error'; error: string }

export class ChatRuntime {
  private modelConfig: ConfiguredChatModel | null
  private options: ConfiguredChatRuntimeOptions

  constructor(options: ChatRuntimeServiceOptions) {
    this.modelConfig = options.modelConfig
    this.options = options.options ?? {}
  }

  sendTurn(request: ChatRuntimeTurnRequest): Promise<ChatTurnResponse> {
    return sendChatTurnWithConfiguredModel(this.modelConfig, request, this.options)
  }

  streamTurn(request: ChatRuntimeTurnRequest): AsyncGenerator<string> {
    return streamChatTurnWithConfiguredModel(this.modelConfig, request, this.options)
  }

  runTurnEvents(request: ChatRuntimeTurnRequest): AsyncGenerator<ChatRuntimeEvent> {
    return runChatTurnEventsWithConfiguredModel(this.modelConfig, request, this.options)
  }
}

export async function sendChatTurnWithConfiguredModel(
  modelConfig: ConfiguredChatModel | null,
  request: ConfiguredChatTurnRequest,
  options: ConfiguredChatRuntimeOptions = {}
): Promise<ChatTurnResponse> {
  const session = createChatSessionFromModel(toChatModelConfig(modelConfig), options)
  return session.send(normalizeConfiguredChatTurnRequest(request))
}

export async function *streamChatTurnWithConfiguredModel(
  modelConfig: ConfiguredChatModel | null,
  request: ConfiguredChatTurnRequest,
  options: ConfiguredChatRuntimeOptions = {}
): AsyncGenerator<string> {
  const session = createChatSessionFromModel(toChatModelConfig(modelConfig), options)
  yield* session.stream(normalizeConfiguredChatTurnRequest(request))
}

export async function *streamChatTurnEventsWithConfiguredModel(
  modelConfig: ConfiguredChatModel | null,
  request: ConfiguredChatTurnRequest,
  options: ConfiguredChatRuntimeOptions = {}
): AsyncGenerator<ChatRuntimeEvent> {
  const session = createChatSessionFromModel(toChatModelConfig(modelConfig), options)
  yield* streamChatTurnEvents(session, normalizeConfiguredChatTurnRequest(request))
}

export async function sendChatTurnEventsWithConfiguredModel(
  modelConfig: ConfiguredChatModel | null,
  request: ConfiguredChatTurnRequest,
  options: ConfiguredChatRuntimeOptions = {}
): Promise<ChatRuntimeEvent[]> {
  const session = createChatSessionFromModel(toChatModelConfig(modelConfig), options)
  return sendChatTurnEvents(session, normalizeConfiguredChatTurnRequest(request))
}

export async function *runChatTurnEventsWithConfiguredModel(
  modelConfig: ConfiguredChatModel | null,
  request: ChatRuntimeTurnRequest,
  options: ConfiguredChatRuntimeOptions = {}
): AsyncGenerator<ChatRuntimeEvent> {
  const normalized = normalizeChatRuntimeTurnRequest(request)
  if (normalized.stream) {
    yield* streamChatTurnEventsWithConfiguredModel(modelConfig, normalized, options)
    return
  }
  for (const event of await sendChatTurnEventsWithConfiguredModel(modelConfig, normalized, options)) {
    yield event
  }
}

export async function *streamChatTurnEvents(
  session: ChatSession,
  request: ChatTurnRequest
): AsyncGenerator<ChatRuntimeEvent> {
  yield { type: 'message.started' }
  const chunks: string[] = []
  try {
    for await (const delta of session.stream(request)) {
      chunks.push(delta)
      yield { type: 'message.delta', delta }
    }
    yield { type: 'message.completed', content: chunks.join('') }
  } catch (error: any) {
    const message = error?.message || String(error)
    yield { type: 'error', error: message }
    throw error
  }
}

export async function sendChatTurnEvents(
  session: ChatSession,
  request: ChatTurnRequest
): Promise<ChatRuntimeEvent[]> {
  try {
    const response = await session.send(request)
    return [
      { type: 'message.started' },
      { type: 'message.completed', content: response.content },
    ]
  } catch (error: any) {
    return [
      { type: 'message.started' },
      { type: 'error', error: error?.message || String(error) },
    ]
  }
}

export function toChatModelConfig(config: ConfiguredChatModel | null): ChatModelConfig {
  if (!config) {
    throw new Error('Chat model is not configured')
  }
  const model = config.modelName?.trim()
  if (!model) {
    throw new Error('Chat model name is empty')
  }
  return {
    provider: config.provider,
    apiKey: config.apiKey || '',
    model,
    baseURL: config.baseUrl?.trim() || undefined,
  }
}

export function normalizeConfiguredChatTurnRequest(request: ConfiguredChatTurnRequest): ChatTurnRequest {
  const input = typeof request?.input === 'string' ? request.input.trim() : ''
  if (!input) {
    throw new Error('Message is empty')
  }
  return {
    input,
    language: request.language,
    messages: normalizeChatMessages(request.messages),
    attachments: normalizeChatAttachments(request.attachments),
    character: request.character,
    preferencePrompt: normalizePreferencePrompt(request.preferencePrompt),
    options: normalizeChatRequestOptions(request.options),
    ...(request.signal ? { signal: request.signal } : {}),
  }
}

export function normalizeChatRuntimeTurnRequest(request: ChatRuntimeTurnRequest): NormalizedChatRuntimeTurnRequest {
  const normalized = normalizeConfiguredChatTurnRequest(request)
  const conversationId = typeof request?.conversationId === 'string' ? request.conversationId.trim() : ''
  const runtimeOptions = normalizeRuntimeOptions(request?.runtimeOptions)
  return {
    ...normalized,
    ...(conversationId ? { conversationId } : {}),
    stream: request?.stream === true,
    ...(runtimeOptions ? { runtimeOptions } : {}),
  }
}

export function normalizeChatMessages(messages: ChatMessage[] | undefined): ChatMessage[] {
  if (!Array.isArray(messages)) {
    return []
  }
  return messages
    .map((message): ChatMessage => ({
      role: normalizeRole(message.role),
      content: typeof message.content === 'string'
        ? message.content.trim()
        : message.content,
    }))
    .filter((message) => typeof message.content !== 'string' || Boolean(message.content))
}

export function normalizeChatAttachments(attachments: ChatAttachment[] | undefined): ChatAttachment[] {
  if (!Array.isArray(attachments)) {
    return []
  }
  return attachments
    .map((attachment): ChatAttachment => ({
      kind: attachment.kind === 'video' ? 'video' : 'image',
      name: String(attachment.name || 'attachment'),
      mimeType: String(attachment.mimeType || (attachment.kind === 'video' ? 'video/mp4' : 'image/png')),
      dataUrl: typeof attachment.dataUrl === 'string' ? attachment.dataUrl : undefined,
      size: typeof attachment.size === 'number' ? attachment.size : undefined,
    }))
    .filter((attachment) => Boolean(attachment.dataUrl))
}

export function normalizeChatRequestOptions(options: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!options || typeof options !== 'object') {
    return undefined
  }
  const normalized: Record<string, unknown> = {}
  const temperature = normalizeNumberOption(options.temperature, 0, 2)
  const topP = normalizeNumberOption(options.top_p, 0, 1)
  const maxTokens = normalizeIntegerOption(options.max_tokens, 1, 5000)
  if (temperature !== undefined) {
    normalized.temperature = temperature
  }
  if (topP !== undefined) {
    normalized.top_p = topP
  }
  if (maxTokens !== undefined) {
    normalized.max_tokens = maxTokens
  }
  return Object.keys(normalized).length ? normalized : undefined
}

function normalizePreferencePrompt(prompt: string | undefined): string | undefined {
  const normalized = typeof prompt === 'string' ? prompt.trim() : ''
  return normalized || undefined
}

function normalizeRuntimeOptions(options: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!options || typeof options !== 'object') {
    return undefined
  }
  return Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined)
  )
}

function normalizeNumberOption(value: unknown, min: number, max: number): number | undefined {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) {
    return undefined
  }
  return Math.min(max, Math.max(min, number))
}

function normalizeIntegerOption(value: unknown, min: number, max: number): number | undefined {
  const number = normalizeNumberOption(value, min, max)
  return number === undefined ? undefined : Math.round(number)
}

function normalizeRole(role: ChatMessage['role']): ChatMessage['role'] {
  return role === 'assistant' || role === 'system' ? role : 'user'
}
