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
    appearancePromptForRole(input.profile.appearancePrompt, role),
    rolePromptForImage(role, domain, input.promptText, input.control, input.profile, input.targetIndex),
    stylePromptForImage(role, domain, input.profile, input.control),
    qualityPromptForImage(role, domain),
    avoidPromptForImage(role, domain, input.control),
  ])
}

function appearancePromptForRole(appearancePrompt: string, role: string): string {
  if (role !== 'character-overview-sheet') {
    return appearancePrompt
  }
  return appearancePrompt
    .replace(/\b(upper[- ]body|half[- ]body|bust|close[- ]up|headshot|profile|avatar)\s+(portrait|shot|image)\b/gi, '')
    .replace(/\b(portrait|headshot|avatar)\b/gi, '')
    .replace(/\b(1:1|3:4|4:5|9:16)\b/g, '')
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
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
    avatar: 'single character upper-body portrait, one person only, one clear face, direct gaze, simple clean background',
    'character-overview-sheet': 'same character full-body design sheet, wide clean canvas, front view, back view, side view, hairstyle, hands, feet, outfit details, expression callouts, no text labels',
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
      ? 'one anime character only, upper-body avatar portrait, one head, one face, clear detailed eyes, simple background'
      : 'one person only, upper-body profile portrait, one face, clear facial features, natural simple background'
    return compactJoin([base, shot, slot, indexed])
  }
  if (role === 'character-overview-sheet') {
    return compactJoin([
      'same character as reference image, full-body character design sheet, wide composition, clean light background',
      'front view, back view, side view, hairstyle detail, hand and foot detail, outfit material details, expression callouts, no written labels',
      slot,
      indexed,
    ])
  }
  return compactJoin([automaticRolePrompt(role, profile), shot, slot, indexed])
}

function stylePromptForImage(
  role: string,
  domain: CharacterImageStyleDomain,
  profile: CharacterImageProfile,
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
      adultSensualPrompt(role, domain, profile, control),
      control?.stylePrompt,
    ])
  }
  const domainPrompts: Record<CharacterImageStyleDomain, string> = {
    anime: 'anime style illustration, polished visual novel character art, clean linework, expressive detailed eyes, soft lighting, high quality anime art',
    photoreal: 'realistic photography, portrait, natural skin texture, detailed eyes, soft natural light, shallow depth of field, high quality photo',
    illustration: 'polished character illustration, refined facial structure, clean silhouette, detailed costume, high quality artwork',
    stylized: 'stylized character art, clear silhouette, refined face, polished color, high quality role-card finish',
  }
  return compactJoin([
    domainPrompts[domain],
    presetStylePrompt(control?.imageStylePreset, role, domain),
    adultSensualPrompt(role, domain, profile, control),
    control?.stylePrompt,
  ])
}

function adultSensualPrompt(
  role: string,
  domain: CharacterImageStyleDomain,
  profile: CharacterImageProfile,
  control?: AgentImageGenerationControl
): string {
  if (!shouldUseAdultSensualCues(profile, control)) {
    return ''
  }
  if (role === 'character-overview-sheet') {
    return domain === 'anime'
      ? 'mature anime charm, elegant body curves, tasteful outfit detail, refined sensual costume design'
      : 'mature sensual character design, elegant body curves, tasteful outfit detail, refined adult styling'
  }
  if (domain === 'anime') {
    return 'mature anime sensual charm, alluring gaze, elegant body curves, tasteful skin exposure, lace or silk outfit details, delicate blush, warm intimate lighting'
  }
  return 'mature sensual allure, seductive but tasteful pose, alluring gaze, elegant cleavage, defined waistline and hip curve, lace, silk, sheer fabric, deep V neckline, warm intimate lighting'
}

function shouldUseAdultSensualCues(
  profile: CharacterImageProfile,
  control?: AgentImageGenerationControl
): boolean {
  const source = [
    profile.appearancePrompt,
    profile.appearance,
    profile.description,
    profile.scenario,
    profile.worldContext,
    control?.stylePrompt,
    control?.imageStylePreset,
  ].join(' ').toLowerCase()
  return /(adult|mature|nsfw|sensual|seductive|sexy|glamour|lingerie|cleavage|curvy|voluptuous|erotic|intimate|御姐|成熟|性感|诱惑|撩人|暧昧|身材|丰满|胸|乳沟|腰线|臀|大腿|蕾丝|丝绸|透视|吊带|开叉|深v|主播|少妇|人妻|风情|妩媚)/i.test(source)
}

function qualityPromptForImage(role: string, domain: CharacterImageStyleDomain): string {
  if (role === 'avatar') {
    return domain === 'anime'
      ? 'beautiful specific face, luminous eyes, crisp hair silhouette, refined outfit details, clean high-resolution finish'
      : 'flattering face light, precise eye catchlights, realistic hair, refined styling, clean high-resolution finish'
  }
  if (role === 'character-overview-sheet') {
    return 'consistent same-character face across views, readable proportions, clean spacing, high-resolution production art'
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
      ? 'premium mobile game avatar, elegant face design, polished cel shading, soft glow'
      : 'premium companion portrait, flattering light, readable eyes, profile-card finish',
    'character-sheet': 'professional character design sheet, visual-only details, clean panel spacing',
    'model-sheet': 'professional model sheet, consistent views, clean neutral presentation',
    'turnaround-reference': 'turnaround reference, front side and back views, stable outfit construction',
    'trading-card-art': 'premium role-card cover art, dominant character silhouette, dramatic background',
    'photoreal-portrait': 'polished photoreal portrait, natural skin texture, realistic hair, detailed eyes',
    'cinematic-realism': 'cinematic realism, filmic color, controlled contrast, motivated lighting',
    'editorial-photography': 'editorial photography, intentional styling, magazine-grade lighting',
    'high-fashion-editorial': 'high-fashion editorial, sculptural silhouette, luxurious material detail',
    'magazine-cover-gloss': 'glossy magazine cover finish, polished skin and hair, clean background separation',
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
  const common = compactList([
    control?.negativePrompt,
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
    'character-overview-sheet': ['written labels', 'different faces between views', 'cropped feet', 'cropped hands'],
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
