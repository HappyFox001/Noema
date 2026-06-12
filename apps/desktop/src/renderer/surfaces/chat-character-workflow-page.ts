/**
 * Renders the character resource graph workbench for the chat surface.
 */
import Fuse from 'fuse.js'
import Split from 'split-grid'
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/dist/esm/adapter/element-adapter.js'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import { LGraph, LiteGraph } from 'litegraph.js'
import { Download, Link2Off, Maximize, MessageCircle, Package, Play, RotateCcw, Save, Search, createIcons } from 'lucide'
import * as Y from 'yjs'

export interface CharacterWorkflowPageOptions {
  language: 'zh-CN' | 'en-US'
  escapeHtml(value: string): string
  configOverrides?: Record<string, Record<string, unknown>>
  positionOverrides?: Record<string, { x: number; y: number }>
  runState?: CharacterResourceRunState | null
  tabs: CharacterWorkflowFileTab[]
  activeTabId: string
  selectedNodeId: string
  activePanel: CharacterWorkflowSidePanel
  sidebarCollapsed: boolean
  inspectorCollapsed: boolean
  viewState?: CharacterResourceViewState
}

export interface CharacterWorkflowFileTab {
  id: string
  title: string
  kind: 'workflow' | 'run' | 'character'
  state?: 'running' | 'failed' | 'dirty'
}

export type CharacterWorkflowSidePanel = 'workflow' | 'assets' | 'nodes'

export interface CharacterResourceViewState {
  zoom?: number
  hideLinks?: boolean
  collapsedNodeIds?: string[]
  deletedNodeIds?: string[]
  duplicatedNodes?: Array<{
    id: string
    sourceId: string
    offsetX: number
    offsetY: number
  }>
}

export interface SerializedCharacterResourceGraph {
  schemaVersion: 1
  graphId: string
  activeTabId: string
  selectedNodeId: string
  viewState: CharacterResourceViewState
  configOverrides: Record<string, Record<string, unknown>>
  positionOverrides: Record<string, { x: number; y: number }>
  yjsSnapshot: string
}

type CharacterResourceNodeStatus = 'idle' | 'dirty' | 'queued' | 'running' | 'done' | 'failed' | 'stale' | 'disabled'
type CharacterResourcePreviewType = 'text-card' | 'image' | 'voice' | 'rule' | 'validation' | 'package'
type CharacterResourceParameterType = 'text' | 'textarea' | 'number' | 'integer' | 'boolean' | 'select' | 'multi-select' | 'string-list'
type CharacterResourceLinkKind = 'requires' | 'constrains' | 'references' | 'validates' | 'exports' | 'suggests'

interface CharacterResourceGraph {
  id: string
  title: string
  nodes: CharacterResourceNode[]
  links: CharacterResourceLink[]
  groups: CharacterResourceGroup[]
  tabs: CharacterResourceGraphTab[]
  viewport: CharacterResourceViewport
  selection: CharacterResourceSelection
  panels: CharacterResourcePanels
  mockOutputs: CharacterResourceMockOutput[]
}

interface CharacterResourceNodeDefinition {
  type: string
  displayName: string
  aliases: string[]
  category: string
  source: 'core' | 'asset' | 'agent' | 'safety'
  description: string
  inputs: CharacterResourceSlotDefinition[]
  outputs: CharacterResourceSlotDefinition[]
  parameters: CharacterResourceParameterDefinition[]
  defaultSize: { width: number; height: number }
  previewType: CharacterResourcePreviewType
}

interface CharacterResourceSlotDefinition {
  id: string
  label: string
  type: string
  required?: boolean
  tooltip: string
}

interface CharacterResourceParameterDefinition {
  id: string
  label: string
  type: CharacterResourceParameterType
  defaultValue: unknown
  min?: number
  max?: number
  step?: number
  options?: Array<{ label: string; value: string }>
}

interface CharacterResourceNode {
  id: string
  type: string
  title: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  status: CharacterResourceNodeStatus
  collapsed?: boolean
  zIndex: number
  config: Record<string, unknown>
}

interface CharacterResourceLink {
  id: string
  sourceNodeId: string
  sourceSlotId: string
  targetNodeId: string
  targetSlotId: string
  kind: CharacterResourceLinkKind
  label: string
  status: 'valid' | 'warning' | 'invalid' | 'hidden'
}

interface CharacterResourceGroup {
  id: string
  title: string
  nodeIds: string[]
  color: string
}

interface CharacterResourceGraphTab {
  id: string
  title: string
  kind: 'resource-graph' | 'package-preview' | 'run-draft'
}

interface CharacterResourceViewport {
  x: number
  y: number
  zoom: number
}

interface CharacterResourceSelection {
  nodeIds: string[]
  linkIds: string[]
}

interface CharacterResourcePanels {
  leftWidth: number
  rightWidth: number
  bottomHeight: number
  activePanel: CharacterWorkflowSidePanel
}

interface CharacterResourceMockOutput {
  id: string
  nodeId: string
  type: string
  title: string
  summary: string
  status: CharacterResourceNodeStatus
}

export interface CharacterResourceRunState {
  run?: {
    id: string
    title: string
    status: 'idle' | 'running' | 'failed' | 'done'
  }
  artifacts?: Array<{
    id?: string
    type: string
    sourceNodeId: string
    title?: string
    summary?: string
  }>
}

export function createDraftCharacterResourceRunState(runNumber: number, status: CharacterResourceRunState['run']['status'] = 'running'): CharacterResourceRunState {
  const id = `resource-run-${Date.now()}-${Math.random().toString(16).slice(2)}`
  return {
    run: {
      id,
      title: `Resource Draft ${String(runNumber).padStart(2, '0')}.run`,
      status,
    },
    artifacts: [],
  }
}

export function completeCharacterResourceRunState(state: CharacterResourceRunState): CharacterResourceRunState {
  const run = state.run ?? createDraftCharacterResourceRunState(1, 'done').run!
  return {
    run: {
      ...run,
      status: 'done',
    },
    artifacts: [
      { type: 'character-card', sourceNodeId: 'identity-card', title: 'Identity Card', summary: 'Mock identity resource assembled from the current resource graph.' },
      { type: 'character-card', sourceNodeId: 'persona-engine', title: 'Persona Engine', summary: 'Mock persona resource assembled with constraints and contradictions.' },
      { type: 'image-asset', sourceNodeId: 'image-assets', title: 'Image Asset Set', summary: 'Mock avatar, body image, expression sheet, and scene reference slots reserved.' },
      { type: 'validation-report', sourceNodeId: 'consistency-critic', title: 'Consistency Report', summary: 'Mock validation report checks required resources, slot compatibility, and package gaps.' },
      { type: 'agent-policy', sourceNodeId: 'agent-policy', title: 'Agent Policy', summary: 'Mock autonomous generation boundaries and revision budget are ready for backend execution.' },
      { type: 'character-pack', sourceNodeId: 'character-package', title: 'Character Package', summary: 'Mock package manifest includes graph resources, runtime state, validation, and chat-test entry.' },
    ],
  }
}

export function serializeCharacterResourceGraph(input: Omit<SerializedCharacterResourceGraph, 'schemaVersion'>): string {
  return JSON.stringify({
    schemaVersion: 1,
    ...input,
  } satisfies SerializedCharacterResourceGraph)
}

export function deserializeCharacterResourceGraph(serialized: string): SerializedCharacterResourceGraph {
  const parsed = JSON.parse(serialized) as Partial<SerializedCharacterResourceGraph>
  if (parsed.schemaVersion !== 1 || !parsed.graphId) {
    throw new Error('Unsupported character resource graph snapshot.')
  }
  return {
    schemaVersion: 1,
    graphId: parsed.graphId,
    activeTabId: parsed.activeTabId ?? 'workflow',
    selectedNodeId: parsed.selectedNodeId ?? 'brief-input',
    viewState: parsed.viewState ?? {},
    configOverrides: parsed.configOverrides ?? {},
    positionOverrides: parsed.positionOverrides ?? {},
    yjsSnapshot: parsed.yjsSnapshot ?? '{}',
  }
}

const LINK_KIND_LABELS: Record<CharacterResourceLinkKind, string> = {
  requires: 'requires',
  constrains: 'constrains',
  references: 'references',
  validates: 'validates',
  exports: 'exports',
  suggests: 'suggests',
}

