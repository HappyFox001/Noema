/**
 * Renders the character resource graph workbench for the chat surface.
 */
import Fuse from 'fuse.js'
import Split from 'split-grid'
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/dist/esm/adapter/element-adapter.js'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import { Link2Off, Maximize, MessageCircle, Play, RotateCcw, Save, Search, Square, Trash2, createIcons, type IconNode } from 'lucide'
import type { CharacterResourceViewState, SerializedCharacterResourceLinkKind } from './chat-character-resource-graph-state'

export interface CharacterWorkflowPageOptions {
  language: 'zh-CN' | 'en-US'
  escapeHtml(value: string): string
  t?(key: string): string
  modelChoices?: CharacterWorkflowModelChoice[]
  configOverrides?: Record<string, Record<string, unknown>>
  positionOverrides?: Record<string, { x: number; y: number }>
  runState?: CharacterResourceRunState | null
  runDrafts?: CharacterWorkflowRunDraftOption[]
  tabs: CharacterWorkflowFileTab[]
  activeTabId: string
  selectedNodeId: string
  activePanel: CharacterWorkflowSidePanel
  sidebarCollapsed: boolean
  workflowLibraryCollapsed?: boolean
  inspectorCollapsed: boolean
  nodeSearchOpen?: boolean
  workflowAssistantHtml?: string
  viewState?: CharacterResourceViewState
}

export interface CharacterWorkflowFileTab {
  id: string
  title: string
  kind: 'workflow' | 'run' | 'character'
  state?: 'running' | 'failed' | 'dirty'
}

export interface CharacterWorkflowRunDraftOption {
  id: string
  title: string
  status: 'idle' | 'running' | 'failed' | 'done' | 'needs_action'
  createdAt: number
  completedAt?: number
}

export type CharacterWorkflowSidePanel = 'workflow' | 'assets' | 'nodes'

type CharacterResourceNodeStatus = 'idle' | 'dirty' | 'queued' | 'running' | 'done' | 'failed' | 'stale' | 'disabled'
type CharacterResourcePreviewType = 'text-card' | 'image' | 'voice' | 'rule' | 'validation' | 'package'
type CharacterResourceParameterType = 'text' | 'textarea' | 'number' | 'integer' | 'boolean' | 'select' | 'multi-select' | 'string-list' | 'model-select' | 'materials' | 'field-control-list'
type CharacterResourceLinkKind = SerializedCharacterResourceLinkKind
type CharacterWorkflowLanguage = CharacterWorkflowPageOptions['language']

export interface CharacterWorkflowModelChoice {
  id: string
  kind: 'llm' | 'image'
  apiId: string
  modelName: string
  provider: string
  providerLabel: string
  logoHtml: string
}

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
  outputs: CharacterResourceOutput[]
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
  accepts?: string[]
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
  modelKind?: CharacterWorkflowModelChoice['kind']
}

