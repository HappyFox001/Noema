/**
 * Canonical character profile data shared by chat and companion surfaces.
 */
import type { Personality } from '../personality/index.js'

export type CharacterProfileLanguage = 'zh-CN' | 'en-US'
export type CharacterProfileLocalizedText = Record<CharacterProfileLanguage, string>

export interface CharacterProfileOpeningPanel {
  html: string
  css: string
  summary?: string
  layoutKind?: string
  sourceArtifactId?: string
}

export type CharacterAtmosphereDensity = 'compact' | 'balanced' | 'cinematic'
export type CharacterAtmosphereRadius = 'sharp' | 'soft' | 'round'
export type CharacterAtmosphereMessageFrame = 'minimal' | 'panel' | 'glass' | 'ornate'
export type CharacterAtmosphereAudioPlayer = 'bar' | 'capsule' | 'console'
export type CharacterAtmosphereAudioMotion = 'still' | 'pulse' | 'scan'
export type CharacterAtmosphereAudioTone = 'intimate' | 'ambient' | 'dramatic'
export type CharacterAtmosphereSceneFrame = 'plain' | 'panel' | 'ledger' | 'instrument'
export type CharacterAtmosphereSceneDivider = 'line' | 'glow' | 'none'
export type CharacterAtmosphereImageTreatment = 'portrait' | 'artifact' | 'cinematic'

export interface CharacterProfileMessageStyle {
  frame: CharacterAtmosphereMessageFrame
  narration: 'soft-prose' | 'cinematic' | 'noir' | 'diary' | 'clinical'
  speech: 'quote-emphasis' | 'quiet-line' | 'stage-dialogue'
  density: CharacterAtmosphereDensity
  radius: CharacterAtmosphereRadius
  accent: string
  accentSoft: string
  surface: string
  border: string
  text: string
  muted: string
  radiusPx: number
  paddingY: number
  paddingX: number
  lineWeight: number
}

export interface CharacterProfileAudioStyle {
  player: CharacterAtmosphereAudioPlayer
  motion: CharacterAtmosphereAudioMotion
  tone: CharacterAtmosphereAudioTone
  accent: string
  accentSoft: string
  surface: string
  track: string
  border: string
  text: string
  radiusPx: number
  heightPx: number
}

export interface CharacterProfileSceneStyle {
  frame: CharacterAtmosphereSceneFrame
  divider: CharacterAtmosphereSceneDivider
  accent: string
  accentSoft: string
  surface: string
  border: string
  text: string
  muted: string
  radiusPx: number
}

export interface CharacterProfileImageStyle {
  treatment: CharacterAtmosphereImageTreatment
  accent: string
  border: string
  shadow: string
  radiusPx: number
  filter: string
}

export interface CharacterProfileAtmosphereStyle {
  schemaVersion: 2
  name: string
  summary?: string
  mood: string[]
  scopeClass?: string
  css?: string
  designBrief?: {
    concept?: string
    colorSystem?: string
    surfaceTreatment?: string
    typography?: string
    audioTreatment?: string
    sceneTreatment?: string
  }
  messageStyle: CharacterProfileMessageStyle
  audioStyle: CharacterProfileAudioStyle
  sceneStyle: CharacterProfileSceneStyle
  imageStyle: CharacterProfileImageStyle
  preview?: {
    userLine?: string
    narration?: string
    speech?: string
  }
  sourceArtifactId?: string
}

export interface CharacterProfileGameStat {
  id: string
  label: string
  value: number
  min?: number
  max?: number
  unit?: string
  tone?: string
  description?: string
  visibility?: 'shown' | 'hidden' | 'conditional'
}

export interface CharacterProfileEquipmentItem {
  id: string
  name: string
  description?: string
  tags?: string[]
  quantity?: number
  durability?: number
  effects?: string[]
}

export interface CharacterProfileEquipmentSlot {
  id: string
  label: string
  limit: number
  rule: string
  current?: CharacterProfileEquipmentItem[]
}

export interface CharacterProfileStatusEffect {
  id: string
  label: string
  value?: string
  tone?: string
  description?: string
  duration?: string
  rule?: string
}

