export {}

type ChatPreloadMessageContent = string | Array<
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
>

type ChatPreloadMedia = {
  id?: string
  kind: 'image' | 'video' | 'audio'
  name: string
  mimeType: string
  dataUrl?: string
  url?: string
  size?: number
  durationMs?: number
  transcript?: string
  prompt?: string
  origin?: 'user' | 'assistant' | 'tool' | 'generated' | 'external'
  dispatch?: {
    trigger?: 'manual' | 'model' | 'request' | 'auto' | 'tool' | 'external' | 'probability'
    mode?: 'turn' | 'permanent'
    probability?: number
    externalProbabilityBias?: number
    reason?: string
  }
  context?: {
    mode?: 'auto' | 'visual' | 'text' | 'none'
    summary?: string
  }
  metadata?: Record<string, unknown>
}

type ChatPreloadImageModel = {
  id: string
  modelType: 'image'
  provider?: string
  transport?: 'openai_compatible' | 'codex_local' | 'claude_code_local'
  modelName: string
  enabledModels?: string[]
  apiKey: string
  baseUrl: string
}

type ChatPreloadTTSModel = {
  id: string
  provider: string
  modelName: string
  apiKey: string
  voiceId?: string
  baseUrl?: string
  language?: string
  format?: 'pcm' | 'mp3' | 'opus'
  sampleRate?: number
  extra?: Record<string, unknown>
}

type ChatPreloadImagePromptContext = {
  strategy: 'manual-edit' | 'requested-edit' | 'proactive-edit'
  language: 'zh-CN' | 'en-US'
  visualIntent?: string
  manualDirection?: string
  userText?: string
  assistantText?: string
}

