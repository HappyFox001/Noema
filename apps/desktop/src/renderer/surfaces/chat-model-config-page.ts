/**
 * Renders the chat API and model configuration page.
 */
import claudeIconUrl from '@lobehub/icons-static-svg/icons/claude-color.svg?url'
import adobeFireflyIconUrl from '@lobehub/icons-static-svg/icons/adobefirefly-color.svg?url'
import alibabaCloudIconUrl from '@lobehub/icons-static-svg/icons/alibabacloud-color.svg?url'
import automaticIconUrl from '@lobehub/icons-static-svg/icons/automatic-color.svg?url'
import azureAIIconUrl from '@lobehub/icons-static-svg/icons/azureai-color.svg?url'
import baiduCloudIconUrl from '@lobehub/icons-static-svg/icons/baiducloud-color.svg?url'
import comfyUIIconUrl from '@lobehub/icons-static-svg/icons/comfyui-color.svg?url'
import deepseekIconUrl from '@lobehub/icons-static-svg/icons/deepseek-color.svg?url'
import falIconUrl from '@lobehub/icons-static-svg/icons/fal-color.svg?url'
import geminiIconUrl from '@lobehub/icons-static-svg/icons/gemini-color.svg?url'
import groqIconUrl from '@lobehub/icons-static-svg/icons/groq.svg?url'
import huggingFaceIconUrl from '@lobehub/icons-static-svg/icons/huggingface-color.svg?url'
import ideogramIconUrl from '@lobehub/icons-static-svg/icons/ideogram.svg?url'
import newAPIIconUrl from '@lobehub/icons-static-svg/icons/newapi-color.svg?url'
import ollamaIconUrl from '@lobehub/icons-static-svg/icons/ollama.svg?url'
import openAIIconUrl from '@lobehub/icons-static-svg/icons/openai.svg?url'
import qwenIconUrl from '@lobehub/icons-static-svg/icons/qwen-color.svg?url'
import recraftIconUrl from '@lobehub/icons-static-svg/icons/recraft.svg?url'
import replicateIconUrl from '@lobehub/icons-static-svg/icons/replicate.svg?url'
import siliconCloudIconUrl from '@lobehub/icons-static-svg/icons/siliconcloud-color.svg?url'
import stabilityIconUrl from '@lobehub/icons-static-svg/icons/stability-color.svg?url'
import tencentCloudIconUrl from '@lobehub/icons-static-svg/icons/tencentcloud-color.svg?url'
import volcengineIconUrl from '@lobehub/icons-static-svg/icons/volcengine-color.svg?url'
import {
  IMAGE_PROVIDER_CATALOG,
  LLM_PROVIDER_CATALOG,
  getImageProviderCatalogEntry,
  getLLMProviderCatalogEntry,
  type ImageProviderType,
  type LLMProviderType,
} from '../../main/model-provider-catalog'

export interface ChatModelConfig {
  id: string
  modelType: 'llm' | 'image'
  provider?: string
  modelName: string
  enabledModels: string[]
  availableModels: string[]
  modelsFetchedAt?: number
  apiKey: string
  baseUrl: string
}

export interface ChatSystemConfig {
  chatModels: ChatModelConfig[]
  activeChatId: string
  activeChatModelName: string
  [key: string]: unknown
}

export interface ChatModelConfigPageOptions {
  language: 'zh-CN' | 'en-US'
  escapeHtml(value: string): string
  openTypePicker: boolean
  openModelDropdownId: string
  openProviderDropdownId: string
  loadingModelIds: ReadonlySet<string>
  modelOptions: ReadonlyMap<string, string[]>
}

export function createDefaultChatModel(id = 'default-chat', modelType: 'llm' | 'image' = 'llm'): ChatModelConfig {
  const provider = modelType === 'image'
    ? getImageProviderCatalogEntry('openai-image')
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
  return normalizeModelNameList(model.enabledModels)
}

