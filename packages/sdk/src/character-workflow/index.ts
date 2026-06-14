/**
 * Defines the agentic RP resource graph, run session, and artifact contracts.
 */
export type CharacterWorkflowLanguage = 'zh-CN' | 'en-US'

export type CharacterNodeType =
  | 'goal'
  | 'style-pressure'
  | 'constraint'
  | 'source-material'
  | 'llm-tool'
  | 'image-tool'
  | 'retrieval-tool'
  | 'voice-tool'
  | 'agent-policy'
  | 'generation-strategy'
  | 'critique-loop'
  | 'quality-gate'
  | 'asset-builder'
  | 'output-adapter'

export type CharacterNodeStatus = 'idle' | 'queued' | 'running' | 'done' | 'failed' | 'skipped' | 'stale'
export type WorkflowRunStatus = 'idle' | 'running' | 'paused' | 'done' | 'failed' | 'canceled'

export type CharacterWorkflowNodeCategory =
  | 'goal'
  | 'taste'
  | 'constraints'
  | 'sources'
  | 'tools'
  | 'agent'
  | 'strategy'
  | 'evaluation'
  | 'outputs'

export type CharacterWorkflowExecutorKind = 'manual' | 'agent' | 'llm' | 'image' | 'retrieval' | 'voice' | 'deterministic'

export type CharacterWorkflowLinkKind =
  | 'guides'
  | 'constrains'
  | 'provides'
  | 'enables'
  | 'grounds'
  | 'weights'
  | 'routes'
  | 'evaluates'
  | 'refines'
  | 'exports'

export interface CharacterWorkflow {
  id: string
  name: string
  version: string
  description?: string
  nodes: CharacterWorkflowNode[]
  edges: CharacterWorkflowEdge[]
  defaults: CharacterWorkflowDefaults
  metadata: CharacterWorkflowMetadata
}

export interface CharacterWorkflowDefaults {
  language: CharacterWorkflowLanguage
  llmApiId?: string
  llmModelName?: string
  imageApiId?: string
  imageModelName?: string
}

export interface CharacterWorkflowMetadata {
  createdAt: number
  updatedAt: number
  author?: string
}

export interface CharacterWorkflowNode {
  id: string
  type: CharacterNodeType
  title: string
  position: CharacterWorkflowPosition
  inputs: Record<string, CharacterNodePort>
  outputs: Record<string, CharacterNodePort>
  config: Record<string, unknown>
  state?: CharacterWorkflowNodeState
}

export type CharacterWorkflowParameterType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'select'
  | 'multi-select'
  | 'string-list'
  | 'model-select'

export type CharacterWorkflowParameterValue = string | number | boolean | string[]

export interface CharacterWorkflowNodeParameter {
  id: string
  label: string
  type: CharacterWorkflowParameterType
  defaultValue: CharacterWorkflowParameterValue
  description?: string
  advanced?: boolean
  min?: number
  max?: number
  step?: number
  options?: CharacterWorkflowParameterOption[]
  modelKind?: 'llm' | 'image'
}

export interface CharacterWorkflowParameterOption {
  label: string
  value: string
}

export interface CharacterWorkflowNodeDefinition {
  type: CharacterNodeType
  title: string
  category: CharacterWorkflowNodeCategory
  executor: CharacterWorkflowExecutorKind
  description: string
  inputs: Record<string, CharacterNodePort>
  outputs: Record<string, CharacterNodePort>
  parameters: CharacterWorkflowNodeParameter[]
}

export interface CharacterWorkflowNodeRegistry {
  list(): CharacterWorkflowNodeDefinition[]
  get(type: CharacterNodeType): CharacterWorkflowNodeDefinition | undefined
  require(type: CharacterNodeType): CharacterWorkflowNodeDefinition
}

export interface CharacterWorkflowPosition {
  x: number
  y: number
}

export interface CharacterNodePort {
  id: string
  label: string
  artifactType: CharacterArtifactType
  required?: boolean
}

export interface CharacterWorkflowNodeState {
  status: CharacterNodeStatus
  error?: string
  startedAt?: number
  finishedAt?: number
}

export interface CharacterWorkflowEdge {
  id: string
  from: CharacterWorkflowEndpoint
  to: CharacterWorkflowEndpoint
  kind: CharacterWorkflowLinkKind
}

export interface CharacterWorkflowEndpoint {
  nodeId: string
  port: string
}

export type CharacterArtifactType =
  | 'generation-goal'
  | 'style-signal'
  | 'hard-constraint'
  | 'source-context'
  | 'model-capability'
  | 'image-capability'
  | 'retrieval-capability'
  | 'voice-capability'
  | 'agent-policy'
  | 'strategy-policy'
  | 'critique-policy'
  | 'quality-criteria'
  | 'asset-target'
  | 'candidate-pack'
  | 'validation-report'
  | 'export-target'

export type CharacterArtifact =
  | GenerationGoalArtifact
  | StyleSignalArtifact
  | HardConstraintArtifact
  | SourceContextArtifact
  | ModelCapabilityArtifact
  | ImageCapabilityArtifact
  | RetrievalCapabilityArtifact
  | VoiceCapabilityArtifact
  | AgentPolicyArtifact
  | StrategyPolicyArtifact
  | CritiquePolicyArtifact
  | QualityCriteriaArtifact
  | AssetTargetArtifact
  | CandidatePackArtifact
  | ValidationReportArtifact
  | ExportTargetArtifact

export interface CharacterArtifactBase {
  id: string
  type: CharacterArtifactType
  sourceNodeId: string
  createdAt: number
}

export interface GenerationGoalArtifact extends CharacterArtifactBase {
  type: 'generation-goal'
  goal: {
    prompt: string
    targetAudience: string
    allowAgentExpansion: boolean
    language: CharacterWorkflowLanguage
  }
}

export interface StyleSignalArtifact extends CharacterArtifactBase {
  type: 'style-signal'
  style: {
    preset: string
    prompt: string
    intensity: number
    weights: Record<string, number>
  }
}

export interface HardConstraintArtifact extends CharacterArtifactBase {
  type: 'hard-constraint'
  constraints: {
    mustHave: string[]
    mustNot: string[]
    hardBoundary: boolean
  }
}

export interface SourceContextArtifact extends CharacterArtifactBase {
  type: 'source-context'
  source: {
    kind: string
    notes: string
    groundingStrength: number
  }
}

