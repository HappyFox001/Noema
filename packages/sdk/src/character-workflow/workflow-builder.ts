/**
 * Builds character resource workflows from a free-form user brief.
 */
import {
  sendChatTurnWithConfiguredModel,
  type ConfiguredChatModel,
} from '../chat/request-runtime.js'
import {
  createStandardCharacterWorkflow,
  STANDARD_CHARACTER_WORKFLOW_NODE_DEFINITIONS,
  type CharacterNodeType,
  type CharacterWorkflow,
  type CharacterWorkflowLinkKind,
  type CharacterWorkflowLanguage,
  type CharacterWorkflowNodeParameter,
} from './index.js'

export interface CharacterWorkflowBuilderRequest {
  prompt: string
  language?: CharacterWorkflowLanguage
  mode?: 'create' | 'edit'
  graph?: CharacterWorkflowBuilderGraph
  editorSession?: CharacterWorkflowEditorSession
  modelConfig: ConfiguredChatModel | null
  llmApiId?: string
  llmModelName?: string
  imageApiId?: string
  imageModelName?: string
  now?: number
  onEvent?: (event: CharacterWorkflowBuilderEvent) => void | Promise<void>
}

export type CharacterWorkflowBuilderEvent =
  | { type: 'workflow-agent.started'; mode: 'create' | 'edit'; workId: string; objective: string; timestamp: number }
  | { type: 'workflow-agent.step'; mode: 'create' | 'edit'; workId: string; step: CharacterWorkflowEditorAgentStep; timestamp: number }
  | { type: 'workflow-agent.completed'; mode: 'create' | 'edit'; work: CharacterWorkflowEditorAgentWork; timestamp: number }

export interface CharacterWorkflowEditorSession {
  objective?: string
  plan?: string[]
  completedSteps?: string[]
  currentStep?: string
  history?: Array<{
    userRequest?: string
    summary?: string
    status?: string
    operations?: number
  }>
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
  completedSteps?: string[]
  currentStep?: string
  nextStep?: string
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
  agentWork?: CharacterWorkflowEditorAgentWork
}

export interface CharacterWorkflowEditorAgentWork {
  id: string
  mode: 'create' | 'edit'
  objective: string
  status: 'active' | 'needs-user' | 'blocked' | 'complete'
  plan: string[]
  completedSteps: string[]
  currentStep?: string
  nextStep?: string
  steps: CharacterWorkflowEditorAgentStep[]
  createdAt: number
  updatedAt: number
}

export interface CharacterWorkflowEditorAgentStep {
  id: string
  index: number
  tool: CharacterWorkflowAgentToolAction
  userRequest: string
  summary: string
  status: 'applied' | 'needs-user' | 'blocked'
  plan: string[]
  completedSteps: string[]
  currentStep?: string
  nextStep?: string
  operations: CharacterWorkflowBuilderOperation[]
  uiConfigOverrides: Record<string, Record<string, unknown>>
  createdAt: number
}

export type CharacterWorkflowAgentToolAction =
  | 'inspect_graph'
  | 'edit_graph'
  | 'validate_graph'
  | 'ask_user'
  | 'finish'

const DEFAULT_REQUIRED_CHECKS = ['goal match', 'long-term RP', 'visual identity', 'field completeness', 'consistency']
const DEFAULT_ASSET_TARGETS = ['role-card', 'opening', 'opening-layout', 'image-pack', 'generation-report']

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

  return createCharacterWorkflowFromPrompt({
    ...request,
    prompt,
    language,
  })
}

