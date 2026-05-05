/**
 * Builds Codex-style deferred tool discovery for task runtime.
 */
import type { Tool } from '@her-text/types'

export interface ToolSearchResult {
  name: string
  pluginId?: string
  description: string
  safety?: Tool['safety']
  score: number
}

export function isDeferredTool(tool: Tool): boolean {
  return tool.deferLoading === true
}

export function searchDeferredTools(
  tools: Tool[],
  query: string,
  limit: number
): ToolSearchResult[] {
  const normalizedQuery = normalizeSearchText(query)
  const queryTerms = tokenize(normalizedQuery)
  const deferred = tools.filter(isDeferredTool)

  return deferred
    .map(tool => ({
      tool,
      score: scoreTool(tool, normalizedQuery, queryTerms),
    }))
    .filter(item => item.score > 0 || queryTerms.length === 0)
    .sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name))
    .slice(0, Math.max(1, limit))
    .map(item => ({
      name: item.tool.name,
      pluginId: item.tool.pluginId,
      description: item.tool.description,
      safety: item.tool.safety,
      score: item.score,
    }))
}

export function renderDeferredToolSummary(tools: Tool[]): string {
  const groups = new Map<string, number>()
  for (const tool of tools.filter(isDeferredTool)) {
    const key = tool.pluginId || 'runtime'
    groups.set(key, (groups.get(key) ?? 0) + 1)
  }

  if (groups.size === 0) {
    return ''
  }

  return Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([pluginId, count]) => `- ${pluginId}: ${count} deferred tools`)
    .join('\n')
}

function scoreTool(tool: Tool, normalizedQuery: string, queryTerms: string[]): number {
  const text = normalizeSearchText([
    tool.name,
    tool.name.replace(/[_-]/g, ' '),
    tool.pluginId,
    tool.description,
    tool.safety,
    ...(tool.searchKeywords ?? []),
    ...Object.keys(tool.parameters?.properties ?? {}),
  ].filter(Boolean).join(' '))

  if (queryTerms.length === 0) {
    return 1
  }

  let score = 0
  if (text.includes(normalizedQuery)) {
    score += 8
  }

  for (const term of queryTerms) {
    if (tool.name.toLowerCase().includes(term)) {
      score += 5
    } else if (text.includes(term)) {
      score += 2
    }
  }

  return score
}

function tokenize(text: string): string[] {
  return Array.from(new Set(text.split(/\s+/).filter(token => token.length > 0)))
}

function normalizeSearchText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, ' ').trim()
}
