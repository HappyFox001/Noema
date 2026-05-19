/**
 * Realtime Work Surface runtime plugin.
 *
 * Registers controlled UI tools only when the experimental desktop setting is
 * enabled at SDK initialization time.
 */
const SCHEMA_VERSION = 1

export default function plugin(ctx) {
  const config = ctx.config || {}
  const maxTableRows = clampInteger(Number(config.maxTableRows ?? 80), 5, 500)
  const maxMarkdownChars = clampInteger(Number(config.maxMarkdownChars ?? 12000), 1000, 50000)

  return {
    id: 'work-surface',
    name: 'Realtime Work Surface',
    registerTools() {
      if (!isEnabled()) {
        return []
      }
      return createWorkSurfaceTools({ maxTableRows, maxMarkdownChars })
    },
    extendPrompt(context) {
      if (!isEnabled() || !context.detectTask) {
        return undefined
      }
      return [
        'Realtime Work Surface rules:',
        '- When a task produces structured state, options, tables, files, or intermediate results, use the UI tools to show them in the work surface.',
        '- Never generate raw HTML, CSS, or JavaScript for the work surface.',
        '- Use markdown for narrative summaries, tables for structured rows, artifacts for files/images, and actions/forms when user input is needed.',
        '- UI tools only display task state. Do not claim a task is complete unless the task runtime facts support it.',
      ].join('\n')
    },
    getToolStrategyHints() {
      if (!isEnabled()) {
        return []
      }
      return [
        {
          id: 'work-surface-ui',
          title: 'Realtime work surface',
          priority: 70,
          content: [
            '- Use ui_create_surface once a task needs an interactive workspace.',
            '- Use ui_show_table for lists, search results, comparisons, and structured tool output.',
            '- Use ui_request_action or ui_request_input instead of asking users to infer the next clickable choice from prose.',
          ].join('\n'),
        },
      ]
    },
  }
}

