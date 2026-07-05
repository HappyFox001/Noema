/**
 * Chat-model backed tools for autonomous character resource generation.
 */
import { createChatSessionFromModel } from '../chat/index.js'
import { createImageGenerationArtifact, generateImageWithConfiguredProvider } from '../image/index.js'
import { filterEditCapableImageModelNames } from '../image/catalog.js'
import {
  CHARACTER_CARD_FIELD_SCHEMA,
  CHARACTER_SUPPORT_FIELD_SCHEMA,
  createCharacterAgentToolRuntime,
  type AgentToolDefinition,
  type CharacterAgentImageTargetPrompt,
  type AgentModelCapability,
  type AgentImageGenerationControl,
  type AgentTargetContext,
  type CharacterCardDraft,
  type CharacterAgentArtifact,
  type CharacterAgentArtifactKind,
  type CharacterAgentModelConfig,
  type CharacterAgentRunContext,
} from './agent-runtime.js'
import {
  buildDirectedImageGenerationPrompt,
  createCharacterImageProfile,
  createDirectedAutomaticImagePrompt,
  getDirectedImageRolePriority,
} from './image-prompt-director.js'

const AVATAR_IMAGE_ASPECT_RATIO = '3:4'
const OVERVIEW_SHEET_ASPECT_RATIO = '16:9'
const LOCAL_CLI_DEFAULT_MODEL_REF = '__default__'

export interface CharacterAgentConfiguredModel {
  id: string
  modelType: 'llm' | 'image'
  provider?: string
  transport?: 'openai_compatible' | 'codex_local' | 'claude_code_local'
  modelName: string
  enabledModels?: string[]
  apiKey: string
  baseUrl: string
}

