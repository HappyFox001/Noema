/**
 * Provides the SDK-side runtime contracts for autonomous character resource generation.
 */
import type {
  CharacterWorkflow,
  CharacterWorkflowEdge,
  CharacterWorkflowLanguage,
  CharacterWorkflowLinkKind,
  CharacterWorkflowNode,
} from './index.js'

export type CharacterAgentPhase =
  | 'ingest'
  | 'interpret'
  | 'plan'
  | 'produce'
  | 'inspect'
  | 'repair'
  | 'package'
  | 'report'
  | 'completed'
  | 'needs_action'
  | 'failed'

export type CharacterAgentModelKind = 'llm' | 'image'
export type CharacterAgentArtifactKind =
  | 'agent-plan'
  | 'task-understanding'
  | 'style-brief'
  | 'constraint-brief'
  | 'source-summary'
  | 'character-card-draft'
  | 'character-card-field'
  | 'character-card-final'
  | 'opening-message'
  | 'opening-layout'
  | 'dialogue-style-guide'
  | 'world-context'
  | 'scene-context'
  | 'image-prompt'
  | 'image-attempt'
  | 'image-asset'
  | 'stale-marker'
  | 'voice-direction'
  | 'voice-asset'
  | 'candidate-pack'
  | 'critique-report'
  | 'quality-report'
  | 'chat-simulation-report'
  | 'export-package'
  | 'generation-report'

export interface CharacterAgentGraphReference {
  workflowId: string
  workflowName: string
  workflowVersion: string
  nodes: CharacterAgentNodeReference[]
  relations: CharacterAgentRelation[]
}

export interface CharacterAgentNodeReference {
  id: string
  type: string
  title: string
  config: Record<string, unknown>
}

export interface CharacterAgentRelation {
  fromNodeId: string
  fromPort: string
  toNodeId: string
  toPort: string
  kind: CharacterWorkflowLinkKind
  meaning: string
}

export interface AgentGoalContext {
  prompt: string
  targetAudience: string
  allowAgentExpansion: boolean
  language: CharacterWorkflowLanguage
  nodeId?: string
}

export interface AgentStylePressure {
  nodeId: string
  preset: string
  prompt: string
  intensity: number
  incomingRelations: CharacterAgentRelation[]
}

export interface AgentConstraint {
  nodeId: string
  mustHave: string[]
  mustNot: string[]
  hardBoundary: boolean
  incomingRelations: CharacterAgentRelation[]
}

export type AgentTargetKind =
  | 'character-card'
  | 'character-field'
  | 'opening-layout'
  | 'image'
  | 'world-card'
  | 'npc-pack'
  | 'npc'
  | 'plot-arc'
  | 'scene-card'

export interface AgentImageGenerationControl {
  nodeId: string
  targetImageCount: number
  imageStyleDomain: string
  stylePrompt: string
  shotType: string
  aspectRatio: string
  consistencyMode: string
  seedMode: string
  incomingRelations: CharacterAgentRelation[]
}

export interface AgentFieldGenerationControl {
  nodeId: string
  fieldPurpose: string
  tone: string
  lengthPolicy: string
  avoidPatterns: string[]
  incomingRelations: CharacterAgentRelation[]
}

export interface AgentContinuityControl {
  nodeId: string
  memoryAnchors: string[]
  progressionPacing: string
  forbidResettingFacts: boolean
  incomingRelations: CharacterAgentRelation[]
}

export interface AgentRelationshipControl {
  nodeId: string
  relationshipMode: string
  tensionRules: string[]
  incomingRelations: CharacterAgentRelation[]
}

export interface AgentTargetContext {
  nodeId: string
  kind: AgentTargetKind
  title: string
  config: Record<string, unknown>
  field?: string
  imageRole?: string
  imageAssetPurpose?: string
  requestedResources: string[]
  incomingRelations: CharacterAgentRelation[]
  localStylePressures: AgentStylePressure[]
  localConstraints: AgentConstraint[]
  imageControls: AgentImageGenerationControl[]
  fieldControls: AgentFieldGenerationControl[]
  continuityControls: AgentContinuityControl[]
  relationshipControls: AgentRelationshipControl[]
}

export interface AgentSourceMaterial {
  nodeId: string
  kind: string
  notes: string
  groundingStrength: number
  incomingRelations: CharacterAgentRelation[]
}

export interface AgentModelCapability {
  nodeId: string
  kind: CharacterAgentModelKind
  apiId: string
  modelName: string
  modelRef: string
  parameters: Record<string, unknown>
}

export interface AgentRetrievalCapability {
  nodeId: string
  enabled: boolean
  mode: string
  citationRequired: boolean
}

export interface AgentVoiceCapability {
  nodeId: string
  provider: string
  voice: string
  speed: number
}

export interface AgentCapabilitySet {
  llmModels: AgentModelCapability[]
  imageModels: AgentModelCapability[]
  retrieval: AgentRetrievalCapability[]
  voice: AgentVoiceCapability[]
}

export interface AgentPolicyContext {
  nodeId?: string
  autonomyLevel: string
  revisionBudget: number
  askUserThreshold: string
  canExpandMissingDetails: boolean
  incomingRelations: CharacterAgentRelation[]
}

export interface AgentStrategyContext {
  nodeId?: string
  mode: string
  branchCount: number
  priorityAssets: string[]
  stopCondition: string
  incomingRelations: CharacterAgentRelation[]
}

export interface AgentCritiquePolicyContext {
  nodeId?: string
  iterations: number
  dimensions: string[]
  autoRepair: boolean
  incomingRelations: CharacterAgentRelation[]
}

export interface AgentAssetTarget {
  nodeId: string
  requested: string[]
  includeAlternates: boolean
  incomingRelations: CharacterAgentRelation[]
}

export type CharacterWorkflowRequirementKind = 'character-field' | 'image'
export type CharacterWorkflowRequirementStatus = 'missing' | 'blocked' | 'done' | 'failed'

export interface CharacterWorkflowRequirement {
  id: string
  kind: CharacterWorkflowRequirementKind
  targetNodeId: string
  title: string
  required: boolean
  field?: string
  imageRole?: string
  requiredCount?: number
  dependencyNodeIds: string[]
  referenceSourceNodeIds: string[]
}

export interface CharacterWorkflowRequirementState extends CharacterWorkflowRequirement {
  status: CharacterWorkflowRequirementStatus
  completedCount: number
  artifactIds: string[]
  missingReason?: string
}

export interface AgentQualityGateContext {
  nodeId?: string
  minimumScore: number
  blockExport: boolean
  requiredChecks: string[]
  incomingRelations: CharacterAgentRelation[]
}

export interface AgentExportTargetContext {
  nodeId?: string
  format: string
  includeAssets: boolean
  incomingRelations: CharacterAgentRelation[]
}

export interface CharacterAgentRunContext {
  runId: string
  language: CharacterWorkflowLanguage
  goal: AgentGoalContext
  targets: AgentTargetContext[]
  stylePressures: AgentStylePressure[]
  hardConstraints: AgentConstraint[]
  imageGenerationControls: AgentImageGenerationControl[]
  fieldGenerationControls: AgentFieldGenerationControl[]
  continuityControls: AgentContinuityControl[]
  relationshipControls: AgentRelationshipControl[]
  sourceMaterials: AgentSourceMaterial[]
  capabilities: AgentCapabilitySet
  policy: AgentPolicyContext
  strategy: AgentStrategyContext
  critique: AgentCritiquePolicyContext
  requestedAssets: AgentAssetTarget[]
  requirements: CharacterWorkflowRequirement[]
  qualityGate: AgentQualityGateContext
  exportTarget: AgentExportTargetContext
  graph: CharacterAgentGraphReference
  compilerWarnings: string[]
}

export type CharacterAgentProtocolIssueCode =
  | 'invalid_snapshot'
  | 'unsupported_workflow_version'
  | 'missing_workflow_id'
  | 'duplicate_node_id'
  | 'missing_edge_endpoint'
  | 'missing_model_ref'
  | 'unresolved_model_ref'

export const CURRENT_CHARACTER_WORKFLOW_VERSION = '3.0'

export interface CharacterAgentProtocolIssue {
  code: CharacterAgentProtocolIssueCode
  severity: 'warning' | 'error'
  path: string
  message: string
}

export interface CharacterAgentWorkflowSnapshot {
  workflow: CharacterWorkflow
  issues: CharacterAgentProtocolIssue[]
}

export interface CharacterAgentModelConfig {
  apiId: string
  modelName: string
  modelRef: string
  kind: CharacterAgentModelKind
  provider?: string
  label?: string
  baseUrl?: string
  metadata?: Record<string, unknown>
}

export interface CharacterAgentModelResolver {
  resolve(modelRef: string, kind: CharacterAgentModelKind): CharacterAgentModelConfig | undefined | Promise<CharacterAgentModelConfig | undefined>
}

export interface ResolvedCharacterAgentCapabilities {
  llmModels: CharacterAgentModelConfig[]
  imageModels: CharacterAgentModelConfig[]
  issues: CharacterAgentProtocolIssue[]
}

export interface CharacterAgentPlanStep {
  id: string
  title: string
  purpose: string
  phase: CharacterAgentPhase
  status: 'pending' | 'running' | 'done' | 'skipped' | 'failed'
}

export interface CharacterAgentPlan {
  id: string
  title: string
  strategy: string
  steps: CharacterAgentPlanStep[]
}

export interface CandidatePack {
  id: string
  title: string
  summary: string
  requestedAssets: string[]
  artifactIds: string[]
  risks: string[]
  score?: number
}

export interface AgentCritiqueRecord {
  id: string
  candidateId?: string
  summary: string
  dimensions: string[]
  repairSuggestions: string[]
  createdAt: number
}

export interface AgentQuestion {
  id: string
  prompt: string
  reason: string
  blocking: boolean
}

export interface AgentFinalReport {
  summary: string
  selectedCandidateId?: string
  exportedArtifactId?: string
  risks: string[]
  assumptions: string[]
}

export interface CharacterCardDraft {
  id: string
  fields: Record<string, unknown>
  imagePrompts: string[]
  imageArtifactIds: string[]
  imageTargetArtifactIds: Record<string, string[]>
  notes: string[]
  missing: string[]
  updatedAt: number
}

export interface CharacterAgentImageTargetPrompt {
  targetNodeId: string
  prompt: string
  title?: string
}

export type CharacterAgentAction =
  | { type: 'set_field'; field: string; value: unknown; reason?: string }
  | { type: 'merge_character_card'; value: Record<string, unknown>; reason?: string }
  | { type: 'create_artifact'; kind?: CharacterAgentArtifactKind; title?: string; data: unknown; summary?: string; reason?: string }
  | { type: 'request_image'; targetPrompts: CharacterAgentImageTargetPrompt[]; reason?: string }
  | { type: 'finish'; reason?: string }

export interface CharacterAgentDecision {
  summary: string
  actions: CharacterAgentAction[]
  done: boolean
  confidence: number
  missing: string[]
}

export const CHARACTER_CARD_FIELD_SCHEMA = [
  'name',
  'description',
  'appearance',
  'personality',
  'background',
  'scenario',
  'firstMessage',
  'dialogueStyle',
  'worldContext',
] as const

export const CHARACTER_SUPPORT_FIELD_SCHEMA = [
  'appearancePrompt',
] as const

export interface CharacterAgentState {
  runId: string
  phase: CharacterAgentPhase
  context: CharacterAgentRunContext
  taskUnderstanding: string
  activePlan: CharacterAgentPlan
  draft?: CharacterCardDraft
  candidatePacks: CandidatePack[]
  selectedCandidateId?: string
  critiqueHistory: AgentCritiqueRecord[]
  toolCalls: AgentToolCallRecord[]
  artifacts: CharacterAgentArtifact[]
  requirements: CharacterWorkflowRequirementState[]
  unresolvedQuestions: AgentQuestion[]
  finalReport?: AgentFinalReport
  events: CharacterAgentEvent[]
}

export interface CharacterAgentArtifact<TData = unknown> {
  id: string
  kind: CharacterAgentArtifactKind
  runId: string
  version: number
  title: string
  summary: string
  data: TData
  sourceNodeId?: string
  candidateId?: string
  createdAt: number
  updatedAt: number
}

export interface CharacterAgentArtifactRef {
  id: string
  kind: CharacterAgentArtifactKind
  version: number
  title: string
}

export interface AgentToolCallRecord {
  callId: string
  toolName: string
  phase: CharacterAgentPhase
  ok: boolean
  summary: string
  startedAt: number
  finishedAt: number
}

export interface AgentToolCallInput<TInput = unknown> {
  callId: string
  toolName: string
  phase: CharacterAgentPhase
  input: TInput
  context: CharacterAgentRunContext
  state: CharacterAgentState
  signal?: AbortSignal
}

export interface AgentToolResult<TData = unknown> {
  callId: string
  ok: boolean
  summary: string
  data?: TData
  artifacts?: CharacterAgentArtifact[]
  warnings?: string[]
  suggestedNextActions?: string[]
}

export interface AgentToolDefinition<TInput = unknown, TData = unknown> {
  name: string
  description: string
  kind: 'decision' | 'generation' | 'critique' | 'quality' | 'format' | 'retrieval' | 'image' | 'voice' | 'artifact'
  execute(input: AgentToolCallInput<TInput>): Promise<AgentToolResult<TData>> | AgentToolResult<TData>
}

