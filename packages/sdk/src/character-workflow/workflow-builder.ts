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
  focusPrompt?: string
  focusHistory?: string[]
  status?: 'active' | 'paused' | 'needs-user' | 'blocked' | 'complete'
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
  | 'plan_requirements'
  | 'repair_structure'
  | 'generate_style'
  | 'generate_fields'
  | 'generate_images'
  | 'generate_css'
  | 'generate_gameplay'
  | 'generate_quality'
  | 'evaluate_goal_coverage'
  | 'repair_domain'
  | 'edit_graph'
  | 'validate_graph'
  | 'ask_user'
  | 'finish'

const DEFAULT_REQUIRED_CHECKS = ['goal match', 'long-term RP', 'visual identity', 'field completeness', 'consistency']
const DEFAULT_ASSET_TARGETS = ['role-card', 'opening', 'opening-layout', 'atmosphere-style', 'game-system', 'image-pack', 'resource-package', 'generation-report']
const WORKFLOW_AGENT_DEFAULT_REVISION_BUDGET = 12
const WORKFLOW_EDITOR_DEFAULT_EDIT_TURNS = WORKFLOW_AGENT_DEFAULT_REVISION_BUDGET
const WORKFLOW_EDITOR_MIN_EDIT_TURNS = 3
const WORKFLOW_EDITOR_MAX_EDIT_TURNS = 24
const WORKFLOW_EDITOR_MAX_OPERATIONS_PER_STEP = 28
const WORKFLOW_EDITOR_MAX_NODE_CONFIG_UPDATES_PER_STEP = 28
const WORKFLOW_EDITOR_COMPLETION_SCORE = 0.84
const WORKFLOW_EDITOR_REPAIR_ROUNDS = 4

type WorkflowEditorDomain =
  | 'structure'
  | 'style'
  | 'fields'
  | 'images'
  | 'css'
  | 'gameplay'
  | 'quality'

interface WorkflowEditorRequirement {
  id: string
  domain: WorkflowEditorDomain
  title: string
  prompt: string
  targetNodeIds: string[]
  acceptanceCriteria: string[]
  status: 'pending' | 'done' | 'needs-repair'
  score: number
  issues: string[]
}

interface WorkflowEditorDomainPatch {
  spec: CharacterWorkflowBuilderSpec
  score: number
  issues: string[]
  addedRequirements: WorkflowEditorRequirement[]
}

interface WorkflowEditorGoalEvaluation {
  summary: string
  complete: boolean
  score: number
  domainScores: Partial<Record<WorkflowEditorDomain, number>>
  blockingIssues: Array<{ domain: WorkflowEditorDomain; issue: string; repairPrompt: string }>
  completedRequirementIds: string[]
  nextStep?: string
  decision?: CharacterWorkflowAgentDecision
}

const WORKFLOW_EDITOR_DOMAIN_ORDER: WorkflowEditorDomain[] = [
  'structure',
  'style',
  'fields',
  'images',
  'css',
  'gameplay',
  'quality',
]

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
  const hasPriorSession = hasWorkflowEditorPriorSession(session)
  const objective = session?.objective?.trim() || request.prompt
  const focusPrompt = createWorkflowEditorFocusPrompt(request.prompt, session)
  const activeObjective = createWorkflowEditorActiveObjective(objective, focusPrompt, request.language, mode, hasPriorSession)
  const stepOffset = getWorkflowEditorSessionStepOffset(session)
  await request.onEvent?.({ type: 'workflow-agent.started', mode, workId, objective, timestamp: now })
  let graph = normalizeBuilderGraph(initialGraph)
  let plan = session?.plan?.length
    ? [...session.plan]
    : createAutonomousWorkflowEditorPlan(request.language, mode)
  let completedSteps = [...(session?.completedSteps ?? [])]
  let currentStep = session?.currentStep
  let nextStep: string | undefined
  const steps: CharacterWorkflowEditorAgentStep[] = []
  const maxSteps = getWorkflowEditorMaxSteps(graph)
  let requirements = createFallbackWorkflowEditorRequirements(graph, activeObjective, request.language, mode)

  const emitStep = async (step: CharacterWorkflowEditorAgentStep): Promise<void> => {
    steps.push(step)
    await request.onEvent?.({ type: 'workflow-agent.step', mode, workId, step, timestamp: step.createdAt })
    plan = step.plan.length ? step.plan : plan
    completedSteps = step.completedSteps.length ? step.completedSteps : completedSteps
    currentStep = step.currentStep || currentStep
    nextStep = step.nextStep
  }

  const createStepFromSpec = (input: {
    tool: CharacterWorkflowAgentToolAction
    userRequest: string
    spec: CharacterWorkflowBuilderSpec
    graphBefore: CharacterWorkflowBuilderGraph
  }): CharacterWorkflowEditorAgentStep => {
    const uiConfigOverrides = createEditorUiConfigOverrides(input.spec, input.graphBefore)
    return createWorkflowAgentStep({
      now,
      index: stepOffset + steps.length + 1,
      tool: input.tool,
      userRequest: input.userRequest,
      summary: input.spec.summary,
      status: input.spec.status,
      plan: input.spec.plan,
      completedSteps: input.spec.completedSteps ?? [],
      currentStep: input.spec.currentStep,
      nextStep: input.spec.nextStep,
      decision: input.spec.decision,
      operations: input.spec.operations,
      uiConfigOverrides,
    })
  }

  const runToolStep = async (
    tool: CharacterWorkflowAgentToolAction,
    userRequest: string,
    spec: CharacterWorkflowBuilderSpec
  ): Promise<CharacterWorkflowEditorAgentStep> => {
    const graphBefore = graph
    const step = createStepFromSpec({ tool, userRequest, spec, graphBefore })
    await emitStep(step)
    graph = applyEditorOperationsToGraph(graph, step.operations)
    return step
  }

  const currentSession = (): CharacterWorkflowEditorSession => ({
    objective,
    focusPrompt,
    focusHistory: mergeWorkflowEditorFocusHistory(session?.focusHistory, focusPrompt),
    status: session?.status,
    plan,
    completedSteps,
    currentStep,
    nextStep,
    history: [
      ...(session?.history ?? []).map(sanitizeWorkflowEditorHistoryForModel),
      ...steps.map(createWorkflowEditorHistoryEntryForModel),
    ],
  })

  const inspection = inspectWorkflowEditorGraph(graph, activeObjective, request.language, mode)
  await runToolStep('inspect_graph', focusPrompt, createWorkflowEditorHostSpec({
    language: request.language,
    name: mode === 'create' ? 'Inspect workflow scaffold' : 'Inspect workflow graph',
    summary: inspection.summary,
    plan,
    completedSteps,
    currentStep: inspection.currentStep,
    nextStep: inspection.nextStep,
    status: 'applied',
  }))

  if (steps.length < maxSteps) {
    const planned = await planWorkflowEditorRequirements({
      request,
      objective: activeObjective,
      focusPrompt,
      continuation: mode === 'edit' && hasPriorSession,
      graph,
      mode,
      session: currentSession(),
      fallbackRequirements: requirements,
    })
    requirements = mergeWorkflowEditorRequirements(requirements, planned.requirements)
    const planningStep = await runToolStep('plan_requirements', focusPrompt, createWorkflowEditorHostSpec({
      language: request.language,
      name: request.language === 'zh-CN' ? '目标拆解' : 'Goal Decomposition',
      summary: planned.summary,
      plan: planned.plan.length ? planned.plan : plan,
      completedSteps,
      currentStep: request.language === 'zh-CN' ? '拆解目标覆盖要求' : 'Decompose goal coverage requirements',
      nextStep: request.language === 'zh-CN' ? '开始按独立资源域生成图配置' : 'Generate graph configuration by independent resource domain',
      status: planned.decision ? 'needs-user' : 'applied',
      decision: planned.decision,
    }))
    if (planningStep.status === 'needs-user') {
      return completeWorkflowEditorAgentWork({
        workId,
        mode,
        objective,
        status: 'needs-user',
        plan,
        completedSteps,
        currentStep,
        nextStep,
        decision: planningStep.decision,
        steps,
        createdAt: now,
        onEvent: request.onEvent,
      })
    }
  }

  const structureRepairOperations = createWorkflowEditorStructureRepairOperations(graph)
  if (structureRepairOperations.length && steps.length < maxSteps) {
    const repairStep = await runToolStep('repair_structure', objective, createWorkflowEditorHostSpec({
      language: request.language,
      name: request.language === 'zh-CN' ? '结构修复' : 'Structure Repair',
      summary: request.language === 'zh-CN'
        ? `补齐 ${structureRepairOperations.length} 项核心节点或连线，保证后续资源域可以独立生成。`
        : `Repaired ${structureRepairOperations.length} core node/link item(s) so later resource domains can generate independently.`,
      plan,
      completedSteps: mergeUniqueStrings(completedSteps, [request.language === 'zh-CN' ? '修复资源图核心结构' : 'Repair core graph structure']),
      currentStep: request.language === 'zh-CN' ? '修复资源图结构' : 'Repair graph structure',
      nextStep: request.language === 'zh-CN' ? '生成风格、字段、图片、CSS 和游戏性资源' : 'Generate style, fields, image, CSS, and gameplay resources',
      status: 'applied',
      operations: structureRepairOperations,
    }))
    updateWorkflowEditorRequirementsFromStep(requirements, 'structure', 0.88, [], repairStep.operations)
  }

  const domainOrder = selectWorkflowEditorDomainsForRun({
    mode,
    session: currentSession(),
    focusPrompt,
    requirements,
    continuation: mode === 'edit' && hasPriorSession,
  })
  for (const domain of domainOrder) {
    if (steps.length >= maxSteps || shouldStopWorkflowEditorLoop(steps)) {
      break
    }
    const domainRequirements = requirements.filter((requirement) => requirement.domain === domain)
    if (!domainRequirements.length) {
      continue
    }
    const tool = workflowEditorToolForDomain(domain)
    const patch = await generateWorkflowEditorDomainPatch({
      request,
      mode,
      objective: activeObjective,
      focusPrompt,
      continuation: mode === 'edit' && hasPriorSession,
      graph,
      domain,
      requirements: domainRequirements,
      allRequirements: requirements,
      session: currentSession(),
      repairPrompt: '',
    })
    const step = await runToolStep(tool, describeWorkflowEditorDomainWork(domain, request.language), patch.spec)
    requirements = mergeWorkflowEditorRequirements(requirements, patch.addedRequirements)
    updateWorkflowEditorRequirementsFromStep(requirements, domain, patch.score, patch.issues, step.operations)
  }
  if (mode === 'edit' && hasPriorSession) {
    requirements = filterWorkflowEditorRequirementsForDomains(requirements, domainOrder)
  }

  const stoppedDomainStep = steps[steps.length - 1]
  if (stoppedDomainStep?.status === 'needs-user' || stoppedDomainStep?.status === 'blocked') {
    return completeWorkflowEditorAgentWork({
      workId,
      mode,
      objective,
      status: stoppedDomainStep.status === 'blocked' ? 'blocked' : 'needs-user',
      plan,
      completedSteps,
      currentStep,
      nextStep,
      decision: stoppedDomainStep.decision,
      steps,
      createdAt: now,
      onEvent: request.onEvent,
    })
  }

  let finalEvaluation = await evaluateWorkflowEditorGoalCoverage({
    request,
    mode,
    objective: activeObjective,
    focusPrompt,
    continuation: mode === 'edit' && hasPriorSession,
    graph,
    requirements,
    session: currentSession(),
  })
  if (steps.length < maxSteps) {
    const evaluationStep = await runToolStep('evaluate_goal_coverage', focusPrompt, workflowEditorEvaluationToSpec(finalEvaluation, request.language, plan, completedSteps))
    requirements = applyWorkflowEditorEvaluationToRequirements(requirements, finalEvaluation)
    if (evaluationStep.status === 'needs-user' || evaluationStep.status === 'blocked') {
      return completeWorkflowEditorAgentWork({
        workId,
        mode,
        objective,
        status: evaluationStep.status === 'blocked' ? 'blocked' : 'needs-user',
        plan,
        completedSteps,
        currentStep,
        nextStep,
        decision: evaluationStep.decision,
        steps,
        createdAt: now,
        onEvent: request.onEvent,
      })
    }
  }

  for (let round = 0; round < WORKFLOW_EDITOR_REPAIR_ROUNDS && steps.length < maxSteps; round += 1) {
    const validation = validateWorkflowEditorGraph(graph, activeObjective, request.language, mode)
    if (validation.complete && finalEvaluation.complete && finalEvaluation.score >= WORKFLOW_EDITOR_COMPLETION_SCORE) {
      await runToolStep('finish', objective, createWorkflowEditorHostSpec({
        language: request.language,
        name: request.language === 'zh-CN' ? '完成资源图' : 'Complete Workflow Graph',
        summary: finalEvaluation.summary || validation.summary,
        plan,
        completedSteps: mergeUniqueStrings(completedSteps, [request.language === 'zh-CN' ? '完成目标覆盖评估' : 'Complete goal coverage evaluation']),
        currentStep: request.language === 'zh-CN' ? '完成资源图编辑' : 'Finish workflow editing',
        status: 'complete',
      }))
      nextStep = undefined
      break
    }

    const repairIssue = finalEvaluation.blockingIssues[0]
    if (!repairIssue) {
      nextStep = validation.nextStep || createWorkflowEditorContinuationStep(objective, request.language, mode)
      break
    }

    const patch = await generateWorkflowEditorDomainPatch({
      request,
      mode,
      objective: activeObjective,
      focusPrompt,
      continuation: mode === 'edit' && hasPriorSession,
      graph,
      domain: repairIssue.domain,
      requirements: requirements.filter((requirement) => requirement.domain === repairIssue.domain),
      allRequirements: requirements,
      session: currentSession(),
      repairPrompt: repairIssue.repairPrompt || repairIssue.issue,
    })
    const repairStep = await runToolStep('repair_domain', repairIssue.repairPrompt || repairIssue.issue, patch.spec)
    requirements = mergeWorkflowEditorRequirements(requirements, patch.addedRequirements)
    updateWorkflowEditorRequirementsFromStep(requirements, repairIssue.domain, patch.score, patch.issues, repairStep.operations)

    if (shouldStopWorkflowEditorLoop(steps)) {
      break
    }

    finalEvaluation = await evaluateWorkflowEditorGoalCoverage({
      request,
      mode,
      objective: activeObjective,
      focusPrompt,
      continuation: mode === 'edit' && hasPriorSession,
      graph,
      requirements,
      session: currentSession(),
    })
    await runToolStep('evaluate_goal_coverage', focusPrompt, workflowEditorEvaluationToSpec(finalEvaluation, request.language, plan, completedSteps))
    requirements = applyWorkflowEditorEvaluationToRequirements(requirements, finalEvaluation)
    if (shouldStopWorkflowEditorLoop(steps)) {
      break
    }
  }

  const lastStep = steps[steps.length - 1]
  if (
    lastStep?.status !== 'complete'
    && lastStep?.status !== 'blocked'
    && lastStep?.status !== 'needs-user'
    && !nextStep?.trim()
  ) {
    nextStep = finalEvaluation.nextStep || createWorkflowEditorContinuationStep(objective, request.language, mode)
  }
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

