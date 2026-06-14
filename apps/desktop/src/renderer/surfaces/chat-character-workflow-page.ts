/**
 * Renders the character resource graph workbench for the chat surface.
 */
import Fuse from 'fuse.js'
import Split from 'split-grid'
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/dist/esm/adapter/element-adapter.js'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import { LGraph, LGraphNode, LiteGraph } from 'litegraph.js'
import { Download, Link2Off, Maximize, MessageCircle, Package, Play, RotateCcw, Save, Search, createIcons } from 'lucide'
import * as Y from 'yjs'
import type { CharacterResourceViewState, SerializedCharacterResourceLinkKind } from './chat-character-resource-graph-state'

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
  nodeSearchOpen?: boolean
  viewState?: CharacterResourceViewState
}

export interface CharacterWorkflowFileTab {
  id: string
  title: string
  kind: 'workflow' | 'run' | 'character'
  state?: 'running' | 'failed' | 'dirty'
}

export type CharacterWorkflowSidePanel = 'workflow' | 'assets' | 'nodes'

type CharacterResourceNodeStatus = 'idle' | 'dirty' | 'queued' | 'running' | 'done' | 'failed' | 'stale' | 'disabled'
type CharacterResourcePreviewType = 'text-card' | 'image' | 'voice' | 'rule' | 'validation' | 'package'
type CharacterResourceParameterType = 'text' | 'textarea' | 'number' | 'integer' | 'boolean' | 'select' | 'multi-select' | 'string-list'
type CharacterResourceLinkKind = SerializedCharacterResourceLinkKind
type CharacterWorkflowLanguage = CharacterWorkflowPageOptions['language']

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
      { type: 'agent-plan', sourceNodeId: 'generation-strategy', title: 'Agent Plan', summary: 'Mock plan decomposes the free-form goal into candidates, tools, critique loops, and output targets.' },
      { type: 'candidate-pack', sourceNodeId: 'asset-targets', title: 'Candidate Pack', summary: 'Mock candidate pack reserves role card, opening, visual assets, memory policy, and generation report outputs.' },
      { type: 'validation-report', sourceNodeId: 'quality-gate', title: 'Quality Gate Report', summary: 'Mock quality gate checks goal match, long-term RP durability, style intensity, consistency, and export readiness.' },
      { type: 'chat-test-result', sourceNodeId: 'chat-test', title: 'Chat Test Result', summary: 'Mock first-turn pressure test reports OOC risk, target hit rate, and repair suggestions.' },
      { type: 'export-target', sourceNodeId: 'output-adapter', title: 'Noema Role Chat Export', summary: 'Mock output adapter maps the accepted candidate pack to a Noema Role Chat package.' },
    ],
  }
}

const LINK_KIND_LABELS: Record<CharacterResourceLinkKind, string> = {
  guides: 'guides',
  constrains: 'constrains',
  provides: 'provides',
  enables: 'enables',
  grounds: 'grounds',
  weights: 'weights',
  routes: 'routes',
  evaluates: 'evaluates',
  refines: 'refines',
  exports: 'exports',
}

function ui(options: CharacterWorkflowPageOptions, zh: string, en: string): string {
  return options.language === 'zh-CN' ? zh : en
}

function localizeByLanguage(language: CharacterWorkflowLanguage, zh: string, en: string): string {
  return language === 'zh-CN' ? zh : en
}

function resourceGraphTabTitle(tab: CharacterResourceGraphTab, options: CharacterWorkflowPageOptions): string {
  if (tab.id === 'workflow') {
    return ui(options, '草稿 01.resourcegraph', 'Draft 01.resourcegraph')
  }
  if (tab.id === 'package-preview') {
    return ui(options, '资源包预览', 'Package Preview')
  }
  if (tab.id === 'run-draft') {
    return ui(options, '运行草稿', 'Run Draft')
  }
  return tab.title
}

function statusLabel(status: string, options: CharacterWorkflowPageOptions): string {
  const labels: Record<string, { zh: string; en: string }> = {
    idle: { zh: '空闲', en: 'idle' },
    dirty: { zh: '已修改', en: 'dirty' },
    queued: { zh: '排队中', en: 'queued' },
    running: { zh: '运行中', en: 'running' },
    done: { zh: '完成', en: 'done' },
    failed: { zh: '失败', en: 'failed' },
    stale: { zh: '需刷新', en: 'stale' },
    disabled: { zh: '禁用', en: 'disabled' },
    valid: { zh: '有效', en: 'valid' },
    warning: { zh: '警告', en: 'warning' },
    invalid: { zh: '无效', en: 'invalid' },
    hidden: { zh: '隐藏', en: 'hidden' },
  }
  const label = labels[status]
  return label ? localizeByLanguage(options.language, label.zh, label.en) : status
}

