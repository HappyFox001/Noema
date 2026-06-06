/**
 * Runtime plugin loader for desktop.
 *
 * Discovers plugin manifests, merges persisted configuration, creates plugin
 * data directories, and provides host capabilities to external plugin modules.
 */
import { app } from 'electron'
import { existsSync } from 'fs'
import { mkdir, readdir, readFile, rm } from 'fs/promises'
import { isAbsolute, join, relative, resolve } from 'path'
import { pathToFileURL } from 'url'
import type {
  PluginAdminSchema,
  PluginConfigField,
  PluginPermission,
  PluginUISurfaceManifest,
  RuntimePluginManifest,
  SDKPlugin,
  SDKPluginContext,
} from '@noema/sdk'

type RuntimePluginFactory = (context: SDKPluginContext) => SDKPlugin | Promise<SDKPlugin>
type RuntimePluginManifestEntry = { manifest: RuntimePluginManifest; pluginDir: string }

const manifestCache = new Map<string, RuntimePluginManifestEntry[]>()
const factoryCache = new Map<string, RuntimePluginFactory>()

export interface RuntimePluginInfo {
  id: string
  name: string
  description?: string
  version?: string
  enabled: boolean
  pluginDir: string
  permissions: PluginPermission[]
  config: Record<string, unknown>
  configSchema: PluginConfigField[]
  i18n?: Record<string, Record<string, string>>
  adminSchema?: PluginAdminSchema
  uiSurfaces: RuntimePluginUISurface[]
}

export interface RuntimePluginUISurface {
  id: string
  pluginId: string
  slot: PluginUISurfaceManifest['slot']
  mode: NonNullable<PluginUISurfaceManifest['mode']>
  title?: string
  src: string
  transparent: boolean
  config: Record<string, unknown>
}

export interface RuntimePluginAdminResult {
  success: boolean
  state?: unknown
  result?: unknown
  error?: string
}

export async function discoverRuntimePlugins(
  pluginsDir: string,
  enabledOverrides: Record<string, boolean> = {}
  , configOverrides: Record<string, Record<string, unknown>> = {}
): Promise<RuntimePluginInfo[]> {
  const manifests = await readRuntimePluginManifests(pluginsDir)
  return manifests.map(({ manifest, pluginDir }) => {
    const enabled = enabledOverrides[manifest.id] ?? manifest.enabled !== false
    return {
      id: manifest.id,
      name: manifest.name || manifest.id,
      description: manifest.description,
      version: manifest.version,
      enabled,
      pluginDir,
      permissions: manifest.permissions ?? [],
      config: mergePluginConfig(manifest, configOverrides[manifest.id]),
      configSchema: manifest.configSchema ?? [],
      i18n: manifest.i18n,
      adminSchema: manifest.adminSchema,
      uiSurfaces: enabled
        ? resolveRuntimePluginUISurfaces(
            manifest,
            pluginDir,
            mergePluginConfig(manifest, configOverrides[manifest.id])
          )
        : [],
    }
  })
}

export async function loadRuntimePlugins(
  pluginsDir: string,
  enabledOverrides: Record<string, boolean> = {},
  configOverrides: Record<string, Record<string, unknown>> = {}
): Promise<SDKPlugin[]> {
  const manifests = await readRuntimePluginManifests(pluginsDir)
  const plugins: SDKPlugin[] = []

  for (const { manifest, pluginDir } of manifests) {
    const enabled = enabledOverrides[manifest.id] ?? manifest.enabled !== false
    if (!enabled) {
      console.log(`[PluginLoader] Skipped disabled plugin: ${manifest.id}`)
      continue
    }

    const plugin = await loadRuntimePlugin(pluginDir, manifest, configOverrides[manifest.id])
    if (plugin) {
      plugins.push(plugin)
    }
  }

  return plugins
}