export interface ModelCapabilityArtifact extends CharacterArtifactBase {
  type: 'model-capability'
  model: {
    apiId: string
    modelName: string
    modelRef: string
    temperature: number
    reasoningEffort: string
    contextBudget: number
  }
}

export interface ImageCapabilityArtifact extends CharacterArtifactBase {
  type: 'image-capability'
  image: {
    apiId: string
    modelName: string
    modelRef: string
    assetCount: number
    referenceStrength: number
  }
}

export interface RetrievalCapabilityArtifact extends CharacterArtifactBase {
  type: 'retrieval-capability'
  retrieval: {
    enabled: boolean
    mode: string
    citationRequired: boolean
  }
}

export interface VoiceCapabilityArtifact extends CharacterArtifactBase {
  type: 'voice-capability'
  voice: {
    provider: string
    voice: string
    speed: number
  }
}

export interface AgentPolicyArtifact extends CharacterArtifactBase {
  type: 'agent-policy'
  policy: {
    autonomyLevel: string
    revisionBudget: number
    askUserThreshold: string
    canExpandMissingDetails: boolean
  }
}

export interface StrategyPolicyArtifact extends CharacterArtifactBase {
  type: 'strategy-policy'
  strategy: {
    mode: string
    branchCount: number
    priorityAssets: string[]
    stopCondition: string
  }
}

export interface CritiquePolicyArtifact extends CharacterArtifactBase {
  type: 'critique-policy'
  critique: {
    iterations: number
    dimensions: string[]
    autoRepair: boolean
  }
}

export interface QualityCriteriaArtifact extends CharacterArtifactBase {
  type: 'quality-criteria'
  criteria: {
    minimumScore: number
    blockExport: boolean
    requiredChecks: string[]
  }
}

export interface AssetTargetArtifact extends CharacterArtifactBase {
  type: 'asset-target'
  targets: {
    requested: string[]
    includeAlternates: boolean
  }
}

export interface CandidatePackArtifact extends CharacterArtifactBase {
  type: 'candidate-pack'
  pack: {
    title: string
    summary: string
    resources: string[]
    risks: string[]
  }
}

export interface ValidationReportArtifact extends CharacterArtifactBase {
  type: 'validation-report'
  report: {
    passed: boolean
    score: number
    issues: CharacterValidationIssue[]
    repairTargets: string[]
  }
}

export interface ExportTargetArtifact extends CharacterArtifactBase {
  type: 'export-target'
  export: {
    format: string
    includeAssets: boolean
    path: string
  }
}

export interface CharacterValidationIssue {
  severity: 'info' | 'warning' | 'error'
  path: string
  message: string
}

export interface WorkflowRunSession {
  id: string
  workflowId: string
  title: string
  status: WorkflowRunStatus
  activeNodeId?: string
  progress: {
    total: number
    done: number
    failed: number
    skipped: number
  }
  tabs: {
    pinned: boolean
    lastViewedAt: number
  }
  createdAt: number
  updatedAt: number
}

export interface CharacterWorkflowRunState {
  workflow: CharacterWorkflow
  run: WorkflowRunSession
  artifacts: CharacterArtifact[]
  events: CharacterWorkflowRunEvent[]
}

export interface CharacterWorkflowNodeExecutionInput {
  workflow: CharacterWorkflow
  node: CharacterWorkflowNode
  definition: CharacterWorkflowNodeDefinition
  config: Record<string, unknown>
  inputArtifacts: CharacterArtifact[]
  artifacts: CharacterArtifact[]
  runId: string
  timestamp: number
  signal?: AbortSignal
}

export type CharacterWorkflowNodeExecutor = (
  input: CharacterWorkflowNodeExecutionInput
) => CharacterArtifact[] | void | Promise<CharacterArtifact[] | void>

export interface CharacterWorkflowRunnerOptions {
  registry?: CharacterWorkflowNodeRegistry
  executors?: Partial<Record<CharacterNodeType, CharacterWorkflowNodeExecutor>>
  now?: () => number
  signal?: AbortSignal
  onEvent?: (event: CharacterWorkflowRunEvent) => void | Promise<void>
}

export interface CharacterWorkflowRunner {
  run(workflow: CharacterWorkflow): Promise<CharacterWorkflowRunState>
}

export interface CharacterWorkflowAgentPathStep {
  nodeId: string
  nodeType: CharacterNodeType
  title: string
  category: CharacterWorkflowNodeCategory
  executor: CharacterWorkflowExecutorKind
  status: CharacterNodeStatus
  inputArtifactTypes: CharacterArtifactType[]
  outputArtifactTypes: CharacterArtifactType[]
  configKeys: string[]
}

export type CharacterWorkflowRunEvent =
  | { type: 'run.started'; runId: string; timestamp: number }
  | { type: 'node.queued'; runId: string; nodeId: string; timestamp: number }
  | { type: 'node.started'; runId: string; nodeId: string; timestamp: number }
  | { type: 'node.progress'; runId: string; nodeId: string; progress: number; timestamp: number }
  | { type: 'node.artifact.created'; runId: string; nodeId: string; artifact: CharacterArtifact; timestamp: number }
  | { type: 'node.finished'; runId: string; nodeId: string; timestamp: number }
  | { type: 'node.failed'; runId: string; nodeId: string; error: string; timestamp: number }
  | { type: 'run.finished'; runId: string; timestamp: number }

export interface CreateStandardCharacterWorkflowOptions {
  id?: string
  name?: string
  now?: number
  language?: CharacterWorkflowLanguage
  llmApiId?: string
  llmModelName?: string
  imageApiId?: string
  imageModelName?: string
}