const RESOURCE_NODE_DEFINITIONS: CharacterResourceNodeDefinition[] = [
  createDefinition('brief', 'Character Brief', ['需求', 'brief', 'goal'], 'brief', 'core', 'Defines generation intent, target interaction, audience, taboo zones, and acceptance boundaries.', [], [
    slot('brief', 'Brief', 'brief', 'Generation brief and boundaries.'),
  ], [
    param('prompt', 'Prompt', 'textarea', 'A slow-burn agentic RP character with rich resources and explicit constraints.'),
    param('audience', 'Audience', 'text', 'private roleplay'),
  ], 'text-card'),
  createDefinition('identity', 'Identity Card', ['身份', 'name', 'profile'], 'identity', 'core', 'Stores name, address forms, public identity, age band, occupation, tags, and relationship anchor.', [
    slot('brief', 'Brief', 'brief', 'Identity must satisfy this brief.', true),
  ], [
    slot('identity', 'Identity', 'identity', 'Structured identity resource.'),
  ], [
    param('name', 'Name', 'text', 'Chen Qianyu'),
    param('tags', 'Tags', 'string-list', ['reserved', 'strategic', 'slow-burn']),
  ], 'text-card'),
  createDefinition('persona', 'Persona Engine', ['性格', 'persona', 'motivation'], 'persona', 'core', 'Models values, flaws, secrets, desire, refusal rules, and emotional inertia.', [
    slot('identity', 'Identity', 'identity', 'Identity anchor.', true),
    slot('brief', 'Brief', 'brief', 'Intent boundary.', true),
  ], [
    slot('persona', 'Persona', 'persona', 'Character psychology resource.'),
  ], [
    param('coreDrive', 'Core Drive', 'textarea', 'Protect control while testing trust.'),
    param('contradiction', 'Contradiction', 'textarea', 'Craves closeness but punishes rushed intimacy.'),
  ], 'text-card'),
  createDefinition('world', 'World Bible', ['世界观', 'setting', 'lore'], 'world', 'asset', 'Defines era, factions, locations, rules, social pressure, and plot affordances.', [
    slot('brief', 'Brief', 'brief', 'World should support the brief.', true),
  ], [
    slot('world', 'World', 'world', 'World and lore resource.'),
  ], [
    param('era', 'Era', 'select', 'modern', undefined, undefined, undefined, [
      { label: 'Modern', value: 'modern' },
      { label: 'Near Future', value: 'near-future' },
      { label: 'Fantasy', value: 'fantasy' },
    ]),
    param('locations', 'Locations', 'string-list', ['private study', 'rainy balcony', 'auction house']),
  ], 'text-card'),
  createDefinition('scene', 'Opening Scene', ['场景', 'state', 'opening'], 'scene', 'asset', 'Builds initial place, state variables, props, relationship state, and opening pressure.', [
    slot('persona', 'Persona', 'persona', 'Persona informs scene tension.', true),
    slot('world', 'World', 'world', 'World context.', true),
  ], [
    slot('scene', 'Scene', 'scene', 'Initial runtime scene state.'),
  ], [
    param('place', 'Place', 'text', 'a private study after midnight'),
    param('objective', 'Objective', 'textarea', 'Make the user negotiate access instead of receiving it.'),
  ], 'rule'),
  createDefinition('dialogue', 'Dialogue Style', ['对话', 'voice text', 'examples'], 'dialogue', 'core', 'Defines first message, speech habits, address rules, example dialogues, and taboo phrasing.', [
    slot('persona', 'Persona', 'persona', 'Persona voice.', true),
    slot('scene', 'Scene', 'scene', 'Opening context.', true),
  ], [
    slot('dialogue', 'Dialogue', 'dialogue', 'Dialogue and first-message resource.'),
  ], [
    param('firstMessage', 'First Message', 'textarea', 'You are late. I dislike waiting, but I dislike easy apologies more.'),
    param('temperature', 'Variation', 'number', 0.72, 0, 1, 0.01),
  ], 'text-card'),
  createDefinition('visual', 'Visual Spec', ['视觉', 'appearance', 'outfit'], 'visual', 'asset', 'Defines body, face, hair, clothes, palette, negative visual traits, and image prompt constraints.', [
    slot('identity', 'Identity', 'identity', 'Identity visual anchor.', true),
    slot('persona', 'Persona', 'persona', 'Persona should influence visual tone.', true),
  ], [
    slot('visual', 'Visual', 'visual', 'Visual specification.'),
  ], [
    param('palette', 'Palette', 'string-list', ['black jade', 'warm ivory', 'muted gold']),
    param('negative', 'Negative Traits', 'string-list', ['childlike', 'generic smile', 'overexposed']),
  ], 'image'),
  createDefinition('image', 'Image Asset Set', ['头像', '立绘', 'image'], 'image', 'asset', 'Defines avatar, body image, expression sheet, outfit variants, and scene reference outputs.', [
    slot('visual', 'Visual', 'visual', 'Visual prompt input.', true),
  ], [
    slot('imageAsset', 'Images', 'image-asset', 'Image asset references.'),
  ], [
    param('count', 'Asset Count', 'integer', 4, 1, 12, 1),
    param('styleLock', 'Style Lock', 'boolean', true),
  ], 'image'),
  createDefinition('voice', 'Voice Profile', ['语音', 'tts', 'tone'], 'voice', 'asset', 'Defines TTS profile, tempo, timbre, sample lines, and emotional delivery constraints.', [
    slot('dialogue', 'Dialogue', 'dialogue', 'Dialogue samples.', true),
  ], [
    slot('voice', 'Voice', 'voice', 'Voice/TTS resource.'),
  ], [
    param('timbre', 'Timbre', 'text', 'low, controlled, slightly amused'),
    param('speed', 'Speed', 'number', 0.92, 0.5, 1.5, 0.01),
  ], 'voice'),
  createDefinition('memory', 'Memory Rules', ['记忆', 'summary', 'state'], 'memory', 'agent', 'Configures long-term memory, summary thresholds, relationship variables, and state update rules.', [
    slot('persona', 'Persona', 'persona', 'Persona memory rules.', true),
    slot('scene', 'Scene', 'scene', 'Runtime state shape.', true),
  ], [
    slot('memory', 'Memory', 'memory', 'Memory policy.'),
  ], [
    param('shortTermTurns', 'Short-Term Turns', 'integer', 8, 2, 24, 1),
    param('summaryPolicy', 'Summary Policy', 'textarea', 'Preserve promises, leverage, emotional shifts, and unresolved debts.'),
  ], 'rule'),
  createDefinition('rp-rule', 'RP Constraints', ['规则', 'boundary', 'policy'], 'rp-rule', 'safety', 'Defines roleplay boundaries, pacing rules, refusal strategy, continuity locks, and player agency limits.', [
    slot('brief', 'Brief', 'brief', 'User boundaries.', true),
    slot('persona', 'Persona', 'persona', 'Character behavior constraints.', true),
  ], [
    slot('rules', 'Rules', 'rp-rule', 'RP rule set.'),
  ], [
    param('slowBurn', 'Slow Burn', 'boolean', true),
    param('forbiddenMoves', 'Forbidden Moves', 'string-list', ['instant compliance', 'breaking character', 'plot teleport']),
  ], 'rule'),
  createDefinition('critic', 'Consistency Critic', ['校验', 'critic', 'validation'], 'critic', 'safety', 'Checks identity, persona, world, scene, visual, dialogue, memory, and safety consistency.', [
    slot('identity', 'Identity', 'identity', 'Identity input.', true),
    slot('persona', 'Persona', 'persona', 'Persona input.', true),
    slot('world', 'World', 'world', 'World input.'),
    slot('dialogue', 'Dialogue', 'dialogue', 'Dialogue input.'),
    slot('rules', 'Rules', 'rp-rule', 'Rule input.'),
  ], [
    slot('validation', 'Validation', 'validation-report', 'Validation report.'),
  ], [
    param('strictness', 'Strictness', 'select', 'high', undefined, undefined, undefined, [
      { label: 'Medium', value: 'medium' },
      { label: 'High', value: 'high' },
      { label: 'Severe', value: 'severe' },
    ]),
  ], 'validation'),
  createDefinition('agent-policy', 'Agent Policy', ['agent', '自主', 'plan'], 'agent-policy', 'agent', 'Constrains backend agent autonomy, revision budget, model selection, and handoff rules.', [
    slot('brief', 'Brief', 'brief', 'Primary goal.', true),
    slot('validation', 'Validation', 'validation-report', 'Quality gate.'),
  ], [
    slot('policy', 'Policy', 'agent-policy', 'Agent execution policy.'),
  ], [
    param('revisionBudget', 'Revision Budget', 'integer', 4, 1, 12, 1),
    param('allowAutonomy', 'Allow Autonomy', 'boolean', true),
  ], 'rule'),
  createDefinition('export', 'Character Package', ['导出', 'manifest', 'package'], 'export', 'core', 'Assembles final manifest, resource list, runtime context, missing assets, and chat test entry.', [
    slot('identity', 'Identity', 'identity', 'Identity resource.', true),
    slot('persona', 'Persona', 'persona', 'Persona resource.', true),
    slot('world', 'World', 'world', 'World resource.'),
    slot('scene', 'Scene', 'scene', 'Scene resource.', true),
    slot('dialogue', 'Dialogue', 'dialogue', 'Dialogue resource.', true),
    slot('imageAsset', 'Images', 'image-asset'),
    slot('voice', 'Voice', 'voice'),
    slot('memory', 'Memory', 'memory'),
    slot('rules', 'Rules', 'rp-rule', 'Runtime rules.', true),
    slot('policy', 'Policy', 'agent-policy'),
  ], [
    slot('pack', 'Package', 'character-pack', 'Exportable character pack.'),
  ], [
    param('format', 'Format', 'select', 'noema-role-chat', undefined, undefined, undefined, [
      { label: 'Noema Role Chat', value: 'noema-role-chat' },
      { label: 'Portable JSON', value: 'portable-json' },
    ]),
  ], 'package'),
]

