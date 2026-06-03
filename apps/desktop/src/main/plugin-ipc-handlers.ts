/**
 * IPC handlers for runtime plugin discovery, admin actions, and plugin asset selection.
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises'
import { isAbsolute, join, relative, resolve as resolvePath } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { app, dialog, net, shell, type BrowserWindow, type IpcMain, type OpenDialogOptions } from 'electron'
import type { AppSettings } from './settings-store.js'
import {
  discoverRuntimePlugins,
  invalidateRuntimePluginManifests,
  invokeRuntimePluginAdminAction,
  uninstallRuntimePlugin,
} from './plugin-loader.js'

const PLUGIN_MARKETPLACE_REGISTRY_URL = 'https://raw.githubusercontent.com/HappyFox001/Noema-Plugin/main/registry.json'
const PLUGIN_MARKETPLACE_REPO_URL = 'https://github.com/HappyFox001/Noema-Plugin'
const PLUGIN_MARKETPLACE_API_CONTENTS_URL = 'https://api.github.com/repos/HappyFox001/Noema-Plugin/contents'

interface PluginMarketplaceRegistry {
  schemaVersion?: number
  plugins?: PluginMarketplaceRegistryItem[]
}

interface PluginMarketplaceRegistryItem {
  id?: string
  name?: string
  version?: string
  description?: string
  path?: string
  manifest?: string
  tags?: string[]
}

interface PluginMarketplaceCache {
  fetchedAt: number
  registry: PluginMarketplaceRegistry
}

interface GitHubContentItem {
  type?: string
  name?: string
  path?: string
  download_url?: string | null
}

export function registerPluginIpcHandlers(
  ipcMain: IpcMain,
  options: {
    getMainWindow(): BrowserWindow | null
    getSettings(): AppSettings
    resolveRuntimePluginsDir(): string
  }
): void {
  ipcMain.handle('plugins:list', async () => {
    const settings = options.getSettings()
    try {
      return {
        success: true,
        plugins: await discoverRuntimePlugins(
          options.resolveRuntimePluginsDir(),
          settings.plugins,
          settings.pluginConfigs
        ),
      }
    } catch (error: any) {
      return { success: false, error: error.message, plugins: [] }
    }
  })

  ipcMain.handle('plugins:marketplace', async (_event, request?: { refresh?: boolean }) => {
    try {
      const settings = options.getSettings()
      const installedPlugins = await discoverRuntimePlugins(
        options.resolveRuntimePluginsDir(),
        settings.plugins,
        settings.pluginConfigs
      )
      const installedById = new Map(installedPlugins.map(plugin => [plugin.id, plugin]))
      const { registry, cached, fetchedAt } = await loadPluginMarketplaceRegistry(request?.refresh === true)
      const items = (registry.plugins ?? [])
        .filter(item => typeof item.id === 'string' && item.id.trim().length > 0)
        .map(item => {
          const id = item.id!.trim()
          const installed = installedById.get(id)
          const sourceUrl = item.path
            ? `${PLUGIN_MARKETPLACE_REPO_URL}/tree/main/${item.path.replace(/^\/+/, '')}`
            : PLUGIN_MARKETPLACE_REPO_URL
          return {
            id,
            name: item.name || id,
            version: item.version,
            description: item.description,
            path: item.path,
            manifest: item.manifest,
            tags: Array.isArray(item.tags) ? item.tags.filter(tag => typeof tag === 'string') : [],
            sourceUrl,
            installed: Boolean(installed),
            enabled: installed?.enabled ?? false,
          }
        })

      return {
        success: true,
        source: PLUGIN_MARKETPLACE_REPO_URL,
        registryUrl: PLUGIN_MARKETPLACE_REGISTRY_URL,
        cached,
        fetchedAt,
        plugins: items,
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        source: PLUGIN_MARKETPLACE_REPO_URL,
        registryUrl: PLUGIN_MARKETPLACE_REGISTRY_URL,
        cached: false,
        fetchedAt: undefined,
        plugins: [],
      }
    }
  })

  ipcMain.handle('plugins:openMarketplaceSource', async (_event, sourceUrl?: string) => {
    const target = typeof sourceUrl === 'string' && sourceUrl.startsWith(PLUGIN_MARKETPLACE_REPO_URL)
      ? sourceUrl
      : PLUGIN_MARKETPLACE_REPO_URL
    await shell.openExternal(target)
    return { success: true }
  })

  ipcMain.handle('plugins:uninstall', async (_event, pluginId: string) => {
    try {
      const result = await uninstallRuntimePlugin(options.resolveRuntimePluginsDir(), pluginId)
      return { success: true, ...result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('plugins:installFromMarketplace', async (_event, pluginId: string) => {
    try {
      const result = await installPluginFromMarketplace(
        options.resolveRuntimePluginsDir(),
        pluginId
      )
      return { success: true, ...result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('plugins:adminAction', async (_event, pluginId: string, action: string, payload: unknown) => {
    return invokeRuntimePluginAdminAction(
      options.resolveRuntimePluginsDir(),
      pluginId,
      action,
      payload,
      options.getSettings().pluginConfigs
    )
  })

  ipcMain.handle('plugins:selectConfigPath', async (_event, request?: {
    pluginId?: string
    mode?: 'file' | 'directory'
    title?: string
    defaultPath?: string
    filters?: Array<{ name: string; extensions: string[] }>
    resolveFileExtensions?: string[]
    resolveRecursive?: boolean
  }) => {
    try {
      const mode = request?.mode === 'directory' ? 'directory' : 'file'
      const dialogOptions: OpenDialogOptions = {
        title: request?.title || (mode === 'directory' ? '选择插件目录' : '选择插件文件'),
        properties: [mode === 'directory' ? 'openDirectory' : 'openFile'],
        defaultPath: await resolvePluginDialogDefaultPath(
          options.resolveRuntimePluginsDir(),
          options.getSettings(),
          request?.pluginId,
          request?.defaultPath
        ),
        filters: mode === 'file' && request?.filters?.length ? request.filters : undefined,
      }
      const result = await showOpenDialog(options.getMainWindow(), dialogOptions)

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true }
      }

      const selectedPath = result.filePaths[0]
      if (mode === 'directory') {
        const resolvedFilePath = await findFirstMatchingFile(
          selectedPath,
          request?.resolveFileExtensions ?? [],
          request?.resolveRecursive === true
        )
        return {
          success: true,
          directoryPath: selectedPath,
          resolvedFilePath,
          resolvedFileUrl: resolvedFilePath ? pathToFileURL(resolvedFilePath).toString() : undefined,
        }
      }

      return {
        success: true,
        filePath: selectedPath,
        fileUrl: pathToFileURL(selectedPath).toString(),
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('plugins:selectConfigFile', async (_event, request?: {
    title?: string
    filters?: Array<{ name: string; extensions: string[] }>
  }) => {
    try {
      const dialogOptions: OpenDialogOptions = {
        title: request?.title || '选择插件文件',
        properties: ['openFile'],
        filters: request?.filters?.length ? request.filters : undefined,
      }
      const result = await showOpenDialog(options.getMainWindow(), dialogOptions)

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true }
      }

      const filePath = result.filePaths[0]
      return {
        success: true,
        filePath,
        fileUrl: pathToFileURL(filePath).toString(),
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('plugins:readLive2dModelCapabilities', async (_event, request?: {
    pluginDir?: string
    modelUrl?: string
  }) => {
    try {
      const modelPath = resolveLive2dModelPath(request?.pluginDir, request?.modelUrl)
      if (!modelPath) {
        return { success: false, error: 'missing model path' }
      }
      const raw = await readFile(modelPath, 'utf-8')
      const settings = JSON.parse(raw)
      return {
        success: true,
        ...extractLive2dModelCapabilities(settings),
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
}

async function loadPluginMarketplaceRegistry(forceRefresh: boolean): Promise<{
  registry: PluginMarketplaceRegistry
  cached: boolean
  fetchedAt: number
}> {
  if (!forceRefresh) {
    const cached = await readPluginMarketplaceCache()
    if (cached) {
      return {
        registry: cached.registry,
        cached: true,
        fetchedAt: cached.fetchedAt,
      }
    }
  }

  try {
    const registry = await fetchPluginMarketplaceRegistry()
    const fetchedAt = Date.now()
    await writePluginMarketplaceCache({ fetchedAt, registry })
    return { registry, cached: false, fetchedAt }
  } catch (error) {
    const cached = await readPluginMarketplaceCache()
    if (cached) {
      return {
        registry: cached.registry,
        cached: true,
        fetchedAt: cached.fetchedAt,
      }
    }
    throw error
  }
}

async function readPluginMarketplaceCache(): Promise<PluginMarketplaceCache | null> {
  try {
    const raw = await readFile(getPluginMarketplaceCachePath(), 'utf8')
    const parsed = JSON.parse(raw) as PluginMarketplaceCache
    if (!parsed || typeof parsed.fetchedAt !== 'number' || !parsed.registry) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

async function writePluginMarketplaceCache(cache: PluginMarketplaceCache): Promise<void> {
  const cachePath = getPluginMarketplaceCachePath()
  await mkdir(resolvePath(cachePath, '..'), { recursive: true })
  await writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf8')
}

function getPluginMarketplaceCachePath(): string {
  return join(app.getPath('userData'), 'plugin-marketplace-cache.json')
}

async function fetchPluginMarketplaceRegistry(): Promise<PluginMarketplaceRegistry> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await net.fetch(PLUGIN_MARKETPLACE_REGISTRY_URL, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'User-Agent': 'Noema Desktop',
      },
    })
    if (!response.ok) {
      throw new Error(`Marketplace registry request failed: ${response.status}`)
    }

    return await response.json() as PluginMarketplaceRegistry
  } finally {
    clearTimeout(timeout)
  }
}

async function installPluginFromMarketplace(
  pluginsDir: string,
  pluginId: string
): Promise<{ pluginDir: string }> {
  const safePluginId = normalizePluginId(pluginId)
  const { registry } = await loadPluginMarketplaceRegistry(false)
  const item = (registry.plugins ?? []).find(candidate => candidate.id === safePluginId)
  if (!item?.path) {
    throw new Error(`Marketplace plugin not found: ${pluginId}`)
  }

  const pluginPath = normalizeMarketplacePluginPath(item.path)
  const localPluginsDir = resolvePath(pluginsDir, 'local')
  const targetDir = resolvePath(localPluginsDir, safePluginId)
  const relativeTarget = relative(localPluginsDir, targetDir)
  if (isAbsolute(relativeTarget) || relativeTarget.startsWith('..')) {
    throw new Error(`Invalid plugin id: ${pluginId}`)
  }

  const existingPlugins = await discoverRuntimePlugins(pluginsDir)
  if (existingPlugins.some(plugin => plugin.id === safePluginId)) {
    throw new Error(`Plugin already installed: ${safePluginId}`)
  }

  const tempDir = resolvePath(localPluginsDir, `.${safePluginId}.${Date.now()}.installing`)
  await mkdir(localPluginsDir, { recursive: true })
  await rm(tempDir, { recursive: true, force: true })
  await mkdir(tempDir, { recursive: true })

  try {
    await downloadMarketplaceDirectory(pluginPath, tempDir)
    const manifestPath = resolvePath(tempDir, 'plugin.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { id?: string; type?: string }
    if (manifest.type !== 'sdk-plugin') {
      throw new Error('Downloaded plugin manifest is not an sdk-plugin')
    }
    if (manifest.id !== safePluginId) {
      throw new Error(`Downloaded plugin id mismatch: expected ${safePluginId}, got ${manifest.id || 'unknown'}`)
    }

    await rename(tempDir, targetDir)
    invalidateRuntimePluginManifests(pluginsDir)
    return { pluginDir: targetDir }
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true })
    throw error
  }
}

function normalizePluginId(pluginId: string): string {
  const normalized = pluginId.trim()
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(normalized)) {
    throw new Error(`Invalid plugin id: ${pluginId}`)
  }
  return normalized
}

function normalizeMarketplacePluginPath(pluginPath: string): string {
  const normalized = pluginPath.replace(/^\/+/, '').replace(/\/+$/, '')
  const parts = normalized.split('/')
  if (
    parts.length < 2 ||
    parts[0] !== 'plugins' ||
    parts.some(part => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Invalid marketplace plugin path: ${pluginPath}`)
  }
  return normalized
}

async function downloadMarketplaceDirectory(remotePath: string, localDir: string): Promise<void> {
  const entries = await fetchGitHubContents(remotePath)
  await mkdir(localDir, { recursive: true })

  for (const entry of entries) {
    if (!entry.name || !entry.path || entry.name === '.' || entry.name === '..') {
      continue
    }

    const targetPath = resolvePath(localDir, entry.name)
    const relativeTarget = relative(localDir, targetPath)
    if (isAbsolute(relativeTarget) || relativeTarget.startsWith('..')) {
      throw new Error(`Unsafe marketplace entry: ${entry.name}`)
    }

    if (entry.type === 'dir') {
      await downloadMarketplaceDirectory(entry.path, targetPath)
      continue
    }

    if (entry.type !== 'file' || !entry.download_url) {
      continue
    }

    await downloadMarketplaceFile(entry.download_url, targetPath)
  }
}

async function fetchGitHubContents(remotePath: string): Promise<GitHubContentItem[]> {
  const url = `${PLUGIN_MARKETPLACE_API_CONTENTS_URL}/${encodeURIComponentPath(remotePath)}?ref=main`
  const response = await net.fetch(url, {
    redirect: 'follow',
    headers: {
      accept: 'application/vnd.github+json',
      'User-Agent': 'Noema Desktop',
    },
  })
  if (!response.ok) {
    throw new Error(`Marketplace content request failed: ${response.status}`)
  }

  const data = await response.json() as GitHubContentItem[] | GitHubContentItem
  return Array.isArray(data) ? data : [data]
}

async function downloadMarketplaceFile(downloadUrl: string, targetPath: string): Promise<void> {
  const response = await net.fetch(downloadUrl, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Noema Desktop',
    },
  })
  if (!response.ok) {
    throw new Error(`Marketplace file download failed: ${response.status}`)
  }

  await mkdir(resolvePath(targetPath, '..'), { recursive: true })
  await writeFile(targetPath, Buffer.from(await response.arrayBuffer()))
}

function encodeURIComponentPath(path: string): string {
  return path.split('/').map(part => encodeURIComponent(part)).join('/')
}

async function resolvePluginDialogDefaultPath(
  pluginsDir: string,
  settings: AppSettings,
  pluginId?: string,
  defaultPath?: string
): Promise<string | undefined> {
  if (!defaultPath) {
    return undefined
  }
  if (isAbsolute(defaultPath) || !pluginId) {
    return defaultPath
  }

  const plugins = await discoverRuntimePlugins(pluginsDir, settings.plugins, settings.pluginConfigs)
  const plugin = plugins.find(item => item.id === pluginId)
  if (!plugin) {
    return undefined
  }

  const resolvedPath = resolvePath(plugin.pluginDir, defaultPath)
  const relativePath = relative(plugin.pluginDir, resolvedPath)
  if (isAbsolute(relativePath) || relativePath.startsWith('..')) {
    return undefined
  }
  return resolvedPath
}

function showOpenDialog(
  mainWindow: BrowserWindow | null,
  dialogOptions: OpenDialogOptions
): Promise<Electron.OpenDialogReturnValue> {
  return mainWindow
    ? dialog.showOpenDialog(mainWindow, dialogOptions)
    : dialog.showOpenDialog(dialogOptions)
}

async function findFirstMatchingFile(
  directoryPath: string,
  extensions: string[],
  recursive: boolean
): Promise<string | undefined> {
  if (!extensions.length) {
    return undefined
  }
  const normalizedExtensions = extensions.map(extension =>
    extension.toLowerCase().replace(/^\./, '')
  )

  const entries = await readdir(directoryPath, { withFileTypes: true })
  const sortedEntries = entries.sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of sortedEntries) {
    const entryPath = join(directoryPath, entry.name)
    if (entry.isFile() && normalizedExtensions.some(extension =>
      entry.name.toLowerCase().endsWith(`.${extension}`)
    )) {
      return entryPath
    }
  }

  if (!recursive) {
    return undefined
  }

  for (const entry of sortedEntries) {
    if (!entry.isDirectory()) {
      continue
    }
    const matchedPath = await findFirstMatchingFile(join(directoryPath, entry.name), extensions, true)
    if (matchedPath) {
      return matchedPath
    }
  }
  return undefined
}

function resolveLive2dModelPath(pluginDir?: string, modelUrl?: string): string | undefined {
  if (!modelUrl) {
    return undefined
  }
  if (modelUrl.startsWith('file://')) {
    return fileURLToPath(modelUrl)
  }
  if (isAbsolute(modelUrl)) {
    return modelUrl
  }
  if (!pluginDir) {
    return undefined
  }
  return resolvePath(pluginDir, 'assets', 'ui', modelUrl)
}

function extractLive2dModelCapabilities(settings: any): {
  motionGroups: string[]
  expressions: string[]
  lipSyncParameters: string[]
} {
  const fileReferences = settings?.FileReferences || settings?.fileReferences || {}
  const motions = fileReferences.Motions || fileReferences.motions || {}
  const expressions = fileReferences.Expressions || fileReferences.expressions || []
  const groups = settings?.Groups || settings?.groups || []
  const lipSyncParameters: string[] = []

  for (const group of Array.isArray(groups) ? groups : []) {
    const target = String(group.Target || group.target || '').toLowerCase()
    const name = String(group.Name || group.name || '').toLowerCase()
    if (!target.includes('parameter') || name !== 'lipsync') {
      continue
    }
    const ids = group.Ids || group.ids || []
    for (const id of Array.isArray(ids) ? ids : []) {
      if (typeof id === 'string' && !lipSyncParameters.includes(id)) {
        lipSyncParameters.push(id)
      }
    }
  }

  return {
    motionGroups: Object.keys(motions).sort((left, right) => left.localeCompare(right)),
    expressions: (Array.isArray(expressions) ? expressions : [])
      .map((expression: any) => expression.Name || expression.name)
      .filter((name: unknown): name is string => typeof name === 'string' && name.length > 0)
      .sort((left: string, right: string) => left.localeCompare(right)),
    lipSyncParameters,
  }
}
