/**
 * Renders the chat API and model configuration page.
 */
import claudeIconUrl from '@lobehub/icons-static-svg/icons/claude-color.svg?url'
import azureAIIconUrl from '@lobehub/icons-static-svg/icons/azureai-color.svg?url'
import deepseekIconUrl from '@lobehub/icons-static-svg/icons/deepseek-color.svg?url'
import geminiIconUrl from '@lobehub/icons-static-svg/icons/gemini-color.svg?url'
import groqIconUrl from '@lobehub/icons-static-svg/icons/groq.svg?url'
import newAPIIconUrl from '@lobehub/icons-static-svg/icons/newapi-color.svg?url'
import ollamaIconUrl from '@lobehub/icons-static-svg/icons/ollama.svg?url'
import openAIIconUrl from '@lobehub/icons-static-svg/icons/openai.svg?url'
import qwenIconUrl from '@lobehub/icons-static-svg/icons/qwen-color.svg?url'
import wavespeedLogoUrl from '../assets/wavespeed-dark-logo.png'
import claudeCodeLogoUrl from '../assets/claude_code_logo.png'
import codexLogoUrl from '../assets/codex_logo.png'
/*
 * Hidden image-provider icon imports kept as notes for future re-enablement.
 * Current image provider support is intentionally limited to OpenAI, WaveSpeedAI, and Gemini.
 *
 * import adobeFireflyIconUrl from '@lobehub/icons-static-svg/icons/adobefirefly-color.svg?url'
 * import alibabaCloudIconUrl from '@lobehub/icons-static-svg/icons/alibabacloud-color.svg?url'
 * import automaticIconUrl from '@lobehub/icons-static-svg/icons/automatic-color.svg?url'
 * import baiduCloudIconUrl from '@lobehub/icons-static-svg/icons/baiducloud-color.svg?url'
 * import comfyUIIconUrl from '@lobehub/icons-static-svg/icons/comfyui-color.svg?url'
 * import falIconUrl from '@lobehub/icons-static-svg/icons/fal-color.svg?url'
 * import huggingFaceIconUrl from '@lobehub/icons-static-svg/icons/huggingface-color.svg?url'
 * import ideogramIconUrl from '@lobehub/icons-static-svg/icons/ideogram.svg?url'
 * import recraftIconUrl from '@lobehub/icons-static-svg/icons/recraft.svg?url'
 * import replicateIconUrl from '@lobehub/icons-static-svg/icons/replicate.svg?url'
 * import siliconCloudIconUrl from '@lobehub/icons-static-svg/icons/siliconcloud-color.svg?url'
 * import stabilityIconUrl from '@lobehub/icons-static-svg/icons/stability-color.svg?url'
 * import tencentCloudIconUrl from '@lobehub/icons-static-svg/icons/tencentcloud-color.svg?url'
 * import volcengineIconUrl from '@lobehub/icons-static-svg/icons/volcengine-color.svg?url'
 */
import {
  filterEditCapableImageModelNames,
  IMAGE_PROVIDER_CATALOG,
  LLM_PROVIDER_CATALOG,
  getImageProviderCatalogEntry,
  getLLMProviderCatalogEntry,
  isImageModelEditCapable,
  type ImageProviderType,
  type LLMProviderType,
} from '../../main/model-provider-catalog'

export interface ChatModelConfig {
  id: string
  modelType: 'llm' | 'image'
  provider?: string
  transport?: 'openai_compatible' | 'codex_local' | 'claude_code_local'
  modelName: string
  enabledModels: string[]
  availableModels: string[]
  modelsFetchedAt?: number
  apiKey: string
  baseUrl: string
}

export interface ChatSystemConfig {
  chatModels: ChatModelConfig[]
  taskModels?: Array<{
    id: string
    provider?: string
    transport?: 'openai_compatible' | 'codex_local' | 'claude_code_local'
    modelName: string
    apiKey: string
    baseUrl: string
  }>
  activeChatId: string
  activeChatModelName: string
  [key: string]: unknown
}

export interface ChatModelConfigPageOptions {
  language: 'zh-CN' | 'en-US'
  escapeHtml(value: string): string
  openTypePicker: boolean
  openModelLibraryId: string
  modelLibrarySearch: string
  openProviderDropdownId: string
  visibleApiKeyIds: ReadonlySet<string>
  loadingModelIds: ReadonlySet<string>
  modelOptions: ReadonlyMap<string, string[]>
}