export function getAvailableModelNames(model: ChatModelConfig): string[] {
  return normalizeModelNameList(model.availableModels)
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
              <input class="chat-model-input" type="password" data-chat-model-field="apiKey" value="${options.escapeHtml(model.apiKey)}" placeholder="${options.escapeHtml(providerEntry.defaultApiKeyPlaceholder)}" />
            </div>
            <div class="chat-model-field">
              <label>${options.escapeHtml(options.language === 'zh-CN' ? '地址' : 'URL')}</label>
              <input class="chat-model-input" type="text" data-chat-model-field="baseUrl" value="${options.escapeHtml(model.baseUrl)}" placeholder="${options.escapeHtml(providerEntry.defaultBaseUrl)}" />
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
  const type = getChatModelType(model)
  if (type === 'image') {
    return `
      <div class="chat-api-models">
        <div class="chat-api-models-head">
          <strong>${options.escapeHtml(options.language === 'zh-CN' ? '模型' : 'Model')}</strong>
        </div>
        ${renderChatModelCombobox(model, getChatProviderEntry(model).defaultModel || 'model-name', options)}
      </div>
    `
  }

  const availableModels = getAvailableModelNames(model)
  const enabledModels = getEnabledModelNames(model)
  const fetchedLabel = model.modelsFetchedAt
    ? formatModelCacheTime(model.modelsFetchedAt, options.language)
    : (options.language === 'zh-CN' ? '未缓存' : 'No cache')
  const manualName = model.modelName.trim()
  return `
    <div class="chat-api-models">
      <div class="chat-api-models-head">
        <strong>${options.escapeHtml(options.language === 'zh-CN' ? '模型' : 'Models')}</strong>
        <span>${options.escapeHtml(fetchedLabel)}</span>
        <button class="chat-model-fetch inline" type="button" data-chat-model-action="get-models">
          ${options.escapeHtml(options.loadingModelIds.has(model.id) ? (options.language === 'zh-CN' ? '刷新中...' : 'Refreshing...') : (availableModels.length ? (options.language === 'zh-CN' ? '刷新' : 'Refresh') : 'Get models'))}
        </button>
      </div>
      ${availableModels.length
        ? `<div class="chat-api-model-options">
            ${availableModels.map((name) => `
              <button class="${enabledModels.includes(name) ? 'selected' : ''}" type="button" data-chat-model-action="toggle-enabled-model" data-chat-model-name="${options.escapeHtml(name)}">
                <span>${enabledModels.includes(name) ? '✓' : ''}</span>
                <strong>${options.escapeHtml(name)}</strong>
              </button>
            `).join('')}
          </div>`
        : `<div class="chat-api-model-manual">
            ${renderChatModelCombobox(model, getChatProviderEntry(model).defaultModel || 'model-name', options)}
            <small>${options.escapeHtml(options.language === 'zh-CN' ? '可手动输入一个模型，或点击 Get models 获取并缓存列表。' : 'Enter one model manually, or click Get models to fetch and cache the list.')}</small>
          </div>`}
      ${manualName && availableModels.length && !availableModels.includes(manualName)
        ? `<button class="chat-api-model-add-manual" type="button" data-chat-model-action="toggle-enabled-model" data-chat-model-name="${options.escapeHtml(manualName)}">${options.escapeHtml(options.language === 'zh-CN' ? `添加手动模型：${manualName}` : `Add manual model: ${manualName}`)}</button>`
        : ''}
    </div>
  `
}

function renderChatModelTypeBadge(model: ChatModelConfig, options: ChatModelConfigPageOptions): string {
  const type = getChatModelType(model)
  const label = type === 'image'
    ? (options.language === 'zh-CN' ? '生图模型' : 'Image')
    : 'LLM'
  return `
    <div class="chat-model-type-badge" aria-label="Model type">
      <span class="chat-model-type-dot ${type}"></span>
      <strong>${options.escapeHtml(label)}</strong>
    </div>
  `
}

