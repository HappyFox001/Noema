/**
 * Loads canonical chat character profiles for desktop host surfaces.
 */
import { app } from 'electron'
import { existsSync } from 'fs'
import { readdir, readFile } from 'fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import {
  createCharacterProfileFromManifest,
  localizeCharacterProfileText,
  normalizeCharacterProfile,
  type CharacterProfile,
  type CharacterProfileManifestInput,
} from '@noema/sdk/character-profile'

export const CHAT_ROLE_RESOURCE_PROTOCOL = 'noema-role-resource'
export const CHAT_ROLE_REF_PREFIX = 'chat:'
export const FILE_REF_PREFIX = 'file:'

const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')

export interface CharacterProfileListItem {
  id: string
  name: string
  path: string
  source: 'chat' | 'file'
}

export function getChatRoleResourceDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'role', 'chat')
    : join(SOURCE_ROOT, 'role', 'chat')
}

export async function listChatRoleResources(): Promise<CharacterProfile[]> {
  const chatRoleResourceDir = getChatRoleResourceDir()
  if (!existsSync(chatRoleResourceDir)) {
    return []
  }

  const entries = await readdir(chatRoleResourceDir, { withFileTypes: true })
  const manifests = await Promise.all(entries
    .filter(entry => entry.isDirectory())
    .map(entry => loadChatRoleResourceFromDir(join(chatRoleResourceDir, entry.name))))

  return manifests.filter(Boolean) as CharacterProfile[]
}

export async function listChatRoleResourceItems(externalPaths: string[] = []): Promise<CharacterProfileListItem[]> {
  const chatProfiles = await listChatRoleResources()
  const items: CharacterProfileListItem[] = chatProfiles.map((profile) => ({
    id: `${CHAT_ROLE_REF_PREFIX}${profile.id}`,
    name: localizeCharacterProfileText(profile.displayName, 'zh-CN') || profile.id,
    path: profile.source?.path ?? '',
    source: 'chat',
  }))

  for (const filePath of externalPaths) {
    if (!existsSync(filePath)) {
      continue
    }
    const profile = await loadExternalCharacterProfile(filePath)
    items.push({
      id: `${FILE_REF_PREFIX}${filePath}`,
      name: localizeCharacterProfileText(profile.displayName, 'zh-CN') || profile.id || basename(filePath),
      path: filePath,
      source: 'file',
    })
  }

  return items
}

export async function loadCharacterProfileRef(ref: string): Promise<CharacterProfile> {
  if (ref.startsWith(FILE_REF_PREFIX)) {
    return await loadExternalCharacterProfile(ref.slice(FILE_REF_PREFIX.length))
  }
  if (!ref.startsWith(CHAT_ROLE_REF_PREFIX)) {
    throw new Error(`Invalid character profile reference: ${ref}`)
  }
  return await loadChatRoleResourceById(ref.slice(CHAT_ROLE_REF_PREFIX.length))
}

export async function loadChatRoleResourceById(id: string): Promise<CharacterProfile> {
  const profiles = await listChatRoleResources()
  const profile = profiles.find((item) => item.id === id)
  if (!profile) {
    throw new Error(`Chat character profile not found: ${id}`)
  }
  return profile
}

export async function loadExternalCharacterProfile(filePath: string): Promise<CharacterProfile> {
  if (!/\.json$/i.test(filePath)) {
    throw new Error('Character profile file must be a .json file')
  }
  if (!existsSync(filePath)) {
    throw new Error(`Character profile file not found: ${filePath}`)
  }

  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
  const normalized = normalizeCharacterProfile(parsed)
  if (normalized) {
    return {
      ...normalized,
      source: { kind: 'external', path: filePath },
      avatarImage: resolveExternalImageUri(dirname(filePath), normalized.avatarImage),
      bodyImage: resolveExternalImageUri(dirname(filePath), normalized.bodyImage),
    }
  }

  return createCharacterProfileFromManifest(parsed as CharacterProfileManifestInput, {
    sourceKind: 'external',
    sourcePath: filePath,
    avatarImage: resolveExternalImageUri(dirname(filePath), stringField((parsed as CharacterProfileManifestInput).avatarImage)),
    bodyImage: resolveExternalImageUri(dirname(filePath), stringField((parsed as CharacterProfileManifestInput).bodyImage)),
  })
}

export async function loadChatRoleResourceFromDir(resourceDir: string): Promise<CharacterProfile | null> {
  const manifestPath = join(resourceDir, 'manifest.json')
  if (!existsSync(manifestPath)) {
    return null
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as CharacterProfileManifestInput
  return createCharacterProfileFromManifest(manifest, {
    sourcePath: manifestPath,
    avatarImage: resolveChatRoleImageUrl(resourceDir, stringField(manifest.avatarImage)),
    bodyImage: resolveChatRoleImageUrl(resourceDir, stringField(manifest.bodyImage)),
  })
}

export function resolveChatRoleImageUrl(resourceDir: string, imagePath: string): string {
  if (!imagePath.trim()) {
    return ''
  }
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

export function isPathInside(parent: string, child: string): boolean {
  const normalizedParent = resolve(parent)
  const normalizedChild = resolve(child)
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`)
}

export function mimeForPath(filePath: string): string {
  switch (filePath.toLowerCase().split('.').pop()) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'svg':
      return 'image/svg+xml'
    case 'png':
    default:
      return 'image/png'
  }
}

function resolveExternalImageUri(baseDir: string, imagePath: string): string {
  if (!imagePath.trim() || /^[a-z][a-z0-9+.-]*:/i.test(imagePath)) {
    return imagePath.trim()
  }
  return pathToFileURL(resolve(baseDir, imagePath.replace(/^\/+/, ''))).toString()
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
