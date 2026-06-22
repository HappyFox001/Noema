/**
 * Chat-model backed tools for autonomous character resource generation.
 */
import { createChatSessionFromModel } from '../chat/index.js'
import { createImageGenerationArtifact, generateImageWithConfiguredProvider } from '../image/index.js'
import {
  createCharacterAgentToolRuntime,
  type AgentToolDefinition,
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
      name: 'decide_character_card_next_step',
      description: 'Uses the configured chat model to choose the next autonomous character-card edits.',
      kind: 'decision',
      execute: async ({ callId, context, input, state }) => {
        const text = await runCharacterAgentLLMTool(context, models, options.proxyUrl, [
          'You are an autonomous character-card agent. Your only goal is to complete a usable long-form roleplay character card and its supporting resources.',
          'The resource graph is configuration: goal, style pressure, constraints, model capabilities, resources, and output adapter preferences. It is not a fixed pipeline.',
          'Choose concrete next actions. Do not describe phases. Do not ask the user unless impossible; infer missing creative details within the configured boundaries.',
          'Return JSON only with this shape:',
          '{"summary":"what changed","done":false,"confidence":0.0,"missing":[],"actions":[{"type":"merge_character_card","value":{"name":"...","description":"...","personality":"...","scenario":"...","firstMessage":"...","dialogueStyle":"...","worldContext":"...","memoryStrategy":"...","imagePrompt":"..."}}]}',
          'Allowed action types:',
          '- set_field: {"type":"set_field","field":"name","value":"...","reason":"..."}',
          '- merge_character_card: {"type":"merge_character_card","value":{...},"reason":"..."}',
          '- create_artifact: {"type":"create_artifact","kind":"opening-message|dialogue-style-guide|world-context|scene-context|memory-policy|image-prompt|generation-report","title":"...","data":"...","summary":"..."}',
          '- request_image: {"type":"request_image","prompt":"...","title":"..."}',
          '- finish: {"type":"finish","reason":"..."}',
          'A visual image is a default required output for every character card. Always prepare a strong imagePrompt and use request_image when the prompt is ready.',
          'Set done=true only when the card has name, description, personality, scenario, firstMessage, dialogueStyle, worldContext, memoryStrategy, and imagePrompt.',
          '',
          JSON.stringify({
            ...createAgentPromptContext(context),
            runtime: input,
            currentDraft: state.draft,
          }, null, 2),
        ].join('\n'), { temperature: 0.82, max_tokens: 4200 })
        const parsed = parseJsonObject(text)
        return {
          callId,
          ok: Boolean(parsed),
          summary: stringField(parsed?.summary, text),
          data: parsed ?? {
            summary: text,
            done: false,
            confidence: 0.2,
            missing: ['valid JSON actions'],
            actions: [],
          },
        }
      },
    },
    {
      name: 'generate_character_image',
      description: 'Generates a character image from the current draft prompt.',
      kind: 'image',
      execute: async ({ callId, context, input }) => {
        const source = input && typeof input === 'object' ? input as Record<string, any> : {}
        const candidateId = typeof source.draft?.id === 'string' ? source.draft.id : `${context.runId}:candidate:primary`
        const imageArtifact = await maybeGenerateImageArtifact(context, models, options.proxyUrl, candidateId, source.prompt)
        return {
          callId,
          ok: Boolean(imageArtifact),
          summary: imageArtifact ? 'Generated character image.' : 'Skipped image generation because image model or prompt is unavailable.',
          artifacts: imageArtifact ? [imageArtifact] : [],
        }
      },
    },
    {
      name: 'review_character_card',
      description: 'Lets the configured model judge whether the character card is complete for roleplay runtime use.',
      kind: 'quality',
      execute: async ({ callId, context, input }) => {
        const text = await runCharacterAgentLLMTool(context, models, options.proxyUrl, [
          'Evaluate this character card as an expert roleplay runtime reviewer.',
          'Judge coherence, field completeness, long-form roleplay usefulness, image readiness, style fit, and hard constraints.',
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
      name: 'create_output_adapter_package',
      description: 'Applies Output Adapter runtime semantics to the completed character card.',
      kind: 'artifact',
      execute: ({ callId, context, input }) => ({
        callId,
        ok: true,
        summary: `Prepared ${context.exportTarget.format} output adapter package.`,
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
  const capability = context.capabilities.imageModels[0]
  if (!promptText || !capability) {
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
