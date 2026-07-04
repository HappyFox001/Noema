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
  nextStep?: string
  history?: Array<{
    stepIndex?: number
    tool?: string
    userRequest?: string
    summary?: string
    status?: string
    operations?: number
    currentStep?: string
    nextStep?: string
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
  parameters?: CharacterWorkflowBuilderGraphNodeParameter[]
}

export interface CharacterWorkflowBuilderGraphNodeParameter {
  id: string
  type?: string
  defaultValue?: unknown
  options?: Array<{ value: string; label: string }>
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
  status: 'applied' | 'needs-user' | 'blocked' | 'complete'
  decision?: CharacterWorkflowAgentDecision
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
  decision?: CharacterWorkflowAgentDecision
  steps: CharacterWorkflowEditorAgentStep[]
  createdAt: number
  updatedAt: number
}

export interface CharacterWorkflowAgentDecisionOption {
  id: string
  label: string
  detail?: string
  patchHint?: string
}

export interface CharacterWorkflowAgentDecision {
  id: string
  title: string
  description?: string
  options: CharacterWorkflowAgentDecisionOption[]
  defaultOptionId?: string
  allowSkip?: boolean
}

export interface CharacterWorkflowEditorAgentStep {
  id: string
  index: number
  tool: CharacterWorkflowAgentToolAction
  userRequest: string
  summary: string
  status: CharacterWorkflowBuilderSpec['status']
  plan: string[]
  completedSteps: string[]
  currentStep?: string
  nextStep?: string
  decision?: CharacterWorkflowAgentDecision
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
const DEFAULT_ASSET_TARGETS = ['role-card', 'opening', 'opening-layout', 'atmosphere-style', 'image-pack', 'generation-report']
const WORKFLOW_AGENT_DEFAULT_REVISION_BUDGET = 12
const WORKFLOW_EDITOR_DEFAULT_EDIT_TURNS = WORKFLOW_AGENT_DEFAULT_REVISION_BUDGET
const WORKFLOW_EDITOR_MIN_EDIT_TURNS = 3
const WORKFLOW_EDITOR_MAX_EDIT_TURNS = 24
const WORKFLOW_EDITOR_MAX_OPERATIONS_PER_STEP = 8
const WORKFLOW_EDITOR_MAX_NODE_CONFIG_UPDATES_PER_STEP = 10

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
  const workflowName = deriveName(request.prompt, request.language === 'zh-CN' ? '角色资源图' : 'Character Resource Graph')
  const workflow = createStandardCharacterWorkflow({
    id: `character-workflow-${now}`,
    name: workflowName,
    language: request.language,
    llmApiId: request.llmApiId,
    llmModelName: request.llmModelName,
    imageApiId: request.imageApiId,
    imageModelName: request.imageModelName,
    now: request.now,
  })
  alignWorkflowBuilderNodeIds(workflow)
  const graph = createBuilderGraphFromWorkflow(workflow)
  const agentWork = await runCharacterWorkflowEditorAgent(request, graph, { mode: 'create' })
  const spec = createCharacterWorkflowSpecFromAgentWork(request, agentWork, 'create')

