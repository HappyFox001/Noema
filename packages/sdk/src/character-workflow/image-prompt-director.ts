/**
 * Builds compact visual prompts for character image assets.
 */
import type {
  AgentImageGenerationControl,
  AgentTargetContext,
  CharacterCardDraft,
} from './agent-runtime.js'

export type CharacterImageStyleDomain = 'photoreal' | 'anime' | 'illustration' | 'stylized'

export interface CharacterImageProfile {
  name: string
  appearancePrompt: string
  appearance: string
  description: string
  scenario: string
  worldContext: string
  identityBible: string
  styleDomain: CharacterImageStyleDomain
}

export interface DirectedImagePromptInput {
  target: AgentTargetContext
  imageRole: string
  promptText: string
  control?: AgentImageGenerationControl
  profile: CharacterImageProfile
  targetIndex: number
}

export function createCharacterImageProfile(draft: CharacterCardDraft): CharacterImageProfile {
  const fields = draft.fields ?? {}
  const name = text(fields.name)
  const appearancePrompt = text(fields.appearancePrompt)
  const appearance = text(fields.appearance)
  const description = text(fields.description)
  const scenario = text(fields.scenario)
  const worldContext = text(fields.worldContext)
  const identityBible = compactJoin([
    appearancePrompt,
    name ? `character name ${name}` : '',
  ])
  if (!appearancePrompt) {
    throw new Error('Character image generation needs appearancePrompt before prompt direction')
  }
  return {
    name,
    appearancePrompt,
    appearance,
    description,
    scenario,
    worldContext,
    identityBible,
    styleDomain: inferStyleDomain(appearancePrompt),
  }
}

export function createDirectedAutomaticImagePrompt(
  target: AgentTargetContext,
  profile: CharacterImageProfile,
  index: number,
  count: number
): string {
  const role = target.imageRole || 'character-image'
  const variant = count > 1
    ? `variant ${index} of ${count}, same character identity, vary only expression, pose, framing, lighting, or scene detail`
    : ''
  return compactJoin([automaticRolePrompt(role, profile), variant])
}

export function buildDirectedImageGenerationPrompt(input: DirectedImagePromptInput): string {
  const role = input.imageRole || input.target.imageRole
  if (!role) {
    throw new Error(`Image target ${input.target.nodeId} is missing imageRole`)
  }
  const domain = resolveStyleDomain(input.control, input.profile)
  return compactJoin([
    role === 'avatar' ? input.profile.appearancePrompt : '',
    rolePromptForImage(role, domain, input.promptText, input.control, input.profile, input.targetIndex),
    stylePromptForImage(role, domain, input.control),
    qualityPromptForImage(role, domain),
  ])
}

export function getDirectedImageRolePriority(imageRole: string): number {
  const priorities: Record<string, number> = {
    avatar: 0,
    'character-overview-sheet': 1,
    'hero-cover': 2,
    'opening-moment': 3,
    'story-moment': 4,
    'relationship-moment': 5,
    expression: 6,
    'outfit-detail': 7,
    'world-context': 8,
  }
  return priorities[imageRole] ?? 20
}

function automaticRolePrompt(role: string, profile: CharacterImageProfile): string {
  const prompts: Record<string, string> = {
    avatar: 'canonical avatar master portrait, single subject, one clear unobstructed face, upper-body or half-body framing, looking at viewer, calm natural expression, simple clean background, identity reference image for later assets',
    'character-overview-sheet': 'same character as avatar reference, complete production character overview sheet, full-body front view, full-body back view, side or three-quarter view, main portrait crop, expression callouts, eye close-up, nose and mouth close-up, hairstyle detail, hands, legs, hips and rear silhouette, feet or shoes, outfit material and accessory close-ups, no text labels',
    'hero-cover': 'polished role-card cover image, character dominant in frame, beautiful readable face, strong mood, cinematic background',
    'opening-moment': 'opening scene image, character visibly present, expressive pose, readable setting, roleplay hook',
    'story-moment': 'character-first story moment, expressive pose, believable setting, clear mood',
    'relationship-moment': 'intimate relationship moment, readable gaze and posture, emotional tension, character face clear',
    expression: 'single facial expression reference, one face, clean close portrait',
    'outfit-detail': 'character outfit and accessory detail image, same face identity, readable fabric and signature motifs',
    'world-context': 'world-context visual with the character visible or clear character-linked motifs',
  }
  return prompts[role] ?? `coherent character image for ${profile.name || 'the character'}, same identity`
}