interface WorkflowFieldControlItem {
  field: string
  fieldPurpose: string
  tone: string
  lengthPolicy: string
  avoidPatterns: string[]
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
  kind: 'resource-graph' | 'run-draft'
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

interface CharacterResourceOutput {
  id: string
  nodeId: string
  artifactId?: string
  sourceNodeId?: string
  type: string
  title: string
  summary: string
  status: CharacterResourceNodeStatus
  image?: string
  text?: string
  data?: unknown
}

interface RunCharacterPreviewRow {
  key: string
  label: string
  value: string
}

interface WorkflowMaterialItem {
  id: string
  kind: 'image' | 'document'
  name: string
  mimeType: string
  dataUrl?: string
  text?: string
  size?: number
}

export interface CharacterResourceRunState {
  run?: {
    id: string
    title: string
    status: 'idle' | 'running' | 'failed' | 'done' | 'needs_action'
    currentStepId?: string
  }
  steps?: CharacterResourceRunStep[]
  events?: CharacterResourceRunEvent[]
  artifacts?: Array<{
    id?: string
    type: string
    sourceNodeId: string
    title?: string
    summary?: string
    data?: unknown
  }>
}

type CharacterRunArtifact = NonNullable<CharacterResourceRunState['artifacts']>[number]
type CharacterRunArtifacts = NonNullable<CharacterResourceRunState['artifacts']>

export interface CharacterResourceRunStep {
  id: string
  label: string
  status: 'pending' | 'running' | 'done' | 'failed'
  detail?: string
}

export interface CharacterResourceRunEvent {
  type: string
  timestamp?: number
  phase?: string
  toolName?: string
  title?: string
  summary?: string
  status?: 'pending' | 'running' | 'done' | 'failed'
  artifact?: {
    id?: string
    kind?: string
    title?: string
    summary?: string
    sourceNodeId?: string
    data?: unknown
  }
  raw?: unknown
}

export function createCharacterResourceRunSteps(language: CharacterWorkflowLanguage): CharacterResourceRunStep[] {
  const zh = language === 'zh-CN'
  return [
    {
      id: 'snapshot',
      label: zh ? '生成资源图快照' : 'Create graph snapshot',
      status: 'pending',
      detail: zh ? '读取当前节点、连线、模型选择和参数。' : 'Read current nodes, links, model choices, and parameters.',
    },
    {
      id: 'dispatch',
      label: zh ? '提交 Agent 运行' : 'Dispatch agent run',
      status: 'pending',
      detail: zh ? '把资源图交给角色资源生成 runtime。' : 'Send the graph to the character resource runtime.',
    },
    {
      id: 'agent',
      label: zh ? 'Agent 生成候选资源' : 'Agent generates candidates',
      status: 'pending',
      detail: zh ? '等待规划、候选包、校验报告和导出目标返回。' : 'Wait for plan, candidate pack, validation report, and export target.',
    },
    {
      id: 'collect',
      label: zh ? '收集运行产物' : 'Collect artifacts',
      status: 'pending',
      detail: zh ? '整理后端返回的资源产物并写入运行草稿。' : 'Normalize returned artifacts into the run draft.',
    },
    {
      id: 'finish',
      label: zh ? '完成' : 'Finish',
      status: 'pending',
      detail: zh ? '运行草稿可以预览或导出。' : 'The run draft can be previewed or exported.',
    },
  ]
}

export function createDraftCharacterResourceRunState(
  runNumber: number,
  status: CharacterResourceRunState['run']['status'] = 'running',
  language: CharacterWorkflowLanguage = 'zh-CN'
): CharacterResourceRunState {
  const id = `resource-run-${Date.now()}-${Math.random().toString(16).slice(2)}`
  return {
    run: {
      id,
      title: `Resource Draft ${String(runNumber).padStart(2, '0')}.run`,
      status,
      currentStepId: 'snapshot',
    },
    steps: createCharacterResourceRunSteps(language),
    events: [],
    artifacts: [],
  }
}

export function completeCharacterResourceRunState(state: CharacterResourceRunState): CharacterResourceRunState {
  const run = state.run ?? createDraftCharacterResourceRunState(1, 'done').run!
  return {
    run: {
      ...run,
      status: 'done',
      currentStepId: 'finish',
    },
    steps: (state.steps?.length ? state.steps : createCharacterResourceRunSteps('zh-CN')).map((step) => ({
      ...step,
      status: 'done',
    })),
    events: state.events ?? [],
    artifacts: state.artifacts ?? [],
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
    return ui(options, '资源图', 'Resource Graph')
  }
  if (tab.id === 'run-draft') {
    return ui(options, '运行草稿', 'Run Draft')
  }
  return tab.title
}

function workflowText(options: CharacterWorkflowPageOptions, key: string, fallback: string): string {
  const translated = options.t?.(key)
  return translated && translated !== key ? translated : fallback
}

function localizeNodeTitle(node: CharacterResourceNode, definition: CharacterResourceNodeDefinition, options: CharacterWorkflowPageOptions): string {
  if (isVirtualMaterialNode(node)) {
    return node.title || definition.displayName
  }
  return workflowText(options, `chat.workflow.node.${definition.type}`, node.title || definition.displayName)
}

function localizeParameterLabel(parameterItem: CharacterResourceParameterDefinition, options: CharacterWorkflowPageOptions, nodeType = ''): string {
  if (nodeType) {
    const translated = options.t?.(`chat.workflow.param.${nodeType}.${parameterItem.id}`)
    if (translated && translated !== `chat.workflow.param.${nodeType}.${parameterItem.id}`) {
      return translated
    }
  }
  return workflowText(options, `chat.workflow.param.${parameterItem.id}`, parameterItem.label)
}

function localizeSlotLabel(slotItem: CharacterResourceSlotDefinition, options: CharacterWorkflowPageOptions): string {
  return workflowText(options, `chat.workflow.slot.${slotItem.id}`, slotItem.label)
}

function formatSlotTypeLabel(type: string): string {
  return SLOT_TYPE_LABELS[type] ?? type.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function formatSlotAcceptLabel(types: string[]): string {
  if (types.length === TARGET_RESOURCE_SLOT_TYPES.length && TARGET_RESOURCE_SLOT_TYPES.every((type) => types.includes(type))) {
    return formatSlotTypeLabel('target-resource')
  }
  return types.map(formatSlotTypeLabel).join(' / ')
}

function localizeCategory(category: string, options: CharacterWorkflowPageOptions): string {
  return workflowText(options, `chat.workflow.category.${category}`, category)
}

function localizeSource(source: string, options: CharacterWorkflowPageOptions): string {
  return workflowText(options, `chat.workflow.source.${source}`, source)
}

function localizeParameterOptionLabel(
  parameterItem: CharacterResourceParameterDefinition,
  optionItem: { label: string; value: string },
  options: CharacterWorkflowPageOptions
): string {
  return workflowText(
    options,
    `chat.workflow.option.${parameterItem.id}.${optionItem.value}`,
    workflowText(options, `chat.workflow.option.${optionItem.value}`, optionItem.label)
  )
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

const PROSE_STYLE_PRESET_OPTIONS = PROSE_STYLE_PRESET_VALUES.map((value) => ({
  label: value.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
  value,
}))

const CHARACTER_CARD_FIELD_OPTIONS = [
  { label: 'Name', value: 'name' },
  { label: 'Description', value: 'description' },
  { label: 'Appearance', value: 'appearance' },
  { label: 'Personality', value: 'personality' },
  { label: 'Background', value: 'background' },
  { label: 'Scenario', value: 'scenario' },
  { label: 'First Message', value: 'firstMessage' },
  { label: 'Dialogue Style', value: 'dialogueStyle' },
  { label: 'World Context', value: 'worldContext' },
]

const CHARACTER_SUPPORT_FIELD_OPTIONS = [
  { label: 'Appearance Prompt', value: 'appearancePrompt' },
]

const CHARACTER_FIELD_OPTIONS = [
  ...CHARACTER_CARD_FIELD_OPTIONS,
  ...CHARACTER_SUPPORT_FIELD_OPTIONS,
]

const DEFAULT_CHARACTER_CARD_FIELDS = CHARACTER_CARD_FIELD_OPTIONS.map((item) => item.value)
const DEFAULT_CHARACTER_SUPPORT_FIELDS = CHARACTER_SUPPORT_FIELD_OPTIONS.map((item) => item.value)
const DEFAULT_CHARACTER_FIELD_TARGET_FIELDS = CHARACTER_FIELD_OPTIONS.map((item) => item.value)

const FIELD_TONE_OPTIONS = [
  { label: 'Neutral', value: 'neutral' },
  { label: 'Warm', value: 'warm' },
  { label: 'Restrained', value: 'restrained' },
  { label: 'Sharp', value: 'sharp' },
  { label: 'Dramatic', value: 'dramatic' },
]

const FIELD_LENGTH_POLICY_OPTIONS = [
  { label: 'Short', value: 'short' },
  { label: 'Medium', value: 'medium' },
  { label: 'Long', value: 'long' },
]

const DEFAULT_CHARACTER_FIELD_CONTROLS: WorkflowFieldControlItem[] = [
  { field: 'name', fieldPurpose: 'Short display name only.', tone: 'neutral', lengthPolicy: 'short', avoidPatterns: [] },
  { field: 'description', fieldPurpose: 'Concise identity hook and roleplay appeal.', tone: 'warm', lengthPolicy: 'medium', avoidPatterns: ['lore-dump'] },
  { field: 'appearance', fieldPurpose: 'Visible body, face, outfit, posture, expression, and motifs.', tone: 'neutral', lengthPolicy: 'medium', avoidPatterns: ['lore-dump'] },
  { field: 'personality', fieldPurpose: 'Inner drives, contradictions, habits, emotional logic, and relationship behavior.', tone: 'sharp', lengthPolicy: 'medium', avoidPatterns: ['self-introduction'] },
  { field: 'background', fieldPurpose: 'Formative history, secrets, losses, obligations, and causes.', tone: 'dramatic', lengthPolicy: 'medium', avoidPatterns: ['lore-dump'] },
  { field: 'scenario', fieldPurpose: 'Persistent present setup, current tension, roles, stakes, and continuation hooks.', tone: 'restrained', lengthPolicy: 'medium', avoidPatterns: ['asking-user-intent'] },
  { field: 'firstMessage', fieldPurpose: 'Playable opening scene wrapped in chat tags with a concrete hook.', tone: 'warm', lengthPolicy: 'long', avoidPatterns: ['ooc-explanation', 'asking-user-intent'] },
  { field: 'dialogueStyle', fieldPurpose: 'Speech rhythm, diction, address style, emotional tells, and taboo phrases.', tone: 'neutral', lengthPolicy: 'medium', avoidPatterns: ['lore-dump'] },
  { field: 'worldContext', fieldPurpose: 'Stable world, institution, social, supernatural, or relationship facts outside one scene.', tone: 'restrained', lengthPolicy: 'medium', avoidPatterns: ['lore-dump'] },
  { field: 'appearancePrompt', fieldPurpose: 'Compact avatar identity seed prompt derived from completed character fields and image controls.', tone: 'neutral', lengthPolicy: 'medium', avoidPatterns: ['ooc-explanation'] },
]

const TARGET_RESOURCE_SLOT_TYPES = [
  'character-card-resource',
  'field-resource',
  'opening-layout-resource',
  'image-resource',
  'world-resource',
  'npc-pack-resource',
  'npc-resource',
  'plot-resource',
  'scene-resource',
]

const SLOT_TYPE_LABELS: Record<string, string> = {
  'agent-policy': 'Agent Policy',
  'candidate-pack': 'Candidate Pack',
  'character-card-resource': 'Character Card',
  'continuity-control-resource': 'Continuity Control',
  'critique-policy': 'Critique Policy',
  'document-resource': 'Document',
  'export-target': 'Export Target',
  'field-resource': 'Field',
  'generation-goal': 'Goal',
  'hard-constraint': 'Constraint',
  'image-capability': 'Image Capability',
  'image-control-resource': 'Image Control',
  'image-resource': 'Image',
  'model-capability': 'Model Capability',
  'npc-pack-resource': 'NPC Pack',
  'npc-resource': 'NPC',
  'opening-layout-resource': 'Opening Layout',
  'plot-resource': 'Plot',
  'relationship-control-resource': 'Relationship Control',
  'retrieval-capability': 'Retrieval Capability',
  'scene-resource': 'Scene',
  'source-context': 'Source',
  'style-signal': 'Style',
  'target-resource': 'Target Resource',
  'validation-report': 'Validation Report',
  'voice-capability': 'Voice Capability',
  'voice-profile': 'Voice Profile',
  'world-resource': 'World',
}

const RESOURCE_NODE_DEFINITIONS: CharacterResourceNodeDefinition[] = [
  createDefinition('goal', 'Generation Goal', ['目标', 'brief', 'intent'], 'Goal', 'core', 'Captures the free-form RP generation target without asking the user to define final card fields.', [], [
    slot('goal', 'Goal', 'generation-goal', 'Natural language generation goal and target audience.'),
  ], [
    param('goalPrompt', 'Goal Prompt', 'textarea', ''),
    param('targetAudience', 'Target Audience', 'text', ''),
    param('allowAgentExpansion', 'Allow Agent Expansion', 'boolean', true),
  ], 'text-card'),
  createDefinition('character-card-target', 'Character Card Target', ['角色卡', 'target', 'role card'], 'Targets', 'asset', 'Declares the complete role card as a target resource assembled from field targets and local controls.', [
    slot('goal', 'Goal', 'generation-goal', 'Primary generation goal.', true),
    slot('style', 'Style', 'style-signal', 'Local or global style pressure.'),
    slot('constraint', 'Constraint', 'hard-constraint', 'Local or global hard constraints.'),
    slot('source', 'Source', 'source-context', 'Grounding source material.'),
  ], [
    slot('target', 'Character Card', 'character-card-resource', 'Character card target resource.'),
    slot('candidate', 'Candidate', 'candidate-pack', 'Candidate package produced for evaluation and export.'),
  ], [
    param('includeFields', 'Include Fields', 'multi-select', DEFAULT_CHARACTER_CARD_FIELDS, undefined, undefined, undefined, CHARACTER_CARD_FIELD_OPTIONS),
    param('includeSupportFields', 'Support Fields', 'multi-select', DEFAULT_CHARACTER_SUPPORT_FIELDS, undefined, undefined, undefined, CHARACTER_SUPPORT_FIELD_OPTIONS),
  ], 'package'),
  createDefinition('character-field-target', 'Character Fields', ['字段', 'field target', '字段控制'], 'Targets', 'asset', 'Declares the field resource and per-field generation controls for the role card in one node.', [
    slot('card', 'Character Card', 'character-card-resource', 'Character card target.'),
    slot('style', 'Style', 'style-signal', 'Local field style pressure.'),
    slot('constraint', 'Constraint', 'hard-constraint', 'Local field constraints.'),
  ], [
    slot('field', 'Field', 'field-resource', 'Field target resource.'),
  ], [
    param('fields', 'Fields', 'multi-select', DEFAULT_CHARACTER_FIELD_TARGET_FIELDS, undefined, undefined, undefined, CHARACTER_FIELD_OPTIONS),
    param('fieldControls', 'Field Controls', 'field-control-list', DEFAULT_CHARACTER_FIELD_CONTROLS, undefined, undefined, undefined, CHARACTER_FIELD_OPTIONS),
  ], 'text-card'),
  createDefinition('opening-layout-target', 'Opening Layout Target', ['开幕版面', 'opening layout', 'css card'], 'Targets', 'asset', 'Declares the CSS/HTML-style opening presentation for the role card, combining opening text, visual assets, title, tags, and card surface layout.', [
    slot('card', 'Character Card', 'character-card-resource', 'Character card target.', true),
    slot('field', 'Field', 'field-resource', 'Opening or supporting text field.'),
    slot('imageAsset', 'Image', 'image-resource', 'Images used by the opening presentation.'),
    slot('style', 'Style', 'style-signal', 'Layout and prose style pressure.'),
    slot('constraint', 'Constraint', 'hard-constraint', 'Layout constraints.'),
  ], [
    slot('layout', 'Layout', 'opening-layout-resource', 'Opening layout target resource.'),
  ], [
    param('layoutKind', 'Layout Kind', 'select', 'immersive-card-css', undefined, undefined, undefined, [
      { label: 'Immersive Card CSS', value: 'immersive-card-css' },
      { label: 'Forum Post Card', value: 'forum-post-card' },
      { label: 'Mobile Chat Intro', value: 'mobile-chat-intro' },
      { label: 'SillyTavern Description Block', value: 'sillytavern-description-block' },
    ]),
    param('includeSections', 'Include Sections', 'multi-select', ['title', 'tags', 'opening', 'coverImage', 'supportImages'], undefined, undefined, undefined, [
      { label: 'Title', value: 'title' },
      { label: 'Tags', value: 'tags' },
      { label: 'Opening', value: 'opening' },
      { label: 'Cover Image', value: 'coverImage' },
      { label: 'Support Images', value: 'supportImages' },
      { label: 'Character Summary', value: 'characterSummary' },
    ]),
    param('layoutPrompt', 'Layout Prompt', 'textarea', ''),
  ], 'package'),
  createDefinition('image-target', 'Image Target', ['图片目标', 'image target', 'visual target'], 'Targets', 'asset', 'Declares a role-card visual asset. Each image should preserve character identity while supporting a distinct story, field, or presentation purpose.', [
    slot('card', 'Character Card', 'character-card-resource', 'Character card target.'),
    slot('image', 'Image', 'image-capability', 'Image generation capability.', true),
    slot('imageControl', 'Image Control', 'image-control-resource', 'Image generation control.'),
    slot('referenceImage', 'Image', 'image-resource', 'Reference image artifact used to preserve visual identity.'),
  ], [
    slot('imageAsset', 'Image', 'image-resource', 'Image target resource.'),
  ], [
    param('imageRole', 'Image Role', 'select', 'character-base-image', undefined, undefined, undefined, [
      { label: 'Avatar', value: 'avatar' },
      { label: 'Character Overview Sheet', value: 'character-overview-sheet' },
      { label: 'Base Character Image', value: 'character-base-image' },
    ]),
    param('assetPurpose', 'Asset Purpose', 'textarea', ''),
  ], 'image'),
  createDefinition('world-card-target', 'World Card Target', ['世界卡', 'world card', 'setting'], 'Targets', 'asset', 'Declares an overall world resource for NPCs, scenes, relationship network, and plot progression.', [
    slot('goal', 'Goal', 'generation-goal', 'Primary world goal.', true),
    slot('style', 'Style', 'style-signal', 'World style pressure.'),
    slot('constraint', 'Constraint', 'hard-constraint', 'World constraints.'),
    slot('source', 'Source', 'source-context', 'Grounding source material.'),
  ], [
    slot('world', 'World', 'world-resource', 'World card resource.'),
  ], [
    param('worldSections', 'World Sections', 'multi-select', ['setting', 'rules', 'factions', 'relationship-network', 'plot-hooks'], undefined, undefined, undefined, [
      { label: 'Setting', value: 'setting' },
      { label: 'Rules', value: 'rules' },
      { label: 'Factions', value: 'factions' },
      { label: 'Relationship Network', value: 'relationship-network' },
      { label: 'Plot Hooks', value: 'plot-hooks' },
    ]),
  ], 'package'),
  createDefinition('npc-pack-target', 'NPC Pack Target', ['NPC包', 'npc pack', '多npc'], 'Targets', 'asset', 'Declares a pack of NPC resources connected to the world card and plot arc.', [
    slot('world', 'World', 'world-resource', 'World card resource.'),
    slot('relationship', 'Relationship', 'relationship-control-resource', 'Relationship control.'),
    slot('style', 'Style', 'style-signal', 'NPC pack style.'),
    slot('constraint', 'Constraint', 'hard-constraint', 'NPC constraints.'),
  ], [
    slot('npcPack', 'NPC Pack', 'npc-pack-resource', 'NPC pack resource.'),
  ], [
    param('npcCount', 'NPC Count', 'integer', 4, 1, 12, 1),
    param('npcRoles', 'NPC Roles', 'multi-select', [], undefined, undefined, undefined, [
      { label: 'Primary NPC', value: 'primary-npc' },
      { label: 'Ally', value: 'ally' },
      { label: 'Rival', value: 'rival' },
      { label: 'Antagonist', value: 'antagonist' },
      { label: 'Mentor', value: 'mentor' },
      { label: 'Wildcard', value: 'wildcard' },
    ]),
  ], 'package'),
  createDefinition('npc-target', 'NPC Target', ['NPC', 'single npc', '角色资源'], 'Targets', 'asset', 'Declares a single NPC as an independently controllable target resource.', [
    slot('npcPack', 'NPC Pack', 'npc-pack-resource', 'NPC pack resource.'),
    slot('style', 'Style', 'style-signal', 'NPC style.'),
    slot('constraint', 'Constraint', 'hard-constraint', 'NPC constraints.'),
    slot('relationship', 'Relationship', 'relationship-control-resource', 'Relationship control.'),
  ], [
    slot('npc', 'NPC', 'npc-resource', 'NPC resource.'),
  ], [
    param('npcRole', 'NPC Role', 'select', 'primary-npc', undefined, undefined, undefined, [
      { label: 'Primary NPC', value: 'primary-npc' },
      { label: 'Ally', value: 'ally' },
      { label: 'Rival', value: 'rival' },
      { label: 'Antagonist', value: 'antagonist' },
      { label: 'Mentor', value: 'mentor' },
      { label: 'Wildcard', value: 'wildcard' },
    ]),
    param('storyFunction', 'Story Function', 'textarea', ''),
  ], 'text-card'),
  createDefinition('plot-arc-target', 'Plot Arc Target', ['剧情', 'plot arc', 'story'], 'Targets', 'asset', 'Declares long-running story progression for the world card.', [
    slot('world', 'World', 'world-resource', 'World card resource.'),
    slot('npcPack', 'NPC Pack', 'npc-pack-resource', 'NPC pack resource.'),
    slot('continuity', 'Continuity', 'continuity-control-resource', 'Continuity control.'),
    slot('style', 'Style', 'style-signal', 'Plot style.'),
    slot('constraint', 'Constraint', 'hard-constraint', 'Plot constraints.'),
  ], [
    slot('plot', 'Plot', 'plot-resource', 'Plot arc resource.'),
  ], [
    param('arcShape', 'Arc Shape', 'select', 'slow-burn', undefined, undefined, undefined, [
      { label: 'Slow Burn', value: 'slow-burn' },
      { label: 'Mystery Escalation', value: 'mystery-escalation' },
      { label: 'Relationship Drama', value: 'relationship-drama' },
      { label: 'Adventure Campaign', value: 'adventure-campaign' },
    ]),
    param('milestoneCount', 'Milestone Count', 'integer', 6, 2, 20, 1),
  ], 'text-card'),
  createDefinition('scene-card-target', 'Scene Card Target', ['场景卡', 'scene card', 'scene'], 'Targets', 'asset', 'Declares reusable scene resources for the current world and plot arc.', [
    slot('world', 'World', 'world-resource', 'World card resource.'),
    slot('plot', 'Plot', 'plot-resource', 'Plot arc resource.'),
    slot('style', 'Style', 'style-signal', 'Scene style.'),
    slot('constraint', 'Constraint', 'hard-constraint', 'Scene constraints.'),
  ], [
    slot('scene', 'Scene', 'scene-resource', 'Scene resource.'),
  ], [
    param('sceneCount', 'Scene Count', 'integer', 3, 1, 12, 1),
    param('sceneTypes', 'Scene Types', 'multi-select', [], undefined, undefined, undefined, [
      { label: 'Opening Scene', value: 'opening-scene' },
      { label: 'Private Conversation', value: 'private-conversation' },
      { label: 'Conflict Scene', value: 'conflict-scene' },
      { label: 'Reveal Scene', value: 'reveal-scene' },
      { label: 'Downtime Scene', value: 'downtime-scene' },
    ]),
  ], 'text-card'),
  createDefinition('style-pressure', 'Style Pressure', ['风格', 'taste', 'tone'], 'Taste', 'core', 'Applies weighted taste, genre, mood, intensity, and pacing pressure to connected targets.', [
    slot('target', 'Target Resource', 'target-resource', 'Target being shaped by this taste profile.', false, TARGET_RESOURCE_SLOT_TYPES),
  ], [
    slot('style', 'Style', 'style-signal', 'Weighted style signal.'),
  ], [
    param('preset', 'Preset', 'select', 'custom', undefined, undefined, undefined, PROSE_STYLE_PRESET_OPTIONS),
    param('intensity', 'Intensity', 'number', 0.68, 0, 1, 0.01),
    param('stylePrompt', 'Style Prompt', 'textarea', ''),
  ], 'rule'),
  createDefinition('constraint', 'Hard Constraint', ['约束', 'boundary', 'must not'], 'Constraints', 'safety', 'Sets hard and soft boundaries that limit connected target generation and repair.', [
    slot('target', 'Target Resource', 'target-resource', 'Target constrained by these boundaries.', false, TARGET_RESOURCE_SLOT_TYPES),
  ], [
    slot('constraint', 'Constraint', 'hard-constraint', 'Constraint signal.'),
  ], [
    param('mustHave', 'Must Have', 'string-list', []),
    param('mustNot', 'Must Not', 'string-list', []),
    param('hardBoundary', 'Hard Boundary', 'boolean', true),
  ], 'rule'),
  createDefinition('image-generation-control', 'Image Generation Control', ['图片控制', 'image control', 'visual control'], 'Controls', 'asset', 'Controls batch count, lightweight visual style, shot, aspect ratio, consistency, and seed behavior for a connected image target.', [], [
    slot('imageControl', 'Image Control', 'image-control-resource', 'Image generation control.'),
  ], [
    param('targetImageCount', 'Image Count', 'integer', 1, 1, 16, 1),
    param('imageStyleDomain', 'Style Domain', 'select', 'auto', undefined, undefined, undefined, [
      { label: 'Auto', value: 'auto' },
      { label: 'Photoreal', value: 'photoreal' },
      { label: 'Anime', value: 'anime' },
      { label: 'Illustration', value: 'illustration' },
      { label: 'Stylized', value: 'stylized' },
    ]),
    param('stylePrompt', 'Style Prompt', 'textarea', ''),
    param('shotType', 'Shot Type', 'select', 'auto', undefined, undefined, undefined, [
      { label: 'Auto', value: 'auto' },
      { label: 'Close Up', value: 'close-up' },
      { label: 'Bust', value: 'bust' },
      { label: 'Knee Up', value: 'knee-up' },
      { label: 'Full Body', value: 'full-body' },
      { label: 'Wide Scene', value: 'wide-scene' },
    ]),
    param('aspectRatio', 'Aspect Ratio', 'select', '1:1', undefined, undefined, undefined, [
      { label: '1:1', value: '1:1' },
      { label: '2:3', value: '2:3' },
      { label: '3:4', value: '3:4' },
      { label: '4:5', value: '4:5' },
      { label: '16:9', value: '16:9' },
      { label: '9:16', value: '9:16' },
    ]),
    param('consistencyMode', 'Consistency Mode', 'select', 'same-character', undefined, undefined, undefined, [
      { label: 'Same Character', value: 'same-character' },
      { label: 'Same World', value: 'same-world' },
      { label: 'Independent Images', value: 'independent' },
    ]),
    param('poseGoals', 'Pose Goals', 'string-list', []),
    param('backgroundInteraction', 'Background Interaction', 'textarea', ''),
    param('appealMode', 'Appeal Mode', 'select', 'sensual-confidence', undefined, undefined, undefined, [
      { label: 'Natural', value: 'natural' },
      { label: 'Romantic', value: 'romantic' },
      { label: 'Sensual Confidence', value: 'sensual-confidence' },
      { label: 'Erotic Tension', value: 'erotic-tension' },
      { label: 'Dramatic', value: 'dramatic' },
      { label: 'Mysterious', value: 'mysterious' },
    ]),
    param('sensualityLevel', 'Sensuality Level', 'select', 'sensual', undefined, undefined, undefined, [
      { label: 'Subtle', value: 'subtle' },
      { label: 'Sensual', value: 'sensual' },
      { label: 'Erotic', value: 'erotic' },
      { label: 'Explicit', value: 'explicit' },
    ]),
    param('wardrobeExposure', 'Wardrobe Exposure', 'select', 'stylish-revealing', undefined, undefined, undefined, [
      { label: 'Covered', value: 'covered' },
      { label: 'Stylish Revealing', value: 'stylish-revealing' },
      { label: 'Lingerie / Swimwear', value: 'lingerie-swimwear' },
      { label: 'Implied Nude', value: 'implied-nude' },
    ]),
    param('seedMode', 'Seed Mode', 'select', 'lock-character', undefined, undefined, undefined, [
      { label: 'Lock Character', value: 'lock-character' },
      { label: 'Vary Slightly', value: 'vary-slightly' },
      { label: 'Explore', value: 'explore' },
    ]),
  ], 'image'),
  createDefinition('continuity-control', 'Continuity Control', ['连续性', 'memory', 'continuity'], 'Controls', 'agent', 'Controls long-form continuity, memory anchors, unresolved hooks, and progression pacing.', [
    slot('target', 'Target Resource', 'target-resource', 'Target resource.', false, TARGET_RESOURCE_SLOT_TYPES),
  ], [
    slot('continuity', 'Continuity', 'continuity-control-resource', 'Continuity control.'),
  ], [
    param('memoryAnchors', 'Memory Anchors', 'multi-select', [], undefined, undefined, undefined, [
      { label: 'Relationship Changes', value: 'relationship-changes' },
      { label: 'Unresolved Promises', value: 'unresolved-promises' },
      { label: 'World Facts', value: 'world-facts' },
      { label: 'Boundaries', value: 'boundaries' },
      { label: 'Long Term Goals', value: 'long-term-goals' },
    ]),
    param('progressionPacing', 'Progression Pacing', 'select', 'slow-burn', undefined, undefined, undefined, [
      { label: 'Slow Burn', value: 'slow-burn' },
      { label: 'Steady Escalation', value: 'steady-escalation' },
      { label: 'Episodic', value: 'episodic' },
    ]),
    param('forbidResettingFacts', 'Forbid Resetting Facts', 'boolean', true),
  ], 'rule'),
  createDefinition('relationship-control', 'Relationship Control', ['关系', 'relationship', 'tension'], 'Controls', 'agent', 'Controls the relational function and tension between NPC, character, and user resources.', [
    slot('target', 'Target Resource', 'target-resource', 'Target resource.', false, TARGET_RESOURCE_SLOT_TYPES),
  ], [
    slot('relationship', 'Relationship', 'relationship-control-resource', 'Relationship control.'),
  ], [
    param('relationshipMode', 'Relationship Mode', 'select', 'slow-trust', undefined, undefined, undefined, [
      { label: 'Slow Trust', value: 'slow-trust' },
      { label: 'Rival Tension', value: 'rival-tension' },
      { label: 'Protective Companion', value: 'protective-companion' },
      { label: 'Ambiguous Ally', value: 'ambiguous-ally' },
    ]),
    param('tensionRules', 'Tension Rules', 'multi-select', [], undefined, undefined, undefined, [
      { label: 'Do Not Resolve Immediately', value: 'do-not-resolve-immediately' },
      { label: 'Conflicting Motives', value: 'conflicting-motives' },
      { label: 'Asymmetric Information', value: 'asymmetric-information' },
      { label: 'Slow Trust', value: 'slow-trust-rule' },
    ]),
  ], 'rule'),
  createDefinition('source-material', 'Source Material', ['素材', 'reference', 'context'], 'Sources', 'asset', 'Imports image and document materials as grounded references. Material kind is inferred from file type.', [
    slot('source', 'Source', 'source-context', 'Parent source material node.'),
  ], [
    slot('source', 'Source', 'source-context', 'Reference context available to the agent.'),
    slot('imageAsset', 'Reference Image', 'image-resource', 'Imported image materials available as image references.'),
  ], [
    param('materials', 'Materials', 'materials', []),
  ], 'text-card'),
  createDefinition('material-image-resource', 'Image Resource', ['图片资源', 'reference image', 'material image'], 'Sources', 'asset', 'Displays one imported image as a standalone reference image resource.', [
    slot('source', 'Source', 'source-context', 'Parent material source.'),
  ], [
    slot('resource', 'Resource', 'image-resource', 'Imported image resource. Connect this to an image target reference slot when needed.'),
  ], [], 'image', { width: 286, height: 252 }),
  createDefinition('material-document-resource', 'Text Resource', ['文本资源', 'document', 'material document'], 'Sources', 'asset', 'Displays one imported document as a standalone grounding text resource.', [
    slot('source', 'Source', 'source-context', 'Parent material source.'),
  ], [
    slot('resource', 'Resource', 'document-resource', 'Imported document resource.'),
  ], [], 'text-card', { width: 238, height: 136 }),
  createDefinition('llm-tool', 'LLM Tool', ['模型', 'llm', 'reasoning'], 'Tools', 'agent', 'Selects the LLM capability available to the backend agent.', [], [
    slot('model', 'Model', 'model-capability', 'LLM model capability.'),
  ], [
    param('modelRef', 'Model', 'model-select', '', undefined, undefined, undefined, undefined, 'llm'),
  ], 'rule'),
  createDefinition('image-tool', 'Image Tool', ['生图', 'image api', 'visual'], 'Tools', 'asset', 'Selects image generation capability. Optional edit model is used for reference-image targets after avatar.', [], [
    slot('image', 'Image', 'image-capability', 'Image generation capability.'),
  ], [
    param('modelRef', 'Model / Workflow', 'model-select', '', undefined, undefined, undefined, undefined, 'image'),
    param('editModelRef', 'Edit Model / Workflow', 'model-select', '', undefined, undefined, undefined, undefined, 'image'),
    param('identityStrength', 'Identity Strength', 'number', 0.72, 0, 1, 0.01),
    param('compositionFreedom', 'Composition Freedom', 'number', 0.58, 0, 1, 0.01),
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
    param('revisionBudget', 'Revision Budget', 'integer', 12, 1, 24, 1),
    param('askUserThreshold', 'Ask User Threshold', 'select', 'blocked-only', undefined, undefined, undefined, [
      { label: 'Never During Run', value: 'never' },
      { label: 'Blocked Only', value: 'blocked-only' },
      { label: 'Low Confidence', value: 'low-confidence' },
    ]),
  ], 'rule'),
  createDefinition('generation-strategy', 'Generation Strategy', ['策略', 'workflow', 'plan'], 'Strategy', 'agent', 'Controls how the agent branches, compares candidates, orders phases, and stops.', [
    slot('goal', 'Goal', 'generation-goal', 'Goal to plan around.', true),
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
    param('priorityAssets', 'Priority Assets', 'multi-select', ['role-card', 'opening', 'opening-layout', 'image-pack'], undefined, undefined, undefined, [
      { label: 'Role Card', value: 'role-card' },
      { label: 'Opening', value: 'opening' },
      { label: 'Opening Layout', value: 'opening-layout' },
      { label: 'Image Pack', value: 'image-pack' },
    ]),
  ], 'rule'),
  createDefinition('critique-loop', 'Critique Loop', ['自评', 'repair', 'critic'], 'Evaluation', 'agent', 'Feeds critique and repair instructions back into candidate generation.', [
    slot('strategy', 'Strategy', 'strategy-policy', 'Strategy to refine.', true),
  ], [
    slot('critique', 'Critique', 'critique-policy', 'Critique and repair policy.'),
  ], [
    param('iterations', 'Iterations', 'integer', 2, 0, 8, 1),
    param('dimensions', 'Dimensions', 'multi-select', [], undefined, undefined, undefined, [
      { label: 'Goal Match', value: 'goal-match' },
      { label: 'Field Completeness', value: 'field-completeness' },
      { label: 'Roleplay Usability', value: 'roleplay-usability' },
      { label: 'Appearance Prompt', value: 'appearance-prompt' },
      { label: 'Consistency', value: 'consistency' },
    ]),
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
    param('requiredChecks', 'Required Checks', 'multi-select', [], undefined, undefined, undefined, [
      { label: 'Goal Match', value: 'goal-match' },
      { label: 'Field Completeness', value: 'field-completeness' },
      { label: 'Roleplay Usability', value: 'roleplay-usability' },
      { label: 'Appearance Prompt', value: 'appearance-prompt' },
      { label: 'Consistency', value: 'consistency' },
    ]),
  ], 'validation'),
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
  createDefinition('run-input-resource', 'User Input Graph', ['运行输入', 'input graph', 'resource snapshot'], 'Run Resources', 'core', 'The graph snapshot supplied by the user before the agent starts filling role resources.', [], [
    slot('resource', 'Resource', 'role-resource', 'Starting resource graph snapshot.'),
  ], [], 'text-card', { width: 268, height: 188 }),
  createDefinition('source-material-resource', 'Source Material', ['素材', 'material', 'reference'], 'Run Resources', 'asset', 'Imported source image or document material available to the runtime.', [
    slot('resource', 'Resource', 'role-resource', 'Previous resource.'),
  ], [
    slot('resource', 'Resource', 'role-resource', 'Imported material resource.'),
  ], [], 'text-card', { width: 268, height: 188 }),
  createDefinition('candidate-pack-resource', 'Candidate Pack', ['候选包', 'candidate', 'role resource pack'], 'Run Resources', 'asset', 'A generated package that reserves the role card, opening, context, visual prompts, and export resources.', [
    slot('resource', 'Resource', 'role-resource', 'Previous generated role resource.'),
  ], [
    slot('resource', 'Resource', 'role-resource', 'Candidate package resource.'),
  ], [], 'package', { width: 268, height: 188 }),
  createDefinition('role-card-resource', 'Role Card', ['角色卡', 'character card', 'persona'], 'Run Resources', 'asset', 'The generated role card content.', [
    slot('resource', 'Resource', 'role-resource', 'Previous generated role resource.'),
  ], [
    slot('resource', 'Resource', 'role-resource', 'Role card resource.'),
  ], [], 'text-card', { width: 268, height: 188 }),
  createDefinition('character-field-resource', 'Character Field', ['字段', 'character field', 'field patch'], 'Run Fields', 'asset', 'A single generated or rerolled character field.', [
    slot('resource', 'Resource', 'role-resource', 'Previous generated field or resource.'),
  ], [
    slot('resource', 'Resource', 'role-resource', 'Generated field resource.'),
  ], [], 'text-card', { width: 238, height: 142 }),
  createDefinition('opening-resource', 'Opening Message', ['开场', 'first message', 'opening'], 'Run Resources', 'asset', 'The generated opening message used to start the role chat.', [
    slot('resource', 'Resource', 'role-resource', 'Previous generated role resource.'),
  ], [
    slot('resource', 'Resource', 'role-resource', 'Opening message resource.'),
  ], [], 'text-card', { width: 268, height: 188 }),
  createDefinition('opening-panel-resource', 'Opening Panel', ['开幕面板', 'css panel', 'sillytavern panel'], 'Run Resources', 'asset', 'A CSS/HTML opening panel assembled from generated text and images.', [
    slot('resource', 'Resource', 'role-resource', 'Previous generated role resource.'),
  ], [
    slot('resource', 'Resource', 'role-resource', 'Opening panel resource.'),
  ], [], 'package', { width: 420, height: 360 }),
  createDefinition('style-guide-resource', 'Dialogue Style', ['语气', 'style guide', 'dialogue'], 'Run Resources', 'asset', 'The generated dialogue style guide for the role.', [
    slot('resource', 'Resource', 'role-resource', 'Previous generated role resource.'),
  ], [
    slot('resource', 'Resource', 'role-resource', 'Dialogue style resource.'),
  ], [], 'rule', { width: 268, height: 188 }),
  createDefinition('context-resource', 'Context Resource', ['上下文', 'world', 'scene'], 'Run Resources', 'asset', 'Generated world or scene context that supports the role.', [
    slot('resource', 'Resource', 'role-resource', 'Previous generated role resource.'),
  ], [
    slot('resource', 'Resource', 'role-resource', 'Context resource.'),
  ], [], 'text-card', { width: 268, height: 188 }),
  createDefinition('image-prompt-resource', 'Image Prompt', ['生图提示', 'visual prompt', 'image prompt'], 'Run Resources', 'asset', 'Prompt material prepared for image generation.', [
    slot('resource', 'Resource', 'role-resource', 'Previous generated role resource.'),
  ], [
    slot('resource', 'Resource', 'role-resource', 'Image prompt resource.'),
  ], [], 'text-card', { width: 268, height: 188 }),
  createDefinition('image-asset-resource', 'Generated Image', ['图片', 'image asset', 'visual'], 'Run Resources', 'asset', 'Generated visual asset for the role.', [
    slot('resource', 'Resource', 'role-resource', 'Previous generated role resource.'),
  ], [
    slot('resource', 'Resource', 'role-resource', 'Generated image resource.'),
  ], [], 'image', { width: 268, height: 292 }),
  createDefinition('quality-report-resource', 'Quality Report', ['校验', 'quality', 'report'], 'Run Resources', 'safety', 'Generated quality report for the role resource package.', [
    slot('resource', 'Resource', 'role-resource', 'Previous generated role resource.'),
  ], [
    slot('resource', 'Resource', 'role-resource', 'Quality report resource.'),
  ], [], 'validation', { width: 268, height: 188 }),
  createDefinition('export-package-resource', 'Export Package', ['导出包', 'export', 'package'], 'Run Resources', 'core', 'Final export package produced from the generated role resources.', [
    slot('resource', 'Resource', 'role-resource', 'Previous generated role resource.'),
  ], [
    slot('resource', 'Resource', 'role-resource', 'Export package resource.'),
  ], [], 'package', { width: 268, height: 188 }),
]

const DEFAULT_NODE_PLACEMENT: Array<{ id: string; type: string; title: string; x: number; y: number; status?: CharacterResourceNodeStatus }> = [
  { id: 'generation-goal', type: 'goal', title: 'Generation Goal', x: 40, y: 120, status: 'dirty' },
  { id: 'source-material', type: 'source-material', title: 'Source Material', x: 40, y: 390 },
  { id: 'style-pressure', type: 'style-pressure', title: 'Style Pressure', x: 360, y: -100 },
  { id: 'character-card-target', type: 'character-card-target', title: 'Character Card Target', x: 360, y: 120 },
  { id: 'hard-constraints', type: 'constraint', title: 'Hard Constraints', x: 360, y: 360 },
  { id: 'character-fields', type: 'character-field-target', title: 'Character Fields', x: 700, y: -20 },
  { id: 'avatar-image-target', type: 'image-target', title: 'Avatar Image Target', x: 700, y: 230, status: 'queued' },
  { id: 'avatar-image-control', type: 'image-generation-control', title: 'Avatar Image Control', x: 1040, y: 230 },
  { id: 'overview-sheet-image-target', type: 'image-target', title: 'Overview Sheet Image Target', x: 700, y: 480, status: 'queued' },
  { id: 'overview-sheet-image-control', type: 'image-generation-control', title: 'Overview Sheet Image Control', x: 1040, y: 480 },
  { id: 'opening-panel-image-target', type: 'image-target', title: 'Opening Panel Images Target', x: 700, y: 730, status: 'queued' },
  { id: 'opening-panel-image-control', type: 'image-generation-control', title: 'Opening Panel Images Control', x: 1040, y: 730 },
  { id: 'llm-capability', type: 'llm-tool', title: 'LLM Tool', x: 1040, y: -260 },
  { id: 'image-capability', type: 'image-tool', title: 'Image Tool', x: 1040, y: 980 },
  { id: 'agent-policy', type: 'agent-policy', title: 'Agent Policy', x: 1400, y: 40 },
  { id: 'opening-layout-target', type: 'opening-layout-target', title: 'Opening Layout Target', x: 1400, y: 580 },
  { id: 'generation-strategy', type: 'generation-strategy', title: 'Generation Strategy', x: 1740, y: 40 },
  { id: 'critique-loop', type: 'critique-loop', title: 'Critique Loop', x: 1740, y: 330 },
  { id: 'quality-gate', type: 'quality-gate', title: 'Quality Gate', x: 2080, y: 190, status: 'stale' },
  { id: 'output-adapter', type: 'output-adapter', title: 'Output Adapter', x: 2420, y: 190 },
]

const DEFAULT_LINKS: CharacterResourceLink[] = [
  link('generation-goal', 'goal', 'character-card-target', 'goal', 'guides'),
  link('character-card-target', 'target', 'style-pressure', 'target', 'weights'),
  link('character-card-target', 'target', 'hard-constraints', 'target', 'constrains'),
  link('source-material', 'source', 'character-card-target', 'source', 'grounds'),
  link('character-card-target', 'target', 'character-fields', 'card', 'guides'),
  link('style-pressure', 'style', 'character-fields', 'style', 'weights'),
  link('hard-constraints', 'constraint', 'character-fields', 'constraint', 'constrains'),
  link('character-card-target', 'target', 'avatar-image-target', 'card', 'guides'),
  link('image-capability', 'image', 'avatar-image-target', 'image', 'enables'),
  link('avatar-image-control', 'imageControl', 'avatar-image-target', 'imageControl', 'guides'),
  link('character-card-target', 'target', 'overview-sheet-image-target', 'card', 'guides'),
  link('avatar-image-target', 'imageAsset', 'overview-sheet-image-target', 'referenceImage', 'provides'),
  link('image-capability', 'image', 'overview-sheet-image-target', 'image', 'enables'),
  link('overview-sheet-image-control', 'imageControl', 'overview-sheet-image-target', 'imageControl', 'guides'),
  link('character-card-target', 'target', 'opening-panel-image-target', 'card', 'guides'),
  link('avatar-image-target', 'imageAsset', 'opening-panel-image-target', 'referenceImage', 'provides'),
  link('image-capability', 'image', 'opening-panel-image-target', 'image', 'enables'),
  link('opening-panel-image-control', 'imageControl', 'opening-panel-image-target', 'imageControl', 'guides'),
  link('character-card-target', 'target', 'opening-layout-target', 'card', 'guides'),
  link('character-fields', 'field', 'opening-layout-target', 'field', 'guides'),
  link('avatar-image-target', 'imageAsset', 'opening-layout-target', 'imageAsset', 'guides'),
  link('overview-sheet-image-target', 'imageAsset', 'opening-layout-target', 'imageAsset', 'guides'),
  link('opening-panel-image-target', 'imageAsset', 'opening-layout-target', 'imageAsset', 'guides'),
  link('style-pressure', 'style', 'opening-layout-target', 'style', 'weights'),
  link('generation-goal', 'goal', 'agent-policy', 'goal', 'guides'),
  link('hard-constraints', 'constraint', 'agent-policy', 'constraint', 'constrains'),
  link('source-material', 'source', 'agent-policy', 'source', 'grounds'),
  link('llm-capability', 'model', 'agent-policy', 'model', 'enables'),
  link('agent-policy', 'policy', 'generation-strategy', 'policy', 'guides'),
  link('generation-goal', 'goal', 'generation-strategy', 'goal', 'guides'),
  link('generation-strategy', 'strategy', 'critique-loop', 'strategy', 'routes'),
  link('critique-loop', 'critique', 'quality-gate', 'critique', 'evaluates'),
  link('character-card-target', 'candidate', 'quality-gate', 'candidate', 'evaluates'),
  link('character-card-target', 'candidate', 'output-adapter', 'candidate', 'exports'),
  link('quality-gate', 'report', 'output-adapter', 'report', 'constrains'),
]

const definitionFuse = new Fuse(RESOURCE_NODE_DEFINITIONS, {
  keys: ['type', 'displayName', 'aliases', 'category', 'source', 'description', 'inputs.type', 'outputs.type'],
  threshold: 0.28,
  ignoreLocation: true,
})

const workbenchCleanups = new WeakMap<HTMLElement, Array<() => void>>()
const workflowMotionSnapshots = new WeakMap<HTMLElement, WorkflowMotionSnapshot>()
const runDraftMotionSnapshots = new WeakMap<HTMLElement, WorkflowMotionSnapshot>()

interface WorkflowMotionSnapshot {
  nodes: Map<string, { x: number; y: number; status: string; selected: boolean; configHash: string }>
  links: Set<string>
}

export function renderCharacterWorkflowPage(options: CharacterWorkflowPageOptions): string {
  const graph = createCharacterResourceGraph(options)
  const graphSnapshot = createGraphSerializerSnapshot(graph)
  const activeTab = normalizeActiveTab(options.activeTabId)
  const isWorkflowTab = activeTab === 'workflow'
  const isRunTab = activeTab === 'run-draft'
  const hasRightPanel = isWorkflowTab || isRunTab
  return `
    <div class="chat-character-workflow-shell chat-resource-workbench ${isWorkflowTab ? 'is-workflow-tab' : 'is-review-tab'} ${isRunTab ? 'is-run-tab' : ''} ${options.nodeSearchOpen ? 'is-node-search-open' : ''}" data-resource-graph-id="${options.escapeHtml(graph.id)}" data-resource-placement-label="${options.escapeHtml(ui(options, '放置位置', 'Placement'))}">
      ${renderFileTabs(options)}
      <div class="chat-character-workflow-stage">
        <div class="chat-resource-workspace ${isWorkflowTab ? 'workflow-mode' : isRunTab ? 'run-mode' : 'review-mode'} ${options.sidebarCollapsed ? 'sidebar-collapsed' : ''} ${options.inspectorCollapsed ? 'inspector-collapsed' : ''}" style="--resource-left-panel: ${graph.panels.leftWidth}px; --resource-right-panel: ${graph.panels.rightWidth}px; --resource-bottom-panel: ${graph.panels.bottomHeight}px">
          ${isWorkflowTab ? renderResourceLibrary(graph, options) : ''}
          ${isWorkflowTab ? '<div class="chat-resource-split-gutter left" data-resource-split-gutter="left" aria-hidden="true"></div>' : ''}
          ${renderResourceCanvas(graph, graphSnapshot, options)}
          ${hasRightPanel ? '<div class="chat-resource-split-gutter right" data-resource-split-gutter="right" aria-hidden="true"></div>' : ''}
          ${isWorkflowTab ? renderResourceInspector(graph, options) : ''}
          ${isRunTab && !options.inspectorCollapsed ? renderRunCharacterInspector(options) : ''}
          ${isWorkflowTab || isRunTab ? renderBottomToolbar(graph, options, activeTab) : ''}
        </div>
      </div>
    </div>
  `
}

export function renderCharacterWorkflowRunDraftViewport(options: CharacterWorkflowPageOptions): string {
  return renderRunDraft(createCharacterResourceGraph(options), options)
}

export function renderCharacterWorkflowRunDraftControls(options: CharacterWorkflowPageOptions): string {
  return renderRunCanvasControls(options)
}

export function renderCharacterWorkflowRunDraftInspector(options: CharacterWorkflowPageOptions): string {
  return renderRunCharacterInspector(options)
}

export function createCharacterAgentWorkflowSnapshot(options: CharacterWorkflowPageOptions): Record<string, unknown> {
  const graph = createCharacterResourceGraph(options)
  const definitions = new Map(RESOURCE_NODE_DEFINITIONS.map((definition) => [definition.type, definition]))
  const now = Date.now()
  return {
    id: graph.id,
    name: graph.title,
    version: '3.0',
    description: 'Frontend-authored agentic RP resource graph.',
    nodes: graph.nodes.map((node) => {
      const definition = definitions.get(node.type)
      const serializedType = getSerializableNodeType(node)
      return {
        id: node.id,
        type: serializedType,
        title: node.title,
        position: node.position,
        inputs: Object.fromEntries((definition?.inputs ?? []).map((slotItem) => [slotItem.id, {
          id: slotItem.id,
          label: slotItem.label,
          artifactType: slotItem.type,
          required: Boolean(slotItem.required),
        }])),
        outputs: Object.fromEntries((definition?.outputs ?? []).map((slotItem) => [slotItem.id, {
          id: slotItem.id,
          label: slotItem.label,
          artifactType: slotItem.type,
          required: Boolean(slotItem.required),
        }])),
        parameters: (definition?.parameters ?? []).map((parameterItem) => ({
          id: parameterItem.id,
          label: parameterItem.label,
          type: parameterItem.type,
          defaultValue: parameterItem.defaultValue,
          options: parameterItem.options?.map((optionItem) => ({
            label: optionItem.label,
            value: optionItem.value,
          })),
        })),
        config: getSerializableNodeConfig(node),
        state: { status: node.status === 'dirty' ? 'idle' : node.status },
      }
    }),
    edges: graph.links.map((linkItem) => ({
      id: linkItem.id,
      from: {
        nodeId: linkItem.sourceNodeId,
        port: linkItem.sourceSlotId,
      },
      to: {
        nodeId: linkItem.targetNodeId,
        port: linkItem.targetSlotId,
      },
      kind: linkItem.kind,
    })),
    defaults: {
      language: options.language,
    },
    metadata: {
      createdAt: now,
      updatedAt: now,
    },
  }
}

function getSerializableNodeConfig(node: CharacterResourceNode): Record<string, unknown> {
  if (node.id === 'source-material' && Array.isArray(node.config.materials)) {
    return {
      ...node.config,
      materials: [],
    }
  }
  return node.config
}

function getSerializableNodeType(node: CharacterResourceNode): string {
  if (node.type === 'material-image-resource' || node.type === 'material-document-resource') {
    return 'source-material'
  }
  return node.type
}

export function initializeCharacterResourceWorkbench(root: HTMLElement): void {
  workbenchCleanups.get(root)?.forEach((cleanup) => cleanup())
  const cleanups: Array<() => void> = []
  const workspace = root.querySelector<HTMLElement>('.chat-resource-workspace')
  const leftGutter = root.querySelector<HTMLElement>('[data-resource-split-gutter="left"]')
  const rightGutter = root.querySelector<HTMLElement>('[data-resource-split-gutter="right"]')
  if (workspace && (leftGutter || rightGutter)) {
    const columnGutters = [
      leftGutter ? { element: leftGutter, track: 1 } : undefined,
      rightGutter ? { element: rightGutter, track: 3 } : undefined,
    ].filter((gutter): gutter is { element: HTMLElement; track: number } => Boolean(gutter))
    const split = Split({
      columnGutters,
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
      const targetNode = (event.target as HTMLElement | null)?.closest<HTMLElement>('.chat-resource-node')
      const context = targetNode ? 'node' : 'canvas'
      const nodeId = targetNode?.dataset.chatWorkflowNodeId ?? ''
      if (nodeId) {
        root.dispatchEvent(new CustomEvent('character-resource-node-context', {
          bubbles: true,
          detail: { nodeId },
        }))
      }
      contextMenu.dataset.resourceContext = context
      contextMenu.dataset.resourceContextNode = nodeId
      contextMenu.querySelectorAll<HTMLButtonElement>('[data-resource-menu-scope]').forEach((item) => {
        const scope = item.dataset.resourceMenuScope ?? 'all'
        item.hidden = scope !== 'all' && scope !== context
      })
      contextMenu.classList.add('is-open')
      const canvasRect = canvas.getBoundingClientRect()
      const menuRect = contextMenu.getBoundingClientRect()
      const padding = 8
      const rawX = event.clientX - canvasRect.left
      const rawY = event.clientY - canvasRect.top
      const maxX = Math.max(padding, canvasRect.width - menuRect.width - padding)
      const maxY = Math.max(padding, canvasRect.height - menuRect.height - padding)
      contextMenu.style.left = `${Math.min(Math.max(rawX, padding), maxX)}px`
      contextMenu.style.top = `${Math.min(Math.max(rawY, padding), maxY)}px`
      contextMenu.querySelector<HTMLButtonElement>('[role="menuitem"]:not([hidden])')?.focus()
    }
    const closeContextMenu = () => contextMenu?.classList.remove('is-open')
    const handleContextMenuKey = (event: KeyboardEvent) => {
      if (!contextMenu?.classList.contains('is-open')) {
        return
      }
      const menuItems = Array.from(contextMenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([hidden])'))
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
        accepts: slotElement.dataset.resourceSlotAccepts ?? '',
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
        sourceAccepts: sourceSlot.dataset.resourceSlotAccepts ?? '',
        targetNodeId: targetSlot.dataset.resourceSlotNode ?? '',
        targetSlotId: targetSlot.dataset.resourceSlotId ?? '',
        targetSide: targetSlot.dataset.resourceSlotSide ?? '',
        targetType: targetSlot.dataset.resourceSlotType ?? '',
        targetAccepts: targetSlot.dataset.resourceSlotAccepts ?? '',
      },
    }))
  }
  const areSlotElementsCompatible = (sourceSlot: HTMLElement, targetSlot: HTMLElement): boolean => {
    if (sourceSlot === targetSlot || sourceSlot.dataset.resourceSlotSide === targetSlot.dataset.resourceSlotSide) {
      return false
    }
    const outputSlot = sourceSlot.dataset.resourceSlotSide === 'output' ? sourceSlot : targetSlot
    const inputSlot = sourceSlot.dataset.resourceSlotSide === 'input' ? sourceSlot : targetSlot
    const outputType = outputSlot.dataset.resourceSlotType ?? ''
    const inputType = inputSlot.dataset.resourceSlotType ?? ''
    const acceptedTypes = parseSlotAccepts(inputSlot.dataset.resourceSlotAccepts, inputType)
    return Boolean(outputType && acceptedTypes.includes(outputType))
  }
  const inferNodeSurfaceSlot = (slotElement: HTMLElement, event: PointerEvent) => {
    const sourceSide = slotElement.dataset.resourceSlotSide ?? ''
    const targetNode = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.chat-resource-node')
    if (!targetNode || targetNode.contains(slotElement)) {
      return null
    }
    const candidates = Array.from(targetNode.querySelectorAll<HTMLElement>('.chat-resource-slot'))
      .filter((candidate) => candidate.dataset.resourceSlotSide !== sourceSide && areSlotElementsCompatible(slotElement, candidate))
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
        .filter((candidate) => candidate !== slotElement && areSlotElementsCompatible(slotElement, candidate))
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
      if (inferredTarget && areSlotElementsCompatible(slotElement, inferredTarget)) {
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
      Link2Off,
      Maximize,
      MessageCircle,
      Play,
      RotateCcw,
      Save,
      Search,
      Square,
      Trash2,
    },
    root,
  })
  animateRunDraftCanvas(root, cleanups)
  animateWorkflowCanvasChanges(root, cleanups)
  animateAgentOperationFeedback(root, cleanups)
  workbenchCleanups.set(root, cleanups)
}

function createCharacterResourceGraph(options: CharacterWorkflowPageOptions): CharacterResourceGraph {
  const definitions = new Map(RESOURCE_NODE_DEFINITIONS.map((definition) => [definition.type, definition]))
  const viewState = options.viewState ?? {}
  const activeTab = normalizeActiveTab(options.activeTabId)
  const collapsedNodeIds = new Set(viewState.collapsedNodeIds ?? [])
  const deletedNodeIds = new Set(viewState.deletedNodeIds ?? [])
  const nodes = DEFAULT_NODE_PLACEMENT.map((placement, index) => {
    const definition = definitions.get(placement.type)!
    const config = {
      ...Object.fromEntries(definition.parameters.map((parameterItem) => [parameterItem.id, getParameterDefaultValue(parameterItem, options)])),
      ...(options.configOverrides?.[placement.id] ?? {}),
    }
    return {
      id: placement.id,
      type: placement.type,
      title: placement.title,
      position: options.positionOverrides?.[placement.id] ?? { x: placement.x, y: placement.y },
      size: viewState.nodeSizes?.[placement.id] ?? definition.defaultSize,
      status: placement.status ?? 'idle',
      collapsed: collapsedNodeIds.has(placement.id),
      zIndex: index + 1,
      config,
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
        ...Object.fromEntries(definition.parameters.map((parameterItem) => [parameterItem.id, getParameterDefaultValue(parameterItem, options)])),
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
  const materialVirtual = createMaterialVirtualNodes(nodes, options)
  nodes.push(...materialVirtual.nodes)
  const runArtifacts = options.runState?.artifacts ?? []
  const outputs = runArtifacts.flatMap((artifact) => {
    if (!artifact.sourceNodeId) {
      return []
    }
    const node = nodes.find((item) => item.id === artifact.sourceNodeId)
    if (!node) {
      return []
    }
    const definition = definitions.get(node.type)!
    return [{
      id: artifact.id ?? `${node.id}-output`,
      nodeId: node.id,
      type: artifact.type ?? definition.outputs[0]?.type ?? definition.previewType,
      title: artifact.title ?? definition.displayName,
      summary: artifact.summary ?? '',
      status: 'done',
    } satisfies CharacterResourceOutput]
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
    ...materialVirtual.links,
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
      { id: 'intent-targets', title: ui(options, '目标资源', 'Target Resources'), nodeIds: ['generation-goal', 'character-card-target', 'character-fields', 'avatar-image-target', 'overview-sheet-image-target', 'opening-panel-image-target', 'opening-layout-target', 'source-material'], color: 'rgba(82, 168, 255, 0.16)' },
      { id: 'local-controls', title: ui(options, '局部控制', 'Local Controls'), nodeIds: ['style-pressure', 'hard-constraints', 'avatar-image-control', 'overview-sheet-image-control', 'opening-panel-image-control'], color: 'rgba(162, 202, 188, 0.16)' },
      { id: 'tool-policy', title: ui(options, '工具与策略', 'Tools and Strategy'), nodeIds: ['llm-capability', 'image-capability', 'agent-policy', 'generation-strategy'], color: 'rgba(219, 189, 130, 0.16)' },
      { id: 'evaluation-output', title: ui(options, '评估与输出', 'Evaluation and Output'), nodeIds: ['critique-loop', 'quality-gate', 'output-adapter'], color: 'rgba(206, 154, 118, 0.16)' },
    ],
    tabs: [
      { id: 'workflow', title: 'Draft 01.resourcegraph', kind: 'resource-graph' },
      { id: 'run-draft', title: 'Run Draft', kind: 'run-draft' },
    ],
    viewport: { x: viewState.panX ?? 0, y: viewState.panY ?? 0, zoom: viewState.zoom ?? 0.84 },
    selection: { nodeIds: viewState.selectedNodeIds?.length ? viewState.selectedNodeIds : [options.selectedNodeId || 'generation-goal'], linkIds: viewState.selectedLinkId ? [viewState.selectedLinkId] : [] },
    panels: {
      leftWidth: options.sidebarCollapsed ? 0 : 246,
      rightWidth: options.inspectorCollapsed ? 0 : activeTab === 'run-draft' ? 300 : 252,
      bottomHeight: 62,
      activePanel: options.activePanel,
    },
    outputs,
  }
}

function createMaterialVirtualNodes(
  nodes: CharacterResourceNode[],
  options: CharacterWorkflowPageOptions
): { nodes: CharacterResourceNode[]; links: CharacterResourceLink[] } {
  const sourceNode = nodes.find((node) => node.id === 'source-material')
  const materials = normalizeWorkflowMaterials(sourceNode?.config.materials)
  if (!sourceNode || !materials.length) {
    return { nodes: [], links: [] }
  }
  const virtualNodes = materials.map((material, index): CharacterResourceNode => {
    const nodeId = materialVirtualNodeId(material)
    return {
      id: nodeId,
      type: material.kind === 'image' ? 'material-image-resource' : 'material-document-resource',
      title: material.name,
      position: options.positionOverrides?.[nodeId] ?? {
        x: sourceNode.position.x + 300,
        y: sourceNode.position.y + index * (material.kind === 'image' ? 280 : 150) - 24,
      },
      size: { width: material.kind === 'image' ? 286 : 238, height: material.kind === 'image' ? 252 : 136 },
      status: 'done',
      collapsed: false,
      zIndex: sourceNode.zIndex + index + 1,
      config: { materials: [material] },
    }
  })
  const links: CharacterResourceLink[] = []
  virtualNodes.forEach((node) => {
    links.push({
      id: `${sourceNode.id}.source->${node.id}.source`,
      sourceNodeId: sourceNode.id,
      sourceSlotId: 'source',
      targetNodeId: node.id,
      targetSlotId: 'source',
      kind: 'grounds',
      label: LINK_KIND_LABELS.grounds,
      status: 'valid',
    })
  })
  return { nodes: virtualNodes, links }
}

function materialVirtualNodeId(material: WorkflowMaterialItem): string {
  return `source-material-item-${sanitizeResourceId(material.id || material.name)}`
}

function isVirtualMaterialNode(node: CharacterResourceNode): boolean {
  return node.id.startsWith('source-material-item-')
}

function animateRunDraftCanvas(root: HTMLElement, cleanups: Array<() => void>): void {
  const runViewport = root.querySelector<HTMLElement>('.chat-resource-run-viewport')
  if (!runViewport) {
    return
  }
  const snapshot = captureWorkflowMotionSnapshot(runViewport)
  const previous = runDraftMotionSnapshots.get(root)
  runDraftMotionSnapshots.set(root, snapshot)
  runViewport.dataset.runDraftInitialized = 'true'
  if (!runViewport.classList.contains('run-status-running') || !previous || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return
  }
  const nodes = Array.from(runViewport.querySelectorAll<HTMLElement>('.chat-resource-node'))
  const linkGroups = Array.from(runViewport.querySelectorAll<SVGGElement>('.chat-resource-link'))
  const visibleNodeIds = new Set(previous?.nodes.keys() ?? [])
  const newNodes = nodes.filter((node) => !visibleNodeIds.has(node.dataset.chatWorkflowNodeId ?? ''))
  const newNodeIds = new Set(newNodes.map((node) => node.dataset.chatWorkflowNodeId ?? '').filter(Boolean))
  const newLinkGroups = linkGroups.filter((link) => {
    const linkId = link.getAttribute('data-chat-resource-link-id') ?? ''
    return !previous?.links.has(linkId) || [...newNodeIds].some((nodeId) => linkId.endsWith(`->${nodeId}`))
  })
  if (!newNodes.length && !newLinkGroups.length) {
    return
  }
  newNodes.forEach((node) => {
    node.style.opacity = '0'
    node.style.visibility = 'hidden'
    node.style.transformOrigin = '50% 0%'
  })
  newLinkGroups.forEach((link) => {
    link.style.opacity = '0'
    link.style.visibility = 'hidden'
  })
  newLinkGroups
    .flatMap((link) => Array.from(link.querySelectorAll<SVGPathElement>('path:not(.hit-area)')))
    .forEach((path) => {
      const length = Math.max(1, Math.ceil(path.getTotalLength()))
      path.style.opacity = '0'
      path.style.strokeDasharray = `${length}`
      path.style.strokeDashoffset = `${length}`
    })
  let reverted = false
  import('gsap').then(({ gsap }) => {
    if (reverted || !runViewport.isConnected) {
      return
    }
    const ctx = gsap.context(() => {
      const movedNodes = nodes.flatMap((node) => {
        const nodeId = node.dataset.chatWorkflowNodeId ?? ''
        const before = previous?.nodes.get(nodeId)
        const after = snapshot.nodes.get(nodeId)
        if (!before || !after || newNodeIds.has(nodeId)) return []
        const dx = before.x - after.x
        const dy = before.y - after.y
        return Math.abs(dx) > 1 || Math.abs(dy) > 1 ? [{ node, dx, dy }] : []
      })
      gsap.killTweensOf([
        ...nodes,
        ...linkGroups.flatMap((link) => Array.from(link.querySelectorAll<SVGPathElement>('path:not(.hit-area)'))),
      ])
      if (movedNodes.length) {
        gsap.fromTo(movedNodes.map((item) => item.node), {
          x: (index) => movedNodes[index]?.dx ?? 0,
          y: (index) => movedNodes[index]?.dy ?? 0,
        }, {
          x: 0,
          y: 0,
          duration: 0.48,
          ease: 'expo.out',
          clearProps: 'transform',
        })
      }
      const timelineNodes = newNodes
        .filter((node) => node.dataset.chatWorkflowNodeId !== 'run-input-source')
        .slice()
        .sort((a, b) => Number(a.dataset.runOrder || 0) - Number(b.dataset.runOrder || 0))
      const timeline = gsap.timeline({ defaults: { ease: 'power3.out' } })
      if (!previous) {
        const inputNode = runViewport.querySelector<HTMLElement>('[data-chat-workflow-node-id="run-input-source"]')
        if (inputNode) {
          timeline.fromTo(inputNode, {
            autoAlpha: 0,
            y: -8,
            scale: 0.985,
          }, {
            autoAlpha: 1,
            y: 0,
            scale: 1,
            duration: 0.36,
            clearProps: 'visibility,opacity,transform',
          })
        }
      }
      timelineNodes.forEach((node, index) => {
        const nodeId = node.dataset.chatWorkflowNodeId ?? ''
        const incoming = newLinkGroups.find((link) => (link.getAttribute('data-chat-resource-link-id') ?? '').endsWith(`->${nodeId}`))
        const paths = incoming
          ? Array.from(incoming.querySelectorAll<SVGPathElement>('path:not(.hit-area)'))
          : []
        const label = `run-node-${index}`
        timeline.addLabel(label, index === 0 ? '+=0.08' : '+=0.13')
        if (incoming) {
          timeline.set(incoming, {
            autoAlpha: 1,
          }, label)
        }
        if (paths.length) {
          timeline.to(paths, {
            autoAlpha: 1,
            strokeDashoffset: 0,
            duration: 0.48,
            ease: 'power2.out',
            clearProps: 'visibility,opacity,strokeDasharray,strokeDashoffset',
          }, label)
        }
        timeline.fromTo(node, {
          autoAlpha: 0,
          y: -18,
          scaleY: 0.12,
          scaleX: 0.96,
          filter: 'brightness(1.28) saturate(1.16)',
          transformOrigin: '50% 0%',
        }, {
          autoAlpha: 1,
          y: 0,
          scaleY: 1,
          scaleX: 1,
          filter: 'brightness(1) saturate(1)',
          duration: 0.52,
          ease: 'expo.out',
          clearProps: 'visibility,opacity,transform,filter,transformOrigin',
        }, `${label}+=0.28`)
        const content = Array.from(node.querySelectorAll<HTMLElement>('.chat-resource-node-content strong, .chat-resource-node-content p, .chat-resource-node-content img, .chat-resource-image-actions'))
        if (content.length) {
          timeline.from(content, {
            autoAlpha: 0,
            y: 8,
            duration: 0.28,
            stagger: 0.035,
            clearProps: 'visibility,opacity,transform',
          }, `${label}+=0.46`)
        }
      })
    }, runViewport)
    cleanups.push(() => ctx.revert())
  }).catch(() => {
    newNodes.forEach((node) => {
      node.style.opacity = ''
      node.style.visibility = ''
      node.style.transformOrigin = ''
    })
    newLinkGroups
      .flatMap((link) => Array.from(link.querySelectorAll<SVGPathElement>('path:not(.hit-area)')))
      .forEach((path) => {
        path.style.opacity = ''
        path.style.strokeDasharray = ''
        path.style.strokeDashoffset = ''
      })
    newLinkGroups.forEach((link) => {
      link.style.opacity = ''
      link.style.visibility = ''
    })
  })
  cleanups.push(() => {
    reverted = true
  })
  cleanups.push(() => {
    delete runViewport.dataset.runDraftInitialized
  })
}

function animateWorkflowCanvasChanges(root: HTMLElement, cleanups: Array<() => void>): void {
  const viewport = root.querySelector<HTMLElement>('.chat-workflow-canvas-viewport.active')
  if (!viewport || viewport.classList.contains('chat-resource-run-viewport')) {
    return
  }
  const snapshot = captureWorkflowMotionSnapshot(viewport)
  const previous = workflowMotionSnapshots.get(root)
  workflowMotionSnapshots.set(root, snapshot)
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return
  }
  let reverted = false
  import('gsap').then(({ gsap }) => {
    if (reverted || !viewport.isConnected) {
      return
    }
    const ctx = gsap.context(() => {
      const nodes = gsap.utils.toArray<HTMLElement>('.chat-resource-node')
      const newNodes = nodes.filter((node) => !previous?.nodes.has(node.dataset.chatWorkflowNodeId ?? ''))
      const movedNodes = nodes.flatMap((node) => {
        const nodeId = node.dataset.chatWorkflowNodeId ?? ''
        const before = previous?.nodes.get(nodeId)
        const after = snapshot.nodes.get(nodeId)
        if (!before || !after) return []
        const dx = before.x - after.x
        const dy = before.y - after.y
        return Math.abs(dx) > 1 || Math.abs(dy) > 1 ? [{ node, dx, dy }] : []
      })
      const changedNodes = nodes.filter((node) => {
        const nodeId = node.dataset.chatWorkflowNodeId ?? ''
        const before = previous?.nodes.get(nodeId)
        const after = snapshot.nodes.get(nodeId)
        return Boolean(before && after && (before.status !== after.status || before.configHash !== after.configHash || before.selected !== after.selected))
      })
      const newLinks = gsap.utils.toArray<SVGPathElement>('.chat-resource-link')
        .filter((link) => !previous?.links.has(link.getAttribute('data-chat-resource-link-id') ?? ''))
        .flatMap((link) => gsap.utils.toArray<SVGPathElement>('path:not(.hit-area)', link))
      gsap.killTweensOf([...nodes, ...newLinks])
      if (!previous) {
        gsap.from(nodes, {
          opacity: 0,
          y: 12,
          scale: 0.965,
          duration: 0.32,
          stagger: 0.018,
          ease: 'power3.out',
          clearProps: 'opacity,transform',
        })
        return
      }
      if (movedNodes.length) {
        for (const item of movedNodes) {
          gsap.fromTo(item.node, {
            x: item.dx,
            y: item.dy,
            scale: 0.992,
          }, {
            x: 0,
            y: 0,
            scale: 1,
            duration: 0.48,
            ease: 'expo.out',
            clearProps: 'transform',
          })
        }
      }
      if (newNodes.length) {
        gsap.fromTo(newNodes, {
          opacity: 0,
          y: 18,
          scale: 0.92,
          filter: 'brightness(1.25) saturate(1.18)',
        }, {
          opacity: 1,
          y: 0,
          scale: 1,
          filter: 'brightness(1) saturate(1)',
          duration: 0.46,
          stagger: 0.045,
          ease: 'back.out(1.35)',
          clearProps: 'opacity,transform,filter',
        })
      }
      if (changedNodes.length) {
        gsap.fromTo(changedNodes, {
          boxShadow: '0 0 0 1px rgba(132, 173, 159, 0.48), 0 0 0 0 rgba(132, 173, 159, 0)',
          filter: 'brightness(1.18)',
        }, {
          boxShadow: '0 0 0 1px rgba(132, 173, 159, 0), 0 0 0 12px rgba(132, 173, 159, 0)',
          filter: 'brightness(1)',
          duration: 0.58,
          stagger: 0.025,
          ease: 'power3.out',
          clearProps: 'boxShadow,filter',
        })
      }
      if (newLinks.length) {
        gsap.fromTo(newLinks, {
          opacity: 0,
          strokeDasharray: 20,
          strokeDashoffset: 42,
        }, {
          opacity: 1,
          strokeDashoffset: 0,
          duration: 0.54,
          stagger: 0.025,
          ease: 'power2.out',
          clearProps: 'opacity,strokeDasharray,strokeDashoffset',
        })
      }
    }, viewport)
    cleanups.push(() => ctx.revert())
  }).catch(() => {
    // Animation is optional; rendering must not depend on GSAP availability.
  })
  cleanups.push(() => {
    reverted = true
  })
}

function captureWorkflowMotionSnapshot(viewport: HTMLElement): WorkflowMotionSnapshot {
  const nodes = new Map<string, { x: number; y: number; status: string; selected: boolean; configHash: string }>()
  viewport.querySelectorAll<HTMLElement>('.chat-resource-node').forEach((node) => {
    const nodeId = node.dataset.chatWorkflowNodeId ?? ''
    if (!nodeId) return
    nodes.set(nodeId, {
      x: readPixelCssVariable(node, '--node-x'),
      y: readPixelCssVariable(node, '--node-y'),
      status: readWorkflowNodeStatus(node),
      selected: node.classList.contains('selected'),
      configHash: readWorkflowNodeConfigHash(node),
    })
  })
  const links = new Set<string>()
  viewport.querySelectorAll<SVGGElement>('.chat-resource-link').forEach((link) => {
    const linkId = link.getAttribute('data-chat-resource-link-id') ?? ''
    if (linkId) links.add(linkId)
  })
  return { nodes, links }
}

function readPixelCssVariable(element: HTMLElement, name: string): number {
  const value = element.style.getPropertyValue(name) || getComputedStyle(element).getPropertyValue(name)
  const number = Number.parseFloat(value)
  return Number.isFinite(number) ? number : 0
}

function readWorkflowNodeStatus(node: HTMLElement): string {
  return ['running', 'queued', 'done', 'failed', 'stale', 'dirty', 'idle']
    .find((status) => node.classList.contains(status)) ?? ''
}

function readWorkflowNodeConfigHash(node: HTMLElement): string {
  const fields = Array.from(node.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-chat-workflow-param]'))
  return fields.map((field) => {
    if (field instanceof HTMLInputElement && field.type === 'checkbox') {
      return `${field.dataset.chatWorkflowParam}:${field.checked ? '1' : '0'}`
    }
    return `${field.dataset.chatWorkflowParam}:${field.value}`
  }).join('|')
}

function animateAgentOperationFeedback(root: HTMLElement, cleanups: Array<() => void>): void {
  const viewport = root.querySelector<HTMLElement>('.chat-workflow-canvas-viewport.active')
  if (!viewport) {
    return
  }
  const hasHighlights = viewport.querySelector('.agent-highlight-node, .agent-highlight-link')
  if (!hasHighlights) {
    return
  }
  let reverted = false
  import('gsap').then(({ gsap }) => {
    if (reverted || !viewport.isConnected) {
      return
    }
    const ctx = gsap.context(() => {
      const nodes = gsap.utils.toArray<HTMLElement>('.agent-highlight-node')
      const links = gsap.utils.toArray<SVGPathElement>('.agent-highlight-link path:not(.hit-area)')
      const timeline = gsap.timeline({ defaults: { ease: 'power3.out' } })
      if (nodes.length) {
        timeline.fromTo(nodes, {
          y: -6,
          scale: 0.975,
          filter: 'brightness(1.25)',
        }, {
          y: 0,
          scale: 1,
          filter: 'brightness(1)',
          duration: 0.42,
          stagger: 0.035,
          clearProps: 'transform,filter',
        }, 0)
      }
      if (links.length) {
        timeline.fromTo(links, {
          opacity: 0,
          strokeDasharray: 18,
          strokeDashoffset: 36,
        }, {
          opacity: 1,
          strokeDashoffset: 0,
          duration: 0.52,
          stagger: 0.025,
          clearProps: 'opacity,strokeDasharray,strokeDashoffset',
        }, 0.08)
      }
    }, viewport)
    cleanups.push(() => ctx.revert())
  }).catch(() => {
    // Animation is optional; rendering must not depend on GSAP availability.
  })
  cleanups.push(() => {
    reverted = true
  })
}

function createGraphSerializerSnapshot(graph: CharacterResourceGraph): string {
  return JSON.stringify({
    id: graph.id,
    viewport: graph.viewport,
    panels: graph.panels,
    selection: graph.selection,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      title: node.title,
      position: node.position,
      size: node.size,
      status: node.status,
      collapsed: Boolean(node.collapsed),
      config: node.config,
    })),
    links: graph.links,
    outputs: graph.outputs.map((output) => ({
      id: output.id,
      nodeId: output.nodeId,
      type: output.type,
      title: output.title,
      status: output.status,
    })),
    serializedAt: 0,
  })
}

