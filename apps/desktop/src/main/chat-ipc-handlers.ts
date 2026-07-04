/**
 * IPC handlers for the standalone text chat surface.
 */
import { type IpcMain } from 'electron'
import { dialog, systemPreferences, shell, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { readFile } from 'fs/promises'
import { basename, extname } from 'path'
import { listChatModelsWithProvider } from '@noema/sdk/chat/model-list'
import { ChatMediaService } from '@noema/sdk/chat/media-service'
import { filterEditCapableImageModelNames, isImageModelEditCapable } from '@noema/sdk/image/catalog'
import {
  directChatImagePrompt,
  type ChatImagePromptDirectorInput,
} from '@noema/sdk/chat/conversation-runtime'
import {
  ChatRuntime,
  normalizeChatRuntimeError,
  sendChatTurnWithConfiguredModel,
  type ChatRuntimeEvent,
  type ChatRuntimeTurnRequest,
} from '@noema/sdk/chat/request-runtime'
import {
  type CharacterAgentEvent,
  createCharacterAgentModelConfigs,
  createConfiguredCharacterAgentToolRuntime,
  createCharacterSuperAgent,
  createInMemoryCharacterArtifactStore,
  createStaticCharacterAgentModelResolver,
  buildCharacterWorkflowFromPrompt,
  loadCharacterAgentWorkflowSnapshot,
  type CharacterAgentArtifact,
  type CharacterAgentScopedRun,
  type CharacterWorkflowBuilderEvent,
  type CharacterWorkflowEditorAgentWork,
  type CharacterWorkflowBuilderSpec,
} from '@noema/sdk/character-workflow'
import { ChatHistoryStore, type StoredChatConversation, type StoredChatConversationListItem } from './chat-history-store.js'
import { CharacterWorkflowStore, type StoredCharacterWorkflowProject } from './character-workflow-store.js'
import type { TTSModelConfig } from './settings-store.js'

const LOCAL_CLI_DEFAULT_MODEL_REF = '__default__'

export interface ChatIpcModelConfig {
  id?: string
  provider?: string
  transport?: 'openai_compatible' | 'codex_local' | 'claude_code_local'
  modelName: string
  apiKey: string
  baseUrl?: string
}

export interface ChatIpcConfiguredModel {
  id: string
  modelType: 'llm' | 'image'
  provider?: string
  transport?: 'openai_compatible' | 'codex_local' | 'claude_code_local'
  modelName: string
  enabledModels?: string[]
  apiKey: string
  baseUrl: string
}

export interface ChatGenerateImageMediaRequest {
  model: ChatIpcConfiguredModel
  modelName?: string
  prompt: string
  promptContext: ChatImagePromptDirectorInput
  referenceImages?: string[]
  size?: string
  name?: string
}

export interface ChatGenerateMediaResult {
  success: boolean
  media?: ChatIpcMedia
  provider?: string
  model?: string
  error?: string
}

export interface ChatSynthesizeAudioMediaRequest {
  model: TTSModelConfig
  text: string
  name?: string
}

function normalizeImagePromptDirectorChatOptions(options: Record<string, unknown> | undefined): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  const temperature = typeof options?.temperature === 'number' && Number.isFinite(options.temperature)
    ? Math.max(0, Math.min(2, options.temperature))
    : 0.62
  const maxTokens = typeof options?.max_tokens === 'number' && Number.isFinite(options.max_tokens)
    ? Math.max(1, Math.min(1200, Math.floor(options.max_tokens)))
    : 520
  normalized.temperature = temperature
  normalized.max_tokens = maxTokens
  return normalized
}

