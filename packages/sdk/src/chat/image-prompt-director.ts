/**
 * Builds LLM-directed image prompts for roleplay chat media generation.
 */
import type { CharacterProfile, CharacterProfileLocalizedText } from '../character-profile/index.js'
import { localizeCharacterProfileText } from '../character-profile/index.js'
import type {
  RoleplayMediaLanguage,
  RoleplayMediaRuntimeMessage,
} from './media-orchestrator.js'

export interface ChatImagePromptControl {
  purpose?: string
  clothing?: string
  lighting?: string
  camera?: string
  mood?: string
  style?: string
}

export interface ChatImagePromptDirectorInput {
  language: RoleplayMediaLanguage
  baseScene: string
  manualDirection?: string
  control?: ChatImagePromptControl
  userText?: string
  assistantText?: string
  character?: CharacterProfile
  sceneState?: Record<string, unknown>
  recentMessages?: RoleplayMediaRuntimeMessage[]
  lastImagePrompt?: string
  referenceImages?: string[]
}

export interface ChatImagePromptDirectorRequest {
  systemPrompt: string
  userPrompt: string
  options: Record<string, unknown>
}

export interface ChatDirectedImagePrompt {
  prompt: string
  rawResponse: string
  sourcePrompt: string
}

export type ChatImagePromptTextGenerator = (
  request: ChatImagePromptDirectorRequest
) => Promise<string>

const CHAT_IMAGE_PROMPT_DIRECTOR_SYSTEM_PROMPT = [
  'You are the image-prompt director for a roleplay chat product.',
  'Turn structured conversation context into one final prompt for an image generation model.',
  '',
  'Output contract:',
  '- Output only the final image prompt as plain text.',
  '- Do not output markdown, JSON, XML, headings, comments, refusals, warnings, or analysis.',
  '- Use dense visual phrases. Keep it specific, drawable, and free of UI/text/watermark/caption instructions.',
  '- Prefer English image-prompt phrasing, but preserve proper names and user-specified terms when useful.',
  '',
  'Visual direction:',
  '- Preserve the character identity from supplied reference images. If no references are available, strongly describe the identity from the character profile.',
  '- User manual direction and explicit visual controls override inferred context.',
  '- Use recent dialogue only to infer the current visual beat, emotion, location, activity, clothing, and relationship energy. Do not quote the dialogue.',
  '- Keep outfit and scene continuity from the last image prompt unless the current request or controls explicitly change them.',
  '- Include subject, pose/body language, expression, clothing, lighting, environment, camera/framing, mood, and style.',
  '- For roleplay images, make the picture feel like the user is present in the scene when the context supports it: POV cues, eye contact, shared objects, or an action directed toward the viewer.',
  '- Sensual or intimate visual appeal should be expressed concretely through gaze, pose, fabric, light, body line, scene objects, and composition when the context asks for it.',
].join('\n')

export function createChatImagePromptDirectorRequest(
  input: ChatImagePromptDirectorInput
): ChatImagePromptDirectorRequest {
  return {
    systemPrompt: CHAT_IMAGE_PROMPT_DIRECTOR_SYSTEM_PROMPT,
    userPrompt: buildChatImagePromptDirectorUserPrompt(input),
    options: {
      temperature: 0.62,
      top_p: 0.9,
      max_tokens: 520,
    },
  }
}

export async function directChatImagePrompt(
  input: ChatImagePromptDirectorInput,
  generateText: ChatImagePromptTextGenerator
): Promise<ChatDirectedImagePrompt> {
  const request = createChatImagePromptDirectorRequest(input)
  const rawResponse = await generateText(request)
  const prompt = normalizeDirectedPromptOutput(rawResponse)
  if (!prompt) {
    throw new Error('Image prompt director returned an empty prompt')
  }
  return {
    prompt,
    rawResponse,
    sourcePrompt: request.userPrompt,
  }
}

