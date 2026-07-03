/**
 * IPC handlers for chat character resources stored under the role directory.
 */
import { ipcMain, protocol, type IpcMain } from 'electron'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { resolve } from 'path'
import {
  CHAT_ROLE_RESOURCE_PROTOCOL,
  deleteChatRoleResourceById,
  getChatRoleResourceDir,
  isPathInside,
  listChatRoleResources,
  mimeForPath,
} from './chat-role-resource-store.js'

protocol.registerSchemesAsPrivileged([{
  scheme: CHAT_ROLE_RESOURCE_PROTOCOL,
  privileges: {
    secure: true,
    standard: true,
    supportFetchAPI: true,
    corsEnabled: false,
  },
}])

export function registerChatRoleResourceIpcHandlers(ipc: IpcMain = ipcMain): void {
  ipc.handle('chat-role-resources:list', async () => {
    try {
      return {
        success: true,
        resources: await listChatRoleResources(),
      }
    } catch (error: any) {
      console.error('[ChatRoleResources] Failed to list resources:', error)
      return {
        success: false,
        error: error?.message || String(error),
      }
    }
  })

  ipc.handle('chat-role-resources:delete', async (_, id: string) => {
    try {
      return {
        success: true,
        deleted: await deleteChatRoleResourceById(String(id || '')),
      }
    } catch (error: any) {
      console.error('[ChatRoleResources] Failed to delete resource:', error)
      return {
        success: false,
        error: error?.message || String(error),
      }
    }
  })
}

export function registerChatRoleResourceProtocol(): void {
  if (protocol.isProtocolHandled(CHAT_ROLE_RESOURCE_PROTOCOL)) {
    return
  }
  protocol.handle(CHAT_ROLE_RESOURCE_PROTOCOL, async (request) => {
    const url = new URL(request.url)
    if (url.host && url.host !== 'chat') {
      return new Response(null, { status: 404 })
    }
    const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    const absolutePath = resolve(getChatRoleResourceDir(), relativePath)
    if (!relativePath || !isPathInside(getChatRoleResourceDir(), absolutePath) || !existsSync(absolutePath)) {
      return new Response(null, { status: 404 })
    }
    const bytes = await readFile(absolutePath)
    return new Response(bytes, {
      headers: {
        'Content-Type': mimeForPath(absolutePath),
        'Cache-Control': 'no-store',
      },
    })
  })
}
