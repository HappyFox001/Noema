import OpenAI from 'openai'
import type { SDKConfig } from '@her-text/types'

/**
 * LLM 响应类型
 */
export interface LLMResponse {
  content: string
  toolCalls?: any[]  // OpenAI tool_calls 格式
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
      baseURL,  // 自定义 API 端点
    })
  }

  async chat(messages: any[], options?: any): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      ...options
    })

    const message = response.choices[0]?.message

    return {
      content: message?.content || '',
      toolCalls: message?.tool_calls as any[]
    }
  }

  async *streamChat(messages: any[], options?: any): AsyncGenerator<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages,
      stream: true,
      ...options
    }) as any

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content
      if (content) {
        yield content
      }
    }
  }
}

export function createLLMProvider(config: SDKConfig['llm']): LLMProvider {
  // 统一使用 OpenAI 兼容格式
  if (config.baseURL) {
    console.log(`[LLM] Using custom endpoint: ${config.baseURL}`)
  }

  return new OpenAIProvider(config.apiKey, config.model, config.baseURL)
}