export interface CharacterAgentToolRuntime {
  register<TInput = unknown, TData = unknown>(tool: AgentToolDefinition<TInput, TData>): void
  list(): AgentToolDefinition[]
  get(name: string): AgentToolDefinition | undefined
  call<TInput = unknown, TData = unknown>(
    toolName: string,
    input: TInput,
    callContext: Omit<AgentToolCallInput<TInput>, 'toolName' | 'input'>
  ): Promise<AgentToolResult<TData>>
}

export interface CharacterAgentArtifactStore {
  write<TData = unknown>(artifact: Omit<CharacterAgentArtifact<TData>, 'version' | 'createdAt' | 'updatedAt'>): CharacterAgentArtifact<TData>
  read(id: string): CharacterAgentArtifact | undefined
  list(filter?: { runId?: string; kind?: CharacterAgentArtifactKind; candidateId?: string }): CharacterAgentArtifact[]
  refs(filter?: { runId?: string; kind?: CharacterAgentArtifactKind; candidateId?: string }): CharacterAgentArtifactRef[]
}

export type CharacterAgentEvent =
  | { type: 'run.started'; runId: string; timestamp: number }
  | { type: 'run.phase.changed'; runId: string; phase: CharacterAgentPhase; timestamp: number }
  | { type: 'agent.plan.created'; runId: string; plan: CharacterAgentPlan; timestamp: number }
  | { type: 'tool.call.started'; runId: string; callId: string; toolName: string; phase: CharacterAgentPhase; timestamp: number }
  | { type: 'tool.call.completed'; runId: string; record: AgentToolCallRecord; result: AgentToolResult; timestamp: number }
  | { type: 'artifact.created'; runId: string; artifact: CharacterAgentArtifact; timestamp: number }
  | { type: 'critique.created'; runId: string; critique: AgentCritiqueRecord; timestamp: number }
  | { type: 'run.needs_user_input'; runId: string; question: AgentQuestion; timestamp: number }
  | { type: 'run.needs_action'; runId: string; summary: string; timestamp: number }
  | { type: 'run.completed'; runId: string; report: AgentFinalReport; timestamp: number }
  | { type: 'run.failed'; runId: string; error: string; timestamp: number }

export type CharacterAgentEventHandler = (event: CharacterAgentEvent) => void | Promise<void>

export interface CharacterSuperAgentOptions {
  now?: () => number
  createRunId?: () => string
  tools?: CharacterAgentToolRuntime
  artifacts?: CharacterAgentArtifactStore
  modelResolver?: CharacterAgentModelResolver
  onEvent?: CharacterAgentEventHandler
  signal?: AbortSignal
}

export interface CharacterAgentScopedRun {
  mode: 'scoped-run'
  instruction?: string
  action?: 'retry' | 'reroll' | 'resume' | 'repair'
  scope: {
    targetNodeIds?: string[]
    requirementIds?: string[]
    artifactIds?: string[]
    parentAttemptId?: string
  }
  seedArtifacts?: CharacterAgentArtifact[]
}

export interface CharacterAgentRunOptions {
  scopedRun?: CharacterAgentScopedRun
}

export interface CharacterSuperAgent {
  run(workflow: CharacterWorkflow, options?: CharacterAgentRunOptions): Promise<CharacterAgentState>
}

export function compileCharacterAgentRunContext(
  workflow: CharacterWorkflow,
  options: { runId?: string; now?: number } = {}
): CharacterAgentRunContext {
  const nodesByType = groupNodesByType(workflow.nodes)
  const relations = workflow.edges.map((edge) => createAgentRelation(edge))
  const runId = options.runId ?? `character-agent-run-${options.now ?? Date.now()}`
  const goalNode = firstNode(nodesByType, 'goal')
  const policyNode = firstNode(nodesByType, 'agent-policy')
  const strategyNode = firstNode(nodesByType, 'generation-strategy')
  const critiqueNode = firstNode(nodesByType, 'critique-loop')
  const qualityNode = firstNode(nodesByType, 'quality-gate')
  const exportNode = firstNode(nodesByType, 'output-adapter')
  const warnings: string[] = []
  if (!goalNode) {
    warnings.push('Generation goal node is missing; agent will run with an empty goal context.')
  }
  if (!firstNode(nodesByType, 'llm-tool')) {
    warnings.push('LLM tool node is missing; language model capability must be supplied externally.')
  }
  const stylePressures = (nodesByType.get('style-pressure') ?? []).map((node) => ({
    nodeId: node.id,
    preset: stringValue(node.config.preset, 'custom'),
    prompt: stringValue(node.config.stylePrompt),
    intensity: numberValue(node.config.intensity, 0.5),
    incomingRelations: incomingRelations(relations, node.id),
  }))
  const hardConstraints = (nodesByType.get('constraint') ?? []).map((node) => ({
    nodeId: node.id,
    mustHave: stringListValue(node.config.mustHave),
    mustNot: stringListValue(node.config.mustNot),
    hardBoundary: booleanValue(node.config.hardBoundary, true),
    incomingRelations: incomingRelations(relations, node.id),
  }))
  const imageGenerationControls = (nodesByType.get('image-generation-control') ?? []).map((node) => ({
    nodeId: node.id,
    targetImageCount: numberValue(node.config.targetImageCount, 1),
    imageStyleDomain: stringValue(node.config.imageStyleDomain, 'auto'),
    stylePrompt: stringValue(node.config.stylePrompt),
    shotType: stringValue(node.config.shotType, 'auto'),
    aspectRatio: stringValue(node.config.aspectRatio, '1:1'),
    consistencyMode: stringValue(node.config.consistencyMode, 'same-character'),
    seedMode: stringValue(node.config.seedMode, 'lock-character'),
    incomingRelations: incomingRelations(relations, node.id),
  }))
  const fieldGenerationControls = (nodesByType.get('field-generation-control') ?? []).map((node) => ({
    nodeId: node.id,
    fieldPurpose: stringValue(node.config.fieldPurpose),
    tone: stringValue(node.config.tone),
    lengthPolicy: stringValue(node.config.lengthPolicy, 'medium'),
    avoidPatterns: stringListValue(node.config.avoidPatterns),
    incomingRelations: incomingRelations(relations, node.id),
  }))
  const continuityControls = (nodesByType.get('continuity-control') ?? []).map((node) => ({
    nodeId: node.id,
    memoryAnchors: stringListValue(node.config.memoryAnchors),
    progressionPacing: stringValue(node.config.progressionPacing, 'slow-burn'),
    forbidResettingFacts: booleanValue(node.config.forbidResettingFacts, true),
    incomingRelations: incomingRelations(relations, node.id),
  }))
  const relationshipControls = (nodesByType.get('relationship-control') ?? []).map((node) => ({
    nodeId: node.id,
    relationshipMode: stringValue(node.config.relationshipMode, 'slow-trust'),
    tensionRules: stringListValue(node.config.tensionRules),
    incomingRelations: incomingRelations(relations, node.id),
  }))
  const targets = createAgentTargetContexts(workflow.nodes, relations, {
    stylePressures,
    hardConstraints,
    imageGenerationControls,
    fieldGenerationControls,
    continuityControls,
    relationshipControls,
  })

  return {
    runId,
    language: workflow.defaults.language,
    goal: {
      nodeId: goalNode?.id,
      prompt: stringValue(goalNode?.config.goalPrompt),
      targetAudience: stringValue(goalNode?.config.targetAudience, 'private roleplay'),
      allowAgentExpansion: booleanValue(goalNode?.config.allowAgentExpansion, true),
      language: workflow.defaults.language,
    },
    targets,
    stylePressures,
    hardConstraints,
    imageGenerationControls,
    fieldGenerationControls,
    continuityControls,
    relationshipControls,
    sourceMaterials: (nodesByType.get('source-material') ?? []).map((node) => ({
      nodeId: node.id,
      kind: stringValue(node.config.sourceKind, 'notes'),
      notes: stringValue(node.config.notes),
      groundingStrength: numberValue(node.config.groundingStrength, 0.5),
      incomingRelations: incomingRelations(relations, node.id),
    })),
    capabilities: {
      llmModels: (nodesByType.get('llm-tool') ?? []).map((node) => modelCapability(node, 'llm', workflow.defaults.llmApiId, workflow.defaults.llmModelName)),
      imageModels: [
        ...(nodesByType.get('image-tool') ?? []).map((node) => modelCapability(node, 'image', workflow.defaults.imageApiId, workflow.defaults.imageModelName)),
        ...(nodesByType.get('image-edit-tool') ?? []).map((node) => modelCapability(node, 'image', workflow.defaults.imageApiId, imageEditModelName(workflow.defaults.imageModelName))),
      ],
      retrieval: (nodesByType.get('retrieval-tool') ?? []).map((node) => ({
        nodeId: node.id,
        enabled: booleanValue(node.config.enabled, false),
        mode: stringValue(node.config.mode, 'local-only'),
        citationRequired: booleanValue(node.config.citationRequired, true),
      })),
      voice: (nodesByType.get('voice-tool') ?? []).map((node) => ({
        nodeId: node.id,
        provider: stringValue(node.config.provider),
        voice: stringValue(node.config.voice),
        speed: numberValue(node.config.speed, 1),
      })),
    },
    policy: {
      nodeId: policyNode?.id,
      autonomyLevel: stringValue(policyNode?.config.autonomyLevel, 'high'),
      revisionBudget: numberValue(policyNode?.config.revisionBudget, 4),
      askUserThreshold: stringValue(policyNode?.config.askUserThreshold, 'blocked-only'),
      canExpandMissingDetails: booleanValue(policyNode?.config.canExpandMissingDetails, true),
      incomingRelations: policyNode ? incomingRelations(relations, policyNode.id) : [],
    },
    strategy: {
      nodeId: strategyNode?.id,
      mode: stringValue(strategyNode?.config.mode, 'branch-and-refine'),
      branchCount: numberValue(strategyNode?.config.branchCount, 3),
      priorityAssets: stringListValue(strategyNode?.config.priorityAssets, ['role-card', 'opening', 'opening-layout', 'image-pack']),
      stopCondition: stringValue(strategyNode?.config.stopCondition, 'quality gate passed'),
      incomingRelations: strategyNode ? incomingRelations(relations, strategyNode.id) : [],
    },
    critique: {
      nodeId: critiqueNode?.id,
      iterations: numberValue(critiqueNode?.config.iterations, 2),
      dimensions: stringListValue(critiqueNode?.config.dimensions, ['goal match', 'long-term RP', 'non-template', 'consistency']),
      autoRepair: booleanValue(critiqueNode?.config.autoRepair, true),
      incomingRelations: critiqueNode ? incomingRelations(relations, critiqueNode.id) : [],
    },
    requestedAssets: targets.map((target) => ({
      nodeId: target.nodeId,
      requested: target.requestedResources,
      includeAlternates: true,
      incomingRelations: target.incomingRelations,
    })),
    requirements: createWorkflowRequirements(targets, relations),
    qualityGate: {
      nodeId: qualityNode?.id,
      minimumScore: numberValue(qualityNode?.config.minimumScore, 0.82),
      blockExport: booleanValue(qualityNode?.config.blockExport, true),
      requiredChecks: stringListValue(qualityNode?.config.requiredChecks, ['goal match', 'style intensity', 'long-term RP', 'consistency']),
      incomingRelations: qualityNode ? incomingRelations(relations, qualityNode.id) : [],
    },
    exportTarget: {
      nodeId: exportNode?.id,
      format: stringValue(exportNode?.config.format, 'noema-role-chat'),
      includeAssets: booleanValue(exportNode?.config.includeAssets, true),
      incomingRelations: exportNode ? incomingRelations(relations, exportNode.id) : [],
    },
    graph: {
      workflowId: workflow.id,
      workflowName: workflow.name,
      workflowVersion: workflow.version,
      nodes: workflow.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        title: node.title,
        config: { ...node.config },
      })),
      relations,
    },
    compilerWarnings: warnings,
  }
}

export function loadCharacterAgentWorkflowSnapshot(input: unknown): CharacterAgentWorkflowSnapshot {
  if (!isCharacterWorkflowLike(input)) {
    return {
      workflow: createEmptyWorkflow(),
      issues: [{
        code: 'invalid_snapshot',
        severity: 'error',
        path: '$',
        message: 'Snapshot is not a character workflow object.',
      }],
    }
  }
  const workflow = input as CharacterWorkflow
  return {
    workflow,
    issues: validateCharacterAgentWorkflowProtocol(workflow),
  }
}

export function validateCharacterAgentWorkflowProtocol(workflow: CharacterWorkflow): CharacterAgentProtocolIssue[] {
  const issues: CharacterAgentProtocolIssue[] = []
  if (!workflow.id) {
    issues.push({
      code: 'missing_workflow_id',
      severity: 'error',
      path: 'id',
      message: 'Workflow id is required for agent run persistence.',
    })
  }
  if (workflow.version !== CURRENT_CHARACTER_WORKFLOW_VERSION) {
    issues.push({
      code: 'unsupported_workflow_version',
      severity: 'error',
      path: 'version',
      message: `Workflow version ${workflow.version || '<empty>'} is not supported. Current required version is ${CURRENT_CHARACTER_WORKFLOW_VERSION}.`,
    })
  }
  const seenNodeIds = new Set<string>()
  workflow.nodes.forEach((node, index) => {
    if (seenNodeIds.has(node.id)) {
      issues.push({
        code: 'duplicate_node_id',
        severity: 'error',
        path: `nodes.${index}.id`,
        message: `Duplicate node id: ${node.id}`,
      })
    }
    seenNodeIds.add(node.id)
    if ((node.type === 'llm-tool' || node.type === 'image-tool' || node.type === 'image-edit-tool') && !stringValue(node.config.modelRef)) {
      issues.push({
        code: 'missing_model_ref',
        severity: 'warning',
        path: `nodes.${index}.config.modelRef`,
        message: `${node.type} does not select a configured model.`,
      })
    }
  })
  workflow.edges.forEach((edge, index) => {
    if (!seenNodeIds.has(edge.from.nodeId) || !seenNodeIds.has(edge.to.nodeId)) {
      issues.push({
        code: 'missing_edge_endpoint',
        severity: 'error',
        path: `edges.${index}`,
        message: `Edge references a missing endpoint: ${edge.from.nodeId} -> ${edge.to.nodeId}`,
      })
    }
  })
  return issues
}

