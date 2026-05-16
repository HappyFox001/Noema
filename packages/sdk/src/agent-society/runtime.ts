/**
 * Runtime for lightweight specialized agents.
 */
import type { Tool } from '@her-text/types'
import type { AgentCore } from '../agent/index.js'
import type { MemoryEngine } from '../memory/index.js'
import type { RuntimeEventBus } from '../runtime/index.js'
import { resolve } from 'node:path'
import { CapabilityBroker, HardAgentArtifactLoader } from './hard-agent.js'
import { AgentSocietyStore } from './store.js'
import type {
  AgentRunContext,
  AgentRunInput,
  AgentRunResult,
  CreateSoftAgentInput,
  RuntimeAgentRecord,
  RuntimeAgentStatus,
} from './types.js'

export interface AgentSocietyRuntimeOptions {
  storageDir: string
  agentCore: AgentCore
  memory: MemoryEngine
  runtimeEvents: RuntimeEventBus
}

export class AgentSocietyRuntime {
  public readonly store: AgentSocietyStore
  private readonly hardAgentLoader: HardAgentArtifactLoader
  private readonly capabilityBroker = new CapabilityBroker()

  constructor(private options: AgentSocietyRuntimeOptions) {
    this.store = new AgentSocietyStore(options.storageDir)
    this.hardAgentLoader = new HardAgentArtifactLoader(resolve(options.storageDir, 'agents'))
  }

  async initialize(): Promise<void> {
    await this.store.initialize()
  }

  async createSoftAgent(input: CreateSoftAgentInput): Promise<RuntimeAgentRecord> {
    const record = await this.store.createSoftAgent(input)
    this.options.runtimeEvents.emit({
      name: 'agent.created',
      payload: {
        agentId: record.id,
        mode: record.mode,
        status: record.status,
        purpose: record.purpose,
      },
    })
    return record
  }

  async listAgents(status?: RuntimeAgentStatus): Promise<RuntimeAgentRecord[]> {
    return this.store.listAgents(status)
  }

  async run(agentId: string, input: AgentRunInput): Promise<AgentRunResult> {
    const agent = await this.store.getAgent(agentId)
    if (!agent) {
      throw new Error(`Runtime agent not found: ${agentId}`)
    }
    if (agent.status !== 'active') {
      throw new Error(`Runtime agent is not active: ${agentId}`)
    }

    this.options.runtimeEvents.emit({
      name: 'agent.routed',
      taskId: input.taskId,
      payload: {
        agentId,
        task: input.task,
      },
    })

    const artifact = agent.mode === 'soft'
      ? await this.store.getSoftArtifact(agent.id)
      : null
    const result = agent.mode === 'soft' && artifact
      ? await this.runSoftAgent(agent, artifact.instructions, input)
      : agent.mode === 'hard'
        ? await this.runHardAgent(agent, input)
        : {
            agentId,
            success: false,
            summary: `Agent mode is not runnable yet: ${agent.mode}`,
            error: 'Unsupported agent mode',
          }

    await this.store.recordUsage({
      agentId,
      taskId: input.taskId,
      eventId: input.eventId,
      outcome: result.success ? 'success' : 'failure',
      summary: result.summary,
    })
    this.options.runtimeEvents.emit({
      name: 'agent.completed',
      taskId: input.taskId,
      payload: {
        agentId,
        success: result.success,
        summary: result.summary,
        ...(result.error ? { error: result.error } : {}),
      },
    })
    return result
  }

  async setAgentStatus(agentId: string, status: RuntimeAgentStatus): Promise<void> {
    await this.store.setAgentStatus(agentId, status)
  }

  async verifyHardAgent(agentId: string): Promise<{ success: boolean; errors: string[] }> {
    const result = await this.hardAgentLoader.verify(agentId)
    return { success: result.success, errors: result.errors }
  }

  async registerHardAgent(agentId: string): Promise<RuntimeAgentRecord> {
    const artifact = await this.hardAgentLoader.load(agentId)
    const verification = await this.hardAgentLoader.verify(agentId)
    if (!verification.success) {
      throw new Error(`Hard agent verification failed: ${verification.errors.join('; ')}`)
    }
    const record = await this.store.registerHardAgent(artifact.manifest, artifact.rootDir)
    this.options.runtimeEvents.emit({
      name: 'agent.created',
      payload: {
        agentId: record.id,
        mode: record.mode,
        status: record.status,
        purpose: record.purpose,
      },
    })
    return record
  }

  async unloadAgent(agentId: string): Promise<void> {
    await this.store.setAgentStatus(agentId, 'disabled')
  }

  async shutdown(): Promise<void> {
    await this.store.shutdown()
  }

  private async runSoftAgent(
    agent: RuntimeAgentRecord,
    instructions: string,
    input: AgentRunInput
  ): Promise<AgentRunResult> {
    const context = this.createRunContext(agent, input)
    return context.done({
      summary: [
        `Soft agent "${agent.name}" prepared a runtime plan.`,
        `Purpose: ${agent.purpose}`,
        `Instructions: ${instructions}`,
      ].join('\n'),
      facts: [
        `Task: ${input.task}`,
        `Inherited tools: ${context.tools.length}`,
      ],
      data: {
        instructions,
        context: input.context ?? {},
      },
    })
  }

  private async runHardAgent(agent: RuntimeAgentRecord, input: AgentRunInput): Promise<AgentRunResult> {
    try {
      const artifact = await this.hardAgentLoader.load(agent.id)
      const module = await this.hardAgentLoader.loadModule(artifact)
      const context = this.createRunContext(agent, input)
      const registeredTools = await module.registerTools?.(context) ?? []
      const tools = [
        ...this.capabilityBroker.resolveTools({
          agent,
          manifest: artifact.manifest,
          inheritedTools: context.tools,
        }),
        ...registeredTools,
      ]
      const result = await module.run(input, {
        ...context,
        tools,
      })
      return {
        ...result,
        agentId: agent.id,
      }
    } catch (error) {
      return {
        agentId: agent.id,
        success: false,
        summary: 'Hard agent execution failed.',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private createRunContext(agent: RuntimeAgentRecord, input: AgentRunInput): AgentRunContext {
    return {
      agent,
      input,
      tools: this.resolveInheritedTools(agent),
      memory: this.options.memory,
      runtimeEvents: this.options.runtimeEvents,
      done: (result) => ({
        agentId: agent.id,
        success: true,
        summary: result.summary,
        facts: result.facts,
        data: result.data,
      }),
      fail: (error, result = {}) => ({
        agentId: agent.id,
        success: false,
        summary: result.summary ?? error,
        facts: result.facts,
        data: result.data,
        error,
      }),
    }
  }

  private resolveInheritedTools(agent: RuntimeAgentRecord): Tool[] {
    if (!agent.inheritedCapabilities.includes('tools')) {
      return []
    }
    return this.options.agentCore.getTools()
  }
}
