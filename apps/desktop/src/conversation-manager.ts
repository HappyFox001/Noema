import { HerTextSDK } from '@her-text/sdk'
import type { SDKConfig } from '@her-text/types'
import { VoiceInputManager } from './audio'
import { TTSManager } from './audio-player'

/**
 * Conversation Manager - 完整的语音对话循环
 *
 * 流程: 用户说话 → STT → SDK → TTS → 播放
 */

export interface ConversationConfig {
  // LLM 配置
  llmApiKey: string
  llmModel: string
  llmBaseURL?: string  // API 端点（OpenAI 兼容格式）

  // STT 配置 (Qwen)
  sttApiKey: string

  // TTS 配置 (Fish Audio)
  ttsApiKey: string
  ttsVoiceId?: string

  // 人格配置
  personality?: {
    name: string
    background: string
    values: string[]
    speakingStyle: string
  }
}

export class ConversationManager {
  private sdk: HerTextSDK | null = null
  private voiceInput: VoiceInputManager
  private tts: TTSManager
  private isInitialized = false
  private isConversing = false

  // 回调函数
  private onStateChange?: (state: ConversationState) => void
  private onTranscript?: (text: string) => void
  private onResponse?: (text: string) => void
  private onError?: (error: Error) => void

  constructor() {
    this.voiceInput = new VoiceInputManager()
    this.tts = new TTSManager()
  }

  /**
   * 初始化对话系统
   */
  async initialize(config: ConversationConfig): Promise<void> {
    try {
      // 1. 初始化 SDK
      const sdkConfig: SDKConfig = {
        llm: {
          apiKey: config.llmApiKey,
          model: config.llmModel,
          baseURL: config.llmBaseURL,
        },
        memory: {
          storageDir: './memory',
        },
        personality: {
          character: config.personality || {
            name: 'Luna',
            background: '一个温柔、善解人意的 AI 伴侣',
            values: ['真诚', '同理心', '好奇心'],
            speakingStyle: '简洁自然，避免冗长',
          },
          traits: {
            openness: 0.8,
            conscientiousness: 0.7,
            extraversion: 0.6,
            agreeableness: 0.9,
            neuroticism: 0.3,
          },
          relationship: {
            type: 'companion',
            intimacy: 0.5,
            trust: 0.7,
          },
        },
      }

      this.sdk = await HerTextSDK.initialize(sdkConfig)
      console.log('[ConversationManager] SDK initialized')

      // 2. 初始化语音输入
      await this.voiceInput.initialize(config.sttApiKey)
      console.log('[ConversationManager] Voice input initialized')

      // 3. 初始化语音输出
      await this.tts.initialize(config.ttsApiKey, config.ttsVoiceId)
      console.log('[ConversationManager] TTS initialized')

      this.isInitialized = true
      this.emitStateChange('idle')
    } catch (error) {
      console.error('[ConversationManager] Initialization failed:', error)
      this.emitError(error as Error)
      throw error
    }
  }

  /**
   * 开始对话循环
   */
  startConversation(): void {
    if (!this.isInitialized || !this.sdk) {
      throw new Error('Conversation manager not initialized')
    }

    if (this.isConversing) {
      console.warn('[ConversationManager] Already conversing')
      return
    }

    this.isConversing = true
    this.emitStateChange('listening')

    // 开始监听语音输入
    this.voiceInput.startListening(async (transcript) => {
      await this.handleUserInput(transcript)
    })

    console.log('[ConversationManager] Conversation started')
  }

  /**
   * 停止对话循环
   */
  stopConversation(): void {
    this.isConversing = false
    this.voiceInput.stopListening()
    this.tts.stop()
    this.emitStateChange('idle')
    console.log('[ConversationManager] Conversation stopped')
  }

  /**
   * 处理用户输入
   */
  private async handleUserInput(transcript: string): Promise<void> {
    if (!this.sdk || !this.isConversing) return

    console.log('[ConversationManager] User said:', transcript)
    this.emitTranscript(transcript)
    this.emitStateChange('thinking')

    try {
      // 调用 SDK 处理用户输入（流式）
      let fullResponse = ''

      for await (const chunk of this.sdk.chatStream({
        text: transcript,
        timestamp: Date.now(),
      })) {
        fullResponse += chunk

        // 实时更新响应（可选：显示在 UI）
        this.emitResponse(fullResponse)
      }

      console.log('[ConversationManager] SDK response:', fullResponse)

      // 开始语音合成和播放
      this.emitStateChange('speaking')

      this.tts.onPlaybackEnd(() => {
        // 播放完成，返回监听状态
        if (this.isConversing) {
          this.emitStateChange('listening')
          // 清空响应文本（通过发送空响应）
          this.emitResponse('')
        }
      })

      await this.tts.speak(fullResponse)

    } catch (error) {
      console.error('[ConversationManager] Error handling input:', error)
      this.emitError(error as Error)
      this.emitStateChange('listening')
    }
  }

  /**
   * 文本对话（不使用语音）
   */
  async chat(text: string): Promise<string> {
    if (!this.sdk) {
      throw new Error('SDK not initialized')
    }

    const response = await this.sdk.chat({
      text,
      timestamp: Date.now(),
    })

    return response.text
  }

  /**
   * 清空对话历史
   */
  clearHistory(): void {
    if (this.sdk) {
      this.sdk.clearHistory()
      console.log('[ConversationManager] History cleared')
    }
  }

  /**
   * 获取对话统计
   */
  getStats() {
    return this.sdk?.getStats()
  }

  /**
   * 关闭对话系统
   */
  async shutdown(): Promise<void> {
    this.stopConversation()

    await this.voiceInput.cleanup()
    await this.tts.cleanup()

    if (this.sdk) {
      await this.sdk.shutdown()
    }

    this.isInitialized = false
    console.log('[ConversationManager] Shutdown complete')
  }

  // ========== 事件回调 ==========

  onStateChanged(callback: (state: ConversationState) => void): void {
    this.onStateChange = callback
  }

  onTranscriptReceived(callback: (text: string) => void): void {
    this.onTranscript = callback
  }

  onResponseReceived(callback: (text: string) => void): void {
    this.onResponse = callback
  }

  onErrorOccurred(callback: (error: Error) => void): void {
    this.onError = callback
  }

  private emitStateChange(state: ConversationState): void {
    if (this.onStateChange) {
      this.onStateChange(state)
    }
  }

  private emitTranscript(text: string): void {
    if (this.onTranscript) {
      this.onTranscript(text)
    }
  }

  private emitResponse(text: string): void {
    if (this.onResponse) {
      this.onResponse(text)
    }
  }

  private emitError(error: Error): void {
    if (this.onError) {
      this.onError(error)
    }
  }
}

export type ConversationState = 'idle' | 'listening' | 'thinking' | 'speaking'