export interface CharacterProfileGamePanelStyle {
  frame?: 'glass' | 'dossier' | 'ritual' | 'noir' | 'intimate' | 'mist'
  density?: 'compact' | 'balanced' | 'airy'
  meter?: 'capsule' | 'line' | 'etched' | 'warm-bar'
  accent?: string
  accentSoft?: string
  surface?: string
  surfaceAlt?: string
  track?: string
  border?: string
  text?: string
  muted?: string
  radiusPx?: number
  cellRadiusPx?: number
}

export interface CharacterProfileGameSystem {
  schemaVersion: 1
  name: string
  summary?: string
  stats: CharacterProfileGameStat[]
  equipment: {
    slots: CharacterProfileEquipmentSlot[]
    rules: string[]
    acquisitionRules: string[]
    forbiddenRules: string[]
  }
  statuses: CharacterProfileStatusEffect[]
  rules: string[]
  ui?: {
    quickPanels?: Array<'equipment' | 'status' | 'rules'>
    panelStyle?: CharacterProfileGamePanelStyle
  }
  sourceArtifactId?: string
}

export interface CharacterProfileAsset {
  id: string
  kind: 'avatar' | 'body' | 'overview' | 'voice-sample' | 'live2d' | 'vrm' | 'generated-image'
  uri: string
  mimeType?: string
  role?: string
  metadata?: Record<string, unknown>
}

export interface CharacterProfile {
  schemaVersion: 1
  id: string
  source?: {
    kind: 'chat-role' | 'workflow-run' | 'external'
    path?: string
    runId?: string
  }
  roleCard?: Record<string, unknown>
  openingPanel?: CharacterProfileOpeningPanel
  atmosphereStyle?: CharacterProfileAtmosphereStyle
  gameSystem?: CharacterProfileGameSystem
  name: CharacterProfileLocalizedText
  displayName: CharacterProfileLocalizedText
  description: CharacterProfileLocalizedText
  story: CharacterProfileLocalizedText
  background: CharacterProfileLocalizedText
  scene: Record<string, unknown>
  firstMessage: CharacterProfileLocalizedText
  tag: Record<CharacterProfileLanguage, string[]>
  avatarImage: string
  bodyImage: string
  assets?: CharacterProfileAsset[]
  companion?: {
    speakingStyle?: string
    behaviorRules?: string[]
    values?: string[]
    personalityTraits?: string[]
    relationship?: {
      type: 'companion' | 'assistant' | 'friend'
      intimacy: number
      trust: number
      dynamic?: string
    }
  }
}

export interface CharacterProfileManifestInput {
  id?: unknown
  name?: unknown
  displayName?: unknown
  description?: unknown
  story?: unknown
  background?: unknown
  scene?: unknown
  firstMessage?: unknown
  tag?: unknown
  roleCard?: unknown
  openingPanel?: unknown
  atmosphereStyle?: unknown
  gameSystem?: unknown
  avatarImage?: unknown
  bodyImage?: unknown
}

export function createCharacterProfileFromManifest(
  manifest: CharacterProfileManifestInput,
  options: {
    id?: string
    sourceKind?: 'chat-role' | 'external'
    sourcePath?: string
    avatarImage: string
    bodyImage: string
  }
): CharacterProfile {
  const id = normalizeIdentifier(options.id || stringValue(manifest.id), 'character')
  const name = localizedTextValue(manifest.name)
  const displayName = localizedTextValue(manifest.displayName, name)
  const firstMessage = localizedTextValue(manifest.firstMessage)
  return {
    schemaVersion: 1,
    id,
    source: {
      kind: options.sourceKind ?? 'chat-role',
      ...(options.sourcePath ? { path: options.sourcePath } : {}),
    },
    roleCard: recordValue(manifest.roleCard),
    openingPanel: normalizeOpeningPanel(manifest.openingPanel),
    atmosphereStyle: normalizeAtmosphereStyle(manifest.atmosphereStyle),
    gameSystem: normalizeGameSystem(manifest.gameSystem),
    name: nonEmptyLocalizedText(name, id),
    displayName: nonEmptyLocalizedText(displayName, id),
    description: localizedTextValue(manifest.description),
    story: localizedTextValue(manifest.story),
    background: localizedTextValue(manifest.background),
    scene: recordValue(manifest.scene) ?? {},
    firstMessage,
    tag: tagValue(manifest.tag),
    avatarImage: options.avatarImage,
    bodyImage: options.bodyImage,
    assets: [
      ...(options.avatarImage ? [{ id: `${id}-avatar`, kind: 'avatar' as const, uri: options.avatarImage }] : []),
      ...(options.bodyImage ? [{ id: `${id}-body`, kind: 'body' as const, uri: options.bodyImage }] : []),
    ],
  }
}

