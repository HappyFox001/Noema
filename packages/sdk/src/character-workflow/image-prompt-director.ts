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
    'character-base-image': 2,
  }
  return priorities[imageRole] ?? 20
}

function automaticRolePrompt(role: string, profile: CharacterImageProfile): string {
  const prompts: Record<string, string> = {
    avatar: 'canonical avatar master portrait, single subject, one clear unobstructed face, upper-body or half-body framing, looking at viewer, calm natural expression, simple clean background, identity reference image for later assets',
    'character-overview-sheet': 'same character as avatar reference, complete production character overview sheet, full-body front view, full-body back view, side or three-quarter view, main portrait crop, expression callouts, eye close-up, nose and mouth close-up, hairstyle detail, hands, legs, hips and rear silhouette, feet or shoes, outfit material and accessory close-ups, no text labels',
    'character-base-image': 'same character as supplied avatar reference image, free-form base character sample, reusable non-avatar identity reference, different meaningful scene, action, mood, outfit usage, or roleplay situation',
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
  if (role === 'character-base-image') {
    return baseCharacterImageRolePrompt(slot, control, indexed)
  }
  return compactJoin(['same character as supplied reference image', automaticRolePrompt(role, profile), shot, slot, indexed])
}

function avatarRolePromptForImage(): string {
  return compactJoin([
    'canonical avatar master image for avatar.jpg',
    'fixed 3:4 portrait asset framing',
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

function baseCharacterImageRolePrompt(
  slot: string,
  control: AgentImageGenerationControl | undefined,
  indexed: string
): string {
  return compactJoin([
    'same character as supplied avatar reference image, preserve face, hair, body proportions, signature motifs, and recognizable identity',
    'free-form base character sample image, not avatar.jpg, not a fixed model sheet, not a collage, not a poster layout',
    'each generated image may show a different meaningful roleplay sample: scene, action, mood, pose, outfit usage, prop interaction, or story situation',
    baseImageSensualCompositionPrompt(control),
    'keep the character clearly visible and reusable as a non-avatar reference sample',
    'identity must come from the linked avatar reference; use the target prompt only to vary composition and meaning',
    slot,
    indexed,
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
    `${medium}, one fixed 16:9 overview canvas, simple light background, clean single-page layout, even spacing`,
    'composition layout: left third contains one large polished front full-body reference plus a smaller half-body portrait crop above or beside it',
    'composition layout: center third contains back view and side or three-quarter view as neutral standing model references, aligned on the same ground line',
    'composition layout: right third and bottom strip contain compact visual detail tiles, no written labels',
    'required detail tiles: 3 facial expressions, eye close-up, nose and mouth close-up, hairstyle close-up, hand pose close-up, feet or shoes close-up, outfit fabric, accessory, hemline, silhouette details',
    'keep the avatar outfit and material logic unless this target prompt explicitly requests an outfit variation',
    'visual reference only, no written labels, no UI text, no speech bubbles, no poster composition, no scene background',
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
      anime: 'anime style illustration, mature visual novel character portrait, clean linework, expressive detailed eyes, confident alluring expression, elegant body silhouette, tasteful stylish outfit, soft light, simple background, high quality anime art',
      photoreal: 'realistic glamour portrait photography, mature confident presence, refined makeup, elegant body silhouette, tasteful wardrobe styling, warm natural light, shallow depth of field, natural skin tone and texture, clean lens rendering, high quality photo',
      illustration: 'polished mature character portrait illustration, refined facial structure, expressive gaze, elegant body silhouette, tasteful wardrobe styling, clean silhouette, soft light, simple background, high quality artwork',
      stylized: 'stylized mature character portrait, clear facial design, confident alluring presence, elegant body silhouette, tasteful fashion styling, refined shape language, soft light, clean background, polished high quality finish',
    }
    return compactJoin([
      avatarDomainPrompts[domain],
      control?.stylePrompt,
    ])
  }
  if (role === 'character-overview-sheet') {
    const overviewDomainPrompts: Record<CharacterImageStyleDomain, string> = {
      anime: 'mature anime character design sheet, clean linework, elegant body silhouette, consistent face across views, tasteful outfit construction, high quality anime art',
      photoreal: 'realistic mature character reference sheet, studio lighting, full-body views, elegant body silhouette, tasteful wardrobe construction, high detail',
      illustration: 'professional mature character illustration sheet, clean silhouettes, elegant body silhouette, readable costume construction, refined visual appeal',
      stylized: 'stylized mature character design sheet, clean shapes, elegant body silhouette, consistent identity, tasteful fashion styling, polished color',
    }
    return compactJoin([
      overviewDomainPrompts[domain],
      control?.stylePrompt,
    ])
  }
  if (role === 'character-base-image') {
    const baseImageDomainPrompts: Record<CharacterImageStyleDomain, string> = {
      anime: 'anime style character sample art, consistent face from avatar reference, expressive sensual pose, readable scene context, refined outfit detail, erotic visual appeal, high quality anime art',
      photoreal: 'realistic character sample photography, consistent face from avatar reference, sensual pose, readable setting, refined wardrobe styling, erotic glamour, high quality photo',
      illustration: 'polished character sample illustration, consistent identity from avatar reference, expressive sensual pose, readable scene context, refined costume and prop detail, erotic visual appeal',
      stylized: 'stylized character sample art, consistent identity from avatar reference, clear silhouette, expressive sensual pose, readable scene context, erotic design appeal, polished finish',
    }
    return compactJoin([
      baseImageDomainPrompts[domain],
      control?.stylePrompt,
    ])
  }
  const domainPrompts: Record<CharacterImageStyleDomain, string> = {
    anime: 'anime style illustration, mature visual novel character art, clean linework, expressive detailed eyes, confident alluring expression, elegant body silhouette, pixiv style, soft lighting, high quality anime art',
    photoreal: 'realistic glamour photography, mature confident presence, natural skin texture, detailed eyes, refined makeup, elegant body silhouette, soft natural light, shallow depth of field, high quality photo',
    illustration: 'polished mature character illustration, refined facial structure, expressive gaze, elegant body silhouette, clean silhouette, detailed tasteful costume, high quality artwork',
    stylized: 'stylized mature character art, clear silhouette, refined face, confident alluring presence, elegant body silhouette, polished color, high quality role-card finish',
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
  if (role === 'character-base-image') {
    return 'same-character identity from avatar reference, clear readable face, meaningful pose and scene, strong adult physical appeal, reusable non-avatar reference quality, high-resolution clean finish'
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

function baseImageSensualCompositionPrompt(control?: AgentImageGenerationControl): string {
  if (!control) {
    return 'adult sensual composition, erotic body line, attraction expressed through pose, gaze, fabric, lighting, background interaction, and prop use'
  }
  const pose = control.poseGoals.length
    ? `pose goals: ${control.poseGoals.join(', ')}`
    : 'pose goals: graceful body line, expressive hands, controlled gaze, readable silhouette'
  const background = control.backgroundInteraction
    ? `background and prop interaction: ${control.backgroundInteraction}`
    : 'background and prop interaction should support the mood through furniture, fabric, light, mirror, window, book, cup, weapon, instrument, or other scene objects'
  const appeal = appealModePrompt(control.appealMode)
  const sensuality = sensualityLevelPrompt(control.sensualityLevel)
  const wardrobe = wardrobeExposurePrompt(control.wardrobeExposure)
  return compactJoin([pose, background, appeal, sensuality, wardrobe])
}

function appealModePrompt(value: string): string {
  const prompts: Record<string, string> = {
    natural: 'natural everyday charm, relaxed presence, subtle attractiveness',
    romantic: 'romantic tension, soft gaze, intimate atmosphere, emotional closeness',
    'sensual-confidence': 'sensual confidence, charged posture, elegant body line, direct gaze, adult attraction',
    'erotic-tension': 'erotic tension, provocative pose, deliberate gaze, charged body language, intimate atmosphere',
    dramatic: 'dramatic cinematic appeal, strong silhouette, charged lighting, composed tension',
    mysterious: 'mysterious seductive aura, restrained gaze, shadow and negative space, quiet tension',
  }
  return prompts[value] ?? prompts['sensual-confidence']!
}

function sensualityLevelPrompt(value: string): string {
  const prompts: Record<string, string> = {
    subtle: 'subtle sensuality, implied attraction, elegant restraint',
    sensual: 'clear sensuality, attractive body line, intimate mood, confident gaze',
    erotic: 'erotic visual tension, provocative posture, intimate composition, adult desire',
    explicit: 'explicit adult erotic intent, direct sexual attraction, highly charged pose and framing',
  }
  return prompts[value] ?? prompts.sensual!
}

function wardrobeExposurePrompt(value: string): string {
  const prompts: Record<string, string> = {
    covered: 'covered wardrobe, attraction through silhouette, fabric tension, posture, and gaze',
    'stylish-revealing': 'stylish revealing wardrobe, visible body line, exposed shoulders, legs, waist, or neckline as appropriate',
    'lingerie-swimwear': 'lingerie or swimwear styling, intimate fabric, skin emphasis, bedroom or water-side glamour if suitable',
    'implied-nude': 'implied nude framing, sheets, steam, shadow, or props used for composition and erotic suggestion',
  }
  return prompts[value] ?? prompts['stylish-revealing']!
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