export function createCharacterAgentModelConfigs(
  models: CharacterAgentConfiguredModel[]
): CharacterAgentModelConfig[] {
  return models.flatMap((model) => {
    const configuredNames = getConfiguredModelNames(model)
    const names = model.modelType === 'image'
      ? filterEditCapableImageModelNames(model.provider, configuredNames)
      : configuredNames
    return names.map((modelName) => ({
      apiId: model.id,
      modelName: displayConfiguredModelName(model, modelName),
      modelRef: `${model.id}::${modelName}`,
      kind: model.modelType,
      provider: model.provider,
      label: displayConfiguredModelName(model, modelName),
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
        const imageAssetCount = imageArtifacts.filter((artifact) => artifact.kind === 'image-asset').length
        const failedAttemptCount = imageArtifacts.filter((artifact) => artifact.kind === 'image-attempt').length - imageAssetCount
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
          ok: imageAssetCount > 0,
          summary: imageAssetCount
            ? `Generated ${imageAssetCount} character image asset(s).`
            : failedAttemptCount
              ? `Image generation needs action: ${failedAttemptCount} failed attempt(s).`
              : errorMessage || 'Skipped image generation because image model or prompt is unavailable.',
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
    continuityControls: context.continuityControls,
    relationshipControls: context.relationshipControls,
    sourceMaterials: context.sourceMaterials,
    capabilities: context.capabilities,
    policy: context.policy,
    strategy: context.strategy,
    critique: context.critique,
    requestedAssets: context.requestedAssets,
    requirements: context.requirements,
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
    '  <compact_image_prompt_rules>',
    '    <rule>For image-facing content, write dense comma-separated visual phrases that can be sent directly to an image model. Do not write policy prose, requirement prose, analysis, or instruction manuals.</rule>',
    '    <rule>appearancePrompt is the avatar identity seed prompt. It must already be drawable before runtime wrapping, and it is used only for the first avatar image. Later images inherit identity from graph-linked reference images instead of reusing appearancePrompt text.</rule>',
    '    <rule>When writing appearancePrompt, read the connected image control style domain and stylePrompt as style direction, then write one compact comma-separated visual phrase using this fixed checklist: age or age impression, nationality/ethnicity/species, gender presentation, temperament/archetype, hair style/color/length/texture, face shape, eyes, eyebrows, nose, lips, makeup or natural face treatment, skin tone and texture, body type and silhouette, default outfit and material, signature accessory or motif, base rendering style, quality cue.</rule>',
    '    <rule>There are only four image style domains: photoreal, anime, illustration, and stylized. Adult or sensual visual tone is controlled through image_control fields such as appeal, sensuality, wardrobe_exposure, pose_goals, and background_interaction, not by inventing a fifth style domain.</rule>',
    '    <rule>Anime appearancePrompt pattern: anime style illustration, age impression and archetype, hair color/style/length, eye design and highlights, face shape, brows, nose and mouth style, outfit/material, body silhouette, signature motif, pixiv style, high quality anime art, detailed expressive eyes.</rule>',
    '    <rule>Photoreal appearancePrompt pattern: age + ethnicity/gender, temperament, hair style/color/length, face shape, eyes, brows, nose, lips, makeup, skin tone and texture, body shape, default clothing/material, accessory, realistic portrait photography, natural skin texture, high quality photo. Chinese prompt phrases are acceptable for photoreal characters.</rule>',
    '    <rule>Adult attraction and sensual visual design are valid character-image goals. When relevant, express them concretely through adult body language, gaze, pose, fabric, wardrobe exposure, light, scene objects, and background interaction while preserving the character identity.</rule>',
    '    <rule>Do not add unsolicited modesty or anti-exposure qualifiers such as non-revealing, safe, tasteful, implied, censored, or not explicit. Preserve adult, sensual, erotic, explicit, revealing, or sexualized direction when it matches the workflow goal or user request.</rule>',
    '    <rule>Avatar targetPrompts are bound to imageRole=avatar and should only add the canonical avatar.jpg composition: single visible character, fixed 3:4 portrait asset framing, upper-body or half-body portrait, one clear unobstructed face, looking at camera, calm natural expression, simple uncluttered background, soft light. Do not restate the full appearancePrompt or request another aspect ratio.</rule>',
    '    <rule>Non-avatar free sample image targets use imageRole=character-base-image. They are free-form base character sample images migrated from the avatar reference, not fixed categories like cover, full-body, expression, outfit detail, relationship moment, or world context.</rule>',
    '    <rule>character-base-image targetPrompts should describe image purpose and composition only: pose, camera angle, scene, action, outfit usage, mood, props, background, and roleplay meaning. Identity should come from supplied avatar reference images.</rule>',
    '    <rule>character-base-image may produce multiple images. For multi-image targets, make each sample meaningfully different while preserving the same character: different scenes, activities, emotional beats, or situational uses. Do not request a model sheet, collage, split-screen, written labels, or another avatar.</rule>',
    '    <rule>For character-base-image visual appeal, express adult sensuality through pose, gaze, body line, fabric behavior, lighting, background objects, wardrobe exposure, and prop interaction. These are first-class visual controls, not forbidden content.</rule>',
    '    <rule>If image_control includes pose_goals, background_interaction, appeal, sensuality, or wardrobe_exposure, treat them as strong local guidance for every character-base-image prompt from that target. The prompt should name concrete poses, body language, scene objects, and interactions instead of generic sexy adjectives.</rule>',
    '    <rule>Overview is a special built-in image role, like avatar. Its imageRole already requires a complete fixed 16:9 production overview sheet: left third large front full-body reference plus smaller half-body portrait crop, center third back view and side or three-quarter neutral model references, right third and bottom strip compact visual detail tiles, same character as avatar reference, no written labels.</rule>',
    '    <rule>Overview targetPrompts should only add slot-specific sheet emphasis such as pose neutrality, costume continuity, specific outfit variation, or which details to emphasize. Do not turn overview into a scene, cover, poster, single portrait, or non-16:9 canvas.</rule>',
    '    <example field="appearancePrompt" style="anime">anime style illustration, young adult fox-spirit woman, playful elegant temperament, long flowing crimson hair with soft waves, amber eyes with bright highlights, delicate oval face, slim brows, small nose, soft lips, pale luminous skin, graceful hourglass silhouette, layered red silk kimono with gold trim, small fox-ear hair ornament, pixiv style, high quality anime art, detailed expressive eyes</example>',
    '    <example field="appearancePrompt" style="photoreal">28岁中国女性，成熟温柔气质，深棕色大波浪长发自然垂落，鹅蛋脸，眉眼柔和但有神，高鼻梁，唇形饱满，精致淡妆，肤色白皙自然可见真实皮肤质感，身材高挑匀称腰线清晰，黑色丝绸长裙，细珍珠耳环，真实肖像摄影，高质量摄影</example>',
    '    <example action="request_image" target="avatar-image-target">canonical 3:4 avatar.jpg portrait, single visible character, upper-body framing, one clear unobstructed face, looking at camera, calm natural expression, simple pale background, soft light</example>',
    '    <example action="request_image" target="overview-sheet-image-target">fixed 16:9 production overview sheet, left large front full-body view plus half-body portrait crop, center back and three-quarter model views, right and bottom detail tiles for eyes, nose and mouth, hairstyle, hand pose, shoes, fabric and accessories, preserve avatar outfit construction, no written labels</example>',
    '  </compact_image_prompt_rules>',
    '  <action_contract>',
    '    <output_format>Return JSON only. No markdown. No XML in the response.</output_format>',
    '    <shape>{"summary":"what changed in this step","done":false,"confidence":0.0,"missing":[],"actions":[{"type":"merge_character_card","value":{"name":"...","description":"...","appearance":"..."}}]}</shape>',
    '    <field_content_rule>Every set_field value must be final character-card content, not a prompt, not a plan, and not a resource-control description.</field_content_rule>',
    '    <field_content_rule>Never write labels such as "Style:", "Goal:", "Field purpose:", "target atmosphere", XML tag names, or operation instructions inside character fields.</field_content_rule>',
    '    <field_content_rule>Every field has a distinct job. Do not duplicate the same sentence, relationship premise, visual fact, lore paragraph, or opening beat across fields. Shared facts may be referenced briefly only when the local field needs them.</field_content_rule>',
    '    <field_content_rule>name is only the role name. description is the concise character hook and RP appeal. personality is inner drives, contradictions, habits, and emotional logic. appearance is visible body, outfit, expression, posture, and motifs. background is formative past and secrets. scenario is the persistent present RP setup. worldContext is stable world/relationship/social facts outside one scene. firstMessage is the playable opening scene only. dialogueStyle is how the character speaks across chat, not scene prose. appearancePrompt is image identity only.</field_content_rule>',
    '    <field_content_rule>When completing multiple fields in one merge_character_card action, assign each unique character or story fact to the best field once. Prefer complementary fields over overlapping summaries.</field_content_rule>',
    '    <field_content_rule>description must describe who the character is and why they are appealing for RP. appearance must describe visible body/outfit/expression cues. Do not describe the generation target itself.</field_content_rule>',
    '    <field_content_rule>appearancePrompt is the avatar identity seed prompt: after the visible character-card fields exist, derive one compact image-model phrase from name, description, appearance, personality, background, scenario, worldContext, and connected image style controls. Follow the fixed visual checklist: age or age impression, nationality/ethnicity/species, gender presentation, temperament/archetype, hair style/color/length/texture, face shape, eyes, eyebrows, nose, lips, makeup or natural face treatment, skin tone and texture, body type and silhouette, default outfit and material, signature accessory or motif, base rendering style, quality cue. Preserve adult/sensual identity details when they define the character, but keep pose, scene, wardrobe exposure, and erotic composition mostly in image-control and targetPrompts. Do not include avatar-only wrapping such as half-body portrait, looking at camera, simple background, or soft light unless it belongs to the style domain itself; do not include story scene actions, workflow terms, reference links, multi-image layouts, panels, negative prompts, or target-specific asset instructions.</field_content_rule>',
    '    <role_chat_format_rule>firstMessage is the runnable opening turn for the role chat. It must be final in-character scene text wrapped exactly once as <chat>...</chat>.</role_chat_format_rule>',
    '    <role_chat_format_rule>Inside <chat>, write the opening scene as immersive RP prose with the character present, a concrete situation, sensory details, and a clear hook for the user to respond. Do not include analysis, labels, markdown, or setup notes.</role_chat_format_rule>',
    '    <role_chat_format_rule>Keep firstMessage attractive and playable rather than bloated: usually 2-4 tight paragraphs. Do not include project names, field names, XML tag names, or visible protocol fragments inside the chat body.</role_chat_format_rule>',
    '    <role_chat_format_rule>dialogueStyle must describe how the character speaks during chat, not the opening scene. scenario must define the persistent RP situation. worldContext must carry stable world facts.</role_chat_format_rule>',
    '    <seed_rule>If runtime_state.turn_context_json contains seedPass, return exactly one merge_character_card action. Fill every requested field that can be inferred. Do not request images during seedPass.</seed_rule>',
    '    <seed_rule>For seedPass.stage="base", generate the stable character seed fields first: name, description, personality, appearance, background, scenario, worldContext. Keep these fields complementary and non-overlapping. For seedPass.stage="derived", generate fields that depend on the seed: firstMessage, dialogueStyle, appearancePrompt, and any still-missing requested fields.</seed_rule>',
    '    <seed_rule>Use the Sugar-style seed workflow: first establish the character identity and visible design, then derive roleplay opening, speech style, and image identity prompt from that stable seed. Prefer one coherent merge_character_card over many set_field actions.</seed_rule>',
    '    <progressive_rule>If runtime_state.turn_context_json contains completionPass.requiredField, return exactly one set_field action for that exact field. Do not return request_image, finish, or another field until the requested field is complete.</progressive_rule>',
    '    <workflow_rule>The runtime_state includes workflow requirements. Complete only requirements that are missing and unblocked. Never request an image target whose dependency source is still blocked or missing.</workflow_rule>',
    '    <workflow_rule>Reference-image ordering is defined by graph edges and requirement dependencies, not by a hardcoded role sequence. If a target has reference inputs, write the prompt for that target assuming the runtime supplies those reference images.</workflow_rule>',
    '    <scoped_repair_rule>If runtime_state.turn_context_json contains scopedRun and selectedArtifacts, treat the user instruction as external feedback for those selected run artifacts only.</scoped_repair_rule>',
    '    <scoped_repair_rule>For selected character-card-field artifacts, return one set_field action for that exact field with revised final content. Do not edit unrelated fields.</scoped_repair_rule>',
    '    <scoped_repair_rule>For selected non-field textual artifacts, return create_artifact preserving the artifact purpose and applying the instruction. Do not run a full workflow plan.</scoped_repair_rule>',
    '    <image_rule>Use the graph-declared image pipeline. Avatar is the first identity image. Overview images must use linked avatar references to preserve the same face, hair, proportions, and outfit language.</image_rule>',
    '    <image_rule>character-base-image targets must also use linked avatar references to preserve the same face, hair, proportions, and outfit language while varying scene, action, mood, and roleplay function.</image_rule>',
    '    <image_rule>The avatar prompt must be a compact positive direction for one final avatar.jpg identity master image: fixed 3:4 portrait asset, one visible character only, one clear unobstructed face, upper-body or half-body portrait, looking at camera, calm natural expression, readable face/hair/default outfit/body silhouette, simple uncluttered background, polished finish. Do not request a poster, cover, scene moment, model sheet, collage, split-screen, multiple poses, or any non-3:4 aspect ratio for avatar.</image_rule>',
    '    <image_rule>The character-overview-sheet prompt must stay bound to the overview image role: same avatar reference identity, fixed 16:9 production overview sheet, left third large front full-body reference plus half-body portrait crop, center third back view and side or three-quarter neutral model references, right third and bottom strip detail tiles for expressions, eyes, nose and mouth, hairstyle, hands, feet/shoes, outfit fabric/accessory/hemline/silhouette details, no written labels.</image_rule>',
    '    <image_rule>The character-base-image prompt must stay free-form and sample-based: same avatar reference identity, one clear character-focused image per prompt, meaningful scene/action/mood/outfit usage/prop interaction, adult sensual or erotic appeal according to image_control, no model sheet, no collage, no split screen, no written labels, and no second avatar.</image_rule>',
    '    <image_rule>If an image attempt failed, is stale because its reference changed, or selected artifact feedback says the image is ugly, duplicated, off-style, multi-face, not matching appearancePrompt, or otherwise unacceptable, request_image for the same targetNodeId with a sharper corrected targetPrompts.prompt. Do not edit the workflow graph for a local image reroll.</image_rule>',
    '    <image_rule>The runtime wraps avatar targetPrompts.prompt with appearancePrompt, role-specific positive visual direction, style suffix, quality suffix, and a short avoid list. For non-avatar images, the runtime omits appearancePrompt and relies on graph-linked reference images plus role/style/quality wrapping. Do not repeat the full appearancePrompt inside targetPrompts.prompt.</image_rule>',
    '    <image_rule>Request one image prompt at a time. If a target ultimately needs multiple images, the runtime will request the next image after the previous image artifact is created.</image_rule>',
    '    <image_rule>All non-avatar images for the same role card must use reference-image continuity for face structure, hair, eyes, age impression, body type, signature accessories, and outfit language. Vary pose, shot, background, mood, lighting, outfit, and story function through targetPrompts.</image_rule>',
    '    <image_rule>Each targetPrompts.prompt should be a compact slot-specific visual direction: pose, expression, framing, camera angle, background simplicity, prop/motif, mood, and image function. For attractive free images, specify how the body line, hands, gaze, fabric, furniture, window light, mirror, cup, book, weapon, instrument, or other objects create adult visual appeal. Include only composition or slot-specific changes, not a rewritten identity bible.</image_rule>',
    '    <image_rule>Do not request pure empty scene images. Every image should contain the character or unmistakable character-linked visual motifs, and should support the role card text, opening, story, relationship, or layout.</image_rule>',
    '    <allowed_actions>',
    '      <action name="set_field">{"type":"set_field","field":"name","value":"...","reason":"..."}</action>',
    '      <action name="merge_character_card">{"type":"merge_character_card","value":{"name":"...","description":"...","appearance":"...","personality":"...","background":"...","scenario":"...","worldContext":"...","firstMessage":"<chat>...</chat>","dialogueStyle":"...","appearancePrompt":"..."},"reason":"..."}</action>',
    '      <action name="create_artifact">{"type":"create_artifact","kind":"generation-report","title":"...","summary":"...","data":{"text":"..."}}</action>',
    '      <action name="request_image">{"type":"request_image","targetPrompts":[{"targetNodeId":"avatar-image-target","title":"avatar.jpg","prompt":"compact target-specific image prompt"}]}</action>',
    '      <action name="finish">{"type":"finish","reason":"..."}</action>',
    '    </allowed_actions>',
    '    <completion_rule>Set done=true only after every required workflow requirement is complete. Always produce appearancePrompt and every unblocked required image target.</completion_rule>',
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
    '    <must_check>Fields are complementary and non-repetitive: no duplicated relationship premise, visual inventory, lore paragraph, opening beat, or generic summary across description, personality, background, scenario, worldContext, firstMessage, and dialogueStyle.</must_check>',
    '    <must_check>Each field contributes a unique character or story function: character fields deepen identity, story fields deepen situation/world, and dialogueStyle controls speech rather than restating scenes.</must_check>',
    '    <must_check>Supporting resources include appearancePrompt; if an image model is configured, image readiness must be judged.</must_check>',
    '    <must_check>Only evaluate constraints that are explicitly present in the workflow graph or user request. Do not invent extra content-moderation checks in the quality gate.</must_check>',
    '    <must_check>Adult, sensual, erotic, seductive, NSFW, or explicit visual direction is not a blocking issue by itself when it matches the workflow goal. Do not repair it away unless it contradicts an explicit user or graph constraint.</must_check>',
    '    <must_check>Style pressures are visible but not copied mechanically.</must_check>',
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
    '    <rule>appearancePrompt is the visible avatar identity seed prompt for the image model. It is derived from the completed character-card fields and connected image style controls, and must be one drawable comma-separated visual phrase following this checklist: age or age impression, nationality/ethnicity/species, gender presentation, temperament/archetype, hair style/color/length/texture, face shape, eyes, eyebrows, nose, lips, makeup or natural face treatment, skin tone and texture, body type and silhouette, default outfit and material, signature accessory or motif, base rendering style, quality cue. It is used for avatar generation and emitted as an image-prompt artifact; later images should use graph-linked reference images for identity. It must not carry workflow terms, reference links, multi-image layouts, panels, negative prompts, or target-specific asset instructions.</rule>',
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
      `      <target node="${xmlEscape(target.nodeId)}" kind="${xmlEscape(target.kind)}" field="${xmlEscape(target.field ?? '')}" fields="${xmlEscape((target.fields ?? []).join(', '))}" image_role="${xmlEscape(target.imageRole ?? '')}">`,
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
      ...target.fieldControls.map((item) => `          <field_control node="${xmlEscape(item.nodeId)}" field="${xmlEscape(item.field)}" tone="${xmlEscape(item.tone)}" length="${xmlEscape(item.lengthPolicy)}" avoid="${xmlEscape(item.avoidPatterns.join('; '))}">${xmlEscape(item.fieldPurpose)}</field_control>`),
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
    '    <requirements injection="execution_contract">',
    ...context.requirements.map((requirement) =>
      `      <requirement id="${xmlEscape(requirement.id)}" kind="${xmlEscape(requirement.kind)}" target="${xmlEscape(requirement.targetNodeId)}" required="${requirement.required}" field="${xmlEscape(requirement.field ?? '')}" image_role="${xmlEscape(requirement.imageRole ?? '')}" count="${requirement.requiredCount ?? 1}" depends_on="${xmlEscape(requirement.dependencyNodeIds.join(', '))}" reference_sources="${xmlEscape(requirement.referenceSourceNodeIds.join(', '))}">${xmlEscape(requirement.title)}</requirement>`
    ),
    '    </requirements>',
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
      ...item.materials.map((material) => material.kind === 'image'
        ? `        <material id="${xmlEscape(material.id)}" kind="image" name="${xmlEscape(material.name)}" mime="${xmlEscape(material.mimeType)}" size="${material.size ?? 0}" />`
        : [
            `        <material id="${xmlEscape(material.id)}" kind="document" name="${xmlEscape(material.name)}" mime="${xmlEscape(material.mimeType)}" size="${material.size ?? 0}">`,
            `          <text>${xmlEscape(compactSourceMaterialText(material.text))}</text>`,
            '        </material>',
          ].join('\n')),
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
      `          <image_control node="${xmlEscape(control.nodeId)}" count="${control.targetImageCount}" style_domain="${xmlEscape(control.imageStyleDomain)}" style="${xmlEscape(control.stylePrompt)}" pose_goals="${xmlEscape(control.poseGoals.join('; '))}" background_interaction="${xmlEscape(control.backgroundInteraction)}" appeal="${xmlEscape(control.appealMode)}" sensuality="${xmlEscape(control.sensualityLevel)}" wardrobe_exposure="${xmlEscape(control.wardrobeExposure)}" shot="${xmlEscape(control.shotType)}" aspect_ratio="${xmlEscape(control.aspectRatio)}" consistency="${xmlEscape(control.consistencyMode)}" seed="${xmlEscape(control.seedMode)}" />`,
  ]
}

function characterFieldDescription(field: string): string {
  const descriptions: Record<string, string> = {
    name: 'Character name shown to the user. Keep it short; do not include role summary or tags.',
    description: 'Concise identity hook and RP appeal: who this character is now, what makes them compelling, and why the user would engage. Do not repeat full backstory, physical inventory, or opening scene.',
    appearance: 'Visible physical design only: body, face, hair, outfit, expression, posture, signature motifs, and image-relevant cues. Do not explain personality, world lore, or current plot except as visible details.',
    personality: 'Inner drives, contradictions, habits, emotional logic, relational behavior, and boundaries. Do not retell backstory or describe clothing unless it reveals behavior.',
    background: 'Formative past, secrets, losses, obligations, and history that explain the character. Do not repeat the current scenario or world encyclopedia.',
    scenario: 'Persistent present RP setup: where the user meets the character, current tension, roles, stakes, and what can keep happening. Do not write the opening message prose.',
    firstMessage: 'Playable opening scene only, wrapped in <chat>...</chat>, with the character present, a concrete hook, and no visible protocol labels. Keep it rich but concise.',
    dialogueStyle: 'How the character speaks across chat: diction, rhythm, address style, emotional tells, taboo phrases, and sample tendencies. Do not write a scene.',
    worldContext: 'Stable world, relationship, institution, social, supernatural, or setting facts outside one scene. Do not duplicate scenario beats or character biography.',
  }
  return descriptions[field] ?? field
}

function supportFieldDescription(field: string): string {
  const descriptions: Record<string, string> = {
    appearancePrompt: 'Visible avatar identity seed prompt derived from completed character-card fields and connected image style controls. It must be one drawable comma-separated phrase with age or age impression, nationality/ethnicity/species, gender presentation, temperament/archetype, hair, facial features, makeup or natural face treatment, skin tone and texture, body silhouette, default outfit/material, signature accessory or motif, base rendering style, and quality cue. No workflow terms, reference links, panels, negative prompts, or target-specific asset instructions.',
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

function compactSourceMaterialText(value: unknown): string {
  const normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return normalized.length > 1800 ? `${normalized.slice(0, 1800).trim()}...` : normalized
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
    transport: configuredModel.transport,
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
  console.log('[CharacterWorkflow] LLM raw response:', {
    runId: context.runId,
    modelName,
    apiId: configuredModel.id,
    content: response.content,
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
  const requestedModelName = requested?.modelRef?.startsWith(`${configuredModel.id}::`)
    ? requested.modelRef.slice(`${configuredModel.id}::`.length)
    : requested?.modelName
  const modelName = requestedModelName || configuredModel.enabledModels?.[0] || configuredModel.modelName
  const normalizedModelName = normalizeConfiguredModelNameForCall(configuredModel, modelName)
  if (!normalizedModelName && !isLocalCLIModel(configuredModel)) {
    throw new Error('Character workflow LLM model name is empty')
  }
  if (!configuredModel.apiKey?.trim() && !isLocalCLIModel(configuredModel)) {
    throw new Error(`Character workflow LLM API key is empty for ${configuredModel.id}`)
  }
  return { configuredModel, modelName: normalizedModelName }
}

function getConfiguredModelNames(model: CharacterAgentConfiguredModel): string[] {
  const names = (model.enabledModels?.length ? model.enabledModels : [model.modelName])
    .map((name) => String(name || '').trim())
    .filter(Boolean)
  if (names.length > 0) {
    return names
  }
  return isLocalCLIModel(model) ? [LOCAL_CLI_DEFAULT_MODEL_REF] : []
}

function isLocalCLIModel(model: CharacterAgentConfiguredModel): boolean {
  return model.transport === 'codex_local' || model.transport === 'claude_code_local'
}

function displayConfiguredModelName(model: CharacterAgentConfiguredModel, modelName: string): string {
  if (modelName !== LOCAL_CLI_DEFAULT_MODEL_REF || !isLocalCLIModel(model)) {
    return modelName
  }
  return model.transport === 'claude_code_local' ? 'Claude Code default' : 'Codex default'
}

function normalizeConfiguredModelNameForCall(model: CharacterAgentConfiguredModel, modelName: string | undefined): string {
  const trimmed = String(modelName || '').trim()
  if (isLocalCLIModel(model) && trimmed === LOCAL_CLI_DEFAULT_MODEL_REF) {
    return ''
  }
  return trimmed
}

async function maybeGenerateImageArtifacts(
  context: CharacterAgentRunContext,
  models: CharacterAgentConfiguredModel[],
  proxyUrl: string | undefined,
  candidateId: string,
  input: unknown
): Promise<CharacterAgentArtifact[]> {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  if (!models.some((model) => model.modelType === 'image')) {
    throw new Error('No image model is configured for character workflow image generation')
  }
  const draft = normalizeDraftInput(source.draft)
  const requestedTargetIds = new Set(arrayField(source.targetNodeIds))
  const imageTargets = context.targets
    .filter((target) => target.kind === 'image')
    .filter((target) => !requestedTargetIds.size || requestedTargetIds.has(target.nodeId))
  const prompts = createImageGenerationPromptRequests(resolveImageTargetPromptRequests(source, imageTargets, draft), draft)
  if (!prompts.length) {
    throw new Error('request_image.targetPrompts must include at least one image prompt')
  }
  const artifacts: CharacterAgentArtifact[] = []
  const referenceImagesByTarget = normalizeReferenceImagesByTarget(source.referenceImagesByTarget)
  for (let index = 0; index < prompts.length; index += 1) {
    const referenceImages = resolveReferenceImagesForPrompt(prompts[index], referenceImagesByTarget)
    const { capability, configuredModel, modelName } = selectImageModelForPrompt(context, models, prompts[index].target, referenceImages.length > 0)
    if (!configuredModel.apiKey?.trim()) {
      throw new Error(`Character workflow image API key is empty for ${configuredModel.id}`)
    }
    if (!modelName) {
      throw new Error(`Character workflow image model name is empty for ${configuredModel.id}`)
    }
    const size = imageSizeForPrompt(prompts[index])
    const prompt = appendRerollInstruction(prompts[index].prompt, source.rerollInstruction)
    const attemptId = `${context.runId}:image-attempt:${prompts[index].target.nodeId}:${prompts[index].targetIndex}:${Date.now()}:${index}`
    const attemptBase = {
      attemptId,
      targetNodeId: prompts[index].target.nodeId,
      targetTitle: prompts[index].target.title,
      imageRole: prompts[index].imageRole,
      targetIndex: prompts[index].targetIndex,
      prompt,
      referenceImages,
      model: {
        provider: configuredModel.provider,
        modelName,
        apiId: configuredModel.id,
        capabilityNodeId: capability?.nodeId,
      },
      size,
      action: typeof source.rerollAction === 'string' ? source.rerollAction : undefined,
      instruction: typeof source.rerollInstruction === 'string' ? source.rerollInstruction : undefined,
      parentAttemptId: typeof source.parentAttemptId === 'string' ? source.parentAttemptId : undefined,
    }
    try {
      const generated = await generateImageWithConfiguredProvider({
        model: configuredModel,
        modelName,
        prompt,
        proxyUrl,
        referenceImages,
        size,
      })
      const artifact = createToolArtifact(
        context.runId,
        candidateId,
        'image-asset',
        `${prompts[index].target.title} ${prompts[index].imageRole} ${prompts[index].targetIndex}`,
        {
          ...createImageGenerationArtifact(generated),
          ...attemptBase,
          status: 'succeeded',
          accepted: true,
        },
        prompts[index].target.nodeId
      )
      artifacts.push({
        ...artifact,
        id: `${artifact.id}:${prompts[index].target.nodeId}:${prompts[index].targetIndex}`,
      })
      artifacts.push(createImageAttemptArtifact(context.runId, candidateId, prompts[index].target.nodeId, attemptBase, {
        status: 'succeeded',
        imageArtifactId: `${artifact.id}:${prompts[index].target.nodeId}:${prompts[index].targetIndex}`,
        summary: 'Image generated successfully.',
      }))
    } catch (error) {
      const message = formatImageGenerationError(error)
      artifacts.push(createImageAttemptArtifact(context.runId, candidateId, prompts[index].target.nodeId, attemptBase, {
        status: 'failed',
        error: message,
        summary: message,
      }))
    }
  }
  return artifacts
}

function selectImageModelForPrompt(
  context: CharacterAgentRunContext,
  models: CharacterAgentConfiguredModel[],
  target: AgentTargetContext,
  hasReferenceImages: boolean
): {
  capability: AgentModelCapability | undefined
  configuredModel: CharacterAgentConfiguredModel
  modelName: string
} {
  const connectedNodeIds = new Set(
    target.incomingRelations
      .filter((relation) => relation.toPort === 'image')
      .map((relation) => relation.fromNodeId)
  )
  const connectedCapabilities = context.capabilities.imageModels.filter((capability) => connectedNodeIds.has(capability.nodeId))
  const scopedCapabilities = connectedCapabilities.length ? connectedCapabilities : context.capabilities.imageModels
  const preferredCapability = scopedCapabilities.find((capability) => imageCapabilityMatchesReferenceMode(capability, hasReferenceImages))
    ?? scopedCapabilities[0]
    ?? context.capabilities.imageModels.find((capability) => imageCapabilityMatchesReferenceMode(capability, hasReferenceImages))
    ?? context.capabilities.imageModels[0]
  const configuredModel = preferredCapability
    ? models.find((model) => model.modelType === 'image' && model.id === preferredCapability.apiId)
    : models.find((model) => model.modelType === 'image')
  if (!configuredModel) {
    throw new Error('No image model is configured for character workflow image generation')
  }
  return {
    capability: preferredCapability,
    configuredModel,
    modelName: preferredCapability?.modelName?.trim() || configuredModel.modelName?.trim() || configuredModel.enabledModels?.[0]?.trim() || '',
  }
}

function imageCapabilityMatchesReferenceMode(capability: AgentModelCapability, hasReferenceImages: boolean): boolean {
  const usageMode = typeof capability.parameters.usageMode === 'string' ? capability.parameters.usageMode : ''
  const isReferenceCapability = usageMode === 'reference-edit'
  return hasReferenceImages ? isReferenceCapability : !isReferenceCapability
}

function resolveImageTargetPromptRequests(
  source: Record<string, unknown>,
  imageTargets: AgentTargetContext[],
  draft: CharacterCardDraft
): Array<{ target: AgentTargetContext; prompt: string; targetIndex?: number }> {
  const explicitTargetPrompts = Array.isArray(source.targetPrompts) && source.targetPrompts.length > 0
  if (!explicitTargetPrompts || source.autoGenerateTargetPrompts === true) {
    return createAutomaticImageTargetPromptRequests(draft, imageTargets, {
      singleImagePerTarget: source.singleImagePerTarget === true,
      targetPromptStartIndexByTarget: normalizeTargetPromptStartIndexByTarget(source.targetPromptStartIndexByTarget),
    })
  }
  const targetById = new Map(imageTargets.map((target) => [target.nodeId, target]))
  return normalizeImageTargetPromptInputs(source.targetPrompts).map((item) => {
    const target = targetById.get(item.targetNodeId)
    if (!target) {
      throw new Error(`Image request references unknown image target: ${item.targetNodeId}`)
    }
    return { target, prompt: item.prompt.trim(), targetIndex: item.targetIndex }
  })
}

function createAutomaticImageTargetPromptRequests(
  draft: CharacterCardDraft,
  imageTargets: AgentTargetContext[],
  options: {
    singleImagePerTarget?: boolean
    targetPromptStartIndexByTarget?: Map<string, number>
  } = {}
): Array<{ target: AgentTargetContext; prompt: string; targetIndex: number }> {
  const profile = createCharacterImageProfile(draft)
  return imageTargets.flatMap((target) => {
    const startIndex = options.targetPromptStartIndexByTarget?.get(target.nodeId) ?? 1
    if (options.singleImagePerTarget) {
      return [{
        target,
        targetIndex: startIndex,
        prompt: createDirectedAutomaticImagePrompt(target, profile, startIndex, 1),
      }]
    }
    const controls = target.imageControls.length ? target.imageControls : [undefined]
    return controls.flatMap((control) => {
      const count = Math.max(1, Math.floor(control?.targetImageCount ?? 1))
      return Array.from({ length: count }, (_, index) => ({
        target,
        targetIndex: startIndex + index,
        prompt: createDirectedAutomaticImagePrompt(target, profile, startIndex + index, count),
      }))
    })
  })
}

function normalizeDraftInput(input: unknown): CharacterCardDraft {
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Partial<CharacterCardDraft>
    : {}
  const fields = source.fields && typeof source.fields === 'object' && !Array.isArray(source.fields)
    ? source.fields as Record<string, unknown>
    : {}
  return {
    id: typeof source.id === 'string' ? source.id : 'auto-draft',
    fields,
    imagePrompts: Array.isArray(source.imagePrompts) ? source.imagePrompts.filter((item): item is string => typeof item === 'string') : [],
    imageArtifactIds: Array.isArray(source.imageArtifactIds) ? source.imageArtifactIds.filter((item): item is string => typeof item === 'string') : [],
    imageTargetArtifactIds: source.imageTargetArtifactIds && typeof source.imageTargetArtifactIds === 'object' && !Array.isArray(source.imageTargetArtifactIds)
      ? Object.fromEntries(Object.entries(source.imageTargetArtifactIds).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [],
      ]))
      : {},
    notes: Array.isArray(source.notes) ? source.notes.filter((item): item is string => typeof item === 'string') : [],
    missing: Array.isArray(source.missing) ? source.missing.filter((item): item is string => typeof item === 'string') : [],
    updatedAt: typeof source.updatedAt === 'number' ? source.updatedAt : Date.now(),
  }
}

function normalizeReferenceImagesByTarget(value: unknown): Map<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return new Map()
  }
  return new Map(
    Object.entries(value as Record<string, unknown>).flatMap(([targetNodeId, references]) => {
      const normalized = Array.isArray(references)
        ? references.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean)
        : []
      return normalized.length ? [[targetNodeId, normalized] as const] : []
    })
  )
}

function createImageGenerationPromptRequests(
  requests: Array<{ target: AgentTargetContext; prompt: string; targetIndex?: number }>,
  draft: CharacterCardDraft
): Array<{ target: AgentTargetContext; targetIndex: number; imageRole: string; prompt: string }> {
  const targetPromptCounts = new Map<string, number>()
  const profile = createCharacterImageProfile(draft)
  return requests.map((request) => {
    const targetRole = request.target.imageRole
    if (!targetRole) {
      throw new Error(`Image target ${request.target.nodeId} is missing imageRole`)
    }
    const targetIndex = request.targetIndex && Number.isFinite(request.targetIndex) && request.targetIndex > 0
      ? Math.floor(request.targetIndex)
      : (targetPromptCounts.get(request.target.nodeId) ?? 0) + 1
    targetPromptCounts.set(request.target.nodeId, targetIndex)
    const control = getImageControlForPromptIndex(request.target.imageControls, targetIndex)
    return {
      target: request.target,
      targetIndex,
      imageRole: targetRole,
      prompt: buildDirectedImageGenerationPrompt({
        target: request.target,
        imageRole: targetRole,
        promptText: request.prompt,
        control,
        profile,
        targetIndex,
      }),
    }
  }).sort((left, right) => getDirectedImageRolePriority(left.imageRole) - getDirectedImageRolePriority(right.imageRole))
}

function resolveReferenceImagesForPrompt(
  prompt: { target: AgentTargetContext },
  referenceImagesByTarget: Map<string, string[]>
): string[] {
  return referenceImagesByTarget.get(prompt.target.nodeId) ?? []
}

function appendRerollInstruction(prompt: string, value: unknown): string {
  const instruction = typeof value === 'string' ? value.trim() : ''
  if (!instruction) {
    return prompt
  }
  return [
    prompt,
    'Scoped reroll instruction:',
    instruction,
    'Keep the workflow target, image role, reference-image dependencies, and stable character identity intact while applying this instruction.',
  ].join('\n\n')
}

function imageSizeForPrompt(prompt: {
  target: AgentTargetContext
  imageRole: string
  targetIndex: number
}): string | undefined {
  if (prompt.imageRole === 'avatar') {
    return imageSizeFromAspectRatio(AVATAR_IMAGE_ASPECT_RATIO)
  }
  if (prompt.imageRole === 'character-overview-sheet') {
    return imageSizeFromAspectRatio(OVERVIEW_SHEET_ASPECT_RATIO)
  }
  const control = getImageControlForPromptIndex(prompt.target.imageControls, prompt.targetIndex)
  const aspectRatio = control?.aspectRatio || '1:1'
  return imageSizeFromAspectRatio(aspectRatio)
}

function imageSizeFromAspectRatio(aspectRatio: string): string {
  const sizes: Record<string, string> = {
    '1:1': '2048x2048',
    '2:3': '1365x2048',
    '3:4': '1536x2048',
    '4:5': '1638x2048',
    '16:9': '1920x1088',
    '9:16': '1440x2560',
  }
  return sizes[aspectRatio] ?? '2048x2048'
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
      targetIndex: positiveIntegerField(record.targetIndex),
    }
  })
}