function rolePromptForImage(
  role: string,
  domain: CharacterImageStyleDomain,
  promptText: string,
  control: AgentImageGenerationControl | undefined,
  profile: CharacterImageProfile,
  targetIndex: number
): string {
  const shot = compactShot(control)
  const slot = sanitizeSlotPrompt(promptText, role)
  const indexed = targetIndex > 1 ? `image variant ${targetIndex}, same identity` : ''
  if (role === 'avatar') {
    return compactJoin([avatarRolePromptForImage(), shot, slot, indexed])
  }
  if (role === 'character-overview-sheet') {
    return overviewSheetRolePrompt(domain, slot, indexed)
  }
  return compactJoin(['same character as supplied reference image', automaticRolePrompt(role, profile), shot, slot, indexed])
}

function avatarRolePromptForImage(): string {
  return compactJoin([
    'canonical avatar master image for avatar.jpg',
    'single visible character only',
    'one clear unobstructed face',
    'upper-body or half-body portrait framing',
    'looking at viewer',
    'calm natural expression',
    'face, hair, default outfit, and body silhouette readable',
    'simple uncluttered background',
    'no model sheet, no collage, no split screen, no alternate forms',
  ])
}

function overviewSheetRolePrompt(
  domain: CharacterImageStyleDomain,
  slot: string,
  indexed: string
): string {
  const medium = domain === 'photoreal'
    ? 'realistic production wardrobe and character reference board'
    : 'production character design sheet'
  return compactJoin([
    'same character as supplied avatar reference image, preserve the same face, hair, body proportions, signature motifs, and outfit construction',
    `${medium}, one large clean 16:9 canvas, simple light background, organized model-sheet layout, even spacing`,
    'required contents: full-body front view, full-body back view, full-body side or three-quarter view, polished main portrait or half-body crop',
    'required detail callouts: 3 facial expressions, eye close-up, nose and mouth close-up, hairstyle close-up, hand pose close-up, leg shape close-up, hip and rear silhouette close-up, feet or shoes close-up, outfit fabric, accessory, hemline, and silhouette details',
    'keep the avatar outfit and material logic unless this target prompt explicitly requests an outfit variation',
    'visual reference only, no written labels, no UI text, no speech bubbles',
    slot,
    indexed,
  ])
}

function stylePromptForImage(
  role: string,
  domain: CharacterImageStyleDomain,
  control?: AgentImageGenerationControl
): string {
  if (role === 'avatar') {
    const avatarDomainPrompts: Record<CharacterImageStyleDomain, string> = {
      anime: 'anime style illustration, polished visual novel character portrait, clean linework, expressive detailed eyes, soft light, simple background, high quality anime art',
      photoreal: 'realistic portrait photography, warm natural light, shallow depth of field, natural skin tone and texture, clean lens rendering, high quality photo',
      illustration: 'polished character portrait illustration, refined facial structure, clean silhouette, soft light, simple background, high quality artwork',
      stylized: 'stylized character portrait, clear facial design, refined shape language, soft light, clean background, polished high quality finish',
    }
    return compactJoin([
      avatarDomainPrompts[domain],
      control?.stylePrompt,
    ])
  }
  if (role === 'character-overview-sheet') {
    const overviewDomainPrompts: Record<CharacterImageStyleDomain, string> = {
      anime: 'anime character design sheet, clean linework, consistent face across views, high quality anime art',
      photoreal: 'realistic character reference sheet, studio lighting, full-body views, high detail',
      illustration: 'professional character illustration sheet, clean silhouettes, readable costume construction',
      stylized: 'stylized character design sheet, clean shapes, consistent identity, polished color',
    }
    return compactJoin([
      overviewDomainPrompts[domain],
      control?.stylePrompt,
    ])
  }
  const domainPrompts: Record<CharacterImageStyleDomain, string> = {
    anime: 'anime style illustration, polished visual novel character art, clean linework, expressive detailed eyes, pixiv style, soft lighting, high quality anime art',
    photoreal: 'realistic photography, portrait, natural skin texture, detailed eyes, soft natural light, shallow depth of field, high quality photo',
    illustration: 'polished character illustration, refined facial structure, clean silhouette, detailed costume, high quality artwork',
    stylized: 'stylized character art, clear silhouette, refined face, polished color, high quality role-card finish',
  }
  return compactJoin([
    domainPrompts[domain],
    control?.stylePrompt,
  ])
}

