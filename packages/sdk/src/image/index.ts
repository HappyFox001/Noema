/**
 * Image generation runtime for the current supported providers.
 */
import { Buffer } from 'buffer'
import { createProxyFetch } from '../utils/proxy.js'

export {
  IMAGE_PROVIDER_CATALOG,
  getImageProviderCatalogEntry,
  type ImageGenerationConfiguredModel,
  type ImageGenerationResult,
  type ImageProviderApiStyle,
  type ImageProviderCatalogEntry,
  type ImageProviderType,
} from './catalog.js'
import {
  getImageProviderCatalogEntry,
  type ImageGenerationConfiguredModel,
  type ImageGenerationResult,
  type ImageProviderCatalogEntry,
} from './catalog.js'

export interface ImageGenerationArtifact {
  kind: 'image'
  provider: string
  model: string
  prompt: string
  mimeType?: string
  dataUrl?: string
  url?: string
  referenceImages?: string[]
}

interface ImageProviderRequestOptions {
  referenceImages: string[]
  size?: string
}

interface WaveSpeedRequestShape {
  modelName: string
  referenceField: 'image' | 'images' | null
  referenceImages: string[]
  maxSize?: number
  minPixels?: number
  sizeMultiple?: number
  defaultStrength?: number
}

const WAVESPEED_POLL_TIMEOUT_MS = 600_000

export async function generateImageWithConfiguredProvider(options: {
  model: ImageGenerationConfiguredModel
  modelName: string
  prompt: string
  proxyUrl?: string
  referenceImages?: string[]
  size?: string
}): Promise<ImageGenerationResult> {
  const provider = String(options.model.provider || '').trim()
  const entry = getImageProviderCatalogEntry(provider)
  const baseUrl = normalizeBaseUrl(options.model.baseUrl || entry.defaultBaseUrl)
  const modelName = String(options.modelName || options.model.modelName || entry.defaultModel).trim()
  const prompt = options.prompt.trim()
  const referenceImages = (options.referenceImages ?? []).map((item) => item.trim()).filter(Boolean)

  if (!baseUrl) {
    throw new Error(`Image provider ${provider || options.model.id} has no base URL`)
  }
  if (!modelName) {
    throw new Error(`Image provider ${provider || options.model.id} has no model name`)
  }
  if (!prompt) {
    throw new Error('Image generation prompt is empty')
  }

  const fetcher = createProxyFetch(options.proxyUrl)
  const base = { provider: entry.value, model: modelName, prompt }
  const requestOptions: ImageProviderRequestOptions = { referenceImages, size: options.size }

  switch (entry.apiStyle) {
    case 'openai-images':
      return { ...base, ...(await callOpenAIImages(fetcher, entry, baseUrl, options.model.apiKey, modelName, prompt, requestOptions)) }
    case 'wavespeed':
      return { ...base, ...(await callWaveSpeed(fetcher, entry, baseUrl, options.model.apiKey, modelName, prompt, requestOptions)) }
    default:
      throw new Error(`Unsupported image provider API style: ${entry.apiStyle}`)
  }
}

export function createImageGenerationArtifact(result: ImageGenerationResult): ImageGenerationArtifact {
  return {
    kind: 'image',
    provider: result.provider,
    model: result.model,
    prompt: result.prompt,
    ...(result.mimeType ? { mimeType: result.mimeType } : {}),
    ...(result.dataUrl ? { dataUrl: result.dataUrl } : {}),
    ...(result.url ? { url: result.url } : {}),
    ...(result.referenceImages?.length ? { referenceImages: result.referenceImages } : {}),
  }
}

async function callOpenAIImages(
  fetcher: typeof fetch,
  entry: ImageProviderCatalogEntry,
  baseUrl: string,
  apiKey: string,
  modelName: string,
  prompt: string,
  options: ImageProviderRequestOptions
): Promise<Partial<ImageGenerationResult>> {
  const referenceImages = limitReferenceImages(entry, options.referenceImages)
  if (referenceImages.length) {
    assertReferenceModel(
      entry,
      modelName,
      isOpenAIImageEditModel(modelName),
      'Reference images require an OpenAI edit-capable image model such as gpt-image-* or dall-e-2.'
    )
    return callOpenAIImageEdit(fetcher, entry, baseUrl, apiKey, modelName, prompt, {
      ...options,
      referenceImages,
    })
  }

  const gptImage = /^gpt-image/i.test(modelName)
  const response = await fetcher(`${baseUrl}${entry.generatePath}`, {
    method: 'POST',
    headers: jsonAuthHeaders(apiKey),
    body: JSON.stringify({
      model: modelName,
      prompt,
      n: 1,
      size: normalizeOpenAIImageSize(modelName, options.size),
      ...(gptImage ? { output_format: 'png' } : { response_format: 'b64_json' }),
    }),
  })
  const payload = await readResponsePayload(response)
  assertOk(response, payload, 'Image generation failed')
  return imageFromOpenAIShape(payload)
}

