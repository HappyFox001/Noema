/**
 * IPC handlers for chat character resources stored under the role directory.
 */
import { app, ipcMain, type IpcMain } from 'electron'
import { existsSync } from 'fs'
import { readdir, readFile } from 'fs/promises'
import { dirname, extname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')

interface ChatRoleResourceManifest {
  id: string
  name: Record<string, string>
  displayName: Record<string, string>
  description: Record<string, string>
  background: Record<string, string>
  firstMessage: Record<string, string>
  tag: Record<string, string[]>
  avatarImage: string
  bodyImage: string
}

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
}

async function listChatRoleResources(): Promise<ChatRoleResourceManifest[]> {
  const chatRoleResourceDir = getChatRoleResourceDir()
  if (!existsSync(chatRoleResourceDir)) {
    return []
  }

  const entries = await readdir(chatRoleResourceDir, { withFileTypes: true })
  const manifests = await Promise.all(entries
    .filter(entry => entry.isDirectory())
    .map(entry => loadManifest(join(chatRoleResourceDir, entry.name))))

  return manifests.filter(Boolean) as ChatRoleResourceManifest[]
}

function getChatRoleResourceDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'role', 'chat')
    : join(SOURCE_ROOT, 'role', 'chat')
}

async function loadManifest(resourceDir: string): Promise<ChatRoleResourceManifest | null> {
  const manifestPath = join(resourceDir, 'manifest.json')
  if (!existsSync(manifestPath)) {
    return null
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ChatRoleResourceManifest
  return {
    ...manifest,
    avatarImage: await loadImageDataUrl(resourceDir, manifest.avatarImage),
    bodyImage: await loadImageDataUrl(resourceDir, manifest.bodyImage),
  }
}

async function loadImageDataUrl(resourceDir: string, imagePath: string): Promise<string> {
  const absolutePath = resolve(resourceDir, imagePath.replace(/^\/+/, ''))
  if (!isPathInside(resourceDir, absolutePath)) {
    throw new Error(`Chat role image escapes resource directory: ${imagePath}`)
  }

  const bytes = await readFile(absolutePath)
  return `data:${mimeForPath(absolutePath)};base64,${bytes.toString('base64')}`
}

function isPathInside(parent: string, child: string): boolean {
  const normalizedParent = resolve(parent)
  const normalizedChild = resolve(child)
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`)
}

function mimeForPath(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
    default:
      return 'image/png'
  }
}