async function createCharacterWorkflowFromPrompt(
  request: CharacterWorkflowBuilderRequest & { prompt: string; language: CharacterWorkflowLanguage }
): Promise<CharacterWorkflowBuilderResult> {
  const now = request.now ?? Date.now()
  const workId = `workflow-create-work-${now}`
  await request.onEvent?.({ type: 'workflow-agent.started', mode: 'create', workId, objective: request.prompt, timestamp: now })
  const response = await sendChatTurnWithConfiguredModel(request.modelConfig, {
    input: request.prompt,
    language: request.language,
    options: { temperature: 0.32 },
    messages: [{
      role: 'system',
      content: createWorkflowBuilderSystemPrompt(request.language),
    }],
  })
  const content = await ensureUsefulWorkflowBuilderResponse({
    text: response.content,
    label: 'Workflow builder',
    request,
    language: request.language,
    systemPrompt: createWorkflowBuilderSystemPrompt(request.language),
    sourceInput: request.prompt,
  })

  const spec = normalizeWorkflowBuilderSpec(content, request.prompt, request.language)
  const workflow = createStandardCharacterWorkflow({
    id: `character-workflow-${now}`,
    name: spec.name,
    language: request.language,
    llmApiId: request.llmApiId,
    llmModelName: request.llmModelName,
    imageApiId: request.imageApiId,
    imageModelName: request.imageModelName,
    now: request.now,
  })
  applySpecToWorkflow(workflow, spec)
  const validationSummary = validateCreatedCharacterWorkflow(workflow, spec, request.language)
  const agentWork: CharacterWorkflowEditorAgentWork = {
    id: workId,
    mode: 'create',
    objective: request.prompt,
    status: spec.status === 'blocked' ? 'blocked' : spec.status === 'needs-user' ? 'needs-user' : 'complete',
    plan: spec.plan,
    completedSteps: [
      request.language === 'zh-CN' ? '理解用户目标' : 'Understand user goal',
      request.language === 'zh-CN' ? '生成标准角色资源图配置' : 'Generate standard character workflow configuration',
      request.language === 'zh-CN' ? '校验必需资源链路' : 'Validate required resource links',
    ],
    currentStep: request.language === 'zh-CN' ? '完成初始资源图' : 'Finish initial resource graph',
    nextStep: spec.status === 'needs-user' ? spec.summary : undefined,
    steps: [
      createWorkflowAgentStep({
        now,
        index: 1,
        tool: 'inspect_graph',
        userRequest: request.prompt,
        summary: request.language === 'zh-CN' ? '已解析用户目标并确定角色资源图必须包含角色卡、开场、avatar 和 overview sheet。' : 'Parsed the user goal and identified required role card, opening, avatar, and overview sheet resources.',
        status: 'applied',
        plan: spec.plan,
        completedSteps: [],
        currentStep: request.language === 'zh-CN' ? '理解用户目标' : 'Understand user goal',
        nextStep: request.language === 'zh-CN' ? '生成资源图配置' : 'Generate workflow configuration',
      }),
      createWorkflowAgentStep({
        now,
        index: 2,
        tool: 'edit_graph',
        userRequest: request.prompt,
        summary: spec.summary,
        status: spec.status,
        plan: spec.plan,
        completedSteps: spec.plan.slice(0, 1),
        currentStep: request.language === 'zh-CN' ? '生成资源图配置' : 'Generate workflow configuration',
        nextStep: request.language === 'zh-CN' ? '校验资源图结构' : 'Validate workflow structure',
        operations: spec.operations,
        uiConfigOverrides: createUiConfigOverrides(spec),
      }),
      createWorkflowAgentStep({
        now,
        index: 3,
        tool: spec.status === 'needs-user' ? 'ask_user' : 'validate_graph',
        userRequest: request.prompt,
        summary: validationSummary,
        status: spec.status,
        plan: spec.plan,
        completedSteps: spec.plan,
        currentStep: request.language === 'zh-CN' ? '校验资源图结构' : 'Validate workflow structure',
        nextStep: spec.status === 'needs-user' ? spec.summary : undefined,
      }),
      createWorkflowAgentStep({
        now,
        index: 4,
        tool: spec.status === 'needs-user' ? 'ask_user' : 'finish',
        userRequest: request.prompt,
        summary: spec.status === 'needs-user'
          ? spec.summary
          : request.language === 'zh-CN' ? '初始角色资源图已准备好，可以继续编辑或运行生成。' : 'Initial character workflow is ready to edit or run.',
        status: spec.status,
        plan: spec.plan,
        completedSteps: spec.plan,
        currentStep: request.language === 'zh-CN' ? '完成初始资源图' : 'Finish initial resource graph',
      }),
    ],
    createdAt: now,
    updatedAt: now,
  }
  for (const step of agentWork.steps) {
    await request.onEvent?.({ type: 'workflow-agent.step', mode: 'create', workId, step, timestamp: step.createdAt })
  }
  await request.onEvent?.({ type: 'workflow-agent.completed', mode: 'create', work: agentWork, timestamp: agentWork.updatedAt })

  return {
    workflow,
    spec,
    uiConfigOverrides: createUiConfigOverrides(spec),
    agentWork,
  }
}

async function editCharacterWorkflowFromPrompt(
  request: CharacterWorkflowBuilderRequest & { prompt: string; language: CharacterWorkflowLanguage }
): Promise<CharacterWorkflowBuilderResult> {
  const graph = normalizeBuilderGraph(request.graph)
  if (!graph.nodes.length) {
    throw new Error('Workflow editor graph is empty')
  }
  const agentWork = await runCharacterWorkflowEditorAgent(request, graph)
  const lastStep = agentWork.steps[agentWork.steps.length - 1]
  const aggregateOperations = agentWork.steps.flatMap((step) => step.operations)
  const spec: CharacterWorkflowBuilderSpec = {
    name: lastStep?.currentStep || deriveName(request.prompt, request.language === 'zh-CN' ? '资源图修改' : 'Workflow Edit'),
    plan: agentWork.plan,
    completedSteps: agentWork.completedSteps,
    currentStep: agentWork.currentStep,
    nextStep: agentWork.nextStep,
    summary: summarizeEditorAgentWork(agentWork, request.language),
    confidence: agentWork.status === 'blocked' ? 0.3 : agentWork.status === 'needs-user' ? 0.55 : 0.82,
    status: agentWork.status === 'blocked' ? 'blocked' : agentWork.status === 'needs-user' ? 'needs-user' : 'applied',
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
    operations: aggregateOperations,
  }
  return {
    spec,
    uiConfigOverrides: mergeEditorStepOverrides(agentWork.steps),
    agentWork,
  }
}

