/**
 * Defines the agentic RP resource graph, run session, and artifact contracts.
 */
export * from './agent-runtime.js'
export * from './chat-agent-tools.js'
export * from './workflow-builder.js'
import { CURRENT_CHARACTER_WORKFLOW_VERSION } from './agent-runtime.js'

export type CharacterWorkflowLanguage = 'zh-CN' | 'en-US'

export type CharacterNodeType =
  | 'goal'
  | 'character-card-target'
  | 'character-field-target'
  | 'opening-layout-target'
  | 'atmosphere-style-target'
  | 'game-system-target'
  | 'resource-package-target'
  | 'image-target'
  | 'world-card-target'
  | 'npc-pack-target'
  | 'npc-target'
  | 'plot-arc-target'
  | 'scene-card-target'
  | 'style-pressure'
  | 'constraint'
  | 'image-generation-control'
  | 'continuity-control'
  | 'relationship-control'
  | 'source-material'
  | 'llm-tool'
  | 'image-tool'
  | 'retrieval-tool'
  | 'voice-tool'
  | 'agent-policy'
  | 'generation-strategy'
  | 'critique-loop'
  | 'quality-gate'
  | 'output-adapter'

export type CharacterNodeStatus = 'idle' | 'queued' | 'running' | 'done' | 'failed' | 'skipped' | 'stale'
export type WorkflowRunStatus = 'idle' | 'running' | 'paused' | 'done' | 'failed' | 'canceled'

export type CharacterWorkflowNodeCategory =
  | 'goal'
  | 'targets'
  | 'taste'
  | 'constraints'
  | 'controls'
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
  | 'materials'
  | 'field-control-list'

export interface CharacterFieldControlConfig {
  field: string
  fieldPurpose: string
  tone: string
  lengthPolicy: string
  avoidPatterns: string[]
}

export type CharacterWorkflowParameterValue = string | number | boolean | string[] | SourceMaterialItem[] | CharacterFieldControlConfig[]

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
  | 'resource-package'
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
  | ResourcePackageArtifact
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
    materials: SourceMaterialItem[]
  }
}

