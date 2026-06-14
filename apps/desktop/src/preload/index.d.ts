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

      getLearningOverview: () => Promise<{
        success: boolean
        error?: string
        events?: any[]
        reflections?: any[]
        candidates?: any[]
        assets?: any[]
        agents?: any[]
      }>

      reflectRecentLearning: () => Promise<{
        success: boolean
        error?: string
        result?: any
      }>

      deployLearningCandidate: (payload: {
        candidateId: string
        scope: string
        status?: 'draft' | 'active'
      }) => Promise<{ success: boolean; error?: string; asset?: any }>

      setLearningAssetStatus: (
        id: string,
        status: 'draft' | 'active' | 'disabled' | 'archived'
      ) => Promise<{ success: boolean; error?: string }>

      deleteLearningAsset: (id: string) => Promise<{ success: boolean; error?: string }>

      rollbackLearningAsset: (
        id: string,
        reason: string
      ) => Promise<{ success: boolean; error?: string; rollback?: any }>

      setRuntimeAgentStatus: (
        id: string,
        status: 'draft' | 'active' | 'disabled'
      ) => Promise<{ success: boolean; error?: string }>

      getPersonality: () => Promise<any>
      getStats: () => Promise<any>
      listLogs: (limit?: number) => Promise<{
        success: boolean
        logs: Array<{
          id: number
          time: number
          level: 'debug' | 'info' | 'warn' | 'error'
          type: 'app' | 'asr' | 'audio' | 'conversation' | 'latency' | 'llm' | 'memory' | 'plugin' | 'settings' | 'task' | 'tts' | 'turn' | 'vad'
          message: string
        }>
      }>
      clearLogs: () => Promise<{ success: boolean; error?: string }>
      setLogsStreaming: (streaming: boolean) => void
      getSystemTelemetry: () => Promise<{
        success: boolean
        cpuPercent: number
        memoryBytes: number
        activeNetworkInterfaces: number
        proxyActive: boolean
        activeProxyUrl?: string
        error?: string
      }>
      getSettings: () => Promise<{
        language: 'zh-CN' | 'en-US'
        voiceInputEnabled: boolean
        voiceOutputEnabled: boolean
        volume: number
        appearance: { orbStyle: 'default' | 'advanced' | 'planet'; theme: 'night' | 'day'; liquidGlassEnabled: boolean; dragonCursorEnabled: boolean }
        experimental?: { selfLearningEnabled: boolean }
        selectedPersonality: string
        externalRolePaths: string[]
        pluginPathHistory: Record<string, { mode: 'file' | 'directory'; lastPath: string; recentPaths: string[] }>
        system: {
          proxy: string
          llmModels: Array<{ id: string; provider?: string; modelName: string; apiKey: string; baseUrl: string }>
          activeLLMId: string
          chatModels: Array<{ id: string; modelType: 'llm' | 'image'; provider?: string; modelName: string; enabledModels: string[]; availableModels: string[]; modelsFetchedAt?: number; apiKey: string; baseUrl: string }>
          activeChatId: string
          activeChatModelName: string
          taskModels: Array<{ id: string; provider?: string; transport?: 'openai_compatible' | 'codex_local' | 'claude_code_local'; modelName: string; apiKey: string; baseUrl: string }>
          activeTaskId: string
          taskRuntime: any
          ttsModels: Array<{ id: string; provider: string; modelName: string; apiKey: string; voiceId?: string; baseUrl?: string; language?: string; format?: 'pcm' | 'mp3' | 'opus'; sampleRate?: number; extra?: Record<string, unknown> }>
          activeTTSId: string
          asrModels: Array<{ id: string; provider: string; modelName: string; apiKey: string; baseUrl?: string; language?: string; sampleRate?: number; extra?: Record<string, unknown> }>
          activeASRId: string
        }
      }>
      updateSettings: (partial: Partial<{
        language: 'zh-CN' | 'en-US'
        voiceInputEnabled: boolean
        voiceOutputEnabled: boolean
        volume: number
        appearance: { orbStyle: 'default' | 'advanced' | 'planet'; theme: 'night' | 'day'; liquidGlassEnabled: boolean; dragonCursorEnabled: boolean }
        experimental?: { selfLearningEnabled: boolean }
        selectedPersonality: string
        externalRolePaths: string[]
        pluginPathHistory: Record<string, { mode: 'file' | 'directory'; lastPath: string; recentPaths: string[] }>
        system: {
          proxy: string
          llmModels: Array<{ id: string; provider?: string; modelName: string; apiKey: string; baseUrl: string }>
          activeLLMId: string
          chatModels: Array<{ id: string; modelType: 'llm' | 'image'; provider?: string; modelName: string; enabledModels: string[]; availableModels: string[]; modelsFetchedAt?: number; apiKey: string; baseUrl: string }>
          activeChatId: string
          activeChatModelName: string
          taskModels: Array<{ id: string; provider?: string; transport?: 'openai_compatible' | 'codex_local' | 'claude_code_local'; modelName: string; apiKey: string; baseUrl: string }>
          activeTaskId: string
          taskRuntime: any
          ttsModels: Array<{ id: string; provider: string; modelName: string; apiKey: string; voiceId?: string; baseUrl?: string; language?: string; format?: 'pcm' | 'mp3' | 'opus'; sampleRate?: number; extra?: Record<string, unknown> }>
          activeTTSId: string
          asrModels: Array<{ id: string; provider: string; modelName: string; apiKey: string; baseUrl?: string; language?: string; sampleRate?: number; extra?: Record<string, unknown> }>
          activeASRId: string
        }
      }>) => Promise<{
        language: 'zh-CN' | 'en-US'
        voiceInputEnabled: boolean
        voiceOutputEnabled: boolean
        volume: number
        appearance: { orbStyle: 'default' | 'advanced' | 'planet'; theme: 'night' | 'day'; liquidGlassEnabled: boolean; dragonCursorEnabled: boolean }
        experimental?: { selfLearningEnabled: boolean }
        selectedPersonality: string
        externalRolePaths: string[]
        system: {
          proxy: string
          llmModels: Array<{ id: string; provider?: string; modelName: string; apiKey: string; baseUrl: string }>
          activeLLMId: string
          chatModels: Array<{ id: string; modelType: 'llm' | 'image'; provider?: string; modelName: string; enabledModels: string[]; availableModels: string[]; modelsFetchedAt?: number; apiKey: string; baseUrl: string }>
          activeChatId: string
          activeChatModelName: string
          taskModels: Array<{ id: string; provider?: string; transport?: 'openai_compatible' | 'codex_local' | 'claude_code_local'; modelName: string; apiKey: string; baseUrl: string }>
          activeTaskId: string
          taskRuntime: any
          ttsModels: Array<{ id: string; provider: string; modelName: string; apiKey: string; voiceId?: string; baseUrl?: string; language?: string; format?: 'pcm' | 'mp3' | 'opus'; sampleRate?: number; extra?: Record<string, unknown> }>
          activeTTSId: string
          asrModels: Array<{ id: string; provider: string; modelName: string; apiKey: string; baseUrl?: string; language?: string; sampleRate?: number; extra?: Record<string, unknown> }>
          activeASRId: string
        }
      }>
      resetSystemConfigFromEnv: () => Promise<{
        success: boolean
        error?: string
      }>
      isDevMode: () => Promise<boolean>
      getAppVersion: () => Promise<string>
      checkForUpdates: (options?: { force?: boolean }) => Promise<{
        success: boolean
        error?: string
        currentVersion: string
        latestVersion?: string
        updateAvailable: boolean
        releaseName?: string
        releaseNotes?: string
        releaseUrl?: string
        publishedAt?: string
        checkedAt: number
      }>
      openReleasePage: (releaseUrl?: string) => Promise<{ success: boolean; error?: string }>
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
          | { id: string; provider?: string; transport?: 'openai_compatible' | 'codex_local' | 'claude_code_local'; modelName: string; apiKey: string; baseUrl: string }
          | { id: string; provider: string; modelName: string; apiKey: string; voiceId?: string; baseUrl?: string; language?: string; sampleRate?: number }
          | { id: string; provider: string; modelName: string; apiKey: string; baseUrl?: string; language?: string; sampleRate?: number }
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
          i18n?: Record<string, Record<string, string>>
          uiSurfaces: Array<{
            id: string
            pluginId: string
            slot: 'main-view' | 'task-panel'
            mode: 'replace' | 'overlay'
            title?: string
            src: string
            transparent: boolean
            config: Record<string, unknown>
          }>
          configSchema: Array<
            | {
                key: string
                label?: string
                description?: string
                advanced?: boolean
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
                advanced?: boolean
                type: 'file'
                default?: string
                placeholder?: string
                buttonLabel?: string
                filters?: Array<{ name: string; extensions: string[] }>
              }
            | {
                key: string
                label?: string
                description?: string
                advanced?: boolean
                type: 'directory'
                default?: string
                placeholder?: string
                buttonLabel?: string
                targetKey?: string
                resolveFileExtensions?: string[]
                resolveRecursive?: boolean
              }
            | {
                key: string
                label?: string
                description?: string
                advanced?: boolean
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
                advanced?: boolean
                type: 'boolean'
                default?: boolean
              }
            | {
                key: string
                label?: string
                description?: string
                advanced?: boolean
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
      listPluginMarketplace: (options?: { refresh?: boolean }) => Promise<{
        success: boolean
        error?: string
        source?: string
        registryUrl?: string
        cached?: boolean
        fetchedAt?: number
        plugins: Array<{
          id: string
          name: string
          version?: string
          description?: string
          i18n?: Record<string, { name?: string; description?: string }>
          path?: string
          manifest?: string
          tags: string[]
          sourceUrl: string
          installed: boolean
          enabled: boolean
        }>
      }>
      openPluginMarketplaceSource: (sourceUrl?: string) => Promise<{
        success: boolean
        error?: string
      }>
      uninstallPlugin: (pluginId: string) => Promise<{
        success: boolean
        error?: string
        pluginDir?: string
      }>
      installPluginFromMarketplace: (pluginId: string) => Promise<{
        success: boolean
        error?: string
        pluginDir?: string
      }>
      pluginAdminAction: (pluginId: string, action: string, payload?: unknown) => Promise<{
        success: boolean
        state?: unknown
        result?: unknown
        error?: string
      }>
      selectPluginConfigPath: (options?: {
        pluginId?: string
        mode?: 'file' | 'directory'
        title?: string
        defaultPath?: string
        filters?: Array<{ name: string; extensions: string[] }>
        resolveFileExtensions?: string[]
        resolveRecursive?: boolean
      }) => Promise<{
        success: boolean
        canceled?: boolean
        filePath?: string
        fileUrl?: string
        directoryPath?: string
        resolvedFilePath?: string
        resolvedFileUrl?: string
        error?: string
      }>
      selectPluginConfigFile: (options?: {
        title?: string
        filters?: Array<{ name: string; extensions: string[] }>
      }) => Promise<{
        success: boolean
        canceled?: boolean
        filePath?: string
        fileUrl?: string
        error?: string
      }>
      readLive2dModelCapabilities: (options?: {
        pluginDir?: string
        modelUrl?: string
      }) => Promise<{
        success: boolean
        motionGroups?: string[]
        expressions?: string[]
        lipSyncParameters?: string[]
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
      listChatRoleResources: () => Promise<{
        success: boolean
        resources?: Array<{
          id: string
          name: Record<string, string>
          displayName: Record<string, string>
          description: Record<string, string>
          story: Record<string, string>
          background: Record<string, string>
          scene: Record<string, unknown>
          tag: Record<string, string[]>
          avatarImage: string
          bodyImage: string
        }>
        error?: string
      }>
      listChatConversations: () => Promise<{
        success: boolean
        conversations?: Array<{
          id: string
          characterId: string
          title: Record<string, string>
          preview: Record<string, string>
          updatedLabel: Record<string, string>
          sceneState?: Record<string, unknown>
          summaries?: Array<{
            id: string
            text: Record<string, string>
            createdLabel: Record<string, string>
            messageCount: number
            startMessageIndex: number
            endMessageIndex: number
            sourceMessageIds: string[]
          }>
          messages: Array<{
            id: string
            role: 'system' | 'user' | 'assistant'
            text: Record<string, string>
            createdLabel: Record<string, string>
            attachments?: Array<{
              id: string
              kind: 'image' | 'video'
              name: string
              mimeType: string
              dataUrl?: string
              size?: number
            }>
            state?: 'idle' | 'thinking' | 'generating_image' | 'using_tool'
          }>
        }>
        error?: string
      }>
      saveChatConversation: (conversation: {
        id: string
        characterId: string
        title: Record<string, string>
        preview: Record<string, string>
        updatedLabel: Record<string, string>
        sceneState: unknown
        summaries?: unknown[]
        messages: unknown[]
      }) => Promise<{ success: boolean; error?: string }>
      deleteChatConversation: (id: string) => Promise<{ success: boolean; error?: string }>
      clearChatConversations: () => Promise<{ success: boolean; error?: string }>
      sendChatMessage: (request: {
        input: string
        language?: string
        preferencePrompt?: string
        options?: Record<string, unknown>
        messages?: Array<{
          role: 'system' | 'user' | 'assistant'
          content: string
        }>
        attachments?: Array<{
          kind: 'image' | 'video'
          name: string
          mimeType: string
          dataUrl?: string
          size?: number
        }>
        character?: {
          id?: string
          displayName?: string
          description?: string
          story?: string
          background?: string
          firstMessage?: string
          tags?: string[]
          instructions?: string
          sceneState?: Record<string, unknown>
          canonMemory?: string[]
          narrativeSummaries?: Array<{
            startMessageIndex?: number
            endMessageIndex?: number
            text: string
          }>
        }
      }) => Promise<{
        success: boolean
        response?: string
        sceneUpdate?: Record<string, unknown>
        error?: string
      }>
      runCharacterWorkflow: (request: {
        workflow: Record<string, unknown>
        language?: 'zh-CN' | 'en-US'
      }) => Promise<{
        success: boolean
        runId?: string
        title?: string
        artifacts?: Array<{
          id: string
          kind: string
          title: string
          summary: string
          sourceNodeId?: string
        }>
        error?: string
      }>
      streamChatMessage: (request: {
        input: string
        language?: string
        preferencePrompt?: string
        options?: Record<string, unknown>
        messages?: Array<{
          role: 'system' | 'user' | 'assistant'
          content: string
        }>
        attachments?: Array<{
          kind: 'image' | 'video'
          name: string
          mimeType: string
          dataUrl?: string
          size?: number
        }>
        character?: {
          id?: string
          displayName?: string
          description?: string
          story?: string
          background?: string
          firstMessage?: string
          tags?: string[]
          instructions?: string
          sceneState?: Record<string, unknown>
          canonMemory?: string[]
          narrativeSummaries?: Array<{
            startMessageIndex?: number
            endMessageIndex?: number
            text: string
          }>
        }
      }, handlers?: {
        onDelta?: (delta: string) => void
        onDone?: (result: {
          success: boolean
          response?: string
          sceneUpdate?: Record<string, unknown>
          error?: string
        }) => void
        onError?: (error: string) => void
      }) => Promise<{
        success: boolean
        response?: string
        sceneUpdate?: Record<string, unknown>
        error?: string
      }>
      listChatModels: (request: {
        provider?: string
        apiKey?: string
        baseUrl?: string
      }) => Promise<{
        success: boolean
        models?: string[]
        error?: string
      }>
      selectChatMedia: (request?: {
        kind?: 'image' | 'video' | 'media'
      }) => Promise<{
        success: boolean
        canceled?: boolean
        attachments?: Array<{
          kind: 'image' | 'video'
          name: string
          mimeType: string
          dataUrl?: string
          size?: number
        }>
        error?: string
      }>
      requestChatCameraPermission: () => Promise<{
        success: boolean
        granted?: boolean
        status?: string
        openedSettings?: boolean
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
        phase: 'reply' | 'task_progress' | 'task_result'
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
      onLogEntry: (callback: (entry: {
        id: number
        time: number
        level: 'debug' | 'info' | 'warn' | 'error'
        type: 'app' | 'asr' | 'audio' | 'conversation' | 'latency' | 'llm' | 'memory' | 'plugin' | 'settings' | 'task' | 'tts' | 'turn' | 'vad'
        message: string
      }) => void) => void
      onLogBatch: (callback: (entries: Array<{
        id: number
        time: number
        level: 'debug' | 'info' | 'warn' | 'error'
        type: 'app' | 'asr' | 'audio' | 'conversation' | 'latency' | 'llm' | 'memory' | 'plugin' | 'settings' | 'task' | 'tts' | 'turn' | 'vad'
        message: string
      }>) => void) => void
      onLogsCleared: (callback: () => void) => void
      onAppMenuCommand: (callback: (message: {
        command: 'open-settings'
        payload?: {
          section?: string
        }
      }) => void) => void

      moveWindow: (deltaX: number, deltaY: number) => void
      getCursorScreenPoint: () => Promise<{
        x: number
        y: number
        displayBounds: { x: number; y: number; width: number; height: number }
      }>
      setWindowOpacity: (opacity: number) => Promise<{ success: boolean; error?: string }>
      captureToClipboard: (rect: {
        x: number
        y: number
        width: number
        height: number
        scaleFactor?: number
      }) => Promise<{
        success: boolean
        width?: number
        height?: number
        error?: string
      }>
      captureWindow: () => Promise<{
        success: boolean
        width?: number
        height?: number
        dataUrl?: string
        error?: string
      }>
      beginThemeTransitionCover: () => Promise<{
        success: boolean
        width?: number
        height?: number
        dataUrl?: string
        error?: string
      }>
      endThemeTransitionCover: () => Promise<{ success: boolean; error?: string }>
      playThemeTransitionCover: (afterDataUrl: string) => Promise<{ success: boolean; error?: string }>
      setCompactWindowMode: (compact: boolean) => Promise<{ success: boolean; error?: string }>
      setChatWindowMode: (active: boolean, fullscreen?: boolean) => Promise<{
        success: boolean
        fullscreen?: boolean
        width?: number
        height?: number
        error?: string
      }>
      resizeChatWindow: (
        edge: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw',
        deltaX: number,
        deltaY: number
      ) => Promise<{
        success: boolean
        fullscreen?: boolean
        width?: number
        height?: number
        error?: string
      }>
      setTaskWindowMode: (active: boolean) => Promise<{ success: boolean; error?: string }>
    }
  }
}
