/**
 * Builds character resource workflows from a free-form user brief.
 */
import {
  sendChatTurnWithConfiguredModel,
  type ConfiguredChatModel,
} from '../chat/request-runtime.js'
import {
  createStandardCharacterWorkflow,
  type CharacterWorkflow,
  type CharacterWorkflowLanguage,
} from './index.js'

export interface CharacterWorkflowBuilderRequest {
  prompt: string
  language?: CharacterWorkflowLanguage
  modelConfig: ConfiguredChatModel | null
  llmApiId?: string
  llmModelName?: string
  imageApiId?: string
  imageModelName?: string
  now?: number
}

export interface CharacterWorkflowBuilderSpec {
  name: string
  goalPrompt: string
  targetAudience: string
  stylePrompt: string
  preset: string
  intensity: number
  mustHave: string[]
  mustNot: string[]
  sourceNotes: string
  generationStrategy: {
    mode: string
    branchCount: number
    priorityAssets: string[]
  }
  agentPolicy: {
    autonomyLevel: string
    revisionBudget: number
    askUserThreshold: string
  }
  qualityGate: {
    minimumScore: number
    requiredChecks: string[]
  }
  assetTargets: string[]
  outputFormat: string
  operations: CharacterWorkflowBuilderOperation[]
}

export type CharacterWorkflowBuilderOperation =
  | { type: 'add-node'; nodeType: string; nodeId?: string; title?: string; x?: number; y?: number; config?: Record<string, unknown> }
  | { type: 'update-node-config'; nodeId: string; config: Record<string, unknown> }
  | { type: 'delete-node'; nodeId: string }
  | { type: 'add-link'; sourceNodeId: string; sourceSlotId: string; targetNodeId: string; targetSlotId: string; kind?: string }
  | { type: 'delete-link'; linkId?: string; sourceNodeId?: string; sourceSlotId?: string; targetNodeId?: string; targetSlotId?: string }

export interface CharacterWorkflowBuilderResult {
  workflow: CharacterWorkflow
  spec: CharacterWorkflowBuilderSpec
  uiConfigOverrides: Record<string, Record<string, unknown>>
}

const DEFAULT_REQUIRED_CHECKS = ['goal match', 'long-term RP', 'visual identity', 'field completeness', 'consistency']
const DEFAULT_ASSET_TARGETS = ['role-card', 'opening', 'image-pack', 'generation-report']

export async function buildCharacterWorkflowFromPrompt(
  request: CharacterWorkflowBuilderRequest
): Promise<CharacterWorkflowBuilderResult> {
  const prompt = request.prompt.trim()
  if (!prompt) {
    throw new Error('Workflow builder prompt is empty')
  }

  const language = request.language ?? 'zh-CN'
  const response = await sendChatTurnWithConfiguredModel(request.modelConfig, {
    input: prompt,
    language,
    options: { temperature: 0.32, top_p: 0.82, max_tokens: 1400 },
    messages: [{
      role: 'system',
      content: createWorkflowBuilderSystemPrompt(language),
    }],
  }, {
    defaultOptions: {
      max_tokens: 1400,
    },
  })

  const spec = normalizeWorkflowBuilderSpec(response.content, prompt, language)
  const workflow = createStandardCharacterWorkflow({
    id: `character-workflow-${request.now ?? Date.now()}`,
    name: spec.name,
    language,
    llmApiId: request.llmApiId,
    llmModelName: request.llmModelName,
    imageApiId: request.imageApiId,
    imageModelName: request.imageModelName,
    now: request.now,
  })
  applySpecToWorkflow(workflow, spec)

  return {
    workflow,
    spec,
    uiConfigOverrides: createUiConfigOverrides(spec),
  }
}

