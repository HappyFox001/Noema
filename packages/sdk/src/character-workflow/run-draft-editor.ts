/**
 * Edits generated character workflow run draft artifacts with a configured chat model.
 */
import {
  sendChatTurnWithConfiguredModel,
  type ConfiguredChatModel,
} from '../chat/request-runtime.js'
import type { CharacterWorkflowLanguage } from './index.js'

export interface CharacterWorkflowRunDraftArtifact {
  id?: string
  type: string
  sourceNodeId?: string
  title?: string
  summary?: string
  data?: unknown
}

export interface CharacterWorkflowRunDraftEditRequest {
  prompt: string
  language?: CharacterWorkflowLanguage
  modelConfig: ConfiguredChatModel | null
  runTitle?: string
  artifacts: CharacterWorkflowRunDraftArtifact[]
}

export interface CharacterWorkflowRunDraftEditResult {
  summary: string
  artifacts: CharacterWorkflowRunDraftArtifact[]
}

export async function editCharacterWorkflowRunDraft(
  request: CharacterWorkflowRunDraftEditRequest
): Promise<CharacterWorkflowRunDraftEditResult> {
  const prompt = request.prompt.trim()
  if (!prompt) {
    throw new Error('Run draft edit prompt is empty')
  }
  if (!request.artifacts.length) {
    throw new Error('Run draft has no artifacts to edit')
  }
  const language = request.language ?? 'zh-CN'
  const response = await sendChatTurnWithConfiguredModel(request.modelConfig, {
    input: JSON.stringify({
      userRequest: prompt,
      runTitle: request.runTitle,
      artifacts: request.artifacts,
    }),
    language,
    options: { temperature: 0.28, top_p: 0.82 },
    messages: [{
      role: 'system',
      content: createRunDraftEditorSystemPrompt(language),
    }],
  })
  const parsed = parseJsonObject(response.content)
  if (!Object.keys(parsed).length) {
    throw new Error(`Run draft editor did not return valid JSON. Model response: ${response.content.trim().slice(0, 500)}`)
  }
  if (parsed.status === 'blocked') {
    throw new Error(typeof parsed.summary === 'string' ? parsed.summary : 'Run draft editor blocked the request.')
  }
  const artifacts = Array.isArray(parsed.artifacts)
    ? parsed.artifacts.flatMap((artifact): CharacterWorkflowRunDraftArtifact[] => {
      if (!artifact || typeof artifact !== 'object') return []
      const record = artifact as Record<string, unknown>
      const type = typeof record.type === 'string' ? record.type : ''
      if (!type) return []
      return [{
        id: typeof record.id === 'string' ? record.id : undefined,
        type,
        sourceNodeId: typeof record.sourceNodeId === 'string' ? record.sourceNodeId : undefined,
        title: typeof record.title === 'string' ? record.title : undefined,
        summary: typeof record.summary === 'string' ? record.summary : undefined,
        data: record.data,
      }]
    })
    : []
  if (!artifacts.length) {
    throw new Error('Run draft editor returned no artifacts.')
  }
  return {
    summary: typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim()
      : (language === 'zh-CN' ? '已调整运行草稿。' : 'Updated run draft.'),
    artifacts,
  }
}

function createRunDraftEditorSystemPrompt(language: CharacterWorkflowLanguage): string {
  const localeRule = language === 'zh-CN'
    ? 'Write user-facing artifact content in Chinese. Keep ids and enum-like values unchanged.'
    : 'Write user-facing artifact content in English. Keep ids and enum-like values unchanged.'
  return [
    'You are editing an existing character workflow run draft.',
    'The input contains { userRequest, runTitle, artifacts }. Treat artifacts as the current run draft result.',
    localeRule,
    '',
    'Apply the user request directly to the current artifacts.',
    'Preserve artifact ids, types, sourceNodeId, image URLs, and binary/image data unless the user explicitly asks to remove or replace them.',
    'Do not edit the workflow graph. Only revise the run draft artifacts.',
    'Do not copy instructions or JSON schema into artifact content.',
    'If a request cannot be applied safely, return status "blocked" with a short summary and leave artifacts unchanged.',
    '',
    'Return only valid JSON:',
    '{',
    '  "status": "applied" | "blocked",',
    '  "summary": string,',
    '  "artifacts": [',
    '    { "id"?: string, "type": string, "sourceNodeId"?: string, "title"?: string, "summary"?: string, "data"?: any }',
    '  ]',
    '}',
  ].join('\n')
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  const start = trimmed.indexOf('{')
  if (start < 0) return {}
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < trimmed.length; index += 1) {
    const char = trimmed[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = inString
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          const parsed = JSON.parse(trimmed.slice(start, index + 1))
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
        } catch {
          return {}
        }
      }
    }
  }
  return {}
}
