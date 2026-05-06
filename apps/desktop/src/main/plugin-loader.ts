/**
 * Runtime plugin loader for desktop.
 *
 * Discovers plugin manifests, merges persisted configuration, creates plugin
 * data directories, and provides host capabilities to external plugin modules.
 */
import { app } from 'electron'
import { existsSync } from 'fs'
import { mkdir, readdir, readFile } from 'fs/promises'
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
} from '@her-text/sdk'

type RuntimePluginFactory = (context: SDKPluginContext) => SDKPlugin | Promise<SDKPlugin>

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
      adminSchema: manifest.adminSchema,
      uiSurfaces: enabled ? resolveRuntimePluginUISurfaces(manifest, pluginDir) : [],
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
): Promise<Array<{ manifest: RuntimePluginManifest; pluginDir: string }>> {
  if (!existsSync(pluginsDir)) {
    console.warn('[PluginLoader] Plugin directory not found:', pluginsDir)
    return []
  }

  const entries = await readdir(pluginsDir, { withFileTypes: true })
  const manifests: Array<{ manifest: RuntimePluginManifest; pluginDir: string }> = []

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    const pluginDir = join(pluginsDir, entry.name)
    const manifestPath = join(pluginDir, 'plugin.json')
    if (!existsSync(manifestPath)) {
      continue
    }

    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as RuntimePluginManifest
      if (manifest.type !== 'sdk-plugin') {
        continue
      }

      manifests.push({ manifest, pluginDir })
    } catch (error) {
      console.error(`[PluginLoader] Failed to read plugin manifest from ${pluginDir}:`, error)
    }
  }

  return manifests
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
    const module = await import(pathToFileURL(mainPath).toString())
    const factory = module.default
    if (typeof factory !== 'function') {
      console.warn(`[PluginLoader] Plugin "${manifest.id}" must default-export a plugin factory`)
      return null
    }

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
  pluginDir: string
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
    }]
  })
}