export function normalizeCharacterProfile(value: unknown): CharacterProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const profile = value as Partial<CharacterProfile>
  if (profile.schemaVersion !== 1 || !profile.id) {
    return null
  }
  return {
    schemaVersion: 1,
    id: normalizeIdentifier(profile.id, 'character'),
    source: profile.source && typeof profile.source === 'object' ? profile.source : undefined,
    roleCard: recordValue(profile.roleCard),
    openingPanel: normalizeOpeningPanel(profile.openingPanel),
    atmosphereStyle: normalizeAtmosphereStyle(profile.atmosphereStyle),
    gameSystem: normalizeGameSystem(profile.gameSystem),
    name: nonEmptyLocalizedText(localizedTextValue(profile.name), profile.id),
    displayName: nonEmptyLocalizedText(localizedTextValue(profile.displayName), profile.id),
    description: localizedTextValue(profile.description),
    story: localizedTextValue(profile.story),
    background: localizedTextValue(profile.background),
    scene: recordValue(profile.scene) ?? {},
    firstMessage: localizedTextValue(profile.firstMessage),
    tag: tagValue(profile.tag),
    avatarImage: stringValue(profile.avatarImage),
    bodyImage: stringValue(profile.bodyImage),
    assets: Array.isArray(profile.assets)
      ? profile.assets.map(normalizeAsset).filter(Boolean) as CharacterProfileAsset[]
      : undefined,
    companion: normalizeCompanionProfile(profile.companion),
  }
}

export function characterProfileToPersonality(profile: CharacterProfile): Personality {
  const companion = profile.companion
  const displayName = localizeCharacterProfileText(profile.displayName, 'zh-CN')
  const englishName = localizeCharacterProfileText(profile.displayName, 'en-US') || displayName
  const background = [
    localizeCharacterProfileText(profile.background, 'zh-CN'),
    localizeCharacterProfileText(profile.story, 'zh-CN'),
  ].filter(Boolean).join('\n\n')
  return {
    character: {
      name: englishName || displayName || profile.id,
      chineseName: displayName || englishName || profile.id,
      englishAlias: englishName || displayName || profile.id,
      background: background || localizeCharacterProfileText(profile.description, 'zh-CN') || profile.id,
      personalityTraits: companion?.personalityTraits ?? profile.tag['zh-CN'],
      values: companion?.values?.length ? companion.values : ['保持角色一致', '自然回应用户', '尊重当前对话上下文'],
      speakingStyle: companion?.speakingStyle || '自然、直接、符合角色设定地回应用户。',
      behaviorRules: companion?.behaviorRules,
    },
    relationship: companion?.relationship ?? {
      type: 'companion',
      intimacy: 0.6,
      trust: 0.6,
    },
  }
}

export function localizeCharacterProfileText(
  value: CharacterProfileLocalizedText | undefined,
  language: CharacterProfileLanguage
): string {
  if (!value) {
    return ''
  }
  return value[language] || value['zh-CN'] || value['en-US'] || ''
}

export function localizedText(zh: string, en = zh): CharacterProfileLocalizedText {
  return {
    'zh-CN': zh,
    'en-US': en || zh,
  }
}

