/**
 * Shared media orchestration helpers for roleplay chat turns.
 */
import type { CharacterProfile } from '../character-profile/index.js'

export type RoleplayMediaLanguage = 'zh-CN' | 'en-US'
export type RoleplayMediaLocalizedText = Record<RoleplayMediaLanguage, string>

export interface RoleplayMediaRuntimeMessage {
  id: string
  role: 'system' | 'user' | 'assistant'
  text: RoleplayMediaLocalizedText
  media?: Array<{
    kind: 'image' | 'video' | 'audio'
    origin?: 'user' | 'assistant' | 'tool' | 'generated' | 'external'
  }>
  state?: unknown
}

export type RoleplayImageGenerationMode = 'off' | 'manual' | 'requested' | 'proactive'
export type RoleplayVoiceGenerationMode = 'off' | 'manual' | 'requested' | 'auto'
export type RoleplayImageReferenceMode = 'none' | 'character'
export type RoleplayMediaPersistenceMode = 'turn' | 'permanent'

export interface RoleplayMediaPolicy {
  imageMode: RoleplayImageGenerationMode
  voiceMode: RoleplayVoiceGenerationMode
  imageReferenceMode: RoleplayImageReferenceMode
  imagePersistence: RoleplayMediaPersistenceMode
  voicePersistence: RoleplayMediaPersistenceMode
}

export type RoleplayMediaCharacter = CharacterProfile

export interface RoleplayMediaIntent {
  image?: boolean | {
    prompt?: string
    mode?: string
    permanent?: boolean
  }
  audio?: boolean | {
    text?: string
    permanent?: boolean
  }
}

export interface RoleplayMediaDecisionInput {
  userText: string
  assistantText: string
  language: RoleplayMediaLanguage
  policy: RoleplayMediaPolicy
  intent?: RoleplayMediaIntent | null
  character?: RoleplayMediaCharacter
  sceneState?: Record<string, unknown>
  recentMessages?: RoleplayMediaRuntimeMessage[]
  random?: () => number
}

export interface RoleplayImageDispatch {
  prompt: string
  trigger: 'manual' | 'model' | 'request'
  permanent: boolean
  reason: string
  referenceImages: string[]
}

export interface RoleplayAudioDispatch {
  text: string
  trigger: 'manual' | 'model' | 'request' | 'auto'
  permanent: boolean
  reason: string
}

export interface RoleplayMediaDecision {
  image?: RoleplayImageDispatch
  audio?: RoleplayAudioDispatch
}

export interface RoleplayMediaIntentExtraction {
  text: string
  intent: RoleplayMediaIntent | null
}

const IMAGE_REQUEST_PATTERN = /(画|图|图片|照片|插画|生图|配图|截图|视觉|看看|看一下|appearance|image|picture|photo|draw|illustrat|visual|snapshot|render)/i
const VOICE_REQUEST_PATTERN = /(语音|音频|声音|说出来|念出来|voice|audio|speak|say it|read it)/i

export function extractRoleplayMediaIntent(value: string): RoleplayMediaIntentExtraction {
  const source = String(value || '')
  const match = source.match(/<media_intent>\s*([\s\S]*?)\s*<\/media_intent>/i)
  if (!match) {
    return { text: source.trim(), intent: null }
  }
  const text = source.replace(match[0], '').trim()
  try {
    const parsed = JSON.parse(match[1]) as RoleplayMediaIntent
    return { text, intent: normalizeRoleplayMediaIntent(parsed) }
  } catch {
    return { text, intent: null }
  }
}