export function createDefaultChatModel(id = 'default-chat', modelType: 'llm' | 'image' = 'llm'): ChatModelConfig {
  const provider = modelType === 'image'
    ? getImageProviderCatalogEntry('openai')
    : getLLMProviderCatalogEntry('openai-compatible')
  return {
    id,
    modelType,
    provider: provider.value,
    modelName: provider.defaultModel,
    enabledModels: provider.defaultModel ? [provider.defaultModel] : [],
    availableModels: [],
    apiKey: '',
    baseUrl: provider.defaultBaseUrl,
  }
}

export function renderChatModelConfigPage(
  config: ChatSystemConfig | null,
  options: ChatModelConfigPageOptions
): string {
  if (!config || config.chatModels.length === 0) {
    return `<div class="chat-model-empty">${options.escapeHtml(options.language === 'zh-CN' ? '暂无 chat 模型配置' : 'No chat model configured')}</div>`
  }

  return `
    <div class="chat-model-list-head">
      <span>${options.escapeHtml(options.language === 'zh-CN' ? 'API 路由' : 'API routes')}</span>
      <small>${options.escapeHtml(options.language === 'zh-CN' ? '管理 LLM / 生图 provider、模型名、密钥和地址。' : 'Manage LLM / image providers, model name, key, and URL.')}</small>
    </div>
    ${options.openTypePicker ? renderChatModelTypePicker(options) : ''}
    ${config.chatModels.map((model) => renderChatModelCard(model, config, options)).join('')}
    ${renderChatModelLibraryModal(config, options)}
  `
}

export function getChatModelType(model: ChatModelConfig | undefined): 'llm' | 'image' {
  return model?.modelType ?? 'llm'
}

export function getActiveChatModelName(config: ChatSystemConfig): string {
  return config.activeChatModelName.trim()
}

export function getEnabledModelNames(model: ChatModelConfig | undefined): string[] {
  if (!model) {
    return []
  }
  const enabled = normalizeModelNameList(model.enabledModels)
  const current = model.modelName?.trim()
  if (model.modelType === 'image' && current) {
    const filtered = filterEditCapableImageModelNames(model.provider, enabled)
    return isImageModelEditCapable(model.provider, current)
      ? [current, ...filtered.filter((name) => name !== current)]
      : filtered
  }
  if (model.modelType === 'image') {
    return filterEditCapableImageModelNames(model.provider, enabled)
  }
  return enabled
}

export function getAvailableModelNames(model: ChatModelConfig): string[] {
  const available = normalizeModelNameList(model.availableModels)
  return model.modelType === 'image'
    ? filterEditCapableImageModelNames(model.provider, available)
    : available
}

export function normalizeModelNameList(value: unknown): string[] {
  const list = Array.isArray(value)
    ? value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean)
    : []
  return [...new Set(list)]
}

export function mergeModelNames(current: unknown, additions: unknown): string[] {
  return normalizeModelNameList([
    ...normalizeModelNameList(current),
    ...normalizeModelNameList(additions),
  ])
}

export function getLLMProviderEntry(provider: string | undefined) {
  return getLLMProviderCatalogEntry(provider as LLMProviderType | undefined)
}

export function getChatProviderEntry(model: ChatModelConfig) {
  return getChatModelType(model) === 'image'
    ? getImageProviderCatalogEntry(model.provider)
    : getLLMProviderEntry(model.provider)
}

export function getChatProviderCatalog(model: ChatModelConfig) {
  return getChatModelType(model) === 'image' ? IMAGE_PROVIDER_CATALOG : LLM_PROVIDER_CATALOG
}

export function renderChatModelLogo(model: ChatModelConfig | undefined): string {
  if (!model) {
    return renderProviderLogo('openai-compatible')
  }
  const provider = getChatProviderEntry(model).value
  return getChatModelType(model) === 'image'
    ? renderImageProviderLogo(provider as ImageProviderType)
    : renderProviderLogo(provider as LLMProviderType)
}