async function runCharacterWorkflowEditorAgent(
  request: CharacterWorkflowBuilderRequest & { prompt: string; language: CharacterWorkflowLanguage },
  initialGraph: CharacterWorkflowBuilderGraph
): Promise<CharacterWorkflowEditorAgentWork> {
  const now = request.now ?? Date.now()
  const workId = `workflow-editor-work-${now}`
  const session = request.editorSession
  const objective = session?.objective?.trim() || request.prompt
  await request.onEvent?.({ type: 'workflow-agent.started', mode: 'edit', workId, objective, timestamp: now })
  let graph = initialGraph
  let plan = [...(session?.plan ?? [])]
  let completedSteps = [...(session?.completedSteps ?? [])]
  let currentStep = session?.currentStep
  let nextStep: string | undefined
  const steps: CharacterWorkflowEditorAgentStep[] = []
  const maxSteps = 4

  for (let index = 0; index < maxSteps; index += 1) {
    const stepSession: CharacterWorkflowEditorSession = {
      objective,
      plan,
      completedSteps,
      currentStep,
      history: [
        ...(session?.history ?? []),
        ...steps.map((step) => ({
          userRequest: step.userRequest,
          summary: step.summary,
          status: step.status,
          operations: step.operations.length,
        })),
      ],
    }
    const spec = await executeCharacterWorkflowEditorStep({
      ...request,
      prompt: index === 0 ? request.prompt : nextStep || request.prompt,
      editorSession: stepSession,
      graph,
    }, {
      stepIndex: index,
      maxSteps,
      objective,
    })
    const uiConfigOverrides = createEditorUiConfigOverrides(spec, graph)
    const step: CharacterWorkflowEditorAgentStep = {
      id: `workflow-editor-step-${now}-${index + 1}`,
      index: index + 1,
      tool: spec.status === 'needs-user' ? 'ask_user' : spec.status === 'blocked' ? 'validate_graph' : 'edit_graph',
      userRequest: index === 0 ? request.prompt : nextStep || request.prompt,
      summary: spec.summary,
      status: spec.status,
      plan: spec.plan,
      completedSteps: spec.completedSteps ?? [],
      currentStep: spec.currentStep,
      nextStep: spec.nextStep,
      operations: spec.operations,
      uiConfigOverrides,
      createdAt: now + index,
    }
    steps.push(step)
    await request.onEvent?.({ type: 'workflow-agent.step', mode: 'edit', workId, step, timestamp: step.createdAt })
    plan = step.plan.length ? step.plan : plan
    completedSteps = step.completedSteps.length ? step.completedSteps : completedSteps
    currentStep = step.currentStep
    nextStep = step.nextStep
    graph = applyEditorOperationsToGraph(graph, step.operations)

    if (step.status === 'blocked' || step.status === 'needs-user') {
      break
    }
    if (!step.operations.length || !step.nextStep?.trim()) {
      break
    }
  }

  const lastStep = steps[steps.length - 1]
  const exhausted = steps.length >= maxSteps && Boolean(lastStep?.nextStep?.trim())
  const status: CharacterWorkflowEditorAgentWork['status'] = lastStep?.status === 'blocked'
    ? 'blocked'
    : lastStep?.status === 'needs-user'
      ? 'needs-user'
      : exhausted
        ? 'needs-user'
      : lastStep?.nextStep?.trim()
        ? 'active'
        : 'complete'
  const work: CharacterWorkflowEditorAgentWork = {
    id: workId,
    mode: 'edit',
    objective,
    status,
    plan,
    completedSteps,
    currentStep,
    nextStep: status === 'complete' ? undefined : nextStep,
    steps,
    createdAt: now,
    updatedAt: Date.now(),
  }
  await request.onEvent?.({ type: 'workflow-agent.completed', mode: 'edit', work, timestamp: work.updatedAt })
  return work
}

