/**
 * Builds compact Sugar-style prompts for character image assets.
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
    avoidPromptForImage(role, domain, input.control),
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
    avatar: 'solo character card portrait, one clear face, face and body visible, dynamic attractive pose, simple clean background',
    'character-overview-sheet': 'same character as avatar reference, complete production character overview sheet, full-body front view, full-body back view, side or three-quarter view, main portrait crop, expression callouts, hairstyle detail, hands, feet or shoes, outfit material and accessory close-ups, no text labels',
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
    const base = domain === 'anime'
      ? 'solo anime character, character-card portrait, clear detailed eyes, face and body visible, dynamic three-quarter or high-angle composition, simple background'
      : 'solo person, premium character-card portrait, clear facial features, face and body visible, flattering three-quarter composition, natural simple background'
    return compactJoin([base, shot, slot, indexed])
  }
  if (role === 'character-overview-sheet') {
    return overviewSheetRolePrompt(domain, slot, indexed)
  }
  return compactJoin(['same character as supplied reference image', automaticRolePrompt(role, profile), shot, slot, indexed])
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
    'required detail callouts: 3 facial expressions, hairstyle close-up, hand pose close-up, feet or shoes close-up, outfit fabric, accessory, and silhouette details',
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
  if (role === 'character-overview-sheet') {
    const overviewDomainPrompts: Record<CharacterImageStyleDomain, string> = {
      anime: 'anime character design sheet, clean linework, consistent face across views, high quality anime art',
      photoreal: 'realistic character reference sheet, studio lighting, full-body views, high detail',
      illustration: 'professional character illustration sheet, clean silhouettes, readable costume construction',
      stylized: 'stylized character design sheet, clean shapes, consistent identity, polished color',
    }
    return compactJoin([
      overviewDomainPrompts[domain],
      presetStylePrompt(control?.imageStylePreset, role, domain),
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
    presetStylePrompt(control?.imageStylePreset, role, domain),
    control?.stylePrompt,
  ])
}

function qualityPromptForImage(role: string, domain: CharacterImageStyleDomain): string {
  if (role === 'avatar') {
    return domain === 'anime'
      ? 'beautiful specific face, luminous eyes, crisp hair silhouette, refined outfit details, appealing body silhouette, clean high-resolution finish'
      : 'flattering face light, precise eye catchlights, realistic hair, refined styling, appealing body silhouette, clean high-resolution finish'
  }
  if (role === 'character-overview-sheet') {
    return 'consistent same-character face across every view, complete uncropped full bodies, readable proportions, clean spacing, readable small detail callouts, consistent costume construction, high-resolution production reference art'
  }
  if (role === 'hero-cover') {
    return 'cinematic composition, beautiful readable face, strong silhouette, premium role-card cover quality'
  }
  return 'clear face, refined styling, clean composition, high quality, high resolution'
}

function presetStylePrompt(
  preset: string | undefined,
  role: string,
  domain: CharacterImageStyleDomain
): string {
  const value = preset?.trim()
  if (!value) {
    return ''
  }
  const strategies: Record<string, string> = {
    'roleplay-character-avatar': domain === 'anime'
      ? 'premium mobile game role-card art, dynamic high-angle or three-quarter framing, elegant face design, polished cel shading, soft glow'
      : 'premium companion role-card portrait, flattering high-angle or three-quarter framing, readable eyes, profile-card finish',
    'character-sheet': 'professional character design sheet, visual-only details, clean panel spacing',
    'model-sheet': 'professional model sheet, consistent views, clean neutral presentation',
    'turnaround-reference': 'turnaround reference, front side and back views, stable outfit construction',
    'trading-card-art': 'premium role-card cover art, dominant character silhouette, dramatic background',
    'photoreal-portrait': 'polished photoreal portrait, natural skin texture, realistic hair, detailed eyes',
    'cinematic-realism': 'cinematic realism, filmic color, controlled contrast, motivated lighting',
    'editorial-photography': 'editorial photography, intentional styling, magazine-grade lighting',
    'high-fashion-editorial': 'high-fashion editorial, sculptural silhouette, luxurious material detail',
    'magazine-cover-gloss': 'glossy magazine cover finish, polished skin and hair, clean background separation',
    'adult-sensual': 'mature sensual allure, alluring gaze, elegant body curves, lace, silk, sheer fabric, deep V neckline, cleavage, waistline, hip curve, thigh slit, warm intimate lighting, seductive but tasteful character-card pose',
    'anime-sensual-companion': 'mature anime sensual charm, alluring gaze, elegant body curves, tasteful skin exposure, lace or silk outfit details, delicate blush, warm intimate lighting, seductive character-card pose, premium anime companion art',
    'glamour-lingerie': 'glamour lingerie styling, lace, silk, sheer fabric, elegant cleavage, defined waistline, hip curve, thigh slit, warm intimate lighting, polished adult companion portrait finish',
    'mature-companion': 'mature companion allure, refined adult styling, elegant body curves, confident gaze, intimate warm light, premium role-card finish',
    'anime-visual-novel': 'polished anime visual novel key art, expressive eyes, clean cel shading',
    'anime-mobile-game': 'premium anime mobile game character art, crisp silhouette, detailed eyes',
    'soft-anime-portrait': 'soft anime portrait, gentle lighting, translucent eye highlights, tasteful blush',
    'oil-painting': 'polished oil painting character illustration, rich color layering, painterly depth',
    'classical-portrait-painting': 'classical portrait painting, refined facial modeling, rich fabric handling',
    'dreamy-soft-focus': 'dreamy soft focus, gentle bloom, airy color, clear face readability',
    'bokeh-portrait': 'creamy bokeh portrait, subject separation, expressive eyes',
  }
  return strategies[value] ?? formatPreset(value)
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
  const blocked = /(reference|model|character|expression|variant|turnaround)\s*sheet|panel|split[- ]?screen|collage|inset|duplicate|same character twice|two (poses|forms|faces|characters)|multiple (poses|faces|characters)|before and after|alternate/i
  return normalized
    .split(/(?<=[.!?。！？；;])\s+|[,，]\s*/)
    .map((part) => part.trim())
    .filter((part) => part && !blocked.test(part))
    .join(', ')
}