const RESOURCE_NODE_DEFINITIONS: CharacterResourceNodeDefinition[] = [
  createDefinition('goal', 'Generation Goal', ['目标', 'brief', 'intent'], 'Goal', 'core', 'Captures the free-form RP generation target without asking the user to define final card fields.', [], [
    slot('goal', 'Goal', 'generation-goal', 'Natural language generation goal and target audience.'),
  ], [
    param('goalPrompt', 'Goal Prompt', 'textarea', '校园恋爱，长期 RP，角色要有主动性和暧昧拉扯，但不要模板化。'),
    param('targetAudience', 'Target Audience', 'text', 'private long-form roleplay'),
    param('allowExpansion', 'Allow Agent Expansion', 'boolean', true),
  ], 'text-card'),
  createDefinition('style-pressure', 'Style Pressure', ['风格', 'taste', 'tone'], 'Taste', 'core', 'Applies weighted taste, genre, mood, intensity, and pacing pressure to the agent.', [
    slot('goal', 'Goal', 'generation-goal', 'Goal being shaped by this taste profile.', true),
  ], [
    slot('style', 'Style', 'style-signal', 'Weighted style signal.'),
  ], [
    param('preset', 'Preset', 'select', 'campus-romance', undefined, undefined, undefined, [
      { label: 'Campus Romance', value: 'campus-romance' },
      { label: 'Dark Adult', value: 'dark-adult' },
      { label: 'Urban Suspense', value: 'urban-suspense' },
      { label: 'Fantasy Companion', value: 'fantasy-companion' },
    ]),
    param('intensity', 'Intensity', 'number', 0.68, 0, 1, 0.01),
    param('stylePrompt', 'Style Prompt', 'textarea', '克制、暧昧、有张力，避免说明书式自我介绍。'),
  ], 'rule'),
  createDefinition('constraint', 'Hard Constraint', ['约束', 'boundary', 'must not'], 'Constraints', 'safety', 'Sets hard and soft boundaries that limit agent freedom during generation and repair.', [
    slot('goal', 'Goal', 'generation-goal', 'Goal constrained by these boundaries.'),
  ], [
    slot('constraint', 'Constraint', 'hard-constraint', 'Constraint signal.'),
  ], [
    param('mustHave', 'Must Have', 'string-list', ['长期可聊', '角色主动推进关系']),
    param('mustNot', 'Must Not', 'string-list', ['模板化人格', 'OOC 解释设定', '瞬间顺从']),
    param('hardBoundary', 'Hard Boundary', 'boolean', true),
  ], 'rule'),
  createDefinition('source-material', 'Source Material', ['素材', 'reference', 'context'], 'Sources', 'asset', 'Provides optional source context, references, existing cards, images, or user preference notes.', [], [
    slot('source', 'Source', 'source-context', 'Reference context available to the agent.'),
  ], [
    param('sourceKind', 'Source Kind', 'select', 'notes', undefined, undefined, undefined, [
      { label: 'Notes', value: 'notes' },
      { label: 'Existing Card', value: 'existing-card' },
      { label: 'Image Reference', value: 'image-reference' },
      { label: 'User Preference', value: 'user-preference' },
    ]),
    param('notes', 'Notes', 'textarea', ''),
    param('groundingStrength', 'Grounding Strength', 'number', 0.5, 0, 1, 0.01),
  ], 'text-card'),
  createDefinition('llm-tool', 'LLM Tool', ['模型', 'llm', 'reasoning'], 'Tools', 'agent', 'Selects the LLM capability available to the backend agent.', [], [
    slot('model', 'Model', 'model-capability', 'LLM model capability.'),
  ], [
    param('provider', 'Provider', 'select', 'default', undefined, undefined, undefined, [
      { label: 'Default', value: 'default' },
      { label: 'OpenAI Compatible', value: 'openai-compatible' },
      { label: 'Local', value: 'local' },
    ]),
    param('model', 'Model', 'text', ''),
    param('temperature', 'Temperature', 'number', 0.72, 0, 2, 0.01),
    param('reasoningEffort', 'Reasoning Effort', 'select', 'medium', undefined, undefined, undefined, [
      { label: 'Low', value: 'low' },
      { label: 'Medium', value: 'medium' },
      { label: 'High', value: 'high' },
    ]),
  ], 'rule'),
  createDefinition('image-tool', 'Image Tool', ['生图', 'image api', 'visual'], 'Tools', 'asset', 'Selects image generation or editing capability for avatar, body art, expressions, and scene references.', [
    slot('style', 'Style', 'style-signal', 'Style pressure for generated image assets.'),
  ], [
    slot('image', 'Image', 'image-capability', 'Image generation capability.'),
  ], [
    param('provider', 'Provider', 'select', 'manual', undefined, undefined, undefined, [
      { label: 'Manual', value: 'manual' },
      { label: 'ComfyUI Workflow', value: 'comfyui-workflow' },
      { label: 'Hosted API', value: 'hosted-api' },
    ]),
    param('model', 'Model / Workflow', 'text', ''),
    param('assetCount', 'Asset Count', 'integer', 4, 1, 16, 1),
    param('referenceStrength', 'Reference Strength', 'number', 0.55, 0, 1, 0.01),
  ], 'image'),
  createDefinition('retrieval-tool', 'Retrieval Tool', ['检索', 'search', 'knowledge'], 'Tools', 'agent', 'Allows the agent to read local context, vector sources, or web summaries when enabled.', [
    slot('source', 'Source', 'source-context', 'Source context that can be indexed.'),
  ], [
    slot('retrieval', 'Retrieval', 'retrieval-capability', 'Retrieval capability.'),
  ], [
    param('enabled', 'Enabled', 'boolean', false),
    param('mode', 'Mode', 'select', 'local-only', undefined, undefined, undefined, [
      { label: 'Local Only', value: 'local-only' },
      { label: 'Vector Index', value: 'vector-index' },
      { label: 'Web Summary', value: 'web-summary' },
    ]),
    param('citationRequired', 'Citation Required', 'boolean', true),
  ], 'rule'),
  createDefinition('voice-tool', 'Voice Tool', ['语音', 'tts', 'voice'], 'Tools', 'asset', 'Selects voice or TTS capability for sample lines and voice profile assets.', [
    slot('style', 'Style', 'style-signal', 'Tone and delivery style.'),
  ], [
    slot('voice', 'Voice', 'voice-capability', 'Voice generation capability.'),
  ], [
    param('provider', 'Provider', 'text', ''),
    param('voice', 'Voice', 'text', ''),
    param('speed', 'Speed', 'number', 1, 0.5, 1.5, 0.01),
  ], 'voice'),
  createDefinition('agent-policy', 'Agent Policy', ['agent', '自主', 'policy'], 'Agent', 'agent', 'Defines how much freedom the backend agent has to expand, revise, ask, and repair.', [
    slot('goal', 'Goal', 'generation-goal', 'Primary target.', true),
    slot('constraint', 'Constraint', 'hard-constraint', 'Hard autonomy limits.'),
    slot('source', 'Source', 'source-context', 'Grounding source context.'),
    slot('model', 'Model', 'model-capability', 'LLM capability used by the agent.', true),
  ], [
    slot('policy', 'Policy', 'agent-policy', 'Agent autonomy policy.'),
  ], [
    param('autonomyLevel', 'Autonomy Level', 'select', 'high', undefined, undefined, undefined, [
      { label: 'Low', value: 'low' },
      { label: 'Medium', value: 'medium' },
      { label: 'High', value: 'high' },
    ]),
    param('revisionBudget', 'Revision Budget', 'integer', 4, 1, 12, 1),
    param('askUserThreshold', 'Ask User Threshold', 'select', 'blocked-only', undefined, undefined, undefined, [
      { label: 'Never During Run', value: 'never' },
      { label: 'Blocked Only', value: 'blocked-only' },
      { label: 'Low Confidence', value: 'low-confidence' },
    ]),
  ], 'rule'),
  createDefinition('generation-strategy', 'Generation Strategy', ['策略', 'workflow', 'plan'], 'Strategy', 'agent', 'Controls how the agent branches, compares candidates, orders phases, and stops.', [
    slot('goal', 'Goal', 'generation-goal', 'Goal to plan around.', true),
    slot('style', 'Style', 'style-signal', 'Style pressure.'),
    slot('policy', 'Policy', 'agent-policy', 'Agent autonomy policy.', true),
  ], [
    slot('strategy', 'Strategy', 'strategy-policy', 'Generation strategy.'),
  ], [
    param('mode', 'Mode', 'select', 'branch-and-refine', undefined, undefined, undefined, [
      { label: 'Single Pass', value: 'single-pass' },
      { label: 'Branch and Refine', value: 'branch-and-refine' },
      { label: 'Explore then Converge', value: 'explore-then-converge' },
    ]),
    param('branchCount', 'Branch Count', 'integer', 3, 1, 8, 1),
    param('priorityAssets', 'Priority Assets', 'multi-select', ['role-card', 'opening', 'image-pack'], undefined, undefined, undefined, [
      { label: 'Role Card', value: 'role-card' },
      { label: 'Opening', value: 'opening' },
      { label: 'Image Pack', value: 'image-pack' },
      { label: 'Chat Test', value: 'chat-test' },
    ]),
  ], 'rule'),
  createDefinition('critique-loop', 'Critique Loop', ['自评', 'repair', 'critic'], 'Evaluation', 'agent', 'Feeds critique and repair instructions back into candidate generation.', [
    slot('strategy', 'Strategy', 'strategy-policy', 'Strategy to refine.', true),
  ], [
    slot('critique', 'Critique', 'critique-policy', 'Critique and repair policy.'),
  ], [
    param('iterations', 'Iterations', 'integer', 2, 0, 8, 1),
    param('dimensions', 'Dimensions', 'string-list', ['goal match', 'long-term RP', 'non-template', 'consistency']),
    param('autoRepair', 'Auto Repair', 'boolean', true),
  ], 'validation'),
  createDefinition('quality-gate', 'Quality Gate', ['质量', 'validation', 'acceptance'], 'Evaluation', 'safety', 'Defines acceptance criteria that can block export or route candidates back for repair.', [
    slot('goal', 'Goal', 'generation-goal', 'Original target.', true),
    slot('candidate', 'Candidate', 'candidate-pack', 'Candidate pack to evaluate.', true),
    slot('critique', 'Critique', 'critique-policy', 'Critique policy.'),
  ], [
    slot('report', 'Report', 'validation-report', 'Quality gate report.'),
  ], [
    param('minimumScore', 'Minimum Score', 'number', 0.82, 0, 1, 0.01),
    param('blockExport', 'Block Export', 'boolean', true),
    param('requiredChecks', 'Required Checks', 'string-list', ['goal match', 'style intensity', 'long-term RP', 'consistency']),
  ], 'validation'),
  createDefinition('asset-builder', 'Asset Builder', ['资源', 'outputs', 'package target'], 'Outputs', 'asset', 'Declares which final resources the agent should produce without forcing the user to write their contents.', [
    slot('strategy', 'Strategy', 'strategy-policy', 'Generation strategy.', true),
    slot('image', 'Image', 'image-capability', 'Optional image capability.'),
    slot('voice', 'Voice', 'voice-capability', 'Optional voice capability.'),
  ], [
    slot('assets', 'Assets', 'asset-target', 'Requested resource targets.'),
    slot('candidate', 'Candidate', 'candidate-pack', 'Candidate pack produced by the mock lifecycle.'),
  ], [
    param('targets', 'Targets', 'multi-select', ['role-card', 'opening', 'image-pack', 'generation-report'], undefined, undefined, undefined, [
      { label: 'Role Card', value: 'role-card' },
      { label: 'Opening', value: 'opening' },
      { label: 'Image Pack', value: 'image-pack' },
      { label: 'Voice Sample', value: 'voice-sample' },
      { label: 'Generation Report', value: 'generation-report' },
    ]),
    param('includeAlternates', 'Include Alternates', 'boolean', true),
  ], 'package'),
  createDefinition('output-adapter', 'Output Adapter', ['导出', 'adapter', 'format'], 'Outputs', 'core', 'Maps an accepted candidate pack to a target format without changing generation goals.', [
    slot('candidate', 'Candidate', 'candidate-pack', 'Accepted candidate pack.', true),
    slot('report', 'Report', 'validation-report', 'Quality gate report.', true),
  ], [
    slot('export', 'Export', 'export-target', 'Export target.'),
  ], [
    param('format', 'Format', 'select', 'noema-role-chat', undefined, undefined, undefined, [
      { label: 'Noema Role Chat', value: 'noema-role-chat' },
      { label: 'SillyTavern', value: 'sillytavern' },
      { label: 'Portable JSON', value: 'portable-json' },
      { label: 'Markdown Dossier', value: 'markdown-dossier' },
    ]),
    param('includeAssets', 'Include Assets', 'boolean', true),
  ], 'package'),
  createDefinition('chat-test', 'Chat Test', ['试聊', 'chat', 'test'], 'Evaluation', 'agent', 'Runs a mock first-turn and durability check against the exported candidate.', [
    slot('export', 'Export', 'export-target', 'Export target to test.', true),
  ], [
    slot('result', 'Result', 'chat-test-result', 'Chat test result and repair suggestions.'),
  ], [
    param('turns', 'Turns', 'integer', 3, 1, 12, 1),
    param('stressPrompt', 'Stress Prompt', 'textarea', '测试角色是否保持主动性、边界和长期可聊性。'),
  ], 'validation'),
]