async function executeCharacterWorkflowEditorStep(
  request: CharacterWorkflowBuilderRequest & { prompt: string; language: CharacterWorkflowLanguage },
  runtime: { stepIndex: number; maxSteps: number; objective: string }
): Promise<CharacterWorkflowBuilderSpec> {
  const graph = normalizeBuilderGraph(request.graph)
  if (!graph.nodes.length) {
    throw new Error('Workflow editor graph is empty')
  }
  const response = await sendChatTurnWithConfiguredModel(request.modelConfig, {
    input: JSON.stringify({
      objective: runtime.objective,
      userRequest: request.prompt,
      editorSession: request.editorSession ?? null,
      runtime: {
        stepIndex: runtime.stepIndex + 1,
        maxSteps: runtime.maxSteps,
        remainingSteps: Math.max(0, runtime.maxSteps - runtime.stepIndex - 1),
      },
      graph,
    }),
    language: request.language,
    options: { temperature: 0.24 },
    messages: [{
      role: 'system',
      content: createWorkflowEditorSystemPrompt(request.language),
    }],
  })
  const content = await ensureUsefulWorkflowBuilderResponse({
    text: response.content,
    label: 'Workflow editor',
    request,
    language: request.language,
    systemPrompt: createWorkflowEditorSystemPrompt(request.language),
    sourceInput: JSON.stringify({
      objective: runtime.objective,
      userRequest: request.prompt,
      editorSession: request.editorSession ?? null,
      runtime: {
        stepIndex: runtime.stepIndex + 1,
        maxSteps: runtime.maxSteps,
      },
      graph,
    }),
    requireEditableOperations: true,
  })

  return normalizeWorkflowEditorSpec(content, request.prompt, request.language, graph)
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
    operations: sanitizeWorkflowBuilderOperations(operationList(parsed?.operations), { nodes: [], edges: [] }),
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
  const mergedUpdates = Object.fromEntries(Object.entries(directUpdates).slice(0, 6))
  const mergedOperations = sanitizeWorkflowBuilderOperations([
    ...Object.entries(mergedUpdates).map(([nodeId, config]) => ({
      type: 'update-node-config' as const,
      nodeId,
      config,
    })),
    ...operations,
  ], normalizedGraph).slice(0, 4)
  return {
    name: stringValue(parsed, 'name') || deriveName(fallbackPrompt, fallbackName),
    plan: stringList(parsed, 'plan', []),
    completedSteps: stringList(parsed, 'completedSteps', []),
    currentStep: stringValue(parsed, 'currentStep'),
    nextStep: stringValue(parsed, 'nextStep'),
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
      includeSupportFields: ['appearancePrompt'],
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
    'avatar-image-target': {
      imageRole: 'avatar',
      assetPurpose: 'Final avatar.jpg for the role card: one polished single-character role-card portrait with one clear face, visible body silhouette, strong appeal, and stable appearancePrompt identity.',
    },
    'avatar-image-control': {
      targetImageCount: 1,
      imageStyleDomain: 'auto',
      stylePrompt: spec.stylePrompt,
      shotType: 'knee-up',
      consistencyMode: 'same-character',
      seedMode: 'lock-character',
    },
    'overview-sheet-image-target': {
      imageRole: 'character-overview-sheet',
      assetPurpose: 'Large production character overview sheet using linked avatar reference image inputs. Required contents: full-body front view, full-body back view, side or three-quarter view, one main portrait or half-body crop, 3 expression callouts, eye close-up, nose and mouth close-up, hairstyle detail, hand pose detail, leg shape close-up, hip and rear silhouette close-up, feet or shoes detail, outfit fabric, accessory, hemline, and silhouette details. Preserve avatar outfit construction unless explicitly requesting outfit variants. No written labels.',
    },
    'overview-sheet-image-control': {
      targetImageCount: 1,
      imageStyleDomain: 'auto',
      stylePrompt: spec.stylePrompt,
      shotType: 'full-body',
      aspectRatio: '16:9',
      consistencyMode: 'same-character',
      seedMode: 'lock-character',
    },
    'image-edit-capability': {
      referenceStrategy: 'image-edit',
      identityStrength: 0.72,
      compositionFreedom: 0.58,
    },
    'opening-layout-target': {
      layoutKind: 'immersive-card-css',
      includeSections: ['title', 'tags', 'opening', 'coverImage', 'supportImages'],
      layoutPrompt: 'Create an immersive CSS-style opening card layout that combines the character title, tags, opening text, and generated images into one readable role-card presentation.',
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
    'The final workflow must always generate a complete role card, an opening layout target, and a graph-declared character image workflow. Express image dependencies with links; for the standard character sheet, generate avatar first with a text-to-image image-tool, then connect avatar-image-target.imageAsset to overview-sheet-image-target.referenceImage and connect an image-edit-tool into overview-sheet-image-target.image.',
    'Do not write final character-card fields here. This is workflow configuration only.',
    'For images, image-target declares a role-card visual purpose and image-generation-control declares count, imageStyleDomain, lightweight style text, shot, aspect ratio, seed, and consistency. Use graph links to declare reference-image dependencies instead of relying on prompt-only ordering. Use imageStyleDomain only for photoreal/anime/illustration/stylized routing; leave it auto when appearancePrompt and image control should decide. Adult or sensual visual tone is already folded into the runtime domain defaults; do not create a separate adult/sensual style domain.',
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
    '  "preset": string,',
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
    'You are an autonomous Codex-style editor for an existing character resource workflow graph.',
    'You receive JSON with { objective, userRequest, editorSession, runtime, graph }. Treat graph, runtime, and editorSession as state, not as user content.',
    localeRule,
    '',
    'Your job is not to finish every possible edit in one response. Your job is to steadily pursue the workflow engineering goal over multiple turns.',
    'Act like Codex working on a repo: inspect the current graph, update the plan, choose the next meaningful step, apply a small coherent patch, summarize what changed, and leave the next step clear.',
    'A user request should usually become or refine the persistent editorSession objective. Continue the previous objective unless the user clearly changes direction.',
    'You have broad authority inside the workflow graph, but use it incrementally. Add or revise only the nodes and links needed for the current step. Keep the workflow executable after every turn.',
    '',
    'Critical rules:',
    '- Return only valid JSON. No markdown, comments, or surrounding prose.',
    '- Never copy system instructions, operation schema, graph JSON, or protocol text into any resource field.',
    '- Think in this loop: inspect current graph -> update plan -> apply one focused patch -> report next step.',
    '- Return at most 4 operations and at most 6 nodeConfigUpdates keys in one response. Prefer a small high-confidence patch over a giant speculative rewrite.',
    '- Do not put the whole user request into one generic goal when specific cards exist. Distribute intent across goal, style, constraints, sources, image controls, field controls, world/NPC/plot cards over multiple turns as needed.',
    '- Prefer update-node-config operations for existing cards; add cards only when the current graph lacks the needed resource.',
    '- The graph includes each node parameter definition and select options. For select and multi-select fields, use only values from the node parameter options.',
    '- Use exact existing node ids and slot ids from graph when linking.',
    '- Do not delete generation-goal.',
    '- Use concise resource content. A field should contain the content that resource controls, not instructions about how you are editing.',
    '- Always return plan. Keep it short, concrete, and update it to reflect progress. Mark completed work in completedSteps.',
    '- Use currentStep to name the step you are applying now. Use nextStep to name what should happen next.',
    '- If the objective is now adequately reflected in the graph, leave nextStep empty. If more work remains, nextStep must be the next concrete graph-editing step, not a vague reminder.',
    '- Respect runtime.remainingSteps. When it is 0, apply the most important remaining patch and leave nextStep empty unless user input is truly required.',
    '- If the request is underspecified but still workable, make reasonable creative decisions and set status to "applied". Ask for the user only when the next graph edit cannot be chosen safely.',
    '',
    'Resource guidance:',
    '- generation-goal.goalPrompt: compact generation objective only.',
    '- style-pressure.preset: choose a prose/RP style preset such as plain-natural-rp, immersive-second-person, slow-burn-romance, hurt-comfort, gothic-romance-prose, dark-adult-drama, cyberpunk-noir, psychological-thriller, sillytavern-natural-card, ali-chat-dialogue-samples, or longform-novelistic-rp.',
    '- style-pressure.stylePrompt: concrete English prose control text covering tone, genre texture, relationship flavor, sentence rhythm, narration style, and roleplay pacing.',
    '- hard-constraints.mustHave/mustNot: hard requirements and boundaries.',
    '- source-material.notes: concrete story material, setting facts, character seeds, world facts.',
    '- field-generation-control.fieldPurpose: local intent for one text field such as firstMessage/opening/dialogue style.',
    '- opening-layout-target: use this for the CSS/HTML-style role-card opening presentation that combines title, tags, opening text, and generated images.',
    '- image-target.imageRole: choose the role-card visual purpose from options such as avatar, character-overview-sheet, hero-cover, full-body, opening-moment, story-moment, expression, outfit-detail, relationship-moment, or world-context. Do not use scene as a standalone image type.',
    '- image-target.assetPurpose: what this exact image should communicate and which story/text field it supports.',
    '- image-generation-control: image count, imageStyleDomain, concise stylePrompt, shotType, aspectRatio, consistencyMode, seedMode. Use imageStyleDomain only for photoreal/anime/illustration/stylized routing; use auto when appearancePrompt and image control should decide. Adult or sensual visual tone is part of the runtime domain defaults. Never create a new sensual style domain, never infer additional sensual styling from unrelated role text, and never put imageType or composition here.',
    '- For character resources, prefer graph-declared asset dependencies: link avatar-image-target.imageAsset into overview-sheet-image-target.referenceImage when the overview should preserve the avatar identity. Targets with referenceImage inputs should use image-edit-tool instead of the first-pass image-tool. Additional pictures should be separate image-target nodes when they serve different card/story purposes, and/or image-generation-control.targetImageCount for variants.',
    '- Do not connect hard-constraint nodes directly into image-target. Keep image-specific exclusions in the constraint node or the target purpose; image controls should stay lightweight.',
    '- world-card-target / npc-pack-target / npc-target / plot-arc-target / scene-card-target: add these when the request asks for multi-NPC, world, setting, story arc, or scene planning.',
    '',
    'Valid node types:',
    'goal, character-card-target, character-field-target, opening-layout-target, image-target, world-card-target, npc-pack-target, npc-target, plot-arc-target, scene-card-target, style-pressure, constraint, image-generation-control, field-generation-control, continuity-control, relationship-control, source-material, llm-tool, image-tool, image-edit-tool, retrieval-tool, voice-tool, agent-policy, generation-strategy, critique-loop, quality-gate, output-adapter.',
    '',
    'Valid link kinds:',
    'guides, constrains, provides, enables, grounds, weights, routes, evaluates, refines, exports.',
    '',
    'Return the smallest valid JSON object that can perform the edit:',
    '{',
    '  "name"?: string,',
    '  "summary": string,',
    '  "plan": string[],',
    '  "completedSteps"?: string[],',
    '  "currentStep"?: string,',
    '  "nextStep"?: string,',
    '  "confidence"?: number,',
    '  "status": "applied" | "needs-user" | "blocked",',
    '  "nodeConfigUpdates"?: { [nodeId: string]: object },',
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
    '',
    'For ordinary field edits, prefer nodeConfigUpdates to save tokens. Use operations for add/move/delete/select/link actions.',
  ].join('\n')
}

function summarizeEditorAgentWork(
  work: CharacterWorkflowEditorAgentWork,
  language: CharacterWorkflowLanguage
): string {
  const zh = language === 'zh-CN'
  const summaries = work.steps.map((step) => step.summary).filter(Boolean)
  const editCount = work.steps.reduce((total, step) => total + step.operations.length + Object.keys(step.uiConfigOverrides).length, 0)
  const prefix = zh
    ? `Agent 已执行 ${work.steps.length} 个步骤，应用 ${editCount} 项资源图修改。`
    : `Agent ran ${work.steps.length} steps and applied ${editCount} workflow edits.`
  return [prefix, ...summaries.slice(-3)].join(zh ? '\n' : '\n')
}

function createWorkflowAgentStep(options: {
  now: number
  index: number
  tool: CharacterWorkflowAgentToolAction
  userRequest: string
  summary: string
  status: CharacterWorkflowBuilderSpec['status']
  plan: string[]
  completedSteps: string[]
  currentStep?: string
  nextStep?: string
  operations?: CharacterWorkflowBuilderOperation[]
  uiConfigOverrides?: Record<string, Record<string, unknown>>
}): CharacterWorkflowEditorAgentStep {
  return {
    id: `workflow-agent-step-${options.now}-${options.index}`,
    index: options.index,
    tool: options.tool,
    userRequest: options.userRequest,
    summary: options.summary,
    status: options.status,
    plan: options.plan,
    completedSteps: options.completedSteps,
    currentStep: options.currentStep,
    nextStep: options.nextStep,
    operations: options.operations ?? [],
    uiConfigOverrides: options.uiConfigOverrides ?? {},
    createdAt: options.now + options.index,
  }
}

function validateCreatedCharacterWorkflow(
  workflow: CharacterWorkflow,
  spec: CharacterWorkflowBuilderSpec,
  language: CharacterWorkflowLanguage
): string {
  const requiredNodeIds = [
    'generation-goal',
    'character-card-target',
    'opening-field-target',
    'avatar-image-target',
    'avatar-image-control',
    'overview-sheet-image-target',
    'overview-sheet-image-control',
    'image-edit-capability',
    'opening-layout-target',
    'quality-gate',
    'output-adapter',
  ]
  const missing = requiredNodeIds.filter((id) => !workflow.nodes.some((node) => node.id === id))
  const hasAvatarLink = workflow.edges.some((edge) => edge.from.nodeId === 'avatar-image-target' || edge.to.nodeId === 'avatar-image-target')
  const hasOverviewLink = workflow.edges.some((edge) => edge.from.nodeId === 'overview-sheet-image-target' || edge.to.nodeId === 'overview-sheet-image-target')
  const issues = [
    ...missing.map((id) => `missing node ${id}`),
    ...(hasAvatarLink ? [] : ['avatar image target is not linked']),
    ...(hasOverviewLink ? [] : ['overview sheet image target is not linked']),
    ...(spec.outputFormat === 'noema-role-chat' ? [] : ['output format is not noema-role-chat']),
  ]
  if (!issues.length) {
    return language === 'zh-CN'
      ? '资源图结构校验通过：角色卡、开场白、avatar.jpg、overview sheet、质量门和导出链路均已配置。'
      : 'Workflow structure validated: role card, opening, avatar.jpg, overview sheet, quality gate, and export path are configured.'
  }
  return language === 'zh-CN'
    ? `资源图结构存在问题：${issues.join('；')}`
    : `Workflow structure has issues: ${issues.join('; ')}`
}

function mergeEditorStepOverrides(
  steps: CharacterWorkflowEditorAgentStep[]
): Record<string, Record<string, unknown>> {
  const merged: Record<string, Record<string, unknown>> = {}
  for (const step of steps) {
    for (const [nodeId, config] of Object.entries(step.uiConfigOverrides)) {
      merged[nodeId] = {
        ...(merged[nodeId] ?? {}),
        ...config,
      }
    }
  }
  return merged
}

function applyEditorOperationsToGraph(
  graph: CharacterWorkflowBuilderGraph,
  operations: CharacterWorkflowBuilderOperation[]
): CharacterWorkflowBuilderGraph {
  let next = normalizeBuilderGraph(graph)
  for (const operation of operations) {
    if (operation.type === 'add-node') {
      const nodeId = operation.nodeId?.trim() || `${operation.nodeType}-${next.nodes.length + 1}`
      if (!next.nodes.some((node) => node.id === nodeId)) {
        const definition = STANDARD_CHARACTER_WORKFLOW_NODE_DEFINITIONS.find((item) => item.type === operation.nodeType)
        next = {
          ...next,
          selectedNodeId: nodeId,
          nodes: [
            ...next.nodes,
            {
              id: nodeId,
              type: operation.nodeType,
              title: operation.title || definition?.title || operation.nodeType,
              config: sanitizeResourceConfigForNode(operation.nodeType, operation.config ?? {}),
              inputs: Object.keys(definition?.inputs ?? {}),
              outputs: Object.keys(definition?.outputs ?? {}),
            },
          ],
        }
      }
    } else if (operation.type === 'update-node-config') {
      next = {
        ...next,
        selectedNodeId: operation.nodeId,
        nodes: next.nodes.map((node) => (
          node.id === operation.nodeId
            ? {
                ...node,
                config: {
                  ...(node.config ?? {}),
                  ...sanitizeResourceConfigForNode(node.type, operation.config),
                },
              }
            : node
        )),
      }
    } else if (operation.type === 'delete-node') {
      if (operation.nodeId === 'generation-goal') {
        continue
      }
      next = {
        ...next,
        selectedNodeId: next.selectedNodeId === operation.nodeId ? 'generation-goal' : next.selectedNodeId,
        nodes: next.nodes.filter((node) => node.id !== operation.nodeId),
        edges: next.edges.filter((edge) => edge.from.nodeId !== operation.nodeId && edge.to.nodeId !== operation.nodeId),
      }
    } else if (operation.type === 'select-node') {
      next = { ...next, selectedNodeId: operation.nodeId }
    } else if (operation.type === 'add-link') {
      const linkId = `${operation.sourceNodeId}:${operation.sourceSlotId}->${operation.targetNodeId}:${operation.targetSlotId}`
      if (!next.edges.some((edge) => edge.id === linkId)) {
        next = {
          ...next,
          edges: [
            ...next.edges,
            {
              id: linkId,
              from: { nodeId: operation.sourceNodeId, port: operation.sourceSlotId },
              to: { nodeId: operation.targetNodeId, port: operation.targetSlotId },
              kind: operation.kind ?? 'guides',
            },
          ],
        }
      }
    } else if (operation.type === 'delete-link') {
      const linkId = operation.linkId || `${operation.sourceNodeId ?? ''}:${operation.sourceSlotId ?? ''}->${operation.targetNodeId ?? ''}:${operation.targetSlotId ?? ''}`
      next = {
        ...next,
        edges: next.edges.filter((edge) => edge.id !== linkId),
      }
    }
  }
  return next
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
    includeSupportFields: ['appearancePrompt'],
  })
  byType.get('character-field-target')?.config && Object.assign(byType.get('character-field-target')!.config, {
    field: 'firstMessage',
  })
  byType.get('field-generation-control')?.config && Object.assign(byType.get('field-generation-control')!.config, {
    fieldPurpose: spec.stylePrompt,
    tone: '',
    avoidPatterns: spec.mustNot,
  })
  const avatarTarget = workflow.nodes.find((node) => node.id === 'avatar-image-target')
  avatarTarget?.config && Object.assign(avatarTarget.config, {
    imageRole: 'avatar',
    assetPurpose: [
      'Generate one final avatar.jpg for the role card.',
      'Quality should match a polished production character avatar: one single-character role-card portrait, one clear face, visible body silhouette, strong appeal, and stable appearancePrompt identity.',
    ].join(' '),
  })
  const avatarControl = workflow.nodes.find((node) => node.id === 'avatar-image-control')
  avatarControl?.config && Object.assign(avatarControl.config, {
    targetImageCount: 1,
    imageStyleDomain: 'auto',
    stylePrompt: spec.stylePrompt,
    shotType: 'knee-up',
    consistencyMode: 'same-character',
    seedMode: 'lock-character',
  })
  const overviewTarget = workflow.nodes.find((node) => node.id === 'overview-sheet-image-target')
  overviewTarget?.config && Object.assign(overviewTarget.config, {
    imageRole: 'character-overview-sheet',
    assetPurpose: [
      'Generate one very large production character overview sheet using linked avatar reference image inputs for identity preservation.',
      'Required contents: full-body front view, full-body back view, side or three-quarter view, one main portrait or half-body crop, 3 expression callouts, eye close-up, nose and mouth close-up, hairstyle detail, hand pose detail, leg shape close-up, hip and rear silhouette close-up, feet or shoes detail, outfit fabric, accessory, hemline, and silhouette details.',
      'Preserve the avatar outfit construction unless this target explicitly requests outfit variants.',
      'The sheet is for production reference, not a social cover, and must not contain written labels.',
    ].join(' '),
  })
  const overviewControl = workflow.nodes.find((node) => node.id === 'overview-sheet-image-control')
  overviewControl?.config && Object.assign(overviewControl.config, {
    targetImageCount: 1,
    imageStyleDomain: 'auto',
    stylePrompt: spec.stylePrompt,
    shotType: 'full-body',
    aspectRatio: '16:9',
    consistencyMode: 'same-character',
    seedMode: 'lock-character',
  })
  byType.get('opening-layout-target')?.config && Object.assign(byType.get('opening-layout-target')!.config, {
    layoutKind: 'immersive-card-css',
    includeSections: ['title', 'tags', 'opening', 'coverImage', 'supportImages'],
    layoutPrompt: 'Create an immersive CSS-style opening card layout that combines the character title, tags, opening text, and generated images into one readable role-card presentation.',
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
  const jsonText = extractJsonObjectText(text)
  if (!jsonText) {
    return {}
  }
  try {
    const parsed = JSON.parse(jsonText)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function extractJsonObjectText(text: string): string {
  const trimmed = text.trim()
  const start = trimmed.indexOf('{')
  if (start < 0) {
    return ''
  }
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
    if (inString) {
      continue
    }
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return trimmed.slice(start, index + 1)
      }
    }
  }
  return ''
}