  return {
    workflow,
    spec,
    uiConfigOverrides: mergeEditorStepOverrides(agentWork.steps),
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
  const agentWork = await runCharacterWorkflowEditorAgent(request, graph, { mode: 'edit' })
  const spec = createCharacterWorkflowSpecFromAgentWork(request, agentWork, 'edit')
  return {
    spec,
    uiConfigOverrides: mergeEditorStepOverrides(agentWork.steps),
    agentWork,
  }
}

async function runCharacterWorkflowEditorAgent(
  request: CharacterWorkflowBuilderRequest & { prompt: string; language: CharacterWorkflowLanguage },
  initialGraph: CharacterWorkflowBuilderGraph,
  options: { mode: 'create' | 'edit' } = { mode: 'edit' }
): Promise<CharacterWorkflowEditorAgentWork> {
  const now = request.now ?? Date.now()
  const mode = options.mode
  const workId = `workflow-${mode}-work-${now}`
  const session = request.editorSession
  const objective = session?.objective?.trim() || request.prompt
  const stepOffset = getWorkflowEditorSessionStepOffset(session)
  await request.onEvent?.({ type: 'workflow-agent.started', mode, workId, objective, timestamp: now })
  let graph = normalizeBuilderGraph(initialGraph)
  let plan = [...(session?.plan ?? [])]
  let completedSteps = [...(session?.completedSteps ?? [])]
  let currentStep = session?.currentStep
  let nextStep: string | undefined = request.prompt
  const steps: CharacterWorkflowEditorAgentStep[] = []
  const maxSteps = getWorkflowEditorMaxSteps(graph)
  const emitStep = async (step: CharacterWorkflowEditorAgentStep) => {
    steps.push(step)
    await request.onEvent?.({ type: 'workflow-agent.step', mode, workId, step, timestamp: step.createdAt })
    plan = step.plan.length ? step.plan : plan
    completedSteps = step.completedSteps.length ? step.completedSteps : completedSteps
    currentStep = step.currentStep || currentStep
    nextStep = step.nextStep
  }

  const inspection = inspectWorkflowEditorGraph(graph, objective, request.language, mode)
  plan = plan.length ? plan : inspection.plan
  currentStep = currentStep || inspection.currentStep
  nextStep = nextStep?.trim() ? nextStep : inspection.nextStep

  while (steps.length < maxSteps) {
    const stepSession: CharacterWorkflowEditorSession = {
      objective,
      plan,
      completedSteps,
      history: [
        ...(session?.history ?? []).map(sanitizeWorkflowEditorHistoryForModel),
        ...steps.map(createWorkflowEditorHistoryEntryForModel),
      ],
    }
    const editStepIndex = steps.filter((item) => item.tool === 'edit_graph').length
    const userRequest = nextStep?.trim() || request.prompt
    const spec = await executeCharacterWorkflowEditorStep({
      ...request,
      prompt: userRequest,
      editorSession: stepSession,
      graph,
    }, {
      stepIndex: editStepIndex,
      globalStepIndex: stepOffset + steps.length + 1,
      previousStepCount: stepOffset,
      objective,
      mode,
    })
    const uiConfigOverrides = createEditorUiConfigOverrides(spec, graph)
    const step = createWorkflowAgentStep({
      now,
      index: stepOffset + steps.length + 1,
      tool: spec.status === 'needs-user' ? 'ask_user' : spec.status === 'complete' ? 'finish' : 'edit_graph',
      userRequest,
      summary: spec.summary,
      status: spec.status,
      plan: spec.plan,
      completedSteps: spec.completedSteps ?? [],
      currentStep: spec.currentStep,
      nextStep: spec.nextStep,
      decision: spec.decision,
      operations: spec.operations,
      uiConfigOverrides,
    })
    await emitStep(step)
    graph = applyEditorOperationsToGraph(graph, step.operations)

    if (step.status === 'blocked' || step.status === 'needs-user') {
      break
    }

    if (step.status === 'complete') {
      const validation = validateWorkflowEditorGraph(graph, objective, request.language, mode)
      if (validation.complete) {
        completedSteps = validation.completedSteps.length
          ? mergeUniqueStrings(completedSteps, validation.completedSteps)
          : completedSteps
        currentStep = validation.currentStep
        nextStep = undefined
        break
      }
      currentStep = validation.currentStep
      nextStep = validation.nextStep || createWorkflowEditorContinuationStep(objective, request.language, mode)
      continue
    }

    if (!step.nextStep?.trim()) {
      nextStep = createWorkflowEditorContinuationStep(objective, request.language, mode)
    }
  }

  const lastStep = steps[steps.length - 1]
  const exhausted = steps.length >= maxSteps && Boolean(nextStep?.trim())
  const status: CharacterWorkflowEditorAgentWork['status'] = lastStep?.status === 'blocked'
    ? 'blocked'
    : lastStep?.status === 'needs-user'
      ? 'needs-user'
      : lastStep?.status === 'complete' && !nextStep?.trim()
        ? 'complete'
        : exhausted
          ? 'active'
          : nextStep?.trim()
            ? 'active'
            : 'complete'
  const work: CharacterWorkflowEditorAgentWork = {
    id: workId,
    mode,
    objective,
    status,
    plan,
    completedSteps,
    currentStep,
    nextStep: status === 'complete' ? undefined : nextStep,
    decision: lastStep?.status === 'needs-user' ? lastStep.decision : undefined,
    steps,
    createdAt: now,
    updatedAt: Date.now(),
  }
  await request.onEvent?.({ type: 'workflow-agent.completed', mode, work, timestamp: work.updatedAt })
  return work
}

async function executeCharacterWorkflowEditorStep(
  request: CharacterWorkflowBuilderRequest & { prompt: string; language: CharacterWorkflowLanguage },
  runtime: { stepIndex: number; globalStepIndex: number; previousStepCount: number; objective: string; mode: 'create' | 'edit' }
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
        mode: runtime.mode,
        tool: 'edit_graph',
        stepIndex: runtime.stepIndex + 1,
        globalStepIndex: runtime.globalStepIndex,
        previousStepCount: runtime.previousStepCount,
      },
      graph,
    }),
    language: request.language,
    options: { temperature: 0.24, max_tokens: 5000 },
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
        mode: runtime.mode,
        tool: 'edit_graph',
        stepIndex: runtime.stepIndex + 1,
        globalStepIndex: runtime.globalStepIndex,
        previousStepCount: runtime.previousStepCount,
      },
      graph,
    }),
    requireEditableOperations: true,
  })

  return normalizeWorkflowEditorSpec(content, request.prompt, request.language, graph)
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
  const mergedUpdates = Object.fromEntries(Object.entries(directUpdates).slice(0, WORKFLOW_EDITOR_MAX_NODE_CONFIG_UPDATES_PER_STEP))
  const mergedOperations = sanitizeWorkflowBuilderOperations([
    ...Object.entries(mergedUpdates).map(([nodeId, config]) => ({
      type: 'update-node-config' as const,
      nodeId,
      config,
    })),
    ...operations,
  ], normalizedGraph).slice(0, WORKFLOW_EDITOR_MAX_OPERATIONS_PER_STEP)
  return {
    name: stringValue(parsed, 'name') || deriveName(fallbackPrompt, fallbackName),
    plan: stringList(parsed, 'plan', []),
    completedSteps: stringList(parsed, 'completedSteps', []),
    currentStep: stringValue(parsed, 'currentStep'),
    nextStep: stringValue(parsed, 'nextStep'),
    summary: stringValue(parsed, 'summary'),
    confidence: numberValue(parsed, 'confidence', 0.78, 0, 1),
    status: normalizeBuilderStatus(stringValue(parsed, 'status')),
    decision: normalizeWorkflowAgentDecision(parsed.decision),
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

function createCharacterWorkflowSpecFromAgentWork(
  request: CharacterWorkflowBuilderRequest & { prompt: string; language: CharacterWorkflowLanguage },
  agentWork: CharacterWorkflowEditorAgentWork,
  mode: 'create' | 'edit'
): CharacterWorkflowBuilderSpec {
  const uiConfigOverrides = mergeEditorStepOverrides(agentWork.steps)
  const lastStep = agentWork.steps[agentWork.steps.length - 1]
  const aggregateOperations = agentWork.steps.flatMap((step) => step.operations)
  const goalConfig = uiConfigOverrides['generation-goal'] ?? {}
  const styleConfig = uiConfigOverrides['style-pressure'] ?? {}
  const constraintConfig = uiConfigOverrides['hard-constraints'] ?? uiConfigOverrides.constraint ?? {}
  const sourceConfig = uiConfigOverrides['source-material'] ?? {}
  const strategyConfig = uiConfigOverrides['generation-strategy'] ?? {}
  const policyConfig = uiConfigOverrides['agent-policy'] ?? {}
  const qualityConfig = uiConfigOverrides['quality-gate'] ?? {}
  const outputConfig = uiConfigOverrides['output-adapter'] ?? {}
  const createMode = mode === 'create'
  return {
    name: createMode
      ? deriveName(agentWork.objective, request.language === 'zh-CN' ? '角色资源图' : 'Character Resource Graph')
      : lastStep?.currentStep || deriveName(request.prompt, request.language === 'zh-CN' ? '资源图修改' : 'Workflow Edit'),
    plan: agentWork.plan,
    completedSteps: agentWork.completedSteps,
    currentStep: agentWork.currentStep,
    nextStep: agentWork.nextStep,
    summary: summarizeEditorAgentWork(agentWork, request.language),
    confidence: agentWork.status === 'blocked' ? 0.3 : agentWork.status === 'needs-user' ? 0.55 : agentWork.status === 'active' ? 0.72 : 0.86,
    status: agentWork.status === 'blocked'
      ? 'blocked'
      : agentWork.status === 'needs-user'
        ? 'needs-user'
        : agentWork.status === 'complete'
          ? 'complete'
          : 'applied',
    decision: agentWork.decision,
    goalPrompt: createMode ? stringValue(goalConfig, 'goalPrompt') || request.prompt : '',
    targetAudience: createMode ? stringValue(goalConfig, 'targetAudience') : '',
    stylePrompt: createMode ? stringValue(styleConfig, 'stylePrompt') : '',
    preset: createMode ? normalizePreset(stringValue(styleConfig, 'preset')) : 'custom',
    intensity: createMode ? numberValue(styleConfig, 'intensity', 0.72, 0, 1) : 0.72,
    mustHave: createMode ? stringList(constraintConfig, 'mustHave', []) : [],
    mustNot: createMode ? stringList(constraintConfig, 'mustNot', []) : [],
    sourceNotes: createMode ? stringValue(sourceConfig, 'notes') : '',
    generationStrategy: normalizeGenerationStrategy(createMode ? strategyConfig : {}),
    agentPolicy: normalizeAgentPolicy(createMode ? policyConfig : {}),
    qualityGate: normalizeQualityGate(createMode ? qualityConfig : {}),
    assetTargets: DEFAULT_ASSET_TARGETS,
    outputFormat: normalizeOutputFormat(createMode ? stringValue(outputConfig, 'format') : ''),
    operations: aggregateOperations,
  }
}

function alignWorkflowBuilderNodeIds(workflow: CharacterWorkflow): void {
  const aliases: Record<string, string> = {
    goal: 'generation-goal',
    constraint: 'hard-constraints',
    'character-field-target': 'character-fields',
    'llm-tool': 'llm-capability',
    'image-tool': 'image-capability',
  }
  for (const node of workflow.nodes) {
    node.id = aliases[node.id] ?? node.id
  }
  for (const edge of workflow.edges) {
    edge.from.nodeId = aliases[edge.from.nodeId] ?? edge.from.nodeId
    edge.to.nodeId = aliases[edge.to.nodeId] ?? edge.to.nodeId
    edge.id = `${edge.from.nodeId}:${edge.from.port}->${edge.to.nodeId}:${edge.to.port}`
  }
}

function createBuilderGraphFromWorkflow(workflow: CharacterWorkflow): CharacterWorkflowBuilderGraph {
  return normalizeBuilderGraph({
    selectedNodeId: 'generation-goal',
    nodes: workflow.nodes.map((node) => {
      const definition = STANDARD_CHARACTER_WORKFLOW_NODE_DEFINITIONS.find((item) => item.type === node.type)
      return {
        id: node.id,
        type: node.type,
        title: node.title,
        config: { ...node.config },
        inputs: Object.keys(node.inputs),
        outputs: Object.keys(node.outputs),
        parameters: definition?.parameters.map((parameterItem) => ({
          id: parameterItem.id,
          type: parameterItem.type,
          defaultValue: parameterItem.defaultValue,
          options: parameterItem.options?.map((optionItem) => ({
            value: optionItem.value,
            label: optionItem.label,
          })),
        })),
      }
    }),
    edges: workflow.edges.map((edge) => ({
      id: edge.id,
      from: { ...edge.from },
      to: { ...edge.to },
      kind: edge.kind,
    })),
  })
}

interface WorkflowGraphToolReport {
  summary: string
  status: CharacterWorkflowBuilderSpec['status']
  plan: string[]
  completedSteps: string[]
  currentStep: string
  nextStep?: string
  complete: boolean
}

function inspectWorkflowEditorGraph(
  graph: CharacterWorkflowBuilderGraph,
  objective: string,
  language: CharacterWorkflowLanguage,
  mode: 'create' | 'edit'
): WorkflowGraphToolReport {
  const zh = language === 'zh-CN'
  const nodeCount = graph.nodes.length
  const edgeCount = graph.edges.length
  const missing = getMissingWorkflowCoreNodeIds(graph)
  const plan = createDefaultWorkflowAgentPlan(language, mode)
  const summary = missing.length
    ? zh
      ? `已检查资源图：当前有 ${nodeCount} 个节点、${edgeCount} 条连线；还需要补齐 ${missing.join('、')}。`
      : `Inspected graph: ${nodeCount} nodes and ${edgeCount} links; missing ${missing.join(', ')}.`
    : zh
      ? `已检查资源图：当前有 ${nodeCount} 个节点、${edgeCount} 条连线，核心目标、角色卡、图片、质量门和导出链路都在图中。`
      : `Inspected graph: ${nodeCount} nodes and ${edgeCount} links; core goal, card, image, quality, and export resources are present.`
  return {
    summary,
    status: 'applied',
    plan,
    completedSteps: [],
    currentStep: zh ? '检查资源图状态' : 'Inspect resource graph',
    nextStep: mode === 'create'
      ? zh
        ? `把用户目标写入资源图，并配置目标、风格、约束、文本字段、图像目标和运行策略：${objective}`
        : `Write the user goal into the graph and configure goal, style, constraints, text fields, image targets, and run policy: ${objective}`
      : zh
        ? `根据用户要求修改当前资源图：${objective}`
        : `Apply the requested graph edit: ${objective}`,
    complete: false,
  }
}

function validateWorkflowEditorGraph(
  graph: CharacterWorkflowBuilderGraph,
  objective: string,
  language: CharacterWorkflowLanguage,
  mode: 'create' | 'edit'
): WorkflowGraphToolReport {
  const zh = language === 'zh-CN'
  const missing = getMissingWorkflowCoreNodeIds(graph)
  const issues = [
    ...missing.map((id) => zh ? `缺少节点 ${id}` : `missing node ${id}`),
    ...getMissingWorkflowCoreLinkIssues(graph, language),
    ...(mode === 'create' && !stringValue(graph.nodes.find((node) => node.id === 'generation-goal')?.config ?? {}, 'goalPrompt')
      ? [zh ? 'generation-goal.goalPrompt 还没有写入用户目标' : 'generation-goal.goalPrompt has not captured the user objective']
      : []),
  ]
  const complete = issues.length === 0
  return {
    summary: complete
      ? zh
        ? '资源图校验通过：用户目标、核心资源节点、图片引用链路、质量门和导出路径均可继续运行。'
        : 'Graph validation passed: user goal, core resource nodes, image-reference links, quality gate, and export path are ready.'
      : zh
        ? `资源图校验发现 ${issues.length} 项待处理：${issues.slice(0, 5).join('；')}`
        : `Graph validation found ${issues.length} issue(s): ${issues.slice(0, 5).join('; ')}`,
    status: 'applied',
    plan: createDefaultWorkflowAgentPlan(language, mode),
    completedSteps: complete ? [zh ? '校验资源图结构' : 'Validate graph structure'] : [],
    currentStep: zh ? '校验资源图结构' : 'Validate graph structure',
    nextStep: complete
      ? undefined
      : zh
        ? `修复资源图校验问题：${issues.slice(0, 3).join('；')}`
        : `Fix graph validation issues: ${issues.slice(0, 3).join('; ')}`,
    complete,
  }
}

function createWorkflowEditorContinuationStep(
  objective: string,
  language: CharacterWorkflowLanguage,
  mode: 'create' | 'edit'
): string {
  const zh = language === 'zh-CN'
  if (mode === 'create') {
    return zh
      ? `继续完善资源面板，使目标、字段控制、图片控制、开场展示、氛围样式、质量门和导出链路都充分服务用户目标：${objective}`
      : `Continue refining the resource panel so goals, field controls, image controls, opening display, atmosphere style, quality gate, and export path fully serve the objective: ${objective}`
  }
  return zh
    ? `继续根据用户目标检查并补齐资源面板中仍然薄弱的目标、字段、图片、展示、氛围、质量或导出配置：${objective}`
    : `Continue checking and filling weak goal, field, image, display, atmosphere, quality, or export settings against the objective: ${objective}`
}

function createDefaultWorkflowAgentPlan(language: CharacterWorkflowLanguage, mode: 'create' | 'edit'): string[] {
  const zh = language === 'zh-CN'
  if (mode === 'create') {
    return zh
      ? ['检查资源图基础结构', '写入用户目标与风格约束', '配置文本字段、图片目标和资源依赖', '校验运行策略、质量门和导出路径']
      : ['Inspect the base graph', 'Write the user goal with style and constraints', 'Configure text fields, image targets, and dependencies', 'Validate run policy, quality gate, and export path']
  }
  return zh
    ? ['检查当前资源图', '应用用户要求到相关节点和连线', '校验结构并决定是否继续']
    : ['Inspect the current graph', 'Apply the user request to relevant nodes and links', 'Validate structure and decide whether to continue']
}

function getMissingWorkflowCoreNodeIds(graph: CharacterWorkflowBuilderGraph): string[] {
  const nodeIds = new Set(graph.nodes.map((node) => node.id))
  return [
    'generation-goal',
    'character-card-target',
    'character-fields',
    'avatar-image-target',
    'avatar-image-control',
    'overview-sheet-image-target',
    'overview-sheet-image-control',
    'opening-panel-image-target',
    'opening-panel-image-control',
    'image-capability',
    'agent-policy',
    'generation-strategy',
    'opening-layout-target',
    'atmosphere-style-target',
    'quality-gate',
    'output-adapter',
  ].filter((id) => !nodeIds.has(id))
}

function getMissingWorkflowCoreLinkIssues(
  graph: CharacterWorkflowBuilderGraph,
  language: CharacterWorkflowLanguage
): string[] {
  const zh = language === 'zh-CN'
  const checks: Array<[string, string, string, string, string, string]> = [
    ['generation-goal', 'goal', 'character-card-target', 'goal', '目标没有连接到角色卡目标', 'goal is not linked to the character-card target'],
    ['image-capability', 'image', 'avatar-image-target', 'image', '图片工具没有连接到 avatar 目标', 'image tool is not linked to the avatar target'],
    ['avatar-image-target', 'imageAsset', 'overview-sheet-image-target', 'referenceImage', 'avatar 没有作为 overview sheet 的引用图', 'avatar is not linked as the overview sheet reference image'],
    ['avatar-image-target', 'imageAsset', 'opening-panel-image-target', 'referenceImage', 'avatar 没有作为 opening panel 图片引用', 'avatar is not linked as the opening-panel image reference'],
    ['opening-panel-image-target', 'imageAsset', 'opening-layout-target', 'imageAsset', 'opening panel 图片没有连接到 opening layout', 'opening-panel images are not linked to the opening layout'],
    ['character-card-target', 'target', 'atmosphere-style-target', 'card', '角色卡没有连接到氛围样式目标', 'character card is not linked to the atmosphere style target'],
    ['quality-gate', 'report', 'output-adapter', 'report', '质量门没有连接到导出节点', 'quality gate is not linked to the output adapter'],
  ]
  return checks
    .filter(([sourceNodeId, sourceSlotId, targetNodeId, targetSlotId]) => !hasWorkflowLink(graph, sourceNodeId, sourceSlotId, targetNodeId, targetSlotId))
    .map(([, , , , zhIssue, enIssue]) => zh ? zhIssue : enIssue)
}

function hasWorkflowLink(
  graph: CharacterWorkflowBuilderGraph,
  sourceNodeId: string,
  sourceSlotId: string,
  targetNodeId: string,
  targetSlotId: string
): boolean {
  return graph.edges.some((edge) => (
    edge.from.nodeId === sourceNodeId
    && edge.from.port === sourceSlotId
    && edge.to.nodeId === targetNodeId
    && edge.to.port === targetSlotId
  ))
}

function mergeUniqueStrings(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right].map((item) => item.trim()).filter(Boolean))]
}