export function buildChatImagePromptDirectorUserPrompt(input: ChatImagePromptDirectorInput): string {
  const language = input.language === 'en-US' ? 'en-US' : 'zh-CN'
  const character = input.character ? summarizeCharacter(input.character, language) : {}
  const controls = normalizeImagePromptControl(input.control)
  const recentDialogue = summarizeRecentMessages(input.recentMessages, language)
  const referenceCount = Array.isArray(input.referenceImages) ? input.referenceImages.filter(Boolean).length : 0

  return [
    '<chat_image_prompt_request>',
    tag('language', language),
    tag('base_scene', compactText(input.baseScene, 1200)),
    tag('manual_direction', compactText(input.manualDirection, 600)),
    tag('visual_controls_json', JSON.stringify(controls)),
    tag('user_message', compactText(input.userText, 700)),
    tag('assistant_reply', compactText(input.assistantText, 900)),
    tag('character_json', JSON.stringify(character)),
    tag('scene_state_json', JSON.stringify(compactJson(input.sceneState) ?? {})),
    tag('recent_dialogue', recentDialogue),
    tag('last_image_prompt', compactText(input.lastImagePrompt, 900)),
    tag('reference_image_count', String(referenceCount)),
    '<task>',
    'Create the final image-generation prompt now.',
    'Use manual_direction and visual_controls_json as the strongest current direction.',
    'If manual_direction is empty, infer the most natural image from base_scene, assistant_reply, user_message, scene_state, and recent_dialogue.',
    'If last_image_prompt exists, preserve clothing and room continuity unless the current direction changes them.',
    'If reference_image_count is greater than 0, rely on references for identity and avoid restating every physical trait unless it matters for generation.',
    'If reference_image_count is 0, include enough character identity details from character_json to generate the role consistently.',
    '</task>',
    '</chat_image_prompt_request>',
  ].join('\n')
}

export function normalizeDirectedPromptOutput(value: string): string {
  return String(value || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:text|prompt)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^\s*(final prompt|prompt)\s*:\s*/i, '')
    .trim()
}

function summarizeCharacter(character: CharacterProfile, language: RoleplayMediaLanguage): Record<string, unknown> {
  const roleCard = character.roleCard ?? {}
  return compactRecord({
    id: character.id,
    name: localizeCharacterProfileText(character.displayName, language),
    description: localizeCharacterProfileText(character.description, language),
    story: localizeCharacterProfileText(character.story, language),
    background: localizeCharacterProfileText(character.background, language),
    scene: compactJson(character.scene),
    tags: character.tag?.[language] ?? character.tag?.['zh-CN'] ?? [],
    appearance: textField(roleCard.appearance),
    appearancePrompt: textField(roleCard.appearancePrompt),
    personality: textField(roleCard.personality),
    scenario: textField(roleCard.scenario),
    worldContext: textField(roleCard.worldContext),
    assets: (character.assets ?? [])
      .filter((asset) => asset.kind === 'avatar' || asset.kind === 'body' || asset.kind === 'generated-image')
      .slice(0, 6)
      .map((asset) => ({
        kind: asset.kind,
        role: asset.role,
        metadata: compactJson(asset.metadata),
      })),
  })
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  const compacted = compactJson(value)
  return compacted && typeof compacted === 'object' && !Array.isArray(compacted)
    ? compacted as Record<string, unknown>
    : {}
}

function summarizeRecentMessages(
  messages: RoleplayMediaRuntimeMessage[] | undefined,
  language: RoleplayMediaLanguage
): string {
  if (!Array.isArray(messages) || !messages.length) {
    return ''
  }
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-8)
    .map((message) => {
      const text = localizeRuntimeMessageText(message.text, language)
      return text ? `${message.role}: ${compactText(text, 260)}` : ''
    })
    .filter(Boolean)
    .join('\n')
}

function normalizeImagePromptControl(control: ChatImagePromptControl | undefined): ChatImagePromptControl {
  return {
    purpose: compactText(control?.purpose, 180),
    clothing: compactText(control?.clothing, 180),
    lighting: compactText(control?.lighting, 180),
    camera: compactText(control?.camera, 180),
    mood: compactText(control?.mood, 180),
    style: compactText(control?.style, 180),
  }
}

function localizeRuntimeMessageText(
  value: Record<RoleplayMediaLanguage, string> | undefined,
  language: RoleplayMediaLanguage
): string {
  if (!value) {
    return ''
  }
  return value[language] || value['zh-CN'] || value['en-US'] || ''
}

function textField(value: unknown): string {
  if (typeof value === 'string') {
    return compactText(value, 900)
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const localized = value as Partial<CharacterProfileLocalizedText>
    return compactText(localized['zh-CN'] || localized['en-US'] || '', 900)
  }
  return ''
}

function tag(name: string, value: string): string {
  return `<${name}>${escapeXml(value)}</${name}>`
}

function compactText(value: unknown, max = 520): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function compactJson(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return undefined
  }
  if (typeof value === 'string') {
    return compactText(value, 520)
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, depth > 1 ? 4 : 10)
      .map((item) => compactJson(item, depth + 1))
      .filter((item) => item !== undefined)
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, depth > 1 ? 8 : 24)) {
      const compacted = compactJson(child, depth + 1)
      if (compacted !== undefined && String(compacted).trim() !== '') {
        output[key] = compacted
      }
    }
    return output
  }
  return undefined
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
