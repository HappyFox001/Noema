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

export async function generateImageWithConfiguredProvider(options: {
  model: ImageGenerationConfiguredModel
  modelName: string
  prompt: string
  proxyUrl?: string
  referenceImages?: string[]
  size?: string
}): Promise<ImageGenerationResult> {
  const provider = String(options.model.provider || '').trim()
  const entry = getImageProviderCatalogEntry(provider as any)
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
  const requestOptions: ImageProviderRequestOptions = {
    referenceImages,
    size: options.size,
  }
  switch (entry.apiStyle) {
    case 'openai-images':
    case 'volcengine-ark-images':
    case 'baidu-qianfan-images':
      return { ...base, ...(await callOpenAIImages(fetcher, entry, baseUrl, options.model.apiKey, modelName, prompt, requestOptions)) }
    case 'recraft':
      return { ...base, ...(await callRecraft(fetcher, entry, baseUrl, options.model.apiKey, modelName, prompt, requestOptions)) }
    case 'google-imagen':
      return { ...base, ...(await callGoogleImagen(fetcher, entry, baseUrl, options.model.apiKey, modelName, prompt, requestOptions)) }
    case 'stability-v2':
      return { ...base, ...(await callStabilityCore(fetcher, entry, baseUrl, options.model.apiKey, modelName, prompt, requestOptions)) }
    case 'replicate-predictions':
      return { ...base, ...(await callReplicate(fetcher, entry, baseUrl, options.model.apiKey, modelName, prompt, requestOptions)) }
    case 'fal-run':
      return { ...base, ...(await callFal(fetcher, entry, baseUrl, options.model.apiKey, modelName, prompt, requestOptions)) }
    case 'comfyui-workflow':
      return { ...base, ...(await callComfyUI(fetcher, entry, baseUrl, modelName, prompt, requestOptions)) }
    case 'automatic1111-sdapi':
      return { ...base, ...(await callAutomatic1111(fetcher, entry, baseUrl, options.model.apiKey, modelName, prompt, requestOptions)) }
    case 'dashscope-wanx':
      return { ...base, ...(await callDashScopeWanx(fetcher, entry, baseUrl, options.model.apiKey, modelName, prompt, requestOptions)) }
    case 'adobe-firefly':
      return { ...base, ...(await callAdobeFirefly(fetcher, entry, baseUrl, options.model.apiKey, modelName, prompt, requestOptions)) }
    case 'ideogram':
      return { ...base, ...(await callIdeogram(fetcher, entry, baseUrl, options.model.apiKey, modelName, prompt, requestOptions)) }
    case 'wavespeed':
      return { ...base, ...(await callWaveSpeed(fetcher, entry, baseUrl, options.model.apiKey, modelName, prompt, requestOptions)) }
    case 'tencent-cloud-action':
      return { ...base, ...(await callTencentHunyuan(fetcher, entry, baseUrl, options.model.apiKey, modelName, prompt, requestOptions)) }
    case 'huggingface-inference':
      return { ...base, ...(await callHuggingFaceInference(fetcher, entry, baseUrl, options.model.apiKey, modelName, prompt, requestOptions)) }
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
  if (referenceImages.length && entry.capabilities?.referenceImages?.mode === 'multipart-edit') {
    if (entry.value === 'openai-image') {
      assertReferenceModel(
        entry,
        modelName,
        isOpenAIImageEditModel(modelName),
        'Reference images require an OpenAI edit-capable image model such as gpt-image-* or dall-e-2.'
      )
    }
    return callOpenAIImageEdit(fetcher, entry, baseUrl, apiKey, modelName, prompt, {
      ...options,
      referenceImages,
    })
  }
  if (referenceImages.length && entry.value === 'volcengine-ark') {
    assertReferenceModel(
      entry,
      modelName,
      isVolcengineReferenceModel(modelName),
      'Reference images require a Volcengine image model/endpoint that explicitly supports image-to-image or visual reference input.'
    )
  }
  const jsonReferenceImages = entry.capabilities?.referenceImages?.mode === 'json-images'
    ? referenceImages
    : []
  const gptImage = /^gpt-image/i.test(modelName)
  const body: Record<string, unknown> = {
    model: modelName,
    prompt,
    n: 1,
    size: entry.value === 'openai-image'
      ? normalizeOpenAIImageSize(modelName, options.size)
      : formatProviderImageSize(options.size, 'x', '1024x1024'),
    ...(jsonReferenceImages.length ? openAICompatibleReferencePayload(entry, jsonReferenceImages) : {}),
    ...(gptImage ? { output_format: 'png' } : { response_format: 'b64_json' }),
  }
  const response = await fetcher(`${baseUrl}${entry.generatePath}`, {
    method: 'POST',
    headers: jsonAuthHeaders(apiKey),
    body: JSON.stringify(body),
  })
  const payload = await readResponsePayload(response)
  assertOk(response, payload, 'Image generation failed')
  return {
    ...imageFromOpenAIShape(payload),
    ...(jsonReferenceImages.length ? { referenceImages: jsonReferenceImages } : {}),
  }
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
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  })
  const payload = await readResponsePayload(response)
  assertOk(response, payload, 'Image edit failed')
  return {
    ...imageFromOpenAIShape(payload),
    referenceImages,
  }
}