function getWorkflowEditorSessionStepOffset(session: CharacterWorkflowEditorSession | undefined): number {
  const history = Array.isArray(session?.history) ? session.history : []
  const maxExplicitStep = history.reduce((maxStep, item) => {
    const stepIndex = Math.max(0, Math.round(Number(item?.stepIndex) || 0))
    return stepIndex > maxStep ? stepIndex : maxStep
  }, 0)
  return maxExplicitStep || history.length
}

function createWorkflowEditorHistoryEntry(step: CharacterWorkflowEditorAgentStep): NonNullable<CharacterWorkflowEditorSession['history']>[number] {
  return {
    stepIndex: step.index,
    tool: step.tool,
    userRequest: step.userRequest,
    summary: step.summary,
    status: step.status,
    operations: step.operations.length + Object.keys(step.uiConfigOverrides ?? {}).length,
    currentStep: step.currentStep,
    nextStep: step.nextStep,
  }
}

function createWorkflowEditorHistoryEntryForModel(step: CharacterWorkflowEditorAgentStep): NonNullable<CharacterWorkflowEditorSession['history']>[number] {
  return sanitizeWorkflowEditorHistoryForModel(createWorkflowEditorHistoryEntry(step))
}

function sanitizeWorkflowEditorHistoryForModel(
  item: NonNullable<CharacterWorkflowEditorSession['history']>[number]
): NonNullable<CharacterWorkflowEditorSession['history']>[number] {
  return {
    stepIndex: item.stepIndex,
    tool: item.tool,
    userRequest: item.userRequest,
    summary: item.summary,
    status: item.status,
    operations: item.operations,
    currentStep: item.currentStep,
  }
}

