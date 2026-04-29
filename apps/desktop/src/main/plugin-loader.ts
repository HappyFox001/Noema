import { existsSync } from 'fs'
import { readdir, readFile } from 'fs/promises'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'
import type { SDKPlugin, SDKPluginContext } from '@her-text/sdk'

export interface RuntimePluginManifest {
  id: string
  name?: string
  version?: string
  type?: 'sdk-plugin'
  main?: string
  assets?: string
  enabled?: boolean
  config?: Record<string, unknown>
}

type RuntimePluginFactory = (context: SDKPluginContext) => SDKPlugin | Promise<SDKPlugin>

export interface RuntimePluginInfo {
  id: string
  name: string
  version?: string
  enabled: boolean
  pluginDir: string
}

export async function discoverRuntimePlugins(
  pluginsDir: string,
  enabledOverrides: Record<string, boolean> = {}
): Promise<RuntimePluginInfo[]> {
  const manifests = await readRuntimePluginManifests(pluginsDir)
  return manifests.map(({ manifest, pluginDir }) => ({
    id: manifest.id,
    name: manifest.name || manifest.id,
    version: manifest.version,
    enabled: enabledOverrides[manifest.id] ?? manifest.enabled !== false,
    pluginDir,
  }))
}

export async function loadRuntimePlugins(
  pluginsDir: string,
  enabledOverrides: Record<string, boolean> = {}
): Promise<SDKPlugin[]> {
  const manifests = await readRuntimePluginManifests(pluginsDir)
  const plugins: SDKPlugin[] = []

  for (const { manifest, pluginDir } of manifests) {
    const enabled = enabledOverrides[manifest.id] ?? manifest.enabled !== false
    if (!enabled) {
      console.log(`[PluginLoader] Skipped disabled plugin: ${manifest.id}`)
      continue
    }

    const plugin = await loadRuntimePlugin(pluginDir, manifest)
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
  manifest: RuntimePluginManifest
): Promise<SDKPlugin | null> {
  try {
    const mainFile = manifest.main || 'index.mjs'
    const mainPath = resolve(pluginDir, mainFile)
    if (!existsSync(mainPath)) {
      console.warn(`[PluginLoader] Plugin "${manifest.id}" main file not found:`, mainPath)
      return null
    }

    const assetsDir = manifest.assets ? resolve(pluginDir, manifest.assets) : pluginDir
    const module = await import(pathToFileURL(mainPath).toString())
    const factory = module.default || module.createPlugin
    if (typeof factory !== 'function') {
      console.warn(`[PluginLoader] Plugin "${manifest.id}" does not export a plugin factory`)
      return null
    }

    const plugin = await (factory as RuntimePluginFactory)({
      pluginDir,
      assetsDir,
      config: manifest.config ?? {},
      resolveAsset: (assetPath: string) => resolve(assetsDir, assetPath),
    } as SDKPluginContext)

    console.log(`[PluginLoader] Loaded plugin: ${plugin.id}${manifest.version ? `@${manifest.version}` : ''}`)
    return plugin
  } catch (error) {
    console.error(`[PluginLoader] Failed to load plugin from ${pluginDir}:`, error)
    return null
  }
}
