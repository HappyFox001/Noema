/**
 * Shared learning asset contracts for runtime-level self-learning.
 */
import type { RuntimeEvent } from '../runtime/index.js'

export type LearningCandidateKind = 'skill' | 'routine' | 'agent'
export type LearningCandidateStatus = 'pending' | 'approved' | 'rejected' | 'deployed'
export type LearningAssetStatus = 'draft' | 'active' | 'disabled' | 'archived'
export type LearningAutomationDecisionAction =
  | 'reflected'
  | 'candidate_created'
  | 'auto_deployed'
  | 'kept_pending'
  | 'rollback'

export interface LearningEventRecord {
  id: string
  name: RuntimeEvent['name']
  timestamp: number
  correlationId?: string
  turnId?: string
  taskId?: string
  payload: unknown
}

export interface ReflectionRecord {
  id: string
  sourceEventIds: string[]
  summary: string
  failures: string[]
  inefficiencies: string[]
  reusablePatterns: string[]
  structuralNeeds: string[]
  createdAt: number
}

export interface LearningCandidate {
  id: string
  kind: LearningCandidateKind
  sourceEventIds: string[]
  reason: string
  evidence: string[]
  expectedBenefit: string
  risk: string
  confidence: number
  status: LearningCandidateStatus
  createdAt: number
  updatedAt: number
}

export interface LearningAsset {
  id: string
  kind: LearningCandidateKind
  scope: string
  content: unknown
  status: LearningAssetStatus
  sourceCandidateId?: string
  version: number
  confidence: number
  createdAt: number
  updatedAt: number
}

export interface LearningAssetUsage {
  id: string
  assetId: string
  eventId?: string
  taskId?: string
  outcome: 'success' | 'failure' | 'neutral'
  note?: string
  createdAt: number
}

export interface LearningAutomationDecision {
  id: string
  action: LearningAutomationDecisionAction
  candidateId?: string
  assetId?: string
  reason: string
  risk: 'low' | 'medium' | 'high'
  createdAt: number
}

export interface LearningAssetRollback {
  id: string
  assetId: string
  previousStatus: LearningAssetStatus
  restoredStatus: LearningAssetStatus
  reason: string
  createdAt: number
}

export interface SkillLearningContent {
  trigger: string[]
  workflow: string
  tools?: string[]
  reusableSteps: string[]
  verification?: string[]
}

export interface RoutinePolicy {
  scope: 'dialogue' | 'task' | 'voice' | 'output' | 'persona'
  condition: string
  behavior: string
  source: 'explicit_user_preference' | 'observed_pattern' | 'system_reflection'
  confidence: number
  expiresAt?: number
}

export interface CreateReflectionInput {
  sourceEventIds: string[]
  summary: string
  failures?: string[]
  inefficiencies?: string[]
  reusablePatterns?: string[]
  structuralNeeds?: string[]
}

export interface CreateLearningCandidateInput {
  kind: LearningCandidateKind
  sourceEventIds: string[]
  reason: string
  evidence?: string[]
  expectedBenefit: string
  risk: string
  confidence: number
  status?: LearningCandidateStatus
}

export interface CreateLearningAssetInput {
  kind: LearningCandidateKind
  scope: string
  content: unknown
  sourceCandidateId?: string
  confidence: number
  status?: LearningAssetStatus
}

export interface RecordLearningAssetUsageInput {
  assetId: string
  eventId?: string
  taskId?: string
  outcome: LearningAssetUsage['outcome']
  note?: string
}

export interface RecordLearningAutomationDecisionInput {
  action: LearningAutomationDecisionAction
  candidateId?: string
  assetId?: string
  reason: string
  risk: LearningAutomationDecision['risk']
}

export interface DeployCandidateInput {
  candidateId: string
  scope: string
  content?: unknown
  status?: LearningAssetStatus
}
