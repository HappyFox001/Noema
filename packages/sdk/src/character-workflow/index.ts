/**
 * Defines the character card workflow graph, run session, and artifact contracts.
 */
export type CharacterWorkflowLanguage = 'zh-CN' | 'en-US'

export type CharacterNodeType =
  | 'brief-input'
  | 'reference-input'
  | 'concept-generator'
  | 'persona-generator'
  | 'dialogue-generator'
  | 'game-profile-generator'
  | 'visual-spec-generator'
  | 'image-prompt-composer'
  | 'portrait-generator'
  | 'expression-pack-generator'
  | 'outfit-generator'
  | 'scene-reference-generator'
  | 'schema-validator'
  | 'consistency-critic'
  | 'safety-rights-check'
  | 'character-pack-exporter'

export type CharacterNodeStatus = 'idle' | 'queued' | 'running' | 'done' | 'failed' | 'skipped' | 'stale'

export type WorkflowRunStatus = 'idle' | 'running' | 'paused' | 'done' | 'failed' | 'canceled'

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
  llmApiId?: string
  llmModelName?: string
  imageApiId?: string
  imageModelName?: string
  language: CharacterWorkflowLanguage
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

export type CharacterWorkflowNodeCategory = 'input' | 'llm' | 'image' | 'validation' | 'export'

export type CharacterWorkflowExecutorKind = 'manual' | 'llm' | 'image' | 'deterministic'

export type CharacterWorkflowParameterType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'select'
  | 'multi-select'
  | 'string-list'

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
}

export type CharacterWorkflowParameterValue =
  | string
  | number
  | boolean
  | string[]

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
}

export interface CharacterWorkflowEndpoint {
  nodeId: string
  port: string
}

export type CharacterArtifactType =
  | 'character-brief'
  | 'reference'
  | 'character-card'
  | 'visual-spec'
  | 'image-prompt'
  | 'image-asset'
  | 'game-profile'
  | 'validation-report'
  | 'character-pack'

export type CharacterArtifact =
  | CharacterBriefArtifact
  | ReferenceArtifact
  | CharacterCardArtifact
  | VisualSpecArtifact
  | ImagePromptArtifact
  | ImageAssetArtifact
  | GameProfileArtifact
  | ValidationReportArtifact
  | CharacterPackArtifact

export interface CharacterArtifactBase {
  id: string
  type: CharacterArtifactType
  sourceNodeId: string
  createdAt: number
}

export interface CharacterBriefArtifact extends CharacterArtifactBase {
  type: 'character-brief'
  brief: {
    characterType: string
    world: string
    personalityKeywords: string[]
    visualDirection: string
    interactionGoal: string
    forbiddenContent: string[]
  }
}

export interface ReferenceArtifact extends CharacterArtifactBase {
  type: 'reference'
  references: Array<{
    kind: 'text' | 'image'
    title: string
    content: string
    path?: string
  }>
}

export interface CharacterCardArtifact extends CharacterArtifactBase {
  type: 'character-card'
  card: CharacterCard
}

export interface VisualSpecArtifact extends CharacterArtifactBase {
  type: 'visual-spec'
  spec: CharacterVisualSpec
}

export interface ImagePromptArtifact extends CharacterArtifactBase {
  type: 'image-prompt'
  prompts: CharacterImagePrompt[]
}

export interface ImageAssetArtifact extends CharacterArtifactBase {
  type: 'image-asset'
  assets: CharacterImageAsset[]
}

export interface GameProfileArtifact extends CharacterArtifactBase {
  type: 'game-profile'
  game: CharacterCard['game']
}

export interface ValidationReportArtifact extends CharacterArtifactBase {
  type: 'validation-report'
  report: {
    passed: boolean
    issues: CharacterValidationIssue[]
  }
}

export interface CharacterPackArtifact extends CharacterArtifactBase {
  type: 'character-pack'
  pack: {
    path: string
    manifestPath: string
    cardPath: string
    assetPaths: string[]
  }
}

