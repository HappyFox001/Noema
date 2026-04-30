export {}

declare global {
  interface Window {
    electronAPI: {
      // 初始化（不再接收 config 参数）
      initializeConversation: () => Promise<{
        success: boolean
        error?: string
        ttsEnabled?: boolean
        stats?: {
          turns: number
          tokens: number
          historyVersion: number
        }
      }>

      // 发送消息
      sendText: (
        text: string,
        enableTTS: boolean
      ) => Promise<{
        success: boolean
        error?: string
        response?: string
        ttsEnabled?: boolean
      }>

      // TTS 控制
      stopTTS: () => Promise<{ success: boolean; error?: string }>

      // 对话历史
      clearHistory: () => Promise<{ success: boolean; error?: string }>
      clearProfile: () => Promise<{ success: boolean; error?: string }>
      startSpeechStream: () => Promise<{
        success: boolean
        error?: string
      }>
      appendSpeechStream: (samples: number[] | Int16Array) => void
      stopSpeechStream: () => Promise<{
        success: boolean
        error?: string
      }>
      getMicrophonePermissionStatus: () => Promise<{
        success: boolean
        status?: string
        error?: string
      }>
      requestMicrophonePermission: () => Promise<{
        success: boolean
        granted?: boolean
        status?: string
        openedSettings?: boolean
        error?: string
      }>

      // ========== 记忆管理 API ==========
      getUserProfile: () => Promise<{
        success: boolean
        profile?: {
          basic: {
            name?: string
            nickname?: string
            age?: number
            gender?: string
            location?: string
            occupation?: string
          }
          personality?: string[]
          interests?: string[]
          importantMemories?: Record<string, string>
          lastUpdated?: number
        }
        error?: string
      }>

      updateUserProfile: (updates: Partial<{
        name?: string
        nickname?: string
        age?: number
        gender?: string
        location?: string
        occupation?: string
      }>) => Promise<{
        success: boolean
        error?: string
      }>

      addImportantMemory: (key: string, value: string) => Promise<{
        success: boolean
        error?: string
      }>

      deleteImportantMemory: (key: string) => Promise<{
        success: boolean
        error?: string
      }>

      getConversationSummaries: () => Promise<{
        success: boolean
        summaries?: Array<{
          id: string
          startTurn: number
          endTurn: number
          timestamp: number
          summary: string
          keyTopics: string[]
        }>
        error?: string
      }>

      deleteConversationSummary: (id: string) => Promise<{
        success: boolean
        error?: string
      }>

      getWorkingMemory: () => Promise<{
        success: boolean
        memory?: {
          recentTurns: Array<{
            id: string
            role: 'user' | 'assistant'
            content: string
            timestamp?: number
          }>
        }
        error?: string
      }>

      deleteConversationTurn: (id: string) => Promise<{
        success: boolean
        error?: string
      }>

      deleteProfileField: (field: string) => Promise<{
        success: boolean
        error?: string
      }>

      clearImportantMemories: () => Promise<{
        success: boolean
        error?: string
      }>

      clearConversationSummaries: () => Promise<{
        success: boolean
        error?: string
      }>

      clearWorkingMemory: () => Promise<{
        success: boolean
        error?: string
      }>

      // SDK 功能
      getPersonality: () => Promise<any>
      getStats: () => Promise<any>
      getSettings: () => Promise<{
        voiceInputEnabled: boolean
        voiceOutputEnabled: boolean
        volume: number
        selectedPersonality: string
        externalRolePaths: string[]
        system: {
          proxy: string
          llmModels: Array<{ id: string; modelName: string; apiKey: string; baseUrl: string }>
          activeLLMId: string
          ttsModels: Array<{ id: string; provider: 'fish'; modelName: string; apiKey: string; voiceId?: string }>
          activeTTSId: string
          asrModels: Array<{ id: string; provider: 'qwen'; modelName: string; apiKey: string }>
          activeASRId: string
        }
      }>
      updateSettings: (partial: Partial<{
        voiceInputEnabled: boolean
        voiceOutputEnabled: boolean
        volume: number
        selectedPersonality: string
        externalRolePaths: string[]
        system: {
          proxy: string
          llmModels: Array<{ id: string; modelName: string; apiKey: string; baseUrl: string }>
          activeLLMId: string
          ttsModels: Array<{ id: string; provider: 'fish'; modelName: string; apiKey: string; voiceId?: string }>
          activeTTSId: string
          asrModels: Array<{ id: string; provider: 'qwen'; modelName: string; apiKey: string }>
          activeASRId: string
        }
      }>) => Promise<{
        voiceInputEnabled: boolean
        voiceOutputEnabled: boolean
        volume: number
        selectedPersonality: string
        externalRolePaths: string[]
        system: {
          proxy: string
          llmModels: Array<{ id: string; modelName: string; apiKey: string; baseUrl: string }>
          activeLLMId: string
          ttsModels: Array<{ id: string; provider: 'fish'; modelName: string; apiKey: string; voiceId?: string }>
          activeTTSId: string
          asrModels: Array<{ id: string; provider: 'qwen'; modelName: string; apiKey: string }>
          activeASRId: string
        }
      }>
      resetSystemConfigFromEnv: () => Promise<{
        success: boolean
        error?: string
      }>
      getLocalModelStatus: () => Promise<{
        success: boolean
        error?: string
        models: Array<{
          id: 'silero-vad' | 'smart-turn'
          name: string
          filename: string
          purpose: string
          exists: boolean
          sizeBytes?: number
          path: string
        }>
      }>
      downloadMissingLocalModels: () => Promise<{
        success: boolean
        error?: string
        models: Array<{
          id: 'silero-vad' | 'smart-turn'
          name: string
          filename: string
          purpose: string
          exists: boolean
          sizeBytes?: number
          path: string
        }>
      }>
      listPlugins: () => Promise<{
        success: boolean
        error?: string
        plugins: Array<{
          id: string
          name: string
          version?: string
          enabled: boolean
          pluginDir: string
          config: Record<string, unknown>
          configSchema: Array<
            | {
                key: string
                label?: string
                description?: string
                type: 'string'
                default?: string
                placeholder?: string
              }
            | {
                key: string
                label?: string
                description?: string
                type: 'number'
                default?: number
                min?: number
                max?: number
                step?: number
              }
            | {
                key: string
                label?: string
                description?: string
                type: 'boolean'
                default?: boolean
              }
            | {
                key: string
                label?: string
                description?: string
                type: 'select'
                default?: string
                options: Array<{ label: string; value: string }>
              }
          >
        }>
      }>
      listPersonalities: () => Promise<{
        success: boolean
        current?: string
        items: Array<{
          id: string
          name: string
          path: string
          source: 'role' | 'file'
        }>
        error?: string
      }>
      setPersonality: (name: string) => Promise<{
        success: boolean
        current?: string
        error?: string
      }>
      addPersonalityFile: () => Promise<{
        success: boolean
        canceled?: boolean
        item?: {
          id: string
          name: string
          path: string
          source: 'file'
        }
        error?: string
      }>

      // 事件监听器
      // TTS 音频事件（带上下文 ID）
      onTTSAudio: (callback: (audioData: Uint8Array, contextId: number) => void) => void
      onTTSConnected: (callback: (contextId: number) => void) => void
      onTTSClosed: (callback: () => void) => void
      onTTSError: (callback: (error: string) => void) => void

      // TTS 上下文管理
      onTTSContextStart: (callback: (contextId: number) => void) => void
      onTTSContextInvalidated: (callback: (contextId: number) => void) => void
      onConversationResponse: (callback: (text: string) => void) => void
      onConversationFrame: (callback: (frame: {
        type: 'system.reset'
      } | {
        type: 'control.phase_start' | 'control.phase_end'
        phase: 'reply' | 'task' | 'task_result'
      } | {
        type: 'control.task_start'
        taskDescription: string
      } | {
        type: 'control.task_end'
        success: boolean
        summary: string
        error?: string
      } | {
        type: 'data.tts_text'
        text: string
      } | {
        type: 'expression.show'
        id: string
        emotion: string
        src: string
        durationMs: number
        priority?: number
      }) => void) => void

      // 语音识别事件 (VAD 在 Main Process 处理)
      onSpeechTranscript: (callback: (text: string) => void) => void
      onSpeechState: (callback: (state: 'listening' | 'processing' | 'idle') => void) => void
      onSpeechError: (callback: (error: string) => void) => void
      onUserSpeaking: (callback: () => void) => void

      // WebSocket 重连事件
      onSpeechReconnecting: (callback: () => void) => void
      onSpeechReconnected: (callback: () => void) => void
      onSpeechConnectionFailed: (callback: () => void) => void

      // 打断事件
      onInterruption: (callback: (turnId: number) => void) => void
      // 新轮次开始
      onTurnStart: (callback: (turnId: number) => void) => void

      // 播放完成同步（用于 Phase 之间的音频同步）
      onPlaybackWaitRequest: (callback: (requestId: number) => void) => void
      notifyPlaybackComplete: (requestId: number) => void

      // 延迟追踪
      notifyFirstAudioPlay: () => void
      notifyAudioScheduled: (metrics: {
        durationMs: number
        scheduleDelayMs: number
        bufferAheadMs: number
        underrunMs: number
      }) => void
      onLatencyData: (callback: (data: {
        sessionId: number
        total?: number
        intervals: {
          speechToASR?: number
          asrToLLM?: number
          llmToFirstToken?: number
          firstTokenToTTSText?: number
          ttsTextToAudio?: number
          audioToPlayback?: number
        }
        ttsPlayback?: {
          chunks: number
          totalAudioMs: number
          avgArrivalGapMs?: number
          maxArrivalGapMs?: number
          maxScheduleDelayMs?: number
          minBufferAheadMs?: number
          maxUnderrunMs?: number
        }
      }) => void) => void

      // 窗口控制
      moveWindow: (deltaX: number, deltaY: number) => void
      getWindowPosition: () => Promise<[number, number]>
    }
  }
}