async function callOpenAIImageEdit(
  fetcher: typeof fetch,
  entry: ImageProviderCatalogEntry,
  baseUrl: string,
  apiKey: string,
  modelName: string,
  prompt: string,
  options: ImageProviderRequestOptions
): Promise<Partial<ImageGenerationResult>> {
  const form = new FormData()
  form.set('model', modelName)
  form.set('prompt', prompt)
  form.set('n', '1')
  form.set('size', normalizeOpenAIImageSize(modelName, options.size))
  if (/^gpt-image/i.test(modelName)) {
    form.set('output_format', 'png')
  }

  const referenceImages = limitReferenceImages(entry, options.referenceImages)
  for (let index = 0; index < referenceImages.length; index += 1) {
    const image = await loadReferenceImageBlob(fetcher, referenceImages[index], index)
    form.append('image[]', image.blob, image.filename)
  }

  const response = await fetcher(`${baseUrl}/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  const payload = await readResponsePayload(response)
  assertOk(response, payload, 'Image edit failed')
  return {
    ...imageFromOpenAIShape(payload),
    referenceImages,
  }
}

async function callWaveSpeed(
  fetcher: typeof fetch,
  entry: ImageProviderCatalogEntry,
  baseUrl: string,
  apiKey: string,
  modelName: string,
  prompt: string,
  options: ImageProviderRequestOptions
): Promise<Partial<ImageGenerationResult>> {
  const waveSpeedRequest = resolveWaveSpeedRequest(entry, modelName, options)
  const path = `${baseUrl}${entry.generatePath.replace('{model}', waveSpeedRequest.modelName)}`
  const body = buildWaveSpeedRequestBody(prompt, options.size, waveSpeedRequest)

  if (waveSpeedRequest.defaultStrength !== undefined) {
    body.strength = waveSpeedRequest.defaultStrength
  }
  if (waveSpeedRequest.referenceField === 'images') {
    body.images = waveSpeedRequest.referenceImages
  } else if (waveSpeedRequest.referenceField === 'image' && waveSpeedRequest.referenceImages[0]) {
    body.image = waveSpeedRequest.referenceImages[0]
  }

  const response = await fetcher(path, {
    method: 'POST',
    headers: jsonAuthHeaders(apiKey),
    body: JSON.stringify(body),
  })
  const payload = await readResponsePayload(response)
  assertOk(response, payload, 'WaveSpeed image generation failed')

  const submitted = (payload as any).data ?? payload
  const immediate = tryImageFromProviderOutput((submitted as any).outputs ?? submitted, payload)
  if (immediate) {
    return {
      ...immediate,
      ...(waveSpeedRequest.referenceImages.length ? { referenceImages: waveSpeedRequest.referenceImages } : {}),
    }
  }

  const taskId = (submitted as any).id
  const getUrl = (submitted as any).urls?.get || (taskId ? `${baseUrl}/predictions/${encodeURIComponent(taskId)}` : '')
  if (!getUrl) {
    throw new Error('WaveSpeed response did not include an image or prediction id')
  }

  const task = await pollWaveSpeedPrediction(fetcher, baseUrl, getUrl, apiKey, taskId)
  const output = (task as any).data?.outputs ?? (task as any).outputs ?? (task as any).data ?? task
  return {
    ...imageFromProviderOutput(output, task),
    ...(waveSpeedRequest.referenceImages.length ? { referenceImages: waveSpeedRequest.referenceImages } : {}),
  }
}

function limitReferenceImages(entry: ImageProviderCatalogEntry, referenceImages: string[] = []): string[] {
  const normalized = referenceImages.map((item) => item.trim()).filter(Boolean)
  if (!normalized.length) {
    return []
  }
  const referenceCapability = entry.capabilities?.referenceImages
  if (!referenceCapability?.supported) {
    throw new Error(`${entry.label} does not support reference images through this adapter`)
  }
  return normalized.slice(0, Math.max(1, referenceCapability.maxImages))
}

function assertReferenceModel(entry: ImageProviderCatalogEntry, modelName: string, supported: boolean, reason: string): void {
  if (!supported) {
    throw new Error(`${entry.label} model "${modelName}" cannot use reference images. ${reason}`)
  }
}

function isOpenAIImageEditModel(modelName: string): boolean {
  return /^(gpt-image|chatgpt-image|dall-e-2)/i.test(modelName.trim())
}

function resolveWaveSpeedRequest(
  entry: ImageProviderCatalogEntry,
  modelName: string,
  options: { referenceImages?: string[] }
): WaveSpeedRequestShape {
  const normalized = modelName.replace(/^\/+|\/+$/g, '')
  const referenceImages = limitReferenceImages(entry, options.referenceImages)
  const hasReferenceImages = referenceImages.length > 0
  const lower = normalized.toLowerCase()
  const zImage = lower === 'wavespeed-ai/z-image/turbo' || lower.startsWith('wavespeed-ai/z-image/turbo/')

  if (zImage) {
    return {
      modelName: normalized,
      referenceField: hasReferenceImages ? 'image' : null,
      referenceImages: referenceImages.slice(0, 1),
      maxSize: 1536,
      ...(hasReferenceImages ? { defaultStrength: 0.6 } : {}),
    }
  }
  if (lower === 'openai/gpt-image-2/text-to-image') {
    return {
      modelName: hasReferenceImages ? 'openai/gpt-image-2/edit' : normalized,
      referenceField: hasReferenceImages ? 'images' : null,
      referenceImages,
    }
  }
  if (lower === 'openai/gpt-image-2/edit') {
    assertReferenceModel(
      entry,
      modelName,
      hasReferenceImages,
      'Use openai/gpt-image-2/text-to-image for prompt-only requests; the edit endpoint requires reference images.'
    )
    return {
      modelName: normalized,
      referenceField: 'images',
      referenceImages,
    }
  }
  if (hasReferenceImages && /\/image-to-image$|\/img2img$/i.test(normalized)) {
    return {
      modelName: normalized,
      referenceField: 'image',
      referenceImages: referenceImages.slice(0, 1),
    }
  }
  return {
    modelName: normalized,
    referenceField: hasReferenceImages ? resolveWaveSpeedReferenceField(normalized, referenceImages.length) : null,
    referenceImages,
    ...(lower === 'bytedance/seedream-v4.5' ? { minPixels: 2560 * 1440, sizeMultiple: 64 } : {}),
  }
}

function resolveWaveSpeedReferenceField(modelName: string, referenceImageCount: number): 'image' | 'images' {
  if (referenceImageCount <= 1 && !/\/multi$|ideogram-character|character-reference|reference-images/i.test(modelName)) {
    return 'image'
  }
  return 'images'
}

function normalizeOpenAIImageSize(modelName: string, size: string | undefined): string {
  const parsed = parseImageSize(size)
  if (!parsed) {
    return '1024x1024'
  }
  const landscape = parsed.width > parsed.height
  const portrait = parsed.height > parsed.width
  if (/^dall-e-3/i.test(modelName)) {
    return landscape ? '1792x1024' : portrait ? '1024x1792' : '1024x1024'
  }
  if (/^gpt-image/i.test(modelName)) {
    return landscape ? '1536x1024' : portrait ? '1024x1536' : '1024x1024'
  }
  return '1024x1024'
}

function aspectRatioForImageSize(size: string | undefined): string | null {
  const parsed = parseImageSize(size)
  if (!parsed) {
    return null
  }
  const ratio = parsed.width / parsed.height
  const known: Array<[string, number]> = [
    ['1:1', 1],
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['4:3', 4 / 3],
    ['3:4', 3 / 4],
    ['3:2', 3 / 2],
    ['2:3', 2 / 3],
    ['4:5', 4 / 5],
    ['5:4', 5 / 4],
  ]
  return known.reduce((best, item) => (
    Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best
  ))[0]
}

function formatWaveSpeedImageSize(size: string | undefined, request: WaveSpeedRequestShape): string {
  const parsed = parseImageSize(size)
  let width = parsed?.width ?? 1024
  let height = parsed?.height ?? 1024
  const maxSize = request.maxSize

  if (maxSize && (width > maxSize || height > maxSize)) {
    const scale = maxSize / Math.max(width, height)
    width = Math.max(256, Math.round(width * scale))
    height = Math.max(256, Math.round(height * scale))
  }
  if (request.minPixels && width * height < request.minPixels) {
    const scale = Math.sqrt(request.minPixels / (width * height))
    width = roundWaveSpeedDimension(width * scale, request.sizeMultiple)
    height = roundWaveSpeedDimension(height * scale, request.sizeMultiple)
  }
  return `${width}*${height}`
}

function buildWaveSpeedRequestBody(prompt: string, size: string | undefined, request: WaveSpeedRequestShape): Record<string, unknown> {
  if (/^openai\/gpt-image-2\/(?:text-to-image|edit)$/i.test(request.modelName)) {
    return {
      prompt,
      aspect_ratio: aspectRatioForImageSize(size) ?? '1:1',
      resolution: waveSpeedGptImage2Resolution(size),
      quality: 'medium',
      output_format: 'png',
      enable_sync_mode: false,
      enable_base64_output: false,
    }
  }
  return {
    prompt,
    size: formatWaveSpeedImageSize(size, request),
    enable_sync_mode: true,
    enable_base64_output: false,
  }
}

function waveSpeedGptImage2Resolution(size: string | undefined): '1k' | '2k' | '4k' {
  const parsed = parseImageSize(size)
  const maxDimension = Math.max(parsed?.width ?? 1024, parsed?.height ?? 1024)
  if (maxDimension <= 1024) {
    return '1k'
  }
  if (maxDimension <= 2048) {
    return '2k'
  }
  return '4k'
}

function roundWaveSpeedDimension(value: number, multiple = 1): number {
  const rounded = multiple > 1
    ? Math.ceil(value / multiple) * multiple
    : Math.ceil(value)
  return Math.min(8192, Math.max(512, rounded))
}

function parseImageSize(size: string | undefined): { width: number; height: number } | null {
  const match = String(size ?? '').trim().match(/^(\d{2,5})\s*[x*]\s*(\d{2,5})$/i)
  if (!match) {
    return null
  }
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  return { width: Math.round(width), height: Math.round(height) }
}

async function loadReferenceImageBlob(
  fetcher: typeof fetch,
  referenceImage: string,
  index: number
): Promise<{ blob: Blob; filename: string }> {
  const dataUrl = parseDataUrl(referenceImage)
  if (dataUrl) {
    return {
      blob: new Blob([dataUrl.bytes], { type: dataUrl.mimeType }),
      filename: `reference-${index + 1}.${extensionForMimeType(dataUrl.mimeType)}`,
    }
  }

  const response = await fetcher(referenceImage)
  const payloadForError = response.ok ? null : await clonePayloadForError(response)
  assertOk(response, payloadForError, 'Reference image fetch failed')
  const mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/png'
  const bytes = Buffer.from(await response.arrayBuffer())
  return {
    blob: new Blob([bytes], { type: mimeType }),
    filename: `reference-${index + 1}.${extensionForMimeType(mimeType)}`,
  }
}

function parseDataUrl(value: string): { mimeType: string; bytes: Buffer } | null {
  const match = value.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/)
  if (!match) {
    return null
  }
  const mimeType = match[1] || 'image/png'
  const encoded = match[3] || ''
  const bytes = match[2]
    ? Buffer.from(encoded, 'base64')
    : Buffer.from(decodeURIComponent(encoded))
  return { mimeType, bytes }
}

function extensionForMimeType(mimeType: string): string {
  if (/jpe?g/i.test(mimeType)) {
    return 'jpg'
  }
  if (/webp/i.test(mimeType)) {
    return 'webp'
  }
  return 'png'
}

function imageFromOpenAIShape(payload: unknown): Partial<ImageGenerationResult> {
  const first = firstArrayItem((payload as any).data)
  const b64 = first?.b64_json || first?.base64 || first?.image
  const url = first?.url
  if (b64) {
    return { mimeType: 'image/png', dataUrl: `data:image/png;base64,${b64}`, providerResponse: payload }
  }
  if (url) {
    return { url, providerResponse: payload }
  }
  throw new Error('Image response did not include a URL or base64 image')
}

function imageFromProviderOutput(output: unknown, providerResponse: unknown): Partial<ImageGenerationResult> {
  const first = Array.isArray(output) ? firstArrayItem(output) : output
  if (typeof first === 'string' && /^https?:\/\//.test(first)) {
    return { url: first, providerResponse }
  }
  if (typeof first === 'string' && first.length > 256) {
    return {
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${first.replace(/^data:image\/\w+;base64,/, '')}`,
      providerResponse,
    }
  }
  if (first && typeof first === 'object') {
    const item = first as Record<string, any>
    const imageValue = item.image
    const url = item.url || item.image_url || item.imageUrl || item.download_url ||
      (typeof imageValue === 'string' && /^https?:\/\//.test(imageValue) ? imageValue : undefined)
    const b64 = item.b64_json || item.base64 ||
      (typeof imageValue === 'string' && !/^https?:\/\//.test(imageValue) ? imageValue : undefined) ||
      item.data
    if (url) {
      return { url: String(url), providerResponse }
    }
    if (b64) {
      const mimeType = item.mimeType || item.mime_type || 'image/png'
      return {
        mimeType,
        dataUrl: `data:${mimeType};base64,${String(b64).replace(/^data:image\/\w+;base64,/, '')}`,
        providerResponse,
      }
    }
    return imageFromProviderOutput(item.images || item.results || item.output || item.ImageUrls || item.ResultImage, providerResponse)
  }
  throw new Error('Image provider response did not include an image result')
}

function tryImageFromProviderOutput(output: unknown, providerResponse: unknown): Partial<ImageGenerationResult> | null {
  try {
    return imageFromProviderOutput(output, providerResponse)
  } catch {
    return null
  }
}

async function pollWaveSpeedPrediction(
  fetcher: typeof fetch,
  baseUrl: string,
  getUrl: string,
  apiKey: string,
  fallbackTaskId = ''
): Promise<unknown> {
  const task = await pollJson(fetcher, getUrl, { Authorization: `Bearer ${apiKey}` }, (body) => {
    const status = (body as any).data?.status ?? (body as any).status
    return status === 'completed' || status === 'failed' || status === 'canceled'
  }, WAVESPEED_POLL_TIMEOUT_MS)
  const status = (task as any).data?.status ?? (task as any).status
  if (status !== 'completed') {
    const error = (task as any).data?.error ?? (task as any).error
    throw new Error(`WaveSpeed prediction ended with status ${status || 'unknown'}${error ? `: ${error}` : ''}`)
  }

  const taskId = (task as any).data?.id ?? (task as any).id ?? fallbackTaskId
  if (!taskId) {
    return task
  }

  const result = await fetcher(`${baseUrl}/predictions/${encodeURIComponent(taskId)}/result`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  const payload = await readResponsePayload(result)
  assertOk(result, payload, 'WaveSpeed result fetch failed')
  return payload
}

async function pollJson(
  fetcher: typeof fetch,
  url: string,
  headers: Record<string, string> | undefined,
  done: (body: unknown) => boolean,
  timeoutMs: number
): Promise<unknown> {
  const deadline = Date.now() + timeoutMs
  let lastBody: unknown = {}
  while (Date.now() < deadline) {
    const response = await fetcher(url, { headers })
    const body = await readResponsePayload(response)
    assertOk(response, body, 'Image provider poll failed')
    lastBody = body
    if (done(body)) {
      return body
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  throw new Error(`Image provider polling timed out: ${JSON.stringify(lastBody).slice(0, 300)}`)
}

function jsonAuthHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  }
}

function normalizeBaseUrl(value: string): string {
  return String(value || '').trim().replace(/\/+$/, '')
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.startsWith('image/')) {
    const buffer = Buffer.from(await response.arrayBuffer())
    return { mimeType: contentType.split(';')[0], base64: buffer.toString('base64') }
  }

  const text = await response.text()
  if (!text.trim()) {
    return {}
  }
  try {
    return JSON.parse(text)
  } catch {
    return { message: text }
  }
}

async function clonePayloadForError(response: Response): Promise<unknown> {
  try {
    return await readResponsePayload(response.clone())
  } catch {
    return {}
  }
}

function assertOk(response: Response, body: unknown, fallback: string): void {
  if (response.ok) {
    return
  }
  const source = body && typeof body === 'object' ? body as Record<string, any> : {}
  const message = source.error?.message || source.error || source.message || source.detail
  throw new Error(typeof message === 'string' && message.trim() ? message.trim() : `${fallback} with HTTP ${response.status}`)
}

function firstArrayItem(value: unknown): any {
  return Array.isArray(value) && value.length ? value[0] : undefined
}