export interface CharacterCard {
  schemaVersion: '1.0'
  id: string
  identity: {
    name: string
    displayName: string
    ageBand?: string
    gender?: string
    species?: string
    role: string
    tags: string[]
  }
  world: {
    genre: string
    setting: string
    era?: string
    location?: string
    rules?: string[]
  }
  persona: {
    summary: string
    traits: string[]
    values: string[]
    flaws: string[]
    goals: string[]
    secrets?: string[]
    boundaries: string[]
  }
  dialogue: {
    language: CharacterWorkflowLanguage | 'mixed'
    style: string
    firstMessage: string
    userAddressing: string
    examples: Array<{ user: string; assistant: string }>
  }
  visual: CharacterVisualSpec
  game: {
    stats: GameStat[]
    skills: GameSkill[]
    inventory: GameItem[]
    relationshipRules: string[]
    sceneHooks: string[]
  }
  generation: {
    promptBase: string
    negativePrompt: string
    referenceAssets: string[]
    preferredAspectRatios: string[]
  }
}

export interface CharacterVisualSpec {
  artStyle: string
  appearance: string
  hair: string
  eyes: string
  outfit: string
  bodyShape?: string
  signatureItems: string[]
  colorPalette: string[]
  negativeTraits: string[]
}

export interface GameStat {
  id: string
  label: string
  value: number
  min: number
  max: number
}

export interface GameSkill {
  id: string
  name: string
  description: string
}

export interface GameItem {
  id: string
  name: string
  description: string
  quantity: number
}

export type CharacterImageAssetKind =
  | 'avatar'
  | 'character-normal'
  | 'character-detail-sheet'
  | 'expression'
  | 'outfit'
  | 'scene'
  | 'reference'

export interface CharacterImagePrompt {
  id: string
  kind: CharacterImageAssetKind
  prompt: string
  negativePrompt?: string
  aspectRatio?: string
  count: number
}

