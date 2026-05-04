/**
 * SDK plugin interfaces and manager.
 *
 * Defines generic hooks for setup, tools, prompt additions, text transforms,
 * task-context injection, expression selection, and admin actions.
 */
import type { Tool } from '@her-text/types'
import type { TaskPlan, TaskRunState, TaskStep } from '../session/task-plan.js'

export type PluginPermission =
  | 'tools.register'
  | 'filesystem.read'
  | 'filesystem.write'
  | 'shell.execute'
  | 'network'
  | 'browser.control'
  | 'desktop.control'
  | 'secrets.read'
  | 'secrets.write'
  | 'memory.read'
  | 'memory.write'
  | 'admin.custom'

export type PluginConfigField =
  | {
      key: string
      label?: string
      description?: string
      type: 'string'
      default?: string
      placeholder?: string
      multiline?: boolean
      rows?: number
    }
  | {
      key: string
      label?: string
      description?: string
      type: 'number'
      default?: number
      min?: number
      max?: number
      step?: number
    }
  | {
      key: string
      label?: string
      description?: string
      type: 'boolean'
      default?: boolean
    }
  | {
      key: string
      label?: string
      description?: string
      type: 'select'
      default?: string
      options: Array<{ label: string; value: string }>
    }

export interface PluginAdminActionSchema {
  id: string
  label: string
  description?: string
  variant?: 'primary' | 'secondary' | 'danger'
  payloadSchema?: Record<string, unknown>
}

export interface PluginAdminSchema {
  title?: string
  description?: string
  actions?: PluginAdminActionSchema[]
}

export interface RuntimePluginManifest {
  id: string
  name?: string
  description?: string
  version?: string
  type?: 'sdk-plugin'
  main?: string
  assets?: string
  enabled?: boolean
  permissions?: PluginPermission[]
  config?: Record<string, unknown>
  configSchema?: PluginConfigField[]
  adminSchema?: PluginAdminSchema
}

export interface PluginRuntimeContext {
  tts?: {
    provider: string
    model?: string
  }
  voiceOutputEnabled?: boolean
}

export interface PromptHookContext {
  runtime: PluginRuntimeContext
  phase: 'reply' | 'task_result'
  detectTask: boolean
  hasTools: boolean
}

export type TextTransformTarget =
  | 'tts_input'
  | 'display'
  | 'memory'
  | 'interrupted_assistant'

export interface TextTransformContext {
  runtime: PluginRuntimeContext
  target: TextTransformTarget
}

export interface ExpressionFrame {
  type: 'expression_show'
  id: string
  emotion: string
  assetPath: string
  durationMs: number
  priority?: number
}

export interface ExpressionHookContext {
  runtime: PluginRuntimeContext
  phase: 'reply' | 'task_result'
  replyText: string
  emotionTag?: string
}

export interface ToolRegistrationContext {
  runtime: PluginRuntimeContext
}

export interface TaskContextResolveContext {
  runtime: PluginRuntimeContext
  userInput: string
  taskDescription: string
  maxItems: number
}

export interface TaskContextInjection {
  id: string
  type: 'skill' | 'policy' | 'memory' | 'browser' | 'mcp' | 'project' | 'custom'
  name: string
  path?: string
  content: string
  reason?: string
  score?: number
}

export interface ConversationTurnHookContext {
  runtime: PluginRuntimeContext
  userInput: string
  timestamp: number
}

export interface TaskLifecycleContext {
  runtime: PluginRuntimeContext
  taskDescription: string
  originalUserInput?: string
}

export interface TaskPlanHookContext extends TaskLifecycleContext {
  plan: TaskPlan
}

export interface TaskStepHookContext extends TaskPlanHookContext {
  step: TaskStep
}

export interface TaskEndHookContext extends TaskLifecycleContext {
  success: boolean
  summary: string
  error?: string
  plan?: TaskPlan
  iterations?: number
  toolCalls?: number
}

export interface TaskRunStateHookContext extends TaskLifecycleContext {
  state: TaskRunState
}

export interface SDKPlugin {
  id: string
  name?: string
  manifest?: RuntimePluginManifest
  permissions?: PluginPermission[]
  setup?(context: SDKPluginContext): void | Promise<void>
  shutdown?(context: SDKPluginContext): void | Promise<void>
  registerTools?(context: ToolRegistrationContext): Tool[] | Promise<Tool[]>
  getAdminState?(): Promise<unknown> | unknown
  handleAdminAction?(action: string, payload?: unknown): Promise<unknown> | unknown
  resolveTaskContext?(context: TaskContextResolveContext): TaskContextInjection[] | Promise<TaskContextInjection[]>
  extendPrompt?(context: PromptHookContext): string | undefined
  transformText?(text: string, context: TextTransformContext): string
  selectExpression?(context: ExpressionHookContext): ExpressionFrame | undefined
  onConversationTurnStart?(context: ConversationTurnHookContext): void | Promise<void>
  onConversationTurnEnd?(context: ConversationTurnHookContext & { assistantText: string }): void | Promise<void>
  onTaskStart?(context: TaskLifecycleContext): void | Promise<void>
  onTaskRunStateChanged?(context: TaskRunStateHookContext): void | Promise<void>
  onTaskPlanUpdated?(context: TaskPlanHookContext): void | Promise<void>
  onTaskStepUpdated?(context: TaskStepHookContext): void | Promise<void>
  onTaskEnd?(context: TaskEndHookContext): void | Promise<void>
}

export interface SDKPluginContext {
  plugins?: PluginManager
  pluginDir?: string
  assetsDir?: string
  dataDir?: string
  config?: Record<string, unknown>
  manifest?: RuntimePluginManifest
  resolveAsset?: (assetPath: string) => string
}