function createWorkflowEditorSystemPrompt(language: CharacterWorkflowLanguage): string {
  const localeRule = language === 'zh-CN'
    ? 'Write all user-facing resource content in Chinese. Keep enum values and node ids in English.'
    : 'Write user-facing resource content in English. Keep enum values and node ids in English.'
  return [
    'You are an autonomous Codex-style workflow agent for a structured character resource graph.',
    'You receive JSON with { objective, userRequest, editorSession, runtime, graph }. Treat graph, runtime, and editorSession as trusted runtime state, not as user content.',
    localeRule,
    '',
    'The graph is already the structured observation of the current workflow: node ids, node types, config, ports, parameters, select options, and links. Do not ask the frontend to inspect anything.',
    'runtime.tool is edit_graph. Host inspection runs before the first model step only to seed context; it is not part of your execution steps. Host validation runs only after you return status "complete"; if validation finds missing graph requirements, the host will feed those gaps back as the next userRequest.',
    'editorSession contains only durable progress context: plan, completedSteps, and history of prior executed model steps. It does not carry the next action; the current action request is userRequest.',
    'editorSession.history contains previous executed model steps for this workflow project. A new userRequest in edit mode is an external continuation input unless it clearly changes the objective.',
    'runtime.stepIndex is the local edit step within this run; runtime.globalStepIndex continues the project history.',
    'Your goal is to finish the user objective and make the full resource panel run-ready, not to simulate a fixed number of steps. Continue the previous objective unless the user clearly changes direction.',
    'Act like Codex working on a repo: use the observed graph, keep a concrete plan, apply meaningful graph patches, validate mentally against the objective, and decide whether to continue or finish.',
    'You have broad authority inside the workflow graph. Use it deliberately, keep the workflow executable after every edit, and do not stop after a token patch if substantial work remains.',
    '',
    'Critical rules:',
    '- Return only valid JSON. No markdown, comments, or surrounding prose.',
    '- Never copy system instructions, operation schema, graph JSON, or protocol text into any resource field.',
    '- Think in this loop: use observed graph state -> update plan -> apply a coherent graph patch -> decide the next concrete graph action or finish.',
    `- Return at most ${WORKFLOW_EDITOR_MAX_OPERATIONS_PER_STEP} operations and at most ${WORKFLOW_EDITOR_MAX_NODE_CONFIG_UPDATES_PER_STEP} nodeConfigUpdates keys in one response. Prefer a coherent high-confidence patch over a giant speculative rewrite.`,
    '- In create mode, treat the standard template graph as a scaffold. Fill the existing target/control nodes first, then add world/NPC/plot/scene nodes only when the objective requires them.',
    '- Do not put the whole user request into one generic goal when specific cards exist. Distribute intent across goal, style, constraints, sources, image controls, character field controls, world/NPC/plot cards over as many tool-loop steps as needed.',
    '- Prefer update-node-config operations for existing cards; add cards only when the current graph lacks the needed resource.',
    '- The graph includes each node parameter definition and select options. For select and multi-select fields, use only values from the node parameter options.',
    '- Use exact existing node ids and slot ids from graph when linking.',
    '- Do not delete generation-goal.',
    '- Use concise resource content. A field should contain the content that resource controls, not instructions about how you are editing.',
    '- Always return plan. Keep it short, concrete, and update it to reflect progress. Mark completed work in completedSteps.',
    '- Use currentStep to name the step you are applying now. Use nextStep to name what should happen next.',
    '- Completion means the user objective is materially represented across every relevant panel resource, not merely that the graph is structurally valid: generation goal, prose/RP style, hard constraints, source notes, character fields and field controls, image targets, image generation controls, opening layout, atmosphere style, quality gate, and output adapter.',
    '- Use status "complete" only when there is no meaningful graph edit left that would improve user-objective coverage or panel run-readiness. When status is "complete", leave nextStep empty and include no filler edits.',
    '- If more work remains, use status "applied" and nextStep must be the next concrete graph-editing step, not a vague reminder. Do not use an empty nextStep to imply completion without status "complete".',
    '- Do not optimize around a visible step budget. The host runtime may stop the loop externally; your decision should be based on objective completion and panel readiness.',
    '- If the request is underspecified but still workable, make strong creative decisions and set status to "applied".',
    '- Ask the user only when the next edit requires information the agent cannot responsibly infer: vague design direction, style preference, adult/sensual presentation direction, relationship direction, imported material choice, output target, or privacy-sensitive handling.',
    '- Do not ask for routine graph choices, obvious defaults, ordinary missing details, or permission to continue. Continue autonomously.',
    '- When asking the user, return status "needs-user", include a decision object with 2-6 single-choice options, and stop without filler operations. This is an information request, not an error.',
    '- Good decision topics include prose style, RP pacing, image style domain, opening structure, relationship direction, world/NPC/plot expansion, output target, free-image pose goals, background/prop interaction, sensuality level, wardrobe exposure, or whether to add major new resource families.',
    '',
    'Resource guidance:',
    '- generation-goal.goalPrompt: compact generation objective only.',
    '- style-pressure.preset: choose a prose/RP style preset from the node parameter options, such as precise-literary-prose, gothic-romance-prose, cyberpunk-noir, psychological-thriller, slow-burn-romance, hurt-comfort, dark-adult-drama, sillytavern-natural-card, ali-chat-dialogue-samples, or longform-novelistic-rp.',
    '- style-pressure.stylePrompt: concrete English prose control text covering tone, genre texture, relationship flavor, sentence rhythm, narration style, and roleplay pacing.',
    '- hard-constraints.mustHave/mustNot: hard requirements and boundaries.',
    '- source-material.materials: imported image/document references. Material kinds are inferred from file type; do not ask users to hand-write material type remarks.',
    '- source-material.notes: optional concrete story material, setting facts, character seeds, world facts when no imported document exists.',
    '- character-field-target.fields: one field node should cover the role-card fields and support fields that need generation. Do not create duplicate field nodes for ordinary field styling.',
    '- character-field-target.fieldControls: structured per-field controls inside the same field node. Each item should use { field, fieldPurpose, tone, lengthPolicy, avoidPatterns }. Use this for opening, dialogue style, scenario, world facts, appearance flavor, and other field-specific adaptation. It controls style and shape, not final content.',
    '- Every generated field must carry unique role-card information. Do not repeat the same relationship premise, visual fact, lore paragraph, or opening beat across multiple fields.',
    '- opening-layout-target: use this for the CSS/HTML-style role-card opening presentation that combines title, short tags, opening preview, and generated images. Set layoutKind to auto-opening-layout unless the user asks for a specific shape. Available layoutKind values are cinematic-poster, visual-novel-scene, chat-teaser, scrapbook-collage, profile-dossier, and editorial-cover. Set textDensity to minimal by default; use balanced or story only when the user wants a text-heavy intro.',
    '- Opening panels must feel like attractive roleplay entry surfaces, not project reports. Do not surface project labels such as Noema, workflow, role opening, generated card, node names, XML tags, or field names in layoutPrompt or visible text guidance. Prefer varied visual layouts inspired by character-card/profile/opening-message products: poster, visual novel, chat teaser, collage, dossier, or editorial cover.',
    '- atmosphere-style-target: use this for the structured role-card atmosphere style that controls chat bubble feeling, role_chat speech styling, inline audio player style, scene/status cards, and the profile preview. Do not generate free CSS. Configure moodPreset, surface, messageFrame, audioPlayer, density, and stylePrompt as style tokens. Add or update this node whenever the request mentions immersive chat presentation, character UI atmosphere, audio-bar feeling, dialogue display, or role-card style consistency.',
    '- image-target.imageRole: use avatar for the first canonical avatar.jpg target, character-overview-sheet for the required built-in overview sheet, and character-base-image for any extra free-form non-avatar character sample images. Do not invent fixed categories such as cover, full-body, opening moment, story moment, expression, outfit detail, relationship moment, or world context.',
    '- image-target.assetPurpose: for character-base-image, describe the free-form meaning of the sample images: scene, action, pose, outfit usage, prop interaction, mood, and roleplay situation. For character-overview-sheet, keep the existing overview sheet purpose and do not turn it into a scene.',
    '- image-generation-control: image count, imageStyleDomain, concise stylePrompt, poseGoals, backgroundInteraction, appealMode, sensualityLevel, wardrobeExposure, shotType, aspectRatio, consistencyMode, seedMode. Use imageStyleDomain only for photoreal/anime/illustration/stylized routing; use pose/background/appeal/sensuality/wardrobe fields for free character-base-image composition and adult visual attraction.',
    '- For multiple extra character-base-image targets or high targetImageCount, ask a structured decision when pose/background/wardrobe direction is underspecified and the choice would materially change the images. Example option groups: bedroom mirror pose, window light lounging, desk/object interaction, weapon/instrument handling, wet hair/swimwear, lingerie interior, implied nude sheets, street fashion flirtation.',
    '- For character resources, prefer graph-declared asset dependencies: link avatar-image-target.imageAsset into overview-sheet-image-target.referenceImage when the overview should preserve the avatar identity. Targets with referenceImage inputs use the same image-tool capability; optionally set image-tool.editModelRef when the provider has a distinct edit/reference endpoint. Additional free-form pictures should use character-base-image nodes, and/or image-generation-control.targetImageCount for variants.',
    '- Do not connect hard-constraint nodes directly into image-target. Keep image-specific exclusions in the constraint node or the target purpose; image controls should stay lightweight.',
    '- world-card-target / npc-pack-target / npc-target / plot-arc-target / scene-card-target: add these when the request asks for multi-NPC, world, setting, story arc, or scene planning.',
    '',
    'Valid node types:',
    'goal, character-card-target, character-field-target, opening-layout-target, atmosphere-style-target, image-target, world-card-target, npc-pack-target, npc-target, plot-arc-target, scene-card-target, style-pressure, constraint, image-generation-control, continuity-control, relationship-control, source-material, llm-tool, image-tool, retrieval-tool, voice-tool, agent-policy, generation-strategy, critique-loop, quality-gate, output-adapter.',
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
    '  "status": "applied" | "needs-user" | "blocked" | "complete",',
    '  "decision"?: {',
    '    "id": string,',
    '    "title": string,',
    '    "description"?: string,',
    '    "options": [{ "id": string, "label": string, "detail"?: string, "patchHint"?: string }],',
    '    "defaultOptionId"?: string,',
    '    "allowSkip"?: boolean',
    '  },',
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
  decision?: CharacterWorkflowAgentDecision
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
    decision: options.decision,
    operations: options.operations ?? [],
    uiConfigOverrides: options.uiConfigOverrides ?? {},
    createdAt: options.now + options.index,
  }
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
              parameters: definition?.parameters.map((parameterItem) => ({
                id: parameterItem.id,
                type: parameterItem.type,
                defaultValue: parameterItem.defaultValue,
                options: parameterItem.options?.map((optionItem) => ({
                  value: optionItem.value,
                  label: optionItem.label,
                })),
              })) ?? [],
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
    for (const reason of ['invalid-json', 'regenerate-minimal'] as const) {
      content = await repairWorkflowBuilderJson({ ...options, reason })
      parsed = parseJsonObject(content)
      if (Object.keys(parsed).length) {
        break
      }
    }
  }
  if (!Object.keys(parsed).length) {
    throw new Error(`${options.label} did not return valid editable JSON. Model response: ${options.text.trim().slice(0, 500)}`)
  }
  if (options.requireEditableOperations && normalizeBuilderStatus(stringValue(parsed, 'status')) === 'applied' && !hasWorkflowEditorEdits(parsed)) {
    content = await repairWorkflowBuilderJson({ ...options, text: content, reason: 'missing-edits' })
    parsed = parseJsonObject(content)
    if (!Object.keys(parsed).length) {
      throw new Error(`${options.label} did not return valid editable JSON after repair. Model response: ${options.text.trim().slice(0, 500)}`)
    }
    if (normalizeBuilderStatus(stringValue(parsed, 'status')) === 'applied' && !hasWorkflowEditorEdits(parsed)) {
      throw new Error(`${options.label} returned valid JSON but no editable graph operations.`)
    }
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
  requireEditableOperations?: boolean
  reason?: 'invalid-json' | 'regenerate-minimal' | 'missing-edits'
}): Promise<string> {
  const reason = options.reason ?? 'invalid-json'
  const response = await sendChatTurnWithConfiguredModel(options.request.modelConfig, {
    input: [
      reason === 'missing-edits'
        ? 'The previous response was valid JSON but did not contain editable graph changes.'
        : reason === 'regenerate-minimal'
          ? 'The previous response was truncated or unrecoverable. Generate a fresh minimal workflow-editor JSON patch from the original input.'
          : 'The previous response was not complete valid JSON and could not be parsed.',
      'Return exactly one complete JSON object. No markdown, comments, explanations, or code fences.',
      options.requireEditableOperations
        ? 'If status is "applied", include nodeConfigUpdates or operations. Use status "complete" only when the workflow graph already fully satisfies the objective and panel readiness requirements. Use status "needs-user" only when a concrete decision is required. Use status "blocked" only when the request cannot be safely or coherently represented as a workflow graph.'
        : 'Match the required schema.',
      'Keep the response compact: short summary, short plan, at most 3 completedSteps, concise currentStep/nextStep.',
      '',
      '<original_input>',
      truncateWorkflowRepairText(options.sourceInput, 12000),
      '</original_input>',
      '',
      '<invalid_response>',
      truncateWorkflowRepairText(options.text, 6000),
      '</invalid_response>',
    ].join('\n'),
    language: options.language,
    options: { temperature: 0, max_tokens: 5000 },
    messages: [{
      role: 'system',
      content: options.requireEditableOperations
        ? createWorkflowJsonRepairSystemPrompt(options.language)
        : options.systemPrompt,
    }],
  })
  return response.content
}

