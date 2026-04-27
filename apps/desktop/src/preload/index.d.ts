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
      commitSpeechStream: () => Promise<{
        success: boolean
        text?: string
        error?: string
      }>
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
          timestamp: number
          summary: string
          topics: string[]
          emotionalTone: string
          keyPoints: string[]
        }>
        error?: string
      }>

      getWorkingMemory: () => Promise<{
        success: boolean
        memory?: {
          recentTurns: Array<{
            role: 'user' | 'assistant'
            content: string
            timestamp?: number
          }>
        }
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
      }>
      updateSettings: (partial: Partial<{
        voiceInputEnabled: boolean
        voiceOutputEnabled: boolean
        volume: number
        selectedPersonality: string
      }>) => Promise<{
        voiceInputEnabled: boolean
        voiceOutputEnabled: boolean
        volume: number
        selectedPersonality: string
      }>
      listPersonalities: () => Promise<{
        success: boolean
        current?: string
        items: string[]
        error?: string
      }>
      setPersonality: (name: string) => Promise<{
        success: boolean
        current?: string
        error?: string
      }>

      // 事件监听器
      onTTSAudio: (callback: (audioData: Uint8Array) => void) => void
      onTTSConnected: (callback: () => void) => void
      onTTSClosed: (callback: () => void) => void
      onTTSError: (callback: (error: string) => void) => void
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
      }) => void) => void

      // 语音识别事件 (VAD 在 Main Process 处理)
      onSpeechTranscript: (callback: (text: string) => void) => void
      onSpeechState: (callback: (state: 'listening' | 'processing' | 'idle') => void) => void
      onSpeechError: (callback: (error: string) => void) => void
      onUserSpeaking: (callback: () => void) => void

      // 播放完成同步（用于 Phase 之间的音频同步）
      onPlaybackWaitRequest: (callback: (requestId: number) => void) => void
      notifyPlaybackComplete: (requestId: number) => void

      // 窗口控制
      moveWindow: (deltaX: number, deltaY: number) => void
      getWindowPosition: () => Promise<[number, number]>
    }
  }
}