function localizedTextValue(value: unknown, fallback?: CharacterProfileLocalizedText): CharacterProfileLocalizedText {
  if (typeof value === 'string') {
    return localizedText(value)
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const zh = typeof record['zh-CN'] === 'string' ? record['zh-CN'] : ''
    const en = typeof record['en-US'] === 'string' ? record['en-US'] : zh
    return { 'zh-CN': zh, 'en-US': en }
  }
  return fallback ? { ...fallback } : localizedText('')
}

function nonEmptyLocalizedText(value: CharacterProfileLocalizedText, fallback: string): CharacterProfileLocalizedText {
  const zh = value['zh-CN'] || fallback
  const en = value['en-US'] || zh
  return { 'zh-CN': zh, 'en-US': en }
}

function tagValue(value: unknown): Record<CharacterProfileLanguage, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { 'zh-CN': [], 'en-US': [] }
  }
  const record = value as Record<string, unknown>
  const zh = Array.isArray(record['zh-CN'])
    ? record['zh-CN'].filter((item): item is string => typeof item === 'string')
    : []
  const en = Array.isArray(record['en-US'])
    ? record['en-US'].filter((item): item is string => typeof item === 'string')
    : zh
  return { 'zh-CN': zh, 'en-US': en }
}

function normalizeOpeningPanel(value: unknown): CharacterProfileOpeningPanel | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const record = value as Record<string, unknown>
  const html = stringValue(record.html)
  const css = stringValue(record.css)
  if (!html || !css) {
    return undefined
  }
  return {
    html,
    css,
    summary: optionalString(record.summary),
    layoutKind: optionalString(record.layoutKind),
    sourceArtifactId: optionalString(record.sourceArtifactId),
  }
}

function normalizeAtmosphereStyle(value: unknown): CharacterProfileAtmosphereStyle | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 2) {
    return undefined
  }
  const messageStyleInput = recordValue(record.messageStyle)
  const audioStyleInput = recordValue(record.audioStyle)
  const sceneStyleInput = recordValue(record.sceneStyle)
  const imageStyleInput = recordValue(record.imageStyle)
  if (!messageStyleInput || !audioStyleInput || !sceneStyleInput || !imageStyleInput) {
    return undefined
  }
  const messageStyle = normalizeMessageStyle(messageStyleInput)
  const audioStyle = normalizeAudioStyle(audioStyleInput)
  const sceneStyle = normalizeSceneStyle(sceneStyleInput)
  const imageStyle = normalizeImageStyle(imageStyleInput)
  return {
    schemaVersion: 2,
    name: optionalString(record.name) ?? 'Character atmosphere',
    summary: optionalString(record.summary),
    mood: stringArrayValue(record.mood).slice(0, 8),
    messageStyle,
    audioStyle,
    sceneStyle,
    imageStyle,
    preview: normalizeAtmospherePreview(record.preview),
    scopeClass: optionalString(record.scopeClass),
    css: optionalString(record.css),
    designBrief: normalizeAtmosphereDesignBrief(record.designBrief),
    sourceArtifactId: optionalString(record.sourceArtifactId),
  }
}

function normalizeMessageStyle(
  value: Record<string, unknown>
): CharacterProfileMessageStyle {
  const record = value
  const radius = enumString(record.radius, ['sharp', 'soft', 'round'], 'soft')
  const density = enumString(record.density, ['compact', 'balanced', 'cinematic'], 'balanced')
  return {
    frame: enumString(record.frame, ['minimal', 'panel', 'glass', 'ornate'], 'panel'),
    narration: enumString(record.narration, ['soft-prose', 'cinematic', 'noir', 'diary', 'clinical'], 'soft-prose'),
    speech: enumString(record.speech, ['quote-emphasis', 'quiet-line', 'stage-dialogue'], 'quote-emphasis'),
    density,
    radius,
    accent: colorString(record.accent, '#c7d8d0'),
    accentSoft: colorString(record.accentSoft, 'rgba(199, 216, 208, 0.16)'),
    surface: colorString(record.surface, 'rgba(9, 9, 11, 0.86)'),
    border: colorString(record.border, 'rgba(218, 232, 224, 0.18)'),
    text: colorString(record.text, 'rgba(250, 250, 246, 0.95)'),
    muted: colorString(record.muted, 'rgba(225, 228, 224, 0.76)'),
    radiusPx: clampNumber(numberValue(record.radiusPx, radius === 'sharp' ? 10 : radius === 'round' ? 22 : 16), 6, 36),
    paddingY: clampNumber(numberValue(record.paddingY, density === 'compact' ? 15 : density === 'cinematic' ? 24 : 18), 10, 36),
    paddingX: clampNumber(numberValue(record.paddingX, density === 'compact' ? 17 : density === 'cinematic' ? 25 : 20), 12, 40),
    lineWeight: clampNumber(numberValue(record.lineWeight, 1), 1, 4),
  }
}

