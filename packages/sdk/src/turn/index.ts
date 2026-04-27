/**
 * Turn 管理模块
 *
 * 移植自 Pipecat 的轮次管理系统，提供：
 * - 轮次状态机 (IDLE → USER_TURN → USER_DONE → BOT_TURN → BOT_DONE)
 * - Endpointing 双计时器策略
 * - 打断检测和处理
 * - 事件回调系统
 */

// 类型导出
export {
  TurnState,
  ProcessFrameResult,
  EndpointingConfig,
  UserTurnStartedParams,
  UserTurnStoppedParams,
  InterruptionHandler,
  IEndpointingStrategy,
  SmartTurnOptions,
  TurnControllerEvents,
  TranscriptionFrame,
  DEFAULT_ENDPOINTING_CONFIG,
} from './types.js'

// 轮次控制器
export { TurnController, TurnControllerConfig } from './turn-controller.js'

// Endpointing 策略
export { EndpointingStrategy } from './endpointing.js'

// 打断管理
export {
  InterruptionManager,
  makeInterruptible,
  createInterruptionController,
} from './interruption.js'

// Smart Turn (ML 智能话音结束检测)
export {
  SmartTurnAnalyzer,
  SmartTurnConfig,
  SmartTurnResult,
  SimpleWhisperFeatureExtractor,
  WhisperFeatureExtractor,
  OnnxInferenceSession as SmartTurnOnnxSession,
  OnnxTensor as SmartTurnOnnxTensor,
  OnnxTensorFactory as SmartTurnOnnxTensorFactory,
} from './smart-turn.js'

// Smart Turn Endpointing 策略
export {
  SmartTurnEndpointingStrategy,
  SmartTurnEndpointingConfig,
} from './smart-turn-endpointing.js'
