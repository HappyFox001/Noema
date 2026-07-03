/**
 * Builds compact LLM-directed image prompts for roleplay chat media generation.
 */
import type { CharacterProfile, CharacterProfileLocalizedText } from '../character-profile/index.js'
import { localizeCharacterProfileText } from '../character-profile/index.js'
import type { RoleplayMediaLanguage } from './media-orchestrator.js'

export interface ChatImagePromptDirectorInput {
  strategy?: 'manual-edit' | 'contextual'
  language: RoleplayMediaLanguage
  baseScene?: string
  manualDirection?: string
  userText?: string
  assistantText?: string
  character?: CharacterProfile
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
  'You write one image-generation prompt for a roleplay chat.',
  'Use only the details provided in the request.',
  'Output only the final prompt as plain text. No markdown, JSON, headings, notes, or analysis.',
  'Keep it concise and drawable: subject, pose, expression, outfit, setting, lighting, camera, mood.',
].join('\n')

export function createChatImagePromptDirectorRequest(
  input: ChatImagePromptDirectorInput
): ChatImagePromptDirectorRequest {
  return {
    systemPrompt: CHAT_IMAGE_PROMPT_DIRECTOR_SYSTEM_PROMPT,
    userPrompt: buildChatImagePromptDirectorUserPrompt(input),
    options: {
      temperature: 0.62,
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
  if (input.strategy === 'manual-edit') {
    return buildManualEditPrompt(input)
  }
  return buildContextualPrompt(input)
}

function buildManualEditPrompt(input: ChatImagePromptDirectorInput): string {
  const language = input.language === 'en-US' ? 'en-US' : 'zh-CN'

  return [
    `Language: ${language}`,
    input.manualDirection ? `User image direction: ${compactText(input.manualDirection, 520)}` : '',
    input.assistantText ? `Current character reply: ${compactText(input.assistantText, 420)}` : '',
    input.userText ? `Current user message: ${compactText(input.userText, 320)}` : '',
    'Task: Write the final image edit prompt now. Follow User image direction first. Do not restate character identity; reference images handle identity.',
  ].filter(Boolean).join('\n')
}

function buildContextualPrompt(input: ChatImagePromptDirectorInput): string {
  const language = input.language === 'en-US' ? 'en-US' : 'zh-CN'
  const character = input.character ? summarizeCharacterVisual(input.character, language) : ''

  return [
    `Language: ${language}`,
    character ? `Character visual identity: ${character}` : '',
    input.manualDirection ? `User image direction: ${compactText(input.manualDirection, 420)}` : '',
    input.assistantText ? `Current character reply: ${compactText(input.assistantText, 520)}` : '',
    input.userText ? `Current user message: ${compactText(input.userText, 420)}` : '',
    input.baseScene ? `Base scene: ${compactText(input.baseScene, 520)}` : '',
    'Task: Write the final image prompt now. Use English image-prompt phrasing unless a proper name must stay as-is.',
  ].filter(Boolean).join('\n')
}

export function normalizeDirectedPromptOutput(value: string): string {
  return String(value || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:text|prompt)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^\s*(final prompt|prompt)\s*:\s*/i, '')
    .trim()
}

function summarizeCharacterVisual(character: CharacterProfile, language: RoleplayMediaLanguage): string {
  const roleCard = character.roleCard ?? {}
  return [
    localizeCharacterProfileText(character.displayName, language),
    textField(roleCard.appearancePrompt),
    textField(roleCard.appearance),
    localizeCharacterProfileText(character.description, language),
  ]
    .map((item) => compactText(item, 260))
    .filter(Boolean)
    .join('; ')
    .slice(0, 720)
}

function textField(value: unknown): string {
  if (typeof value === 'string') {
    return compactText(value, 520)
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const localized = value as Partial<CharacterProfileLocalizedText>
    return compactText(localized['zh-CN'] || localized['en-US'] || '', 520)
  }
  return ''
}

function compactText(value: unknown, max = 520): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}