const DEFAULT_NODE_PLACEMENT: Array<{ id: string; type: string; title: string; x: number; y: number; status?: CharacterResourceNodeStatus }> = [
  { id: 'brief-input', type: 'brief', title: 'Brief', x: 88, y: 96, status: 'dirty' },
  { id: 'identity-card', type: 'identity', title: 'Identity Card', x: 402, y: 48 },
  { id: 'persona-engine', type: 'persona', title: 'Persona Engine', x: 726, y: 72 },
  { id: 'world-bible', type: 'world', title: 'World Bible', x: 402, y: 276 },
  { id: 'opening-scene', type: 'scene', title: 'Opening Scene', x: 726, y: 320 },
  { id: 'dialogue-style', type: 'dialogue', title: 'Dialogue Style', x: 1052, y: 180 },
  { id: 'visual-spec', type: 'visual', title: 'Visual Spec', x: 724, y: 546 },
  { id: 'image-assets', type: 'image', title: 'Image Asset Set', x: 1052, y: 528, status: 'queued' },
  { id: 'voice-profile', type: 'voice', title: 'Voice Profile', x: 1378, y: 116 },
  { id: 'memory-rules', type: 'memory', title: 'Memory Rules', x: 1378, y: 340 },
  { id: 'rp-constraints', type: 'rp-rule', title: 'RP Constraints', x: 1052, y: 760 },
  { id: 'consistency-critic', type: 'critic', title: 'Consistency Critic', x: 1706, y: 278, status: 'stale' },
  { id: 'agent-policy', type: 'agent-policy', title: 'Agent Policy', x: 1706, y: 548 },
  { id: 'character-package', type: 'export', title: 'Character Package', x: 2038, y: 392 },
]

const DEFAULT_LINKS: CharacterResourceLink[] = [
  link('brief-input', 'brief', 'identity-card', 'brief', 'requires'),
  link('brief-input', 'brief', 'persona-engine', 'brief', 'requires'),
  link('brief-input', 'brief', 'world-bible', 'brief', 'suggests'),
  link('identity-card', 'identity', 'persona-engine', 'identity', 'requires'),
  link('persona-engine', 'persona', 'opening-scene', 'persona', 'requires'),
  link('world-bible', 'world', 'opening-scene', 'world', 'requires'),
  link('persona-engine', 'persona', 'dialogue-style', 'persona', 'requires'),
  link('opening-scene', 'scene', 'dialogue-style', 'scene', 'requires'),
  link('identity-card', 'identity', 'visual-spec', 'identity', 'references'),
  link('persona-engine', 'persona', 'visual-spec', 'persona', 'constrains'),
  link('visual-spec', 'visual', 'image-assets', 'visual', 'requires'),
  link('dialogue-style', 'dialogue', 'voice-profile', 'dialogue', 'references'),
  link('persona-engine', 'persona', 'memory-rules', 'persona', 'requires'),
  link('opening-scene', 'scene', 'memory-rules', 'scene', 'requires'),
  link('brief-input', 'brief', 'rp-constraints', 'brief', 'constrains'),
  link('persona-engine', 'persona', 'rp-constraints', 'persona', 'constrains'),
  link('identity-card', 'identity', 'consistency-critic', 'identity', 'validates'),
  link('persona-engine', 'persona', 'consistency-critic', 'persona', 'validates'),
  link('world-bible', 'world', 'consistency-critic', 'world', 'validates'),
  link('dialogue-style', 'dialogue', 'consistency-critic', 'dialogue', 'validates'),
  link('rp-constraints', 'rules', 'consistency-critic', 'rules', 'validates'),
  link('brief-input', 'brief', 'agent-policy', 'brief', 'requires'),
  link('consistency-critic', 'validation', 'agent-policy', 'validation', 'requires'),
  link('identity-card', 'identity', 'character-package', 'identity', 'exports'),
  link('persona-engine', 'persona', 'character-package', 'persona', 'exports'),
  link('world-bible', 'world', 'character-package', 'world', 'exports'),
  link('opening-scene', 'scene', 'character-package', 'scene', 'exports'),
  link('dialogue-style', 'dialogue', 'character-package', 'dialogue', 'exports'),
  link('image-assets', 'imageAsset', 'character-package', 'imageAsset', 'exports'),
  link('voice-profile', 'voice', 'character-package', 'voice', 'exports'),
  link('memory-rules', 'memory', 'character-package', 'memory', 'exports'),
  link('rp-constraints', 'rules', 'character-package', 'rules', 'exports'),
  link('agent-policy', 'policy', 'character-package', 'policy', 'exports'),
]

const definitionFuse = new Fuse(RESOURCE_NODE_DEFINITIONS, {
  keys: ['type', 'displayName', 'aliases', 'category', 'source', 'description', 'inputs.type', 'outputs.type'],
  threshold: 0.28,
  ignoreLocation: true,
})

const workbenchCleanups = new WeakMap<HTMLElement, Array<() => void>>()

export function renderCharacterWorkflowPage(options: CharacterWorkflowPageOptions): string {
  const graph = createCharacterResourceGraph(options)
  const liteGraphSnapshot = createLiteGraphSnapshot(graph)
  const yjsSnapshot = createYjsSnapshot(graph, liteGraphSnapshot)
  return `
    <div class="chat-character-workflow-shell chat-resource-workbench" data-resource-graph-id="${options.escapeHtml(graph.id)}">
      ${renderFileTabs(options)}
      <div class="chat-character-workflow-stage">
        <div class="chat-resource-workspace ${options.sidebarCollapsed ? 'sidebar-collapsed' : ''} ${options.inspectorCollapsed ? 'inspector-collapsed' : ''}" style="--resource-left-panel: ${graph.panels.leftWidth}px; --resource-right-panel: ${graph.panels.rightWidth}px; --resource-bottom-panel: ${graph.panels.bottomHeight}px">
          ${renderResourceLibrary(graph, options)}
          <div class="chat-resource-split-gutter left" data-resource-split-gutter="left" aria-hidden="true"></div>
          ${renderResourceCanvas(graph, yjsSnapshot, options)}
          <div class="chat-resource-split-gutter right" data-resource-split-gutter="right" aria-hidden="true"></div>
          ${renderResourceInspector(graph, options)}
          ${renderBottomToolbar(graph, options)}
        </div>
      </div>
    </div>
  `
}

