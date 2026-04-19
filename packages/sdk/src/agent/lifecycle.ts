/**
 * Agent 生命周期管理
 * 参考 codex /core/src/agent/control.rs
 */

export enum AgentStatus {
  PendingInit = 'pending_init',
  Running = 'running',
  Interrupted = 'interrupted',
  Completed = 'completed',
  Errored = 'errored',
  Shutdown = 'shutdown',
  NotFound = 'not_found'
}

export interface AgentMetadata {
  agentId: string
  agentPath?: string
  agentNickname?: string
  agentRole?: string
  lastTaskMessage?: string
  createdAt: number
  updatedAt: number
}

export interface SpawnAgentOptions {
  role?: string
  model?: string
  forkMode?: 'snapshot' | 'clean'
  maxDepth?: number
}

export class AgentInstance {
  public id: string
  public status: AgentStatus
  public metadata: AgentMetadata
  private completionPromise: Promise<string | null>
  private completionResolve?: (value: string | null) => void

  constructor(id: string, metadata: Partial<AgentMetadata> = {}) {
    this.id = id
    this.status = AgentStatus.PendingInit
    this.metadata = {
      agentId: id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...metadata
    }

    // 创建完成 Promise
    this.completionPromise = new Promise(resolve => {
      this.completionResolve = resolve
    })
  }

  updateStatus(status: AgentStatus, message?: string): void {
    this.status = status
    this.metadata.updatedAt = Date.now()

    if (message) {
      this.metadata.lastTaskMessage = message
    }

    // 完成时 resolve
    if (status === AgentStatus.Completed || status === AgentStatus.Errored) {
      this.completionResolve?.(message || null)
    }
  }

  async waitForCompletion(timeout?: number): Promise<string | null> {
    if (timeout) {
      return Promise.race([
        this.completionPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout))
      ])
    }
    return this.completionPromise
  }

  isRunning(): boolean {
    return this.status === AgentStatus.Running
  }

  isCompleted(): boolean {
    return this.status === AgentStatus.Completed || this.status === AgentStatus.Errored
  }
}

/**
 * Agent 注册表 - 管理活跃的 agent 实例
 * 参考 codex /core/src/agent/registry.rs
 */
export class AgentRegistry {
  private agents: Map<string, AgentInstance> = new Map()
  private totalCount: number = 0
  private maxAgents: number = 10
  private nicknameCounter: number = 0

  register(agent: AgentInstance): void {
    if (this.totalCount >= this.maxAgents) {
      throw new Error(`Agent limit reached: ${this.maxAgents}`)
    }

    this.agents.set(agent.id, agent)
    this.totalCount++
  }

  unregister(agentId: string): boolean {
    const deleted = this.agents.delete(agentId)
    if (deleted) {
      this.totalCount--
    }
    return deleted
  }

  get(agentId: string): AgentInstance | undefined {
    return this.agents.get(agentId)
  }

  getAll(): AgentInstance[] {
    return Array.from(this.agents.values())
  }

  getByRole(role: string): AgentInstance[] {
    return Array.from(this.agents.values()).filter(
      agent => agent.metadata.agentRole === role
    )
  }

  generateNickname(prefix: string = 'agent'): string {
    this.nicknameCounter++
    return `${prefix}-${this.nicknameCounter}`
  }

  getTotalCount(): number {
    return this.totalCount
  }

  setMaxAgents(max: number): void {
    this.maxAgents = max
  }

  canSpawn(): boolean {
    return this.totalCount < this.maxAgents
  }
}