const DEFAULT_NODE_PLACEMENT: Array<{ id: string; type: string; title: string; x: number; y: number; status?: CharacterResourceNodeStatus }> = [
  { id: 'generation-goal', type: 'goal', title: 'Generation Goal', x: 88, y: 96, status: 'dirty' },
  { id: 'style-pressure', type: 'style-pressure', title: 'Style Pressure', x: 420, y: 48 },
  { id: 'hard-constraints', type: 'constraint', title: 'Hard Constraints', x: 420, y: 292 },
  { id: 'source-material', type: 'source-material', title: 'Source Material', x: 88, y: 360 },
  { id: 'llm-capability', type: 'llm-tool', title: 'LLM Tool', x: 760, y: 54 },
  { id: 'image-capability', type: 'image-tool', title: 'Image Tool', x: 760, y: 300, status: 'queued' },
  { id: 'agent-policy', type: 'agent-policy', title: 'Agent Policy', x: 1096, y: 104 },
  { id: 'generation-strategy', type: 'generation-strategy', title: 'Generation Strategy', x: 1434, y: 104 },
  { id: 'asset-targets', type: 'asset-builder', title: 'Asset Builder', x: 1772, y: 132 },
  { id: 'critique-loop', type: 'critique-loop', title: 'Critique Loop', x: 1434, y: 404 },
  { id: 'quality-gate', type: 'quality-gate', title: 'Quality Gate', x: 2110, y: 230, status: 'stale' },
  { id: 'output-adapter', type: 'output-adapter', title: 'Output Adapter', x: 2448, y: 230 },
  { id: 'chat-test', type: 'chat-test', title: 'Chat Test', x: 2786, y: 230 },
]