export function buildRoleplayMediaPolicyPrompt(policy: RoleplayMediaPolicy, language: RoleplayMediaLanguage): string {
  const normalized = normalizeRoleplayMediaPolicy(policy)
  const imageIntentEnabled = normalized.imageMode === 'requested' || normalized.imageMode === 'proactive'
  const voiceIntentEnabled = normalized.voiceMode === 'requested' || normalized.voiceMode === 'auto'
  const imageManual = normalized.imageMode === 'manual'
  const voiceManual = normalized.voiceMode === 'manual'
  const imageOff = normalized.imageMode === 'off'
  const voiceOff = normalized.voiceMode === 'off'
  if (imageOff && voiceOff) {
    return ''
  }
  if (language === 'zh-CN') {
    return [
      '<media_policy>',
      imageIntentEnabled
        ? normalized.imageMode === 'requested'
          ? '只有当用户明确要求图片、照片、自拍、外观或视觉画面时，才可以在回复末尾追加 <media_intent>{"image":{"prompt":"简短画面意图"}}</media_intent>。prompt 写用户想看的角色变化核心：场景、动作、姿态、表情、服饰或外观状态、光线和氛围；成人、性感、情色、直接成人、暴露或性化风格如果属于用户请求，就直接保留，不要自动改成不暴露、安全、含蓄或弱化版本；不要写完整生图提示词、UI、标题、字幕或解释。系统会再由图像导演生成最终 edit 提示词。'
          : '当用户明确要求图片，或本轮出现强画面感的角色扮演节点并且一张图会自然推进体验时，可以在回复末尾追加 <media_intent>{"image":{"prompt":"简短画面意图"}}</media_intent>。不要频繁发送；prompt 写这一轮角色变化的视觉核心：动作、姿态、表情、服饰或外观状态、位置、光线和氛围。成人、性感、情色、直接成人、暴露或性化风格如果属于当前氛围，就直接保留，不要自动改成不暴露、安全、含蓄或弱化版本。最终 edit 提示词由系统图像导演生成。'
        : imageManual
          ? '图片由用户通过界面按钮手动生成；不要主动追加 image media_intent。'
          : '不要主动请求图片生成。',
      voiceIntentEnabled
        ? normalized.voiceMode === 'requested'
          ? '只有当用户明确要求语音、声音、朗读或音频时，才可以在同一个 media_intent 中加入 "audio":true，或 {"audio":{"text":"要朗读的干净文本"}}。'
          : '系统会为每条角色回复自动生成语音；一般不要追加 audio media_intent。只有当你希望语音朗读文本不同于可见回复时，才加入 {"audio":{"text":"要朗读的干净文本"}}。'
        : voiceManual
          ? '语音由用户通过界面按钮手动生成；不要主动追加 audio media_intent。'
          : '不要主动请求语音生成。',
      'media_intent 只能放在回复末尾，并且不要在正常可见文本中解释这个标签。',
      '</media_policy>',
    ].join('\n')
  }
  return [
    '<media_policy>',
    imageIntentEnabled
      ? normalized.imageMode === 'requested'
        ? 'Only when the user explicitly asks for an image, photo, selfie, appearance, or visual scene, append <media_intent>{"image":{"prompt":"short visual intent"}}</media_intent> at the end. The prompt should capture the requested character change: scene, action, pose, expression, outfit or appearance state, lighting, and mood. If adult, sensual, erotic, explicit, revealing, or sexualized styling belongs to the user request, preserve it directly and do not rewrite it into a non-revealing, safe, implied, or softened version. Do not write the final image prompt, UI, titles, captions, or explanations; the system image director will create the final edit prompt.'
        : 'When the user explicitly asks for an image, or this turn has a strong visual roleplay beat where a visual would naturally improve the experience, append <media_intent>{"image":{"prompt":"short visual intent"}}</media_intent> at the end. Do not send images frequently; the prompt should capture the character change in this turn: action, posture, expression, outfit or appearance state, location, lighting, and mood. If adult, sensual, erotic, explicit, revealing, or sexualized styling belongs to the moment, preserve it directly and do not rewrite it into a non-revealing, safe, implied, or softened version. The system image director will create the final edit prompt.'
      : imageManual
        ? 'Images are generated manually by the user through the UI button; do not append image media_intent.'
        : 'Do not request image generation.',
    voiceIntentEnabled
      ? normalized.voiceMode === 'requested'
        ? 'Only when the user explicitly asks for voice, sound, spoken playback, or audio, include "audio":true in the same media_intent, or {"audio":{"text":"clean text to speak"}}.'
        : 'The system will synthesize voice for every character reply automatically. Usually do not append audio media_intent; only include {"audio":{"text":"clean text to speak"}} when the spoken text should differ from the visible reply.'
      : voiceManual
        ? 'Voice is generated manually by the user through the UI button; do not append audio media_intent.'
        : 'Do not request voice generation.',
    'media_intent must appear only at the end, and must not be explained in visible text.',
    '</media_policy>',
  ].join('\n')
}

