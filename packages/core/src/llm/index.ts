import OpenAI from 'openai'
import type { SDKConfig } from '@her-text/types'


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

export function createLLMProvider(config: SDKConfig['llm'], options: LLMProviderOptions = {}): LLMProvider {
  if (config.baseURL) {
    console.log(`[LLM] Using custom endpoint: ${config.baseURL}`)
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
