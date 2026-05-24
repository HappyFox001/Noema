/**
 * Manages local ONNX model storage and downloads for the desktop runtime.
 */
import { net } from 'electron'
import { createHash } from 'crypto'
import { mkdir, open, rename, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { getStorageDir } from './sdk-config.js'

export type LocalModelId = 'silero-vad' | 'smart-turn'

export type LocalModelDefinition = {
  id: LocalModelId
  name: string
  filename: string
  purpose: string
  url: string
}

export type LocalModelStatus = Omit<LocalModelDefinition, 'url'> & {
  exists: boolean
  sizeBytes?: number
  path: string
}

export const LOCAL_MODEL_DEFINITIONS: LocalModelDefinition[] = [
  {
    id: 'silero-vad',
    name: 'Silero VAD',
    filename: 'silero_vad.onnx',
    purpose: '本地语音活动检测',
    url: 'https://raw.githubusercontent.com/snakers4/silero-vad/master/src/silero_vad/data/silero_vad.onnx',
  },
  {
    id: 'smart-turn',
    name: 'Smart Turn v3.2',
    filename: 'smart-turn-v3.2-cpu.onnx',
    purpose: '本地智能话音结束判断',
    url: 'https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/main/smart-turn-v3.2-cpu.onnx?download=true',
  },
]

export function resolveLocalModelsDir(): string {
  return join(getStorageDir(), 'models')
}

export function resolveLocalModelPath(id: LocalModelId): string {
  const definition = getLocalModelDefinition(id)
  return join(resolveLocalModelsDir(), definition.filename)
}

export async function getLocalModelStatuses(): Promise<LocalModelStatus[]> {
  return Promise.all(LOCAL_MODEL_DEFINITIONS.map(async (model) => {
    const modelPath = join(resolveLocalModelsDir(), model.filename)
    const exists = await isValidOnnxFile(modelPath)

    if (!exists) {
      return {
        ...toStatusModel(model),
        exists: false,
        path: modelPath,
      }
    }

    const file = await stat(modelPath)
    return {
      ...toStatusModel(model),
      exists: true,
      sizeBytes: file.size,
      path: modelPath,
    }
  }))
}

export async function ensureLocalModelPath(id: LocalModelId): Promise<string> {
  const modelPath = resolveLocalModelPath(id)
  if (await isValidOnnxFile(modelPath)) {
    return modelPath
  }

  const definition = getLocalModelDefinition(id)
  throw new Error(`${definition.name} model not found. Download it from Settings > Models > Local Inference Models.`)
}

export async function isLocalModelAvailable(id: LocalModelId): Promise<boolean> {
  return isValidOnnxFile(resolveLocalModelPath(id))
}

export async function downloadMissingLocalModels(resetLocalAnalyzers: () => void): Promise<LocalModelStatus[]> {
  const before = await getLocalModelStatuses()
  const missingIds = new Set(before.filter((model) => !model.exists).map((model) => model.id))
  if (missingIds.size === 0) {
    return before
  }

  await mkdir(resolveLocalModelsDir(), { recursive: true })
  for (const model of LOCAL_MODEL_DEFINITIONS) {
    if (missingIds.has(model.id)) {
      await downloadLocalModel(model)
    }
  }

  resetLocalAnalyzers()
  return getLocalModelStatuses()
}

async function downloadLocalModel(model: LocalModelDefinition): Promise<void> {
  const modelPath = join(resolveLocalModelsDir(), model.filename)
  const tempPath = `${modelPath}.${process.pid}.${Date.now()}.part`

  console.log('[Models] Downloading local model:', model.name, model.url)
  try {
    const response = await net.fetch(model.url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Noema Desktop',
      },
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`)
    }

    const data = Buffer.from(await response.arrayBuffer())
    await writeFile(tempPath, data)
    if (!await isValidOnnxFile(tempPath)) {
      const fingerprint = createHash('sha256').update(data.subarray(0, 4096)).digest('hex').slice(0, 12)
      throw new Error(`Downloaded file is not a valid ONNX model (${data.length} bytes, sha256:${fingerprint})`)
    }

    await rename(tempPath, modelPath)
    console.log('[Models] Downloaded local model:', model.name, modelPath)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw new Error(`Failed to download ${model.name} from ${model.url}: ${formatDownloadError(error)}`)
  }
}

async function isValidOnnxFile(modelPath: string): Promise<boolean> {
  let file
  try {
    const fileStat = await stat(modelPath)
    if (!fileStat.isFile() || fileStat.size < 1024) {
      return false
    }

    file = await open(modelPath, 'r')
    const buffer = Buffer.alloc(Math.min(256, fileStat.size))
    await file.read(buffer, 0, buffer.length, 0)
    const header = buffer.toString('utf8').toLowerCase()
    return !/<!doctype|<html|not found|version https:\/\/git-lfs.github.com\/spec/.test(header)
  } catch {
    return false
  } finally {
    await file?.close()
  }
}

function getLocalModelDefinition(id: LocalModelId): LocalModelDefinition {
  const definition = LOCAL_MODEL_DEFINITIONS.find((model) => model.id === id)
  if (!definition) {
    throw new Error(`Unknown local model: ${id}`)
  }
  return definition
}

function toStatusModel(model: LocalModelDefinition): Omit<LocalModelStatus, 'exists' | 'sizeBytes' | 'path'> {
  const { url: _url, ...statusModel } = model
  return statusModel
}

function formatDownloadError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }

  const cause = (error as Error & { cause?: unknown }).cause
  if (cause instanceof Error && cause.message && cause.message !== error.message) {
    return `${error.message}; cause: ${cause.message}`
  }

  return error.message
}
