/**
 * Provider-specific image generation runtime for configured image models.
 */
import { createHmac, createHash } from 'crypto'
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
import { getImageProviderCatalogEntry, type ImageGenerationConfiguredModel, type ImageGenerationResult, type ImageProviderCatalogEntry } from './catalog.js'

export async function generateImageWithConfiguredProvider(options: {
  model: ImageGenerationConfiguredModel
  modelName: string
  prompt: string
  proxyUrl?: string
}): Promise<ImageGenerationResult> {
  const provider = String(options.model.provider || '').trim()
  const entry = getImageProviderCatalogEntry(provider as any)
  const baseUrl = normalizeBaseUrl(options.model.baseUrl || entry.defaultBaseUrl)
  const modelName = String(options.modelName || options.model.modelName || entry.defaultModel).trim()
  const prompt = options.prompt.trim()
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
  switch (entry.apiStyle) {
    case 'openai-images':
    case 'volcengine-ark-images':
    case 'baidu-qianfan-images':
      return { ...base, ...(await callOpenAIImages(fetcher, entry, baseUrl, options.model.apiKey, modelName, prompt)) }
    case 'recraft':
      return { ...base, ...(await callRecraft(fetcher, entry, baseUrl, options.model.apiKey, modelName, prompt)) }
    case 'google-imagen':
      return { ...base, ...(await callGoogleImagen(fetcher, entry, baseUrl, options.model.apiKey, modelName, prompt)) }
    case 'stability-v2':
      return { ...base, ...(await callStabilityCore(fetcher, entry, baseUrl, options.model.apiKey, prompt)) }
    case 'replicate-predictions':
      return { ...base, ...(await callReplicate(fetcher, baseUrl, options.model.apiKey, modelName, prompt)) }
    case 'fal-run':
      return { ...base, ...(await callFal(fetcher, entry, baseUrl, options.model.apiKey, modelName, prompt)) }
    case 'comfyui-workflow':
      return { ...base, ...(await callComfyUI(fetcher, entry, baseUrl, modelName, prompt)) }
    case 'automatic1111-sdapi':
      return { ...base, ...(await callAutomatic1111(fetcher, entry, baseUrl, options.model.apiKey, modelName, prompt)) }
    case 'dashscope-wanx':
      return { ...base, ...(await callDashScopeWanx(fetcher, entry, baseUrl, options.model.apiKey, modelName, prompt)) }
    case 'adobe-firefly':
      return { ...base, ...(await callAdobeFirefly(fetcher, entry, baseUrl, options.model.apiKey, modelName, prompt)) }
    case 'ideogram':
      return { ...base, ...(await callIdeogram(fetcher, entry, baseUrl, options.model.apiKey, modelName, prompt)) }
    case 'tencent-cloud-action':
      return { ...base, ...(await callTencentHunyuan(fetcher, entry, baseUrl, options.model.apiKey, modelName, prompt)) }
    default:
      throw new Error(`Unsupported image provider API style: ${entry.apiStyle}`)
  }
}

async function callOpenAIImages(
  fetcher: typeof fetch,
  entry: ImageProviderCatalogEntry,
  baseUrl: string,
  apiKey: string,
  modelName: string,
  prompt: string
): Promise<Partial<ImageGenerationResult>> {
  const gptImage = /^gpt-image/i.test(modelName)
  const body: Record<string, unknown> = {
    model: modelName,
    prompt,
    n: 1,
    size: '1024x1024',
    ...(gptImage ? { output_format: 'png' } : { response_format: 'b64_json' }),
  }
  const response = await fetcher(`${baseUrl}${entry.generatePath}`, {
    method: 'POST',
    headers: jsonAuthHeaders(apiKey),
    body: JSON.stringify(body),
  })
  const payload = await readResponsePayload(response)
  assertOk(response, payload, 'Image generation failed')
  return imageFromOpenAIShape(payload)
}

async function callRecraft(
  fetcher: typeof fetch,
  entry: ImageProviderCatalogEntry,
  baseUrl: string,
  apiKey: string,
  modelName: string,
  prompt: string
): Promise<Partial<ImageGenerationResult>> {
  const response = await fetcher(`${baseUrl}${entry.generatePath}`, {
    method: 'POST',
    headers: jsonAuthHeaders(apiKey),
    body: JSON.stringify({
      model: modelName,
      prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
    }),
  })
  const payload = await readResponsePayload(response)
  assertOk(response, payload, 'Recraft image generation failed')
  return imageFromOpenAIShape(payload)
}