export function normalizeWorkflowBuilderSpec(
  rawContent: string,
  fallbackPrompt: string,
  language: CharacterWorkflowLanguage = 'zh-CN'
): CharacterWorkflowBuilderSpec {
  const parsed = parseJsonObject(rawContent)
  const fallbackName = language === 'zh-CN' ? '角色草稿' : 'Character Draft'
  const spec: CharacterWorkflowBuilderSpec = {
    name: stringValue(parsed, 'name') || deriveName(fallbackPrompt, fallbackName),
    goalPrompt: stringValue(parsed, 'goalPrompt') || fallbackPrompt,
    targetAudience: stringValue(parsed, 'targetAudience'),
    stylePrompt: stringValue(parsed, 'stylePrompt'),
    preset: normalizePreset(stringValue(parsed, 'preset')),
    intensity: numberValue(parsed, 'intensity', 0.72, 0, 1),
    mustHave: stringList(parsed, 'mustHave', []),
    mustNot: stringList(parsed, 'mustNot', []),
    sourceNotes: stringValue(parsed, 'sourceNotes'),
    generationStrategy: normalizeGenerationStrategy(recordValue(parsed, 'generationStrategy')),
    agentPolicy: normalizeAgentPolicy(recordValue(parsed, 'agentPolicy')),
    qualityGate: normalizeQualityGate(recordValue(parsed, 'qualityGate')),
    assetTargets: stringList(parsed, 'assetTargets', DEFAULT_ASSET_TARGETS),
    outputFormat: normalizeOutputFormat(stringValue(parsed, 'outputFormat')),
    operations: operationList(parsed?.operations),
  }
  if (!spec.assetTargets.includes('image-pack')) {
    spec.assetTargets = [...spec.assetTargets, 'image-pack']
  }
  return spec
}

export function createUiConfigOverrides(spec: CharacterWorkflowBuilderSpec): Record<string, Record<string, unknown>> {
  return {
    'generation-goal': {
      goalPrompt: spec.goalPrompt,
      targetAudience: spec.targetAudience,
      allowAgentExpansion: true,
    },
    'character-card-target': {
      includeFields: ['name', 'description', 'appearance', 'personality', 'background', 'scenario', 'firstMessage', 'dialogueStyle', 'worldContext'],
      includeSupportFields: ['memoryStrategy', 'imagePrompt'],
    },
    'opening-field-target': {
      field: 'firstMessage',
    },
    'opening-field-control': {
      fieldPurpose: spec.stylePrompt,
      tone: '',
      lengthPolicy: 'medium',
      avoidPatterns: spec.mustNot,
    },
    'image-target': {
      imageRole: 'avatar',
    },
    'image-control': {
      targetImageCount: Math.max(1, spec.assetTargets.includes('image-pack') ? 4 : 1),
      imageTypes: spec.assetTargets.includes('image-pack') ? ['avatar', 'body', 'scene', 'expression'] : ['avatar'],
      composition: 'character-focused',
      consistencyMode: 'same-character',
      negativePrompt: spec.mustNot.join(', '),
    },
    'style-pressure': {
      preset: spec.preset,
      intensity: spec.intensity,
      stylePrompt: spec.stylePrompt,
    },
    'hard-constraints': {
      mustHave: spec.mustHave,
      mustNot: spec.mustNot,
      hardBoundary: true,
    },
    'source-material': {
      sourceKind: 'notes',
      notes: spec.sourceNotes,
    },
    'agent-policy': {
      autonomyLevel: spec.agentPolicy.autonomyLevel,
      revisionBudget: spec.agentPolicy.revisionBudget,
      askUserThreshold: spec.agentPolicy.askUserThreshold,
      canExpandMissingDetails: true,
    },
    'generation-strategy': {
      mode: spec.generationStrategy.mode,
      branchCount: spec.generationStrategy.branchCount,
      priorityAssets: spec.generationStrategy.priorityAssets,
      stopCondition: 'quality gate passed',
    },
    'quality-gate': {
      minimumScore: spec.qualityGate.minimumScore,
      blockExport: true,
      requiredChecks: spec.qualityGate.requiredChecks,
    },
    'output-adapter': {
      format: spec.outputFormat,
      includeAssets: true,
    },
  }
}

