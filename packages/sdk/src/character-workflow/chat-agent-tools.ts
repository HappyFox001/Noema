/**
 * Chat-model backed tools for autonomous character resource generation.
 */
import { createChatSessionFromModel } from '../chat/index.js'
import { createImageGenerationArtifact, generateImageWithConfiguredProvider } from '../image/index.js'
import {
  createCharacterAgentToolRuntime,
  type AgentToolDefinition,
  type CandidatePack,
  type CharacterAgentArtifact,
  type CharacterAgentArtifactKind,
  type CharacterAgentModelConfig,
  type CharacterAgentRunContext,
} from './agent-runtime.js'

export interface CharacterAgentConfiguredModel {
  id: string
  modelType: 'llm' | 'image'
  provider?: string
  modelName: string
  enabledModels?: string[]
  apiKey: string
  baseUrl: string
}

export function createCharacterAgentModelConfigs(
  models: CharacterAgentConfiguredModel[]
): CharacterAgentModelConfig[] {
  return models.flatMap((model) => {
    const names = (model.enabledModels?.length ? model.enabledModels : [model.modelName])
      .map((name) => String(name || '').trim())
      .filter(Boolean)
    return names.map((modelName) => ({
      apiId: model.id,
      modelName,
      modelRef: `${model.id}::${modelName}`,
      kind: model.modelType,
      provider: model.provider,
      label: modelName,
      baseUrl: model.baseUrl,
      metadata: {
        configuredModelId: model.id,
      },
    }))
  })
}