function createWorkSurfaceTools({ maxTableRows, maxMarkdownChars }) {
  return [
    createTool({
      name: 'ui_create_surface',
      description: 'Create a realtime work surface for the current task. Use before adding UI components.',
      parameters: {
        type: 'object',
        properties: {
          surfaceId: { type: 'string', description: 'Stable surface id. If omitted, a generated id is used.' },
          taskId: { type: 'string', description: 'Optional task id to bind the surface to.' },
          title: { type: 'string', description: 'Surface title.' },
          mode: { type: 'string', enum: ['task', 'analysis', 'browser', 'document', 'custom'], default: 'task' },
        },
        required: ['title'],
      },
      execute: async ({ surfaceId, taskId, title, mode = 'task' }) => {
        const id = normalizeId(surfaceId || `surface-${Date.now()}`)
        return publish({
          schemaVersion: SCHEMA_VERSION,
          type: 'surface.create',
          surfaceId: id,
          taskId,
          title: String(title || 'Work Surface'),
          mode,
          layout: {
            id: 'root',
            kind: 'column',
            children: [],
          },
        })
      },
    }),
    createTool({
      name: 'ui_show_markdown',
      description: 'Add a markdown block to an existing work surface. Markdown is rendered safely as application-owned UI.',
      parameters: {
        type: 'object',
        properties: {
          surfaceId: { type: 'string' },
          componentId: { type: 'string' },
          title: { type: 'string' },
          markdown: { type: 'string' },
        },
        required: ['surfaceId', 'markdown'],
      },
      execute: async ({ surfaceId, componentId, title, markdown }) => publishPatch(surfaceId, {
        op: 'add',
        parentId: 'root',
        component: {
          id: normalizeId(componentId || `markdown-${Date.now()}`),
          kind: 'markdown',
          title,
          markdown: String(markdown || '').slice(0, maxMarkdownChars),
        },
      }),
    }),
    createTool({
      name: 'ui_show_table',
      description: 'Add a selectable data table to an existing work surface.',
      parameters: {
        type: 'object',
        properties: {
          surfaceId: { type: 'string' },
          componentId: { type: 'string' },
          title: { type: 'string' },
          columns: { type: 'array', items: { type: 'object' } },
          rows: { type: 'array', items: { type: 'object' } },
        },
        required: ['surfaceId', 'columns', 'rows'],
      },
      execute: async ({ surfaceId, componentId, title, columns, rows }) => publishPatch(surfaceId, {
        op: 'add',
        parentId: 'root',
        component: {
          id: normalizeId(componentId || `table-${Date.now()}`),
          kind: 'table',
          title,
          columns: Array.isArray(columns) ? columns.slice(0, 24) : [],
          rows: Array.isArray(rows) ? rows.slice(0, maxTableRows) : [],
          selectionMode: 'single',
        },
      }),
    }),
    createTool({
      name: 'ui_show_artifacts',
      description: 'Show files, images, reports, or screenshots as artifact cards in the work surface.',
      parameters: {
        type: 'object',
        properties: {
          surfaceId: { type: 'string' },
          componentId: { type: 'string' },
          title: { type: 'string' },
          artifacts: { type: 'array', items: { type: 'object' } },
        },
        required: ['surfaceId', 'artifacts'],
      },
      execute: async ({ surfaceId, componentId, title, artifacts }) => publishPatch(surfaceId, {
        op: 'add',
        parentId: 'root',
        component: {
          id: normalizeId(componentId || `artifacts-${Date.now()}`),
          kind: 'artifacts',
          title,
          artifacts: Array.isArray(artifacts) ? artifacts.slice(0, 40) : [],
        },
      }),
    }),
    createTool({
      name: 'ui_request_action',
      description: 'Show user actions that can continue, modify, cancel, or confirm task progress.',
      parameters: {
        type: 'object',
        properties: {
          surfaceId: { type: 'string' },
          componentId: { type: 'string' },
          title: { type: 'string' },
          actions: { type: 'array', items: { type: 'object' } },
        },
        required: ['surfaceId', 'actions'],
      },
      execute: async ({ surfaceId, componentId, title, actions }) => publishPatch(surfaceId, {
        op: 'add',
        parentId: 'root',
        component: {
          id: normalizeId(componentId || `actions-${Date.now()}`),
          kind: 'actions',
          title,
          actions: Array.isArray(actions) ? actions.slice(0, 12) : [],
        },
      }),
    }),
    createTool({
      name: 'ui_request_input',
      description: 'Ask the user for structured input inside the work surface.',
      parameters: {
        type: 'object',
        properties: {
          surfaceId: { type: 'string' },
          requestId: { type: 'string' },
          prompt: { type: 'string' },
          input: { type: 'object' },
        },
        required: ['surfaceId', 'requestId', 'prompt', 'input'],
      },
      execute: async ({ surfaceId, requestId, prompt, input }) => publish({
        schemaVersion: SCHEMA_VERSION,
        type: 'surface.request_input',
        surfaceId,
        requestId,
        prompt,
        input,
      }),
    }),
    createTool({
      name: 'ui_update_component',
      description: 'Update properties on an existing work surface component.',
      parameters: {
        type: 'object',
        properties: {
          surfaceId: { type: 'string' },
          targetId: { type: 'string' },
          props: { type: 'object' },
        },
        required: ['surfaceId', 'targetId', 'props'],
      },
      execute: async ({ surfaceId, targetId, props }) => publishPatch(surfaceId, {
        op: 'update',
        targetId,
        props,
      }),
    }),
    createTool({
      name: 'ui_focus',
      description: 'Focus a component or object in the work surface.',
      parameters: {
        type: 'object',
        properties: {
          surfaceId: { type: 'string' },
          targetId: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['surfaceId', 'targetId'],
      },
      execute: async ({ surfaceId, targetId, reason }) => publish({
        schemaVersion: SCHEMA_VERSION,
        type: 'surface.focus',
        surfaceId,
        targetId,
        reason,
      }),
    }),
  ]
}

function createTool(tool) {
  return {
    safety: 'safe',
    timeoutMs: 10000,
    ...tool,
  }
}

function publishPatch(surfaceId, patch) {
  return publish({
    schemaVersion: SCHEMA_VERSION,
    type: 'surface.patch',
    surfaceId,
    patches: [patch],
  })
}

function publish(frame) {
  const publisher = globalThis.__herTextPublishWorkSurfaceFrame
  if (typeof publisher !== 'function') {
    return { success: false, error: 'Work surface host bridge is not available' }
  }
  return publisher({
    ...frame,
    timestamp: Date.now(),
  })
}

function isEnabled() {
  const readEnabled = globalThis.__herTextWorkSurfaceIsEnabled
  return typeof readEnabled === 'function' && readEnabled() === true
}

function normalizeId(value) {
  return String(value || 'component')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || `component-${Date.now()}`
}

function clampInteger(value, min, max) {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.max(min, Math.min(max, Math.round(value)))
}