export function createStaticCharacterAgentModelResolver(
  models: CharacterAgentModelConfig[]
): CharacterAgentModelResolver {
  const byRef = new Map(models.map((model) => [`${model.kind}:${model.modelRef}`, model]))
  return {
    resolve(modelRef, kind) {
      return byRef.get(`${kind}:${modelRef}`)
    },
  }
}

export async function resolveCharacterAgentModelCapabilities(
  context: CharacterAgentRunContext,
  resolver: CharacterAgentModelResolver
): Promise<ResolvedCharacterAgentCapabilities> {
  const issues: CharacterAgentProtocolIssue[] = []
  const resolve = async (capability: AgentModelCapability): Promise<CharacterAgentModelConfig | undefined> => {
    if (!capability.modelRef) {
      issues.push({
        code: 'missing_model_ref',
        severity: 'warning',
        path: `nodes.${capability.nodeId}.config.modelRef`,
        message: `${capability.kind} capability has no selected model.`,
      })
      return undefined
    }
    const resolved = await resolver.resolve(capability.modelRef, capability.kind)
    if (!resolved) {
      issues.push({
        code: 'unresolved_model_ref',
        severity: 'error',
        path: `nodes.${capability.nodeId}.config.modelRef`,
        message: `Configured model could not be resolved: ${capability.modelRef}`,
      })
    }
    return resolved
  }
  const llmModels = (await Promise.all(context.capabilities.llmModels.map(resolve))).filter((model): model is CharacterAgentModelConfig => Boolean(model))
  const imageModels = (await Promise.all(context.capabilities.imageModels.map(resolve))).filter((model): model is CharacterAgentModelConfig => Boolean(model))
  return { llmModels, imageModels, issues }
}

export function createCharacterAgentToolRuntime(
  tools: AgentToolDefinition[] = []
): CharacterAgentToolRuntime {
  const registry = new Map<string, AgentToolDefinition>()
  tools.forEach((tool) => registry.set(tool.name, tool))
  return {
    register(tool) {
      registry.set(tool.name, tool)
    },
    list() {
      return [...registry.values()]
    },
    get(name) {
      return registry.get(name)
    },
    async call<TInput = unknown, TData = unknown>(toolName: string, input: TInput, callContext: Omit<AgentToolCallInput<TInput>, 'toolName' | 'input'>): Promise<AgentToolResult<TData>> {
      const tool = registry.get(toolName)
      if (!tool) {
        return {
          callId: callContext.callId,
          ok: false,
          summary: `Tool is not registered: ${toolName}`,
          warnings: [`Missing tool: ${toolName}`],
        }
      }
      const result = await tool.execute({
        ...callContext,
        toolName,
        input,
      })
      return result as AgentToolResult<TData>
    },
  }
}

export function createInMemoryCharacterArtifactStore(
  seed: CharacterAgentArtifact[] = []
): CharacterAgentArtifactStore {
  const artifacts = new Map<string, CharacterAgentArtifact[]>()
  seed.forEach((artifact) => {
    artifacts.set(artifact.id, [...(artifacts.get(artifact.id) ?? []), artifact])
  })
  const latest = (id: string) => {
    const versions = artifacts.get(id) ?? []
    return versions[versions.length - 1]
  }
  return {
    write<TData = unknown>(artifact: Omit<CharacterAgentArtifact<TData>, 'version' | 'createdAt' | 'updatedAt'>): CharacterAgentArtifact<TData> {
      const versions = artifacts.get(artifact.id) ?? []
      const now = Date.now()
      const next: CharacterAgentArtifact<TData> = {
        ...artifact,
        version: versions.length + 1,
        createdAt: versions[0]?.createdAt ?? now,
        updatedAt: now,
      }
      artifacts.set(artifact.id, [...versions, next])
      return next
    },
    read(id) {
      return latest(id)
    },
    list(filter = {}) {
      return [...artifacts.values()]
        .flatMap((versions) => versions)
        .filter((artifact) => matchesArtifactFilter(artifact, filter))
    },
    refs(filter = {}) {
      return this.list(filter).map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        version: artifact.version,
        title: artifact.title,
      }))
    },
  }
}

