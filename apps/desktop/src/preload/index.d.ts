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

      // 新增 SDK 功能
      getMemory: () => Promise<any>
      getPersonality: () => Promise<any>
      getStats: () => Promise<any>

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
      }) => void) => void

      // 窗口控制
      moveWindow: (deltaX: number, deltaY: number) => void
      getWindowPosition: () => Promise<[number, number]>
    }
  }
}