export interface SourceMaterialItem {
  id: string
  kind: 'image' | 'document'
  name: string
  mimeType: string
  size?: number
  dataUrl?: string
  text?: string
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
    referenceStrength: number
    editModelRef?: string
    editModelName?: string
    compositionFreedom?: number
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

export interface ResourcePackageArtifact extends CharacterArtifactBase {
  type: 'resource-package'
  package: {
    title: string
    summary: string
    resources: string[]
    coverage: string[]
    missing: string[]
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

const PROSE_STYLE_PRESET_VALUES = [
  'custom',
  'plain-natural-rp',
  'immersive-second-person',
  'close-third-person',
  'first-person-confessional',
  'dialogue-forward',
  'cinematic-scene-prose',
  'sensory-rich-prose',
  'minimalist-prose',
  'precise-literary-prose',
  'lush-poetic-prose',
  'noir-detective-voice',
  'gothic-romance-prose',
  'dark-fantasy-prose',
  'urban-fantasy-prose',
  'grimdark-prose',
  'cozy-fantasy-prose',
  'high-fantasy-epic',
  'sword-and-sorcery',
  'wuxia-xianxia-prose',
  'isekai-adventure',
  'space-opera-prose',
  'cyberpunk-noir',
  'post-apocalyptic-survival',
  'dystopian-drama',
  'occult-mystery',
  'cosmic-horror-prose',
  'psychological-thriller',
  'cozy-mystery',
  'crime-drama',
  'medical-drama',
  'legal-drama',
  'political-intrigue',
  'military-sci-fi',
  'slice-of-life',
  'slow-burn-romance',
  'campus-romance',
  'office-romance',
  'forbidden-romance',
  'rivals-to-lovers',
  'enemies-to-lovers',
  'childhood-friends',
  'found-family',
  'hurt-comfort',
  'angst-with-comfort',
  'protective-companion',
  'mentor-student-tension',
  'arranged-marriage-drama',
  'royal-court-romance',
  'monster-romance',
  'paranormal-romance',
  'yandere-tension',
  'obsessive-devotion',
  'toxic-romance-drama',
  'dark-adult-drama',
  'power-imbalance-drama',
  'mature-psychological-romance',
  'taboo-tension-drama',
  'jealousy-and-possession',
  'betrayal-and-reconciliation',
  'domestic-suspense',
  'melodrama',
  'soap-opera',
  'comedic-banter',
  'dry-wit',
  'satirical-prose',
  'wholesome-comfort',
  'healing-slow-life',
  'dreamlike-surreal',
  'liminal-horror',
  'fairytale-retelling',
  'mythic-legendary',
  'picaresque-adventure',
  'journal-entry-style',
  'epistolary-style',
  'chat-log-style',
  'scenario-card-direct',
  'sillytavern-natural-card',
  'ali-chat-dialogue-samples',
  'w-plus-plus-structured',
  'longform-novelistic-rp',
]

const PROSE_STYLE_PRESET_OPTIONS: CharacterWorkflowParameterOption[] = PROSE_STYLE_PRESET_VALUES.map((value) => (
  option(value.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '), value)
))

const CHARACTER_CARD_FIELD_OPTIONS = [
  option('Name', 'name'),
  option('Description', 'description'),
  option('Appearance', 'appearance'),
  option('Personality', 'personality'),
  option('Background', 'background'),
  option('Scenario', 'scenario'),
  option('First Message', 'firstMessage'),
  option('Dialogue Style', 'dialogueStyle'),
  option('World Context', 'worldContext'),
]

const CHARACTER_SUPPORT_FIELD_OPTIONS = [
  option('Appearance Prompt', 'appearancePrompt'),
]

const OPENING_LAYOUT_KIND_OPTIONS = [
  option('Auto Mixed Opening', 'auto-opening-layout'),
  option('Cinematic Poster', 'cinematic-poster'),
  option('Visual Novel Scene', 'visual-novel-scene'),
  option('Chat Teaser', 'chat-teaser'),
  option('Scrapbook Collage', 'scrapbook-collage'),
  option('Profile Dossier', 'profile-dossier'),
  option('Editorial Cover', 'editorial-cover'),
]

const OPENING_TEXT_DENSITY_OPTIONS = [
  option('Minimal', 'minimal'),
  option('Balanced', 'balanced'),
  option('Story', 'story'),
]

const DEFAULT_CHARACTER_CARD_FIELDS = CHARACTER_CARD_FIELD_OPTIONS.map((item) => item.value)
const DEFAULT_CHARACTER_SUPPORT_FIELDS = CHARACTER_SUPPORT_FIELD_OPTIONS.map((item) => item.value)
const DEFAULT_CHARACTER_FIELD_TARGET_FIELDS = [...DEFAULT_CHARACTER_CARD_FIELDS, ...DEFAULT_CHARACTER_SUPPORT_FIELDS]

const DEFAULT_CHARACTER_FIELD_CONTROLS: CharacterFieldControlConfig[] = [
  { field: 'name', fieldPurpose: 'Short display name only.', tone: 'neutral', lengthPolicy: 'short', avoidPatterns: [] },
  { field: 'description', fieldPurpose: 'Concise identity hook and roleplay appeal.', tone: 'warm', lengthPolicy: 'medium', avoidPatterns: ['lore-dump'] },
  { field: 'appearance', fieldPurpose: 'Visible body, face, outfit, posture, expression, and motifs.', tone: 'neutral', lengthPolicy: 'medium', avoidPatterns: ['lore-dump'] },
  { field: 'personality', fieldPurpose: 'Inner drives, contradictions, habits, emotional logic, and relationship behavior.', tone: 'sharp', lengthPolicy: 'medium', avoidPatterns: ['self-introduction'] },
  { field: 'background', fieldPurpose: 'Formative history, secrets, losses, obligations, and causes.', tone: 'dramatic', lengthPolicy: 'medium', avoidPatterns: ['lore-dump'] },
  { field: 'scenario', fieldPurpose: 'Persistent present setup, current tension, roles, stakes, and continuation hooks.', tone: 'restrained', lengthPolicy: 'medium', avoidPatterns: ['asking-user-intent'] },
  { field: 'firstMessage', fieldPurpose: 'Playable opening scene wrapped in chat tags with a concrete hook. Keep it rich but concise.', tone: 'warm', lengthPolicy: 'medium', avoidPatterns: ['ooc-explanation', 'asking-user-intent'] },
  { field: 'dialogueStyle', fieldPurpose: 'Speech rhythm, diction, address style, emotional tells, and taboo phrases.', tone: 'neutral', lengthPolicy: 'medium', avoidPatterns: ['lore-dump'] },
  { field: 'worldContext', fieldPurpose: 'Stable world, institution, social, supernatural, or relationship facts outside one scene.', tone: 'restrained', lengthPolicy: 'medium', avoidPatterns: ['lore-dump'] },
  { field: 'appearancePrompt', fieldPurpose: 'Compact avatar identity seed prompt derived from completed character fields and image controls.', tone: 'neutral', lengthPolicy: 'medium', avoidPatterns: ['ooc-explanation'] },
]

export const STANDARD_CHARACTER_WORKFLOW_NODE_DEFINITIONS: CharacterWorkflowNodeDefinition[] = [
  {
    type: 'goal',
    title: 'Generation Goal',
    category: 'goal',
    executor: 'manual',
    description: 'Collects the free-form RP generation target without asking the user to fill final card fields.',
    inputs: { source: port('source', 'Source', 'source-context') },
    outputs: { goal: port('goal', 'Goal', 'generation-goal') },
    parameters: [
      parameter('goalPrompt', 'Goal Prompt', 'textarea', ''),
      parameter('targetAudience', 'Target Audience', 'text', ''),
      parameter('allowAgentExpansion', 'Allow Agent Expansion', 'boolean', true),
    ],
  },
  {
    type: 'character-card-target',
    title: 'Character Card Target',
    category: 'targets',
    executor: 'agent',
    description: 'Declares the complete role card as a target resource assembled from field targets and controls.',
    inputs: {
      goal: port('goal', 'Goal', 'generation-goal', true),
      style: port('style', 'Style', 'style-signal'),
      constraint: port('constraint', 'Constraint', 'hard-constraint'),
      source: port('source', 'Source', 'source-context'),
    },
    outputs: {
      target: port('target', 'Target', 'asset-target'),
      candidate: port('candidate', 'Candidate', 'candidate-pack'),
    },
    parameters: [
      parameter('includeFields', 'Include Fields', 'multi-select', DEFAULT_CHARACTER_CARD_FIELDS, undefined, CHARACTER_CARD_FIELD_OPTIONS),
      parameter('includeSupportFields', 'Include Support Fields', 'multi-select', DEFAULT_CHARACTER_SUPPORT_FIELDS, undefined, CHARACTER_SUPPORT_FIELD_OPTIONS),
    ],
  },
  {
    type: 'character-field-target',
    title: 'Character Fields',
    category: 'targets',
    executor: 'agent',
    description: 'Declares the field resource and per-field generation controls for the role card in one node.',
    inputs: {
      card: port('card', 'Card', 'asset-target'),
      style: port('style', 'Style', 'style-signal'),
      constraint: port('constraint', 'Constraint', 'hard-constraint'),
    },
    outputs: { field: port('field', 'Field', 'asset-target') },
    parameters: [
      parameter('fields', 'Fields', 'multi-select', DEFAULT_CHARACTER_FIELD_TARGET_FIELDS, undefined, [
        ...CHARACTER_CARD_FIELD_OPTIONS,
        ...CHARACTER_SUPPORT_FIELD_OPTIONS,
      ]),
      parameter('fieldControls', 'Field Controls', 'field-control-list', DEFAULT_CHARACTER_FIELD_CONTROLS, [
        ...CHARACTER_CARD_FIELD_OPTIONS,
        ...CHARACTER_SUPPORT_FIELD_OPTIONS,
      ]),
    ],
  },
  {
    type: 'opening-layout-target',
    title: 'Opening Layout Target',
    category: 'targets',
    executor: 'agent',
    description: 'Declares the CSS/HTML-style opening presentation for the role card, combining the opening text, visual assets, title, tags, and card surface layout.',
    inputs: {
      card: port('card', 'Card', 'asset-target', true),
      field: port('field', 'Field', 'asset-target'),
      imageAsset: port('imageAsset', 'Image Asset', 'asset-target'),
      style: port('style', 'Style', 'style-signal'),
      constraint: port('constraint', 'Constraint', 'hard-constraint'),
    },
    outputs: { layout: port('layout', 'Layout', 'asset-target') },
    parameters: [
      parameter('layoutKind', 'Layout Kind', 'select', 'auto-opening-layout', undefined, OPENING_LAYOUT_KIND_OPTIONS),
      parameter('textDensity', 'Text Density', 'select', 'minimal', undefined, OPENING_TEXT_DENSITY_OPTIONS),
      parameter('includeSections', 'Include Sections', 'multi-select', ['title', 'tags', 'opening', 'coverImage', 'supportImages'], undefined, [
        option('Title', 'title'),
        option('Tags', 'tags'),
        option('Opening', 'opening'),
        option('Cover Image', 'coverImage'),
        option('Support Images', 'supportImages'),
        option('Character Summary', 'characterSummary'),
      ]),
      parameter('layoutPrompt', 'Layout Prompt', 'textarea', ''),
    ],
  },
  {
    type: 'atmosphere-style-target',
    title: 'Atmosphere Style Target',
    category: 'targets',
    executor: 'agent',
    description: 'Declares a character-specific scoped atmosphere design system for chat bubbles, role speech, inline audio, scene cards, and profile previews.',
    inputs: {
      card: port('card', 'Card', 'asset-target', true),
      field: port('field', 'Field', 'asset-target'),
      imageAsset: port('imageAsset', 'Image Asset', 'asset-target'),
      style: port('style', 'Style', 'style-signal'),
      voice: port('voice', 'Voice', 'voice-capability'),
    },
    outputs: { atmosphere: port('atmosphere', 'Atmosphere', 'asset-target') },
    parameters: [
      parameter('moodPreset', 'Atmosphere Direction', 'textarea', ''),
      parameter('surface', 'Surface Material', 'textarea', ''),
      parameter('messageFrame', 'Message Composition', 'textarea', ''),
      parameter('audioPlayer', 'Audio Bar Design', 'textarea', ''),
      parameter('density', 'Spacing Rhythm', 'textarea', ''),
      parameter('stylePrompt', 'Design Brief', 'textarea', ''),
    ],
  },
  {
    type: 'game-system-target',
    title: 'Game System Target',
    category: 'targets',
    executor: 'agent',
    description: 'Declares a character-specific game layer for stats, independent equipment slots, equipment rules, status effects, and chat quick panels. Editing defines the rules; runtime generates concrete values.',
    inputs: {
      card: port('card', 'Card', 'asset-target', true),
      field: port('field', 'Field', 'asset-target'),
      world: port('world', 'World', 'asset-target'),
      style: port('style', 'Style', 'style-signal'),
      constraint: port('constraint', 'Constraint', 'hard-constraint'),
    },
    outputs: { gameSystem: port('gameSystem', 'Game System', 'asset-target') },
    parameters: [
      parameter('statDesign', 'Stat System Design', 'textarea', 'Split the game layer into: 1) base role fields, 2) base gameplay with complete world knowledge, 3) status fields derived from gameplay and character premise, 4) CSS/visual hooks. Design 3-6 character-specific stats that matter for this role and scenario. Avoid fixed generic labels; use adult/intimate body or desire stats only when the workflow explicitly allows adult content and the character context makes them meaningful.'),
      parameter('equipmentRules', 'Equipment Rules', 'textarea', 'Define slot logic, capacity, rarity, compatibility, prohibited items, acquisition/removal rules, and how equipment may alter stats or status.'),
      parameter('statusRules', 'Status Rules', 'textarea', 'Define temporary and persistent statuses from the character premise, relationship dynamic, body/mental state, powers, risks, and scene rules. Each status needs trigger, decay, conflict behavior, and narrative consequence.'),
      parameter('panelDesign', 'Chat Panel Design', 'textarea', 'Expose equipment, status, rules, and world facts as quick chat panels. Keep generated values compact and readable, but preserve enough world knowledge for future turns.'),
    ],
  },
  {
    type: 'resource-package-target',
    title: 'Resource Package Target',
    category: 'targets',
    executor: 'agent',
    description: 'Assembles the role card candidate and all generated target assets into one package for quality evaluation and export.',
    inputs: {
      candidate: port('candidate', 'Candidate', 'candidate-pack', true),
      field: port('field', 'Field', 'asset-target'),
      imageAsset: port('imageAsset', 'Image Asset', 'asset-target'),
      layout: port('layout', 'Layout', 'asset-target'),
      atmosphere: port('atmosphere', 'Atmosphere', 'asset-target'),
      gameSystem: port('gameSystem', 'Game System', 'asset-target'),
      world: port('world', 'World', 'asset-target'),
      continuity: port('continuity', 'Continuity', 'asset-target'),
      relationship: port('relationship', 'Relationship', 'asset-target'),
      plot: port('plot', 'Plot', 'asset-target'),
      scene: port('scene', 'Scene', 'asset-target'),
    },
    outputs: { package: port('package', 'Package', 'resource-package') },
    parameters: [
      parameter('packageScope', 'Package Scope', 'multi-select', ['role-card', 'fields', 'image-pack', 'opening-layout', 'atmosphere-style', 'game-system', 'world-context'], undefined, [
        option('Role Card', 'role-card'),
        option('Fields', 'fields'),
        option('Image Pack', 'image-pack'),
        option('Opening Layout', 'opening-layout'),
        option('Atmosphere Style', 'atmosphere-style'),
        option('Game System', 'game-system'),
        option('World Context', 'world-context'),
        option('Continuity', 'continuity'),
        option('Relationship', 'relationship'),
        option('Plot', 'plot'),
        option('Scenes', 'scenes'),
      ]),
      parameter('includeOptionalAssets', 'Include Optional Assets', 'boolean', true),
      parameter('assemblyPrompt', 'Assembly Prompt', 'textarea', 'Package every generated target into one exportable resource bundle. Preserve each asset as an independently inspectable resource instead of flattening everything into the role-card text.'),
    ],
  },
  {
    type: 'image-target',
    title: 'Image Target',
    category: 'targets',
    executor: 'image',
    description: 'Declares a role-card visual asset. Each image should preserve character identity while supporting a distinct story, field, or presentation purpose. Multi-image character-base targets should produce different visual missions, camera angles, poses, environments, and roleplay meanings.',
    inputs: {
      card: port('card', 'Card', 'asset-target'),
      image: port('image', 'Image', 'image-capability', true),
      imageControl: port('imageControl', 'Image Control', 'asset-target'),
      referenceImage: port('referenceImage', 'Reference Image', 'asset-target'),
    },
    outputs: { imageAsset: port('imageAsset', 'Image Asset', 'asset-target') },
    parameters: [
      parameter('imageRole', 'Image Role', 'select', 'character-base-image', undefined, [
        option('Avatar', 'avatar'),
        option('Character Overview Sheet', 'character-overview-sheet'),
        option('Base Character Image', 'character-base-image'),
      ]),
      parameter('assetPurpose', 'Asset Purpose', 'textarea', ''),
    ],
  },
  {
    type: 'world-card-target',
    title: 'World Card Target',
    category: 'targets',
    executor: 'agent',
    description: 'Declares an overall world resource that coordinates NPCs, scene cards, relationship network, and plot progression.',
    inputs: {
      goal: port('goal', 'Goal', 'generation-goal', true),
      style: port('style', 'Style', 'style-signal'),
      constraint: port('constraint', 'Constraint', 'hard-constraint'),
      source: port('source', 'Source', 'source-context'),
    },
    outputs: { world: port('world', 'World', 'asset-target') },
    parameters: [
      parameter('worldSections', 'World Sections', 'multi-select', ['setting', 'rules', 'factions', 'relationship-network', 'plot-hooks'], undefined, [
        option('Setting', 'setting'),
        option('Rules', 'rules'),
        option('Factions', 'factions'),
        option('Relationship Network', 'relationship-network'),
        option('Plot Hooks', 'plot-hooks'),
      ]),
    ],
  },
  {
    type: 'npc-pack-target',
    title: 'NPC Pack Target',
    category: 'targets',
    executor: 'agent',
    description: 'Declares a pack of NPC resources connected to the world card and plot arc.',
    inputs: {
      world: port('world', 'World', 'asset-target'),
      relationship: port('relationship', 'Relationship', 'asset-target'),
      style: port('style', 'Style', 'style-signal'),
      constraint: port('constraint', 'Constraint', 'hard-constraint'),
    },
    outputs: { npcPack: port('npcPack', 'NPC Pack', 'asset-target') },
    parameters: [
      parameter('npcCount', 'NPC Count', 'integer', 4, { min: 1, max: 12, step: 1 }),
      parameter('npcRoles', 'NPC Roles', 'multi-select', [], undefined, [
        option('Primary NPC', 'primary-npc'),
        option('Ally', 'ally'),
        option('Rival', 'rival'),
        option('Antagonist', 'antagonist'),
        option('Mentor', 'mentor'),
        option('Wildcard', 'wildcard'),
      ]),
    ],
  },
  {
    type: 'npc-target',
    title: 'NPC Target',
    category: 'targets',
    executor: 'agent',
    description: 'Declares a single NPC as an independently controllable target resource.',
    inputs: {
      npcPack: port('npcPack', 'NPC Pack', 'asset-target'),
      style: port('style', 'Style', 'style-signal'),
      constraint: port('constraint', 'Constraint', 'hard-constraint'),
      relationship: port('relationship', 'Relationship', 'asset-target'),
    },
    outputs: { npc: port('npc', 'NPC', 'asset-target') },
    parameters: [
      parameter('npcRole', 'NPC Role', 'select', 'primary-npc', undefined, [
        option('Primary NPC', 'primary-npc'),
        option('Ally', 'ally'),
        option('Rival', 'rival'),
        option('Antagonist', 'antagonist'),
        option('Mentor', 'mentor'),
        option('Wildcard', 'wildcard'),
      ]),
      parameter('storyFunction', 'Story Function', 'textarea', ''),
    ],
  },
  {
    type: 'plot-arc-target',
    title: 'Plot Arc Target',
    category: 'targets',
    executor: 'agent',
    description: 'Declares the long-running story progression resource for the world card.',
    inputs: {
      world: port('world', 'World', 'asset-target'),
      npcPack: port('npcPack', 'NPC Pack', 'asset-target'),
      continuity: port('continuity', 'Continuity', 'asset-target'),
      style: port('style', 'Style', 'style-signal'),
      constraint: port('constraint', 'Constraint', 'hard-constraint'),
    },
    outputs: { plot: port('plot', 'Plot', 'asset-target') },
    parameters: [
      parameter('arcShape', 'Arc Shape', 'select', 'slow-burn', undefined, [
        option('Slow Burn', 'slow-burn'),
        option('Mystery Escalation', 'mystery-escalation'),
        option('Relationship Drama', 'relationship-drama'),
        option('Adventure Campaign', 'adventure-campaign'),
      ]),
      parameter('milestoneCount', 'Milestone Count', 'integer', 6, { min: 2, max: 20, step: 1 }),
    ],
  },
  {
    type: 'scene-card-target',
    title: 'Scene Card Target',
    category: 'targets',
    executor: 'agent',
    description: 'Declares reusable scene resources for the current world and plot arc.',
    inputs: {
      world: port('world', 'World', 'asset-target'),
      plot: port('plot', 'Plot', 'asset-target'),
      style: port('style', 'Style', 'style-signal'),
      constraint: port('constraint', 'Constraint', 'hard-constraint'),
    },
    outputs: { scene: port('scene', 'Scene', 'asset-target') },
    parameters: [
      parameter('sceneCount', 'Scene Count', 'integer', 3, { min: 1, max: 12, step: 1 }),
      parameter('sceneTypes', 'Scene Types', 'multi-select', [], undefined, [
        option('Opening Scene', 'opening-scene'),
        option('Private Conversation', 'private-conversation'),
        option('Conflict Scene', 'conflict-scene'),
        option('Reveal Scene', 'reveal-scene'),
        option('Downtime Scene', 'downtime-scene'),
      ]),
    ],
  },
  {
    type: 'style-pressure',
    title: 'Style Pressure',
    category: 'taste',
    executor: 'manual',
    description: 'Applies weighted taste, genre, mood, intensity, and pacing pressure to any connected target.',
    inputs: { target: port('target', 'Target', 'asset-target') },
    outputs: { style: port('style', 'Style', 'style-signal') },
    parameters: [
      parameter('preset', 'Preset', 'select', 'custom', undefined, PROSE_STYLE_PRESET_OPTIONS),
      parameter('stylePrompt', 'Style Prompt', 'textarea', ''),
      parameter('intensity', 'Intensity', 'number', 0.68, { min: 0, max: 1, step: 0.01 }),
    ],
  },
  {
    type: 'constraint',
    title: 'Hard Constraint',
    category: 'constraints',
    executor: 'manual',
    description: 'Sets local or global hard boundaries that limit connected target generation and repair.',
    inputs: { target: port('target', 'Target', 'asset-target') },
    outputs: { constraint: port('constraint', 'Constraint', 'hard-constraint') },
    parameters: [
      parameter('mustHave', 'Must Have', 'string-list', []),
      parameter('mustNot', 'Must Not', 'string-list', []),
      parameter('hardBoundary', 'Hard Boundary', 'boolean', true),
    ],
  },
  {
    type: 'image-generation-control',
    title: 'Image Generation Control',
    category: 'controls',
    executor: 'manual',
    description: 'Controls image batch count, visual style, shot, aspect ratio, consistency, seed behavior, and per-image variation. It does not declare the target asset.',
    inputs: {},
    outputs: { imageControl: port('imageControl', 'Image Control', 'asset-target') },
    parameters: [
      parameter('targetImageCount', 'Image Count', 'integer', 1, { min: 1, max: 16, step: 1 }),
      parameter('imageStyleDomain', 'Style Domain', 'select', 'auto', undefined, [
        option('Auto', 'auto'),
        option('Photoreal', 'photoreal'),
        option('Anime', 'anime'),
        option('Illustration', 'illustration'),
        option('Stylized', 'stylized'),
      ]),
      parameter('stylePrompt', 'Style Prompt', 'textarea', ''),
      parameter('poseGoals', 'Pose Goals', 'string-list', []),
      parameter('backgroundInteraction', 'Background Interaction', 'textarea', ''),
      parameter('appealMode', 'Appeal Mode', 'select', 'sensual-confidence', undefined, [
        option('Natural', 'natural'),
        option('Romantic', 'romantic'),
        option('Sensual Confidence', 'sensual-confidence'),
        option('Erotic Tension', 'erotic-tension'),
        option('Dramatic', 'dramatic'),
        option('Mysterious', 'mysterious'),
      ]),
      parameter('sensualityLevel', 'Sensuality Level', 'select', 'sensual', undefined, [
        option('Subtle', 'subtle'),
        option('Sensual', 'sensual'),
        option('Erotic', 'erotic'),
        option('Explicit', 'explicit'),
      ]),
      parameter('wardrobeExposure', 'Wardrobe Exposure', 'select', 'stylish-revealing', undefined, [
        option('Covered', 'covered'),
        option('Stylish Revealing', 'stylish-revealing'),
        option('Lingerie / Swimwear', 'lingerie-swimwear'),
        option('Implied Nude', 'implied-nude'),
      ]),
      parameter('shotType', 'Shot Type', 'select', 'auto', undefined, [
        option('Auto', 'auto'),
        option('Close Up', 'close-up'),
        option('Bust', 'bust'),
        option('Knee Up', 'knee-up'),
        option('Full Body', 'full-body'),
        option('Wide Scene', 'wide-scene'),
      ]),
      parameter('aspectRatio', 'Aspect Ratio', 'select', '1:1', undefined, [
        option('1:1', '1:1'),
        option('2:3', '2:3'),
        option('3:4', '3:4'),
        option('4:5', '4:5'),
        option('16:9', '16:9'),
        option('9:16', '9:16'),
      ]),
      parameter('consistencyMode', 'Consistency Mode', 'select', 'same-character', undefined, [
        option('Same Character', 'same-character'),
        option('Same World', 'same-world'),
        option('Independent Images', 'independent'),
      ]),
      parameter('seedMode', 'Seed Mode', 'select', 'lock-character', undefined, [
        option('Lock Character', 'lock-character'),
        option('Vary Slightly', 'vary-slightly'),
        option('Explore', 'explore'),
      ]),
    ],
  },
  {
    type: 'continuity-control',
    title: 'Continuity Control',
    category: 'controls',
    executor: 'manual',
    description: 'Controls long-form continuity, memory anchors, unresolved hooks, and progression pacing.',
    inputs: { target: port('target', 'Target', 'asset-target') },
    outputs: { continuity: port('continuity', 'Continuity', 'asset-target') },
    parameters: [
      parameter('memoryAnchors', 'Memory Anchors', 'multi-select', [], undefined, [
        option('Relationship Changes', 'relationship-changes'),
        option('Unresolved Promises', 'unresolved-promises'),
        option('World Facts', 'world-facts'),
        option('Boundaries', 'boundaries'),
        option('Long Term Goals', 'long-term-goals'),
      ]),
      parameter('progressionPacing', 'Progression Pacing', 'select', 'slow-burn', undefined, [
        option('Slow Burn', 'slow-burn'),
        option('Steady Escalation', 'steady-escalation'),
        option('Episodic', 'episodic'),
      ]),
      parameter('forbidResettingFacts', 'Forbid Resetting Facts', 'boolean', true),
    ],
  },
  {
    type: 'relationship-control',
    title: 'Relationship Control',
    category: 'controls',
    executor: 'manual',
    description: 'Controls the relational function and tension between generated NPC, character, and user resources.',
    inputs: { target: port('target', 'Target', 'asset-target') },
    outputs: { relationship: port('relationship', 'Relationship', 'asset-target') },
    parameters: [
      parameter('relationshipMode', 'Relationship Mode', 'select', 'slow-trust', undefined, [
        option('Slow Trust', 'slow-trust'),
        option('Rival Tension', 'rival-tension'),
        option('Protective Companion', 'protective-companion'),
        option('Ambiguous Ally', 'ambiguous-ally'),
      ]),
      parameter('tensionRules', 'Tension Rules', 'multi-select', [], undefined, [
        option('Do Not Resolve Immediately', 'do-not-resolve-immediately'),
        option('Conflicting Motives', 'conflicting-motives'),
        option('Asymmetric Information', 'asymmetric-information'),
        option('Slow Trust', 'slow-trust-rule'),
      ]),
    ],
  },
  {
    type: 'source-material',
    title: 'Source Material',
    category: 'sources',
    executor: 'manual',
    description: 'Imports image and document materials as grounded references. Material kind is inferred from file type.',
    inputs: {},
    outputs: {
      source: port('source', 'Source', 'source-context'),
      imageAsset: port('imageAsset', 'Reference Image', 'asset-target'),
    },
    parameters: [
      parameter('materials', 'Materials', 'materials', []),
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
    ],
  },
  {
    type: 'image-tool',
    title: 'Image Tool',
    category: 'tools',
    executor: 'image',
    description: 'Selects image generation capability. An optional edit model is used for reference-image targets after avatar.',
    inputs: {},
    outputs: { image: port('image', 'Image', 'image-capability') },
    parameters: [
      parameter('modelRef', 'Model / Workflow', 'model-select', '', { modelKind: 'image' }),
      parameter('editModelRef', 'Edit Model / Workflow', 'model-select', '', { modelKind: 'image' }),
      parameter('identityStrength', 'Identity Strength', 'number', 0.72, { min: 0, max: 1, step: 0.01 }),
      parameter('compositionFreedom', 'Composition Freedom', 'number', 0.58, { min: 0, max: 1, step: 0.01 }),
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
      parameter('revisionBudget', 'Revision Budget', 'integer', 12, { min: 1, max: 24, step: 1 }),
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
      parameter('priorityAssets', 'Priority Assets', 'multi-select', ['role-card', 'opening', 'opening-layout', 'atmosphere-style', 'game-system', 'image-pack'], undefined, [
        option('Role Card', 'role-card'),
        option('Opening', 'opening'),
        option('Opening Layout', 'opening-layout'),
        option('Atmosphere Style', 'atmosphere-style'),
        option('Game System', 'game-system'),
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
      parameter('dimensions', 'Dimensions', 'multi-select', [], undefined, [
        option('Goal Match', 'goal-match'),
        option('Field Completeness', 'field-completeness'),
        option('Roleplay Usability', 'roleplay-usability'),
        option('Appearance Prompt', 'appearance-prompt'),
        option('Consistency', 'consistency'),
      ]),
      parameter('autoRepair', 'Auto Repair', 'boolean', true),
    ],
  },
  {
    type: 'quality-gate',
    title: 'Quality Gate',
    category: 'evaluation',
    executor: 'agent',
    description: 'Defines acceptance criteria that can block export or route the assembled resource package back for repair.',
    inputs: {
      goal: port('goal', 'Goal', 'generation-goal', true),
      package: port('package', 'Package', 'resource-package', true),
      critique: port('critique', 'Critique', 'critique-policy'),
    },
    outputs: {
      criteria: port('criteria', 'Criteria', 'quality-criteria'),
      report: port('report', 'Report', 'validation-report'),
    },
    parameters: [
      parameter('minimumScore', 'Minimum Score', 'number', 0.82, { min: 0, max: 1, step: 0.01 }),
      parameter('blockExport', 'Block Export', 'boolean', true),
      parameter('requiredChecks', 'Required Checks', 'multi-select', [], undefined, [
        option('Goal Match', 'goal-match'),
        option('Field Completeness', 'field-completeness'),
        option('Roleplay Usability', 'roleplay-usability'),
        option('Appearance Prompt', 'appearance-prompt'),
        option('Consistency', 'consistency'),
      ]),
    ],
  },
  {
    type: 'output-adapter',
    title: 'Output Adapter',
    category: 'outputs',
    executor: 'deterministic',
    description: 'Maps an accepted resource package to a target format without changing generation goals.',
    inputs: {
      package: port('package', 'Package', 'resource-package', true),
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
    node('source-material', 40, 390),
    node('style-pressure', 360, -100),
    node('character-card-target', 360, 120),
    node('constraint', 360, 360),
    node('character-field-target', 700, -20, 'character-fields', 'Character Fields'),
    node('image-target', 700, 230, 'avatar-image-target', 'Avatar Image Target'),
    node('image-generation-control', 1040, 230, 'avatar-image-control', 'Avatar Image Control'),
    node('image-target', 700, 480, 'overview-sheet-image-target', 'Overview Sheet Image Target'),
    node('image-generation-control', 1040, 480, 'overview-sheet-image-control', 'Overview Sheet Image Control'),
    node('image-target', 700, 730, 'opening-panel-image-target', 'Opening Panel Images Target'),
    node('image-generation-control', 1040, 730, 'opening-panel-image-control', 'Opening Panel Images Control'),
    node('llm-tool', 1040, -260),
    node('image-tool', 1040, 980),
    node('agent-policy', 1400, 40),
    node('opening-layout-target', 1400, 580),
    node('atmosphere-style-target', 1400, 830),
    node('game-system-target', 1400, 1080),
    node('generation-strategy', 1740, 40),
    node('critique-loop', 1740, 330),
    node('resource-package-target', 1740, 650),
    node('quality-gate', 2080, 360),
    node('output-adapter', 2420, 360),
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
  const avatarTarget = nodes.find((nodeItem) => nodeItem.id === 'avatar-image-target')
  if (avatarTarget) {
    Object.assign(avatarTarget.config, {
      imageRole: 'avatar',
      assetPurpose: 'Final avatar.jpg for the role card: one polished single-character role-card portrait with one clear face, visible body silhouette, strong appeal, and stable appearancePrompt identity.',
    })
  }
  const avatarControl = nodes.find((nodeItem) => nodeItem.id === 'avatar-image-control')
  if (avatarControl) {
    Object.assign(avatarControl.config, {
      targetImageCount: 1,
      imageStyleDomain: 'auto',
      shotType: 'knee-up',
      consistencyMode: 'same-character',
      seedMode: 'lock-character',
    })
  }
  const overviewTarget = nodes.find((nodeItem) => nodeItem.id === 'overview-sheet-image-target')
  if (overviewTarget) {
    Object.assign(overviewTarget.config, {
      imageRole: 'character-overview-sheet',
      assetPurpose: 'Large production character overview sheet using linked avatar reference inputs for identity preservation. It must show full-body front view, full-body back view, side/three-quarter view, a main portrait or half-body crop, 3 expression callouts, eye close-up, nose and mouth close-up, hairstyle detail, hand pose detail, leg shape close-up, hip/rear silhouette close-up, feet/shoes detail, and outfit fabric/accessory/hemline/silhouette details in one clean unlabeled model-sheet composition. Preserve the avatar outfit construction unless this target explicitly requests outfit variants.',
    })
  }
  const overviewControl = nodes.find((nodeItem) => nodeItem.id === 'overview-sheet-image-control')
  if (overviewControl) {
    Object.assign(overviewControl.config, {
      targetImageCount: 1,
      imageStyleDomain: 'auto',
      shotType: 'full-body',
      aspectRatio: '16:9',
      consistencyMode: 'same-character',
      seedMode: 'lock-character',
    })
  }
  const openingPanelImageTarget = nodes.find((nodeItem) => nodeItem.id === 'opening-panel-image-target')
  if (openingPanelImageTarget) {
    Object.assign(openingPanelImageTarget.config, {
      imageRole: 'character-base-image',
      assetPurpose: 'Free-form character sample images for the opening CSS panel. Generate reusable non-avatar images migrated from the avatar reference. Each image should have a different visual mission: distinct camera angle, pose family, action, environment use, outfit usage, prop interaction, mood, and roleplay meaning. Avoid repeating the same pose/background/framing with only minor expression changes.',
    })
  }
  const openingPanelImageControl = nodes.find((nodeItem) => nodeItem.id === 'opening-panel-image-control')
  if (openingPanelImageControl) {
    Object.assign(openingPanelImageControl.config, {
      targetImageCount: 2,
      imageStyleDomain: 'auto',
      poseGoals: ['variant 1: three-quarter standing or leaning view with readable outfit usage', 'variant 2: seated or reclining scene interaction with different camera angle', 'variant 3+: dynamic action, over-shoulder, side/back silhouette, close intimate crop, or environmental storytelling shot'],
      backgroundInteraction: 'Use different role-appropriate environments and objects across images: room, furniture, window light, fabric, mirror, cup, book, weapon, instrument, desk, street, bed, or other scene objects. Each image should use a different object/setting relationship to create visual and roleplay meaning.',
      appealMode: 'sensual-confidence',
      sensualityLevel: 'sensual',
      wardrobeExposure: 'stylish-revealing',
      shotType: 'auto',
      aspectRatio: '3:4',
      consistencyMode: 'same-character',
      seedMode: 'vary-slightly',
    })
  }

  return {
    id,
    name: options.name ?? 'Agentic RP Resource Graph',
    version: CURRENT_CHARACTER_WORKFLOW_VERSION,
    description: 'Configures target resources, local controls, tools, agent autonomy, evaluation gates, and output adapters for autonomous RP resource generation.',
    nodes,
    edges: connectEdges([
      ['goal', 'goal', 'character-card-target', 'goal', 'guides'],
      ['character-card-target', 'target', 'style-pressure', 'target', 'weights'],
      ['character-card-target', 'target', 'constraint', 'target', 'constrains'],
      ['source-material', 'source', 'character-card-target', 'source', 'grounds'],
      ['character-card-target', 'target', 'character-fields', 'card', 'guides'],
      ['style-pressure', 'style', 'character-fields', 'style', 'weights'],
      ['constraint', 'constraint', 'character-fields', 'constraint', 'constrains'],
      ['character-card-target', 'target', 'avatar-image-target', 'card', 'guides'],
      ['image-tool', 'image', 'avatar-image-target', 'image', 'enables'],
      ['avatar-image-control', 'imageControl', 'avatar-image-target', 'imageControl', 'guides'],
      ['character-card-target', 'target', 'overview-sheet-image-target', 'card', 'guides'],
      ['avatar-image-target', 'imageAsset', 'overview-sheet-image-target', 'referenceImage', 'provides'],
      ['image-tool', 'image', 'overview-sheet-image-target', 'image', 'enables'],
      ['overview-sheet-image-control', 'imageControl', 'overview-sheet-image-target', 'imageControl', 'guides'],
      ['character-card-target', 'target', 'opening-panel-image-target', 'card', 'guides'],
      ['avatar-image-target', 'imageAsset', 'opening-panel-image-target', 'referenceImage', 'provides'],
      ['image-tool', 'image', 'opening-panel-image-target', 'image', 'enables'],
      ['opening-panel-image-control', 'imageControl', 'opening-panel-image-target', 'imageControl', 'guides'],
      ['character-card-target', 'target', 'opening-layout-target', 'card', 'guides'],
      ['character-fields', 'field', 'opening-layout-target', 'field', 'guides'],
      ['avatar-image-target', 'imageAsset', 'opening-layout-target', 'imageAsset', 'guides'],
      ['overview-sheet-image-target', 'imageAsset', 'opening-layout-target', 'imageAsset', 'guides'],
      ['opening-panel-image-target', 'imageAsset', 'opening-layout-target', 'imageAsset', 'guides'],
      ['style-pressure', 'style', 'opening-layout-target', 'style', 'weights'],
      ['character-card-target', 'target', 'atmosphere-style-target', 'card', 'guides'],
      ['character-fields', 'field', 'atmosphere-style-target', 'field', 'guides'],
      ['avatar-image-target', 'imageAsset', 'atmosphere-style-target', 'imageAsset', 'guides'],
      ['overview-sheet-image-target', 'imageAsset', 'atmosphere-style-target', 'imageAsset', 'guides'],
      ['style-pressure', 'style', 'atmosphere-style-target', 'style', 'weights'],
      ['character-card-target', 'target', 'game-system-target', 'card', 'guides'],
      ['character-fields', 'field', 'game-system-target', 'field', 'guides'],
      ['style-pressure', 'style', 'game-system-target', 'style', 'weights'],
      ['constraint', 'constraint', 'game-system-target', 'constraint', 'constrains'],
      ['character-card-target', 'candidate', 'resource-package-target', 'candidate', 'provides'],
      ['character-fields', 'field', 'resource-package-target', 'field', 'provides'],
      ['avatar-image-target', 'imageAsset', 'resource-package-target', 'imageAsset', 'provides'],
      ['overview-sheet-image-target', 'imageAsset', 'resource-package-target', 'imageAsset', 'provides'],
      ['opening-panel-image-target', 'imageAsset', 'resource-package-target', 'imageAsset', 'provides'],
      ['opening-layout-target', 'layout', 'resource-package-target', 'layout', 'provides'],
      ['atmosphere-style-target', 'atmosphere', 'resource-package-target', 'atmosphere', 'provides'],
      ['game-system-target', 'gameSystem', 'resource-package-target', 'gameSystem', 'provides'],
      ['goal', 'goal', 'agent-policy', 'goal', 'guides'],
      ['constraint', 'constraint', 'agent-policy', 'constraint', 'constrains'],
      ['source-material', 'source', 'agent-policy', 'source', 'grounds'],
      ['llm-tool', 'model', 'agent-policy', 'model', 'enables'],
      ['agent-policy', 'policy', 'generation-strategy', 'policy', 'guides'],
      ['generation-strategy', 'strategy', 'critique-loop', 'strategy', 'routes'],
      ['critique-loop', 'critique', 'quality-gate', 'critique', 'evaluates'],
      ['resource-package-target', 'package', 'quality-gate', 'package', 'evaluates'],
      ['resource-package-target', 'package', 'output-adapter', 'package', 'exports'],
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
  return (type: CharacterNodeType, x: number, y: number, id?: string, title?: string): CharacterWorkflowNode => {
    const definition = registry.require(type)
    return {
      id: id ?? type,
      type,
      title: title ?? definition.title,
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
      defaultValue: cloneParameterDefaultValue(item.defaultValue),
      options: item.options?.map((optionItem) => ({ ...optionItem })),
    })),
  }
}

function cloneParameterDefaultValue(value: CharacterWorkflowParameterValue): CharacterWorkflowParameterValue {
  if (!Array.isArray(value)) {
    return value
  }
  return value.map((item) => {
    if (typeof item === 'string') {
      return item
    }
    if ('avoidPatterns' in item) {
      return {
        ...item,
        avoidPatterns: Array.isArray(item.avoidPatterns) ? [...item.avoidPatterns] : [],
      }
    }
    return { ...item }
  }) as CharacterWorkflowParameterValue
}

function clonePorts(ports: Record<string, CharacterNodePort>): Record<string, CharacterNodePort> {
  return Object.fromEntries(Object.entries(ports).map(([key, value]) => [key, { ...value }]))
}

function createDefaultNodeConfig(definition: CharacterWorkflowNodeDefinition): Record<string, unknown> {
  return Object.fromEntries(
    definition.parameters.map((item) => [
      item.id,
      cloneParameterDefaultValue(item.defaultValue),
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
    'character-card-target': ({ node, config, timestamp }) => [{
      id: `${node.id}-target`,
      type: 'asset-target',
      sourceNodeId: node.id,
      createdAt: timestamp,
      targets: {
        requested: ['character-card', ...stringListConfig(config.includeFields), ...stringListConfig(config.includeSupportFields)],
        includeAlternates: true,
      },
    }, {
      id: `${node.id}-candidate`,
      type: 'candidate-pack',
      sourceNodeId: node.id,
      createdAt: timestamp,
      pack: {
        title: 'Character Card Candidate',
        summary: 'Candidate assembled from target resources and local controls.',
        resources: ['character-card', ...stringListConfig(config.includeFields), ...stringListConfig(config.includeSupportFields)],
        risks: [],
      },
    }],
    'character-field-target': ({ node, config, timestamp }) => [{
      id: `${node.id}-field-target`,
      type: 'asset-target',
      sourceNodeId: node.id,
      createdAt: timestamp,
      targets: {
        requested: fieldTargetConfigFields(config).map((field) => `field:${field}`),
        includeAlternates: false,
      },
    }],
    'opening-layout-target': ({ node, config, timestamp }) => [{
      id: `${node.id}-layout-target`,
      type: 'asset-target',
      sourceNodeId: node.id,
      createdAt: timestamp,
      targets: {
        requested: ['opening-layout', ...stringListConfig(config.includeSections)],
        includeAlternates: false,
      },
    }],
    'atmosphere-style-target': ({ node, config, timestamp }) => [{
      id: `${node.id}-atmosphere-target`,
      type: 'asset-target',
      sourceNodeId: node.id,
      createdAt: timestamp,
      targets: {
        requested: [
          'atmosphere-style',
          `design:${stringConfig(config.stylePrompt, '')}`,
          `atmosphere:${stringConfig(config.moodPreset, '')}`,
          `surface:${stringConfig(config.surface, '')}`,
          `message:${stringConfig(config.messageFrame, '')}`,
          `audio:${stringConfig(config.audioPlayer, '')}`,
          `spacing:${stringConfig(config.density, '')}`,
        ].filter((item) => !item.endsWith(':')),
        includeAlternates: false,
      },
    }],
    'game-system-target': ({ node, config, timestamp }) => [{
      id: `${node.id}-game-system-target`,
      type: 'asset-target',
      sourceNodeId: node.id,
      createdAt: timestamp,
      targets: {
        requested: [
          'game-system',
          `stats:${stringConfig(config.statDesign, '')}`,
          `equipment:${stringConfig(config.equipmentRules, '')}`,
          `status:${stringConfig(config.statusRules, '')}`,
          `panels:${stringConfig(config.panelDesign, '')}`,
        ].filter((item) => !item.endsWith(':')),
        includeAlternates: false,
      },
    }],
    'resource-package-target': ({ node, config, inputArtifacts, timestamp }) => {
      const candidate = inputArtifacts.find((artifact): artifact is CandidatePackArtifact => artifact.type === 'candidate-pack')
      const assetTargets = inputArtifacts.filter((artifact): artifact is AssetTargetArtifact => artifact.type === 'asset-target')
      const scope = stringListConfig(config.packageScope, ['role-card', 'fields', 'image-pack', 'opening-layout', 'atmosphere-style', 'game-system'])
      const requestedResources = [
        ...(candidate?.pack.resources ?? []),
        ...assetTargets.flatMap((artifact) => artifact.targets.requested),
      ].map((item) => item.trim()).filter(Boolean)
      const resources = mergeStringValues([...scope, ...requestedResources])
      const missing = scope.filter((item) => !packageScopeCovered(item, resources))
      return [{
        id: `${node.id}-package`,
        type: 'resource-package',
        sourceNodeId: node.id,
        createdAt: timestamp,
        package: {
          title: 'Character Resource Package',
          summary: stringConfig(config.assemblyPrompt, 'Assembled character resource package.'),
          resources,
          coverage: scope.filter((item) => !missing.includes(item)),
          missing,
        },
      }]
    },
    'image-target': ({ node, config, timestamp }) => [{
      id: `${node.id}-image-target`,
      type: 'asset-target',
      sourceNodeId: node.id,
      createdAt: timestamp,
      targets: {
        requested: [`image:${requireStringConfig(config.imageRole, `${node.id}.imageRole`)}`],
        includeAlternates: true,
      },
    }],
    'world-card-target': ({ node, config, timestamp }) => [{
      id: `${node.id}-world-target`,
      type: 'asset-target',
      sourceNodeId: node.id,
      createdAt: timestamp,
      targets: {
        requested: ['world-card', ...stringListConfig(config.worldSections)],
        includeAlternates: true,
      },
    }],
    'npc-pack-target': ({ node, config, timestamp }) => [{
      id: `${node.id}-npc-pack-target`,
      type: 'asset-target',
      sourceNodeId: node.id,
      createdAt: timestamp,
      targets: {
        requested: ['npc-pack', ...stringListConfig(config.npcRoles)],
        includeAlternates: true,
      },
    }],
    'npc-target': ({ node, config, timestamp }) => [{
      id: `${node.id}-npc-target`,
      type: 'asset-target',
      sourceNodeId: node.id,
      createdAt: timestamp,
      targets: {
        requested: [`npc:${stringConfig(config.npcRole, 'npc')}`],
        includeAlternates: true,
      },
    }],
    'plot-arc-target': ({ node, config, timestamp }) => [{
      id: `${node.id}-plot-target`,
      type: 'asset-target',
      sourceNodeId: node.id,
      createdAt: timestamp,
      targets: {
        requested: [`plot-arc:${stringConfig(config.arcShape, 'slow-burn')}`],
        includeAlternates: true,
      },
    }],
    'scene-card-target': ({ node, config, timestamp }) => [{
      id: `${node.id}-scene-target`,
      type: 'asset-target',
      sourceNodeId: node.id,
      createdAt: timestamp,
      targets: {
        requested: ['scene-card', ...stringListConfig(config.sceneTypes)],
        includeAlternates: true,
      },
    }],
    'image-generation-control': ({ node, config, timestamp }) => [{
      id: `${node.id}-image-control`,
      type: 'asset-target',
      sourceNodeId: node.id,
      createdAt: timestamp,
      targets: {
        requested: ['image-control'],
        includeAlternates: true,
      },
    }],
    'continuity-control': ({ node, timestamp }) => [{
      id: `${node.id}-continuity-control`,
      type: 'asset-target',
      sourceNodeId: node.id,
      createdAt: timestamp,
      targets: {
        requested: ['continuity-control'],
        includeAlternates: false,
      },
    }],
    'relationship-control': ({ node, timestamp }) => [{
      id: `${node.id}-relationship-control`,
      type: 'asset-target',
      sourceNodeId: node.id,
      createdAt: timestamp,
      targets: {
        requested: ['relationship-control'],
        includeAlternates: false,
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
        kind: inferSourceMaterialKind(config.materials),
        notes: stringConfig(config.notes, ''),
        groundingStrength: numberConfig(config.groundingStrength, 0.5),
        materials: materialListConfig(config.materials),
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
        editModelRef: stringConfig(config.editModelRef, ''),
        editModelName: parseModelRef(stringConfig(config.editModelRef, '')).modelName,
        referenceStrength: numberConfig(config.identityStrength, numberConfig(config.referenceStrength, 0.55)),
        compositionFreedom: numberConfig(config.compositionFreedom, 0.58),
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
        revisionBudget: numberConfig(config.revisionBudget, 12),
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
    'quality-gate': ({ node, config, inputArtifacts, timestamp }) => {
      const resourcePackage = inputArtifacts.find((artifact): artifact is ResourcePackageArtifact => artifact.type === 'resource-package')
      const missing = resourcePackage?.package.missing ?? []
      const score = resourcePackage ? (missing.length ? 0.74 : 0.9) : 0.2
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
          issues: resourcePackage
            ? missing.map((item) => ({ severity: 'warning' as const, path: `package.${item}`, message: `Resource package is missing ${item}.` }))
            : [{ severity: 'error', path: 'package', message: 'Resource package is missing.' }],
          repairTargets: resourcePackage ? missing : ['resource-package-target'],
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

function fieldTargetConfigFields(config: Record<string, unknown>): string[] {
  const values = Array.isArray(config.fields)
    ? config.fields.map((item) => String(item).trim()).filter(Boolean)
    : []
  return values.length ? values : DEFAULT_CHARACTER_FIELD_TARGET_FIELDS
}

function requireStringConfig(value: unknown, path: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }
  throw new Error(`Missing required workflow config: ${path}`)
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

function mergeStringValues(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))]
}

function packageScopeCovered(scope: string, resources: string[]): boolean {
  if (resources.includes(scope)) {
    return true
  }
  if (scope === 'fields') {
    return resources.some((item) => item.startsWith('field:'))
  }
  if (scope === 'image-pack') {
    return resources.some((item) => item.startsWith('image:') || item === 'image-control')
  }
  if (scope === 'world-context') {
    return resources.some((item) => item === 'world-card' || item === 'scene-card' || item.startsWith('plot-arc:'))
  }
  if (scope === 'continuity') {
    return resources.includes('continuity-control')
  }
  if (scope === 'relationship') {
    return resources.includes('relationship-control')
  }
  if (scope === 'plot') {
    return resources.some((item) => item.startsWith('plot-arc:'))
  }
  if (scope === 'scenes') {
    return resources.includes('scene-card')
  }
  return false
}

function materialListConfig(value: unknown): SourceMaterialItem[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item, index): SourceMaterialItem[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return []
    }
    const record = item as Record<string, unknown>
    const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : `material-${index + 1}`
    const mimeType = typeof record.mimeType === 'string' ? record.mimeType : ''
    const kind = inferMaterialItemKind(record.kind, mimeType, name)
    const material: SourceMaterialItem = {
      id: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `material-${index + 1}`,
      kind,
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
  const materials = materialListConfig(value)
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

function inferMaterialItemKind(value: unknown, mimeType: string, name: string): SourceMaterialItem['kind'] {
  if (value === 'image' || value === 'document') {
    return value
  }
  if (mimeType.startsWith('image/')) {
    return 'image'
  }
  return /\.(png|jpe?g|webp|gif)$/i.test(name) ? 'image' : 'document'
}

function numberConfig(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback
}

function booleanConfig(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}