export const STANDARD_CHARACTER_WORKFLOW_NODE_DEFINITIONS: CharacterWorkflowNodeDefinition[] = [
  {
    type: 'goal',
    title: 'Generation Goal',
    category: 'goal',
    executor: 'manual',
    description: 'Collects the free-form RP generation target without asking the user to fill final card fields.',
    inputs: {},
    outputs: { goal: port('goal', 'Goal', 'generation-goal') },
    parameters: [
      parameter('goalPrompt', 'Goal Prompt', 'textarea', '校园恋爱，长期 RP，角色要有主动性和暧昧拉扯，但不要模板化。'),
      parameter('targetAudience', 'Target Audience', 'text', 'private long-form roleplay'),
      parameter('allowAgentExpansion', 'Allow Agent Expansion', 'boolean', true),
    ],
  },
  {
    type: 'style-pressure',
    title: 'Style Pressure',
    category: 'taste',
    executor: 'manual',
    description: 'Applies weighted taste, genre, mood, intensity, and pacing pressure to the agent.',
    inputs: { goal: port('goal', 'Goal', 'generation-goal') },
    outputs: { style: port('style', 'Style', 'style-signal') },
    parameters: [
      parameter('preset', 'Preset', 'select', 'campus-romance', undefined, [
        option('Campus Romance', 'campus-romance'),
        option('Dark Adult', 'dark-adult'),
        option('Urban Suspense', 'urban-suspense'),
      ]),
      parameter('stylePrompt', 'Style Prompt', 'textarea', '克制、暧昧、有张力，避免说明书式自我介绍。'),
      parameter('intensity', 'Intensity', 'number', 0.68, { min: 0, max: 1, step: 0.01 }),
    ],
  },
  {
    type: 'constraint',
    title: 'Hard Constraint',
    category: 'constraints',
    executor: 'manual',
    description: 'Sets hard and soft boundaries that limit agent freedom during generation and repair.',
    inputs: { goal: port('goal', 'Goal', 'generation-goal') },
    outputs: { constraint: port('constraint', 'Constraint', 'hard-constraint') },
    parameters: [
      parameter('mustHave', 'Must Have', 'string-list', ['长期可聊', '角色主动推进关系']),
      parameter('mustNot', 'Must Not', 'string-list', ['模板化人格', 'OOC 解释设定', '瞬间顺从']),
      parameter('hardBoundary', 'Hard Boundary', 'boolean', true),
    ],
  },
  {
    type: 'source-material',
    title: 'Source Material',
    category: 'sources',
    executor: 'manual',
    description: 'Provides optional source context, references, existing cards, images, or user preference notes.',
    inputs: {},
    outputs: { source: port('source', 'Source', 'source-context') },
    parameters: [
      parameter('sourceKind', 'Source Kind', 'select', 'notes', undefined, [
        option('Notes', 'notes'),
        option('Existing Card', 'existing-card'),
        option('Image Reference', 'image-reference'),
        option('User Preference', 'user-preference'),
      ]),
      parameter('notes', 'Notes', 'textarea', ''),
      parameter('groundingStrength', 'Grounding Strength', 'number', 0.5, { min: 0, max: 1, step: 0.01 }),
    ],
  },
  {
    type: 'llm-tool',
    title: 'LLM Tool',
    category: 'tools',
    executor: 'llm',
    description: 'Selects the LLM capability available to the backend agent.',
    inputs: {},
    outputs: { model: port('model', 'Model', 'model-capability') },
    parameters: [
      parameter('modelRef', 'Model', 'model-select', '', { modelKind: 'llm' }),
      parameter('temperature', 'Temperature', 'number', 0.72, { min: 0, max: 2, step: 0.01 }),
      parameter('reasoningEffort', 'Reasoning Effort', 'select', 'medium', undefined, [
        option('Low', 'low'),
        option('Medium', 'medium'),
        option('High', 'high'),
      ]),
      parameter('contextBudget', 'Context Budget', 'integer', 16000, { min: 1000, max: 200000, step: 1000 }),
    ],
  },
  {
    type: 'image-tool',
    title: 'Image Tool',
    category: 'tools',
    executor: 'image',
    description: 'Selects image generation or editing capability for visual assets.',
    inputs: { style: port('style', 'Style', 'style-signal') },
    outputs: { image: port('image', 'Image', 'image-capability') },
    parameters: [
      parameter('modelRef', 'Model / Workflow', 'model-select', '', { modelKind: 'image' }),
      parameter('assetCount', 'Asset Count', 'integer', 4, { min: 1, max: 16, step: 1 }),
      parameter('referenceStrength', 'Reference Strength', 'number', 0.55, { min: 0, max: 1, step: 0.01 }),
    ],
  },
  {
    type: 'retrieval-tool',
    title: 'Retrieval Tool',
    category: 'tools',
    executor: 'retrieval',
    description: 'Allows the agent to read local context, vector sources, or web summaries when enabled.',
    inputs: { source: port('source', 'Source', 'source-context') },
    outputs: { retrieval: port('retrieval', 'Retrieval', 'retrieval-capability') },
    parameters: [
      parameter('enabled', 'Enabled', 'boolean', false),
      parameter('mode', 'Mode', 'select', 'local-only', undefined, [
        option('Local Only', 'local-only'),
        option('Vector Index', 'vector-index'),
        option('Web Summary', 'web-summary'),
      ]),
      parameter('citationRequired', 'Citation Required', 'boolean', true),
    ],
  },
  {
    type: 'voice-tool',
    title: 'Voice Tool',
    category: 'tools',
    executor: 'voice',
    description: 'Selects voice or TTS capability for sample lines and voice profile assets.',
    inputs: { style: port('style', 'Style', 'style-signal') },
    outputs: { voice: port('voice', 'Voice', 'voice-capability') },
    parameters: [
      parameter('provider', 'Provider', 'text', ''),
      parameter('voice', 'Voice', 'text', ''),
      parameter('speed', 'Speed', 'number', 1, { min: 0.5, max: 1.5, step: 0.01 }),
    ],
  },
  {
    type: 'agent-policy',
    title: 'Agent Policy',
    category: 'agent',
    executor: 'agent',
    description: 'Defines how much freedom the backend agent has to expand, revise, ask, and repair.',
    inputs: {
      goal: port('goal', 'Goal', 'generation-goal', true),
      constraint: port('constraint', 'Constraint', 'hard-constraint'),
      source: port('source', 'Source', 'source-context'),
      model: port('model', 'Model', 'model-capability', true),
    },
    outputs: { policy: port('policy', 'Policy', 'agent-policy') },
    parameters: [
      parameter('autonomyLevel', 'Autonomy Level', 'select', 'high', undefined, [
        option('Low', 'low'),
        option('Medium', 'medium'),
        option('High', 'high'),
      ]),
      parameter('revisionBudget', 'Revision Budget', 'integer', 4, { min: 1, max: 12, step: 1 }),
      parameter('askUserThreshold', 'Ask User Threshold', 'select', 'blocked-only', undefined, [
        option('Never During Run', 'never'),
        option('Blocked Only', 'blocked-only'),
        option('Low Confidence', 'low-confidence'),
      ]),
      parameter('canExpandMissingDetails', 'Can Expand Missing Details', 'boolean', true),
    ],
  },
  {
    type: 'generation-strategy',
    title: 'Generation Strategy',
    category: 'strategy',
    executor: 'agent',
    description: 'Controls how the agent branches, compares candidates, orders phases, and stops.',
    inputs: {
      goal: port('goal', 'Goal', 'generation-goal', true),
      style: port('style', 'Style', 'style-signal'),
      policy: port('policy', 'Policy', 'agent-policy', true),
    },
    outputs: { strategy: port('strategy', 'Strategy', 'strategy-policy') },
    parameters: [
      parameter('mode', 'Mode', 'select', 'branch-and-refine', undefined, [
        option('Single Pass', 'single-pass'),
        option('Branch and Refine', 'branch-and-refine'),
        option('Explore then Converge', 'explore-then-converge'),
      ]),
      parameter('branchCount', 'Branch Count', 'integer', 3, { min: 1, max: 8, step: 1 }),
      parameter('priorityAssets', 'Priority Assets', 'multi-select', ['role-card', 'opening', 'image-pack'], undefined, [
        option('Role Card', 'role-card'),
        option('Opening', 'opening'),
        option('Image Pack', 'image-pack'),
      ]),
      parameter('stopCondition', 'Stop Condition', 'text', 'quality gate passed'),
    ],
  },
  {
    type: 'critique-loop',
    title: 'Critique Loop',
    category: 'evaluation',
    executor: 'agent',
    description: 'Feeds critique and repair instructions back into candidate generation.',
    inputs: { strategy: port('strategy', 'Strategy', 'strategy-policy', true) },
    outputs: { critique: port('critique', 'Critique', 'critique-policy') },
    parameters: [
      parameter('iterations', 'Iterations', 'integer', 2, { min: 0, max: 8, step: 1 }),
      parameter('dimensions', 'Dimensions', 'string-list', ['goal match', 'long-term RP', 'non-template', 'consistency']),
      parameter('autoRepair', 'Auto Repair', 'boolean', true),
    ],
  },
  {
    type: 'asset-builder',
    title: 'Asset Builder',
    category: 'outputs',
    executor: 'agent',
    description: 'Declares which final resources the agent should produce without forcing the user to write their contents.',
    inputs: {
      strategy: port('strategy', 'Strategy', 'strategy-policy', true),
      image: port('image', 'Image', 'image-capability'),
      voice: port('voice', 'Voice', 'voice-capability'),
    },
    outputs: {
      assets: port('assets', 'Assets', 'asset-target'),
      candidate: port('candidate', 'Candidate', 'candidate-pack'),
    },
    parameters: [
      parameter('targets', 'Targets', 'multi-select', ['role-card', 'opening', 'image-pack', 'generation-report'], undefined, [
        option('Role Card', 'role-card'),
        option('Opening', 'opening'),
        option('Image Pack', 'image-pack'),
        option('Voice Sample', 'voice-sample'),
        option('Generation Report', 'generation-report'),
      ]),
      parameter('includeAlternates', 'Include Alternates', 'boolean', true),
    ],
  },
  {
    type: 'quality-gate',
    title: 'Quality Gate',
    category: 'evaluation',
    executor: 'agent',
    description: 'Defines acceptance criteria that can block export or route candidates back for repair.',
    inputs: {
      goal: port('goal', 'Goal', 'generation-goal', true),
      candidate: port('candidate', 'Candidate', 'candidate-pack', true),
      critique: port('critique', 'Critique', 'critique-policy'),
    },
    outputs: {
      criteria: port('criteria', 'Criteria', 'quality-criteria'),
      report: port('report', 'Report', 'validation-report'),
    },
    parameters: [
      parameter('minimumScore', 'Minimum Score', 'number', 0.82, { min: 0, max: 1, step: 0.01 }),
      parameter('blockExport', 'Block Export', 'boolean', true),
      parameter('requiredChecks', 'Required Checks', 'string-list', ['goal match', 'style intensity', 'long-term RP', 'consistency']),
    ],
  },
  {
    type: 'output-adapter',
    title: 'Output Adapter',
    category: 'outputs',
    executor: 'deterministic',
    description: 'Maps an accepted candidate pack to a target format without changing generation goals.',
    inputs: {
      candidate: port('candidate', 'Candidate', 'candidate-pack', true),
      report: port('report', 'Report', 'validation-report', true),
    },
    outputs: { export: port('export', 'Export', 'export-target') },
    parameters: [
      parameter('format', 'Format', 'select', 'noema-role-chat', undefined, [
        option('Noema Role Chat', 'noema-role-chat'),
        option('SillyTavern', 'sillytavern'),
        option('Portable JSON', 'portable-json'),
        option('Markdown Dossier', 'markdown-dossier'),
      ]),
      parameter('includeAssets', 'Include Assets', 'boolean', true),
    ],
  },
]

