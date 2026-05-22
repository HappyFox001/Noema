/**
 * Shared factory for built-in local work tools.
 */
import type { Tool } from './types.js'

export type LocalToolDefinition = {
  name: string
  description: string
  parameters: Tool['parameters']
  safety: NonNullable<Tool['safety']>
  timeoutMs?: number
  execute: (params: Record<string, any>) => Promise<any>
}

export function createTool({ name, description, parameters, safety, timeoutMs, execute }: LocalToolDefinition): Tool {
  return {
    name,
    description,
    parameters,
    safety,
    timeoutMs,
    execute: async (params: any) => {
      try {
        return await execute(params || {})
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}

export function truncateText(text: string, maxChars?: number): string {
  const limit = Number.isFinite(Number(maxChars)) ? Math.max(1000, Number(maxChars)) : 12000
  if (typeof text !== 'string' || text.length <= limit) {
    return text
  }
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} chars]`
}