function renderChatModelTypePicker(options: ChatModelConfigPageOptions): string {
  const types: Array<{ value: 'llm' | 'image'; label: string; description: string }> = options.language === 'zh-CN'
    ? [
        { value: 'llm', label: 'LLM 模型', description: '对话、角色回复、文本推理' },
        { value: 'image', label: '生图模型', description: '图片生成、编辑、本地工作流' },
      ]
    : [
        { value: 'llm', label: 'LLM model', description: 'Chat, role replies, text reasoning' },
        { value: 'image', label: 'Image model', description: 'Image generation, editing, local workflows' },
      ]
  return `
    <div class="chat-api-type-picker" role="dialog" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '选择 API 类型' : 'Choose API type')}">
      ${types.map((type) => `
        <button class="chat-api-type-option" type="button" data-chat-add-model-type="${type.value}">
          <span class="chat-model-type-dot ${type.value}"></span>
          <span>
            <strong>${options.escapeHtml(type.label)}</strong>
            <small>${options.escapeHtml(type.description)}</small>
          </span>
        </button>
      `).join('')}
    </div>
  `
}

function renderChatModelCard(
  model: ChatModelConfig,
  config: ChatSystemConfig,
  options: ChatModelConfigPageOptions
): string {
  const canDelete = config.chatModels.length > 1
  const providerEntry = getChatProviderEntry(model)
  const localCli = getLocalLLMTransport(model) !== 'openai_compatible'
  const keyVisible = options.visibleApiKeyIds.has(model.id)
  const keyToggleLabel = keyVisible
    ? (options.language === 'zh-CN' ? '隐藏密钥' : 'Hide key')
    : (options.language === 'zh-CN' ? '显示密钥' : 'Show key')
  return `
    <article class="chat-model-card" data-chat-model-id="${options.escapeHtml(model.id)}">
      <div class="chat-api-config">
        <span class="chat-model-logo">${renderChatModelLogo(model)}</span>
        <div class="chat-api-config-main">
          <div class="chat-api-config-label">
            <span>API</span>
            <strong>${options.escapeHtml(providerEntry.label)}</strong>
          </div>
          ${renderChatProviderSelect(model, options)}
          <div class="chat-model-fields compact">
            <div class="chat-model-field">
              <label>${options.escapeHtml(options.language === 'zh-CN' ? '密钥' : 'Key')}</label>
              <div class="chat-model-secret-field">
                <input class="chat-model-input" type="${keyVisible ? 'text' : 'password'}" data-chat-model-field="apiKey" value="${options.escapeHtml(model.apiKey)}" placeholder="${options.escapeHtml(providerEntry.defaultApiKeyPlaceholder)}" ${localCli ? 'disabled' : ''} />
                <button class="chat-model-secret-toggle ${keyVisible ? 'active' : ''}" type="button" data-chat-model-action="toggle-api-key" aria-pressed="${keyVisible ? 'true' : 'false'}" aria-label="${options.escapeHtml(keyToggleLabel)}" title="${options.escapeHtml(keyToggleLabel)}">${options.escapeHtml(keyVisible ? 'ABC' : '***')}</button>
              </div>
            </div>
            <div class="chat-model-field">
              <label>${options.escapeHtml(options.language === 'zh-CN' ? '地址' : 'URL')}</label>
              <input class="chat-model-input" type="text" data-chat-model-field="baseUrl" value="${options.escapeHtml(model.baseUrl)}" placeholder="${options.escapeHtml(providerEntry.defaultBaseUrl)}" ${localCli ? 'disabled' : ''} />
            </div>
          </div>
        </div>
      </div>
      ${renderChatModelTypeBadge(model, options)}
      ${renderChatApiModelSelector(model, options)}
      <div class="chat-model-actions" aria-label="Model actions">
        ${canDelete ? `<button class="danger" type="button" data-chat-model-action="delete">${options.escapeHtml(options.language === 'zh-CN' ? '移除' : 'Remove')}</button>` : ''}
      </div>
    </article>
  `
}

