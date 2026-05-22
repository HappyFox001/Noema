/**
 * Builds Codex-style deferred tool discovery for task runtime.
 */
import type { Tool } from '../tools/types.js'

export interface ToolSearchResult {
  name: string
  pluginId?: string
  description: string
  safety?: Tool['safety']
  score: number
}

type ToolSearchEntry = {
  tool: Tool
  searchText: string
  tokens: string[]
  termFrequencies: Map<string, number>
  length: number
  limitBucket?: string
}

const TOOL_SEARCH_DEFAULT_LIMIT = 8
const COMPUTER_USE_BUCKET = 'computer-use'
const COMPUTER_USE_TOOL_SEARCH_LIMIT = 20
const BM25_K1 = 1.2
const BM25_B = 0.75

export function isDeferredTool(tool: Tool): boolean {
  return tool.deferLoading === true
}

export function searchDeferredTools(
  tools: Tool[],
  query: string,
  limit: number,
  useDefaultLimit = false
): ToolSearchResult[] {
  const entries = buildToolSearchEntries(tools)
  if (entries.length === 0) {
    return []
  }

  const queryTerms = tokenize(query)
  if (queryTerms.length === 0) {
    return []
  }

  const effectiveLimit = Math.max(1, limit)
  const ranked = rankEntries(entries, queryTerms)
  const expandedLimit = useDefaultLimit && ranked.some(item => item.entry.limitBucket === COMPUTER_USE_BUCKET)
    ? COMPUTER_USE_TOOL_SEARCH_LIMIT
    : effectiveLimit

  const results = ranked
    .slice(0, expandedLimit)
    .filter(item => item.score > 0)

  const bucketed = useDefaultLimit
    ? limitResultsByBucket(results)
    : results

  return bucketed
    .map(item => ({
      name: item.entry.tool.name,
      pluginId: item.entry.tool.pluginId,
      description: item.entry.tool.description,
      safety: item.entry.tool.safety,
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

function buildToolSearchEntries(tools: Tool[]): ToolSearchEntry[] {
  return tools
    .filter(isDeferredTool)
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(tool => {
      const searchText = buildSearchText(tool)
      const tokens = tokenize(searchText)
      return {
        tool,
        searchText,
        tokens,
        termFrequencies: countTerms(tokens),
        length: Math.max(1, tokens.length),
        limitBucket: tool.pluginId,
      }
    })
}

function buildSearchText(tool: Tool): string {
  return [
    tool.name,
    tool.name.replace(/[_-]/g, ' '),
    tool.pluginId,
    tool.description,
    tool.safety,
    ...(tool.searchKeywords ?? []),
    ...Object.keys(tool.parameters?.properties ?? {}),
  ].filter(Boolean).join(' ')
}

function rankEntries(entries: ToolSearchEntry[], queryTerms: string[]): Array<{ entry: ToolSearchEntry; score: number }> {
  const documentFrequency = new Map<string, number>()
  for (const entry of entries) {
    for (const term of new Set(entry.tokens)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
    }
  }

  const averageLength = entries.reduce((sum, entry) => sum + entry.length, 0) / Math.max(1, entries.length)
  return entries
    .map(entry => ({
      entry,
      score: bm25Score(entry, queryTerms, documentFrequency, entries.length, averageLength),
    }))
    .sort((left, right) => right.score - left.score || left.entry.tool.name.localeCompare(right.entry.tool.name))
}

function bm25Score(
  entry: ToolSearchEntry,
  queryTerms: string[],
  documentFrequency: Map<string, number>,
  documentCount: number,
  averageLength: number
): number {
  let score = 0
  const uniqueTerms = Array.from(new Set(queryTerms))
  for (const term of uniqueTerms) {
    const frequency = entry.termFrequencies.get(term) ?? 0
    if (frequency <= 0) {
      continue
    }
    const documentsWithTerm = documentFrequency.get(term) ?? 0
    const inverseDocumentFrequency = Math.log(1 + (documentCount - documentsWithTerm + 0.5) / (documentsWithTerm + 0.5))
    const numerator = frequency * (BM25_K1 + 1)
    const denominator = frequency + BM25_K1 * (1 - BM25_B + BM25_B * (entry.length / Math.max(1, averageLength)))
    score += inverseDocumentFrequency * (numerator / denominator)
  }
  return score
}

function limitResultsByBucket<T extends { entry: ToolSearchEntry }>(results: T[]): T[] {
  const counts = new Map<string, number>()
  const limited: T[] = []
  for (const result of results) {
    const bucket = result.entry.limitBucket
    if (!bucket) {
      limited.push(result)
      continue
    }
    const count = counts.get(bucket) ?? 0
    if (count >= defaultLimitForBucket(bucket)) {
      continue
    }
    counts.set(bucket, count + 1)
    limited.push(result)
  }
  return limited
}

function defaultLimitForBucket(bucket: string): number {
  return bucket === COMPUTER_USE_BUCKET ? COMPUTER_USE_TOOL_SEARCH_LIMIT : TOOL_SEARCH_DEFAULT_LIMIT
}

function countTerms(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return counts
}

function tokenize(text: string): string[] {
  return normalizeSearchText(text).split(/\s+/).filter(token => token.length > 0)
}

function normalizeSearchText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, ' ').trim()
}
