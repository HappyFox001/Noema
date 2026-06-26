/**
 * Renders the character resource graph workbench for the chat surface.
 */
import Fuse from 'fuse.js'
import Split from 'split-grid'
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/dist/esm/adapter/element-adapter.js'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import { Link2Off, Maximize, MessageCircle, Play, RotateCcw, Save, Search, Square, Trash2, createIcons } from 'lucide'
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
type CharacterResourceParameterType = 'text' | 'textarea' | 'number' | 'integer' | 'boolean' | 'select' | 'multi-select' | 'string-list' | 'model-select'
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
  return workflowText(options, `chat.workflow.node.${definition.type}`, node.title || definition.displayName)
}

function localizeParameterLabel(parameterItem: CharacterResourceParameterDefinition, options: CharacterWorkflowPageOptions): string {
  return workflowText(options, `chat.workflow.param.${parameterItem.id}`, parameterItem.label)
}

function localizeSlotLabel(slotItem: CharacterResourceSlotDefinition, options: CharacterWorkflowPageOptions): string {
  return workflowText(options, `chat.workflow.slot.${slotItem.id}`, slotItem.label)
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
    slot('target', 'Target', 'asset-target', 'Character card target resource.'),
    slot('candidate', 'Candidate', 'candidate-pack', 'Candidate package produced for evaluation and export.'),
  ], [
    param('includeFields', 'Include Fields', 'multi-select', ['name', 'description', 'appearance', 'personality', 'background', 'scenario', 'firstMessage', 'dialogueStyle', 'worldContext'], undefined, undefined, undefined, [
      { label: 'Name', value: 'name' },
      { label: 'Description', value: 'description' },
      { label: 'Appearance', value: 'appearance' },
      { label: 'Personality', value: 'personality' },
      { label: 'Background', value: 'background' },
      { label: 'Scenario', value: 'scenario' },
      { label: 'First Message', value: 'firstMessage' },
      { label: 'Dialogue Style', value: 'dialogueStyle' },
      { label: 'World Context', value: 'worldContext' },
    ]),
    param('includeSupportFields', 'Support Fields', 'multi-select', ['appearancePrompt'], undefined, undefined, undefined, [
      { label: 'Appearance Prompt', value: 'appearancePrompt' },
    ]),
  ], 'package'),
  createDefinition('character-field-target', 'Character Field Target', ['字段', 'field target', '局部字段'], 'Targets', 'asset', 'Declares a single card field as an independently controllable target resource.', [
    slot('card', 'Card', 'asset-target', 'Character card target.'),
    slot('style', 'Style', 'style-signal', 'Local field style pressure.'),
    slot('constraint', 'Constraint', 'hard-constraint', 'Local field constraints.'),
    slot('fieldControl', 'Field Control', 'asset-target', 'Field generation control.'),
  ], [
    slot('field', 'Field', 'asset-target', 'Field target resource.'),
  ], [
    param('field', 'Field', 'select', 'firstMessage', undefined, undefined, undefined, [
      { label: 'Name', value: 'name' },
      { label: 'Description', value: 'description' },
      { label: 'Appearance', value: 'appearance' },
      { label: 'Personality', value: 'personality' },
      { label: 'Background', value: 'background' },
      { label: 'Scenario', value: 'scenario' },
      { label: 'First Message', value: 'firstMessage' },
      { label: 'Dialogue Style', value: 'dialogueStyle' },
      { label: 'World Context', value: 'worldContext' },
      { label: 'Appearance Prompt', value: 'appearancePrompt' },
    ]),
  ], 'text-card'),
  createDefinition('opening-layout-target', 'Opening Layout Target', ['开幕版面', 'opening layout', 'css card'], 'Targets', 'asset', 'Declares the CSS/HTML-style opening presentation for the role card, combining opening text, visual assets, title, tags, and card surface layout.', [
    slot('card', 'Card', 'asset-target', 'Character card target.', true),
    slot('field', 'Field', 'asset-target', 'Opening or supporting text field.'),
    slot('imageAsset', 'Image Asset', 'asset-target', 'Images used by the opening presentation.'),
    slot('style', 'Style', 'style-signal', 'Layout and prose style pressure.'),
    slot('constraint', 'Constraint', 'hard-constraint', 'Layout constraints.'),
  ], [
    slot('layout', 'Layout', 'asset-target', 'Opening layout target resource.'),
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
    slot('card', 'Card', 'asset-target', 'Character card target.'),
    slot('image', 'Image', 'image-capability', 'Image generation capability.', true),
    slot('imageControl', 'Image Control', 'asset-target', 'Image generation control.'),
    slot('referenceImage', 'Reference Image', 'asset-target', 'Reference image artifact used to preserve visual identity.'),
  ], [
    slot('imageAsset', 'Image Asset', 'asset-target', 'Image target resource.'),
  ], [
    param('imageRole', 'Image Role', 'select', 'hero-cover', undefined, undefined, undefined, [
      { label: 'Avatar', value: 'avatar' },
      { label: 'Character Overview Sheet', value: 'character-overview-sheet' },
      { label: 'Hero Cover', value: 'hero-cover' },
      { label: 'Full Body', value: 'full-body' },
      { label: 'Opening Moment', value: 'opening-moment' },
      { label: 'Story Moment', value: 'story-moment' },
      { label: 'Expression', value: 'expression' },
      { label: 'Outfit Detail', value: 'outfit-detail' },
      { label: 'Relationship Moment', value: 'relationship-moment' },
      { label: 'World Context', value: 'world-context' },
    ]),
    param('assetPurpose', 'Asset Purpose', 'textarea', ''),
  ], 'image'),
  createDefinition('world-card-target', 'World Card Target', ['世界卡', 'world card', 'setting'], 'Targets', 'asset', 'Declares an overall world resource for NPCs, scenes, relationship network, and plot progression.', [
    slot('goal', 'Goal', 'generation-goal', 'Primary world goal.', true),
    slot('style', 'Style', 'style-signal', 'World style pressure.'),
    slot('constraint', 'Constraint', 'hard-constraint', 'World constraints.'),
    slot('source', 'Source', 'source-context', 'Grounding source material.'),
  ], [
    slot('world', 'World', 'asset-target', 'World card resource.'),
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
    slot('world', 'World', 'asset-target', 'World card resource.'),
    slot('relationship', 'Relationship', 'asset-target', 'Relationship control.'),
    slot('style', 'Style', 'style-signal', 'NPC pack style.'),
    slot('constraint', 'Constraint', 'hard-constraint', 'NPC constraints.'),
  ], [
    slot('npcPack', 'NPC Pack', 'asset-target', 'NPC pack resource.'),
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
    slot('npcPack', 'NPC Pack', 'asset-target', 'NPC pack resource.'),
    slot('style', 'Style', 'style-signal', 'NPC style.'),
    slot('constraint', 'Constraint', 'hard-constraint', 'NPC constraints.'),
    slot('relationship', 'Relationship', 'asset-target', 'Relationship control.'),
  ], [
    slot('npc', 'NPC', 'asset-target', 'NPC resource.'),
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
    slot('world', 'World', 'asset-target', 'World card resource.'),
    slot('npcPack', 'NPC Pack', 'asset-target', 'NPC pack resource.'),
    slot('continuity', 'Continuity', 'asset-target', 'Continuity control.'),
    slot('style', 'Style', 'style-signal', 'Plot style.'),
    slot('constraint', 'Constraint', 'hard-constraint', 'Plot constraints.'),
  ], [
    slot('plot', 'Plot', 'asset-target', 'Plot arc resource.'),
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
    slot('world', 'World', 'asset-target', 'World card resource.'),
    slot('plot', 'Plot', 'asset-target', 'Plot arc resource.'),
    slot('style', 'Style', 'style-signal', 'Scene style.'),
    slot('constraint', 'Constraint', 'hard-constraint', 'Scene constraints.'),
  ], [
    slot('scene', 'Scene', 'asset-target', 'Scene resource.'),
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
    slot('target', 'Target', 'asset-target', 'Target being shaped by this taste profile.'),
  ], [
    slot('style', 'Style', 'style-signal', 'Weighted style signal.'),
  ], [
    param('preset', 'Preset', 'select', 'custom', undefined, undefined, undefined, PROSE_STYLE_PRESET_OPTIONS),
    param('intensity', 'Intensity', 'number', 0.68, 0, 1, 0.01),
    param('stylePrompt', 'Style Prompt', 'textarea', ''),
  ], 'rule'),
  createDefinition('constraint', 'Hard Constraint', ['约束', 'boundary', 'must not'], 'Constraints', 'safety', 'Sets hard and soft boundaries that limit connected target generation and repair.', [
    slot('target', 'Target', 'asset-target', 'Target constrained by these boundaries.'),
  ], [
    slot('constraint', 'Constraint', 'hard-constraint', 'Constraint signal.'),
  ], [
    param('mustHave', 'Must Have', 'string-list', []),
    param('mustNot', 'Must Not', 'string-list', []),
    param('hardBoundary', 'Hard Boundary', 'boolean', true),
  ], 'rule'),
  createDefinition('image-generation-control', 'Image Generation Control', ['图片控制', 'image control', 'visual control'], 'Controls', 'asset', 'Controls batch count, lightweight visual style, shot, aspect ratio, consistency, and seed behavior for a connected image target.', [], [
    slot('imageControl', 'Image Control', 'asset-target', 'Image generation control.'),
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
    param('seedMode', 'Seed Mode', 'select', 'lock-character', undefined, undefined, undefined, [
      { label: 'Lock Character', value: 'lock-character' },
      { label: 'Vary Slightly', value: 'vary-slightly' },
      { label: 'Explore', value: 'explore' },
    ]),
  ], 'image'),
  createDefinition('field-generation-control', 'Field Generation Control', ['字段控制', 'field control', 'local control'], 'Controls', 'agent', 'Controls how a connected field target is generated without containing final field content.', [
    slot('fieldTarget', 'Field Target', 'asset-target', 'Field target resource.'),
  ], [
    slot('fieldControl', 'Field Control', 'asset-target', 'Field generation control.'),
  ], [
    param('fieldPurpose', 'Field Purpose', 'textarea', ''),
    param('tone', 'Tone', 'select', 'neutral', undefined, undefined, undefined, [
      { label: 'Neutral', value: 'neutral' },
      { label: 'Warm', value: 'warm' },
      { label: 'Restrained', value: 'restrained' },
      { label: 'Sharp', value: 'sharp' },
      { label: 'Dramatic', value: 'dramatic' },
    ]),
    param('lengthPolicy', 'Length Policy', 'select', 'medium', undefined, undefined, undefined, [
      { label: 'Short', value: 'short' },
      { label: 'Medium', value: 'medium' },
      { label: 'Long', value: 'long' },
    ]),
    param('avoidPatterns', 'Avoid Patterns', 'multi-select', [], undefined, undefined, undefined, [
      { label: 'Self Introduction', value: 'self-introduction' },
      { label: 'Lore Dump', value: 'lore-dump' },
      { label: 'Asking User Intent', value: 'asking-user-intent' },
      { label: 'OOC Explanation', value: 'ooc-explanation' },
      { label: 'Instant Compliance', value: 'instant-compliance' },
    ]),
  ], 'rule'),
  createDefinition('continuity-control', 'Continuity Control', ['连续性', 'memory', 'continuity'], 'Controls', 'agent', 'Controls long-form continuity, memory anchors, unresolved hooks, and progression pacing.', [
    slot('target', 'Target', 'asset-target', 'Target resource.'),
  ], [
    slot('continuity', 'Continuity', 'asset-target', 'Continuity control.'),
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
    slot('target', 'Target', 'asset-target', 'Target resource.'),
  ], [
    slot('relationship', 'Relationship', 'asset-target', 'Relationship control.'),
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
  ], 'text-card'),
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
    param('revisionBudget', 'Revision Budget', 'integer', 4, 1, 12, 1),
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
  { id: 'generation-goal', type: 'goal', title: 'Generation Goal', x: 80, y: 150, status: 'dirty' },
  { id: 'character-card-target', type: 'character-card-target', title: 'Character Card Target', x: 390, y: 134 },
  { id: 'opening-field-target', type: 'character-field-target', title: 'Opening Field Target', x: 730, y: 20 },
  { id: 'opening-field-control', type: 'field-generation-control', title: 'Opening Field Control', x: 730, y: 226 },
  { id: 'avatar-image-target', type: 'image-target', title: 'Avatar Image Target', x: 730, y: 400, status: 'queued' },
  { id: 'avatar-image-control', type: 'image-generation-control', title: 'Avatar Image Control', x: 1060, y: 360 },
  { id: 'overview-sheet-image-target', type: 'image-target', title: 'Overview Sheet Image Target', x: 730, y: 600, status: 'queued' },
  { id: 'overview-sheet-image-control', type: 'image-generation-control', title: 'Overview Sheet Image Control', x: 1060, y: 580 },
  { id: 'opening-layout-target', type: 'opening-layout-target', title: 'Opening Layout Target', x: 1060, y: 638 },
  { id: 'style-pressure', type: 'style-pressure', title: 'Style Pressure', x: 390, y: -86 },
  { id: 'hard-constraints', type: 'constraint', title: 'Hard Constraints', x: 390, y: 370 },
  { id: 'source-material', type: 'source-material', title: 'Source Material', x: 80, y: 412 },
  { id: 'llm-capability', type: 'llm-tool', title: 'LLM Tool', x: 1060, y: 16 },
  { id: 'image-capability', type: 'image-tool', title: 'Image Tool', x: 1060, y: 224 },
  { id: 'agent-policy', type: 'agent-policy', title: 'Agent Policy', x: 1398, y: 70 },
  { id: 'generation-strategy', type: 'generation-strategy', title: 'Generation Strategy', x: 1736, y: 70 },
  { id: 'critique-loop', type: 'critique-loop', title: 'Critique Loop', x: 1736, y: 360 },
  { id: 'quality-gate', type: 'quality-gate', title: 'Quality Gate', x: 2074, y: 206, status: 'stale' },
  { id: 'output-adapter', type: 'output-adapter', title: 'Output Adapter', x: 2412, y: 206 },
]