export function decideRoleplayMediaDispatch(input: RoleplayMediaDecisionInput): RoleplayMediaDecision {
  const policy = normalizeRoleplayMediaPolicy(input.policy)
  const imageIntent = normalizeImageIntent(input.intent?.image)
  const audioIntent = normalizeAudioIntent(input.intent?.audio)
  const decision: RoleplayMediaDecision = {}

  if (policy.voiceMode !== 'off' && policy.voiceMode !== 'manual') {
    const requestedVoice = Boolean(audioIntent) || VOICE_REQUEST_PATTERN.test(input.userText)
    if (policy.voiceMode === 'auto' || (policy.voiceMode === 'requested' && requestedVoice)) {
      decision.audio = {
        text: normalizeSpeechText(audioIntent?.text || input.assistantText),
        trigger: audioIntent ? 'model' : policy.voiceMode === 'auto' ? 'auto' : 'request',
        permanent: audioIntent?.permanent ?? policy.voicePersistence === 'permanent',
        reason: audioIntent ? 'model_media_intent' : policy.voiceMode === 'auto' ? 'voice_every_reply' : 'user_requested_voice',
      }
    }
  }

  if (policy.imageMode !== 'off' && policy.imageMode !== 'manual') {
    const modelPrompt = typeof imageIntent?.prompt === 'string' ? imageIntent.prompt.trim() : ''
    const userRequestedImage = IMAGE_REQUEST_PATTERN.test(input.userText)
    const shouldGenerate = Boolean(imageIntent) || userRequestedImage
    if (shouldGenerate) {
      decision.image = {
        prompt: modelPrompt || buildRoleplayImageSceneSeed({
          userText: input.userText,
          assistantText: input.assistantText,
          language: input.language,
          sceneState: input.sceneState,
        }),
        trigger: imageIntent ? 'model' : 'request',
        permanent: imageIntent?.permanent ?? policy.imagePersistence === 'permanent',
        reason: imageIntent ? 'model_media_intent' : 'user_requested_image',
        referenceImages: policy.imageReferenceMode === 'character'
          ? selectRoleplayReferenceImages(input.character)
          : [],
      }
    }
  }

  if (decision.audio && !decision.audio.text) {
    delete decision.audio
  }
  return decision
}

export function buildRoleplayImageSceneSeed(options: {
  userText: string
  assistantText: string
  language: RoleplayMediaLanguage
  sceneState?: Record<string, unknown>
}): string {
  const scene = summarizeSceneState(options.sceneState, options.language)
  const userMoment = compactLine(options.userText)
  const assistantMoment = compactLine(options.assistantText)
  return [
    assistantMoment ? `Character turn change: ${assistantMoment}` : '',
    userMoment ? `User request or preceding beat: ${userMoment}` : '',
    scene ? `Current scene state: ${scene}` : '',
  ].filter(Boolean).join('\n')
}

export function selectRoleplayReferenceImages(character: RoleplayMediaCharacter | undefined): string[] {
  if (!character) {
    return []
  }
  return [character.avatarImage, character.bodyImage]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index)
    .slice(0, 4)
}

