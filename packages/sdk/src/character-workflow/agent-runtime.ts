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
  | 'failed'

export type CharacterAgentModelKind = 'llm' | 'image'
export type CharacterAgentArtifactKind =
  | 'agent-plan'
  | 'task-understanding'
  | 'style-brief'
  | 'constraint-brief'
  | 'source-summary'
  | 'character-card-draft'
  | 'character-card-final'
  | 'opening-message'
  | 'dialogue-style-guide'
  | 'world-context'
  | 'scene-context'
  | 'memory-policy'
  | 'image-prompt'
  | 'image-asset'
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
  stylePressures: AgentStylePressure[]
  hardConstraints: AgentConstraint[]
  sourceMaterials: AgentSourceMaterial[]
  capabilities: AgentCapabilitySet
  policy: AgentPolicyContext
  strategy: AgentStrategyContext
  critique: AgentCritiquePolicyContext
  requestedAssets: AgentAssetTarget[]
  qualityGate: AgentQualityGateContext
  exportTarget: AgentExportTargetContext
  graph: CharacterAgentGraphReference
  compilerWarnings: string[]
}

export type CharacterAgentProtocolIssueCode =
  | 'invalid_snapshot'
  | 'missing_workflow_id'
  | 'duplicate_node_id'
  | 'missing_edge_endpoint'
  | 'missing_model_ref'
  | 'unresolved_model_ref'

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
  notes: string[]
  missing: string[]
  updatedAt: number
}

export type CharacterAgentAction =
  | { type: 'set_field'; field: string; value: unknown; reason?: string }
  | { type: 'merge_character_card'; value: Record<string, unknown>; reason?: string }
  | { type: 'create_artifact'; kind?: CharacterAgentArtifactKind; title?: string; data: unknown; summary?: string; reason?: string }
  | { type: 'request_image'; prompt: string; title?: string; reason?: string }
  | { type: 'finish'; reason?: string }

export interface CharacterAgentDecision {
  summary: string
  actions: CharacterAgentAction[]
  done: boolean
  confidence: number
  missing: string[]
}

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