async function callRecraft(
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
    const form = new FormData()
    form.set('model', modelName)
    form.set('prompt', prompt)
    form.set('n', '1')
    form.set('size', formatProviderImageSize(options.size, 'x', '1024x1024'))
    const image = await loadReferenceImageBlob(fetcher, referenceImages[0], 0)
    form.append('image', image.blob, image.filename)
    const response = await fetcher(`${baseUrl}/images/edits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    })
    const payload = await readResponsePayload(response)
    assertOk(response, payload, 'Recraft image edit failed')
    return {
      ...imageFromOpenAIShape(payload),
      referenceImages,
    }
  }
  const response = await fetcher(`${baseUrl}${entry.generatePath}`, {
    method: 'POST',
    headers: jsonAuthHeaders(apiKey),
    body: JSON.stringify({
      model: modelName,
      prompt,
      n: 1,
      size: formatProviderImageSize(options.size, 'x', '1024x1024'),
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
  prompt: string,
  options: ImageProviderRequestOptions
): Promise<Partial<ImageGenerationResult>> {
  rejectReferenceImages(entry, modelName, options.referenceImages, 'Google Imagen adapter currently exposes text-to-image generation only. Use a Gemini/Nano Banana style reference-capable adapter for image references.')
  const aspectRatio = aspectRatioForProvider(options.size)
  const path = entry.generatePath.replace('{model}', encodeURIComponent(modelName))
  const response = await fetcher(`${baseUrl}${path}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        ...(aspectRatio ? { aspectRatio } : {}),
      },
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
  modelName: string,
  prompt: string,
  options: ImageProviderRequestOptions
): Promise<Partial<ImageGenerationResult>> {
  const form = new FormData()
  form.set('prompt', prompt)
  form.set('output_format', 'png')
  const aspectRatio = aspectRatioForProvider(options.size)
  if (aspectRatio) {
    form.set('aspect_ratio', aspectRatio)
  }
  const referenceImages = limitReferenceImages(entry, options.referenceImages)
  const path = resolveStabilityPath(entry, modelName, referenceImages.length > 0)
  for (let index = 0; index < referenceImages.length; index += 1) {
    const image = await loadReferenceImageBlob(fetcher, referenceImages[index], index)
    form.append(index === 0 ? 'image' : `image_${index + 1}`, image.blob, image.filename)
  }
  const response = await fetcher(`${baseUrl}${path}`, {
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
  return {
    mimeType,
    dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
    ...(referenceImages.length ? { referenceImages } : {}),
  }
}

async function callReplicate(
  fetcher: typeof fetch,
  entry: ImageProviderCatalogEntry,
  baseUrl: string,
  apiKey: string,
  modelName: string,
  prompt: string,
  options: ImageProviderRequestOptions
): Promise<Partial<ImageGenerationResult>> {
  const size = parseImageSize(options.size)
  const referenceImages = limitReferenceImages(entry, options.referenceImages)
  const input: Record<string, unknown> = {
    prompt,
    ...(size ? { width: size.width, height: size.height, image_size: `${size.width}x${size.height}` } : {}),
    ...(referenceImages[0] ? {
      image: referenceImages[0],
      input_image: referenceImages[0],
      reference_image: referenceImages[0],
      reference_images: referenceImages,
    } : {}),
  }
  const path = modelName.split('/').length >= 2
    ? `/models/${modelName}/predictions`
    : '/predictions'
  const response = await fetcher(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      ...jsonAuthHeaders(apiKey),
      Prefer: 'wait=60',
    },
    body: JSON.stringify({ input }),
  })
  const payload = await readResponsePayload(response)
  assertOk(response, payload, 'Replicate prediction failed')
  const result = await settlePrediction(fetcher, payload, apiKey)
  return {
    ...imageFromProviderOutput(result.output ?? result, result),
    ...(referenceImages.length ? { referenceImages } : {}),
  }
}