function logCharacterWorkflowImageAttemptFailure(event: CharacterAgentEvent): void {
  if (event.type !== 'artifact.created' || event.artifact.kind !== 'image-attempt') {
    return
  }
  const data = event.artifact.data && typeof event.artifact.data === 'object'
    ? event.artifact.data as Record<string, any>
    : {}
  if (data.status !== 'failed') {
    return
  }
  const model = data.model && typeof data.model === 'object' ? data.model as Record<string, unknown> : {}
  console.warn('[CharacterWorkflow] Image attempt failed:', {
    runId: event.runId,
    artifactId: event.artifact.id,
    targetNodeId: data.targetNodeId,
    targetTitle: data.targetTitle,
    imageRole: data.imageRole,
    provider: model.provider,
    modelName: model.modelName,
    apiId: model.apiId,
    size: data.size,
    action: data.action,
    parentAttemptId: data.parentAttemptId,
    error: data.error || event.artifact.summary,
  })
}

export interface ChatSendMessageRequest extends ChatRuntimeTurnRequest {
  streamId?: string
}

export interface ChatSendMessageResult {
  success: boolean
  response?: string
  sceneUpdate?: Record<string, unknown>
  error?: string
}

export interface ChatRunCharacterWorkflowRequest {
  workflow: unknown
  language?: 'zh-CN' | 'en-US'
  streamId?: string
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
}

export interface ChatRunCharacterWorkflowResult {
  success: boolean
  runId?: string
  title?: string
  status?: 'done' | 'needs_action'
  artifacts?: Array<{
    id: string
    kind: string
    title: string
    summary: string
    sourceNodeId?: string
    data?: unknown
  }>
  error?: string
}

export interface ChatBuildCharacterWorkflowRequest {
  prompt: string
  streamId?: string
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
}

export interface ChatBuildCharacterWorkflowResult {
  success: boolean
  workflow?: Record<string, unknown>
  spec?: CharacterWorkflowBuilderSpec
  uiConfigOverrides?: Record<string, Record<string, unknown>>
  agentWork?: CharacterWorkflowEditorAgentWork
  error?: string
}

export interface ChatListModelsRequest {
  provider?: string
  modelType?: 'llm' | 'image'
  apiKey?: string
  baseUrl?: string
}

export interface ChatListModelsResult {
  success: boolean
  models?: string[]
  error?: string
}

function normalizeCharacterAgentSeedArtifacts(
  artifacts: NonNullable<ChatRunCharacterWorkflowRequest['scopedRun']>['seedArtifacts'] | undefined
): CharacterAgentArtifact[] {
  const now = Date.now()
  return (Array.isArray(artifacts) ? artifacts : [])
    .filter((artifact) => artifact && typeof artifact === 'object' && typeof artifact.type === 'string')
    .map((artifact, index) => ({
      id: artifact.id || `seed-artifact-${now}-${index}`,
      kind: artifact.type as CharacterAgentArtifact['kind'],
      runId: 'seed-run',
      candidateId: 'seed-candidate',
      sourceNodeId: artifact.sourceNodeId,
      title: artifact.title || artifact.type,
      summary: artifact.summary || '',
      data: artifact.data,
      version: 0,
      createdAt: now,
      updatedAt: now,
    }))
}