export function createCharacterSuperAgent(
  options: CharacterSuperAgentOptions = {}
): CharacterSuperAgent {
  const now = options.now ?? Date.now
  const createRunId = options.createRunId ?? (() => `character-agent-run-${now()}`)
  const tools = options.tools ?? createDefaultCharacterAgentToolRuntime()
  const artifacts = options.artifacts ?? createInMemoryCharacterArtifactStore()
  return {
    async run(workflow, runOptions = {}) {
      const runId = createRunId()
      const context = compileCharacterAgentRunContext(workflow, { runId, now: now() })
      if (options.modelResolver) {
        const resolved = await resolveCharacterAgentModelCapabilities(context, options.modelResolver)
        context.compilerWarnings.push(...resolved.issues.map((issue) => issue.message))
      }
      let state = createInitialCharacterAgentState(context, now(), runOptions.scopedRun?.seedArtifacts ?? artifacts.list())
      const emit = async (event: CharacterAgentEvent) => {
        state = {
          ...state,
          events: [...state.events, event],
        }
        await options.onEvent?.(event)
      }
      const changePhase = async (phase: CharacterAgentPhase) => {
        state = { ...state, phase }
        await emit({ type: 'run.phase.changed', runId, phase, timestamp: now() })
      }
      const writeArtifact = async (artifact: Omit<CharacterAgentArtifact, 'version' | 'createdAt' | 'updatedAt'>) => {
        const written = artifacts.write(artifact)
        state = { ...state, artifacts: [...state.artifacts, written] }
        await emit({ type: 'artifact.created', runId, artifact: written, timestamp: now() })
        return written
      }
      const refreshRequirements = () => {
        const requirements = evaluateCharacterWorkflowRequirements(context, state.draft, state.artifacts)
        state = {
          ...state,
          requirements,
          draft: state.draft ? {
            ...state.draft,
            missing: requirementMissingLabels(requirements),
            updatedAt: now(),
          } : state.draft,
        }
        return requirements
      }
      const callTool = async (toolName: string, phase: CharacterAgentPhase, input: unknown) => {
        const callId = `${runId}:${phase}:${toolName}:${state.toolCalls.length + 1}`
        const startedAt = now()
        await emit({ type: 'tool.call.started', runId, callId, toolName, phase, timestamp: startedAt })
        const result = await tools.call(toolName, input, {
          callId,
          phase,
          context,
          state,
          signal: options.signal,
        })
        const finishedAt = now()
        const record: AgentToolCallRecord = {
          callId,
          toolName,
          phase,
          ok: result.ok,
          summary: result.summary,
          startedAt,
          finishedAt,
        }
        state = { ...state, toolCalls: [...state.toolCalls, record] }
        for (const artifact of result.artifacts ?? []) {
          await writeArtifact(artifact)
        }
        await emit({ type: 'tool.call.completed', runId, record, result, timestamp: finishedAt })
        return result
      }
      const executeImageRequestAction = async (action: Extract<CharacterAgentAction, { type: 'request_image' }>, phase: CharacterAgentPhase) => {
        if (!await ensureImagePrerequisites(phase)) {
          return
        }
        const imageResult = await callTool('generate_character_image', phase, {
          targetPrompts: action.targetPrompts,
          draft: state.draft,
          referenceImagesByTarget: resolveReferenceImagesByTarget(context, state.artifacts),
        })
        const promptTexts = getRequestImagePromptTexts(action)
        const imageIds = (imageResult.artifacts ?? [])
          .filter((artifact) => artifact.kind === 'image-asset')
          .map((artifact) => artifact.id)
        const failedAttemptIds = (imageResult.artifacts ?? [])
          .filter((artifact) => artifact.kind === 'image-attempt' && imageAttemptStatus(artifact) === 'failed')
          .map((artifact) => artifact.id)
        const imageTargetArtifactIds = collectImageTargetArtifactIds(state.draft?.imageTargetArtifactIds ?? {}, imageResult.artifacts ?? [])
        if (!imageIds.length && !failedAttemptIds.length) {
          const diagnostic = (imageResult.artifacts ?? [])
            .map((artifact) => [artifact.title, artifact.summary].filter(Boolean).join(': '))
            .filter(Boolean)
            .join(' | ')
          throw new Error(diagnostic || imageResult.summary || 'Image generation request completed without producing image assets')
        }
        state = {
          ...state,
          draft: {
            ...state.draft!,
            imagePrompts: appendUnique(state.draft!.imagePrompts, promptTexts),
            imageArtifactIds: appendUnique(state.draft!.imageArtifactIds, imageIds),
            imageTargetArtifactIds,
            notes: appendUnique(state.draft!.notes, [action.reason ?? imageResult.summary]),
            updatedAt: now(),
          },
        }
        refreshRequirements()
      }
      const executeImageTargets = async (
        phase: CharacterAgentPhase,
        targetNodeIds: string[],
        options: { instruction?: string; action?: string; parentAttemptId?: string; scoped?: boolean } = {}
      ): Promise<{ ran: boolean; imageIds: string[]; failedAttemptIds: string[] }> => {
        const uniqueTargetNodeIds = [...new Set(targetNodeIds.map((item) => item.trim()).filter(Boolean))]
        if (!uniqueTargetNodeIds.length) {
          return { ran: false, imageIds: [], failedAttemptIds: [] }
        }
        if (options.scoped) {
          const missingPrerequisites = getMissingImagePrerequisiteFields(state.draft, context)
          if (missingPrerequisites.length) {
            return { ran: false, imageIds: [], failedAttemptIds: [] }
          }
        } else if (!await ensureImagePrerequisites(phase)) {
          return { ran: false, imageIds: [], failedAttemptIds: [] }
        }
        const imageResult = await callTool('generate_character_image', phase, {
          draft: state.draft,
          autoGenerateTargetPrompts: true,
          targetNodeIds: uniqueTargetNodeIds,
          rerollInstruction: options.instruction,
          rerollAction: options.action,
          parentAttemptId: options.parentAttemptId,
          referenceImagesByTarget: resolveReferenceImagesByTarget(context, state.artifacts),
        })
        const imageIds = (imageResult.artifacts ?? [])
          .filter((artifact) => artifact.kind === 'image-asset')
          .map((artifact) => artifact.id)
        const failedAttemptIds = (imageResult.artifacts ?? [])
          .filter((artifact) => artifact.kind === 'image-attempt' && imageAttemptStatus(artifact) === 'failed')
          .map((artifact) => artifact.id)
        const imageTargetArtifactIds = collectImageTargetArtifactIds(state.draft?.imageTargetArtifactIds ?? {}, imageResult.artifacts ?? [])
        if (!imageIds.length && !failedAttemptIds.length) {
          const diagnostic = (imageResult.artifacts ?? [])
            .map((artifact) => [artifact.title, artifact.summary].filter(Boolean).join(': '))
            .filter(Boolean)
            .join(' | ')
          throw new Error(diagnostic || imageResult.summary || 'Image generation request completed without producing image assets')
        }
        state = {
          ...state,
          draft: {
            ...state.draft!,
            imagePrompts: appendUnique(state.draft!.imagePrompts, getGeneratedImagePromptTexts(imageResult.artifacts ?? [])),
            imageArtifactIds: appendUnique(state.draft!.imageArtifactIds, imageIds),
            imageTargetArtifactIds,
            notes: appendUnique(state.draft!.notes, [imageResult.summary]),
            updatedAt: now(),
          },
        }
        refreshRequirements()
        if (options.scoped && imageIds.length) {
          for (const staleMarker of createStaleMarkersForScopedImageTargets(context, state.artifacts, uniqueTargetNodeIds, imageIds, runId)) {
            await writeArtifact(staleMarker)
          }
        }
        await writeArtifact(createDraftArtifact(context, state.draft))
        return { ran: true, imageIds, failedAttemptIds }
      }
      const executeReadyImageRequirements = async (phase: CharacterAgentPhase): Promise<{ ran: boolean; imageIds: string[]; failedAttemptIds: string[] }> => {
        const readyImageRequirements = getReadyMissingImageRequirements(refreshRequirements())
        if (!readyImageRequirements.length) {
          return { ran: false, imageIds: [], failedAttemptIds: [] }
        }
        return executeImageTargets(phase, readyImageRequirements.map((requirement) => requirement.targetNodeId))
      }
      const applyFieldActionAndWriteArtifacts = async (action: CharacterAgentAction, summary?: string, writeDraft = true) => {
        const beforeFields = { ...(state.draft?.fields ?? {}) }
        state = {
          ...state,
          draft: applyCharacterAgentAction(state.draft!, action, context, now()),
        }
        for (const fieldArtifact of createFieldArtifactsForChangedFields(context, state.draft!, beforeFields)) {
          await writeArtifact(fieldArtifact)
        }
        state = {
          ...state,
          draft: {
            ...state.draft!,
            notes: appendUnique(state.draft!.notes, summary ? [summary] : []),
            updatedAt: now(),
          },
        }
        if (writeDraft) {
          await writeArtifact(createDraftArtifact(context, state.draft))
        }
      }
      const runSeedPass = async (
        stage: 'base' | 'derived',
        requestedFields: string[],
        reason: string
      ): Promise<boolean> => {
        const fields = [...new Set(requestedFields.map((field) => normalizeDraftFieldName(field)).filter(Boolean))]
          .filter((field) => !hasDraftField(state.draft?.fields ?? {}, field, context))
        if (!fields.length) {
          return false
        }
        const decisionResult = await callTool('decide_character_card_next_step', 'produce', {
          context,
          draft: state.draft,
          requirements: refreshRequirements(),
          seedPass: {
            stage,
            reason,
            requestedFields: fields,
          },
          turn: `seed-${stage}`,
          maxTurns: 1,
          artifacts: state.artifacts.map((artifact) => ({
            id: artifact.id,
            kind: artifact.kind,
            title: artifact.title,
            summary: artifact.summary,
          })),
        })
        const decision = decisionFromToolResult(decisionResult, context, state.draft, false)
        const actions = decision.actions.filter((action) => action.type === 'merge_character_card' || action.type === 'set_field')
        if (!actions.length) {
          return false
        }
        for (const action of actions) {
          await applyFieldActionAndWriteArtifacts(action, decision.summary, false)
        }
        state = {
          ...state,
          draft: {
            ...state.draft!,
            notes: appendUnique(state.draft!.notes, [decision.summary || decisionResult.summary]),
            updatedAt: now(),
          },
        }
        await writeArtifact(createDraftArtifact(context, state.draft))
        refreshRequirements()
        return true
      }
      const completeMissingRequiredFields = async (phase: CharacterAgentPhase, reason: string): Promise<boolean> => {
        let missingFields = getMissingCharacterDraftFields(state.draft, context)
        if (!missingFields.length) {
          return true
        }
        const maxTurns = missingFields.length + 4
        for (let turn = 1; turn <= maxTurns && missingFields.length; turn += 1) {
          const requiredField = missingFields[0]
          const requirements = refreshRequirements()
          const decisionResult = await callTool('decide_character_card_next_step', phase, {
            context,
            draft: state.draft,
            requirements,
            completionPass: {
              reason,
              requiredField,
              missingFields,
            },
            turn: `completion-${turn}`,
            maxTurns,
            artifacts: state.artifacts.map((artifact) => ({
              id: artifact.id,
              kind: artifact.kind,
              title: artifact.title,
              summary: artifact.summary,
            })),
          })
          const decision = decisionFromToolResult(decisionResult, context, state.draft, turn === maxTurns)
          const action = selectMissingFieldAction(decision.actions, requiredField)
          if (!action) {
            break
          }
          await applyFieldActionAndWriteArtifacts(action, decision.summary)
          missingFields = getMissingCharacterDraftFields(state.draft, context)
        }
        refreshRequirements()
        return missingFields.length === 0
      }
      const ensureImagePrerequisites = async (phase: CharacterAgentPhase): Promise<boolean> => {
        let missingFields = getMissingImagePrerequisiteFields(state.draft, context)
        if (!missingFields.length) {
          return true
        }
        const maxTurns = missingFields.length + 2
        for (let turn = 1; turn <= maxTurns && missingFields.length; turn += 1) {
          const requirements = refreshRequirements()
          const decisionResult = await callTool('decide_character_card_next_step', phase, {
            context,
            draft: state.draft,
            requirements,
            turn,
            maxTurns,
            artifacts: state.artifacts.map((artifact) => ({
              id: artifact.id,
              kind: artifact.kind,
              title: artifact.title,
              summary: artifact.summary,
            })),
          })
          const decision = decisionFromToolResult(decisionResult, context, state.draft, turn === maxTurns)
          const action = selectMissingFieldAction(decision.actions, missingFields[0])
          if (!action) {
            break
          }
          await applyFieldActionAndWriteArtifacts(action, decision.summary)
          missingFields = getMissingImagePrerequisiteFields(state.draft, context)
        }
        refreshRequirements()
        return missingFields.length === 0
      }
      const executeScopedArtifactRepair = async (scopedRun: CharacterAgentScopedRun): Promise<{ artifactIds: string[]; summary: string }> => {
        const selectedArtifacts = resolveScopedArtifacts(state.artifacts, scopedRun)
        const decisionResult = await callTool('decide_character_card_next_step', 'repair', {
          context,
          draft: state.draft,
          requirements: refreshRequirements(),
          scopedRun: {
            instruction: scopedRun.instruction,
            action: scopedRun.action,
            scope: scopedRun.scope,
          },
          selectedArtifacts: selectedArtifacts.map((artifact) => ({
            id: artifact.id,
            kind: artifact.kind,
            title: artifact.title,
            summary: artifact.summary,
            sourceNodeId: artifact.sourceNodeId,
            data: compactScopedArtifactData(artifact.data),
          })),
          artifacts: state.artifacts.map((artifact) => ({
            id: artifact.id,
            kind: artifact.kind,
            title: artifact.title,
            summary: artifact.summary,
            sourceNodeId: artifact.sourceNodeId,
          })),
          turn: 'scoped-repair',
          maxTurns: 1,
        })
        const decision = decisionFromToolResult(decisionResult, context, state.draft, true)
        const action = decision.actions[0]
        const written: string[] = []
        if (!action || action.type === 'finish') {
          const report = await writeArtifact(createScopedRepairReportArtifact(context, state.draft!, scopedRun, selectedArtifacts, decision.summary || decisionResult.summary))
          written.push(report.id)
          return { artifactIds: written, summary: decision.summary || decisionResult.summary || 'Scoped run feedback recorded.' }
        }
        if (action.type === 'request_image') {
          await executeImageRequestAction(action, 'repair')
          return { artifactIds: [], summary: decision.summary || decisionResult.summary || 'Scoped repair requested image generation.' }
        }
        if (action.type === 'create_artifact') {
          const artifact = await writeArtifact(createScopedActionArtifact(context, state.draft!, scopedRun, selectedArtifacts, action))
          written.push(artifact.id)
        } else {
          const beforeFields = { ...(state.draft?.fields ?? {}) }
          state = {
            ...state,
            draft: applyCharacterAgentAction(state.draft!, action, context, now()),
          }
          for (const fieldArtifact of createFieldArtifactsForChangedFields(context, state.draft!, beforeFields)) {
            const artifact = await writeArtifact(createScopedFieldArtifact(fieldArtifact, scopedRun, selectedArtifacts))
            written.push(artifact.id)
          }
        }
        await writeArtifact(createDraftArtifact(context, state.draft))
        refreshRequirements()
        return { artifactIds: written, summary: decision.summary || decisionResult.summary || 'Scoped artifact repair completed.' }
      }

      try {
        await emit({ type: 'run.started', runId, timestamp: now() })
        await changePhase('produce')
        state = {
          ...state,
          draft: hydrateCharacterDraftFromArtifacts(context, state.artifacts, now()) ?? createInitialCharacterDraft(context, now()),
          taskUnderstanding: '',
        }
        refreshRequirements()
        await writeArtifact(createDraftArtifact(context, state.draft))

        if (runOptions.scopedRun?.mode === 'scoped-run') {
          if (!shouldRunScopedImageTargets(state.artifacts, runOptions.scopedRun)) {
            const repairResult = await executeScopedArtifactRepair(runOptions.scopedRun)
            const summary = repairResult.summary
            state = {
              ...state,
              phase: 'completed',
              finalReport: {
                summary,
                selectedCandidateId: state.draft?.id,
                risks: [],
                assumptions: context.compilerWarnings,
              },
            }
            await emit({ type: 'run.completed', runId, report: state.finalReport!, timestamp: now() })
            return state
          }
          const targetNodeIds = resolveScopedImageTargetNodeIds(context, runOptions.scopedRun)
          const scopedResult = await executeImageTargets('produce', targetNodeIds, {
            instruction: runOptions.scopedRun.instruction,
            action: runOptions.scopedRun.action,
            parentAttemptId: runOptions.scopedRun.scope.parentAttemptId,
            scoped: true,
          })
          let imageRunResult = scopedResult
          if (scopedResult.ran && scopedResult.imageIds.length && !scopedResult.failedAttemptIds.length) {
            for (let attempt = 0; attempt < context.requirements.length; attempt += 1) {
              const downstreamResult = await executeReadyImageRequirements('produce')
              if (!downstreamResult.ran) {
                break
              }
              imageRunResult = {
                ran: true,
                imageIds: appendUnique(imageRunResult.imageIds, downstreamResult.imageIds),
                failedAttemptIds: appendUnique(imageRunResult.failedAttemptIds, downstreamResult.failedAttemptIds),
              }
              if (downstreamResult.failedAttemptIds.length || areAllRequiredRequirementsDone(refreshRequirements())) {
                break
              }
            }
          }
          const summary = !imageRunResult.ran
            ? `Scoped image run could not start for ${targetNodeIds.join(', ')} because image prerequisites are missing.`
            : imageRunResult.failedAttemptIds.length
            ? `Scoped image run needs action: ${imageRunResult.failedAttemptIds.length} failed attempt(s).`
            : `Scoped image run completed for ${targetNodeIds.join(', ')}${imageRunResult.imageIds.length > scopedResult.imageIds.length ? ' and unblocked downstream image target(s).' : ''}`
          if (!imageRunResult.ran || imageRunResult.failedAttemptIds.length) {
            state = {
              ...state,
              phase: 'needs_action',
              finalReport: {
                summary,
                selectedCandidateId: state.draft?.id,
                risks: imageRunResult.failedAttemptIds.map((id) => `Failed image attempt: ${id}`),
                assumptions: context.compilerWarnings,
              },
            }
            await emit({ type: 'run.needs_action', runId, summary, timestamp: now() })
            return state
          }
          state = {
            ...state,
            phase: 'completed',
            finalReport: {
              summary,
              selectedCandidateId: state.draft?.id,
              risks: imageRunResult.failedAttemptIds.map((id) => `Failed image attempt: ${id}`),
              assumptions: context.compilerWarnings,
            },
          }
          await emit({ type: 'run.completed', runId, report: state.finalReport!, timestamp: now() })
          return state
        }

        const requiredTextFields = getRequiredCharacterDraftFields(context)
        await runSeedPass(
          'base',
          requiredTextFields.filter((field) => !['firstMessage', 'dialogueStyle', 'appearancePrompt'].includes(field)),
          'generate the stable character seed before derived fields and images'
        )
        await runSeedPass(
          'derived',
          requiredTextFields,
          'derive opening, dialogue style, and avatar identity prompt from the stable character seed'
        )

        await completeMissingRequiredFields('produce', 'complete required character-card fields before inspection and image generation')

        for (let attempt = 0; attempt < context.requirements.length; attempt += 1) {
          const imageRequirementResult = await executeReadyImageRequirements('produce')
          if (!imageRequirementResult.ran) {
            break
          }
          if (areAllRequiredRequirementsDone(refreshRequirements())) {
            break
          }
        }

        await changePhase('inspect')
        const qualityResult = await callTool('review_character_card', 'inspect', {
          context,
          draft: state.draft,
          artifacts: state.artifacts,
        })
        const critique: AgentCritiqueRecord = {
          id: `${runId}:critique:1`,
          candidateId: state.draft?.id,
          summary: qualityResult.summary,
          dimensions: context.qualityGate.requiredChecks,
          repairSuggestions: qualityResult.suggestedNextActions ?? [],
          createdAt: now(),
        }
        state = { ...state, critiqueHistory: [critique] }
        await emit({ type: 'critique.created', runId, critique, timestamp: now() })
        await writeArtifact({
          id: `${runId}:quality-report`,
          kind: 'quality-report',
          runId,
          candidateId: state.draft?.id,
          title: 'Quality Report',
          summary: qualityResult.summary,
          data: qualityResult.data ?? { ok: qualityResult.ok, summary: qualityResult.summary },
        })

        if (!qualityResult.ok && context.critique.autoRepair && context.policy.revisionBudget > 0) {
          await changePhase('repair')
          const repairResult = await callTool('decide_character_card_next_step', 'repair', {
            context,
            draft: state.draft,
            critique,
            forceRepair: true,
          })
          const repairDecision = decisionFromToolResult(repairResult, context, state.draft, true)
          for (const action of repairDecision.actions) {
            if (action.type === 'request_image') {
              await executeImageRequestAction(action, 'repair')
            } else if (action.type === 'create_artifact') {
              await writeArtifact(createActionArtifact(context, state.draft!, action))
            } else {
              await applyFieldActionAndWriteArtifacts(action, undefined, false)
            }
            await writeArtifact(createDraftArtifact(context, state.draft))
          }
          refreshRequirements()
        }

        await completeMissingRequiredFields('repair', 'complete required character-card fields after quality repair')
        for (let attempt = 0; attempt < context.requirements.length; attempt += 1) {
          const imageRequirementResult = await executeReadyImageRequirements('repair')
          if (!imageRequirementResult.ran) {
            break
          }
          if (areAllRequiredRequirementsDone(refreshRequirements())) {
            break
          }
        }

        const finalRequirements = refreshRequirements()
        const finalMissing = requirementMissingLabels(finalRequirements)
        if (finalMissing.length || !areAllRequiredRequirementsDone(finalRequirements)) {
          const failedImageRequirements = finalRequirements.filter((requirement) => requirement.kind === 'image' && requirement.status === 'failed')
          if (failedImageRequirements.length) {
            const summary = `Character workflow needs action for failed image target(s): ${failedImageRequirements.map((requirement) => requirement.title).join(', ')}.`
            state = {
              ...state,
              phase: 'needs_action',
              finalReport: {
                summary,
                selectedCandidateId: state.draft?.id,
                risks: finalMissing,
                assumptions: context.compilerWarnings,
              },
            }
            await emit({ type: 'run.needs_action', runId, summary, timestamp: now() })
            return state
          }
          throw new Error(`Character workflow did not produce a complete character card. Missing: ${finalMissing.join(', ') || 'unknown fields'}. Last review: ${qualityResult.summary}`)
        }

        const formatIssues = validateCharacterOutputFormat(state.draft)
        if (formatIssues.length) {
          await changePhase('repair')
          state = {
            ...state,
            draft: repairCharacterOutputFormat(state.draft!, now()),
          }
          await writeArtifact(createDraftArtifact(context, state.draft))
          await writeArtifact({
            id: `${runId}:format-repair-report`,
            kind: 'quality-report',
            runId,
            candidateId: state.draft?.id,
            title: 'Format Repair Report',
            summary: `Repaired output format: ${formatIssues.join(', ')}`,
            data: {
              repaired: true,
              issues: formatIssues,
              protocol: 'noema-role-chat',
            },
          })
        }

        const finalCard = await writeArtifact({
          id: `${runId}:character-card-final`,
          kind: 'character-card-final',
          runId,
          candidateId: state.draft?.id,
          title: stringValue(state.draft?.fields.name, 'Character Card'),
          summary: summarizeDraft(state.draft),
          data: pickCharacterCardFields(state.draft?.fields ?? {}),
        })
        const candidate: CandidatePack = {
          id: state.draft?.id ?? `${runId}:candidate:primary`,
          title: finalCard.title,
          summary: finalCard.summary,
          requestedAssets: flattenRequestedAssets(context),
          artifactIds: state.artifacts.map((artifact) => artifact.id),
          risks: [...context.compilerWarnings, ...(state.draft?.missing ?? []).map((item) => `Missing: ${item}`)],
          score: typeof qualityResult.data === 'object' && qualityResult.data && 'score' in qualityResult.data
            ? Number((qualityResult.data as { score?: unknown }).score)
            : undefined,
        }
        state = { ...state, candidatePacks: [candidate], selectedCandidateId: candidate.id }

        await changePhase('package')
        const exportResult = await callTool('create_output_adapter_package', 'package', { context, candidate, draft: state.draft, artifacts: state.artifacts })
        const exported = await writeArtifact({
          id: `${runId}:export-package`,
          kind: 'export-package',
          runId,
          candidateId: candidate.id,
          title: `${context.exportTarget.format} Export Package`,
          summary: exportResult.summary,
          data: exportResult.data ?? { format: context.exportTarget.format, candidate, draft: state.draft },
        })

        await changePhase('report')
        const report: AgentFinalReport = {
          summary: `Generated a complete character card for ${context.goal.targetAudience}.`,
          selectedCandidateId: candidate.id,
          exportedArtifactId: exported.id,
          risks: candidate.risks,
          assumptions: context.compilerWarnings,
        }
        state = { ...state, finalReport: report, phase: 'completed' }
        await emit({ type: 'run.completed', runId, report, timestamp: now() })
        return state
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        state = { ...state, phase: 'failed' }
        await emit({ type: 'run.failed', runId, error: message, timestamp: now() })
        return state
      }
    },
  }
}

