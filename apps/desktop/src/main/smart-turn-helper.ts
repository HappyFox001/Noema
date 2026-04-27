/**
 * Smart Turn 辅助模块
 * 用于在 Electron 主进程中初始化 Smart Turn
 */

import { createRequire } from 'module'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import {
  SmartTurnAnalyzer,
  SimpleWhisperFeatureExtractor,
  type OnnxInferenceSession,
  type OnnxTensor,
  type OnnxTensorFactory,
} from '@her-text/sdk'

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

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
 * 查找 Smart Turn 模型文件
 */
function findModelPath(): string {
  const possiblePaths = [
    // 开发环境：从 apps/desktop/dist/ 到 models/
    join(__dirname, '../../../models/smart-turn-v3.2-cpu.onnx'),
    // 开发环境：从 apps/desktop/src/main/
    join(__dirname, '../../../../models/smart-turn-v3.2-cpu.onnx'),
    // 生产环境：打包后
    join(__dirname, './models/smart-turn-v3.2-cpu.onnx'),
    join(__dirname, '../models/smart-turn-v3.2-cpu.onnx'),
    // 相对于 cwd
    join(process.cwd(), 'models/smart-turn-v3.2-cpu.onnx'),
    join(process.cwd(), '../../models/smart-turn-v3.2-cpu.onnx'),
  ]

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      console.log('[SmartTurn] Found model at:', p)
      return p
    }
  }

  throw new Error(`Smart Turn model not found. Searched paths:\n${possiblePaths.join('\n')}`)
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
          const bigintData = BigInt64Array.from(
            (data as number[]).map(v => BigInt(v))
          )
          onnxFeeds[name] = new onnxRuntime.Tensor('int64', bigintData, dims.length > 0 ? dims : undefined)
        }
      }

      const results = await session.run(onnxFeeds)

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
 * 初始化 Smart Turn
 */
export async function initializeSmartTurn(sampleRate: number = 16000): Promise<SmartTurnAnalyzer> {
  console.log('[SmartTurn] Initializing...')

  const onnxRuntime = loadOnnxRuntime()
  console.log('[SmartTurn] ONNX Runtime loaded')

  const modelPath = findModelPath()

  const sessionOptions = {
    executionProviders: ['cpu'],
    interOpNumThreads: 1,
    intraOpNumThreads: 1,
  }

  console.log('[SmartTurn] Loading model...')
  const session = await onnxRuntime.InferenceSession.create(modelPath, sessionOptions)
  console.log('[SmartTurn] Model loaded')

  const smartTurn = new SmartTurnAnalyzer({
    session: wrapSession(session, onnxRuntime),
    tensorFactory: createTensorFactory(onnxRuntime),
    featureExtractor: new SimpleWhisperFeatureExtractor(),
    sampleRate,
    stopSecs: 2.0,        // 2 秒静音超时备用
    preSpeechMs: 500,     // 语音开始前 500ms
    maxDurationSecs: 8,   // 最大分析 8 秒
    threshold: 0.5,       // 完成阈值
  })

  console.log('[SmartTurn] Initialized successfully')
  return smartTurn
}

/**
 * 检查 Smart Turn 是否可用
 */
export function isSmartTurnAvailable(): boolean {
  try {
    loadOnnxRuntime()
    findModelPath()
    return true
  } catch {
    return false
  }
}
