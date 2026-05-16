/**
 * SQLite-backed registry for runtime-managed agents.
 */
import { generateId } from '@her-text/core'
import { mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import {
  parseJsonValue,
  runSqlite,
  runSqliteJson,
  sqlText,
} from '../memory/sqlite-runtime.js'
import type { HardAgentManifest } from './hard-agent.js'
import type {
  CreateSoftAgentInput,
  RuntimeAgentRecord,
  RuntimeAgentStatus,
  RuntimeAgentUsage,
  SoftAgentArtifact,
} from './types.js'

const AGENT_SOCIETY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS runtime_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'disabled')),
  mode TEXT NOT NULL CHECK(mode IN ('soft', 'hard')),
  capabilities TEXT NOT NULL,
  inherited_capabilities TEXT NOT NULL,
  own_capabilities TEXT NOT NULL,
  routing_policy TEXT NOT NULL,
  artifact_ref TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS soft_agent_artifacts (
  agent_id TEXT PRIMARY KEY,
  instructions TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_agent_usage (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  task_id TEXT,
  event_id TEXT,
  outcome TEXT NOT NULL CHECK(outcome IN ('success', 'failure', 'neutral')),
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runtime_agents_status ON runtime_agents(status);
CREATE INDEX IF NOT EXISTS idx_runtime_agent_usage_agent ON runtime_agent_usage(agent_id);
`

interface AgentRow {
  id: string
  name: string
  purpose: string
  status: RuntimeAgentStatus
  mode: 'soft' | 'hard'
  capabilities: string
  inherited_capabilities: string
  own_capabilities: string
  routing_policy: string
  artifact_ref: string
  version: number
  created_at: number
  updated_at: number
}

interface SoftArtifactRow {
  agent_id: string
  instructions: string
  created_at: number
  updated_at: number
}

interface AgentUsageRow {
  id: string
  agent_id: string
  task_id: string | null
  event_id: string | null
  outcome: RuntimeAgentUsage['outcome']
  summary: string
  created_at: number
}

export class AgentSocietyStore {
  private persistenceEnabled = false
  private readonly dbPath: string

  constructor(storageDir: string) {
    const resolvedStorageDir = isAbsolute(storageDir)
      ? storageDir
      : resolve(process.cwd(), storageDir)
    this.dbPath = resolve(resolvedStorageDir, 'agent-society.sqlite3')
  }

  async initialize(): Promise<void> {
    try {
      await mkdir(dirname(this.dbPath), { recursive: true })
      await runSqlite(this.dbPath, AGENT_SOCIETY_SCHEMA_SQL)
      this.persistenceEnabled = true
      console.log('[AgentSocietyStore] Initialized with SQLite persistence:', this.dbPath)
    } catch (error) {
      console.error('[AgentSocietyStore] Failed to initialize persistence:', error)
      console.log('[AgentSocietyStore] Continuing in disabled persistence mode')
    }
  }

  async createSoftAgent(input: CreateSoftAgentInput): Promise<RuntimeAgentRecord> {
    this.assertPersistence()
    const now = Date.now()
    const record: RuntimeAgentRecord = {
      id: input.id,
      name: input.name,
      purpose: input.purpose,
      status: input.status ?? 'draft',
      mode: 'soft',
      capabilities: input.capabilities ?? [],
      inheritedCapabilities: input.inheritedCapabilities ?? ['tools', 'memory', 'runtime.events'],
      ownCapabilities: input.ownCapabilities ?? [],
      routingPolicy: input.routingPolicy ?? input.purpose,
      artifactRef: `soft:${input.id}`,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }

    await runSqlite(
      this.dbPath,
      `
      INSERT INTO runtime_agents (
        id,
        name,
        purpose,
        status,
        mode,
        capabilities,
        inherited_capabilities,
        own_capabilities,
        routing_policy,
        artifact_ref,
        version,
        created_at,
        updated_at
      ) VALUES (
        ${sqlText(record.id)},
        ${sqlText(record.name)},
        ${sqlText(record.purpose)},
        ${sqlText(record.status)},
        ${sqlText(record.mode)},
        ${sqlText(JSON.stringify(record.capabilities))},
        ${sqlText(JSON.stringify(record.inheritedCapabilities))},
        ${sqlText(JSON.stringify(record.ownCapabilities))},
        ${sqlText(record.routingPolicy)},
        ${sqlText(record.artifactRef)},
        ${record.version},
        ${record.createdAt},
        ${record.updatedAt}
      );

      INSERT INTO soft_agent_artifacts (
        agent_id,
        instructions,
        created_at,
        updated_at
      ) VALUES (
        ${sqlText(record.id)},
        ${sqlText(input.instructions)},
        ${now},
        ${now}
      );
      `
    )

    return record
  }

  async registerHardAgent(manifest: HardAgentManifest, artifactRoot: string): Promise<RuntimeAgentRecord> {
    this.assertPersistence()
    const now = Date.now()
    const existing = await this.getAgent(manifest.id).catch(() => null)
    const record: RuntimeAgentRecord = {
      id: manifest.id,
      name: manifest.name,
      purpose: manifest.purpose ?? manifest.name,
      status: existing?.status ?? 'draft',
      mode: 'hard',
      capabilities: manifest.capabilities,
      inheritedCapabilities: manifest.inherits ?? [],
      ownCapabilities: manifest.ownCapabilities?.map(capability => capability.id) ?? [],
      routingPolicy: manifest.purpose ?? manifest.name,
      artifactRef: artifactRoot,
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }

    await runSqlite(
      this.dbPath,
      `
      INSERT OR REPLACE INTO runtime_agents (
        id,
        name,
        purpose,
        status,
        mode,
        capabilities,
        inherited_capabilities,
        own_capabilities,
        routing_policy,
        artifact_ref,
        version,
        created_at,
        updated_at
      ) VALUES (
        ${sqlText(record.id)},
        ${sqlText(record.name)},
        ${sqlText(record.purpose)},
        ${sqlText(record.status)},
        ${sqlText(record.mode)},
        ${sqlText(JSON.stringify(record.capabilities))},
        ${sqlText(JSON.stringify(record.inheritedCapabilities))},
        ${sqlText(JSON.stringify(record.ownCapabilities))},
        ${sqlText(record.routingPolicy)},
        ${sqlText(record.artifactRef)},
        ${record.version},
        ${record.createdAt},
        ${record.updatedAt}
      );
      `
    )

    return record
  }

  async listAgents(status?: RuntimeAgentStatus): Promise<RuntimeAgentRecord[]> {
    this.assertPersistence()
    const where = status ? `WHERE status = ${sqlText(status)}` : ''
    const rows = await runSqliteJson<AgentRow>(
      this.dbPath,
      `
      SELECT * FROM runtime_agents
      ${where}
      ORDER BY updated_at DESC;
      `
    )
    return rows.map(mapAgentRow)
  }

  async getAgent(id: string): Promise<RuntimeAgentRecord | null> {
    this.assertPersistence()
    const rows = await runSqliteJson<AgentRow>(
      this.dbPath,
      `
      SELECT * FROM runtime_agents
      WHERE id = ${sqlText(id)}
      LIMIT 1;
      `
    )
    return rows[0] ? mapAgentRow(rows[0]) : null
  }

  async getSoftArtifact(agentId: string): Promise<SoftAgentArtifact | null> {
    this.assertPersistence()
    const rows = await runSqliteJson<SoftArtifactRow>(
      this.dbPath,
      `
      SELECT * FROM soft_agent_artifacts
      WHERE agent_id = ${sqlText(agentId)}
      LIMIT 1;
      `
    )
    const row = rows[0]
    return row
      ? {
          id: row.agent_id,
          instructions: row.instructions,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      : null
  }

  async setAgentStatus(id: string, status: RuntimeAgentStatus): Promise<void> {
    this.assertPersistence()
    await runSqlite(
      this.dbPath,
      `
      UPDATE runtime_agents
      SET status = ${sqlText(status)}, updated_at = ${Date.now()}
      WHERE id = ${sqlText(id)};
      `
    )
  }

  async recordUsage(input: {
    agentId: string
    taskId?: string
    eventId?: string
    outcome: RuntimeAgentUsage['outcome']
    summary: string
  }): Promise<RuntimeAgentUsage> {
    this.assertPersistence()
    const usage: RuntimeAgentUsage = {
      id: generateId(),
      agentId: input.agentId,
      taskId: input.taskId,
      eventId: input.eventId,
      outcome: input.outcome,
      summary: input.summary,
      createdAt: Date.now(),
    }

    await runSqlite(
      this.dbPath,
      `
      INSERT INTO runtime_agent_usage (
        id,
        agent_id,
        task_id,
        event_id,
        outcome,
        summary,
        created_at
      ) VALUES (
        ${sqlText(usage.id)},
        ${sqlText(usage.agentId)},
        ${usage.taskId ? sqlText(usage.taskId) : 'NULL'},
        ${usage.eventId ? sqlText(usage.eventId) : 'NULL'},
        ${sqlText(usage.outcome)},
        ${sqlText(usage.summary)},
        ${usage.createdAt}
      );
      `
    )

    return usage
  }

  async listUsage(agentId: string, limit = 50): Promise<RuntimeAgentUsage[]> {
    this.assertPersistence()
    const rows = await runSqliteJson<AgentUsageRow>(
      this.dbPath,
      `
      SELECT * FROM runtime_agent_usage
      WHERE agent_id = ${sqlText(agentId)}
      ORDER BY created_at DESC
      LIMIT ${Math.max(1, Math.min(500, Math.floor(limit) || 1))};
      `
    )
    return rows.map(mapUsageRow)
  }

  async shutdown(): Promise<void> {
    return
  }

  private assertPersistence(): void {
    if (!this.persistenceEnabled) {
      throw new Error('Agent society persistence is not initialized')
    }
  }
}

function mapAgentRow(row: AgentRow): RuntimeAgentRecord {
  return {
    id: row.id,
    name: row.name,
    purpose: row.purpose,
    status: row.status,
    mode: row.mode,
    capabilities: parseStringArray(row.capabilities),
    inheritedCapabilities: parseStringArray(row.inherited_capabilities),
    ownCapabilities: parseStringArray(row.own_capabilities),
    routingPolicy: row.routing_policy,
    artifactRef: row.artifact_ref,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapUsageRow(row: AgentUsageRow): RuntimeAgentUsage {
  return {
    id: row.id,
    agentId: row.agent_id,
    taskId: row.task_id ?? undefined,
    eventId: row.event_id ?? undefined,
    outcome: row.outcome,
    summary: row.summary,
    createdAt: row.created_at,
  }
}

function parseStringArray(value: string): string[] {
  const parsed = parseJsonValue(value)
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
}
