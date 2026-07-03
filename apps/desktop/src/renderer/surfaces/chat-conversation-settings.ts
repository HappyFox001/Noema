/**
 * Owns conversation preference settings, storage, and settings dialog markup.
 */
import { buildRoleplayMediaPolicyPrompt } from '@noema/sdk/chat/conversation-runtime'

export const CHAT_OUTPUT_TOKEN_MIN = 225
export const CHAT_OUTPUT_TOKEN_MAX = 5000
export const CHAT_OUTPUT_TOKEN_STEP = 50
export const CHAT_CONTEXT_TURNS_MIN = 15
export const CHAT_CONTEXT_TURNS_MAX = 30
export const CHAT_SUMMARY_LIMIT_MIN = 0
export const CHAT_SUMMARY_LIMIT_MAX = 24
export const CHAT_SUMMARY_BATCH_MESSAGE_COUNT = 10

export type ChatMediaImageMode = 'off' | 'manual' | 'requested' | 'proactive'
export type ChatMediaVoiceMode = 'off' | 'manual' | 'requested' | 'auto'
export type ChatMediaImageReferenceMode = 'none' | 'character'
export type ChatMediaPersistenceMode = 'turn' | 'permanent'

export interface ChatConversationSettings {
  textStreaming: boolean
  sceneImmersion: boolean
  language: 'auto' | 'zh-CN' | 'en-US'
  outputTokenBudget: number
  temperature: number
  diversity: number
  shortTermTurns: number
  summaryLimit: number
  mediaImageMode: ChatMediaImageMode
  mediaImageModelRef: string
  mediaImageSize: string
  mediaImageReferenceMode: ChatMediaImageReferenceMode
  mediaImagePersistence: ChatMediaPersistenceMode
  mediaVoiceMode: ChatMediaVoiceMode
  mediaTtsModelId: string
  mediaVoiceAutoplay: boolean
  mediaVoicePersistence: ChatMediaPersistenceMode
}

export interface ConversationSettingsPageOptions {
  language: 'zh-CN' | 'en-US'
  escapeHtml(value: string): string
}

export function getDefaultConversationSettings(): ChatConversationSettings {
  return {
    textStreaming: true,
    sceneImmersion: false,
    language: 'auto',
    outputTokenBudget: 450,
    temperature: 0.7,
    diversity: 0.7,
    shortTermTurns: 15,
    summaryLimit: 8,
    mediaImageMode: 'requested',
    mediaImageModelRef: '',
    mediaImageSize: '1024x1024',
    mediaImageReferenceMode: 'character',
    mediaImagePersistence: 'permanent',
    mediaVoiceMode: 'manual',
    mediaTtsModelId: '',
    mediaVoiceAutoplay: false,
    mediaVoicePersistence: 'turn',
  }
}

