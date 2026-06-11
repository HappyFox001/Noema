/**
 * Renders the Character Workflow chat page shell.
 */
import {
  createWorkflowRunState,
  createStandardCharacterWorkflow,
  getStandardCharacterWorkflowNodeDefinitions,
  type CharacterWorkflow,
  type CharacterWorkflowNode,
  type CharacterWorkflowNodeDefinition,
  type CharacterWorkflowNodeParameter,
  type CharacterWorkflowRunState,
  type WorkflowRunSession,
} from '@noema/sdk/character-workflow'

export interface CharacterWorkflowPageOptions {
  language: 'zh-CN' | 'en-US'
  escapeHtml(value: string): string
  configOverrides?: Record<string, Record<string, unknown>>
  positionOverrides?: Record<string, { x: number; y: number }>
  runState?: CharacterWorkflowRunState | null
  tabs: CharacterWorkflowFileTab[]
  activeTabId: string
}

export interface CharacterWorkflowFileTab {
  id: string
  title: string
  kind: 'workflow' | 'run' | 'character'
  state?: 'running' | 'failed' | 'dirty'
}

export function renderCharacterWorkflowPage(options: CharacterWorkflowPageOptions): string {
  const workflow = createStandardCharacterWorkflow({
    id: 'draft-character-workflow',
    name: options.language === 'zh-CN' ? 'Draft 01' : 'Draft 01',
    now: 1,
    language: options.language,
  })
  applyWorkflowConfigOverrides(workflow, options.configOverrides)
  applyWorkflowPositionOverrides(workflow, options.positionOverrides)
  const runState = options.runState ?? createWorkflowRunState(workflow, 1)
  applyWorkflowConfigOverrides(runState.workflow, options.configOverrides)
  applyWorkflowPositionOverrides(runState.workflow, options.positionOverrides)
  return `
    <div class="chat-character-workflow-shell">
      ${renderFileTabs(options)}
      <div class="chat-character-workflow-stage">
        ${renderRunToolbar(runState.workflow, runState.run, options)}
        <div class="chat-character-workflow-grid">
          ${renderWorkflowCanvas(runState.workflow, options)}
          ${renderWorkflowArtifacts(runState, options)}
        </div>
      </div>
    </div>
  `
}

function renderFileTabs(options: CharacterWorkflowPageOptions): string {
  return `
    <div class="chat-workflow-file-tabs" role="tablist" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '角色工作流文件' : 'Character workflow files')}">
      ${options.tabs.map((tab) => renderFileTab(tab, tab.id === options.activeTabId, options)).join('')}
      <button class="chat-workflow-new-tab" type="button" data-chat-workflow-action="new-run" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '新建运行' : 'New run')}">+</button>
    </div>
  `
}

function renderFileTab(
  tab: CharacterWorkflowFileTab,
  active: boolean,
  options: CharacterWorkflowPageOptions
): string {
  return `
    <button class="chat-workflow-file-tab ${active ? 'active' : ''} ${tab.state ? `is-${tab.state}` : ''}" type="button" role="tab" aria-selected="${active ? 'true' : 'false'}" data-chat-workflow-tab="${options.escapeHtml(tab.id)}">
      <span class="chat-workflow-file-icon ${tab.kind}" aria-hidden="true"></span>
      <strong>${options.escapeHtml(tab.title)}</strong>
      ${tab.state ? `<span class="chat-workflow-file-state" aria-hidden="true"></span>` : ''}
      <span class="chat-workflow-file-close" data-chat-workflow-close-tab="${options.escapeHtml(tab.id)}" aria-hidden="true">×</span>
    </button>
  `
}

function renderRunToolbar(
  workflow: CharacterWorkflow,
  run: WorkflowRunSession,
  options: CharacterWorkflowPageOptions
): string {
  const done = run.progress.done
  const statusLabel = run.status === 'idle'
    ? (options.language === 'zh-CN' ? '等待运行' : 'Ready')
    : run.status === 'done'
      ? (options.language === 'zh-CN' ? '角色资源已生成' : 'Character resources generated')
      : (options.language === 'zh-CN' ? '正在生成角色资源' : 'Generating character resources')
  return `
    <header class="chat-workflow-run-toolbar">
      <div>
        <span>${options.escapeHtml(options.language === 'zh-CN' ? 'Character Workflow' : 'Character Workflow')}</span>
        <h3>${options.escapeHtml(run.title)}</h3>
      </div>
      <div class="chat-workflow-run-status">
        <span>${options.escapeHtml(statusLabel)}</span>
        <strong>${done}/${workflow.nodes.length}</strong>
      </div>
      <div class="chat-workflow-run-actions">
        <button type="button" data-chat-workflow-action="run">${options.escapeHtml(options.language === 'zh-CN' ? '运行' : 'Run')}</button>
        <button type="button" data-chat-workflow-action="stop">${options.escapeHtml(options.language === 'zh-CN' ? '停止' : 'Stop')}</button>
        <button type="button" data-chat-workflow-action="export">${options.escapeHtml(options.language === 'zh-CN' ? '导出' : 'Export')}</button>
      </div>
    </header>
  `
}