async function completeWorkflowEditorAgentWork(options: {
  workId: string
  mode: 'create' | 'edit'
  objective: string
  status: CharacterWorkflowEditorAgentWork['status']
  plan: string[]
  completedSteps: string[]
  currentStep?: string
  nextStep?: string
  decision?: CharacterWorkflowAgentDecision
  steps: CharacterWorkflowEditorAgentStep[]
  createdAt: number
  onEvent?: CharacterWorkflowBuilderRequest['onEvent']
}): Promise<CharacterWorkflowEditorAgentWork> {
  const work: CharacterWorkflowEditorAgentWork = {
    id: options.workId,
    mode: options.mode,
    objective: options.objective,
    status: options.status,
    plan: options.plan,
    completedSteps: options.completedSteps,
    currentStep: options.currentStep,
    nextStep: options.status === 'complete' ? undefined : options.nextStep,
    decision: options.status === 'needs-user' ? options.decision : undefined,
    steps: options.steps,
    createdAt: options.createdAt,
    updatedAt: Date.now(),
  }
  await options.onEvent?.({ type: 'workflow-agent.completed', mode: options.mode, work, timestamp: work.updatedAt })
  return work
}

function createAutonomousWorkflowEditorPlan(language: CharacterWorkflowLanguage, mode: 'create' | 'edit'): string[] {
  const zh = language === 'zh-CN'
  if (mode === 'create') {
    return zh
      ? ['拆解目标覆盖要求', '补齐可运行资源图结构', '独立生成风格、字段、图片、CSS 与游戏性控制', '评估目标覆盖并按域修复', '完成资源图']
      : ['Decompose goal coverage requirements', 'Repair run-ready graph structure', 'Generate style, fields, image, CSS, and gameplay controls independently', 'Evaluate goal coverage and repair by domain', 'Finish the workflow graph']
  }
  return zh
    ? ['读取当前图与用户变更目标', '按独立资源域生成必要修改', '评估目标覆盖并修复薄弱域', '完成资源图编辑']
    : ['Read the current graph and edit objective', 'Generate needed edits by independent resource domain', 'Evaluate goal coverage and repair weak domains', 'Finish the workflow edit']
}

function hasWorkflowEditorPriorSession(session: CharacterWorkflowEditorSession | undefined): boolean {
  return Boolean(
    session?.objective?.trim()
    || session?.focusPrompt?.trim()
    || session?.plan?.length
    || session?.completedSteps?.length
    || session?.history?.length
  )
}

function createWorkflowEditorFocusPrompt(
  prompt: string,
  session: CharacterWorkflowEditorSession | undefined
): string {
  return prompt.trim() || session?.focusPrompt?.trim() || session?.nextStep?.trim() || session?.currentStep?.trim() || ''
}

function createWorkflowEditorActiveObjective(
  objective: string,
  focusPrompt: string,
  language: CharacterWorkflowLanguage,
  mode: 'create' | 'edit',
  hasPriorSession: boolean
): string {
  if (mode !== 'edit' || !hasPriorSession || !focusPrompt.trim() || focusPrompt.trim() === objective.trim()) {
    return objective
  }
  return language === 'zh-CN'
    ? `整体目标：${objective}\n本轮聚焦：${focusPrompt}`
    : `Overall objective: ${objective}\nCurrent focus: ${focusPrompt}`
}

function mergeWorkflowEditorFocusHistory(existing: string[] | undefined, focusPrompt: string): string[] {
  return [...new Set([...(existing ?? []), focusPrompt].map((item) => item.trim()).filter(Boolean))].slice(-8)
}

function selectWorkflowEditorDomainsForRun(options: {
  mode: 'create' | 'edit'
  session: CharacterWorkflowEditorSession
  focusPrompt: string
  requirements: WorkflowEditorRequirement[]
  continuation: boolean
}): WorkflowEditorDomain[] {
  if (options.mode === 'create' || !options.continuation) {
    return WORKFLOW_EDITOR_DOMAIN_ORDER
  }

  const requirementDomains = new Set(options.requirements.map((requirement) => requirement.domain))
  const allDomains = requirementDomains.size >= WORKFLOW_EDITOR_DOMAIN_ORDER.length
  const selected = new Set<WorkflowEditorDomain>()
  if (requirementDomains.size > 0 && !allDomains) {
    for (const domain of requirementDomains) {
      selected.add(domain)
    }
  }

  for (const domain of inferWorkflowEditorDomainsFromFocus([
    options.focusPrompt,
    options.session.nextStep ?? '',
    options.session.currentStep ?? '',
  ].join('\n'))) {
    selected.add(domain)
  }

  if (!selected.size) {
    selected.add('style')
    selected.add('fields')
  }
  selected.add('quality')
  return WORKFLOW_EDITOR_DOMAIN_ORDER.filter((domain) => selected.has(domain))
}

function filterWorkflowEditorRequirementsForDomains(
  requirements: WorkflowEditorRequirement[],
  domains: WorkflowEditorDomain[]
): WorkflowEditorRequirement[] {
  const selected = new Set(domains)
  const filtered = requirements.filter((requirement) => selected.has(requirement.domain))
  return filtered.length ? filtered : requirements
}

function inferWorkflowEditorDomainsFromFocus(text: string): WorkflowEditorDomain[] {
  const normalized = text.toLowerCase()
  const matches = (tokens: string[]) => tokens.some((token) => normalized.includes(token.toLowerCase()))
  const domains: WorkflowEditorDomain[] = []
  if (matches(['structure', 'graph', 'node', 'link', 'edge', 'world', 'continuity', 'relationship', 'plot', 'scene', '结构', '节点', '连线', '世界', '连续', '关系', '剧情', '场景'])) {
    domains.push('structure')
  }
  if (matches(['style', 'tone', 'voice', 'prose', 'writing', 'constraint', 'boundary', '风格', '语气', '文风', '约束', '边界', '氛围'])) {
    domains.push('style')
  }
  if (matches(['field', 'card', 'name', 'description', 'appearance', 'personality', 'background', 'scenario', 'first message', 'dialogue', '字段', '角色卡', '姓名', '描述', '外貌', '性格', '背景', '设定', '开场白', '对话'])) {
    domains.push('fields')
  }
  if (matches(['image', 'avatar', 'portrait', 'overview', 'sheet', 'visual', 'pose', 'outfit', '生图', '图片', '头像', '立绘', '视觉', '姿势', '服装'])) {
    domains.push('images')
  }
  if (matches(['css', 'layout', 'ui', 'panel', 'surface', 'opening', 'theme', '布局', '样式', '面板', '界面', '开场', '展示'])) {
    domains.push('css')
  }
  if (matches(['game', 'gameplay', 'stat', 'status', 'equipment', 'inventory', 'rule', '玩法', '游戏性', '数值', '状态', '装备', '背包', '规则'])) {
    domains.push('gameplay')
  }
  if (matches(['quality', 'export', 'package', 'gate', 'evaluate', 'finish', '质量', '导出', '资源包', '检查', '评估', '完成'])) {
    domains.push('quality')
  }
  return domains
}