export function loadConversationSettings(): ChatConversationSettings {
  const defaults = getDefaultConversationSettings()
  try {
    const raw = window.localStorage.getItem('noema.chat.conversationSettings')
    if (!raw) {
      return defaults
    }
    const parsed = JSON.parse(raw) as Partial<ChatConversationSettings>
    return {
      textStreaming: typeof parsed.textStreaming === 'boolean' ? parsed.textStreaming : defaults.textStreaming,
      sceneImmersion: typeof parsed.sceneImmersion === 'boolean' ? parsed.sceneImmersion : defaults.sceneImmersion,
      language: parsed.language === 'zh-CN' || parsed.language === 'en-US' || parsed.language === 'auto' ? parsed.language : defaults.language,
      outputTokenBudget: Number.isFinite(Number(parsed.outputTokenBudget))
        ? clampNumber(Number(parsed.outputTokenBudget), CHAT_OUTPUT_TOKEN_MIN, CHAT_OUTPUT_TOKEN_MAX)
        : defaults.outputTokenBudget,
      temperature: Number.isFinite(Number(parsed.temperature)) ? clampNumber(Number(parsed.temperature), 0, 1) : defaults.temperature,
      diversity: Number.isFinite(Number(parsed.diversity)) ? clampNumber(Number(parsed.diversity), 0, 1) : defaults.diversity,
      shortTermTurns: Number.isFinite(Number(parsed.shortTermTurns))
        ? Math.round(clampNumber(Number(parsed.shortTermTurns), CHAT_CONTEXT_TURNS_MIN, CHAT_CONTEXT_TURNS_MAX))
        : defaults.shortTermTurns,
      summaryLimit: Number.isFinite(Number(parsed.summaryLimit))
        ? Math.round(clampNumber(Number(parsed.summaryLimit), CHAT_SUMMARY_LIMIT_MIN, CHAT_SUMMARY_LIMIT_MAX))
        : defaults.summaryLimit,
      mediaImageMode: isMediaImageMode(parsed.mediaImageMode) ? parsed.mediaImageMode : defaults.mediaImageMode,
      mediaImageModelRef: typeof parsed.mediaImageModelRef === 'string' ? parsed.mediaImageModelRef : defaults.mediaImageModelRef,
      mediaImageSize: normalizeImageSize(parsed.mediaImageSize, defaults.mediaImageSize),
      mediaImageReferenceMode: parsed.mediaImageReferenceMode === 'none' ? 'none' : defaults.mediaImageReferenceMode,
      mediaImagePersistence: parsed.mediaImagePersistence === 'turn' || parsed.mediaImagePersistence === 'permanent'
        ? parsed.mediaImagePersistence
        : defaults.mediaImagePersistence,
      mediaVoiceMode: isMediaVoiceMode(parsed.mediaVoiceMode) ? parsed.mediaVoiceMode : defaults.mediaVoiceMode,
      mediaTtsModelId: typeof parsed.mediaTtsModelId === 'string' ? parsed.mediaTtsModelId : defaults.mediaTtsModelId,
      mediaVoiceAutoplay: typeof parsed.mediaVoiceAutoplay === 'boolean' ? parsed.mediaVoiceAutoplay : defaults.mediaVoiceAutoplay,
      mediaVoicePersistence: parsed.mediaVoicePersistence === 'turn' || parsed.mediaVoicePersistence === 'permanent'
        ? parsed.mediaVoicePersistence
        : defaults.mediaVoicePersistence,
    }
  } catch {
    return defaults
  }
}

export function saveConversationSettings(settings: ChatConversationSettings): void {
  try {
    window.localStorage.setItem('noema.chat.conversationSettings', JSON.stringify(settings))
  } catch {
    // Local storage may be unavailable in restricted renderer contexts.
  }
}

