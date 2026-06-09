/**
 * LLM provider abstraction and OpenAI-compatible implementation.
 */
import OpenAI from 'openai'
import type { SDKConfig } from '../config/types.js'

export interface LLMResponse {
  content: string
  toolCalls?: any[]
  finishReason?: string | null
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
}

export interface LLMProvider {
  chat(messages: any[], options?: any): Promise<LLMResponse>
  streamChat(messages: any[], options?: any): AsyncGenerator<string>
}

export interface LLMProviderOptions {
  defaultReasoningMode?: 'minimal-or-none'
  geminiThinkingMode?: 'minimal-or-none'
}

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI

  constructor(
    apiKey: string,
    private model: string = 'gpt-4-turbo-preview',
    private baseURL?: string,
    private providerOptions: LLMProviderOptions = {}
  ) {
    this.client = new OpenAI({
      apiKey,
      baseURL,
      dangerouslyAllowBrowser: true,
    })
  }

  async chat(messages: any[], options?: any): Promise<LLMResponse> {
    const { signal, ...requestOptions } = options ?? {}
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      ...this.withDefaultReasoning(requestOptions)
    } as any, signal ? { signal } : undefined)

    const message = response.choices[0]?.message

    return {
      content: message?.content || '',
      toolCalls: message?.tool_calls as any[],
      finishReason: response.choices[0]?.finish_reason,
      usage: response.usage
        ? {
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    }
  }

  async *streamChat(messages: any[], options?: any): AsyncGenerator<string> {
    const { signal, ...requestOptions } = options ?? {}
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages,
      stream: true,
      ...this.withDefaultReasoning(requestOptions)
    } as any, signal ? { signal } : undefined) as any

    for await (const chunk of stream) {
      if (signal?.aborted) {
        return
      }
      const content = chunk.choices[0]?.delta?.content
      if (content) {
        yield content
      }
    }
  }

  private withDefaultReasoning(requestOptions: any): any {
    if (!this.shouldApplyMinimalReasoning(requestOptions)) {
      return requestOptions
    }

    const reasoningEffort = getMinimalReasoningEffort(this.model, this.baseURL)
    if (!reasoningEffort) {
      return requestOptions
    }

    return {
      ...requestOptions,
      reasoning_effort: reasoningEffort,
    }
  }

  private shouldApplyMinimalReasoning(requestOptions: any): boolean {
    if (
      (this.providerOptions.defaultReasoningMode ?? this.providerOptions.geminiThinkingMode) !== 'minimal-or-none' ||
      requestOptions?.reasoning_effort !== undefined ||
      hasProviderReasoningConfig(requestOptions)
    ) {
      return false
    }

    return true
  }
}

export class AnthropicMessagesProvider implements LLMProvider {
  constructor(
    private apiKey: string,
    private model: string,
    private baseURL: string = 'https://api.anthropic.com/v1'
  ) {}