function renderFileTabs(options: CharacterWorkflowPageOptions): string {
  const tab = options.tabs.find((item) => item.kind === 'workflow') ?? {
    id: 'workflow',
    title: ui(options, '草稿 01.resourcegraph', 'Draft 01.resourcegraph'),
    kind: 'workflow' as const,
  }
  return `
    <div class="chat-workflow-file-tabs" role="tablist" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '角色资源图文件' : 'Character resource graph files')}">
      ${renderFileTab(tab, true, options)}
    </div>
  `
}

function renderFileTab(tab: CharacterWorkflowFileTab, active: boolean, options: CharacterWorkflowPageOptions): string {
  return `
    <div class="chat-workflow-file-tab ${active ? 'active' : ''} ${tab.state ? `is-${tab.state}` : ''}" role="tab" aria-selected="${active ? 'true' : 'false'}">
      <button class="chat-workflow-file-open" type="button" data-chat-workflow-tab="${options.escapeHtml(tab.id)}">
        <span class="chat-workflow-file-icon ${tab.kind}" aria-hidden="true"></span>
        <strong>${options.escapeHtml(tab.title)}</strong>
        ${tab.state ? '<span class="chat-workflow-file-state" aria-hidden="true"></span>' : ''}
      </button>
      <button class="chat-workflow-file-close" type="button" data-chat-workflow-close-tab="${options.escapeHtml(tab.id)}" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '关闭文件' : 'Close file')}">x</button>
    </div>
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
          <button class="${graph.panels.activePanel === 'assets' ? 'active' : ''}" type="button" data-chat-workflow-panel="assets"><span>${options.escapeHtml(ui(options, '资源包', 'Package'))}</span><em>${graph.outputs.length}</em></button>
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
            return `<button type="button" data-chat-workflow-panel="nodes" ${firstNode ? `data-chat-workflow-node-select="${options.escapeHtml(firstNode.id)}"` : ''}><span>${options.escapeHtml(localizeCategory(category, options))}</span><em>${count}</em></button>`
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
  const displayName = workflowText(options, `chat.workflow.node.${definition.type}`, definition.displayName)
  const categoryLabel = localizeCategory(definition.category, options)
  const sourceLabel = localizeSource(definition.source, options)
  const searchText = [
    definition.type,
    definition.displayName,
    displayName,
    definition.category,
    categoryLabel,
    definition.source,
    sourceLabel,
    ...definition.aliases,
    ...definition.inputs.map((slotItem) => slotItem.type),
    ...definition.outputs.map((slotItem) => slotItem.type),
  ].join(' ')
  const inputTypes = definition.inputs.map((slotItem) => slotItem.type).join(' ')
  const outputTypes = definition.outputs.map((slotItem) => slotItem.type).join(' ')
  return `
    <button class="chat-resource-library-card" ${elementId ? `id="${options.escapeHtml(elementId)}"` : ''} type="button" role="option" data-resource-library-card data-resource-node-add-type="${options.escapeHtml(definition.type)}" data-resource-category="${options.escapeHtml(definition.category)}" data-resource-input-types="${options.escapeHtml(inputTypes)}" data-resource-output-types="${options.escapeHtml(outputTypes)}" data-resource-search-text="${options.escapeHtml(searchText)}" data-resource-preview-title="${options.escapeHtml(displayName)}" data-resource-preview-body="${options.escapeHtml(definition.description)}" data-chat-workflow-panel="nodes">
      <span>
        <b>${options.escapeHtml(displayName)}</b>
        <small>${options.escapeHtml(categoryLabel)} / ${options.escapeHtml(sourceLabel)}</small>
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

function renderWorkflowLibraryToggle(options: CharacterWorkflowPageOptions): string {
  const collapsed = Boolean(options.workflowLibraryCollapsed)
  const label = collapsed
    ? (options.language === 'zh-CN' ? '展开左侧草稿库' : 'Expand drafts sidebar')
    : (options.language === 'zh-CN' ? '收起左侧草稿库' : 'Collapse drafts sidebar')
  return `
    <button class="chat-workflow-sidebar-toggle chat-workflow-library-inline-toggle ${collapsed ? 'is-library-collapsed' : ''}" type="button" data-chat-workflow-library-action="toggle-width" aria-label="${options.escapeHtml(label)}" title="${options.escapeHtml(label)}">
      <span aria-hidden="true"></span>
    </button>
  `
}

function renderResourceCanvas(graph: CharacterResourceGraph, graphSnapshot: string, options: CharacterWorkflowPageOptions): string {
  const activeTab = normalizeActiveTab(options.activeTabId)
  const isWorkflowTab = activeTab === 'workflow'
  const isRunTab = activeTab === 'run-draft'
  return `
    <section class="chat-workflow-canvas chat-resource-canvas" tabindex="-1" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '角色资源图画布' : 'Character resource graph canvas')}">
      ${isWorkflowTab ? renderCanvasControls(graph, options) : ''}
      ${isRunTab ? renderRunCanvasControls(options) : ''}
      <div class="chat-resource-tabs">
        ${isWorkflowTab ? `${renderWorkflowLibraryToggle(options)}${renderSidebarToggle(options)}` : ''}
        ${graph.tabs.map((tab) => renderResourceTabControl(tab, activeTab, options)).join('')}
      </div>
      ${activeTab === 'run-draft' ? renderRunDraft(graph, options) : ''}
      ${isWorkflowTab ? `<div class="chat-workflow-canvas-viewport active" data-resource-viewport="${options.escapeHtml(JSON.stringify(graph.viewport))}">
        <div class="chat-workflow-canvas-plane chat-resource-graph-plane" style="--resource-zoom: ${graph.viewport.zoom}; --resource-pan-x: ${graph.viewport.x}px; --resource-pan-y: ${graph.viewport.y}px">
          <div class="chat-workflow-canvas-grid" aria-hidden="true"></div>
          ${graph.groups.map((group) => renderGroup(group, graph, options)).join('')}
          ${options.viewState?.hideLinks ? '' : renderLinkOverlay(graph, options)}
          ${graph.nodes.map((node) => renderResourceNode(node, graph, options)).join('')}
          ${renderSelectionBox(options.viewState?.selectionBox)}
          ${renderSelectionRectangle(graph)}
        </div>
      </div>` : ''}
      <div class="chat-resource-serializer" aria-hidden="true" data-graph-snapshot="${options.escapeHtml(graphSnapshot)}"></div>
      ${isWorkflowTab ? renderNodeSearchPopover(graph, options) : ''}
      ${isWorkflowTab ? renderCanvasContextMenu(options) : ''}
      ${isWorkflowTab || isRunTab ? options.workflowAssistantHtml ?? '' : ''}
    </section>
  `
}

function renderRunCanvasControls(options: CharacterWorkflowPageOptions): string {
  const running = options.runState?.run?.status === 'running'
  const runLabel = running ? ui(options, '停止 Agent 运行', 'Stop agent run') : ui(options, '运行 Agent', 'Run agent')
  const fitLabel = ui(options, '适配视图', 'Fit view')
  const resetLabel = ui(options, '重置视图', 'Reset view')
  return `
    <div class="chat-workflow-canvas-controls chat-resource-canvas-controls chat-resource-run-controls" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '画布控制' : 'Canvas controls')}">
      <button class="chat-workflow-run-toggle ${running ? 'is-running' : ''}" type="button" data-chat-workflow-action="${running ? 'stop' : 'run'}" aria-label="${options.escapeHtml(runLabel)}" title="${options.escapeHtml(runLabel)}">${renderLucideSvg(running ? Square : Play)}</button>
      <button type="button" data-chat-workflow-action="fit-view" title="${options.escapeHtml(fitLabel)}" aria-label="${options.escapeHtml(fitLabel)}">${renderLucideSvg(Maximize)}</button>
      <button type="button" data-chat-workflow-action="reset-view" title="${options.escapeHtml(resetLabel)}" aria-label="${options.escapeHtml(resetLabel)}">${renderLucideSvg(RotateCcw)}</button>
      ${renderInspectorToggle(options)}
    </div>
  `
}

function renderLucideSvg(icon: IconNode): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icon.map(([tag, attrs]) => `<${tag}${renderSvgAttributes(attrs)}></${tag}>`).join('')}</svg>`
}

function renderSvgAttributes(attrs: Record<string, string | number>): string {
  return Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${escapeSvgAttribute(String(value))}"`)
    .join('')
}

function escapeSvgAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function renderResourceTabControl(tab: CharacterResourceGraph['tabs'][number], activeTab: 'workflow' | 'run-draft', options: CharacterWorkflowPageOptions): string {
  if (tab.id !== 'run-draft') {
    return `<button class="${tab.id === activeTab ? 'active' : ''}" type="button" data-chat-workflow-tab="${options.escapeHtml(tab.id)}">${options.escapeHtml(resourceGraphTabTitle(tab, options))}</button>`
  }
  const drafts = options.runDrafts ?? []
  const activeRunId = activeTab === 'run-draft' ? options.runState?.run?.id ?? '' : ''
  const activeDraft = drafts.find((draft) => draft.id === activeRunId)
  const selectTitle = activeDraft ? `${activeDraft.title} · ${activeDraft.status}` : ui(options, '运行草稿', 'Run Draft')
  return `
    <label class="chat-resource-run-tab-select ${activeTab === 'run-draft' ? 'active' : ''} ${drafts.length ? '' : 'disabled'}" title="${options.escapeHtml(selectTitle)}">
      <select data-chat-workflow-run-select aria-label="${options.escapeHtml(ui(options, '选择运行草稿', 'Select run draft'))}" ${drafts.length ? '' : 'disabled'}>
        <option value="" ${activeRunId ? '' : 'selected'}>${options.escapeHtml(ui(options, '运行草稿', 'Run Draft'))}</option>
        ${drafts.map((draft) => `<option value="${options.escapeHtml(draft.id)}" ${draft.id === activeRunId ? 'selected' : ''}>${options.escapeHtml(`${draft.title} · ${draft.status}`)}</option>`).join('')}
      </select>
    </label>
  `
}