const DEFAULT_LINKS: CharacterResourceLink[] = [
  link('generation-goal', 'goal', 'style-pressure', 'goal', 'guides'),
  link('generation-goal', 'goal', 'hard-constraints', 'goal', 'constrains'),
  link('generation-goal', 'goal', 'agent-policy', 'goal', 'guides'),
  link('style-pressure', 'style', 'generation-strategy', 'style', 'weights'),
  link('hard-constraints', 'constraint', 'agent-policy', 'constraint', 'constrains'),
  link('source-material', 'source', 'agent-policy', 'source', 'grounds'),
  link('llm-capability', 'model', 'agent-policy', 'model', 'enables'),
  link('style-pressure', 'style', 'image-capability', 'style', 'guides'),
  link('image-capability', 'image', 'asset-targets', 'image', 'enables'),
  link('agent-policy', 'policy', 'generation-strategy', 'policy', 'guides'),
  link('generation-goal', 'goal', 'generation-strategy', 'goal', 'guides'),
  link('generation-strategy', 'strategy', 'asset-targets', 'strategy', 'routes'),
  link('generation-strategy', 'strategy', 'critique-loop', 'strategy', 'routes'),
  link('critique-loop', 'critique', 'quality-gate', 'critique', 'evaluates'),
  link('asset-targets', 'candidate', 'quality-gate', 'candidate', 'evaluates'),
  link('quality-gate', 'report', 'generation-strategy', 'strategy', 'refines'),
  link('asset-targets', 'candidate', 'output-adapter', 'candidate', 'exports'),
  link('quality-gate', 'report', 'output-adapter', 'report', 'constrains'),
  link('output-adapter', 'export', 'chat-test', 'export', 'routes'),
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
    <div class="chat-character-workflow-shell chat-resource-workbench ${options.nodeSearchOpen ? 'is-node-search-open' : ''}" data-resource-graph-id="${options.escapeHtml(graph.id)}" data-resource-placement-label="${options.escapeHtml(ui(options, '放置位置', 'Placement'))}">
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
      contextMenu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    }
    const closeContextMenu = () => contextMenu?.classList.remove('is-open')
    const handleContextMenuKey = (event: KeyboardEvent) => {
      if (!contextMenu?.classList.contains('is-open')) {
        return
      }
      const menuItems = Array.from(contextMenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      const activeIndex = Math.max(0, menuItems.findIndex((item) => item === document.activeElement))
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const direction = event.key === 'ArrowDown' ? 1 : -1
        menuItems[(activeIndex + direction + menuItems.length) % menuItems.length]?.focus()
      }
      if (event.key === 'Home') {
        event.preventDefault()
        menuItems[0]?.focus()
      }
      if (event.key === 'End') {
        event.preventDefault()
        menuItems[menuItems.length - 1]?.focus()
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        closeContextMenu()
        canvas.focus()
      }
    }
    canvas.addEventListener('contextmenu', openContextMenu)
    root.addEventListener('click', closeContextMenu)
    contextMenu?.addEventListener('keydown', handleContextMenuKey)
    cleanups.push(() => {
      canvas.removeEventListener('contextmenu', openContextMenu)
      root.removeEventListener('click', closeContextMenu)
      contextMenu?.removeEventListener('keydown', handleContextMenuKey)
    })
  }

  cleanups.push(monitorForElements({
    onDragStart: () => root.classList.add('is-resource-dragging'),
    onDrop: () => root.classList.remove('is-resource-dragging'),
  }))

  const searchInput = root.querySelector<HTMLElement>('.chat-resource-search-panel [data-chat-resource-node-search]')
  const searchPopover = root.querySelector<HTMLElement>('.chat-resource-node-search-popover')
  const searchFilters = new Map<HTMLElement, () => void>()
  root.querySelectorAll<HTMLInputElement>('[data-chat-resource-node-search]').forEach((inputElement) => {
    const searchScope = inputElement.closest<HTMLElement>('[data-resource-node-search-scope]') ?? root
    const preview = searchScope.querySelector<HTMLElement>('[data-resource-node-preview]')
    const filterTargets = () => Array.from(searchScope.querySelectorAll<HTMLButtonElement>('[data-resource-library-card]'))
    const emptyState = searchScope.querySelector<HTMLElement>('[data-resource-node-search-empty]')
    const setNodeSearchActive = (card: HTMLElement | null) => {
      filterTargets().forEach((item) => item.classList.toggle('is-node-search-active', item === card))
      if (card?.id) {
        inputElement.setAttribute('aria-activedescendant', card.id)
      } else {
        inputElement.removeAttribute('aria-activedescendant')
      }
    }
    const updatePreview = (card: HTMLElement) => {
      if (!preview) {
        return
      }
      const title = card.dataset.resourcePreviewTitle ?? ''
      const body = card.dataset.resourcePreviewBody ?? ''
      preview.innerHTML = `<strong>${title}</strong><p>${body}</p>`
    }
    const filterCards = () => {
      const query = inputElement.value.trim().toLowerCase()
      filterTargets().forEach((card) => {
        const searchable = (card.dataset.resourceSearchText ?? '').toLowerCase()
        const activeCategory = card.closest<HTMLElement>('[data-resource-node-search-scope]')?.dataset.resourceNodeSearchCategory ?? 'all'
        const matchesCategory = activeCategory === 'all' || card.dataset.resourceCategory === activeCategory
        const contextType = searchScope.dataset.resourceSearchContextType ?? ''
        const contextSide = searchScope.dataset.resourceSearchContextSide ?? ''
        const compatibleTypes = contextSide === 'input' ? card.dataset.resourceOutputTypes : card.dataset.resourceInputTypes
        const matchesContext = !contextType || (compatibleTypes ?? '').split(' ').includes(contextType)
        card.hidden = (Boolean(query) && !searchable.includes(query)) || !matchesCategory || !matchesContext
      })
      const firstVisible = filterTargets().find((card) => !card.hidden) ?? null
      emptyState?.classList.toggle('is-visible', !firstVisible)
      setNodeSearchActive(firstVisible)
      if (firstVisible) {
        updatePreview(firstVisible)
      }
    }
    const focusNextCard = (direction: 1 | -1) => {
      const cards = filterTargets().filter((card) => !card.hidden)
      if (!cards.length) {
        setNodeSearchActive(null)
        return
      }
      const activeIndex = Math.max(0, cards.findIndex((card) => card === document.activeElement))
      const next = cards[(activeIndex + direction + cards.length) % cards.length]
      next?.focus()
      if (next) {
        setNodeSearchActive(next)
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
      if (event.key === 'Enter') {
        event.preventDefault()
        const firstCard = filterTargets().find((card) => !card.hidden)
        firstCard?.click()
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        root.classList.remove('is-node-search-open')
        searchScope.removeAttribute('data-resource-search-context-type')
        searchScope.removeAttribute('data-resource-search-context-side')
        filterCards()
      }
    }
    const handleCardHover = (event: Event) => {
      const card = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-resource-library-card]')
      if (card && searchScope.contains(card)) {
        setNodeSearchActive(card)
        updatePreview(card)
      }
    }
    const handleCategoryFilter = (event: Event) => {
      const categoryButton = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-resource-node-search-category]')
      const scope = categoryButton?.closest<HTMLElement>('[data-resource-node-search-scope]')
      if (!categoryButton || !scope) {
        return
      }
      scope.dataset.resourceNodeSearchCategory = categoryButton.dataset.resourceNodeSearchCategory ?? 'all'
      scope.querySelectorAll<HTMLElement>('[data-resource-node-search-category]').forEach((button) => button.classList.toggle('active', button === categoryButton))
      filterCards()
      const firstCard = filterTargets().find((card) => !card.hidden)
      if (firstCard) {
        setNodeSearchActive(firstCard)
        updatePreview(firstCard)
      }
    }
    inputElement.addEventListener('input', filterCards)
    inputElement.addEventListener('keydown', handleSearchKey)
    searchScope.addEventListener('mouseover', handleCardHover)
    searchScope.addEventListener('focusin', handleCardHover)
    searchScope.addEventListener('click', handleCategoryFilter)
    searchFilters.set(searchScope, filterCards)
    filterCards()
    cleanups.push(() => {
      inputElement.removeEventListener('input', filterCards)
      inputElement.removeEventListener('keydown', handleSearchKey)
      searchScope.removeEventListener('mouseover', handleCardHover)
      searchScope.removeEventListener('focusin', handleCardHover)
      searchScope.removeEventListener('click', handleCategoryFilter)
      searchFilters.delete(searchScope)
    })
  })
  if (root.classList.contains('is-node-search-open')) {
    root.querySelector<HTMLInputElement>('.chat-resource-node-search-popover [data-chat-resource-node-search]')?.focus()
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

  const removeConnectionGhost = () => root.querySelector<HTMLElement>('.chat-resource-connection-ghost')?.remove()
  const ensureConnectionGhost = () => {
    let ghost = root.querySelector<SVGSVGElement>('.chat-resource-connection-ghost')
    if (!ghost) {
      ghost = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      ghost.classList.add('chat-resource-connection-ghost')
      ghost.setAttribute('aria-hidden', 'true')
      ghost.innerHTML = '<path></path>'
      root.append(ghost)
    }
    return ghost
  }
  const updateConnectionGhost = (sourceSlot: HTMLElement, event: PointerEvent) => {
    const hostRect = root.getBoundingClientRect()
    const slotRect = sourceSlot.getBoundingClientRect()
    const x1 = Math.round(slotRect.left - hostRect.left + slotRect.width / 2)
    const y1 = Math.round(slotRect.top - hostRect.top + slotRect.height / 2)
    const x2 = Math.round(event.clientX - hostRect.left)
    const y2 = Math.round(event.clientY - hostRect.top)
    const mid = Math.max(48, Math.abs(x2 - x1) * 0.45)
    const path = sourceSlot.dataset.resourceSlotSide === 'input'
      ? `M ${x2} ${y2} C ${x2 + mid} ${y2}, ${x1 - mid} ${y1}, ${x1} ${y1}`
      : `M ${x1} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2} ${y2}`
    const ghost = ensureConnectionGhost()
    ghost.setAttribute('viewBox', `0 0 ${Math.round(hostRect.width)} ${Math.round(hostRect.height)}`)
    ghost.querySelector('path')?.setAttribute('d', path)
  }
  const showPlacementGhost = (event: PointerEvent) => {
    const hostRect = root.getBoundingClientRect()
    let ghost = root.querySelector<HTMLElement>('.chat-resource-placement-ghost')
    if (!ghost) {
      ghost = document.createElement('div')
      ghost.className = 'chat-resource-placement-ghost'
      root.append(ghost)
    }
    ghost.textContent = root.dataset.resourcePlacementLabel ?? 'Placement'
    ghost.style.left = `${Math.round(event.clientX - hostRect.left)}px`
    ghost.style.top = `${Math.round(event.clientY - hostRect.top)}px`
    ghost.classList.add('is-visible')
  }
  const openSearchFromSlotDrag = (slotElement: HTMLElement, event: PointerEvent) => {
    if (!searchPopover || !(canvas instanceof HTMLElement)) {
      return
    }
    const canvasRect = canvas.getBoundingClientRect()
    searchPopover.style.left = `${Math.round(event.clientX - canvasRect.left + 12)}px`
    searchPopover.style.top = `${Math.round(event.clientY - canvasRect.top + 12)}px`
    searchPopover.dataset.resourceSearchContextType = slotElement.dataset.resourceSlotType ?? ''
    searchPopover.dataset.resourceSearchContextSide = slotElement.dataset.resourceSlotSide ?? ''
    root.classList.add('is-node-search-open')
    searchFilters.get(searchPopover)?.()
    const firstCard = Array.from(searchPopover.querySelectorAll<HTMLButtonElement>('[data-resource-library-card]')).find((card) => !card.hidden)
    firstCard?.focus()
    const preview = searchPopover.querySelector<HTMLElement>('[data-resource-node-preview]')
    if (preview && firstCard) {
      preview.innerHTML = `<strong>${firstCard.dataset.resourcePreviewTitle ?? ''}</strong><p>${firstCard.dataset.resourcePreviewBody ?? ''}</p>`
    }
  }
  const dispatchSlotConnect = (sourceSlot: HTMLElement, targetSlot: HTMLElement) => {
    root.dispatchEvent(new CustomEvent('character-resource-slot-connect', {
      bubbles: true,
      detail: {
        sourceNodeId: sourceSlot.dataset.resourceSlotNode ?? '',
        sourceSlotId: sourceSlot.dataset.resourceSlotId ?? '',
        sourceSide: sourceSlot.dataset.resourceSlotSide ?? '',
        sourceType: sourceSlot.dataset.resourceSlotType ?? '',
        targetNodeId: targetSlot.dataset.resourceSlotNode ?? '',
        targetSlotId: targetSlot.dataset.resourceSlotId ?? '',
        targetSide: targetSlot.dataset.resourceSlotSide ?? '',
        targetType: targetSlot.dataset.resourceSlotType ?? '',
      },
    }))
  }
  const inferNodeSurfaceSlot = (slotElement: HTMLElement, event: PointerEvent) => {
    const sourceType = slotElement.dataset.resourceSlotType ?? ''
    const sourceSide = slotElement.dataset.resourceSlotSide ?? ''
    const targetNode = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.chat-resource-node')
    if (!targetNode || targetNode.contains(slotElement)) {
      return null
    }
    const candidates = Array.from(targetNode.querySelectorAll<HTMLElement>('.chat-resource-slot'))
      .filter((candidate) => candidate.dataset.resourceSlotType === sourceType && candidate.dataset.resourceSlotSide !== sourceSide)
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect()
        const bRect = b.getBoundingClientRect()
        return Math.abs(aRect.top + aRect.height / 2 - event.clientY) - Math.abs(bRect.top + bRect.height / 2 - event.clientY)
      })
    return candidates[0] ?? null
  }
  root.querySelectorAll<HTMLElement>('.chat-resource-slot').forEach((slotElement) => {
    const startSlotDrag = (event: PointerEvent) => {
      const sourceType = slotElement.dataset.resourceSlotType ?? ''
      const sourceSide = slotElement.dataset.resourceSlotSide ?? ''
      const compatibleSlots = Array.from(root.querySelectorAll<HTMLElement>('.chat-resource-slot'))
        .filter((candidate) => candidate !== slotElement && candidate.dataset.resourceSlotType === sourceType && candidate.dataset.resourceSlotSide !== sourceSide)
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
      updateConnectionGhost(slotElement, event)
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
      updateConnectionGhost(slotElement, event)
      showPlacementGhost(event)
    }
    const endSlotDrag = (event: PointerEvent) => {
      root.classList.remove('is-slot-dragging')
      removeConnectionGhost()
      root.querySelectorAll<HTMLElement>('.chat-resource-slot.is-compatible-candidate').forEach((candidate) => candidate.classList.remove('is-compatible-candidate'))
      const dropTarget = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.chat-resource-slot')
      const inferredTarget = dropTarget ?? inferNodeSurfaceSlot(slotElement, event)
      if (inferredTarget && inferredTarget !== slotElement && inferredTarget.dataset.resourceSlotType === slotElement.dataset.resourceSlotType && inferredTarget.dataset.resourceSlotSide !== slotElement.dataset.resourceSlotSide) {
        root.dataset.resourceSlotDropResult = JSON.stringify({
          sourceNodeId: slotElement.dataset.resourceSlotNode ?? '',
          sourceSlotId: slotElement.dataset.resourceSlotId ?? '',
          targetNodeId: inferredTarget.dataset.resourceSlotNode ?? '',
          targetSlotId: inferredTarget.dataset.resourceSlotId ?? '',
          type: slotElement.dataset.resourceSlotType ?? '',
        })
        dispatchSlotConnect(slotElement, inferredTarget)
        root.querySelector<HTMLElement>('.chat-resource-placement-ghost')?.classList.remove('is-visible')
      } else {
        openSearchFromSlotDrag(slotElement, event)
      }
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
      size: viewState.nodeSizes?.[placement.id] ?? definition.defaultSize,
      status: placement.status ?? 'idle',
      collapsed: collapsedNodeIds.has(placement.id),
      zIndex: index + 1,
      config: {
        ...Object.fromEntries(definition.parameters.map((parameterItem) => [parameterItem.id, parameterItem.defaultValue])),
        ...(options.configOverrides?.[placement.id] ?? {}),
      },
    } satisfies CharacterResourceNode
  }).filter((node) => !deletedNodeIds.has(node.id))
  for (const added of viewState.addedNodes ?? []) {
    const definition = definitions.get(added.type)
    if (!definition || deletedNodeIds.has(added.id)) {
      continue
    }
    nodes.push({
      id: added.id,
      type: added.type,
      title: added.title || definition.displayName,
      position: options.positionOverrides?.[added.id] ?? { x: added.x, y: added.y },
      size: viewState.nodeSizes?.[added.id] ?? definition.defaultSize,
      status: 'dirty',
      collapsed: collapsedNodeIds.has(added.id),
      zIndex: nodes.length + 1,
      config: {
        ...Object.fromEntries(definition.parameters.map((parameterItem) => [parameterItem.id, parameterItem.defaultValue])),
        ...(options.configOverrides?.[added.id] ?? {}),
      },
    })
  }
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
      size: viewState.nodeSizes?.[duplicate.id] ?? sourceNode.size,
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
  const deletedLinkIds = new Set(viewState.deletedLinkIds ?? [])
  const replacedTargetSlots = new Set(viewState.replacedTargetSlots ?? [])
  const customLinks = (viewState.customLinks ?? []).map((item) => ({
    ...item,
    label: LINK_KIND_LABELS[item.kind],
    status: 'valid' as const,
  }))
  const graphLinks = [
    ...DEFAULT_LINKS.filter((item) => !replacedTargetSlots.has(getTargetSlotKey(item)) && !deletedLinkIds.has(item.id)),
    ...customLinks.filter((item) => !deletedLinkIds.has(item.id)),
  ]
  return {
    id: 'draft-character-resource-graph',
    title: ui(options, '角色资源图草稿', 'Draft Character Resource Graph'),
    nodes,
    links: graphLinks
      .filter((item) => !deletedNodeIds.has(item.sourceNodeId) && !deletedNodeIds.has(item.targetNodeId))
      .map((item) => {
        const kind = viewState.linkKinds?.[item.id] ?? item.kind
        return {
          ...item,
          kind,
          label: LINK_KIND_LABELS[kind],
          status: validateLink(item, nodes, definitions) ? 'valid' : 'invalid',
        }
      }),
    groups: [
      { id: 'intent-control', title: ui(options, '目标与口味', 'Goal and Taste'), nodeIds: ['generation-goal', 'style-pressure', 'hard-constraints', 'source-material'], color: 'rgba(82, 168, 255, 0.16)' },
      { id: 'tool-policy', title: ui(options, '工具与策略', 'Tools and Strategy'), nodeIds: ['llm-capability', 'image-capability', 'agent-policy', 'generation-strategy'], color: 'rgba(219, 189, 130, 0.16)' },
      { id: 'evaluation-output', title: ui(options, '评估与输出', 'Evaluation and Output'), nodeIds: ['asset-targets', 'critique-loop', 'quality-gate', 'output-adapter', 'chat-test'], color: 'rgba(162, 202, 188, 0.16)' },
    ],
    tabs: [
      { id: 'workflow', title: 'Draft 01.resourcegraph', kind: 'resource-graph' },
      { id: 'package-preview', title: 'Package Preview', kind: 'package-preview' },
      { id: 'run-draft', title: 'Run Draft', kind: 'run-draft' },
    ],
    viewport: { x: viewState.panX ?? 0, y: viewState.panY ?? 0, zoom: viewState.zoom ?? 0.84 },
    selection: { nodeIds: viewState.selectedNodeIds?.length ? viewState.selectedNodeIds : [options.selectedNodeId || 'generation-goal'], linkIds: viewState.selectedLinkId ? [viewState.selectedLinkId] : [] },
    panels: {
      leftWidth: options.sidebarCollapsed ? 0 : 246,
      rightWidth: options.inspectorCollapsed ? 0 : 252,
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
      LiteGraph.registerNodeType(`noema/${definition.type}`, class extends LGraphNode {
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
    title: ui(options, '草稿 01.resourcegraph', 'Draft 01.resourcegraph'),
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
  const recentNodes = getRecentNodeDefinitions(graph)
  return `
    <aside class="chat-workflow-sidebar chat-resource-library" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '资源节点库' : 'Resource node library')}">
      <div class="chat-workflow-sidebar-scroll">
        <section class="chat-workflow-sidebar-section">
          <strong>${options.escapeHtml(ui(options, '资源库', 'Resource Library'))}</strong>
          <button class="${graph.panels.activePanel === 'workflow' ? 'active' : ''}" type="button" data-chat-workflow-panel="workflow"><span>${options.escapeHtml(ui(options, '图', 'Graph'))}</span><em>${graph.nodes.length}</em></button>
          <button class="${graph.panels.activePanel === 'assets' ? 'active' : ''}" type="button" data-chat-workflow-panel="assets"><span>${options.escapeHtml(ui(options, '资源包', 'Package'))}</span><em>${graph.mockOutputs.length}</em></button>
          <button class="${graph.panels.activePanel === 'nodes' ? 'active' : ''}" type="button" data-chat-workflow-panel="nodes"><span>${options.escapeHtml(ui(options, '节点', 'Nodes'))}</span><em>${RESOURCE_NODE_DEFINITIONS.length}</em></button>
        </section>
        <section class="chat-resource-search-panel" data-resource-node-search-scope data-resource-node-search-category="all">
          <label>
            <span>${options.escapeHtml(options.language === 'zh-CN' ? '搜索节点' : 'Search nodes')}</span>
            <input type="search" value="" role="combobox" aria-autocomplete="list" aria-expanded="true" placeholder="${options.escapeHtml(options.language === 'zh-CN' ? '名称 / 类型 / slot' : 'name / type / slot')}" data-chat-resource-node-search>
          </label>
          <div class="chat-resource-search-results">
            ${searchResults.slice(0, 5).map((definition, index) => renderNodeLibraryCard(definition, graph, options, `resource-library-search-${index}`)).join('')}
            <div class="chat-resource-search-empty" data-resource-node-search-empty>
              <strong>${options.escapeHtml(ui(options, '无匹配节点', 'No matching nodes'))}</strong>
              <span>${options.escapeHtml(ui(options, '调整关键词或切换分类', 'Adjust the query or category'))}</span>
            </div>
          </div>
          <div class="chat-resource-node-preview" data-resource-node-preview>
            <strong>${options.escapeHtml(searchResults[0]?.displayName ?? ui(options, '节点预览', 'Node Preview'))}</strong>
            <p>${options.escapeHtml(searchResults[0]?.description ?? '')}</p>
          </div>
        </section>
        <section class="chat-workflow-sidebar-section compact">
          <strong>${options.escapeHtml(ui(options, '最近', 'Recent'))}</strong>
          ${recentNodes.map((definition, index) => renderNodeLibraryCard(definition, graph, options, `resource-library-recent-${index}`)).join('')}
        </section>
        <section class="chat-workflow-sidebar-section">
          <strong>${options.escapeHtml(ui(options, '分类', 'Categories'))}</strong>
          ${categories.map((category) => {
            const count = RESOURCE_NODE_DEFINITIONS.filter((definition) => definition.category === category).length
            const firstNode = graph.nodes.find((node) => node.type === category)
            return `<button type="button" data-chat-workflow-panel="nodes" ${firstNode ? `data-chat-workflow-node-select="${options.escapeHtml(firstNode.id)}"` : ''}><span>${options.escapeHtml(category)}</span><em>${count}</em></button>`
          }).join('')}
        </section>
        <section class="chat-workflow-sidebar-section compact">
          <strong>${options.escapeHtml(ui(options, '常用', 'Favorites'))}</strong>
          ${RESOURCE_NODE_DEFINITIONS.filter((definition) => definition.source === 'core' || definition.source === 'agent').slice(0, 4).map((definition, index) => renderNodeLibraryCard(definition, graph, options, `resource-library-favorite-${index}`)).join('')}
        </section>
      </div>
    </aside>
  `
}

function renderNodeLibraryCard(definition: CharacterResourceNodeDefinition, graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions, elementId = ''): string {
  const searchText = [
    definition.type,
    definition.displayName,
    definition.category,
    definition.source,
    ...definition.aliases,
    ...definition.inputs.map((slotItem) => slotItem.type),
    ...definition.outputs.map((slotItem) => slotItem.type),
  ].join(' ')
  const inputTypes = definition.inputs.map((slotItem) => slotItem.type).join(' ')
  const outputTypes = definition.outputs.map((slotItem) => slotItem.type).join(' ')
  return `
    <button class="chat-resource-library-card" ${elementId ? `id="${options.escapeHtml(elementId)}"` : ''} type="button" role="option" data-resource-library-card data-resource-node-add-type="${options.escapeHtml(definition.type)}" data-resource-category="${options.escapeHtml(definition.category)}" data-resource-input-types="${options.escapeHtml(inputTypes)}" data-resource-output-types="${options.escapeHtml(outputTypes)}" data-resource-search-text="${options.escapeHtml(searchText)}" data-resource-preview-title="${options.escapeHtml(definition.displayName)}" data-resource-preview-body="${options.escapeHtml(definition.description)}" data-chat-workflow-panel="nodes">
      <span>
        <b>${options.escapeHtml(definition.displayName)}</b>
        <small>${options.escapeHtml(definition.category)} / ${options.escapeHtml(definition.source)}</small>
      </span>
      <em>${options.escapeHtml(definition.outputs[0]?.type ?? '-')}</em>
    </button>
  `
}

function getRecentNodeDefinitions(graph: CharacterResourceGraph): CharacterResourceNodeDefinition[] {
  const seen = new Set<string>()
  return graph.nodes
    .slice()
    .sort((a, b) => b.zIndex - a.zIndex)
    .map((node) => getDefinition(node.type))
    .filter((definition) => {
      if (seen.has(definition.type)) {
        return false
      }
      seen.add(definition.type)
      return true
    })
    .slice(0, 4)
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
    <section class="chat-workflow-canvas chat-resource-canvas" tabindex="-1" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '角色资源图画布' : 'Character resource graph canvas')}">
      ${renderCanvasControls(graph, options)}
      <div class="chat-resource-tabs">
        ${renderSidebarToggle(options)}
        ${graph.tabs.map((tab) => `<button class="${tab.id === activeTab ? 'active' : ''}" type="button" data-chat-workflow-tab="${options.escapeHtml(tab.id)}">${options.escapeHtml(resourceGraphTabTitle(tab, options))}</button>`).join('')}
      </div>
      ${activeTab === 'package-preview' ? renderPackagePreview(graph, options) : ''}
      ${activeTab === 'run-draft' ? renderRunDraft(graph, options) : ''}
      <div class="chat-workflow-canvas-viewport ${activeTab === 'workflow' ? 'active' : 'inactive'}" data-resource-viewport="${options.escapeHtml(JSON.stringify(graph.viewport))}">
        <div class="chat-workflow-canvas-plane chat-resource-graph-plane" style="--resource-zoom: ${graph.viewport.zoom}; --resource-pan-x: ${graph.viewport.x}px; --resource-pan-y: ${graph.viewport.y}px">
          <div class="chat-workflow-canvas-grid" aria-hidden="true"></div>
          ${graph.groups.map((group) => renderGroup(group, graph, options)).join('')}
          ${options.viewState?.hideLinks ? '' : renderLinkOverlay(graph, options)}
          ${graph.nodes.map((node) => renderResourceNode(node, graph, options)).join('')}
          ${renderSelectionBox(options.viewState?.selectionBox)}
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
  const requiredTypes = ['candidate', 'report', 'export']
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
          <strong>${options.escapeHtml(ui(options, '资源', 'Resources'))}</strong>
          <span>${graph.mockOutputs.length}</span>
        </header>
        ${graph.mockOutputs.map((output) => `
          <article>
            <b>${options.escapeHtml(output.title)}</b>
            <span>${options.escapeHtml(output.type)} / ${options.escapeHtml(statusLabel(output.status, options))}</span>
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
    ...missing.map((type) => ui(options, `缺少候选包预览输入：${type}`, `Missing candidate preview input: ${type}`)),
    ...invalidLinks.map((linkItem) => ui(options, `无效连线：${linkItem.sourceNodeId} -> ${linkItem.targetNodeId}`, `Invalid link: ${linkItem.sourceNodeId} -> ${linkItem.targetNodeId}`)),
  ]
  return `
    <section class="chat-resource-validation-panel ${warnings.length ? 'error' : 'empty'}">
      <header>
        <strong>${options.escapeHtml(ui(options, '校验', 'Validation'))}</strong>
        <span>${options.escapeHtml(warnings.length ? ui(options, `${warnings.length} 个问题`, `${warnings.length} issues`) : ui(options, '通过', 'pass'))}</span>
      </header>
      ${warnings.length
        ? warnings.map((warning) => `<p class="error">${options.escapeHtml(warning)}</p>`).join('')
        : `<div class="chat-resource-panel-state empty"><strong>${options.escapeHtml(ui(options, '没有阻塞问题', 'No blocking issues'))}</strong><span>${options.escapeHtml(ui(options, '当前图快照中已包含候选包、质量报告和输出目标。', 'The current graph snapshot includes candidate, quality report, and export target links.'))}</span></div>`}
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
          <strong>${options.escapeHtml(options.runState?.run?.title ?? ui(options, '运行草稿', 'Run Draft'))}</strong>
        </header>
        <div class="chat-resource-run-lifecycle">
          ${lifecycle.map((step) => `<i class="${runStatus === step || (runStatus === 'idle' && step === 'queued') ? 'active' : ''}">${options.escapeHtml(statusLabel(step, options))}</i>`).join('')}
        </div>
      </section>
      <section class="chat-resource-package-list">
        <header>
          <strong>${options.escapeHtml(ui(options, '产物', 'Produced Artifacts'))}</strong>
          <span>${options.escapeHtml(String(options.runState?.artifacts?.length ?? 0))}</span>
        </header>
        ${(options.runState?.artifacts ?? []).map((artifact) => `
          <article>
            <b>${options.escapeHtml(artifact.title ?? artifact.type)}</b>
            <span>${options.escapeHtml(artifact.type)} / ${options.escapeHtml(artifact.sourceNodeId)}</span>
            <p>${options.escapeHtml(artifact.summary ?? 'Mock artifact produced by the agent trace lifecycle.')}</p>
          </article>
        `).join('') || `<div class="chat-resource-panel-state empty"><strong>${options.escapeHtml(ui(options, '还没有产物', 'No artifacts yet'))}</strong><span>${options.escapeHtml(ui(options, '运行 Agent mock trace 后会填充这个草稿。', 'Run the agent mock trace to populate this draft.'))}</span></div>`}
      </section>
      <section class="chat-resource-validation-panel">
        <header>
          <strong>${options.escapeHtml(ui(options, 'Agent 边界', 'Agent Boundary'))}</strong>
          <span>${options.escapeHtml(ui(options, `${graph.nodes.length} 个节点`, `${graph.nodes.length} nodes`))}</span>
        </header>
        <p>${options.escapeHtml(ui(options, '这里不会调用真实后端 Agent。这个草稿只映射规划、工具选择、候选生成、评估、修复和导出的前端 mock trace。', 'Real backend agents are not called here. This draft mirrors planning, tool selection, candidate generation, evaluation, repair, and export as a frontend mock trace.'))}</p>
      </section>
    </div>
  `
}

function renderCanvasControls(graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions): string {
  const running = options.runState?.run?.status === 'running'
  const runLabel = running ? ui(options, '停止前端模拟运行', 'Stop mock run') : ui(options, '运行前端模拟生命周期', 'Run mock lifecycle')
  const fitLabel = ui(options, '适配视图', 'Fit view')
  const resetLabel = ui(options, '重置视图', 'Reset view')
  const linksLabel = ui(options, '显示/隐藏连线', 'Toggle links')
  return `
    <div class="chat-workflow-canvas-controls chat-resource-canvas-controls" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '画布控制' : 'Canvas controls')}">
      <button class="chat-workflow-run-toggle ${running ? 'is-running' : ''}" type="button" data-chat-workflow-action="${running ? 'stop' : 'run'}" aria-label="${options.escapeHtml(runLabel)}" title="${options.escapeHtml(runLabel)}"><i icon-name="play" aria-hidden="true"></i></button>
      <button type="button" data-chat-workflow-action="fit-view" title="${options.escapeHtml(fitLabel)}" aria-label="${options.escapeHtml(fitLabel)}"><i icon-name="maximize" aria-hidden="true"></i></button>
      <button type="button" data-chat-workflow-action="reset-view" title="${options.escapeHtml(resetLabel)}" aria-label="${options.escapeHtml(resetLabel)}"><i icon-name="rotate-ccw" aria-hidden="true"></i></button>
      <button type="button" data-chat-workflow-action="toggle-links" title="${options.escapeHtml(linksLabel)}" aria-label="${options.escapeHtml(linksLabel)}"><i icon-name="link-2-off" aria-hidden="true"></i></button>
      ${renderInspectorToggle(options)}
      <span class="chat-resource-zoom-label">${Math.round(graph.viewport.zoom * 100)}%</span>
    </div>
    <div class="chat-resource-minimap" data-resource-minimap aria-label="${options.escapeHtml(ui(options, '图概览', 'Graph overview'))}">
      ${graph.nodes.map((node) => `<i class="${graph.selection.nodeIds.includes(node.id) ? 'selected' : ''}" data-resource-minimap-node="${options.escapeHtml(node.id)}" style="left:${Math.round(node.position.x / 24)}px;top:${Math.round(node.position.y / 24)}px;width:${Math.max(8, Math.round(node.size.width / 24))}px;height:${Math.max(6, Math.round(node.size.height / 24))}px"></i>`).join('')}
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
  const flowing = source.status === 'running' || source.status === 'queued' || target.status === 'running' || target.status === 'queued'
  const collapsedNodeLinkReroute = Boolean(source.collapsed || target.collapsed)
  return `
    <g class="chat-resource-link ${options.escapeHtml(linkItem.kind)} ${options.escapeHtml(linkItem.status)} ${flowing ? 'flowing' : ''} ${collapsedNodeLinkReroute ? 'collapsed-node-link reroute-link' : ''} ${graph.selection.linkIds.includes(linkItem.id) ? 'selected' : ''}" data-chat-resource-link-id="${options.escapeHtml(linkItem.id)}" data-chat-workflow-link-select="${options.escapeHtml(linkItem.id)}">
      <path d="${path}" marker-end="url(#chat-resource-arrow)"></path>
      <path class="hit-area" d="${path}"></path>
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
      <button class="chat-resource-node-resize" type="button" data-resource-node-resize aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '调整节点尺寸' : 'Resize node')}"></button>
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
      <span>${options.escapeHtml(ui(options, `${inbound} 入 / ${outbound} 出`, `${inbound} in / ${outbound} out`))}</span>
      <button type="button" data-chat-workflow-node-select="${options.escapeHtml(node.id)}">${options.escapeHtml(definition.previewType)}</button>
    </footer>
  `
}

function renderResourceInspector(graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions): string {
  const selectedLink = graph.links.find((linkItem) => graph.selection.linkIds.includes(linkItem.id))
  if (selectedLink) {
    return renderLinkInspector(graph, selectedLink, options)
  }
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
          <h4>${options.escapeHtml(ui(options, '插槽', 'Slots'))}</h4>
          <div class="chat-workflow-inspector-ports">
            ${definition.inputs.map((slotItem) => `<span><b>IN</b>${options.escapeHtml(slotItem.label)}<small>${options.escapeHtml(slotItem.type)}</small></span>`).join('') || '<span><b>IN</b>-</span>'}
            ${definition.outputs.map((slotItem) => `<span><b>OUT</b>${options.escapeHtml(slotItem.label)}<small>${options.escapeHtml(slotItem.type)}</small></span>`).join('')}
          </div>
        </section>
        <section class="chat-workflow-inspector-section">
          <h4>${options.escapeHtml(ui(options, '模拟输出', 'Mock Output'))}</h4>
          <div class="chat-resource-output-card">
            <strong>${options.escapeHtml(output?.title ?? definition.displayName)}</strong>
            <p>${options.escapeHtml(output?.summary ?? '')}</p>
            <span>${options.escapeHtml(output?.status ?? selectedNode.status)}</span>
          </div>
        </section>
        <section class="chat-workflow-inspector-section">
          <h4>${options.escapeHtml(ui(options, '连线类型', 'Link Kinds'))}</h4>
          <div class="chat-resource-link-kind-list">
            ${(Object.keys(LINK_KIND_LABELS) as CharacterResourceLinkKind[]).map((kind) => `<button type="button" data-chat-workflow-action="set-link-kind" title="${options.escapeHtml(kind)}">${options.escapeHtml(kind)}</button>`).join('')}
          </div>
        </section>
      </div>
    </aside>
  `
}

function renderLinkInspector(graph: CharacterResourceGraph, linkItem: CharacterResourceLink, options: CharacterWorkflowPageOptions): string {
  const source = graph.nodes.find((node) => node.id === linkItem.sourceNodeId)
  const target = graph.nodes.find((node) => node.id === linkItem.targetNodeId)
  return `
    <aside class="chat-workflow-inspector chat-resource-inspector" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '连线 Inspector' : 'Link inspector')}">
      <div class="chat-workflow-inspector-scroll">
        <header class="chat-workflow-inspector-head">
          <span>${options.escapeHtml(linkItem.kind)} / ${options.escapeHtml(linkItem.status)}</span>
          <strong>${options.escapeHtml(source?.title ?? linkItem.sourceNodeId)} -> ${options.escapeHtml(target?.title ?? linkItem.targetNodeId)}</strong>
          <small>${options.escapeHtml(`${linkItem.sourceSlotId} -> ${linkItem.targetSlotId}`)}</small>
        </header>
        <section class="chat-workflow-inspector-section">
          <h4>${options.escapeHtml(ui(options, '连线类型', 'Link Kind'))}</h4>
          <div class="chat-resource-link-kind-list">
            ${(Object.keys(LINK_KIND_LABELS) as CharacterResourceLinkKind[]).map((kind) => `<button class="${kind === linkItem.kind ? 'active' : ''}" type="button" data-chat-workflow-action="set-link-kind" data-resource-link-kind="${options.escapeHtml(kind)}" title="${options.escapeHtml(kind)}">${options.escapeHtml(kind)}</button>`).join('')}
          </div>
        </section>
        <section class="chat-workflow-inspector-section">
          <h4>${options.escapeHtml(ui(options, '连接', 'Connection'))}</h4>
          <div class="chat-workflow-inspector-ports">
            <span><b>OUT</b>${options.escapeHtml(linkItem.sourceSlotId)}<small>${options.escapeHtml(linkItem.sourceNodeId)}</small></span>
            <span><b>IN</b>${options.escapeHtml(linkItem.targetSlotId)}<small>${options.escapeHtml(linkItem.targetNodeId)}</small></span>
          </div>
        </section>
        <section class="chat-workflow-inspector-section">
          <h4>${options.escapeHtml(ui(options, '端点', 'Endpoints'))}</h4>
          <div class="chat-resource-link-endpoint-actions">
            <button type="button" data-chat-workflow-action="reconnect-link" data-selected-link-endpoint="source">${options.escapeHtml(ui(options, '重连输出', 'Reconnect Output'))}</button>
            <button type="button" data-chat-workflow-action="reconnect-link" data-selected-link-endpoint="target">${options.escapeHtml(ui(options, '重连输入', 'Reconnect Input'))}</button>
          </div>
        </section>
        <section class="chat-workflow-inspector-section">
          <button class="chat-resource-danger-action" type="button" data-chat-workflow-action="delete-selection">${options.escapeHtml(ui(options, '断开连接', 'Disconnect'))}</button>
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
  const dirty = !areParameterValuesEqual(value, parameterItem.defaultValue)
  const validation = validateInspectorParameter(parameterItem, value ?? parameterItem.defaultValue, options)
  return `
    <label class="chat-workflow-inspector-field ${dirty ? 'is-dirty' : ''} ${validation ? 'is-invalid' : ''}">
      <span>
        <b>${options.escapeHtml(parameterItem.label)}</b>
        ${dirty ? `<button class="chat-workflow-param-reset" type="button" data-chat-workflow-action="reset-parameter" data-chat-workflow-param-reset="${options.escapeHtml(parameterItem.id)}" data-chat-workflow-node="${options.escapeHtml(node.id)}">${options.escapeHtml(ui(options, '重置', 'Reset'))}</button>` : ''}
      </span>
      ${renderParameterField(parameterItem, node, value ?? parameterItem.defaultValue, options, Boolean(validation))}
      ${validation ? `<em class="chat-workflow-field-error">${options.escapeHtml(validation)}</em>` : ''}
    </label>
  `
}

