export {}

declare global {
  interface Window {
    electronAPI: {
      initializeConversation: (config: any) => Promise<{ success: boolean; error?: string; ttsEnabled?: boolean }>
      sendText: (text: string, enableTTS: boolean) => Promise<{ success: boolean; error?: string; response?: string; ttsEnabled?: boolean }>
      stopTTS: () => Promise<{ success: boolean; error?: string }>
      clearHistory: () => Promise<{ success: boolean; error?: string }>
      onTTSAudio: (callback: (audioData: Uint8Array) => void) => void
      onTTSConnected: (callback: () => void) => void
      onTTSClosed: (callback: () => void) => void
      onTTSError: (callback: (error: string) => void) => void
      onConversationResponse: (callback: (text: string) => void) => void
    }
  }
}