export function initializeCharacterResourceWorkbench(root: HTMLElement): void {
  workbenchCleanups.get(root)?.forEach((cleanup) => cleanup())
  const cleanups: Array<() => void> = []
  const workspace = root.querySelector<HTMLElement>('.chat-resource-workspace')
  const leftGutter = root.querySelector<HTMLElement>('[data-resource-split-gutter="left"]')
  const rightGutter = root.querySelector<HTMLElement>('[data-resource-split-gutter="right"]')
  if (workspace && leftGutter && rightGutter) {
    const split = Split({
      columnGutters: [
        { element: leftGutter, track: 1 },
        { element: rightGutter, track: 3 },
      ],
      columnMinSizes: { 0: 0, 2: 420, 4: 0 },
      snapOffset: 42,
    })
    cleanups.push(() => split.destroy(true))
  }

  root.querySelectorAll<HTMLElement>('.chat-resource-node').forEach((node) => {
    const handle = node.querySelector<HTMLElement>('[data-chat-workflow-drag-handle]') ?? node
    cleanups.push(draggable({
      element: node,
      dragHandle: handle,
      getInitialData: () => ({
        kind: 'character-resource-node',
        nodeId: node.dataset.chatWorkflowNodeId ?? '',
        nodeType: node.dataset.resourceNodeType ?? '',
      }),
      onDragStart: () => node.classList.add('is-pragmatic-dragging'),
      onDrop: () => node.classList.remove('is-pragmatic-dragging'),
    }))
  })

  const canvas = root.querySelector<HTMLElement>('.chat-resource-canvas')
  const contextMenu = root.querySelector<HTMLElement>('.chat-resource-context-menu')
  if (canvas) {
    cleanups.push(dropTargetForElements({
      element: canvas,
      getData: () => ({ kind: 'character-resource-canvas' }),
      onDragEnter: () => canvas.classList.add('is-drag-target'),
      onDragLeave: () => canvas.classList.remove('is-drag-target'),
      onDrop: () => canvas.classList.remove('is-drag-target'),
    }))
    const openContextMenu = (event: MouseEvent) => {
      if (!contextMenu || !(event.target as HTMLElement | null)?.closest('.chat-resource-canvas')) {
        return
      }
      event.preventDefault()
      contextMenu.classList.add('is-open')
      contextMenu.style.left = `${event.offsetX}px`
      contextMenu.style.top = `${event.offsetY}px`
    }
    const closeContextMenu = () => contextMenu?.classList.remove('is-open')
    canvas.addEventListener('contextmenu', openContextMenu)
    root.addEventListener('click', closeContextMenu)
    cleanups.push(() => {
      canvas.removeEventListener('contextmenu', openContextMenu)
      root.removeEventListener('click', closeContextMenu)
    })
  }

  cleanups.push(monitorForElements({
    onDragStart: () => root.classList.add('is-resource-dragging'),
    onDrop: () => root.classList.remove('is-resource-dragging'),
  }))

  const searchInput = root.querySelector<HTMLElement>('[data-chat-resource-node-search]')
  const searchPopover = root.querySelector<HTMLElement>('.chat-resource-node-search-popover')
  if (searchInput instanceof HTMLInputElement) {
    const preview = root.querySelector<HTMLElement>('[data-resource-node-preview]')
    const updatePreview = (card: HTMLElement) => {
      if (!preview) {
        return
      }
      const title = card.dataset.resourcePreviewTitle ?? ''
      const body = card.dataset.resourcePreviewBody ?? ''
      preview.innerHTML = `<strong>${title}</strong><p>${body}</p>`
    }
    const filterCards = () => {
      const query = searchInput.value.trim().toLowerCase()
      root.querySelectorAll<HTMLElement>('[data-resource-library-card]').forEach((card) => {
        const searchable = (card.dataset.resourceSearchText ?? '').toLowerCase()
        card.hidden = Boolean(query) && !searchable.includes(query)
      })
    }
    const focusNextCard = (direction: 1 | -1) => {
      const cards = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-resource-library-card]')).filter((card) => !card.hidden)
      const activeIndex = Math.max(0, cards.findIndex((card) => card === document.activeElement))
      const next = cards[(activeIndex + direction + cards.length) % cards.length]
      next?.focus()
      if (next) {
        updatePreview(next)
      }
    }
    const handleSearchKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        focusNextCard(1)
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        focusNextCard(-1)
      }
    }
    const handleCardHover = (event: Event) => {
      const card = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-resource-library-card]')
      if (card) {
        updatePreview(card)
      }
    }
    searchInput.addEventListener('input', filterCards)
    searchInput.addEventListener('keydown', handleSearchKey)
    root.addEventListener('mouseover', handleCardHover)
    root.addEventListener('focusin', handleCardHover)
    cleanups.push(() => {
      searchInput.removeEventListener('input', filterCards)
      searchInput.removeEventListener('keydown', handleSearchKey)
      root.removeEventListener('mouseover', handleCardHover)
      root.removeEventListener('focusin', handleCardHover)
    })
  }
  if (searchInput && searchPopover) {
    void computePosition(searchInput, searchPopover, {
      placement: 'right-start',
      middleware: [offset(10), flip(), shift({ padding: 12 })],
    }).then(({ x, y }) => {
      searchPopover.style.left = `${Math.round(x)}px`
      searchPopover.style.top = `${Math.round(y)}px`
    })
  }

  const measureSlots = () => {
    const hostRect = root.getBoundingClientRect()
    const slotLayout = Array.from(root.querySelectorAll<HTMLElement>('.chat-resource-slot')).map((slotElement) => {
      const rect = slotElement.getBoundingClientRect()
      return {
        nodeId: slotElement.dataset.resourceSlotNode ?? '',
        slotId: slotElement.dataset.resourceSlotId ?? '',
        side: slotElement.dataset.resourceSlotSide ?? '',
        type: slotElement.dataset.resourceSlotType ?? '',
        x: Math.round(rect.left - hostRect.left + rect.width / 2),
        y: Math.round(rect.top - hostRect.top + rect.height / 2),
      }
    })
    root.dataset.resourceSlotLayout = JSON.stringify(slotLayout)
  }
  measureSlots()
  window.addEventListener('resize', measureSlots)
  cleanups.push(() => window.removeEventListener('resize', measureSlots))

  root.querySelectorAll<HTMLElement>('.chat-resource-slot').forEach((slotElement) => {
    const startSlotDrag = (event: PointerEvent) => {
      const sourceType = slotElement.dataset.resourceSlotType ?? ''
      const compatibleSlots = Array.from(root.querySelectorAll<HTMLElement>('.chat-resource-slot'))
        .filter((candidate) => candidate !== slotElement && candidate.dataset.resourceSlotType === sourceType)
      compatibleSlots.forEach((candidate) => candidate.classList.add('is-compatible-candidate'))
      root.dataset.resourceSlotDragState = JSON.stringify({
        source: {
          nodeId: slotElement.dataset.resourceSlotNode ?? '',
          slotId: slotElement.dataset.resourceSlotId ?? '',
          side: slotElement.dataset.resourceSlotSide ?? '',
          type: sourceType,
        },
        pointer: { x: Math.round(event.clientX), y: Math.round(event.clientY) },
        compatibleCount: compatibleSlots.length,
      })
      root.classList.add('is-slot-dragging')
      slotElement.setPointerCapture?.(event.pointerId)
    }
    const updateSlotDrag = (event: PointerEvent) => {
      if (!root.classList.contains('is-slot-dragging')) {
        return
      }
      const state = root.dataset.resourceSlotDragState ? JSON.parse(root.dataset.resourceSlotDragState) as Record<string, unknown> : {}
      root.dataset.resourceSlotDragState = JSON.stringify({
        ...state,
        pointer: { x: Math.round(event.clientX), y: Math.round(event.clientY) },
      })
    }
    const endSlotDrag = () => {
      root.classList.remove('is-slot-dragging')
      root.querySelectorAll<HTMLElement>('.chat-resource-slot.is-compatible-candidate').forEach((candidate) => candidate.classList.remove('is-compatible-candidate'))
    }
    slotElement.addEventListener('pointerdown', startSlotDrag)
    slotElement.addEventListener('pointermove', updateSlotDrag)
    slotElement.addEventListener('pointerup', endSlotDrag)
    slotElement.addEventListener('pointercancel', endSlotDrag)
    cleanups.push(() => {
      slotElement.removeEventListener('pointerdown', startSlotDrag)
      slotElement.removeEventListener('pointermove', updateSlotDrag)
      slotElement.removeEventListener('pointerup', endSlotDrag)
      slotElement.removeEventListener('pointercancel', endSlotDrag)
    })
  })

  createIcons({
    icons: {
      Download,
      Link2Off,
      Maximize,
      MessageCircle,
      Package,
      Play,
      RotateCcw,
      Save,
      Search,
    },
    root,
  })
  workbenchCleanups.set(root, cleanups)
}

function createCharacterResourceGraph(options: CharacterWorkflowPageOptions): CharacterResourceGraph {
  const definitions = new Map(RESOURCE_NODE_DEFINITIONS.map((definition) => [definition.type, definition]))
  const viewState = options.viewState ?? {}
  const collapsedNodeIds = new Set(viewState.collapsedNodeIds ?? [])
  const deletedNodeIds = new Set(viewState.deletedNodeIds ?? [])
  const nodes = DEFAULT_NODE_PLACEMENT.map((placement, index) => {
    const definition = definitions.get(placement.type)!
    return {
      id: placement.id,
      type: placement.type,
      title: placement.title,
      position: options.positionOverrides?.[placement.id] ?? { x: placement.x, y: placement.y },
      size: definition.defaultSize,
      status: placement.status ?? 'idle',
      collapsed: collapsedNodeIds.has(placement.id),
      zIndex: index + 1,
      config: {
        ...Object.fromEntries(definition.parameters.map((parameterItem) => [parameterItem.id, parameterItem.defaultValue])),
        ...(options.configOverrides?.[placement.id] ?? {}),
      },
    } satisfies CharacterResourceNode
  }).filter((node) => !deletedNodeIds.has(node.id))
  for (const duplicate of viewState.duplicatedNodes ?? []) {
    const sourceNode = nodes.find((node) => node.id === duplicate.sourceId)
    if (!sourceNode || deletedNodeIds.has(duplicate.id)) {
      continue
    }
    nodes.push({
      ...sourceNode,
      id: duplicate.id,
      title: `${sourceNode.title} Copy`,
      position: options.positionOverrides?.[duplicate.id] ?? {
        x: sourceNode.position.x + duplicate.offsetX,
        y: sourceNode.position.y + duplicate.offsetY,
      },
      collapsed: collapsedNodeIds.has(duplicate.id),
      zIndex: nodes.length + 1,
      config: {
        ...sourceNode.config,
        ...(options.configOverrides?.[duplicate.id] ?? {}),
      },
    })
  }
  const runArtifacts = options.runState?.artifacts ?? []
  const mockOutputs = nodes.map((node) => {
    const definition = definitions.get(node.type)!
    const artifact = runArtifacts.find((item) => item.sourceNodeId === node.id)
    return {
      id: `${node.id}-mock-output`,
      nodeId: node.id,
      type: artifact?.type ?? definition.outputs[0]?.type ?? definition.previewType,
      title: artifact?.title ?? definition.displayName,
      summary: artifact?.summary ?? createMockOutputSummary(definition, node),
      status: artifact ? 'done' : node.status,
    } satisfies CharacterResourceMockOutput
  })
  return {
    id: 'draft-character-resource-graph',
    title: 'Draft Character Resource Graph',
    nodes,
    links: DEFAULT_LINKS
      .filter((item) => !deletedNodeIds.has(item.sourceNodeId) && !deletedNodeIds.has(item.targetNodeId))
      .map((item) => ({ ...item, status: validateLink(item, nodes, definitions) ? 'valid' : 'invalid' })),
    groups: [
      { id: 'core-character', title: 'Core Character', nodeIds: ['brief-input', 'identity-card', 'persona-engine', 'dialogue-style'], color: 'rgba(82, 168, 255, 0.16)' },
      { id: 'asset-pack', title: 'Resource Pack', nodeIds: ['visual-spec', 'image-assets', 'voice-profile'], color: 'rgba(219, 189, 130, 0.16)' },
      { id: 'agent-boundary', title: 'Agent Boundary', nodeIds: ['memory-rules', 'rp-constraints', 'consistency-critic', 'agent-policy'], color: 'rgba(162, 202, 188, 0.16)' },
    ],
    tabs: [
      { id: 'workflow', title: 'Draft 01.resourcegraph', kind: 'resource-graph' },
      { id: 'package-preview', title: 'Package Preview', kind: 'package-preview' },
      { id: 'run-draft', title: 'Run Draft', kind: 'run-draft' },
    ],
    viewport: { x: 0, y: 0, zoom: viewState.zoom ?? 0.84 },
    selection: { nodeIds: [options.selectedNodeId || 'brief-input'], linkIds: [] },
    panels: {
      leftWidth: options.sidebarCollapsed ? 0 : 246,
      rightWidth: options.inspectorCollapsed ? 0 : 312,
      bottomHeight: 62,
      activePanel: options.activePanel,
    },
    mockOutputs,
  }
}