export function createCharacterWorkflowNodeRegistry(
  definitions: CharacterWorkflowNodeDefinition[] = STANDARD_CHARACTER_WORKFLOW_NODE_DEFINITIONS
): CharacterWorkflowNodeRegistry {
  const byType = new Map(definitions.map((definition) => [definition.type, definition]))
  return {
    list: () => definitions.map(cloneNodeDefinition),
    get: (type) => {
      const definition = byType.get(type)
      return definition ? cloneNodeDefinition(definition) : undefined
    },
    require: (type) => {
      const definition = byType.get(type)
      if (!definition) {
        throw new Error(`Unknown agentic resource node type: ${type}`)
      }
      return cloneNodeDefinition(definition)
    },
  }
}

export function getStandardCharacterWorkflowNodeDefinitions(): CharacterWorkflowNodeDefinition[] {
  return createCharacterWorkflowNodeRegistry().list()
}

export function createStandardCharacterWorkflow(
  options: CreateStandardCharacterWorkflowOptions = {}
): CharacterWorkflow {
  const now = options.now ?? Date.now()
  const id = options.id ?? `agentic-resource-graph-${now}`
  const node = createWorkflowNodeFactory()
  const nodes = [
    node('goal', 40, 120),
    node('style-pressure', 320, 60),
    node('constraint', 320, 300),
    node('source-material', 40, 360),
    node('llm-tool', 620, 80),
    node('image-tool', 620, 320),
    node('agent-policy', 920, 140),
    node('generation-strategy', 1220, 140),
    node('asset-builder', 1520, 160),
    node('critique-loop', 1220, 420),
    node('quality-gate', 1820, 220),
    node('output-adapter', 2120, 220),
  ]
  const llmModelRef = createModelRef(options.llmApiId, options.llmModelName)
  const imageModelRef = createModelRef(options.imageApiId, options.imageModelName)
  const llmNode = nodes.find((nodeItem) => nodeItem.type === 'llm-tool')
  const imageNode = nodes.find((nodeItem) => nodeItem.type === 'image-tool')
  if (llmNode && llmModelRef) {
    llmNode.config.modelRef = llmModelRef
  }
  if (imageNode && imageModelRef) {
    imageNode.config.modelRef = imageModelRef
  }

  return {
    id,
    name: options.name ?? 'Agentic RP Resource Graph',
    version: '2.0',
    description: 'Configures goals, taste, constraints, tools, agent autonomy, evaluation gates, and output adapters for autonomous RP resource generation.',
    nodes,
    edges: connectEdges([
      ['goal', 'goal', 'style-pressure', 'goal', 'guides'],
      ['goal', 'goal', 'constraint', 'goal', 'constrains'],
      ['goal', 'goal', 'agent-policy', 'goal', 'guides'],
      ['style-pressure', 'style', 'generation-strategy', 'style', 'weights'],
      ['constraint', 'constraint', 'agent-policy', 'constraint', 'constrains'],
      ['source-material', 'source', 'agent-policy', 'source', 'grounds'],
      ['llm-tool', 'model', 'agent-policy', 'model', 'enables'],
      ['style-pressure', 'style', 'image-tool', 'style', 'guides'],
      ['image-tool', 'image', 'asset-builder', 'image', 'enables'],
      ['agent-policy', 'policy', 'generation-strategy', 'policy', 'guides'],
      ['generation-strategy', 'strategy', 'asset-builder', 'strategy', 'routes'],
      ['generation-strategy', 'strategy', 'critique-loop', 'strategy', 'routes'],
      ['critique-loop', 'critique', 'quality-gate', 'critique', 'evaluates'],
      ['asset-builder', 'candidate', 'quality-gate', 'candidate', 'evaluates'],
      ['quality-gate', 'report', 'generation-strategy', 'strategy', 'refines'],
      ['asset-builder', 'candidate', 'output-adapter', 'candidate', 'exports'],
      ['quality-gate', 'report', 'output-adapter', 'report', 'constrains'],
    ]),
    defaults: {
      language: options.language ?? 'zh-CN',
      llmApiId: options.llmApiId,
      llmModelName: options.llmModelName,
      imageApiId: options.imageApiId,
      imageModelName: options.imageModelName,
    },
    metadata: {
      createdAt: now,
      updatedAt: now,
    },
  }
}