async function callGoogleImagen(
  fetcher: typeof fetch,
  entry: ImageProviderCatalogEntry,
  baseUrl: string,
  apiKey: string,
  modelName: string,
  prompt: string
): Promise<Partial<ImageGenerationResult>> {
  const path = entry.generatePath.replace('{model}', encodeURIComponent(modelName))
  const response = await fetcher(`${baseUrl}${path}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1 },
    }),
  })
  const payload = await readResponsePayload(response)
  assertOk(response, payload, 'Google Imagen generation failed')
  const first = firstArrayItem((payload as any).predictions)
  const b64 = first?.bytesBase64Encoded || first?.image?.bytesBase64Encoded
  if (!b64) {
    throw new Error('Google Imagen response did not include image bytes')
  }
  return { mimeType: 'image/png', dataUrl: `data:image/png;base64,${b64}`, providerResponse: payload }
}

async function callStabilityCore(
  fetcher: typeof fetch,
  entry: ImageProviderCatalogEntry,
  baseUrl: string,
  apiKey: string,
  prompt: string
): Promise<Partial<ImageGenerationResult>> {
  const form = new FormData()
  form.set('prompt', prompt)
  form.set('output_format', 'png')
  const response = await fetcher(`${baseUrl}${entry.generatePath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'image/*',
    },
    body: form,
  })
  if (!response.ok) {
    const payload = await readResponsePayload(response)
    assertOk(response, payload, 'Stability image generation failed')
  }
  const mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/png'
  const buffer = Buffer.from(await response.arrayBuffer())
  return { mimeType, dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}` }
}

async function callReplicate(
  fetcher: typeof fetch,
  baseUrl: string,
  apiKey: string,
  modelName: string,
  prompt: string
): Promise<Partial<ImageGenerationResult>> {
  const path = modelName.split('/').length >= 2
    ? `/models/${modelName}/predictions`
    : '/predictions'
  const response = await fetcher(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      ...jsonAuthHeaders(apiKey),
      Prefer: 'wait=60',
    },
    body: JSON.stringify({ input: { prompt } }),
  })
  const payload = await readResponsePayload(response)
  assertOk(response, payload, 'Replicate prediction failed')
  const result = await settlePrediction(fetcher, payload, apiKey)
  return imageFromProviderOutput(result.output ?? result, result)
}

async function callFal(
  fetcher: typeof fetch,
  entry: ImageProviderCatalogEntry,
  baseUrl: string,
  apiKey: string,
  modelName: string,
  prompt: string
): Promise<Partial<ImageGenerationResult>> {
  const response = await fetcher(`${baseUrl}${entry.generatePath.replace('{model}', modelName)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify({ prompt, image_size: 'square_hd', num_images: 1 }),
  })
  const payload = await readResponsePayload(response)
  assertOk(response, payload, 'fal image generation failed')
  return imageFromProviderOutput((payload as any).images ?? payload, payload)
}

async function callComfyUI(
  fetcher: typeof fetch,
  entry: ImageProviderCatalogEntry,
  baseUrl: string,
  modelName: string,
  prompt: string
): Promise<Partial<ImageGenerationResult>> {
  const workflow = parseComfyWorkflow(modelName, prompt)
  const clientId = `noema-${Date.now()}`
  const submit = await fetcher(`${baseUrl}${entry.generatePath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  })
  const submitted = await readResponsePayload(submit)
  assertOk(submit, submitted, 'ComfyUI prompt submission failed')
  const promptId = (submitted as any).prompt_id
  if (!promptId) {
    throw new Error('ComfyUI response did not include prompt_id')
  }
  const history = await pollJson(fetcher, `${baseUrl}/history/${encodeURIComponent(promptId)}`, undefined, (body) => Boolean((body as any)[promptId]), 90_000)
  const image = findComfyImage((history as any)[promptId])
  if (!image) {
    throw new Error('ComfyUI history did not include generated image metadata')
  }
  const query = new URLSearchParams({
    filename: image.filename,
    type: image.type || 'output',
    subfolder: image.subfolder || '',
  })
  const view = await fetcher(`${baseUrl}/view?${query.toString()}`)
  assertOk(view, await clonePayloadForError(view), 'ComfyUI image fetch failed')
  const mimeType = view.headers.get('content-type')?.split(';')[0] || 'image/png'
  const buffer = Buffer.from(await view.arrayBuffer())
  return { mimeType, dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`, providerResponse: submitted }
}

