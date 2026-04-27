/**
 * Silero VAD 辅助模块
 * 用于在 Electron 主进程中初始化 Silero VAD
 */

import { createRequire } from 'module'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import {
  createSileroVAD,
  type SileroVAD,
  type OnnxInferenceSession,
  type OnnxTensor,
  type OnnxTensorFactory,
} from '@her-text/sdk'

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ONNX Runtime 类型 - 使用 any 避免复杂类型问题
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ort: any = null

/**
 * 加载 ONNX Runtime
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadOnnxRuntime(): any {
  if (!ort) {
    ort = require('onnxruntime-node')
  }
  return ort
}

/**
 * 查找 Silero VAD 模型文件
 */
function findModelPath(): string {
  const possiblePaths = [
    // 开发环境：从 apps/desktop/dist/ 到 models/
    // dist → desktop → apps → her-text → models/
    join(__dirname, '../../../models/silero_vad.onnx'),
    // 开发环境：从 apps/desktop/src/main/
    join(__dirname, '../../../../models/silero_vad.onnx'),
    // 生产环境：打包后（模型复制到 app 内）
    join(__dirname, './models/silero_vad.onnx'),
    join(__dirname, '../models/silero_vad.onnx'),
    // 相对于 cwd（her-text/ 或 apps/desktop/）
    join(process.cwd(), 'models/silero_vad.onnx'),
    join(process.cwd(), '../../models/silero_vad.onnx'),
  ]

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      console.log('[SileroVAD] Found model at:', p)
      return p
    }
  }

  throw new Error(`Silero VAD model not found. Searched paths:\n${possiblePaths.join('\n')}`)
}

/**
 * 创建 ONNX Tensor 工厂
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createTensorFactory(onnxRuntime: any): OnnxTensorFactory {
  return {
    create(
      type: 'float32' | 'int64',
      data: Float32Array | BigInt64Array | number[] | bigint[],
      dims: number[]
    ): OnnxTensor {
      const Tensor = onnxRuntime.Tensor
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let tensor: any

      if (type === 'float32') {
        const float32Data = data instanceof Float32Array
          ? data
          : new Float32Array(data as number[])
        tensor = new Tensor('float32', float32Data, dims.length > 0 ? dims : undefined)
      } else {
        // int64 - ONNX Runtime 需要 BigInt64Array
        let bigintData: BigInt64Array
        if (data instanceof BigInt64Array) {
          bigintData = data
        } else if (Array.isArray(data)) {
          bigintData = BigInt64Array.from(data.map(v =>
            typeof v === 'bigint' ? v : BigInt(v as number)
          ))
        } else {
          bigintData = BigInt64Array.from(Array.from(data as Float32Array).map(v => BigInt(v)))
        }
        tensor = new Tensor('int64', bigintData, dims.length > 0 ? dims : undefined)
      }

      return {
        data: tensor.data as Float32Array | BigInt64Array,
        dims: tensor.dims as number[],
      }
    },
  }
}

/**
 * 包装 ONNX InferenceSession
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapSession(session: any, onnxRuntime: any): OnnxInferenceSession {
  return {
    async run(feeds: Record<string, OnnxTensor>): Promise<Record<string, OnnxTensor>> {
      // 将我们的 OnnxTensor 转换为 ONNX Runtime Tensor
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onnxFeeds: Record<string, any> = {}

      for (const [name, tensor] of Object.entries(feeds)) {
        const data = tensor.data
        const dims = tensor.dims

        if (data instanceof Float32Array) {
          onnxFeeds[name] = new onnxRuntime.Tensor('float32', data, dims.length > 0 ? dims : undefined)
        } else if (data instanceof BigInt64Array) {
          onnxFeeds[name] = new onnxRuntime.Tensor('int64', data, dims.length > 0 ? dims : undefined)
        } else {
          // number[]
          const bigintData = BigInt64Array.from(
            (data as number[]).map(v => BigInt(v))
          )
          onnxFeeds[name] = new onnxRuntime.Tensor('int64', bigintData, dims.length > 0 ? dims : undefined)
        }
      }

      // 运行推理
      const results = await session.run(onnxFeeds)

      // 转换结果
      const output: Record<string, OnnxTensor> = {}
      for (const [name, tensor] of Object.entries(results)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t = tensor as any
        output[name] = {
          data: t.data as Float32Array | BigInt64Array,
          dims: t.dims as number[],
        }
      }

      return output
    },
  }
}

/**
 * 初始化 Silero VAD
 */
export async function initializeSileroVAD(sampleRate: number = 16000): Promise<SileroVAD> {
  console.log('[SileroVAD] Initializing...')

  // 加载 ONNX Runtime
  const onnxRuntime = loadOnnxRuntime()
  console.log('[SileroVAD] ONNX Runtime loaded')

  // 查找模型文件
  const modelPath = findModelPath()

  // 创建 ONNX 会话
  const sessionOptions = {
    executionProviders: ['cpu'],
    interOpNumThreads: 1,
    intraOpNumThreads: 1,
  }

  console.log('[SileroVAD] Loading model...')
  const session = await onnxRuntime.InferenceSession.create(modelPath, sessionOptions)
  console.log('[SileroVAD] Model loaded')

  // 创建 Silero VAD
  const sileroVAD = createSileroVAD({
    session: wrapSession(session, onnxRuntime),
    tensorFactory: createTensorFactory(onnxRuntime),
    sampleRate,
  })

  console.log('[SileroVAD] Initialized successfully')
  return sileroVAD
}

/**
 * 检查 Silero VAD 是否可用
 */
export function isSileroVADAvailable(): boolean {
  try {
    loadOnnxRuntime()
    findModelPath()
    return true
  } catch {
    return false
  }
}
