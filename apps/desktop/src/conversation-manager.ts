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
  sttUrl?: string

  // TTS 配置 (Fish Audio)
  ttsApiKey: string
  ttsVoiceId?: string
  ttsModel?: string

  // 人格配置
  personality?: {
    name: string
    background: string
    values: string[]
    speakingStyle: string
  }
}

export interface ConversationInitializeOptions {
  enableVoiceInput?: boolean
}

export class ConversationManager {
  private sdk: HerTextSDK | null = null
  private voiceInput: VoiceInputManager
  private tts: TTSManager
  private isInitialized = false
  private isVoiceInputInitialized = false
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
  async initialize(
    config: ConversationConfig,
    options: ConversationInitializeOptions = { enableVoiceInput: true }
  ): Promise<void> {
    try {
      // 1. 初始化 SDK
      if (!this.sdk) {
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
      }

      // 2. 语音输入只在语音模式初始化。文本模式不连接麦克风或 STT。
      if (options.enableVoiceInput && !this.isVoiceInputInitialized) {
        await this.voiceInput.initialize(config.sttApiKey, config.sttUrl)
        this.isVoiceInputInitialized = true
        console.log('[ConversationManager] Voice input initialized')
      }

      // 3. 尝试初始化语音输出（可选）
      if (!this.tts.isReady()) {
        console.log('[ConversationManager] Initializing TTS with config:', {
          hasApiKey: !!config.ttsApiKey,
          apiKeyLength: config.ttsApiKey?.length,
          voiceId: config.ttsVoiceId,
          model: config.ttsModel
        })
        try {
          await this.tts.initialize(config.ttsApiKey, config.ttsVoiceId, config.ttsModel)
          console.log('[ConversationManager] TTS initialized successfully')
        } catch (error) {
          console.error('[ConversationManager] TTS initialization failed:', error)
          console.error('[ConversationManager] TTS will not be available')
        }
      } else {
        console.log('[ConversationManager] TTS already initialized')
      }

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

    if (!this.isVoiceInputInitialized) {
      throw new Error('Voice input is not initialized')
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
      let ttsBuffer = ''
      let shouldUseTTS = this.tts.isReady()

      if (shouldUseTTS) {
        this.emitStateChange('speaking')
        this.tts.onPlaybackEnd(() => {
          if (this.isConversing) {
            this.emitStateChange('listening')
            this.emitResponse('')
          }
        })
        await this.tts.startStreaming()
      }

      for await (const chunk of this.sdk.chatStream({
        text: transcript,
        timestamp: Date.now(),
      })) {
        fullResponse += chunk
        ttsBuffer += chunk

        // 实时更新响应（可选：显示在 UI）
        this.emitResponse(fullResponse)

        if (shouldUseTTS && this.shouldSendTTSChunk(ttsBuffer)) {
          try {
            await this.tts.pushTextAndFlush(ttsBuffer)
            ttsBuffer = ''
          } catch (error) {
            console.error('[ConversationManager] Streaming TTS failed:', error)
            shouldUseTTS = false
          }
        }
      }

      console.log('[ConversationManager] SDK response:', fullResponse)

      if (shouldUseTTS) {
        if (ttsBuffer.trim()) {
          await this.tts.pushTextAndFlush(ttsBuffer)
        }
        await this.tts.finishStreaming()
      } else {
        this.emitStateChange('listening')
      }
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
   * 发送文本消息（支持流式输出和可选 TTS）
   */
  async sendTextMessage(text: string, enableTTS = false): Promise<void> {
    if (!this.sdk) {
      throw new Error('SDK not initialized')
    }

    console.log('[ConversationManager] User text:', text)
    console.log('[ConversationManager] enableTTS:', enableTTS)
    console.log('[ConversationManager] TTS isReady:', this.tts.isReady())
    this.emitTranscript(text)
    this.emitStateChange('thinking')

    try {
      // 调用 SDK 处理用户输入（流式）
      let fullResponse = ''
      let ttsBuffer = ''
      let shouldUseTTS = enableTTS && this.tts.isReady()
      console.log('[ConversationManager] shouldUseTTS:', shouldUseTTS)

      if (shouldUseTTS) {
        this.emitStateChange('speaking')
        this.tts.onPlaybackEnd(() => {
          this.emitStateChange('idle')
          this.emitResponse('')
        })
        await this.tts.startStreaming()
      }

      for await (const chunk of this.sdk.chatStream({
        text,
        timestamp: Date.now(),
      })) {
        fullResponse += chunk
        ttsBuffer += chunk
        // 实时更新响应
        this.emitResponse(fullResponse)

        if (shouldUseTTS && this.shouldSendTTSChunk(ttsBuffer)) {
          try {
            await this.tts.pushTextAndFlush(ttsBuffer)
            ttsBuffer = ''
          } catch (error) {
            console.error('[ConversationManager] Streaming TTS failed:', error)
            shouldUseTTS = false
          }
        }
      }

      console.log('[ConversationManager] SDK response:', fullResponse)

      // 如果启用 TTS，进行语音合成
      if (shouldUseTTS) {
        if (ttsBuffer.trim()) {
          await this.tts.pushTextAndFlush(ttsBuffer)
        }
        await this.tts.finishStreaming()
      } else {
        if (enableTTS) {
          console.warn('[ConversationManager] TTS requested but not initialized')
        }
        this.emitStateChange('idle')
      }

    } catch (error) {
      console.error('[ConversationManager] Error handling text:', error)
      this.emitError(error as Error)
      this.emitStateChange('idle')
      throw error
    }
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

    if (this.isVoiceInputInitialized) {
      await this.voiceInput.cleanup()
    }
    await this.tts.cleanup()

    if (this.sdk) {
      await this.sdk.shutdown()
    }

    this.isInitialized = false
    this.isVoiceInputInitialized = false
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

  private shouldSendTTSChunk(buffer: string): boolean {
    const trimmed = buffer.trim()
    return trimmed.length >= 18 || /[。！？.!?]\s*$/.test(trimmed)
  }
}

export type ConversationState = 'idle' | 'listening' | 'thinking' | 'speaking'
