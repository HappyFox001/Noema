/**
 * Runtime for lightweight specialized agents.
 */
import type { Tool } from '../tools/types.js'
import type { AgentCore } from '../agent/index.js'
import type { MemoryEngine } from '../memory/index.js'
import type { RuntimeEventBus, RuntimeJobManager, RuntimeJobUnregister } from '../runtime/index.js'
import { resolve } from 'node:path'
import { CapabilityBroker, HardAgentArtifactLoader } from './hard-agent.js'
import { AgentSocietyStore } from './store.js'
import type {
  AgentRunContext,
  AgentRunInput,
  AgentRunResult,
  AgentRoutingDecision,
  CreateSoftAgentInput,
  RuntimeAgentRecord,
  RuntimeAgentStatus,
} from './types.js'

export interface AgentSocietyRuntimeOptions {
  storageDir: string
  agentCore: AgentCore
  memory: MemoryEngine
  runtimeEvents: RuntimeEventBus
  runtimeJobs: RuntimeJobManager
}

export class AgentSocietyRuntime {
  public readonly store: AgentSocietyStore
  private readonly hardAgentLoader: HardAgentArtifactLoader
  private readonly capabilityBroker = new CapabilityBroker()
  private unregisterAgentRunJob?: RuntimeJobUnregister
  private unregisterCreateSoftJob?: RuntimeJobUnregister
  private unregisterVerifyHardJob?: RuntimeJobUnregister
  private unregisterRegisterHardJob?: RuntimeJobUnregister
  private unregisterPromoteHardJob?: RuntimeJobUnregister

  constructor(private options: AgentSocietyRuntimeOptions) {
    this.store = new AgentSocietyStore(options.storageDir)
    this.hardAgentLoader = new HardAgentArtifactLoader(resolve(options.storageDir, 'agents'))
  }

  async initialize(): Promise<void> {
    await this.store.initialize()
    this.unregisterAgentRunJob = this.options.runtimeJobs.register<AgentRunInput, AgentRunResult>(
      'agent.run',
      async (input, context) => {
        if (!input.agentId) {
          throw new Error('agent.run job requires input.agentId')
        }
        return this.run(input.agentId, input, context.signal)
      },
      { concurrency: 4 }
    )
    this.unregisterCreateSoftJob = this.options.runtimeJobs.register<CreateSoftAgentInput, RuntimeAgentRecord>(
      'agent.createSoft',
      (input) => this.createSoftAgent(input),
      { concurrency: 1 }
    )
    this.unregisterVerifyHardJob = this.options.runtimeJobs.register<{ agentId: string }, { success: boolean; errors: string[] }>(
      'agent.verifyHard',
      (input) => this.verifyHardAgent(input.agentId),
      { concurrency: 1 }
    )
    this.unregisterRegisterHardJob = this.options.runtimeJobs.register<{ agentId: string }, RuntimeAgentRecord>(
      'agent.registerHard',
      (input) => this.registerHardAgent(input.agentId),
      { concurrency: 1 }
    )
    this.unregisterPromoteHardJob = this.options.runtimeJobs.register<{ agentId: string; reason: string }, {
      agentId: string
      reason: string
      status: 'suggested'
    }>(
      'agent.promoteHard',
      (input) => ({
        agentId: input.agentId,
        reason: input.reason,
        status: 'suggested',
      }),
      { concurrency: 1 }
    )
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

  async listAgentUsage(agentId: string, limit = 50) {
    return this.store.listUsage(agentId, limit)
  }

  async selectAgentForTask(task: string): Promise<AgentRoutingDecision | null> {
    const agents = await this.store.listAgents('active')
    const scored = agents
      .map(agent => scoreAgentForTask(agent, task))
      .filter((decision): decision is AgentRoutingDecision => decision !== null)
      .sort((a, b) => b.score - a.score)

    return scored[0] ?? null
  }

  async run(agentId: string, input: AgentRunInput, signal?: AbortSignal): Promise<AgentRunResult> {
    if (signal?.aborted) {
      return {
        agentId,
        success: false,
        summary: 'Agent run was cancelled before start.',
        error: 'Agent run was cancelled before start.',
      }
    }

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
      ? await this.runSoftAgent(agent, artifact.instructions, input, signal)
      : agent.mode === 'hard'
        ? await this.runHardAgent(agent, input, signal)
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
    this.unregisterAgentRunJob?.()
    this.unregisterAgentRunJob = undefined
    this.unregisterCreateSoftJob?.()
    this.unregisterCreateSoftJob = undefined
    this.unregisterVerifyHardJob?.()
    this.unregisterVerifyHardJob = undefined
    this.unregisterRegisterHardJob?.()
    this.unregisterRegisterHardJob = undefined
    this.unregisterPromoteHardJob?.()
    this.unregisterPromoteHardJob = undefined
    await this.store.shutdown()
  }

  private async runSoftAgent(
    agent: RuntimeAgentRecord,
    instructions: string,
    input: AgentRunInput,
    signal?: AbortSignal
  ): Promise<AgentRunResult> {
    const context = this.createRunContext(agent, input, signal)
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

  private async runHardAgent(agent: RuntimeAgentRecord, input: AgentRunInput, signal?: AbortSignal): Promise<AgentRunResult> {
    try {
      const artifact = await this.hardAgentLoader.load(agent.id)
      const module = await this.hardAgentLoader.loadModule(artifact)
      const context = this.createRunContext(agent, input, signal)
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

  private createRunContext(agent: RuntimeAgentRecord, input: AgentRunInput, signal?: AbortSignal): AgentRunContext {
    return {
      agent,
      input,
      signal,
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

function scoreAgentForTask(agent: RuntimeAgentRecord, task: string): AgentRoutingDecision | null {
  const taskTokens = tokenizeForRouting(task)
  if (taskTokens.size === 0) {
    return null
  }

  const policyTokens = tokenizeForRouting([
    agent.name,
    agent.purpose,
    agent.routingPolicy,
    ...agent.capabilities,
    ...agent.ownCapabilities,
  ].join(' '))

  let overlap = 0
  for (const token of taskTokens) {
    if (policyTokens.has(token)) {
      overlap += 1
    }
  }

  const score = overlap / Math.max(3, taskTokens.size)
  if (score < 0.25 || overlap < 2) {
    return null
  }

  return {
    agent,
    score,
    reason: `Matched ${overlap} routing tokens with policy "${agent.routingPolicy || agent.purpose}".`,
  }
}

function tokenizeForRouting(value: string): Set<string> {
  const stopWords = new Set([
    'the',
    'and',
    'for',
    'with',
    'this',
    'that',
    'please',
    'task',
    'agent',
    'runtime',
    '一个',
    '这个',
    '那个',
    '请',
    '任务',
    '处理',
  ])
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map(token => token.trim())
    .filter(token => token.length >= 2 && !stopWords.has(token))
  return new Set(tokens)
}