export function createDefaultCharacterAgentToolRuntime(): CharacterAgentToolRuntime {
  return createCharacterAgentToolRuntime([
    {
      name: 'decide_character_card_next_step',
      description: 'Chooses the next autonomous edits needed to complete the character card.',
      kind: 'decision',
      execute: ({ callId, context, state }) => ({
        callId,
        ok: false,
        summary: 'No configured LLM decision tool is available; character fields were not generated.',
        data: {
          summary: 'No configured LLM decision tool is available; character fields were not generated.',
          done: false,
          confidence: 0,
          missing: requirementMissingLabels(state.requirements),
          actions: [],
        },
      }),
    },
    {
      name: 'generate_character_image',
      description: 'Generates a visual asset for the current character draft when an image model is configured.',
      kind: 'image',
      execute: ({ callId }) => ({
        callId,
        ok: false,
        summary: 'No configured image generator is available in the default runtime.',
        warnings: ['Image generation requires the configured desktop tool runtime.'],
      }),
    },
    {
      name: 'review_character_card',
      description: 'Reviews whether the current character card is complete enough for runtime use.',
      kind: 'quality',
      execute: ({ callId, context, state }) => {
        const requirements = evaluateCharacterWorkflowRequirements(context, state.draft, state.artifacts)
        const missing = requirementMissingLabels(requirements)
        return {
          callId,
          ok: missing.length === 0,
          summary: missing.length ? `Missing required workflow requirements: ${missing.join(', ')}` : 'Character workflow requirements are complete enough for runtime use.',
          data: {
            score: missing.length ? Math.max(0.35, context.qualityGate.minimumScore - 0.18) : Math.max(context.qualityGate.minimumScore, 0.86),
            passed: missing.length === 0,
            missing,
          },
          suggestedNextActions: missing,
        }
      },
    },
    {
      name: 'create_output_adapter_package',
      description: 'Applies Output Adapter semantics to the completed character draft.',
      kind: 'format',
      execute: ({ callId, context, input }) => ({
        callId,
        ok: true,
        summary: `Prepared ${context.exportTarget.format} output adapter package.`,
        data: {
          format: context.exportTarget.format,
          includeAssets: context.exportTarget.includeAssets,
          payload: input,
        },
      }),
    },
  ])
}

function createInitialCharacterAgentState(
  context: CharacterAgentRunContext,
  now: number,
  seedArtifacts: CharacterAgentArtifact[] = []
): CharacterAgentState {
  return {
    runId: context.runId,
    phase: 'ingest',
    context,
    taskUnderstanding: '',
    activePlan: createDefaultAgentPlan(context),
    candidatePacks: [],
    critiqueHistory: [],
    toolCalls: [],
    artifacts: seedArtifacts,
    requirements: evaluateCharacterWorkflowRequirements(context, hydrateCharacterDraftFromArtifacts(context, seedArtifacts, now) ?? undefined, seedArtifacts),
    unresolvedQuestions: [],
    events: [],
  }
}

function createInitialCharacterDraft(context: CharacterAgentRunContext, now: number): CharacterCardDraft {
  return {
    id: `${context.runId}:candidate:primary`,
    fields: {},
    imagePrompts: [],
    imageArtifactIds: [],
    imageTargetArtifactIds: {},
    notes: [],
    missing: getRequiredCharacterDraftFields(context),
    updatedAt: now,
  }
}

function hydrateCharacterDraftFromArtifacts(
  context: CharacterAgentRunContext,
  artifacts: CharacterAgentArtifact[],
  now: number
): CharacterCardDraft | null {
  const draftArtifact = [...artifacts].reverse().find((artifact) => artifact.kind === 'character-card-draft')
  const draftData = draftArtifact?.data
  if (draftData && typeof draftData === 'object' && !Array.isArray(draftData)) {
    const draft = draftData as Partial<CharacterCardDraft>
    return {
      id: typeof draft.id === 'string' ? draft.id : `${context.runId}:candidate:primary`,
      fields: draft.fields && typeof draft.fields === 'object' && !Array.isArray(draft.fields) ? draft.fields as Record<string, unknown> : {},
      imagePrompts: Array.isArray(draft.imagePrompts) ? draft.imagePrompts.filter((item): item is string => typeof item === 'string') : [],
      imageArtifactIds: Array.isArray(draft.imageArtifactIds) ? draft.imageArtifactIds.filter((item): item is string => typeof item === 'string') : [],
      imageTargetArtifactIds: draft.imageTargetArtifactIds && typeof draft.imageTargetArtifactIds === 'object' && !Array.isArray(draft.imageTargetArtifactIds)
        ? Object.fromEntries(Object.entries(draft.imageTargetArtifactIds).map(([key, value]) => [key, Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []]))
        : collectImageTargetArtifactIds({}, artifacts),
      notes: Array.isArray(draft.notes) ? draft.notes.filter((item): item is string => typeof item === 'string') : [],
      missing: Array.isArray(draft.missing) ? draft.missing.filter((item): item is string => typeof item === 'string') : getRequiredCharacterDraftFields(context),
      updatedAt: typeof draft.updatedAt === 'number' ? draft.updatedAt : now,
    }
  }
  const finalCard = [...artifacts].reverse().find((artifact) => artifact.kind === 'character-card-final')
  const fields = finalCard?.data && typeof finalCard.data === 'object' && !Array.isArray(finalCard.data)
    ? finalCard.data as Record<string, unknown>
    : {}
  if (!Object.keys(fields).length && !artifacts.some((artifact) => artifact.kind === 'image-asset')) {
    return null
  }
  return {
    id: `${context.runId}:candidate:primary`,
    fields,
    imagePrompts: [],
    imageArtifactIds: artifacts.filter((artifact) => artifact.kind === 'image-asset').map((artifact) => artifact.id),
    imageTargetArtifactIds: collectImageTargetArtifactIds({}, artifacts),
    notes: [],
    missing: getRequiredCharacterDraftFields(context),
    updatedAt: now,
  }
}

function createDraftArtifact(context: CharacterAgentRunContext, draft: CharacterCardDraft | undefined): Omit<CharacterAgentArtifact<CharacterCardDraft>, 'version' | 'createdAt' | 'updatedAt'> {
  const safeDraft = draft ?? createInitialCharacterDraft(context, Date.now())
  const draftVersionKey = `${Object.keys(safeDraft.fields).length}-${safeDraft.notes.length}-${safeDraft.imagePrompts.length}-${safeDraft.updatedAt}`
  return {
    id: `${context.runId}:character-card-draft:${draftVersionKey}`,
    kind: 'character-card-draft',
    runId: context.runId,
    candidateId: safeDraft.id,
    title: stringValue(safeDraft.fields.name, 'Character Card Draft'),
    summary: summarizeDraft(safeDraft),
    data: safeDraft,
    sourceNodeId: context.goal.nodeId,
  }
}

function createActionArtifact(
  context: CharacterAgentRunContext,
  draft: CharacterCardDraft,
  action: Extract<CharacterAgentAction, { type: 'create_artifact' }>
): Omit<CharacterAgentArtifact, 'version' | 'createdAt' | 'updatedAt'> {
  const kind = action.kind ?? 'generation-report'
  return {
    id: `${draft.id}:${kind}`,
    kind,
    runId: context.runId,
    candidateId: draft.id,
    title: action.title ?? artifactTitle(kind),
    summary: action.summary ?? summarizeValue(action.data),
    data: action.data,
    sourceNodeId: context.requestedAssets[0]?.nodeId ?? context.goal.nodeId,
  }
}

function createScopedActionArtifact(
  context: CharacterAgentRunContext,
  draft: CharacterCardDraft,
  scopedRun: CharacterAgentScopedRun,
  selectedArtifacts: CharacterAgentArtifact[],
  action: Extract<CharacterAgentAction, { type: 'create_artifact' }>
): Omit<CharacterAgentArtifact, 'version' | 'createdAt' | 'updatedAt'> {
  const base = createActionArtifact(context, draft, action)
  const selected = selectedArtifacts[0]
  return {
    ...base,
    id: selected?.id ?? base.id,
    kind: selected?.kind ?? base.kind,
    sourceNodeId: selected?.sourceNodeId ?? base.sourceNodeId,
    summary: action.summary ?? scopedRun.instruction ?? base.summary,
  }
}

function createScopedFieldArtifact(
  artifact: Omit<CharacterAgentArtifact, 'version' | 'createdAt' | 'updatedAt'>,
  scopedRun: CharacterAgentScopedRun,
  selectedArtifacts: CharacterAgentArtifact[]
): Omit<CharacterAgentArtifact, 'version' | 'createdAt' | 'updatedAt'> {
  const selected = selectedArtifacts.find((item) => item.kind === 'character-card-field')
  return {
    ...artifact,
    id: selected?.id ?? artifact.id,
    sourceNodeId: selected?.sourceNodeId ?? artifact.sourceNodeId,
    summary: scopedRun.instruction ? `${artifact.summary}\nFeedback: ${scopedRun.instruction}` : artifact.summary,
  }
}

function createScopedRepairReportArtifact(
  context: CharacterAgentRunContext,
  draft: CharacterCardDraft,
  scopedRun: CharacterAgentScopedRun,
  selectedArtifacts: CharacterAgentArtifact[],
  summary: string
): Omit<CharacterAgentArtifact, 'version' | 'createdAt' | 'updatedAt'> {
  const selected = selectedArtifacts[0]
  return {
    id: `${context.runId}:scoped-repair-report:${Date.now()}`,
    kind: 'generation-report',
    runId: context.runId,
    candidateId: draft.id,
    title: 'Scoped Repair Feedback',
    summary,
    data: {
      instruction: scopedRun.instruction,
      selectedArtifactIds: selectedArtifacts.map((artifact) => artifact.id),
      selectedArtifactTitle: selected?.title,
    },
    sourceNodeId: selected?.sourceNodeId ?? context.goal.nodeId,
  }
}