function renderRunDraft(graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions): string {
  const runGraph = createRunDraftCanvasGraph(graph, options)
  const runGraphSnapshot = createGraphSerializerSnapshot(runGraph)
  const status = options.runState?.run?.status ?? 'idle'
  const runPlaneWidth = Math.max(1640, ...runGraph.nodes.map((node) => node.position.x + node.size.width + 220))
  const runPlaneHeight = Math.max(760, ...runGraph.nodes.map((node) => node.position.y + node.size.height + 180))
  return `
    <div class="chat-workflow-canvas-viewport active chat-resource-run-viewport run-status-${options.escapeHtml(status)}" data-resource-viewport="${options.escapeHtml(JSON.stringify(runGraph.viewport))}" aria-label="${options.escapeHtml(ui(options, '角色卡运行草稿', 'Character card run draft'))}">
      ${renderRunProgressOverlay(options)}
      <div class="chat-workflow-canvas-plane chat-resource-graph-plane chat-resource-run-plane" style="--resource-zoom: ${runGraph.viewport.zoom}; --resource-pan-x: ${runGraph.viewport.x}px; --resource-pan-y: ${runGraph.viewport.y}px; --run-plane-width: ${runPlaneWidth}px; --run-plane-height: ${runPlaneHeight}px">
        <div class="chat-workflow-canvas-grid" aria-hidden="true"></div>
        ${renderLinkOverlay(runGraph, options)}
        ${runGraph.nodes.map((node) => renderResourceNode(node, runGraph, options)).join('')}
      </div>
      <div class="chat-resource-serializer" aria-hidden="true" data-graph-snapshot="${options.escapeHtml(runGraphSnapshot)}"></div>
    </div>
  `
}

function renderRunProgressOverlay(options: CharacterWorkflowPageOptions): string {
  const runState = options.runState
  const events = normalizeRunEvents(runState)
  const latest = [...events].reverse().find((event) => event.type !== 'user.input.graph')
  const latestArtifact = [...events].reverse().find((event) => event.artifact)?.artifact
  const phase = latest?.phase ?? runState?.run?.currentStepId ?? '-'
  const tool = latest?.toolName ?? '-'
  const status = runState?.run?.status ?? 'idle'
  const statusLabel = formatRunStatus(status, options)
  return `
    <section class="chat-resource-run-progress" aria-label="${options.escapeHtml(ui(options, '运行进度', 'Run progress'))}">
      <div>
        <span>${options.escapeHtml(ui(options, '状态', 'Status'))}</span>
        <strong data-run-progress-status>${options.escapeHtml(statusLabel)}</strong>
      </div>
      <div>
        <span>${options.escapeHtml(ui(options, '阶段', 'Phase'))}</span>
        <strong data-run-progress-phase>${options.escapeHtml(String(phase))}</strong>
      </div>
      <div>
        <span>${options.escapeHtml(ui(options, '工具', 'Tool'))}</span>
        <strong data-run-progress-tool>${options.escapeHtml(String(tool))}</strong>
      </div>
      <div>
        <span>${options.escapeHtml(ui(options, '产物', 'Artifact'))}</span>
        <strong data-run-progress-artifact>${options.escapeHtml(latestArtifact?.title ?? latestArtifact?.kind ?? '-')}</strong>
      </div>
      <p data-run-progress-summary>${options.escapeHtml(latest ? formatRunEventSummary(latest, options) || formatRunEventTitle(latest, options) : ui(options, '等待运行开始', 'Waiting for run to start'))}</p>
    </section>
  `
}

function renderRunCharacterInspector(options: CharacterWorkflowPageOptions): string {
  const artifacts = getRoleResourceArtifacts(options.runState?.artifacts ?? [])
  const rows = createRunCharacterRows(artifacts, options)
  const images = artifacts
    .map((artifact) => ({ artifact, image: getArtifactImage(artifact.data) }))
    .filter((item) => item.image)
    .slice(-8)
  return `
    <aside class="chat-workflow-inspector chat-resource-inspector chat-run-character-inspector" aria-label="${options.escapeHtml(ui(options, '角色资源详情', 'Character resource details'))}">
      <div class="chat-workflow-inspector-scroll chat-run-character-scroll">
        <header class="chat-run-character-hero">
          ${images[0]?.image ? `<img src="${options.escapeHtml(images[0].image)}" alt="${options.escapeHtml(ui(options, '角色图', 'Character image'))}">` : ''}
          <div class="chat-run-character-hero-copy">
            <span>${options.escapeHtml(ui(options, '角色资源', 'Character Resource'))}</span>
            <strong>${options.escapeHtml(getRunCharacterTitle(rows, options))}</strong>
          </div>
          <div class="chat-run-character-actions">
            <button type="button" data-chat-workflow-action="download-run-draft">${options.escapeHtml(ui(options, '下载', 'Download'))}</button>
            <button type="button" data-chat-workflow-action="chat-test">${options.escapeHtml(ui(options, '聊天测试', 'Chat Test'))}</button>
          </div>
        </header>
        <section class="chat-run-character-fields" data-run-character-fields>
          ${rows.map((row) => `
            <article data-run-character-field-key="${options.escapeHtml(row.key)}">
              <span>${options.escapeHtml(row.label)}</span>
              <p>${options.escapeHtml(row.value)}</p>
            </article>
          `).join('')}
        </section>
        ${images.length ? `
          <section class="chat-run-character-carousel" data-run-character-images aria-label="${options.escapeHtml(ui(options, '角色图片', 'Character images'))}">
            ${images.map((item, index) => `
              <figure data-run-character-image-key="${options.escapeHtml(item.artifact.id ?? `${item.artifact.type}-${index}`)}">
                <img src="${options.escapeHtml(item.image)}" alt="${options.escapeHtml(item.artifact.title ?? `${ui(options, '角色图片', 'Character image')} ${index + 1}`)}">
                <figcaption>${options.escapeHtml(item.artifact.title ?? `${index + 1} / ${images.length}`)}</figcaption>
              </figure>
            `).join('')}
          </section>
        ` : ''}
      </div>
    </aside>
  `
}

function createRunCharacterRows(
  artifacts: NonNullable<CharacterResourceRunState['artifacts']>,
  options: CharacterWorkflowPageOptions
): RunCharacterPreviewRow[] {
  const rows: RunCharacterPreviewRow[] = []
  const push = (key: string, label: string, value: string | undefined) => {
    const normalized = normalizeRunCharacterFieldValue(value)
    if (normalized && !rows.some((row) => row.key === key && row.value === normalized)) {
      rows.push({ key, label, value: normalized })
    }
  }
  const roleCard = artifacts.find((artifact) => artifact.type === 'character-card-final')
    ?? [...artifacts].reverse().find((artifact) => artifact.type === 'character-card-draft')
  if (roleCard) {
    const record = getRoleCardVisibleFields(roleCard.data)
    for (const [key, value] of Object.entries(record)) {
      push(key, formatRunCharacterFieldLabel(key, options), formatRunCharacterFieldValue(value))
    }
  }
  for (const artifact of artifacts) {
    if (artifact.type === 'character-card-final' || artifact.type === 'character-card-draft' || artifact.type === 'image-asset') {
      continue
    }
    const mapped = getCharacterFacingArtifactField(artifact)
    if (mapped) {
      push(mapped.key, formatRunCharacterFieldLabel(mapped.key, options), mapped.value)
    }
  }
  if (!rows.length) {
    push('status', ui(options, '状态', 'Status'), options.runState?.run?.status === 'running'
      ? ui(options, '角色资源生成中', 'Character resources are being generated')
      : ui(options, '暂无角色资源', 'No character resources yet'))
  }
  return rows
    .filter((row) => ![ui(options, '示例对话', 'Example Dialogue'), ui(options, '场景上下文', 'Scene Context')].includes(row.label))
    .slice(0, 7)
    .map((row) => ({ ...row, value: clampRunCharacterPreviewText(row.value, 220) }))
}

function getRunCharacterTitle(rows: RunCharacterPreviewRow[], options: CharacterWorkflowPageOptions): string {
  const nameLabel = ui(options, '名称', 'Name')
  return rows.find((row) => row.key === 'name' || row.label === nameLabel)?.value
    ?? ui(options, '生成角色', 'Generated Character')
}

function formatRunStatus(status: NonNullable<CharacterResourceRunState['run']>['status'], options: CharacterWorkflowPageOptions): string {
  const labels: Record<NonNullable<CharacterResourceRunState['run']>['status'], string> = {
    idle: ui(options, 'IDLE', 'IDLE'),
    running: ui(options, 'RUNNING', 'RUNNING'),
    failed: ui(options, 'FAILED', 'FAILED'),
    needs_action: ui(options, 'NEEDS ACTION', 'NEEDS ACTION'),
    done: ui(options, 'COMPLETED', 'COMPLETED'),
  }
  return labels[status]
}

function formatRunCharacterFieldLabel(key: string, options: CharacterWorkflowPageOptions): string {
  const labels: Record<string, { zh: string; en: string }> = {
    name: { zh: '名称', en: 'Name' },
    displayName: { zh: '显示名称', en: 'Display Name' },
    description: { zh: '简介', en: 'Description' },
    appearance: { zh: '外貌', en: 'Appearance' },
    personality: { zh: '性格', en: 'Personality' },
    background: { zh: '背景', en: 'Background' },
    story: { zh: '故事', en: 'Story' },
    firstMessage: { zh: '开场白', en: 'First Message' },
    scenario: { zh: '场景', en: 'Scenario' },
    world: { zh: '世界观', en: 'World' },
    worldContext: { zh: '世界观', en: 'World Context' },
    sceneContext: { zh: '场景上下文', en: 'Scene Context' },
    dialogueStyle: { zh: '对话风格', en: 'Dialogue Style' },
    exampleDialogue: { zh: '示例对话', en: 'Example Dialogue' },
  }
  const label = labels[key]
  if (label) {
    return ui(options, label.zh, label.en)
  }
  return key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
}

function getRoleCardVisibleFields(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {}
  }
  const source = data as Record<string, unknown>
  const fields = source.fields && typeof source.fields === 'object' && !Array.isArray(source.fields)
    ? source.fields as Record<string, unknown>
    : source
  const visibleOrder = [
    'name',
    'displayName',
    'description',
    'appearance',
    'personality',
    'background',
    'scenario',
    'worldContext',
    'firstMessage',
    'dialogueStyle',
    'exampleDialogue',
  ]
  return Object.fromEntries(
    visibleOrder
      .filter((key) => fields[key] !== undefined && fields[key] !== null)
      .map((key) => [key, fields[key]])
  )
}

function getCharacterFacingArtifactField(
  artifact: NonNullable<CharacterResourceRunState['artifacts']>[number]
): { key: string; value: string | undefined } | null {
  const value = getArtifactText(artifact.data) || artifact.summary
  if (artifact.type === 'opening-message') {
    return { key: 'firstMessage', value }
  }
  if (artifact.type === 'dialogue-style-guide') {
    return { key: 'dialogueStyle', value }
  }
  if (artifact.type === 'world-context') {
    return { key: 'worldContext', value }
  }
  if (artifact.type === 'scene-context') {
    return { key: 'sceneContext', value }
  }
  return null
}

function formatRunCharacterFieldValue(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value.map(formatRunCharacterFieldValue).filter(Boolean).join('\n')
  }
  if (typeof value === 'object') {
    const localized = value as Record<string, unknown>
    if (typeof localized['zh-CN'] === 'string') {
      return localized['zh-CN']
    }
    if (typeof localized['en-US'] === 'string') {
      return localized['en-US']
    }
    return JSON.stringify(value, null, 2)
  }
  return undefined
}

