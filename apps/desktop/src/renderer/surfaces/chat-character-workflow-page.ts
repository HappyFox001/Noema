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
  selectedNodeId: string
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
          ${renderWorkflowSidebar(runState, options)}
          ${renderWorkflowCanvas(runState.workflow, options)}
          ${renderWorkflowInspector(runState, options)}
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

function renderWorkflowSidebar(
  state: CharacterWorkflowRunState,
  options: CharacterWorkflowPageOptions
): string {
  const definitionMap = createDefinitionMap()
  const categories = ['input', 'llm', 'image', 'validation', 'export']
  return `
    <aside class="chat-workflow-sidebar" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '工作流工具' : 'Workflow tools')}">
      <section class="chat-workflow-sidebar-section">
        <strong>${options.escapeHtml(options.language === 'zh-CN' ? 'Workflow' : 'Workflow')}</strong>
        <button type="button" data-chat-workflow-panel="workflow">${options.escapeHtml(options.language === 'zh-CN' ? '运行路径' : 'Run Path')}</button>
        <button type="button" data-chat-workflow-panel="assets">${options.escapeHtml(options.language === 'zh-CN' ? '资产' : 'Assets')}</button>
        <button type="button" data-chat-workflow-panel="nodes">${options.escapeHtml(options.language === 'zh-CN' ? '节点库' : 'Nodes')}</button>
      </section>
      <section class="chat-workflow-sidebar-section">
        <strong>${options.escapeHtml(options.language === 'zh-CN' ? 'Nodes' : 'Nodes')}</strong>
        ${categories.map((category) => {
          const count = state.workflow.nodes.filter((node) => definitionMap.get(node.type)?.category === category).length
          return `<button type="button" data-chat-workflow-panel="nodes" data-chat-workflow-node-category="${category}"><span>${options.escapeHtml(category)}</span><em>${count}</em></button>`
        }).join('')}
      </section>
      <section class="chat-workflow-sidebar-section">
        <strong>${options.escapeHtml(options.language === 'zh-CN' ? 'Assets' : 'Assets')}</strong>
        ${renderSidebarArtifactCount(state, 'character-card', options)}
        ${renderSidebarArtifactCount(state, 'image-asset', options)}
        ${renderSidebarArtifactCount(state, 'validation-report', options)}
        ${renderSidebarArtifactCount(state, 'character-pack', options)}
      </section>
    </aside>
  `
}

function renderSidebarArtifactCount(
  state: CharacterWorkflowRunState,
  type: string,
  options: CharacterWorkflowPageOptions
): string {
  const count = state.artifacts.filter((artifact) => artifact.type === type).length
  return `<button type="button" data-chat-workflow-panel="assets" data-chat-workflow-artifact-type="${options.escapeHtml(type)}"><span>${options.escapeHtml(type)}</span><em>${count}</em></button>`
}

function renderWorkflowInspector(
  state: CharacterWorkflowRunState,
  options: CharacterWorkflowPageOptions
): string {
  const definitionMap = createDefinitionMap()
  const selectedNode = state.workflow.nodes.find((node) => node.id === options.selectedNodeId) ?? state.workflow.nodes[0]
  const definition = selectedNode ? definitionMap.get(selectedNode.type) : undefined
  if (!selectedNode || !definition) {
    return `
      <aside class="chat-workflow-inspector">
        <div class="chat-workflow-inspector-empty">${options.escapeHtml(options.language === 'zh-CN' ? '选择一个节点编辑参数。' : 'Select a node to edit parameters.')}</div>
      </aside>
    `
  }
  const producedArtifacts = state.artifacts.filter((artifact) => artifact.sourceNodeId === selectedNode.id)
  return `
    <aside class="chat-workflow-inspector" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '节点参数面板' : 'Node inspector')}">
      <header class="chat-workflow-inspector-head">
        <span>${options.escapeHtml(definition.category)} / ${options.escapeHtml(definition.executor)}</span>
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
        <h4>${options.escapeHtml(options.language === 'zh-CN' ? '输入 / 输出' : 'Inputs / Outputs')}</h4>
        <div class="chat-workflow-inspector-ports">
          ${Object.values(selectedNode.inputs).map((portItem) => `<span><b>IN</b>${options.escapeHtml(portItem.label)}</span>`).join('') || '<span><b>IN</b>-</span>'}
          ${Object.values(selectedNode.outputs).map((portItem) => `<span><b>OUT</b>${options.escapeHtml(portItem.label)}</span>`).join('')}
        </div>
      </section>
      <section class="chat-workflow-inspector-section">
        <h4>${options.escapeHtml(options.language === 'zh-CN' ? 'Agent 路径关联' : 'Agent Path Link')}</h4>
        <div class="chat-workflow-agent-path">
          <span>${options.escapeHtml(definition.executor)}</span>
          <strong>${options.escapeHtml(formatNodeType(selectedNode.type))}</strong>
          <small>${options.escapeHtml(producedArtifacts.length ? `${producedArtifacts.length} artifact(s)` : 'waiting for run output')}</small>
        </div>
      </section>
    </aside>
  `
}

function renderInspectorParameter(
  parameterItem: CharacterWorkflowNodeParameter,
  node: CharacterWorkflowNode,
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

function renderWorkflowNode(
  node: CharacterWorkflowNode,
  definition: CharacterWorkflowNodeDefinition | undefined,
  options: CharacterWorkflowPageOptions
): string {
  const parameters = definition?.parameters ?? []
  return `
    <article class="chat-workflow-node ${node.state?.status ?? 'idle'} ${definition?.category ?? 'unknown'} ${options.selectedNodeId === node.id ? 'selected' : ''}" style="--node-x: ${node.position.x}px; --node-y: ${node.position.y}px" data-chat-workflow-node-id="${options.escapeHtml(node.id)}" data-chat-workflow-node-select="${options.escapeHtml(node.id)}">
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

function formatNodeType(type: string): string {
  return type
    .split('-')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')
}