  async chat(messages: any[], options?: any): Promise<LLMResponse> {
    const { signal, ...requestOptions } = options ?? {}
    const response = await fetch(`${this.normalizedBaseURL()}/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: this.model,
        max_tokens: requestOptions.max_tokens ?? requestOptions.maxTokens ?? 1024,
        ...this.convertMessages(messages),
        ...this.cleanRequestOptions(requestOptions),
      }),
      signal,
    })

    const bodyText = await response.text()
    const body = this.parseJson(bodyText)
    if (!response.ok) {
      throw new Error(body?.error?.message || bodyText.slice(0, 300) || `Anthropic request failed with HTTP ${response.status}`)
    }

    return {
      content: this.extractContent(body),
      finishReason: body?.stop_reason ?? null,
      usage: body?.usage
        ? {
            inputTokens: body.usage.input_tokens,
            outputTokens: body.usage.output_tokens,
            totalTokens: (body.usage.input_tokens ?? 0) + (body.usage.output_tokens ?? 0),
          }
        : undefined,
    }
  }

  async *streamChat(messages: any[], options?: any): AsyncGenerator<string> {
    const { signal, ...requestOptions } = options ?? {}
    const response = await fetch(`${this.normalizedBaseURL()}/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: this.model,
        max_tokens: requestOptions.max_tokens ?? requestOptions.maxTokens ?? 1024,
        stream: true,
        ...this.convertMessages(messages),
        ...this.cleanRequestOptions(requestOptions),
      }),
      signal,
    })

    if (!response.ok) {
      const bodyText = await response.text()
      const body = this.parseJson(bodyText)
      throw new Error(body?.error?.message || bodyText.slice(0, 300) || `Anthropic stream failed with HTTP ${response.status}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        if (signal?.aborted) {
          return
        }
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const chunk = this.parseSSELine(line)
          if (chunk) {
            yield chunk
          }
        }
      }
      const tail = this.parseSSELine(buffer)
      if (tail) {
        yield tail
      }
    } finally {
      reader.releaseLock()
    }
  }

  private normalizedBaseURL(): string {
    return this.baseURL.replace(/\/+$/, '')
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    }
  }

  private convertMessages(messages: any[]): { system?: string; messages: any[] } {
    const systemParts: string[] = []
    const anthropicMessages: any[] = []

    for (const message of messages) {
      const role = message?.role
      const content = this.normalizeContent(message?.content)
      if (!content) {
        continue
      }
      if (role === 'system' || role === 'developer') {
        systemParts.push(this.contentToText(content))
        continue
      }
      anthropicMessages.push({
        role: role === 'assistant' ? 'assistant' : 'user',
        content,
      })
    }

    return {
      ...(systemParts.length ? { system: systemParts.join('\n\n') } : {}),
      messages: this.mergeAdjacentMessages(anthropicMessages),
    }
  }

  private normalizeContent(content: any): string | any[] {
    if (typeof content === 'string') {
      return content
    }
    if (Array.isArray(content)) {
      const parts = content
        .map(part => this.normalizeContentPart(part))
        .filter(Boolean)
      return parts.length ? parts : ''
    }
    return content == null ? '' : String(content)
  }

  private normalizeContentPart(part: any): any {
    if (typeof part === 'string') {
      return { type: 'text', text: part }
    }
    if (part?.type === 'text' && part.text) {
      return { type: 'text', text: String(part.text) }
    }
    if (part?.type === 'image_url' && part.image_url?.url) {
      const source = this.parseDataUrl(part.image_url.url)
      if (!source) {
        return undefined
      }
      return {
        type: 'image',
        source,
      }
    }
    return part?.text ? { type: 'text', text: String(part.text) } : undefined
  }

  private contentToText(content: string | any[]): string {
    if (typeof content === 'string') {
      return content
    }
    return content
      .map(part => typeof part === 'string' ? part : part?.text)
      .filter(Boolean)
      .join('\n')
  }

  private parseDataUrl(value: string): { type: 'base64'; media_type: string; data: string } | null {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(value)
    if (!match) {
      return null
    }
    return {
      type: 'base64',
      media_type: match[1],
      data: match[2],
    }
  }

  private mergeAdjacentMessages(messages: any[]): any[] {
    const merged: any[] = []
    for (const message of messages) {
      const previous = merged[merged.length - 1]
    if (previous?.role === message.role && typeof previous.content === 'string' && typeof message.content === 'string') {
      previous.content = `${previous.content}\n\n${message.content}`
    } else if (previous?.role === message.role && Array.isArray(previous.content) && Array.isArray(message.content)) {
      previous.content = [...previous.content, ...message.content]
    } else {
      merged.push({ ...message })
      }
    }
    return merged
  }

  private cleanRequestOptions(options: any): any {
    const {
      max_tokens,
      maxTokens,
      signal,
      messages,
      model,
      stream,
      reasoning_effort,
      ...rest
    } = options ?? {}
    return rest
  }

  private parseSSELine(line: string): string {
    if (!line.startsWith('data:')) {
      return ''
    }
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') {
      return ''
    }
    const parsed = this.parseJson(data)
    return parsed?.type === 'content_block_delta' && parsed?.delta?.type === 'text_delta'
      ? parsed.delta.text || ''
      : ''
  }

  private extractContent(body: any): string {
    if (!Array.isArray(body?.content)) {
      return ''
    }
    return body.content
      .map((part: any) => part?.type === 'text' ? part.text : '')
      .filter(Boolean)
      .join('')
  }

  private parseJson(text: string): any {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }
}

export function createLLMProvider(config: SDKConfig['llm'], options: LLMProviderOptions = {}): LLMProvider {
  if (config.baseURL) {
    console.log(`[LLM] Using custom endpoint: ${config.baseURL}`)
  }

  if (config.provider === 'claude' || config.provider === 'anthropic') {
    return new AnthropicMessagesProvider(config.apiKey, config.model, config.baseURL)
  }

  return new OpenAIProvider(config.apiKey, config.model, config.baseURL, options)
}

function isOfficialGeminiOpenAIEndpoint(baseURL?: string): boolean {
  const url = parseBaseURL(baseURL)
  return Boolean(url && url.hostname === 'generativelanguage.googleapis.com' && url.pathname.includes('/openai'))
}

function isOfficialOpenAIEndpoint(baseURL?: string): boolean {
  if (!baseURL) {
    return true
  }
  const url = parseBaseURL(baseURL)
  return Boolean(url && url.hostname === 'api.openai.com')
}

function parseBaseURL(baseURL?: string): URL | null {
  if (!baseURL) {
    return null
  }
  try {
    return new URL(baseURL)
  } catch {
    return null
  }
}

function isGeminiModel(model: string): boolean {
  return model.toLowerCase().startsWith('gemini-')
}

function isOpenAIReasoningModel(model: string): boolean {
  const normalized = model.toLowerCase()
  return normalized.startsWith('gpt-5') || /^o\d/.test(normalized)
}

function isClaudeModel(model: string): boolean {
  return model.toLowerCase().startsWith('claude-')
}

function hasProviderReasoningConfig(requestOptions: any): boolean {
  const extraBody = requestOptions?.extra_body
  return Boolean(
    requestOptions?.reasoning ||
    requestOptions?.thinking ||
    extraBody?.reasoning ||
    extraBody?.thinking ||
    extraBody?.google?.thinking_config ||
    extraBody?.google?.thinkingConfig ||
    extraBody?.anthropic?.thinking
  )
}

function getMinimalReasoningEffort(model: string, baseURL?: string): 'none' | 'minimal' | 'low' | null {
  const normalized = model.toLowerCase()

  if (isOfficialGeminiOpenAIEndpoint(baseURL) && isGeminiModel(model)) {
    if (normalized.includes('gemini-2.5') && !normalized.includes('pro')) {
      return 'none'
    }
    return 'minimal'
  }

  if (isOfficialOpenAIEndpoint(baseURL) && isOpenAIReasoningModel(model)) {
    if (normalized.startsWith('gpt-5.1')) {
      return 'none'
    }
    if (normalized.startsWith('gpt-5')) {
      return 'minimal'
    }
    return 'low'
  }

  if (isClaudeModel(model)) {
    return null
  }

  return null
}
