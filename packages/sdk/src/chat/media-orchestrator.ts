/**
 * Shared media orchestration helpers for roleplay chat turns.
 */
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

export interface RoleplayMediaCharacter {
  id?: string
  roleCard?: Record<string, unknown>
  displayName?: RoleplayMediaLocalizedText
  description?: RoleplayMediaLocalizedText
  story?: RoleplayMediaLocalizedText
  background?: RoleplayMediaLocalizedText
  firstMessage?: RoleplayMediaLocalizedText
  avatarImage?: string
  bodyImage?: string
  tag?: Partial<Record<RoleplayMediaLanguage, string[]>>
}

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
          ? '只有当用户明确要求图片、照片、自拍、外观或视觉画面时，才可以在回复末尾追加 <media_intent>{"image":{"prompt":"简洁英文生图提示词"}}</media_intent>。prompt 只描述画面，不要写 UI、标题、字幕或解释。'
          : '当用户明确要求图片，或本轮出现强画面感的角色扮演节点并且一张图会自然推进体验时，可以在回复末尾追加 <media_intent>{"image":{"prompt":"简洁英文生图提示词"}}</media_intent>。不要频繁发送，prompt 只描述画面。'
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
        ? 'Only when the user explicitly asks for an image, photo, selfie, appearance, or visual scene, append <media_intent>{"image":{"prompt":"concise English image prompt"}}</media_intent> at the end. The prompt describes only the image, not UI, titles, captions, or explanations.'
        : 'When the user explicitly asks for an image, or this turn has a strong visual roleplay beat where a visual would naturally improve the experience, append <media_intent>{"image":{"prompt":"concise English image prompt"}}</media_intent> at the end. Do not send images frequently; the prompt describes only the image.'
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
        prompt: modelPrompt || buildRoleplayImagePrompt({
          userText: input.userText,
          assistantText: input.assistantText,
          language: input.language,
          character: input.character,
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

export function buildRoleplayImagePrompt(options: {
  userText: string
  assistantText: string
  language: RoleplayMediaLanguage
  character?: RoleplayMediaCharacter
  sceneState?: Record<string, unknown>
}): string {
  const characterName = localizeRoleplayText(options.character?.displayName, options.language)
  const description = compactLine(localizeRoleplayText(options.character?.description, options.language))
  const background = compactLine(localizeRoleplayText(options.character?.background, options.language))
  const story = compactLine(localizeRoleplayText(options.character?.story, options.language))
  const tags = options.character?.tag?.[options.language] ?? options.character?.tag?.['zh-CN'] ?? []
  const scene = summarizeSceneState(options.sceneState, options.language)
  const userMoment = compactLine(options.userText)
  const assistantMoment = compactLine(options.assistantText)
  return [
    'Create one immersive roleplay still image.',
    characterName ? `Main character: ${characterName}.` : '',
    description ? `Character identity: ${description}.` : '',
    background ? `Background: ${background}.` : '',
    story ? `Narrative tone: ${story}.` : '',
    tags.length ? `Style and traits: ${tags.slice(0, 8).join(', ')}.` : '',
    scene ? `Current scene state: ${scene}.` : '',
    userMoment ? `User beat: ${userMoment}.` : '',
    assistantMoment ? `Assistant beat to visualize: ${assistantMoment}.` : '',
    'Preserve character identity from any reference images. Show the current emotional beat, body language, environment, lighting, and composition. No UI, text, captions, watermarks, speech bubbles, panels, borders, or logos.',
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

function localizeRoleplayText(value: RoleplayMediaLocalizedText | undefined, language: RoleplayMediaLanguage): string {
  if (!value) {
    return ''
  }
  return value[language] || value['zh-CN'] || value['en-US'] || ''
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