function createWorkflowEditorHostSpec(options: {
  language: CharacterWorkflowLanguage
  name: string
  summary: string
  plan: string[]
  completedSteps?: string[]
  currentStep?: string
  nextStep?: string
  status: CharacterWorkflowBuilderSpec['status']
  decision?: CharacterWorkflowAgentDecision
  operations?: CharacterWorkflowBuilderOperation[]
}): CharacterWorkflowBuilderSpec {
  return {
    name: options.name,
    plan: options.plan,
    completedSteps: options.completedSteps ?? [],
    currentStep: options.currentStep,
    nextStep: options.nextStep,
    summary: options.summary,
    confidence: options.status === 'blocked' ? 0.25 : options.status === 'needs-user' ? 0.55 : 0.82,
    status: options.status,
    decision: options.decision,
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
    operations: options.operations ?? [],
  }
}

async function runWorkflowEditorJsonModelTurn(options: {
  request: CharacterWorkflowBuilderRequest & { prompt: string; language: CharacterWorkflowLanguage }
  label: string
  systemPrompt: string
  input: Record<string, unknown>
  requireEditableOperations?: boolean
  temperature?: number
  maxTokens?: number
}): Promise<string> {
  const sourceInput = JSON.stringify(options.input, null, 2)
  const response = await sendChatTurnWithConfiguredModel(options.request.modelConfig, {
    input: sourceInput,
    language: options.request.language,
    options: {
      temperature: options.temperature ?? 0.35,
      max_tokens: options.maxTokens ?? 7000,
    },
    messages: [{
      role: 'system',
      content: options.systemPrompt,
    }],
  })
  return ensureUsefulWorkflowBuilderResponse({
    text: response.content,
    label: options.label,
    request: options.request,
    language: options.request.language,
    systemPrompt: options.systemPrompt,
    sourceInput,
    requireEditableOperations: options.requireEditableOperations,
  })
}

async function planWorkflowEditorRequirements(options: {
  request: CharacterWorkflowBuilderRequest & { prompt: string; language: CharacterWorkflowLanguage }
  objective: string
  focusPrompt: string
  continuation: boolean
  graph: CharacterWorkflowBuilderGraph
  mode: 'create' | 'edit'
  session: CharacterWorkflowEditorSession
  fallbackRequirements: WorkflowEditorRequirement[]
}): Promise<{
  summary: string
  plan: string[]
  requirements: WorkflowEditorRequirement[]
  decision?: CharacterWorkflowAgentDecision
}> {
  const zh = options.request.language === 'zh-CN'
  try {
    const content = await runWorkflowEditorJsonModelTurn({
      request: options.request,
      label: 'workflow requirement planner',
      systemPrompt: createWorkflowEditorRequirementPlannerSystemPrompt(options.request.language),
      input: {
        objective: options.objective,
        focusPrompt: options.focusPrompt,
        continuation: options.continuation,
        mode: options.mode,
        graph: createWorkflowEditorGraphSnapshot(options.graph),
        editorSession: options.session,
        fallbackRequirements: options.fallbackRequirements,
        requiredDomains: WORKFLOW_EDITOR_DOMAIN_ORDER,
      },
      requireEditableOperations: false,
      temperature: 0.22,
      maxTokens: 5200,
    })
    const parsed = parseJsonObject(content)
    const requirements = normalizeWorkflowEditorRequirements(parsed.requirements, options.fallbackRequirements)
    return {
      summary: stringValue(parsed, 'summary') || (zh ? '已将用户目标拆成独立资源域验收要求。' : 'Decomposed the user goal into independent resource-domain acceptance requirements.'),
      plan: stringList(parsed, 'plan', createAutonomousWorkflowEditorPlan(options.request.language, options.mode)),
      requirements,
      decision: normalizeWorkflowAgentDecision(parsed.decision),
    }
  } catch {
    return {
      summary: zh
        ? '目标拆解模型不可用，已使用运行时默认的结构、风格、字段、图片、CSS、游戏性与质量要求继续。'
        : 'Requirement planning model was unavailable; continuing with runtime defaults for structure, style, fields, images, CSS, gameplay, and quality.',
      plan: createAutonomousWorkflowEditorPlan(options.request.language, options.mode),
      requirements: options.fallbackRequirements,
    }
  }
}

function createWorkflowEditorRequirementPlannerSystemPrompt(language: CharacterWorkflowLanguage): string {
  const zh = language === 'zh-CN'
  return [
    'You are the planning tool in a Codex-style workflow editor.',
    zh
      ? '用户可见文本用中文；domain、id、node ids 和 enum values 保持英文。'
      : 'Write user-visible text in English; keep domain, ids, node ids, and enum values in English.',
    'Return only valid JSON.',
    'Split the objective into independent, verifiable requirements. Do not generate graph edits.',
    'For create mode, cover these domains: structure, style, fields, images, css, gameplay, quality.',
    'For edit continuation, preserve existing completed work and treat focusPrompt as the current turn focus. Return only requirements needed by that focus plus quality/export when the package or acceptance criteria must change.',
    'A requirement must be concrete enough that another tool can update graph nodes without reading a giant prompt pile.',
    'Do not ask the user unless a missing boundary would materially change the resource graph.',
    'Return schema:',
    '{',
    '  "summary": string,',
    '  "plan": string[],',
    '  "decision"?: { "id": string, "title": string, "description"?: string, "options": [{ "id": string, "label": string, "detail"?: string, "patchHint"?: string }], "defaultOptionId"?: string, "allowSkip"?: boolean },',
    '  "requirements": [{',
    '    "id": string,',
    '    "domain": "structure" | "style" | "fields" | "images" | "css" | "gameplay" | "quality",',
    '    "title": string,',
    '    "prompt": string,',
    '    "targetNodeIds": string[],',
    '    "acceptanceCriteria": string[]',
    '  }]',
    '}',
  ].join('\n')
}

function createFallbackWorkflowEditorRequirements(
  graph: CharacterWorkflowBuilderGraph,
  objective: string,
  language: CharacterWorkflowLanguage,
  mode: 'create' | 'edit'
): WorkflowEditorRequirement[] {
  const zh = language === 'zh-CN'
  const suffix = mode === 'create'
    ? zh ? '创建' : 'create'
    : zh ? '编辑' : 'edit'
  const requirement = (
    domain: WorkflowEditorDomain,
    title: string,
    prompt: string,
    targetNodeIds: string[],
    acceptanceCriteria: string[]
  ): WorkflowEditorRequirement => ({
    id: `${domain}-${suffix}`,
    domain,
    title,
    prompt,
    targetNodeIds: targetNodeIds.filter((nodeId) => graph.nodes.some((node) => node.id === nodeId) || WORKFLOW_EDITOR_CORE_NODE_SPECS.some((node) => node.id === nodeId)),
    acceptanceCriteria,
    status: 'pending',
    score: 0,
    issues: [],
  })

  return zh
    ? [
        requirement('structure', '可运行资源图结构', `让资源图能承载目标：${objective}`, ['generation-goal', 'character-card-target', 'character-fields', 'style-pressure', 'hard-constraints', 'source-material', 'agent-policy', 'generation-strategy', 'resource-package-target', 'quality-gate', 'output-adapter'], ['核心节点齐全', '核心连线齐全', '目标写入 generation-goal', '资源汇总包连接到质量门和导出']),
        requirement('style', '独立风格控制', `为目标设计具体 prose/RP 风格、边界、来源备注和 agent 自主策略：${objective}`, ['generation-goal', 'style-pressure', 'hard-constraints', 'source-material', 'agent-policy', 'generation-strategy'], ['风格不是泛化模板', '约束和目标分离', '自主度足够高且只在真正阻塞时询问']),
        requirement('fields', '独立字段控制', `为角色卡字段生成字段集合与逐字段控制，不直接塞最终成品文案：${objective}`, ['character-card-target', 'character-fields'], ['字段覆盖角色卡和支持字段', '每个关键字段有目的、语气、长度和避免模式', '字段之间不重复同一信息']),
        requirement('images', '独立生图控制', `为 avatar、overview sheet 和 opening panel 设计不同视觉任务和图像控制：${objective}`, ['avatar-image-target', 'avatar-image-control', 'overview-sheet-image-target', 'overview-sheet-image-control', 'opening-panel-image-target', 'opening-panel-image-control', 'image-capability'], ['每类图片目的不同', '控制项包含风格、姿态、背景、吸引力、服装、比例和一致性', 'overview/opening 能引用 avatar 身份']),
        requirement('css', '独立 CSS/氛围控制', `为开场展示和聊天氛围生成 UI/CSS 方向：${objective}`, ['opening-layout-target', 'atmosphere-style-target'], ['开场布局像角色产品入口而非报告', '氛围控制覆盖 surface/message/audio/density', 'CSS 方向与角色主题绑定']),
        requirement('gameplay', '独立游戏性控制', `为聊天侧状态、装备、关系和长期玩法生成规则：${objective}`, ['game-system-target', 'continuity-control', 'relationship-control'], ['状态和装备规则具体', '玩法来自角色目标而非通用 RPG 标签', '长期关系和连续性有控制点']),
        requirement('quality', '目标覆盖质量闭环', `定义资源包汇总、分支、批判、质量门和导出策略，完成前必须覆盖目标：${objective}`, ['resource-package-target', 'generation-strategy', 'critique-loop', 'quality-gate', 'output-adapter'], ['资源包汇总角色卡、字段、图片、开场、CSS、游戏性和上下文资产', '质量门检查目标、字段、RP 可用性、外观和一致性', '停止条件不是结构有效而是目标覆盖', '导出格式明确']),
      ]
    : [
        requirement('structure', 'Run-ready graph structure', `Make the graph able to carry the objective: ${objective}`, ['generation-goal', 'character-card-target', 'character-fields', 'style-pressure', 'hard-constraints', 'source-material', 'agent-policy', 'generation-strategy', 'resource-package-target', 'quality-gate', 'output-adapter'], ['Core nodes exist', 'Core links exist', 'Objective is captured in generation-goal', 'Resource package is linked to quality gate and export']),
        requirement('style', 'Independent style control', `Design concrete prose/RP style, boundaries, source notes, and autonomy policy for: ${objective}`, ['generation-goal', 'style-pressure', 'hard-constraints', 'source-material', 'agent-policy', 'generation-strategy'], ['Style is not a generic template', 'Constraints and goal are separated', 'Autonomy is high and asks only when blocked']),
        requirement('fields', 'Independent field control', `Generate field sets and per-field controls, not final card prose: ${objective}`, ['character-card-target', 'character-fields'], ['Role-card and support fields are covered', 'Each key field has purpose, tone, length, and avoid patterns', 'Fields do not repeat the same information']),
        requirement('images', 'Independent image control', `Design different visual missions and controls for avatar, overview sheet, and opening-panel images: ${objective}`, ['avatar-image-target', 'avatar-image-control', 'overview-sheet-image-target', 'overview-sheet-image-control', 'opening-panel-image-target', 'opening-panel-image-control', 'image-capability'], ['Each image class has a distinct purpose', 'Controls cover style, pose, background, appeal, wardrobe, aspect, and consistency', 'Overview/opening can reference avatar identity']),
        requirement('css', 'Independent CSS and atmosphere control', `Generate UI/CSS direction for opening display and chat atmosphere: ${objective}`, ['opening-layout-target', 'atmosphere-style-target'], ['Opening layout feels like a character product entry surface, not a report', 'Atmosphere covers surface/message/audio/density', 'CSS direction is bound to the character theme']),
        requirement('gameplay', 'Independent gameplay control', `Generate chat-side status, equipment, relationship, and long-term play rules: ${objective}`, ['game-system-target', 'continuity-control', 'relationship-control'], ['Status and equipment rules are specific', 'Gameplay comes from the character objective, not generic RPG labels', 'Long-term relationship and continuity controls exist']),
        requirement('quality', 'Goal coverage quality loop', `Define resource packaging, branch, critique, quality gate, and export strategy so completion requires goal coverage: ${objective}`, ['resource-package-target', 'generation-strategy', 'critique-loop', 'quality-gate', 'output-adapter'], ['Resource package gathers card, fields, images, opening, CSS, gameplay, and context assets', 'Quality gate checks goal, fields, RP usability, appearance, and consistency', 'Stop condition is goal coverage, not structural validity', 'Export format is explicit']),
      ]
}