function createLiteGraphSnapshot(graph: CharacterResourceGraph): unknown {
  const liteGraph = new LGraph()
  for (const definition of RESOURCE_NODE_DEFINITIONS) {
    if (!LiteGraph.registered_node_types?.[`noema/${definition.type}`]) {
      LiteGraph.registerNodeType(`noema/${definition.type}`, class extends LGraph.LGraphNode {
        constructor(title?: string) {
          super(title ?? definition.displayName)
          this.size = [definition.defaultSize.width, definition.defaultSize.height]
          definition.inputs.forEach((input) => this.addInput(input.label, input.type))
          definition.outputs.forEach((output) => this.addOutput(output.label, output.type))
        }
      })
    }
  }
  for (const node of graph.nodes) {
    const liteNode = LiteGraph.createNode(`noema/${node.type}`, node.title)
    if (!liteNode) {
      continue
    }
    liteNode.id = Number(node.zIndex)
    liteNode.pos = [node.position.x, node.position.y]
    liteNode.size = [node.size.width, node.size.height]
    liteNode.properties = { ...node.config, noemaNodeId: node.id, status: node.status }
    liteGraph.add(liteNode)
  }
  return liteGraph.serialize()
}

function createYjsSnapshot(graph: CharacterResourceGraph, liteGraphSnapshot: unknown): string {
  const document = new Y.Doc()
  const meta = document.getMap<unknown>('characterResourceGraph')
  meta.set('id', graph.id)
  meta.set('viewport', graph.viewport)
  meta.set('panels', graph.panels)
  meta.set('selection', graph.selection)
  meta.set('liteGraph', liteGraphSnapshot)
  meta.set('serializedAt', new Date(0).toISOString())
  return JSON.stringify(meta.toJSON())
}

function renderFileTabs(options: CharacterWorkflowPageOptions): string {
  const tabs = options.tabs.length ? options.tabs : [{
    id: 'workflow',
    title: 'Draft 01.resourcegraph',
    kind: 'workflow' as const,
  }]
  return `
    <div class="chat-workflow-file-tabs" role="tablist" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '角色资源图文件' : 'Character resource graph files')}">
      ${tabs.map((tab) => renderFileTab(tab, tab.id === options.activeTabId, options)).join('')}
      <button class="chat-workflow-new-tab" type="button" data-chat-workflow-action="new-run" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '新建运行草稿' : 'New run draft')}">+</button>
    </div>
  `
}

function renderFileTab(tab: CharacterWorkflowFileTab, active: boolean, options: CharacterWorkflowPageOptions): string {
  return `
    <button class="chat-workflow-file-tab ${active ? 'active' : ''} ${tab.state ? `is-${tab.state}` : ''}" type="button" role="tab" aria-selected="${active ? 'true' : 'false'}" data-chat-workflow-tab="${options.escapeHtml(tab.id)}">
      <span class="chat-workflow-file-icon ${tab.kind}" aria-hidden="true"></span>
      <strong>${options.escapeHtml(tab.title)}</strong>
      ${tab.state ? '<span class="chat-workflow-file-state" aria-hidden="true"></span>' : ''}
      <span class="chat-workflow-file-close" data-chat-workflow-close-tab="${options.escapeHtml(tab.id)}" aria-hidden="true">×</span>
    </button>
  `
}

function renderResourceLibrary(graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions): string {
  const categories = getResourceCategories()
  const searchResults = RESOURCE_NODE_DEFINITIONS
    .slice()
    .sort((a, b) => a.category.localeCompare(b.category) || a.displayName.localeCompare(b.displayName))
  return `
    <aside class="chat-workflow-sidebar chat-resource-library" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '资源节点库' : 'Resource node library')}">
      ${renderSidebarToggle(options)}
      <div class="chat-workflow-sidebar-scroll">
        <section class="chat-workflow-sidebar-section">
          <strong>${options.escapeHtml(options.language === 'zh-CN' ? 'Resource Library' : 'Resource Library')}</strong>
          <button class="${graph.panels.activePanel === 'workflow' ? 'active' : ''}" type="button" data-chat-workflow-panel="workflow"><span>Graph</span><em>${graph.nodes.length}</em></button>
          <button class="${graph.panels.activePanel === 'assets' ? 'active' : ''}" type="button" data-chat-workflow-panel="assets"><span>Package</span><em>${graph.mockOutputs.length}</em></button>
          <button class="${graph.panels.activePanel === 'nodes' ? 'active' : ''}" type="button" data-chat-workflow-panel="nodes"><span>Nodes</span><em>${RESOURCE_NODE_DEFINITIONS.length}</em></button>
        </section>
        <section class="chat-resource-search-panel">
          <label>
            <span>${options.escapeHtml(options.language === 'zh-CN' ? '搜索节点' : 'Search nodes')}</span>
            <input type="search" value="" placeholder="${options.escapeHtml(options.language === 'zh-CN' ? '名称 / 类型 / slot' : 'name / type / slot')}" data-chat-resource-node-search>
          </label>
          <div class="chat-resource-search-results">
            ${searchResults.slice(0, 5).map((definition) => renderNodeLibraryCard(definition, graph, options)).join('')}
          </div>
          <div class="chat-resource-node-preview" data-resource-node-preview>
            <strong>${options.escapeHtml(searchResults[0]?.displayName ?? 'Node Preview')}</strong>
            <p>${options.escapeHtml(searchResults[0]?.description ?? '')}</p>
          </div>
        </section>
        <section class="chat-workflow-sidebar-section">
          <strong>${options.escapeHtml(options.language === 'zh-CN' ? 'Categories' : 'Categories')}</strong>
          ${categories.map((category) => {
            const count = RESOURCE_NODE_DEFINITIONS.filter((definition) => definition.category === category).length
            const firstNode = graph.nodes.find((node) => node.type === category)
            return `<button type="button" data-chat-workflow-panel="nodes" ${firstNode ? `data-chat-workflow-node-select="${options.escapeHtml(firstNode.id)}"` : ''}><span>${options.escapeHtml(category)}</span><em>${count}</em></button>`
          }).join('')}
        </section>
        <section class="chat-workflow-sidebar-section compact">
          <strong>${options.escapeHtml(options.language === 'zh-CN' ? 'Favorites' : 'Favorites')}</strong>
          ${RESOURCE_NODE_DEFINITIONS.filter((definition) => definition.source === 'core' || definition.source === 'agent').slice(0, 4).map((definition) => renderNodeLibraryCard(definition, graph, options)).join('')}
        </section>
      </div>
    </aside>
  `
}

function renderNodeLibraryCard(definition: CharacterResourceNodeDefinition, graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions): string {
  const existing = graph.nodes.find((node) => node.type === definition.type)
  const searchText = [
    definition.type,
    definition.displayName,
    definition.category,
    definition.source,
    ...definition.aliases,
    ...definition.inputs.map((slotItem) => slotItem.type),
    ...definition.outputs.map((slotItem) => slotItem.type),
  ].join(' ')
  return `
    <button class="chat-resource-library-card" type="button" data-resource-library-card data-resource-search-text="${options.escapeHtml(searchText)}" data-resource-preview-title="${options.escapeHtml(definition.displayName)}" data-resource-preview-body="${options.escapeHtml(definition.description)}" data-chat-workflow-panel="nodes" ${existing ? `data-chat-workflow-node-select="${options.escapeHtml(existing.id)}"` : ''}>
      <span>
        <b>${options.escapeHtml(definition.displayName)}</b>
        <small>${options.escapeHtml(definition.category)} / ${options.escapeHtml(definition.source)}</small>
      </span>
      <em>${options.escapeHtml(definition.outputs[0]?.type ?? '-')}</em>
    </button>
  `
}

function renderSidebarToggle(options: CharacterWorkflowPageOptions): string {
  const label = options.sidebarCollapsed
    ? (options.language === 'zh-CN' ? '展开资源库' : 'Expand resource library')
    : (options.language === 'zh-CN' ? '收起资源库' : 'Collapse resource library')
  return `
    <button class="chat-workflow-sidebar-toggle" type="button" data-chat-workflow-action="toggle-sidebar" aria-label="${options.escapeHtml(label)}" title="${options.escapeHtml(label)}">
      <span aria-hidden="true"></span>
    </button>
  `
}

