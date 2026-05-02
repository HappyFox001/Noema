import type { Tool } from '@her-text/types'

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

export interface SDKPlugin {
  id: string
  name?: string
  setup?(context: SDKPluginContext): void | Promise<void>
  registerTools?(context: ToolRegistrationContext): Tool[] | Promise<Tool[]>
  getAdminState?(): Promise<unknown> | unknown
  handleAdminAction?(action: string, payload?: unknown): Promise<unknown> | unknown
  resolveTaskContext?(context: TaskContextResolveContext): TaskContextInjection[] | Promise<TaskContextInjection[]>
  extendPrompt?(context: PromptHookContext): string | undefined
  transformText?(text: string, context: TextTransformContext): string
  selectExpression?(context: ExpressionHookContext): ExpressionFrame | undefined
}

export interface SDKPluginContext {
  plugins?: PluginManager
  pluginDir?: string
  assetsDir?: string
  dataDir?: string
  config?: Record<string, unknown>
  resolveAsset?: (assetPath: string) => string
  tools?: {
    createBaseTools?: () => Tool[]
  }
}

export class PluginManager {
  private readonly plugins: SDKPlugin[]
  private setupComplete = false

  constructor(plugins: SDKPlugin[] = []) {
    this.plugins = [...plugins]
  }

  async setup(): Promise<void> {
    if (this.setupComplete) {
      return
    }

    for (const plugin of this.plugins) {
      await plugin.setup?.({ plugins: this })
    }

    this.setupComplete = true
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
}
