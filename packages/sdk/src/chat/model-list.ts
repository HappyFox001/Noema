/**
 * Provider-specific model listing for chat model configuration.
 */
import { createProxyFetch } from '../utils/proxy.js'

export interface ChatModelListRequest {
  provider?: string
  modelType?: 'llm' | 'image'
  apiKey?: string
  baseUrl?: string
}

export interface ChatModelListCandidate {
  url: string
  headers: Record<string, string>
}

export async function listChatModelsWithProvider(
  request: ChatModelListRequest,
  options: { proxyUrl?: string } = {}
): Promise<string[]> {
  const body = await fetchChatModelList(request, options.proxyUrl)
  return normalizeChatModelNames(body, request)
}

export async function fetchChatModelList(
  request: ChatModelListRequest,
  proxyUrl?: string
): Promise<unknown> {
  const candidates = buildChatModelListCandidates(request)
  const proxiedFetch = createProxyFetch(proxyUrl)
  let lastError: Error | null = null
  for (const candidate of candidates) {
    try {
      const response = await proxiedFetch(candidate.url, { headers: candidate.headers })
      const text = await response.text()
      const body = parseJson(text)
      if (!response.ok) {
        throw new Error(readModelListError(body, text, response.status))
      }
      if (normalizeChatModelNames(body, request).length > 0 || candidates.length === 1) {
        return body
      }
      lastError = new Error('Models response did not include model names')
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(error?.message || String(error))
    }
  }
  throw lastError || new Error('No model list endpoint is available')
}

export function buildChatModelListCandidates(request: ChatModelListRequest): ChatModelListCandidate[] {
  const provider = String(request?.provider || '').toLowerCase()
  const apiKey = typeof request?.apiKey === 'string' ? request.apiKey.trim() : ''
  const baseUrl = normalizeModelListBaseUrl(request?.baseUrl)
  const candidates: ChatModelListCandidate[] = []
  const imageModels = request.modelType === 'image'

  if (!imageModels && provider === 'gemini') {
    const nativeGeminiBase = getGeminiNativeBaseUrl(baseUrl)
    if (apiKey && nativeGeminiBase) {
      candidates.push({
        url: `${nativeGeminiBase}/models?key=${encodeURIComponent(apiKey)}`,
        headers: {},
      })
    }
  }

  if (provider === 'ollama' && baseUrl) {
    candidates.push({
      url: `${getOllamaNativeBaseUrl(baseUrl)}/api/tags`,
      headers: {},
    })
  }

  if (imageModels) {
    candidates.push(...buildImageModelListCandidates(provider, baseUrl, request))
  }

  if (provider === 'deepseek' && baseUrl) {
    candidates.push({
      url: `${getDeepSeekModelListBaseUrl(baseUrl)}/models`,
      headers: buildModelsRequestHeaders(request),
    })
  }

  if (baseUrl) {
    candidates.push({
      url: `${baseUrl}/models`,
      headers: buildModelsRequestHeaders(request),
    })
    if (shouldTryOpenAIV1ModelList(baseUrl, provider)) {
      candidates.push({
        url: `${baseUrl}/v1/models`,
        headers: buildModelsRequestHeaders(request),
      })
    }
  }

  const unique = new Map<string, ChatModelListCandidate>()
  for (const candidate of candidates) {
    unique.set(candidate.url, candidate)
  }
  if (unique.size === 0) {
    throw new Error('Base URL is empty')
  }
  return [...unique.values()]
}

function buildImageModelListCandidates(
  provider: string,
  baseUrl: string,
  request: ChatModelListRequest
): ChatModelListCandidate[] {
  const candidates: ChatModelListCandidate[] = []
  const headers = buildModelsRequestHeaders(request)

  if (provider === 'wavespeed' && baseUrl) {
    candidates.push({
      url: `${baseUrl}/models`,
      headers,
    })
  }

  return candidates
}

export function normalizeChatModelNames(body: unknown, request: ChatModelListRequest = {}): string[] {
  const items = collectModelListItems(body)
  const names = items
    .filter((item) => matchesRequestedModelType(item, request))
    .map(readModelListItemName)
    .filter((name: unknown): name is string => typeof name === 'string' && name.trim().length > 0)
    .map((name) => name.trim().replace(/^models\//, ''))
  return [...new Set(names)].sort((a, b) => a.localeCompare(b))
}

function matchesRequestedModelType(item: unknown, request: ChatModelListRequest): boolean {
  if (request.modelType !== 'image') {
    return true
  }
  if (typeof item === 'string') {
    return matchesImageModelName(item, request.provider)
  }
  const source = item && typeof item === 'object' ? item as Record<string, unknown> : {}
  const descriptors = [
    source.type,
    source.model_type,
    source.task,
    source.category,
    source.pipeline_tag,
    source.modality,
    source.metadata && typeof source.metadata === 'object' ? (source.metadata as Record<string, unknown>).category : '',
    source.metadata && typeof source.metadata === 'object' ? (source.metadata as Record<string, unknown>).status : '',
    source.tags,
    source.metadata && typeof source.metadata === 'object' ? (source.metadata as Record<string, unknown>).tags : '',
  ]
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => typeof value === 'string' ? value.toLowerCase() : '')
    .filter(Boolean)

  if (descriptors.some((value) => value.includes('image'))) {
    return true
  }
  if (descriptors.length > 0) {
    return false
  }
  return matchesImageModelName(readModelListItemName(item), request.provider)
}

function buildModelsRequestHeaders(request: ChatModelListRequest): Record<string, string> {
  const provider = String(request?.provider || '').toLowerCase()
  const apiKey = typeof request?.apiKey === 'string' ? request.apiKey.trim() : ''
  if (provider === 'claude' || provider === 'anthropic') {
    return {
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
      'anthropic-version': '2023-06-01',
    }
  }
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

function buildFalModelRequestHeaders(request: ChatModelListRequest): Record<string, string> {
  const apiKey = typeof request?.apiKey === 'string' ? request.apiKey.trim() : ''
  return apiKey ? { Authorization: `Key ${apiKey}` } : {}
}

function normalizeModelListBaseUrl(value: string | undefined): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) {
    return ''
  }
  try {
    const url = new URL(raw)
    const parts = url.pathname.split('/').filter(Boolean)
    while (parts.length && ['models', 'messages', 'completions'].includes(parts[parts.length - 1])) {
      parts.pop()
    }
    if (parts.at(-1) === 'chat') {
      parts.pop()
    }
    url.pathname = parts.length ? `/${parts.join('/')}` : ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return raw
      .replace(/[?#].*$/, '')
      .replace(/\/(?:models|messages|chat\/completions|completions)\/?$/i, '')
      .replace(/\/+$/, '')
  }
}

function getStabilityV1BaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    const parts = url.pathname.split('/').filter(Boolean)
    while (parts.length && /^v\d+(?:beta)?$/i.test(parts[parts.length - 1])) {
      parts.pop()
    }
    url.pathname = parts.length ? `/${parts.join('/')}/v1` : '/v1'
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return `${baseUrl.replace(/\/v\d+(?:beta)?\/?$/i, '').replace(/\/+$/, '')}/v1`
  }
}

