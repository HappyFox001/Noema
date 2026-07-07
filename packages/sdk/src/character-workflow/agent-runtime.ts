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
  | 'source-material'
  | 'character-card-draft'
  | 'character-card-field'
  | 'character-card-final'
  | 'opening-message'
  | 'opening-layout'
  | 'atmosphere-style'
  | 'game-system'
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
  | 'atmosphere-style'
  | 'game-system'
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
  poseGoals: string[]
  backgroundInteraction: string
  appealMode: string
  sensualityLevel: string
  wardrobeExposure: string
  shotType: string
  aspectRatio: string
  consistencyMode: string
  seedMode: string
  incomingRelations: CharacterAgentRelation[]
}

export interface AgentFieldGenerationControl {
  nodeId: string
  field: string
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
  fields?: string[]
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
  materials: AgentSourceMaterialItem[]
  incomingRelations: CharacterAgentRelation[]
}

export interface AgentSourceMaterialItem {
  id: string
  kind: 'image' | 'document'
  name: string
  mimeType: string
  size?: number
  dataUrl?: string
  text?: string
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
  targetIndex?: number
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
    poseGoals: stringListValue(node.config.poseGoals),
    backgroundInteraction: stringValue(node.config.backgroundInteraction),
    appealMode: stringValue(node.config.appealMode, 'sensual-confidence'),
    sensualityLevel: stringValue(node.config.sensualityLevel, 'sensual'),
    wardrobeExposure: stringValue(node.config.wardrobeExposure, 'stylish-revealing'),
    shotType: stringValue(node.config.shotType, 'auto'),
    aspectRatio: stringValue(node.config.aspectRatio, '1:1'),
    consistencyMode: stringValue(node.config.consistencyMode, 'same-character'),
    seedMode: stringValue(node.config.seedMode, 'lock-character'),
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
    continuityControls,
    relationshipControls,
    sourceMaterials: (nodesByType.get('source-material') ?? []).map((node) => ({
      nodeId: node.id,
      kind: inferSourceMaterialKind(node.config.materials),
      notes: stringValue(node.config.notes),
      groundingStrength: numberValue(node.config.groundingStrength, 0.5),
      materials: normalizeSourceMaterialItems(node.config.materials),
      incomingRelations: incomingRelations(relations, node.id),
    })),
    capabilities: {
      llmModels: (nodesByType.get('llm-tool') ?? []).map((node) => modelCapability(node, 'llm', workflow.defaults.llmApiId, workflow.defaults.llmModelName)),
      imageModels: (nodesByType.get('image-tool') ?? []).flatMap((node) => imageToolCapabilities(node, workflow.defaults.imageApiId, workflow.defaults.imageModelName)),
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
      revisionBudget: numberValue(policyNode?.config.revisionBudget, 12),
      askUserThreshold: stringValue(policyNode?.config.askUserThreshold, 'blocked-only'),
      canExpandMissingDetails: booleanValue(policyNode?.config.canExpandMissingDetails, true),
      incomingRelations: policyNode ? incomingRelations(relations, policyNode.id) : [],
    },
    strategy: {
      nodeId: strategyNode?.id,
      mode: stringValue(strategyNode?.config.mode, 'branch-and-refine'),
      branchCount: numberValue(strategyNode?.config.branchCount, 3),
      priorityAssets: stringListValue(strategyNode?.config.priorityAssets, ['role-card', 'opening', 'opening-layout', 'atmosphere-style', 'image-pack']),
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
    if ((node.type === 'llm-tool' || node.type === 'image-tool') && !stringValue(node.config.modelRef)) {
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
      const applyImageToolResult = (
        imageResult: AgentToolResult,
        promptTexts: string[],
        note: string | undefined
      ): { imageIds: string[]; failedAttemptIds: string[] } => {
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
            notes: appendUnique(state.draft!.notes, [note ?? imageResult.summary]),
            updatedAt: now(),
          },
        }
        refreshRequirements()
        return { imageIds, failedAttemptIds }
      }
      const getNextImageTargetIndex = (targetNodeId: string): number => (
        state.artifacts.filter((artifact) => artifact.kind === 'image-asset' && artifact.sourceNodeId === targetNodeId).length + 1
      )
      const executeImageRequestAction = async (action: Extract<CharacterAgentAction, { type: 'request_image' }>, phase: CharacterAgentPhase) => {
        if (!await ensureImagePrerequisites(phase)) {
          return
        }
        for (const prompt of action.targetPrompts) {
          const imageResult = await callTool('generate_character_image', phase, {
            targetPrompts: [{
              ...prompt,
              targetIndex: prompt.targetIndex ?? getNextImageTargetIndex(prompt.targetNodeId),
            }],
            draft: state.draft,
            referenceImagesByTarget: resolveReferenceImagesByTarget(context, state.artifacts),
          })
          const resultIds = applyImageToolResult(imageResult, [prompt.prompt.trim()].filter(Boolean), action.reason ?? imageResult.summary)
          if (resultIds.failedAttemptIds.length) {
            break
          }
        }
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
        const imageIds: string[] = []
        const failedAttemptIds: string[] = []
        for (const targetNodeId of uniqueTargetNodeIds) {
          const imageResult = await callTool('generate_character_image', phase, {
            draft: state.draft,
            autoGenerateTargetPrompts: true,
            singleImagePerTarget: true,
            targetNodeIds: [targetNodeId],
            targetPromptStartIndexByTarget: {
              [targetNodeId]: getNextImageTargetIndex(targetNodeId),
            },
            rerollInstruction: options.instruction,
            rerollAction: options.action,
            parentAttemptId: options.parentAttemptId,
            referenceImagesByTarget: resolveReferenceImagesByTarget(context, state.artifacts),
          })
          const resultIds = applyImageToolResult(imageResult, getGeneratedImagePromptTexts(imageResult.artifacts ?? []), imageResult.summary)
          imageIds.push(...resultIds.imageIds)
          failedAttemptIds.push(...resultIds.failedAttemptIds)
          if (options.scoped && resultIds.imageIds.length) {
            for (const staleMarker of createStaleMarkersForScopedImageTargets(context, state.artifacts, [targetNodeId], resultIds.imageIds, runId)) {
              await writeArtifact(staleMarker)
            }
          }
          await writeArtifact(createDraftArtifact(context, state.draft))
          if (resultIds.failedAttemptIds.length) {
            break
          }
        }
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
        for (const materialArtifact of createSourceMaterialArtifacts(context, runId)) {
          await writeArtifact(materialArtifact)
        }
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
            for (let attempt = 0; attempt < getImageGenerationAttemptBudget(context); attempt += 1) {
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

        for (let attempt = 0; attempt < getImageGenerationAttemptBudget(context); attempt += 1) {
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
        for (let attempt = 0; attempt < getImageGenerationAttemptBudget(context); attempt += 1) {
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

        for (const openingLayoutArtifact of createOpeningLayoutArtifacts(context, state.draft!, state.artifacts, runId)) {
          await writeArtifact(openingLayoutArtifact)
        }
        for (const atmosphereStyleArtifact of createAtmosphereStyleArtifacts(context, state.draft!, state.artifacts, runId)) {
          await writeArtifact(atmosphereStyleArtifact)
        }
        for (const gameSystemArtifact of createGameSystemArtifacts(context, state.draft!, runId)) {
          await writeArtifact(gameSystemArtifact)
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

function createSourceMaterialArtifacts(
  context: CharacterAgentRunContext,
  runId: string
): Array<Omit<CharacterAgentArtifact, 'version' | 'createdAt' | 'updatedAt'>> {
  return context.sourceMaterials.flatMap((source) => source.materials.map((material, index) => ({
    id: `${runId}:source-material:${source.nodeId}:${material.id || index}`,
    kind: 'source-material' as const,
    runId,
    candidateId: `${runId}:candidate:primary`,
    title: material.name,
    summary: material.kind === 'image'
      ? `Image material from ${source.nodeId}.`
      : compactText(material.text, 180) || `Document material from ${source.nodeId}.`,
    sourceNodeId: source.nodeId,
    data: {
      ...material,
      sourceNodeId: source.nodeId,
      sourceKind: source.kind,
      groundingStrength: source.groundingStrength,
    },
  })))
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

function createOpeningLayoutArtifacts(
  context: CharacterAgentRunContext,
  draft: CharacterCardDraft,
  artifacts: CharacterAgentArtifact[],
  runId: string
): Array<Omit<CharacterAgentArtifact, 'version' | 'createdAt' | 'updatedAt'>> {
  const targets = context.targets.filter((target) => target.kind === 'opening-layout')
  if (!targets.length) {
    return []
  }
  const fields = draft.fields ?? {}
  return targets.map((target) => {
    const data = createOpeningLayoutData(context, target, fields, artifacts)
    return {
      id: `${runId}:opening-layout:${target.nodeId}`,
      kind: 'opening-layout' as const,
      runId,
      candidateId: draft.id,
      sourceNodeId: target.nodeId,
      title: `${stringValue(fields.name, 'Character')} Opening Panel`,
      summary: stringValue(data.summary, `Opening panel for ${stringValue(fields.name, 'Character')}.`),
      data,
    }
  })
}

function createAtmosphereStyleArtifacts(
  context: CharacterAgentRunContext,
  draft: CharacterCardDraft,
  artifacts: CharacterAgentArtifact[],
  runId: string
): Array<Omit<CharacterAgentArtifact, 'version' | 'createdAt' | 'updatedAt'>> {
  const targets = context.targets.filter((target) => target.kind === 'atmosphere-style')
  if (!targets.length) {
    return []
  }
  const fields = draft.fields ?? {}
  return targets.map((target) => {
    const data = createAtmosphereStyleData(context, target, fields, artifacts)
    return {
      id: `${runId}:atmosphere-style:${target.nodeId}`,
      kind: 'atmosphere-style' as const,
      runId,
      candidateId: draft.id,
      sourceNodeId: target.nodeId,
      title: `${stringValue(fields.name, 'Character')} Atmosphere Style`,
      summary: stringValue(data.summary, `Atmosphere style for ${stringValue(fields.name, 'Character')}.`),
      data,
    }
  })
}

function createGameSystemArtifacts(
  context: CharacterAgentRunContext,
  draft: CharacterCardDraft,
  runId: string
): Array<Omit<CharacterAgentArtifact, 'version' | 'createdAt' | 'updatedAt'>> {
  const targets = context.targets.filter((target) => target.kind === 'game-system')
  if (!targets.length) {
    return []
  }
  const fields = draft.fields ?? {}
  return targets.map((target) => {
    const data = createGameSystemData(context, target, fields)
    return {
      id: `${runId}:game-system:${target.nodeId}`,
      kind: 'game-system' as const,
      runId,
      candidateId: draft.id,
      sourceNodeId: target.nodeId,
      title: `${stringValue(fields.name, 'Character')} Game System`,
      summary: stringValue(data.summary, `Game system for ${stringValue(fields.name, 'Character')}.`),
      data,
    }
  })
}

function createGameSystemData(
  context: CharacterAgentRunContext,
  target: AgentTargetContext,
  fields: Record<string, unknown>
): Record<string, unknown> {
  const name = stringValue(fields.name, 'Character')
  const sourceText = [
    context.goal.prompt,
    stringValue(fields.description),
    stringValue(fields.personality),
    stringValue(fields.scenario),
    stringValue(fields.worldContext),
    stringValue(fields.dialogueStyle),
    stringValue(target.config.statDesign),
    stringValue(target.config.equipmentRules),
    stringValue(target.config.statusRules),
    stringValue(target.config.panelDesign),
    ...target.localStylePressures.map((item) => item.prompt),
    ...target.localConstraints.flatMap((item) => [...item.mustHave, ...item.mustNot.map((rule) => `Avoid: ${rule}`)]),
  ].filter(Boolean).join('\n')
  const seed = hashText(`${name}\n${sourceText}`)
  const statBase = 34 + (seed % 22)
  const stats = [
    gameStat('resolve', 'Resolve', statBase + 10, 0, 100, 'mental pressure, fear, and willingness to act'),
    gameStat('composure', 'Composure', statBase + 4, 0, 100, 'visible control, social poise, and emotional leakage'),
    gameStat('affinity', 'Affinity', Math.max(8, Math.round(statBase * 0.72)), 0, 100, 'trust, attachment, and willingness to reveal private information'),
    gameStat('strain', 'Strain', Math.max(0, 62 - statBase), 0, 100, 'fatigue, injury, magical load, or narrative instability'),
    gameStat('leverage', 'Leverage', 18 + (seed % 37), 0, 100, 'resources, secrets, permissions, or tactical advantage'),
  ]
  const equipmentTone = /magic|curse|witch|spell|魔|咒|巫|玄/i.test(sourceText)
    ? 'ritual-compatible, rule-bound, and costly to misuse'
    : /school|campus|student|校园|学生/i.test(sourceText)
      ? 'daily-carry, socially plausible, and privacy-sensitive'
      : /cyber|terminal|hacker|赛博|黑客/i.test(sourceText)
        ? 'modular, traceable, and access-controlled'
        : 'setting-specific, consequential, and narratively earned'
  return {
    schemaVersion: 1,
    name: `${name} Game Layer`,
    summary: `Character-specific stats, equipment rules, and status rules generated from the workflow design for ${name}.`,
    stats,
    equipment: {
      slots: [
        equipmentSlot('worn', 'Worn / Carried', 3, `Items must fit the character silhouette and current scene. Equipment is ${equipmentTone}.`, [
          equipmentItem('signature-item', 'Signature item', 'A character-defining carried object generated from the role card at runtime.', ['signature', 'visible'], ['May unlock unique dialogue or alter leverage.']),
        ]),
        equipmentSlot('hidden', 'Hidden / Private', 2, 'Hidden items require a plausible concealment method, can be discovered by scene pressure, and must not contradict established clothing or access.', []),
        equipmentSlot('bound', 'Bound / Persistent', 2, 'Persistent gear, marks, contracts, implants, or magical bindings cannot be removed casually and must declare cost, trigger, and counterplay.', []),
      ],
      rules: [
        'Every equipment item must declare slot, visibility, source, narrative permission, and at least one stat/status interaction.',
        'Equipment cannot appear from nowhere: acquisition needs scene access, prior preparation, trade, crafting, gift, discovery, or explicit user action.',
        'Conflicting items cannot occupy the same physical or narrative function unless the rule text explains coexistence.',
        'Powerful equipment must add a cost, cooldown, social risk, durability loss, or status side effect.',
        stringValue(target.config.equipmentRules),
      ].filter(Boolean),
      acquisitionRules: [
        'Runtime may introduce minor common items when they are scene-plausible.',
        'Runtime must ask or foreshadow before granting rare, intimate, illegal, magical, or high-impact items.',
        'Lost, broken, traded, or confiscated equipment remains part of history and should affect future scenes.',
      ],
      forbiddenRules: [
        'Do not generate equipment that breaks the role card, violates hard constraints, or solves the central conflict for free.',
        'Do not use equipment as a shortcut around consent, relationship pacing, or established scene limitations.',
      ],
    },
    statuses: [
      statusEffect('focused', 'Focused', 'stable', 'Actions are cleaner; social tells are reduced.', 'Ends when interrupted or emotionally shaken.'),
      statusEffect('exposed', 'Exposed', 'risk', 'Secrets, wounds, or intentions are easier to read.', 'Clears after cover, recovery, or a successful diversion.'),
      statusEffect('marked', 'Marked', 'persistent', 'A visible or invisible narrative mark creates future consequences.', 'Requires an explicit cleansing, repair, or negotiation rule.'),
    ],
    rules: [
      'Stats are character-local and should change only when the conversation creates a concrete cause.',
      'Status effects must state trigger, duration, conflict behavior, and narrative consequence.',
      'The chat UI should expose equipment, status, and rules as quick panels without forcing the user to leave the conversation.',
      stringValue(target.config.statDesign),
      stringValue(target.config.statusRules),
      stringValue(target.config.panelDesign),
    ].filter(Boolean),
    ui: { quickPanels: ['equipment', 'status', 'rules'] },
  }
}

function gameStat(id: string, label: string, value: number, min: number, max: number, description: string): Record<string, unknown> {
  return { id, label, value: Math.max(min, Math.min(max, value)), min, max, description, visibility: 'shown' }
}

function equipmentSlot(id: string, label: string, limit: number, rule: string, current: Array<Record<string, unknown>>): Record<string, unknown> {
  return { id, label, limit, rule, current }
}

function equipmentItem(id: string, name: string, description: string, tags: string[], effects: string[]): Record<string, unknown> {
  return { id, name, description, tags, quantity: 1, effects }
}

function statusEffect(id: string, label: string, value: string, description: string, rule: string): Record<string, unknown> {
  return { id, label, value, description, rule }
}

function createAtmosphereStyleData(
  context: CharacterAgentRunContext,
  target: AgentTargetContext,
  fields: Record<string, unknown>,
  artifacts: CharacterAgentArtifact[]
): Record<string, unknown> {
  const name = stringValue(fields.name, 'Character')
  const description = stringValue(fields.description)
  const personality = stringValue(fields.personality)
  const scenario = stringValue(fields.scenario)
  const dialogueStyle = stringValue(fields.dialogueStyle)
  const worldContext = stringValue(fields.worldContext)
  const appearance = stringValue(fields.appearance)
  const appearancePrompt = stringValue(fields.appearancePrompt)
  const goalText = context.goal.prompt
  const localStyle = target.localStylePressures[0] ?? context.stylePressures[0]
  const stylePrompt = [
    stringValue(target.config.stylePrompt),
    stringValue(target.config.moodPreset),
    stringValue(target.config.surface),
    stringValue(target.config.messageFrame),
    stringValue(target.config.audioPlayer),
    stringValue(target.config.density),
    localStyle?.preset,
    localStyle?.prompt,
    goalText,
    description,
    personality,
    scenario,
    dialogueStyle,
    worldContext,
    appearance,
    appearancePrompt,
  ].filter(Boolean).join(' ')
  const fallbackProfile = createDefaultAtmosphereFallback()
  const scopeClass = `noema-atmosphere-${sanitizeCssIdentifier(target.nodeId)}`
  const freeStyle = createFreeAtmosphereStyle({
    fallback: fallbackProfile,
    scopeClass,
    characterName: name,
    description,
    personality,
    scenario,
    dialogueStyle,
    stylePrompt,
  })
  const firstSpeech = extractFirstRoleChatLine(stringValue(fields.firstMessage)) || dialogueStyle
  const narration = stripVisibleControlTags(stringValue(fields.firstMessage)) || scenario || description
  const imageHints = collectOpeningLayoutImages(artifacts).slice(0, 3).map((image) => ({
    id: image.id,
    role: image.role,
    title: image.title,
  }))
  return {
    schemaVersion: 1,
    name: freeStyle.name,
    summary: freeStyle.summary,
    mood: freeStyle.mood,
    scopeClass,
    css: freeStyle.css,
    designBrief: freeStyle.designBrief,
    palette: freeStyle.palette,
    message: freeStyle.message,
    audio: freeStyle.audio,
    sceneCard: freeStyle.sceneCard,
    preview: {
      userLine: '',
      narration: compactOpeningText(narration, 96),
      speech: compactOpeningText(firstSpeech, 64),
      location: compactOpeningText(scenario || worldContext, 34),
      status: freeStyle.previewStatus,
      equipment: freeStyle.previewEquipment,
    },
    source: {
      targetNodeId: target.nodeId,
      stylePrompt: stringValue(target.config.stylePrompt),
      derivedFrom: ['role-card', 'dialogueStyle', 'firstMessage', 'style-pressure'],
      imageHints,
    },
  }
}

function createOpeningLayoutData(
  context: CharacterAgentRunContext,
  target: AgentTargetContext,
  fields: Record<string, unknown>,
  artifacts: CharacterAgentArtifact[]
): Record<string, unknown> {
  const name = stringValue(fields.name, 'Unknown Character')
  const description = stringValue(fields.description)
  const opening = stripChatTags(stringValue(fields.firstMessage))
  const scenario = stringValue(fields.scenario)
  const worldContext = stringValue(fields.worldContext)
  const dialogueStyle = stringValue(fields.dialogueStyle)
  const includeSections = stringListValue(target.config.includeSections, ['title', 'tags', 'opening', 'coverImage', 'supportImages'])
  const requestedLayoutKind = stringValue(target.config.layoutKind, 'auto-opening-layout')
  const textDensity = normalizeOpeningTextDensity(stringValue(target.config.textDensity, 'minimal'))
  const style = resolveOpeningLayoutStyle(context, target, fields)
  const images = collectOpeningLayoutImages(artifacts)
  const cover = images[0]
  const supportImages = images.slice(1, 4)
  const layoutKind = chooseOpeningLayoutKind(requestedLayoutKind, {
    name,
    description,
    scenario,
    worldContext,
    dialogueStyle,
    style,
    cover,
    supportImages,
  })
  const scopeClass = `noema-opening-panel-${sanitizeCssIdentifier(target.nodeId)}`
  const sections = {
    title: name,
    summary: description,
    opening,
    scenario,
    worldContext,
    dialogueStyle,
  }
  const html = buildOpeningLayoutHtml({
    scopeClass,
    layoutKind,
    textDensity,
    name,
    description,
    opening,
    scenario,
    worldContext,
    dialogueStyle,
    includeSections,
    cover,
    supportImages,
  })
  const css = buildOpeningLayoutCss(scopeClass, style)
  return {
    schemaVersion: 2,
    layoutKind,
    requestedLayoutKind,
    textDensity,
    includeSections,
    summary: `${layoutKind} panel for ${name}, styled from ${style.preset}.`,
    html,
    css,
    text: opening || description || scenario,
    sections,
    images,
    style,
    source: {
      targetNodeId: target.nodeId,
      layoutPrompt: stringValue(target.config.layoutPrompt),
      imageArtifactIds: images.map((image) => image.id),
    },
  }
}

function resolveOpeningLayoutStyle(
  context: CharacterAgentRunContext,
  target: AgentTargetContext,
  fields: Record<string, unknown>
): Record<string, string> {
  const localStyle = target.localStylePressures[0] ?? context.stylePressures[0]
  const preset = localStyle?.preset || 'sillytavern-natural-card'
  const prompt = localStyle?.prompt || context.goal.prompt
  const text = [
    preset,
    prompt,
    stringValue(fields.description),
    stringValue(fields.scenario),
    stringValue(fields.personality),
  ].join(' ').toLowerCase()
  const gothic = /goth|noir|dark|horror|thriller|shadow|血|夜|暗|悬疑/.test(text)
  const warm = /warm|romance|comfort|soft|校园|温柔|治愈|浪漫/.test(text)
  const cyber = /cyber|neon|future|sci-fi|ai|城市|赛博|霓虹/.test(text)
  const accent = cyber ? '#76d7ff' : warm ? '#e2b278' : gothic ? '#b58cff' : '#d8dce0'
  const accentSoft = cyber ? 'rgba(118, 215, 255, 0.2)' : warm ? 'rgba(226, 178, 120, 0.2)' : gothic ? 'rgba(181, 140, 255, 0.2)' : 'rgba(216, 220, 224, 0.18)'
  const surface = gothic ? 'rgba(8, 8, 11, 0.94)' : 'rgba(9, 10, 12, 0.94)'
  return {
    preset,
    prompt,
    accent,
    accentSoft,
    surface,
    mood: cyber ? 'neon' : warm ? 'warm' : gothic ? 'noir' : 'minimal',
  }
}

function createDefaultAtmosphereFallback(): {
  name: string
  summary: string
  mood: string[]
  palette: Record<string, string>
  message: Record<string, string>
  audio: Record<string, string>
  sceneCard: Record<string, string>
  previewStatus: string[]
  previewEquipment: Array<Record<string, string>>
} {
  return {
    name: 'Neutral Atmosphere',
    summary: 'Neutral internal fallback used only when no generated atmosphere data exists.',
    mood: ['custom'],
    palette: {
      accent: '#c7d8d0',
      accentSoft: 'rgba(199, 216, 208, 0.16)',
      surface: 'glass',
      warmth: 'neutral',
      contrast: 'medium',
    },
    message: {
      frame: 'plain',
      narration: 'soft-prose',
      speech: 'quote-emphasis',
      density: 'balanced',
      radius: 'soft',
    },
    audio: {
      player: 'thin-glass-bar',
      motion: 'subtle-wave',
      tone: 'near',
    },
    sceneCard: {
      frame: 'quiet-panel',
      divider: 'fine-line',
    },
    previewStatus: ['氛围 50', '距离 50', '状态 50'],
    previewEquipment: [
      { name: '随身物件', ability: '维持角色气氛', quantity: '1' },
    ],
  }
}

function createFreeAtmosphereStyle(input: {
  fallback: ReturnType<typeof createDefaultAtmosphereFallback>
  scopeClass: string
  characterName: string
  description: string
  personality: string
  scenario: string
  dialogueStyle: string
  stylePrompt: string
}): ReturnType<typeof createDefaultAtmosphereFallback> & {
  css: string
  designBrief: Record<string, string>
} {
  const source = [
    input.characterName,
    input.description,
    input.personality,
    input.scenario,
    input.dialogueStyle,
    input.stylePrompt,
  ].filter(Boolean).join(' ')
  const lower = source.toLowerCase()
  const seed = hashText(source)
  const emotionalHeat = scoreText(lower, ['desire', 'romance', 'warm', 'intimate', '暧昧', '亲密', '欲', '恋', '温柔'])
  const threat = scoreText(lower, ['danger', 'secret', 'blood', 'knife', 'noir', '危险', '秘密', '血', '刀', '禁忌', '暗'])
  const precision = scoreText(lower, ['dossier', 'clinical', 'terminal', 'signal', 'lab', '档案', '实验', '终端', '信号', '机械'])
  const softness = scoreText(lower, ['rain', 'mist', 'dream', 'quiet', 'soft', '雨', '雾', '梦', '安静', '柔'])
  const hue = normalizeHue(seed % 360 + emotionalHeat * 22 - threat * 18 + precision * 34 + softness * 11)
  const saturation = clampNumber(34 + emotionalHeat * 10 + threat * 8 + precision * 6, 32, 72)
  const lightness = clampNumber(62 + softness * 5 - threat * 8 - precision * 4, 42, 72)
  const accent = `hsl(${hue} ${saturation}% ${lightness}%)`
  const accentSoft = `hsla(${hue} ${saturation}% ${lightness}% / ${clampNumber(0.12 + softness * 0.025 + emotionalHeat * 0.018, 0.12, 0.24).toFixed(2)})`
  const surfaceHue = normalizeHue(hue + 210 + precision * 16 - emotionalHeat * 10)
  const surface = `hsl(${surfaceHue} ${clampNumber(10 + precision * 4 + threat * 3, 10, 28)}% ${clampNumber(7 + softness * 2 - threat, 5, 14)}%)`
  const radiusPx = Math.round(clampNumber(11 + softness * 4 + emotionalHeat * 3 - precision * 3 - threat * 2 + (seed % 5), 8, 30))
  const paddingY = Math.round(clampNumber(16 + softness * 3 - precision * 2 + (seed % 4), 14, 27))
  const paddingX = Math.round(clampNumber(18 + emotionalHeat * 2 + softness * 2 + (seed % 6), 17, 30))
  const lineWeight = Math.round(clampNumber(1 + precision * 0.45 + threat * 0.35, 1, 3))
  const audioRadius = Math.round(clampNumber(radiusPx + 4 + emotionalHeat * 6 - precision * 4, 9, 999))
  const mood = [
    emotionalHeat > 1 ? 'intimate' : '',
    threat > 1 ? 'tense' : '',
    precision > 1 ? 'precise' : '',
    softness > 1 ? 'soft-atmospheric' : '',
    `seed-${seed % 997}`,
  ].filter(Boolean)
  const designBrief = {
    concept: `${input.characterName} specific atmosphere generated from role-card semantics, not from a fixed CSS template.`,
    colorSystem: `Seeded hue ${hue}, saturation ${saturation}, lightness ${lightness}; accent ${accent}, soft field ${accentSoft}.`,
    surfaceTreatment: `Custom surface uses ${surface}, radius ${radiusPx}px, ${lineWeight}px boundary weight, and semantic glow density from the card text.`,
    typography: precision > threat ? 'Compact metadata rhythm with readable literary speech.' : threat > emotionalHeat ? 'Tense prose frame with sharp quoted speech.' : 'Literary conversational rhythm with soft speech emphasis.',
    audioTreatment: `Audio bar radius ${audioRadius}px, progress color from character accent, spacing derived from the same semantic seed.`,
    sceneTreatment: 'Scene/status card shares the generated surface, border, and accent system instead of using a separate preset.',
  }
  return {
    ...input.fallback,
    name: `${input.characterName} Atmosphere`,
    summary: `Custom scoped atmosphere generated from ${input.characterName}'s role card, dialogue, scene, and style controls.`,
    mood: mood.length ? mood : ['custom', `seed-${seed % 997}`],
    palette: {
      accent,
      accentSoft,
      surface: input.fallback.palette.surface,
      warmth: emotionalHeat > precision ? 'warm' : precision > emotionalHeat ? 'cool' : 'neutral',
      contrast: threat > 1 || precision > 1 ? 'high' : softness > 1 ? 'low' : 'medium',
    },
    message: {
      ...input.fallback.message,
      density: precision > 1 ? 'compact' : softness > 1 ? 'airy' : 'balanced',
      radius: radiusPx <= 12 ? 'sharp' : radiusPx >= 22 ? 'round' : 'soft',
    },
    audio: {
      ...input.fallback.audio,
      motion: precision > 1 ? 'still' : 'subtle-wave',
      tone: emotionalHeat > 1 ? 'intimate' : precision > 1 ? 'formal' : 'near',
    },
    sceneCard: {
      ...input.fallback.sceneCard,
      divider: precision > 1 || threat > 1 ? 'fine-line' : softness > 1 ? 'soft-band' : 'none',
    },
    previewStatus: input.fallback.previewStatus,
    previewEquipment: input.fallback.previewEquipment,
    designBrief,
    css: buildFreeAtmosphereCss(input.scopeClass, {
      accent,
      accentSoft,
      surface,
      hue,
      surfaceHue,
      radiusPx,
      paddingY,
      paddingX,
      lineWeight,
      audioRadius,
      glowAlpha: clampNumber(0.18 + softness * 0.04 + emotionalHeat * 0.035, 0.16, 0.34),
      precision,
      threat,
      softness,
    }, designBrief),
  }
}

function buildFreeAtmosphereCss(
  scopeClass: string,
  spec: {
    accent: string
    accentSoft: string
    surface: string
    hue: number
    surfaceHue: number
    radiusPx: number
    paddingY: number
    paddingX: number
    lineWeight: number
    audioRadius: number
    glowAlpha: number
    precision: number
    threat: number
    softness: number
  },
  design: Record<string, string>
): string {
  const frameShadow = spec.threat > 1
    ? '0 24px 80px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.04)'
    : `0 18px 64px hsla(${spec.hue} 35% 8% / 0.28), inset 0 1px 0 rgba(255,255,255,0.045)`
  const grain = spec.precision > 1
    ? `linear-gradient(90deg, hsla(${spec.hue} 70% 70% / 0.05) 1px, transparent 1px)`
    : `radial-gradient(circle at 78% 10%, hsla(${spec.hue} 70% 72% / ${spec.glowAlpha}), transparent 34%)`
  return [
    `.${scopeClass}.has-chat-atmosphere .roleplay-chat-frame {`,
    `  padding: ${spec.paddingY}px ${spec.paddingX}px ${spec.paddingY + 2}px;`,
    `  border-width: ${spec.lineWeight}px;`,
    `  border-radius: ${spec.radiusPx + 4}px;`,
    `  border-color: color-mix(in srgb, ${spec.accent} 28%, transparent);`,
    `  background: radial-gradient(circle at 10% 0%, ${spec.accentSoft}, transparent 31%), ${grain}, linear-gradient(139deg, color-mix(in srgb, ${spec.accent} 10%, ${spec.surface}), ${spec.surface});`,
    `  box-shadow: ${frameShadow};`,
    `}`,
    `.${scopeClass}.has-chat-atmosphere .roleplay-chat-frame::before {`,
    `  background: linear-gradient(90deg, hsla(${spec.hue} 70% 72% / 0.08), transparent 46%), radial-gradient(circle at 72% 20%, ${spec.accentSoft}, transparent 38%);`,
    `}`,
    `.${scopeClass}.has-chat-atmosphere .roleplay-chat-frame > p { color: hsla(${spec.surfaceHue} 18% 86% / 0.78); }`,
    `.${scopeClass}.has-chat-atmosphere .chat-message .roleplay-chat-quote, .${scopeClass}.has-chat-atmosphere .roleplay-chat-quote { color: hsla(${spec.hue} 34% 96% / 0.97); }`,
    `.${scopeClass}.has-chat-atmosphere .chat-inline-audio-player, .${scopeClass}.has-chat-atmosphere .chat-inline-audio.pending span {`,
    `  min-height: ${spec.precision > 1 ? 36 : 40}px;`,
    `  border-radius: ${spec.audioRadius >= 120 ? 999 : spec.audioRadius}px;`,
    `  border-color: color-mix(in srgb, ${spec.accent} 32%, transparent);`,
    `  background: linear-gradient(90deg, ${spec.accentSoft}, rgba(255,255,255,0.026)), color-mix(in srgb, ${spec.surface} 82%, transparent);`,
    `}`,
    `.${scopeClass}.has-chat-atmosphere .chat-inline-audio-track { background: hsla(${spec.hue} 24% 84% / 0.18); }`,
    `.${scopeClass}.has-chat-atmosphere .chat-inline-audio-track span { background: color-mix(in srgb, ${spec.accent} 76%, rgba(255,255,255,0.86)); }`,
    `.${scopeClass}.has-chat-atmosphere .chat-inline-scene {`,
    `  border-radius: ${Math.max(10, spec.radiusPx)}px;`,
    `  border-color: color-mix(in srgb, ${spec.accent} 24%, transparent);`,
    `  background: linear-gradient(180deg, ${spec.accentSoft}, rgba(255,255,255,0.024)), color-mix(in srgb, ${spec.surface} 74%, transparent);`,
    `}`,
    `.${scopeClass}.has-chat-atmosphere .chat-inline-scene-line span { color: color-mix(in srgb, ${spec.accent} 58%, rgba(238,241,240,0.58)); }`,
    `.${scopeClass}.has-chat-atmosphere .chat-inline-scene-status em { border-color: color-mix(in srgb, ${spec.accent} 26%, transparent); background: color-mix(in srgb, ${spec.accent} 10%, transparent); }`,
    `/* ${design.concept} */`,
  ].join('\n')
}

function hashText(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function scoreText(value: string, terms: string[]): number {
  return terms.reduce((score, term) => score + (value.includes(term) ? 1 : 0), 0)
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizeHue(value: number): number {
  return Math.round(((value % 360) + 360) % 360)
}

function collectOpeningLayoutImages(artifacts: CharacterAgentArtifact[]): Array<Record<string, string>> {
  return artifacts
    .filter((artifact) => artifact.kind === 'image-asset')
    .filter((artifact) => {
      const data = artifact.data && typeof artifact.data === 'object' && !Array.isArray(artifact.data)
        ? artifact.data as Record<string, unknown>
        : {}
      return data.accepted !== false
    })
    .map((artifact) => {
      const data = artifact.data && typeof artifact.data === 'object' && !Array.isArray(artifact.data)
        ? artifact.data as Record<string, unknown>
        : {}
      return {
        id: artifact.id,
        title: artifact.title,
        role: stringValue(data.imageRole, artifact.sourceNodeId ?? ''),
        sourceNodeId: artifact.sourceNodeId ?? '',
        url: stringValue(data.dataUrl) || stringValue(data.url),
      }
    })
    .filter((image) => image.url)
    .sort((a, b) => openingImagePriority(a.role) - openingImagePriority(b.role))
}

function openingImagePriority(role: string): number {
  if (role === 'character-base-image') return 0
  if (role === 'avatar') return 1
  if (role === 'character-overview-sheet') return 2
  return 3
}

const OPENING_LAYOUT_KIND_VALUES = [
  'auto-opening-layout',
  'cinematic-poster',
  'visual-novel-scene',
  'chat-teaser',
  'scrapbook-collage',
  'profile-dossier',
  'editorial-cover',
] as const

type OpeningLayoutKind = Exclude<typeof OPENING_LAYOUT_KIND_VALUES[number], 'auto-opening-layout'>

const OPENING_TEXT_DENSITY_VALUES = ['minimal', 'balanced', 'story'] as const
type OpeningTextDensity = typeof OPENING_TEXT_DENSITY_VALUES[number]

function normalizeOpeningTextDensity(value: string): OpeningTextDensity {
  return (OPENING_TEXT_DENSITY_VALUES as readonly string[]).includes(value)
    ? value as OpeningTextDensity
    : 'minimal'
}

function chooseOpeningLayoutKind(
  requested: string,
  options: {
    name: string
    description: string
    scenario: string
    worldContext: string
    dialogueStyle: string
    style: Record<string, string>
    cover?: Record<string, string>
    supportImages: Array<Record<string, string>>
  }
): OpeningLayoutKind {
  if ((OPENING_LAYOUT_KIND_VALUES as readonly string[]).includes(requested) && requested !== 'auto-opening-layout') {
    return requested as OpeningLayoutKind
  }
  const source = [
    options.name,
    options.description,
    options.scenario,
    options.worldContext,
    options.dialogueStyle,
    options.style.preset,
    options.style.prompt,
  ].join(' ').toLowerCase()
  const choices: OpeningLayoutKind[] = []
  if (options.cover) {
    choices.push('cinematic-poster', 'visual-novel-scene', 'editorial-cover', 'profile-dossier')
  }
  if (options.supportImages.length >= 2) {
    choices.push('scrapbook-collage')
  }
  choices.push('chat-teaser')
  if (/campus|school|classroom|雨|教室|校园|窗|下午|自习/.test(source)) {
    choices.unshift('visual-novel-scene')
  }
  if (/noir|goth|horror|thriller|mystery|夜|暗|悬疑|秘密/.test(source)) {
    choices.unshift('cinematic-poster')
  }
  if (/idol|agent|vtuber|android|档案|身份|组织|委托/.test(source)) {
    choices.unshift('profile-dossier')
  }
  return choices[stableOpeningLayoutIndex(source || options.name, choices.length)] ?? 'chat-teaser'
}

function stableOpeningLayoutIndex(value: string, modulo: number): number {
  if (modulo <= 1) {
    return 0
  }
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return (hash >>> 0) % modulo
}

function buildOpeningLayoutHtml(options: {
  scopeClass: string
  layoutKind: OpeningLayoutKind
  textDensity: OpeningTextDensity
  name: string
  description: string
  opening: string
  scenario: string
  worldContext: string
  dialogueStyle: string
  includeSections: string[]
  cover?: Record<string, string>
  supportImages: Array<Record<string, string>>
}): string {
  const show = (section: string) => options.includeSections.includes(section)
  const limits = openingTextLimits(options.textDensity)
  const title = compactOpeningText(options.name, 28)
  const summary = compactOpeningText(options.description || options.scenario, limits.summary)
  const opening = compactOpeningText(options.opening || options.scenario || options.description, limits.opening)
  const tags = show('tags') ? deriveOpeningTags(options).slice(0, options.textDensity === 'story' ? 3 : 2) : []
  const facts = options.layoutKind === 'profile-dossier'
    ? buildOpeningFactItems(options, limits.fact)
    : []
  const hasCover = Boolean(show('coverImage') && options.cover)
  const galleryImages = show('supportImages') ? options.supportImages.slice(0, options.layoutKind === 'scrapbook-collage' ? 3 : 2) : []
  const hasVisual = hasCover || galleryImages.length > 0
  return [
    `<section class="${options.scopeClass} noema-opening-panel is-${options.layoutKind}${hasVisual ? '' : ' no-visual'}" data-layout="${htmlEscape(options.layoutKind)}">`,
    hasVisual ? [
      '<div class="noema-opening-visual-stack">',
      hasCover && options.cover ? `<figure class="noema-opening-visual"><img src="${htmlEscape(options.cover.url)}" alt="${htmlEscape(options.cover.title)}"></figure>` : '',
      galleryImages.length ? `<div class="noema-opening-gallery">${galleryImages.map((image) => `<img src="${htmlEscape(image.url)}" alt="${htmlEscape(image.title)}">`).join('')}</div>` : '',
      '</div>',
    ].join('') : '',
    '<div class="noema-opening-copy">',
    show('title') ? `<header><h1>${htmlEscape(title)}</h1>${summary ? `<p class="noema-opening-hook">${htmlEscape(summary)}</p>` : ''}</header>` : '',
    tags.length ? `<div class="noema-opening-tags">${tags.map((tag) => `<span>${htmlEscape(tag)}</span>`).join('')}</div>` : '',
    show('opening') && opening ? `<div class="noema-opening-dialogue"><p>${htmlEscape(opening)}</p></div>` : '',
    facts.length ? `<dl class="noema-opening-facts">${facts.map((fact) => `<div><dt>${htmlEscape(fact.label)}</dt><dd>${htmlEscape(fact.value)}</dd></div>`).join('')}</dl>` : '',
    show('characterSummary') && options.worldContext && options.textDensity === 'story' ? `<p class="noema-opening-note">${htmlEscape(compactOpeningText(options.worldContext, limits.summary))}</p>` : '',
    '</div>',
    '</section>',
  ].filter(Boolean).join('')
}

function buildOpeningLayoutCss(scopeClass: string, style: Record<string, string>): string {
  return [
    `.${scopeClass}.noema-opening-panel{--noema-accent:${style.accent};--noema-accent-soft:${style.accentSoft};position:relative;display:grid;gap:12px;width:100%;max-width:640px;min-height:260px;padding:14px;border:1px solid rgba(255,255,255,.12);border-radius:22px;background:radial-gradient(circle at 16% 0%,var(--noema-accent-soft),transparent 34%),linear-gradient(145deg,rgba(255,255,255,.07),rgba(255,255,255,.018)),${style.surface};color:rgba(248,250,250,.92);box-shadow:0 22px 70px rgba(0,0,0,.42);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden}`,
    `.${scopeClass} *{box-sizing:border-box;letter-spacing:0}`,
    `.${scopeClass} .noema-opening-visual-stack{display:grid;gap:8px;min-width:0}`,
    `.${scopeClass} .noema-opening-visual{margin:0;min-width:0;overflow:hidden;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(255,255,255,.04)}`,
    `.${scopeClass} .noema-opening-visual img{display:block;width:100%;height:100%;object-fit:contain;object-position:center;background:linear-gradient(145deg,rgba(255,255,255,.06),rgba(0,0,0,.26));filter:saturate(1.04) contrast(1.03)}`,
    `.${scopeClass} .noema-opening-gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}`,
    `.${scopeClass} .noema-opening-gallery img{display:block;width:100%;aspect-ratio:1/1;object-fit:cover;object-position:center;border:1px solid rgba(255,255,255,.11);border-radius:14px;background:rgba(255,255,255,.04)}`,
    `.${scopeClass} .noema-opening-copy{position:relative;z-index:1;display:grid;align-content:center;gap:10px;min-width:0}`,
    `.${scopeClass} header{display:grid;gap:6px}`,
    `.${scopeClass} h1{margin:0;color:white;font-size:34px;font-weight:780;line-height:1.02}`,
    `.${scopeClass} .noema-opening-hook{margin:0;max-width:34em;color:rgba(248,250,250,.74);font-size:13px;line-height:1.52}`,
    `.${scopeClass} .noema-opening-tags{display:flex;flex-wrap:wrap;gap:6px}`,
    `.${scopeClass} .noema-opening-tags span{max-width:16em;padding:4px 8px;border:1px solid rgba(255,255,255,.13);border-radius:999px;background:rgba(255,255,255,.056);color:rgba(248,250,250,.76);font-size:11px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`,
    `.${scopeClass} .noema-opening-dialogue{padding:12px 13px;border:1px solid rgba(255,255,255,.1);border-left:3px solid var(--noema-accent);border-radius:16px;background:rgba(0,0,0,.24);box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}`,
    `.${scopeClass} .noema-opening-dialogue p{margin:0;color:rgba(248,250,250,.88);font-size:13px;line-height:1.62}`,
    `.${scopeClass} .noema-opening-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0}`,
    `.${scopeClass} .noema-opening-facts div{padding:8px 9px;border:1px solid rgba(255,255,255,.08);border-radius:13px;background:rgba(255,255,255,.035)}`,
    `.${scopeClass} .noema-opening-facts dt{margin:0 0 3px;color:var(--noema-accent);font-size:10px;font-weight:740}`,
    `.${scopeClass} .noema-opening-facts dd{margin:0;color:rgba(248,250,250,.72);font-size:11px;line-height:1.35}`,
    `.${scopeClass} .noema-opening-note{margin:0;color:rgba(248,250,250,.66);font-size:12px;line-height:1.5}`,
    `.${scopeClass}.is-cinematic-poster{min-height:430px;grid-template-columns:1fr;align-items:end;padding:18px}`,
    `.${scopeClass}.is-cinematic-poster .noema-opening-visual-stack{position:absolute;inset:0;display:block;opacity:.82}`,
    `.${scopeClass}.is-cinematic-poster .noema-opening-visual{height:100%;border:0;border-radius:0}`,
    `.${scopeClass}.is-cinematic-poster .noema-opening-visual img{object-fit:cover;object-position:center 34%;filter:saturate(1.05) contrast(1.05) brightness(.72)}`,
    `.${scopeClass}.is-cinematic-poster .noema-opening-gallery{display:none}`,
    `.${scopeClass}.is-cinematic-poster .noema-opening-copy{max-width:430px;padding:16px;border:1px solid rgba(255,255,255,.1);border-radius:18px;background:linear-gradient(145deg,rgba(8,10,12,.76),rgba(8,10,12,.42));backdrop-filter:blur(12px)}`,
    `.${scopeClass}.is-visual-novel-scene{grid-template-rows:minmax(220px,300px) auto;padding:12px}`,
    `.${scopeClass}.is-visual-novel-scene .noema-opening-visual{min-height:220px}`,
    `.${scopeClass}.is-visual-novel-scene .noema-opening-copy{align-content:start;padding:12px;border-radius:18px;background:rgba(0,0,0,.28)}`,
    `.${scopeClass}.is-chat-teaser{grid-template-columns:96px minmax(0,1fr);min-height:170px;align-items:center}`,
    `.${scopeClass}.is-chat-teaser .noema-opening-visual{width:96px;height:96px;border-radius:28px}`,
    `.${scopeClass}.is-chat-teaser .noema-opening-gallery{display:none}`,
    `.${scopeClass}.is-scrapbook-collage{grid-template-columns:minmax(180px,.92fr) minmax(0,1fr);align-items:center}`,
    `.${scopeClass}.is-scrapbook-collage .noema-opening-visual{height:260px;transform:rotate(-1.4deg)}`,
    `.${scopeClass}.is-scrapbook-collage .noema-opening-gallery img:nth-child(2){transform:translateY(-7px) rotate(1.2deg)}`,
    `.${scopeClass}.is-profile-dossier{grid-template-columns:170px minmax(0,1fr);align-items:center}`,
    `.${scopeClass}.is-profile-dossier .noema-opening-visual{height:235px}`,
    `.${scopeClass}.is-editorial-cover{grid-template-columns:minmax(180px,.78fr) minmax(0,1fr);align-items:stretch}`,
    `.${scopeClass}.is-editorial-cover .noema-opening-visual{height:330px}`,
    `.${scopeClass}.is-editorial-cover h1{font-size:44px;line-height:.96}`,
    `.${scopeClass}.no-visual{grid-template-columns:1fr;min-height:0}`,
    `.${scopeClass}.no-visual .noema-opening-copy{align-content:start}`,
    `@media(max-width:560px){.${scopeClass}.noema-opening-panel{grid-template-columns:1fr;min-height:0;padding:12px}.${scopeClass}.is-cinematic-poster{min-height:360px}.${scopeClass}.is-cinematic-poster .noema-opening-visual-stack{position:absolute;inset:0}.${scopeClass}.is-cinematic-poster .noema-opening-copy{margin-top:170px}.${scopeClass}:not(.is-cinematic-poster) .noema-opening-visual-stack{position:relative;inset:auto}.${scopeClass}:not(.is-cinematic-poster) .noema-opening-visual{height:230px;width:auto}.${scopeClass} h1{font-size:28px}.${scopeClass}.is-editorial-cover h1{font-size:32px}.${scopeClass} .noema-opening-facts{grid-template-columns:1fr}}`,
  ].join('\n')
}

function openingTextLimits(density: OpeningTextDensity): { summary: number; opening: number; fact: number } {
  if (density === 'story') {
    return { summary: 150, opening: 320, fact: 64 }
  }
  if (density === 'balanced') {
    return { summary: 105, opening: 220, fact: 52 }
  }
  return { summary: 72, opening: 150, fact: 44 }
}

function compactOpeningText(value: string, maxLength: number): string {
  const text = stripVisibleControlTags(value)
    .replace(/\s+/g, ' ')
    .trim()
  if (!text || text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
}

function stripVisibleControlTags(value: string): string {
  return value
    .replace(/<\/?(?:chat|role_chat)\b[^>]*>/gi, '')
    .replace(/<\/?[a-z_][\w:-]*(?:\s[^>]*)?>/gi, '')
}

function extractFirstRoleChatLine(value: string): string {
  const match = value.match(/<role_chat\b[^>]*>([\s\S]*?)<\/role_chat>/i)
  const text = match ? match[1] : value
  return stripVisibleControlTags(text)
    .replace(/^["“”]+|["“”]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildOpeningFactItems(
  options: {
    scenario: string
    worldContext: string
    dialogueStyle: string
  },
  maxLength: number
): Array<{ label: string; value: string }> {
  return [
    ['scene', options.scenario],
    ['world', options.worldContext],
    ['voice', options.dialogueStyle],
  ].map(([label, value]) => ({
    label,
    value: compactOpeningText(value, maxLength),
  })).filter((item) => item.value).slice(0, 2)
}

function deriveOpeningTags(options: {
  description: string
  scenario: string
  worldContext: string
  dialogueStyle: string
}): string[] {
  const source = [options.description, options.scenario, options.worldContext, options.dialogueStyle].join(' ')
  const tags = [
    /romance|恋|暧昧|亲密/i.test(source) ? 'slow tension' : '',
    /mystery|悬疑|秘密|noir/i.test(source) ? 'mystery' : '',
    /campus|学校|校园/i.test(source) ? 'campus' : '',
    /cyber|赛博|未来|neon/i.test(source) ? 'neon city' : '',
    /fantasy|魔法|精灵|spirit/i.test(source) ? 'fantasy' : '',
  ].filter(Boolean)
  return [...new Set(tags.length ? tags : ['first encounter', 'private scene'])].slice(0, 3)
}

function stripChatTags(value: string): string {
  return stripVisibleControlTags(value).trim()
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sanitizeCssIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'panel'
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
      const requirement = context.requirements.find((item) => item.kind === 'character-field' && item.field === field)
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
        sourceNodeId: requirement?.targetNodeId ?? context.goal.nodeId,
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

function getImageGenerationAttemptBudget(context: CharacterAgentRunContext): number {
  const requiredImageCount = context.requirements.reduce((sum, requirement) => {
    if (requirement.kind !== 'image' || !requirement.required) {
      return sum
    }
    return sum + Math.max(1, Math.floor(requirement.requiredCount ?? 1))
  }, 0)
  return Math.max(context.requirements.length, requiredImageCount)
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
    if ((artifact.kind !== 'image-asset' && artifact.kind !== 'source-material') || !artifact.sourceNodeId) {
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
  if (artifact.kind === 'source-material' && data.kind !== 'image') {
    return null
  }
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
    .filter((target) => target.kind === 'character-field')
    .flatMap((target) => (target.fields?.length ? target.fields : target.field ? [target.field] : [])
      .map((field) => ({ field, target })))
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
    const referenceRelations = relations
      .filter((relation) =>
        relation.toNodeId === target.nodeId &&
        (relation.fromPort === 'imageAsset' || relation.fromPort === 'resource')
      )
    const referenceSourceNodeIds = referenceRelations
      .map((relation) => relation.fromNodeId)
    const dependencySourceNodeIds = referenceRelations
      .map((relation) => relation.fromNodeId)
      .filter((nodeId) => imageTargetIds.has(nodeId))
    requirements.push({
      id: `image:${target.nodeId}`,
      kind: 'image',
      targetNodeId: target.nodeId,
      title: target.title,
      required: true,
      imageRole: target.imageRole,
      requiredCount,
      dependencyNodeIds: [...new Set(dependencySourceNodeIds)],
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
    .filter((target) => target.kind === 'character-field')
    .flatMap((target) => target.fields?.length ? target.fields : target.field ? [target.field] : [])
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
  issues.push(...detectOverlappingCharacterFields(draft?.fields ?? {}))
  return issues
}

function detectOverlappingCharacterFields(fields: Record<string, unknown>): string[] {
  const checkedFields = [
    'description',
    'appearance',
    'personality',
    'background',
    'scenario',
    'worldContext',
    'firstMessage',
    'dialogueStyle',
  ]
  const normalized = checkedFields.flatMap((field) => {
    const value = fields[field]
    if (typeof value !== 'string') {
      return []
    }
    const text = normalizeFieldOverlapText(value)
    return text.length >= 80 ? [{ field, text }] : []
  })
  const issues: string[] = []
  for (let leftIndex = 0; leftIndex < normalized.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < normalized.length; rightIndex += 1) {
      const left = normalized[leftIndex]!
      const right = normalized[rightIndex]!
      if (left.text === right.text || hasLongSharedFieldPhrase(left.text, right.text)) {
        issues.push(`Fields ${left.field} and ${right.field} contain overlapping content`)
      }
    }
  }
  return issues.slice(0, 4)
}

function normalizeFieldOverlapText(value: string): string {
  return value
    .replace(/<\/?chat>/gi, ' ')
    .replace(/[，。！？、；：,.!?;:"'“”‘’()[\]{}<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function hasLongSharedFieldPhrase(left: string, right: string): boolean {
  const shorter = left.length < right.length ? left : right
  const longer = left.length < right.length ? right : left
  if (shorter.length >= 120 && longer.includes(shorter)) {
    return true
  }
  const windowSize = 48
  for (let index = 0; index + windowSize <= shorter.length; index += 16) {
    const slice = shorter.slice(index, index + windowSize).trim()
    if (slice.length >= windowSize && longer.includes(slice)) {
      return true
    }
  }
  return false
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
    'source-material': 'Source Material',
    'character-card-draft': 'Character Card Draft',
    'character-card-field': 'Character Card Field',
    'character-card-final': 'Character Card',
    'opening-message': 'Opening Message',
    'opening-layout': 'Opening Layout',
    'atmosphere-style': 'Atmosphere Style',
    'game-system': 'Game System',
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
    'atmosphere-style',
    'game-system',
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
        field: kind === 'character-field' ? fieldTargetConfigFields(node.config)[0] : undefined,
        fields: kind === 'character-field' ? fieldTargetConfigFields(node.config) : undefined,
        imageRole: kind === 'image' ? stringValue(node.config.imageRole) : undefined,
        imageAssetPurpose: kind === 'image' ? stringValue(node.config.assetPurpose) : undefined,
        requestedResources: requestedResourcesForTarget(node, kind),
        incomingRelations: incomingRelations(relations, node.id),
        localStylePressures: controls.stylePressures.filter((control) => isLocallyConnected(relations, node.id, control.nodeId)),
        localConstraints: controls.hardConstraints.filter((control) => isLocallyConnected(relations, node.id, control.nodeId)),
        imageControls: controls.imageGenerationControls.filter((control) => isLocallyConnected(relations, node.id, control.nodeId)),
        fieldControls: kind === 'character-field' ? inlineFieldControlsForTarget(node, relations) : [],
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
    'atmosphere-style-target': 'atmosphere-style',
    'game-system-target': 'game-system',
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
    return fieldTargetConfigFields(node.config).map((field) => `field:${field}`)
  }
  if (kind === 'opening-layout') {
    return ['opening-layout', ...stringListValue(node.config.includeSections)]
  }
  if (kind === 'atmosphere-style') {
    return [
      'atmosphere-style',
      stringValue(node.config.stylePrompt) ? `design:${stringValue(node.config.stylePrompt)}` : '',
      stringValue(node.config.moodPreset) ? `atmosphere:${stringValue(node.config.moodPreset)}` : '',
      stringValue(node.config.surface) ? `surface:${stringValue(node.config.surface)}` : '',
      stringValue(node.config.messageFrame) ? `message:${stringValue(node.config.messageFrame)}` : '',
      stringValue(node.config.audioPlayer) ? `audio:${stringValue(node.config.audioPlayer)}` : '',
      stringValue(node.config.density) ? `spacing:${stringValue(node.config.density)}` : '',
    ].filter(Boolean)
  }
  if (kind === 'game-system') {
    return [
      'game-system',
      stringValue(node.config.statDesign) ? `stats:${stringValue(node.config.statDesign)}` : '',
      stringValue(node.config.equipmentRules) ? `equipment:${stringValue(node.config.equipmentRules)}` : '',
      stringValue(node.config.statusRules) ? `status:${stringValue(node.config.statusRules)}` : '',
      stringValue(node.config.panelDesign) ? `panels:${stringValue(node.config.panelDesign)}` : '',
    ].filter(Boolean)
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

function fieldTargetConfigFields(config: Record<string, unknown>): string[] {
  const fields = stringListValue(config.fields)
    .map((field) => normalizeDraftFieldName(field))
    .filter(Boolean)
  return [...new Set(fields.length ? fields : [...CHARACTER_CARD_FIELD_SCHEMA, ...CHARACTER_SUPPORT_FIELD_SCHEMA])]
}

function inlineFieldControlsForTarget(node: CharacterWorkflowNode, relations: CharacterAgentRelation[]): AgentFieldGenerationControl[] {
  const fields = fieldTargetConfigFields(node.config)
  const configured = normalizeInlineFieldControls(node.config.fieldControls, node.id)
  const byField = new Map(configured.map((control) => [control.field, control]))
  const relationContext = incomingRelations(relations, node.id)
  return fields.map((field) => {
    const existing = byField.get(field)
    if (existing) {
      return {
        ...existing,
        incomingRelations: relationContext,
      }
    }
    return createDefaultInlineFieldControl(node.id, field, relationContext)
  })
}

function normalizeInlineFieldControls(value: unknown, nodeId: string): AgentFieldGenerationControl[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item): AgentFieldGenerationControl[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return []
    }
    const record = item as Record<string, unknown>
    const field = normalizeDraftFieldName(stringValue(record.field))
    if (!field) {
      return []
    }
    return [{
      nodeId: `${nodeId}:${field}`,
      field,
      fieldPurpose: stringValue(record.fieldPurpose, defaultFieldPurpose(field)),
      tone: stringValue(record.tone, 'neutral'),
      lengthPolicy: stringValue(record.lengthPolicy, defaultFieldLengthPolicy(field)),
      avoidPatterns: stringListValue(record.avoidPatterns),
      incomingRelations: [],
    }]
  })
}

function createDefaultInlineFieldControl(
  nodeId: string,
  field: string,
  relationContext: CharacterAgentRelation[]
): AgentFieldGenerationControl {
  return {
    nodeId: `${nodeId}:${field}`,
    field,
    fieldPurpose: defaultFieldPurpose(field),
    tone: 'neutral',
    lengthPolicy: defaultFieldLengthPolicy(field),
    avoidPatterns: [],
    incomingRelations: relationContext,
  }
}

function defaultFieldLengthPolicy(field: string): string {
  if (field === 'name') return 'short'
  if (field === 'firstMessage') return 'medium'
  return 'medium'
}

function defaultFieldPurpose(field: string): string {
  const purposes: Record<string, string> = {
    name: 'Short display name only.',
    description: 'Concise identity hook and roleplay appeal.',
    appearance: 'Visible body, face, outfit, posture, expression, and motifs.',
    personality: 'Inner drives, contradictions, habits, emotional logic, and relationship behavior.',
    background: 'Formative history, secrets, losses, obligations, and causes.',
    scenario: 'Persistent present setup, current tension, roles, stakes, and continuation hooks.',
    firstMessage: 'Playable opening scene wrapped in chat tags with a concrete hook. Keep it rich but concise.',
    dialogueStyle: 'Speech rhythm, diction, address style, emotional tells, and taboo phrases.',
    worldContext: 'Stable world, institution, social, supernatural, or relationship facts outside one scene.',
    appearancePrompt: 'Compact avatar identity seed prompt derived from completed character fields and image controls.',
  }
  return purposes[field] ?? `Generation control for ${field}.`
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
      ...Object.fromEntries(Object.entries(node.config).filter(([key]) => key !== 'modelRef')),
    },
  }
}

function imageToolCapabilities(
  node: CharacterWorkflowNode,
  fallbackApiId: string | undefined,
  fallbackModelName: string | undefined
): AgentModelCapability[] {
  const base = modelCapability(node, 'image', fallbackApiId, fallbackModelName)
  const editModelRef = stringValue(node.config.editModelRef)
  if (!editModelRef) {
    return [base]
  }
  const parsed = parseModelRef(editModelRef)
  return [
    base,
    {
      ...base,
      apiId: parsed.apiId,
      modelName: parsed.modelName,
      modelRef: editModelRef,
      parameters: {
        ...base.parameters,
        usageMode: 'reference-edit',
        modelRef: base.modelRef,
        editModelRef,
      },
    },
  ]
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

function normalizeSourceMaterialItems(value: unknown): AgentSourceMaterialItem[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item, index): AgentSourceMaterialItem[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return []
    }
    const record = item as Record<string, unknown>
    const name = stringValue(record.name, `material-${index + 1}`)
    const mimeType = stringValue(record.mimeType)
    const material: AgentSourceMaterialItem = {
      id: stringValue(record.id, `material-${index + 1}`),
      kind: inferSourceMaterialItemKind(record.kind, mimeType, name),
      name,
      mimeType,
    }
    if (typeof record.size === 'number' && Number.isFinite(record.size)) {
      material.size = Math.max(0, Math.round(record.size))
    }
    if (typeof record.dataUrl === 'string' && record.dataUrl.trim()) {
      material.dataUrl = record.dataUrl.trim()
    }
    if (typeof record.text === 'string' && record.text.trim()) {
      material.text = record.text.trim()
    }
    return [material]
  })
}

function inferSourceMaterialKind(value: unknown): string {
  const materials = normalizeSourceMaterialItems(value)
  const imageCount = materials.filter((item) => item.kind === 'image').length
  const documentCount = materials.filter((item) => item.kind === 'document').length
  if (imageCount && documentCount) {
    return 'mixed-materials'
  }
  if (imageCount) {
    return 'image-materials'
  }
  if (documentCount) {
    return 'document-materials'
  }
  return 'empty-materials'
}

function inferSourceMaterialItemKind(value: unknown, mimeType: string, name: string): AgentSourceMaterialItem['kind'] {
  if (value === 'image' || value === 'document') {
    return value
  }
  if (mimeType.startsWith('image/')) {
    return 'image'
  }
  return /\.(png|jpe?g|webp|gif)$/i.test(name) ? 'image' : 'document'
}

function compactText(value: unknown, maxLength: number): string {
  const normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (!normalized) {
    return ''
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trim()}...` : normalized
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