export function renderConversationSettingsPage(
  settings: ChatConversationSettings,
  options: ConversationSettingsPageOptions
): string {
  const zh = options.language === 'zh-CN'
  return `
    <div class="chat-settings-stage chat-settings-page-layout">
      <section class="chat-settings-section chat-settings-language-section" aria-label="${options.escapeHtml(zh ? '语言' : 'Language')}">
        <div class="chat-settings-section-copy">
          <h3>${options.escapeHtml(zh ? '语言' : 'Language')}</h3>
          <p>${options.escapeHtml(zh ? '它会影响字元回复所使用的语言。语言可用性因型号而异。' : 'Controls the language used by character replies. Availability depends on the model.')}</p>
        </div>
        <label class="chat-settings-select-wrap chat-settings-language-select">
          <select data-chat-setting="language" aria-label="${options.escapeHtml(zh ? '语言' : 'Language')}">
            ${renderConversationLanguageOption(settings, options, 'auto', zh ? '跟随界面' : 'Follow UI')}
            ${renderConversationLanguageOption(settings, options, 'zh-CN', zh ? '简体中文' : 'Simplified Chinese')}
            ${renderConversationLanguageOption(settings, options, 'en-US', zh ? 'English' : 'English')}
          </select>
          <span aria-hidden="true"></span>
        </label>
      </section>

      <section class="chat-settings-section chat-settings-parameter-panel">
        <div class="chat-settings-section-head">
          <div class="chat-settings-section-copy">
            <h3>${options.escapeHtml(zh ? '参数' : 'Parameters')}</h3>
            <p>${options.escapeHtml(zh ? '控制回复长度、创造空间与稳定性。' : 'Controls reply length, creative range, and stability.')}</p>
          </div>
          <button type="button" data-chat-setting-reset>${options.escapeHtml(zh ? '重置' : 'Reset')}</button>
        </div>
        <div class="chat-settings-control-card chat-settings-parameter-card">
          <article class="chat-settings-output-control">
            <div class="chat-settings-control-head">
              <div>
                <strong>${options.escapeHtml(zh ? '输出长度' : 'Output length')}</strong>
                <small>${options.escapeHtml(zh ? '动态强调本次回复的目标输出 token。' : 'Target output tokens for this reply.')}</small>
              </div>
              <output>${options.escapeHtml(String(settings.outputTokenBudget))}</output>
            </div>
            ${renderConversationRange(options, 'outputTokenBudget', CHAT_OUTPUT_TOKEN_MIN, CHAT_OUTPUT_TOKEN_MAX, CHAT_OUTPUT_TOKEN_STEP, settings.outputTokenBudget, [
              { value: 225, label: zh ? '轻量' : 'Lean' },
              { value: 1000, label: zh ? '日常' : 'Daily' },
              { value: 2500, label: zh ? '长文' : 'Long' },
              { value: 5000, label: zh ? '深记忆' : 'Deep' },
            ])}
          </article>
          <div class="chat-settings-parameter-grid">
            ${renderConversationParameter(settings, options, 'temperature', zh ? '温度' : 'Temperature', zh ? '克制' : 'Precise', zh ? '灵动' : 'Expressive')}
            ${renderConversationParameter(settings, options, 'diversity', zh ? '内容多样性' : 'Diversity', zh ? '稳定' : 'Stable', zh ? '丰富' : 'Varied')}
          </div>
        </div>
      </section>

      <section class="chat-settings-section chat-settings-basics-panel">
        <div class="chat-settings-section-head">
          <div class="chat-settings-section-copy">
            <h3>${options.escapeHtml(zh ? '常规设置' : 'General settings')}</h3>
            <p>${options.escapeHtml(zh ? '决定回复是一次出现还是逐位出现，以及是否把角色场景融入上下文。' : 'Controls progressive text and whether character scene context is used.')}</p>
          </div>
        </div>
        <div class="chat-settings-control-card chat-settings-list-card">
          <div class="chat-settings-toggles">
            ${renderConversationToggle(settings, options, 'textStreaming', zh ? '文字流' : 'Text stream', zh ? '确定文本是一次出现还是逐位出现。' : 'Choose instant text or progressive reveal.')}
            ${renderConversationToggle(settings, options, 'sceneImmersion', zh ? '场景化体验' : 'Scene mode', zh ? '将角色的场景和范例对话融入上下文中。' : 'Include character scenes and examples in context.')}
          </div>
        </div>
      </section>

      <section class="chat-settings-section chat-settings-media-panel">
        <div class="chat-settings-section-head">
          <div class="chat-settings-section-copy">
            <h3>${options.escapeHtml(zh ? '媒体生成' : 'Media generation')}</h3>
            <p>${options.escapeHtml(zh ? '控制角色扮演中的图片与语音生成时机、参考图和记忆方式。' : 'Controls image and voice timing, references, and memory behavior.')}</p>
          </div>
        </div>
        <div class="chat-settings-control-card chat-settings-media-card">
          <div class="chat-settings-media-grid">
            <article class="chat-settings-media-group">
              <div class="chat-settings-media-group-copy">
                <strong>${options.escapeHtml(zh ? '生图' : 'Images')}</strong>
                <small>${options.escapeHtml(zh ? '控制图片何时生成，以及是否把生成结果作为后续视觉参考。' : 'Controls when images are generated and whether generated results become future visual context.')}</small>
              </div>
              ${renderConversationSelect(settings, options, 'mediaImageMode', zh ? '时机' : 'Timing', [
                { value: 'off', label: zh ? '关闭' : 'Off' },
                { value: 'manual', label: zh ? '仅手动按钮' : 'Manual button' },
                { value: 'requested', label: zh ? '请求时生成' : 'Requested' },
                { value: 'proactive', label: zh ? '自然主动' : 'Natural proactive' },
              ])}
              ${renderConversationSelect(settings, options, 'mediaImageSize', zh ? '尺寸' : 'Size', [
                { value: '1024x1024', label: '1024 x 1024' },
                { value: '1024x1536', label: '1024 x 1536' },
                { value: '1536x1024', label: '1536 x 1024' },
              ])}
              ${renderConversationSelect(settings, options, 'mediaImageReferenceMode', zh ? '参考图' : 'References', [
                { value: 'character', label: zh ? '角色 avatar / body' : 'Character avatar / body' },
                { value: 'none', label: zh ? '不使用参考图' : 'No references' },
              ])}
              ${renderConversationSelect(settings, options, 'mediaImagePersistence', zh ? '上下文' : 'Context', [
                { value: 'permanent', label: zh ? '作为角色记忆参考' : 'As context reference' },
                { value: 'turn', label: zh ? '仅展示' : 'Display only' },
              ])}
            </article>
            <article class="chat-settings-media-group">
              <div class="chat-settings-media-group-copy">
                <strong>${options.escapeHtml(zh ? '语音' : 'Voice')}</strong>
                <small>${options.escapeHtml(zh ? '控制 TTS 何时生成。每轮自动适合沉浸式语音角色扮演。' : 'Controls when TTS is generated. Every reply is intended for immersive spoken roleplay.')}</small>
              </div>
              ${renderConversationSelect(settings, options, 'mediaVoiceMode', zh ? '时机' : 'Timing', [
                { value: 'off', label: zh ? '关闭' : 'Off' },
                { value: 'manual', label: zh ? '仅手动按钮' : 'Manual button' },
                { value: 'requested', label: zh ? '请求时生成' : 'Requested' },
                { value: 'auto', label: zh ? '每轮自动' : 'Every reply' },
              ])}
              ${renderConversationSelect(settings, options, 'mediaVoicePersistence', zh ? '上下文' : 'Context', [
                { value: 'turn', label: zh ? '仅展示' : 'Display only' },
                { value: 'permanent', label: zh ? '作为角色记忆参考' : 'As context reference' },
              ])}
              <label class="chat-settings-field inline-toggle">
                <span>${options.escapeHtml(zh ? '生成后自动播放' : 'Autoplay generated voice')}</span>
                <input type="checkbox" data-chat-setting="mediaVoiceAutoplay" ${settings.mediaVoiceAutoplay ? 'checked' : ''} />
                <i aria-hidden="true"></i>
              </label>
            </article>
          </div>
        </div>
      </section>
    </div>
  `
}

