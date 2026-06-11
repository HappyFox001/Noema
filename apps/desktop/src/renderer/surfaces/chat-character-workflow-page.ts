/**
 * Renders the Character Workflow chat page shell.
 */
import {
  createStandardCharacterWorkflow,
  createWorkflowRunSession,
  type CharacterWorkflow,
  type WorkflowRunSession,
} from '@noema/sdk/character-workflow'

export interface CharacterWorkflowPageOptions {
  language: 'zh-CN' | 'en-US'
  escapeHtml(value: string): string
}

export function renderCharacterWorkflowPage(options: CharacterWorkflowPageOptions): string {
  const workflow = createStandardCharacterWorkflow({
    id: 'draft-character-workflow',
    name: options.language === 'zh-CN' ? 'Draft 01' : 'Draft 01',
    now: 1,
    language: options.language,
  })
  const run = createWorkflowRunSession(workflow, 1)
  return `
    <div class="chat-character-workflow-shell">
      ${renderFileTabs(workflow, run, options)}
      <div class="chat-character-workflow-stage">
        ${renderRunToolbar(workflow, run, options)}
        <div class="chat-character-workflow-grid">
          ${renderWorkflowCanvas(workflow, options)}
          ${renderWorkflowArtifacts(options)}
        </div>
      </div>
    </div>
  `
}

function renderFileTabs(
  workflow: CharacterWorkflow,
  run: WorkflowRunSession,
  options: CharacterWorkflowPageOptions
): string {
  const previewTitle = options.language === 'zh-CN' ? '角色包预览.character' : 'Character Pack Preview.character'
  return `
    <div class="chat-workflow-file-tabs" role="tablist" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '角色工作流文件' : 'Character workflow files')}">
      ${renderFileTab(`${workflow.name}.workflow`, 'workflow', true, options)}
      ${renderFileTab(run.title, 'run', false, options, 'running')}
      ${renderFileTab(previewTitle, 'character', false, options)}
      <button class="chat-workflow-new-tab" type="button" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '新建运行' : 'New run')}">+</button>
    </div>
  `
}

function renderFileTab(
  title: string,
  kind: 'workflow' | 'run' | 'character',
  active: boolean,
  options: CharacterWorkflowPageOptions,
  state?: 'running' | 'failed' | 'dirty'
): string {
  return `
    <button class="chat-workflow-file-tab ${active ? 'active' : ''} ${state ? `is-${state}` : ''}" type="button" role="tab" aria-selected="${active ? 'true' : 'false'}">
      <span class="chat-workflow-file-icon ${kind}" aria-hidden="true"></span>
      <strong>${options.escapeHtml(title)}</strong>
      ${state ? `<span class="chat-workflow-file-state" aria-hidden="true"></span>` : ''}
      <span class="chat-workflow-file-close" aria-hidden="true">×</span>
    </button>
  `
}

function renderRunToolbar(
  workflow: CharacterWorkflow,
  run: WorkflowRunSession,
  options: CharacterWorkflowPageOptions
): string {
  const done = Math.max(0, Math.round(workflow.nodes.length * 0.46))
  return `
    <header class="chat-workflow-run-toolbar">
      <div>
        <span>${options.escapeHtml(options.language === 'zh-CN' ? 'Character Workflow' : 'Character Workflow')}</span>
        <h3>${options.escapeHtml(run.title)}</h3>
      </div>
      <div class="chat-workflow-run-status">
        <span>${options.escapeHtml(options.language === 'zh-CN' ? '正在生成角色资源' : 'Generating character resources')}</span>
        <strong>${done}/${workflow.nodes.length}</strong>
      </div>
      <div class="chat-workflow-run-actions">
        <button type="button">${options.escapeHtml(options.language === 'zh-CN' ? '停止' : 'Stop')}</button>
        <button type="button">${options.escapeHtml(options.language === 'zh-CN' ? '导出' : 'Export')}</button>
      </div>
    </header>
  `
}

function renderWorkflowCanvas(workflow: CharacterWorkflow, options: CharacterWorkflowPageOptions): string {
  const visibleNodes = workflow.nodes.slice(0, 8)
  return `
    <section class="chat-workflow-canvas" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '工作流执行画布' : 'Workflow run canvas')}">
      <div class="chat-workflow-canvas-grid" aria-hidden="true"></div>
      ${visibleNodes.map((node, index) => `
        <article class="chat-workflow-node ${index < 3 ? 'done' : index === 3 ? 'running' : ''}" style="--node-x: ${node.position.x / 10}px; --node-y: ${node.position.y / 10}px">
          <span>${options.escapeHtml(formatNodeType(node.type))}</span>
          <strong>${options.escapeHtml(node.title)}</strong>
          <small>${options.escapeHtml(Object.keys(node.outputs)[0] || 'artifact')}</small>
        </article>
      `).join('')}
      <div class="chat-workflow-flow-line one" aria-hidden="true"></div>
      <div class="chat-workflow-flow-line two" aria-hidden="true"></div>
      <div class="chat-workflow-flow-line three" aria-hidden="true"></div>
    </section>
  `
}

function renderWorkflowArtifacts(options: CharacterWorkflowPageOptions): string {
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
        <h4>${options.escapeHtml(options.language === 'zh-CN' ? 'Draft 01' : 'Draft 01')}</h4>
        <p>${options.escapeHtml(options.language === 'zh-CN' ? '等待 LLM 节点写入角色身份、人格、对话风格和游戏化状态。' : 'Waiting for LLM nodes to write identity, persona, dialogue style, and game state.')}</p>
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

function formatNodeType(type: string): string {
  return type
    .split('-')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')
}
