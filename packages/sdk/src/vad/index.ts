/**
 * VAD (Voice Activity Detection) 模块
 *
 * 移植自 Pipecat 的 VAD 系统，提供：
 * - 4 状态机 VAD 分析器 (QUIET → STARTING → SPEAKING → STOPPING)
 * - RMS VAD 实现（默认，无依赖）
 * - 可扩展的置信度提供者接口（可接入 Silero 等模型）
 */

// 类型导出
export {
  VADState,
  VADParams,
  VADEvent,
  VADAnalyzerInterface,
  VoiceConfidenceProvider,
  DEFAULT_VAD_PARAMS,
  calculateRmsVolume,
  int16ToFloat32,
} from './types.js'

// VAD 分析器
export {
  VADAnalyzer,
  VADControllerConfig,
  DEFAULT_VAD_CONTROLLER_CONFIG,
} from './vad-analyzer.js'

// RMS VAD
export { RmsVAD, RmsVADConfig, createRmsVAD } from './rms-vad.js'

/**
 * 创建默认的 VAD 分析器
 * 使用 RMS VAD 作为置信度提供者
 */
import { VADAnalyzer } from './vad-analyzer.js'
import { createRmsVAD } from './rms-vad.js'
import type { VADParams } from './types.js'

export function createVADAnalyzer(params?: Partial<VADParams>): VADAnalyzer {
  const confidenceProvider = createRmsVAD()
  return new VADAnalyzer(confidenceProvider, params)
}