function renderResourceCanvas(graph: CharacterResourceGraph, yjsSnapshot: string, options: CharacterWorkflowPageOptions): string {
  const activeTab = normalizeActiveTab(options.activeTabId)
  return `
    <section class="chat-workflow-canvas chat-resource-canvas" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '角色资源图画布' : 'Character resource graph canvas')}">
      ${renderCanvasControls(graph, options)}
      <div class="chat-resource-tabs">
        ${graph.tabs.map((tab) => `<button class="${tab.id === activeTab ? 'active' : ''}" type="button" data-chat-workflow-tab="${options.escapeHtml(tab.id === 'package-preview' ? 'character-pack' : tab.id)}">${options.escapeHtml(tab.title)}</button>`).join('')}
      </div>
      ${activeTab === 'package-preview' ? renderPackagePreview(graph, options) : ''}
      ${activeTab === 'run-draft' ? renderRunDraft(graph, options) : ''}
      <div class="chat-workflow-canvas-viewport ${activeTab === 'workflow' ? 'active' : 'inactive'}" data-resource-viewport="${options.escapeHtml(JSON.stringify(graph.viewport))}">
        <div class="chat-workflow-canvas-plane chat-resource-graph-plane" style="--resource-zoom: ${graph.viewport.zoom}">
          <div class="chat-workflow-canvas-grid" aria-hidden="true"></div>
          ${graph.groups.map((group) => renderGroup(group, graph, options)).join('')}
          ${options.viewState?.hideLinks ? '' : renderLinkOverlay(graph, options)}
          ${graph.nodes.map((node) => renderResourceNode(node, graph, options)).join('')}
          ${renderSelectionRectangle(graph)}
        </div>
      </div>
      <div class="chat-resource-serializer" aria-hidden="true" data-yjs-snapshot="${options.escapeHtml(yjsSnapshot)}"></div>
      ${renderNodeSearchPopover(graph, options)}
      ${renderCanvasContextMenu(options)}
    </section>
  `
}

function renderPackagePreview(graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions): string {
  const requiredTypes = ['identity', 'persona', 'scene', 'dialogue', 'rp-rule']
  const outputTypes = new Set(graph.links.map((linkItem) => linkItem.targetSlotId))
  const missing = requiredTypes.filter((type) => !outputTypes.has(type))
  const manifest = {
    id: graph.id,
    title: graph.title,
    resources: graph.mockOutputs.length,
    links: graph.links.length,
    missing,
  }
  return `
    <div class="chat-resource-tab-panel package-preview">
      <section class="chat-resource-manifest-preview">
        <header>
          <span>manifest.json</span>
          <strong>${options.escapeHtml(graph.title)}</strong>
        </header>
        <pre>${options.escapeHtml(JSON.stringify(manifest, null, 2))}</pre>
      </section>
      <section class="chat-resource-package-list">
        <header>
          <strong>Resources</strong>
          <span>${graph.mockOutputs.length}</span>
        </header>
        ${graph.mockOutputs.map((output) => `
          <article>
            <b>${options.escapeHtml(output.title)}</b>
            <span>${options.escapeHtml(output.type)} / ${options.escapeHtml(output.status)}</span>
            <p>${options.escapeHtml(output.summary)}</p>
          </article>
        `).join('')}
      </section>
      ${renderValidationPanel(graph, missing, options)}
    </div>
  `
}

function renderValidationPanel(graph: CharacterResourceGraph, missing: string[], options: CharacterWorkflowPageOptions): string {
  const invalidLinks = graph.links.filter((linkItem) => linkItem.status !== 'valid')
  const warnings = [
    ...missing.map((type) => `Missing required package input: ${type}`),
    ...invalidLinks.map((linkItem) => `Invalid link: ${linkItem.sourceNodeId} -> ${linkItem.targetNodeId}`),
  ]
  return `
    <section class="chat-resource-validation-panel">
      <header>
        <strong>Validation</strong>
        <span>${warnings.length ? `${warnings.length} issues` : 'pass'}</span>
      </header>
      ${warnings.length
        ? warnings.map((warning) => `<p>${options.escapeHtml(warning)}</p>`).join('')
        : '<p>All required resource links are present in the current graph snapshot.</p>'}
    </section>
  `
}

function renderRunDraft(graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions): string {
  const runStatus = options.runState?.run?.status ?? 'idle'
  const lifecycle = ['queued', 'running', 'done', 'failed'] as const
  return `
    <div class="chat-resource-tab-panel run-draft">
      <section class="chat-resource-run-summary">
        <header>
          <span>${options.escapeHtml(options.runState?.run?.id ?? 'no-run')}</span>
          <strong>${options.escapeHtml(options.runState?.run?.title ?? 'Run Draft')}</strong>
        </header>
        <div class="chat-resource-run-lifecycle">
          ${lifecycle.map((step) => `<i class="${runStatus === step || (runStatus === 'idle' && step === 'queued') ? 'active' : ''}">${options.escapeHtml(step)}</i>`).join('')}
        </div>
      </section>
      <section class="chat-resource-package-list">
        <header>
          <strong>Produced Artifacts</strong>
          <span>${options.escapeHtml(String(options.runState?.artifacts?.length ?? 0))}</span>
        </header>
        ${(options.runState?.artifacts ?? []).map((artifact) => `
          <article>
            <b>${options.escapeHtml(artifact.title ?? artifact.type)}</b>
            <span>${options.escapeHtml(artifact.type)} / ${options.escapeHtml(artifact.sourceNodeId)}</span>
            <p>${options.escapeHtml(artifact.summary ?? 'Mock artifact produced by the frontend lifecycle.')}</p>
          </article>
        `).join('') || '<article><b>No artifacts yet</b><span>idle</span><p>Run the resource graph mock lifecycle to populate this draft.</p></article>'}
      </section>
      <section class="chat-resource-validation-panel">
        <header>
          <strong>Agent Boundary</strong>
          <span>${graph.nodes.length} nodes</span>
        </header>
        <p>Backend agents are not called here. This draft only mirrors queued/running/done/failed frontend lifecycle state.</p>
      </section>
    </div>
  `
}

function renderCanvasControls(graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions): string {
  const running = options.runState?.run?.status === 'running'
  return `
    <div class="chat-workflow-canvas-controls chat-resource-canvas-controls" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '画布控制' : 'Canvas controls')}">
      <button class="chat-workflow-run-toggle ${running ? 'is-running' : ''}" type="button" data-chat-workflow-action="${running ? 'stop' : 'run'}" aria-label="${options.escapeHtml(running ? 'Stop mock run' : 'Run mock lifecycle')}" title="${options.escapeHtml(running ? 'Stop mock run' : 'Run mock lifecycle')}"><i icon-name="play" aria-hidden="true"></i></button>
      <button type="button" data-chat-workflow-action="fit-view" title="Fit view" aria-label="Fit view"><i icon-name="maximize" aria-hidden="true"></i></button>
      <button type="button" data-chat-workflow-action="reset-view" title="Reset view" aria-label="Reset view"><i icon-name="rotate-ccw" aria-hidden="true"></i></button>
      <button type="button" data-chat-workflow-action="toggle-links" title="Toggle links" aria-label="Toggle links"><i icon-name="link-2-off" aria-hidden="true"></i></button>
      ${renderInspectorToggle(options)}
      <span class="chat-resource-zoom-label">${Math.round(graph.viewport.zoom * 100)}%</span>
    </div>
    <div class="chat-resource-minimap" aria-label="Graph overview">
      ${graph.nodes.map((node) => `<i class="${graph.selection.nodeIds.includes(node.id) ? 'selected' : ''}" style="left:${Math.round(node.position.x / 24)}px;top:${Math.round(node.position.y / 24)}px;width:${Math.max(8, Math.round(node.size.width / 24))}px;height:${Math.max(6, Math.round(node.size.height / 24))}px"></i>`).join('')}
    </div>
  `
}

function renderInspectorToggle(options: CharacterWorkflowPageOptions): string {
  const label = options.inspectorCollapsed
    ? (options.language === 'zh-CN' ? '展开 Inspector' : 'Expand inspector')
    : (options.language === 'zh-CN' ? '收起 Inspector' : 'Collapse inspector')
  return `
    <button class="chat-workflow-inspector-toggle" type="button" data-chat-workflow-action="toggle-inspector" aria-label="${options.escapeHtml(label)}" title="${options.escapeHtml(label)}">
      <span aria-hidden="true"></span>
    </button>
  `
}

function renderGroup(group: CharacterResourceGroup, graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions): string {
  const nodes = group.nodeIds
    .map((id) => graph.nodes.find((node) => node.id === id))
    .filter((node): node is CharacterResourceNode => Boolean(node))
  if (!nodes.length) {
    return ''
  }
  const left = Math.min(...nodes.map((node) => node.position.x)) - 24
  const top = Math.min(...nodes.map((node) => node.position.y)) - 34
  const right = Math.max(...nodes.map((node) => node.position.x + node.size.width)) + 24
  const bottom = Math.max(...nodes.map((node) => node.position.y + node.size.height)) + 24
  return `<div class="chat-resource-group" style="left:${left}px;top:${top}px;width:${right - left}px;height:${bottom - top}px;--group-color:${group.color}"><span>${options.escapeHtml(group.title)}</span></div>`
}

function renderLinkOverlay(graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions): string {
  return `
    <svg class="chat-resource-link-overlay" width="2600" height="1180" viewBox="0 0 2600 1180" aria-hidden="true">
      <defs>
        <marker id="chat-resource-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z"></path>
        </marker>
      </defs>
      ${graph.links.map((linkItem) => renderLinkPath(linkItem, graph, options)).join('')}
    </svg>
  `
}