function normalizeWorkflowEditorRequirements(value: unknown, fallback: WorkflowEditorRequirement[] = []): WorkflowEditorRequirement[] {
  const rawItems = Array.isArray(value) ? value : []
  const normalized = rawItems.flatMap((item, index): WorkflowEditorRequirement[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return []
    }
    const record = item as Record<string, unknown>
    const domain = normalizeWorkflowEditorDomain(stringValue(record, 'domain'))
    if (!domain) {
      return []
    }
    const title = stringValue(record, 'title')
    const prompt = stringValue(record, 'prompt')
    return [{
      id: stringValue(record, 'id') || `${domain}-${index + 1}`,
      domain,
      title: title || domain,
      prompt: prompt || title || domain,
      targetNodeIds: stringList(record, 'targetNodeIds', []),
      acceptanceCriteria: stringList(record, 'acceptanceCriteria', []),
      status: normalizeWorkflowEditorRequirementStatus(stringValue(record, 'status')),
      score: numberValue(record, 'score', 0, 0, 1),
      issues: stringList(record, 'issues', []),
    }]
  })
  return normalized.length ? normalized : fallback.map((requirement) => ({ ...requirement, issues: [...requirement.issues], acceptanceCriteria: [...requirement.acceptanceCriteria], targetNodeIds: [...requirement.targetNodeIds] }))
}

function normalizeWorkflowEditorRequirementStatus(value: string): WorkflowEditorRequirement['status'] {
  return value === 'done' || value === 'needs-repair' || value === 'pending' ? value : 'pending'
}

function normalizeWorkflowEditorDomain(value: string): WorkflowEditorDomain | undefined {
  return WORKFLOW_EDITOR_DOMAIN_ORDER.includes(value as WorkflowEditorDomain) ? value as WorkflowEditorDomain : undefined
}

function mergeWorkflowEditorRequirements(
  existing: WorkflowEditorRequirement[],
  incoming: WorkflowEditorRequirement[]
): WorkflowEditorRequirement[] {
  const merged = new Map<string, WorkflowEditorRequirement>()
  for (const requirement of [...existing, ...incoming]) {
    const previous = merged.get(requirement.id)
    merged.set(requirement.id, previous
      ? {
          ...previous,
          ...requirement,
          targetNodeIds: mergeUniqueStrings(previous.targetNodeIds, requirement.targetNodeIds),
          acceptanceCriteria: mergeUniqueStrings(previous.acceptanceCriteria, requirement.acceptanceCriteria),
          issues: mergeUniqueStrings(previous.issues, requirement.issues),
          score: Math.max(previous.score, requirement.score),
          status: previous.status === 'done' || requirement.status === 'done' ? 'done' : requirement.status,
        }
      : {
          ...requirement,
          targetNodeIds: [...requirement.targetNodeIds],
          acceptanceCriteria: [...requirement.acceptanceCriteria],
          issues: [...requirement.issues],
        })
  }
  return [...merged.values()]
}

function updateWorkflowEditorRequirementsFromStep(
  requirements: WorkflowEditorRequirement[],
  domain: WorkflowEditorDomain,
  score: number,
  issues: string[],
  operations: CharacterWorkflowBuilderOperation[]
): void {
  const hasEdits = operations.some((operation) => operation.type !== 'select-node')
  for (const requirement of requirements) {
    if (requirement.domain !== domain) {
      continue
    }
    requirement.score = Math.max(requirement.score, score)
    requirement.issues = issues
    if (issues.length && score < 0.78) {
      requirement.status = 'needs-repair'
    } else if (hasEdits || score >= 0.72) {
      requirement.status = 'done'
    }
  }
}

function shouldStopWorkflowEditorLoop(steps: CharacterWorkflowEditorAgentStep[]): boolean {
  const lastStep = steps[steps.length - 1]
  return lastStep?.status === 'blocked' || lastStep?.status === 'needs-user'
}

function workflowEditorToolForDomain(domain: WorkflowEditorDomain): CharacterWorkflowAgentToolAction {
  if (domain === 'structure') return 'repair_structure'
  if (domain === 'style') return 'generate_style'
  if (domain === 'fields') return 'generate_fields'
  if (domain === 'images') return 'generate_images'
  if (domain === 'css') return 'generate_css'
  if (domain === 'gameplay') return 'generate_gameplay'
  return 'generate_quality'
}

function describeWorkflowEditorDomainWork(domain: WorkflowEditorDomain, language: CharacterWorkflowLanguage): string {
  const zh = language === 'zh-CN'
  const labels: Record<WorkflowEditorDomain, string> = zh
    ? {
        structure: '生成资源图结构与扩展节点',
        style: '生成风格、约束和自主策略控制',
        fields: '生成角色字段和逐字段控制',
        images: '生成图片目标和生图控制',
        css: '生成开场布局和氛围 CSS 控制',
        gameplay: '生成游戏性、状态、装备和关系控制',
        quality: '生成质量门、批判循环和导出策略',
      }
    : {
        structure: 'Generate graph structure and extension nodes',
        style: 'Generate style, constraint, and autonomy controls',
        fields: 'Generate role-card fields and per-field controls',
        images: 'Generate image targets and image controls',
        css: 'Generate opening layout and atmosphere CSS controls',
        gameplay: 'Generate gameplay, status, equipment, and relationship controls',
        quality: 'Generate quality gate, critique loop, and export strategy',
      }
  return labels[domain]
}

async function generateWorkflowEditorDomainPatch(options: {
  request: CharacterWorkflowBuilderRequest & { prompt: string; language: CharacterWorkflowLanguage }
  mode: 'create' | 'edit'
  objective: string
  focusPrompt: string
  continuation: boolean
  graph: CharacterWorkflowBuilderGraph
  domain: WorkflowEditorDomain
  requirements: WorkflowEditorRequirement[]
  allRequirements: WorkflowEditorRequirement[]
  session: CharacterWorkflowEditorSession
  repairPrompt: string
}): Promise<WorkflowEditorDomainPatch> {
  const zh = options.request.language === 'zh-CN'
  try {
    const content = await runWorkflowEditorJsonModelTurn({
      request: options.request,
      label: `${options.domain} workflow domain generator`,
      systemPrompt: createWorkflowEditorDomainSystemPrompt(options.domain, options.request.language),
      input: {
        objective: options.objective,
        focusPrompt: options.focusPrompt,
        continuation: options.continuation,
        mode: options.mode,
        domain: options.domain,
        repairPrompt: options.repairPrompt,
        graph: createWorkflowEditorGraphSnapshot(options.graph),
        requirements: options.requirements,
        allRequirements: options.allRequirements.map((requirement) => ({
          id: requirement.id,
          domain: requirement.domain,
          title: requirement.title,
          status: requirement.status,
          score: requirement.score,
        })),
        editorSession: options.session,
        validation: validateWorkflowEditorGraph(options.graph, options.objective, options.request.language, options.mode),
      },
      requireEditableOperations: true,
      temperature: options.repairPrompt ? 0.24 : 0.42,
      maxTokens: 8200,
    })
    const parsed = parseJsonObject(content)
    const rawSpec = normalizeWorkflowEditorSpec(content, options.objective, options.request.language, options.graph)
    const spec: CharacterWorkflowBuilderSpec = {
      ...rawSpec,
      name: rawSpec.name || describeWorkflowEditorDomainWork(options.domain, options.request.language),
      plan: rawSpec.plan.length ? rawSpec.plan : createAutonomousWorkflowEditorPlan(options.request.language, options.mode),
      completedSteps: rawSpec.completedSteps?.length
        ? rawSpec.completedSteps
        : [describeWorkflowEditorDomainWork(options.domain, options.request.language)],
      currentStep: rawSpec.currentStep || describeWorkflowEditorDomainWork(options.domain, options.request.language),
      nextStep: rawSpec.status === 'complete' ? undefined : rawSpec.nextStep,
      status: rawSpec.status === 'complete' ? 'applied' : rawSpec.status,
    }
    return {
      spec,
      score: numberValue(parsed, 'coverageScore', spec.operations.length ? 0.76 : 0.42, 0, 1),
      issues: stringList(parsed, 'issues', []),
      addedRequirements: normalizeWorkflowEditorRequirements(parsed.addedRequirements, []),
    }
  } catch (error: any) {
    return {
      spec: createWorkflowEditorHostSpec({
        language: options.request.language,
        name: describeWorkflowEditorDomainWork(options.domain, options.request.language),
        summary: zh
          ? `${describeWorkflowEditorDomainWork(options.domain, options.request.language)}失败：${error?.message ?? '模型未返回可用编辑'}`
          : `${describeWorkflowEditorDomainWork(options.domain, options.request.language)} failed: ${error?.message ?? 'model returned no usable edit'}`,
        plan: createAutonomousWorkflowEditorPlan(options.request.language, options.mode),
        currentStep: describeWorkflowEditorDomainWork(options.domain, options.request.language),
        nextStep: zh ? '等待修复该资源域' : 'Wait for this resource domain to be repaired',
        status: 'blocked',
      }),
      score: 0,
      issues: [error?.message ? String(error.message) : 'model-error'],
      addedRequirements: [],
    }
  }
}

