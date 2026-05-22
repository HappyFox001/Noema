/**
 * Hot-plug hard agent artifact loading and capability contracts.
 */
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { Tool } from '../tools/types.js'
import type { AgentRunContext, AgentRunInput, AgentRunResult, RuntimeAgentRecord } from './types.js'

export type HardAgentProviderType = 'worker' | 'mcp' | 'native-helper' | 'local-model' | 'cli'
export type HardAgentCapabilityRisk = 'safe' | 'read' | 'write' | 'external' | 'destructive' | 'computer'

export interface HardAgentOwnCapabilityManifest {
  id: string
  entry: string
  risk: HardAgentCapabilityRisk
  description?: string
}

export interface HardAgentExternalProviderManifest {
  id: string
  type: HardAgentProviderType
  entry?: string
  command?: string
  permissions?: string[]
}

export interface HardAgentManifest {
  id: string
  name: string
  version: string
  entry: string
  mode: 'hard'
  purpose?: string
  capabilities: string[]
  inherits?: string[]
  permissions?: string[]
  hotReload?: boolean
  ownCapabilities?: HardAgentOwnCapabilityManifest[]
  externalProviders?: HardAgentExternalProviderManifest[]
}

export interface HardAgentModule {
  id?: string
  run(input: AgentRunInput, context: AgentRunContext): Promise<AgentRunResult> | AgentRunResult
  registerTools?(context: AgentRunContext): Promise<Tool[]> | Tool[]
}

export interface HardAgentArtifact {
  manifest: HardAgentManifest
  rootDir: string
  entryPath: string
}

export interface CapabilityBrokerContext {
  agent: RuntimeAgentRecord
  manifest?: HardAgentManifest
  inheritedTools: Tool[]
}

export class CapabilityBroker {
  resolveTools(context: CapabilityBrokerContext): Tool[] {
    if (!context.agent.inheritedCapabilities.includes('tools')) {
      return []
    }
    return context.inheritedTools
  }

  describeCapabilities(context: CapabilityBrokerContext): string[] {
    return [
      ...context.agent.inheritedCapabilities,
      ...context.agent.ownCapabilities,
      ...(context.manifest?.capabilities ?? []),
    ]
  }
}

export class HardAgentArtifactLoader {
  constructor(private artifactsDir: string) {}

  async load(agentId: string): Promise<HardAgentArtifact> {
    const rootDir = resolve(this.artifactsDir, agentId)
    const manifestPath = resolve(rootDir, 'agent.manifest.json')
    if (!existsSync(manifestPath)) {
      throw new Error(`Hard agent manifest not found: ${manifestPath}`)
    }

    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as HardAgentManifest
    validateHardAgentManifest(manifest)
    if (manifest.id !== agentId) {
      throw new Error(`Hard agent manifest id mismatch: expected ${agentId}, got ${manifest.id}`)
    }

    const entryPath = resolve(rootDir, manifest.entry)
    if (!isInside(rootDir, entryPath)) {
      throw new Error(`Hard agent entry must stay inside artifact directory: ${manifest.entry}`)
    }
    if (!existsSync(entryPath)) {
      throw new Error(`Hard agent entry not found: ${entryPath}`)
    }

    return { manifest, rootDir, entryPath }
  }

  async loadModule(artifact: HardAgentArtifact): Promise<HardAgentModule> {
    const cacheBuster = artifact.manifest.hotReload ? `?t=${Date.now()}` : ''
    const module = await import(`${pathToFileURL(artifact.entryPath).toString()}${cacheBuster}`)
    const value = module.default ?? module.agent
    if (!value || typeof value.run !== 'function') {
      throw new Error(`Hard agent module must export default object with run(): ${artifact.entryPath}`)
    }
    return value as HardAgentModule
  }

  async verify(agentId: string): Promise<{ success: boolean; errors: string[]; manifest?: HardAgentManifest }> {
    try {
      const artifact = await this.load(agentId)
      await this.loadModule(artifact)
      return { success: true, errors: [], manifest: artifact.manifest }
    } catch (error) {
      return {
        success: false,
        errors: [error instanceof Error ? error.message : String(error)],
      }
    }
  }
}

function validateHardAgentManifest(manifest: HardAgentManifest): void {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Hard agent manifest must be an object')
  }
  if (!manifest.id || typeof manifest.id !== 'string') {
    throw new Error('Hard agent manifest requires string id')
  }
  if (!manifest.name || typeof manifest.name !== 'string') {
    throw new Error('Hard agent manifest requires string name')
  }
  if (!manifest.version || typeof manifest.version !== 'string') {
    throw new Error('Hard agent manifest requires string version')
  }
  if (manifest.mode !== 'hard') {
    throw new Error('Hard agent manifest mode must be "hard"')
  }
  if (!manifest.entry || typeof manifest.entry !== 'string') {
    throw new Error('Hard agent manifest requires string entry')
  }
  if (!Array.isArray(manifest.capabilities)) {
    throw new Error('Hard agent manifest requires capabilities array')
  }
}

function isInside(rootDir: string, targetPath: string): boolean {
  const root = withTrailingSeparator(resolve(rootDir))
  const target = resolve(targetPath)
  return target.startsWith(root)
}

function withTrailingSeparator(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}
