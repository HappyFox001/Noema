/**
 * IPC handlers for runtime plugin discovery, admin actions, and plugin asset selection.
 */
import { readFile, readdir } from 'fs/promises'
import { isAbsolute, join, resolve as resolvePath } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { dialog, type BrowserWindow, type IpcMain, type OpenDialogOptions } from 'electron'
import type { AppSettings } from './settings-store.js'
import { discoverRuntimePlugins, invokeRuntimePluginAdminAction } from './plugin-loader.js'

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
        defaultPath: request?.defaultPath,
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
