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
      ...this.withDefaultGeminiThinking(requestOptions)
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
      ...this.withDefaultGeminiThinking(requestOptions)
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

  private withDefaultGeminiThinking(requestOptions: any): any {
    if (
      this.providerOptions.geminiThinkingMode !== 'minimal-or-none' ||
      !isOfficialGeminiOpenAIEndpoint(this.baseURL) ||
      !isGeminiModel(this.model) ||
      requestOptions?.reasoning_effort !== undefined ||
      hasGeminiThinkingConfig(requestOptions?.extra_body)
    ) {
      return requestOptions
    }

    return {
      ...requestOptions,
      reasoning_effort: getMinimalGeminiReasoningEffort(this.model),
    }
  }
}

export function createLLMProvider(config: SDKConfig['llm'], options: LLMProviderOptions = {}): LLMProvider {
  if (config.baseURL) {
    console.log(`[LLM] Using custom endpoint: ${config.baseURL}`)
  }

  return new OpenAIProvider(config.apiKey, config.model, config.baseURL, options)
}

function isOfficialGeminiOpenAIEndpoint(baseURL?: string): boolean {
  if (!baseURL) {
    return false
  }
  try {
    const url = new URL(baseURL)
    return url.hostname === 'generativelanguage.googleapis.com' && url.pathname.includes('/openai')
  } catch {
    return false
  }
}

function isGeminiModel(model: string): boolean {
  return model.toLowerCase().startsWith('gemini-')
}

function hasGeminiThinkingConfig(extraBody: any): boolean {
  return Boolean(extraBody?.google?.thinking_config || extraBody?.google?.thinkingConfig)
}

function getMinimalGeminiReasoningEffort(model: string): 'none' | 'minimal' {
  const normalized = model.toLowerCase()
  if (normalized.includes('gemini-2.5') && !normalized.includes('pro')) {
    return 'none'
  }
  return 'minimal'
}
