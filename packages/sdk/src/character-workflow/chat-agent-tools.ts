/**
 * Chat-model backed tools for autonomous character resource generation.
 */
import { createChatSessionFromModel } from '../chat/index.js'
import { createImageGenerationArtifact, generateImageWithConfiguredProvider } from '../image/index.js'
import {
  CHARACTER_CARD_FIELD_SCHEMA,
  CHARACTER_SUPPORT_FIELD_SCHEMA,
  createCharacterAgentToolRuntime,
  type AgentToolDefinition,
  type CharacterAgentImageTargetPrompt,
  type AgentImageGenerationControl,
  type AgentTargetContext,
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
          createCharacterDecisionPrompt(context, input, state.draft),
        ].join('\n'), { temperature: 0.82 })
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
        let imageArtifacts: CharacterAgentArtifact[] = []
        let errorMessage = ''
        try {
          imageArtifacts = await maybeGenerateImageArtifacts(context, models, options.proxyUrl, candidateId, source)
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : String(error)
        }
        const failureArtifact = imageArtifacts.length ? null : createToolArtifact(
          context.runId,
          candidateId,
          'generation-report',
          errorMessage ? 'Image Generation Failed' : 'Image Generation Skipped',
          {
            summary: errorMessage || 'Image generation did not run. Check that an image model is configured, enabled, and selected.',
            targetPrompts: source.targetPrompts,
            imageModels: models.filter((model) => model.modelType === 'image').map((model) => ({
              id: model.id,
              provider: model.provider,
              modelName: model.modelName,
              enabledModels: model.enabledModels,
              hasApiKey: Boolean(model.apiKey?.trim()),
              baseUrl: model.baseUrl,
            })),
            selectedCapability: context.capabilities.imageModels[0] ?? null,
            imageControls: context.targets
              .filter((target) => target.kind === 'image')
              .flatMap((target) => target.imageControls),
          },
          context.capabilities.imageModels[0]?.nodeId ?? 'image-capability'
        )
        return {
          callId,
          ok: imageArtifacts.length > 0,
          summary: imageArtifacts.length ? `Generated ${imageArtifacts.length} character image asset(s).` : errorMessage || 'Skipped image generation because image model or prompt is unavailable.',
          artifacts: imageArtifacts.length ? imageArtifacts : failureArtifact ? [failureArtifact] : [],
        }
      },
    },
    {
      name: 'review_character_card',
      description: 'Lets the configured model judge whether the character card is complete for roleplay runtime use.',
      kind: 'quality',
      execute: async ({ callId, context, input }) => {
        const text = await runCharacterAgentLLMTool(context, models, options.proxyUrl, [
          createCharacterReviewPrompt(context, input),
        ].join('\n'), { temperature: 0.2 })
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
    targets: context.targets,
    stylePressures: context.stylePressures,
    hardConstraints: context.hardConstraints,
    imageGenerationControls: context.imageGenerationControls,
    fieldGenerationControls: context.fieldGenerationControls,
    continuityControls: context.continuityControls,
    relationshipControls: context.relationshipControls,
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

function createCharacterDecisionPrompt(
  context: CharacterAgentRunContext,
  runtime: unknown,
  currentDraft: unknown
): string {
  return [
    '<character_agent_prompt>',
    '  <role>You are an autonomous character-card agent. Your job is to complete the fixed character-card schema and required supporting resources.</role>',
    '  <operating_model>The resource graph is a target/control graph, not a linear pipeline. Generate each target using its local controls first, then global controls.</operating_model>',
    `  <language>${xmlEscape(context.language)}</language>`,
    createSchemaXml(),
    createResourceContextXml(context),
    '  <runtime_state>',
    `    <current_draft_json>${xmlEscape(JSON.stringify(currentDraft ?? {}, null, 2))}</current_draft_json>`,
    `    <turn_context_json>${xmlEscape(JSON.stringify(runtime ?? {}, null, 2))}</turn_context_json>`,
    '  </runtime_state>',
    '  <action_contract>',
    '    <output_format>Return JSON only. No markdown. No XML in the response.</output_format>',
    '    <shape>{"summary":"what changed in this single step","done":false,"confidence":0.0,"missing":[],"actions":[{"type":"set_field","field":"nextField","value":"..."}]}</shape>',
    '    <field_content_rule>Every set_field value must be final character-card content, not a prompt, not a plan, and not a resource-control description.</field_content_rule>',
    '    <field_content_rule>Never write labels such as "Style:", "Goal:", "Field purpose:", "target atmosphere", XML tag names, or operation instructions inside character fields.</field_content_rule>',
    '    <field_content_rule>description must describe who the character is and why they are appealing for RP. appearance must describe visible body/outfit/expression cues. Do not describe the generation target itself.</field_content_rule>',
    '    <progressive_rule>Return exactly one action. Generate or reroll one field at a time. Do not fill the whole card in one response.</progressive_rule>',
    '    <progressive_rule>If a field target is missing, return set_field for the earliest missing field in fixed_schema order and obey that target local XML controls. Only request_image after imagePrompt exists.</progressive_rule>',
    '    <image_rule>When requesting images, create one targetPrompts item per final image, not just per image target. If an image target requests multiple images through image_control count, return multiple distinct prompts for the same targetNodeId.</image_rule>',
    '    <image_rule>All images for the same role card must share a clear identity anchor: face structure, hair, eyes, age impression, body type, signature accessories, and outfit language. Vary pose, shot, background, mood, lighting, and story function.</image_rule>',
    '    <image_rule>Each targetPrompts prompt must be specific to that exact image slot, image_role, local image_control, and the text field or story beat it supports. Do not rely on the image tool to duplicate or vary one generic prompt.</image_rule>',
    '    <image_rule>Do not request pure empty scene images. Every image should contain the character or unmistakable character-linked visual motifs, and should support the role card text, opening, story, relationship, or layout.</image_rule>',
    '    <allowed_actions>',
    '      <action name="set_field">{"type":"set_field","field":"name","value":"...","reason":"..."}</action>',
    '      <action name="request_image">{"type":"request_image","targetPrompts":[{"targetNodeId":"image-target-node-id","title":"Avatar Image","prompt":"target-specific English image prompt"}]}</action>',
    '      <action name="finish">{"type":"finish","reason":"..."}</action>',
    '    </allowed_actions>',
    '    <completion_rule>Set done=true only after all fixed character fields and support fields are filled. Always produce imagePrompt and request_image.</completion_rule>',
    '  </action_contract>',
    '</character_agent_prompt>',
  ].join('\n')
}

function createCharacterReviewPrompt(context: CharacterAgentRunContext, input: unknown): string {
  return [
    '<character_quality_review>',
    '  <role>You are the final quality gate for a generated roleplay character card.</role>',
    createSchemaXml(),
    createResourceContextXml(context),
    '  <review_contract>',
    `    <minimum_score>${context.qualityGate.minimumScore}</minimum_score>`,
    `    <block_export>${context.qualityGate.blockExport}</block_export>`,
    `    <required_checks>${xmlEscape(context.qualityGate.requiredChecks.join(', '))}</required_checks>`,
    '    <must_check>All fixed character fields are present, concrete, and belong to the character rather than the agent.</must_check>',
    '    <must_check>Supporting resources include memoryStrategy and imagePrompt; if an image model is configured, image readiness must be judged.</must_check>',
    '    <must_check>Hard constraints are respected. Style pressures are visible but not copied mechanically.</must_check>',
    '    <output_format>Return JSON only with keys: score, passed, summary, checks, blockingIssues, repairSuggestions.</output_format>',
    '  </review_contract>',
    `  <candidate_json>${xmlEscape(JSON.stringify(input ?? {}, null, 2))}</candidate_json>`,
    '</character_quality_review>',
  ].join('\n')
}

function createSchemaXml(): string {
  return [
    '  <fixed_schema>',
    '    <character_card_fields>',
    ...CHARACTER_CARD_FIELD_SCHEMA.map((field) => `      <field name="${field}" required="true">${xmlEscape(characterFieldDescription(field))}</field>`),
    '    </character_card_fields>',
    '    <support_fields>',
    ...CHARACTER_SUPPORT_FIELD_SCHEMA.map((field) => `      <field name="${field}" required="true">${xmlEscape(supportFieldDescription(field))}</field>`),
    '    </support_fields>',
    '    <rule>Do not invent new top-level required fields. Use extra details inside the fixed fields when needed.</rule>',
    '    <rule>imagePrompt is for the image model, not a visible character-card field.</rule>',
    '  </fixed_schema>',
  ].join('\n')
}

function createResourceContextXml(context: CharacterAgentRunContext): string {
  return [
    '  <resource_context>',
    '    <goals injection="primary_task">',
    `      <goal_prompt>${xmlEscape(context.goal.prompt)}</goal_prompt>`,
    `      <target_audience>${xmlEscape(context.goal.targetAudience)}</target_audience>`,
    `      <allow_agent_expansion>${context.goal.allowAgentExpansion}</allow_agent_expansion>`,
    '    </goals>',
    '    <targets injection="local_target_contexts">',
    ...context.targets.map((target) => [
      `      <target node="${xmlEscape(target.nodeId)}" kind="${xmlEscape(target.kind)}" field="${xmlEscape(target.field ?? '')}" image_role="${xmlEscape(target.imageRole ?? '')}">`,
      `        <title>${xmlEscape(target.title)}</title>`,
      `        <requested_resources>${xmlEscape(target.requestedResources.join(', '))}</requested_resources>`,
      `        <config_json>${xmlEscape(JSON.stringify(target.config))}</config_json>`,
      '        <local_style_pressures>',
      ...target.localStylePressures.map((item) => `          <style node="${xmlEscape(item.nodeId)}" preset="${xmlEscape(item.preset)}" intensity="${item.intensity}">${xmlEscape(item.prompt)}</style>`),
      '        </local_style_pressures>',
      '        <local_hard_constraints>',
      ...target.localConstraints.map((item) => `          <constraint node="${xmlEscape(item.nodeId)}" hard="${item.hardBoundary}" must_have="${xmlEscape(item.mustHave.join('; '))}" must_not="${xmlEscape(item.mustNot.join('; '))}" />`),
      '        </local_hard_constraints>',
      '        <field_controls>',
      ...target.fieldControls.map((item) => `          <field_control node="${xmlEscape(item.nodeId)}" tone="${xmlEscape(item.tone)}" length="${xmlEscape(item.lengthPolicy)}" avoid="${xmlEscape(item.avoidPatterns.join('; '))}">${xmlEscape(item.fieldPurpose)}</field_control>`),
      '        </field_controls>',
      '        <image_controls>',
      ...target.imageControls.flatMap(renderImageControlContextXml),
      '        </image_controls>',
      '        <continuity_controls>',
      ...target.continuityControls.map((item) => `          <continuity_control node="${xmlEscape(item.nodeId)}" pacing="${xmlEscape(item.progressionPacing)}" forbid_resetting_facts="${item.forbidResettingFacts}" anchors="${xmlEscape(item.memoryAnchors.join('; '))}" />`),
      '        </continuity_controls>',
      '        <relationship_controls>',
      ...target.relationshipControls.map((item) => `          <relationship_control node="${xmlEscape(item.nodeId)}" mode="${xmlEscape(item.relationshipMode)}" rules="${xmlEscape(item.tensionRules.join('; '))}" />`),
      '        </relationship_controls>',
      '      </target>',
    ].join('\n')),
    '    </targets>',
    '    <style injection="soft_pressure">',
    ...context.stylePressures.map((item) => [
      `      <style_pressure node="${xmlEscape(item.nodeId)}" preset="${xmlEscape(item.preset)}" intensity="${item.intensity}">`,
      `        <prompt>${xmlEscape(item.prompt)}</prompt>`,
      '      </style_pressure>',
    ].join('\n')),
    '    </style>',
    '    <constraints injection="hard_boundaries">',
    ...context.hardConstraints.map((item) => [
      `      <constraint node="${xmlEscape(item.nodeId)}" hard="${item.hardBoundary}">`,
      `        <must_have>${xmlEscape(item.mustHave.join('; '))}</must_have>`,
      `        <must_not>${xmlEscape(item.mustNot.join('; '))}</must_not>`,
      '      </constraint>',
    ].join('\n')),
    '    </constraints>',
    '    <sources injection="grounding_material">',
    ...context.sourceMaterials.map((item) => [
      `      <source node="${xmlEscape(item.nodeId)}" kind="${xmlEscape(item.kind)}" grounding_strength="${item.groundingStrength}">`,
      `        <notes>${xmlEscape(item.notes)}</notes>`,
      '      </source>',
    ].join('\n')),
    '    </sources>',
    '    <capabilities injection="available_runtime_tools">',
    `      <llm_models>${xmlEscape(context.capabilities.llmModels.map((item) => item.modelRef).filter(Boolean).join(', '))}</llm_models>`,
    `      <image_models required="true">${xmlEscape(context.capabilities.imageModels.map((item) => item.modelRef).filter(Boolean).join(', '))}</image_models>`,
    `      <retrieval>${xmlEscape(JSON.stringify(context.capabilities.retrieval))}</retrieval>`,
    `      <voice>${xmlEscape(JSON.stringify(context.capabilities.voice))}</voice>`,
    '    </capabilities>',
    '    <agent_policy injection="run_behavior">',
    `      <autonomy_level>${xmlEscape(context.policy.autonomyLevel)}</autonomy_level>`,
    `      <revision_budget>${context.policy.revisionBudget}</revision_budget>`,
    `      <ask_user_threshold>${xmlEscape(context.policy.askUserThreshold)}</ask_user_threshold>`,
    `      <can_expand_missing_details>${context.policy.canExpandMissingDetails}</can_expand_missing_details>`,
    '    </agent_policy>',
    '    <generation_strategy injection="creative_process_preference">',
    `      <mode>${xmlEscape(context.strategy.mode)}</mode>`,
    `      <branch_count>${context.strategy.branchCount}</branch_count>`,
    `      <priority_assets>${xmlEscape(context.strategy.priorityAssets.join(', '))}</priority_assets>`,
    `      <stop_condition>${xmlEscape(context.strategy.stopCondition)}</stop_condition>`,
    '    </generation_strategy>',
    '    <quality injection="final_review_policy">',
    `      <minimum_score>${context.qualityGate.minimumScore}</minimum_score>`,
    `      <required_checks>${xmlEscape(context.qualityGate.requiredChecks.join(', '))}</required_checks>`,
    `      <auto_repair>${context.critique.autoRepair}</auto_repair>`,
    `      <critique_dimensions>${xmlEscape(context.critique.dimensions.join(', '))}</critique_dimensions>`,
    '    </quality>',
    '    <output_adapter injection="packaging_only">',
    `      <format>${xmlEscape(context.exportTarget.format)}</format>`,
    `      <include_assets>${context.exportTarget.includeAssets}</include_assets>`,
    '    </output_adapter>',
    '  </resource_context>',
  ].join('\n')
}

function renderImageControlContextXml(control: AgentImageGenerationControl): string[] {
  return [
    `          <image_control node="${xmlEscape(control.nodeId)}" count="${control.targetImageCount}" preset="${xmlEscape(control.imageStylePreset)}" style="${xmlEscape(control.stylePrompt)}" shot="${xmlEscape(control.shotType)}" aspect_ratio="${xmlEscape(control.aspectRatio)}" consistency="${xmlEscape(control.consistencyMode)}" seed="${xmlEscape(control.seedMode)}" negative="${xmlEscape(control.negativePrompt)}" />`,
  ]
}

function characterFieldDescription(field: string): string {
  const descriptions: Record<string, string> = {
    name: 'Character name shown to the user.',
    description: 'Concise role description and core appeal.',
    appearance: 'Visible physical design, outfit, expression, and image-relevant cues.',
    personality: 'Stable personality traits and relational behavior.',
    background: 'Backstory that supports long-term roleplay.',
    scenario: 'Current situation where the roleplay begins.',
    firstMessage: 'Opening message spoken by the character.',
    dialogueStyle: 'How the character talks in scenes.',
    worldContext: 'World, relationship, and scene context needed by the role.',
  }
  return descriptions[field] ?? field
}

function supportFieldDescription(field: string): string {
  const descriptions: Record<string, string> = {
    memoryStrategy: 'Runtime memory behavior for long-form roleplay continuity.',
    imagePrompt: 'Prompt for the image model; this is not shown as a character-card field.',
  }
  return descriptions[field] ?? field
}

function xmlEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function runCharacterAgentLLMTool(
  context: CharacterAgentRunContext,
  models: CharacterAgentConfiguredModel[],
  proxyUrl: string | undefined,
  input: string,
  options: { temperature?: number } = {}
): Promise<string> {
  const { configuredModel, modelName } = findConfiguredLLMModel(models, context)
  const session = createChatSessionFromModel({
    provider: configuredModel.provider,
    apiKey: configuredModel.apiKey,
    model: modelName,
    baseURL: configuredModel.baseUrl?.trim() || undefined,
  }, {
    llmOptions: {
      proxyUrl,
    },
  })
  const response = await session.send({
    input,
    language: context.language,
    options: {
      temperature: options.temperature ?? 0.5,
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

async function maybeGenerateImageArtifacts(
  context: CharacterAgentRunContext,
  models: CharacterAgentConfiguredModel[],
  proxyUrl: string | undefined,
  candidateId: string,
  input: unknown
): Promise<CharacterAgentArtifact[]> {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const capability = context.capabilities.imageModels[0]
  const configuredModel = capability
    ? models.find((model) => model.modelType === 'image' && model.id === capability.apiId)
    : models.find((model) => model.modelType === 'image')
  if (!configuredModel) {
    throw new Error('No image model is configured for character workflow image generation')
  }
  if (!configuredModel.apiKey?.trim()) {
    throw new Error(`Character workflow image API key is empty for ${configuredModel.id}`)
  }
  const modelName = capability?.modelName?.trim() || configuredModel.modelName?.trim() || configuredModel.enabledModels?.[0]?.trim()
  if (!modelName) {
    throw new Error(`Character workflow image model name is empty for ${configuredModel.id}`)
  }
  const imageTargets = context.targets.filter((target) => target.kind === 'image')
  const prompts = createImageGenerationPromptRequests(resolveImageTargetPromptRequests(source, imageTargets))
  if (!prompts.length) {
    throw new Error('request_image.targetPrompts must include at least one image prompt')
  }
  const artifacts: CharacterAgentArtifact[] = []
  for (let index = 0; index < prompts.length; index += 1) {
    const generated = await generateImageWithConfiguredProvider({
      model: configuredModel,
      modelName,
      prompt: prompts[index].prompt,
      proxyUrl,
    })
    if (generated) {
      const artifact = createToolArtifact(
        context.runId,
        candidateId,
        'image-asset',
        `${prompts[index].target.title} ${prompts[index].imageRole} ${prompts[index].targetIndex}`,
        createImageGenerationArtifact(generated),
        prompts[index].target.nodeId
      )
      artifacts.push({
        ...artifact,
        id: `${artifact.id}:${prompts[index].target.nodeId}:${prompts[index].targetIndex}`,
      })
    }
  }
  return artifacts
}

function resolveImageTargetPromptRequests(
  source: Record<string, unknown>,
  imageTargets: AgentTargetContext[]
): Array<{ target: AgentTargetContext; prompt: string }> {
  const targetById = new Map(imageTargets.map((target) => [target.nodeId, target]))
  return normalizeImageTargetPromptInputs(source.targetPrompts).map((item) => {
    const target = targetById.get(item.targetNodeId)
    if (!target) {
      throw new Error(`Image request references unknown image target: ${item.targetNodeId}`)
    }
    return { target, prompt: item.prompt.trim() }
  })
}

function createImageGenerationPromptRequests(
  requests: Array<{ target: AgentTargetContext; prompt: string }>
): Array<{ target: AgentTargetContext; targetIndex: number; imageRole: string; prompt: string }> {
  const targetPromptCounts = new Map<string, number>()
  return requests.map((request) => {
    const targetRole = request.target.imageRole
    if (!targetRole) {
      throw new Error(`Image target ${request.target.nodeId} is missing imageRole`)
    }
    const targetIndex = (targetPromptCounts.get(request.target.nodeId) ?? 0) + 1
    targetPromptCounts.set(request.target.nodeId, targetIndex)
    const control = getImageControlForPromptIndex(request.target.imageControls, targetIndex)
    return {
      target: request.target,
      targetIndex,
      imageRole: targetRole,
      prompt: buildImageGenerationPrompt(request.target, targetRole, request.prompt, control),
    }
  })
}

function getImageControlForPromptIndex(
  controls: AgentImageGenerationControl[],
  targetIndex: number
): AgentImageGenerationControl | undefined {
  if (!controls.length) {
    return undefined
  }
  let cursor = 0
  for (const control of controls) {
    const count = Math.max(1, Math.floor(control.targetImageCount))
    cursor += count
    if (targetIndex <= cursor) {
      return control
    }
  }
  return controls[controls.length - 1]
}

function normalizeImageTargetPromptInputs(value: unknown): CharacterAgentImageTargetPrompt[] {
  if (!Array.isArray(value)) {
    throw new Error('request_image.targetPrompts must be an array')
  }
  return value.map((item, index): CharacterAgentImageTargetPrompt => {
    if (!item || typeof item !== 'object') {
      throw new Error(`request_image.targetPrompts[${index}] must be an object`)
    }
    const record = item as Record<string, unknown>
    const targetNodeId = stringField(record.targetNodeId, '')
    const prompt = stringField(record.prompt, '')
    if (!targetNodeId || !prompt) {
      throw new Error(`request_image.targetPrompts[${index}] must include targetNodeId and prompt`)
    }
    return {
      targetNodeId,
      prompt,
      title: stringField(record.title, ''),
    }
  })
}

function buildImageGenerationPrompt(
  target: AgentTargetContext,
  imageRole: string,
  promptText: string,
  control: AgentImageGenerationControl | undefined
): string {
  const resolvedRole = imageRole || target.imageRole
  if (!resolvedRole) {
    throw new Error(`Image target ${target.nodeId} is missing imageRole`)
  }
  const roleInstruction = imageRoleInstruction(resolvedRole)
  const negative = [
    control?.negativePrompt,
    'text, caption, subtitle, watermark, logo, signature, UI text, prompt words, labels, typography, speech bubble',
  ].filter(Boolean).join(', ')
  return [
    roleInstruction,
    target.imageAssetPurpose ? `Asset purpose: ${target.imageAssetPurpose}.` : '',
    control?.imageStylePreset ? `Style preset: ${formatImageStylePreset(control.imageStylePreset)}.` : '',
    control?.stylePrompt ? `Visual style: ${control.stylePrompt}.` : '',
    control ? naturalImageControlInstruction(control) : '',
    'Generate visual content only, with no written words, letters, symbols, captions, interface elements, labels, logos, watermarks, or visible prompt text anywhere in the image.',
    promptText,
    `The image must avoid ${negative}.`,
  ].filter(Boolean).join('\n')
}

function formatImageStylePreset(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => /^[0-9]+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function imageRoleInstruction(imageRole: string): string {
  const instructions: Record<string, string> = {
    avatar: 'Create a single avatar portrait focused on the character face, hair, expression, and upper-body identity, with a simple but story-relevant background.',
    'hero-cover': 'Create a polished role-card cover image: attractive character-first composition, clear identity, strong background atmosphere, and a visual hook for the card premise.',
    'full-body': 'Create a single full-body character image showing the complete outfit, posture, proportions, and silhouette while preserving the same face and identity.',
    'opening-moment': 'Create a story image for the opening message: the character is visibly present in the first-scene situation with background, props, mood, and narrative hook.',
    'story-moment': 'Create a plot-supporting character image tied to a specific card field or story beat, with the character grounded in a concrete background.',
    expression: 'Create a single expression reference focused on one clear facial expression and emotional state, without label text or a labeled collage.',
    'outfit-detail': 'Create a design-detail image emphasizing outfit materials, accessories, motifs, and palette while keeping the character identity recognizable.',
    'relationship-moment': 'Create a character-focused relationship beat with another person implied or partially present, emphasizing body language, tension, and emotional context.',
    'world-context': 'Create a world-context image that still includes the character or unmistakable character-linked motifs, not an empty environment-only scene.',
  }
  return instructions[imageRole] ?? `Create a single coherent visual for the ${imageRole} image role.`
}

function naturalImageControlInstruction(control: AgentImageGenerationControl): string {
  const consistencyMode = control.consistencyMode
  const consistencyText: Record<string, string> = {
    'same-character': 'Preserve the same character identity.',
    'same-world': 'Preserve the same world and visual continuity.',
    independent: 'This image may stand independently.',
  }
  return [
    consistencyText[consistencyMode] ?? '',
    control.shotType && control.shotType !== 'auto' ? `Shot type: ${control.shotType}.` : '',
    control.aspectRatio ? `Aspect ratio target: ${control.aspectRatio}.` : '',
    control.seedMode ? `Seed strategy: ${control.seedMode}.` : '',
  ].filter(Boolean).join(' ')
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
