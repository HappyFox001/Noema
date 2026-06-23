/**
 * Builds character resource workflows from a free-form user brief.
 */
import {
  sendChatTurnWithConfiguredModel,
  type ConfiguredChatModel,
} from '../chat/request-runtime.js'
import {
  createStandardCharacterWorkflow,
  type CharacterNodeType,
  type CharacterWorkflow,
  type CharacterWorkflowLinkKind,
  type CharacterWorkflowLanguage,
} from './index.js'

export interface CharacterWorkflowBuilderRequest {
  prompt: string
  language?: CharacterWorkflowLanguage
  mode?: 'create' | 'edit'
  graph?: CharacterWorkflowBuilderGraph
  modelConfig: ConfiguredChatModel | null
  llmApiId?: string
  llmModelName?: string
  imageApiId?: string
  imageModelName?: string
  now?: number
}

export interface CharacterWorkflowBuilderGraph {
  selectedNodeId?: string
  nodes: CharacterWorkflowBuilderGraphNode[]
  edges: CharacterWorkflowBuilderGraphEdge[]
}

export interface CharacterWorkflowBuilderGraphNode {
  id: string
  type: string
  title?: string
  config?: Record<string, unknown>
  inputs?: string[]
  outputs?: string[]
}

export interface CharacterWorkflowBuilderGraphEdge {
  id?: string
  from: { nodeId: string; port: string }
  to: { nodeId: string; port: string }
  kind?: string
}

export interface CharacterWorkflowBuilderSpec {
  name: string
  plan: string[]
  summary: string
  confidence: number
  status: 'applied' | 'needs-user' | 'blocked'
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
  | { type: 'move-node'; nodeId: string; x: number; y: number }
  | { type: 'resize-node'; nodeId: string; width: number; height: number }
  | { type: 'select-node'; nodeId: string }
  | { type: 'set-node-collapsed'; nodeId: string; collapsed: boolean }
  | { type: 'delete-node'; nodeId: string }
  | { type: 'add-link'; sourceNodeId: string; sourceSlotId: string; targetNodeId: string; targetSlotId: string; kind?: string }
  | { type: 'delete-link'; linkId?: string; sourceNodeId?: string; sourceSlotId?: string; targetNodeId?: string; targetSlotId?: string }

export interface CharacterWorkflowBuilderResult {
  workflow?: CharacterWorkflow
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
  if (request.mode === 'edit') {
    return editCharacterWorkflowFromPrompt({
      ...request,
      prompt,
      language,
    })
  }