function qualityPromptForImage(role: string, domain: CharacterImageStyleDomain): string {
  if (role === 'avatar') {
    return domain === 'anime'
      ? 'beautiful specific face, luminous eyes, crisp hair silhouette, refined outfit details, stable recognizable identity, clean high-resolution finish'
      : 'flattering face light, precise eye catchlights, realistic hair, refined styling, stable recognizable identity, clean high-resolution finish'
  }
  if (role === 'character-overview-sheet') {
    return 'consistent same-character face across every view, complete uncropped full bodies, readable proportions, clean spacing, readable small detail callouts, consistent costume construction, high-resolution production reference art'
  }
  if (role === 'hero-cover') {
    return 'cinematic composition, beautiful readable face, strong silhouette, premium role-card cover quality'
  }
  return 'clear face, refined styling, clean composition, high quality, high resolution'
}

function compactShot(control?: AgentImageGenerationControl): string {
  const shot = control?.shotType && control.shotType !== 'auto' ? control.shotType : ''
  const aspect = control?.aspectRatio ? `${control.aspectRatio} composition` : ''
  if (shot === 'bust') {
    return compactJoin(['knee-up or three-quarter character-card framing', aspect])
  }
  return compactJoin([shot, aspect])
}

function sanitizeSlotPrompt(promptText: string, role: string): string {
  const prompt = promptText.trim()
  if (!prompt) {
    return ''
  }
  const normalized = prompt
    .replace(/\b(asset role|primary objective|identity lock|composition strategy|style strategy|negative constraints|slot-specific prompt)\s*:\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (role !== 'avatar') {
    return normalized
  }
  const blocked = /(reference|model|character|expression|variant|turnaround)\s*sheet|full[- ]?body|wide canvas|panel|split[- ]?screen|collage|inset|duplicate|same character twice|two (poses|forms|faces|characters)|multiple (poses|faces|characters)|before and after|alternate/i
  return normalized
    .split(/(?<=[.!?。！？；;])\s+|[,，]\s*/)
    .map((part) => part.trim())
    .filter((part) => part && !blocked.test(part))
    .join(', ')
}

function inferStyleDomain(value: string): CharacterImageStyleDomain {
  const lower = value.toLowerCase()
  if (/(anime|manga|moe|chibi|visual[- ]?novel|light[- ]?novel|pixiv|cel|webtoon|manhwa|二次元|动漫|動畫|动画)/.test(lower)) {
    return 'anime'
  }
  if (/(photoreal|photo|realistic|cinematic|editorial|fashion|film|camera|bokeh|portrait|live action|真人|写实|寫實|摄影|攝影)/.test(lower)) {
    return 'photoreal'
  }
  if (/(oil|painting|watercolor|gouache|acrylic|pastel|charcoal|graphite|ink|illustration|插画|插畫)/.test(lower)) {
    return 'illustration'
  }
  return 'stylized'
}

function resolveStyleDomain(
  control: AgentImageGenerationControl | undefined,
  profile: CharacterImageProfile
): CharacterImageStyleDomain {
  const explicit = normalizeStyleDomain(control?.imageStyleDomain)
  if (explicit) {
    return explicit
  }
  const stylePromptDomain = inferStyleDomain(control?.stylePrompt ?? '')
  if (stylePromptDomain !== 'stylized') {
    return stylePromptDomain
  }
  return profile.styleDomain
}

function normalizeStyleDomain(value: unknown): CharacterImageStyleDomain | null {
  if (value === 'photoreal' || value === 'anime' || value === 'illustration' || value === 'stylized') {
    return value
  }
  return null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function compactJoin(values: Array<string | undefined>): string {
  return compactList(values).join('，')
}

function compactList(values: Array<string | undefined>): string[] {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
}