function normalizeRoleplayMediaPolicy(policy: RoleplayMediaPolicy): RoleplayMediaPolicy {
  return {
    imageMode: isImageMode(policy.imageMode) ? policy.imageMode : 'off',
    voiceMode: isVoiceMode(policy.voiceMode) ? policy.voiceMode : 'off',
    imageReferenceMode: policy.imageReferenceMode === 'none' ? 'none' : 'character',
    imagePersistence: policy.imagePersistence === 'permanent' ? 'permanent' : 'turn',
    voicePersistence: policy.voicePersistence === 'permanent' ? 'permanent' : 'turn',
  }
}

function normalizeRoleplayMediaIntent(intent: RoleplayMediaIntent): RoleplayMediaIntent {
  if (!intent || typeof intent !== 'object') {
    return {}
  }
  return {
    ...(intent.image !== undefined ? { image: normalizeImageIntent(intent.image) ?? false } : {}),
    ...(intent.audio !== undefined ? { audio: normalizeAudioIntent(intent.audio) ?? false } : {}),
  }
}

function normalizeImageIntent(value: RoleplayMediaIntent['image']): { prompt?: string; mode?: string; permanent?: boolean } | null {
  if (value === true) {
    return {}
  }
  if (!value || typeof value !== 'object') {
    return null
  }
  return {
    ...(typeof value.prompt === 'string' && value.prompt.trim() ? { prompt: value.prompt.trim() } : {}),
    ...(typeof value.mode === 'string' && value.mode.trim() ? { mode: value.mode.trim() } : {}),
    ...(typeof value.permanent === 'boolean' ? { permanent: value.permanent } : {}),
  }
}

function normalizeAudioIntent(value: RoleplayMediaIntent['audio']): { text?: string; permanent?: boolean } | null {
  if (value === true) {
    return {}
  }
  if (!value || typeof value !== 'object') {
    return null
  }
  return {
    ...(typeof value.text === 'string' && value.text.trim() ? { text: value.text.trim() } : {}),
    ...(typeof value.permanent === 'boolean' ? { permanent: value.permanent } : {}),
  }
}

function normalizeSpeechText(value: string): string {
  return String(value || '')
    .replace(/<scene_update>[\s\S]*?<\/scene_update>/gi, '')
    .replace(/<media_intent>[\s\S]*?<\/media_intent>/gi, '')
    .replace(/\{发送图片:[^}]*\}/g, '')
    .replace(/\{发送语音(?::[^}]*)?\}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1600)
}

function summarizeSceneState(sceneState: Record<string, unknown> | undefined, language: RoleplayMediaLanguage): string {
  if (!sceneState) {
    return ''
  }
  return Object.entries(sceneState)
    .map(([key, value]) => {
      const formatted = formatSceneValue(value, language)
      return formatted ? `${key}: ${formatted}` : ''
    })
    .filter(Boolean)
    .slice(0, 8)
    .join('; ')
}

function formatSceneValue(value: unknown, language: RoleplayMediaLanguage): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return compactLine(String(value))
  }
  if (Array.isArray(value)) {
    return value.map((item) => formatSceneValue(item, language)).filter(Boolean).slice(0, 4).join(', ')
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record[language] === 'string' || typeof record['zh-CN'] === 'string' || typeof record['en-US'] === 'string') {
      return compactLine(String(record[language] || record['zh-CN'] || record['en-US'] || ''))
    }
    return Object.entries(record)
      .map(([key, item]) => {
        const formatted = formatSceneValue(item, language)
        return formatted ? `${key} ${formatted}` : ''
      })
      .filter(Boolean)
      .slice(0, 4)
      .join(', ')
  }
  return ''
}

function compactLine(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 520)
}

function isImageMode(value: unknown): value is RoleplayImageGenerationMode {
  return value === 'off' || value === 'manual' || value === 'requested' || value === 'proactive'
}

function isVoiceMode(value: unknown): value is RoleplayVoiceGenerationMode {
  return value === 'off' || value === 'manual' || value === 'requested' || value === 'auto'
}
