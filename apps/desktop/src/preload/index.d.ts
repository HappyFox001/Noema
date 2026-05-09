export {}

declare global {
  interface Window {
    electronAPI: {
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

      sendText: (
        text: string,
        enableTTS: boolean
      ) => Promise<{
        success: boolean
        error?: string
        response?: string
        ttsEnabled?: boolean
      }>

      stopTTS: () => Promise<{ success: boolean; error?: string }>

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

      listAccountInputs: () => Promise<{
        success: boolean
        inputs?: Array<{
          key: string
          label: string
          value: string
          sensitivity: string
          scope: string
          updatedAt: number
        }>
        error?: string
      }>

      deleteAccountInput: (key: string) => Promise<{
        success: boolean
        error?: string
      }>

      clearAccountInputs: () => Promise<{
        success: boolean
        error?: string
      }>

      getPersonality: () => Promise<any>
      getStats: () => Promise<any>
      getSettings: () => Promise<{
        language: 'zh-CN' | 'en-US'
        voiceInputEnabled: boolean
        voiceOutputEnabled: boolean
        volume: number
        appearance: { orbStyle: 'default' | 'advanced' | 'planet'; theme: 'night' | 'day' }
        selectedPersonality: string
        externalRolePaths: string[]
        system: {
          proxy: string
          llmModels: Array<{ id: string; modelName: string; apiKey: string; baseUrl: string }>
          activeLLMId: string
          taskModels: Array<{ id: string; modelName: string; apiKey: string; baseUrl: string }>
          activeTaskId: string
          ttsModels: Array<{ id: string; provider: 'fish'; modelName: string; apiKey: string; voiceId?: string }>
          activeTTSId: string
          asrModels: Array<{ id: string; provider: 'qwen'; modelName: string; apiKey: string }>
          activeASRId: string
        }
      }>
      updateSettings: (partial: Partial<{
        language: 'zh-CN' | 'en-US'
        voiceInputEnabled: boolean
        voiceOutputEnabled: boolean
        volume: number
        appearance: { orbStyle: 'default' | 'advanced' | 'planet'; theme: 'night' | 'day' }
        selectedPersonality: string
        externalRolePaths: string[]
        system: {
          proxy: string
          llmModels: Array<{ id: string; modelName: string; apiKey: string; baseUrl: string }>
          activeLLMId: string
          taskModels: Array<{ id: string; modelName: string; apiKey: string; baseUrl: string }>
          activeTaskId: string
          ttsModels: Array<{ id: string; provider: 'fish'; modelName: string; apiKey: string; voiceId?: string }>
          activeTTSId: string
          asrModels: Array<{ id: string; provider: 'qwen'; modelName: string; apiKey: string }>
          activeASRId: string
        }
      }>) => Promise<{
        language: 'zh-CN' | 'en-US'
        voiceInputEnabled: boolean
        voiceOutputEnabled: boolean
        volume: number
        appearance: { orbStyle: 'default' | 'advanced' | 'planet'; theme: 'night' | 'day' }
        selectedPersonality: string
        externalRolePaths: string[]
        system: {
          proxy: string
          llmModels: Array<{ id: string; modelName: string; apiKey: string; baseUrl: string }>
          activeLLMId: string
          taskModels: Array<{ id: string; modelName: string; apiKey: string; baseUrl: string }>
          activeTaskId: string
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
      isDevMode: () => Promise<boolean>
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
      testApiModel: (
        kind: 'llm' | 'task' | 'tts' | 'asr',
        model:
          | { id: string; modelName: string; apiKey: string; baseUrl: string }
          | { id: string; provider: 'fish'; modelName: string; apiKey: string; voiceId?: string }
          | { id: string; provider: 'qwen'; modelName: string; apiKey: string }
      ) => Promise<{
        success: boolean
        message?: string
        error?: string
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
          permissions: string[]
          config: Record<string, unknown>
          uiSurfaces: Array<{
            id: string
            pluginId: string
            slot: 'main-view' | 'task-panel'
            mode: 'replace' | 'overlay'
            title?: string
            src: string
            transparent: boolean
          }>
          configSchema: Array<
            | {
                key: string
                label?: string
                description?: string
                type: 'string'
                default?: string
                placeholder?: string
                multiline?: boolean
                rows?: number
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
          adminSchema?: {
            title?: string
            description?: string
            actions?: Array<{
              id: string
              label: string
              description?: string
              variant?: 'primary' | 'secondary' | 'danger'
            }>
          }
        }>
      }>
      pluginAdminAction: (pluginId: string, action: string, payload?: unknown) => Promise<{
        success: boolean
        state?: unknown
        result?: unknown
        error?: string
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
      submitInteractiveInput: (requestId: string, response: {
        value: string
        remembered?: boolean
        cancelled?: boolean
      }) => Promise<void>

      onTTSAudio: (callback: (audioData: Uint8Array, contextId: number) => void) => void
      onTTSConnected: (callback: (contextId: number) => void) => void
      onTTSClosed: (callback: () => void) => void
      onTTSError: (callback: (error: string) => void) => void

      onTTSContextStart: (callback: (contextId: number) => void) => void
      onTTSContextInvalidated: (callback: (contextId: number) => void) => void
      onConversationResponse: (callback: (text: string) => void) => void
      onConversationFrame: (callback: (frame: {
        type: 'system.reset'
      } | {
        type: 'control.phase_start' | 'control.phase_end'
        phase: 'reply' | 'task' | 'task_progress' | 'task_result'
      } | {
        type: 'control.task_start'
        taskDescription: string
      } | {
        type: 'control.task_status'
        status: string
        message?: string
        severity: 'silent' | 'info' | 'important' | 'blocking' | 'final'
      } | {
        type: 'control.task_plan'
        plan: {
          id: string
          title: string
          summary: string
          steps: Array<{
            id: string
            title: string
            description: string
            status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
            result?: string
            error?: string
          }>
        }
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

      onSpeechTranscript: (callback: (text: string) => void) => void
      onSpeechState: (callback: (state: 'listening' | 'processing' | 'idle') => void) => void
      onSpeechError: (callback: (error: string) => void) => void
      onUserSpeaking: (callback: () => void) => void

      onSpeechReconnecting: (callback: () => void) => void
      onSpeechReconnected: (callback: () => void) => void
      onSpeechConnectionFailed: (callback: () => void) => void

      onInterruption: (callback: (turnId: number) => void) => void
      onTurnStart: (callback: (turnId: number) => void) => void
      onInteractiveInputRequest: (callback: (request: {
        id: string
        key?: string
        label: string
        description?: string
        placeholder?: string
        inputKind: 'text' | 'password' | 'textarea' | 'code'
        persistence: 'temporary' | 'persistent'
        sensitivity: 'normal' | 'secret' | 'verification'
      }) => void) => void

      onPlaybackWaitRequest: (callback: (requestId: number) => void) => void
      notifyPlaybackComplete: (requestId: number) => void

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

      moveWindow: (deltaX: number, deltaY: number) => void
      getCursorScreenPoint: () => Promise<{
        x: number
        y: number
        displayBounds: { x: number; y: number; width: number; height: number }
      }>
      setCompactWindowMode: (compact: boolean) => void
      setTaskWindowMode: (active: boolean) => void
    }
  }
}