const DEFAULT_LINKS: CharacterResourceLink[] = [
  link('generation-goal', 'goal', 'character-card-target', 'goal', 'guides'),
  link('character-card-target', 'target', 'style-pressure', 'target', 'weights'),
  link('character-card-target', 'target', 'hard-constraints', 'target', 'constrains'),
  link('source-material', 'source', 'character-card-target', 'source', 'grounds'),
  link('character-card-target', 'target', 'opening-field-target', 'card', 'guides'),
  link('opening-field-target', 'field', 'opening-field-control', 'fieldTarget', 'guides'),
  link('opening-field-control', 'fieldControl', 'opening-field-target', 'fieldControl', 'guides'),
  link('style-pressure', 'style', 'opening-field-target', 'style', 'weights'),
  link('hard-constraints', 'constraint', 'opening-field-target', 'constraint', 'constrains'),
  link('character-card-target', 'target', 'avatar-image-target', 'card', 'guides'),
  link('image-capability', 'image', 'avatar-image-target', 'image', 'enables'),
  link('avatar-image-control', 'imageControl', 'avatar-image-target', 'imageControl', 'guides'),
  link('character-card-target', 'target', 'overview-sheet-image-target', 'card', 'guides'),
  link('avatar-image-target', 'imageAsset', 'overview-sheet-image-target', 'referenceImage', 'provides'),
  link('image-capability', 'image', 'overview-sheet-image-target', 'image', 'enables'),
  link('overview-sheet-image-control', 'imageControl', 'overview-sheet-image-target', 'imageControl', 'guides'),
  link('character-card-target', 'target', 'opening-layout-target', 'card', 'guides'),
  link('opening-field-target', 'field', 'opening-layout-target', 'field', 'guides'),
  link('avatar-image-target', 'imageAsset', 'opening-layout-target', 'imageAsset', 'guides'),
  link('overview-sheet-image-target', 'imageAsset', 'opening-layout-target', 'imageAsset', 'guides'),
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
      return {
        id: node.id,
        type: node.type,
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
        config: node.config,
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
      { id: 'intent-targets', title: ui(options, '目标资源', 'Target Resources'), nodeIds: ['generation-goal', 'character-card-target', 'opening-field-target', 'avatar-image-target', 'overview-sheet-image-target', 'opening-layout-target', 'source-material'], color: 'rgba(82, 168, 255, 0.16)' },
      { id: 'local-controls', title: ui(options, '局部控制', 'Local Controls'), nodeIds: ['style-pressure', 'hard-constraints', 'opening-field-control', 'avatar-image-control', 'overview-sheet-image-control'], color: 'rgba(162, 202, 188, 0.16)' },
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

function animateRunDraftCanvas(root: HTMLElement, cleanups: Array<() => void>): void {
  const runViewport = root.querySelector<HTMLElement>('.chat-resource-run-viewport')
  if (!runViewport) {
    return
  }
  const snapshot = captureWorkflowMotionSnapshot(runViewport)
  const previous = runDraftMotionSnapshots.get(root)
  runDraftMotionSnapshots.set(root, snapshot)
  runViewport.dataset.runDraftInitialized = 'true'
  if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    let reverted = false
    import('gsap').then(({ gsap }) => {
      if (reverted || !runViewport.isConnected) {
        return
      }
      const ctx = gsap.context(() => {
        const nodes = gsap.utils.toArray<HTMLElement>('.chat-resource-node')
        const links = gsap.utils.toArray<SVGPathElement>('.chat-resource-link')
          .flatMap((link) => gsap.utils.toArray<SVGPathElement>('path:not(.hit-area)', link))
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
        const newLinks = links.filter((link) => !previous?.links.has(link.closest<SVGElement>('.chat-resource-link')?.getAttribute('data-chat-resource-link-id') ?? ''))
        gsap.killTweensOf([...nodes, ...links])
        if (!previous) {
          const timeline = gsap.timeline({ defaults: { ease: 'power3.out' } })
          timeline.from(nodes, {
            autoAlpha: 0,
            y: 14,
            scale: 0.965,
            duration: 0.34,
            stagger: { each: 0.035, from: 'start' },
            clearProps: 'visibility,opacity,transform',
          })
          timeline.from(links, {
            autoAlpha: 0,
            strokeDasharray: 18,
            strokeDashoffset: 44,
            duration: 0.42,
            stagger: 0.018,
            clearProps: 'visibility,opacity,strokeDasharray,strokeDashoffset',
          }, '<0.08')
          return
        }
        if (movedNodes.length) {
          gsap.fromTo(movedNodes.map((item) => item.node), {
            x: (index) => movedNodes[index]?.dx ?? 0,
            y: (index) => movedNodes[index]?.dy ?? 0,
            scale: 0.992,
          }, {
            x: 0,
            y: 0,
            scale: 1,
            duration: 0.58,
            ease: 'expo.out',
            clearProps: 'transform',
          })
        }
        if (newNodes.length) {
          const sourceNode = runViewport.querySelector<HTMLElement>('[data-chat-workflow-node-id="run-agent-source"]')
          const sourceRect = sourceNode?.getBoundingClientRect()
          const timeline = gsap.timeline({ defaults: { ease: 'power3.out' } })
          timeline.fromTo(newNodes, {
            autoAlpha: 0,
            x: (_index, target) => {
              if (!sourceRect || !(target instanceof HTMLElement)) return -34
              const rect = target.getBoundingClientRect()
              return sourceRect.left + sourceRect.width * 0.68 - (rect.left + rect.width * 0.16)
            },
            y: (_index, target) => {
              if (!sourceRect || !(target instanceof HTMLElement)) return -10
              const rect = target.getBoundingClientRect()
              return sourceRect.top + sourceRect.height * 0.56 - (rect.top + rect.height * 0.34)
            },
            scaleX: 0.12,
            scaleY: 0.48,
            filter: 'brightness(1.36) saturate(1.18)',
            transformOrigin: '12% 42%',
          }, {
            autoAlpha: 1,
            x: 0,
            y: 0,
            scaleX: 1,
            scaleY: 1,
            filter: 'brightness(1) saturate(1)',
            duration: 0.68,
            stagger: { each: 0.095, from: 'start' },
            ease: 'expo.out',
            clearProps: 'visibility,opacity,transform,filter,transformOrigin',
          })
          const revealText = newNodes.flatMap((node) => Array.from(node.querySelectorAll<HTMLElement>('.chat-resource-node-content strong, .chat-resource-node-content p')))
          timeline.from(revealText, {
            autoAlpha: 0,
            y: 7,
            duration: 0.32,
            stagger: 0.024,
            clearProps: 'visibility,opacity,transform',
          }, '<0.22')
        }
        if (newLinks.length) {
          gsap.fromTo(newLinks, {
            autoAlpha: 0,
            strokeDasharray: 24,
            strokeDashoffset: 58,
          }, {
            autoAlpha: 1,
            strokeDashoffset: 0,
            duration: 0.72,
            stagger: 0.04,
            ease: 'power2.out',
            clearProps: 'visibility,opacity,strokeDasharray,strokeDashoffset',
          })
        }
      }, runViewport)
      cleanups.push(() => ctx.revert())
    })
    cleanups.push(() => {
      reverted = true
    })
  }
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
      <button class="chat-workflow-run-toggle ${running ? 'is-running' : ''}" type="button" data-chat-workflow-action="${running ? 'stop' : 'run'}" aria-label="${options.escapeHtml(runLabel)}" title="${options.escapeHtml(runLabel)}"><i icon-name="${running ? 'square' : 'play'}" aria-hidden="true"></i></button>
      <button type="button" data-chat-workflow-action="fit-view" title="${options.escapeHtml(fitLabel)}" aria-label="${options.escapeHtml(fitLabel)}"><i icon-name="maximize" aria-hidden="true"></i></button>
      <button type="button" data-chat-workflow-action="reset-view" title="${options.escapeHtml(resetLabel)}" aria-label="${options.escapeHtml(resetLabel)}"><i icon-name="rotate-ccw" aria-hidden="true"></i></button>
      ${renderInspectorToggle(options)}
    </div>
  `
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
  return `
    <div class="chat-workflow-canvas-viewport active chat-resource-run-viewport run-status-${options.escapeHtml(status)}" data-resource-viewport="${options.escapeHtml(JSON.stringify(runGraph.viewport))}" aria-label="${options.escapeHtml(ui(options, '角色卡运行草稿', 'Character card run draft'))}">
      ${renderRunProgressOverlay(options)}
      <div class="chat-workflow-canvas-plane chat-resource-graph-plane chat-resource-run-plane" style="--resource-zoom: ${runGraph.viewport.zoom}; --resource-pan-x: ${runGraph.viewport.x}px; --resource-pan-y: ${runGraph.viewport.y}px">
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
        <section class="chat-run-character-fields">
          ${rows.map((row) => `
            <article>
              <span>${options.escapeHtml(row.label)}</span>
              <p>${options.escapeHtml(row.value)}</p>
            </article>
          `).join('')}
        </section>
        ${images.length ? `
          <section class="chat-run-character-carousel" aria-label="${options.escapeHtml(ui(options, '角色图片', 'Character images'))}">
            ${images.map((item, index) => `
              <figure>
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
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = []
  const push = (label: string, value: string | undefined) => {
    const normalized = normalizeRunCharacterFieldValue(value)
    if (normalized && !rows.some((row) => row.label === label && row.value === normalized)) {
      rows.push({ label, value: normalized })
    }
  }
  const roleCard = artifacts.find((artifact) => artifact.type === 'character-card-final')
    ?? [...artifacts].reverse().find((artifact) => artifact.type === 'character-card-draft')
  if (roleCard) {
    const record = getRoleCardVisibleFields(roleCard.data)
    for (const [key, value] of Object.entries(record)) {
      push(formatRunCharacterFieldLabel(key, options), formatRunCharacterFieldValue(value))
    }
  }
  for (const artifact of artifacts) {
    if (artifact.type === 'character-card-final' || artifact.type === 'character-card-draft' || artifact.type === 'image-asset') {
      continue
    }
    const mapped = getCharacterFacingArtifactField(artifact)
    if (mapped) {
      push(formatRunCharacterFieldLabel(mapped.key, options), mapped.value)
    }
  }
  if (!rows.length) {
    push(ui(options, '状态', 'Status'), options.runState?.run?.status === 'running'
      ? ui(options, '角色资源生成中', 'Character resources are being generated')
      : ui(options, '暂无角色资源', 'No character resources yet'))
  }
  return rows
    .filter((row) => ![ui(options, '示例对话', 'Example Dialogue'), ui(options, '场景上下文', 'Scene Context')].includes(row.label))
    .slice(0, 7)
    .map((row) => ({ ...row, value: clampRunCharacterPreviewText(row.value, 220) }))
}

function getRunCharacterTitle(rows: Array<{ label: string; value: string }>, options: CharacterWorkflowPageOptions): string {
  const nameLabel = ui(options, '名称', 'Name')
  return rows.find((row) => row.label === nameLabel)?.value
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

function createRunDraftCanvasGraph(graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions): CharacterResourceGraph {
  const artifacts = getRunCanvasArtifacts(options.runState?.artifacts ?? [])
  const status = options.runState?.run?.status ?? 'idle'
  const sourceNodeId = 'run-agent-source'
  const nodes: CharacterResourceNode[] = [{
    id: sourceNodeId,
    type: 'agent-policy',
    title: ui(options, 'Agent 运行', 'Agent Run'),
    position: options.positionOverrides?.[sourceNodeId] ?? { x: 72, y: 112 },
    size: { width: 210, height: 126 },
    status: status === 'failed' || status === 'needs_action' ? 'failed' : status === 'done' ? 'done' : status === 'running' ? 'running' : 'idle',
    zIndex: 1,
    config: {},
  }]
  const outputs: CharacterResourceOutput[] = [{
    id: 'run-agent-source-output',
    nodeId: 'run-agent-source',
    type: 'agent-run',
    title: ui(options, '自主生成角色卡', 'Autonomous character generation'),
    summary: status === 'running'
      ? ui(options, 'Agent 正在把配置转化为角色字段和资源。', 'The agent is turning config into character fields and assets.')
      : ui(options, '运行后这里会串联新增字段、资源和图片。', 'New fields, resources, and images will be chained here after running.'),
    status: nodes[0].status,
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
  compactArtifacts.forEach((artifact, index) => {
    const nodeId = `run-artifact-${sanitizeResourceId(artifact.id || artifact.type || String(index))}`
    const nodeType = getRunArtifactNodeType(artifact.type)
    const placement = getRunArtifactPlacement(artifact, index)
    const image = getArtifactImage(artifact.data)
    const artifactStatus = getRunArtifactNodeStatus(artifact)
    nodes.push({
      id: nodeId,
      type: nodeType,
      title: getRunArtifactNodeTitle(artifact, options),
      position: options.positionOverrides?.[nodeId] ?? {
        x: placement.x,
        y: placement.y,
      },
      size: image ? { width: 226, height: 178 } : { width: 238, height: 134 },
      status: artifactStatus,
      zIndex: index + 2,
      config: getRunArtifactNodeConfig(artifact),
    })
    outputs.push({
      id: `${nodeId}-output`,
      nodeId,
      artifactId: artifact.id,
      sourceNodeId: artifact.sourceNodeId,
      type: artifact.type,
      title: artifact.title ?? artifact.type,
      summary: artifact.summary || getArtifactText(artifact.data) || getRunArtifactMeta(artifact, options),
      status: artifactStatus,
      image,
      text: getArtifactText(artifact.data),
      data: artifact.data,
    })
    links.push(createRunResourceLink('run-agent-source', nodeId, getRunExecutionLabel(artifact.type, options), index))
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
      zoom: options.viewState?.zoom ?? 0.94,
    },
    selection: { nodeIds: [selectedNodeId], linkIds: [] },
    outputs,
  }
}

function resolveRunDraftSelectedNodeId(
  nodes: CharacterResourceNode[],
  artifacts: NonNullable<CharacterResourceRunState['artifacts']>,
  options: CharacterWorkflowPageOptions
): string {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const selected = options.viewState?.selectedNodeIds?.find((nodeId) => nodeIds.has(nodeId))
  if (selected) {
    return selected
  }
  const latestImageArtifact = [...artifacts].reverse().find((artifact) => artifact.type === 'image-asset')
  if (latestImageArtifact?.id) {
    const imageNodeId = `run-artifact-${sanitizeResourceId(latestImageArtifact.id)}`
    if (nodeIds.has(imageNodeId)) {
      return imageNodeId
    }
  }
  return nodes[nodes.length - 1]?.id ?? 'run-agent-source'
}

function getRunArtifactPlacement(artifact: NonNullable<CharacterResourceRunState['artifacts']>[number], index: number): { x: number; y: number } {
  if (artifact.type === 'character-card-field') {
    const data = artifact.data && typeof artifact.data === 'object' && !Array.isArray(artifact.data)
      ? artifact.data as Record<string, unknown>
      : {}
    const field = typeof data.field === 'string' ? data.field : ''
    const order = ['name', 'description', 'appearance', 'personality', 'background', 'scenario', 'worldContext', 'firstMessage', 'dialogueStyle']
    const fieldIndex = Math.max(0, order.indexOf(field))
    const lane = fieldIndex % 3
    const row = Math.floor(fieldIndex / 3)
    const jitter = getStableRunOffset(field || artifact.id || String(index), 22, 18)
    return { x: 344 + lane * 286 + jitter.x, y: 50 + row * 158 + jitter.y }
  }
  if (artifact.type === 'opening-message' || artifact.type === 'dialogue-style-guide' || artifact.type === 'world-context' || artifact.type === 'scene-context') {
    const order = ['world-context', 'scene-context', 'opening-message', 'dialogue-style-guide']
    const row = Math.max(0, order.indexOf(artifact.type))
    const jitter = getStableRunOffset(artifact.type, 24, 16)
    return { x: 640 + jitter.x, y: 568 + row * 142 + jitter.y }
  }
  if (artifact.type === 'image-asset' || artifact.type === 'image-attempt' || artifact.type === 'stale-marker') {
    const targetKey = getRunArtifactTargetNodeId(artifact) || artifact.sourceNodeId || artifact.id || String(index)
    const imageIndex = Math.max(0, getStableRunLaneIndex(targetKey, 4))
    const lane = artifact.type === 'image-asset' ? 0 : artifact.type === 'image-attempt' ? 1 : 2
    const jitter = getStableRunOffset(`${artifact.type}:${targetKey}`, 28, 24)
    return { x: 1060 + lane * 256 + jitter.x, y: 72 + imageIndex * 190 + jitter.y }
  }
  if (artifact.type === 'quality-report' || artifact.type === 'generation-report' || artifact.type === 'export-package' || artifact.type === 'candidate-pack') {
    const reportIndex = getStableRunLaneIndex(artifact.id || artifact.type || String(index), 5)
    const jitter = getStableRunOffset(artifact.id || artifact.type || String(index), 20, 18)
    return { x: 1570 + jitter.x, y: 82 + reportIndex * 148 + jitter.y }
  }
  const stableIndex = getStableRunLaneIndex(artifact.id || artifact.type || String(index), 6)
  const jitter = getStableRunOffset(artifact.id || artifact.type || String(index), 30, 20)
  return {
    x: 700 + (stableIndex % 2) * 288 + jitter.x,
    y: 78 + Math.floor(stableIndex / 2) * 162 + jitter.y,
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

function getRunArtifactNodeTitle(artifact: NonNullable<CharacterResourceRunState['artifacts']>[number], options: CharacterWorkflowPageOptions): string {
  if (artifact.type === 'character-card-field') {
    return getCharacterFieldArtifactLabel(artifact, options)
  }
  if (artifact.type === 'character-card-draft') {
    return ui(options, '字段草稿', 'Field Draft')
  }
  return artifact.title ?? getRunArtifactMeta(artifact, options)
}

function getRunArtifactNodeConfig(artifact: NonNullable<CharacterResourceRunState['artifacts']>[number]): Record<string, unknown> {
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

function getRunArtifactNodeStatus(artifact: NonNullable<CharacterResourceRunState['artifacts']>[number]): CharacterResourceNodeStatus {
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

function getRunArtifactDataRecord(artifact: NonNullable<CharacterResourceRunState['artifacts']>[number]): Record<string, unknown> {
  return artifact.data && typeof artifact.data === 'object' && !Array.isArray(artifact.data)
    ? artifact.data as Record<string, unknown>
    : {}
}

function getRunArtifactTargetNodeId(artifact: NonNullable<CharacterResourceRunState['artifacts']>[number]): string {
  const data = getRunArtifactDataRecord(artifact)
  return typeof data.targetNodeId === 'string'
    ? data.targetNodeId
    : typeof data.staleTargetNodeId === 'string'
      ? data.staleTargetNodeId
      : artifact.sourceNodeId
}

function getCharacterFieldArtifactLabel(artifact: NonNullable<CharacterResourceRunState['artifacts']>[number], options: CharacterWorkflowPageOptions): string {
  const data = artifact.data && typeof artifact.data === 'object' && !Array.isArray(artifact.data)
    ? artifact.data as Record<string, unknown>
    : {}
  const field = typeof data.field === 'string' ? data.field : ''
  return field ? formatRunCharacterFieldLabel(field, options) : artifact.title ?? getRunArtifactMeta(artifact, options)
}

function getRunCanvasArtifacts(artifacts: NonNullable<CharacterResourceRunState['artifacts']>): NonNullable<CharacterResourceRunState['artifacts']> {
  const filtered = getRoleResourceArtifacts(artifacts)
    .filter((artifact) => artifact.type !== 'character-card-draft')
    .filter((artifact) => !isHiddenRunCanvasFieldArtifact(artifact))
  return filtered.some((artifact) => artifact.type === 'character-card-field')
    ? filtered.filter((artifact) => artifact.type !== 'character-card-final')
    : filtered
}

function isHiddenRunCanvasFieldArtifact(artifact: NonNullable<CharacterResourceRunState['artifacts']>[number]): boolean {
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
    'character-card-field',
    'character-card-final',
    'opening-message',
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
    'character-card-field',
    'character-card-final',
    'opening-message',
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
    'character-card-field': ui(options, '角色字段 / field', 'character field / resource'),
    'character-card-final': ui(options, '角色卡 / role-card', 'role card / resource'),
    'opening-message': ui(options, '开场 / opening', 'opening / resource'),
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
    'character-card-field': 'character-field-resource',
    'character-card-draft': 'role-card-resource',
    'character-card-final': 'role-card-resource',
    'opening-message': 'opening-resource',
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
      <button class="chat-workflow-run-toggle ${running ? 'is-running' : ''}" type="button" data-chat-workflow-action="${running ? 'stop' : 'run'}" aria-label="${options.escapeHtml(runLabel)}" title="${options.escapeHtml(runLabel)}"><i icon-name="${running ? 'square' : 'play'}" aria-hidden="true"></i></button>
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
  const width = Math.max(980, ...graph.nodes.map((node) => node.position.x + node.size.width + 120))
  const height = Math.max(620, ...graph.nodes.map((node) => node.position.y + node.size.height + 120))
  return `
    <svg class="chat-resource-link-overlay" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
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
  const highlighted = options.viewState?.agentHighlights?.linkIds?.includes(linkItem.id) ?? false
  const actionLabel = options.viewState?.agentHighlights?.linkActions?.[linkItem.id] ?? ''
  return `
    <g class="chat-resource-link ${options.escapeHtml(linkItem.kind)} ${options.escapeHtml(linkItem.status)} ${flowing ? 'flowing' : ''} ${collapsedNodeLinkReroute ? 'collapsed-node-link reroute-link' : ''} ${highlighted ? 'agent-highlight-link' : ''} ${graph.selection.linkIds.includes(linkItem.id) ? 'selected' : ''}" data-chat-resource-link-id="${options.escapeHtml(linkItem.id)}" data-chat-workflow-link-select="${options.escapeHtml(linkItem.id)}" data-agent-op-label="${options.escapeHtml(actionLabel)}">
      <path d="${path}" marker-end="url(#chat-resource-arrow)"></path>
      <path class="hit-area" d="${path}"></path>
      <text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 7}">${options.escapeHtml(actionLabel || linkItem.label || LINK_KIND_LABELS[linkItem.kind])}</text>
    </g>
  `
}

function renderResourceNode(node: CharacterResourceNode, graph: CharacterResourceGraph, options: CharacterWorkflowPageOptions): string {
  const definition = getDefinition(node.type)
  const selected = graph.selection.nodeIds.includes(node.id)
  const output = graph.outputs.find((item) => item.nodeId === node.id)
  const runField = typeof node.config.runField === 'string' ? node.config.runField : ''
  const runFieldClass = runField ? `run-field-${sanitizeResourceId(runField)} ${node.config.runFieldSupport ? 'run-field-support' : 'run-field-card'}` : ''
  const highlighted = options.viewState?.agentHighlights?.nodeIds?.includes(node.id) ?? false
  const actionLabel = options.viewState?.agentHighlights?.nodeActions?.[node.id] ?? ''
  return `
    <article class="chat-workflow-node chat-resource-node ${node.status} ${node.type} ${definition.category} ${runFieldClass} ${highlighted ? 'agent-highlight-node' : ''} ${selected ? 'selected' : ''} ${node.collapsed ? 'collapsed' : ''}" style="--node-x: ${node.position.x}px; --node-y: ${node.position.y}px; --node-w: ${node.size.width}px; --node-h: ${node.size.height}px; z-index: ${node.zIndex}" data-chat-workflow-node-id="${options.escapeHtml(node.id)}" data-chat-workflow-node-select="${options.escapeHtml(node.id)}" data-resource-node-type="${options.escapeHtml(node.type)}" data-run-artifact-id="${options.escapeHtml(output?.artifactId ?? '')}" data-run-artifact-type="${options.escapeHtml(output?.type ?? '')}" data-run-target-node-id="${options.escapeHtml(output?.sourceNodeId ?? '')}" data-run-field="${options.escapeHtml(runField)}" data-agent-op-label="${options.escapeHtml(actionLabel)}">
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
      ${slots.map((slotItem) => `
        <span class="chat-workflow-node-port chat-resource-slot ${slotItem.required ? 'required' : ''}" data-resource-slot-node="${options.escapeHtml(node.id)}" data-resource-slot-id="${options.escapeHtml(slotItem.id)}" data-resource-slot-side="${side}" data-resource-slot-type="${options.escapeHtml(slotItem.type)}" title="${options.escapeHtml(slotItem.tooltip)}">
          <i class="chat-resource-slot-dot" aria-hidden="true"></i>
          <b>${options.escapeHtml(localizeSlotLabel(slotItem, options))}</b>
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
          <span>${options.escapeHtml(localizeParameterLabel(parameterItem, options))}</span>
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
  if (!output) {
    return ''
  }
  const previewClass = `preview-${definition.previewType}`
  const runImageActions = renderRunImageActions(output, options)
  if (output?.image) {
    return `
      <div class="chat-resource-node-content ${previewClass} has-image">
        <img src="${options.escapeHtml(output.image)}" alt="${options.escapeHtml(output.title)}">
        <strong>${options.escapeHtml(output.title)}</strong>
        <p>${options.escapeHtml(output.summary || output.text || definition.description)}</p>
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
  const accepted = data.accepted !== false && output.type === 'image-asset'
  const canAccept = output.type === 'image-asset'
  const retryLabel = ui(options, '按同一目标重试', 'Retry same target')
  const rerollLabel = ui(options, '追加指令重炼', 'Reroll with instruction')
  const acceptLabel = accepted ? ui(options, '已选中', 'Accepted') : ui(options, '选中这张图', 'Accept this image')
  return `
    <div class="chat-resource-image-actions" data-run-image-actions>
      ${canAccept ? `<button class="${accepted ? 'active' : ''}" type="button" data-chat-workflow-run-image-action="accept" data-run-artifact-id="${options.escapeHtml(artifactId)}" data-run-target-node-id="${options.escapeHtml(targetNodeId)}" data-run-attempt-id="${options.escapeHtml(attemptId)}" aria-label="${options.escapeHtml(acceptLabel)}" title="${options.escapeHtml(acceptLabel)}"><i icon-name="check" aria-hidden="true"></i></button>` : ''}
      <button type="button" data-chat-workflow-run-image-action="retry" data-run-artifact-id="${options.escapeHtml(artifactId)}" data-run-target-node-id="${options.escapeHtml(targetNodeId)}" data-run-attempt-id="${options.escapeHtml(attemptId)}" aria-label="${options.escapeHtml(retryLabel)}" title="${options.escapeHtml(retryLabel)}"><i icon-name="rotate-ccw" aria-hidden="true"></i></button>
      <button type="button" data-chat-workflow-run-image-action="reroll" data-run-artifact-id="${options.escapeHtml(artifactId)}" data-run-target-node-id="${options.escapeHtml(targetNodeId)}" data-run-attempt-id="${options.escapeHtml(attemptId)}" aria-label="${options.escapeHtml(rerollLabel)}" title="${options.escapeHtml(rerollLabel)}"><i icon-name="shuffle" aria-hidden="true"></i></button>
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
            ${definition.inputs.map((slotItem) => `<span><b>IN</b>${options.escapeHtml(localizeSlotLabel(slotItem, options))}<small>${options.escapeHtml(slotItem.type)}</small></span>`).join('') || '<span><b>IN</b>-</span>'}
            ${definition.outputs.map((slotItem) => `<span><b>OUT</b>${options.escapeHtml(localizeSlotLabel(slotItem, options))}<small>${options.escapeHtml(slotItem.type)}</small></span>`).join('')}
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
        <b>${options.escapeHtml(localizeParameterLabel(parameterItem, options))}</b>
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
  const label = localizeParameterLabel(parameterItem, options)
  if (parameterItem.type === 'boolean') {
    return `<input class="chat-workflow-boolean-field" type="checkbox" ${baseAttrs} ${value ? 'checked' : ''} aria-label="${options.escapeHtml(label)}">`
  }
  if (parameterItem.type === 'number' || parameterItem.type === 'integer') {
    return `<input type="number" ${baseAttrs} value="${options.escapeHtml(formatParameterValue(value))}" ${parameterItem.min === undefined ? '' : `min="${parameterItem.min}"`} ${parameterItem.max === undefined ? '' : `max="${parameterItem.max}"`} ${parameterItem.step === undefined ? '' : `step="${parameterItem.step}"`} aria-label="${options.escapeHtml(label)}">`
  }
  if (parameterItem.type === 'model-select') {
    return renderModelSelectField(parameterItem, node, value, options, baseAttrs)
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
      <summary aria-label="${options.escapeHtml(localizeParameterLabel(parameterItem, options))}">
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
  options?: Array<{ label: string; value: string }>,
  modelKind?: CharacterWorkflowModelChoice['kind']
): CharacterResourceParameterDefinition {
  return { id, label, type, defaultValue, min, max, step, options, modelKind }
}

function getParameterDefaultValue(parameterItem: CharacterResourceParameterDefinition, options: CharacterWorkflowPageOptions): unknown {
  if (parameterItem.type === 'model-select') {
    return getModelChoices(parameterItem, options)[0]?.id ?? parameterItem.defaultValue
  }
  return Array.isArray(parameterItem.defaultValue) ? [...parameterItem.defaultValue] : parameterItem.defaultValue
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
