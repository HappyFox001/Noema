/**
 * SQLite-backed storage for runtime learning events and assets.
 */
import { generateId } from '../utils/index.js'
import { mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import {
  parseJsonValue,
  runSqlite,
  runSqliteJson,
  sqlText,
} from '../memory/sqlite-runtime.js'
import type { RuntimeEvent } from '../runtime/index.js'
import type {
  CreateLearningAssetInput,
  CreateLearningCandidateInput,
  CreateReflectionInput,
  DeployCandidateInput,
  LearningAsset,
  LearningAssetRollback,
  LearningAssetStatus,
  LearningAssetUsage,
  LearningAutomationDecision,
  LearningCandidate,
  LearningCandidateStatus,
  LearningEventRecord,
  RecordLearningAutomationDecisionInput,
  RecordLearningAssetUsageInput,
  ReflectionRecord,
  RoutinePolicy,
  SkillLearningContent,
} from './types.js'

const LEARNING_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS learning_events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  correlation_id TEXT,
  turn_id TEXT,
  task_id TEXT,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reflections (
  id TEXT PRIMARY KEY,
  source_event_ids TEXT NOT NULL,
  summary TEXT NOT NULL,
  failures TEXT NOT NULL,
  inefficiencies TEXT NOT NULL,
  reusable_patterns TEXT NOT NULL,
  structural_needs TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_candidates (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('skill', 'routine', 'agent')),
  source_event_ids TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence TEXT NOT NULL,
  expected_benefit TEXT NOT NULL,
  risk TEXT NOT NULL,
  confidence REAL NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected', 'deployed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_assets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('skill', 'routine', 'agent')),
  scope TEXT NOT NULL,
  content_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'disabled', 'archived')),
  source_candidate_id TEXT,
  version INTEGER NOT NULL,
  confidence REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_usage (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  event_id TEXT,
  task_id TEXT,
  outcome TEXT NOT NULL CHECK(outcome IN ('success', 'failure', 'neutral')),
  note TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_decisions (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK(action IN ('reflected', 'candidate_created', 'auto_deployed', 'kept_pending', 'rollback')),
  candidate_id TEXT,
  asset_id TEXT,
  reason TEXT NOT NULL,
  risk TEXT NOT NULL CHECK(risk IN ('low', 'medium', 'high')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_rollbacks (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  restored_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_learning_events_timestamp ON learning_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_learning_events_correlation ON learning_events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_learning_events_task ON learning_events(task_id);
CREATE INDEX IF NOT EXISTS idx_learning_candidates_status ON learning_candidates(status);
CREATE INDEX IF NOT EXISTS idx_learning_assets_status ON learning_assets(status);
CREATE INDEX IF NOT EXISTS idx_automation_decisions_created ON automation_decisions(created_at);
CREATE INDEX IF NOT EXISTS idx_asset_rollbacks_asset ON asset_rollbacks(asset_id);
`

interface LearningEventRow {
  id: string
  name: RuntimeEvent['name']
  timestamp: number
  correlation_id: string | null
  turn_id: string | null
  task_id: string | null
  payload_json: string
}

interface ReflectionRow {
  id: string
  source_event_ids: string
  summary: string
  failures: string
  inefficiencies: string
  reusable_patterns: string
  structural_needs: string
  created_at: number
}

interface CandidateRow {
  id: string
  kind: LearningCandidate['kind']
  source_event_ids: string
  reason: string
  evidence: string
  expected_benefit: string
  risk: string
  confidence: number
  status: LearningCandidateStatus
  created_at: number
  updated_at: number
}

interface AssetRow {
  id: string
  kind: LearningAsset['kind']
  scope: string
  content_json: string
  status: LearningAssetStatus
  source_candidate_id: string | null
  version: number
  confidence: number
  created_at: number
  updated_at: number
}

interface UsageRow {
  id: string
  asset_id: string
  event_id: string | null
  task_id: string | null
  outcome: LearningAssetUsage['outcome']
  note: string | null
  created_at: number
}

interface AutomationDecisionRow {
  id: string
  action: LearningAutomationDecision['action']
  candidate_id: string | null
  asset_id: string | null
  reason: string
  risk: LearningAutomationDecision['risk']
  created_at: number
}

interface RollbackRow {
  id: string
  asset_id: string
  previous_status: LearningAssetStatus
  restored_status: LearningAssetStatus
  reason: string
  created_at: number
}

export class LearningAssetStore {
  private persistenceEnabled = false
  private writeQueue: Promise<void> = Promise.resolve()
  private readonly dbPath: string

  constructor(storageDir: string) {
    const resolvedStorageDir = isAbsolute(storageDir)
      ? storageDir
      : resolve(process.cwd(), storageDir)
    this.dbPath = resolve(resolvedStorageDir, 'learning.sqlite3')
  }

  async initialize(): Promise<void> {
    try {
      await mkdir(dirname(this.dbPath), { recursive: true })
      await runSqlite(this.dbPath, LEARNING_SCHEMA_SQL)
      this.persistenceEnabled = true
      console.log('[LearningAssetStore] Initialized with SQLite persistence:', this.dbPath)
    } catch (error) {
      console.error('[LearningAssetStore] Failed to initialize persistence:', error)
      console.log('[LearningAssetStore] Continuing in disabled persistence mode')
    }
  }

  recordRuntimeEvent(event: RuntimeEvent): void {
    if (!this.persistenceEnabled) {
      return
    }

    this.enqueueWrite(async () => {
      await runSqlite(
        this.dbPath,
        `
        INSERT OR REPLACE INTO learning_events (
          id,
          name,
          timestamp,
          correlation_id,
          turn_id,
          task_id,
          payload_json
        ) VALUES (
          ${sqlText(event.id)},
          ${sqlText(event.name)},
          ${event.timestamp},
          ${event.correlationId ? sqlText(event.correlationId) : 'NULL'},
          ${event.turnId ? sqlText(event.turnId) : 'NULL'},
          ${event.taskId ? sqlText(event.taskId) : 'NULL'},
          ${sqlText(JSON.stringify(event.payload))}
        );
        `
      )
    })
  }

  async listEvents(limit = 100): Promise<LearningEventRecord[]> {
    await this.flushWrites()
    const rows = await runSqliteJson<LearningEventRow>(
      this.dbPath,
      `
      SELECT * FROM learning_events
      ORDER BY timestamp DESC
      LIMIT ${clampLimit(limit)};
      `
    )
    return rows.reverse().map(mapEventRow)
  }

  async createReflection(input: CreateReflectionInput): Promise<ReflectionRecord> {
    const record: ReflectionRecord = {
      id: generateId(),
      sourceEventIds: input.sourceEventIds,
      summary: input.summary,
      failures: input.failures ?? [],
      inefficiencies: input.inefficiencies ?? [],
      reusablePatterns: input.reusablePatterns ?? [],
      structuralNeeds: input.structuralNeeds ?? [],
      createdAt: Date.now(),
    }

    await runSqlite(
      this.dbPath,
      `
      INSERT INTO reflections (
        id,
        source_event_ids,
        summary,
        failures,
        inefficiencies,
        reusable_patterns,
        structural_needs,
        created_at
      ) VALUES (
        ${sqlText(record.id)},
        ${sqlText(JSON.stringify(record.sourceEventIds))},
        ${sqlText(record.summary)},
        ${sqlText(JSON.stringify(record.failures))},
        ${sqlText(JSON.stringify(record.inefficiencies))},
        ${sqlText(JSON.stringify(record.reusablePatterns))},
        ${sqlText(JSON.stringify(record.structuralNeeds))},
        ${record.createdAt}
      );
      `
    )

    return record
  }

  async listReflections(limit = 50): Promise<ReflectionRecord[]> {
    const rows = await runSqliteJson<ReflectionRow>(
      this.dbPath,
      `
      SELECT * FROM reflections
      ORDER BY created_at DESC
      LIMIT ${clampLimit(limit)};
      `
    )
    return rows.map(mapReflectionRow)
  }

  async createCandidate(input: CreateLearningCandidateInput): Promise<LearningCandidate> {
    const now = Date.now()
    const candidate: LearningCandidate = {
      id: generateId(),
      kind: input.kind,
      sourceEventIds: input.sourceEventIds,
      reason: input.reason,
      evidence: input.evidence ?? [],
      expectedBenefit: input.expectedBenefit,
      risk: input.risk,
      confidence: input.confidence,
      status: input.status ?? 'pending',
      createdAt: now,
      updatedAt: now,
    }

    await runSqlite(
      this.dbPath,
      `
      INSERT INTO learning_candidates (
        id,
        kind,
        source_event_ids,
        reason,
        evidence,
        expected_benefit,
        risk,
        confidence,
        status,
        created_at,
        updated_at
      ) VALUES (
        ${sqlText(candidate.id)},
        ${sqlText(candidate.kind)},
        ${sqlText(JSON.stringify(candidate.sourceEventIds))},
        ${sqlText(candidate.reason)},
        ${sqlText(JSON.stringify(candidate.evidence))},
        ${sqlText(candidate.expectedBenefit)},
        ${sqlText(candidate.risk)},
        ${candidate.confidence},
        ${sqlText(candidate.status)},
        ${candidate.createdAt},
        ${candidate.updatedAt}
      );
      `
    )

    return candidate
  }

  async listCandidates(status?: LearningCandidateStatus, limit = 50): Promise<LearningCandidate[]> {
    const where = status ? `WHERE status = ${sqlText(status)}` : ''
    const rows = await runSqliteJson<CandidateRow>(
      this.dbPath,
      `
      SELECT * FROM learning_candidates
      ${where}
      ORDER BY updated_at DESC
      LIMIT ${clampLimit(limit)};
      `
    )
    return rows.map(mapCandidateRow)
  }

  async getCandidate(id: string): Promise<LearningCandidate | null> {
    const rows = await runSqliteJson<CandidateRow>(
      this.dbPath,
      `
      SELECT * FROM learning_candidates
      WHERE id = ${sqlText(id)}
      LIMIT 1;
      `
    )
    return rows[0] ? mapCandidateRow(rows[0]) : null
  }

  async setCandidateStatus(id: string, status: LearningCandidateStatus): Promise<void> {
    await runSqlite(
      this.dbPath,
      `
      UPDATE learning_candidates
      SET status = ${sqlText(status)}, updated_at = ${Date.now()}
      WHERE id = ${sqlText(id)};
      `
    )
  }

  async createAsset(input: CreateLearningAssetInput): Promise<LearningAsset> {
    const now = Date.now()
    const asset: LearningAsset = {
      id: generateId(),
      kind: input.kind,
      scope: input.scope,
      content: input.content,
      status: input.status ?? 'draft',
      sourceCandidateId: input.sourceCandidateId,
      version: 1,
      confidence: input.confidence,
      createdAt: now,
      updatedAt: now,
    }

    await runSqlite(
      this.dbPath,
      `
      INSERT INTO learning_assets (
        id,
        kind,
        scope,
        content_json,
        status,
        source_candidate_id,
        version,
        confidence,
        created_at,
        updated_at
      ) VALUES (
        ${sqlText(asset.id)},
        ${sqlText(asset.kind)},
        ${sqlText(asset.scope)},
        ${sqlText(JSON.stringify(asset.content))},
        ${sqlText(asset.status)},
        ${asset.sourceCandidateId ? sqlText(asset.sourceCandidateId) : 'NULL'},
        ${asset.version},
        ${asset.confidence},
        ${asset.createdAt},
        ${asset.updatedAt}
      );
      `
    )

    return asset
  }

  async listAssets(status?: LearningAssetStatus, limit = 50): Promise<LearningAsset[]> {
    const where = status ? `WHERE status = ${sqlText(status)}` : ''
    const rows = await runSqliteJson<AssetRow>(
      this.dbPath,
      `
      SELECT * FROM learning_assets
      ${where}
      ORDER BY updated_at DESC
      LIMIT ${clampLimit(limit)};
      `
    )
    return rows.map(mapAssetRow)
  }

  async getAsset(id: string): Promise<LearningAsset | null> {
    const rows = await runSqliteJson<AssetRow>(
      this.dbPath,
      `
      SELECT * FROM learning_assets
      WHERE id = ${sqlText(id)}
      LIMIT 1;
      `
    )
    return rows[0] ? mapAssetRow(rows[0]) : null
  }

  async listActiveSkills(limit = 50): Promise<Array<LearningAsset & { content: SkillLearningContent }>> {
    return (await this.listAssets('active', limit))
      .filter((asset): asset is LearningAsset & { content: SkillLearningContent } =>
        asset.kind === 'skill' && isSkillLearningContent(asset.content)
      )
  }

  async listActiveRoutines(
    scope?: RoutinePolicy['scope'],
    limit = 50
  ): Promise<Array<LearningAsset & { content: RoutinePolicy }>> {
    return (await this.listAssets('active', limit))
      .filter((asset): asset is LearningAsset & { content: RoutinePolicy } =>
        asset.kind === 'routine' &&
        isRoutinePolicy(asset.content) &&
        (!scope || asset.content.scope === scope)
      )
  }

  async deployCandidate(input: DeployCandidateInput): Promise<LearningAsset> {
    const candidate = await this.getCandidate(input.candidateId)
    if (!candidate) {
      throw new Error(`Learning candidate not found: ${input.candidateId}`)
    }

    const asset = await this.createAsset({
      kind: candidate.kind,
      scope: input.scope,
      content: input.content ?? defaultAssetContent(candidate, input.scope),
      sourceCandidateId: candidate.id,
      confidence: candidate.confidence,
      status: input.status ?? 'draft',
    })
    await this.setCandidateStatus(candidate.id, input.status === 'active' ? 'deployed' : 'approved')
    return asset
  }

  async setAssetStatus(id: string, status: LearningAssetStatus): Promise<void> {
    await runSqlite(
      this.dbPath,
      `
      UPDATE learning_assets
      SET status = ${sqlText(status)}, updated_at = ${Date.now()}
      WHERE id = ${sqlText(id)};
      `
    )
  }

  async deleteAsset(id: string): Promise<void> {
    await runSqlite(
      this.dbPath,
      `
      DELETE FROM learning_assets
      WHERE id = ${sqlText(id)};
      `
    )
  }

  async rollbackAsset(id: string, reason: string): Promise<LearningAssetRollback> {
    const asset = await this.getAsset(id)
    if (!asset) {
      throw new Error(`Learning asset not found: ${id}`)
    }

    const rollback: LearningAssetRollback = {
      id: generateId(),
      assetId: id,
      previousStatus: asset.status,
      restoredStatus: 'disabled',
      reason,
      createdAt: Date.now(),
    }

    await runSqlite(
      this.dbPath,
      `
      UPDATE learning_assets
      SET status = ${sqlText(rollback.restoredStatus)}, updated_at = ${rollback.createdAt}
      WHERE id = ${sqlText(id)};

      INSERT INTO asset_rollbacks (
        id,
        asset_id,
        previous_status,
        restored_status,
        reason,
        created_at
      ) VALUES (
        ${sqlText(rollback.id)},
        ${sqlText(rollback.assetId)},
        ${sqlText(rollback.previousStatus)},
        ${sqlText(rollback.restoredStatus)},
        ${sqlText(rollback.reason)},
        ${rollback.createdAt}
      );
      `
    )

    await this.recordAutomationDecision({
      action: 'rollback',
      assetId: id,
      reason,
      risk: 'medium',
    })

    return rollback
  }

  async recordAssetUsage(input: RecordLearningAssetUsageInput): Promise<LearningAssetUsage> {
    const usage: LearningAssetUsage = {
      id: generateId(),
      assetId: input.assetId,
      eventId: input.eventId,
      taskId: input.taskId,
      outcome: input.outcome,
      note: input.note,
      createdAt: Date.now(),
    }

    await runSqlite(
      this.dbPath,
      `
      INSERT INTO asset_usage (
        id,
        asset_id,
        event_id,
        task_id,
        outcome,
        note,
        created_at
      ) VALUES (
        ${sqlText(usage.id)},
        ${sqlText(usage.assetId)},
        ${usage.eventId ? sqlText(usage.eventId) : 'NULL'},
        ${usage.taskId ? sqlText(usage.taskId) : 'NULL'},
        ${sqlText(usage.outcome)},
        ${usage.note ? sqlText(usage.note) : 'NULL'},
        ${usage.createdAt}
      );
      `
    )

    return usage
  }

  async listAssetUsage(assetId: string, limit = 50): Promise<LearningAssetUsage[]> {
    const rows = await runSqliteJson<UsageRow>(
      this.dbPath,
      `
      SELECT * FROM asset_usage
      WHERE asset_id = ${sqlText(assetId)}
      ORDER BY created_at DESC
      LIMIT ${clampLimit(limit)};
      `
    )
    return rows.map(mapUsageRow)
  }

  async recordAutomationDecision(
    input: RecordLearningAutomationDecisionInput
  ): Promise<LearningAutomationDecision> {
    const decision: LearningAutomationDecision = {
      id: generateId(),
      action: input.action,
      candidateId: input.candidateId,
      assetId: input.assetId,
      reason: input.reason,
      risk: input.risk,
      createdAt: Date.now(),
    }

    await runSqlite(
      this.dbPath,
      `
      INSERT INTO automation_decisions (
        id,
        action,
        candidate_id,
        asset_id,
        reason,
        risk,
        created_at
      ) VALUES (
        ${sqlText(decision.id)},
        ${sqlText(decision.action)},
        ${decision.candidateId ? sqlText(decision.candidateId) : 'NULL'},
        ${decision.assetId ? sqlText(decision.assetId) : 'NULL'},
        ${sqlText(decision.reason)},
        ${sqlText(decision.risk)},
        ${decision.createdAt}
      );
      `
    )

    return decision
  }

  async listAutomationDecisions(limit = 50): Promise<LearningAutomationDecision[]> {
    const rows = await runSqliteJson<AutomationDecisionRow>(
      this.dbPath,
      `
      SELECT * FROM automation_decisions
      ORDER BY created_at DESC
      LIMIT ${clampLimit(limit)};
      `
    )
    return rows.map(mapAutomationDecisionRow)
  }

  async listAssetRollbacks(assetId?: string, limit = 50): Promise<LearningAssetRollback[]> {
    const where = assetId ? `WHERE asset_id = ${sqlText(assetId)}` : ''
    const rows = await runSqliteJson<RollbackRow>(
      this.dbPath,
      `
      SELECT * FROM asset_rollbacks
      ${where}
      ORDER BY created_at DESC
      LIMIT ${clampLimit(limit)};
      `
    )
    return rows.map(mapRollbackRow)
  }

  async flushWrites(): Promise<void> {
    await this.writeQueue
  }

  async shutdown(): Promise<void> {
    await this.writeQueue
  }

  private enqueueWrite(task: () => Promise<void>): void {
    this.writeQueue = this.writeQueue
      .then(task)
      .catch((error) => {
        console.error('[LearningAssetStore] Persistence write failed:', error)
      })
  }
}

function mapEventRow(row: LearningEventRow): LearningEventRecord {
  return {
    id: row.id,
    name: row.name,
    timestamp: row.timestamp,
    correlationId: row.correlation_id ?? undefined,
    turnId: row.turn_id ?? undefined,
    taskId: row.task_id ?? undefined,
    payload: parseJsonValue(row.payload_json),
  }
}

function mapReflectionRow(row: ReflectionRow): ReflectionRecord {
  return {
    id: row.id,
    sourceEventIds: parseStringArray(row.source_event_ids),
    summary: row.summary,
    failures: parseStringArray(row.failures),
    inefficiencies: parseStringArray(row.inefficiencies),
    reusablePatterns: parseStringArray(row.reusable_patterns),
    structuralNeeds: parseStringArray(row.structural_needs),
    createdAt: row.created_at,
  }
}

function mapCandidateRow(row: CandidateRow): LearningCandidate {
  return {
    id: row.id,
    kind: row.kind,
    sourceEventIds: parseStringArray(row.source_event_ids),
    reason: row.reason,
    evidence: parseStringArray(row.evidence),
    expectedBenefit: row.expected_benefit,
    risk: row.risk,
    confidence: row.confidence,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapAssetRow(row: AssetRow): LearningAsset {
  return {
    id: row.id,
    kind: row.kind,
    scope: row.scope,
    content: parseJsonValue(row.content_json),
    status: row.status,
    sourceCandidateId: row.source_candidate_id ?? undefined,
    version: row.version,
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapUsageRow(row: UsageRow): LearningAssetUsage {
  return {
    id: row.id,
    assetId: row.asset_id,
    eventId: row.event_id ?? undefined,
    taskId: row.task_id ?? undefined,
    outcome: row.outcome,
    note: row.note ?? undefined,
    createdAt: row.created_at,
  }
}

function mapAutomationDecisionRow(row: AutomationDecisionRow): LearningAutomationDecision {
  return {
    id: row.id,
    action: row.action,
    candidateId: row.candidate_id ?? undefined,
    assetId: row.asset_id ?? undefined,
    reason: row.reason,
    risk: row.risk,
    createdAt: row.created_at,
  }
}

function mapRollbackRow(row: RollbackRow): LearningAssetRollback {
  return {
    id: row.id,
    assetId: row.asset_id,
    previousStatus: row.previous_status,
    restoredStatus: row.restored_status,
    reason: row.reason,
    createdAt: row.created_at,
  }
}

function parseStringArray(value: string): string[] {
  const parsed = parseJsonValue(value)
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
}

function clampLimit(limit: number): number {
  return Math.max(1, Math.min(1000, Math.floor(limit) || 1))
}

function defaultAssetContent(candidate: LearningCandidate, scope: string): unknown {
  if (candidate.kind === 'skill') {
    return {
      trigger: candidate.evidence,
      workflow: candidate.reason,
      reusableSteps: [candidate.expectedBenefit],
      verification: [candidate.risk],
    } satisfies SkillLearningContent
  }

  if (candidate.kind === 'routine') {
    return {
      scope: normalizeRoutineScope(scope),
      condition: candidate.reason,
      behavior: candidate.expectedBenefit,
      source: 'system_reflection',
      confidence: candidate.confidence,
    } satisfies RoutinePolicy
  }

  return {
    purpose: candidate.reason,
    expectedBenefit: candidate.expectedBenefit,
    risk: candidate.risk,
    evidence: candidate.evidence,
  }
}

function normalizeRoutineScope(scope: string): RoutinePolicy['scope'] {
  return scope === 'dialogue' || scope === 'task' || scope === 'voice' || scope === 'output' || scope === 'persona'
    ? scope
    : 'task'
}

function isSkillLearningContent(value: unknown): value is SkillLearningContent {
  const content = value as Partial<SkillLearningContent>
  return Boolean(
    content &&
    Array.isArray(content.trigger) &&
    typeof content.workflow === 'string' &&
    Array.isArray(content.reusableSteps)
  )
}

function isRoutinePolicy(value: unknown): value is RoutinePolicy {
  const content = value as Partial<RoutinePolicy>
  return Boolean(
    content &&
    (content.scope === 'dialogue' || content.scope === 'task' || content.scope === 'voice' || content.scope === 'output' || content.scope === 'persona') &&
    typeof content.condition === 'string' &&
    typeof content.behavior === 'string' &&
    typeof content.confidence === 'number'
  )
}