async function callAutomatic1111(
  fetcher: typeof fetch,
  entry: ImageProviderCatalogEntry,
  baseUrl: string,
  apiKey: string,
  modelName: string,
  prompt: string
): Promise<Partial<ImageGenerationResult>> {
  const response = await fetcher(`${baseUrl}${entry.generatePath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      prompt,
      steps: 24,
      width: 1024,
      height: 1024,
      batch_size: 1,
      override_settings: modelName ? { sd_model_checkpoint: modelName } : undefined,
    }),
  })
  const payload = await readResponsePayload(response)
  assertOk(response, payload, 'AUTOMATIC1111 txt2img failed')
  const b64 = firstArrayItem((payload as any).images)
  if (!b64) {
    throw new Error('AUTOMATIC1111 response did not include images')
  }
  return { mimeType: 'image/png', dataUrl: `data:image/png;base64,${String(b64).replace(/^data:image\/\w+;base64,/, '')}`, providerResponse: payload }
}

async function callDashScopeWanx(
  fetcher: typeof fetch,
  entry: ImageProviderCatalogEntry,
  baseUrl: string,
  apiKey: string,
  modelName: string,
  prompt: string
): Promise<Partial<ImageGenerationResult>> {
  const response = await fetcher(`${baseUrl}${entry.generatePath}`, {
    method: 'POST',
    headers: {
      ...jsonAuthHeaders(apiKey),
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({
      model: modelName,
      input: { prompt },
      parameters: { size: '1024*1024', n: 1 },
    }),
  })
  const payload = await readResponsePayload(response)
  assertOk(response, payload, 'DashScope Wanx task creation failed')
  const taskId = (payload as any).output?.task_id
  if (!taskId) {
    return imageFromProviderOutput((payload as any).output, payload)
  }
  const task = await pollJson(fetcher, `${baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
    Authorization: `Bearer ${apiKey}`,
  }, (body) => {
    const status = (body as any).output?.task_status
    return status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELED'
  }, 180_000)
  const status = (task as any).output?.task_status
  if (status !== 'SUCCEEDED') {
    throw new Error(`DashScope Wanx task ended with status ${status || 'unknown'}`)
  }
  return imageFromProviderOutput((task as any).output?.results, task)
}