function createWorkflowBuilderSystemPrompt(language: CharacterWorkflowLanguage): string {
  const localeRule = language === 'zh-CN'
    ? 'Write Chinese user-facing content. Keep internal enum values in English.'
    : 'Write English user-facing content. Keep internal enum values in English.'
  return [
    'You are the backend planner for a character resource graph builder.',
    'Convert the user brief into configuration for an autonomous character-card generation workflow.',
    localeRule,
    'The final workflow must always generate a complete role card and at least one image asset.',
    'Do not write final character-card fields here. This is workflow configuration only.',
    'Return only valid JSON. No markdown, comments, or surrounding prose.',
    'Schema:',
    '{',
    '  "name": string,',
    '  "goalPrompt": string,',
    '  "targetAudience": string,',
    '  "stylePrompt": string,',
    '  "preset": "custom" | "campus-romance" | "dark-adult" | "urban-suspense" | "fantasy-companion" | "slice-of-life",',
    '  "intensity": number,',
    '  "mustHave": string[],',
    '  "mustNot": string[],',
    '  "sourceNotes": string,',
    '  "generationStrategy": { "mode": "branch-and-refine" | "explore-then-converge" | "single-pass", "branchCount": number, "priorityAssets": string[] },',
    '  "agentPolicy": { "autonomyLevel": "high" | "medium" | "low", "revisionBudget": number, "askUserThreshold": "blocked-only" | "low-confidence" | "never" },',
    '  "qualityGate": { "minimumScore": number, "requiredChecks": string[] },',
    '  "assetTargets": string[],',
    '  "outputFormat": "noema-role-chat" | "sillytavern" | "portable-json" | "markdown-dossier",',
    '  "operations": [',
    '    { "type": "add-node", "nodeType": string, "nodeId"?: string, "title"?: string, "x"?: number, "y"?: number, "config"?: object },',
    '    { "type": "update-node-config", "nodeId": string, "config": object },',
    '    { "type": "delete-node", "nodeId": string },',
    '    { "type": "add-link", "sourceNodeId": string, "sourceSlotId": string, "targetNodeId": string, "targetSlotId": string, "kind"?: string },',
    '    { "type": "delete-link", "linkId"?: string, "sourceNodeId"?: string, "sourceSlotId"?: string, "targetNodeId"?: string, "targetSlotId"?: string }',
    '  ]',
    '}',
  ].join('\n')
}

function applySpecToWorkflow(workflow: CharacterWorkflow, spec: CharacterWorkflowBuilderSpec): void {
  const byType = new Map(workflow.nodes.map((node) => [node.type, node]))
  byType.get('goal')?.config && Object.assign(byType.get('goal')!.config, {
    goalPrompt: spec.goalPrompt,
    targetAudience: spec.targetAudience,
    allowAgentExpansion: true,
  })
  byType.get('style-pressure')?.config && Object.assign(byType.get('style-pressure')!.config, {
    preset: spec.preset,
    stylePrompt: spec.stylePrompt,
    intensity: spec.intensity,
  })
  byType.get('constraint')?.config && Object.assign(byType.get('constraint')!.config, {
    mustHave: spec.mustHave,
    mustNot: spec.mustNot,
    hardBoundary: true,
  })
  byType.get('source-material')?.config && Object.assign(byType.get('source-material')!.config, {
    sourceKind: 'notes',
    notes: spec.sourceNotes,
  })
  byType.get('agent-policy')?.config && Object.assign(byType.get('agent-policy')!.config, {
    ...spec.agentPolicy,
    canExpandMissingDetails: true,
  })
  byType.get('generation-strategy')?.config && Object.assign(byType.get('generation-strategy')!.config, {
    ...spec.generationStrategy,
    stopCondition: 'quality gate passed',
  })
  byType.get('character-card-target')?.config && Object.assign(byType.get('character-card-target')!.config, {
    includeFields: ['name', 'description', 'appearance', 'personality', 'background', 'scenario', 'firstMessage', 'dialogueStyle', 'worldContext'],
    includeSupportFields: ['memoryStrategy', 'imagePrompt'],
  })
  byType.get('character-field-target')?.config && Object.assign(byType.get('character-field-target')!.config, {
    field: 'firstMessage',
  })
  byType.get('field-generation-control')?.config && Object.assign(byType.get('field-generation-control')!.config, {
    fieldPurpose: spec.stylePrompt,
    tone: '',
    avoidPatterns: spec.mustNot,
  })
  byType.get('image-target')?.config && Object.assign(byType.get('image-target')!.config, {
    imageRole: 'avatar',
  })
  byType.get('image-generation-control')?.config && Object.assign(byType.get('image-generation-control')!.config, {
    targetImageCount: Math.max(1, spec.assetTargets.includes('image-pack') ? 4 : 1),
    imageTypes: spec.assetTargets.includes('image-pack') ? ['avatar', 'body', 'scene', 'expression'] : ['avatar'],
    composition: 'character-focused',
    consistencyMode: 'same-character',
    negativePrompt: spec.mustNot.join(', '),
  })
  byType.get('quality-gate')?.config && Object.assign(byType.get('quality-gate')!.config, {
    ...spec.qualityGate,
    blockExport: true,
  })
  byType.get('output-adapter')?.config && Object.assign(byType.get('output-adapter')!.config, {
    format: spec.outputFormat,
    includeAssets: true,
  })
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) {
    return {}
  }
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function recordValue(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? String(record[key]).trim() : ''
}

function numberValue(record: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const number = typeof record[key] === 'number' ? record[key] : Number(record[key])
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
}

