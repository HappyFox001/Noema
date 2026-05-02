

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

export {
  VADAnalyzer,
  VADControllerConfig,
  DEFAULT_VAD_CONTROLLER_CONFIG,
} from './vad-analyzer.js'

// RMS VAD
export { RmsVAD, RmsVADConfig, createRmsVAD } from './rms-vad.js'

export {
  SileroVAD,
  SileroVADConfig,
  SileroOnnxModel,
  createSileroVAD,
  type OnnxInferenceSession,
  type OnnxTensor,
  type OnnxTensorFactory,
} from './silero-vad.js'


import { VADAnalyzer } from './vad-analyzer.js'
import { createRmsVAD } from './rms-vad.js'
import type { VADParams } from './types.js'

export function createVADAnalyzer(params?: Partial<VADParams>): VADAnalyzer {
  const confidenceProvider = createRmsVAD()
  return new VADAnalyzer(confidenceProvider, params)
}
