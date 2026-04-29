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

export interface SDKPlugin {
  id: string
  name?: string
  setup?(context: SDKPluginContext): void | Promise<void>
  extendPrompt?(context: PromptHookContext): string | undefined
  transformText?(text: string, context: TextTransformContext): string
  selectExpression?(context: ExpressionHookContext): ExpressionFrame | undefined
}

export interface SDKPluginContext {
  plugins: PluginManager
  pluginDir?: string
  assetsDir?: string
  config?: Record<string, unknown>
  resolveAsset?: (assetPath: string) => string
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