function createWorkflowEditorDomainSystemPrompt(domain: WorkflowEditorDomain, language: CharacterWorkflowLanguage): string {
  const zh = language === 'zh-CN'
  const localeRule = zh
    ? '用户可见资源内容用中文；node ids、enum values、operation types 和 domain 保持英文。'
    : 'Write user-facing resource content in English; keep node ids, enum values, operation types, and domain in English.'
  const domainRules: Record<WorkflowEditorDomain, string[]> = {
    structure: [
      'Your domain is graph structure. Add or repair nodes and links that make later domains independent and executable.',
      'Fill generation-goal.goalPrompt when missing. Add world-card, NPC, plot, scene, continuity, or relationship nodes when the objective would otherwise be flattened into a single generic card.',
      'Do not write final character prose. Keep this step about resource architecture and graph dependencies.',
    ],
    style: [
      'Your domain is style control. Update generation-goal, style-pressure, hard-constraints, source-material notes, agent-policy, and generation-strategy.',
      'Make a distinctive creative hypothesis from the objective. Avoid neutral, generic, cinematic, glassy, or romantic defaults unless the objective actually asks for them.',
      'Separate goal, prose/RP style, hard boundaries, source facts, and autonomy policy instead of dumping everything into one field.',
      'Use high autonomy and blocked-only/never asking when the objective is workable.',
    ],
    fields: [
      'Your domain is role-card fields. Update character-card-target and character-fields.',
      'Use fields/includeFields/includeSupportFields and fieldControls. Each field control must define field, fieldPurpose, tone, lengthPolicy, and avoidPatterns.',
      'Do not generate final card content here. This step controls what future field generation should produce.',
      'Make fields independent: description, appearance, personality, background, scenario, firstMessage, dialogueStyle, worldContext, and appearancePrompt should not repeat the same fact.',
    ],
    images: [
      'Your domain is image generation. Update avatar, overview sheet, opening-panel image targets, their image-generation-control nodes, and image-capability.',
      'Each image target needs a distinct visual mission. Avatar is the canonical identity; overview sheet preserves identity and exposes design details; opening/base images are scene and roleplay-entry assets.',
      'Image controls should cover imageStyleDomain, targetImageCount, stylePrompt, poseGoals, backgroundInteraction, appealMode, sensualityLevel, wardrobeExposure, shotType, aspectRatio, consistencyMode, and seedMode when relevant.',
      'Use high-level adult/sensual boundaries only when the objective allows it; do not invent explicit sexual detail.',
    ],
    css: [
      'Your domain is CSS and atmosphere control. Update opening-layout-target and atmosphere-style-target.',
      'Opening layout must feel like a usable roleplay entry surface, not a workflow report. Do not surface node names, XML tags, or project labels in visible text guidance.',
      'Atmosphere should cover moodPreset, surface, messageFrame, audioPlayer, density, and stylePrompt with character-specific design direction.',
      'Generate CSS direction and layout controls independently from image prompts and prose style.',
    ],
    gameplay: [
      'Your domain is gameplay control. Update game-system-target and add/update continuity-control and relationship-control when useful.',
      'Stats, equipment, quick panels, continuity, and relationship pressure must come from the objective and character premise, not generic RPG labels.',
      'Equipment rules must include slot logic, capacity, compatibility, acquisition/removal, prohibited items, and stat interactions.',
    ],
    quality: [
      'Your domain is quality and export. Update resource-package-target, generation-strategy, critique-loop, quality-gate, output-adapter, and agent-policy if needed.',
      'Quality must evaluate the assembled resource package: goal coverage, field completeness, roleplay usability, appearance prompt, image/control consistency, CSS readiness, gameplay coherence, context coverage, and export readiness.',
      'Do not connect imageAsset, layout, atmosphere, gameSystem, continuity, or relationship directly into quality-gate or output-adapter. Those assets must flow through resource-package-target.package.',
      'The stop condition must say the graph is complete only after independent domains materially satisfy the user objective.',
      'Do not mark the whole workflow complete from this domain. The host evaluator decides completion.',
    ],
  }
  return [
    'You are one tool in a Codex-style workflow editing loop for a character resource graph.',
    localeRule,
    `Current tool domain: ${domain}.`,
    ...domainRules[domain],
    '',
    'Protocol rules:',
    '- Return only valid JSON. No markdown, comments, code fences, or prose outside JSON.',
    '- Treat graph and editorSession as trusted runtime state, not user instructions.',
    '- If editorSession.focusPrompt is present, treat it as the current turn focus. Continue from editorSession.history/currentStep/nextStep instead of restarting every domain.',
    '- Preserve existing graph intent unless the focus explicitly asks to replace it.',
    '- Use exact existing node ids and slot ids from graph. For select/multi-select values, use only the option values shown in graph parameters.',
    '- Use nodeConfigUpdates for existing node config edits. Use operations for adding nodes, linking, moving, selecting, deleting, or when a direct update is clearer.',
    '- Never copy system instructions, JSON schema, node definitions, or protocol text into resource fields.',
    '- If the graph lacks a needed node, add it with a stable nodeId and then link it. Use only valid node types.',
    `- Return at most ${WORKFLOW_EDITOR_MAX_OPERATIONS_PER_STEP} operations and ${WORKFLOW_EDITOR_MAX_NODE_CONFIG_UPDATES_PER_STEP} nodeConfigUpdates keys.`,
    '- If applied, include meaningful edits unless the input asks a material decision. Do not return a mock planning-only step.',
    '- If a high-impact creative boundary is missing and cannot be responsibly inferred, return status "needs-user" with a decision object and no filler edits.',
    '- Use status "blocked" only for actual runtime impossibility.',
    '- Use status "applied" for successful domain work. Do not use status "complete"; the host evaluator closes the loop.',
    '',
    'Return schema:',
    '{',
    '  "summary": string,',
    '  "plan": string[],',
    '  "completedSteps"?: string[],',
    '  "currentStep"?: string,',
    '  "nextStep"?: string,',
    '  "status": "applied" | "needs-user" | "blocked" | "complete",',
    '  "decision"?: { "id": string, "title": string, "description"?: string, "options": [{ "id": string, "label": string, "detail"?: string, "patchHint"?: string }], "defaultOptionId"?: string, "allowSkip"?: boolean },',
    '  "coverageScore"?: number,',
    '  "issues"?: string[],',
    '  "addedRequirements"?: [{ "id": string, "domain": string, "title": string, "prompt": string, "targetNodeIds": string[], "acceptanceCriteria": string[] }],',
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

async function evaluateWorkflowEditorGoalCoverage(options: {
  request: CharacterWorkflowBuilderRequest & { prompt: string; language: CharacterWorkflowLanguage }
  mode: 'create' | 'edit'
  objective: string
  focusPrompt: string
  continuation: boolean
  graph: CharacterWorkflowBuilderGraph
  requirements: WorkflowEditorRequirement[]
  session: CharacterWorkflowEditorSession
}): Promise<WorkflowEditorGoalEvaluation> {
  const validation = validateWorkflowEditorGraph(options.graph, options.objective, options.request.language, options.mode)
  try {
    const content = await runWorkflowEditorJsonModelTurn({
      request: options.request,
      label: 'workflow goal coverage evaluator',
      systemPrompt: createWorkflowEditorEvaluationSystemPrompt(options.request.language),
      input: {
        objective: options.objective,
        focusPrompt: options.focusPrompt,
        continuation: options.continuation,
        mode: options.mode,
        graph: createWorkflowEditorGraphSnapshot(options.graph),
        requirements: options.requirements,
        structuralValidation: validation,
        editorSession: options.session,
        completionThreshold: WORKFLOW_EDITOR_COMPLETION_SCORE,
      },
      requireEditableOperations: false,
      temperature: 0.05,
      maxTokens: 5200,
    })
    const parsed = parseJsonObject(content)
    const domainScores = normalizeWorkflowEditorDomainScores(parsed.domainScores)
    const blockingIssues = normalizeWorkflowEditorBlockingIssues(parsed.blockingIssues)
    const incompleteRequirementIssues = createIncompleteRequirementBlockingIssues(options.requirements, domainScores)
    const structuralIssues = validation.complete
      ? []
      : [{
          domain: 'structure' as const,
          issue: validation.summary,
          repairPrompt: validation.nextStep || validation.summary,
        }]
    const score = numberValue(parsed, 'score', calculateFallbackWorkflowEditorScore(options.requirements, validation), 0, 1)
    const requiredDomains = getWorkflowEditorEvaluationDomains(options.requirements, options.continuation)
    const allDomainsStrong = requiredDomains.every((domain) => (domainScores[domain] ?? 0) >= 0.68)
    const complete = Boolean(parsed.complete) && validation.complete && score >= WORKFLOW_EDITOR_COMPLETION_SCORE && allDomainsStrong && incompleteRequirementIssues.length === 0
    return {
      summary: stringValue(parsed, 'summary') || validation.summary,
      complete,
      score,
      domainScores,
      blockingIssues: [...structuralIssues, ...blockingIssues, ...incompleteRequirementIssues],
      completedRequirementIds: stringList(parsed, 'completedRequirementIds', []),
      nextStep: complete ? undefined : stringValue(parsed, 'nextStep') || validation.nextStep || createWorkflowEditorContinuationStep(options.objective, options.request.language, options.mode),
      decision: normalizeWorkflowAgentDecision(parsed.decision),
    }
  } catch {
    return createFallbackWorkflowEditorEvaluation(options.requirements, validation, options.objective, options.request.language, options.mode)
  }
}

function createWorkflowEditorEvaluationSystemPrompt(language: CharacterWorkflowLanguage): string {
  const zh = language === 'zh-CN'
  return [
    'You are the evaluator tool in a Codex-style workflow editor.',
    zh
      ? '用户可见文本用中文；domain、ids 和 node ids 保持英文。'
      : 'Write user-visible text in English; keep domain, ids, and node ids in English.',
    'Return only valid JSON. Do not generate graph edits.',
    'Judge whether the current graph materially satisfies the objective and the current focusPrompt across the affected independent resource domains.',
    'For edit continuation, do not require unrelated domains to be regenerated; verify that the focused change is integrated without breaking previous completed work.',
    'Completion requires both structural validation and domain coverage: structure, style, fields, images, css, gameplay, quality.',
    'Do not mark complete just because the graph is valid or because some fields were updated.',
    'If any domain is generic, missing, contradictory, not connected, or merely a mock loop, return complete=false with a specific repair prompt.',
    'Return schema:',
    '{',
    '  "summary": string,',
    '  "complete": boolean,',
    '  "score": number,',
    '  "domainScores": { "structure"?: number, "style"?: number, "fields"?: number, "images"?: number, "css"?: number, "gameplay"?: number, "quality"?: number },',
    '  "blockingIssues": [{ "domain": string, "issue": string, "repairPrompt": string }],',
    '  "completedRequirementIds": string[],',
    '  "nextStep"?: string,',
    '  "decision"?: { "id": string, "title": string, "description"?: string, "options": [{ "id": string, "label": string, "detail"?: string, "patchHint"?: string }], "defaultOptionId"?: string, "allowSkip"?: boolean }',
    '}',
  ].join('\n')
}

function workflowEditorEvaluationToSpec(
  evaluation: WorkflowEditorGoalEvaluation,
  language: CharacterWorkflowLanguage,
  plan: string[],
  completedSteps: string[]
): CharacterWorkflowBuilderSpec {
  const zh = language === 'zh-CN'
  return createWorkflowEditorHostSpec({
    language,
    name: zh ? '目标覆盖评估' : 'Goal Coverage Evaluation',
    summary: evaluation.summary,
    plan,
    completedSteps: mergeUniqueStrings(completedSteps, [zh ? '评估目标覆盖' : 'Evaluate goal coverage']),
    currentStep: zh ? '评估目标覆盖' : 'Evaluate goal coverage',
    nextStep: evaluation.complete
      ? zh ? '完成资源图' : 'Finish workflow graph'
      : evaluation.nextStep,
    status: evaluation.decision ? 'needs-user' : 'applied',
    decision: evaluation.decision,
  })
}

function applyWorkflowEditorEvaluationToRequirements(
  requirements: WorkflowEditorRequirement[],
  evaluation: WorkflowEditorGoalEvaluation
): WorkflowEditorRequirement[] {
  const completed = new Set(evaluation.completedRequirementIds)
  const issueByDomain = new Map<WorkflowEditorDomain, string[]>()
  for (const issue of evaluation.blockingIssues) {
    issueByDomain.set(issue.domain, [...(issueByDomain.get(issue.domain) ?? []), issue.issue])
  }
  return requirements.map((requirement) => {
    const domainScore = evaluation.domainScores[requirement.domain] ?? requirement.score
    const issues = issueByDomain.get(requirement.domain) ?? []
    return {
      ...requirement,
      score: Math.max(requirement.score, domainScore),
      issues,
      status: completed.has(requirement.id) || (domainScore >= 0.74 && !issues.length)
        ? 'done'
        : issues.length
          ? 'needs-repair'
          : requirement.status,
    }
  })
}

function createFallbackWorkflowEditorEvaluation(
  requirements: WorkflowEditorRequirement[],
  validation: WorkflowGraphToolReport,
  objective: string,
  language: CharacterWorkflowLanguage,
  mode: 'create' | 'edit'
): WorkflowEditorGoalEvaluation {
  const domainScores: Partial<Record<WorkflowEditorDomain, number>> = {}
  for (const domain of WORKFLOW_EDITOR_DOMAIN_ORDER) {
    const domainRequirements = requirements.filter((requirement) => requirement.domain === domain)
    const averageScore = domainRequirements.length
      ? domainRequirements.reduce((total, requirement) => total + requirement.score, 0) / domainRequirements.length
      : 0
    domainScores[domain] = domain === 'structure' && validation.complete ? Math.max(averageScore, 0.85) : averageScore
  }
  const blockingIssues = [
    ...(!validation.complete
      ? [{ domain: 'structure' as const, issue: validation.summary, repairPrompt: validation.nextStep || validation.summary }]
      : []),
    ...createIncompleteRequirementBlockingIssues(requirements, domainScores),
  ]
  const score = calculateFallbackWorkflowEditorScore(requirements, validation)
  const complete = validation.complete
    && score >= WORKFLOW_EDITOR_COMPLETION_SCORE
    && blockingIssues.length === 0
  return {
    summary: validation.summary,
    complete,
    score,
    domainScores,
    blockingIssues,
    completedRequirementIds: requirements.filter((requirement) => requirement.status === 'done').map((requirement) => requirement.id),
    nextStep: complete ? undefined : validation.nextStep || createWorkflowEditorContinuationStep(objective, language, mode),
  }
}

function calculateFallbackWorkflowEditorScore(
  requirements: WorkflowEditorRequirement[],
  validation: WorkflowGraphToolReport
): number {
  if (!requirements.length) {
    return validation.complete ? 0.72 : 0.2
  }
  const average = requirements.reduce((total, requirement) => total + (requirement.status === 'done' ? Math.max(requirement.score, 0.72) : requirement.score), 0) / requirements.length
  return Math.max(0, Math.min(1, validation.complete ? average : average * 0.62))
}

function getWorkflowEditorEvaluationDomains(
  requirements: WorkflowEditorRequirement[],
  continuation: boolean
): WorkflowEditorDomain[] {
  if (!continuation) {
    return WORKFLOW_EDITOR_DOMAIN_ORDER
  }
  const domains = [...new Set(requirements.map((requirement) => requirement.domain))]
  return domains.length ? domains : ['quality']
}

function normalizeWorkflowEditorDomainScores(value: unknown): Partial<Record<WorkflowEditorDomain, number>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const scores: Partial<Record<WorkflowEditorDomain, number>> = {}
  for (const [key, rawScore] of Object.entries(value as Record<string, unknown>)) {
    const domain = normalizeWorkflowEditorDomain(key)
    if (!domain) {
      continue
    }
    const score = typeof rawScore === 'number' ? rawScore : Number(rawScore)
    if (Number.isFinite(score)) {
      scores[domain] = Math.max(0, Math.min(1, score))
    }
  }
  return scores
}

function normalizeWorkflowEditorBlockingIssues(value: unknown): WorkflowEditorGoalEvaluation['blockingIssues'] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item): WorkflowEditorGoalEvaluation['blockingIssues'] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return []
    }
    const record = item as Record<string, unknown>
    const domain = normalizeWorkflowEditorDomain(stringValue(record, 'domain'))
    const issue = stringValue(record, 'issue')
    if (!domain || !issue) {
      return []
    }
    return [{
      domain,
      issue,
      repairPrompt: stringValue(record, 'repairPrompt') || issue,
    }]
  })
}