export interface ChatIpcMedia {
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

export interface ChatIpcMaterial {
  kind: 'image' | 'document'
  name: string
  mimeType: string
  dataUrl?: string
  text?: string
  size?: number
}

export interface ChatSelectMediaRequest {
  kind?: 'image' | 'video' | 'audio' | 'media'
}

export interface ChatSelectMediaResult {
  success: boolean
  canceled?: boolean
  media?: ChatIpcMedia[]
  error?: string
}

export interface ChatSelectMaterialsResult {
  success: boolean
  canceled?: boolean
  materials?: ChatIpcMaterial[]
  error?: string
}

export interface ChatCameraPermissionResult {
  success: boolean
  granted?: boolean
  status?: string
  openedSettings?: boolean
  error?: string
}

export interface ChatHistoryResult {
  success: boolean
  conversations?: StoredChatConversationListItem[]
  error?: string
}

export interface ChatHistoryGetResult {
  success: boolean
  conversation?: StoredChatConversation | null
  error?: string
}

export interface ChatHistoryGetRequest {
  includeWorkflowState?: boolean
}

export interface CharacterWorkflowProjectResult {
  success: boolean
  projects?: StoredCharacterWorkflowProject[]
  project?: StoredCharacterWorkflowProject | null
  error?: string
}

export function registerChatIpcHandlers(
  ipcMain: IpcMain,
  options: {
    getModelConfig(): ChatIpcModelConfig | null
    getTaskModelConfig?(): ChatIpcModelConfig | null
    getTaskModels?(): ChatIpcModelConfig[]
    getChatModels(): ChatIpcConfiguredModel[]
    getProxyUrl?(): string
    getMainWindow?(): BrowserWindow | null
    getChatHistoryStore(): ChatHistoryStore
    getCharacterWorkflowStore(): CharacterWorkflowStore
  }
): void {
  const createRuntime = (): ChatRuntime => new ChatRuntime({
    modelConfig: options.getModelConfig(),
    options: {
      defaultOptions: {
        max_tokens: 1024,
      },
      llmOptions: {
        proxyUrl: options.getProxyUrl?.(),
      },
    },
  })
  const chatMediaService = new ChatMediaService({
    getProxyUrl: () => options.getProxyUrl?.(),
  })

  ipcMain.handle('chat:sendMessage', async (_, request: ChatSendMessageRequest): Promise<ChatSendMessageResult> => {
    try {
      const result = await collectChatRuntimeResult(createRuntime().runTurnEvents({ ...request, stream: false }))

      return {
        success: true,
        response: result.response,
        sceneUpdate: result.sceneUpdate,
      }
    } catch (error: any) {
      console.error('[Chat] Failed to send message:', error)
      return {
        success: false,
        error: normalizeChatRuntimeError(error),
      }
    }
  })

  ipcMain.handle('chat:generateImageMedia', async (_, request: ChatGenerateImageMediaRequest): Promise<ChatGenerateMediaResult> => {
    try {
      if (!request.promptContext) {
        throw new Error('Chat image prompt context is required')
      }
      const directedPrompt = await directChatImagePrompt(
        request.promptContext,
        async (directorRequest) => {
          try {
            const modelConfig = options.getModelConfig()
            console.info('[ChatMedia] Directing image prompt with chat LLM:', {
              provider: modelConfig?.provider,
              modelName: modelConfig?.modelName,
            })
            const response = await sendChatTurnWithConfiguredModel(modelConfig, {
              input: directorRequest.userPrompt,
              options: normalizeImagePromptDirectorChatOptions(directorRequest.options),
            }, {
              systemPrompt: directorRequest.systemPrompt,
              outputConstraintPrompt: '',
              defaultOptions: {
                max_tokens: 520,
              },
              llmOptions: {
                proxyUrl: options.getProxyUrl?.(),
              },
            })
            return response.content
          } catch (error: any) {
            console.error('[ChatMedia] Image prompt director failed:', error)
            throw new Error(`Image prompt director failed before image generation: ${error?.message || String(error)}`)
          }
        }
      )
      console.info('[ChatMedia] Directed image prompt:', {
        provider: request.model.provider,
        modelName: request.modelName || request.model.modelName,
        prompt: directedPrompt.prompt.slice(0, 500),
      })
      const result = await chatMediaService.generateImage({
        ...request,
        prompt: directedPrompt.prompt,
      })
      const media = result.media as ChatIpcMedia
      media.metadata = {
        ...(media.metadata ?? {}),
        promptDirector: {
          sourcePrompt: directedPrompt.sourcePrompt,
          rawResponse: directedPrompt.rawResponse,
          visualIntent: request.prompt,
        },
      }
      return {
        success: true,
        provider: result.provider,
        model: result.model,
        media,
      }
    } catch (error: any) {
      console.error('[ChatMedia] Failed to generate image:', error)
      return { success: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('chat:synthesizeAudioMedia', async (_, request: ChatSynthesizeAudioMediaRequest): Promise<ChatGenerateMediaResult> => {
    try {
      const result = await chatMediaService.synthesizeAudio(request)
      return {
        success: true,
        provider: result.provider,
        model: result.model,
        media: result.media as ChatIpcMedia,
      }
    } catch (error: any) {
      console.error('[ChatMedia] Failed to synthesize audio:', error)
      return { success: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('chat:runCharacterWorkflow', async (event, request: ChatRunCharacterWorkflowRequest): Promise<ChatRunCharacterWorkflowResult> => {
    try {
      const snapshot = loadCharacterAgentWorkflowSnapshot(request.workflow)
      const blockingIssue = snapshot.issues.find((issue) => issue.severity === 'error')
      if (blockingIssue) {
        throw new Error(blockingIssue.message)
      }
      const configuredModels = getCharacterWorkflowConfiguredModels(options)
      const modelResolver = createStaticCharacterAgentModelResolver(createCharacterAgentModelConfigs(configuredModels))
      const seedArtifacts = normalizeCharacterAgentSeedArtifacts(request.scopedRun?.seedArtifacts)
      const artifacts = createInMemoryCharacterArtifactStore(seedArtifacts)
      const tools = createConfiguredCharacterAgentToolRuntime(configuredModels, { proxyUrl: options.getProxyUrl?.() })
      const agent = createCharacterSuperAgent({
        tools,
        artifacts,
        modelResolver,
        onEvent: (agentEvent: CharacterAgentEvent) => {
          logCharacterWorkflowImageAttemptFailure(agentEvent)
          if (request.streamId) {
            event.sender.send('chat:characterWorkflowEvent', { streamId: request.streamId, event: agentEvent })
          }
        },
      })
      const scopedRun: CharacterAgentScopedRun | undefined = request.scopedRun
        ? {
            mode: 'scoped-run',
            instruction: request.scopedRun.instruction,
            action: request.scopedRun.action,
            scope: request.scopedRun.scope,
            seedArtifacts,
          }
        : undefined
      const state = await agent.run(snapshot.workflow, scopedRun ? { scopedRun } : undefined)
      if (state.phase === 'failed') {
        const failed = state.events.find((event) => event.type === 'run.failed')
        throw new Error(failed && 'error' in failed ? failed.error : 'Character agent failed')
      }
      return {
        success: true,
        runId: state.runId,
        title: state.finalReport?.summary ?? `${snapshot.workflow.name}.run`,
        status: state.phase === 'needs_action' ? 'needs_action' : 'done',
        artifacts: state.artifacts.map((artifact) => ({
          id: artifact.id,
          kind: artifact.kind,
          title: artifact.title,
          summary: artifact.summary,
          sourceNodeId: artifact.sourceNodeId,
          data: artifact.data,
        })),
      }
    } catch (error: any) {
      console.error('[Chat] Failed to run character workflow:', error)
      return {
        success: false,
        error: normalizeChatRuntimeError(error),
      }
    }
  })

  ipcMain.handle('chat:buildCharacterWorkflow', async (event, request: ChatBuildCharacterWorkflowRequest): Promise<ChatBuildCharacterWorkflowResult> => {
    try {
      const configuredModels = getCharacterWorkflowConfiguredModels(options)
      const workflowModelConfig = options.getTaskModelConfig?.() ?? options.getModelConfig()
      const firstImageModel = configuredModels.find((model) => model.modelType === 'image')
      const workflowModelName = getWorkflowModelNameForRef(workflowModelConfig)
      const result = await buildCharacterWorkflowFromPrompt({
        prompt: request.prompt,
        language: request.language,
        mode: request.mode,
        graph: request.graph,
        editorSession: request.editorSession,
        modelConfig: workflowModelConfig,
        llmApiId: workflowModelConfig?.id ?? workflowModelConfig?.provider,
        llmModelName: workflowModelName,
        imageApiId: firstImageModel?.id,
        imageModelName: firstImageModel?.modelName,
        onEvent: request.streamId
          ? (builderEvent: CharacterWorkflowBuilderEvent) => {
              event.sender.send('chat:characterWorkflowBuildEvent', {
                streamId: request.streamId,
                event: builderEvent,
              })
            }
          : undefined,
      })
      return {
        success: true,
        workflow: result.workflow as unknown as Record<string, unknown>,
        spec: result.spec,
        uiConfigOverrides: result.uiConfigOverrides,
        agentWork: result.agentWork,
      }
    } catch (error: any) {
      console.error('[Chat] Failed to build character workflow:', error)
      return {
        success: false,
        error: normalizeChatRuntimeError(error),
      }
    }
  })

  ipcMain.handle('chat:streamMessage', async (event, request: ChatSendMessageRequest): Promise<ChatSendMessageResult> => {
    const streamId = typeof request?.streamId === 'string' ? request.streamId : ''
    try {
      let result = {
        response: '',
        sceneUpdate: undefined as Record<string, unknown> | undefined,
      }
      for await (const runtimeEvent of createRuntime().runTurnEvents({ ...request, stream: true })) {
        if (runtimeEvent.type === 'message.delta') {
          if (streamId) {
            event.sender.send('chat:streamDelta', { streamId, delta: runtimeEvent.delta })
          }
        } else if (runtimeEvent.type === 'message.completed') {
          result.response = runtimeEvent.content
        } else if (runtimeEvent.type === 'scene.updated') {
          result.sceneUpdate = runtimeEvent.patch
        }
      }

      return {
        success: true,
        response: result.response,
        sceneUpdate: result.sceneUpdate,
      }
    } catch (error: any) {
      console.error('[Chat] Failed to stream message:', error)
      return {
        success: false,
        error: normalizeChatRuntimeError(error),
      }
    }
  })

  ipcMain.handle('chat:listModels', async (_, request: ChatListModelsRequest): Promise<ChatListModelsResult> => {
    try {
      const models = await listChatModelsWithProvider(request, {
        proxyUrl: options.getProxyUrl?.(),
      })
      return {
        success: true,
        models,
      }
    } catch (error: any) {
      console.error('[Chat] Failed to list models:', error)
      return {
        success: false,
        error: error?.message || String(error),
      }
    }
  })

  ipcMain.handle('chat:selectMedia', async (_, request: ChatSelectMediaRequest): Promise<ChatSelectMediaResult> => {
    try {
      const dialogOptions: OpenDialogOptions = {
        title: 'Select media',
        properties: ['openFile', 'multiSelections'],
        filters: [{
          name: 'Media',
          extensions: mediaExtensionsForKind(request?.kind),
        }],
      }
      const owner = options.getMainWindow?.()
      const result = owner
        ? await dialog.showOpenDialog(owner, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)
      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, canceled: true, media: [] }
      }
      const media = await Promise.all(result.filePaths.map(readMediaFile))
      return {
        success: true,
        media: media.filter(Boolean) as ChatIpcMedia[],
      }
    } catch (error: any) {
      console.error('[Chat] Failed to select media:', error)
      return {
        success: false,
        error: error?.message || String(error),
      }
    }
  })

  ipcMain.handle('chat:selectMaterials', async (): Promise<ChatSelectMaterialsResult> => {
    try {
      const dialogOptions: OpenDialogOptions = {
        title: 'Select materials',
        properties: ['openFile', 'multiSelections'],
        filters: [{
          name: 'Images and documents',
          extensions: materialFileExtensions(),
        }],
      }
      const owner = options.getMainWindow?.()
      const result = owner
        ? await dialog.showOpenDialog(owner, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)
      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, canceled: true, materials: [] }
      }
      const materials = await Promise.all(result.filePaths.map(readMaterialFile))
      return {
        success: true,
        materials: materials.filter(Boolean) as ChatIpcMaterial[],
      }
    } catch (error: any) {
      console.error('[Chat] Failed to select materials:', error)
      return {
        success: false,
        error: error?.message || String(error),
      }
    }
  })

  ipcMain.handle('chat:requestCameraPermission', async (): Promise<ChatCameraPermissionResult> => {
    if (process.platform !== 'darwin') {
      return { success: true, granted: true, status: 'granted' }
    }

    try {
      const currentStatus = systemPreferences.getMediaAccessStatus('camera')
      if (currentStatus === 'granted') {
        return { success: true, granted: true, status: currentStatus }
      }
      if (currentStatus === 'denied' || currentStatus === 'restricted') {
        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Camera')
        return { success: true, granted: false, status: currentStatus, openedSettings: true }
      }
      const granted = await systemPreferences.askForMediaAccess('camera')
      return {
        success: true,
        granted,
        status: systemPreferences.getMediaAccessStatus('camera'),
      }
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('chat-history:list', async (): Promise<ChatHistoryResult> => {
    try {
      const conversations = await options.getChatHistoryStore().listConversations()
      return { success: true, conversations }
    } catch (error: any) {
      console.error('[ChatHistory] Failed to list conversations:', error)
      return { success: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('chat-history:get', async (_, id: string, request?: ChatHistoryGetRequest): Promise<ChatHistoryGetResult> => {
    try {
      const conversation = await options.getChatHistoryStore().getConversation(String(id || ''), {
        includeWorkflowState: Boolean(request?.includeWorkflowState),
      })
      return { success: true, conversation }
    } catch (error: any) {
      console.error('[ChatHistory] Failed to get conversation:', error)
      return { success: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('chat-history:upsert', async (_, conversation: StoredChatConversation): Promise<{ success: boolean; error?: string }> => {
    try {
      await options.getChatHistoryStore().upsertConversation(conversation)
      return { success: true }
    } catch (error: any) {
      console.error('[ChatHistory] Failed to save conversation:', error)
      return { success: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('chat-history:delete', async (_, id: string): Promise<{ success: boolean; error?: string }> => {
    try {
      await options.getChatHistoryStore().deleteConversation(String(id || ''))
      return { success: true }
    } catch (error: any) {
      console.error('[ChatHistory] Failed to delete conversation:', error)
      return { success: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('chat-history:clear', async (): Promise<{ success: boolean; error?: string }> => {
    try {
      await options.getChatHistoryStore().clearConversations()
      return { success: true }
    } catch (error: any) {
      console.error('[ChatHistory] Failed to clear conversations:', error)
      return { success: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('character-workflows:list', async (): Promise<CharacterWorkflowProjectResult> => {
    try {
      const projects = await options.getCharacterWorkflowStore().listProjects()
      return { success: true, projects }
    } catch (error: any) {
      console.error('[CharacterWorkflowStore] Failed to list projects:', error)
      return { success: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('character-workflows:get', async (_, id: string): Promise<CharacterWorkflowProjectResult> => {
    try {
      const project = await options.getCharacterWorkflowStore().getProject(String(id || ''))
      return { success: true, project }
    } catch (error: any) {
      console.error('[CharacterWorkflowStore] Failed to get project:', error)
      return { success: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('character-workflows:getOverview', async (_, id: string): Promise<CharacterWorkflowProjectResult> => {
    try {
      const project = await options.getCharacterWorkflowStore().getProjectOverview(String(id || ''))
      return { success: true, project }
    } catch (error: any) {
      console.error('[CharacterWorkflowStore] Failed to get project overview:', error)
      return { success: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('character-workflows:getRun', async (_, request: { projectId?: string; runId?: string }): Promise<{ success: boolean; run?: unknown; error?: string }> => {
    try {
      const run = await options.getCharacterWorkflowStore().getProjectRun(String(request?.projectId || ''), String(request?.runId || ''))
      return { success: true, run }
    } catch (error: any) {
      console.error('[CharacterWorkflowStore] Failed to get workflow run:', error)
      return { success: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('character-workflows:deleteRun', async (_, request: { projectId?: string; runId?: string }): Promise<{ success: boolean; error?: string }> => {
    try {
      await options.getCharacterWorkflowStore().deleteProjectRun(String(request?.projectId || ''), String(request?.runId || ''))
      return { success: true }
    } catch (error: any) {
      console.error('[CharacterWorkflowStore] Failed to delete workflow run:', error)
      return { success: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('character-workflows:upsert', async (_, project: StoredCharacterWorkflowProject): Promise<{ success: boolean; error?: string }> => {
    try {
      await options.getCharacterWorkflowStore().upsertProject(project)
      return { success: true }
    } catch (error: any) {
      console.error('[CharacterWorkflowStore] Failed to save project:', error)
      return { success: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('character-workflows:delete', async (_, id: string): Promise<{ success: boolean; error?: string }> => {
    try {
      await options.getCharacterWorkflowStore().deleteProject(String(id || ''))
      return { success: true }
    } catch (error: any) {
      console.error('[CharacterWorkflowStore] Failed to delete project:', error)
      return { success: false, error: error?.message || String(error) }
    }
  })
}

function getCharacterWorkflowConfiguredModels(options: {
  getModelConfig(): ChatIpcModelConfig | null
  getTaskModelConfig?(): ChatIpcModelConfig | null
  getTaskModels?(): ChatIpcModelConfig[]
  getChatModels(): ChatIpcConfiguredModel[]
}): ChatIpcConfiguredModel[] {
  const taskModels = options.getTaskModels?.() ?? []
  const activeTask = options.getTaskModelConfig?.()
  const taskEntries = [
    ...taskModels,
    ...(activeTask ? [activeTask] : []),
  ]
  const seenTaskKeys = new Set<string>()
  const llmModels = taskEntries.flatMap((model, index): ChatIpcConfiguredModel[] => {
    const key = [
      model.provider ?? '',
      getModelTransport(model),
      model.modelName ?? '',
      model.baseUrl ?? '',
    ].join('\u0000')
    if (seenTaskKeys.has(key)) {
      return []
    }
    seenTaskKeys.add(key)
    return [{
      id: `task-workflow-${index}`,
      ...(model.id ? { id: model.id } : {}),
      modelType: 'llm',
      provider: model.provider,
      transport: getModelTransport(model),
      modelName: model.modelName,
      enabledModels: getWorkflowEnabledModels(model),
      apiKey: model.apiKey,
      baseUrl: model.baseUrl ?? '',
    }]
  })
  const imageModels = options.getChatModels().flatMap((model): ChatIpcConfiguredModel[] => {
    if (model.modelType !== 'image') {
      return []
    }
    const enabledModels = filterEditCapableImageModelNames(
      model.provider,
      model.enabledModels?.length ? model.enabledModels : [model.modelName]
    )
    const modelName = isImageModelEditCapable(model.provider, model.modelName)
      ? model.modelName
      : enabledModels[0] ?? ''
    return enabledModels.length
      ? [{
          ...model,
          modelName,
          enabledModels,
        }]
      : []
  })
  const fallbackChatLLMs = llmModels.length
    ? []
    : options.getChatModels().filter((model) => model.modelType === 'llm')
  return [...llmModels, ...fallbackChatLLMs, ...imageModels]
}

function getWorkflowEnabledModels(model: ChatIpcModelConfig): string[] {
  const modelName = isLocalCLIModel(model) ? '' : String(model.modelName || '').trim()
  if (modelName) {
    return [modelName]
  }
  return isLocalCLIModel(model) ? [LOCAL_CLI_DEFAULT_MODEL_REF] : []
}

function getWorkflowModelNameForRef(model: ChatIpcModelConfig | null | undefined): string | undefined {
  const modelName = model && !isLocalCLIModel(model) ? String(model.modelName || '').trim() : ''
  if (modelName) {
    return modelName
  }
  return model && isLocalCLIModel(model) ? LOCAL_CLI_DEFAULT_MODEL_REF : undefined
}

function isLocalCLIModel(model: ChatIpcModelConfig): boolean {
  return isLocalCLITransport(getModelTransport(model))
}

function getModelTransport(model: ChatIpcModelConfig | null | undefined): NonNullable<ChatIpcModelConfig['transport']> {
  if (model?.transport === 'codex_local' || model?.transport === 'claude_code_local') {
    return model.transport
  }
  if (model?.provider === 'codex') {
    return 'codex_local'
  }
  if (model?.provider === 'claude-code') {
    return 'claude_code_local'
  }
  return 'openai_compatible'
}

function isLocalCLITransport(transport: ChatIpcModelConfig['transport'] | undefined): boolean {
  return transport === 'codex_local' || transport === 'claude_code_local'
}

async function collectChatRuntimeResult(events: AsyncGenerator<ChatRuntimeEvent>): Promise<{
  response: string
  sceneUpdate?: Record<string, unknown>
}> {
  const result: {
    response: string
    sceneUpdate?: Record<string, unknown>
  } = {
    response: '',
  }
  for await (const runtimeEvent of events) {
    if (runtimeEvent.type === 'message.completed') {
      result.response = runtimeEvent.content
    } else if (runtimeEvent.type === 'scene.updated') {
      result.sceneUpdate = runtimeEvent.patch
    }
  }
  return result
}

function mediaExtensionsForKind(kind: ChatSelectMediaRequest['kind']): string[] {
  if (kind === 'image') {
    return ['png', 'jpg', 'jpeg', 'webp', 'gif']
  }
  if (kind === 'video') {
    return ['mp4', 'mov', 'm4v', 'webm']
  }
  if (kind === 'audio') {
    return ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac']
  }
  return ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'mov', 'm4v', 'webm', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac']
}

function materialFileExtensions(): string[] {
  return [
    'png', 'jpg', 'jpeg', 'webp', 'gif',
    'txt', 'md', 'markdown', 'json', 'csv', 'tsv',
    'pdf', 'doc', 'docx', 'rtf',
  ]
}

async function readMediaFile(filePath: string): Promise<ChatIpcMedia | null> {
  const mimeType = mimeForPath(filePath)
  if (!mimeType) {
    return null
  }
  const bytes = await readFile(filePath)
  return {
    kind: mediaKindForMimeType(mimeType),
    name: basename(filePath),
    mimeType,
    size: bytes.byteLength,
    dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
    origin: 'user',
    dispatch: { trigger: 'manual', mode: 'turn', probability: 1 },
    context: { mode: mimeType.startsWith('audio/') ? 'text' : 'auto' },
  }
}

function mediaKindForMimeType(mimeType: string): ChatIpcMedia['kind'] {
  if (mimeType.startsWith('video/')) {
    return 'video'
  }
  if (mimeType.startsWith('audio/')) {
    return 'audio'
  }
  return 'image'
}

async function readMaterialFile(filePath: string): Promise<ChatIpcMaterial | null> {
  const mimeType = mimeForPath(filePath) ?? documentMimeForPath(filePath)
  if (!mimeType) {
    return null
  }
  const bytes = await readFile(filePath)
  const name = basename(filePath)
  if (mimeType.startsWith('image/')) {
    return {
      kind: 'image',
      name,
      mimeType,
      size: bytes.byteLength,
      dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
    }
  }
  return {
    kind: 'document',
    name,
    mimeType,
    size: bytes.byteLength,
    text: isTextDocumentMime(mimeType) ? bytes.toString('utf8').slice(0, 24000) : undefined,
  }
}

function mimeForPath(filePath: string): string | null {
  switch (extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.mp4':
    case '.m4v':
      return 'video/mp4'
    case '.mov':
      return 'video/quicktime'
    case '.webm':
      return 'video/webm'
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    case '.m4a':
      return 'audio/mp4'
    case '.aac':
      return 'audio/aac'
    case '.ogg':
      return 'audio/ogg'
    case '.opus':
      return 'audio/opus'
    case '.flac':
      return 'audio/flac'
    default:
      return null
  }
}

function documentMimeForPath(filePath: string): string | null {
  switch (extname(filePath).toLowerCase()) {
    case '.txt':
      return 'text/plain'
    case '.md':
    case '.markdown':
      return 'text/markdown'
    case '.json':
      return 'application/json'
    case '.csv':
      return 'text/csv'
    case '.tsv':
      return 'text/tab-separated-values'
    case '.pdf':
      return 'application/pdf'
    case '.doc':
      return 'application/msword'
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case '.rtf':
      return 'application/rtf'
    default:
      return null
  }
}

function isTextDocumentMime(mimeType: string): boolean {
  return mimeType.startsWith('text/')
    || mimeType === 'application/json'
}