function normalizeAudioStyle(
  value: Record<string, unknown>
): CharacterProfileAudioStyle {
  const record = value
  const player = enumString(record.player, ['bar', 'capsule', 'console'], 'capsule')
  return {
    player,
    motion: enumString(record.motion, ['still', 'pulse', 'scan'], 'pulse'),
    tone: enumString(record.tone, ['intimate', 'ambient', 'dramatic'], 'ambient'),
    accent: colorString(record.accent, '#c7d8d0'),
    accentSoft: colorString(record.accentSoft, 'rgba(199, 216, 208, 0.16)'),
    surface: colorString(record.surface, 'rgba(255, 255, 255, 0.032)'),
    track: colorString(record.track, 'rgba(255, 255, 255, 0.14)'),
    border: colorString(record.border, 'rgba(218, 232, 224, 0.18)'),
    text: colorString(record.text, 'rgba(248, 250, 250, 0.78)'),
    radiusPx: clampNumber(numberValue(record.radiusPx, player === 'console' ? 10 : player === 'bar' ? 18 : 999), 6, 999),
    heightPx: clampNumber(numberValue(record.heightPx, player === 'bar' ? 36 : 40), 28, 60),
  }
}

function normalizeSceneStyle(
  value: Record<string, unknown>
): CharacterProfileSceneStyle {
  const record = value
  return {
    frame: enumString(record.frame, ['plain', 'panel', 'ledger', 'instrument'], 'panel'),
    divider: enumString(record.divider, ['line', 'glow', 'none'], 'line'),
    accent: colorString(record.accent, '#c7d8d0'),
    accentSoft: colorString(record.accentSoft, 'rgba(199, 216, 208, 0.16)'),
    surface: colorString(record.surface, 'rgba(7, 8, 9, 0.52)'),
    border: colorString(record.border, 'rgba(218, 232, 224, 0.16)'),
    text: colorString(record.text, 'rgba(248, 250, 250, 0.76)'),
    muted: colorString(record.muted, 'rgba(248, 250, 250, 0.42)'),
    radiusPx: clampNumber(numberValue(record.radiusPx, 14), 8, 32),
  }
}

function normalizeImageStyle(value: Record<string, unknown>): CharacterProfileImageStyle {
  const record = value
  return {
    treatment: enumString(record.treatment, ['portrait', 'artifact', 'cinematic'], 'portrait'),
    accent: colorString(record.accent, '#c7d8d0'),
    border: colorString(record.border, 'rgba(255, 255, 255, 0.10)'),
    shadow: colorString(record.shadow, 'rgba(0, 0, 0, 0.32)'),
    radiusPx: clampNumber(numberValue(record.radiusPx, 12), 6, 30),
    filter: optionalString(record.filter) ?? 'contrast(1.02) saturate(1.02)',
  }
}

function normalizeAtmosphereDesignBrief(value: unknown): CharacterProfileAtmosphereStyle['designBrief'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const record = value as Record<string, unknown>
  const brief = {
    concept: optionalString(record.concept),
    colorSystem: optionalString(record.colorSystem),
    surfaceTreatment: optionalString(record.surfaceTreatment),
    typography: optionalString(record.typography),
    audioTreatment: optionalString(record.audioTreatment),
    sceneTreatment: optionalString(record.sceneTreatment),
  }
  return Object.values(brief).some(Boolean) ? brief : undefined
}