function renderParameterField(
  parameterItem: CharacterResourceParameterDefinition,
  node: CharacterResourceNode,
  value: unknown,
  options: CharacterWorkflowPageOptions,
  invalid = false
): string {
  const baseAttrs = `data-chat-workflow-param="${options.escapeHtml(parameterItem.id)}" data-chat-workflow-node="${options.escapeHtml(node.id)}" data-chat-workflow-param-type="${options.escapeHtml(parameterItem.type)}" aria-invalid="${invalid ? 'true' : 'false'}"`
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

function areParameterValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

function validateInspectorParameter(parameterItem: CharacterResourceParameterDefinition, value: unknown, options: CharacterWorkflowPageOptions): string {
  if (parameterItem.type === 'number' || parameterItem.type === 'integer') {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) {
      return ui(options, '请输入有效数字', 'Enter a valid number')
    }
    if (parameterItem.type === 'integer' && !Number.isInteger(numeric)) {
      return ui(options, '请输入整数', 'Enter an integer')
    }
    if (parameterItem.min !== undefined && numeric < parameterItem.min) {
      return ui(options, `不能小于 ${parameterItem.min}`, `Must be at least ${parameterItem.min}`)
    }
    if (parameterItem.max !== undefined && numeric > parameterItem.max) {
      return ui(options, `不能大于 ${parameterItem.max}`, `Must be at most ${parameterItem.max}`)
    }
  }
  if ((parameterItem.type === 'text' || parameterItem.type === 'textarea') && String(value ?? '').trim() === '') {
    return ui(options, '此字段不能为空', 'This field cannot be empty')
  }
  return ''
}

