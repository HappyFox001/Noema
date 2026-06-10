/**
 * IPC handlers for the standalone text chat surface.
 */
import { type IpcMain } from 'electron'
import { dialog, systemPreferences, shell, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { readFile } from 'fs/promises'
import { basename, extname } from 'path'
import { createChatSessionFromModel, type ChatCharacterContext, type ChatMessage, type ChatModelConfig } from '@noema/sdk'
import { ChatHistoryStore, type StoredChatConversation } from './chat-history-store.js'

export interface ChatIpcModelConfig {
  provider?: string
  modelName: string
  apiKey: string
  baseUrl?: string
}

export interface ChatSendMessageRequest {
  input: string
  streamId?: string
  language?: string
  preferencePrompt?: string
  options?: Record<string, unknown>
  messages?: ChatMessage[]
  attachments?: ChatIpcAttachment[]
  character?: ChatCharacterContext
}

export interface ChatSendMessageResult {
  success: boolean
  response?: string
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
    getMainWindow?(): BrowserWindow | null
    getChatHistoryStore(): ChatHistoryStore
  }
): void {
  ipcMain.handle('chat:sendMessage', async (_, request: ChatSendMessageRequest): Promise<ChatSendMessageResult> => {
    try {
      const input = typeof request?.input === 'string' ? request.input.trim() : ''
      if (!input) {
        throw new Error('Message is empty')
      }

      const model = toChatModelConfig(options.getModelConfig())
      const session = createChatSessionFromModel(model, {
        defaultOptions: {
          max_tokens: 1024,
        },
      })
      const response = await session.send({
        input,
        language: request.language,
        messages: normalizeMessages(request.messages),
        attachments: normalizeAttachments(request.attachments),
        character: request.character,
        preferencePrompt: normalizePreferencePrompt(request.preferencePrompt),
        options: normalizeChatRequestOptions(request.options),
      })

      return {
        success: true,
        response: response.content,
      }
    } catch (error: any) {
      console.error('[Chat] Failed to send message:', error)
      return {
        success: false,
        error: error?.message || String(error),
      }
    }
  })

  ipcMain.handle('chat:streamMessage', async (event, request: ChatSendMessageRequest): Promise<ChatSendMessageResult> => {
    const streamId = typeof request?.streamId === 'string' ? request.streamId : ''
    try {
      const input = typeof request?.input === 'string' ? request.input.trim() : ''
      if (!input) {
        throw new Error('Message is empty')
      }

      const model = toChatModelConfig(options.getModelConfig())
      const session = createChatSessionFromModel(model, {
        defaultOptions: {
          max_tokens: 1024,
        },
      })
      const turnRequest = {
        input,
        language: request.language,
        messages: normalizeMessages(request.messages),
        attachments: normalizeAttachments(request.attachments),
        character: request.character,
        preferencePrompt: normalizePreferencePrompt(request.preferencePrompt),
        options: normalizeChatRequestOptions(request.options),
      }
      const chunks: string[] = []
      for await (const delta of session.stream(turnRequest)) {
        chunks.push(delta)
        if (streamId) {
          event.sender.send('chat:streamDelta', { streamId, delta })
        }
      }

      return {
        success: true,
        response: chunks.join(''),
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
      const baseUrl = typeof request?.baseUrl === 'string' ? request.baseUrl.trim() : ''
      if (!baseUrl) {
        throw new Error('Base URL is empty')
      }
      const url = `${baseUrl.replace(/\/+$/, '')}/models`
      const response = await fetch(url, {
        headers: buildModelsRequestHeaders(request),
      })
      const text = await response.text()
      const body = parseJson(text)
      if (!response.ok) {
        throw new Error(readModelListError(body, text, response.status))
      }
      return {
        success: true,
        models: normalizeModelNames(body),
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

function toChatModelConfig(config: ChatIpcModelConfig | null): ChatModelConfig {
  if (!config) {
    throw new Error('Chat model is not configured')
  }
  const model = config.modelName?.trim()
  if (!model) {
    throw new Error('Chat model name is empty')
  }
  return {
    provider: config.provider,
    apiKey: config.apiKey || '',
    model,
    baseURL: config.baseUrl?.trim() || undefined,
  }
}

function buildModelsRequestHeaders(request: ChatListModelsRequest): Record<string, string> {
  const provider = String(request?.provider || '').toLowerCase()
  const apiKey = typeof request?.apiKey === 'string' ? request.apiKey.trim() : ''
  if (provider === 'claude' || provider === 'anthropic') {
    return {
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
      'anthropic-version': '2023-06-01',
    }
  }
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

function normalizePreferencePrompt(prompt: string | undefined): string | undefined {
  const normalized = typeof prompt === 'string' ? prompt.trim() : ''
  return normalized || undefined
}

function normalizeChatRequestOptions(options: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!options || typeof options !== 'object') {
    return undefined
  }
  const normalized: Record<string, unknown> = {}
  const temperature = normalizeNumberOption(options.temperature, 0, 2)
  const topP = normalizeNumberOption(options.top_p, 0, 1)
  const maxTokens = normalizeIntegerOption(options.max_tokens, 1, 5000)
  if (temperature !== undefined) {
    normalized.temperature = temperature
  }
  if (topP !== undefined) {
    normalized.top_p = topP
  }
  if (maxTokens !== undefined) {
    normalized.max_tokens = maxTokens
  }
  return Object.keys(normalized).length ? normalized : undefined
}

function normalizeNumberOption(value: unknown, min: number, max: number): number | undefined {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) {
    return undefined
  }
  return Math.min(max, Math.max(min, number))
}

function normalizeIntegerOption(value: unknown, min: number, max: number): number | undefined {
  const number = normalizeNumberOption(value, min, max)
  return number === undefined ? undefined : Math.round(number)
}

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return {}
  }
}

function readModelListError(body: unknown, text: string, status: number): string {
  const source = body && typeof body === 'object' ? body as Record<string, any> : {}
  const message = source.error?.message || source.message || text.trim()
  return message || `Models request failed with HTTP ${status}`
}

function normalizeModelNames(body: unknown): string[] {
  const source = body && typeof body === 'object' ? body as Record<string, any> : {}
  const items = Array.isArray(source.data)
    ? source.data
    : Array.isArray(source.models)
      ? source.models
      : []
  const names = items
    .map((item: any) => typeof item === 'string' ? item : item?.id || item?.name)
    .filter((name: unknown): name is string => typeof name === 'string' && name.trim().length > 0)
    .map((name) => name.trim())
  return [...new Set(names)].sort((a, b) => a.localeCompare(b))
}

function normalizeMessages(messages: ChatMessage[] | undefined): ChatMessage[] {
  if (!Array.isArray(messages)) {
    return []
  }
  return messages
    .map((message): ChatMessage => ({
      role: normalizeRole(message.role),
      content: String(message.content ?? '').trim(),
    }))
    .filter((message) => message.content)
}

function normalizeAttachments(attachments: ChatIpcAttachment[] | undefined): ChatIpcAttachment[] {
  if (!Array.isArray(attachments)) {
    return []
  }
  return attachments
    .map((attachment): ChatIpcAttachment => ({
      kind: attachment.kind === 'video' ? 'video' : 'image',
      name: String(attachment.name || 'attachment'),
      mimeType: String(attachment.mimeType || (attachment.kind === 'video' ? 'video/mp4' : 'image/png')),
      dataUrl: typeof attachment.dataUrl === 'string' ? attachment.dataUrl : undefined,
      size: typeof attachment.size === 'number' ? attachment.size : undefined,
    }))
    .filter((attachment) => Boolean(attachment.dataUrl))
}

function normalizeRole(role: ChatMessage['role']): ChatMessage['role'] {
  return role === 'assistant' || role === 'system' ? role : 'user'
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
