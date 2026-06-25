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
  const sourceInput = JSON.stringify({
    userRequest: prompt,
    runTitle: request.runTitle,
    artifacts: compactRunDraftArtifactsForEditor(request.artifacts),
  })
  const response = await sendChatTurnWithConfiguredModel(request.modelConfig, {
    input: sourceInput,
    language,
    options: { temperature: 0.18, top_p: 0.72, response_format: { type: 'json_object' } },
    messages: [{
      role: 'system',
      content: createRunDraftEditorSystemPrompt(language),
    }],
  })
  let parsed = parseJsonObject(response.content)
  if (!Object.keys(parsed).length) {
    const repaired = await repairRunDraftEditorJson({
      text: response.content,
      sourceInput,
      request,
      language,
      systemPrompt: createRunDraftEditorSystemPrompt(language),
    })
    parsed = parseJsonObject(repaired)
  }
  if (!Object.keys(parsed).length) {
    return createUnchangedRunDraftEditResult(language, request.artifacts)
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
    return createUnchangedRunDraftEditResult(language, request.artifacts)
  }
  const mergedArtifacts = mergeEditedRunDraftArtifacts(request.artifacts, artifacts)
  return {
    summary: typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim()
      : (language === 'zh-CN' ? '已调整运行草稿。' : 'Updated run draft.'),
    artifacts: mergedArtifacts,
  }
}

function createUnchangedRunDraftEditResult(
  language: CharacterWorkflowLanguage,
  artifacts: CharacterWorkflowRunDraftArtifact[]
): CharacterWorkflowRunDraftEditResult {
  return {
    summary: language === 'zh-CN'
      ? '模型没有返回可解析的运行草稿编辑结果，已保留当前运行草稿。'
      : 'The model did not return a parseable run draft edit, so the current run draft was preserved.',
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

async function repairRunDraftEditorJson(options: {
  text: string
  sourceInput: string
  request: CharacterWorkflowRunDraftEditRequest
  language: CharacterWorkflowLanguage
  systemPrompt: string
}): Promise<string> {
  const response = await sendChatTurnWithConfiguredModel(options.request.modelConfig, {
    input: [
      'The previous response was not valid JSON and could not be parsed.',
      'Rewrite it as one complete valid JSON object matching the required schema.',
      'Do not add markdown, comments, explanations, or code fences.',
      'If the prior response was empty, apply the original user request conservatively to the provided artifacts.',
      '',
      '<original_input>',
      options.sourceInput,
      '</original_input>',
      '',
      '<invalid_response>',
      options.text,
      '</invalid_response>',
    ].join('\n'),
    language: options.language,
    options: { temperature: 0, response_format: { type: 'json_object' } },
    messages: [{
      role: 'system',
      content: options.systemPrompt,
    }],
  })
  return response.content
}

function compactRunDraftArtifactsForEditor(artifacts: CharacterWorkflowRunDraftArtifact[]): CharacterWorkflowRunDraftArtifact[] {
  return artifacts.map((artifact) => ({
    ...artifact,
    data: compactRunDraftArtifactData(artifact.data),
  }))
}

function compactRunDraftArtifactData(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }
  const record = value as Record<string, unknown>
  const compact: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(record)) {
    if ((key === 'dataUrl' || key === 'url') && typeof item === 'string') {
      compact[key] = `[preserved ${key}: ${item.slice(0, 80)}]`
      continue
    }
    if (typeof item === 'string' && item.length > 1200) {
      compact[key] = `${item.slice(0, 1200)}...`
      continue
    }
    compact[key] = item
  }
  return compact
}

function mergeEditedRunDraftArtifacts(
  originalArtifacts: CharacterWorkflowRunDraftArtifact[],
  editedArtifacts: CharacterWorkflowRunDraftArtifact[]
): CharacterWorkflowRunDraftArtifact[] {
  return editedArtifacts.map((artifact) => {
    const original = originalArtifacts.find((item) => item.id && item.id === artifact.id)
      ?? originalArtifacts.find((item) => item.type === artifact.type && item.sourceNodeId === artifact.sourceNodeId)
    if (!original || !original.data || !artifact.data || typeof original.data !== 'object' || typeof artifact.data !== 'object' || Array.isArray(original.data) || Array.isArray(artifact.data)) {
      return artifact
    }
    const originalData = original.data as Record<string, unknown>
    const editedData = artifact.data as Record<string, unknown>
    return {
      ...artifact,
      data: {
        ...editedData,
        ...preservedImageData(originalData, editedData),
      },
    }
  })
}

function preservedImageData(originalData: Record<string, unknown>, editedData: Record<string, unknown>): Record<string, unknown> {
  const preserved: Record<string, unknown> = {}
  for (const key of ['dataUrl', 'url', 'mimeType', 'storagePath', 'filePath']) {
    const edited = editedData[key]
    if (typeof edited === 'string' && !edited.startsWith('[preserved ')) {
      continue
    }
    if (originalData[key] !== undefined) {
      preserved[key] = originalData[key]
    }
  }
  return preserved
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