type ChatPreloadAtmosphereStyle = {
  schemaVersion: 1
  name: string
  summary?: string
  mood: string[]
  palette: {
    accent: string
    accentSoft: string
    surface: 'glass' | 'paper' | 'noir' | 'mist' | 'velvet' | 'terminal'
    warmth: 'cool' | 'neutral' | 'warm'
    contrast: 'low' | 'medium' | 'high'
  }
  message: {
    frame: 'plain' | 'literary-panel' | 'visual-novel' | 'dossier' | 'letter'
    narration: 'soft-prose' | 'cinematic' | 'noir' | 'diary' | 'clinical'
    speech: 'quote-emphasis' | 'quiet-line' | 'stage-dialogue'
    density: 'compact' | 'balanced' | 'airy'
    radius: 'sharp' | 'soft' | 'round'
  }
  audio: {
    player: 'thin-glass-bar' | 'soft-wave-strip' | 'quiet-capsule' | 'dossier-line'
    motion: 'still' | 'subtle-wave' | 'breath'
    tone: 'near' | 'distant' | 'intimate' | 'formal'
  }
  sceneCard: {
    frame: 'quiet-panel' | 'glass-dossier' | 'paper-note' | 'terminal-readout'
    divider: 'fine-line' | 'soft-band' | 'none'
  }
  preview?: Record<string, unknown>
  sourceArtifactId?: string
}

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
          source: 'chat' | 'file'
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
          roleCard?: Record<string, unknown>
          atmosphereStyle?: ChatPreloadAtmosphereStyle
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
      deleteChatRoleResource: (id: string) => Promise<{
        success: boolean
        deleted?: boolean
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
          messages?: Array<{
            id: string
            role: 'system' | 'user' | 'assistant'
            text: Record<string, string>
            createdLabel: Record<string, string>
            media?: ChatPreloadMedia[]
            openingPanel?: {
              html: string
              css: string
              summary?: string
              layoutKind?: string
              sourceArtifactId?: string
            }
            state?: 'idle' | 'thinking' | 'generating_image' | 'using_tool'
          }>
          workflowState?: unknown
          characterResource?: {
            id: string
            roleCard?: Record<string, unknown>
            openingPanel?: {
              html: string
              css: string
              summary?: string
              layoutKind?: string
              sourceArtifactId?: string
            }
            atmosphereStyle?: ChatPreloadAtmosphereStyle
            name: Record<string, string>
            displayName: Record<string, string>
            description: Record<string, string>
            story: Record<string, string>
            background: Record<string, string>
            scene: Record<string, unknown>
            firstMessage: Record<string, string>
            tag: Record<string, string[]>
            avatarImage: string
            bodyImage: string
          }
          messageCount?: number
          hasWorkflowState?: boolean
        }>
        error?: string
      }>
      getChatConversation: (id: string, request?: { includeWorkflowState?: boolean }) => Promise<{
        success: boolean
        conversation?: {
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
            media?: ChatPreloadMedia[]
            openingPanel?: {
              html: string
              css: string
              summary?: string
              layoutKind?: string
              sourceArtifactId?: string
            }
            state?: 'idle' | 'thinking' | 'generating_image' | 'using_tool'
          }>
          workflowState?: unknown
          characterResource?: {
            id: string
            roleCard?: Record<string, unknown>
            openingPanel?: {
              html: string
              css: string
              summary?: string
              layoutKind?: string
              sourceArtifactId?: string
            }
            atmosphereStyle?: ChatPreloadAtmosphereStyle
            name: Record<string, string>
            displayName: Record<string, string>
            description: Record<string, string>
            story: Record<string, string>
            background: Record<string, string>
            scene: Record<string, unknown>
            firstMessage: Record<string, string>
            tag: Record<string, string[]>
            avatarImage: string
            bodyImage: string
          }
        } | null
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
        workflowState?: unknown
        characterResource?: unknown
      }) => Promise<{ success: boolean; error?: string }>
      deleteChatConversation: (id: string) => Promise<{ success: boolean; error?: string }>
      clearChatConversations: () => Promise<{ success: boolean; error?: string }>
      listCharacterWorkflowProjects: () => Promise<{
        success: boolean
        projects?: Array<{
          id: string
          name: string
          schemaVersion: number
          createdAt: number
          updatedAt: number
          activeRunId?: string
          runCount: number
          payload?: unknown
        }>
        error?: string
      }>
      getCharacterWorkflowProject: (id: string) => Promise<{
        success: boolean
        project?: {
          id: string
          name: string
          schemaVersion: number
          createdAt: number
          updatedAt: number
          activeRunId?: string
          runCount: number
          payload?: unknown
        } | null
        error?: string
      }>
      getCharacterWorkflowProjectOverview: (id: string) => Promise<{
        success: boolean
        project?: {
          id: string
          name: string
          schemaVersion: number
          createdAt: number
          updatedAt: number
          activeRunId?: string
          runCount: number
          payload?: unknown
        } | null
        error?: string
      }>
      getCharacterWorkflowRun: (projectId: string, runId: string) => Promise<{
        success: boolean
        run?: unknown
        error?: string
      }>
      deleteCharacterWorkflowRun: (projectId: string, runId: string) => Promise<{ success: boolean; error?: string }>
      saveCharacterWorkflowProject: (project: {
        id: string
        name: string
        schemaVersion: number
        createdAt: number
        updatedAt: number
        activeRunId?: string
        runCount: number
        payload?: unknown
      }) => Promise<{ success: boolean; error?: string }>
      deleteCharacterWorkflowProject: (id: string) => Promise<{ success: boolean; error?: string }>
      sendChatMessage: (request: {
        input: string
        language?: string
        preferencePrompt?: string
        options?: Record<string, unknown>
        messages?: Array<{
          role: 'system' | 'user' | 'assistant'
          content: ChatPreloadMessageContent
        }>
        media?: ChatPreloadMedia[]
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
      buildCharacterWorkflow: (request: {
        prompt: string
        language?: 'zh-CN' | 'en-US'
        mode?: 'create' | 'edit'
        editorSession?: {
          objective?: string
          plan?: string[]
          completedSteps?: string[]
          currentStep?: string
          nextStep?: string
          history?: Array<{
            stepIndex?: number
            tool?: string
            userRequest?: string
            summary?: string
            status?: string
            operations?: number
            currentStep?: string
            nextStep?: string
          }>
        }
        graph?: {
          selectedNodeId?: string
          nodes: Array<{
            id: string
            type: string
            title?: string
            config?: Record<string, unknown>
            inputs?: string[]
            outputs?: string[]
          }>
          edges: Array<{
            id?: string
            from: { nodeId: string; port: string }
            to: { nodeId: string; port: string }
            kind?: string
          }>
        }
      }) => Promise<{
        success: boolean
        workflow?: Record<string, unknown>
        spec?: {
          name: string
          plan?: string[]
          summary?: string
          confidence?: number
          status?: 'applied' | 'needs-user' | 'blocked' | 'complete'
          decision?: {
            id: string
            title: string
            description?: string
            options: Array<{
              id: string
              label: string
              detail?: string
              patchHint?: string
            }>
            defaultOptionId?: string
            allowSkip?: boolean
          }
          goalPrompt: string
          targetAudience: string
          stylePrompt: string
          preset: string
          intensity: number
          mustHave: string[]
          mustNot: string[]
          sourceNotes: string
          generationStrategy: {
            mode: string
            branchCount: number
            priorityAssets: string[]
          }
          agentPolicy: {
            autonomyLevel: string
            revisionBudget: number
            askUserThreshold: string
          }
          qualityGate: {
            minimumScore: number
            requiredChecks: string[]
          }
          assetTargets: string[]
          outputFormat: string
          operations?: Array<Record<string, unknown>>
        }
        uiConfigOverrides?: Record<string, Record<string, unknown>>
        agentWork?: {
          id: string
          mode: 'create' | 'edit'
          objective: string
          status: 'active' | 'needs-user' | 'blocked' | 'complete'
          plan: string[]
          completedSteps: string[]
          currentStep?: string
          nextStep?: string
          decision?: {
            id: string
            title: string
            description?: string
            options: Array<{
              id: string
              label: string
              detail?: string
              patchHint?: string
            }>
            defaultOptionId?: string
            allowSkip?: boolean
          }
          createdAt: number
          updatedAt: number
          steps: Array<{
            id: string
            index: number
            tool: 'inspect_graph' | 'plan_requirements' | 'repair_structure' | 'generate_style' | 'generate_fields' | 'generate_images' | 'generate_css' | 'generate_gameplay' | 'generate_quality' | 'evaluate_goal_coverage' | 'repair_domain' | 'edit_graph' | 'validate_graph' | 'ask_user' | 'finish'
            userRequest: string
            summary: string
            status: 'applied' | 'needs-user' | 'blocked' | 'complete'
            plan: string[]
            completedSteps: string[]
            currentStep?: string
            nextStep?: string
            decision?: {
              id: string
              title: string
              description?: string
              options: Array<{
                id: string
                label: string
                detail?: string
                patchHint?: string
              }>
              defaultOptionId?: string
              allowSkip?: boolean
            }
            operations: Array<Record<string, unknown>>
            uiConfigOverrides: Record<string, Record<string, unknown>>
            createdAt: number
          }>
        }
        error?: string
      }>
      streamBuildCharacterWorkflow?: (
        request: Parameters<Window['electronAPI']['buildCharacterWorkflow']>[0],
        handlers?: {
          onEvent?: (event: {
            type: string
            mode?: 'create' | 'edit'
            workId?: string
            timestamp?: number
            step?: {
              id: string
              index: number
              tool?: string
              userRequest?: string
              summary?: string
              status?: string
              plan?: string[]
              completedSteps?: string[]
              currentStep?: string
              nextStep?: string
              decision?: {
                id: string
                title: string
                description?: string
                options: Array<{
                  id: string
                  label: string
                  detail?: string
                  patchHint?: string
                }>
                defaultOptionId?: string
                allowSkip?: boolean
              }
              operations?: Array<Record<string, unknown>>
              uiConfigOverrides?: Record<string, Record<string, unknown>>
              createdAt?: number
            }
            work?: {
              id: string
              mode: 'create' | 'edit'
              objective: string
              status: 'active' | 'needs-user' | 'blocked' | 'complete'
              plan: string[]
              completedSteps: string[]
              currentStep?: string
              nextStep?: string
              decision?: {
                id: string
                title: string
                description?: string
                options: Array<{
                  id: string
                  label: string
                  detail?: string
                  patchHint?: string
                }>
                defaultOptionId?: string
                allowSkip?: boolean
              }
              updatedAt: number
            }
          }) => void
          onDone?: (result: Awaited<ReturnType<Window['electronAPI']['buildCharacterWorkflow']>>) => void
          onError?: (error: string) => void
        }
      ) => ReturnType<Window['electronAPI']['buildCharacterWorkflow']>
      runCharacterWorkflow: (request: {
        workflow: Record<string, unknown>
        language?: 'zh-CN' | 'en-US'
        runId?: string
        scopedRun?: {
          instruction?: string
          action?: 'retry' | 'reroll' | 'resume' | 'repair'
          scope: {
            targetNodeIds?: string[]
            requirementIds?: string[]
            artifactIds?: string[]
            parentAttemptId?: string
          }
          seedArtifacts?: Array<{
            id?: string
            type: string
            sourceNodeId?: string
            title?: string
            summary?: string
            data?: unknown
          }>
        }
      }) => Promise<{
        success: boolean
        runId?: string
        title?: string
        status?: 'done' | 'needs_action' | 'failed' | 'cancelled'
        artifacts?: Array<{
          id: string
          kind: string
          title: string
          summary: string
          sourceNodeId?: string
          data?: unknown
        }>
        error?: string
      }>
      cancelCharacterWorkflowRun: (request?: {
        streamId?: string
        runId?: string
        reason?: string
      }) => Promise<{ success: boolean; error?: string }>
      streamCharacterWorkflow?: (request: {
        workflow: Record<string, unknown>
        language?: 'zh-CN' | 'en-US'
        runId?: string
        scopedRun?: Parameters<Window['electronAPI']['runCharacterWorkflow']>[0]['scopedRun']
      }, handlers?: {
        onEvent?: (event: Record<string, unknown>) => void
        onDone?: (result: {
          success: boolean
          runId?: string
          title?: string
          status?: 'done' | 'needs_action' | 'failed' | 'cancelled'
          artifacts?: Array<{
            id: string
            kind: string
            title: string
            summary: string
            sourceNodeId?: string
            data?: unknown
          }>
          error?: string
        }) => void
        onError?: (error: string) => void
      }) => Promise<{
        success: boolean
        runId?: string
        title?: string
        status?: 'done' | 'needs_action' | 'failed' | 'cancelled'
        artifacts?: Array<{
          id: string
          kind: string
          title: string
          summary: string
          sourceNodeId?: string
          data?: unknown
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
          content: ChatPreloadMessageContent
        }>
        media?: ChatPreloadMedia[]
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
        modelType?: 'llm' | 'image'
        apiKey?: string
        baseUrl?: string
      }) => Promise<{
        success: boolean
        models?: string[]
        error?: string
      }>
      selectChatMedia: (request?: {
        kind?: 'image' | 'video' | 'audio' | 'media'
      }) => Promise<{
        success: boolean
        canceled?: boolean
        media?: ChatPreloadMedia[]
        error?: string
      }>
      generateChatImageMedia: (request: {
        model: ChatPreloadImageModel
        modelName?: string
        prompt: string
        promptContext: ChatPreloadImagePromptContext
        referenceImages?: string[]
        size?: string
        name?: string
      }) => Promise<{
        success: boolean
        media?: ChatPreloadMedia
        provider?: string
        model?: string
        error?: string
      }>
      synthesizeChatAudioMedia: (request: {
        model: ChatPreloadTTSModel
        text: string
        name?: string
      }) => Promise<{
        success: boolean
        media?: ChatPreloadMedia
        provider?: string
        model?: string
        error?: string
      }>
      selectChatMaterials: () => Promise<{
        success: boolean
        canceled?: boolean
        materials?: Array<{
          kind: 'image' | 'document'
          name: string
          mimeType: string
          dataUrl?: string
          text?: string
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