export function createConfiguredCharacterAgentToolRuntime(
  models: CharacterAgentConfiguredModel[],
  options: { proxyUrl?: string } = {}
): ReturnType<typeof createCharacterAgentToolRuntime> {
  const tools: AgentToolDefinition[] = [
    {
      name: 'interpret_resource_graph',
      description: 'Uses the configured chat model to interpret the resource graph as an autonomous agent brief.',
      kind: 'generation',
      execute: async ({ callId, context }) => {
        const text = await runCharacterAgentLLMTool(context, models, options.proxyUrl, [
          'You are the backend planner for an agentic role-resource workflow.',
          'Interpret this graph as constraints, goals, capabilities, and freedom boundaries for a character generation agent.',
          'Do not ask for fixed persona fields. Infer only the task direction and agent operating rules.',
          'Return a concise task understanding in the requested language.',
          '',
          JSON.stringify(createAgentPromptContext(context), null, 2),
        ].join('\n'), { temperature: 0.35, max_tokens: 1400 })
        return {
          callId,
          ok: true,
          summary: text,
          data: { text },
        }
      },
    },
    {
      name: 'create_generation_plan',
      description: 'Creates an agent-owned generation plan from the interpreted graph.',
      kind: 'generation',
      execute: async ({ callId, context, input }) => {
        const text = await runCharacterAgentLLMTool(context, models, options.proxyUrl, [
          'Create a production plan for generating a complete role-resource package.',
          'Return JSON only with this shape:',
          '{"id":"plan-id","title":"...","strategy":"...","steps":[{"id":"...","title":"...","purpose":"...","phase":"interpret|plan|produce|inspect|repair|package","status":"pending"}]}',
          '',
          JSON.stringify({ ...createAgentPromptContext(context), input }, null, 2),
        ].join('\n'), { temperature: 0.3, max_tokens: 1600 })
        const parsed = parseJsonObject(text)
        const plan = parsed && Array.isArray(parsed.steps)
          ? parsed
          : {
              id: `${context.runId}:plan`,
              title: 'Character Resource Generation Plan',
              strategy: text,
              steps: [
                { id: 'interpret', title: 'Interpret resource graph', purpose: 'Resolve user goals and constraints.', phase: 'interpret', status: 'pending' },
                { id: 'produce', title: 'Generate candidate package', purpose: 'Create role resources with agent autonomy.', phase: 'produce', status: 'pending' },
                { id: 'inspect', title: 'Inspect quality', purpose: 'Review coherence, style fit, and runtime readiness.', phase: 'inspect', status: 'pending' },
                { id: 'package', title: 'Package resources', purpose: 'Prepare export payload.', phase: 'package', status: 'pending' },
              ],
            }
        return {
          callId,
          ok: true,
          summary: typeof plan.strategy === 'string' ? plan.strategy : 'Created an agent generation plan.',
          data: plan,
        }
      },
    },
    {
      name: 'generate_candidate_pack',
      description: 'Generates a complete candidate role-resource package using agent freedom and graph constraints.',
      kind: 'generation',
      execute: async ({ callId, context, input }) => {
        const candidateId = `${context.runId}:candidate:primary`
        const text = await runCharacterAgentLLMTool(context, models, options.proxyUrl, [
          'Generate a complete autonomous role-resource package.',
          'Do not wait for mechanical schema fields. You own the creative choices within the graph constraints.',
          'Return JSON only with keys: title, summary, characterCard, openingMessage, dialogueStyleGuide, worldContext, sceneContext, memoryPolicy, imagePrompt, generationReport, risks.',
          'The characterCard should be complete enough for role-play runtime use.',
          '',
          JSON.stringify({ candidateId, ...createAgentPromptContext(context), input }, null, 2),
        ].join('\n'), { temperature: 0.82, max_tokens: 4200 })
        const parsed = parseJsonObject(text) ?? { generationReport: text }
        const artifacts = createCandidateArtifacts(context.runId, candidateId, parsed, context)
        const imageArtifact = await maybeGenerateImageArtifact(context, models, options.proxyUrl, candidateId, parsed.imagePrompt)
        if (imageArtifact) {
          artifacts.push(imageArtifact)
        }
        const candidate: CandidatePack = {
          id: candidateId,
          title: stringField(parsed.title, 'Character Resource Candidate'),
          summary: stringField(parsed.summary, 'Generated an agent-owned character resource package.'),
          requestedAssets: context.requestedAssets.flatMap((target) => target.requested),
          artifactIds: artifacts.map((artifact) => artifact.id),
          risks: arrayField(parsed.risks),
        }
        return {
          callId,
          ok: true,
          summary: candidate.summary,
          data: candidate,
          artifacts,
        }
      },
    },
    {
      name: 'run_quality_gate',
      description: 'Lets the configured model judge whether the candidate satisfies graph-level quality goals.',
      kind: 'quality',
      execute: async ({ callId, context, input }) => {
        const text = await runCharacterAgentLLMTool(context, models, options.proxyUrl, [
          'Evaluate this character resource package as an expert reviewer.',
          'Do not perform brittle mechanical field validation. Judge quality, coherence, safety boundaries, style fit, and runtime usefulness.',
          'Return JSON only with keys: score (0-1), passed (boolean), summary, checks, blockingIssues, repairSuggestions.',
          '',
          JSON.stringify({ qualityGate: context.qualityGate, input }, null, 2),
        ].join('\n'), { temperature: 0.2, max_tokens: 2200 })
        const parsed = parseJsonObject(text) ?? {}
        const score = numberField(parsed.score, context.qualityGate.minimumScore)
        const passed = parsed.passed === false ? false : score >= context.qualityGate.minimumScore
        return {
          callId,
          ok: passed || !context.qualityGate.blockExport,
          summary: stringField(parsed.summary, text),
          data: {
            score,
            passed,
            checks: Array.isArray(parsed.checks) ? parsed.checks : [],
            blockingIssues: arrayField(parsed.blockingIssues),
            repairSuggestions: arrayField(parsed.repairSuggestions),
          },
          suggestedNextActions: arrayField(parsed.repairSuggestions),
        }
      },
    },
    {
      name: 'repair_candidate_pack',
      description: 'Repairs a candidate package according to model critique while preserving agent autonomy.',
      kind: 'generation',
      execute: async ({ callId, context, input }) => {
        const candidateId = `${context.runId}:candidate:repaired`
        const text = await runCharacterAgentLLMTool(context, models, options.proxyUrl, [
          'Repair the candidate package according to the critique.',
          'Preserve the original creative direction unless the critique requires a stronger choice.',
          'Return JSON only with keys: title, summary, characterCard, openingMessage, dialogueStyleGuide, worldContext, sceneContext, memoryPolicy, imagePrompt, generationReport, risks.',
          '',
          JSON.stringify({ candidateId, ...createAgentPromptContext(context), input }, null, 2),
        ].join('\n'), { temperature: 0.68, max_tokens: 4200 })
        const parsed = parseJsonObject(text) ?? { generationReport: text }
        const artifacts = createCandidateArtifacts(context.runId, candidateId, parsed, context)
        const imageArtifact = await maybeGenerateImageArtifact(context, models, options.proxyUrl, candidateId, parsed.imagePrompt)
        if (imageArtifact) {
          artifacts.push(imageArtifact)
        }
        const candidate: CandidatePack = {
          id: candidateId,
          title: stringField(parsed.title, 'Repaired Character Resource Candidate'),
          summary: stringField(parsed.summary, 'Repaired the character resource package.'),
          requestedAssets: context.requestedAssets.flatMap((target) => target.requested),
          artifactIds: artifacts.map((artifact) => artifact.id),
          risks: arrayField(parsed.risks),
        }
        return {
          callId,
          ok: true,
          summary: candidate.summary,
          data: candidate,
          artifacts,
        }
      },
    },
    {
      name: 'create_export_package',
      description: 'Creates the final export payload for the selected candidate package.',
      kind: 'artifact',
      execute: ({ callId, context, input }) => ({
        callId,
        ok: true,
        summary: `Prepared ${context.exportTarget.format} export package.`,
        data: {
          format: context.exportTarget.format,
          includeAssets: context.exportTarget.includeAssets,
          workflow: context.graph,
          input,
        },
      }),
    },
  ]
  return createCharacterAgentToolRuntime(tools)
}