function renderBottomToolbar(graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions): string {
  const packageNode = graph.nodes.find((node) => node.type === 'output-adapter')
  const validationIssues = graph.links.filter((linkItem) => linkItem.status !== 'valid').length
  return `
    <footer class="chat-resource-bottom-toolbar">
      <div>
        <strong>${options.escapeHtml(graph.title)}</strong>
        <span>${options.escapeHtml(ui(options, `${graph.nodes.length} 个节点 / ${graph.links.length} 条连线 / ${validationIssues} 个问题`, `${graph.nodes.length} nodes / ${graph.links.length} links / ${validationIssues} issues`))}</span>
      </div>
      <button type="button" data-chat-workflow-action="save-graph"><i icon-name="save" aria-hidden="true"></i><span>${options.escapeHtml(ui(options, '保存', 'Save'))}</span></button>
      <button type="button" data-chat-workflow-tab="package-preview" ${packageNode ? `data-chat-workflow-node-select="${options.escapeHtml(packageNode.id)}"` : ''}><i icon-name="package" aria-hidden="true"></i><span>${options.escapeHtml(ui(options, '预览', 'Preview'))}</span></button>
      <button type="button" data-chat-workflow-node-select="quality-gate">${options.escapeHtml(ui(options, '校验', 'Validate'))}</button>
      <button type="button" data-chat-workflow-action="chat-test"><i icon-name="message-circle" aria-hidden="true"></i><span>${options.escapeHtml(ui(options, '聊天测试', 'Chat Test'))}</span></button>
      <button type="button" data-chat-workflow-action="export"><i icon-name="download" aria-hidden="true"></i><span>${options.escapeHtml(ui(options, '导出', 'Export'))}</span></button>
    </footer>
  `
}