export function buildConversationRequestOptions(settings: ChatConversationSettings): Record<string, unknown> {
  return {
    temperature: settings.temperature,
    top_p: settings.diversity,
    max_tokens: Math.round(settings.outputTokenBudget),
  }
}

export function buildConversationPreferencePrompt(settings: ChatConversationSettings, language: 'zh-CN' | 'en-US'): string {
  const targetTokens = Math.round(settings.outputTokenBudget)
  const outputLength = language === 'zh-CN'
    ? [
      '<conversation_preferences>',
      `本次回复的目标输出长度约为 ${targetTokens} tokens。`,
      `请主动围绕这个 token 预算组织回复的密度、段落数量和叙事推进速度。`,
      '如果用户明确要求更短或更长，以用户本轮要求优先；否则不要明显少于该预算，也不要为了凑长度重复内容。',
      settings.sceneImmersion
        ? '场景化体验已开启：可以使用角色背景、场景信息、示例对话和感官细节来推进故事。'
        : '场景化体验已关闭：不要主动扩写大段场景背景，优先保持直接、紧凑、围绕当前对话。',
      '如果本轮导致当前地点、角色/环境状态或装备栏发生变化，请在回复末尾追加 <scene_update>{"location":"...","status":"🙂 愉悦度 45  ⚡ 兴奋值 22","equipment":[{"name":"装备名称","ability":"能力","quantity":1}]}</scene_update>。只输出发生变化的字段，不要把 scene_update 写进正常叙事。',
      '</conversation_preferences>',
    ]
    : [
      '<conversation_preferences>',
      `Target this reply at roughly ${targetTokens} output tokens.`,
      'Use that token budget to decide density, paragraph count, and narrative pacing.',
      'If the user explicitly asks for a shorter or longer answer, follow the user; otherwise do not undershoot the budget noticeably and do not pad with repetition.',
      settings.sceneImmersion
        ? 'Scene mode is enabled: use character background, scene context, example dialogue, and sensory detail to move the story forward.'
        : 'Scene mode is disabled: do not proactively expand long scene background; stay direct, compact, and centered on the current exchange.',
      'If this turn changes the current location, character/environment status, or equipment, append <scene_update>{"location":"...","status":"🙂 pleasure 45  ⚡ arousal 22","equipment":[{"name":"item name","ability":"ability","quantity":1}]}</scene_update> at the end. Include only changed fields and do not include scene_update in normal prose.',
      '</conversation_preferences>',
    ]
  const mediaPolicy = buildRoleplayMediaPolicyPrompt(buildConversationMediaPolicy(settings), language)
  return [...outputLength, mediaPolicy].filter(Boolean).join('\n')
}