function getGeminiNativeBaseUrl(baseUrl: string): string {
  if (!baseUrl) {
    return 'https://generativelanguage.googleapis.com/v1beta'
  }
  try {
    const url = new URL(baseUrl)
    if (!url.hostname.includes('generativelanguage.googleapis.com')) {
      return 'https://generativelanguage.googleapis.com/v1beta'
    }
    const parts = url.pathname.split('/').filter(Boolean).filter((part) => part !== 'openai')
    url.pathname = parts.length ? `/${parts.join('/')}` : '/v1beta'
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return 'https://generativelanguage.googleapis.com/v1beta'
  }
}

function getOllamaNativeBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.at(-1) === 'v1') {
      parts.pop()
    }
    url.pathname = parts.length ? `/${parts.join('/')}` : ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return baseUrl.replace(/\/v1\/?$/i, '').replace(/\/+$/, '')
  }
}

function getDeepSeekModelListBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.at(-1) === 'v1') {
      parts.pop()
    }
    url.pathname = parts.length ? `/${parts.join('/')}` : ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return baseUrl.replace(/\/v1\/?$/i, '').replace(/\/+$/, '')
  }
}

function shouldTryOpenAIV1ModelList(baseUrl: string, provider: string): boolean {
  if (!['openai-compatible', 'openai_compatible', 'newapi', 'new-api'].includes(provider)) {
    return false
  }
  try {
    const parts = new URL(baseUrl).pathname.split('/').filter(Boolean)
    return !parts.includes('v1')
  } catch {
    return !/\/v1(?:\/|$)/i.test(baseUrl)
  }
}

function collectModelListItems(body: unknown): any[] {
  if (Array.isArray(body)) {
    return body
  }
  const source = body && typeof body === 'object' ? body as Record<string, any> : {}
  if (Array.isArray(source.data)) {
    return source.data
  }
  if (Array.isArray(source.models)) {
    return source.models
  }
  if (Array.isArray(source.results)) {
    return source.results
  }
  if (Array.isArray(source.items)) {
    return source.items
  }
  if (source.data && typeof source.data === 'object') {
    return Object.values(source.data).flatMap((value) => Array.isArray(value) ? value : [])
  }
  const comfyCheckpoints = source.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0]
  if (Array.isArray(comfyCheckpoints)) {
    return comfyCheckpoints
  }
  return []
}

function readModelListItemName(item: unknown): string {
  if (typeof item === 'string') {
    return item
  }
  const source = item && typeof item === 'object' ? item as Record<string, any> : {}
  if (typeof source.endpoint_id === 'string') {
    return source.endpoint_id
  }
  if (typeof source.id === 'string') {
    return source.id
  }
  if (typeof source.model_id === 'string') {
    return source.model_id
  }
  if (typeof source.model === 'string') {
    return source.model
  }
  if (typeof source.title === 'string') {
    return source.title
  }
  if (typeof source.model_name === 'string') {
    return source.model_name
  }
  if (typeof source.name === 'string') {
    if (typeof source.owner === 'string' && !source.name.includes('/')) {
      return `${source.owner}/${source.name}`
    }
    return source.name
  }
  if (typeof source.repo_id === 'string') {
    return source.repo_id
  }
  return ''
}

function matchesImageModelName(name: string, provider: string | undefined): boolean {
  const normalizedProvider = String(provider || '').toLowerCase()
  const normalized = name.toLowerCase()
  if (!normalized) {
    return false
  }
  if (normalizedProvider === 'wavespeed') {
    return true
  }
  if (normalizedProvider === 'openai-image') {
    return /^(gpt-image|dall-e)/i.test(name)
  }
  return false
}

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return {}
  }
}

function readModelListError(body: unknown, text: string, status: number): string {
  const source = body && typeof body === 'object' ? body as Record<string, any> : {}
  const message = source.error?.message || source.message || text.trim()
  return message || `Models request failed with HTTP ${status}`
}