export function createWorkflowRunSession(
  workflow: Pick<CharacterWorkflow, 'id' | 'nodes' | 'name'>,
  now = Date.now()
): WorkflowRunSession {
  return {
    id: `agentic-resource-run-${now}`,
    workflowId: workflow.id,
    title: `${workflow.name}.run`,
    status: 'idle',
    progress: {
      total: workflow.nodes.length,
      done: 0,
      failed: 0,
      skipped: 0,
    },
    tabs: {
      pinned: false,
      lastViewedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  }
}

export function createWorkflowRunState(
  workflow: CharacterWorkflow,
  now = Date.now()
): CharacterWorkflowRunState {
  return {
    workflow: cloneWorkflow(workflow),
    run: createWorkflowRunSession(workflow, now),
    artifacts: [],
    events: [],
  }
}

export function applyWorkflowRunEvent(
  state: CharacterWorkflowRunState,
  event: CharacterWorkflowRunEvent
): CharacterWorkflowRunState {
  if (event.runId !== state.run.id) {
    return state
  }
  const next: CharacterWorkflowRunState = {
    workflow: cloneWorkflow(state.workflow),
    run: {
      ...state.run,
      progress: { ...state.run.progress },
      tabs: { ...state.run.tabs },
      updatedAt: event.timestamp,
    },
    artifacts: [...state.artifacts],
    events: [...state.events, event],
  }

  switch (event.type) {
    case 'run.started':
      next.run.status = 'running'
      break
    case 'node.queued':
      updateWorkflowNode(next.workflow, event.nodeId, { status: 'queued', error: undefined })
      next.run.status = 'running'
      break
    case 'node.started':
      updateWorkflowNode(next.workflow, event.nodeId, {
        status: 'running',
        error: undefined,
        startedAt: event.timestamp,
      })
      next.run.status = 'running'
      next.run.activeNodeId = event.nodeId
      break
    case 'node.progress':
      next.run.status = 'running'
      next.run.activeNodeId = event.nodeId
      break
    case 'node.artifact.created':
      next.artifacts = upsertArtifact(next.artifacts, event.artifact)
      next.run.status = 'running'
      next.run.activeNodeId = event.nodeId
      break
    case 'node.finished':
      updateWorkflowNode(next.workflow, event.nodeId, {
        status: 'done',
        error: undefined,
        finishedAt: event.timestamp,
      })
      next.run.activeNodeId = undefined
      break
    case 'node.failed':
      updateWorkflowNode(next.workflow, event.nodeId, {
        status: 'failed',
        error: event.error,
        finishedAt: event.timestamp,
      })
      next.run.status = 'failed'
      next.run.activeNodeId = event.nodeId
      break
    case 'run.finished':
      next.run.status = next.run.progress.failed > 0 ? 'failed' : 'done'
      next.run.activeNodeId = undefined
      break
    default:
      break
  }

  next.run.progress = calculateRunProgress(next.workflow)
  return next
}

export function createCharacterWorkflowRunner(
  options: CharacterWorkflowRunnerOptions = {}
): CharacterWorkflowRunner {
  const registry = options.registry ?? createCharacterWorkflowNodeRegistry()
  const executors = {
    ...createDefaultCharacterWorkflowExecutors(),
    ...options.executors,
  }
  const now = options.now ?? Date.now

  return {
    async run(workflow) {
      let state = createWorkflowRunState(workflow, now())
      const emit = async (event: CharacterWorkflowRunEvent) => {
        state = applyWorkflowRunEvent(state, event)
        await options.onEvent?.(event)
      }

      await emit({ type: 'run.started', runId: state.run.id, timestamp: now() })
      for (const nodeItem of getWorkflowExecutionOrder(state.workflow)) {
        if (options.signal?.aborted) {
          break
        }
        const definition = registry.require(nodeItem.type)
        const inputArtifacts = resolveNodeInputArtifacts(state.workflow, nodeItem, state.artifacts)
        const missingInput = findMissingRequiredInput(nodeItem, inputArtifacts)
        if (missingInput) {
          await emit({
            type: 'node.failed',
            runId: state.run.id,
            nodeId: nodeItem.id,
            error: `Missing required input: ${missingInput.label}`,
            timestamp: now(),
          })
          break
        }

        await emit({ type: 'node.started', runId: state.run.id, nodeId: nodeItem.id, timestamp: now() })
        const executor = executors[nodeItem.type]
        if (!executor) {
          await emit({
            type: 'node.failed',
            runId: state.run.id,
            nodeId: nodeItem.id,
            error: `No executor registered for node type: ${nodeItem.type}`,
            timestamp: now(),
          })
          break
        }

        try {
          const artifacts = await executor({
            workflow: state.workflow,
            node: nodeItem,
            definition,
            config: nodeItem.config,
            inputArtifacts,
            artifacts: state.artifacts,
            runId: state.run.id,
            timestamp: now(),
            signal: options.signal,
          }) ?? []
          for (const artifact of artifacts) {
            await emit({
              type: 'node.artifact.created',
              runId: state.run.id,
              nodeId: nodeItem.id,
              artifact,
              timestamp: now(),
            })
          }
          await emit({ type: 'node.finished', runId: state.run.id, nodeId: nodeItem.id, timestamp: now() })
        } catch (error) {
          await emit({
            type: 'node.failed',
            runId: state.run.id,
            nodeId: nodeItem.id,
            error: error instanceof Error ? error.message : String(error),
            timestamp: now(),
          })
          break
        }
      }
      await emit({ type: 'run.finished', runId: state.run.id, timestamp: now() })
      return state
    },
  }
}

export async function executeCharacterWorkflow(
  workflow: CharacterWorkflow,
  options: CharacterWorkflowRunnerOptions = {}
): Promise<CharacterWorkflowRunState> {
  return createCharacterWorkflowRunner(options).run(workflow)
}

export function createCharacterWorkflowAgentPath(
  workflow: CharacterWorkflow,
  registry: CharacterWorkflowNodeRegistry = createCharacterWorkflowNodeRegistry()
): CharacterWorkflowAgentPathStep[] {
  return getWorkflowExecutionOrder(workflow).map((nodeItem) => {
    const definition = registry.require(nodeItem.type)
    return {
      nodeId: nodeItem.id,
      nodeType: nodeItem.type,
      title: nodeItem.title,
      category: definition.category,
      executor: definition.executor,
      status: nodeItem.state?.status ?? 'idle',
      inputArtifactTypes: Object.values(nodeItem.inputs).map((portItem) => portItem.artifactType),
      outputArtifactTypes: Object.values(nodeItem.outputs).map((portItem) => portItem.artifactType),
      configKeys: definition.parameters.map((parameterItem) => parameterItem.id),
    }
  })
}

export function collectWorkflowArtifacts<T extends CharacterArtifactType>(
  state: CharacterWorkflowRunState,
  type: T
): Array<Extract<CharacterArtifact, { type: T }>> {
  return state.artifacts.filter((artifact): artifact is Extract<CharacterArtifact, { type: T }> => artifact.type === type)
}

function createWorkflowNodeFactory() {
  const registry = createCharacterWorkflowNodeRegistry()
  return (type: CharacterNodeType, x: number, y: number): CharacterWorkflowNode => {
    const definition = registry.require(type)
    return {
      id: type,
      type,
      title: definition.title,
      position: { x, y },
      inputs: clonePorts(definition.inputs),
      outputs: clonePorts(definition.outputs),
      config: createDefaultNodeConfig(definition),
      state: { status: 'idle' },
    }
  }
}

function cloneWorkflow(workflow: CharacterWorkflow): CharacterWorkflow {
  return {
    ...workflow,
    nodes: workflow.nodes.map((nodeItem) => ({
      ...nodeItem,
      position: { ...nodeItem.position },
      inputs: clonePorts(nodeItem.inputs),
      outputs: clonePorts(nodeItem.outputs),
      config: { ...nodeItem.config },
      state: nodeItem.state ? { ...nodeItem.state } : undefined,
    })),
    edges: workflow.edges.map((edge) => ({
      ...edge,
      from: { ...edge.from },
      to: { ...edge.to },
    })),
    defaults: { ...workflow.defaults },
    metadata: { ...workflow.metadata },
  }
}

function cloneNodeDefinition(definition: CharacterWorkflowNodeDefinition): CharacterWorkflowNodeDefinition {
  return {
    ...definition,
    inputs: clonePorts(definition.inputs),
    outputs: clonePorts(definition.outputs),
    parameters: definition.parameters.map((item) => ({
      ...item,
      defaultValue: Array.isArray(item.defaultValue) ? [...item.defaultValue] : item.defaultValue,
      options: item.options?.map((optionItem) => ({ ...optionItem })),
    })),
  }
}

function clonePorts(ports: Record<string, CharacterNodePort>): Record<string, CharacterNodePort> {
  return Object.fromEntries(Object.entries(ports).map(([key, value]) => [key, { ...value }]))
}

function createDefaultNodeConfig(definition: CharacterWorkflowNodeDefinition): Record<string, unknown> {
  return Object.fromEntries(
    definition.parameters.map((item) => [
      item.id,
      Array.isArray(item.defaultValue) ? [...item.defaultValue] : item.defaultValue,
    ])
  )
}

function createDefaultCharacterWorkflowExecutors(): Partial<Record<CharacterNodeType, CharacterWorkflowNodeExecutor>> {
  return {
    goal: ({ node, config, workflow, timestamp }) => [{
      id: `${node.id}-goal`,
      type: 'generation-goal',
      sourceNodeId: node.id,
      createdAt: timestamp,
      goal: {
        prompt: stringConfig(config.goalPrompt, ''),
        targetAudience: stringConfig(config.targetAudience, ''),
        allowAgentExpansion: booleanConfig(config.allowAgentExpansion, true),
        language: workflow.defaults.language,
      },
    }],
    'style-pressure': ({ node, config, timestamp }) => [{
      id: `${node.id}-style`,
      type: 'style-signal',
      sourceNodeId: node.id,
      createdAt: timestamp,
      style: {
        preset: stringConfig(config.preset, 'custom'),
        prompt: stringConfig(config.stylePrompt, ''),
        intensity: numberConfig(config.intensity, 0.5),
        weights: { intensity: numberConfig(config.intensity, 0.5) },
      },
    }],
    constraint: ({ node, config, timestamp }) => [{
      id: `${node.id}-constraint`,
      type: 'hard-constraint',
      sourceNodeId: node.id,
      createdAt: timestamp,
      constraints: {
        mustHave: stringListConfig(config.mustHave),
        mustNot: stringListConfig(config.mustNot),
        hardBoundary: booleanConfig(config.hardBoundary, true),
      },
    }],
    'source-material': ({ node, config, timestamp }) => [{
      id: `${node.id}-source`,
      type: 'source-context',
      sourceNodeId: node.id,
      createdAt: timestamp,
      source: {
        kind: stringConfig(config.sourceKind, 'notes'),
        notes: stringConfig(config.notes, ''),
        groundingStrength: numberConfig(config.groundingStrength, 0.5),
      },
    }],
    'llm-tool': ({ node, config, workflow, timestamp }) => [{
      id: `${node.id}-model`,
      type: 'model-capability',
      sourceNodeId: node.id,
      createdAt: timestamp,
      model: {
        ...parseModelRef(nonEmptyStringConfig(config.modelRef, createModelRef(workflow.defaults.llmApiId, workflow.defaults.llmModelName))),
        temperature: numberConfig(config.temperature, 0.72),
        reasoningEffort: stringConfig(config.reasoningEffort, 'medium'),
        contextBudget: numberConfig(config.contextBudget, 16000),
      },
    }],
    'image-tool': ({ node, config, workflow, timestamp }) => [{
      id: `${node.id}-image`,
      type: 'image-capability',
      sourceNodeId: node.id,
      createdAt: timestamp,
      image: {
        ...parseModelRef(nonEmptyStringConfig(config.modelRef, createModelRef(workflow.defaults.imageApiId, workflow.defaults.imageModelName))),
        assetCount: numberConfig(config.assetCount, 4),
        referenceStrength: numberConfig(config.referenceStrength, 0.55),
      },
    }],
    'retrieval-tool': ({ node, config, timestamp }) => [{
      id: `${node.id}-retrieval`,
      type: 'retrieval-capability',
      sourceNodeId: node.id,
      createdAt: timestamp,
      retrieval: {
        enabled: booleanConfig(config.enabled, false),
        mode: stringConfig(config.mode, 'local-only'),
        citationRequired: booleanConfig(config.citationRequired, true),
      },
    }],
    'voice-tool': ({ node, config, timestamp }) => [{
      id: `${node.id}-voice`,
      type: 'voice-capability',
      sourceNodeId: node.id,
      createdAt: timestamp,
      voice: {
        provider: stringConfig(config.provider, ''),
        voice: stringConfig(config.voice, ''),
        speed: numberConfig(config.speed, 1),
      },
    }],
    'agent-policy': ({ node, config, timestamp }) => [{
      id: `${node.id}-policy`,
      type: 'agent-policy',
      sourceNodeId: node.id,
      createdAt: timestamp,
      policy: {
        autonomyLevel: stringConfig(config.autonomyLevel, 'high'),
        revisionBudget: numberConfig(config.revisionBudget, 4),
        askUserThreshold: stringConfig(config.askUserThreshold, 'blocked-only'),
        canExpandMissingDetails: booleanConfig(config.canExpandMissingDetails, true),
      },
    }],
    'generation-strategy': ({ node, config, timestamp }) => [{
      id: `${node.id}-strategy`,
      type: 'strategy-policy',
      sourceNodeId: node.id,
      createdAt: timestamp,
      strategy: {
        mode: stringConfig(config.mode, 'branch-and-refine'),
        branchCount: numberConfig(config.branchCount, 3),
        priorityAssets: stringListConfig(config.priorityAssets),
        stopCondition: stringConfig(config.stopCondition, 'quality gate passed'),
      },
    }],
    'critique-loop': ({ node, config, timestamp }) => [{
      id: `${node.id}-critique`,
      type: 'critique-policy',
      sourceNodeId: node.id,
      createdAt: timestamp,
      critique: {
        iterations: numberConfig(config.iterations, 2),
        dimensions: stringListConfig(config.dimensions),
        autoRepair: booleanConfig(config.autoRepair, true),
      },
    }],
    'asset-builder': ({ node, config, timestamp }) => [{
      id: `${node.id}-targets`,
      type: 'asset-target',
      sourceNodeId: node.id,
      createdAt: timestamp,
      targets: {
        requested: stringListConfig(config.targets),
        includeAlternates: booleanConfig(config.includeAlternates, true),
      },
    }, {
      id: `${node.id}-candidate`,
      type: 'candidate-pack',
      sourceNodeId: node.id,
      createdAt: timestamp,
      pack: {
        title: 'Agentic RP Candidate',
        summary: 'Mock candidate assembled from goals, taste pressure, constraints, tool capabilities, and strategy policy.',
        resources: stringListConfig(config.targets),
        risks: [],
      },
    }],
    'quality-gate': ({ node, config, inputArtifacts, timestamp }) => {
      const hasCandidate = inputArtifacts.some((artifact) => artifact.type === 'candidate-pack')
      const score = hasCandidate ? 0.86 : 0.2
      return [{
        id: `${node.id}-criteria`,
        type: 'quality-criteria',
        sourceNodeId: node.id,
        createdAt: timestamp,
        criteria: {
          minimumScore: numberConfig(config.minimumScore, 0.82),
          blockExport: booleanConfig(config.blockExport, true),
          requiredChecks: stringListConfig(config.requiredChecks),
        },
      }, {
        id: `${node.id}-report`,
        type: 'validation-report',
        sourceNodeId: node.id,
        createdAt: timestamp,
        report: {
          passed: score >= numberConfig(config.minimumScore, 0.82),
          score,
          issues: hasCandidate ? [] : [{ severity: 'error', path: 'candidate', message: 'Candidate pack is missing.' }],
          repairTargets: hasCandidate ? [] : ['asset-builder'],
        },
      }]
    },
    'output-adapter': ({ node, config, timestamp }) => [{
      id: `${node.id}-export`,
      type: 'export-target',
      sourceNodeId: node.id,
      createdAt: timestamp,
      export: {
        format: stringConfig(config.format, 'noema-role-chat'),
        includeAssets: booleanConfig(config.includeAssets, true),
        path: `memory://agentic-resource-graph/${stringConfig(config.format, 'noema-role-chat')}`,
      },
    }],
  }
}

function getWorkflowExecutionOrder(workflow: CharacterWorkflow): CharacterWorkflowNode[] {
  const nodesById = new Map(workflow.nodes.map((nodeItem) => [nodeItem.id, nodeItem]))
  const incoming = new Map(workflow.nodes.map((nodeItem) => [nodeItem.id, 0]))
  const outgoing = new Map<string, CharacterWorkflowEdge[]>()
  for (const edge of workflow.edges) {
    incoming.set(edge.to.nodeId, (incoming.get(edge.to.nodeId) ?? 0) + 1)
    const edges = outgoing.get(edge.from.nodeId) ?? []
    edges.push(edge)
    outgoing.set(edge.from.nodeId, edges)
  }
  const ready = workflow.nodes.filter((nodeItem) => (incoming.get(nodeItem.id) ?? 0) === 0)
  const ordered: CharacterWorkflowNode[] = []
  while (ready.length) {
    const nodeItem = ready.shift()
    if (!nodeItem) {
      continue
    }
    ordered.push(nodeItem)
    for (const edge of outgoing.get(nodeItem.id) ?? []) {
      const nextCount = (incoming.get(edge.to.nodeId) ?? 0) - 1
      incoming.set(edge.to.nodeId, nextCount)
      if (nextCount === 0) {
        const nextNode = nodesById.get(edge.to.nodeId)
        if (nextNode) {
          ready.push(nextNode)
        }
      }
    }
  }
  return ordered.length === workflow.nodes.length ? ordered : workflow.nodes
}

function resolveNodeInputArtifacts(
  workflow: CharacterWorkflow,
  node: CharacterWorkflowNode,
  artifacts: CharacterArtifact[]
): CharacterArtifact[] {
  const incomingEdges = workflow.edges.filter((edge) => edge.to.nodeId === node.id)
  const acceptedTypes = new Set(incomingEdges
    .map((edge) => node.inputs[edge.to.port]?.artifactType)
    .filter(Boolean))
  return artifacts.filter((artifact) => acceptedTypes.has(artifact.type))
}

function findMissingRequiredInput(
  node: CharacterWorkflowNode,
  inputArtifacts: CharacterArtifact[]
): CharacterNodePort | undefined {
  return Object.values(node.inputs).find((input) => (
    input.required && !inputArtifacts.some((artifact) => artifact.type === input.artifactType)
  ))
}

function updateWorkflowNode(
  workflow: CharacterWorkflow,
  nodeId: string,
  state: Partial<CharacterWorkflowNodeState>
): void {
  const target = workflow.nodes.find((nodeItem) => nodeItem.id === nodeId)
  if (!target) {
    return
  }
  target.state = {
    status: target.state?.status ?? 'idle',
    ...target.state,
    ...state,
  }
}

function calculateRunProgress(workflow: CharacterWorkflow): WorkflowRunSession['progress'] {
  return workflow.nodes.reduce<WorkflowRunSession['progress']>((progress, nodeItem) => {
    const status = nodeItem.state?.status ?? 'idle'
    if (status === 'done') {
      progress.done += 1
    } else if (status === 'failed') {
      progress.failed += 1
    } else if (status === 'skipped') {
      progress.skipped += 1
    }
    return progress
  }, {
    total: workflow.nodes.length,
    done: 0,
    failed: 0,
    skipped: 0,
  })
}

function upsertArtifact(artifacts: CharacterArtifact[], artifact: CharacterArtifact): CharacterArtifact[] {
  const existingIndex = artifacts.findIndex((item) => item.id === artifact.id)
  if (existingIndex < 0) {
    return [...artifacts, artifact]
  }
  return artifacts.map((item, index) => index === existingIndex ? artifact : item)
}

function port(
  id: string,
  label: string,
  artifactType: CharacterArtifactType,
  required = false
): CharacterNodePort {
  return { id, label, artifactType, required }
}

function parameter(
  id: string,
  label: string,
  type: CharacterWorkflowParameterType,
  defaultValue: CharacterWorkflowParameterValue,
  optionsOrMeta?: CharacterWorkflowParameterOption[] | Partial<Omit<CharacterWorkflowNodeParameter, 'id' | 'label' | 'type' | 'defaultValue' | 'options'>>,
  options?: CharacterWorkflowParameterOption[]
): CharacterWorkflowNodeParameter {
  const meta = Array.isArray(optionsOrMeta) ? undefined : optionsOrMeta
  return {
    id,
    label,
    type,
    defaultValue,
    ...meta,
    options: Array.isArray(optionsOrMeta) ? optionsOrMeta : options,
  }
}

function option(label: string, value: string): CharacterWorkflowParameterOption {
  return { label, value }
}

function connectEdges(items: Array<[string, string, string, string, CharacterWorkflowLinkKind]>): CharacterWorkflowEdge[] {
  return items.map(([fromNode, fromPort, toNode, toPort, kind]) => ({
    id: `${fromNode}.${fromPort}->${toNode}.${toPort}`,
    from: { nodeId: fromNode, port: fromPort },
    to: { nodeId: toNode, port: toPort },
    kind,
  }))
}

function stringConfig(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function nonEmptyStringConfig(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function createModelRef(apiId: string | undefined, modelName: string | undefined): string {
  return apiId && modelName ? `${apiId}::${modelName}` : ''
}

function parseModelRef(modelRef: string): { apiId: string; modelName: string; modelRef: string } {
  const [apiId = '', ...modelNameParts] = modelRef.split('::')
  return {
    apiId,
    modelName: modelNameParts.join('::'),
    modelRef,
  }
}

function stringListConfig(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : fallback
}

function numberConfig(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback
}

function booleanConfig(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}