function renderLinkPath(linkItem: CharacterResourceLink, graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions): string {
  const source = graph.nodes.find((node) => node.id === linkItem.sourceNodeId)
  const target = graph.nodes.find((node) => node.id === linkItem.targetNodeId)
  if (!source || !target) {
    return ''
  }
  const sourceSlot = getSlotOffset(source, getOutputIndex(source.type, linkItem.sourceSlotId), 'output')
  const targetSlot = getSlotOffset(target, getInputIndex(target.type, linkItem.targetSlotId), 'input')
  const x1 = source.position.x + source.size.width + sourceSlot.x
  const y1 = source.position.y + sourceSlot.y
  const x2 = target.position.x + targetSlot.x
  const y2 = target.position.y + targetSlot.y
  const mid = Math.max(80, Math.abs(x2 - x1) * 0.45)
  const path = `M ${x1} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2} ${y2}`
  return `
    <g class="chat-resource-link ${options.escapeHtml(linkItem.kind)} ${options.escapeHtml(linkItem.status)}" data-chat-resource-link-id="${options.escapeHtml(linkItem.id)}">
      <path d="${path}" marker-end="url(#chat-resource-arrow)"></path>
      <text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 7}">${options.escapeHtml(LINK_KIND_LABELS[linkItem.kind])}</text>
    </g>
  `
}

function renderResourceNode(node: CharacterResourceNode, graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions): string {
  const definition = getDefinition(node.type)
  const selected = graph.selection.nodeIds.includes(node.id)
  const output = graph.mockOutputs.find((item) => item.nodeId === node.id)
  return `
    <article class="chat-workflow-node chat-resource-node ${node.status} ${definition.category} ${selected ? 'selected' : ''} ${node.collapsed ? 'collapsed' : ''}" style="--node-x: ${node.position.x}px; --node-y: ${node.position.y}px; --node-w: ${node.size.width}px; --node-h: ${node.size.height}px; z-index: ${node.zIndex}" data-chat-workflow-node-id="${options.escapeHtml(node.id)}" data-chat-workflow-node-select="${options.escapeHtml(node.id)}" data-resource-node-type="${options.escapeHtml(node.type)}">
      ${renderNodeHeader(node, definition, options)}
      ${renderNodeSlots(node, definition, options)}
      ${renderNodeWidgets(node, definition, options)}
      ${renderNodeContent(node, definition, output, options)}
      ${renderNodeFooter(node, definition, graph, options)}
    </article>
  `
}

function renderNodeHeader(node: CharacterResourceNode, definition: CharacterResourceNodeDefinition, options: CharacterWorkflowPageOptions): string {
  return `
    <header class="chat-workflow-node-head chat-resource-node-header" data-chat-workflow-drag-handle>
      <button type="button" data-chat-workflow-action="toggle-node-collapse" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '折叠节点' : 'Collapse node')}"></button>
      <span>${options.escapeHtml(definition.category)} / ${options.escapeHtml(definition.source)}</span>
      <strong>${options.escapeHtml(node.title)}</strong>
      <em>${options.escapeHtml(node.status)}</em>
    </header>
  `
}

function renderNodeSlots(node: CharacterResourceNode, definition: CharacterResourceNodeDefinition, options: CharacterWorkflowPageOptions): string {
  return `
    <div class="chat-workflow-node-ports chat-resource-node-slots">
      ${renderSlotList(node, definition.inputs, 'input', options)}
      ${renderSlotList(node, definition.outputs, 'output', options)}
    </div>
  `
}

function renderSlotList(node: CharacterResourceNode, slots: CharacterResourceSlotDefinition[], side: 'input' | 'output', options: CharacterWorkflowPageOptions): string {
  if (!slots.length) {
    return `<div class="chat-workflow-node-port-list ${side} empty"></div>`
  }
  return `
    <div class="chat-workflow-node-port-list ${side}">
      ${slots.map((slotItem) => `
        <span class="chat-workflow-node-port chat-resource-slot ${slotItem.required ? 'required' : ''}" data-resource-slot-node="${options.escapeHtml(node.id)}" data-resource-slot-id="${options.escapeHtml(slotItem.id)}" data-resource-slot-side="${side}" data-resource-slot-type="${options.escapeHtml(slotItem.type)}" title="${options.escapeHtml(slotItem.tooltip)}">
          <i class="chat-resource-slot-dot" aria-hidden="true"></i>
          <b>${options.escapeHtml(slotItem.label)}</b>
        </span>
      `).join('')}
    </div>
  `
}

function renderNodeWidgets(node: CharacterResourceNode, definition: CharacterResourceNodeDefinition, options: CharacterWorkflowPageOptions): string {
  return `
    <div class="chat-resource-node-widgets">
      ${definition.parameters.slice(0, 3).map((parameterItem) => `
        <label>
          <span>${options.escapeHtml(parameterItem.label)}</span>
          ${renderParameterField(parameterItem, node, node.config[parameterItem.id], options)}
        </label>
      `).join('')}
    </div>
  `
}

function renderNodeContent(
  node: CharacterResourceNode,
  definition: CharacterResourceNodeDefinition,
  output: CharacterResourceMockOutput | undefined,
  options: CharacterWorkflowPageOptions
): string {
  const previewClass = `preview-${definition.previewType}`
  return `
    <div class="chat-resource-node-content ${previewClass}">
      <strong>${options.escapeHtml(output?.title ?? definition.displayName)}</strong>
      <p>${options.escapeHtml(output?.summary ?? definition.description)}</p>
    </div>
  `
}

function renderNodeFooter(
  node: CharacterResourceNode,
  definition: CharacterResourceNodeDefinition,
  graph: CharacterResourceGraph,
  options: CharacterWorkflowPageOptions
): string {
  const inbound = graph.links.filter((linkItem) => linkItem.targetNodeId === node.id).length
  const outbound = graph.links.filter((linkItem) => linkItem.sourceNodeId === node.id).length
  return `
    <footer class="chat-resource-node-footer">
      <span>${options.escapeHtml(`${inbound} in / ${outbound} out`)}</span>
      <button type="button" data-chat-workflow-node-select="${options.escapeHtml(node.id)}">${options.escapeHtml(definition.previewType)}</button>
    </footer>
  `
}

function renderResourceInspector(graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions): string {
  const selectedNode = graph.nodes.find((node) => graph.selection.nodeIds.includes(node.id)) ?? graph.nodes[0]
  const definition = getDefinition(selectedNode.type)
  const output = graph.mockOutputs.find((item) => item.nodeId === selectedNode.id)
  return `
    <aside class="chat-workflow-inspector chat-resource-inspector" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '资源 Inspector' : 'Resource inspector')}">
      <div class="chat-workflow-inspector-scroll">
        <header class="chat-workflow-inspector-head">
          <span>${options.escapeHtml(`${definition.category} / ${definition.source} / ${definition.previewType}`)}</span>
          <strong>${options.escapeHtml(selectedNode.title)}</strong>
          <small>${options.escapeHtml(definition.description)}</small>
        </header>
        <section class="chat-workflow-inspector-section">
          <h4>${options.escapeHtml(options.language === 'zh-CN' ? '参数' : 'Parameters')}</h4>
          <div class="chat-workflow-inspector-fields">
            ${definition.parameters.map((parameterItem) => renderInspectorParameter(parameterItem, selectedNode, selectedNode.config[parameterItem.id], options)).join('')}
          </div>
        </section>
        <section class="chat-workflow-inspector-section">
          <h4>Slots</h4>
          <div class="chat-workflow-inspector-ports">
            ${definition.inputs.map((slotItem) => `<span><b>IN</b>${options.escapeHtml(slotItem.label)}<small>${options.escapeHtml(slotItem.type)}</small></span>`).join('') || '<span><b>IN</b>-</span>'}
            ${definition.outputs.map((slotItem) => `<span><b>OUT</b>${options.escapeHtml(slotItem.label)}<small>${options.escapeHtml(slotItem.type)}</small></span>`).join('')}
          </div>
        </section>
        <section class="chat-workflow-inspector-section">
          <h4>${options.escapeHtml(options.language === 'zh-CN' ? 'Mock Output' : 'Mock Output')}</h4>
          <div class="chat-resource-output-card">
            <strong>${options.escapeHtml(output?.title ?? definition.displayName)}</strong>
            <p>${options.escapeHtml(output?.summary ?? '')}</p>
            <span>${options.escapeHtml(output?.status ?? selectedNode.status)}</span>
          </div>
        </section>
        <section class="chat-workflow-inspector-section">
          <h4>Link Kinds</h4>
          <div class="chat-resource-link-kind-list">
            ${(Object.keys(LINK_KIND_LABELS) as CharacterResourceLinkKind[]).map((kind) => `<button type="button" data-chat-workflow-action="set-link-kind" title="${options.escapeHtml(kind)}">${options.escapeHtml(kind)}</button>`).join('')}
          </div>
        </section>
      </div>
    </aside>
  `
}

function renderInspectorParameter(
  parameterItem: CharacterResourceParameterDefinition,
  node: CharacterResourceNode,
  value: unknown,
  options: CharacterWorkflowPageOptions
): string {
  return `
    <label class="chat-workflow-inspector-field">
      <span>${options.escapeHtml(parameterItem.label)}</span>
      ${renderParameterField(parameterItem, node, value ?? parameterItem.defaultValue, options)}
    </label>
  `
}

