/**
 * Owns conversation preference settings, storage, and settings dialog markup.
 */
export const CHAT_OUTPUT_TOKEN_MIN = 225
export const CHAT_OUTPUT_TOKEN_MAX = 5000
export const CHAT_OUTPUT_TOKEN_STEP = 50
export const CHAT_CONTEXT_TURNS_MIN = 15
export const CHAT_CONTEXT_TURNS_MAX = 30
export const CHAT_SUMMARY_LIMIT_MIN = 0
export const CHAT_SUMMARY_LIMIT_MAX = 24
export const CHAT_SUMMARY_BATCH_MESSAGE_COUNT = 10

export interface ChatConversationSettings {
  textStreaming: boolean
  sceneImmersion: boolean
  language: 'auto' | 'zh-CN' | 'en-US'
  outputTokenBudget: number
  temperature: number
  diversity: number
  shortTermTurns: number
  summaryLimit: number
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
    <div class="chat-settings-stage">
      <section class="chat-settings-intro" aria-label="${options.escapeHtml(zh ? '常规设置' : 'General settings')}">
        <span>${options.escapeHtml(zh ? '偏好' : 'Preferences')}</span>
        <p>${options.escapeHtml(zh
          ? '只影响当前设备上的 chat 对话偏好；不会打断正在进行的对话。'
          : 'Device-local chat preferences. The current conversation stays in place.')}</p>
      </section>

      <div class="chat-settings-toggles">
        ${renderConversationToggle(settings, options, 'textStreaming', zh ? '文字流' : 'Text stream', zh ? '逐字呈现回复' : 'Progressive reveal')}
        ${renderConversationToggle(settings, options, 'sceneImmersion', zh ? '场景化体验' : 'Scene mode', zh ? '引入角色场景与示例' : 'Use character scenes')}
      </div>

      <section class="chat-settings-language-panel">
        <div>
          <span class="chat-settings-section-label">${options.escapeHtml(zh ? '语言' : 'Language')}</span>
          <p>${options.escapeHtml(zh ? '用于角色资料与回复格式。' : 'For profile and response formatting.')}</p>
        </div>
        <label class="chat-settings-select-wrap">
          <select data-chat-setting="language" aria-label="${options.escapeHtml(zh ? '语言' : 'Language')}">
            ${renderConversationLanguageOption(settings, options, 'auto', zh ? '跟随界面' : 'Follow UI')}
            ${renderConversationLanguageOption(settings, options, 'zh-CN', zh ? '简体中文' : 'Simplified Chinese')}
            ${renderConversationLanguageOption(settings, options, 'en-US', zh ? 'English' : 'English')}
          </select>
          <span aria-hidden="true"></span>
        </label>
      </section>

      <section class="chat-settings-budget-panel">
        <div class="chat-settings-panel-head">
          <div>
            <span class="chat-settings-section-label">${options.escapeHtml(zh ? '输出长度' : 'Output length')}</span>
            <p>${options.escapeHtml(zh ? '动态强调本次回复的目标输出 token。' : 'Dynamically emphasizes the target output tokens.')}</p>
          </div>
          <output>${options.escapeHtml(String(settings.outputTokenBudget))}</output>
        </div>
        ${renderConversationRange(options, 'outputTokenBudget', CHAT_OUTPUT_TOKEN_MIN, CHAT_OUTPUT_TOKEN_MAX, CHAT_OUTPUT_TOKEN_STEP, settings.outputTokenBudget, [
          { value: 225, label: zh ? '轻量' : 'Lean' },
          { value: 1000, label: zh ? '日常' : 'Daily' },
          { value: 2500, label: zh ? '长文' : 'Long' },
          { value: 5000, label: zh ? '深记忆' : 'Deep' },
        ])}
      </section>

      <section class="chat-settings-parameter-panel">
        <div class="chat-settings-panel-head compact">
          <div>
            <span class="chat-settings-section-label">${options.escapeHtml(zh ? '参数' : 'Parameters')}</span>
            <p>${options.escapeHtml(zh ? '创作空间与稳定性。' : 'Room and stability.')}</p>
          </div>
          <button type="button" data-chat-setting-reset>${options.escapeHtml(zh ? '重置' : 'Reset')}</button>
        </div>
        <div class="chat-settings-parameter-grid">
          ${renderConversationParameter(settings, options, 'temperature', zh ? '温度' : 'Temperature', zh ? '克制' : 'Precise', zh ? '灵动' : 'Expressive')}
          ${renderConversationParameter(settings, options, 'diversity', zh ? '内容多样性' : 'Diversity', zh ? '稳定' : 'Stable', zh ? '丰富' : 'Varied')}
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
  return outputLength.join('\n')
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

function renderConversationLanguageOption(
  settings: ChatConversationSettings,
  options: ConversationSettingsPageOptions,
  value: ChatConversationSettings['language'],
  label: string
): string {
  return `<option value="${options.escapeHtml(value)}" ${settings.language === value ? 'selected' : ''}>${options.escapeHtml(label)}</option>`
}

function renderConversationRange(
  options: ConversationSettingsPageOptions,
  key: keyof Pick<ChatConversationSettings, 'outputTokenBudget' | 'temperature' | 'diversity'>,
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