function createFieldArtifactsForChangedFields(
  context: CharacterAgentRunContext,
  draft: CharacterCardDraft,
  beforeFields: Record<string, unknown>
): Array<Omit<CharacterAgentArtifact, 'version' | 'createdAt' | 'updatedAt'>> {
  return Object.entries(draft.fields)
    .filter(([field, value]) => isCharacterRunField(field) && JSON.stringify(beforeFields[field] ?? null) !== JSON.stringify(value ?? null))
    .map(([field, value]) => {
      const summary = summarizeValue(value)
      return {
        id: `${draft.id}:field:${field}:${draft.updatedAt}`,
        kind: 'character-card-field',
        runId: context.runId,
        candidateId: draft.id,
        title: characterRunFieldTitle(field),
        summary,
        data: {
          field,
          label: characterRunFieldTitle(field),
          value,
          support: CHARACTER_SUPPORT_FIELD_SCHEMA.includes(field as any),
        },
        sourceNodeId: context.goal.nodeId,
      }
    })
}

function applyCharacterAgentAction(
  draft: CharacterCardDraft,
  action: CharacterAgentAction,
  context: CharacterAgentRunContext,
  now: number
): CharacterCardDraft {
  if (action.type === 'set_field') {
    const field = normalizeDraftFieldName(action.field)
    if (!field) {
      return draft
    }
    const value = sanitizeCharacterDraftFieldValue(field, action.value, context, draft)
    if (value === undefined) {
      return {
        ...draft,
        notes: appendUnique(draft.notes, [`Rejected invalid generated value for ${field}.`]),
        updatedAt: now,
      }
    }
    return {
      ...draft,
      fields: { ...draft.fields, [field]: value },
      notes: appendUnique(draft.notes, action.reason ? [action.reason] : []),
      updatedAt: now,
    }
  }
  if (action.type === 'merge_character_card') {
    const normalizedFields = normalizeDraftFields(action.value)
    const fields = Object.fromEntries(
      Object.entries(normalizedFields).flatMap(([field, value]) => {
        const sanitized = sanitizeCharacterDraftFieldValue(field, value, context, draft)
        return sanitized === undefined ? [] : [[field, sanitized]]
      })
    )
    return {
      ...draft,
      fields: { ...draft.fields, ...fields },
      notes: appendUnique(draft.notes, action.reason ? [action.reason] : []),
      updatedAt: now,
    }
  }
  if (action.type === 'request_image') {
    return {
      ...draft,
      imagePrompts: appendUnique(draft.imagePrompts, getRequestImagePromptTexts(action)),
      notes: appendUnique(draft.notes, action.reason ? [action.reason] : []),
      updatedAt: now,
    }
  }
  if (action.type === 'finish') {
    return {
      ...draft,
      notes: appendUnique(draft.notes, action.reason ? [action.reason] : ['Agent marked the character card complete.']),
      updatedAt: now,
    }
  }
  return draft
}

function decisionFromToolResult(
  result: AgentToolResult,
  context: CharacterAgentRunContext,
  draft: CharacterCardDraft | undefined,
  forceDone: boolean
): CharacterAgentDecision {
  if (isDecisionObject(result.data)) {
    return {
      summary: stringValue(result.data.summary, result.summary),
      actions: normalizeAgentActions(result.data.actions),
      done: Boolean(result.data.done),
      confidence: numberValue(result.data.confidence, 0.5),
      missing: stringListValue(result.data.missing),
    }
  }
  const fallbackDraft = draft ?? createInitialCharacterDraft(context, Date.now())
  return {
    summary: result.summary || 'The model did not return valid character-generation actions.',
    actions: [],
    done: forceDone,
    confidence: 0,
    missing: requirementMissingLabels(evaluateCharacterWorkflowRequirements(context, fallbackDraft, [])),
  }
}

function selectProgressiveAction(
  actions: CharacterAgentAction[],
  draft: CharacterCardDraft,
  context: CharacterAgentRunContext,
  requirements: CharacterWorkflowRequirementState[]
): CharacterAgentAction | null {
  const nextField = getNextMissingField(draft, context)
  if (nextField) {
    return selectMissingFieldAction(actions, nextField)
  }
  const readyImageTargetIds = new Set(getReadyMissingImageRequirements(requirements).map((requirement) => requirement.targetNodeId))
  if (readyImageTargetIds.size) {
    const imageAction = actions.find((action) => action.type === 'request_image')
    if (!imageAction) {
      return null
    }
    const targetPrompts = imageAction.targetPrompts.filter((prompt) => readyImageTargetIds.has(prompt.targetNodeId))
    return targetPrompts.length ? { ...imageAction, targetPrompts } : null
  }
  return areAllRequiredRequirementsDone(requirements) ? actions.find((action) => action.type === 'finish') ?? null : null
}

function selectMissingFieldAction(actions: CharacterAgentAction[], nextField: string): CharacterAgentAction | null {
  for (const action of actions) {
    if (action.type === 'set_field' && normalizeDraftFieldName(action.field) === nextField) {
      return action
    }
    if (action.type === 'merge_character_card') {
      const fields = normalizeDraftFields(action.value)
      if (fields[nextField] !== undefined && fields[nextField] !== null) {
        return {
          type: 'set_field',
          field: nextField,
          value: fields[nextField],
          reason: action.reason,
        }
      }
    }
  }
  return null
}

function normalizeAgentActions(value: unknown): CharacterAgentAction[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((item): CharacterAgentAction | null => {
      if (!item || typeof item !== 'object') {
        return null
      }
      const action = item as Record<string, unknown>
      const type = stringValue(action.type)
      if (type === 'set_field') {
        return { type, field: stringValue(action.field), value: action.value, reason: stringValue(action.reason) }
      }
      if (type === 'merge_character_card' && action.value && typeof action.value === 'object' && !Array.isArray(action.value)) {
        return { type, value: action.value as Record<string, unknown>, reason: stringValue(action.reason) }
      }
      if (type === 'create_artifact') {
        return {
          type,
          kind: isArtifactKind(action.kind) ? action.kind : undefined,
          title: stringValue(action.title),
          summary: stringValue(action.summary),
          data: action.data,
          reason: stringValue(action.reason),
        }
      }
      if (type === 'request_image') {
        const targetPrompts = normalizeImageTargetPrompts(action.targetPrompts)
        return { type, targetPrompts, reason: stringValue(action.reason) }
      }
      if (type === 'finish') {
        return { type, reason: stringValue(action.reason) }
      }
      return null
    })
    .filter((action): action is CharacterAgentAction => Boolean(action))
    .filter((action) => action.type !== 'request_image' || action.targetPrompts.length > 0)
}

function normalizeImageTargetPrompts(value: unknown): CharacterAgentImageTargetPrompt[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item): CharacterAgentImageTargetPrompt[] => {
    if (!item || typeof item !== 'object') {
      return []
    }
    const record = item as Record<string, unknown>
    const targetNodeId = stringValue(record.targetNodeId)
    const prompt = stringValue(record.prompt)
    if (!targetNodeId || !prompt) {
      return []
    }
    return [{
      targetNodeId,
      prompt,
      title: stringValue(record.title),
    }]
  })
}

function getRequestImagePromptTexts(action: Extract<CharacterAgentAction, { type: 'request_image' }>): string[] {
  return action.targetPrompts.map((item) => item.prompt.trim()).filter(Boolean)
}

function getGeneratedImagePromptTexts(artifacts: CharacterAgentArtifact[]): string[] {
  return artifacts
    .filter((artifact) => artifact.kind === 'image-asset')
    .map((artifact) => {
      const data = artifact.data && typeof artifact.data === 'object' && !Array.isArray(artifact.data)
        ? artifact.data as Record<string, unknown>
        : {}
      return stringValue(data.prompt).trim()
    })
    .filter(Boolean)
}

function collectImageTargetArtifactIds(
  existing: Record<string, string[]>,
  artifacts: CharacterAgentArtifact[]
): Record<string, string[]> {
  const next: Record<string, string[]> = Object.fromEntries(
    Object.entries(existing).map(([key, value]) => [key, [...value]])
  )
  for (const artifact of artifacts) {
    if (artifact.kind !== 'image-asset' || !artifact.sourceNodeId) {
      continue
    }
    next[artifact.sourceNodeId] = appendUnique(next[artifact.sourceNodeId] ?? [], [artifact.id])
  }
  return next
}

function getReadyMissingImageRequirements(requirements: CharacterWorkflowRequirementState[]): CharacterWorkflowRequirementState[] {
  return requirements.filter((requirement) => requirement.kind === 'image' && requirement.status === 'missing')
}

function imageAttemptStatus(artifact: CharacterAgentArtifact): string {
  const data = artifact.data && typeof artifact.data === 'object' && !Array.isArray(artifact.data)
    ? artifact.data as Record<string, unknown>
    : {}
  return typeof data.status === 'string' ? data.status : ''
}

function resolveScopedImageTargetNodeIds(context: CharacterAgentRunContext, scopedRun: CharacterAgentScopedRun): string[] {
  const explicitTargets = scopedRun.scope.targetNodeIds?.filter(Boolean) ?? []
  if (explicitTargets.length) {
    return explicitTargets
  }
  const requirementTargets = new Set(scopedRun.scope.requirementIds ?? [])
  const fromRequirements = context.requirements
    .filter((requirement) => requirement.kind === 'image' && requirementTargets.has(requirement.id))
    .map((requirement) => requirement.targetNodeId)
  if (fromRequirements.length) {
    return fromRequirements
  }
  return context.requirements
    .filter((requirement) => requirement.kind === 'image')
    .map((requirement) => requirement.targetNodeId)
    .slice(0, 1)
}

function shouldRunScopedImageTargets(artifacts: CharacterAgentArtifact[], scopedRun: CharacterAgentScopedRun): boolean {
  if (scopedRun.scope.targetNodeIds?.some(Boolean) || scopedRun.scope.requirementIds?.some(Boolean)) {
    return true
  }
  const artifactIds = new Set(scopedRun.scope.artifactIds ?? [])
  if (!artifactIds.size) {
    return false
  }
  return artifacts.some((artifact) => (
    artifactIds.has(artifact.id)
    && (artifact.kind === 'image-asset' || artifact.kind === 'image-attempt' || artifact.kind === 'stale-marker')
  ))
}

function resolveScopedArtifacts(artifacts: CharacterAgentArtifact[], scopedRun: CharacterAgentScopedRun): CharacterAgentArtifact[] {
  const artifactIds = new Set(scopedRun.scope.artifactIds ?? [])
  if (!artifactIds.size) {
    return []
  }
  return artifacts.filter((artifact) => artifactIds.has(artifact.id))
}

function compactScopedArtifactData(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return data
  }
  const record = data as Record<string, unknown>
  return Object.fromEntries(Object.entries(record).map(([key, value]) => {
    if ((key === 'dataUrl' || key === 'url') && typeof value === 'string') {
      return [key, `[preserved ${key}: ${value.slice(0, 80)}]`]
    }
    if (typeof value === 'string' && value.length > 1400) {
      return [key, `${value.slice(0, 1400)}...`]
    }
    return [key, value]
  }))
}

function createStaleMarkersForScopedImageTargets(
  context: CharacterAgentRunContext,
  artifacts: CharacterAgentArtifact[],
  regeneratedTargetNodeIds: string[],
  newImageArtifactIds: string[],
  runId: string
): Array<Omit<CharacterAgentArtifact, 'version' | 'createdAt' | 'updatedAt'>> {
  const regenerated = new Set(regeneratedTargetNodeIds)
  const downstreamTargetIds = new Set(context.requirements
    .filter((requirement) => requirement.kind === 'image')
    .filter((requirement) => requirement.referenceSourceNodeIds.some((sourceNodeId) => regenerated.has(sourceNodeId)))
    .map((requirement) => requirement.targetNodeId))
  if (!downstreamTargetIds.size) {
    return []
  }
  return artifacts
    .filter((artifact) => artifact.kind === 'image-asset' && artifact.sourceNodeId && downstreamTargetIds.has(artifact.sourceNodeId))
    .map((artifact) => ({
      id: `${runId}:stale:${artifact.id}`,
      kind: 'stale-marker' as const,
      runId,
      candidateId: artifact.candidateId,
      sourceNodeId: artifact.sourceNodeId,
      title: `Stale: ${artifact.title}`,
      summary: `This image may be stale because ${regeneratedTargetNodeIds.join(', ')} was regenerated.`,
      data: {
        staleArtifactId: artifact.id,
        staleTargetNodeId: artifact.sourceNodeId,
        changedTargetNodeIds: regeneratedTargetNodeIds,
        newImageArtifactIds,
        reason: 'reference-source-rerolled',
      },
    }))
}

function areAllRequiredRequirementsDone(requirements: CharacterWorkflowRequirementState[]): boolean {
  return requirements.every((requirement) => !requirement.required || requirement.status === 'done')
}

function requirementMissingLabels(requirements: CharacterWorkflowRequirementState[]): string[] {
  return requirements
    .filter((requirement) => requirement.required && requirement.status !== 'done')
    .map((requirement) => requirement.missingReason || `${requirement.kind}:${requirement.targetNodeId}`)
}

function resolveReferenceImagesByTarget(
  context: CharacterAgentRunContext,
  artifacts: CharacterAgentArtifact[]
): Record<string, string[]> {
  const imageByTarget = new Map<string, string[]>()
  for (const artifact of artifacts) {
    if (artifact.kind !== 'image-asset' || !artifact.sourceNodeId) {
      continue
    }
    const reference = imageReferenceFromArtifact(artifact)
    if (!reference) {
      continue
    }
    imageByTarget.set(artifact.sourceNodeId, [...(imageByTarget.get(artifact.sourceNodeId) ?? []), reference])
  }
  return Object.fromEntries(
    context.requirements
      .filter((requirement) => requirement.kind === 'image' && requirement.referenceSourceNodeIds.length)
      .map((requirement) => [
        requirement.targetNodeId,
        requirement.referenceSourceNodeIds.flatMap((sourceNodeId) => imageByTarget.get(sourceNodeId) ?? []),
      ])
      .filter(([, references]) => references.length)
  )
}