function createAgentPromptContext(context: CharacterAgentRunContext): Record<string, unknown> {
  return {
    language: context.language,
    goal: context.goal,
    stylePressures: context.stylePressures,
    hardConstraints: context.hardConstraints,
    sourceMaterials: context.sourceMaterials,
    capabilities: context.capabilities,
    policy: context.policy,
    strategy: context.strategy,
    critique: context.critique,
    requestedAssets: context.requestedAssets,
    qualityGate: context.qualityGate,
    exportTarget: context.exportTarget,
    graph: context.graph,
    compilerWarnings: context.compilerWarnings,
  }
}

async function runCharacterAgentLLMTool(
  context: CharacterAgentRunContext,
  models: CharacterAgentConfiguredModel[],
  proxyUrl: string | undefined,
  input: string,
  options: { temperature?: number; max_tokens?: number } = {}
): Promise<string> {
  const { configuredModel, modelName } = findConfiguredLLMModel(models, context)
  const session = createChatSessionFromModel({
    provider: configuredModel.provider,
    apiKey: configuredModel.apiKey,
    model: modelName,
    baseURL: configuredModel.baseUrl?.trim() || undefined,
  }, {
    defaultOptions: {
      max_tokens: options.max_tokens ?? 2400,
    },
    llmOptions: {
      proxyUrl,
    },
  })
  const response = await session.send({
    input,
    language: context.language,
    options: {
      temperature: options.temperature ?? 0.5,
      max_tokens: options.max_tokens ?? 2400,
    },
  })
  return response.content.trim()
}

function findConfiguredLLMModel(
  models: CharacterAgentConfiguredModel[],
  context: CharacterAgentRunContext
): { configuredModel: CharacterAgentConfiguredModel; modelName: string } {
  const requested = context.capabilities.llmModels[0]
  const llmModels = models.filter((model) => model.modelType === 'llm')
  const configuredModel = requested
    ? llmModels.find((model) => model.id === requested.apiId)
    : llmModels[0]
  if (!configuredModel) {
    throw new Error('No LLM model is configured for character workflow generation')
  }
  const modelName = requested?.modelName || configuredModel.enabledModels?.[0] || configuredModel.modelName
  if (!modelName?.trim()) {
    throw new Error('Character workflow LLM model name is empty')
  }
  if (!configuredModel.apiKey?.trim()) {
    throw new Error(`Character workflow LLM API key is empty for ${configuredModel.id}`)
  }
  return { configuredModel, modelName: modelName.trim() }
}