function createWorkflowJsonRepairSystemPrompt(language: CharacterWorkflowLanguage): string {
  const localeRule = language === 'zh-CN'
    ? 'Write Chinese user-facing summary, plan, currentStep, nextStep, and decision text. Keep enum values and node ids in English.'
    : 'Write English user-facing text. Keep enum values and node ids in English.'
  return [
    'You repair JSON for a workflow graph editor.',
    localeRule,
    'Return only valid JSON. No markdown.',
    'Schema:',
    '{',
    '  "summary": string,',
    '  "plan": string[],',
    '  "completedSteps"?: string[],',
    '  "currentStep"?: string,',
    '  "nextStep"?: string,',
    '  "status": "applied" | "needs-user" | "blocked" | "complete",',
    '  "decision"?: { "id": string, "title": string, "description"?: string, "options": [{ "id": string, "label": string, "detail"?: string, "patchHint"?: string }], "defaultOptionId"?: string, "allowSkip"?: boolean },',
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
  ].join('\n')
}

function truncateWorkflowRepairText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }
  const headLength = Math.floor(maxLength * 0.72)
  const tailLength = Math.max(0, maxLength - headLength - 80)
  return [
    value.slice(0, headLength),
    `\n...<truncated ${value.length - headLength - tailLength} chars>...\n`,
    tailLength ? value.slice(-tailLength) : '',
  ].join('')
}