async function callAdobeFirefly(
  fetcher: typeof fetch,
  entry: ImageProviderCatalogEntry,
  baseUrl: string,
  apiKey: string,
  modelName: string,
  prompt: string
): Promise<Partial<ImageGenerationResult>> {
  const credentials = parseAdobeCredentials(apiKey)
  const response = await fetcher(`${baseUrl}${entry.generatePath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-api-key': credentials.clientId,
      Authorization: `Bearer ${credentials.accessToken}`,
    },
    body: JSON.stringify({
      prompt,
      modelVersion: modelName,
      numVariations: 1,
      size: { width: 1024, height: 1024 },
    }),
  })
  const payload = await readResponsePayload(response)
  assertOk(response, payload, 'Adobe Firefly generation failed')
  return imageFromProviderOutput((payload as any).outputs ?? payload, payload)
}

async function callIdeogram(
  fetcher: typeof fetch,
  entry: ImageProviderCatalogEntry,
  baseUrl: string,
  apiKey: string,
  modelName: string,
  prompt: string
): Promise<Partial<ImageGenerationResult>> {
  const form = new FormData()
  form.set('prompt', prompt)
  form.set('rendering_speed', 'DEFAULT')
  form.set('num_images', '1')
  const response = await fetcher(`${baseUrl}${entry.generatePath}`, {
    method: 'POST',
    headers: {
      'Api-Key': apiKey,
    },
    body: form,
  })
  const payload = await readResponsePayload(response)
  assertOk(response, payload, 'Ideogram generation failed')
  return imageFromProviderOutput((payload as any).data ?? payload, payload)
}

async function callTencentHunyuan(
  fetcher: typeof fetch,
  entry: ImageProviderCatalogEntry,
  baseUrl: string,
  apiKey: string,
  modelName: string,
  prompt: string
): Promise<Partial<ImageGenerationResult>> {
  const credentials = parseTencentCredentials(apiKey)
  const body = JSON.stringify({
    Prompt: prompt,
    Model: modelName,
    Resolution: '1024:1024',
    Num: 1,
  })
  const headers = createTencentTC3Headers({
    secretId: credentials.secretId,
    secretKey: credentials.secretKey,
    host: new URL(baseUrl).host,
    service: 'hunyuan',
    action: 'TextToImage',
    version: credentials.version || '2023-09-01',
    region: credentials.region || 'ap-guangzhou',
    payload: body,
  })
  const response = await fetcher(baseUrl, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body,
  })
  const payload = await readResponsePayload(response)
  assertOk(response, payload, 'Tencent Hunyuan image generation failed')
  return imageFromProviderOutput((payload as any).Response, payload)
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
    return { mimeType: 'image/png', dataUrl: `data:image/png;base64,${first.replace(/^data:image\/\w+;base64,/, '')}`, providerResponse }
  }
  if (first && typeof first === 'object') {
    const item = first as Record<string, any>
    const url = item.url || item.image_url || item.imageUrl || item.download_url
    const b64 = item.b64_json || item.base64 || item.image || item.data
    if (url) {
      return { url: String(url), providerResponse }
    }
    if (b64) {
      return { mimeType: item.mimeType || item.mime_type || 'image/png', dataUrl: `data:${item.mimeType || item.mime_type || 'image/png'};base64,${String(b64).replace(/^data:image\/\w+;base64,/, '')}`, providerResponse }
    }
    return imageFromProviderOutput(item.images || item.results || item.output || item.ImageUrls || item.ResultImage, providerResponse)
  }
  throw new Error('Image provider response did not include an image result')
}

async function settlePrediction(fetcher: typeof fetch, payload: any, apiKey: string): Promise<any> {
  if (payload.status === 'succeeded' || payload.status === 'failed' || payload.status === 'canceled') {
    if (payload.status !== 'succeeded') {
      throw new Error(`Replicate prediction ended with status ${payload.status}`)
    }
    return payload
  }
  const getUrl = payload.urls?.get
  if (!getUrl) {
    return payload
  }
  return pollJson(fetcher, getUrl, { Authorization: `Bearer ${apiKey}` }, (body) => {
    const status = (body as any).status
    return status === 'succeeded' || status === 'failed' || status === 'canceled'
  }, 180_000).then((body: any) => {
    if (body.status !== 'succeeded') {
      throw new Error(`Replicate prediction ended with status ${body.status || 'unknown'}`)
    }
    return body
  })
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

function parseComfyWorkflow(modelName: string, prompt: string): Record<string, unknown> {
  const source = modelName.trim()
  if (!source.startsWith('{')) {
    throw new Error('ComfyUI image model must be a workflow API JSON object with prompt placeholders')
  }
  const parsed = JSON.parse(source.replace(/\{\{\s*prompt\s*\}\}/g, prompt.replace(/"/g, '\\"')))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ComfyUI workflow JSON must be an object')
  }
  return parsed as Record<string, unknown>
}

function findComfyImage(history: any): any | null {
  const outputs = history?.outputs && typeof history.outputs === 'object' ? Object.values(history.outputs) : []
  for (const output of outputs as any[]) {
    const images = Array.isArray(output?.images) ? output.images : []
    if (images[0]?.filename) {
      return images[0]
    }
  }
  return null
}

function parseAdobeCredentials(apiKey: string): { clientId: string; accessToken: string } {
  const parsed = parseCredentialObject(apiKey)
  const clientId = parsed.clientId || parsed.client_id || parsed.apiKey || parsed.api_key
  const accessToken = parsed.accessToken || parsed.access_token || parsed.token
  if (clientId && accessToken) {
    return { clientId, accessToken }
  }
  const [left, ...right] = apiKey.split(':')
  if (left && right.length) {
    return { clientId: left.trim(), accessToken: right.join(':').trim() }
  }
  throw new Error('Adobe Firefly credentials must be JSON {clientId, accessToken} or clientId:accessToken')
}

function parseTencentCredentials(apiKey: string): { secretId: string; secretKey: string; region?: string; version?: string } {
  const parsed = parseCredentialObject(apiKey)
  const secretId = parsed.secretId || parsed.secret_id
  const secretKey = parsed.secretKey || parsed.secret_key
  if (secretId && secretKey) {
    return { secretId, secretKey, region: parsed.region, version: parsed.version }
  }
  const [id, key, region, version] = apiKey.split(':')
  if (id && key) {
    return { secretId: id.trim(), secretKey: key.trim(), region: region?.trim(), version: version?.trim() }
  }
  throw new Error('Tencent Hunyuan credentials must be JSON {secretId, secretKey, region?} or secretId:secretKey[:region]')
}

function createTencentTC3Headers(options: {
  secretId: string
  secretKey: string
  host: string
  service: string
  action: string
  version: string
  region: string
  payload: string
}): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const signedHeaders = 'content-type;host'
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${options.host}\n`
  const hashedRequestPayload = sha256(options.payload)
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, hashedRequestPayload].join('\n')
  const credentialScope = `${date}/${options.service}/tc3_request`
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, credentialScope, sha256(canonicalRequest)].join('\n')
  const secretDate = hmac(`TC3${options.secretKey}`, date)
  const secretService = hmac(secretDate, options.service)
  const secretSigning = hmac(secretService, 'tc3_request')
  const signature = hmacHex(secretSigning, stringToSign)
  return {
    Authorization: `TC3-HMAC-SHA256 Credential=${options.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    Host: options.host,
    'X-TC-Action': options.action,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Version': options.version,
    'X-TC-Region': options.region,
  }
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

function parseCredentialObject(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}

function hmacHex(key: Buffer, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex')
}