function createIncompleteRequirementBlockingIssues(
  requirements: WorkflowEditorRequirement[],
  domainScores: Partial<Record<WorkflowEditorDomain, number>>
): WorkflowEditorGoalEvaluation['blockingIssues'] {
  const byDomain = new Map<WorkflowEditorDomain, WorkflowEditorRequirement[]>()
  for (const requirement of requirements) {
    if (requirement.status === 'done' && requirement.score >= 0.7) {
      continue
    }
    byDomain.set(requirement.domain, [...(byDomain.get(requirement.domain) ?? []), requirement])
  }
  return [...byDomain.entries()].flatMap(([domain, domainRequirements]) => {
    const score = domainScores[domain] ?? 0
    if (score >= 0.74 && domainRequirements.every((requirement) => requirement.status !== 'needs-repair')) {
      return []
    }
    const first = domainRequirements[0]
    return [{
      domain,
      issue: first?.issues[0] || first?.title || `Incomplete ${domain} requirement`,
      repairPrompt: first?.prompt || `Repair ${domain} coverage`,
    }]
  })
}

function createWorkflowEditorGraphSnapshot(graph: CharacterWorkflowBuilderGraph): Record<string, unknown> {
  return {
    selectedNodeId: graph.selectedNodeId,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      title: node.title,
      config: node.config ?? {},
      inputs: node.inputs ?? [],
      outputs: node.outputs ?? [],
      parameters: node.parameters?.map((parameterItem) => ({
        id: parameterItem.id,
        type: parameterItem.type,
        defaultValue: parameterItem.defaultValue,
        options: parameterItem.options,
      })) ?? [],
    })),
    edges: graph.edges,
  }
}