function renderChatApiModelSelector(model: ChatModelConfig, options: ChatModelConfigPageOptions): string {
  const localCli = getLocalLLMTransport(model) !== 'openai_compatible'
  const availableModels = getAvailableModelNames(model)
  const enabledModels = getEnabledModelNames(model)
  const fetchedLabel = localCli
    ? enabledModels.length
      ? (options.language === 'zh-CN' ? '手动 --model' : 'manual --model')
      : (options.language === 'zh-CN' ? '使用 CLI 默认' : 'Using CLI default')
    : model.modelsFetchedAt
    ? formatModelCacheTime(model.modelsFetchedAt, options.language)
    : (options.language === 'zh-CN' ? '未缓存' : 'No cache')
  const modelCountLabel = options.language === 'zh-CN'
    ? (localCli && !enabledModels.length ? '默认模型' : `${enabledModels.length} 个已启用`)
    : (localCli && !enabledModels.length ? 'Default model' : `${enabledModels.length} enabled`)
  const manualPlaceholder = localCli
    ? (options.language === 'zh-CN' ? '可选 --model 覆盖' : 'optional --model override')
    : getChatProviderEntry(model).defaultModel || 'model-name'
  return `
    <div class="chat-api-models">
      <div class="chat-api-models-head">
        <strong>${options.escapeHtml(options.language === 'zh-CN' ? '模型' : 'Models')}</strong>
        <span>${options.escapeHtml(`${modelCountLabel} · ${fetchedLabel}`)}</span>
        ${localCli ? '' : `<button class="chat-model-fetch inline" type="button" data-chat-model-action="open-model-library">
          ${options.escapeHtml(options.language === 'zh-CN' ? '模型库' : 'Library')}
        </button>
        <button class="chat-model-fetch inline" type="button" data-chat-model-action="get-models">
          ${options.escapeHtml(options.loadingModelIds.has(model.id) ? (options.language === 'zh-CN' ? '刷新中...' : 'Refreshing...') : (availableModels.length ? (options.language === 'zh-CN' ? '刷新' : 'Refresh') : 'Get models'))}
        </button>`}
      </div>
      ${enabledModels.length
        ? `<div class="chat-enabled-models">
            ${enabledModels.map((name) => `
              <span class="chat-enabled-model-chip">
                <strong>${options.escapeHtml(name)}</strong>
                <button type="button" data-chat-model-action="remove-enabled-model" data-chat-model-name="${options.escapeHtml(name)}" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? `移除 ${name}` : `Remove ${name}`)}">×</button>
              </span>
            `).join('')}
          </div>`
        : localCli
          ? `<div class="chat-enabled-models">
              <span class="chat-enabled-model-chip">
                <strong>${options.escapeHtml(options.language === 'zh-CN' ? 'CLI 默认' : 'CLI default')}</strong>
              </span>
            </div>`
        : `<div class="chat-enabled-models empty">${options.escapeHtml(options.language === 'zh-CN' ? '还没有启用模型' : 'No enabled models')}</div>`}
      <div class="chat-api-model-manual">
        <input class="chat-model-input" type="text" data-chat-manual-model-input value="" placeholder="${options.escapeHtml(manualPlaceholder)}" autocomplete="off" />
        <button class="chat-api-model-add-manual" type="button" data-chat-model-action="add-manual-model">${options.escapeHtml(options.language === 'zh-CN' ? '添加' : 'Add')}</button>
      </div>
    </div>
  `
}

export function getLocalLLMTransport(model: ChatModelConfig | undefined): 'openai_compatible' | 'codex_local' | 'claude_code_local' {
  if (model?.modelType === 'image') {
    return 'openai_compatible'
  }
  const entry = getLLMProviderEntry(model?.provider)
  return entry.transport ?? model?.transport ?? 'openai_compatible'
}