function normalizeTargetPromptStartIndexByTarget(value: unknown): Map<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return new Map()
  }
  return new Map(
    Object.entries(value as Record<string, unknown>).flatMap(([targetNodeId, index]) => {
      const normalized = positiveIntegerField(index)
      return normalized ? [[targetNodeId, normalized] as const] : []
    })
  )
}

function positiveIntegerField(value: unknown): number | undefined {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : undefined
}

function createImageAttemptArtifact(
  runId: string,
  candidateId: string,
  sourceNodeId: string,
  base: Record<string, unknown>,
  result: Record<string, unknown>
): CharacterAgentArtifact {
  const status = typeof result.status === 'string' ? result.status : 'unknown'
  return createToolArtifact(
    runId,
    candidateId,
    'image-attempt',
    status === 'failed' ? 'Image Attempt Failed' : 'Image Attempt',
    {
      ...base,
      ...result,
      status,
    },
    sourceNodeId
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
    createToolArtifact(runId, candidateId, 'image-prompt', 'Appearance Prompt', data.appearancePrompt, context.capabilities.imageModels[0]?.nodeId ?? defaultSourceNodeId),
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
  const dataRecord = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
  const explicitId = typeof dataRecord.attemptId === 'string'
    ? dataRecord.attemptId
    : ''
  return {
    id: explicitId || `${candidateId}:${kind}`,
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

function formatImageGenerationError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }
  const details = collectErrorDetails((error as Error & { cause?: unknown }).cause)
  return [error.message, details].filter(Boolean).join(': ')
}

function collectErrorDetails(value: unknown): string {
  if (!value) {
    return ''
  }
  if (value instanceof Error) {
    return [value.name, value.message, collectErrorDetails((value as Error & { cause?: unknown }).cause)].filter(Boolean).join(': ')
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return [
      typeof record.code === 'string' ? record.code : '',
      typeof record.reason === 'string' ? record.reason : '',
      typeof record.message === 'string' ? record.message : '',
    ].filter(Boolean).join(': ')
  }
  return String(value)
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
