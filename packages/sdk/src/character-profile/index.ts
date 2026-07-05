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

export type CharacterAtmosphereSurface = 'glass' | 'paper' | 'noir' | 'mist' | 'velvet' | 'terminal'
export type CharacterAtmosphereDensity = 'compact' | 'balanced' | 'airy'
export type CharacterAtmosphereRadius = 'sharp' | 'soft' | 'round'
export type CharacterAtmosphereAudioPlayer = 'thin-glass-bar' | 'soft-wave-strip' | 'quiet-capsule' | 'dossier-line'

export interface CharacterProfileAtmosphereStyle {
  schemaVersion: 1
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
  palette: {
    accent: string
    accentSoft: string
    surface: CharacterAtmosphereSurface
    warmth: 'cool' | 'neutral' | 'warm'
    contrast: 'low' | 'medium' | 'high'
  }
  message: {
    frame: 'plain' | 'literary-panel' | 'visual-novel' | 'dossier' | 'letter'
    narration: 'soft-prose' | 'cinematic' | 'noir' | 'diary' | 'clinical'
    speech: 'quote-emphasis' | 'quiet-line' | 'stage-dialogue'
    density: CharacterAtmosphereDensity
    radius: CharacterAtmosphereRadius
  }
  audio: {
    player: CharacterAtmosphereAudioPlayer
    motion: 'still' | 'subtle-wave' | 'breath'
    tone: 'near' | 'distant' | 'intimate' | 'formal'
  }
  sceneCard: {
    frame: 'quiet-panel' | 'glass-dossier' | 'paper-note' | 'terminal-readout'
    divider: 'fine-line' | 'soft-band' | 'none'
  }
  preview?: {
    userLine?: string
    narration?: string
    speech?: string
    location?: string
    status?: string[]
    equipment?: Array<{ name: string; ability: string; quantity?: string }>
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
  const palette = recordValue(record.palette) ?? {}
  const message = recordValue(record.message) ?? {}
  const audio = recordValue(record.audio) ?? {}
  const sceneCard = recordValue(record.sceneCard) ?? {}
  return {
    schemaVersion: 1,
    name: optionalString(record.name) ?? 'Character atmosphere',
    summary: optionalString(record.summary),
    mood: stringArrayValue(record.mood).slice(0, 8),
    palette: {
      accent: colorString(palette.accent, '#c7d8d0'),
      accentSoft: colorString(palette.accentSoft, 'rgba(199, 216, 208, 0.16)'),
      surface: enumString(palette.surface, ['glass', 'paper', 'noir', 'mist', 'velvet', 'terminal'], 'glass'),
      warmth: enumString(palette.warmth, ['cool', 'neutral', 'warm'], 'neutral'),
      contrast: enumString(palette.contrast, ['low', 'medium', 'high'], 'medium'),
    },
    message: {
      frame: enumString(message.frame, ['plain', 'literary-panel', 'visual-novel', 'dossier', 'letter'], 'literary-panel'),
      narration: enumString(message.narration, ['soft-prose', 'cinematic', 'noir', 'diary', 'clinical'], 'soft-prose'),
      speech: enumString(message.speech, ['quote-emphasis', 'quiet-line', 'stage-dialogue'], 'quote-emphasis'),
      density: enumString(message.density, ['compact', 'balanced', 'airy'], 'balanced'),
      radius: enumString(message.radius, ['sharp', 'soft', 'round'], 'soft'),
    },
    audio: {
      player: enumString(audio.player, ['thin-glass-bar', 'soft-wave-strip', 'quiet-capsule', 'dossier-line'], 'thin-glass-bar'),
      motion: enumString(audio.motion, ['still', 'subtle-wave', 'breath'], 'subtle-wave'),
      tone: enumString(audio.tone, ['near', 'distant', 'intimate', 'formal'], 'near'),
    },
    sceneCard: {
      frame: enumString(sceneCard.frame, ['quiet-panel', 'glass-dossier', 'paper-note', 'terminal-readout'], 'quiet-panel'),
      divider: enumString(sceneCard.divider, ['fine-line', 'soft-band', 'none'], 'fine-line'),
    },
    preview: normalizeAtmospherePreview(record.preview),
    scopeClass: optionalString(record.scopeClass),
    css: optionalString(record.css),
    designBrief: normalizeAtmosphereDesignBrief(record.designBrief),
    sourceArtifactId: optionalString(record.sourceArtifactId),
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
  const equipment = Array.isArray(record.equipment)
    ? record.equipment
        .map((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return null
          const entry = item as Record<string, unknown>
          const name = optionalString(entry.name)
          const ability = optionalString(entry.ability)
          if (!name || !ability) return null
          return {
            name,
            ability,
            quantity: optionalString(entry.quantity),
          }
        })
        .filter(Boolean) as Array<{ name: string; ability: string; quantity?: string }>
    : undefined
  const preview = {
    userLine: optionalString(record.userLine),
    narration: optionalString(record.narration),
    speech: optionalString(record.speech),
    location: optionalString(record.location),
    status: stringArrayValue(record.status).slice(0, 4),
    equipment,
  }
  return Object.values(preview).some((item) => Array.isArray(item) ? item.length > 0 : Boolean(item))
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
    statuses: arrayValue(record.statuses).map(normalizeStatusEffect).filter(Boolean) as CharacterProfileStatusEffect[],
    rules: stringArrayValue(record.rules).slice(0, 16),
    ui: normalizeGameSystemUi(record.ui),
    sourceArtifactId: optionalString(record.sourceArtifactId),
  }
  return gameSystem.stats.length || gameSystem.equipment.slots.length || gameSystem.statuses.length || gameSystem.rules.length
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

function normalizeGameSystemUi(value: unknown): CharacterProfileGameSystem['ui'] | undefined {
  const record = recordValue(value)
  if (!record) return undefined
  const quickPanels = stringArrayValue(record.quickPanels)
    .filter((item): item is 'equipment' | 'status' | 'rules' => item === 'equipment' || item === 'status' || item === 'rules')
  return quickPanels.length ? { quickPanels } : undefined
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

function optionalNumber(value: unknown): number | undefined {
  const number = numberValue(value, NaN)
  return Number.isFinite(number) ? number : undefined
}

function enumString<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? value as T
    : fallback
}

function colorString(value: unknown, fallback: string): string {
  const text = stringValue(value)
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(text) || /^rgba?\([^)]+\)$/i.test(text)) {
    return text
  }
  return fallback
}

function normalizeIdentifier(value: unknown, fallback: string): string {
  const normalized = stringValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || fallback
}