function normalizeAtmospherePreview(value: unknown): CharacterProfileAtmosphereStyle['preview'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const record = value as Record<string, unknown>
  const preview = {
    userLine: optionalString(record.userLine),
    narration: optionalString(record.narration),
    speech: optionalString(record.speech),
  }
  return Object.values(preview).some(Boolean)
    ? preview
    : undefined
}

function normalizeGameSystem(value: unknown): CharacterProfileGameSystem | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const record = value as Record<string, unknown>
  const equipment = recordValue(record.equipment) ?? {}
  const gameSystem: CharacterProfileGameSystem = {
    schemaVersion: 1,
    name: optionalString(record.name) ?? 'Character game system',
    summary: optionalString(record.summary),
    stats: arrayValue(record.stats).map(normalizeGameStat).filter(Boolean) as CharacterProfileGameStat[],
    equipment: {
      slots: arrayValue(equipment.slots).map(normalizeEquipmentSlot).filter(Boolean) as CharacterProfileEquipmentSlot[],
      rules: stringArrayValue(equipment.rules).slice(0, 12),
      acquisitionRules: stringArrayValue(equipment.acquisitionRules).slice(0, 12),
      forbiddenRules: stringArrayValue(equipment.forbiddenRules).slice(0, 12),
    },
    statuses: [],
    rules: stringArrayValue(record.rules).slice(0, 16),
    ui: normalizeGameSystemUi(record.ui, record.panelStyle),
    sourceArtifactId: optionalString(record.sourceArtifactId),
  }
  return gameSystem.stats.length || gameSystem.equipment.slots.length || gameSystem.rules.length
    ? gameSystem
    : undefined
}

function normalizeGameStat(value: unknown): CharacterProfileGameStat | null {
  const record = recordValue(value)
  if (!record) return null
  const id = normalizeIdentifier(record.id, normalizeIdentifier(record.label, 'stat'))
  const label = optionalString(record.label) ?? id
  return {
    id,
    label,
    value: numberValue(record.value, 0),
    min: optionalNumber(record.min),
    max: optionalNumber(record.max),
    unit: optionalString(record.unit),
    tone: optionalString(record.tone),
    description: optionalString(record.description),
    visibility: enumString(record.visibility, ['shown', 'hidden', 'conditional'] as const, 'shown'),
  }
}

function normalizeEquipmentSlot(value: unknown): CharacterProfileEquipmentSlot | null {
  const record = recordValue(value)
  if (!record) return null
  const id = normalizeIdentifier(record.id, normalizeIdentifier(record.label, 'slot'))
  const label = optionalString(record.label) ?? id
  return {
    id,
    label,
    limit: Math.max(1, Math.round(numberValue(record.limit, 1))),
    rule: optionalString(record.rule) ?? '',
    current: arrayValue(record.current).map(normalizeEquipmentItem).filter(Boolean) as CharacterProfileEquipmentItem[],
  }
}

function normalizeEquipmentItem(value: unknown): CharacterProfileEquipmentItem | null {
  const record = recordValue(value)
  if (!record) return null
  const name = optionalString(record.name)
  if (!name) return null
  return {
    id: normalizeIdentifier(record.id, name),
    name,
    description: optionalString(record.description),
    tags: stringArrayValue(record.tags).slice(0, 8),
    quantity: optionalNumber(record.quantity),
    durability: optionalNumber(record.durability),
    effects: stringArrayValue(record.effects).slice(0, 8),
  }
}

function normalizeStatusEffect(value: unknown): CharacterProfileStatusEffect | null {
  const record = recordValue(value)
  if (!record) return null
  const label = optionalString(record.label)
  if (!label) return null
  return {
    id: normalizeIdentifier(record.id, label),
    label,
    value: optionalString(record.value),
    tone: optionalString(record.tone),
    description: optionalString(record.description),
    duration: optionalString(record.duration),
    rule: optionalString(record.rule),
  }
}