function clampRunCharacterPreviewText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trim()}...` : normalized
}

function normalizeRunCharacterFieldValue(value: string | undefined): string {
  return String(value ?? '').replace(/\r\n/g, '\n').trim()
}

function getRunInputSummary(graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions): string {
  const goalNode = graph.nodes.find((node) => node.id === 'generation-goal' || node.type === 'goal')
  const goalPrompt = typeof goalNode?.config.goalPrompt === 'string' ? goalNode.config.goalPrompt.trim() : ''
  const targetAudience = typeof goalNode?.config.targetAudience === 'string' ? goalNode.config.targetAudience.trim() : ''
  const eventSummary = normalizeRunEvents(options.runState)
    .find((event) => event.type === 'user.input.graph')?.summary?.trim() ?? ''
  return goalPrompt
    || targetAudience
    || eventSummary
    || ui(options, '当前资源图作为本次运行的原始输入。', 'The current resource graph is the original input for this run.')
}

function createRunDraftCanvasGraph(graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions): CharacterResourceGraph {
  const artifacts = getRunCanvasArtifacts(options.runState?.artifacts ?? [])
  const status = options.runState?.run?.status ?? 'idle'
  const sourceNodeId = 'run-input-source'
  const inputSummary = getRunInputSummary(graph, options)
  const nodes: CharacterResourceNode[] = [{
    id: sourceNodeId,
    type: 'goal',
    title: ui(options, '原始输入', 'Original Input'),
    position: options.positionOverrides?.[sourceNodeId] ?? { x: 96, y: 136 },
    size: { width: 330, height: 130 },
    status: status === 'failed' || status === 'needs_action' ? 'failed' : status === 'done' ? 'done' : status === 'running' ? 'running' : 'idle',
    zIndex: 1,
    config: { runTimelineRoot: true },
  }]
  const outputs: CharacterResourceOutput[] = [{
    id: 'run-agent-source-output',
    nodeId: sourceNodeId,
    type: 'agent-run',
    title: ui(options, '用户原始输入', 'User original input'),
    summary: inputSummary,
    status: nodes[0].status,
    text: inputSummary,
  }]
  const links: CharacterResourceLink[] = []
  const compactArtifacts = artifacts.length
    ? artifacts
    : options.runState?.run?.status === 'running'
      ? [{
          id: 'run-placeholder',
          type: 'character-card-draft',
          sourceNodeId: 'agent-policy',
          title: ui(options, '等待新增字段', 'Waiting for fields'),
          summary: ui(options, '生成中的字段和图片会作为小框出现在画布中。', 'Generated fields and images will appear as compact canvas boxes.'),
          data: undefined,
        }]
      : []
  let previousNodeId = sourceNodeId
  compactArtifacts.forEach((artifact, index) => {
    const nodeId = getRunArtifactNodeId(artifact, index)
    const nodeType = getRunArtifactNodeType(artifact.type)
    const placement = getRunArtifactPlacement(artifact, index)
    const image = getArtifactImage(artifact.data)
    const artifactStatus = getRunArtifactNodeStatus(artifact)
    const title = getRunArtifactNodeTitle(artifact, options)
    const size = getRunArtifactNodeSize(artifact, Boolean(image))
    nodes.push({
      id: nodeId,
      type: nodeType,
      title,
      position: options.positionOverrides?.[nodeId] ?? {
        x: placement.x,
        y: placement.y,
      },
      size,
      status: artifactStatus,
      zIndex: index + 2,
      config: {
        ...getRunArtifactNodeConfig(artifact),
        runOrder: index + 1,
      },
    })
    outputs.push({
      id: `${nodeId}-output`,
      nodeId,
      artifactId: artifact.id,
      sourceNodeId: artifact.sourceNodeId,
      type: artifact.type,
      title,
      summary: getRunArtifactSummary(artifact, options),
      status: artifactStatus,
      image,
      text: getArtifactText(artifact.data),
      data: artifact.data,
    })
    links.push(createRunResourceLink(previousNodeId, nodeId, getRunExecutionLabel(artifact.type, options), index))
    previousNodeId = nodeId
  })
  const selectedNodeId = resolveRunDraftSelectedNodeId(nodes, artifacts, options)
  return {
    ...graph,
    id: `${graph.id}-run`,
    title: ui(options, '角色卡运行草稿', 'Character Card Run Draft'),
    nodes,
    links,
    groups: [],
    viewport: {
      x: options.viewState?.panX ?? 0,
      y: options.viewState?.panY ?? 0,
      zoom: options.viewState?.zoom ?? 0.92,
    },
    selection: { nodeIds: [selectedNodeId], linkIds: [] },
    outputs,
  }
}

function resolveRunDraftSelectedNodeId(
  nodes: CharacterResourceNode[],
  artifacts: CharacterRunArtifacts,
  options: CharacterWorkflowPageOptions
): string {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const selected = options.viewState?.selectedNodeIds?.find((nodeId) => nodeIds.has(nodeId))
  if (selected) {
    return selected
  }
  const latestImageArtifact = [...artifacts].reverse().find((artifact) => artifact.type === 'image-asset' || isFailedRunImageAttemptArtifact(artifact))
  if (latestImageArtifact?.id) {
    const imageNodeId = getRunArtifactNodeId(latestImageArtifact, artifacts.indexOf(latestImageArtifact))
    if (nodeIds.has(imageNodeId)) {
      return imageNodeId
    }
  }
  return nodes[nodes.length - 1]?.id ?? 'run-input-source'
}

function getRunArtifactNodeId(artifact: CharacterRunArtifact, index: number): string {
  const imageKey = getRunImageDisplayKey(artifact)
  if (imageKey && (artifact.type === 'image-asset' || artifact.type === 'image-attempt')) {
    return `run-image-${sanitizeResourceId(imageKey)}`
  }
  return `run-artifact-${sanitizeResourceId(artifact.id || artifact.type || String(index))}`
}

function getRunArtifactNodeSize(artifact: CharacterRunArtifact, hasImage: boolean): { width: number; height: number } {
  if (artifact.type === 'image-asset' && hasImage) {
    const ratio = getRunImageAspectRatio(artifact)
    const width = ratio >= 1.24
      ? clampNumber(Math.round(314 + (Math.min(ratio, 2.1) - 1) * 76), 318, 396)
      : ratio <= 0.86
        ? clampNumber(Math.round(238 + ratio * 80), 244, 308)
        : 304
    const imageHeight = clampNumber(Math.round((width - 24) / ratio), 132, 284)
    return { width, height: imageHeight + 88 }
  }
  if (artifact.type === 'image-attempt') {
    return { width: 304, height: 168 }
  }
  return hasImage ? { width: 286, height: 158 } : { width: 286, height: 118 }
}

function getRunImageAspectRatio(artifact: CharacterRunArtifact): number {
  const data = getRunArtifactDataRecord(artifact)
  const width = readPositiveNumber(data.width) ?? readPositiveNumber(data.WIDTH)
  const height = readPositiveNumber(data.height) ?? readPositiveNumber(data.HEIGHT)
  if (width && height) {
    return clampNumber(width / height, 0.48, 2.35)
  }
  const size = typeof data.size === 'string'
    ? data.size
    : typeof data.image_size === 'string'
      ? data.image_size
      : ''
  const match = size.trim().match(/^(\d{2,5})\s*[x*:]\s*(\d{2,5})$/i)
  if (!match) {
    return 1
  }
  const parsedWidth = Number(match[1])
  const parsedHeight = Number(match[2])
  return parsedWidth > 0 && parsedHeight > 0
    ? clampNumber(parsedWidth / parsedHeight, 0.48, 2.35)
    : 1
}

function readPositiveNumber(value: unknown): number | null {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function getRunArtifactPlacement(artifact: CharacterRunArtifact, index: number): { x: number; y: number } {
  const key = `${artifact.id || artifact.type || index}:${artifact.sourceNodeId || ''}`
  const columns = 3
  const row = Math.floor(index / columns)
  const columnInRow = index % columns
  const column = row % 2 === 0 ? columnInRow : columns - columnInRow - 1
  const xAnchors = [500, 882, 1264]
  const rowWave = [0, 26, -18, 18][row % 4] ?? 0
  const columnWave = [-10, 18, -4][column] ?? 0
  const jitter = getStableRunOffset(key, 10, 8)
  const imageNudge = artifact.type === 'image-asset' || artifact.type === 'image-attempt' ? 14 : 0
  return {
    x: xAnchors[column] + columnWave + jitter.x + imageNudge,
    y: 128 + row * 360 + rowWave + jitter.y,
  }
}

function getStableRunLaneIndex(value: string, modulo: number): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash % Math.max(1, modulo)
}

function getStableRunOffset(value: string, maxX: number, maxY: number): { x: number; y: number } {
  const xSeed = getStableRunLaneIndex(`${value}:x`, maxX * 2 + 1) - maxX
  const ySeed = getStableRunLaneIndex(`${value}:y`, maxY * 2 + 1) - maxY
  return { x: xSeed, y: ySeed }
}

function getRunArtifactNodeTitle(artifact: CharacterRunArtifact, options: CharacterWorkflowPageOptions): string {
  if (artifact.type === 'character-card-field') {
    return getCharacterFieldArtifactLabel(artifact, options)
  }
  if (artifact.type === 'character-card-draft') {
    return ui(options, '字段草稿', 'Field Draft')
  }
  if (artifact.type === 'image-attempt') {
    return getRunImageNodeTitle(artifact, options)
  }
  return artifact.title ?? getRunArtifactMeta(artifact, options)
}

function getRunArtifactSummary(artifact: CharacterRunArtifact, options: CharacterWorkflowPageOptions): string {
  const data = getRunArtifactDataRecord(artifact)
  if (artifact.type === 'image-attempt') {
    const error = typeof data.error === 'string' ? data.error : ''
    if (error) {
      return error
    }
  }
  return artifact.summary || getArtifactText(artifact.data) || getRunArtifactMeta(artifact, options)
}

function getRunImageNodeTitle(artifact: CharacterRunArtifact, options: CharacterWorkflowPageOptions): string {
  const data = getRunArtifactDataRecord(artifact)
  const targetTitle = typeof data.targetTitle === 'string' ? data.targetTitle.trim() : ''
  const imageRole = typeof data.imageRole === 'string' ? data.imageRole.trim() : ''
  const title = [targetTitle, imageRole].filter(Boolean).join(' · ')
  return title || artifact.title?.replace(/^Image Attempt(?: Failed)?$/i, '').trim() || ui(options, '图片', 'Image')
}

function getRunArtifactNodeConfig(artifact: CharacterRunArtifact): Record<string, unknown> {
  if (artifact.type !== 'character-card-field') {
    return {}
  }
  const data = artifact.data && typeof artifact.data === 'object' && !Array.isArray(artifact.data)
    ? artifact.data as Record<string, unknown>
    : {}
  return {
    runField: typeof data.field === 'string' ? data.field : '',
    runFieldSupport: Boolean(data.support),
  }
}

function getRunArtifactNodeStatus(artifact: CharacterRunArtifact): CharacterResourceNodeStatus {
  const data = getRunArtifactDataRecord(artifact)
  const status = typeof data.status === 'string' ? data.status : ''
  if (artifact.type === 'image-attempt' && status === 'failed') {
    return 'failed'
  }
  if (artifact.type === 'stale-marker') {
    return 'queued'
  }
  if (artifact.type === 'quality-report' && String(artifact.summary ?? '').toLowerCase().includes('missing')) {
    return 'failed'
  }
  return 'done'
}

function getRunArtifactDataRecord(artifact: CharacterRunArtifact): Record<string, unknown> {
  return artifact.data && typeof artifact.data === 'object' && !Array.isArray(artifact.data)
    ? artifact.data as Record<string, unknown>
    : {}
}

function getRunArtifactTargetNodeId(artifact: CharacterRunArtifact): string {
  const data = getRunArtifactDataRecord(artifact)
  return typeof data.targetNodeId === 'string'
    ? data.targetNodeId
    : typeof data.staleTargetNodeId === 'string'
      ? data.staleTargetNodeId
      : artifact.sourceNodeId
}

function getRunImageDisplayKey(artifact: CharacterRunArtifact): string {
  const data = getRunArtifactDataRecord(artifact)
  const targetNodeId = getRunArtifactTargetNodeId(artifact)
  if (!targetNodeId) {
    return ''
  }
  const targetIndex = typeof data.targetIndex === 'number' || typeof data.targetIndex === 'string'
    ? String(data.targetIndex)
    : ''
  return [targetNodeId, targetIndex].filter(Boolean).join(':')
}

function isFailedRunImageAttemptArtifact(artifact: CharacterRunArtifact): boolean {
  const data = getRunArtifactDataRecord(artifact)
  return artifact.type === 'image-attempt' && data.status === 'failed'
}

function getCharacterFieldArtifactLabel(artifact: CharacterRunArtifact, options: CharacterWorkflowPageOptions): string {
  const data = artifact.data && typeof artifact.data === 'object' && !Array.isArray(artifact.data)
    ? artifact.data as Record<string, unknown>
    : {}
  const field = typeof data.field === 'string' ? data.field : ''
  return field ? formatRunCharacterFieldLabel(field, options) : artifact.title ?? getRunArtifactMeta(artifact, options)
}

function getRunCanvasArtifacts(artifacts: CharacterRunArtifacts): CharacterRunArtifacts {
  const allowed = new Set([
    'character-card-draft',
    'source-material',
    'character-card-field',
    'character-card-final',
    'opening-message',
    'opening-layout',
    'dialogue-style-guide',
    'world-context',
    'scene-context',
    'image-prompt',
    'image-attempt',
    'image-asset',
    'stale-marker',
    'candidate-pack',
    'quality-report',
    'export-package',
    'generation-report',
  ])
  const filtered = artifacts
    .filter((artifact) => allowed.has(artifact.type))
    .filter((artifact) => artifact.type !== 'character-card-draft')
    .filter((artifact) => !isHiddenRunCanvasFieldArtifact(artifact))
  const canvasArtifacts = coalesceRunCanvasImageArtifacts(filtered)
  const visible = canvasArtifacts.some((artifact) => artifact.type === 'character-card-field')
    ? canvasArtifacts.filter((artifact) => artifact.type !== 'character-card-final')
    : canvasArtifacts
  return pruneRunCanvasArtifacts(visible)
}

function pruneRunCanvasArtifacts(
  artifacts: CharacterRunArtifacts
): CharacterRunArtifacts {
  const importantTypes = new Set(['quality-report', 'generation-report', 'export-package', 'stale-marker'])
  const images = artifacts.filter((artifact) => artifact.type === 'image-asset' || artifact.type === 'image-attempt').slice(-6)
  const fields = artifacts.filter((artifact) => artifact.type === 'character-card-field').slice(-9)
  const important = artifacts.filter((artifact) => importantTypes.has(artifact.type)).slice(-5)
  const other = artifacts
    .filter((artifact) => artifact.type !== 'image-asset' && artifact.type !== 'image-attempt' && artifact.type !== 'character-card-field' && !importantTypes.has(artifact.type))
    .slice(-4)
  const keepIds = new Set([...fields, ...other, ...images, ...important].map((artifact) => artifact.id || `${artifact.type}:${artifact.title ?? ''}`))
  return artifacts.filter((artifact) => keepIds.has(artifact.id || `${artifact.type}:${artifact.title ?? ''}`)).slice(-24)
}

function coalesceRunCanvasImageArtifacts(artifacts: CharacterRunArtifacts): CharacterRunArtifacts {
  const successfulImageKeys = new Set(artifacts
    .filter((artifact) => artifact.type === 'image-asset')
    .map(getRunImageDisplayKey)
    .filter(Boolean))
  const latestFailedAttemptByKey = new Map<string, CharacterRunArtifact>()
  for (const artifact of artifacts) {
    if (!isFailedRunImageAttemptArtifact(artifact)) {
      continue
    }
    const key = getRunImageDisplayKey(artifact)
    if (key && !successfulImageKeys.has(key)) {
      latestFailedAttemptByKey.set(key, artifact)
    }
  }
  const visibleFailedAttempts = new Set(latestFailedAttemptByKey.values())
  return artifacts.filter((artifact) => artifact.type !== 'image-attempt' || visibleFailedAttempts.has(artifact))
}

function isHiddenRunCanvasFieldArtifact(artifact: CharacterRunArtifact): boolean {
  if (artifact.type !== 'character-card-field') {
    return false
  }
  const data = artifact.data && typeof artifact.data === 'object' && !Array.isArray(artifact.data)
    ? artifact.data as Record<string, unknown>
    : {}
  return data.field === 'appearancePrompt'
}

function getRoleResourceArtifacts(artifacts: NonNullable<CharacterResourceRunState['artifacts']>): NonNullable<CharacterResourceRunState['artifacts']> {
  const allowed = new Set([
    'character-card-draft',
    'source-material',
    'character-card-field',
    'character-card-final',
    'opening-message',
    'opening-layout',
    'dialogue-style-guide',
    'world-context',
    'scene-context',
    'image-prompt',
    'image-attempt',
    'image-asset',
    'stale-marker',
    'candidate-pack',
    'quality-report',
    'export-package',
    'generation-report',
  ])
  return artifacts
    .filter((artifact) => allowed.has(artifact.type))
    .sort((a, b) => getRunArtifactOrder(a.type) - getRunArtifactOrder(b.type))
}

function getRunArtifactOrder(type: string): number {
  const order = [
    'candidate-pack',
    'character-card-draft',
    'source-material',
    'character-card-field',
    'character-card-final',
    'opening-message',
    'opening-layout',
    'dialogue-style-guide',
    'world-context',
    'scene-context',
    'image-prompt',
    'image-attempt',
    'image-asset',
    'stale-marker',
    'quality-report',
    'generation-report',
    'export-package',
  ]
  const index = order.indexOf(type)
  return index === -1 ? 99 : index
}

function getRunArtifactMeta(artifact: NonNullable<CharacterResourceRunState['artifacts']>[number], options: CharacterWorkflowPageOptions): string {
  const labels: Record<string, string> = {
    'candidate-pack': ui(options, '候选包 / resource', 'candidate pack / resource'),
    'character-card-draft': ui(options, '角色卡草稿 / draft', 'character draft / resource'),
    'source-material': ui(options, '素材 / material', 'source material / resource'),
    'character-card-field': ui(options, '角色字段 / field', 'character field / resource'),
    'character-card-final': ui(options, '角色卡 / role-card', 'role card / resource'),
    'opening-message': ui(options, '开场 / opening', 'opening / resource'),
    'opening-layout': ui(options, '开幕面板 / CSS', 'opening panel / CSS'),
    'dialogue-style-guide': ui(options, '语气 / style', 'style / resource'),
    'world-context': ui(options, '世界观 / context', 'world / resource'),
    'scene-context': ui(options, '场景 / context', 'scene / resource'),
    'image-prompt': ui(options, '生图提示 / image', 'image prompt / resource'),
    'image-attempt': ui(options, '生图尝试 / attempt', 'image attempt / resource'),
    'image-asset': ui(options, '图片 / image', 'image / resource'),
    'stale-marker': ui(options, '需刷新 / stale', 'stale / marker'),
    'quality-report': ui(options, '校验 / report', 'quality / report'),
    'generation-report': ui(options, '生成报告 / report', 'generation / report'),
    'export-package': ui(options, '导出包 / package', 'export / package'),
  }
  return labels[artifact.type] ?? `${artifact.type} / ${artifact.sourceNodeId}`
}

function getRunArtifactNodeType(type: string): string {
  const nodeTypes: Record<string, string> = {
    'candidate-pack': 'candidate-pack-resource',
    'source-material': 'source-material-resource',
    'character-card-field': 'character-field-resource',
    'character-card-draft': 'role-card-resource',
    'character-card-final': 'role-card-resource',
    'opening-message': 'opening-resource',
    'opening-layout': 'opening-panel-resource',
    'dialogue-style-guide': 'style-guide-resource',
    'world-context': 'context-resource',
    'scene-context': 'context-resource',
    'image-prompt': 'image-prompt-resource',
    'image-attempt': 'image-asset-resource',
    'image-asset': 'image-asset-resource',
    'stale-marker': 'quality-report-resource',
    'quality-report': 'quality-report-resource',
    'generation-report': 'quality-report-resource',
    'export-package': 'export-package-resource',
  }
  return nodeTypes[type] ?? 'candidate-pack-resource'
}

function getRunExecutionLabel(type: string, options: CharacterWorkflowPageOptions): string {
  if (type === 'character-card-draft') {
    return ui(options, '补字段', 'field')
  }
  if (type === 'character-card-field') {
    return ui(options, '字段', 'field')
  }
  if (type === 'image-asset' || type === 'image-attempt') {
    return ui(options, '生图', 'image')
  }
  if (type === 'stale-marker') {
    return ui(options, '依赖变化', 'stale')
  }
  if (type.includes('report') || type === 'quality-report') {
    return ui(options, '检查', 'review')
  }
  if (type === 'export-package') {
    return ui(options, '输出', 'output')
  }
  return ui(options, '新增', 'add')
}

function createRunResourceLink(
  sourceNodeId: string,
  targetNodeId: string,
  label: string,
  index: number,
  kind: CharacterResourceLinkKind = 'provides'
): CharacterResourceLink {
  return {
    id: `run-link-${index}-${sourceNodeId}->${targetNodeId}`,
    sourceNodeId,
    sourceSlotId: 'resource',
    targetNodeId,
    targetSlotId: 'resource',
    kind,
    label,
    status: 'valid',
  }
}

function sanitizeResourceId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || `resource-${Date.now()}`
}

function normalizeRunEvents(runState: CharacterResourceRunState | null | undefined): CharacterResourceRunEvent[] {
  const events = runState?.events?.length ? [...runState.events] : []
  if (!events.length) {
    return [
      { type: 'user.input.graph', title: 'User Input Graph', summary: 'Current resource graph snapshot is the starting point.', status: 'done' },
      ...(runState?.steps ?? []).map((step) => ({
        type: `run.step.${step.id}`,
        title: step.label,
        summary: step.detail,
        status: step.status,
      } satisfies CharacterResourceRunEvent)),
    ]
  }
  return [
    { type: 'user.input.graph', title: 'User Input Graph', summary: 'Current resource graph snapshot is the starting point.', status: 'done' },
    ...events,
  ]
}

function inferEventStatus(type: string): CharacterResourceRunEvent['status'] {
  if (type === 'run.failed' || type === 'run.needs_action') {
    return 'failed'
  }
  if (type === 'tool.call.started' || type === 'run.phase.changed') {
    return 'running'
  }
  return 'done'
}

function formatRunEventTitle(event: CharacterResourceRunEvent, options: CharacterWorkflowPageOptions): string {
  if (event.type === 'run.started') {
    return ui(options, '开始运行', 'Run started')
  }
  if (event.type === 'run.phase.changed') {
    return ui(options, `进入阶段：${event.phase ?? '-'}`, `Phase: ${event.phase ?? '-'}`)
  }
  if (event.type === 'tool.call.started') {
    return ui(options, `调用工具：${event.toolName ?? '-'}`, `Tool started: ${event.toolName ?? '-'}`)
  }
  if (event.type === 'tool.call.completed') {
    return ui(options, `工具完成：${event.toolName ?? '-'}`, `Tool completed: ${event.toolName ?? '-'}`)
  }
  if (event.type === 'artifact.created') {
    return event.artifact?.title ?? ui(options, '生成资源', 'Artifact created')
  }
  if (event.type === 'agent.plan.created') {
    return ui(options, '生成执行计划', 'Plan created')
  }
  if (event.type === 'run.completed') {
    return ui(options, '运行完成', 'Run completed')
  }
  if (event.type === 'run.needs_action') {
    return ui(options, '需要处理', 'Needs action')
  }
  if (event.type === 'run.failed') {
    return ui(options, '运行失败', 'Run failed')
  }
  return event.type
}

function formatRunEventSummary(event: CharacterResourceRunEvent, options: CharacterWorkflowPageOptions): string {
  if (event.artifact?.summary) {
    return event.artifact.summary
  }
  if (event.summary) {
    return event.summary
  }
  if (event.type === 'user.input.graph') {
    return ui(options, '从当前用户输入资源图开始。', 'Starts from the current user input graph.')
  }
  return ''
}

function getArtifactImage(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return ''
  }
  const item = data as Record<string, any>
  if (typeof item.dataUrl === 'string') {
    return item.dataUrl
  }
  if (typeof item.url === 'string') {
    return item.url
  }
  return ''
}

function getArtifactText(data: unknown): string {
  if (typeof data === 'string') {
    return data
  }
  if (!data || typeof data !== 'object') {
    return ''
  }
  const item = data as Record<string, any>
  if ('value' in item) {
    return formatRunCharacterFieldValue(item.value) ?? ''
  }
  const text = item.text ?? item.summary ?? item.generationReport ?? item.prompt
  if (typeof text === 'string') {
    return text
  }
  return JSON.stringify(data).slice(0, 360)
}

function renderCanvasControls(graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions): string {
  const running = options.runState?.run?.status === 'running'
  const runLabel = running ? ui(options, '停止 Agent 运行', 'Stop agent run') : ui(options, '运行 Agent', 'Run agent')
  const fitLabel = ui(options, '适配视图', 'Fit view')
  const resetLabel = ui(options, '重置视图', 'Reset view')
  const linksLabel = ui(options, '显示/隐藏连线', 'Toggle links')
  return `
    <div class="chat-workflow-canvas-controls chat-resource-canvas-controls" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '画布控制' : 'Canvas controls')}">
      <button class="chat-workflow-run-toggle ${running ? 'is-running' : ''}" type="button" data-chat-workflow-action="${running ? 'stop' : 'run'}" aria-label="${options.escapeHtml(runLabel)}" title="${options.escapeHtml(runLabel)}">${renderLucideSvg(running ? Square : Play)}</button>
      <button type="button" data-chat-workflow-action="fit-view" title="${options.escapeHtml(fitLabel)}" aria-label="${options.escapeHtml(fitLabel)}">${renderLucideSvg(Maximize)}</button>
      <button type="button" data-chat-workflow-action="reset-view" title="${options.escapeHtml(resetLabel)}" aria-label="${options.escapeHtml(resetLabel)}">${renderLucideSvg(RotateCcw)}</button>
      <button type="button" data-chat-workflow-action="toggle-links" title="${options.escapeHtml(linksLabel)}" aria-label="${options.escapeHtml(linksLabel)}">${renderLucideSvg(Link2Off)}</button>
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
  return `<div class="chat-resource-group" data-resource-group-node-ids="${options.escapeHtml(group.nodeIds.join(','))}" style="left:${left}px;top:${top}px;width:${right - left}px;height:${bottom - top}px;--group-color:${group.color}"><span>${options.escapeHtml(group.title)}</span></div>`
}