function stringList(record: Record<string, unknown>, key: string, fallback: string[]): string[] {
  const value = record[key]
  const list = Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : []
  return (list.length ? list : fallback).slice(0, 12)
}

function operationList(value: unknown): CharacterWorkflowBuilderOperation[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item): CharacterWorkflowBuilderOperation[] => {
    if (!item || typeof item !== 'object') {
      return []
    }
    const record = item as Record<string, unknown>
    const type = stringValue(record, 'type')
    if (type === 'add-node') {
      const nodeType = stringValue(record, 'nodeType')
      if (!nodeType) return []
      return [{
        type,
        nodeType,
        nodeId: stringValue(record, 'nodeId') || undefined,
        title: stringValue(record, 'title') || undefined,
        x: typeof record.x === 'number' ? record.x : undefined,
        y: typeof record.y === 'number' ? record.y : undefined,
        config: recordValue(record, 'config'),
      }]
    }
    if (type === 'update-node-config') {
      const nodeId = stringValue(record, 'nodeId')
      if (!nodeId) return []
      return [{ type, nodeId, config: recordValue(record, 'config') }]
    }
    if (type === 'delete-node') {
      const nodeId = stringValue(record, 'nodeId')
      return nodeId ? [{ type, nodeId }] : []
    }
    if (type === 'add-link') {
      const sourceNodeId = stringValue(record, 'sourceNodeId')
      const sourceSlotId = stringValue(record, 'sourceSlotId')
      const targetNodeId = stringValue(record, 'targetNodeId')
      const targetSlotId = stringValue(record, 'targetSlotId')
      if (!sourceNodeId || !sourceSlotId || !targetNodeId || !targetSlotId) return []
      return [{ type, sourceNodeId, sourceSlotId, targetNodeId, targetSlotId, kind: stringValue(record, 'kind') || undefined }]
    }
    if (type === 'delete-link') {
      return [{
        type,
        linkId: stringValue(record, 'linkId') || undefined,
        sourceNodeId: stringValue(record, 'sourceNodeId') || undefined,
        sourceSlotId: stringValue(record, 'sourceSlotId') || undefined,
        targetNodeId: stringValue(record, 'targetNodeId') || undefined,
        targetSlotId: stringValue(record, 'targetSlotId') || undefined,
      }]
    }
    return []
  }).slice(0, 24)
}

function normalizePreset(value: string): string {
  const allowed = new Set(['custom', 'campus-romance', 'dark-adult', 'urban-suspense', 'fantasy-companion', 'slice-of-life'])
  return allowed.has(value) ? value : 'custom'
}

function normalizeOutputFormat(value: string): string {
  const allowed = new Set(['noema-role-chat', 'sillytavern', 'portable-json', 'markdown-dossier'])
  return allowed.has(value) ? value : 'noema-role-chat'
}

function normalizeGenerationStrategy(record: Record<string, unknown>): CharacterWorkflowBuilderSpec['generationStrategy'] {
  const mode = stringValue(record, 'mode')
  const allowedMode = new Set(['branch-and-refine', 'explore-then-converge', 'single-pass'])
  const priorityAssets = stringList(record, 'priorityAssets', DEFAULT_ASSET_TARGETS)
  return {
    mode: allowedMode.has(mode) ? mode : 'branch-and-refine',
    branchCount: Math.round(numberValue(record, 'branchCount', 3, 1, 8)),
    priorityAssets: priorityAssets.includes('image-pack') ? priorityAssets : [...priorityAssets, 'image-pack'],
  }
}

function normalizeAgentPolicy(record: Record<string, unknown>): CharacterWorkflowBuilderSpec['agentPolicy'] {
  const autonomyLevel = stringValue(record, 'autonomyLevel')
  const askUserThreshold = stringValue(record, 'askUserThreshold')
  return {
    autonomyLevel: new Set(['high', 'medium', 'low']).has(autonomyLevel) ? autonomyLevel : 'high',
    revisionBudget: Math.round(numberValue(record, 'revisionBudget', 4, 1, 12)),
    askUserThreshold: new Set(['blocked-only', 'low-confidence', 'never']).has(askUserThreshold) ? askUserThreshold : 'blocked-only',
  }
}

function normalizeQualityGate(record: Record<string, unknown>): CharacterWorkflowBuilderSpec['qualityGate'] {
  return {
    minimumScore: numberValue(record, 'minimumScore', 0.84, 0, 1),
    requiredChecks: stringList(record, 'requiredChecks', DEFAULT_REQUIRED_CHECKS),
  }
}

function deriveName(prompt: string, fallback: string): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, 28) : fallback
}