function renderWorkflowCanvas(workflow: CharacterWorkflow, options: CharacterWorkflowPageOptions): string {
  const definitionMap = createDefinitionMap()
  const visibleNodes = workflow.nodes.slice(0, 11)
  return `
    <section class="chat-workflow-canvas" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '工作流执行画布' : 'Workflow run canvas')}">
      <div class="chat-workflow-canvas-plane">
        <div class="chat-workflow-canvas-grid" aria-hidden="true"></div>
        ${visibleNodes.map((node) => renderWorkflowNode(node, definitionMap.get(node.type), options)).join('')}
        <div class="chat-workflow-flow-line one" aria-hidden="true"></div>
        <div class="chat-workflow-flow-line two" aria-hidden="true"></div>
        <div class="chat-workflow-flow-line three" aria-hidden="true"></div>
      </div>
    </section>
  `
}

function renderWorkflowNode(
  node: CharacterWorkflowNode,
  definition: CharacterWorkflowNodeDefinition | undefined,
  options: CharacterWorkflowPageOptions
): string {
  const parameters = definition?.parameters ?? []
  return `
    <article class="chat-workflow-node ${node.state?.status ?? 'idle'} ${definition?.category ?? 'unknown'}" style="--node-x: ${node.position.x}px; --node-y: ${node.position.y}px" data-chat-workflow-node-id="${options.escapeHtml(node.id)}">
      <header class="chat-workflow-node-head" data-chat-workflow-drag-handle>
        <button type="button" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '折叠节点' : 'Collapse node')}"></button>
        <span>${options.escapeHtml(formatNodeType(node.type))}</span>
        <strong>${options.escapeHtml(node.title)}</strong>
        <em>${options.escapeHtml(definition?.executor ?? 'manual')}</em>
      </header>
      <div class="chat-workflow-node-ports">
        ${renderNodePorts('input', node.inputs, options)}
        ${renderNodePorts('output', node.outputs, options)}
      </div>
      <div class="chat-workflow-node-widgets">
        ${parameters.slice(0, 5).map((parameterItem) => renderNodeParameter(parameterItem, node, node.config[parameterItem.id], options)).join('')}
        ${parameters.length > 5 ? `<small class="chat-workflow-node-more">+${parameters.length - 5}</small>` : ''}
      </div>
    </article>
  `
}

function renderNodePorts(
  side: 'input' | 'output',
  ports: CharacterWorkflowNode['inputs'],
  options: CharacterWorkflowPageOptions
): string {
  const entries = Object.values(ports)
  if (!entries.length) {
    return `<div class="chat-workflow-node-port-list ${side} empty"></div>`
  }
  return `
    <div class="chat-workflow-node-port-list ${side}">
      ${entries.map((portItem) => `
        <span class="chat-workflow-node-port ${portItem.required ? 'required' : ''}">
          <i aria-hidden="true"></i>
          <b>${options.escapeHtml(portItem.label)}</b>
        </span>
      `).join('')}
    </div>
  `
}

function renderNodeParameter(
  parameterItem: CharacterWorkflowNodeParameter,
  node: CharacterWorkflowNode,
  value: unknown,
  options: CharacterWorkflowPageOptions
): string {
  const field = renderParameterField(parameterItem, node, value ?? parameterItem.defaultValue, options)
  return `
    <label class="chat-workflow-node-widget ${parameterItem.type} ${parameterItem.advanced ? 'advanced' : ''}">
      <span>${options.escapeHtml(parameterItem.label)}</span>
      ${field}
    </label>
  `
}

function createDefinitionMap(): Map<string, CharacterWorkflowNodeDefinition> {
  return new Map(getStandardCharacterWorkflowNodeDefinitions().map((definition) => [definition.type, definition]))
}

