import type { Tool } from '../tools/types.js'


export class AgentCore {
  private tools: Map<string, Tool> = new Map()

  registerTool(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      console.warn(`[AgentCore] Replacing registered tool: ${tool.name}`)
    }
    this.tools.set(tool.name, tool)
  }

  unregisterTool(name: string): boolean {
    return this.tools.delete(name)
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  getTools(): Tool[] {
    return Array.from(this.tools.values())
  }

}
