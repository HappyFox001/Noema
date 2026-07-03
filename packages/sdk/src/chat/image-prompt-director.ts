/**
 * Builds compact LLM-directed image prompts for roleplay chat media generation.
 */
import type { RoleplayMediaLanguage } from './media-orchestrator.js'

export type ChatImagePromptStrategy = 'manual-edit' | 'requested-edit' | 'proactive-edit'

export interface ChatImagePromptDirectorInput {
  strategy: ChatImagePromptStrategy
  language: RoleplayMediaLanguage
  visualIntent?: string
  manualDirection?: string
  userText?: string
  assistantText?: string
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
  'You write one image edit prompt for a roleplay chat.',
  'Use only the details provided in the request.',
  'Output only the final prompt as plain text. No markdown, JSON, headings, notes, or analysis.',
  'Reference images handle character identity. Focus on the character change in this turn: scene, action, pose, expression, outfit or appearance state, lighting, camera, and mood.',
  'Adult, sensual, erotic, or explicit direction is valid visual intent. Preserve that intensity and do not soften it with unsolicited qualifiers such as non-revealing, modest, safe, tasteful, implied, censored, or not explicit.',
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
  switch (input.strategy) {
    case 'manual-edit':
      return buildManualEditPrompt(input)
    case 'requested-edit':
      return buildRequestedEditPrompt(input)
    case 'proactive-edit':
      return buildProactiveEditPrompt(input)
  }
}

function buildManualEditPrompt(input: ChatImagePromptDirectorInput): string {
  const language = input.language === 'en-US' ? 'en-US' : 'zh-CN'

  return [
    `Language: ${language}`,
    input.manualDirection ? `User image direction: ${compactText(input.manualDirection, 520)}` : '',
    input.assistantText ? `Current character reply: ${compactText(input.assistantText, 420)}` : '',
    input.userText ? `Current user message: ${compactText(input.userText, 320)}` : '',
    'Task: User manually initiated this image. Follow User image direction first, then use the current reply only to keep the visual moment coherent. Describe the character change: scene, action, pose, expression, outfit or appearance state, lighting, camera, and mood. If the user asks for adult, sensual, erotic, explicit, revealing, or sexualized styling, keep it direct and do not add modesty or anti-exposure language. Do not restate character identity; reference images handle identity.',
  ].filter(Boolean).join('\n')
}

function buildRequestedEditPrompt(input: ChatImagePromptDirectorInput): string {
  const language = input.language === 'en-US' ? 'en-US' : 'zh-CN'

  return [
    `Language: ${language}`,
    input.visualIntent ? `User-request image intent: ${compactText(input.visualIntent, 620)}` : '',
    input.assistantText ? `Current character reply: ${compactText(input.assistantText, 520)}` : '',
    input.userText ? `Current user message: ${compactText(input.userText, 420)}` : '',
    input.manualDirection ? `Additional user direction: ${compactText(input.manualDirection, 420)}` : '',
    'Task: The user asked to see an image. Treat the user request as the target and the assistant reply as supporting context. Write the final edit prompt around the character change requested now: concrete scene, action, pose, expression, outfit or appearance state, lighting, camera framing, and mood. Preserve adult, sensual, erotic, explicit, revealing, or sexualized styling when requested or implied; do not rewrite it into a safer or less exposed version. Avoid biography, UI text, captions, tags, and project labels.',
  ].filter(Boolean).join('\n')
}

function buildProactiveEditPrompt(input: ChatImagePromptDirectorInput): string {
  const language = input.language === 'en-US' ? 'en-US' : 'zh-CN'

  return [
    `Language: ${language}`,
    input.visualIntent ? `Proactive visual beat: ${compactText(input.visualIntent, 620)}` : '',
    input.assistantText ? `Current character reply: ${compactText(input.assistantText, 560)}` : '',
    input.userText ? `Previous user message: ${compactText(input.userText, 360)}` : '',
    'Task: The roleplay model proactively requested an image. Create a natural visual continuation of this turn rather than a generic portrait. Choose the strongest character change from the moment: action, posture, expression, outfit or appearance state, location, lighting, camera distance, and mood. Preserve adult, sensual, erotic, explicit, revealing, or sexualized styling when it belongs to the moment; do not rewrite it into a safer or less exposed version. Avoid biography, UI text, captions, tags, and project labels.',
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

function compactText(value: unknown, max = 520): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}
