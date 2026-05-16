/**
 * Contracts for runtime-managed specialized agents.
 */
import type { Tool } from '@her-text/types'
import type { MemoryEngine } from '../memory/index.js'
import type { RuntimeEventBus } from '../runtime/index.js'

export type RuntimeAgentStatus = 'draft' | 'active' | 'disabled'
export type RuntimeAgentMode = 'soft' | 'hard'
export type RuntimeAgentOutcome = 'success' | 'failure' | 'neutral'

export interface RuntimeAgentRecord {
  id: string
  name: string
  purpose: string
  status: RuntimeAgentStatus
  mode: RuntimeAgentMode
  capabilities: string[]
  inheritedCapabilities: string[]
  ownCapabilities: string[]
  routingPolicy: string
  artifactRef: string
  version: number
  createdAt: number
  updatedAt: number
}

export interface RuntimeAgentUsage {
  id: string
  agentId: string
  taskId?: string
  eventId?: string
  outcome: RuntimeAgentOutcome
  summary: string
  createdAt: number
}

export interface CreateSoftAgentInput {
  id: string
  name: string
  purpose: string
  instructions: string
  capabilities?: string[]
  inheritedCapabilities?: string[]
  ownCapabilities?: string[]
  routingPolicy?: string
  status?: RuntimeAgentStatus
}

export interface AgentRunInput {
  task: string
  taskId?: string
  eventId?: string
  context?: Record<string, unknown>
}

export interface AgentRunResult {
  agentId: string
  success: boolean
  summary: string
  facts?: string[]
  data?: unknown
  error?: string
}

export interface SoftAgentArtifact {
  id: string
  instructions: string
  createdAt: number
  updatedAt: number
}

export interface AgentRunContext {
  agent: RuntimeAgentRecord
  input: AgentRunInput
  tools: Tool[]
  memory: MemoryEngine
  runtimeEvents: RuntimeEventBus
  done(result: Omit<AgentRunResult, 'agentId' | 'success'>): AgentRunResult
  fail(error: string, result?: Partial<Omit<AgentRunResult, 'agentId' | 'success' | 'error'>>): AgentRunResult
}