function renderParameterField(
  parameterItem: CharacterWorkflowNodeParameter,
  node: CharacterWorkflowNode,
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
        ${(parameterItem.options ?? []).map((optionItem) => `
          <option value="${options.escapeHtml(optionItem.value)}" ${String(value) === optionItem.value ? 'selected' : ''}>${options.escapeHtml(optionItem.label)}</option>
        `).join('')}
      </select>
    `
  }
  if (parameterItem.type === 'multi-select' || parameterItem.type === 'string-list') {
    return `<input type="text" ${baseAttrs} value="${options.escapeHtml(formatParameterValue(value))}" aria-label="${options.escapeHtml(parameterItem.label)}">`
  }
  if (parameterItem.type === 'textarea') {
    return `<textarea ${baseAttrs} rows="1" aria-label="${options.escapeHtml(parameterItem.label)}">${options.escapeHtml(formatParameterValue(value))}</textarea>`
  }
  return `<input type="text" ${baseAttrs} value="${options.escapeHtml(formatParameterValue(value))}" aria-label="${options.escapeHtml(parameterItem.label)}">`
}

function applyWorkflowConfigOverrides(
  workflow: CharacterWorkflow,
  overrides: Record<string, Record<string, unknown>> | undefined
): void {
  if (!overrides) {
    return
  }
  for (const node of workflow.nodes) {
    const override = overrides[node.id]
    if (override) {
      node.config = {
        ...node.config,
        ...override,
      }
    }
  }
}

function applyWorkflowPositionOverrides(
  workflow: CharacterWorkflow,
  overrides: Record<string, { x: number; y: number }> | undefined
): void {
  if (!overrides) {
    return
  }
  for (const node of workflow.nodes) {
    const override = overrides[node.id]
    if (override) {
      node.position = { ...override }
    }
  }
}

function formatParameterValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length ? value.join(', ') : '[]'
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (value === undefined || value === null || value === '') {
    return '-'
  }
  return String(value)
}

function renderWorkflowArtifacts(
  state: CharacterWorkflowRunState,
  options: CharacterWorkflowPageOptions
): string {
  const card = state.artifacts.find((artifact) => artifact.type === 'character-card')?.card
  const assets = options.language === 'zh-CN'
    ? [
        ['avatar', '头像照', '角色列表、会话顶部、社区卡片'],
        ['normal', '正常角色图', '标准展示和后续生图主参考'],
        ['sheet', '角色细节设定图', '正面、侧面、鞋袜、服装、配饰细节'],
      ]
    : [
        ['avatar', 'Avatar', 'Character list, chat header, community card'],
        ['normal', 'Normal character art', 'Main display and generation reference'],
        ['sheet', 'Detail reference sheet', 'Front, side, shoes, socks, outfit details'],
      ]
  return `
    <aside class="chat-workflow-artifacts" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '角色资源产物' : 'Character artifacts')}">
      <div class="chat-workflow-artifacts-head">
        <span>${options.escapeHtml(options.language === 'zh-CN' ? 'Character Pack' : 'Character Pack')}</span>
        <strong>${options.escapeHtml(options.language === 'zh-CN' ? '核心图包' : 'Core image pack')}</strong>
      </div>
      <div class="chat-workflow-card-preview">
        <h4>${options.escapeHtml(card?.identity.displayName || 'Draft 01')}</h4>
        <p>${options.escapeHtml(card?.persona.summary || (options.language === 'zh-CN' ? '等待 LLM 节点写入角色身份、人格、对话风格和游戏化状态。' : 'Waiting for LLM nodes to write identity, persona, dialogue style, and game state.'))}</p>
      </div>
      <div class="chat-workflow-asset-list">
        ${assets.map(([kind, title, copy]) => `
          <article class="chat-workflow-asset ${kind}">
            <div aria-hidden="true"></div>
            <span>
              <strong>${options.escapeHtml(title)}</strong>
              <small>${options.escapeHtml(copy)}</small>
            </span>
          </article>
        `).join('')}
      </div>
    </aside>
  `
}

function createPreviewCharacterCard() {
  return {
    schemaVersion: '1.0' as const,
    id: 'draft-01',
    identity: {
      name: 'Draft 01',
      displayName: 'Draft 01',
      role: 'Companion character',
      tags: ['workflow', 'draft'],
    },
    world: {
      genre: 'original',
      setting: 'Noema character workflow draft',
    },
    persona: {
      summary: '一个正在由工作流逐步生成的角色草稿，身份、人设和图包会随着节点执行逐步填充。',
      traits: ['curious'],
      values: ['consistency'],
      flaws: [],
      goals: ['become a complete character pack'],
      boundaries: [],
    },
    dialogue: {
      language: 'zh-CN' as const,
      style: '自然、简洁、角色一致',
      firstMessage: '我还在生成中，等我的设定和图包完成吧。',
      userAddressing: '你',
      examples: [],
    },
    visual: {
      artStyle: 'anime reference sheet',
      appearance: 'pending',
      hair: 'pending',
      eyes: 'pending',
      outfit: 'pending',
      signatureItems: [],
      colorPalette: [],
      negativeTraits: [],
    },
    game: {
      stats: [],
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

function formatNodeType(type: string): string {
  return type
    .split('-')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')
}
