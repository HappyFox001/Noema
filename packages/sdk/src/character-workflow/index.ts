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

export function createStandardCharacterWorkflow(
  options: CreateStandardCharacterWorkflowOptions = {}
): CharacterWorkflow {
  const now = options.now ?? Date.now()
  const id = options.id ?? `character-workflow-${now}`
  const node = createWorkflowNodeFactory()
  const nodes = [
    node('brief-input', 'Brief Input', 40, 120, {}, { brief: port('brief', 'Brief', 'character-brief') }),
    node('concept-generator', 'Concept Generator', 300, 80, { brief: port('brief', 'Brief', 'character-brief', true) }, { card: port('card', 'Concept', 'character-card') }),
    node('persona-generator', 'Persona Generator', 560, 80, { card: port('card', 'Concept', 'character-card', true) }, { card: port('card', 'Persona', 'character-card') }),
    node('dialogue-generator', 'Dialogue Generator', 820, 80, { card: port('card', 'Persona', 'character-card', true) }, { card: port('card', 'Dialogue', 'character-card') }),
    node('game-profile-generator', 'Game Profile Generator', 1080, 80, { card: port('card', 'Dialogue', 'character-card', true) }, { game: port('game', 'Game', 'game-profile') }),
    node('visual-spec-generator', 'Visual Spec Generator', 560, 260, { card: port('card', 'Persona', 'character-card', true) }, { visual: port('visual', 'Visual', 'visual-spec') }),
    node('image-prompt-composer', 'Image Prompt Composer', 820, 260, { visual: port('visual', 'Visual', 'visual-spec', true) }, { prompts: port('prompts', 'Prompts', 'image-prompt') }),
    node('portrait-generator', 'Core Image Pack', 1080, 260, { prompts: port('prompts', 'Prompts', 'image-prompt', true) }, { assets: port('assets', 'Assets', 'image-asset') }, {
      requiredAssets: ['avatar', 'character-normal', 'character-detail-sheet'],
    }),
    node('schema-validator', 'Schema Validator', 1340, 150, { card: port('card', 'Card', 'character-card', true) }, { report: port('report', 'Report', 'validation-report') }),
    node('consistency-critic', 'Consistency Critic', 1600, 150, {
      card: port('card', 'Card', 'character-card', true),
      assets: port('assets', 'Assets', 'image-asset', true),
    }, { report: port('report', 'Report', 'validation-report') }),
    node('character-pack-exporter', 'Character Pack Exporter', 1860, 150, {
      card: port('card', 'Card', 'character-card', true),
      assets: port('assets', 'Assets', 'image-asset', true),
      report: port('report', 'Report', 'validation-report', true),
    }, { pack: port('pack', 'Pack', 'character-pack') }),
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

function createWorkflowNodeFactory() {
  return (
    type: CharacterNodeType,
    title: string,
    x: number,
    y: number,
    inputs: Record<string, CharacterNodePort>,
    outputs: Record<string, CharacterNodePort>,
    config: Record<string, unknown> = {}
  ): CharacterWorkflowNode => ({
    id: type,
    type,
    title,
    position: { x, y },
    inputs,
    outputs,
    config,
    state: { status: 'idle' },
  })
}

function port(
  id: string,
  label: string,
  artifactType: CharacterArtifactType,
  required = false
): CharacterNodePort {
  return { id, label, artifactType, required }
}

function connectSequential(items: Array<[string, string, string, string]>): CharacterWorkflowEdge[] {
  return items.map(([fromNode, fromPort, toNode, toPort]) => ({
    id: `${fromNode}.${fromPort}->${toNode}.${toPort}`,
    from: { nodeId: fromNode, port: fromPort },
    to: { nodeId: toNode, port: toPort },
  }))
}