function renderChatModelLibraryModal(config: ChatSystemConfig, options: ChatModelConfigPageOptions): string {
  const model = config.chatModels.find((item) => item.id === options.openModelLibraryId)
  if (!model) {
    return ''
  }
  const availableModels = mergeModelNames(getAvailableModelNames(model), options.modelOptions.get(model.id) || [])
  const enabledModels = getEnabledModelNames(model)
  const query = options.modelLibrarySearch.trim().toLowerCase()
  const filteredModels = query
    ? availableModels.filter((name) => name.toLowerCase().includes(query))
    : availableModels
  const loading = options.loadingModelIds.has(model.id)
  const provider = getChatProviderEntry(model)
  const title = options.language === 'zh-CN' ? '选择模型' : 'Choose models'
  const emptyText = availableModels.length
    ? (options.language === 'zh-CN' ? '没有匹配的模型' : 'No matching models')
    : (options.language === 'zh-CN' ? '还没有缓存模型列表，可以刷新后搜索选择。' : 'No cached model list yet. Refresh, then search and choose.')
  return `
    <div class="chat-model-library-backdrop" data-chat-model-action="close-model-library">
      <section class="chat-model-library" role="dialog" aria-modal="true" aria-label="${options.escapeHtml(title)}" data-chat-model-id="${options.escapeHtml(model.id)}">
        <div class="chat-model-library-head">
          <span class="chat-model-logo small">${renderChatModelLogo(model)}</span>
          <span class="chat-model-library-title">
            <strong>${options.escapeHtml(title)}</strong>
            <small>${options.escapeHtml(`${provider.label} · ${enabledModels.length}/${availableModels.length}`)}</small>
          </span>
          <button class="chat-model-library-close" type="button" data-chat-model-action="close-model-library" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '关闭' : 'Close')}">×</button>
        </div>
        <div class="chat-model-library-tools">
          <input class="chat-model-input" type="search" data-chat-model-library-search value="${options.escapeHtml(options.modelLibrarySearch)}" placeholder="${options.escapeHtml(options.language === 'zh-CN' ? '搜索模型...' : 'Search models...')}" autocomplete="off" />
          <button class="chat-model-fetch" type="button" data-chat-model-action="get-models">
            ${options.escapeHtml(loading ? (options.language === 'zh-CN' ? '刷新中...' : 'Refreshing...') : (options.language === 'zh-CN' ? '刷新列表' : 'Refresh'))}
          </button>
        </div>
        ${filteredModels.length
          ? `<div class="chat-model-library-list">
              ${filteredModels.map((name) => `
                <button class="${enabledModels.includes(name) ? 'selected' : ''}" type="button" data-chat-model-action="toggle-enabled-model" data-chat-model-name="${options.escapeHtml(name)}">
                  <span>${enabledModels.includes(name) ? '✓' : ''}</span>
                  <strong>${options.escapeHtml(name)}</strong>
                </button>
              `).join('')}
            </div>`
          : `<div class="chat-model-library-empty">
              <span>${options.escapeHtml(emptyText)}</span>
              ${availableModels.length ? '' : `<button class="chat-model-fetch" type="button" data-chat-model-action="get-models">${options.escapeHtml(options.language === 'zh-CN' ? '获取模型列表' : 'Get models')}</button>`}
            </div>`}
      </section>
    </div>
  `
}

function renderChatModelTypeBadge(model: ChatModelConfig, options: ChatModelConfigPageOptions): string {
  const type = getChatModelType(model)
  const label = type === 'image'
    ? 'IMG'
    : 'LLM'
  return `
    <div class="chat-model-type-badge" aria-label="Model type">
      <strong>${options.escapeHtml(label)}</strong>
    </div>
  `
}

function renderChatProviderSelect(model: ChatModelConfig, options: ChatModelConfigPageOptions): string {
  const current = getChatProviderEntry(model)
  const open = options.openProviderDropdownId === model.id
  return `
    <div class="chat-provider-select ${open ? 'open' : ''}">
      <button class="chat-provider-current" type="button" data-chat-model-action="toggle-providers" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '选择服务商' : 'Choose provider')}">
        <span class="chat-provider-current-icon">${renderChatProviderLogo(model)}</span>
        <span class="chat-provider-current-copy">
          <strong>${options.escapeHtml(current.label)}</strong>
          <small>${options.escapeHtml(current.value)}</small>
        </span>
        <span class="chat-provider-current-chevron"></span>
      </button>
      ${open ? `<div class="chat-provider-menu" aria-label="Provider">
        ${getChatProviderCatalog(model).map((provider) => renderChatProviderOption(provider.value, model, options)).join('')}
      </div>` : ''}
    </div>
  `
}