function renderNodeSearchPopover(graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions): string {
  const candidates = definitionFuse.search('persona').map((result) => result.item)
  const categories = getResourceCategories()
  return `
    <div class="chat-resource-node-search-popover" role="dialog" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '节点搜索' : 'Node search')}" data-resource-node-search-scope data-resource-node-search-category="all">
      <header>
        <strong>${options.escapeHtml(options.language === 'zh-CN' ? '添加可连接节点' : 'Add connectable node')}</strong>
        <span>${options.escapeHtml(String(candidates.length))}</span>
      </header>
      <label class="chat-resource-node-search-field">
        <span>${options.escapeHtml(options.language === 'zh-CN' ? '搜索' : 'Search')}</span>
        <input type="search" value="" role="combobox" aria-autocomplete="list" aria-expanded="true" placeholder="${options.escapeHtml(options.language === 'zh-CN' ? '名称 / 类型 / slot' : 'name / type / slot')}" data-chat-resource-node-search>
      </label>
      <div class="chat-resource-node-search-filters" role="toolbar" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '节点分类筛选' : 'Node category filters')}">
        <button class="active" type="button" data-resource-node-search-category="all">${options.escapeHtml(ui(options, '全部', 'All'))}</button>
        ${categories.map((category) => `<button type="button" data-resource-node-search-category="${options.escapeHtml(category)}">${options.escapeHtml(category)}</button>`).join('')}
      </div>
      <div class="chat-resource-node-search-results">
      ${candidates.map((definition, index) => renderNodeLibraryCard(definition, graph, options, `resource-popover-search-${index}`)).join('')}
        <div class="chat-resource-search-empty" data-resource-node-search-empty>
          <strong>${options.escapeHtml(ui(options, '无可连接节点', 'No connectable nodes'))}</strong>
          <span>${options.escapeHtml(ui(options, '尝试拖拽到兼容 slot 或清空搜索', 'Try a compatible slot or clear the query'))}</span>
        </div>
      </div>
      <div class="chat-resource-node-preview" data-resource-node-preview>
        <strong>${options.escapeHtml(candidates[0]?.displayName ?? ui(options, '节点预览', 'Node Preview'))}</strong>
        <p>${options.escapeHtml(candidates[0]?.description ?? '')}</p>
      </div>
    </div>
  `
}

