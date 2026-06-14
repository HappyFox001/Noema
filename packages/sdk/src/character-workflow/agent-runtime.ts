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

export interface CharacterAgentState {
  runId: string
  phase: CharacterAgentPhase
  context: CharacterAgentRunContext
  taskUnderstanding: string
  activePlan: CharacterAgentPlan
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
  kind: 'generation' | 'critique' | 'quality' | 'format' | 'retrieval' | 'image' | 'voice' | 'artifact'
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
        await changePhase('interpret')
        const understanding = await callTool('interpret_resource_graph', 'interpret', { context })
        state = {
          ...state,
          taskUnderstanding: stringFromToolResult(understanding, createFallbackUnderstanding(context)),
        }
        await writeArtifact({
          id: `${runId}:task-understanding`,
          kind: 'task-understanding',
          runId,
          title: 'Task Understanding',
          summary: state.taskUnderstanding,
          data: { text: state.taskUnderstanding, compilerWarnings: context.compilerWarnings },
        })

        await changePhase('plan')
        const planResult = await callTool('create_generation_plan', 'plan', { context, taskUnderstanding: state.taskUnderstanding })
        state = {
          ...state,
          activePlan: planFromToolResult(planResult, context),
        }
        await emit({ type: 'agent.plan.created', runId, plan: state.activePlan, timestamp: now() })
        await writeArtifact({
          id: `${runId}:agent-plan`,
          kind: 'agent-plan',
          runId,
          title: state.activePlan.title,
          summary: state.activePlan.strategy,
          data: state.activePlan,
        })

        await changePhase('produce')
        const candidateResult = await callTool('generate_candidate_pack', 'produce', { context, plan: state.activePlan })
        const candidate = candidateFromToolResult(candidateResult, context, runId)
        state = { ...state, candidatePacks: [candidate], selectedCandidateId: candidate.id }
        await writeArtifact({
          id: `${candidate.id}:candidate-pack`,
          kind: 'candidate-pack',
          runId,
          candidateId: candidate.id,
          title: candidate.title,
          summary: candidate.summary,
          data: candidate,
        })

        await changePhase('inspect')
        const qualityResult = await callTool('run_quality_gate', 'inspect', { context, candidate })
        const critique: AgentCritiqueRecord = {
          id: `${runId}:critique:1`,
          candidateId: candidate.id,
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
          candidateId: candidate.id,
          title: 'Quality Report',
          summary: qualityResult.summary,
          data: qualityResult.data ?? { toolResult: qualityResult },
        })

        if (!qualityResult.ok && context.critique.autoRepair && context.policy.revisionBudget > 0) {
          await changePhase('repair')
          const repairResult = await callTool('repair_candidate_pack', 'repair', { context, candidate, critique })
          const repaired = candidateFromToolResult(repairResult, context, runId, 'repaired')
          state = {
            ...state,
            candidatePacks: [...state.candidatePacks, repaired],
            selectedCandidateId: repaired.id,
          }
          await writeArtifact({
            id: `${repaired.id}:candidate-pack`,
            kind: 'candidate-pack',
            runId,
            candidateId: repaired.id,
            title: repaired.title,
            summary: repaired.summary,
            data: repaired,
          })
        }

        await changePhase('package')
        const selected = state.candidatePacks.find((candidatePack) => candidatePack.id === state.selectedCandidateId) ?? candidate
        const exportResult = await callTool('create_export_package', 'package', { context, candidate: selected })
        const exported = await writeArtifact({
          id: `${runId}:export-package`,
          kind: 'export-package',
          runId,
          candidateId: selected.id,
          title: `${context.exportTarget.format} Export Package`,
          summary: exportResult.summary,
          data: exportResult.data ?? { format: context.exportTarget.format, candidate: selected },
        })

        await changePhase('report')
        const report: AgentFinalReport = {
          summary: `Generated ${selected.requestedAssets.join(', ')} for ${context.goal.targetAudience}.`,
          selectedCandidateId: selected.id,
          exportedArtifactId: exported.id,
          risks: selected.risks,
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
      name: 'interpret_resource_graph',
      description: 'Summarizes the resource graph as an agent task understanding.',
      kind: 'generation',
      execute: ({ callId, context }) => ({
        callId,
        ok: true,
        summary: createFallbackUnderstanding(context),
        data: { text: createFallbackUnderstanding(context) },
      }),
    },
    {
      name: 'create_generation_plan',
      description: 'Creates an agent-owned generation plan from graph constraints.',
      kind: 'generation',
      execute: ({ callId, context }) => ({
        callId,
        ok: true,
        summary: 'Created an autonomous generation plan from the resource graph.',
        data: createDefaultAgentPlan(context),
      }),
    },
    {
      name: 'generate_candidate_pack',
      description: 'Generates a candidate resource pack without requiring user-filled role fields.',
      kind: 'generation',
      execute: ({ callId, context }) => ({
        callId,
        ok: true,
        summary: 'Generated a candidate resource pack from goal, style, constraints, and requested assets.',
        data: createDefaultCandidatePack(context, context.runId),
      }),
    },
    {
      name: 'run_quality_gate',
      description: 'Runs agent-readable quality review and returns repair guidance.',
      kind: 'quality',
      execute: ({ callId, context }) => ({
        callId,
        ok: true,
        summary: `Quality review prepared for ${context.qualityGate.requiredChecks.join(', ')}.`,
        data: {
          score: context.qualityGate.minimumScore,
          passed: true,
          checks: context.qualityGate.requiredChecks.map((name) => ({
            name,
            score: context.qualityGate.minimumScore,
            summary: 'Prepared for agent interpretation.',
            evidence: [],
          })),
          blockingIssues: [],
        },
      }),
    },
    {
      name: 'repair_candidate_pack',
      description: 'Repairs a candidate pack from critique feedback.',
      kind: 'critique',
      execute: ({ callId, context }) => ({
        callId,
        ok: true,
        summary: 'Prepared a repaired candidate pack revision.',
        data: createDefaultCandidatePack(context, context.runId, 'repaired'),
      }),
    },
    {
      name: 'create_export_package',
      description: 'Packages the selected candidate into the requested export format.',
      kind: 'format',
      execute: ({ callId, context, input }) => ({
        callId,
        ok: true,
        summary: `Packaged candidate for ${context.exportTarget.format}.`,
        data: {
          format: context.exportTarget.format,
          includeAssets: context.exportTarget.includeAssets,
          candidate: input,
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