function renderChatProviderOption(
  provider: LLMProviderType | ImageProviderType,
  model: ChatModelConfig,
  options: ChatModelConfigPageOptions
): string {
  const selected = getChatProviderEntry(model).value === provider
  const entry = getChatModelType(model) === 'image'
    ? getImageProviderCatalogEntry(provider)
    : getLLMProviderCatalogEntry(provider)
  return `
    <button class="chat-provider-option ${selected ? 'selected' : ''}" type="button" title="${options.escapeHtml(entry.label)}" data-chat-provider="${options.escapeHtml(provider)}">
      ${getChatModelType(model) === 'image' ? renderImageProviderLogo(provider as ImageProviderType) : renderProviderLogo(provider as LLMProviderType)}
      <span>
        <strong>${options.escapeHtml(entry.label)}</strong>
        <small>${options.escapeHtml(entry.value)}</small>
      </span>
    </button>
  `
}

function formatModelCacheTime(value: number, language: 'zh-CN' | 'en-US'): string {
  if (!Number.isFinite(value) || value <= 0) {
    return language === 'zh-CN' ? '未缓存' : 'No cache'
  }
  const text = new Date(value).toLocaleString(language === 'zh-CN' ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  return language === 'zh-CN' ? `缓存 ${text}` : `Cached ${text}`
}

function renderChatProviderLogo(model: ChatModelConfig): string {
  const provider = getChatProviderEntry(model).value
  return getChatModelType(model) === 'image'
    ? renderImageProviderLogo(provider as ImageProviderType)
    : renderProviderLogo(provider as LLMProviderType)
}

export function renderProviderLogo(provider: LLMProviderType): string {
  const logo = getProviderLogo(provider)
  return `<img src="${logo.src}" alt="${logo.alt}" />`
}

function renderImageProviderLogo(provider: ImageProviderType): string {
  const logo = getImageProviderLogo(provider)
  return `<img src="${logo.src}" alt="${logo.alt}" />`
}

function getProviderLogo(provider: LLMProviderType): { src: string; alt: string } {
  switch (provider) {
    case 'gemini':
      return { src: geminiIconUrl, alt: 'Gemini' }
    case 'claude':
      return { src: claudeIconUrl, alt: 'Claude' }
    case 'claude-code':
      return { src: claudeCodeLogoUrl, alt: 'Claude Code' }
    case 'codex':
      return { src: codexLogoUrl, alt: 'Codex' }
    case 'qwen':
      return { src: qwenIconUrl, alt: 'Qwen' }
    case 'deepseek':
      return { src: deepseekIconUrl, alt: 'DeepSeek' }
    case 'groq':
      return { src: groqIconUrl, alt: 'Groq' }
    case 'ollama':
      return { src: ollamaIconUrl, alt: 'Ollama' }
    case 'azure-openai':
      return { src: azureAIIconUrl, alt: 'Azure OpenAI' }
    case 'openai-compatible':
      return { src: newAPIIconUrl, alt: 'New API' }
    case 'openai':
    default:
      return { src: openAIIconUrl, alt: 'OpenAI' }
  }
}

function getImageProviderLogo(provider: ImageProviderType): { src: string; alt: string } {
  switch (provider) {
    case 'wavespeed':
      return { src: wavespeedLogoUrl, alt: 'WaveSpeedAI' }
    case 'gemini':
      return { src: geminiIconUrl, alt: 'Gemini' }
    case 'openai':
    default:
      return { src: openAIIconUrl, alt: 'OpenAI Images' }
  }
}

/*
 * Hidden image-provider logo mappings kept for future re-enablement.
 * They are not reachable while IMAGE_PROVIDER_CATALOG is limited to OpenAI, WaveSpeedAI, and Gemini.
 *
 * stability -> stabilityIconUrl, Stability AI
 * replicate -> replicateIconUrl, Replicate
 * fal -> falIconUrl, fal.ai
 * comfyui -> comfyUIIconUrl, ComfyUI
 * automatic1111 -> automaticIconUrl, AUTOMATIC1111
 * aliyun-bailian -> alibabaCloudIconUrl, Alibaba Bailian
 * volcengine-ark -> volcengineIconUrl, Volcengine Ark
 * tencent-hunyuan -> tencentCloudIconUrl, Tencent Hunyuan
 * baidu-qianfan -> baiduCloudIconUrl, Baidu Qianfan
 * siliconflow -> siliconCloudIconUrl, SiliconFlow
 * huggingface -> huggingFaceIconUrl, Hugging Face
 * adobe-firefly -> adobeFireflyIconUrl, Adobe Firefly
 * ideogram -> ideogramIconUrl, Ideogram
 * recraft -> recraftIconUrl, Recraft
 */
