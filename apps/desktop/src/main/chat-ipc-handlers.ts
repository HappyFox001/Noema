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
  type ChatRuntimeTurnRequest,
} from '@noema/sdk/chat/request-runtime'
import {
  createCharacterAgentModelConfigs,
  createConfiguredCharacterAgentToolRuntime,
  createCharacterSuperAgent,
  createInMemoryCharacterArtifactStore,
  createStaticCharacterAgentModelResolver,
  loadCharacterAgentWorkflowSnapshot,
} from '@noema/sdk/character-workflow'
import { ChatHistoryStore, type StoredChatConversation } from './chat-history-store.js'

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
  error?: string
}

export interface ChatRunCharacterWorkflowRequest {
  workflow: unknown
  language?: 'zh-CN' | 'en-US'
}

export interface ChatRunCharacterWorkflowResult {
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
}

export interface ChatListModelsRequest {
  provider?: string
  apiKey?: string
  baseUrl?: string
}

export interface ChatListModelsResult {
  success: boolean
  models?: string[]
  error?: string
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
  conversations?: StoredChatConversation[]
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
      const response = await createRuntime().sendTurn(request)

      return {
        success: true,
        response: response.content,
      }
    } catch (error: any) {
      console.error('[Chat] Failed to send message:', error)
      return {
        success: false,
        error: normalizeChatRuntimeError(error),
      }
    }
  })

  ipcMain.handle('chat:runCharacterWorkflow', async (_, request: ChatRunCharacterWorkflowRequest): Promise<ChatRunCharacterWorkflowResult> => {
    try {
      const snapshot = loadCharacterAgentWorkflowSnapshot(request.workflow)
      const blockingIssue = snapshot.issues.find((issue) => issue.severity === 'error')
      if (blockingIssue) {
        throw new Error(blockingIssue.message)
      }
      const configuredModels = options.getChatModels()
      const modelResolver = createStaticCharacterAgentModelResolver(createCharacterAgentModelConfigs(configuredModels))
      const artifacts = createInMemoryCharacterArtifactStore()
      const tools = createConfiguredCharacterAgentToolRuntime(configuredModels, { proxyUrl: options.getProxyUrl?.() })
      const agent = createCharacterSuperAgent({
        tools,
        artifacts,
        modelResolver,
      })
      const state = await agent.run(snapshot.workflow)
      if (state.phase === 'failed') {
        const failed = state.events.find((event) => event.type === 'run.failed')
        throw new Error(failed && 'error' in failed ? failed.error : 'Character agent failed')
      }
      return {
        success: true,
        runId: state.runId,
        title: state.finalReport?.summary ?? `${snapshot.workflow.name}.run`,
        artifacts: state.artifacts.map((artifact) => ({
          id: artifact.id,
          kind: artifact.kind,
          title: artifact.title,
          summary: artifact.summary,
          sourceNodeId: artifact.sourceNodeId,
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

  ipcMain.handle('chat:streamMessage', async (event, request: ChatSendMessageRequest): Promise<ChatSendMessageResult> => {
    const streamId = typeof request?.streamId === 'string' ? request.streamId : ''
    try {
      let response = ''
      for await (const runtimeEvent of createRuntime().runTurnEvents({ ...request, stream: true })) {
        if (runtimeEvent.type === 'message.delta') {
          response += runtimeEvent.delta
          if (streamId) {
            event.sender.send('chat:streamDelta', { streamId, delta: runtimeEvent.delta })
          }
        } else if (runtimeEvent.type === 'message.completed') {
          response = runtimeEvent.content
        }
      }

      return {
        success: true,
        response,
      }
    } catch (error: any) {
      console.error('[Chat] Failed to stream message:', error)
      return {
        success: false,
        error: error?.message || String(error),
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
