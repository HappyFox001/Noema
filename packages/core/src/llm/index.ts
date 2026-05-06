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

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI

  constructor(
    apiKey: string,
    private model: string = 'gpt-4-turbo-preview',
    baseURL?: string
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
      ...requestOptions
    }, signal ? { signal } : undefined)

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
      ...requestOptions
    }, signal ? { signal } : undefined) as any

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
}

export function createLLMProvider(config: SDKConfig['llm']): LLMProvider {
  if (config.baseURL) {
    console.log(`[LLM] Using custom endpoint: ${config.baseURL}`)
  }

  return new OpenAIProvider(config.apiKey, config.model, config.baseURL)
}
