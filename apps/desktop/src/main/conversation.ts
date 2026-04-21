import OpenAI from 'openai'

export class ConversationService {
  private client!: OpenAI
  private messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []

  async initialize(config: any): Promise<void> {
    this.client = new OpenAI({
      apiKey: config.llmApiKey,
      baseURL: config.llmBaseURL,
    })

    // 初始化系统提示词
    this.messages.push({
      role: 'system',
      content: '你是 Luna，一个温柔、善解人意的 AI 伴侣。请用简洁自然的方式回复，避免冗长。'
    })

    console.log('[ConversationService] Initialized')
  }

  async *chatStream(text: string): AsyncGenerator<string, void, unknown> {
    // 添加用户消息
    this.messages.push({
      role: 'user',
      content: text
    })

    // 调用 LLM
    const stream = await this.client.chat.completions.create({
      model: 'deepseek-chat',
      messages: this.messages,
      stream: true,
    })

    let fullResponse = ''

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || ''
      if (content) {
        fullResponse += content
        yield content
      }
    }

    // 保存助手回复
    this.messages.push({
      role: 'assistant',
      content: fullResponse
    })

    // 限制历史长度
    if (this.messages.length > 20) {
      this.messages = [
        this.messages[0], // 保留系统提示词
        ...this.messages.slice(-19)
      ]
    }
  }

  clearHistory(): void {
    const systemMessage = this.messages[0]
    this.messages = [systemMessage]
  }

  async shutdown(): Promise<void> {
    // 清理资源
  }
}