function renderCanvasContextMenu(options: CharacterWorkflowPageOptions): string {
  return `
    <div class="chat-resource-context-menu" role="menu" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '画布菜单' : 'Canvas menu')}">
      <button type="button" role="menuitem" data-chat-workflow-action="open-node-search">${options.escapeHtml(ui(options, '添加节点', 'Add Node'))}</button>
      <button type="button" role="menuitem" data-chat-workflow-action="fit-view">${options.escapeHtml(ui(options, '适配视图', 'Fit View'))}</button>
      <button type="button" role="menuitem" data-chat-workflow-action="copy-selection">${options.escapeHtml(ui(options, '复制', 'Copy'))}</button>
      <button type="button" role="menuitem" data-chat-workflow-action="paste-selection">${options.escapeHtml(ui(options, '粘贴', 'Paste'))}</button>
      <button type="button" role="menuitem" data-chat-workflow-action="duplicate-selection">${options.escapeHtml(ui(options, '复制副本', 'Duplicate'))}</button>
      <button type="button" role="menuitem" data-chat-workflow-action="undo-graph">${options.escapeHtml(ui(options, '撤销', 'Undo'))}</button>
      <button type="button" role="menuitem" data-chat-workflow-action="redo-graph">${options.escapeHtml(ui(options, '重做', 'Redo'))}</button>
      <button type="button" role="menuitem" data-chat-workflow-action="align-left">${options.escapeHtml(ui(options, '左对齐', 'Align Left'))}</button>
      <button type="button" role="menuitem" data-chat-workflow-action="align-top">${options.escapeHtml(ui(options, '顶对齐', 'Align Top'))}</button>
      <button class="danger" type="button" role="menuitem" data-chat-workflow-action="delete-selection">${options.escapeHtml(ui(options, '删除', 'Delete'))}</button>
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

function renderSelectionBox(selectionBox: CharacterResourceViewState['selectionBox'] | undefined): string {
  if (!selectionBox) {
    return ''
  }
  return `<div class="chat-resource-selection-box" style="left:${selectionBox.x}px;top:${selectionBox.y}px;width:${selectionBox.width}px;height:${selectionBox.height}px"></div>`
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

function getTargetSlotKey(linkItem: Pick<CharacterResourceLink, 'targetNodeId' | 'targetSlotId'>): string {
  return `${linkItem.targetNodeId}:${linkItem.targetSlotId}`
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
    return 'Mock quality gate checks goal match, style intensity, long-term RP durability, consistency, and export readiness.'
  }
  if (definition.previewType === 'package') {
    return 'Mock candidate package preview combines agent plan, requested assets, quality gate report, output adapter, and chat-test entry.'
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