export interface CharacterSuperAgent {
  run(workflow: CharacterWorkflow): Promise<CharacterAgentState>
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
    stylePressures: (nodesByType.get('style-pressure') ?? []).map((node) => ({
      nodeId: node.id,
      preset: stringValue(node.config.preset, 'custom'),
      prompt: stringValue(node.config.stylePrompt),
      intensity: numberValue(node.config.intensity, 0.5),
      incomingRelations: incomingRelations(relations, node.id),
    })),
    hardConstraints: (nodesByType.get('constraint') ?? []).map((node) => ({
      nodeId: node.id,
      mustHave: stringListValue(node.config.mustHave),
      mustNot: stringListValue(node.config.mustNot),
      hardBoundary: booleanValue(node.config.hardBoundary, true),
      incomingRelations: incomingRelations(relations, node.id),
    })),
    sourceMaterials: (nodesByType.get('source-material') ?? []).map((node) => ({
      nodeId: node.id,
      kind: stringValue(node.config.sourceKind, 'notes'),
      notes: stringValue(node.config.notes),
      groundingStrength: numberValue(node.config.groundingStrength, 0.5),
      incomingRelations: incomingRelations(relations, node.id),
    })),
    capabilities: {
      llmModels: (nodesByType.get('llm-tool') ?? []).map((node) => modelCapability(node, 'llm', workflow.defaults.llmApiId, workflow.defaults.llmModelName)),
      imageModels: (nodesByType.get('image-tool') ?? []).map((node) => modelCapability(node, 'image', workflow.defaults.imageApiId, workflow.defaults.imageModelName)),
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
      priorityAssets: stringListValue(strategyNode?.config.priorityAssets, ['role-card', 'opening', 'image-pack']),
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
    requestedAssets: (nodesByType.get('asset-builder') ?? []).map((node) => ({
      nodeId: node.id,
      requested: stringListValue(node.config.targets, ['role-card', 'opening', 'image-pack', 'generation-report']),
      includeAlternates: booleanValue(node.config.includeAlternates, true),
      incomingRelations: incomingRelations(relations, node.id),
    })),
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
    async run(workflow) {
      const runId = createRunId()
      const context = compileCharacterAgentRunContext(workflow, { runId, now: now() })
      if (options.modelResolver) {
        const resolved = await resolveCharacterAgentModelCapabilities(context, options.modelResolver)
        context.compilerWarnings.push(...resolved.issues.map((issue) => issue.message))
      }
      let state = createInitialCharacterAgentState(context, now())
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

      try {
        await emit({ type: 'run.started', runId, timestamp: now() })
        await changePhase('produce')
        state = {
          ...state,
          draft: createInitialCharacterDraft(context, now()),
          taskUnderstanding: createFallbackUnderstanding(context),
        }
        await writeArtifact(createDraftArtifact(context, state.draft))

        const maxTurns = Math.max(2, Math.min(10, context.policy.revisionBudget + context.critique.iterations + 2))
        for (let turn = 1; turn <= maxTurns; turn += 1) {
          const decisionResult = await callTool('decide_character_card_next_step', 'produce', {
            context,
            draft: state.draft,
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
          for (const action of decision.actions) {
            if (action.type === 'request_image') {
              const imageResult = await callTool('generate_character_image', 'produce', {
                prompt: action.prompt,
                title: action.title,
                draft: state.draft,
              })
              const imageIds = (imageResult.artifacts ?? [])
                .filter((artifact) => artifact.kind === 'image-asset')
                .map((artifact) => artifact.id)
              state = {
                ...state,
                draft: {
                  ...state.draft!,
                  imagePrompts: appendUnique(state.draft!.imagePrompts, [action.prompt]),
                  imageArtifactIds: appendUnique(state.draft!.imageArtifactIds, imageIds),
                  notes: appendUnique(state.draft!.notes, [action.reason ?? imageResult.summary]),
                  updatedAt: now(),
                },
              }
            } else if (action.type === 'create_artifact') {
              const artifact = await writeArtifact(createActionArtifact(context, state.draft!, action))
              state = {
                ...state,
                draft: {
                  ...state.draft!,
                  notes: appendUnique(state.draft!.notes, [action.reason ?? artifact.summary]),
                  updatedAt: now(),
                },
              }
            } else {
              state = {
                ...state,
                draft: applyCharacterAgentAction(state.draft!, action, now()),
              }
            }
            await writeArtifact(createDraftArtifact(context, state.draft))
          }
          state = {
            ...state,
            draft: {
              ...state.draft!,
              missing: decision.missing,
              notes: appendUnique(state.draft!.notes, [decision.summary]),
              updatedAt: now(),
            },
          }
          await writeArtifact(createDraftArtifact(context, state.draft))
          if ((decision.done || decision.actions.some((action) => action.type === 'finish')) && isCharacterDraftComplete(state.draft, context)) {
            break
          }
        }

        if (!state.draft?.imageArtifactIds.length) {
          const imagePrompt = stringValue(state.draft?.fields.imagePrompt)
          if (imagePrompt) {
            const imageResult = await callTool('generate_character_image', 'produce', {
              prompt: imagePrompt,
              title: 'Character Image',
              draft: state.draft,
            })
            const imageIds = (imageResult.artifacts ?? [])
              .filter((artifact) => artifact.kind === 'image-asset')
              .map((artifact) => artifact.id)
            state = {
              ...state,
              draft: {
                ...state.draft!,
                imagePrompts: appendUnique(state.draft!.imagePrompts, [imagePrompt]),
                imageArtifactIds: appendUnique(state.draft!.imageArtifactIds, imageIds),
                notes: appendUnique(state.draft!.notes, [imageResult.summary]),
                updatedAt: now(),
              },
            }
            await writeArtifact(createDraftArtifact(context, state.draft))
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
          for (const action of repairDecision.actions.filter((action) => action.type !== 'request_image')) {
            if (action.type === 'create_artifact') {
              await writeArtifact(createActionArtifact(context, state.draft!, action))
            } else {
              state = {
                ...state,
                draft: applyCharacterAgentAction(state.draft!, action, now()),
              }
            }
            await writeArtifact(createDraftArtifact(context, state.draft))
          }
        }

        const finalCard = await writeArtifact({
          id: `${runId}:character-card-final`,
          kind: 'character-card-final',
          runId,
          candidateId: state.draft?.id,
          title: stringValue(state.draft?.fields.name, 'Character Card'),
          summary: summarizeDraft(state.draft),
          data: state.draft?.fields ?? {},
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
      execute: ({ callId, context, state }) => {
        const draft = state.draft ?? createInitialCharacterDraft(context, Date.now())
        const fields = createFallbackCharacterFields(context, draft)
        return {
          callId,
          ok: true,
          summary: 'Filled the character card from goal, style, resources, and constraints.',
          data: {
            summary: 'Filled the character card from goal, style, resources, and constraints.',
            done: true,
            confidence: 0.72,
            missing: [],
            actions: [
              { type: 'merge_character_card', value: fields },
              { type: 'create_artifact', kind: 'opening-message', title: 'Opening Message', data: fields.firstMessage },
              { type: 'create_artifact', kind: 'dialogue-style-guide', title: 'Dialogue Style Guide', data: fields.dialogueStyle },
              { type: 'create_artifact', kind: 'world-context', title: 'World Context', data: fields.worldContext },
              { type: 'create_artifact', kind: 'memory-policy', title: 'Memory Policy', data: fields.memoryStrategy },
              { type: 'create_artifact', kind: 'image-prompt', title: 'Image Prompt', data: fields.imagePrompt },
              { type: 'request_image', prompt: stringValue(fields.imagePrompt), title: 'Character Image' },
              { type: 'finish' },
            ],
          },
        }
      },
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
        const missing = getMissingCharacterDraftFields(state.draft, context)
        return {
          callId,
          ok: missing.length === 0,
          summary: missing.length ? `Missing required character fields: ${missing.join(', ')}` : 'Character card is complete enough for runtime use.',
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

function createInitialCharacterAgentState(context: CharacterAgentRunContext, now: number): CharacterAgentState {
  return {
    runId: context.runId,
    phase: 'ingest',
    context,
    taskUnderstanding: '',
    activePlan: createDefaultAgentPlan(context),
    candidatePacks: [],
    critiqueHistory: [],
    toolCalls: [],
    artifacts: [],
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
    notes: [createFallbackUnderstanding(context)],
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

function applyCharacterAgentAction(draft: CharacterCardDraft, action: CharacterAgentAction, now: number): CharacterCardDraft {
  if (action.type === 'set_field') {
    const field = normalizeDraftFieldName(action.field)
    if (!field) {
      return draft
    }
    return {
      ...draft,
      fields: { ...draft.fields, [field]: action.value },
      notes: appendUnique(draft.notes, action.reason ? [action.reason] : []),
      updatedAt: now,
    }
  }
  if (action.type === 'merge_character_card') {
    return {
      ...draft,
      fields: { ...draft.fields, ...normalizeDraftFields(action.value) },
      notes: appendUnique(draft.notes, action.reason ? [action.reason] : []),
      updatedAt: now,
    }
  }
  if (action.type === 'request_image') {
    return {
      ...draft,
      imagePrompts: appendUnique(draft.imagePrompts, [action.prompt]),
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
    summary: result.summary || 'Updated character card draft.',
    actions: (() => {
      const fields = createFallbackCharacterFields(context, fallbackDraft)
      return [{
        type: 'merge_character_card' as const,
        value: fields,
      }, {
        type: 'request_image' as const,
        prompt: stringValue(fields.imagePrompt),
        title: 'Character Image',
      }, {
        type: 'finish' as const,
      }]
    })(),
    done: forceDone,
    confidence: 0.45,
    missing: getMissingCharacterDraftFields(fallbackDraft, context),
  }
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
        return { type, prompt: stringValue(action.prompt), title: stringValue(action.title), reason: stringValue(action.reason) }
      }
      if (type === 'finish') {
        return { type, reason: stringValue(action.reason) }
      }
      return null
    })
    .filter((action): action is CharacterAgentAction => Boolean(action))
    .filter((action) => action.type !== 'request_image' || Boolean(action.prompt.trim()))
}

function isCharacterDraftComplete(draft: CharacterCardDraft | undefined, context: CharacterAgentRunContext): boolean {
  const fields = draft?.fields ?? {}
  return getRequiredCharacterDraftFields(context).every((field) => hasDraftField(fields, field))
}

function getMissingCharacterDraftFields(draft: CharacterCardDraft | undefined, context: CharacterAgentRunContext): string[] {
  const fields = draft?.fields ?? {}
  const missing = getRequiredCharacterDraftFields(context).filter((field) => !hasDraftField(fields, field))
  if (context.capabilities.imageModels.length && !draft?.imageArtifactIds.length) {
    missing.push('imageAsset')
  }
  return missing
}

function getRequiredCharacterDraftFields(context: CharacterAgentRunContext): string[] {
  return ['name', 'description', 'personality', 'scenario', 'firstMessage', 'dialogueStyle', 'worldContext', 'memoryStrategy', 'imagePrompt']
}

function hasDraftField(fields: Record<string, unknown>, field: string): boolean {
  const value = fields[field]
  if (typeof value === 'string') {
    return Boolean(value.trim())
  }
  if (Array.isArray(value)) {
    return value.length > 0
  }
  return value !== undefined && value !== null
}

function createFallbackCharacterFields(context: CharacterAgentRunContext, draft: CharacterCardDraft): Record<string, unknown> {
  const goal = context.goal.prompt || 'A flexible long-form roleplay character.'
  const style = context.stylePressures.map((item) => item.prompt || item.preset).filter(Boolean).join('; ') || 'natural, vivid, emotionally grounded'
  const constraints = context.hardConstraints.flatMap((item) => item.mustHave).join('; ')
  const boundaries = context.hardConstraints.flatMap((item) => item.mustNot).join('; ')
  const source = context.sourceMaterials.map((item) => item.notes).filter(Boolean).join('\n')
  return {
    ...draft.fields,
    name: stringValue(draft.fields.name, 'Unnamed Role'),
    description: stringValue(draft.fields.description, goal),
    personality: stringValue(draft.fields.personality, `主动、稳定、有长期互动余量。风格压力：${style}`),
    scenario: stringValue(draft.fields.scenario, source || goal),
    firstMessage: stringValue(draft.fields.firstMessage, '你终于来了。我已经把今天最重要的事留到现在，只等你亲自开口。'),
    dialogueStyle: stringValue(draft.fields.dialogueStyle, style),
    worldContext: stringValue(draft.fields.worldContext, source || `围绕目标展开：${goal}`),
    memoryStrategy: stringValue(draft.fields.memoryStrategy, '持续记录关系变化、长期目标、未完成承诺、偏好和边界，不把一次性情绪当作永久设定。'),
    imagePrompt: stringValue(draft.fields.imagePrompt, `Character portrait for: ${goal}. Style: ${style}. Must include: ${constraints}. Avoid: ${boundaries}.`),
    generationReport: stringValue(draft.fields.generationReport, createFallbackUnderstanding(context)),
  }
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
    memory: 'memoryStrategy',
    memoryPolicy: 'memoryStrategy',
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
    'character-card-final': 'Character Card',
    'opening-message': 'Opening Message',
    'dialogue-style-guide': 'Dialogue Style Guide',
    'world-context': 'World Context',
    'scene-context': 'Scene Context',
    'memory-policy': 'Memory Policy',
    'image-prompt': 'Image Prompt',
    'image-asset': 'Image Asset',
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
    'character-card-final',
    'opening-message',
    'dialogue-style-guide',
    'world-context',
    'scene-context',
    'memory-policy',
    'image-prompt',
    'image-asset',
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

function createDefaultCandidatePack(context: CharacterAgentRunContext, runId: string, suffix = 'draft'): CandidatePack {
  const requestedAssets = flattenRequestedAssets(context)
  return {
    id: `${runId}:candidate:${suffix}`,
    title: `Character Resource Candidate ${suffix}`,
    summary: `Candidate guided by "${context.goal.prompt || 'empty goal'}" for ${context.goal.targetAudience}.`,
    requestedAssets,
    artifactIds: [],
    risks: context.compilerWarnings,
  }
}

function createFallbackUnderstanding(context: CharacterAgentRunContext): string {
  const styles = context.stylePressures.map((item) => item.preset).filter(Boolean).join(', ') || 'custom style'
  const assets = flattenRequestedAssets(context).join(', ') || 'role resources'
  return `Generate ${assets} for ${context.goal.targetAudience} from a free-form goal, with ${styles} pressure and agent autonomy ${context.policy.autonomyLevel}.`
}

function planFromToolResult(result: AgentToolResult, context: CharacterAgentRunContext): CharacterAgentPlan {
  if (isAgentPlan(result.data)) {
    return result.data
  }
  return createDefaultAgentPlan(context)
}

function candidateFromToolResult(
  result: AgentToolResult,
  context: CharacterAgentRunContext,
  runId: string,
  suffix = 'draft'
): CandidatePack {
  if (isCandidatePack(result.data)) {
    return result.data
  }
  return createDefaultCandidatePack(context, runId, suffix)
}

function stringFromToolResult(result: AgentToolResult, fallback: string): string {
  if (typeof result.data === 'object' && result.data && 'text' in result.data && typeof result.data.text === 'string') {
    return result.data.text
  }
  return result.summary || fallback
}

function isAgentPlan(value: unknown): value is CharacterAgentPlan {
  return Boolean(value && typeof value === 'object' && 'steps' in value && Array.isArray(value.steps))
}

function isCandidatePack(value: unknown): value is CandidatePack {
  return Boolean(value && typeof value === 'object' && 'requestedAssets' in value && Array.isArray(value.requestedAssets))
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
    parameters: Object.fromEntries(Object.entries(node.config).filter(([key]) => key !== 'modelRef')),
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
    version: '0.0',
    nodes: [],
    edges: [],
    defaults: { language: 'zh-CN' },
    metadata: {
      createdAt: now,
      updatedAt: now,
    },
  }
}