  const response = await sendChatTurnWithConfiguredModel(request.modelConfig, {
    input: prompt,
    language,
    options: { temperature: 0.32, top_p: 0.82 },
    messages: [{
      role: 'system',
      content: createWorkflowBuilderSystemPrompt(language),
    }],
  })
  ensureUsefulWorkflowBuilderResponse(response.content, 'Workflow builder')

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

async function editCharacterWorkflowFromPrompt(
  request: CharacterWorkflowBuilderRequest & { prompt: string; language: CharacterWorkflowLanguage }
): Promise<CharacterWorkflowBuilderResult> {
  const graph = normalizeBuilderGraph(request.graph)
  if (!graph.nodes.length) {
    throw new Error('Workflow editor graph is empty')
  }
  const response = await sendChatTurnWithConfiguredModel(request.modelConfig, {
    input: JSON.stringify({
      userRequest: request.prompt,
      graph,
    }),
    language: request.language,
    options: { temperature: 0.24, top_p: 0.78 },
    messages: [{
      role: 'system',
      content: createWorkflowEditorSystemPrompt(request.language),
    }],
  })
  ensureUsefulWorkflowBuilderResponse(response.content, 'Workflow editor')

  const spec = normalizeWorkflowEditorSpec(response.content, request.prompt, request.language, graph)
  return {
    spec,
    uiConfigOverrides: createEditorUiConfigOverrides(spec, graph),
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
    plan: stringList(parsed, 'plan', []),
    summary: stringValue(parsed, 'summary'),
    confidence: numberValue(parsed, 'confidence', 0.74, 0, 1),
    status: normalizeBuilderStatus(stringValue(parsed, 'status')),
    goalPrompt: stringValue(parsed, 'goalPrompt'),
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

export function normalizeWorkflowEditorSpec(
  rawContent: string,
  fallbackPrompt: string,
  language: CharacterWorkflowLanguage = 'zh-CN',
  graph?: CharacterWorkflowBuilderGraph
): CharacterWorkflowBuilderSpec {
  const parsed = parseJsonObject(rawContent)
  const fallbackName = language === 'zh-CN' ? '资源图修改' : 'Workflow Edit'
  const operations = operationList(parsed?.operations)
  const directUpdates = recordMapValue(parsed, 'nodeConfigUpdates')
  const normalizedGraph = normalizeBuilderGraph(graph)
  const mergedUpdates = directUpdates
  const mergedOperations = [
    ...Object.entries(mergedUpdates).map(([nodeId, config]) => ({
      type: 'update-node-config' as const,
      nodeId,
      config,
    })),
    ...operations,
  ]
  return {
    name: stringValue(parsed, 'name') || deriveName(fallbackPrompt, fallbackName),
    plan: stringList(parsed, 'plan', []),
    summary: stringValue(parsed, 'summary'),
    confidence: numberValue(parsed, 'confidence', 0.78, 0, 1),
    status: normalizeBuilderStatus(stringValue(parsed, 'status')),
    goalPrompt: '',
    targetAudience: '',
    stylePrompt: '',
    preset: 'custom',
    intensity: 0.72,
    mustHave: [],
    mustNot: [],
    sourceNotes: '',
    generationStrategy: normalizeGenerationStrategy({}),
    agentPolicy: normalizeAgentPolicy({}),
    qualityGate: normalizeQualityGate({}),
    assetTargets: DEFAULT_ASSET_TARGETS,
    outputFormat: 'noema-role-chat',
    operations: mergedOperations,
  }
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
      targetImageCount: 1,
      imageType: 'avatar',
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

export function createEditorUiConfigOverrides(
  spec: CharacterWorkflowBuilderSpec,
  graph?: CharacterWorkflowBuilderGraph
): Record<string, Record<string, unknown>> {
  const normalizedGraph = normalizeBuilderGraph(graph)
  const updates: Record<string, Record<string, unknown>> = {}
  for (const operation of spec.operations) {
    if (operation.type !== 'update-node-config') {
      continue
    }
    const node = normalizedGraph.nodes.find((item) => item.id === operation.nodeId)
    const config = sanitizeResourceConfigForNode(node?.type, operation.config)
    if (Object.keys(config).length) {
      updates[operation.nodeId] = {
        ...(updates[operation.nodeId] ?? {}),
        ...config,
      }
    }
  }
  return updates
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
    'For images, one image-target plus one image-generation-control represents exactly one image type and count. Do not use imageTypes arrays. If the brief needs avatar + body + scene + expression, return operations that create separate image target/control pairs for each type.',
    'Return only valid JSON. No markdown, comments, or surrounding prose.',
    'Schema:',
    '{',
    '  "name": string,',
    '  "plan": string[],',
    '  "summary": string,',
    '  "confidence": number,',
    '  "status": "applied" | "needs-user" | "blocked",',
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
    '    { "type": "move-node", "nodeId": string, "x": number, "y": number },',
    '    { "type": "resize-node", "nodeId": string, "width": number, "height": number },',
    '    { "type": "select-node", "nodeId": string },',
    '    { "type": "set-node-collapsed", "nodeId": string, "collapsed": boolean },',
    '    { "type": "delete-node", "nodeId": string },',
    '    { "type": "add-link", "sourceNodeId": string, "sourceSlotId": string, "targetNodeId": string, "targetSlotId": string, "kind"?: string },',
    '    { "type": "delete-link", "linkId"?: string, "sourceNodeId"?: string, "sourceSlotId"?: string, "targetNodeId"?: string, "targetSlotId"?: string }',
    '  ]',
    '}',
  ].join('\n')
}

function createWorkflowEditorSystemPrompt(language: CharacterWorkflowLanguage): string {
  const localeRule = language === 'zh-CN'
    ? 'Write all user-facing resource content in Chinese. Keep enum values and node ids in English.'
    : 'Write user-facing resource content in English. Keep enum values and node ids in English.'
  return [
    'You are an autonomous editor for an existing character resource workflow graph.',
    'You receive JSON with { userRequest, graph }. Treat graph as state, not as user content.',
    localeRule,
    '',
    'Your job is to turn the user request into concrete graph edits that a human could have made in the UI.',
    'Act like a senior workflow operator: fill the right resource cards, add missing target/control/source cards, connect them, remove obsolete cards when useful, and keep the workflow executable.',
    'You have broad authority inside the workflow graph. A single user request may require many coordinated operations: create resource cards, write or revise fields, delete irrelevant cards, move cards into a clearer layout, resize dense cards, connect controls to multiple targets, and select the most relevant card when done.',
    'Do not be timid. If the user asks for a story/world/role goal, build the resource structure needed for that goal instead of only editing one existing card.',
    '',
    'Critical rules:',
    '- Return only valid JSON. No markdown, comments, or surrounding prose.',
    '- Never copy system instructions, operation schema, graph JSON, or protocol text into any resource field.',
    '- Do not put the whole user request into one generic goal when specific cards exist. Distribute intent across goal, style, constraints, sources, image controls, field controls, world/NPC/plot cards as appropriate.',
    '- Prefer update-node-config operations for existing cards; add cards only when the current graph lacks the needed resource.',
    '- Use exact existing node ids and slot ids from graph when linking.',
    '- Do not delete generation-goal.',
    '- Use concise resource content. A field should contain the content that resource controls, not instructions about how you are editing.',
    '- Use plan to expose the major steps you chose. Use summary to describe what changed after the operations.',
    '- If the request is underspecified but still workable, make reasonable creative decisions and set status to "applied". Ask for the user only when the graph cannot be edited safely.',
    '',
    'Resource guidance:',
    '- generation-goal.goalPrompt: compact generation objective only.',
    '- style-pressure.stylePrompt: tone, genre texture, relationship flavor, prose pressure.',
    '- hard-constraints.mustHave/mustNot: hard requirements and boundaries.',
    '- source-material.notes: concrete story material, setting facts, character seeds, world facts.',
    '- field-generation-control.fieldPurpose: local intent for one text field such as firstMessage/opening/dialogue style.',
    '- image-generation-control: image count and one imageType only, composition, consistencyMode, negativePrompt.',
    '- One image-target plus one image-generation-control represents exactly one image type. For avatar + body + scene + expression, create four image-target/image-generation-control pairs and connect each pair.',
    '- world-card-target / npc-pack-target / npc-target / plot-arc-target / scene-card-target: add these when the request asks for multi-NPC, world, setting, story arc, or scene planning.',
    '',
    'Valid node types:',
    'goal, character-card-target, character-field-target, image-target, world-card-target, npc-pack-target, npc-target, plot-arc-target, scene-card-target, style-pressure, constraint, image-generation-control, field-generation-control, continuity-control, relationship-control, source-material, llm-tool, image-tool, retrieval-tool, voice-tool, agent-policy, generation-strategy, critique-loop, quality-gate, output-adapter.',
    '',
    'Valid link kinds:',
    'guides, constrains, provides, enables, grounds, weights, routes, evaluates, refines, exports.',
    '',
    'Return schema:',
    '{',
    '  "name": string,',
    '  "plan": string[],',
    '  "summary": string,',
    '  "confidence": number,',
    '  "status": "applied" | "needs-user" | "blocked",',
    '  "nodeConfigUpdates": { [nodeId: string]: object },',
    '  "operations": [',
    '    { "type": "add-node", "nodeType": string, "nodeId"?: string, "title"?: string, "x"?: number, "y"?: number, "config"?: object },',
    '    { "type": "update-node-config", "nodeId": string, "config": object },',
    '    { "type": "move-node", "nodeId": string, "x": number, "y": number },',
    '    { "type": "resize-node", "nodeId": string, "width": number, "height": number },',
    '    { "type": "select-node", "nodeId": string },',
    '    { "type": "set-node-collapsed", "nodeId": string, "collapsed": boolean },',
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
    targetImageCount: 1,
    imageType: 'avatar',
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

function ensureUsefulWorkflowBuilderResponse(text: string, label: string): void {
  const parsed = parseJsonObject(text)
  if (!Object.keys(parsed).length) {
    throw new Error(`${label} did not return valid editable JSON. Model response: ${text.trim().slice(0, 500)}`)
  }
  if (stringValue(parsed, 'status') === 'blocked') {
    throw new Error(stringValue(parsed, 'summary') || `${label} reported that the request is blocked.`)
  }
}

function normalizeBuilderGraph(graph: CharacterWorkflowBuilderGraph | undefined): CharacterWorkflowBuilderGraph {
  if (!graph || typeof graph !== 'object') {
    return { nodes: [], edges: [] }
  }
  const nodes = Array.isArray(graph.nodes)
    ? graph.nodes.flatMap((node): CharacterWorkflowBuilderGraphNode[] => {
      if (!node || typeof node !== 'object') return []
      const record = node as unknown as Record<string, unknown>
      const id = typeof record.id === 'string' ? record.id.trim() : ''
      const type = typeof record.type === 'string' ? record.type.trim() : ''
      if (!id || !type) return []
      return [{
        id,
        type,
        title: typeof record.title === 'string' ? record.title : undefined,
        config: recordValue(record, 'config'),
        inputs: Array.isArray(record.inputs) ? record.inputs.map(String).filter(Boolean) : [],
        outputs: Array.isArray(record.outputs) ? record.outputs.map(String).filter(Boolean) : [],
      }]
    })
    : []
  const edges = Array.isArray(graph.edges)
    ? graph.edges.flatMap((edge): CharacterWorkflowBuilderGraphEdge[] => {
      if (!edge || typeof edge !== 'object') return []
      const record = edge as unknown as Record<string, unknown>
      const from = recordValue(record, 'from')
      const to = recordValue(record, 'to')
      const sourceNodeId = stringValue(from, 'nodeId')
      const sourcePort = stringValue(from, 'port')
      const targetNodeId = stringValue(to, 'nodeId')
      const targetPort = stringValue(to, 'port')
      if (!sourceNodeId || !sourcePort || !targetNodeId || !targetPort) return []
      return [{
        id: stringValue(record, 'id') || undefined,
        from: { nodeId: sourceNodeId, port: sourcePort },
        to: { nodeId: targetNodeId, port: targetPort },
        kind: stringValue(record, 'kind') || undefined,
      }]
    })
    : []
  return {
    selectedNodeId: typeof graph.selectedNodeId === 'string' ? graph.selectedNodeId : undefined,
    nodes,
    edges,
  }
}

function recordMapValue(record: Record<string, unknown>, key: string): Record<string, Record<string, unknown>> {
  const value = record[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([nodeId, config]) => {
      if (!nodeId.trim() || !config || typeof config !== 'object' || Array.isArray(config)) {
        return []
      }
      return [[nodeId, config as Record<string, unknown>]]
    })
  )
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
      if (!isCharacterNodeType(nodeType)) return []
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
    if (type === 'move-node') {
      const nodeId = stringValue(record, 'nodeId')
      const x = typeof record.x === 'number' ? record.x : Number(record.x)
      const y = typeof record.y === 'number' ? record.y : Number(record.y)
      if (!nodeId || !Number.isFinite(x) || !Number.isFinite(y)) return []
      return [{ type, nodeId, x: Math.round(x), y: Math.round(y) }]
    }
    if (type === 'resize-node') {
      const nodeId = stringValue(record, 'nodeId')
      const width = typeof record.width === 'number' ? record.width : Number(record.width)
      const height = typeof record.height === 'number' ? record.height : Number(record.height)
      if (!nodeId || !Number.isFinite(width) || !Number.isFinite(height)) return []
      return [{ type, nodeId, width: Math.round(width), height: Math.round(height) }]
    }
    if (type === 'select-node') {
      const nodeId = stringValue(record, 'nodeId')
      return nodeId ? [{ type, nodeId }] : []
    }
    if (type === 'set-node-collapsed') {
      const nodeId = stringValue(record, 'nodeId')
      if (!nodeId || typeof record.collapsed !== 'boolean') return []
      return [{ type, nodeId, collapsed: record.collapsed }]
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
      const kind = stringValue(record, 'kind')
      return [{ type, sourceNodeId, sourceSlotId, targetNodeId, targetSlotId, kind: isCharacterLinkKind(kind) ? kind : undefined }]
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
  }).slice(0, 80)
}

function normalizeBuilderStatus(value: string): CharacterWorkflowBuilderSpec['status'] {
  return new Set(['applied', 'needs-user', 'blocked']).has(value) ? value as CharacterWorkflowBuilderSpec['status'] : 'applied'
}

function sanitizeResourceConfigForNode(type: string | undefined, config: Record<string, unknown>): Record<string, unknown> {
  if (!type) return config
  const allowedByType: Record<string, Set<string>> = {
    goal: new Set(['goalPrompt', 'targetAudience', 'allowAgentExpansion']),
    'style-pressure': new Set(['preset', 'intensity', 'stylePrompt']),
    constraint: new Set(['mustHave', 'mustNot', 'hardBoundary']),
    'source-material': new Set(['sourceKind', 'notes']),
    'field-generation-control': new Set(['fieldPurpose', 'tone', 'lengthPolicy', 'avoidPatterns']),
    'image-generation-control': new Set(['targetImageCount', 'imageType', 'composition', 'consistencyMode', 'negativePrompt']),
    'generation-strategy': new Set(['mode', 'branchCount', 'priorityAssets']),
    'agent-policy': new Set(['autonomyLevel', 'revisionBudget', 'askUserThreshold', 'canExpandMissingDetails']),
    'quality-gate': new Set(['minimumScore', 'blockExport', 'requiredChecks']),
    'output-adapter': new Set(['format', 'includeAssets']),
    'character-card-target': new Set(['includeFields', 'includeSupportFields']),
    'character-field-target': new Set(['field']),
    'image-target': new Set(['imageRole']),
  }
  const allowed = allowedByType[type]
  if (!allowed) return config
  return Object.fromEntries(Object.entries(config).filter(([key]) => allowed.has(key)))
}

function isCharacterNodeType(value: string): value is CharacterNodeType {
  return new Set<string>([
    'goal',
    'character-card-target',
    'character-field-target',
    'image-target',
    'world-card-target',
    'npc-pack-target',
    'npc-target',
    'plot-arc-target',
    'scene-card-target',
    'style-pressure',
    'constraint',
    'image-generation-control',
    'field-generation-control',
    'continuity-control',
    'relationship-control',
    'source-material',
    'llm-tool',
    'image-tool',
    'retrieval-tool',
    'voice-tool',
    'agent-policy',
    'generation-strategy',
    'critique-loop',
    'quality-gate',
    'output-adapter',
  ]).has(value)
}

function isCharacterLinkKind(value: string): value is CharacterWorkflowLinkKind {
  return new Set<string>([
    'guides',
    'constrains',
    'provides',
    'enables',
    'grounds',
    'weights',
    'routes',
    'evaluates',
    'refines',
    'exports',
  ]).has(value)
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