function normalizeGameSystemUi(value: unknown, rootPanelStyle?: unknown): CharacterProfileGameSystem['ui'] | undefined {
  const record = recordValue(value)
  const panelStyle = normalizeGamePanelStyle(record?.panelStyle ?? rootPanelStyle)
  if (!record) return panelStyle ? { panelStyle } : undefined
  const quickPanels = stringArrayValue(record.quickPanels)
    .filter((item): item is 'equipment' | 'status' | 'rules' => item === 'equipment' || item === 'status' || item === 'rules')
  return quickPanels.length || panelStyle
    ? { ...(quickPanels.length ? { quickPanels } : {}), ...(panelStyle ? { panelStyle } : {}) }
    : undefined
}

function normalizeGamePanelStyle(value: unknown): CharacterProfileGamePanelStyle | undefined {
  const record = recordValue(value)
  if (!record) return undefined
  const style: CharacterProfileGamePanelStyle = {
    frame: optionalEnumString(record.frame, ['glass', 'dossier', 'ritual', 'noir', 'intimate', 'mist']),
    density: optionalEnumString(record.density, ['compact', 'balanced', 'airy']),
    meter: optionalEnumString(record.meter, ['capsule', 'line', 'etched', 'warm-bar']),
    accent: optionalColorString(record.accent),
    accentSoft: optionalColorString(record.accentSoft),
    surface: optionalColorString(record.surface),
    surfaceAlt: optionalColorString(record.surfaceAlt),
    track: optionalColorString(record.track),
    border: optionalColorString(record.border),
    text: optionalColorString(record.text),
    muted: optionalColorString(record.muted),
    radiusPx: optionalNumber(record.radiusPx),
    cellRadiusPx: optionalNumber(record.cellRadiusPx),
  }
  return Object.values(style).some((item) => item !== undefined) ? style : undefined
}

function normalizeAsset(value: unknown): CharacterProfileAsset | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as Partial<CharacterProfileAsset>
  const id = stringValue(record.id)
  const uri = stringValue(record.uri)
  if (!id || !uri) {
    return null
  }
  const kind = record.kind === 'body' || record.kind === 'overview' || record.kind === 'voice-sample' ||
    record.kind === 'live2d' || record.kind === 'vrm' || record.kind === 'generated-image'
    ? record.kind
    : 'avatar'
  return {
    id,
    kind,
    uri,
    mimeType: optionalString(record.mimeType),
    role: optionalString(record.role),
    metadata: recordValue(record.metadata),
  }
}

function normalizeCompanionProfile(value: unknown): CharacterProfile['companion'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const record = value as NonNullable<CharacterProfile['companion']>
  return {
    speakingStyle: optionalString(record.speakingStyle),
    behaviorRules: Array.isArray(record.behaviorRules) ? record.behaviorRules.filter((item): item is string => typeof item === 'string') : undefined,
    values: Array.isArray(record.values) ? record.values.filter((item): item is string => typeof item === 'string') : undefined,
    personalityTraits: Array.isArray(record.personalityTraits) ? record.personalityTraits.filter((item): item is string => typeof item === 'string') : undefined,
    relationship: record.relationship,
  }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalString(value: unknown): string | undefined {
  const text = stringValue(value)
  return text || undefined
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean)
    : []
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function numberValue(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(number) ? number : fallback
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function optionalNumber(value: unknown): number | undefined {
  const number = numberValue(value, NaN)
  return Number.isFinite(number) ? number : undefined
}

function enumString<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? value as T
    : fallback
}

function optionalEnumString<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? value as T
    : undefined
}

function colorString(value: unknown, fallback: string): string {
  return optionalColorString(value) ?? fallback
}

function optionalColorString(value: unknown): string | undefined {
  const text = stringValue(value)
  if (
    /^#[0-9a-f]{3,8}$/i.test(text) ||
    /^hsla?\(\s*[\d.]+(?:deg|rad|turn)?\s+[\d.]+%\s+[\d.]+%(?:\s*\/\s*(?:[\d.]+|[\d.]+%))?\s*\)$/i.test(text) ||
    /^rgba?\([^)]+\)$/i.test(text)
  ) {
    return text
  }
  return undefined
}

function normalizeIdentifier(value: unknown, fallback: string): string {
  const normalized = stringValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || fallback
}