function renderParameterField(
  parameterItem: CharacterResourceParameterDefinition,
  node: CharacterResourceNode,
  value: unknown,
  options: CharacterWorkflowPageOptions
): string {
  const baseAttrs = `data-chat-workflow-param="${options.escapeHtml(parameterItem.id)}" data-chat-workflow-node="${options.escapeHtml(node.id)}" data-chat-workflow-param-type="${options.escapeHtml(parameterItem.type)}"`
  if (parameterItem.type === 'boolean') {
    return `<input type="checkbox" ${baseAttrs} ${value ? 'checked' : ''} aria-label="${options.escapeHtml(parameterItem.label)}">`
  }
  if (parameterItem.type === 'number' || parameterItem.type === 'integer') {
    return `<input type="number" ${baseAttrs} value="${options.escapeHtml(formatParameterValue(value))}" ${parameterItem.min === undefined ? '' : `min="${parameterItem.min}"`} ${parameterItem.max === undefined ? '' : `max="${parameterItem.max}"`} ${parameterItem.step === undefined ? '' : `step="${parameterItem.step}"`} aria-label="${options.escapeHtml(parameterItem.label)}">`
  }
  if (parameterItem.type === 'select') {
    return `
      <select ${baseAttrs} aria-label="${options.escapeHtml(parameterItem.label)}">
        ${(parameterItem.options ?? []).map((optionItem) => `<option value="${options.escapeHtml(optionItem.value)}" ${String(value) === optionItem.value ? 'selected' : ''}>${options.escapeHtml(optionItem.label)}</option>`).join('')}
      </select>
    `
  }
  if (parameterItem.type === 'multi-select' || parameterItem.type === 'string-list') {
    return `<input type="text" ${baseAttrs} value="${options.escapeHtml(formatParameterValue(value))}" aria-label="${options.escapeHtml(parameterItem.label)}">`
  }
  if (parameterItem.type === 'textarea') {
    return `<textarea ${baseAttrs} rows="2" aria-label="${options.escapeHtml(parameterItem.label)}">${options.escapeHtml(formatParameterValue(value))}</textarea>`
  }
  return `<input type="text" ${baseAttrs} value="${options.escapeHtml(formatParameterValue(value))}" aria-label="${options.escapeHtml(parameterItem.label)}">`
}

function renderBottomToolbar(graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions): string {
  const packageNode = graph.nodes.find((node) => node.type === 'export')
  const validationIssues = graph.links.filter((linkItem) => linkItem.status !== 'valid').length
  return `
    <footer class="chat-resource-bottom-toolbar">
      <div>
        <strong>${options.escapeHtml(graph.title)}</strong>
        <span>${options.escapeHtml(`${graph.nodes.length} nodes / ${graph.links.length} links / ${validationIssues} issues`)}</span>
      </div>
      <button type="button" data-chat-workflow-action="save-graph"><i icon-name="save" aria-hidden="true"></i><span>Save</span></button>
      <button type="button" data-chat-workflow-tab="character-pack" ${packageNode ? `data-chat-workflow-node-select="${options.escapeHtml(packageNode.id)}"` : ''}><i icon-name="package" aria-hidden="true"></i><span>Preview</span></button>
      <button type="button" data-chat-workflow-node-select="consistency-critic">Validate</button>
      <button type="button" data-chat-workflow-action="chat-test"><i icon-name="message-circle" aria-hidden="true"></i><span>Chat Test</span></button>
      <button type="button" data-chat-workflow-action="export"><i icon-name="download" aria-hidden="true"></i><span>Export</span></button>
    </footer>
  `
}

function renderNodeSearchPopover(graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions): string {
  const candidates = definitionFuse.search('persona').map((result) => result.item).slice(0, 6)
  return `
    <div class="chat-resource-node-search-popover" role="dialog" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '节点搜索' : 'Node search')}">
      <header>
        <strong>${options.escapeHtml(options.language === 'zh-CN' ? '添加可连接节点' : 'Add connectable node')}</strong>
        <span>${options.escapeHtml(String(candidates.length))}</span>
      </header>
      ${candidates.map((definition) => renderNodeLibraryCard(definition, graph, options)).join('')}
    </div>
  `
}

function renderCanvasContextMenu(options: CharacterWorkflowPageOptions): string {
  return `
    <div class="chat-resource-context-menu" role="menu" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '画布菜单' : 'Canvas menu')}">
      <button type="button" role="menuitem" data-chat-workflow-action="open-node-search">Add Node</button>
      <button type="button" role="menuitem" data-chat-workflow-action="fit-view">Fit View</button>
      <button type="button" role="menuitem" data-chat-workflow-action="duplicate-selection">Duplicate</button>
      <button type="button" role="menuitem" data-chat-workflow-action="delete-selection">Delete</button>
    </div>
  `
}

function renderSelectionRectangle(graph: CharacterResourceGraph): string {
  const selected = graph.nodes.find((node) => graph.selection.nodeIds.includes(node.id))
  if (!selected) {
    return ''
  }
  return `<div class="chat-resource-selection-rectangle" style="left:${selected.position.x - 5}px;top:${selected.position.y - 5}px;width:${selected.size.width + 10}px;height:${selected.size.height + 10}px"></div>`
}

function createDefinition(
  type: string,
  displayName: string,
  aliases: string[],
  category: string,
  source: CharacterResourceNodeDefinition['source'],
  description: string,
  inputs: CharacterResourceSlotDefinition[],
  outputs: CharacterResourceSlotDefinition[],
  parameters: CharacterResourceParameterDefinition[],
  previewType: CharacterResourcePreviewType
): CharacterResourceNodeDefinition {
  return {
    type,
    displayName,
    aliases,
    category,
    source,
    description,
    inputs,
    outputs,
    parameters,
    defaultSize: { width: 268, height: 226 },
    previewType,
  }
}

function slot(id: string, label: string, type: string, tooltip = '', required = false): CharacterResourceSlotDefinition {
  return { id, label, type, required, tooltip: tooltip || type }
}

function param(
  id: string,
  label: string,
  type: CharacterResourceParameterType,
  defaultValue: unknown,
  min?: number,
  max?: number,
  step?: number,
  options?: Array<{ label: string; value: string }>
): CharacterResourceParameterDefinition {
  return { id, label, type, defaultValue, min, max, step, options }
}

function link(
  sourceNodeId: string,
  sourceSlotId: string,
  targetNodeId: string,
  targetSlotId: string,
  kind: CharacterResourceLinkKind
): CharacterResourceLink {
  return {
    id: `${sourceNodeId}:${sourceSlotId}->${targetNodeId}:${targetSlotId}`,
    sourceNodeId,
    sourceSlotId,
    targetNodeId,
    targetSlotId,
    kind,
    label: LINK_KIND_LABELS[kind],
    status: 'valid',
  }
}

function validateLink(
  linkItem: CharacterResourceLink,
  nodes: CharacterResourceNode[],
  definitions: Map<string, CharacterResourceNodeDefinition>
): boolean {
  const source = nodes.find((node) => node.id === linkItem.sourceNodeId)
  const target = nodes.find((node) => node.id === linkItem.targetNodeId)
  if (!source || !target) {
    return false
  }
  const sourceSlot = definitions.get(source.type)?.outputs.find((slotItem) => slotItem.id === linkItem.sourceSlotId)
  const targetSlot = definitions.get(target.type)?.inputs.find((slotItem) => slotItem.id === linkItem.targetSlotId)
  return Boolean(sourceSlot && targetSlot && sourceSlot.type === targetSlot.type)
}

function getDefinition(type: string): CharacterResourceNodeDefinition {
  return RESOURCE_NODE_DEFINITIONS.find((definition) => definition.type === type) ?? RESOURCE_NODE_DEFINITIONS[0]
}

function getResourceCategories(): string[] {
  return [...new Set(RESOURCE_NODE_DEFINITIONS.map((definition) => definition.category))]
}

function getInputIndex(type: string, slotId: string): number {
  return Math.max(0, getDefinition(type).inputs.findIndex((slotItem) => slotItem.id === slotId))
}

function getOutputIndex(type: string, slotId: string): number {
  return Math.max(0, getDefinition(type).outputs.findIndex((slotItem) => slotItem.id === slotId))
}

function getSlotOffset(node: CharacterResourceNode, index: number, side: 'input' | 'output'): { x: number; y: number } {
  return {
    x: side === 'input' ? 0 : 0,
    y: 64 + index * 23,
  }
}

function normalizeActiveTab(activeTabId: string): string {
  if (activeTabId === 'character-pack') {
    return 'package-preview'
  }
  if (activeTabId.startsWith('run-') || activeTabId.startsWith('resource-run-')) {
    return 'run-draft'
  }
  return activeTabId
}

function createMockOutputSummary(definition: CharacterResourceNodeDefinition, node: CharacterResourceNode): string {
  if (definition.previewType === 'image') {
    return 'Mock image resources are reserved in graph state; backend image generation is not called in this phase.'
  }
  if (definition.previewType === 'voice') {
    return 'Mock voice profile includes timbre, speed, and sample-line constraints for later TTS generation.'
  }
  if (definition.previewType === 'validation') {
    return 'Mock validation checks required slots, incompatible links, missing outputs, and package completeness.'
  }
  if (definition.previewType === 'package') {
    return 'Mock package manifest combines character card, resources, runtime state, validation, and chat-test entry.'
  }
  return `${definition.displayName} is configured by ${Object.keys(node.config).length} parameter fields and participates in the resource graph.`
}

function formatParameterValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length ? value.join(', ') : ''
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (value === undefined || value === null) {
    return ''
  }
  return String(value)
}