export interface CharacterImageAsset {
  id: string
  kind: CharacterImageAssetKind
  path: string
  promptId?: string
  seed?: number
  modelName?: string
  sourceNodeId: string
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
    type: 'brief-input',
    title: 'Brief Input',
    category: 'input',
    executor: 'manual',
    description: 'Collects the seed brief, boundaries, world direction, and target interaction goal.',
    inputs: {},
    outputs: { brief: port('brief', 'Brief', 'character-brief') },
    parameters: [
      parameter('characterType', 'Character Type', 'text', '原创陪伴角色'),
      parameter('world', 'World', 'textarea', '近未来都市、轻奇幻、可长期互动'),
      parameter('personalityKeywords', 'Personality Keywords', 'string-list', ['敏锐', '克制', '有好奇心']),
      parameter('visualDirection', 'Visual Direction', 'textarea', '可用于头像、正常角色图和细节设定图的清晰视觉方向'),
      parameter('interactionGoal', 'Interaction Goal', 'textarea', '长期聊天、角色扮演和游戏化成长'),
      parameter('forbiddenContent', 'Forbidden Content', 'string-list', []),
    ],
  },
  {
    type: 'reference-input',
    title: 'Reference Input',
    category: 'input',
    executor: 'manual',
    description: 'Adds optional text or image references that constrain the generated card and image pack.',
    inputs: {},
    outputs: { references: port('references', 'References', 'reference') },
    parameters: [
      parameter('referenceMode', 'Reference Mode', 'select', 'optional', undefined, [
        option('Optional', 'optional'),
        option('Required', 'required'),
      ]),
      parameter('notes', 'Notes', 'textarea', ''),
    ],
  },
  {
    type: 'concept-generator',
    title: 'Concept Generator',
    category: 'llm',
    executor: 'llm',
    description: 'Turns a brief into the first structured character concept.',
    inputs: { brief: port('brief', 'Brief', 'character-brief', true) },
    outputs: { card: port('card', 'Concept', 'character-card') },
    parameters: [
      parameter('model', 'Model', 'text', ''),
      parameter('temperature', 'Temperature', 'number', 0.7, { min: 0, max: 2, step: 0.1 }),
      parameter('maxTokens', 'Max Tokens', 'integer', 2400, { min: 512, max: 12000, step: 256 }),
      parameter('systemPrompt', 'System Prompt', 'textarea', '你是专业角色卡设计师，输出完整、可执行、可延展的角色设定。'),
      parameter('jsonMode', 'JSON Mode', 'boolean', true, { advanced: true }),
    ],
  },
  {
    type: 'persona-generator',
    title: 'Persona Generator',
    category: 'llm',
    executor: 'llm',
    description: 'Expands identity, persona, values, flaws, goals, and boundaries.',
    inputs: { card: port('card', 'Concept', 'character-card', true) },
    outputs: { card: port('card', 'Persona', 'character-card') },
    parameters: [
      parameter('depth', 'Depth', 'select', 'full', undefined, [
        option('Compact', 'compact'),
        option('Full', 'full'),
        option('Deep', 'deep'),
      ]),
      parameter('lockCoreIdentity', 'Lock Core Identity', 'boolean', true),
      parameter('temperature', 'Temperature', 'number', 0.65, { min: 0, max: 2, step: 0.1 }),
    ],
  },
  {
    type: 'dialogue-generator',
    title: 'Dialogue Generator',
    category: 'llm',
    executor: 'llm',
    description: 'Creates first message, speaking style, address rules, and examples.',
    inputs: { card: port('card', 'Persona', 'character-card', true) },
    outputs: { card: port('card', 'Dialogue', 'character-card') },
    parameters: [
      parameter('language', 'Language', 'select', 'zh-CN', undefined, [
        option('中文', 'zh-CN'),
        option('English', 'en-US'),
        option('Mixed', 'mixed'),
      ]),
      parameter('exampleCount', 'Example Count', 'integer', 6, { min: 0, max: 24, step: 1 }),
      parameter('styleGuide', 'Style Guide', 'textarea', '自然、稳定、有角色边界，不机械解释设定。'),
    ],
  },
  {
    type: 'game-profile-generator',
    title: 'Game Profile Generator',
    category: 'llm',
    executor: 'llm',
    description: 'Adds stats, skills, inventory, relationship rules, and scene hooks.',
    inputs: { card: port('card', 'Dialogue', 'character-card', true) },
    outputs: { game: port('game', 'Game', 'game-profile') },
    parameters: [
      parameter('statCount', 'Stat Count', 'integer', 6, { min: 3, max: 12, step: 1 }),
      parameter('skillCount', 'Skill Count', 'integer', 5, { min: 0, max: 20, step: 1 }),
      parameter('gameTone', 'Game Tone', 'select', 'light-rpg', undefined, [
        option('Light RPG', 'light-rpg'),
        option('Dating Sim', 'dating-sim'),
        option('Adventure', 'adventure'),
      ]),
    ],
  },
  {
    type: 'visual-spec-generator',
    title: 'Visual Spec Generator',
    category: 'llm',
    executor: 'llm',
    description: 'Produces stable visual anchors for image generation and later consistency checks.',
    inputs: { card: port('card', 'Persona', 'character-card', true) },
    outputs: { visual: port('visual', 'Visual', 'visual-spec') },
    parameters: [
      parameter('artStyle', 'Art Style', 'text', 'anime reference sheet'),
      parameter('lockedTraits', 'Locked Traits', 'string-list', ['发型', '眼睛', '服装主色']),
      parameter('negativeTraits', 'Negative Traits', 'string-list', ['extra fingers', 'bad anatomy']),
      parameter('paletteSize', 'Palette Size', 'integer', 5, { min: 3, max: 12, step: 1 }),
    ],
  },
  {
    type: 'image-prompt-composer',
    title: 'Image Prompt Composer',
    category: 'llm',
    executor: 'llm',
    description: 'Composes provider-ready prompts for avatar, normal art, and detail reference sheet.',
    inputs: { visual: port('visual', 'Visual', 'visual-spec', true) },
    outputs: { prompts: port('prompts', 'Prompts', 'image-prompt') },
    parameters: [
      parameter('requiredAssets', 'Required Assets', 'multi-select', ['avatar', 'character-normal', 'character-detail-sheet'], undefined, [
        option('Avatar', 'avatar'),
        option('Normal character art', 'character-normal'),
        option('Detail reference sheet', 'character-detail-sheet'),
        option('Expression pack', 'expression'),
        option('Outfit sheet', 'outfit'),
      ]),
      parameter('promptLanguage', 'Prompt Language', 'select', 'en-US', undefined, [
        option('English', 'en-US'),
        option('中文', 'zh-CN'),
      ]),
      parameter('negativePrompt', 'Negative Prompt', 'textarea', 'low quality, bad anatomy, extra fingers, missing limbs'),
    ],
  },
  {
    type: 'portrait-generator',
    title: 'Core Image Pack',
    category: 'image',
    executor: 'image',
    description: 'Generates the required avatar, normal character art, and detail reference sheet assets.',
    inputs: { prompts: port('prompts', 'Prompts', 'image-prompt', true) },
    outputs: { assets: port('assets', 'Assets', 'image-asset') },
    parameters: [
      parameter('imageApiId', 'Image API', 'text', ''),
      parameter('imageModelName', 'Image Model', 'text', ''),
      parameter('size', 'Size', 'select', '1024x1024', undefined, [
        option('1024 x 1024', '1024x1024'),
        option('1024 x 1536', '1024x1536'),
        option('1536 x 1024', '1536x1024'),
      ]),
      parameter('seed', 'Seed', 'integer', -1, { min: -1, max: 2147483647, step: 1 }),
      parameter('count', 'Count Per Asset', 'integer', 1, { min: 1, max: 4, step: 1 }),
      parameter('referenceStrength', 'Reference Strength', 'number', 0.65, { min: 0, max: 1, step: 0.05 }),
    ],
  },
  {
    type: 'expression-pack-generator',
    title: 'Expression Pack Generator',
    category: 'image',
    executor: 'image',
    description: 'Generates optional expression variations after core identity is stable.',
    inputs: { prompts: port('prompts', 'Prompts', 'image-prompt', true) },
    outputs: { assets: port('assets', 'Expressions', 'image-asset') },
    parameters: [
      parameter('expressions', 'Expressions', 'string-list', ['neutral', 'smile', 'angry', 'sad']),
      parameter('count', 'Count', 'integer', 4, { min: 1, max: 12, step: 1 }),
    ],
  },
  {
    type: 'outfit-generator',
    title: 'Outfit Generator',
    category: 'image',
    executor: 'image',
    description: 'Generates optional outfit variants while preserving locked character traits.',
    inputs: { prompts: port('prompts', 'Prompts', 'image-prompt', true) },
    outputs: { assets: port('assets', 'Outfits', 'image-asset') },
    parameters: [
      parameter('outfits', 'Outfits', 'string-list', ['default', 'casual', 'formal']),
      parameter('preserveIdentity', 'Preserve Identity', 'boolean', true),
    ],
  },
  {
    type: 'scene-reference-generator',
    title: 'Scene Reference Generator',
    category: 'image',
    executor: 'image',
    description: 'Generates optional scene reference images for later roleplay or story cards.',
    inputs: { prompts: port('prompts', 'Prompts', 'image-prompt', true) },
    outputs: { assets: port('assets', 'Scenes', 'image-asset') },
    parameters: [
      parameter('sceneCount', 'Scene Count', 'integer', 3, { min: 1, max: 12, step: 1 }),
      parameter('aspectRatio', 'Aspect Ratio', 'select', '16:9', undefined, [
        option('1:1', '1:1'),
        option('3:4', '3:4'),
        option('16:9', '16:9'),
      ]),
    ],
  },
  {
    type: 'schema-validator',
    title: 'Schema Validator',
    category: 'validation',
    executor: 'deterministic',
    description: 'Checks the character card against required schema fields.',
    inputs: { card: port('card', 'Card', 'character-card', true) },
    outputs: { report: port('report', 'Report', 'validation-report') },
    parameters: [
      parameter('strict', 'Strict', 'boolean', true),
      parameter('requiredFields', 'Required Fields', 'string-list', ['identity', 'persona', 'dialogue', 'visual', 'game']),
    ],
  },
  {
    type: 'consistency-critic',
    title: 'Consistency Critic',
    category: 'validation',
    executor: 'llm',
    description: 'Reviews card and image assets for identity, visual, and safety consistency.',
    inputs: {
      card: port('card', 'Card', 'character-card', true),
      assets: port('assets', 'Assets', 'image-asset', true),
    },
    outputs: { report: port('report', 'Report', 'validation-report') },
    parameters: [
      parameter('strictness', 'Strictness', 'select', 'normal', undefined, [
        option('Loose', 'loose'),
        option('Normal', 'normal'),
        option('Strict', 'strict'),
      ]),
      parameter('checkImages', 'Check Images', 'boolean', true),
    ],
  },
  {
    type: 'safety-rights-check',
    title: 'Safety & Rights Check',
    category: 'validation',
    executor: 'deterministic',
    description: 'Checks forbidden content, rights notes, and export policy before packaging.',
    inputs: { card: port('card', 'Card', 'character-card', true) },
    outputs: { report: port('report', 'Report', 'validation-report') },
    parameters: [
      parameter('policy', 'Policy', 'select', 'standard', undefined, [
        option('Standard', 'standard'),
        option('Strict', 'strict'),
      ]),
    ],
  },
  {
    type: 'character-pack-exporter',
    title: 'Character Pack Exporter',
    category: 'export',
    executor: 'deterministic',
    description: 'Packages card JSON, workflow metadata, and generated images into a character pack.',
    inputs: {
      card: port('card', 'Card', 'character-card', true),
      assets: port('assets', 'Assets', 'image-asset', true),
      report: port('report', 'Report', 'validation-report', true),
    },
    outputs: { pack: port('pack', 'Pack', 'character-pack') },
    parameters: [
      parameter('outputName', 'Output Name', 'text', 'character-pack'),
      parameter('includeWorkflow', 'Include Workflow', 'boolean', true),
      parameter('format', 'Format', 'select', 'directory', undefined, [
        option('Directory', 'directory'),
        option('Zip', 'zip'),
      ]),
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
        throw new Error(`Unknown character workflow node type: ${type}`)
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
  const id = options.id ?? `character-workflow-${now}`
  const node = createWorkflowNodeFactory()
  const nodes = [
    node('brief-input', 40, 120),
    node('concept-generator', 300, 80),
    node('persona-generator', 560, 80),
    node('dialogue-generator', 820, 80),
    node('game-profile-generator', 1080, 80),
    node('visual-spec-generator', 560, 260),
    node('image-prompt-composer', 820, 260),
    node('portrait-generator', 1080, 260),
    node('schema-validator', 1340, 150),
    node('consistency-critic', 1600, 150),
    node('character-pack-exporter', 1860, 150),
  ]

  return {
    id,
    name: options.name ?? 'Standard Character Workflow',
    version: '1.0',
    description: 'Generates a character card, required core image pack, validation report, and exportable Character Pack.',
    nodes,
    edges: connectSequential([
      ['brief-input', 'brief', 'concept-generator', 'brief'],
      ['concept-generator', 'card', 'persona-generator', 'card'],
      ['persona-generator', 'card', 'dialogue-generator', 'card'],
      ['dialogue-generator', 'card', 'game-profile-generator', 'card'],
      ['persona-generator', 'card', 'visual-spec-generator', 'card'],
      ['visual-spec-generator', 'visual', 'image-prompt-composer', 'visual'],
      ['image-prompt-composer', 'prompts', 'portrait-generator', 'prompts'],
      ['dialogue-generator', 'card', 'schema-validator', 'card'],
      ['dialogue-generator', 'card', 'consistency-critic', 'card'],
      ['schema-validator', 'report', 'consistency-critic', 'report'],
      ['portrait-generator', 'assets', 'consistency-critic', 'assets'],
      ['dialogue-generator', 'card', 'character-pack-exporter', 'card'],
      ['portrait-generator', 'assets', 'character-pack-exporter', 'assets'],
      ['consistency-critic', 'report', 'character-pack-exporter', 'report'],
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
    id: `workflow-run-${now}`,
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
      updateWorkflowNode(next.workflow, event.nodeId, {
        status: 'queued',
        error: undefined,
      })
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

export function collectWorkflowArtifacts<T extends CharacterArtifactType>(
  state: CharacterWorkflowRunState,
  type: T
): Array<Extract<CharacterArtifact, { type: T }>> {
  return state.artifacts.filter((artifact): artifact is Extract<CharacterArtifact, { type: T }> => artifact.type === type)
}

function createWorkflowNodeFactory() {
  const registry = createCharacterWorkflowNodeRegistry()
  return (
    type: CharacterNodeType,
    x: number,
    y: number
  ): CharacterWorkflowNode => ({
    id: type,
    type,
    title: registry.require(type).title,
    position: { x, y },
    inputs: clonePorts(registry.require(type).inputs),
    outputs: clonePorts(registry.require(type).outputs),
    config: createDefaultNodeConfig(registry.require(type)),
    state: { status: 'idle' },
  })
}

function cloneWorkflow(workflow: CharacterWorkflow): CharacterWorkflow {
  return {
    ...workflow,
    nodes: workflow.nodes.map((nodeItem) => ({
      ...nodeItem,
      position: { ...nodeItem.position },
      inputs: { ...nodeItem.inputs },
      outputs: { ...nodeItem.outputs },
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
  return Object.fromEntries(
    Object.entries(ports).map(([key, value]) => [key, { ...value }])
  )
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
    'brief-input': ({ node, config, timestamp }) => [{
      id: `${node.id}-brief`,
      type: 'character-brief',
      sourceNodeId: node.id,
      createdAt: timestamp,
      brief: {
        characterType: stringConfig(config.characterType, '原创陪伴角色'),
        world: stringConfig(config.world, '近未来都市、轻奇幻、可长期互动'),
        personalityKeywords: stringListConfig(config.personalityKeywords),
        visualDirection: stringConfig(config.visualDirection, '清晰、稳定、可重复生成的角色视觉方向'),
        interactionGoal: stringConfig(config.interactionGoal, '长期聊天、角色扮演和游戏化成长'),
        forbiddenContent: stringListConfig(config.forbiddenContent),
      },
    }],
    'concept-generator': (input) => [createCardArtifact(input, 'concept')],
    'persona-generator': (input) => [createCardArtifact(input, 'persona')],
    'dialogue-generator': (input) => [createCardArtifact(input, 'dialogue')],
    'game-profile-generator': ({ node, timestamp }) => [{
      id: `${node.id}-game`,
      type: 'game-profile',
      sourceNodeId: node.id,
      createdAt: timestamp,
      game: createExecutableCharacterCard().game,
    }],
    'visual-spec-generator': ({ node, config, timestamp }) => [{
      id: `${node.id}-visual`,
      type: 'visual-spec',
      sourceNodeId: node.id,
      createdAt: timestamp,
      spec: {
        ...createExecutableCharacterCard().visual,
        artStyle: stringConfig(config.artStyle, 'anime reference sheet'),
        negativeTraits: stringListConfig(config.negativeTraits),
      },
    }],
    'image-prompt-composer': ({ node, config, timestamp }) => {
      const requiredAssets = stringListConfig(config.requiredAssets, ['avatar', 'character-normal', 'character-detail-sheet'])
      return [{
        id: `${node.id}-prompts`,
        type: 'image-prompt',
        sourceNodeId: node.id,
        createdAt: timestamp,
        prompts: requiredAssets.map((kind) => ({
          id: `${kind}-prompt`,
          kind: kind as CharacterImageAssetKind,
          prompt: `high quality ${kind} for a consistent original character, ${stringConfig(config.promptLanguage, 'en-US')}`,
          negativePrompt: stringConfig(config.negativePrompt, 'low quality, bad anatomy'),
          aspectRatio: kind === 'character-detail-sheet' ? '16:9' : '1:1',
          count: 1,
        })),
      }]
    },
    'portrait-generator': ({ node, config, inputArtifacts, timestamp }) => {
      const prompts = inputArtifacts.flatMap((artifact) => artifact.type === 'image-prompt' ? artifact.prompts : [])
      return [{
        id: `${node.id}-assets`,
        type: 'image-asset',
        sourceNodeId: node.id,
        createdAt: timestamp,
        assets: prompts.map((promptItem) => ({
          id: `${promptItem.kind}-asset`,
          kind: promptItem.kind,
          path: `memory://character-workflow/${node.id}/${promptItem.kind}.png`,
          promptId: promptItem.id,
          seed: numberConfig(config.seed, -1),
          modelName: stringConfig(config.imageModelName, ''),
          sourceNodeId: node.id,
        })),
      }]
    },
    'schema-validator': ({ node, inputArtifacts, timestamp }) => [{
      id: `${node.id}-report`,
      type: 'validation-report',
      sourceNodeId: node.id,
      createdAt: timestamp,
      report: {
        passed: inputArtifacts.some((artifact) => artifact.type === 'character-card'),
        issues: [],
      },
    }],
    'consistency-critic': ({ node, inputArtifacts, timestamp }) => [{
      id: `${node.id}-report`,
      type: 'validation-report',
      sourceNodeId: node.id,
      createdAt: timestamp,
      report: {
        passed: inputArtifacts.some((artifact) => artifact.type === 'character-card')
          && inputArtifacts.some((artifact) => artifact.type === 'image-asset'),
        issues: [],
      },
    }],
    'safety-rights-check': ({ node, timestamp }) => [{
      id: `${node.id}-report`,
      type: 'validation-report',
      sourceNodeId: node.id,
      createdAt: timestamp,
      report: { passed: true, issues: [] },
    }],
    'character-pack-exporter': ({ node, timestamp }) => [{
      id: `${node.id}-pack`,
      type: 'character-pack',
      sourceNodeId: node.id,
      createdAt: timestamp,
      pack: {
        path: 'memory://character-workflow/character-pack',
        manifestPath: 'memory://character-workflow/character-pack/manifest.json',
        cardPath: 'memory://character-workflow/character-pack/card.json',
        assetPaths: [],
      },
    }],
  }
}

function createCardArtifact(input: CharacterWorkflowNodeExecutionInput, stage: string): CharacterCardArtifact {
  const previousCard = [...input.inputArtifacts, ...input.artifacts]
    .reverse()
    .find((artifact): artifact is CharacterCardArtifact => artifact.type === 'character-card')
    ?.card
  return {
    id: `${input.node.id}-card`,
    type: 'character-card',
    sourceNodeId: input.node.id,
    createdAt: input.timestamp,
    card: {
      ...(previousCard ?? createExecutableCharacterCard()),
      generation: {
        ...(previousCard ?? createExecutableCharacterCard()).generation,
        promptBase: `Generated through ${stage} stage.`,
      },
    },
  }
}

function createExecutableCharacterCard(): CharacterCard {
  return {
    schemaVersion: '1.0',
    id: 'workflow-draft',
    identity: {
      name: 'Workflow Draft',
      displayName: 'Workflow Draft',
      role: 'Companion character',
      tags: ['workflow', 'draft'],
    },
    world: {
      genre: 'original',
      setting: 'Noema character workflow',
    },
    persona: {
      summary: 'A structured character draft produced by the workflow runner.',
      traits: ['consistent'],
      values: ['coherence'],
      flaws: [],
      goals: ['become a complete character pack'],
      boundaries: [],
    },
    dialogue: {
      language: 'zh-CN',
      style: '自然、稳定、角色一致',
      firstMessage: '我的角色卡正在由工作流生成。',
      userAddressing: '你',
      examples: [],
    },
    visual: {
      artStyle: 'anime reference sheet',
      appearance: 'consistent original character',
      hair: 'defined by visual spec',
      eyes: 'defined by visual spec',
      outfit: 'defined by visual spec',
      signatureItems: [],
      colorPalette: [],
      negativeTraits: [],
    },
    game: {
      stats: [
        { id: 'focus', label: 'Focus', value: 70, min: 0, max: 100 },
        { id: 'trust', label: 'Trust', value: 50, min: 0, max: 100 },
      ],
      skills: [],
      inventory: [],
      relationshipRules: [],
      sceneHooks: [],
    },
    generation: {
      promptBase: '',
      negativePrompt: '',
      referenceAssets: [],
      preferredAspectRatios: ['1:1', '3:4', '16:9'],
    },
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

function stringConfig(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function stringListConfig(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : fallback
}

function numberConfig(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback
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

function connectSequential(items: Array<[string, string, string, string]>): CharacterWorkflowEdge[] {
  return items.map(([fromNode, fromPort, toNode, toPort]) => ({
    id: `${fromNode}.${fromPort}->${toNode}.${toPort}`,
    from: { nodeId: fromNode, port: fromPort },
    to: { nodeId: toNode, port: toPort },
  }))
}