function hasWorkflowEditorEdits(parsed: Record<string, unknown>): boolean {
  if (operationList(parsed.operations).length > 0) {
    return true
  }
  return Object.keys(recordMapValue(parsed, 'nodeConfigUpdates')).length > 0
}

function normalizeWorkflowAgentDecision(value: unknown): CharacterWorkflowAgentDecision | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const record = value as Record<string, unknown>
  const title = stringValue(record, 'title')
  const rawOptions = Array.isArray(record.options) ? record.options : []
  const options = rawOptions.flatMap((item, index): CharacterWorkflowAgentDecisionOption[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return []
    }
    const optionRecord = item as Record<string, unknown>
    const label = stringValue(optionRecord, 'label')
    if (!label) {
      return []
    }
    const id = stringValue(optionRecord, 'id') || `option-${index + 1}`
    return [{
      id,
      label,
      detail: stringValue(optionRecord, 'detail') || undefined,
      patchHint: stringValue(optionRecord, 'patchHint') || undefined,
    }]
  }).slice(0, 6)
  if (!title || options.length < 2) {
    return undefined
  }
  const defaultOptionId = stringValue(record, 'defaultOptionId')
  return {
    id: stringValue(record, 'id') || `decision-${Date.now()}`,
    title,
    description: stringValue(record, 'description') || undefined,
    options,
    defaultOptionId: options.some((option) => option.id === defaultOptionId) ? defaultOptionId : options[0]?.id,
    allowSkip: typeof record.allowSkip === 'boolean' ? record.allowSkip : true,
  }
}