function avoidPromptForImage(
  role: string,
  domain: CharacterImageStyleDomain,
  control?: AgentImageGenerationControl
): string {
  const controlNegatives = control?.negativePrompt
    ? control.negativePrompt.split(',').map((item) => item.trim())
    : []
  const common = compactList([
    ...controlNegatives,
    'low quality',
    'blurry',
    'bad anatomy',
    'deformed face',
    'text',
    'watermark',
    'logo',
  ])
  const roleNegatives: Record<string, string[]> = {
    avatar: ['multiple people', 'two characters', 'duplicate face', 'second face', 'collage', 'panel layout', 'inset portrait'],
    'character-overview-sheet': ['written labels', 'speech bubbles', 'UI text', 'single portrait only', 'social media cover', 'random extra character', 'different faces between views', 'changed hairstyle', 'changed outfit without prompt', 'cropped full body', 'cropped feet', 'cropped hands', 'messy collage', 'overlapping bodies'],
    'hero-cover': ['face hidden', 'tiny character', 'empty landscape'],
    'opening-moment': ['empty room', 'character hidden'],
  }
  const domainNegatives: Record<CharacterImageStyleDomain, string[]> = {
    photoreal: ['anime', 'cartoon', 'plastic skin'],
    anime: ['photorealistic', 'live action', '3d render'],
    illustration: ['cheap clipart', 'stock photo'],
    stylized: ['style clash'],
  }
  const negatives = dedupe([
    ...common,
    ...(roleNegatives[role] ?? []),
    ...domainNegatives[domain],
  ])
  return negatives.length ? `avoid ${negatives.join(', ')}` : ''
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

function formatPreset(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => /^[0-9]+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function dedupe(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = value?.trim()
    if (!normalized || seen.has(normalized.toLowerCase())) {
      continue
    }
    seen.add(normalized.toLowerCase())
    result.push(normalized)
  }
  return result
}
