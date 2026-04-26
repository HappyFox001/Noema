/**
 * VAD 状态机分析器
 * 完整移植自 Pipecat: src/pipecat/audio/vad/vad_analyzer.py
 */

import {
  VADState,
  VADParams,
  VADEvent,
  VADAnalyzerInterface,
  VoiceConfidenceProvider,
  DEFAULT_VAD_PARAMS,
  calculateRmsVolume,
  int16ToFloat32,
} from './types.js'

/**
 * 指数平滑函数
 * 用于音量的平滑处理，避免突变
 */
function expSmoothing(value: number, prevValue: number, factor: number): number {
  return factor * value + (1 - factor) * prevValue
}

/**
 * VAD 状态机分析器
 *
 * 实现 Pipecat 风格的 4 状态机：
 * QUIET → STARTING → SPEAKING → STOPPING → QUIET
 *
 * 核心逻辑：
 * 1. 累积音频到足够帧数
 * 2. 计算置信度和音量
 * 3. 同时检查 confidence >= threshold AND volume >= minVolume
 * 4. 状态机转移需要持续一定帧数才确认
 */
export class VADAnalyzer implements VADAnalyzerInterface {
  private params: VADParams
  private confidenceProvider: VoiceConfidenceProvider

  // 内部状态
  private vadState: VADState = VADState.QUIET
  private vadBuffer: Float32Array = new Float32Array(0)

  // 帧计数器
  private vadStartingCount = 0
  private vadStoppingCount = 0

  // 计算出的帧数阈值
  private vadFrames = 0 // 每次分析需要的帧数
  private vadStartFrames = 0 // 确认开始需要的帧数
  private vadStopFrames = 0 // 确认停止需要的帧数

  // 音量平滑
  private smoothingFactor = 0.2
  private prevVolume = 0

  // 事件处理器
  private eventHandler: ((event: VADEvent) => void) | null = null

  // 上一次的状态，用于检测状态变化
  private prevState: VADState = VADState.QUIET

  constructor(
    confidenceProvider: VoiceConfidenceProvider,
    params?: Partial<VADParams>
  ) {
    this.confidenceProvider = confidenceProvider
    this.params = { ...DEFAULT_VAD_PARAMS, ...params }
    this.calculateFrameThresholds()
  }

  /**
   * 计算帧数阈值
   * 根据采样率和时间参数计算需要多少帧
   */
  private calculateFrameThresholds(): void {
    // 每帧的样本数（用于 VAD 分析）
    // Silero VAD 需要 512 样本 (32ms @ 16kHz)
    // 对于 RMS VAD，我们使用相同的帧大小
    this.vadFrames = 512

    // 每秒的帧数
    const framesPerSec = this.params.sampleRate / this.vadFrames

    // 确认开始/停止需要的帧数
    this.vadStartFrames = Math.round(this.params.startSecs * framesPerSec)
    this.vadStopFrames = Math.round(this.params.stopSecs * framesPerSec)

    // 确保至少需要 1 帧
    this.vadStartFrames = Math.max(1, this.vadStartFrames)
    this.vadStopFrames = Math.max(1, this.vadStopFrames)
  }

  /**
   * 设置 VAD 参数并重新计算阈值
   */
  setParams(params: Partial<VADParams>): void {
    this.params = { ...this.params, ...params }
    this.calculateFrameThresholds()
    this.reset()
  }

  /**
   * 获取当前 VAD 参数
   */
  getParams(): VADParams {
    return { ...this.params }
  }

  /**
   * 设置事件处理器
   */
  setEventHandler(handler: (event: VADEvent) => void): void {
    this.eventHandler = handler
  }

  /**
   * 获取当前状态
   */
  getState(): VADState {
    return this.vadState
  }

  /**
   * 重置状态机
   */
  reset(): void {
    this.vadState = VADState.QUIET
    this.prevState = VADState.QUIET
    this.vadBuffer = new Float32Array(0)
    this.vadStartingCount = 0
    this.vadStoppingCount = 0
    this.prevVolume = 0
    this.confidenceProvider.reset()
  }

  /**
   * 计算平滑后的音量
   */
  private getSmoothedVolume(audio: Float32Array): number {
    const volume = calculateRmsVolume(audio)
    const smoothed = expSmoothing(volume, this.prevVolume, this.smoothingFactor)
    this.prevVolume = smoothed
    return smoothed
  }