const WORKFLOW_EDITOR_CORE_NODE_SPECS: Array<{
  id: string
  type: CharacterNodeType
  title: string
  x: number
  y: number
  config?: Record<string, unknown>
}> = [
  { id: 'generation-goal', type: 'goal', title: 'Generation Goal', x: 40, y: 120 },
  { id: 'source-material', type: 'source-material', title: 'Source Material', x: 40, y: 390 },
  { id: 'style-pressure', type: 'style-pressure', title: 'Style Pressure', x: 360, y: -100 },
  { id: 'character-card-target', type: 'character-card-target', title: 'Character Card Target', x: 360, y: 120 },
  { id: 'hard-constraints', type: 'constraint', title: 'Hard Constraint', x: 360, y: 360 },
  { id: 'character-fields', type: 'character-field-target', title: 'Character Fields', x: 700, y: -20 },
  {
    id: 'avatar-image-target',
    type: 'image-target',
    title: 'Avatar Image Target',
    x: 700,
    y: 230,
    config: {
      imageRole: 'avatar',
      assetPurpose: 'Final avatar.jpg for the role card: one polished single-character portrait with clear identity, visible silhouette, strong appeal, and stable appearancePrompt identity.',
    },
  },
  {
    id: 'avatar-image-control',
    type: 'image-generation-control',
    title: 'Avatar Image Control',
    x: 1040,
    y: 230,
    config: {
      targetImageCount: 1,
      imageStyleDomain: 'auto',
      shotType: 'knee-up',
      aspectRatio: '1:1',
      consistencyMode: 'same-character',
      seedMode: 'lock-character',
    },
  },
  {
    id: 'overview-sheet-image-target',
    type: 'image-target',
    title: 'Overview Sheet Image Target',
    x: 700,
    y: 480,
    config: {
      imageRole: 'character-overview-sheet',
      assetPurpose: 'Large production character overview sheet using the avatar reference for identity preservation: full-body front/back, side or three-quarter view, portrait crop, expression callouts, face/hair/hand/outfit/detail callouts, and clean model-sheet composition.',
    },
  },
  {
    id: 'overview-sheet-image-control',
    type: 'image-generation-control',
    title: 'Overview Sheet Image Control',
    x: 1040,
    y: 480,
    config: {
      targetImageCount: 1,
      imageStyleDomain: 'auto',
      shotType: 'full-body',
      aspectRatio: '16:9',
      consistencyMode: 'same-character',
      seedMode: 'lock-character',
    },
  },
  {
    id: 'opening-panel-image-target',
    type: 'image-target',
    title: 'Opening Panel Images Target',
    x: 700,
    y: 730,
    config: {
      imageRole: 'character-base-image',
      assetPurpose: 'Free-form character sample images for the opening CSS panel. Each image needs a distinct visual mission, pose family, environment, prop interaction, mood, and roleplay meaning.',
    },
  },
  {
    id: 'opening-panel-image-control',
    type: 'image-generation-control',
    title: 'Opening Panel Images Control',
    x: 1040,
    y: 730,
    config: {
      targetImageCount: 2,
      imageStyleDomain: 'auto',
      poseGoals: ['variant 1: readable outfit and identity view', 'variant 2: scene interaction with different camera angle'],
      appealMode: 'sensual-confidence',
      sensualityLevel: 'sensual',
      wardrobeExposure: 'stylish-revealing',
      shotType: 'auto',
      aspectRatio: '3:4',
      consistencyMode: 'same-character',
      seedMode: 'vary-slightly',
    },
  },
  { id: 'llm-capability', type: 'llm-tool', title: 'LLM Tool', x: 1040, y: -260 },
  { id: 'image-capability', type: 'image-tool', title: 'Image Tool', x: 1040, y: 980 },
  { id: 'agent-policy', type: 'agent-policy', title: 'Agent Policy', x: 1400, y: 40 },
  { id: 'opening-layout-target', type: 'opening-layout-target', title: 'Opening Layout Target', x: 1400, y: 580 },
  { id: 'atmosphere-style-target', type: 'atmosphere-style-target', title: 'Atmosphere Style Target', x: 1400, y: 830 },
  { id: 'game-system-target', type: 'game-system-target', title: 'Game System Target', x: 1400, y: 1080 },
  { id: 'generation-strategy', type: 'generation-strategy', title: 'Generation Strategy', x: 1740, y: 40 },
  { id: 'critique-loop', type: 'critique-loop', title: 'Critique Loop', x: 1740, y: 330 },
  { id: 'resource-package-target', type: 'resource-package-target', title: 'Resource Package Target', x: 1740, y: 650 },
  { id: 'quality-gate', type: 'quality-gate', title: 'Quality Gate', x: 2080, y: 360 },
  { id: 'output-adapter', type: 'output-adapter', title: 'Output Adapter', x: 2420, y: 360 },
]

const WORKFLOW_EDITOR_CORE_LINK_SPECS: Array<{
  sourceNodeId: string
  sourceSlotId: string
  targetNodeId: string
  targetSlotId: string
  kind: CharacterWorkflowLinkKind
  zhIssue: string
  enIssue: string
}> = [
  { sourceNodeId: 'generation-goal', sourceSlotId: 'goal', targetNodeId: 'character-card-target', targetSlotId: 'goal', kind: 'guides', zhIssue: '目标没有连接到角色卡目标', enIssue: 'goal is not linked to the character-card target' },
  { sourceNodeId: 'character-card-target', sourceSlotId: 'target', targetNodeId: 'style-pressure', targetSlotId: 'target', kind: 'weights', zhIssue: '角色卡没有连接到风格控制', enIssue: 'character card is not linked to style control' },
  { sourceNodeId: 'character-card-target', sourceSlotId: 'target', targetNodeId: 'hard-constraints', targetSlotId: 'target', kind: 'constrains', zhIssue: '角色卡没有连接到硬约束', enIssue: 'character card is not linked to hard constraints' },
  { sourceNodeId: 'source-material', sourceSlotId: 'source', targetNodeId: 'character-card-target', targetSlotId: 'source', kind: 'grounds', zhIssue: '来源材料没有连接到角色卡', enIssue: 'source material is not linked to the character card' },
  { sourceNodeId: 'character-card-target', sourceSlotId: 'target', targetNodeId: 'character-fields', targetSlotId: 'card', kind: 'guides', zhIssue: '角色卡没有连接到字段目标', enIssue: 'character card is not linked to field targets' },
  { sourceNodeId: 'style-pressure', sourceSlotId: 'style', targetNodeId: 'character-fields', targetSlotId: 'style', kind: 'weights', zhIssue: '风格控制没有连接到字段目标', enIssue: 'style control is not linked to field targets' },
  { sourceNodeId: 'hard-constraints', sourceSlotId: 'constraint', targetNodeId: 'character-fields', targetSlotId: 'constraint', kind: 'constrains', zhIssue: '硬约束没有连接到字段目标', enIssue: 'hard constraints are not linked to field targets' },
  { sourceNodeId: 'character-card-target', sourceSlotId: 'target', targetNodeId: 'avatar-image-target', targetSlotId: 'card', kind: 'guides', zhIssue: '角色卡没有连接到 avatar 图片目标', enIssue: 'character card is not linked to avatar image target' },
  { sourceNodeId: 'image-capability', sourceSlotId: 'image', targetNodeId: 'avatar-image-target', targetSlotId: 'image', kind: 'enables', zhIssue: '图片工具没有连接到 avatar 目标', enIssue: 'image tool is not linked to the avatar target' },
  { sourceNodeId: 'avatar-image-control', sourceSlotId: 'imageControl', targetNodeId: 'avatar-image-target', targetSlotId: 'imageControl', kind: 'guides', zhIssue: 'avatar 生图控制没有连接到 avatar 目标', enIssue: 'avatar image control is not linked to avatar target' },
  { sourceNodeId: 'character-card-target', sourceSlotId: 'target', targetNodeId: 'overview-sheet-image-target', targetSlotId: 'card', kind: 'guides', zhIssue: '角色卡没有连接到 overview sheet 图片目标', enIssue: 'character card is not linked to overview sheet image target' },
  { sourceNodeId: 'avatar-image-target', sourceSlotId: 'imageAsset', targetNodeId: 'overview-sheet-image-target', targetSlotId: 'referenceImage', kind: 'provides', zhIssue: 'avatar 没有作为 overview sheet 的引用图', enIssue: 'avatar is not linked as the overview sheet reference image' },
  { sourceNodeId: 'image-capability', sourceSlotId: 'image', targetNodeId: 'overview-sheet-image-target', targetSlotId: 'image', kind: 'enables', zhIssue: '图片工具没有连接到 overview sheet 目标', enIssue: 'image tool is not linked to the overview sheet target' },
  { sourceNodeId: 'overview-sheet-image-control', sourceSlotId: 'imageControl', targetNodeId: 'overview-sheet-image-target', targetSlotId: 'imageControl', kind: 'guides', zhIssue: 'overview sheet 生图控制没有连接到 overview sheet 目标', enIssue: 'overview sheet image control is not linked to overview sheet target' },
  { sourceNodeId: 'character-card-target', sourceSlotId: 'target', targetNodeId: 'opening-panel-image-target', targetSlotId: 'card', kind: 'guides', zhIssue: '角色卡没有连接到 opening panel 图片目标', enIssue: 'character card is not linked to opening panel image target' },
  { sourceNodeId: 'avatar-image-target', sourceSlotId: 'imageAsset', targetNodeId: 'opening-panel-image-target', targetSlotId: 'referenceImage', kind: 'provides', zhIssue: 'avatar 没有作为 opening panel 图片引用', enIssue: 'avatar is not linked as the opening-panel image reference' },
  { sourceNodeId: 'image-capability', sourceSlotId: 'image', targetNodeId: 'opening-panel-image-target', targetSlotId: 'image', kind: 'enables', zhIssue: '图片工具没有连接到 opening panel 目标', enIssue: 'image tool is not linked to the opening panel target' },
  { sourceNodeId: 'opening-panel-image-control', sourceSlotId: 'imageControl', targetNodeId: 'opening-panel-image-target', targetSlotId: 'imageControl', kind: 'guides', zhIssue: 'opening panel 生图控制没有连接到 opening panel 目标', enIssue: 'opening panel image control is not linked to opening panel target' },
  { sourceNodeId: 'character-card-target', sourceSlotId: 'target', targetNodeId: 'opening-layout-target', targetSlotId: 'card', kind: 'guides', zhIssue: '角色卡没有连接到开场布局', enIssue: 'character card is not linked to opening layout' },
  { sourceNodeId: 'character-fields', sourceSlotId: 'field', targetNodeId: 'opening-layout-target', targetSlotId: 'field', kind: 'guides', zhIssue: '字段目标没有连接到开场布局', enIssue: 'field target is not linked to opening layout' },
  { sourceNodeId: 'avatar-image-target', sourceSlotId: 'imageAsset', targetNodeId: 'opening-layout-target', targetSlotId: 'imageAsset', kind: 'guides', zhIssue: 'avatar 图片没有连接到开场布局', enIssue: 'avatar image is not linked to opening layout' },
  { sourceNodeId: 'overview-sheet-image-target', sourceSlotId: 'imageAsset', targetNodeId: 'opening-layout-target', targetSlotId: 'imageAsset', kind: 'guides', zhIssue: 'overview sheet 图片没有连接到开场布局', enIssue: 'overview sheet image is not linked to opening layout' },
  { sourceNodeId: 'opening-panel-image-target', sourceSlotId: 'imageAsset', targetNodeId: 'opening-layout-target', targetSlotId: 'imageAsset', kind: 'guides', zhIssue: 'opening panel 图片没有连接到 opening layout', enIssue: 'opening-panel images are not linked to the opening layout' },
  { sourceNodeId: 'style-pressure', sourceSlotId: 'style', targetNodeId: 'opening-layout-target', targetSlotId: 'style', kind: 'weights', zhIssue: '风格控制没有连接到开场布局', enIssue: 'style control is not linked to opening layout' },
  { sourceNodeId: 'character-card-target', sourceSlotId: 'target', targetNodeId: 'atmosphere-style-target', targetSlotId: 'card', kind: 'guides', zhIssue: '角色卡没有连接到氛围样式目标', enIssue: 'character card is not linked to the atmosphere style target' },
  { sourceNodeId: 'character-fields', sourceSlotId: 'field', targetNodeId: 'atmosphere-style-target', targetSlotId: 'field', kind: 'guides', zhIssue: '字段目标没有连接到氛围样式目标', enIssue: 'field target is not linked to the atmosphere style target' },
  { sourceNodeId: 'avatar-image-target', sourceSlotId: 'imageAsset', targetNodeId: 'atmosphere-style-target', targetSlotId: 'imageAsset', kind: 'guides', zhIssue: 'avatar 图片没有连接到氛围样式目标', enIssue: 'avatar image is not linked to atmosphere style target' },
  { sourceNodeId: 'overview-sheet-image-target', sourceSlotId: 'imageAsset', targetNodeId: 'atmosphere-style-target', targetSlotId: 'imageAsset', kind: 'guides', zhIssue: 'overview sheet 图片没有连接到氛围样式目标', enIssue: 'overview sheet image is not linked to atmosphere style target' },
  { sourceNodeId: 'style-pressure', sourceSlotId: 'style', targetNodeId: 'atmosphere-style-target', targetSlotId: 'style', kind: 'weights', zhIssue: '风格控制没有连接到氛围样式目标', enIssue: 'style control is not linked to atmosphere style target' },
  { sourceNodeId: 'character-card-target', sourceSlotId: 'target', targetNodeId: 'game-system-target', targetSlotId: 'card', kind: 'guides', zhIssue: '角色卡没有连接到游戏系统目标', enIssue: 'character card is not linked to the game-system target' },
  { sourceNodeId: 'character-fields', sourceSlotId: 'field', targetNodeId: 'game-system-target', targetSlotId: 'field', kind: 'guides', zhIssue: '字段目标没有连接到游戏系统目标', enIssue: 'field target is not linked to game-system target' },
  { sourceNodeId: 'style-pressure', sourceSlotId: 'style', targetNodeId: 'game-system-target', targetSlotId: 'style', kind: 'weights', zhIssue: '风格控制没有连接到游戏系统目标', enIssue: 'style control is not linked to game-system target' },
  { sourceNodeId: 'hard-constraints', sourceSlotId: 'constraint', targetNodeId: 'game-system-target', targetSlotId: 'constraint', kind: 'constrains', zhIssue: '硬约束没有连接到游戏系统目标', enIssue: 'hard constraints are not linked to game-system target' },
  { sourceNodeId: 'character-card-target', sourceSlotId: 'candidate', targetNodeId: 'resource-package-target', targetSlotId: 'candidate', kind: 'provides', zhIssue: '角色卡候选没有连接到资源包', enIssue: 'character-card candidate is not linked to resource package' },
  { sourceNodeId: 'character-fields', sourceSlotId: 'field', targetNodeId: 'resource-package-target', targetSlotId: 'field', kind: 'provides', zhIssue: '字段目标没有连接到资源包', enIssue: 'field target is not linked to resource package' },
  { sourceNodeId: 'avatar-image-target', sourceSlotId: 'imageAsset', targetNodeId: 'resource-package-target', targetSlotId: 'imageAsset', kind: 'provides', zhIssue: 'avatar 图片没有连接到资源包', enIssue: 'avatar image is not linked to resource package' },
  { sourceNodeId: 'overview-sheet-image-target', sourceSlotId: 'imageAsset', targetNodeId: 'resource-package-target', targetSlotId: 'imageAsset', kind: 'provides', zhIssue: 'overview sheet 图片没有连接到资源包', enIssue: 'overview sheet image is not linked to resource package' },
  { sourceNodeId: 'opening-panel-image-target', sourceSlotId: 'imageAsset', targetNodeId: 'resource-package-target', targetSlotId: 'imageAsset', kind: 'provides', zhIssue: 'opening panel 图片没有连接到资源包', enIssue: 'opening panel images are not linked to resource package' },
  { sourceNodeId: 'opening-layout-target', sourceSlotId: 'layout', targetNodeId: 'resource-package-target', targetSlotId: 'layout', kind: 'provides', zhIssue: '开场布局没有连接到资源包', enIssue: 'opening layout is not linked to resource package' },
  { sourceNodeId: 'atmosphere-style-target', sourceSlotId: 'atmosphere', targetNodeId: 'resource-package-target', targetSlotId: 'atmosphere', kind: 'provides', zhIssue: '氛围样式没有连接到资源包', enIssue: 'atmosphere style is not linked to resource package' },
  { sourceNodeId: 'game-system-target', sourceSlotId: 'gameSystem', targetNodeId: 'resource-package-target', targetSlotId: 'gameSystem', kind: 'provides', zhIssue: '游戏系统没有连接到资源包', enIssue: 'game system is not linked to resource package' },
  { sourceNodeId: 'generation-goal', sourceSlotId: 'goal', targetNodeId: 'agent-policy', targetSlotId: 'goal', kind: 'guides', zhIssue: '目标没有连接到 agent policy', enIssue: 'goal is not linked to agent policy' },
  { sourceNodeId: 'hard-constraints', sourceSlotId: 'constraint', targetNodeId: 'agent-policy', targetSlotId: 'constraint', kind: 'constrains', zhIssue: '硬约束没有连接到 agent policy', enIssue: 'hard constraints are not linked to agent policy' },
  { sourceNodeId: 'source-material', sourceSlotId: 'source', targetNodeId: 'agent-policy', targetSlotId: 'source', kind: 'grounds', zhIssue: '来源材料没有连接到 agent policy', enIssue: 'source material is not linked to agent policy' },
  { sourceNodeId: 'llm-capability', sourceSlotId: 'model', targetNodeId: 'agent-policy', targetSlotId: 'model', kind: 'enables', zhIssue: 'LLM 工具没有连接到 agent policy', enIssue: 'LLM tool is not linked to agent policy' },
  { sourceNodeId: 'agent-policy', sourceSlotId: 'policy', targetNodeId: 'generation-strategy', targetSlotId: 'policy', kind: 'guides', zhIssue: 'agent policy 没有连接到 generation strategy', enIssue: 'agent policy is not linked to generation strategy' },
  { sourceNodeId: 'generation-strategy', sourceSlotId: 'strategy', targetNodeId: 'critique-loop', targetSlotId: 'strategy', kind: 'routes', zhIssue: 'generation strategy 没有连接到 critique loop', enIssue: 'generation strategy is not linked to critique loop' },
  { sourceNodeId: 'critique-loop', sourceSlotId: 'critique', targetNodeId: 'quality-gate', targetSlotId: 'critique', kind: 'evaluates', zhIssue: 'critique loop 没有连接到质量门', enIssue: 'critique loop is not linked to quality gate' },
  { sourceNodeId: 'resource-package-target', sourceSlotId: 'package', targetNodeId: 'quality-gate', targetSlotId: 'package', kind: 'evaluates', zhIssue: '资源包没有连接到质量门', enIssue: 'resource package is not linked to quality gate' },
  { sourceNodeId: 'resource-package-target', sourceSlotId: 'package', targetNodeId: 'output-adapter', targetSlotId: 'package', kind: 'exports', zhIssue: '资源包没有连接到导出节点', enIssue: 'resource package is not linked to output adapter' },
  { sourceNodeId: 'quality-gate', sourceSlotId: 'report', targetNodeId: 'output-adapter', targetSlotId: 'report', kind: 'constrains', zhIssue: '质量门没有连接到导出节点', enIssue: 'quality gate is not linked to the output adapter' },
]