async function ensureUsefulWorkflowBuilderResponse(options: {
  text: string
  label: string
  request: Pick<CharacterWorkflowBuilderRequest, 'modelConfig' | 'prompt'>
  language: CharacterWorkflowLanguage
  systemPrompt: string
  sourceInput: string
  requireEditableOperations?: boolean
}): Promise<string> {
  let content = options.text
  let parsed = parseJsonObject(content)
  if (!Object.keys(parsed).length) {
    content = await repairWorkflowBuilderJson(options)
    parsed = parseJsonObject(content)
  }
  if (!Object.keys(parsed).length) {
    throw new Error(`${options.label} did not return valid editable JSON. Model response: ${options.text.trim().slice(0, 500)}`)
  }
  if (stringValue(parsed, 'status') === 'blocked') {
    throw new Error(stringValue(parsed, 'summary') || `${options.label} reported that the request is blocked.`)
  }
  if (options.requireEditableOperations && stringValue(parsed, 'status') !== 'needs-user' && !hasWorkflowEditorEdits(parsed)) {
    throw new Error(`${options.label} returned valid JSON but no editable graph operations.`)
  }
  return content
}

async function repairWorkflowBuilderJson(options: {
  text: string
  label: string
  request: Pick<CharacterWorkflowBuilderRequest, 'modelConfig' | 'prompt'>
  language: CharacterWorkflowLanguage
  systemPrompt: string
  sourceInput: string
}): Promise<string> {
  const response = await sendChatTurnWithConfiguredModel(options.request.modelConfig, {
    input: [
      'The previous response was not valid JSON and could not be parsed.',
      'Rewrite it as one complete valid JSON object matching the required schema.',
      'Preserve the intended edits. Do not add markdown, comments, explanations, or code fences.',
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
    options: { temperature: 0 },
    messages: [{
      role: 'system',
      content: options.systemPrompt,
    }],
  })
  return response.content
}

function hasWorkflowEditorEdits(parsed: Record<string, unknown>): boolean {
  if (operationList(parsed.operations).length > 0) {
    return true
  }
  return Object.keys(recordMapValue(parsed, 'nodeConfigUpdates')).length > 0
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
  const definition = STANDARD_CHARACTER_WORKFLOW_NODE_DEFINITIONS.find((item) => item.type === type)
  if (!definition) return config
  const parameters = new Map(definition.parameters.map((parameterItem) => [parameterItem.id, parameterItem]))
  return Object.fromEntries(Object.entries(config).flatMap(([key, value]) => {
    const parameterItem = parameters.get(key)
    if (!parameterItem) return []
    const sanitized = sanitizeWorkflowParameterValue(parameterItem, value)
    return sanitized === undefined ? [] : [[key, sanitized]]
  }))
}

function sanitizeWorkflowBuilderOperations(
  operations: CharacterWorkflowBuilderOperation[],
  graph: CharacterWorkflowBuilderGraph
): CharacterWorkflowBuilderOperation[] {
  const nodeTypes = new Map(graph.nodes.map((node) => [node.id, node.type]))
  return operations.flatMap((operation): CharacterWorkflowBuilderOperation[] => {
    if (operation.type === 'add-node') {
      const config = sanitizeResourceConfigForNode(operation.nodeType, operation.config ?? {})
      return [{ ...operation, config }]
    }
    if (operation.type === 'update-node-config') {
      const config = sanitizeResourceConfigForNode(nodeTypes.get(operation.nodeId), operation.config)
      return Object.keys(config).length ? [{ ...operation, config }] : []
    }
    return [operation]
  })
}

function sanitizeWorkflowParameterValue(
  parameterItem: CharacterWorkflowNodeParameter,
  value: unknown
): unknown {
  if (parameterItem.type === 'select' || parameterItem.type === 'model-select') {
    if (typeof value !== 'string') return undefined
    if (!parameterItem.options?.length) return value
    return parameterItem.options.some((optionItem) => optionItem.value === value) ? value : undefined
  }
  if (parameterItem.type === 'multi-select') {
    const values = Array.isArray(value)
      ? value.map((item) => String(item).trim()).filter(Boolean)
      : typeof value === 'string'
        ? value.split(',').map((item) => item.trim()).filter(Boolean)
        : []
    if (!values.length) return undefined
    if (!parameterItem.options?.length) return values
    const allowed = new Set(parameterItem.options.map((optionItem) => optionItem.value))
    const filtered = values.filter((item) => allowed.has(item))
    return filtered.length ? filtered : undefined
  }
  return value
}

function isCharacterNodeType(value: string): value is CharacterNodeType {
  return new Set<string>([
    'goal',
    'character-card-target',
    'character-field-target',
    'opening-layout-target',
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
    'image-edit-tool',
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
    priorityAssets: ['opening-layout', 'image-pack'].reduce(
      (assets, asset) => assets.includes(asset) ? assets : [...assets, asset],
      priorityAssets
    ),
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