async function maybeGenerateImageArtifact(
  context: CharacterAgentRunContext,
  models: CharacterAgentConfiguredModel[],
  proxyUrl: string | undefined,
  candidateId: string,
  prompt: unknown
): Promise<CharacterAgentArtifact | null> {
  const promptText = typeof prompt === 'string' ? prompt.trim() : ''
  const requestedImages = context.requestedAssets.some((target) => target.requested.some((asset) => asset.includes('image')))
  const capability = context.capabilities.imageModels[0]
  if (!promptText || !requestedImages || !capability) {
    return null
  }
  const configuredModel = models.find((model) => model.modelType === 'image' && model.id === capability.apiId)
  if (!configuredModel) {
    return null
  }
  const generated = await generateImageWithConfiguredProvider({
    model: configuredModel,
    modelName: capability.modelName,
    prompt: promptText,
    proxyUrl,
  })
  if (!generated) {
    return null
  }
  return createToolArtifact(
    context.runId,
    candidateId,
    'image-asset',
    'Generated Image Asset',
    createImageGenerationArtifact(generated),
    capability.nodeId
  )
}

function createCandidateArtifacts(
  runId: string,
  candidateId: string,
  data: Record<string, any>,
  context: CharacterAgentRunContext
): CharacterAgentArtifact[] {
  const defaultSourceNodeId = context.requestedAssets[0]?.nodeId
  return [
    createToolArtifact(runId, candidateId, 'character-card-final', 'Character Card', data.characterCard ?? data, defaultSourceNodeId),
    createToolArtifact(runId, candidateId, 'opening-message', 'Opening Message', data.openingMessage, defaultSourceNodeId),
    createToolArtifact(runId, candidateId, 'dialogue-style-guide', 'Dialogue Style Guide', data.dialogueStyleGuide, defaultSourceNodeId),
    createToolArtifact(runId, candidateId, 'world-context', 'World Context', data.worldContext, defaultSourceNodeId),
    createToolArtifact(runId, candidateId, 'scene-context', 'Scene Context', data.sceneContext, defaultSourceNodeId),
    createToolArtifact(runId, candidateId, 'memory-policy', 'Memory Policy', data.memoryPolicy, defaultSourceNodeId),
    createToolArtifact(runId, candidateId, 'image-prompt', 'Image Prompt', data.imagePrompt, context.capabilities.imageModels[0]?.nodeId ?? defaultSourceNodeId),
    createToolArtifact(runId, candidateId, 'generation-report', 'Generation Report', data.generationReport ?? data.summary ?? data, defaultSourceNodeId),
  ].filter((artifact) => artifact.data !== undefined && artifact.data !== null && String(artifact.data).trim?.() !== '')
}

function createToolArtifact(
  runId: string,
  candidateId: string,
  kind: CharacterAgentArtifactKind,
  title: string,
  data: unknown,
  sourceNodeId?: string
): CharacterAgentArtifact {
  const summary = summarizeArtifactData(data)
  return {
    id: `${candidateId}:${kind}`,
    kind,
    runId,
    version: 0,
    title,
    summary,
    data,
    sourceNodeId,
    candidateId,
    createdAt: 0,
    updatedAt: 0,
  }
}

function summarizeArtifactData(data: unknown): string {
  if (typeof data === 'string') {
    return data.trim().slice(0, 180) || 'Generated resource artifact.'
  }
  if (data && typeof data === 'object') {
    const source = data as Record<string, any>
    const text = source.summary || source.description || source.title
    if (typeof text === 'string' && text.trim()) {
      return text.trim().slice(0, 180)
    }
  }
  return 'Generated resource artifact.'
}

function parseJsonObject(text: string): Record<string, any> | null {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1] ?? trimmed
  try {
    const parsed = JSON.parse(candidate)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, any> : null
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(candidate.slice(start, end + 1))
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, any> : null
      } catch {
        return null
      }
    }
    return null
  }
}

function stringField(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function arrayField(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean)
}

function numberField(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback
}
