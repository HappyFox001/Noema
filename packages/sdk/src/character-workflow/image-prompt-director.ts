/**
 * Directs character image prompts from stable role-card identity into image-model ready assets.
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
  const source = [
    appearancePrompt ? `Reusable appearance prompt: ${appearancePrompt}` : '',
    name ? `Character name: ${name}` : '',
  ].filter(Boolean)
  const identityBible = source.join('\n')
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
    ? `Variant ${index} of ${count}: keep the same face, hair, age impression, body type, and signature motifs; vary only pose, framing, lighting, background, expression, or scene function.`
    : ''
  const rolePrompt = roleAutomaticPrompt(role, profile)
  return [
    rolePrompt,
    targetPurpose(role, target.imageAssetPurpose),
    variant,
  ].filter(Boolean).join('\n')
}

export function buildDirectedImageGenerationPrompt(input: DirectedImagePromptInput): string {
  const role = input.imageRole || input.target.imageRole
  if (!role) {
    throw new Error(`Image target ${input.target.nodeId} is missing imageRole`)
  }
  const domain = resolveStyleDomain(input.control, input.profile)
  const sections = [
    `Asset role: ${role}.`,
    primaryObjective(role, domain),
    targetPurpose(role, input.target.imageAssetPurpose),
    input.targetIndex > 1 ? `Image slot: ${input.targetIndex}. Keep identity stable while making this slot visually distinct from earlier slots.` : '',
    identityLock(input.profile),
    compositionStrategy(role, domain, input.control),
    styleStrategy(role, domain, input.control),
    qualityStrategy(role, domain),
    slotPromptForRole(role, input.promptText),
    globalVisualRules(role),
    negativeConstraints(role, domain, input.control),
  ]
  return sections.filter(Boolean).join('\n\n')
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

function roleAutomaticPrompt(role: string, profile: CharacterImageProfile): string {
  const prompts: Record<string, string> = {
    avatar: [
      'Canonical identity avatar for an AI roleplay character.',
      'Generate exactly one depiction of exactly one character in one continuous portrait image.',
      'Bust or upper-body portrait, clear face, direct eye contact or slightly off-camera gaze, attractive readable silhouette, confident inviting expression, subtle mature companion appeal.',
      'Prioritize exact face structure, eye shape, brows, nose, lips, hairstyle, body frame, skin tone, signature accessory or motif, and default outfit language.',
      'Make it feel like the final selected profile image from a professional character asset pipeline: polished face design, premium lighting, precise hair shape, refined styling, and strong thumbnail readability.',
      'Use a simple background that does not compete with the face. No alternate version, no duplicate face, no side-by-side comparison, no model sheet.',
    ].join(' '),
    'character-overview-sheet': [
      'Large production model sheet for the same character using any supplied reference image inputs as the identity lock.',
      'Show full-body front view, back view, side or three-quarter view, hairstyle detail, hands, legs, feet or shoes, outfit material details, and expression closeups as clean visual panels.',
      'Preserve the supplied reference identity exactly when reference images are available.',
    ].join(' '),
    'hero-cover': 'Polished role-card hero cover using supplied reference images as identity lock, with the character dominant in frame, strong mood, clear identity, and a readable hook for the premise.',
    'opening-moment': 'Opening-scene image with the character visibly present in the first RP situation, grounded setting details, expressive body language, and a concrete invitation into the scene.',
    'story-moment': 'Character-first story beat image with believable environment, pose, expression, props, and mood tied to the role card premise.',
    'relationship-moment': 'Relationship beat focused on chemistry, tension, distance, gaze, posture, and emotional context; another person may be implied or partially framed.',
    expression: 'Single expression reference image focused on one clean facial expression and emotional state, no labeled collage.',
    'outfit-detail': 'Character outfit and accessory detail image that preserves face identity while emphasizing fabric, materials, palette, and signature motifs.',
    'world-context': 'World-context visual that includes the character or unmistakable character-linked motifs, not an empty environment-only scene.',
  }
  return prompts[role] ?? `Coherent character image for ${role}, preserving the same identity and role-card appeal from ${profile.name || 'the character'}.`
}

function primaryObjective(role: string, domain: CharacterImageStyleDomain): string {
  if (role === 'avatar') {
    return domain === 'anime'
      ? 'Primary objective: create one finished single-subject mobile/visual-novel character avatar with memorable eyes, hair silhouette, clean upper-body framing, and immediate roleplay appeal. The output must not be a reference sheet, character sheet, variant sheet, or two-pose layout.'
      : 'Primary objective: create one finished single-subject AI companion profile portrait with natural facial detail, flattering light, strong eye contact, and immediate roleplay appeal. The output must not be a reference sheet, character sheet, variant sheet, or two-pose layout.'
  }
  if (role === 'character-overview-sheet') {
    return 'Primary objective: expand the supplied character identity into a production reference sheet without changing the face family, age impression, hairstyle, proportions, or outfit language.'
  }
  return 'Primary objective: create a character-first role-card image that supports the story while preserving the stable identity.'
}

function targetPurpose(role: string, purpose: string | undefined): string {
  if (role === 'avatar') {
    return [
      'Target purpose: final avatar image for the role card.',
      purpose ? `Internal intent: ${purpose}` : '',
      'Render it as a single finished portrait only; do not visualize reference-link, identity-lock, or production-planning concepts as panels, duplicates, comparison views, or extra faces.',
    ].filter(Boolean).join(' ')
  }
  return purpose ? `Target purpose: ${purpose}.` : ''
}

function identityLock(profile: CharacterImageProfile): string {
  return [
    'Identity lock:',
    profile.identityBible,
    'Keep these traits stable across all images: face shape, eye shape and color, eyebrow style, nose and lips, hair color and silhouette, age impression, skin tone, body type and proportions, signature accessory or motif, and outfit language.',
  ].join('\n')
}

function compositionStrategy(
  role: string,
  domain: CharacterImageStyleDomain,
  control?: AgentImageGenerationControl
): string {
  const controlLines = [
    control?.shotType && control.shotType !== 'auto' ? `Requested shot: ${control.shotType}.` : '',
    control?.aspectRatio ? `Aspect ratio target: ${control.aspectRatio}.` : '',
    control?.consistencyMode ? `Consistency mode: ${control.consistencyMode}.` : '',
    control?.seedMode ? `Seed strategy: ${control.seedMode}.` : '',
  ].filter(Boolean).join(' ')
  const roleLines: Record<string, string> = {
    avatar: 'Composition: one subject only; exactly one face and one body depiction; bust to half-body crop; face large enough to read; centered or subtly off-center portrait framing; no full-body sheet; no collage; no panels; no split-screen; no inset closeups; no mirrored duplicate; no same character twice; no multiple poses; simple depth-separated background.',
    'character-overview-sheet': 'Composition: clean model-sheet layout with visual panels only; include full-body front, back, side or three-quarter view, plus close details for face, hair, hands, legs, shoes, outfit materials, and 2-4 expressions; no written labels.',
    'hero-cover': 'Composition: cover-quality character-first framing; readable silhouette; character dominant; face unobstructed; environment supports the premise without hiding the body or face; strong thumbnail readability.',
    'opening-moment': 'Composition: concrete scene staging with the character in the foreground, expressive pose, readable setting, and clear entry point for roleplay.',
    'relationship-moment': 'Composition: intimate camera distance, readable gaze and posture, strong emotional spacing; keep the main character face unobstructed.',
  }
  const domainLine = domain === 'anime'
    ? 'Use character-art composition discipline: clean silhouette, expressive eyes, controlled shapes, no noisy over-detail.'
    : 'Use portrait/commercial composition discipline: flattering perspective, believable lens language, natural anatomy, controlled background separation.'
  return [
    roleLines[role] ?? 'Composition: single coherent character image with the character clearly visible and recognizable.',
    domainLine,
    controlLines,
  ].filter(Boolean).join('\n')
}

function styleStrategy(
  role: string,
  domain: CharacterImageStyleDomain,
  control?: AgentImageGenerationControl
): string {
  const preset = presetStyleStrategy(control?.imageStylePreset, role, domain)
  const localStyle = control?.stylePrompt ? `Local style pressure: ${control.stylePrompt}.` : ''
  const domainStyle: Record<CharacterImageStyleDomain, string> = {
    photoreal: [
      'Style strategy: photoreal portrait language, natural skin texture, detailed eyes, realistic hair strands, believable fabric, soft cinematic or studio light, 50-85mm lens feel, shallow depth of field when appropriate.',
      role === 'avatar' ? 'Avoid generic stock-photo neutrality; give the portrait clear companion-card charm and mature attractiveness without losing identity specificity.' : '',
    ].filter(Boolean).join(' '),
    anime: [
      'Style strategy: polished anime/visual-novel character art, clean linework, controlled cel shading, expressive eyes, appealing hair silhouette, tasteful highlights, mobile game avatar finish.',
      role === 'avatar' ? 'Avoid generic template face; make the eye design, bangs, accessories, and expression distinctive.' : '',
    ].filter(Boolean).join(' '),
    illustration: 'Style strategy: polished character illustration with intentional brushwork, clear facial structure, readable costume design, and refined color handling.',
    stylized: 'Style strategy: cohesive stylized character design with strong silhouette, clear material logic, readable expression, and premium role-card finish.',
  }
  return [domainStyle[domain], preset, localStyle].filter(Boolean).join('\n')
}

function qualityStrategy(role: string, domain: CharacterImageStyleDomain): string {
  if (role === 'character-overview-sheet') {
    return [
      'Reference-sheet quality direction:',
      'Prioritize same-character consistency across all panels: same face family, eyes, brows, hair silhouette, age impression, proportions, outfit language, and signature motifs.',
      'Use crisp panel spacing, clean silhouettes, readable hands/feet/outfit materials, and visual-only detail views without written labels.',
    ].join(' ')
  }
  if (role === 'hero-cover') {
    return [
      'Hero-cover quality direction:',
      'Prioritize premium role-card appeal: beautiful readable face, strong silhouette, refined styling, controlled background, cinematic/story-rich atmosphere, and thumbnail clarity.',
      'Preserve the reference identity even while making the cover more expressive and dramatic.',
    ].join(' ')
  }
  if (role !== 'avatar') {
    return ''
  }
  if (domain === 'anime') {
    return [
      'Avatar quality direction:',
      'Treat this as a final commercial anime character portrait, not a rough concept.',
      'Use a beautiful but specific face design, luminous detailed eyes, clean eyelash and eyebrow shapes, attractive mouth shape, graceful neck and shoulder line, crisp bangs and hair silhouette, subtle layered hair highlights, refined outfit material accents, soft rim light, gentle bloom, balanced color grading, and clean high-resolution finish.',
      'The face should be the strongest focal point; background, props, effects, and accessories must support the portrait without competing with the eyes.',
    ].join(' ')
  }
  if (domain === 'photoreal') {
    return [
      'Avatar quality direction:',
      'Treat this as a final premium profile portrait from a professional shoot, not a casual snapshot.',
      'Use flattering but believable facial light, precise eye catchlights, natural skin texture, detailed hair strands, intentional grooming, refined wardrobe material, shallow background separation, elegant color grading, and a clean high-resolution finish.',
      'The face should be the strongest focal point; background and props must remain restrained.',
    ].join(' ')
  }
  return [
    'Avatar quality direction:',
    'Treat this as a final premium character portrait, not a sketch, study, or layout exploration.',
    'Use a distinctive beautiful face, refined eyes, clean silhouette, intentional styling, polished material detail, controlled lighting, balanced color, and high-resolution finish.',
    'The face should be the strongest focal point; background, props, and effects must not compete with identity readability.',
  ].join(' ')
}

function presetStyleStrategy(
  preset: string | undefined,
  role: string,
  domain: CharacterImageStyleDomain
): string {
  const value = preset?.trim()
  if (!value) {
    return ''
  }
  const strategies: Record<string, string> = {
    'roleplay-character-avatar': [
      'Preset style: premium roleplay character avatar.',
      domain === 'anime'
        ? 'Use refined visual-novel/mobile-game character rendering: elegant face design, expressive eyes, clean line hierarchy, polished cel shading, soft gradient accents, crisp hair silhouette, tasteful highlights, and a finished profile-card feel.'
        : 'Use high-appeal companion portrait rendering: flattering face light, readable eyes, intentional styling, premium profile-card finish, and a distinct non-generic identity.',
      role === 'avatar' ? 'Prioritize face beauty, recognizability, subtle expression, and a clean bust composition over background complexity.' : '',
    ].filter(Boolean).join(' '),
    'character-sheet': 'Preset style: professional character design sheet. Use clean production-art presentation, consistent face family across views, readable outfit construction, controlled panel spacing, visual-only detail callouts, and no text labels.',
    'model-sheet': 'Preset style: professional model sheet. Use consistent same-character views, clean orthographic or near-orthographic presentation, readable proportions, controlled panel spacing, visual-only detail callouts, and no text labels.',
    'turnaround-reference': 'Preset style: turnaround reference. Use front, three-quarter, side, and back views with strict same-character identity, stable outfit construction, readable hair silhouette, clean neutral presentation, and no text labels.',
    'trading-card-art': 'Preset style: premium role-card/trading-card art. Use a dominant character silhouette, refined face appeal, controlled dramatic background, polished material detail, strong value grouping, and thumbnail-readable cover composition.',
    'photoreal-portrait': 'Preset style: polished photoreal portrait with natural skin texture, realistic hair, detailed eyes, flattering portrait light, and believable camera perspective.',
    'cinematic-realism': 'Preset style: cinematic realism with filmic color, controlled contrast, motivated lighting, atmospheric depth, realistic materials, and grounded anatomy.',
    'editorial-photography': 'Preset style: refined editorial photography with intentional styling, premium wardrobe language, clean composition, magazine-grade lighting, and confident pose direction.',
    'high-fashion-editorial': 'Preset style: high-fashion editorial with sculptural silhouette, deliberate styling, luxurious material detail, poised expression, and bold but controlled art direction.',
    'magazine-cover-gloss': 'Preset style: glossy magazine-cover finish with polished skin/hair, punchy lighting, clean background separation, strong eye contact, and premium color grading.',
    'anime-visual-novel': 'Preset style: polished anime visual-novel key art with clean linework, expressive eyes, elegant face proportions, controlled cel shading, soft bloom, delicate highlights, and refined character appeal.',
    'anime-mobile-game': 'Preset style: premium anime mobile-game character art with crisp silhouette, detailed eyes, polished hair shapes, readable costume layers, controlled effects, and high production value.',
    'soft-anime-portrait': 'Preset style: soft anime portrait with gentle lighting, delicate facial rendering, translucent eye highlights, smooth cel shading, tasteful blush, and calm emotional tone.',
    'oil-painting': 'Preset style: polished oil-painting character illustration with intentional brushwork, clear facial structure, rich color layering, and painterly depth without muddy details.',
    'classical-portrait-painting': 'Preset style: classical portrait painting with dignified pose, controlled chiaroscuro, refined facial modeling, rich fabric handling, and timeless composition.',
    'dreamy-soft-focus': 'Preset style: dreamy soft-focus character image with gentle bloom, low harshness, airy color, soft background separation, and clear face readability.',
    'bokeh-portrait': 'Preset style: portrait with creamy bokeh, subject separation, expressive eyes, soft lens depth, and uncluttered background lights.',
  }
  if (strategies[value]) {
    return strategies[value]
  }
  return `Preset style: ${formatPreset(value)}. Translate this preset into concrete visual choices for lighting, rendering finish, palette, texture, camera/composition discipline, and character appeal; do not treat it as a vague label.`
}

function slotPrompt(promptText: string): string {
  return [
    'Slot-specific prompt:',
    promptText.trim(),
  ].join('\n')
}

function slotPromptForRole(role: string, promptText: string): string {
  const roleContract = role === 'avatar'
    ? [
      'Avatar slot contract:',
      'This image is not a concept board. Generate one final role-card avatar portrait only.',
      'Exactly one visible depiction of the character: one head, one face, one bust/upper body, one continuous camera frame.',
      'Do not include alternate designs, second expressions, extra heads, face closeup insets, comparison panels, model-sheet panels, or a second copy of the same character.',
    ].join('\n')
    : ''
  return [
    roleContract,
    slotPrompt(promptText),
  ].filter(Boolean).join('\n')
}

function globalVisualRules(role: string): string {
  return [
    'Global visual rules:',
    'Generate visual content only. No written words, captions, subtitles, UI, labels, logos, signatures, watermark, prompt text, or typographic elements anywhere in the image.',
    role === 'character-overview-sheet'
      ? 'Overview sheet may use panel separation, but every panel must be visual-only and preserve the same identity.'
      : 'The image must read as a finished role-card asset, not a prompt study or loose concept sketch.',
  ].join('\n')
}

function negativeConstraints(
  role: string,
  domain: CharacterImageStyleDomain,
  control?: AgentImageGenerationControl
): string {
  const common = [
    control?.negativePrompt,
    'low quality',
    'blurry',
    'bad anatomy',
    'deformed face',
    'asymmetrical eyes',
    'extra fingers',
    'missing fingers',
    'broken hands',
    'malformed legs',
    'duplicate limbs',
    'text',
    'caption',
    'subtitle',
    'watermark',
    'logo',
    'signature',
    'UI text',
    'speech bubble',
  ]
  const roleNegatives: Record<string, string[]> = {
    avatar: ['multiple people', 'two characters', 'duplicate character', 'same character twice', 'multiple faces', 'two faces', 'extra face', 'face inset', 'portrait inset', 'second portrait', 'dual portrait', 'two busts', 'split screen', 'diptych', 'triptych', 'contact sheet', 'before and after', 'alternate version', 'variant sheet', 'comparison layout', 'collage', 'reference sheet', 'character sheet', 'model sheet', 'full-body turnaround', 'multiple poses', 'side profile only', 'covered face', 'mask hiding face', 'generic face', 'age ambiguity'],
    'character-overview-sheet': ['written labels', 'text labels', 'different faces between panels', 'different hairstyles between panels', 'random outfit swaps', 'cropped feet', 'cropped hands'],
    'hero-cover': ['face hidden', 'tiny character', 'empty landscape', 'busy unreadable background'],
    'opening-moment': ['empty room', 'environment-only image', 'character hidden'],
  }
  const domainNegatives: Record<CharacterImageStyleDomain, string[]> = {
    photoreal: ['anime', 'manga', 'cartoon', '3d render', 'plastic skin', 'over-smoothed skin', 'uncanny CGI'],
    anime: ['photorealistic', 'live action', '3d render', 'western comic anatomy', 'muddy linework', 'over-rendered skin pores'],
    illustration: ['flat vector', 'cheap clipart', 'stock photo', 'plastic CGI'],
    stylized: ['style clash', 'uncontrolled rendering', 'muddy forms'],
  }
  return `Negative constraints: ${dedupe([
    ...common,
    ...(roleNegatives[role] ?? []),
    ...domainNegatives[domain],
  ]).join(', ')}.`
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
    const item = value?.trim()
    if (!item) {
      continue
    }
    const key = item.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      result.push(item)
    }
  }
  return result
}