async function readRuntimePluginManifests(
  pluginsDir: string
): Promise<RuntimePluginManifestEntry[]> {
  const cacheKey = resolve(pluginsDir)
  const cached = manifestCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const manifests: Array<{ manifest: RuntimePluginManifest; pluginDir: string }> = []
  const seenPluginIds = new Set<string>()
  const pluginDirs = await listRuntimePluginDirs(pluginsDir)
  if (!pluginDirs.length) {
    console.warn('[PluginLoader] No plugin directories found under runtime roots:', getRuntimePluginRoots(pluginsDir))
  }

  for (const pluginDir of pluginDirs) {
    const manifestPath = join(pluginDir, 'plugin.json')
    if (!existsSync(manifestPath)) {
      continue
    }

    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as RuntimePluginManifest
      if (manifest.type !== 'sdk-plugin') {
        continue
      }
      if (seenPluginIds.has(manifest.id)) {
        continue
      }

      seenPluginIds.add(manifest.id)
      manifests.push({ manifest, pluginDir })
    } catch (error) {
      console.error(`[PluginLoader] Failed to read plugin manifest from ${pluginDir}:`, error)
    }
  }

  manifestCache.set(cacheKey, manifests)
  return manifests
}

export function invalidateRuntimePluginManifests(pluginsDir?: string): void {
  if (pluginsDir) {
    manifestCache.delete(resolve(pluginsDir))
    return
  }

  manifestCache.clear()
}

export async function uninstallRuntimePlugin(
  pluginsDir: string,
  pluginId: string
): Promise<{ pluginDir: string }> {
  const manifests = await readRuntimePluginManifests(pluginsDir)
  const entry = manifests.find(item => item.manifest.id === pluginId)
  if (!entry) {
    throw new Error(`Plugin not found: ${pluginId}`)
  }

  if (!isRuntimePluginDirAllowed(pluginsDir, entry.pluginDir)) {
    throw new Error(`Plugin directory is outside local plugin roots: ${entry.pluginDir}`)
  }

  await rm(entry.pluginDir, { recursive: true, force: true })
  invalidateRuntimePluginManifests(pluginsDir)
  for (const mainPath of factoryCache.keys()) {
    if (isPathInside(entry.pluginDir, mainPath)) {
      factoryCache.delete(mainPath)
    }
  }

  return { pluginDir: entry.pluginDir }
}

async function listRuntimePluginDirs(pluginsDir: string): Promise<string[]> {
  const pluginRoots = getRuntimePluginRoots(pluginsDir)
  const pluginDirs: string[] = []
  const seenPluginDirs = new Set<string>()

  for (const pluginRoot of pluginRoots) {
    if (!existsSync(pluginRoot)) {
      continue
    }

    const entries = await readdir(pluginRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }

      const pluginDir = resolve(pluginRoot, entry.name)
      if (seenPluginDirs.has(pluginDir)) {
        continue
      }

      seenPluginDirs.add(pluginDir)
      pluginDirs.push(pluginDir)
    }
  }

  return pluginDirs
}

function getRuntimePluginRoots(pluginsDir: string): string[] {
  const roots = [
    join(pluginsDir, 'local'),
  ]
  const bundledPluginsDir = join(process.resourcesPath, 'plugins')
  if (resolve(bundledPluginsDir) !== resolve(pluginsDir)) {
    roots.push(
      join(bundledPluginsDir, 'local')
    )
  }
  return roots
}

function getWritableRuntimePluginRoots(pluginsDir: string): string[] {
  return [
    join(pluginsDir, 'local'),
  ]
}

function isRuntimePluginDirAllowed(pluginsDir: string, pluginDir: string): boolean {
  return getWritableRuntimePluginRoots(pluginsDir).some(root => isPathInside(root, pluginDir))
}

function isPathInside(parent: string, child: string): boolean {
  const relativePath = relative(resolve(parent), resolve(child))
  return relativePath === '' || (!isAbsolute(relativePath) && !relativePath.startsWith('..'))
}