function imageReferenceFromArtifact(artifact: CharacterAgentArtifact): string | null {
  const data = artifact.data && typeof artifact.data === 'object' && !Array.isArray(artifact.data)
    ? artifact.data as Record<string, unknown>
    : {}
  return stringValue(data.dataUrl) || stringValue(data.url) || null
}

export function evaluateCharacterWorkflowRequirements(
  context: CharacterAgentRunContext,
  draft: CharacterCardDraft | undefined,
  artifacts: CharacterAgentArtifact[]
): CharacterWorkflowRequirementState[] {
  const fields = draft?.fields ?? {}
  const doneNodeIds = new Set<string>()
  const imageArtifactsByTarget = new Map<string, CharacterAgentArtifact[]>()
  const failedImageAttemptsByTarget = new Map<string, CharacterAgentArtifact[]>()
  for (const artifact of artifacts) {
    if (artifact.kind === 'image-asset' && artifact.sourceNodeId) {
      imageArtifactsByTarget.set(artifact.sourceNodeId, [...(imageArtifactsByTarget.get(artifact.sourceNodeId) ?? []), artifact])
    }
    if (artifact.kind === 'image-attempt' && artifact.sourceNodeId && imageAttemptStatus(artifact) === 'failed') {
      failedImageAttemptsByTarget.set(artifact.sourceNodeId, [...(failedImageAttemptsByTarget.get(artifact.sourceNodeId) ?? []), artifact])
    }
  }

  const provisional = context.requirements.map((requirement): CharacterWorkflowRequirementState => {
    if (requirement.kind === 'character-field') {
      const complete = requirement.field ? hasDraftField(fields, requirement.field, context) : false
      if (complete) {
        doneNodeIds.add(requirement.targetNodeId)
      }
      return {
        ...requirement,
        status: complete ? 'done' : 'missing',
        completedCount: complete ? 1 : 0,
        artifactIds: [],
        missingReason: complete ? undefined : `Missing required field: ${requirement.field ?? requirement.title}`,
      }
    }

    const imageArtifacts = imageArtifactsByTarget.get(requirement.targetNodeId) ?? []
    const failedAttempts = failedImageAttemptsByTarget.get(requirement.targetNodeId) ?? []
    const requiredCount = Math.max(1, Math.floor(requirement.requiredCount ?? 1))
    const complete = imageArtifacts.length >= requiredCount
    if (complete) {
      doneNodeIds.add(requirement.targetNodeId)
    }
    return {
      ...requirement,
      status: complete ? 'done' : failedAttempts.length ? 'failed' : 'missing',
      completedCount: imageArtifacts.length,
      artifactIds: [...imageArtifacts, ...failedAttempts].map((artifact) => artifact.id),
      missingReason: complete
        ? undefined
        : failedAttempts.length
          ? `Image target ${requirement.title} has ${failedAttempts.length} failed attempt(s).`
          : `Missing image target ${requirement.title}: ${imageArtifacts.length}/${requiredCount}`,
    }
  })

  return provisional.map((requirement) => {
    if (requirement.status === 'done') {
      return requirement
    }
    if (requirement.kind === 'image' && !context.capabilities.imageModels.length) {
      return {
        ...requirement,
        status: 'failed',
        missingReason: `Image target ${requirement.title} cannot run because no image model capability is configured.`,
      }
    }
    if (requirement.kind === 'image') {
      const missingPrerequisiteFields = getMissingImagePrerequisiteFields(draft, context)
      if (missingPrerequisiteFields.length) {
        return {
          ...requirement,
          status: 'blocked',
          missingReason: `Blocked by missing image prerequisite field(s): ${missingPrerequisiteFields.join(', ')}`,
        }
      }
    }
    const blockedBy = requirement.dependencyNodeIds.filter((nodeId) => !doneNodeIds.has(nodeId))
    if (blockedBy.length) {
      return {
        ...requirement,
        status: 'blocked',
        missingReason: `Blocked by incomplete requirement source(s): ${blockedBy.join(', ')}`,
      }
    }
    return requirement
  })
}

function createWorkflowRequirements(
  targets: AgentTargetContext[],
  relations: CharacterAgentRelation[]
): CharacterWorkflowRequirement[] {
  const requirements: CharacterWorkflowRequirement[] = []
  const fieldTargets = targets
    .filter((target) => target.kind === 'character-field' && target.field)
    .map((target) => ({ field: target.field!, target }))
  const cardTargets = targets.filter((target) => target.kind === 'character-card')
  const requiredFields = new Map<string, AgentTargetContext>()
  const hasImageTargets = targets.some((target) => target.kind === 'image')

  for (const target of cardTargets) {
    for (const field of [
      ...stringListValue(target.config.includeFields, [...CHARACTER_CARD_FIELD_SCHEMA]),
      ...stringListValue(target.config.includeSupportFields, [...CHARACTER_SUPPORT_FIELD_SCHEMA]),
    ]) {
      requiredFields.set(normalizeDraftFieldName(field), target)
    }
  }
  for (const item of fieldTargets) {
    requiredFields.set(normalizeDraftFieldName(item.field), item.target)
  }
  if (!requiredFields.size) {
    const fallbackTarget = cardTargets[0] ?? targets[0]
    for (const field of [...CHARACTER_CARD_FIELD_SCHEMA, ...CHARACTER_SUPPORT_FIELD_SCHEMA]) {
      requiredFields.set(field, fallbackTarget)
    }
  }
  if (hasImageTargets) {
    const supportTarget = cardTargets[0] ?? targets[0]
    for (const field of CHARACTER_SUPPORT_FIELD_SCHEMA) {
      if (!requiredFields.has(field)) {
        requiredFields.set(field, supportTarget)
      }
    }
  }

  for (const [field, target] of requiredFields) {
    if (!field) {
      continue
    }
    requirements.push({
      id: `field:${field}`,
      kind: 'character-field',
      targetNodeId: target?.nodeId ?? 'character-card',
      title: characterRunFieldTitle(field),
      required: true,
      field,
      dependencyNodeIds: [],
      referenceSourceNodeIds: [],
    })
  }

  const imageTargetIds = new Set(targets.filter((target) => target.kind === 'image').map((target) => target.nodeId))
  for (const target of targets.filter((target) => target.kind === 'image')) {
    const controls = target.imageControls.length ? target.imageControls : [undefined]
    const requiredCount = controls.reduce((sum, control) => sum + Math.max(1, Math.floor(control?.targetImageCount ?? 1)), 0)
    const referenceSourceNodeIds = relations
      .filter((relation) =>
        relation.toNodeId === target.nodeId &&
        relation.fromPort === 'imageAsset' &&
        imageTargetIds.has(relation.fromNodeId)
      )
      .map((relation) => relation.fromNodeId)
    requirements.push({
      id: `image:${target.nodeId}`,
      kind: 'image',
      targetNodeId: target.nodeId,
      title: target.title,
      required: true,
      imageRole: target.imageRole,
      requiredCount,
      dependencyNodeIds: [...new Set(referenceSourceNodeIds)],
      referenceSourceNodeIds: [...new Set(referenceSourceNodeIds)],
    })
  }

  return requirements
}

function isCharacterDraftComplete(draft: CharacterCardDraft | undefined, context: CharacterAgentRunContext): boolean {
  const fields = draft?.fields ?? {}
  return getRequiredCharacterDraftFields(context).every((field) => hasDraftField(fields, field, context))
}

function getMissingCharacterDraftFields(draft: CharacterCardDraft | undefined, context: CharacterAgentRunContext): string[] {
  const fields = draft?.fields ?? {}
  return getRequiredCharacterDraftFields(context).filter((field) => !hasDraftField(fields, field, context))
}

function getNextMissingField(draft: CharacterCardDraft | undefined, context: CharacterAgentRunContext): string | null {
  const fields = draft?.fields ?? {}
  return getRequiredCharacterDraftFields(context).find((field) => !hasDraftField(fields, field, context)) ?? null
}

function getRequiredCharacterDraftFields(context: CharacterAgentRunContext): string[] {
  const fieldTargets = context.targets
    .filter((target) => target.kind === 'character-field' && target.field)
    .map((target) => target.field!)
  const cardTargets = context.targets.filter((target) => target.kind === 'character-card')
  const cardFields = cardTargets.flatMap((target) => [
    ...stringListValue(target.config.includeFields, [...CHARACTER_CARD_FIELD_SCHEMA]),
    ...stringListValue(target.config.includeSupportFields, [...CHARACTER_SUPPORT_FIELD_SCHEMA]),
  ])
  const imagePrerequisiteFields = context.requirements.some((requirement) => requirement.kind === 'image' && requirement.required)
    ? [...CHARACTER_SUPPORT_FIELD_SCHEMA]
    : []
  const required = [...new Set([...cardFields, ...fieldTargets, ...imagePrerequisiteFields])]
  return required.length ? required : [...CHARACTER_CARD_FIELD_SCHEMA, ...CHARACTER_SUPPORT_FIELD_SCHEMA]
}

function getMissingImagePrerequisiteFields(draft: CharacterCardDraft | undefined, context: CharacterAgentRunContext): string[] {
  if (!context.requirements.some((requirement) => requirement.kind === 'image' && requirement.required)) {
    return []
  }
  const fields = draft?.fields ?? {}
  return CHARACTER_SUPPORT_FIELD_SCHEMA.filter((field) => !hasDraftField(fields, field, context))
}

function hasDraftField(fields: Record<string, unknown>, field: string, context: CharacterAgentRunContext): boolean {
  const value = fields[field]
  if (typeof value === 'string') {
    return Boolean(value.trim()) && !isMetaPromptLeak(field, value, context)
  }
  if (Array.isArray(value)) {
    return value.length > 0
  }
  return value !== undefined && value !== null
}

function sanitizeCharacterDraftFieldValue(
  field: string,
  value: unknown,
  context: CharacterAgentRunContext,
  draft: CharacterCardDraft
): unknown {
  if (typeof value !== 'string') {
    return value
  }
  const text = value.trim()
  if (!text || !isMetaPromptLeak(field, text, context)) {
    return field === 'firstMessage' ? normalizeRoleChatOpening(text) : value
  }
  return undefined
}

function normalizeRoleChatOpening(value: string): string {
  const text = value.trim()
  if (!text) {
    return text
  }
  const match = text.match(/<chat>([\s\S]*?)<\/chat>/i)
  if (match) {
    return `<chat>${match[1].trim()}</chat>`
  }
  return `<chat>${text.replace(/<\/?chat>/gi, '').trim()}</chat>`
}

function validateCharacterOutputFormat(draft: CharacterCardDraft | undefined): string[] {
  const issues: string[] = []
  const firstMessage = typeof draft?.fields.firstMessage === 'string' ? draft.fields.firstMessage.trim() : ''
  if (!firstMessage) {
    issues.push('firstMessage is empty')
  } else if (!/^<chat>[\s\S]+<\/chat>$/.test(firstMessage)) {
    issues.push('firstMessage missing <chat> wrapper')
  } else {
    const inner = firstMessage.replace(/^<chat>/i, '').replace(/<\/chat>$/i, '').trim()
    if (!inner) {
      issues.push('firstMessage <chat> body is empty')
    }
    if (/<\/?(narration|metadata|style|goal|field)[^>]*>/i.test(inner)) {
      issues.push('firstMessage contains non-chat protocol tags')
    }
  }
  return issues
}

function repairCharacterOutputFormat(draft: CharacterCardDraft, now: number): CharacterCardDraft {
  const firstMessage = typeof draft.fields.firstMessage === 'string'
    ? normalizeRoleChatOpening(draft.fields.firstMessage)
    : ''
  return {
    ...draft,
    fields: {
      ...draft.fields,
      ...(firstMessage ? { firstMessage } : {}),
    },
    notes: appendUnique(draft.notes, ['Repaired role-chat output format before export.']),
    updatedAt: now,
  }
}

function isMetaPromptLeak(field: string, value: string, context: CharacterAgentRunContext): boolean {
  if (!(CHARACTER_CARD_FIELD_SCHEMA as readonly string[]).includes(field)) {
    return false
  }
  const text = value.trim()
  if (!text) return false
  const lower = text.toLowerCase()
  const normalizedGoal = context.goal.prompt.trim()
  const stylePrompts = context.stylePressures.map((item) => item.prompt.trim()).filter(Boolean)
  const leakPatterns = [
    /(^|\s)style\s*[:：]/i,
    /风格压力|字段目的|目标氛围|目标提示词|资源图|生成目标|长期\s*RP\s*故事框架/,
    /local_style_pressures|field_control|goal_prompt|target_audience|fixed_schema/i,
    /must include\s*:|avoid\s*:|character portrait for\s*:/i,
  ]
  if (leakPatterns.some((pattern) => pattern.test(text))) {
    return true
  }
  if (normalizedGoal && text === normalizedGoal) {
    return true
  }
  if (stylePrompts.some((prompt) => prompt && (text === prompt || lower.includes(`style: ${prompt.toLowerCase()}`)))) {
    return true
  }
  if (field === 'description' && text.length < 18 && /角色卡|story|framework|目标|goal/i.test(text)) {
    return true
  }
  return false
}

function pickCharacterCardFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    CHARACTER_CARD_FIELD_SCHEMA
      .filter((field) => fields[field] !== undefined && fields[field] !== null)
      .map((field) => [field, fields[field]])
  )
}

function isCharacterRunField(field: string): boolean {
  return (CHARACTER_CARD_FIELD_SCHEMA as readonly string[]).includes(field) || (CHARACTER_SUPPORT_FIELD_SCHEMA as readonly string[]).includes(field)
}