function renderChatModelCombobox(
  model: ChatModelConfig,
  placeholder: string,
  options: ChatModelConfigPageOptions
): string {
  const open = options.openModelDropdownId === model.id
  return `
    <div class="chat-model-combo ${open ? 'open' : ''}">
      <input class="chat-model-input" type="text" data-chat-model-field="modelName" value="${options.escapeHtml(model.modelName)}" placeholder="${options.escapeHtml(placeholder)}" autocomplete="off" />
      <button class="chat-model-combo-trigger" type="button" data-chat-model-action="toggle-models" aria-label="${options.escapeHtml(options.language === 'zh-CN' ? '选择模型' : 'Choose model')}"></button>
      ${open ? renderChatModelDropdown(model, options) : ''}
    </div>
  `
}

function renderChatModelDropdown(model: ChatModelConfig, options: ChatModelConfigPageOptions): string {
  if (getChatModelType(model) === 'image') {
    return `
      <div class="chat-model-dropdown">
        <span class="chat-model-dropdown-empty">${options.escapeHtml(options.language === 'zh-CN' ? '生图模型请按厂商文档手动填写模型名或工作流名称。' : 'For image models, enter the model or workflow name manually.')}</span>
      </div>
    `
  }
  const loading = options.loadingModelIds.has(model.id)
  const models = options.modelOptions.get(model.id) || []
  const emptyText = options.language === 'zh-CN'
    ? '可手动输入，或从接口拉取模型列表。'
    : 'Type manually, or fetch available models.'
  return `
    <div class="chat-model-dropdown">
      <button class="chat-model-fetch" type="button" data-chat-model-action="get-models">
        ${options.escapeHtml(loading ? (options.language === 'zh-CN' ? '获取中...' : 'Loading...') : 'Get models')}
      </button>
      ${models.length
        ? `<div class="chat-model-options">
            ${models.map((name) => `
              <button type="button" data-chat-model-action="choose-model" data-chat-model-name="${options.escapeHtml(name)}">
                ${options.escapeHtml(name)}
              </button>
            `).join('')}
          </div>`
        : `<span class="chat-model-dropdown-empty">${options.escapeHtml(emptyText)}</span>`}
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
    case 'google-imagen':
      return { src: geminiIconUrl, alt: 'Google Imagen' }
    case 'stability':
      return { src: stabilityIconUrl, alt: 'Stability AI' }
    case 'replicate':
      return { src: replicateIconUrl, alt: 'Replicate' }
    case 'fal':
      return { src: falIconUrl, alt: 'fal.ai' }
    case 'comfyui':
      return { src: comfyUIIconUrl, alt: 'ComfyUI' }
    case 'automatic1111':
      return { src: automaticIconUrl, alt: 'AUTOMATIC1111' }
    case 'aliyun-bailian':
      return { src: alibabaCloudIconUrl, alt: '阿里云百炼' }
    case 'volcengine-ark':
      return { src: volcengineIconUrl, alt: '火山方舟' }
    case 'tencent-hunyuan':
      return { src: tencentCloudIconUrl, alt: '腾讯混元' }
    case 'baidu-qianfan':
      return { src: baiduCloudIconUrl, alt: '百度千帆' }
    case 'siliconflow':
      return { src: siliconCloudIconUrl, alt: 'SiliconFlow' }
    case 'huggingface':
      return { src: huggingFaceIconUrl, alt: 'Hugging Face' }
    case 'adobe-firefly':
      return { src: adobeFireflyIconUrl, alt: 'Adobe Firefly' }
    case 'ideogram':
      return { src: ideogramIconUrl, alt: 'Ideogram' }
    case 'recraft':
      return { src: recraftIconUrl, alt: 'Recraft' }
    case 'openai-image':
    default:
      return { src: openAIIconUrl, alt: 'OpenAI Images' }
  }
}
