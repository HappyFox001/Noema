/**
 * IPC handlers for chat character resources stored under the role directory.
 */
import { app, ipcMain, protocol, type IpcMain } from 'electron'
import { existsSync } from 'fs'
import { readdir, readFile } from 'fs/promises'
import { dirname, extname, join, relative, resolve, sep } from 'path'
import { fileURLToPath } from 'url'

const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const CHAT_ROLE_RESOURCE_PROTOCOL = 'noema-role-resource'

protocol.registerSchemesAsPrivileged([{
  scheme: CHAT_ROLE_RESOURCE_PROTOCOL,
  privileges: {
    secure: true,
    standard: true,
    supportFetchAPI: true,
    corsEnabled: false,
  },
}])

interface ChatRoleResourceManifest {
  id: string
  name: Record<string, string>
  displayName: Record<string, string>
  description: Record<string, string>
  story: Record<string, string>
  background: Record<string, string>
  scene: Record<string, any>
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
    avatarImage: resolveImageUrl(resourceDir, manifest.avatarImage),
    bodyImage: resolveImageUrl(resourceDir, manifest.bodyImage),
  }
}

function resolveImageUrl(resourceDir: string, imagePath: string): string {
  const absolutePath = resolve(resourceDir, imagePath.replace(/^\/+/, ''))
  if (!isPathInside(resourceDir, absolutePath)) {
    throw new Error(`Chat role image escapes resource directory: ${imagePath}`)
  }

  if (!existsSync(absolutePath)) {
    return ''
  }
  const relativePath = relative(getChatRoleResourceDir(), absolutePath)
    .split(sep)
    .map((part) => encodeURIComponent(part))
    .join('/')
  return `${CHAT_ROLE_RESOURCE_PROTOCOL}://chat/${relativePath}`
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