async function loadRuntimePlugin(
  pluginDir: string,
  manifest: RuntimePluginManifest,
  configOverride?: Record<string, unknown>
): Promise<SDKPlugin | null> {
  try {
    const mainFile = manifest.main || 'index.mjs'
    const mainPath = resolve(pluginDir, mainFile)
    if (!existsSync(mainPath)) {
      console.warn(`[PluginLoader] Plugin "${manifest.id}" main file not found:`, mainPath)
      return null
    }

    const assetsDir = manifest.assets ? resolve(pluginDir, manifest.assets) : pluginDir
    const dataDir = join(app.getPath('userData'), 'plugins', manifest.id)
    await mkdir(dataDir, { recursive: true })
    const factory = await loadRuntimePluginFactory(mainPath, manifest.id)
    if (!factory) return null

    const pluginContext: SDKPluginContext = {
      pluginDir,
      assetsDir,
      dataDir,
      config: mergePluginConfig(manifest, configOverride),
      manifest,
      resolveAsset: (assetPath: string) => resolve(assetsDir, assetPath),
    }
    const plugin = await (factory as RuntimePluginFactory)(pluginContext)
    plugin.manifest = manifest
    plugin.permissions = manifest.permissions ?? []
    plugin.context = pluginContext

    console.log(`[PluginLoader] Loaded plugin: ${plugin.id}${manifest.version ? `@${manifest.version}` : ''}`)
    return plugin
  } catch (error) {
    console.error(`[PluginLoader] Failed to load plugin from ${pluginDir}:`, error)
    return null
  }
}

async function loadRuntimePluginFactory(
  mainPath: string,
  pluginId: string
): Promise<RuntimePluginFactory | null> {
  const cached = factoryCache.get(mainPath)
  if (cached) {
    return cached
  }

  const module = await import(pathToFileURL(mainPath).toString())
  const factory = module.default
  if (typeof factory !== 'function') {
    console.warn(`[PluginLoader] Plugin "${pluginId}" must default-export a plugin factory`)
    return null
  }

  factoryCache.set(mainPath, factory as RuntimePluginFactory)
  return factory as RuntimePluginFactory
}

export async function invokeRuntimePluginAdminAction(
  pluginsDir: string,
  pluginId: string,
  action: string,
  payload: unknown,
  configOverrides: Record<string, Record<string, unknown>> = {}
): Promise<RuntimePluginAdminResult> {
  try {
    const manifests = await readRuntimePluginManifests(pluginsDir)
    const entry = manifests.find(item => item.manifest.id === pluginId)
    if (!entry) {
      return { success: false, error: `Plugin not found: ${pluginId}` }
    }

    const plugin = await loadRuntimePlugin(
      entry.pluginDir,
      entry.manifest,
      configOverrides[pluginId]
    )
    if (!plugin) {
      return { success: false, error: `Plugin failed to load: ${pluginId}` }
    }

    if (action === 'state') {
      return {
        success: true,
        state: await plugin.getAdminState?.(),
      }
    }

    if (typeof plugin.handleAdminAction !== 'function') {
      return { success: false, error: `Plugin has no admin actions: ${pluginId}` }
    }

    const result = await plugin.handleAdminAction(action, payload)
    return {
      success: true,
      result,
      state: await plugin.getAdminState?.(),
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

function mergePluginConfig(
  manifest: RuntimePluginManifest,
  override?: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...(manifest.config ?? {}),
    ...(override ?? {}),
  }
}

function resolveRuntimePluginUISurfaces(
  manifest: RuntimePluginManifest,
  pluginDir: string,
  config: Record<string, unknown>
): RuntimePluginUISurface[] {
  const assetsDir = manifest.assets ? resolve(pluginDir, manifest.assets) : pluginDir
  return (manifest.uiSurfaces ?? []).flatMap((surface) => {
    const entryPath = resolve(assetsDir, surface.entry)
    const entryRelative = relative(assetsDir, entryPath)
    if (isAbsolute(entryRelative) || entryRelative.startsWith('..')) {
      console.warn(`[PluginLoader] Skipped UI surface outside assets for plugin "${manifest.id}":`, surface.entry)
      return []
    }

    return [{
      id: surface.id || `${manifest.id}:${surface.slot}`,
      pluginId: manifest.id,
      slot: surface.slot,
      mode: surface.mode ?? 'replace',
      title: surface.title,
      src: pathToFileURL(entryPath).toString(),
      transparent: surface.transparent !== false,
      config,
    }]
  })
}