async function callFal(
  fetcher: typeof fetch,
  entry: ImageProviderCatalogEntry,
  baseUrl: string,
  apiKey: string,
  modelName: string,
  prompt: string,
  options: ImageProviderRequestOptions
): Promise<Partial<ImageGenerationResult>> {
  const referenceImages = resolveFalReferenceImages(entry, modelName, options.referenceImages)
  const resolvedModelName = resolveFalModelName(modelName)
  const body: Record<string, unknown> = {
    prompt,
    image_size: formatFalImageSize(options.size),
    num_images: 1,
    ...(referenceImages.length ? falReferencePayload(modelName, referenceImages) : {}),
  }
  const response = await fetcher(`${baseUrl}${entry.generatePath.replace('{model}', resolvedModelName)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  const payload = await readResponsePayload(response)
  assertOk(response, payload, 'fal image generation failed')
  return {
    ...imageFromProviderOutput((payload as any).images ?? payload, payload),
    ...(referenceImages.length ? { referenceImages } : {}),
  }
}

async function callComfyUI(
  fetcher: typeof fetch,
  entry: ImageProviderCatalogEntry,
  baseUrl: string,
  modelName: string,
  prompt: string,
  options: ImageProviderRequestOptions
): Promise<Partial<ImageGenerationResult>> {
  const workflow = parseComfyWorkflow(modelName, prompt, options)
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
  prompt: string,
  options: ImageProviderRequestOptions
): Promise<Partial<ImageGenerationResult>> {
  const size = parseImageSize(options.size)
  const referenceImages = limitReferenceImages(entry, options.referenceImages)
  const isImg2Img = referenceImages.length > 0
  const body: Record<string, unknown> = {
    prompt,
    steps: 24,
    width: size?.width ?? 1024,
    height: size?.height ?? 1024,
    batch_size: 1,
    override_settings: modelName ? { sd_model_checkpoint: modelName } : undefined,
  }
  if (isImg2Img) {
    body.init_images = [await loadReferenceImageBase64(fetcher, referenceImages[0])]
    body.denoising_strength = 0.55
  }
  const response = await fetcher(`${baseUrl}${isImg2Img ? '/sdapi/v1/img2img' : entry.generatePath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const payload = await readResponsePayload(response)
  assertOk(response, payload, `AUTOMATIC1111 ${isImg2Img ? 'img2img' : 'txt2img'} failed`)
  const b64 = firstArrayItem((payload as any).images)
  if (!b64) {
    throw new Error('AUTOMATIC1111 response did not include images')
  }
  return {
    mimeType: 'image/png',
    dataUrl: `data:image/png;base64,${String(b64).replace(/^data:image\/\w+;base64,/, '')}`,
    providerResponse: payload,
    ...(referenceImages.length ? { referenceImages } : {}),
  }
}

async function callDashScopeWanx(
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
    return callDashScopeMultimodalImageEdit(fetcher, entry, baseUrl, apiKey, modelName, prompt, options, referenceImages)
  }
  const response = await fetcher(`${baseUrl}${entry.generatePath}`, {
    method: 'POST',
    headers: {
      ...jsonAuthHeaders(apiKey),
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({
      model: modelName,
      input: { prompt },
      parameters: { size: formatProviderImageSize(options.size, 'asterisk', '1024*1024'), n: 1 },
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

async function callDashScopeMultimodalImageEdit(
  fetcher: typeof fetch,
  entry: ImageProviderCatalogEntry,
  baseUrl: string,
  apiKey: string,
  modelName: string,
  prompt: string,
  options: ImageProviderRequestOptions,
  referenceImages: string[]
): Promise<Partial<ImageGenerationResult>> {
  assertReferenceModel(
    entry,
    modelName,
    isDashScopeReferenceModel(modelName),
    'Reference images require a Qwen Image 2.0 or Qwen Image Edit model.'
  )
  assertDashScopeReferenceBaseUrl(baseUrl)
  const content = [
    ...referenceImages.map((image) => ({ image })),
    { text: prompt },
  ]
  const response = await fetcher(`${baseUrl}${dashScopeMultimodalGenerationPath(baseUrl)}`, {
    method: 'POST',
    headers: jsonAuthHeaders(apiKey),
    body: JSON.stringify({
      model: modelName,
      input: {
        messages: [{ role: 'user', content }],
      },
      parameters: {
        n: 1,
        prompt_extend: true,
        watermark: false,
        size: formatProviderImageSize(options.size, 'asterisk', '1024*1024'),
      },
    }),
  })
  const payload = await readResponsePayload(response)
  assertOk(response, payload, 'DashScope Qwen image edit failed')
  const output = (payload as any).output
  return {
    ...imageFromProviderOutput(output?.choices?.[0]?.message?.content ?? output?.results ?? output ?? payload, payload),
    referenceImages,
  }
}

async function callAdobeFirefly(
  fetcher: typeof fetch,
  entry: ImageProviderCatalogEntry,
  baseUrl: string,
  apiKey: string,
  modelName: string,
  prompt: string,
  options: ImageProviderRequestOptions
): Promise<Partial<ImageGenerationResult>> {
  rejectReferenceImages(entry, modelName, options.referenceImages, 'Adobe Firefly references require the Firefly upload/reference-image flow, which is not represented by this text-to-image adapter yet.')
  const credentials = parseAdobeCredentials(apiKey)
  const size = parseImageSize(options.size)
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
      size: { width: size?.width ?? 1024, height: size?.height ?? 1024 },
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
  prompt: string,
  options: ImageProviderRequestOptions
): Promise<Partial<ImageGenerationResult>> {
  const referenceImages = limitReferenceImages(entry, options.referenceImages)
  const form = new FormData()
  form.set('prompt', prompt)
  form.set('rendering_speed', 'DEFAULT')
  form.set('num_images', '1')
  const aspectRatio = aspectRatioForProvider(options.size)
  if (aspectRatio) {
    form.set('aspect_ratio', aspectRatio)
  }
  for (let index = 0; index < referenceImages.length; index += 1) {
    const image = await loadReferenceImageBlob(fetcher, referenceImages[index], index)
    form.append('character_reference_images', image.blob, image.filename)
  }
  const response = await fetcher(`${baseUrl}${entry.generatePath}`, {
    method: 'POST',
    headers: {
      'Api-Key': apiKey,
    },
    body: form,
  })
  const payload = await readResponsePayload(response)
  assertOk(response, payload, 'Ideogram generation failed')
  return {
    ...imageFromProviderOutput((payload as any).data ?? payload, payload),
    ...(referenceImages.length ? { referenceImages } : {}),
  }
}

async function callWaveSpeed(
  fetcher: typeof fetch,
  entry: ImageProviderCatalogEntry,
  baseUrl: string,
  apiKey: string,
  modelName: string,
  prompt: string,
  options: { referenceImages?: string[]; size?: string } = {}
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

async function callTencentHunyuan(
  fetcher: typeof fetch,
  entry: ImageProviderCatalogEntry,
  baseUrl: string,
  apiKey: string,
  modelName: string,
  prompt: string,
  options: ImageProviderRequestOptions
): Promise<Partial<ImageGenerationResult>> {
  rejectReferenceImages(entry, modelName, options.referenceImages, 'Tencent Hunyuan TextToImage does not accept reference images through this action.')
  const credentials = parseTencentCredentials(apiKey)
  const size = parseImageSize(options.size)
  const body = JSON.stringify({
    Prompt: prompt,
    Model: modelName,
    Resolution: `${size?.width ?? 1024}:${size?.height ?? 1024}`,
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

async function callHuggingFaceInference(
  fetcher: typeof fetch,
  entry: ImageProviderCatalogEntry,
  baseUrl: string,
  apiKey: string,
  modelName: string,
  prompt: string,
  options: ImageProviderRequestOptions
): Promise<Partial<ImageGenerationResult>> {
  const size = parseImageSize(options.size)
  const referenceImages = limitReferenceImages(entry, options.referenceImages)
  if (referenceImages.length) {
    assertReferenceModel(
      entry,
      modelName,
      isHuggingFaceReferenceModel(modelName),
      'Reference images require a Hugging Face image-to-image/edit/control model endpoint.'
    )
  }
  const parameters: Record<string, unknown> = {
    ...(size ? { width: size.width, height: size.height } : {}),
    ...(referenceImages[0] ? {
      image: referenceImages[0],
      input_image: referenceImages[0],
      reference_image: referenceImages[0],
    } : {}),
  }
  const pathModelName = modelName.split('/').map((part) => encodeURIComponent(part)).join('/')
  const path = entry.generatePath.replace('{model}', pathModelName)
  const response = await fetcher(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      ...jsonAuthHeaders(apiKey),
      Accept: 'image/*, application/json',
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters,
    }),
  })
  const contentType = response.headers.get('content-type')?.split(';')[0] || ''
  if (response.ok && contentType.startsWith('image/')) {
    const buffer = Buffer.from(await response.arrayBuffer())
    return {
      mimeType: contentType,
      dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
      ...(referenceImages.length ? { referenceImages } : {}),
    }
  }
  const payload = await readResponsePayload(response)
  assertOk(response, payload, 'Hugging Face image generation failed')
  return {
    ...imageFromProviderOutput((payload as any).images ?? (payload as any).output ?? payload, payload),
    ...(referenceImages.length ? { referenceImages } : {}),
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

function rejectReferenceImages(entry: ImageProviderCatalogEntry, modelName: string, referenceImages: string[] = [], reason: string): void {
  if (referenceImages.map((item) => item.trim()).filter(Boolean).length) {
    throw new Error(`${entry.label} model "${modelName}" cannot use reference images. ${reason}`)
  }
}

function assertReferenceModel(entry: ImageProviderCatalogEntry, modelName: string, supported: boolean, reason: string): void {
  if (!supported) {
    throw new Error(`${entry.label} model "${modelName}" cannot use reference images. ${reason}`)
  }
}

function openAICompatibleReferencePayload(entry: ImageProviderCatalogEntry, referenceImages: string[]): Record<string, unknown> {
  if (entry.value === 'volcengine-ark') {
    return {
      image: referenceImages.length === 1 ? referenceImages[0] : referenceImages,
      images: referenceImages,
    }
  }
  return {
    image: referenceImages.length === 1 ? referenceImages[0] : referenceImages,
  }
}

function isOpenAIImageEditModel(modelName: string): boolean {
  return /^(gpt-image|chatgpt-image|dall-e-2)/i.test(modelName.trim())
}

function isVolcengineReferenceModel(modelName: string): boolean {
  return /seedream|dreamina|image-to-image|img2img|i2i|edit|reference/i.test(modelName)
}

function isDashScopeReferenceModel(modelName: string): boolean {
  return /qwen-image(?:-2\.0|-edit|-\d|$)|image-edit|image-to-image|img2img/i.test(modelName)
}

function isHuggingFaceReferenceModel(modelName: string): boolean {
  return /image-to-image|img2img|i2i|kontext|edit|instruct-pix2pix|controlnet|ip-adapter|adapter/i.test(modelName)
}

function resolveStabilityPath(entry: ImageProviderCatalogEntry, modelName: string, hasReferenceImages: boolean): string {
  if (!hasReferenceImages) {
    return entry.generatePath
  }
  const normalized = modelName.trim().replace(/^\/+/, '')
  if (/^v2beta\/stable-image\/(edit|control)\//i.test(normalized)) {
    return `/${normalized}`
  }
  if (/^stable-image\/(edit|control)\//i.test(normalized)) {
    return `/v2beta/${normalized}`
  }
  throw new Error(`${entry.label} model "${modelName}" cannot use reference images. Select an explicit Stability edit/control endpoint path such as v2beta/stable-image/control/sketch.`)
}

function dashScopeMultimodalGenerationPath(baseUrl: string): string {
  return /\/api\/v1\/services\/aigc\/multimodal-generation\/generation\/?$/i.test(new URL(baseUrl).pathname)
    ? ''
    : '/api/v1/services/aigc/multimodal-generation/generation'
}

function assertDashScopeReferenceBaseUrl(baseUrl: string): void {
  const url = new URL(baseUrl)
  const multimodalPath = /\/api\/v1\/services\/aigc\/multimodal-generation\/generation\/?$/i.test(url.pathname)
  if (/\.maas\.aliyuncs\.com$/i.test(url.hostname) || multimodalPath) {
    return
  }
  throw new Error('Aliyun Qwen image references require a WorkspaceId maas base URL, for example https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com')
}

function falReferencePayload(modelName: string, referenceImages: string[]): Record<string, unknown> {
  const normalized = modelName.toLowerCase()
  if (referenceImages.length > 1 || /\/multi(?:\/|$)|edit|kontext/i.test(normalized)) {
    return { image_urls: referenceImages }
  }
  return { image_url: referenceImages[0] }
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
    assertReferenceModel(
      entry,
      modelName,
      !hasReferenceImages,
      'Use openai/gpt-image-2/edit for reference-image requests; the text-to-image endpoint only accepts text prompts.'
    )
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

function resolveFalModelName(modelName: string): string {
  return modelName.replace(/^\/+|\/+$/g, '')
}

function resolveFalReferenceImages(entry: ImageProviderCatalogEntry, modelName: string, referenceImages: string[]): string[] {
  const limited = limitReferenceImages(entry, referenceImages)
  if (!limited.length) {
    return limited
  }
  const normalized = modelName.toLowerCase()
  const supportsReferences = /\/edit(?:\/|$)|image-to-image|img2img|kontext/.test(normalized)
  assertReferenceModel(
    entry,
    modelName,
    supportsReferences,
    'Reference images require an explicit fal edit, image-to-image, img2img, or kontext endpoint.'
  )
  return limited
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

function formatFalImageSize(size: string | undefined): string | { width: number; height: number } {
  const parsed = parseImageSize(size)
  if (!parsed) {
    return 'square_hd'
  }
  const ratio = parsed.width / parsed.height
  if (Math.abs(ratio - 1) < 0.08) {
    return 'square_hd'
  }
  if (ratio > 1) {
    return ratio >= 1.55 ? 'landscape_16_9' : 'landscape_4_3'
  }
  return ratio <= 0.65 ? 'portrait_16_9' : 'portrait_4_3'
}

function aspectRatioForProvider(size: string | undefined): string | null {
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
  if (request.modelName.toLowerCase() === 'openai/gpt-image-2/text-to-image') {
    return {
      prompt,
      aspect_ratio: aspectRatioForProvider(size) ?? '1:1',
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

function formatProviderImageSize(
  size: string | undefined,
  format: 'x' | 'asterisk',
  fallback: string
): string {
  const parsed = parseImageSize(size)
  if (!parsed) {
    return fallback
  }
  const separator = format === 'asterisk' ? '*' : 'x'
  return `${parsed.width}${separator}${parsed.height}`
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

async function loadReferenceImageBase64(fetcher: typeof fetch, referenceImage: string): Promise<string> {
  const dataUrl = parseDataUrl(referenceImage)
  if (dataUrl) {
    return dataUrl.bytes.toString('base64')
  }
  const response = await fetcher(referenceImage)
  const payloadForError = response.ok ? null : await clonePayloadForError(response)
  assertOk(response, payloadForError, 'Reference image fetch failed')
  const bytes = Buffer.from(await response.arrayBuffer())
  return bytes.toString('base64')
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
    return { mimeType: 'image/png', dataUrl: `data:image/png;base64,${first.replace(/^data:image\/\w+;base64,/, '')}`, providerResponse }
  }
  if (first && typeof first === 'object') {
    const item = first as Record<string, any>
    const imageValue = item.image
    const url = item.url || item.image_url || item.imageUrl || item.download_url || (typeof imageValue === 'string' && /^https?:\/\//.test(imageValue) ? imageValue : undefined)
    const b64 = item.b64_json || item.base64 || (typeof imageValue === 'string' && !/^https?:\/\//.test(imageValue) ? imageValue : undefined) || item.data
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

function tryImageFromProviderOutput(output: unknown, providerResponse: unknown): Partial<ImageGenerationResult> | null {
  try {
    return imageFromProviderOutput(output, providerResponse)
  } catch {
    return null
  }
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

async function pollWaveSpeedPrediction(fetcher: typeof fetch, baseUrl: string, getUrl: string, apiKey: string, fallbackTaskId = ''): Promise<unknown> {
  const task = await pollJson(fetcher, getUrl, { Authorization: `Bearer ${apiKey}` }, (body) => {
    const status = (body as any).data?.status ?? (body as any).status
    return status === 'completed' || status === 'failed' || status === 'canceled'
  }, 180_000)
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

function parseComfyWorkflow(modelName: string, prompt: string, options: ImageProviderRequestOptions): Record<string, unknown> {
  const source = modelName.trim()
  if (!source.startsWith('{')) {
    throw new Error('ComfyUI image model must be a workflow API JSON object with prompt placeholders')
  }
  const parsed = JSON.parse(source)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ComfyUI workflow JSON must be an object')
  }
  const size = parseImageSize(options.size)
  const referenceImages = limitReferenceImages(getImageProviderCatalogEntry('comfyui'), options.referenceImages)
  const replacements: Record<string, unknown> = {
    prompt,
    PROMPT: prompt,
    width: size?.width ?? 1024,
    WIDTH: size?.width ?? 1024,
    height: size?.height ?? 1024,
    HEIGHT: size?.height ?? 1024,
    referenceImage: referenceImages[0] ?? '',
    reference_image: referenceImages[0] ?? '',
    REFERENCE_IMAGE: referenceImages[0] ?? '',
    referenceImages,
    reference_images: referenceImages,
    REFERENCE_IMAGES: referenceImages,
  }
  return replaceComfyPlaceholders(parsed, replacements) as Record<string, unknown>
}

function replaceComfyPlaceholders(value: unknown, replacements: Record<string, unknown>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => replaceComfyPlaceholders(item, replacements))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceComfyPlaceholders(item, replacements)]))
  }
  if (typeof value !== 'string') {
    return value
  }
  const exact = value.match(/^\{\{\s*([A-Za-z_]+)\s*\}\}$/)
  if (exact && Object.prototype.hasOwnProperty.call(replacements, exact[1])) {
    return replacements[exact[1]]
  }
  return value.replace(/\{\{\s*([A-Za-z_]+)\s*\}\}/g, (match, key: string) => {
    const replacement = replacements[key]
    if (replacement === undefined) {
      return match
    }
    return Array.isArray(replacement) ? replacement.join('\n') : String(replacement)
  })
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
