/**
 * Runtime adapters for configured chat model turns.
 */
import {
  createChatSessionFromModel,
  type ChatCharacterContext,
  type ChatMediaContextMode,
  type ChatMediaContextPolicy,
  type ChatMediaDispatchMode,
  type ChatMediaDispatchPolicy,
  type ChatMediaDispatchTrigger,
  type ChatMediaItem,
  type ChatMediaKind,
  type ChatMediaOrigin,
  type ChatMessage,
  type ChatModelConfig,
  type ChatSession,
  type ChatSessionOptions,
  type ChatTurnRequest,
  type ChatTurnResponse,
} from './index.js'
import { extractChatSceneUpdate } from './conversation-runtime.js'

export interface ConfiguredChatModel {
  provider?: string
  transport?: 'openai_compatible' | 'codex_local' | 'claude_code_local'
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
  media?: ChatMediaItem[]
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
    for (const event of createChatCompletionEvents(chunks.join(''))) {
      yield event
    }
  } catch (error: any) {
    const message = normalizeChatRuntimeError(error)
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
      ...createChatCompletionEvents(response.content),
    ]
  } catch (error: any) {
    return [
      { type: 'message.started' },
      { type: 'error', error: normalizeChatRuntimeError(error) },
    ]
  }
}

export function normalizeChatRuntimeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message ?? '').trim()
    if (message) {
      return message
    }
  }
  return String(error || 'Chat runtime failed')
}

function createChatCompletionEvents(content: string): ChatRuntimeEvent[] {
  const parsed = extractChatSceneUpdate(content)
  return [
    ...(parsed.update ? [{ type: 'scene.updated' as const, patch: parsed.update }] : []),
    { type: 'message.completed' as const, content: parsed.text },
  ]
}

export function toChatModelConfig(config: ConfiguredChatModel | null): ChatModelConfig {
  if (!config) {
    throw new Error('Chat model is not configured')
  }
  const transport = config.transport ?? 'openai_compatible'
  const model = config.modelName?.trim() ?? ''
  if (!model && transport === 'openai_compatible') {
    throw new Error('Chat model name is empty')
  }
  return {
    provider: config.provider,
    transport,
    apiKey: config.apiKey || '',
    model,
    baseURL: config.baseUrl?.trim() || undefined,
  }
}

export function normalizeConfiguredChatTurnRequest(request: ConfiguredChatTurnRequest): ChatTurnRequest {
  const input = typeof request?.input === 'string' ? request.input.trim() : ''
  const media = normalizeChatMedia(request.media)
  if (!input && media.length === 0) {
    throw new Error('Message is empty')
  }
  return {
    input,
    language: request.language,
    messages: normalizeChatMessages(request.messages),
    media,
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

export function normalizeChatMedia(media: ChatMediaItem[] | undefined): ChatMediaItem[] {
  if (!Array.isArray(media)) {
    return []
  }
  return media
    .map((item): ChatMediaItem => {
      const kind = normalizeChatMediaKind(item.kind)
      return {
        id: optionalString(item.id),
        kind,
        name: String(item.name || 'media'),
        mimeType: String(item.mimeType || defaultMimeTypeForMediaKind(kind)),
        dataUrl: optionalString(item.dataUrl),
        url: optionalString(item.url),
        size: finitePositiveNumber(item.size),
        durationMs: finitePositiveNumber(item.durationMs),
        transcript: optionalString(item.transcript),
        prompt: optionalString(item.prompt),
        origin: normalizeChatMediaOrigin(item.origin),
        dispatch: normalizeChatMediaDispatch(item.dispatch),
        context: normalizeChatMediaContext(item.context),
        metadata: item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
          ? item.metadata
          : undefined,
      }
    })
    .filter((item) => Boolean(item.dataUrl || item.url || item.transcript || item.prompt))
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

function normalizeChatMediaKind(kind: unknown): ChatMediaKind {
  return kind === 'video' || kind === 'audio' ? kind : 'image'
}

function defaultMimeTypeForMediaKind(kind: ChatMediaKind): string {
  if (kind === 'video') {
    return 'video/mp4'
  }
  if (kind === 'audio') {
    return 'audio/mpeg'
  }
  return 'image/png'
}

function normalizeChatMediaOrigin(origin: unknown): ChatMediaOrigin | undefined {
  return origin === 'assistant' || origin === 'tool' || origin === 'generated' || origin === 'external' || origin === 'user'
    ? origin
    : undefined
}

function normalizeChatMediaDispatch(dispatch: ChatMediaDispatchPolicy | undefined): ChatMediaDispatchPolicy | undefined {
  if (!dispatch || typeof dispatch !== 'object' || Array.isArray(dispatch)) {
    return undefined
  }
  const normalized: ChatMediaDispatchPolicy = {}
  const trigger = normalizeChatMediaDispatchTrigger(dispatch.trigger)
  const mode = normalizeChatMediaDispatchMode(dispatch.mode)
  if (trigger) normalized.trigger = trigger
  if (mode) normalized.mode = mode
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

function normalizeChatMediaDispatchTrigger(trigger: unknown): ChatMediaDispatchTrigger | undefined {
  return trigger === 'model' || trigger === 'tool' || trigger === 'external' || trigger === 'probability' || trigger === 'manual'
    ? trigger
    : undefined
}

function normalizeChatMediaDispatchMode(mode: unknown): ChatMediaDispatchMode | undefined {
  return mode === 'permanent' || mode === 'turn' ? mode : undefined
}

function normalizeChatMediaContext(context: ChatMediaContextPolicy | undefined): ChatMediaContextPolicy | undefined {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return undefined
  }
  const normalized: ChatMediaContextPolicy = {}
  const mode = normalizeChatMediaContextMode(context.mode)
  if (mode) normalized.mode = mode
  if (context.summary?.trim()) {
    normalized.summary = context.summary.trim()
  }
  return Object.keys(normalized).length ? normalized : undefined
}

function normalizeChatMediaContextMode(mode: unknown): ChatMediaContextMode | undefined {
  return mode === 'visual' || mode === 'text' || mode === 'none' || mode === 'auto'
    ? mode
    : undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function finitePositiveNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}
