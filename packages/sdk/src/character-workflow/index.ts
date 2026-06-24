/**
 * Defines the agentic RP resource graph, run session, and artifact contracts.
 */
export * from './agent-runtime.js'
export * from './chat-agent-tools.js'
export * from './run-draft-editor.js'
export * from './workflow-builder.js'

export type CharacterWorkflowLanguage = 'zh-CN' | 'en-US'

export type CharacterNodeType =
  | 'goal'
  | 'character-card-target'
  | 'character-field-target'
  | 'opening-layout-target'
  | 'image-target'
  | 'world-card-target'
  | 'npc-pack-target'
  | 'npc-target'
  | 'plot-arc-target'
  | 'scene-card-target'
  | 'style-pressure'
  | 'constraint'
  | 'image-generation-control'
  | 'field-generation-control'
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

const IMAGE_STYLE_PRESET_OPTIONS: CharacterWorkflowParameterOption[] = [
  option('Photoreal Portrait', 'photoreal-portrait'),
  option('Cinematic Realism', 'cinematic-realism'),
  option('Editorial Photography', 'editorial-photography'),
  option('High Fashion Editorial', 'high-fashion-editorial'),
  option('Magazine Cover Gloss', 'magazine-cover-gloss'),
  option('Analog Film', 'analog-film'),
  option('35mm Film Still', '35mm-film-still'),
  option('Polaroid', 'polaroid'),
  option('Disposable Camera', 'disposable-camera'),
  option('Lomography', 'lomography'),
  option('Film Noir', 'film-noir'),
  option('Dreamy Soft Focus', 'dreamy-soft-focus'),
  option('Bokeh Portrait', 'bokeh-portrait'),
  option('Wet Plate Photo', 'wet-plate-photo'),
  option('Infrared Photo', 'infrared-photo'),
  option('Greasy Glossy Aesthetic', 'greasy-glossy-aesthetic'),
  option('Oily Skin Glow', 'oily-skin-glow'),
  option('Dewy Beauty Lighting', 'dewy-beauty-lighting'),
  option('Plastic Gloss', 'plastic-gloss'),
  option('Latex Shine', 'latex-shine'),
  option('Oil Painting', 'oil-painting'),
  option('Impasto Oil Painting', 'impasto-oil-painting'),
  option('Classical Portrait Painting', 'classical-portrait-painting'),
  option('Renaissance Painting', 'renaissance-painting'),
  option('Baroque Painting', 'baroque-painting'),
  option('Rococo Painting', 'rococo-painting'),
  option('Neoclassical Painting', 'neoclassical-painting'),
  option('Romanticism Painting', 'romanticism-painting'),
  option('Realist Painting', 'realist-painting'),
  option('Impressionist Painting', 'impressionist-painting'),
  option('Post Impressionist Painting', 'post-impressionist-painting'),
  option('Expressionist Painting', 'expressionist-painting'),
  option('Fauvism Painting', 'fauvism-painting'),
  option('Cubist Painting', 'cubist-painting'),
  option('Surrealist Painting', 'surrealist-painting'),
  option('Symbolist Painting', 'symbolist-painting'),
  option('Abstract Expressionism', 'abstract-expressionism'),
  option('Pop Art', 'pop-art'),
  option('Op Art', 'op-art'),
  option('Minimalist Art', 'minimalist-art'),
  option('Art Nouveau', 'art-nouveau'),
  option('Art Deco', 'art-deco'),
  option('Bauhaus Poster', 'bauhaus-poster'),
  option('Constructivist Poster', 'constructivist-poster'),
  option('Suprematist Abstraction', 'suprematist-abstraction'),
  option('Watercolor', 'watercolor'),
  option('Loose Watercolor', 'loose-watercolor'),
  option('Gouache', 'gouache'),
  option('Acrylic Painting', 'acrylic-painting'),
  option('Pastel Drawing', 'pastel-drawing'),
  option('Charcoal Drawing', 'charcoal-drawing'),
  option('Graphite Sketch', 'graphite-sketch'),
  option('Colored Pencil', 'colored-pencil'),
  option('Ink Drawing', 'ink-drawing'),
  option('Ink Wash', 'ink-wash'),
  option('Sumi-e', 'sumi-e'),
  option('Ukiyo-e', 'ukiyo-e'),
  option('Woodblock Print', 'woodblock-print'),
  option('Linocut Print', 'linocut-print'),
  option('Etching', 'etching'),
  option('Lithograph', 'lithograph'),
  option('Risograph Print', 'risograph-print'),
  option('Screen Print', 'screen-print'),
  option('Collage', 'collage'),
  option('Mixed Media', 'mixed-media'),
  option('Digital Painting', 'digital-painting'),
  option('Concept Art', 'concept-art'),
  option('Matte Painting', 'matte-painting'),
  option('Splash Art', 'splash-art'),
  option('Trading Card Art', 'trading-card-art'),
  option('Character Sheet', 'character-sheet'),
  option('Model Sheet', 'model-sheet'),
  option('Turnaround Reference', 'turnaround-reference'),
  option('Anime Key Visual', 'anime-key-visual'),
  option('Anime Screenshot', 'anime-screenshot'),
  option('Cel Shaded Anime', 'cel-shaded-anime'),
  option('Semi Realistic Anime', 'semi-realistic-anime'),
  option('90s Anime', '90s-anime'),
  option('Retro Anime', 'retro-anime'),
  option('Shoujo Manga', 'shoujo-manga'),
  option('Shonen Manga', 'shonen-manga'),
  option('Seinen Manga', 'seinen-manga'),
  option('Josei Manga', 'josei-manga'),
  option('Chibi', 'chibi'),
  option('Moe', 'moe'),
  option('Mecha Anime', 'mecha-anime'),
  option('Magical Girl', 'magical-girl'),
  option('Cyberpunk Anime', 'cyberpunk-anime'),
  option('Game CG', 'game-cg'),
  option('Visual Novel CG', 'visual-novel-cg'),
  option('Light Novel Cover', 'light-novel-cover'),
  option('Manga Screentone', 'manga-screentone'),
  option('Webtoon', 'webtoon'),
  option('Manhwa', 'manhwa'),
  option('Comic Book', 'comic-book'),
  option('Graphic Novel', 'graphic-novel'),
  option('Noir Comic', 'noir-comic'),
  option('Pulp Comic', 'pulp-comic'),
  option('Ligne Claire', 'ligne-claire'),
  option('Children Book Illustration', 'children-book-illustration'),
  option('Sticker Art', 'sticker-art'),
  option('Emoji Style', 'emoji-style'),
  option('Tattoo Flash', 'tattoo-flash'),
  option('Flat Vector', 'flat-vector'),
  option('Isometric Illustration', 'isometric-illustration'),
  option('Low Poly 3D', 'low-poly-3d'),
  option('Voxel Art', 'voxel-art'),
  option('Pixel Art', 'pixel-art'),
  option('8 Bit Pixel Art', '8-bit-pixel-art'),
  option('16 Bit Pixel Art', '16-bit-pixel-art'),
  option('PS1 Low Poly', 'ps1-low-poly'),
  option('Clay Render', 'clay-render'),
  option('Claymation', 'claymation'),
  option('Stop Motion', 'stop-motion'),
  option('Toy Photography', 'toy-photography'),
  option('Vinyl Figure', 'vinyl-figure'),
  option('3D Animated Film', '3d-animated-film'),
  option('Path Traced 3D', 'path-traced-3d'),
  option('Product Render', 'product-render'),
  option('Architectural Visualization', 'architectural-visualization'),
  option('Technical Illustration', 'technical-illustration'),
  option('Blueprint Drawing', 'blueprint-drawing'),
  option('Cyberpunk', 'cyberpunk'),
  option('Solarpunk', 'solarpunk'),
  option('Steampunk', 'steampunk'),
  option('Dieselpunk', 'dieselpunk'),
  option('Biopunk', 'biopunk'),
  option('Retrofuturism', 'retrofuturism'),
  option('Cassette Futurism', 'cassette-futurism'),
  option('Y2K Aesthetic', 'y2k-aesthetic'),
  option('Frutiger Aero', 'frutiger-aero'),
  option('Vaporwave', 'vaporwave'),
  option('Synthwave', 'synthwave'),
  option('Outrun', 'outrun'),
  option('Psychedelic Poster', 'psychedelic-poster'),
  option('Blacklight Poster', 'blacklight-poster'),
  option('Acid Graphics', 'acid-graphics'),
  option('Brutalist Graphic Design', 'brutalist-graphic-design'),
  option('Swiss Poster', 'swiss-poster'),
  option('Vintage Travel Poster', 'vintage-travel-poster'),
  option('Propaganda Poster', 'propaganda-poster'),
  option('Dark Fantasy', 'dark-fantasy'),
  option('High Fantasy', 'high-fantasy'),
  option('Gothic Horror', 'gothic-horror'),
  option('Cosmic Horror', 'cosmic-horror'),
  option('Occult Illustration', 'occult-illustration'),
  option('Kawaii Pastel', 'kawaii-pastel'),
  option('Harajuku Street Style', 'harajuku-street-style'),
  option('Fairycore', 'fairycore'),
  option('Cottagecore', 'cottagecore'),
  option('Dreamcore', 'dreamcore'),
  option('Weirdcore', 'weirdcore'),
  option('Liminal Space', 'liminal-space'),
  option('Grunge Poster', 'grunge-poster'),
  option('Punk Zine', 'punk-zine'),
  option('Metal Album Cover', 'metal-album-cover'),
]

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
      parameter('includeFields', 'Include Fields', 'multi-select', ['name', 'description', 'appearance', 'personality', 'background', 'scenario', 'firstMessage', 'dialogueStyle', 'worldContext'], undefined, [
        option('Name', 'name'),
        option('Description', 'description'),
        option('Appearance', 'appearance'),
        option('Personality', 'personality'),
        option('Background', 'background'),
        option('Scenario', 'scenario'),
        option('First Message', 'firstMessage'),
        option('Dialogue Style', 'dialogueStyle'),
        option('World Context', 'worldContext'),
      ]),
      parameter('includeSupportFields', 'Include Support Fields', 'multi-select', ['visualIdentity', 'imagePrompt'], undefined, [
        option('Visual Identity', 'visualIdentity'),
        option('Image Prompt', 'imagePrompt'),
      ]),
    ],
  },
  {
    type: 'character-field-target',
    title: 'Character Field Target',
    category: 'targets',
    executor: 'agent',
    description: 'Declares a single character-card field as an independently controllable target resource.',
    inputs: {
      card: port('card', 'Card', 'asset-target'),
      style: port('style', 'Style', 'style-signal'),
      constraint: port('constraint', 'Constraint', 'hard-constraint'),
      fieldControl: port('fieldControl', 'Field Control', 'asset-target'),
    },
    outputs: { field: port('field', 'Field', 'asset-target') },
    parameters: [
      parameter('field', 'Field', 'select', 'firstMessage', undefined, [
        option('Name', 'name'),
        option('Description', 'description'),
        option('Appearance', 'appearance'),
        option('Personality', 'personality'),
        option('Background', 'background'),
        option('Scenario', 'scenario'),
        option('First Message', 'firstMessage'),
        option('Dialogue Style', 'dialogueStyle'),
        option('World Context', 'worldContext'),
        option('Image Prompt', 'imagePrompt'),
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
      parameter('layoutKind', 'Layout Kind', 'select', 'immersive-card-css', undefined, [
        option('Immersive Card CSS', 'immersive-card-css'),
        option('Forum Post Card', 'forum-post-card'),
        option('Mobile Chat Intro', 'mobile-chat-intro'),
        option('SillyTavern Description Block', 'sillytavern-description-block'),
      ]),
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
    type: 'image-target',
    title: 'Image Target',
    category: 'targets',
    executor: 'image',
    description: 'Declares a role-card visual asset. Each image should preserve character identity while supporting a distinct story, field, or presentation purpose.',
    inputs: {
      card: port('card', 'Card', 'asset-target'),
      image: port('image', 'Image', 'image-capability', true),
      imageControl: port('imageControl', 'Image Control', 'asset-target'),
    },
    outputs: { imageAsset: port('imageAsset', 'Image Asset', 'asset-target') },
    parameters: [
      parameter('imageRole', 'Image Role', 'select', 'hero-cover', undefined, [
        option('Avatar', 'avatar'),
        option('Character Overview Sheet', 'character-overview-sheet'),
        option('Hero Cover', 'hero-cover'),
        option('Full Body', 'full-body'),
        option('Opening Moment', 'opening-moment'),
        option('Story Moment', 'story-moment'),
        option('Expression', 'expression'),
        option('Outfit Detail', 'outfit-detail'),
        option('Relationship Moment', 'relationship-moment'),
        option('World Context', 'world-context'),
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
    description: 'Controls image batch count, lightweight visual style, shot, aspect ratio, consistency, seed behavior, and negative prompt. It does not declare the target asset.',
    inputs: {},
    outputs: { imageControl: port('imageControl', 'Image Control', 'asset-target') },
    parameters: [
      parameter('targetImageCount', 'Image Count', 'integer', 1, { min: 1, max: 16, step: 1 }),
      parameter('imageStylePreset', 'Style Preset', 'select', 'semi-realistic-anime', IMAGE_STYLE_PRESET_OPTIONS),
      parameter('stylePrompt', 'Style Prompt', 'textarea', ''),
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
      parameter('negativePrompt', 'Negative Prompt', 'textarea', ''),
    ],
  },
  {
    type: 'field-generation-control',
    title: 'Field Generation Control',
    category: 'controls',
    executor: 'manual',
    description: 'Controls how a connected field target should be generated without containing final field content.',
    inputs: { fieldTarget: port('fieldTarget', 'Field Target', 'asset-target') },
    outputs: { fieldControl: port('fieldControl', 'Field Control', 'asset-target') },
    parameters: [
      parameter('fieldPurpose', 'Field Purpose', 'textarea', ''),
      parameter('tone', 'Tone', 'select', 'neutral', undefined, [
        option('Neutral', 'neutral'),
        option('Warm', 'warm'),
        option('Restrained', 'restrained'),
        option('Sharp', 'sharp'),
        option('Dramatic', 'dramatic'),
      ]),
      parameter('lengthPolicy', 'Length Policy', 'select', 'medium', undefined, [
        option('Short', 'short'),
        option('Medium', 'medium'),
        option('Long', 'long'),
      ]),
      parameter('avoidPatterns', 'Avoid Patterns', 'multi-select', [], undefined, [
        option('Self Introduction', 'self-introduction'),
        option('Lore Dump', 'lore-dump'),
        option('Asking User Intent', 'asking-user-intent'),
        option('OOC Explanation', 'ooc-explanation'),
        option('Instant Compliance', 'instant-compliance'),
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
    description: 'Selects image generation or editing capability. Image targets declare asset roles; image-generation-control nodes tune execution parameters.',
    inputs: {},
    outputs: { image: port('image', 'Image', 'image-capability') },
    parameters: [
      parameter('modelRef', 'Model / Workflow', 'model-select', '', { modelKind: 'image' }),
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
      parameter('priorityAssets', 'Priority Assets', 'multi-select', ['role-card', 'opening', 'opening-layout', 'image-pack'], undefined, [
        option('Role Card', 'role-card'),
        option('Opening', 'opening'),
        option('Opening Layout', 'opening-layout'),
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
        option('Visual Identity', 'visual-identity'),
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
      parameter('requiredChecks', 'Required Checks', 'multi-select', [], undefined, [
        option('Goal Match', 'goal-match'),
        option('Field Completeness', 'field-completeness'),
        option('Roleplay Usability', 'roleplay-usability'),
        option('Visual Identity', 'visual-identity'),
        option('Consistency', 'consistency'),
      ]),
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
    node('goal', 40, 150),
    node('character-card-target', 360, 140),
    node('character-field-target', 690, 30),
    node('field-generation-control', 690, 230),
    node('image-target', 690, 400, 'avatar-image-target', 'Avatar Image Target'),
    node('image-generation-control', 1010, 360, 'avatar-image-control', 'Avatar Image Control'),
    node('image-target', 690, 600, 'overview-sheet-image-target', 'Overview Sheet Image Target'),
    node('image-generation-control', 1010, 580, 'overview-sheet-image-control', 'Overview Sheet Image Control'),
    node('opening-layout-target', 1010, 640),
    node('style-pressure', 360, -70),
    node('constraint', 360, 360),
    node('source-material', 40, 410),
    node('llm-tool', 1010, 30),
    node('image-tool', 1010, 230),
    node('agent-policy', 1340, 70),
    node('generation-strategy', 1660, 70),
    node('critique-loop', 1660, 340),
    node('quality-gate', 1980, 180),
    node('output-adapter', 2300, 180),
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
      assetPurpose: 'Identity-lock avatar.jpg: the first generated canonical portrait for the character. It must be high quality, face-forward, visually appealing, and reusable as the reference image for every later character asset.',
    })
  }
  const avatarControl = nodes.find((nodeItem) => nodeItem.id === 'avatar-image-control')
  if (avatarControl) {
    Object.assign(avatarControl.config, {
      targetImageCount: 1,
      imageStylePreset: 'semi-realistic-anime',
      shotType: 'bust',
      aspectRatio: '1:1',
      consistencyMode: 'same-character',
      seedMode: 'lock-character',
    })
  }
  const overviewTarget = nodes.find((nodeItem) => nodeItem.id === 'overview-sheet-image-target')
  if (overviewTarget) {
    Object.assign(overviewTarget.config, {
      imageRole: 'character-overview-sheet',
      assetPurpose: 'Large character asset overview sheet generated after avatar.jpg. It should use the avatar as identity reference and show front view, back view, side/three-quarter view, hairstyle, hands, legs, feet/shoes, outfit/material details, and expression callouts in one clean unlabeled model-sheet style composition.',
    })
  }
  const overviewControl = nodes.find((nodeItem) => nodeItem.id === 'overview-sheet-image-control')
  if (overviewControl) {
    Object.assign(overviewControl.config, {
      targetImageCount: 1,
      imageStylePreset: 'character-sheet',
      shotType: 'full-body',
      aspectRatio: '16:9',
      consistencyMode: 'same-character',
      seedMode: 'lock-character',
      negativePrompt: 'text, labels, watermark, logo, distorted face, inconsistent face, deformed hands, extra fingers, missing fingers, bad feet, malformed legs, duplicate limbs',
    })
  }

  return {
    id,
    name: options.name ?? 'Agentic RP Resource Graph',
    version: '2.0',
    description: 'Configures target resources, local controls, tools, agent autonomy, evaluation gates, and output adapters for autonomous RP resource generation.',
    nodes,
    edges: connectEdges([
      ['goal', 'goal', 'character-card-target', 'goal', 'guides'],
      ['character-card-target', 'target', 'style-pressure', 'target', 'weights'],
      ['character-card-target', 'target', 'constraint', 'target', 'constrains'],
      ['source-material', 'source', 'character-card-target', 'source', 'grounds'],
      ['character-card-target', 'target', 'character-field-target', 'card', 'guides'],
      ['character-field-target', 'field', 'field-generation-control', 'fieldTarget', 'guides'],
      ['field-generation-control', 'fieldControl', 'character-field-target', 'fieldControl', 'guides'],
      ['style-pressure', 'style', 'character-field-target', 'style', 'weights'],
      ['constraint', 'constraint', 'character-field-target', 'constraint', 'constrains'],
      ['character-card-target', 'target', 'avatar-image-target', 'card', 'guides'],
      ['image-tool', 'image', 'avatar-image-target', 'image', 'enables'],
      ['avatar-image-control', 'imageControl', 'avatar-image-target', 'imageControl', 'guides'],
      ['character-card-target', 'target', 'overview-sheet-image-target', 'card', 'guides'],
      ['image-tool', 'image', 'overview-sheet-image-target', 'image', 'enables'],
      ['overview-sheet-image-control', 'imageControl', 'overview-sheet-image-target', 'imageControl', 'guides'],
      ['character-card-target', 'target', 'opening-layout-target', 'card', 'guides'],
      ['character-field-target', 'field', 'opening-layout-target', 'field', 'guides'],
      ['avatar-image-target', 'imageAsset', 'opening-layout-target', 'imageAsset', 'guides'],
      ['overview-sheet-image-target', 'imageAsset', 'opening-layout-target', 'imageAsset', 'guides'],
      ['style-pressure', 'style', 'opening-layout-target', 'style', 'weights'],
      ['goal', 'goal', 'agent-policy', 'goal', 'guides'],
      ['constraint', 'constraint', 'agent-policy', 'constraint', 'constrains'],
      ['source-material', 'source', 'agent-policy', 'source', 'grounds'],
      ['llm-tool', 'model', 'agent-policy', 'model', 'enables'],
      ['agent-policy', 'policy', 'generation-strategy', 'policy', 'guides'],
      ['generation-strategy', 'strategy', 'critique-loop', 'strategy', 'routes'],
      ['critique-loop', 'critique', 'quality-gate', 'critique', 'evaluates'],
      ['character-card-target', 'candidate', 'quality-gate', 'candidate', 'evaluates'],
      ['character-card-target', 'candidate', 'output-adapter', 'candidate', 'exports'],
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
        requested: [`field:${stringConfig(config.field, 'firstMessage')}`],
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
    'field-generation-control': ({ node, timestamp }) => [{
      id: `${node.id}-field-control`,
      type: 'asset-target',
      sourceNodeId: node.id,
      createdAt: timestamp,
      targets: {
        requested: ['field-control'],
        includeAlternates: false,
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
          repairTargets: hasCandidate ? [] : ['character-card-target'],
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

function numberConfig(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback
}

function booleanConfig(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}