function createWorkflowEditorStructureRepairOperations(graph: CharacterWorkflowBuilderGraph): CharacterWorkflowBuilderOperation[] {
  const nodeIds = new Set(graph.nodes.map((node) => node.id))
  const operations: CharacterWorkflowBuilderOperation[] = []
  for (const nodeSpec of WORKFLOW_EDITOR_CORE_NODE_SPECS) {
    if (nodeIds.has(nodeSpec.id)) {
      continue
    }
    operations.push({
      type: 'add-node',
      nodeType: nodeSpec.type,
      nodeId: nodeSpec.id,
      title: nodeSpec.title,
      x: nodeSpec.x,
      y: nodeSpec.y,
      config: nodeSpec.config,
    })
  }
  for (const linkSpec of WORKFLOW_EDITOR_CORE_LINK_SPECS) {
    if (hasWorkflowLink(graph, linkSpec.sourceNodeId, linkSpec.sourceSlotId, linkSpec.targetNodeId, linkSpec.targetSlotId)) {
      continue
    }
    operations.push({
      type: 'add-link',
      sourceNodeId: linkSpec.sourceNodeId,
      sourceSlotId: linkSpec.sourceSlotId,
      targetNodeId: linkSpec.targetNodeId,
      targetSlotId: linkSpec.targetSlotId,
      kind: linkSpec.kind,
    })
  }
  return sanitizeWorkflowBuilderOperations(operations, graph).slice(0, WORKFLOW_EDITOR_MAX_OPERATIONS_PER_STEP)
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
  return WORKFLOW_EDITOR_CORE_NODE_SPECS.map((node) => node.id).filter((id) => !nodeIds.has(id))
}

function getMissingWorkflowCoreLinkIssues(
  graph: CharacterWorkflowBuilderGraph,
  language: CharacterWorkflowLanguage
): string[] {
  const zh = language === 'zh-CN'
  return WORKFLOW_EDITOR_CORE_LINK_SPECS
    .filter((link) => !hasWorkflowLink(graph, link.sourceNodeId, link.sourceSlotId, link.targetNodeId, link.targetSlotId))
    .map((link) => zh ? link.zhIssue : link.enIssue)
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
      if (!hasBuilderGraphNode(next, operation.sourceNodeId) || !hasBuilderGraphNode(next, operation.targetNodeId)) {
        continue
      }
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
  return pruneDanglingBuilderGraphEdges(next)
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
  return pruneDanglingBuilderGraphEdges({
    selectedNodeId: typeof graph.selectedNodeId === 'string' ? graph.selectedNodeId : undefined,
    nodes,
    edges,
  })
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
  const knownNodeIds = new Set(graph.nodes.map((node) => node.id))
  return operations.flatMap((operation): CharacterWorkflowBuilderOperation[] => {
    if (operation.type === 'add-node') {
      const config = sanitizeResourceConfigForNode(operation.nodeType, operation.config ?? {})
      knownNodeIds.add(operation.nodeId?.trim() || `${operation.nodeType}-${knownNodeIds.size + 1}`)
      return [{ ...operation, config }]
    }
    if (operation.type === 'update-node-config') {
      const config = sanitizeResourceConfigForNode(nodeTypes.get(operation.nodeId), operation.config)
      return Object.keys(config).length ? [{ ...operation, config }] : []
    }
    if (operation.type === 'add-link') {
      if (!knownNodeIds.has(operation.sourceNodeId) || !knownNodeIds.has(operation.targetNodeId)) {
        return []
      }
    }
    return [operation]
  })
}

function pruneDanglingBuilderGraphEdges(graph: CharacterWorkflowBuilderGraph): CharacterWorkflowBuilderGraph {
  const nodeIds = new Set(graph.nodes.map((node) => node.id))
  return {
    ...graph,
    edges: graph.edges.filter((edge) => nodeIds.has(edge.from.nodeId) && nodeIds.has(edge.to.nodeId)),
  }
}

function hasBuilderGraphNode(graph: CharacterWorkflowBuilderGraph, nodeId: string): boolean {
  return graph.nodes.some((node) => node.id === nodeId)
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
    'game-system-target',
    'resource-package-target',
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
    priorityAssets: ['opening-layout', 'atmosphere-style', 'game-system', 'image-pack'].reduce(
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