  /**
   * 触发事件
   */
  private emitEvent(type: VADEvent['type'], stopSecs?: number): void {
    if (this.eventHandler) {
      const event: VADEvent = {
        type,
        timestamp: Date.now(),
      }
      if (stopSecs !== undefined) {
        event.stopSecs = stopSecs
      }
      this.eventHandler(event)
    }
  }

  /**
   * 检测状态变化并触发事件
   */
  private checkStateChange(): void {
    // 检测 QUIET/STARTING → SPEAKING 转换（开始说话）
    if (
      this.vadState === VADState.SPEAKING &&
      (this.prevState === VADState.QUIET || this.prevState === VADState.STARTING)
    ) {
      this.emitEvent('speech_start')
    }

    // 检测 SPEAKING/STOPPING → QUIET 转换（停止说话）
    if (
      this.vadState === VADState.QUIET &&
      (this.prevState === VADState.SPEAKING || this.prevState === VADState.STOPPING)
    ) {
      this.emitEvent('speech_stop', this.params.stopSecs)
    }

    // 持续说话时触发活动事件
    if (this.vadState === VADState.SPEAKING && this.prevState === VADState.SPEAKING) {
      this.emitEvent('speech_activity')
    }

    this.prevState = this.vadState
  }

  /**
   * 分析音频并返回 VAD 状态
   * 这是核心的状态机逻辑
   */
  async analyze(audio: Int16Array | Float32Array): Promise<VADState> {
    // 转换为 Float32
    const float32Audio =
      audio instanceof Int16Array ? int16ToFloat32(audio) : audio

    // 累积到缓冲区
    const newBuffer = new Float32Array(this.vadBuffer.length + float32Audio.length)
    newBuffer.set(this.vadBuffer)
    newBuffer.set(float32Audio, this.vadBuffer.length)
    this.vadBuffer = newBuffer

    // 需要的字节数
    const numRequiredSamples = this.vadFrames
    if (this.vadBuffer.length < numRequiredSamples) {
      return this.vadState
    }

    // 处理缓冲区中的所有完整帧
    while (this.vadBuffer.length >= numRequiredSamples) {
      // 提取一帧
      const audioFrame = this.vadBuffer.slice(0, numRequiredSamples)
      this.vadBuffer = this.vadBuffer.slice(numRequiredSamples)

      // 计算置信度和音量
      const confidence = await this.confidenceProvider.getVoiceConfidence(audioFrame)
      const volume = this.getSmoothedVolume(audioFrame)

      // 判断是否有语音
      const speaking =
        confidence >= this.params.confidence && volume >= this.params.minVolume

      // 状态机转移
      if (speaking) {
        switch (this.vadState) {
          case VADState.QUIET:
            this.vadState = VADState.STARTING
            this.vadStartingCount = 1
            break
          case VADState.STARTING:
            this.vadStartingCount++
            break
          case VADState.STOPPING:
            // 用户继续说话，回到 SPEAKING
            this.vadState = VADState.SPEAKING
            this.vadStoppingCount = 0
            break
          // SPEAKING 状态保持不变
        }
      } else {
        switch (this.vadState) {
          case VADState.STARTING:
            // 还没确认就停了，回到 QUIET
            this.vadState = VADState.QUIET
            this.vadStartingCount = 0
            break
          case VADState.SPEAKING:
            this.vadState = VADState.STOPPING
            this.vadStoppingCount = 1
            break
          case VADState.STOPPING:
            this.vadStoppingCount++
            break
          // QUIET 状态保持不变
        }
      }
    }

    // 检查是否达到确认阈值
    if (
      this.vadState === VADState.STARTING &&
      this.vadStartingCount >= this.vadStartFrames
    ) {
      this.vadState = VADState.SPEAKING
      this.vadStartingCount = 0
    }

    if (
      this.vadState === VADState.STOPPING &&
      this.vadStoppingCount >= this.vadStopFrames
    ) {
      this.vadState = VADState.QUIET
      this.vadStoppingCount = 0
    }

    // 检测状态变化并触发事件
    this.checkStateChange()

    return this.vadState
  }
}