function renderLinkOverlay(graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions): string {
  const left = Math.min(0, ...graph.nodes.map((node) => node.position.x - 160))
  const top = Math.min(0, ...graph.nodes.map((node) => node.position.y - 160))
  const right = Math.max(980, ...graph.nodes.map((node) => node.position.x + node.size.width + 160))
  const bottom = Math.max(620, ...graph.nodes.map((node) => node.position.y + node.size.height + 160))
  const width = right - left
  const height = bottom - top
  return `
    <svg class="chat-resource-link-overlay" width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}" style="left:${left}px;top:${top}px">
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
  const isRunLink = linkItem.id.startsWith('run-link-')
  const sourceSlot = getSlotOffset(source, getOutputIndex(source.type, linkItem.sourceSlotId), 'output')
  const targetSlot = getSlotOffset(target, getInputIndex(target.type, linkItem.targetSlotId), 'input')
  let x1 = source.position.x + source.size.width + sourceSlot.x
  let y1 = source.position.y + sourceSlot.y
  let x2 = target.position.x + targetSlot.x
  let y2 = target.position.y + targetSlot.y
  let path = ''
  if (isRunLink) {
    const horizontal = Math.abs(target.position.x - source.position.x) > Math.abs(target.position.y - source.position.y) * 1.15
    if (horizontal) {
      const direction = target.position.x >= source.position.x ? 1 : -1
      x1 = direction > 0 ? source.position.x + source.size.width : source.position.x
      y1 = source.position.y + source.size.height * 0.5
      x2 = direction > 0 ? target.position.x : target.position.x + target.size.width
      y2 = target.position.y + target.size.height * 0.5
      const mid = Math.max(92, Math.abs(x2 - x1) * 0.44)
      path = `M ${x1} ${y1} C ${x1 + direction * mid} ${y1}, ${x2 - direction * mid} ${y2}, ${x2} ${y2}`
    } else {
      x1 = source.position.x + source.size.width * 0.5
      const direction = target.position.y >= source.position.y ? 1 : -1
      y1 = direction > 0 ? source.position.y + source.size.height : source.position.y
      x2 = target.position.x + target.size.width * 0.5
      y2 = direction > 0 ? target.position.y : target.position.y + target.size.height
      const mid = Math.max(58, Math.abs(y2 - y1) * 0.44)
      path = `M ${x1} ${y1} C ${x1} ${y1 + direction * mid}, ${x2} ${y2 - direction * mid}, ${x2} ${y2}`
    }
  } else {
    const mid = Math.max(80, Math.abs(x2 - x1) * 0.45)
    path = `M ${x1} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2} ${y2}`
  }
  const flowing = source.status === 'running' || source.status === 'queued' || target.status === 'running' || target.status === 'queued'
  const collapsedNodeLinkReroute = Boolean(source.collapsed || target.collapsed)
  const highlighted = options.viewState?.agentHighlights?.linkIds?.includes(linkItem.id) ?? false
  const actionLabel = options.viewState?.agentHighlights?.linkActions?.[linkItem.id] ?? ''
  const centerX = (x1 + x2) / 2
  const centerY = (y1 + y2) / 2
  const disconnectLabel = ui(options, '断开连接', 'Disconnect link')
  const runLinkOrder = isRunLink ? linkItem.id.match(/^run-link-(\d+)/)?.[1] ?? '' : ''
  return `
    <g class="chat-resource-link ${isRunLink ? 'run-sequence-link' : ''} ${options.escapeHtml(linkItem.kind)} ${options.escapeHtml(linkItem.status)} ${flowing ? 'flowing' : ''} ${collapsedNodeLinkReroute ? 'collapsed-node-link reroute-link' : ''} ${highlighted ? 'agent-highlight-link' : ''} ${graph.selection.linkIds.includes(linkItem.id) ? 'selected' : ''}" data-chat-resource-link-id="${options.escapeHtml(linkItem.id)}" data-chat-workflow-link-select="${options.escapeHtml(linkItem.id)}" data-agent-op-label="${options.escapeHtml(actionLabel)}" data-run-link-order="${options.escapeHtml(runLinkOrder)}" data-run-link-target-node-id="${options.escapeHtml(isRunLink ? linkItem.targetNodeId : '')}">
      ${isRunLink ? `<circle class="chat-resource-link-port source" cx="${x1}" cy="${y1}" r="3.2"></circle><circle class="chat-resource-link-port target" cx="${x2}" cy="${y2}" r="3.6"></circle>` : ''}
      <path class="chat-resource-link-main" d="${path}" marker-end="url(#chat-resource-arrow)"></path>
      <path class="hit-area" d="${path}"></path>
      <text x="${centerX}" y="${centerY - 7}">${options.escapeHtml(actionLabel || linkItem.label || LINK_KIND_LABELS[linkItem.kind])}</text>
      <foreignObject class="chat-resource-link-disconnect-wrap" x="${centerX - 12}" y="${centerY + 2}" width="24" height="24">
        <button xmlns="http://www.w3.org/1999/xhtml" class="chat-resource-link-disconnect" type="button" data-chat-workflow-link-disconnect="${options.escapeHtml(linkItem.id)}" aria-label="${options.escapeHtml(disconnectLabel)}" title="${options.escapeHtml(disconnectLabel)}">×</button>
      </foreignObject>
    </g>
  `
}

function renderResourceNode(node: CharacterResourceNode, graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions): string {
  const definition = getDefinition(node.type)
  const selected = graph.selection.nodeIds.includes(node.id)
  const output = graph.outputs.find((item) => item.nodeId === node.id)
  const runField = typeof node.config.runField === 'string' ? node.config.runField : ''
  const runFieldClass = runField ? `run-field-${sanitizeResourceId(runField)} ${node.config.runFieldSupport ? 'run-field-support' : 'run-field-card'}` : ''
  const runOrder = typeof node.config.runOrder === 'number' ? String(node.config.runOrder) : ''
  const virtualMaterialClass = getVirtualMaterialNodeClass(node)
  const highlighted = options.viewState?.agentHighlights?.nodeIds?.includes(node.id) ?? false
  const actionLabel = options.viewState?.agentHighlights?.nodeActions?.[node.id] ?? ''
  return `
    <article class="chat-workflow-node chat-resource-node ${node.status} ${node.type} ${definition.category} ${virtualMaterialClass} ${runFieldClass} ${highlighted ? 'agent-highlight-node' : ''} ${selected ? 'selected' : ''} ${node.collapsed ? 'collapsed' : ''}" style="--node-x: ${node.position.x}px; --node-y: ${node.position.y}px; --node-w: ${node.size.width}px; --node-h: ${node.size.height}px; z-index: ${node.zIndex}" data-chat-workflow-node-id="${options.escapeHtml(node.id)}" data-chat-workflow-node-select="${options.escapeHtml(node.id)}" data-resource-node-type="${options.escapeHtml(node.type)}" data-run-artifact-id="${options.escapeHtml(output?.artifactId ?? '')}" data-run-artifact-type="${options.escapeHtml(output?.type ?? '')}" data-run-target-node-id="${options.escapeHtml(output?.sourceNodeId ?? '')}" data-run-field="${options.escapeHtml(runField)}" data-run-order="${options.escapeHtml(runOrder)}" data-agent-op-label="${options.escapeHtml(actionLabel)}">
      ${renderNodeHeader(node, definition, options)}
      ${renderNodeSlots(node, definition, options)}
      ${renderNodeWidgets(node, definition, options)}
      ${renderNodeContent(node, definition, output, options)}
      ${renderNodeFooter(node, definition, graph, options)}
      <button class="chat-resource-node-resize" type="button" data-resource-node-resize aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '调整节点尺寸' : 'Resize node')}"></button>
    </article>
  `
}

function getVirtualMaterialNodeClass(node: CharacterResourceNode): string {
  if (!isVirtualMaterialNode(node)) {
    return ''
  }
  const material = normalizeWorkflowMaterials(node.config.materials)[0]
  return material?.kind === 'image' ? 'material-image-display' : 'material-document-display'
}

function renderNodeHeader(node: CharacterResourceNode, definition: CharacterResourceNodeDefinition, options: CharacterWorkflowPageOptions): string {
  if (isVirtualMaterialNode(node)) {
    const material = normalizeWorkflowMaterials(node.config.materials)[0]
    const kindLabel = material?.kind === 'image'
      ? ui(options, '参考图片', 'Reference Image')
      : ui(options, '参考文档', 'Reference Document')
    return `
      <header class="chat-workflow-node-head chat-resource-node-header" data-chat-workflow-drag-handle>
        <button type="button" data-chat-workflow-action="toggle-node-collapse" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '折叠节点' : 'Collapse node')}"></button>
        <span>${options.escapeHtml(kindLabel)}</span>
        <strong>${options.escapeHtml(localizeNodeTitle(node, definition, options))}</strong>
        <em>${options.escapeHtml(node.status)}</em>
      </header>
    `
  }
  return `
    <header class="chat-workflow-node-head chat-resource-node-header" data-chat-workflow-drag-handle>
      <button type="button" data-chat-workflow-action="toggle-node-collapse" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '折叠节点' : 'Collapse node')}"></button>
      <span>${options.escapeHtml(localizeCategory(definition.category, options))} / ${options.escapeHtml(localizeSource(definition.source, options))}</span>
      <strong>${options.escapeHtml(localizeNodeTitle(node, definition, options))}</strong>
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
      ${slots.map((slotItem) => {
        const accepts = slotItem.accepts ?? [slotItem.type]
        const acceptLabel = formatSlotAcceptLabel(accepts)
        const guideLabel = side === 'input'
          ? ui(options, `接入：${acceptLabel}`, `Accepts: ${acceptLabel}`)
          : ui(options, `输出：${formatSlotTypeLabel(slotItem.type)}`, `Outputs: ${formatSlotTypeLabel(slotItem.type)}`)
        const dragGuideLabel = side === 'input'
          ? ui(options, `连接 ${acceptLabel}`, `Connect ${acceptLabel}`)
          : ui(options, `拖向 ${formatSlotTypeLabel(slotItem.type)} 输入口`, `Drag to a ${formatSlotTypeLabel(slotItem.type)} input`)
        const title = `${slotItem.tooltip || slotItem.type} · ${guideLabel}`
        return `
        <span class="chat-workflow-node-port chat-resource-slot ${slotItem.required ? 'required' : ''}" data-resource-slot-node="${options.escapeHtml(node.id)}" data-resource-slot-id="${options.escapeHtml(slotItem.id)}" data-resource-slot-side="${side}" data-resource-slot-type="${options.escapeHtml(slotItem.type)}" data-resource-slot-accepts="${options.escapeHtml(accepts.join(','))}" data-resource-slot-guide="${options.escapeHtml(dragGuideLabel)}" title="${options.escapeHtml(title)}">
          <i class="chat-resource-slot-dot" aria-hidden="true"></i>
          <b>${options.escapeHtml(localizeSlotLabel(slotItem, options))}</b>
          ${side === 'input' ? `<small class="chat-resource-slot-accepts">${options.escapeHtml(guideLabel)}</small>` : ''}
        </span>
      `}).join('')}
    </div>
  `
}

function renderNodeWidgets(node: CharacterResourceNode, definition: CharacterResourceNodeDefinition, options: CharacterWorkflowPageOptions): string {
  if (isVirtualMaterialNode(node)) {
    return ''
  }
  return `
    <div class="chat-resource-node-widgets">
      ${definition.parameters.slice(0, 3).map((parameterItem) => `
        <label>
          <span>${options.escapeHtml(localizeParameterLabel(parameterItem, options, node.type))}</span>
          ${renderParameterField(parameterItem, node, node.config[parameterItem.id], options)}
        </label>
      `).join('')}
    </div>
  `
}

function renderNodeContent(
  node: CharacterResourceNode,
  definition: CharacterResourceNodeDefinition,
  output: CharacterResourceOutput | undefined,
  options: CharacterWorkflowPageOptions
): string {
  if (isVirtualMaterialNode(node)) {
    return renderVirtualMaterialNodeContent(node, options)
  }
  if (!output) {
    return ''
  }
  const previewClass = `preview-${definition.previewType}`
  const runImageActions = renderRunImageActions(output, options)
  if (output.type === 'opening-layout') {
    return `
      <div class="chat-resource-node-content ${previewClass} chat-resource-opening-panel-preview">
        <strong>${options.escapeHtml(output.title)}</strong>
        <p>${options.escapeHtml(output.summary)}</p>
        <span>${options.escapeHtml(ui(options, '开幕面板已生成，详情在右侧资源中查看。', 'Opening panel generated. Review the resource details on the right.'))}</span>
      </div>
    `
  }
  if (output?.image) {
    return `
      <div class="chat-resource-node-content ${previewClass} has-image run-image-preview">
        <img src="${options.escapeHtml(output.image)}" alt="${options.escapeHtml(output.title)}">
        <div class="chat-resource-image-caption">
          <strong>${options.escapeHtml(output.title)}</strong>
        </div>
        ${runImageActions}
      </div>
    `
  }
  return `
    <div class="chat-resource-node-content ${previewClass}">
      <strong>${options.escapeHtml(output.title)}</strong>
      <p>${options.escapeHtml(output.summary)}</p>
      ${runImageActions}
    </div>
  `
}

function renderVirtualMaterialNodeContent(node: CharacterResourceNode, options: CharacterWorkflowPageOptions): string {
  const material = normalizeWorkflowMaterials(node.config.materials)[0]
  if (!material) {
    return ''
  }
  const meta = [
    material.mimeType,
    formatMaterialSize(material.size, options),
  ].filter(Boolean).join(' · ')
  if (material.kind === 'image') {
    return `
      <div class="chat-resource-node-content material-image-preview has-image">
        ${material.dataUrl ? `<img src="${options.escapeHtml(material.dataUrl)}" alt="${options.escapeHtml(material.name)}">` : ''}
        <div>
          <strong>${options.escapeHtml(ui(options, '图片参考', 'Image Reference'))}</strong>
          <p>${options.escapeHtml(meta || ui(options, '可作为图片生成 reference', 'Available as an image generation reference'))}</p>
        </div>
        <button type="button" data-chat-workflow-action="remove-material" data-chat-workflow-node="${options.escapeHtml(node.id)}" data-material-id="${options.escapeHtml(material.id)}">${options.escapeHtml(ui(options, '移除', 'Remove'))}</button>
      </div>
    `
  }
  return `
    <div class="chat-resource-node-content material-document-preview">
      <strong>${options.escapeHtml(ui(options, '文档参考', 'Document Reference'))}</strong>
      <p>${options.escapeHtml(material.text || meta || material.name)}</p>
      <button type="button" data-chat-workflow-action="remove-material" data-chat-workflow-node="${options.escapeHtml(node.id)}" data-material-id="${options.escapeHtml(material.id)}">${options.escapeHtml(ui(options, '移除', 'Remove'))}</button>
    </div>
  `
}

function renderRunImageActions(output: CharacterResourceOutput, options: CharacterWorkflowPageOptions): string {
  if (output.type !== 'image-asset' && output.type !== 'image-attempt' && output.type !== 'stale-marker') {
    return ''
  }
  const data = output.data && typeof output.data === 'object' && !Array.isArray(output.data)
    ? output.data as Record<string, unknown>
    : {}
  const targetNodeId = typeof data.targetNodeId === 'string'
    ? data.targetNodeId
    : typeof data.staleTargetNodeId === 'string'
      ? data.staleTargetNodeId
      : output.sourceNodeId ?? ''
  const attemptId = typeof data.attemptId === 'string'
    ? data.attemptId
    : output.type === 'image-attempt'
      ? output.artifactId ?? ''
      : typeof data.parentAttemptId === 'string'
        ? data.parentAttemptId
        : ''
  const artifactId = output.artifactId ?? ''
  const rerollLabel = ui(options, '追加指令重炼', 'Reroll with instruction')
  return `
    <div class="chat-resource-image-actions" data-run-image-actions>
      <button type="button" data-chat-workflow-run-image-action="reroll" data-run-artifact-id="${options.escapeHtml(artifactId)}" data-run-target-node-id="${options.escapeHtml(targetNodeId)}" data-run-attempt-id="${options.escapeHtml(attemptId)}" aria-label="${options.escapeHtml(rerollLabel)}" title="${options.escapeHtml(rerollLabel)}"><i icon-name="rotate-ccw" aria-hidden="true"></i></button>
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
  const output = graph.outputs.find((item) => item.nodeId === selectedNode.id)
  return `
    <aside class="chat-workflow-inspector chat-resource-inspector" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '资源 Inspector' : 'Resource inspector')}">
      <div class="chat-workflow-inspector-scroll">
        <header class="chat-workflow-inspector-head">
          <span>${options.escapeHtml(`${localizeCategory(definition.category, options)} / ${localizeSource(definition.source, options)} / ${definition.previewType}`)}</span>
          <strong>${options.escapeHtml(localizeNodeTitle(selectedNode, definition, options))}</strong>
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
            ${definition.inputs.map((slotItem) => `<span><b>IN</b>${options.escapeHtml(localizeSlotLabel(slotItem, options))}<small>${options.escapeHtml(formatSlotAcceptLabel(slotItem.accepts ?? [slotItem.type]))}</small></span>`).join('') || '<span><b>IN</b>-</span>'}
            ${definition.outputs.map((slotItem) => `<span><b>OUT</b>${options.escapeHtml(localizeSlotLabel(slotItem, options))}<small>${options.escapeHtml(formatSlotTypeLabel(slotItem.type))}</small></span>`).join('')}
          </div>
        </section>
        ${output ? `
          <section class="chat-workflow-inspector-section">
            <h4>${options.escapeHtml(ui(options, '运行输出', 'Run Output'))}</h4>
            <div class="chat-resource-output-card ${output.image ? 'has-image' : ''}">
              ${output.image ? `<img src="${options.escapeHtml(output.image)}" alt="${options.escapeHtml(output.title)}">` : ''}
              <strong>${options.escapeHtml(output.title)}</strong>
              <p>${options.escapeHtml(output.summary)}</p>
              <span>${options.escapeHtml(output.status)}</span>
            </div>
          </section>
        ` : ''}
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
    <div class="chat-workflow-inspector-field ${dirty ? 'is-dirty' : ''} ${validation ? 'is-invalid' : ''}">
      <span>
        <b>${options.escapeHtml(localizeParameterLabel(parameterItem, options, node.type))}</b>
        ${dirty ? `<button class="chat-workflow-param-reset" type="button" data-chat-workflow-action="reset-parameter" data-chat-workflow-param-reset="${options.escapeHtml(parameterItem.id)}" data-chat-workflow-node="${options.escapeHtml(node.id)}">${options.escapeHtml(ui(options, '重置', 'Reset'))}</button>` : ''}
      </span>
      ${renderParameterField(parameterItem, node, value ?? parameterItem.defaultValue, options, Boolean(validation))}
      ${validation ? `<em class="chat-workflow-field-error">${options.escapeHtml(validation)}</em>` : ''}
    </div>
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
  const label = localizeParameterLabel(parameterItem, options, node.type)
  if (parameterItem.type === 'boolean') {
    return `<input class="chat-workflow-boolean-field" type="checkbox" ${baseAttrs} ${value ? 'checked' : ''} aria-label="${options.escapeHtml(label)}">`
  }
  if (parameterItem.type === 'number' || parameterItem.type === 'integer') {
    return `<input type="number" ${baseAttrs} value="${options.escapeHtml(formatParameterValue(value))}" ${parameterItem.min === undefined ? '' : `min="${parameterItem.min}"`} ${parameterItem.max === undefined ? '' : `max="${parameterItem.max}"`} ${parameterItem.step === undefined ? '' : `step="${parameterItem.step}"`} aria-label="${options.escapeHtml(label)}">`
  }
  if (parameterItem.type === 'model-select') {
    return renderModelSelectField(parameterItem, node, value, options, baseAttrs)
  }
  if (parameterItem.type === 'materials') {
    return renderMaterialsField(parameterItem, node, value, options)
  }
  if (parameterItem.type === 'field-control-list') {
    return renderFieldControlListField(parameterItem, node, value, options)
  }
  if (parameterItem.type === 'select') {
    return `
      <select ${baseAttrs} aria-label="${options.escapeHtml(label)}">
        ${(parameterItem.options ?? []).map((optionItem) => `<option value="${options.escapeHtml(optionItem.value)}" ${String(value) === optionItem.value ? 'selected' : ''}>${options.escapeHtml(localizeParameterOptionLabel(parameterItem, optionItem, options))}</option>`).join('')}
      </select>
    `
  }
  if (parameterItem.type === 'multi-select' || parameterItem.type === 'string-list') {
    return `<input type="text" ${baseAttrs} value="${options.escapeHtml(formatParameterValue(value))}" aria-label="${options.escapeHtml(label)}">`
  }
  if (parameterItem.type === 'textarea') {
    return `<textarea ${baseAttrs} rows="2" aria-label="${options.escapeHtml(label)}">${options.escapeHtml(formatParameterValue(value))}</textarea>`
  }
  return `<input type="text" ${baseAttrs} value="${options.escapeHtml(formatParameterValue(value))}" aria-label="${options.escapeHtml(label)}">`
}

function renderFieldControlListField(
  parameterItem: CharacterResourceParameterDefinition,
  node: CharacterResourceNode,
  value: unknown,
  options: CharacterWorkflowPageOptions
): string {
  const fields = normalizeWorkflowStringList(node.config.fields, DEFAULT_CHARACTER_FIELD_TARGET_FIELDS)
  const controls = normalizeWorkflowFieldControls(value, fields)
  const baseAttrs = `data-chat-workflow-param="${options.escapeHtml(parameterItem.id)}" data-chat-workflow-node="${options.escapeHtml(node.id)}" data-chat-workflow-param-type="${options.escapeHtml(parameterItem.type)}"`
  return `
    <div class="chat-workflow-field-control-list" ${baseAttrs}>
      ${controls.map((control) => renderFieldControlRow(parameterItem, node.id, control, options)).join('')}
    </div>
  `
}

function renderFieldControlRow(
  parameterItem: CharacterResourceParameterDefinition,
  nodeId: string,
  control: WorkflowFieldControlItem,
  options: CharacterWorkflowPageOptions
): string {
  const fieldLabel = localizeWorkflowFieldLabel(control.field, options)
  const fieldAttrs = `data-chat-workflow-param="${options.escapeHtml(parameterItem.id)}" data-chat-workflow-node="${options.escapeHtml(nodeId)}" data-chat-workflow-param-type="${options.escapeHtml(parameterItem.type)}" data-chat-workflow-field-control-field="${options.escapeHtml(control.field)}"`
  return `
    <article class="chat-workflow-field-control-row" data-chat-workflow-field-control-row="${options.escapeHtml(control.field)}">
      <header>
        <strong>${options.escapeHtml(fieldLabel)}</strong>
        <span>${options.escapeHtml(control.field)}</span>
      </header>
      <textarea ${fieldAttrs} data-chat-workflow-field-control-key="fieldPurpose" rows="2" aria-label="${options.escapeHtml(`${fieldLabel} purpose`)}">${options.escapeHtml(control.fieldPurpose)}</textarea>
      <div class="chat-workflow-field-control-inline">
        <label>
          <span>${options.escapeHtml(ui(options, '语气', 'Tone'))}</span>
          <select ${fieldAttrs} data-chat-workflow-field-control-key="tone" aria-label="${options.escapeHtml(`${fieldLabel} tone`)}">
            ${FIELD_TONE_OPTIONS.map((optionItem) => `<option value="${options.escapeHtml(optionItem.value)}" ${optionItem.value === control.tone ? 'selected' : ''}>${options.escapeHtml(localizeFieldControlOption(optionItem, options))}</option>`).join('')}
          </select>
        </label>
        <label>
          <span>${options.escapeHtml(ui(options, '长度', 'Length'))}</span>
          <select ${fieldAttrs} data-chat-workflow-field-control-key="lengthPolicy" aria-label="${options.escapeHtml(`${fieldLabel} length`)}">
            ${FIELD_LENGTH_POLICY_OPTIONS.map((optionItem) => `<option value="${options.escapeHtml(optionItem.value)}" ${optionItem.value === control.lengthPolicy ? 'selected' : ''}>${options.escapeHtml(localizeFieldControlOption(optionItem, options))}</option>`).join('')}
          </select>
        </label>
      </div>
      <label class="chat-workflow-field-control-avoid">
        <span>${options.escapeHtml(ui(options, '规避', 'Avoid'))}</span>
        <input type="text" ${fieldAttrs} data-chat-workflow-field-control-key="avoidPatterns" value="${options.escapeHtml(control.avoidPatterns.join(', '))}" aria-label="${options.escapeHtml(`${fieldLabel} avoid patterns`)}">
      </label>
    </article>
  `
}

function localizeFieldControlOption(optionItem: { label: string; value: string }, options: CharacterWorkflowPageOptions): string {
  return workflowText(options, `chat.workflow.option.${optionItem.value}`, optionItem.label)
}

function localizeWorkflowFieldLabel(field: string, options: CharacterWorkflowPageOptions): string {
  const optionItem = CHARACTER_FIELD_OPTIONS.find((item) => item.value === field)
  return optionItem ? workflowText(options, `chat.workflow.option.${field}`, optionItem.label) : field
}

function normalizeWorkflowStringList(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) {
    return [...fallback]
  }
  const values = value.map((item) => String(item).trim()).filter(Boolean)
  return values.length ? [...new Set(values)] : [...fallback]
}

function normalizeWorkflowFieldControls(value: unknown, fields: string[]): WorkflowFieldControlItem[] {
  const configured = new Map<string, WorkflowFieldControlItem>()
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const record = item as Record<string, unknown>
      const field = typeof record.field === 'string' ? record.field.trim() : ''
      if (!field) continue
      configured.set(field, {
        ...defaultWorkflowFieldControl(field),
        field,
        fieldPurpose: typeof record.fieldPurpose === 'string' ? record.fieldPurpose : defaultWorkflowFieldControl(field).fieldPurpose,
        tone: typeof record.tone === 'string' ? record.tone : defaultWorkflowFieldControl(field).tone,
        lengthPolicy: typeof record.lengthPolicy === 'string' ? record.lengthPolicy : defaultWorkflowFieldControl(field).lengthPolicy,
        avoidPatterns: normalizeWorkflowStringList(record.avoidPatterns, []),
      })
    }
  }
  return fields.map((field) => configured.get(field) ?? defaultWorkflowFieldControl(field))
}

function defaultWorkflowFieldControl(field: string): WorkflowFieldControlItem {
  const existing = DEFAULT_CHARACTER_FIELD_CONTROLS.find((control) => control.field === field)
  if (existing) {
    return {
      ...existing,
      avoidPatterns: [...existing.avoidPatterns],
    }
  }
  return {
    field,
    fieldPurpose: `Generation control for ${field}.`,
    tone: 'neutral',
    lengthPolicy: field === 'name' ? 'short' : field === 'firstMessage' ? 'long' : 'medium',
    avoidPatterns: [],
  }
}

function renderMaterialsField(
  parameterItem: CharacterResourceParameterDefinition,
  node: CharacterResourceNode,
  value: unknown,
  options: CharacterWorkflowPageOptions
): string {
  const materials = normalizeWorkflowMaterials(value)
  const label = localizeParameterLabel(parameterItem, options, node.type)
  return `
    <div class="chat-workflow-materials-field" data-chat-workflow-param="${options.escapeHtml(parameterItem.id)}" data-chat-workflow-node="${options.escapeHtml(node.id)}" data-chat-workflow-param-type="materials" aria-label="${options.escapeHtml(label)}">
      <div class="chat-workflow-materials-head">
        <span>${options.escapeHtml(ui(options, `${materials.length} 个素材`, `${materials.length} materials`))}</span>
        <button type="button" data-chat-workflow-action="add-materials" data-chat-workflow-node="${options.escapeHtml(node.id)}">${options.escapeHtml(ui(options, '添加素材', 'Add Materials'))}</button>
      </div>
      <div class="chat-workflow-materials-list">
        ${materials.length ? materials.map((material) => renderMaterialChip(material, node.id, options)).join('') : `<p>${options.escapeHtml(ui(options, '加入图片或文档后会自动识别类型。', 'Add images or documents; type is inferred automatically.'))}</p>`}
      </div>
    </div>
  `
}

function renderMaterialChip(material: WorkflowMaterialItem, nodeId: string, options: CharacterWorkflowPageOptions): string {
  const meta = [
    material.kind === 'image' ? ui(options, '图片', 'Image') : ui(options, '文档', 'Document'),
    material.mimeType,
    formatMaterialSize(material.size, options),
  ].filter(Boolean).join(' · ')
  return `
    <article class="chat-workflow-material-chip ${options.escapeHtml(material.kind)}">
      ${material.kind === 'image' && material.dataUrl ? `<img src="${options.escapeHtml(material.dataUrl)}" alt="${options.escapeHtml(material.name)}">` : '<i aria-hidden="true"></i>'}
      <span>
        <strong>${options.escapeHtml(material.name)}</strong>
        <small>${options.escapeHtml(meta)}</small>
      </span>
      <button type="button" data-chat-workflow-action="remove-material" data-chat-workflow-node="${options.escapeHtml(nodeId)}" data-material-id="${options.escapeHtml(material.id)}" aria-label="${options.escapeHtml(ui(options, '移除素材', 'Remove material'))}">x</button>
    </article>
  `
}

function normalizeWorkflowMaterials(value: unknown): WorkflowMaterialItem[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item, index): WorkflowMaterialItem[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return []
    }
    const record = item as Record<string, unknown>
    const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : `material-${index + 1}`
    const mimeType = typeof record.mimeType === 'string' ? record.mimeType : ''
    const material: WorkflowMaterialItem = {
      id: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `material-${index + 1}`,
      kind: inferWorkflowMaterialKind(record.kind, mimeType, name),
      name,
      mimeType,
    }
    if (typeof record.dataUrl === 'string' && record.dataUrl.trim()) {
      material.dataUrl = record.dataUrl.trim()
    }
    if (typeof record.text === 'string' && record.text.trim()) {
      material.text = record.text.trim()
    }
    if (typeof record.size === 'number' && Number.isFinite(record.size)) {
      material.size = Math.max(0, Math.round(record.size))
    }
    return [material]
  })
}

function inferWorkflowMaterialKind(value: unknown, mimeType: string, name: string): WorkflowMaterialItem['kind'] {
  if (value === 'image' || value === 'document') {
    return value
  }
  if (mimeType.startsWith('image/')) {
    return 'image'
  }
  return /\.(png|jpe?g|webp|gif)$/i.test(name) ? 'image' : 'document'
}

function formatMaterialSize(value: number | undefined, options: CharacterWorkflowPageOptions): string {
  if (!value) {
    return ''
  }
  if (value < 1024) {
    return ui(options, `${value} 字节`, `${value} B`)
  }
  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KB`
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function renderModelSelectField(
  parameterItem: CharacterResourceParameterDefinition,
  node: CharacterResourceNode,
  value: unknown,
  options: CharacterWorkflowPageOptions,
  baseAttrs: string
): string {
  const choices = getModelChoices(parameterItem, options)
  const currentValue = formatParameterValue(value) || choices[0]?.id || ''
  const selected = choices.find((choice) => choice.id === currentValue) ?? choices[0]
  if (!choices.length) {
    return `
      <div class="chat-resource-model-select empty" ${baseAttrs}>
        <span>${options.escapeHtml(ui(options, '请先在模型配置页添加可用模型', 'Add an available model in Models first'))}</span>
      </div>
    `
  }
  return `
    <details class="chat-resource-model-select">
      <summary aria-label="${options.escapeHtml(localizeParameterLabel(parameterItem, options, node.type))}">
        <span class="chat-resource-model-choice-logo">${selected.logoHtml}</span>
        <span class="chat-resource-model-choice-copy">
          <strong>${options.escapeHtml(selected.modelName)}</strong>
          <small>${options.escapeHtml(selected.providerLabel)}</small>
        </span>
      </summary>
      <div class="chat-resource-model-select-menu">
        ${choices.map((choice) => `
          <button class="chat-resource-model-choice ${choice.id === currentValue ? 'selected' : ''}" type="button" ${baseAttrs} data-chat-workflow-model-choice data-chat-workflow-model-value="${options.escapeHtml(choice.id)}" data-chat-workflow-model-api="${options.escapeHtml(choice.apiId)}" data-chat-workflow-model-name="${options.escapeHtml(choice.modelName)}">
            <span class="chat-resource-model-choice-logo">${choice.logoHtml}</span>
            <span class="chat-resource-model-choice-copy">
              <strong>${options.escapeHtml(choice.modelName)}</strong>
              <small>${options.escapeHtml(choice.providerLabel)}</small>
            </span>
          </button>
        `).join('')}
      </div>
    </details>
  `
}

function areParameterValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

function validateInspectorParameter(parameterItem: CharacterResourceParameterDefinition, value: unknown, options: CharacterWorkflowPageOptions): string {
  if (parameterItem.type === 'model-select') {
    const choices = getModelChoices(parameterItem, options)
    if (!choices.length) {
      return ui(options, '模型配置页暂无可用模型', 'No available model in Models')
    }
    if (!choices.some((choice) => choice.id === String(value ?? ''))) {
      return ui(options, '请选择可用模型', 'Choose an available model')
    }
  }
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

function renderBottomToolbar(graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions, activeTab: 'workflow' | 'run-draft'): string {
  const validationIssues = graph.links.filter((linkItem) => linkItem.status !== 'valid').length
  if (activeTab === 'run-draft') {
    const activeRunId = options.runState?.run?.id ?? ''
    const drafts = options.runDrafts ?? []
    const activeDraft = drafts.find((draft) => draft.id === activeRunId)
    return `
    <footer class="chat-resource-bottom-toolbar chat-resource-run-bottom-toolbar">
      <div>
        <strong>${options.escapeHtml(activeDraft?.title ?? options.runState?.run?.title ?? ui(options, '运行草稿', 'Run Draft'))}</strong>
        <span>${options.escapeHtml(ui(options, `${drafts.length} 个运行草稿`, `${drafts.length} run drafts`))}</span>
      </div>
      <label class="chat-resource-run-draft-select">
        <select data-chat-workflow-run-select aria-label="${options.escapeHtml(ui(options, '选择运行草稿', 'Select run draft'))}">
          ${drafts.map((draft) => `<option value="${options.escapeHtml(draft.id)}" ${draft.id === activeRunId ? 'selected' : ''}>${options.escapeHtml(`${draft.title} · ${draft.status}`)}</option>`).join('')}
        </select>
      </label>
      <button type="button" data-chat-workflow-action="delete-run-draft" ${activeRunId ? '' : 'disabled'}><i icon-name="trash-2" aria-hidden="true"></i><span>${options.escapeHtml(ui(options, '删除草稿', 'Delete Draft'))}</span></button>
      <button type="button" data-chat-workflow-action="chat-test" ${activeRunId ? '' : 'disabled'}><i icon-name="message-circle" aria-hidden="true"></i><span>${options.escapeHtml(ui(options, '聊天测试', 'Chat Test'))}</span></button>
    </footer>
  `
  }
  return `
    <footer class="chat-resource-bottom-toolbar">
      <div>
        <strong>${options.escapeHtml(graph.title)}</strong>
        <span>${options.escapeHtml(ui(options, `${graph.nodes.length} 个节点 / ${graph.links.length} 条连线 / ${validationIssues} 个问题`, `${graph.nodes.length} nodes / ${graph.links.length} links / ${validationIssues} issues`))}</span>
      </div>
      <button type="button" data-chat-workflow-action="save-graph"><i icon-name="save" aria-hidden="true"></i><span>${options.escapeHtml(ui(options, '保存', 'Save'))}</span></button>
      <button type="button" data-chat-workflow-node-select="quality-gate">${options.escapeHtml(ui(options, '校验', 'Validate'))}</button>
      <button type="button" data-chat-workflow-action="chat-test"><i icon-name="message-circle" aria-hidden="true"></i><span>${options.escapeHtml(ui(options, '聊天测试', 'Chat Test'))}</span></button>
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
        ${categories.map((category) => `<button type="button" data-resource-node-search-category="${options.escapeHtml(category)}">${options.escapeHtml(localizeCategory(category, options))}</button>`).join('')}
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
      <button type="button" role="menuitem" data-resource-menu-scope="canvas" data-chat-workflow-action="open-node-search">${options.escapeHtml(ui(options, '添加节点', 'Add Node'))}</button>
      <button type="button" role="menuitem" data-resource-menu-scope="all" data-chat-workflow-action="fit-view">${options.escapeHtml(ui(options, '适配视图', 'Fit View'))}</button>
      <button type="button" role="menuitem" data-resource-menu-scope="node" data-chat-workflow-action="copy-selection">${options.escapeHtml(ui(options, '复制', 'Copy'))}</button>
      <button type="button" role="menuitem" data-resource-menu-scope="canvas" data-chat-workflow-action="paste-selection">${options.escapeHtml(ui(options, '粘贴', 'Paste'))}</button>
      <button type="button" role="menuitem" data-resource-menu-scope="node" data-chat-workflow-action="duplicate-selection">${options.escapeHtml(ui(options, '复制副本', 'Duplicate'))}</button>
      <button type="button" role="menuitem" data-resource-menu-scope="all" data-chat-workflow-action="undo-graph">${options.escapeHtml(ui(options, '撤销', 'Undo'))}</button>
      <button type="button" role="menuitem" data-resource-menu-scope="all" data-chat-workflow-action="redo-graph">${options.escapeHtml(ui(options, '重做', 'Redo'))}</button>
      <button type="button" role="menuitem" data-resource-menu-scope="node" data-chat-workflow-action="align-left">${options.escapeHtml(ui(options, '左对齐', 'Align Left'))}</button>
      <button type="button" role="menuitem" data-resource-menu-scope="node" data-chat-workflow-action="align-top">${options.escapeHtml(ui(options, '顶对齐', 'Align Top'))}</button>
      <button class="danger" type="button" role="menuitem" data-resource-menu-scope="node" data-chat-workflow-action="delete-selection">${options.escapeHtml(ui(options, '删除', 'Delete'))}</button>
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
  previewType: CharacterResourcePreviewType,
  defaultSize: { width: number; height: number } = { width: 268, height: 226 }
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
    defaultSize,
    previewType,
  }
}

function slot(id: string, label: string, type: string, tooltip = '', required = false, accepts?: string[]): CharacterResourceSlotDefinition {
  return { id, label, type, accepts, required, tooltip: tooltip || type }
}

function param(
  id: string,
  label: string,
  type: CharacterResourceParameterType,
  defaultValue: unknown,
  min?: number,
  max?: number,
  step?: number,
  options?: Array<{ label: string; value: string }>,
  modelKind?: CharacterWorkflowModelChoice['kind']
): CharacterResourceParameterDefinition {
  return { id, label, type, defaultValue, min, max, step, options, modelKind }
}

function getParameterDefaultValue(parameterItem: CharacterResourceParameterDefinition, options: CharacterWorkflowPageOptions): unknown {
  if (parameterItem.type === 'model-select') {
    return getModelChoices(parameterItem, options)[0]?.id ?? parameterItem.defaultValue
  }
  return cloneWorkflowParameterValue(parameterItem.defaultValue)
}

function cloneWorkflowParameterValue(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value
  }
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return item
    }
    const record = item as Record<string, unknown>
    return {
      ...record,
      avoidPatterns: Array.isArray(record.avoidPatterns) ? [...record.avoidPatterns] : record.avoidPatterns,
    }
  })
}

function getModelChoices(parameterItem: CharacterResourceParameterDefinition, options: CharacterWorkflowPageOptions): CharacterWorkflowModelChoice[] {
  const modelKind = parameterItem.modelKind
  return (options.modelChoices ?? []).filter((choice) => !modelKind || choice.kind === modelKind)
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
  return areSlotDefinitionsCompatible(sourceSlot, targetSlot)
}

function areSlotDefinitionsCompatible(
  sourceSlot: CharacterResourceSlotDefinition | undefined,
  targetSlot: CharacterResourceSlotDefinition | undefined
): boolean {
  if (!sourceSlot || !targetSlot) {
    return false
  }
  return parseSlotAccepts(targetSlot.accepts, targetSlot.type).includes(sourceSlot.type)
}

function parseSlotAccepts(value: string | string[] | undefined, fallbackType = ''): string[] {
  if (Array.isArray(value)) {
    return value.length ? value : (fallbackType ? [fallbackType] : [])
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map((item) => item.trim()).filter(Boolean)
  }
  return fallbackType ? [fallbackType] : []
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
  if (
    activeTabId.startsWith('run-') ||
    activeTabId.startsWith('resource-run-') ||
    activeTabId.startsWith('character-agent-run-') ||
    activeTabId.toLowerCase().startsWith('generated ')
  ) {
    return 'run-draft'
  }
  return activeTabId
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
