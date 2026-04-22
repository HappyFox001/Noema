import OpenAI from 'openai'
import type { SDKConfig } from '@her-text/types'

/**
 * LLM 响应类型
 */
export interface LLMResponse {
  content: string
  toolCalls?: any[]  // OpenAI tool_calls 格式
}

/**
 * 流式响应 chunk 类型
 */
export interface StreamChunk {
  type: 'content' | 'tool_call'
  content?: string
  toolCall?: {
    index: number
    id?: string
    function: {
      name?: string
      arguments?: string
    }
  }
}

export interface LLMProvider {
  chat(messages: any[], options?: any): Promise<LLMResponse>
  streamChat(messages: any[], options?: any): AsyncGenerator<string>
  streamChatWithTools(messages: any[], options?: any): AsyncGenerator<StreamChunk>
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
      dangerouslyAllowBrowser: true,
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

  /**
   * 流式对话（支持工具调用）
   * 返回 StreamChunk，包含 content 或 tool_call
   */
  async *streamChatWithTools(messages: any[], options?: any): AsyncGenerator<StreamChunk> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages,
      stream: true,
      ...options
    }) as any

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta

      // 处理文本内容
      if (delta?.content) {
        yield {
          type: 'content',
          content: delta.content
        }
      }

      // 处理工具调用
      if (delta?.tool_calls) {
        for (const toolCall of delta.tool_calls) {
          yield {
            type: 'tool_call',
            toolCall: {
              index: toolCall.index,
              id: toolCall.id,
              function: {
                name: toolCall.function?.name,
                arguments: toolCall.function?.arguments
              }
            }
          }
        }
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
