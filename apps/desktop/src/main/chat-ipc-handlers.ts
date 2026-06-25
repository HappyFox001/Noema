/**
 * IPC handlers for the standalone text chat surface.
 */
import { type IpcMain } from 'electron'
import { dialog, systemPreferences, shell, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { readFile } from 'fs/promises'
import { basename, extname } from 'path'
import { listChatModelsWithProvider } from '@noema/sdk/chat/model-list'
import {
  ChatRuntime,
  normalizeChatRuntimeError,
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
  editCharacterWorkflowRunDraft,
  loadCharacterAgentWorkflowSnapshot,
  type CharacterAgentArtifact,
  type CharacterAgentScopedRun,
  type CharacterWorkflowBuilderEvent,
  type CharacterWorkflowEditorAgentWork,
  type CharacterWorkflowBuilderSpec,
} from '@noema/sdk/character-workflow'
import { ChatHistoryStore, type StoredChatConversation, type StoredChatConversationListItem } from './chat-history-store.js'
import { CharacterWorkflowStore, type StoredCharacterWorkflowProject } from './character-workflow-store.js'

export interface ChatIpcModelConfig {
  provider?: string
  modelName: string
  apiKey: string
  baseUrl?: string
}

export interface ChatIpcConfiguredModel {
  id: string
  modelType: 'llm' | 'image'
  provider?: string
  modelName: string
  enabledModels?: string[]
  apiKey: string
  baseUrl: string
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
    history?: Array<{
      userRequest?: string
      summary?: string
      status?: string
      operations?: number
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

export interface ChatEditCharacterWorkflowRunDraftRequest {
  prompt: string
  language?: 'zh-CN' | 'en-US'
  runTitle?: string
  artifacts: Array<{
    id?: string
    type: string
    sourceNodeId?: string
    title?: string
    summary?: string
    data?: unknown
  }>
}

export interface ChatEditCharacterWorkflowRunDraftResult {
  success: boolean
  summary?: string
  artifacts?: Array<{
    id?: string
    type: string
    sourceNodeId?: string
    title?: string
    summary?: string
    data?: unknown
  }>
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

export interface ChatIpcAttachment {
  kind: 'image' | 'video'
  name: string
  mimeType: string
  dataUrl?: string
  size?: number
}

export interface ChatSelectMediaRequest {
  kind?: 'image' | 'video' | 'media'
}

export interface ChatSelectMediaResult {
  success: boolean
  canceled?: boolean
  attachments?: ChatIpcAttachment[]
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

  ipcMain.handle('chat:runCharacterWorkflow', async (event, request: ChatRunCharacterWorkflowRequest): Promise<ChatRunCharacterWorkflowResult> => {
    try {
      const snapshot = loadCharacterAgentWorkflowSnapshot(request.workflow)
      const blockingIssue = snapshot.issues.find((issue) => issue.severity === 'error')
      if (blockingIssue) {
        throw new Error(blockingIssue.message)
      }
      const configuredModels = options.getChatModels()
      const modelResolver = createStaticCharacterAgentModelResolver(createCharacterAgentModelConfigs(configuredModels))
      const seedArtifacts = normalizeCharacterAgentSeedArtifacts(request.scopedRun?.seedArtifacts)
      const artifacts = createInMemoryCharacterArtifactStore(seedArtifacts)
      const tools = createConfiguredCharacterAgentToolRuntime(configuredModels, { proxyUrl: options.getProxyUrl?.() })
      const agent = createCharacterSuperAgent({
        tools,
        artifacts,
        modelResolver,
        onEvent: (agentEvent: CharacterAgentEvent) => {
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
      const configuredModels = options.getChatModels()
      const firstImageModel = configuredModels.find((model) => model.modelType === 'image')
      const result = await buildCharacterWorkflowFromPrompt({
        prompt: request.prompt,
        language: request.language,
        mode: request.mode,
        graph: request.graph,
        editorSession: request.editorSession,
        modelConfig: options.getModelConfig(),
        llmApiId: options.getModelConfig()?.provider,
        llmModelName: options.getModelConfig()?.modelName,
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

  ipcMain.handle('chat:editCharacterWorkflowRunDraft', async (_, request: ChatEditCharacterWorkflowRunDraftRequest): Promise<ChatEditCharacterWorkflowRunDraftResult> => {
    try {
      const result = await editCharacterWorkflowRunDraft({
        prompt: request.prompt,
        language: request.language,
        runTitle: request.runTitle,
        artifacts: request.artifacts,
        modelConfig: options.getModelConfig(),
      })
      return {
        success: true,
        summary: result.summary,
        artifacts: result.artifacts,
      }
    } catch (error: any) {
      console.error('[Chat] Failed to edit character workflow run draft:', error)
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
          name: 'Images and videos',
          extensions: mediaExtensionsForKind(request?.kind),
        }],
      }
      const owner = options.getMainWindow?.()
      const result = owner
        ? await dialog.showOpenDialog(owner, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)
      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, canceled: true, attachments: [] }
      }
      const attachments = await Promise.all(result.filePaths.map(readMediaAttachment))
      return {
        success: true,
        attachments: attachments.filter(Boolean) as ChatIpcAttachment[],
      }
    } catch (error: any) {
      console.error('[Chat] Failed to select media:', error)
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
  return ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'mov', 'm4v', 'webm']
}

async function readMediaAttachment(filePath: string): Promise<ChatIpcAttachment | null> {
  const mimeType = mimeForPath(filePath)
  if (!mimeType) {
    return null
  }
  const bytes = await readFile(filePath)
  return {
    kind: mimeType.startsWith('video/') ? 'video' : 'image',
    name: basename(filePath),
    mimeType,
    size: bytes.byteLength,
    dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
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
    default:
      return null
  }
}