export type SDKPluginFactory = (context: SDKPluginContext) => SDKPlugin | Promise<SDKPlugin>

export function definePlugin(plugin: SDKPlugin): SDKPlugin
export function definePlugin(factory: SDKPluginFactory): SDKPluginFactory
export function definePlugin(value: SDKPlugin | SDKPluginFactory): SDKPlugin | SDKPluginFactory {
  return value
}

export class PluginManager {
  private readonly plugins: SDKPlugin[]
  private readonly contexts = new Map<string, SDKPluginContext>()
  private setupComplete = false

  constructor(plugins: SDKPlugin[] = []) {
    this.plugins = [...plugins]
    for (const plugin of this.plugins) {
      this.contexts.set(plugin.id, {
        manifest: plugin.manifest,
        config: plugin.manifest?.config,
      })
    }
  }

  async setup(): Promise<void> {
    if (this.setupComplete) {
      return
    }

    for (const plugin of this.plugins) {
      await plugin.setup?.(this.getPluginContext(plugin))
    }

    this.setupComplete = true
  }

  async shutdown(context: SDKPluginContext = {}): Promise<void> {
    for (const plugin of [...this.plugins].reverse()) {
      await plugin.shutdown?.({
        ...this.getPluginContext(plugin),
        ...context,
      })
    }
    this.setupComplete = false
  }

  private getPluginContext(plugin: SDKPlugin): SDKPluginContext {
    return {
      ...this.contexts.get(plugin.id),
      plugins: this,
    }
  }

  getPromptAdditions(context: PromptHookContext): string[] {
    const additions: string[] = []

    for (const plugin of this.plugins) {
      const addition = plugin.extendPrompt?.(context)?.trim()
      if (addition) {
        additions.push(addition)
      }
    }

    return additions
  }

  async getTools(context: ToolRegistrationContext = { runtime: {} }): Promise<Tool[]> {
    const tools: Tool[] = []

    for (const plugin of this.plugins) {
      const pluginTools = await plugin.registerTools?.(context)
      if (!pluginTools?.length) {
        continue
      }

      for (const tool of pluginTools) {
        tools.push({
          ...tool,
          pluginId: tool.pluginId || plugin.id,
        })
      }
    }

    return tools
  }

  async resolveTaskContextInjections(context: TaskContextResolveContext): Promise<TaskContextInjection[]> {
    const selected: TaskContextInjection[] = []
    const seen = new Set<string>()

    for (const plugin of this.plugins) {
      const pluginItems = await plugin.resolveTaskContext?.({
        ...context,
        maxItems: Math.max(0, context.maxItems - selected.length),
      })
      if (!pluginItems?.length) {
        continue
      }

      for (const item of pluginItems) {
        const key = `${item.type}:${item.path || item.id || item.name}`
        if (!key || seen.has(key)) {
          continue
        }
        seen.add(key)
        selected.push(item)
        if (selected.length >= context.maxItems) {
          return selected
        }
      }
    }

    return selected
  }

  transformText(text: string, context: TextTransformContext): string {
    return this.plugins.reduce((current, plugin) => {
      return plugin.transformText?.(current, context) ?? current
    }, text)
  }

  selectExpression(context: ExpressionHookContext): ExpressionFrame | undefined {
    for (const plugin of this.plugins) {
      const frame = plugin.selectExpression?.(context)
      if (frame) {
        return frame
      }
    }

    return undefined
  }

  async notifyConversationTurnStart(context: ConversationTurnHookContext): Promise<void> {
    for (const plugin of this.plugins) {
      await this.runPluginHook(plugin, 'onConversationTurnStart', () => plugin.onConversationTurnStart?.(context))
    }
  }

  async notifyConversationTurnEnd(context: ConversationTurnHookContext & { assistantText: string }): Promise<void> {
    for (const plugin of this.plugins) {
      await this.runPluginHook(plugin, 'onConversationTurnEnd', () => plugin.onConversationTurnEnd?.(context))
    }
  }

  async notifyTaskStart(context: TaskLifecycleContext): Promise<void> {
    for (const plugin of this.plugins) {
      await this.runPluginHook(plugin, 'onTaskStart', () => plugin.onTaskStart?.(context))
    }
  }

  async notifyTaskRunStateChanged(context: TaskRunStateHookContext): Promise<void> {
    for (const plugin of this.plugins) {
      await this.runPluginHook(plugin, 'onTaskRunStateChanged', () => plugin.onTaskRunStateChanged?.(context))
    }
  }

  async notifyTaskPlanUpdated(context: TaskPlanHookContext): Promise<void> {
    for (const plugin of this.plugins) {
      await this.runPluginHook(plugin, 'onTaskPlanUpdated', () => plugin.onTaskPlanUpdated?.(context))
    }
  }

  async notifyTaskStepUpdated(context: TaskStepHookContext): Promise<void> {
    for (const plugin of this.plugins) {
      await this.runPluginHook(plugin, 'onTaskStepUpdated', () => plugin.onTaskStepUpdated?.(context))
    }
  }

  async notifyTaskEnd(context: TaskEndHookContext): Promise<void> {
    for (const plugin of this.plugins) {
      await this.runPluginHook(plugin, 'onTaskEnd', () => plugin.onTaskEnd?.(context))
    }
  }

  private async runPluginHook(
    plugin: SDKPlugin,
    hookName: string,
    hook: () => void | Promise<void> | undefined
  ): Promise<void> {
    try {
      await hook()
    } catch (error) {
      console.warn(`[PluginManager] Plugin "${plugin.id}" ${hookName} failed:`, error)
    }
  }
}