function characterRunFieldTitle(field: string): string {
  const titles: Record<string, string> = {
    name: 'Name',
    description: 'Description',
    appearance: 'Appearance',
    personality: 'Personality',
    background: 'Background',
    scenario: 'Scenario',
    firstMessage: 'First Message',
    dialogueStyle: 'Dialogue Style',
    worldContext: 'World Context',
    appearancePrompt: 'Appearance Prompt',
  }
  return titles[field] ?? field
}

function normalizeDraftFields(fields: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    const field = normalizeDraftFieldName(key)
    if (field) {
      normalized[field] = value
    }
  }
  return normalized
}

function normalizeDraftFieldName(field: string): string {
  const trimmed = field.trim()
  const aliases: Record<string, string> = {
    summary: 'description',
    bio: 'description',
    openingMessage: 'firstMessage',
    opening: 'firstMessage',
    styleGuide: 'dialogueStyle',
    dialogueStyleGuide: 'dialogueStyle',
    world: 'worldContext',
  }
  return aliases[trimmed] ?? trimmed
}

function summarizeDraft(draft: CharacterCardDraft | undefined): string {
  if (!draft) {
    return 'Character card draft is empty.'
  }
  const name = stringValue(draft.fields.name, 'Character')
  const description = summarizeValue(draft.fields.description || draft.fields.scenario || draft.fields.personality)
  return `${name}: ${description}`
}

function summarizeValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim().slice(0, 180) || 'Generated character resource.'
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return stringValue(record.summary, stringValue(record.description, JSON.stringify(value).slice(0, 180)))
  }
  return 'Generated character resource.'
}

function appendUnique(values: string[], nextValues: string[]): string[] {
  const seen = new Set(values)
  const merged = [...values]
  nextValues.map((value) => value.trim()).filter(Boolean).forEach((value) => {
    if (!seen.has(value)) {
      seen.add(value)
      merged.push(value)
    }
  })
  return merged
}

function artifactTitle(kind: CharacterAgentArtifactKind): string {
  const titles: Record<CharacterAgentArtifactKind, string> = {
    'agent-plan': 'Agent Plan',
    'task-understanding': 'Task Understanding',
    'style-brief': 'Style Brief',
    'constraint-brief': 'Constraint Brief',
    'source-summary': 'Source Summary',
    'character-card-draft': 'Character Card Draft',
    'character-card-field': 'Character Card Field',
    'character-card-final': 'Character Card',
    'opening-message': 'Opening Message',
    'opening-layout': 'Opening Layout',
    'dialogue-style-guide': 'Dialogue Style Guide',
    'world-context': 'World Context',
    'scene-context': 'Scene Context',
    'image-prompt': 'Image Prompt',
    'image-attempt': 'Image Attempt',
    'image-asset': 'Image Asset',
    'stale-marker': 'Stale Marker',
    'voice-direction': 'Voice Direction',
    'voice-asset': 'Voice Asset',
    'candidate-pack': 'Candidate Pack',
    'critique-report': 'Critique Report',
    'quality-report': 'Quality Report',
    'chat-simulation-report': 'Chat Simulation Report',
    'export-package': 'Export Package',
    'generation-report': 'Generation Report',
  }
  return titles[kind]
}

function isDecisionObject(value: unknown): value is CharacterAgentDecision {
  return Boolean(value && typeof value === 'object' && 'actions' in value && Array.isArray((value as CharacterAgentDecision).actions))
}

function isArtifactKind(value: unknown): value is CharacterAgentArtifactKind {
  return typeof value === 'string' && [
    'agent-plan',
    'task-understanding',
    'style-brief',
    'constraint-brief',
    'source-summary',
    'character-card-draft',
    'character-card-field',
    'character-card-final',
    'opening-message',
    'opening-layout',
    'dialogue-style-guide',
    'world-context',
    'scene-context',
    'image-prompt',
    'image-attempt',
    'image-asset',
    'stale-marker',
    'voice-direction',
    'voice-asset',
    'candidate-pack',
    'critique-report',
    'quality-report',
    'chat-simulation-report',
    'export-package',
    'generation-report',
  ].includes(value)
}

function createDefaultAgentPlan(context: CharacterAgentRunContext): CharacterAgentPlan {
  return {
    id: `${context.runId}:plan`,
    title: 'Autonomous Character Resource Plan',
    strategy: `${context.strategy.mode} with ${context.strategy.branchCount} branch target(s) and ${context.policy.revisionBudget} repair budget.`,
    steps: [
      { id: 'interpret', title: 'Interpret graph intent', purpose: 'Understand goal, style, constraints, and source grounding.', phase: 'interpret', status: 'pending' },
      { id: 'produce', title: 'Produce candidate resources', purpose: `Generate ${flattenRequestedAssets(context).join(', ')}.`, phase: 'produce', status: 'pending' },
      { id: 'inspect', title: 'Inspect candidate quality', purpose: `Review ${context.qualityGate.requiredChecks.join(', ')}.`, phase: 'inspect', status: 'pending' },
      { id: 'package', title: 'Package export target', purpose: `Create ${context.exportTarget.format} output.`, phase: 'package', status: 'pending' },
    ],
  }
}

function groupNodesByType(nodes: CharacterWorkflowNode[]): Map<string, CharacterWorkflowNode[]> {
  const grouped = new Map<string, CharacterWorkflowNode[]>()
  for (const node of nodes) {
    grouped.set(node.type, [...(grouped.get(node.type) ?? []), node])
  }
  return grouped
}

function firstNode(grouped: Map<string, CharacterWorkflowNode[]>, type: string): CharacterWorkflowNode | undefined {
  return grouped.get(type)?.[0]
}

function createAgentTargetContexts(
  nodes: CharacterWorkflowNode[],
  relations: CharacterAgentRelation[],
  controls: {
    stylePressures: AgentStylePressure[]
    hardConstraints: AgentConstraint[]
    imageGenerationControls: AgentImageGenerationControl[]
    fieldGenerationControls: AgentFieldGenerationControl[]
    continuityControls: AgentContinuityControl[]
    relationshipControls: AgentRelationshipControl[]
  }
): AgentTargetContext[] {
  return nodes
    .map((node): AgentTargetContext | null => {
      const kind = targetKindForNodeType(node.type)
      if (!kind) {
        return null
      }
      return {
        nodeId: node.id,
        kind,
        title: node.title,
        config: { ...node.config },
        field: kind === 'character-field' ? stringValue(node.config.field) : undefined,
        imageRole: kind === 'image' ? stringValue(node.config.imageRole) : undefined,
        imageAssetPurpose: kind === 'image' ? stringValue(node.config.assetPurpose) : undefined,
        requestedResources: requestedResourcesForTarget(node, kind),
        incomingRelations: incomingRelations(relations, node.id),
        localStylePressures: controls.stylePressures.filter((control) => isLocallyConnected(relations, node.id, control.nodeId)),
        localConstraints: controls.hardConstraints.filter((control) => isLocallyConnected(relations, node.id, control.nodeId)),
        imageControls: controls.imageGenerationControls.filter((control) => isLocallyConnected(relations, node.id, control.nodeId)),
        fieldControls: controls.fieldGenerationControls.filter((control) => isLocallyConnected(relations, node.id, control.nodeId)),
        continuityControls: controls.continuityControls.filter((control) => isLocallyConnected(relations, node.id, control.nodeId)),
        relationshipControls: controls.relationshipControls.filter((control) => isLocallyConnected(relations, node.id, control.nodeId)),
      }
    })
    .filter((target): target is AgentTargetContext => Boolean(target))
}

function targetKindForNodeType(type: string): AgentTargetKind | null {
  const kinds: Record<string, AgentTargetKind> = {
    'character-card-target': 'character-card',
    'character-field-target': 'character-field',
    'opening-layout-target': 'opening-layout',
    'image-target': 'image',
    'world-card-target': 'world-card',
    'npc-pack-target': 'npc-pack',
    'npc-target': 'npc',
    'plot-arc-target': 'plot-arc',
    'scene-card-target': 'scene-card',
  }
  return kinds[type] ?? null
}

function requestedResourcesForTarget(node: CharacterWorkflowNode, kind: AgentTargetKind): string[] {
  if (kind === 'character-card') {
    return ['character-card', ...stringListValue(node.config.includeFields), ...stringListValue(node.config.includeSupportFields)]
  }
  if (kind === 'character-field') {
    return [`field:${stringValue(node.config.field, 'firstMessage')}`]
  }
  if (kind === 'opening-layout') {
    return ['opening-layout', ...stringListValue(node.config.includeSections)]
  }
  if (kind === 'image') {
    const imageRole = stringValue(node.config.imageRole)
    if (!imageRole) {
      throw new Error(`Image target ${node.id} is missing imageRole`)
    }
    return [`image:${imageRole}`]
  }
  if (kind === 'world-card') {
    return ['world-card', ...stringListValue(node.config.worldSections)]
  }
  if (kind === 'npc-pack') {
    return ['npc-pack', ...stringListValue(node.config.npcRoles)]
  }
  if (kind === 'npc') {
    return [`npc:${stringValue(node.config.npcRole, 'primary-npc')}`]
  }
  if (kind === 'plot-arc') {
    return [`plot-arc:${stringValue(node.config.arcShape, 'slow-burn')}`]
  }
  return ['scene-card', ...stringListValue(node.config.sceneTypes)]
}

function isLocallyConnected(relations: CharacterAgentRelation[], targetNodeId: string, controlNodeId: string): boolean {
  return relations.some((relation) => (
    relation.fromNodeId === targetNodeId && relation.toNodeId === controlNodeId
  ) || (
    relation.fromNodeId === controlNodeId && relation.toNodeId === targetNodeId
  ))
}

function createAgentRelation(edge: CharacterWorkflowEdge): CharacterAgentRelation {
  return {
    fromNodeId: edge.from.nodeId,
    fromPort: edge.from.port,
    toNodeId: edge.to.nodeId,
    toPort: edge.to.port,
    kind: edge.kind,
    meaning: relationMeaning(edge.kind),
  }
}

function relationMeaning(kind: CharacterWorkflowLinkKind): string {
  const meanings: Record<CharacterWorkflowLinkKind, string> = {
    guides: 'upstream context guides downstream interpretation',
    constrains: 'upstream context limits downstream choices',
    provides: 'upstream context provides material or capability',
    enables: 'upstream capability enables downstream action',
    grounds: 'upstream material grounds downstream generation',
    weights: 'upstream context changes downstream priority',
    routes: 'upstream context influences execution path',
    evaluates: 'upstream context is used to evaluate downstream output',
    refines: 'upstream feedback refines downstream generation',
    exports: 'upstream output enters export packaging',
  }
  return meanings[kind]
}

function incomingRelations(relations: CharacterAgentRelation[], nodeId: string): CharacterAgentRelation[] {
  return relations.filter((relation) => relation.toNodeId === nodeId)
}

function modelCapability(
  node: CharacterWorkflowNode,
  kind: CharacterAgentModelKind,
  fallbackApiId: string | undefined,
  fallbackModelName: string | undefined
): AgentModelCapability {
  const modelRef = stringValue(node.config.modelRef, createModelRef(fallbackApiId, fallbackModelName))
  const parsed = parseModelRef(modelRef)
  return {
    nodeId: node.id,
    kind,
    apiId: parsed.apiId,
    modelName: parsed.modelName,
    modelRef,
    parameters: {
      ...(node.type === 'image-edit-tool' ? { usageMode: 'reference-edit' } : {}),
      ...Object.fromEntries(Object.entries(node.config).filter(([key]) => key !== 'modelRef')),
    },
  }
}

function matchesArtifactFilter(
  artifact: CharacterAgentArtifact,
  filter: { runId?: string; kind?: CharacterAgentArtifactKind; candidateId?: string }
): boolean {
  return (!filter.runId || artifact.runId === filter.runId)
    && (!filter.kind || artifact.kind === filter.kind)
    && (!filter.candidateId || artifact.candidateId === filter.candidateId)
}

function flattenRequestedAssets(context: CharacterAgentRunContext): string[] {
  const requested = context.requestedAssets.flatMap((target) => target.requested)
  return requested.length ? [...new Set(requested)] : context.strategy.priorityAssets
}

function createModelRef(apiId: string | undefined, modelName: string | undefined): string {
  return apiId && modelName ? `${apiId}::${modelName}` : ''
}

function imageEditModelName(modelName: string | undefined): string | undefined {
  const normalized = modelName?.trim()
  return normalized?.endsWith('/text-to-image')
    ? normalized.replace(/\/text-to-image$/, '/edit')
    : normalized
}

function parseModelRef(modelRef: string): { apiId: string; modelName: string } {
  const [apiId = '', ...modelNameParts] = modelRef.split('::')
  return {
    apiId,
    modelName: modelNameParts.join('::'),
  }
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function stringListValue(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) {
    return fallback
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function isCharacterWorkflowLike(value: unknown): value is CharacterWorkflow {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<CharacterWorkflow>
  return typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.version === 'string'
    && Array.isArray(candidate.nodes)
    && Array.isArray(candidate.edges)
    && Boolean(candidate.defaults)
}

function createEmptyWorkflow(): CharacterWorkflow {
  const now = Date.now()
  return {
    id: '',
    name: 'Invalid Character Workflow',
    version: CURRENT_CHARACTER_WORKFLOW_VERSION,
    nodes: [],
    edges: [],
    defaults: { language: 'zh-CN' },
    metadata: {
      createdAt: now,
      updatedAt: now,
    },
  }
}