export function buildConversationMediaPolicy(settings: ChatConversationSettings): {
  imageMode: ChatMediaImageMode
  voiceMode: ChatMediaVoiceMode
  imageReferenceMode: ChatMediaImageReferenceMode
  imagePersistence: ChatMediaPersistenceMode
  voicePersistence: ChatMediaPersistenceMode
} {
  return {
    imageMode: settings.mediaImageMode,
    voiceMode: settings.mediaVoiceMode,
    imageReferenceMode: settings.mediaImageReferenceMode,
    imagePersistence: settings.mediaImagePersistence,
    voicePersistence: settings.mediaVoicePersistence,
  }
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.min(max, Math.max(min, value))
}

function renderConversationToggle(
  settings: ChatConversationSettings,
  options: ConversationSettingsPageOptions,
  key: 'textStreaming' | 'sceneImmersion',
  title: string,
  copy: string
): string {
  const checked = settings[key]
  return `
    <label class="chat-settings-toggle-row">
      <span>
        <strong>${options.escapeHtml(title)}</strong>
        <small>${options.escapeHtml(copy)}</small>
      </span>
      <input type="checkbox" data-chat-setting="${key}" ${checked ? 'checked' : ''} />
      <i aria-hidden="true"></i>
    </label>
  `
}

function renderConversationSelect(
  settings: ChatConversationSettings,
  options: ConversationSettingsPageOptions,
  key: keyof Pick<ChatConversationSettings, 'mediaImageMode' | 'mediaImageSize' | 'mediaImageReferenceMode' | 'mediaImagePersistence' | 'mediaVoiceMode' | 'mediaVoicePersistence'>,
  title: string,
  items: Array<{ value: string; label: string }>
): string {
  const selected = String(settings[key] || '')
  return `
    <label class="chat-settings-field">
      <span>${options.escapeHtml(title)}</span>
      <span class="chat-settings-select-shell">
        <select data-chat-setting="${options.escapeHtml(key)}">
          ${items.map((item) => `<option value="${options.escapeHtml(item.value)}" ${item.value === selected ? 'selected' : ''}>${options.escapeHtml(item.label)}</option>`).join('')}
        </select>
        <i aria-hidden="true"></i>
      </span>
    </label>
  `
}

function renderConversationLanguageOption(
  settings: ChatConversationSettings,
  options: ConversationSettingsPageOptions,
  value: ChatConversationSettings['language'],
  label: string
): string {
  return `<option value="${options.escapeHtml(value)}" ${settings.language === value ? 'selected' : ''}>${options.escapeHtml(label)}</option>`
}

export function renderConversationRange(
  options: ConversationSettingsPageOptions,
  key: keyof Pick<ChatConversationSettings, 'outputTokenBudget' | 'temperature' | 'diversity' | 'shortTermTurns' | 'summaryLimit'>,
  min: number,
  max: number,
  step: number,
  value: number,
  markers: Array<{ value: number; label: string }>
): string {
  const progress = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
  return `
    <div class="chat-settings-range" style="--chat-setting-progress: ${progress}%">
      <input type="range" data-chat-setting="${options.escapeHtml(key)}" min="${min}" max="${max}" step="${step}" value="${options.escapeHtml(String(value))}" />
      <div class="chat-settings-range-markers">
        ${markers.map((marker) => `
          <span style="left: ${Math.max(0, Math.min(100, ((marker.value - min) / (max - min)) * 100))}%">
            <b>${options.escapeHtml(String(marker.value))}</b>
            <em>${options.escapeHtml(marker.label)}</em>
          </span>
        `).join('')}
      </div>
    </div>
  `
}

function renderConversationParameter(
  settings: ChatConversationSettings,
  options: ConversationSettingsPageOptions,
  key: 'temperature' | 'diversity',
  title: string,
  minLabel: string,
  maxLabel: string
): string {
  const value = settings[key]
  return `
    <article class="chat-settings-parameter">
      <div>
        <strong>${options.escapeHtml(title)}</strong>
        <output>${options.escapeHtml(value.toFixed(2))}</output>
      </div>
      ${renderConversationRange(options, key, 0, 1, 0.05, value, [
        { value: 0, label: minLabel },
        { value: 1, label: maxLabel },
      ])}
    </article>
  `
}

function normalizeImageSize(value: unknown, fallback: string): string {
  return value === '1024x1024' || value === '1024x1536' || value === '1536x1024' ? value : fallback
}

function isMediaImageMode(value: unknown): value is ChatMediaImageMode {
  return value === 'off' || value === 'manual' || value === 'requested' || value === 'proactive'
}

function isMediaVoiceMode(value: unknown): value is ChatMediaVoiceMode {
  return value === 'off' || value === 'manual' || value === 'requested' || value === 'auto'
}
