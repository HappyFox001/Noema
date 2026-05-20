/**
 * Tool routing primitives for the next work execution engine.
 */
import type { Tool } from '@her-text/types'

export type RoutedToolKind =
  | 'function'
  | 'shell'
  | 'browser'
  | 'desktop'
  | 'mcp'
  | 'deferred'
  | 'custom'

export interface RoutedToolSpec {
  name: string
  description: string
  kind: RoutedToolKind
  pluginId?: string
  supportsParallel: boolean
  deferLoading?: boolean
  parameters?: unknown
}

export interface WorkToolCall {
  id: string
  name: string
  arguments: string
}

export interface RoutedToolCall extends WorkToolCall {
  spec?: RoutedToolSpec
}

export class ToolRouter {
  private specs = new Map<string, RoutedToolSpec>()

  constructor(tools: Tool[] = []) {
    this.setTools(tools)
  }

  setTools(tools: Tool[]): void {
    this.specs.clear()
    for (const tool of tools) {
      this.specs.set(tool.name, this.normalizeTool(tool))
    }
  }

  listModelVisibleTools(): RoutedToolSpec[] {
    return [...this.specs.values()].filter(spec => !spec.deferLoading)
  }

  listDiscoverableTools(): RoutedToolSpec[] {
    return [...this.specs.values()].filter(spec => spec.deferLoading)
  }

  find(name: string): RoutedToolSpec | undefined {
    return this.specs.get(name)
  }

  route(call: WorkToolCall): RoutedToolCall {
    return {
      ...call,
      spec: this.find(call.name),
    }
  }

  private normalizeTool(tool: Tool): RoutedToolSpec {
    return {
      name: tool.name,
      description: tool.description,
      kind: inferToolKind(tool),
      pluginId: tool.pluginId,
      supportsParallel: tool.safety === 'safe' || tool.safety === 'read',
      deferLoading: tool.deferLoading,
      parameters: tool.parameters,
    }
  }
}

function inferToolKind(tool: Tool): RoutedToolKind {
  if (tool.deferLoading) {
    return 'deferred'
  }
  const pluginId = tool.pluginId || ''
  const name = tool.name.toLowerCase()
  if (name.includes('shell') || name.includes('exec') || name.includes('command')) {
    return 'shell'
  }
  if (pluginId.includes('browser') || name.includes('browser')) {
    return 'browser'
  }
  if (pluginId.includes('computer') || pluginId.includes('desktop') || name.includes('desktop')) {
    return 'desktop'
  }
  if (pluginId.includes('mcp') || name.includes('mcp')) {
    return 'mcp'
  }
  return 'function'
}