function getWorkflowEditorMaxSteps(graph: CharacterWorkflowBuilderGraph): number {
  const policyNode = graph.nodes.find((node) => node.id === 'agent-policy' || node.type === 'agent-policy')
  const revisionBudget = typeof policyNode?.config?.revisionBudget === 'number'
    ? policyNode.config.revisionBudget
    : Number(policyNode?.config?.revisionBudget)
  const configuredEditTurns = Number.isFinite(revisionBudget) ? Math.round(revisionBudget) : WORKFLOW_EDITOR_DEFAULT_EDIT_TURNS
  const editTurns = Math.max(WORKFLOW_EDITOR_MIN_EDIT_TURNS, Math.min(WORKFLOW_EDITOR_MAX_EDIT_TURNS, configuredEditTurns))
  return editTurns * 2 + 1
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
        parameters: Array.isArray(record.parameters)
          ? record.parameters.flatMap((parameterItem): CharacterWorkflowBuilderGraphNodeParameter[] => {
            if (!parameterItem || typeof parameterItem !== 'object') return []
            const parameterRecord = parameterItem as Record<string, unknown>
            const id = stringValue(parameterRecord, 'id')
            if (!id) return []
            return [{
              id,
              type: stringValue(parameterRecord, 'type') || undefined,
              defaultValue: parameterRecord.defaultValue,
              options: Array.isArray(parameterRecord.options)
                ? parameterRecord.options.flatMap((optionItem): Array<{ value: string; label: string }> => {
                  if (!optionItem || typeof optionItem !== 'object') return []
                  const optionRecord = optionItem as Record<string, unknown>
                  const value = stringValue(optionRecord, 'value')
                  if (!value) return []
                  return [{ value, label: stringValue(optionRecord, 'label') || value }]
                })
                : undefined,
            }]
          })
          : [],
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
  return new Set(['applied', 'needs-user', 'blocked', 'complete']).has(value) ? value as CharacterWorkflowBuilderSpec['status'] : 'applied'
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
    'atmosphere-style-target',
    'image-target',
    'world-card-target',
    'npc-pack-target',
    'npc-target',
    'plot-arc-target',
    'scene-card-target',
    'style-pressure',
    'constraint',
    'image-generation-control',
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
  const allowed = new Set(
    STANDARD_CHARACTER_WORKFLOW_NODE_DEFINITIONS
      .find((item) => item.type === 'style-pressure')
      ?.parameters
      .find((parameterItem) => parameterItem.id === 'preset')
      ?.options
      ?.map((optionItem) => optionItem.value) ?? ['custom']
  )
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
    priorityAssets: ['opening-layout', 'atmosphere-style', 'image-pack'].reduce(
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
    revisionBudget: Math.round(numberValue(record, 'revisionBudget', WORKFLOW_AGENT_DEFAULT_REVISION_BUDGET, 1, 24)),
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
