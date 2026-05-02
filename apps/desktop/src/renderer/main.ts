import './styles.css'

// ========== Audio Player ==========

class AudioPlayer {
  private audioContext: AudioContext | null = null
  private gainNode: GainNode | null = null
  private isPlaying = false
  private nextStartTime = 0
  private onChunkScheduled?: (payload: { startTime: number; duration: number }) => void
  private onPlaybackStart?: () => void

  // 播放完成同步机制
  private playbackCompleteResolvers: (() => void)[] = []
  private activeSources = new Set<AudioBufferSourceNode>()
  private pendingAudioAdds = 0

  // 延迟追踪：首个音频标志
  private isFirstAudioOfSession = true

  // TTS 上下文管理：防止旧音频混入
  private validContextId: number = 0
  private rejectedContextIds: Set<number> = new Set()

  // 停止计数器：用于检测在 async 操作期间是否调用了 stop()
  private stopGeneration: number = 0

  resetLatencyTracking(): void {
    this.isFirstAudioOfSession = true
  }

  /**
   * 设置当前有效的 TTS 上下文 ID
   * 只有匹配此 ID 的音频才会被播放
   */
  setValidContextId(contextId: number): void {
    console.log(`[AudioPlayer] Setting valid context ID: ${contextId}`)
    this.validContextId = contextId
    // 清除已被拒绝的上下文 ID 列表（保留最近的几个）
    if (this.rejectedContextIds.size > 10) {
      const idsArray = Array.from(this.rejectedContextIds)
      this.rejectedContextIds = new Set(idsArray.slice(-5))
    }
  }

  /**
   * 使指定的上下文 ID 失效
   * 之后收到的该上下文的音频将被丢弃
   */
  invalidateContext(contextId: number): void {
    console.log(`[AudioPlayer] Invalidating context ID: ${contextId}`)
    this.rejectedContextIds.add(contextId)
    // 如果失效的是当前上下文，停止播放
    if (contextId === this.validContextId) {
      console.log(`[AudioPlayer] Current context invalidated, stopping playback`)
      this.stop()
    }
  }

  /**
   * 验证音频上下文是否有效
   */
  isContextValid(contextId: number): boolean {
    // 如果上下文 ID 已被显式拒绝，返回 false
    if (this.rejectedContextIds.has(contextId)) {
      return false
    }
    // 如果上下文 ID 小于当前有效 ID，说明是旧数据
    if (contextId < this.validContextId) {
      return false
    }
    return true
  }

  async initialize(): Promise<void> {
    this.audioContext = new AudioContext({ sampleRate: 16000 })

    // 创建增益节点
    this.gainNode = this.audioContext.createGain()
    this.gainNode.connect(this.audioContext.destination)

    console.log('[AudioPlayer] Initialized with raw PCM output')

    // 音频预热：播放静音音频激活音频系统
    await this.warmup()
  }

  /**
   * 音频预热机制
   * 通过播放一个短暂的静音音频来激活音频系统，减少首次播放延迟
   */
  private async warmup(): Promise<void> {
    if (!this.audioContext) return

    console.log('[AudioPlayer] Starting warmup...')
    const startTime = performance.now()

    try {
      // 确保 AudioContext 处于运行状态
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume()
      }

      // 创建一个非常短的静音缓冲区（约 1ms）
      const silentBuffer = this.audioContext.createBuffer(1, 16, 16000)
      const source = this.audioContext.createBufferSource()
      source.buffer = silentBuffer

      // 连接到一个静音的增益节点，避免任何可能的噪音
      const silentGain = this.audioContext.createGain()
      silentGain.gain.value = 0
      silentGain.connect(this.audioContext.destination)
      source.connect(silentGain)

      // 播放静音音频
      source.start()

      // 等待音频系统准备就绪
      await new Promise<void>((resolve) => {
        source.onended = () => resolve()
        // 超时保护（以防 onended 不触发）
        setTimeout(resolve, 50)
      })

      const elapsed = performance.now() - startTime
      console.log(`[AudioPlayer] Warmup complete in ${elapsed.toFixed(1)}ms`)
    } catch (error) {
      console.warn('[AudioPlayer] Warmup failed:', error)
    }
  }

  setChunkScheduledHandler(
    handler: (payload: { startTime: number; duration: number }) => void
  ): void {
    this.onChunkScheduled = handler
  }

  setPlaybackStartHandler(handler: () => void): void {
    this.onPlaybackStart = handler
  }

  getCurrentTime(): number {
    return this.audioContext?.currentTime ?? 0
  }

  /**
   * 等待所有排队的音频播放完成
   * 用于 Phase 之间的同步
   */
  waitForPlaybackComplete(): Promise<void> {
    // 如果没有正在播放的音频，立即返回
    if (!this.isPlaying && this.activeSources.size === 0 && this.pendingAudioAdds === 0) {
      console.log('[AudioPlayer] waitForPlaybackComplete: already idle')
      return Promise.resolve()
    }

    console.log('[AudioPlayer] waitForPlaybackComplete: waiting...')
    return new Promise((resolve) => {
      this.playbackCompleteResolvers.push(resolve)
    })
  }

  /**
   * 检查是否正在播放
   */
  getIsPlaying(): boolean {
    return this.isPlaying
  }

  /**
   * 通知所有等待者播放已完成
   */
  private notifyPlaybackComplete(): void {
    if (!this.isPlaying && this.activeSources.size === 0 && this.pendingAudioAdds === 0) {
      console.log('[AudioPlayer] Playback complete, notifying', this.playbackCompleteResolvers.length, 'waiters')
      const resolvers = this.playbackCompleteResolvers
      this.playbackCompleteResolvers = []
      resolvers.forEach(r => r())
    }
  }

  private pcm16ToAudioBuffer(pcm16Bytes: Uint8Array): AudioBuffer {
    if (!this.audioContext) {
      throw new Error('Audio context not initialized')
    }

    const pcm16 = new Int16Array(
      pcm16Bytes.buffer,
      pcm16Bytes.byteOffset,
      pcm16Bytes.byteLength / 2
    )

    const audioBuffer = this.audioContext.createBuffer(1, pcm16.length, 16000)
    const channelData = audioBuffer.getChannelData(0)

    for (let i = 0; i < pcm16.length; i++) {
      const sample = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7fff)
      channelData[i] = sample
    }

    return audioBuffer
  }

  private playBuffer(buffer: AudioBuffer): void {
    if (!this.audioContext) return

    const source = this.audioContext.createBufferSource()
    source.buffer = buffer

    source.connect(this.gainNode ?? this.audioContext.destination)
    this.activeSources.add(source)

    const currentTime = this.audioContext.currentTime
    const startTime = Math.max(currentTime + 0.01, this.nextStartTime)
    const previousEndTime = this.nextStartTime
    const underrunMs = previousEndTime > 0
      ? Math.max(0, (currentTime - previousEndTime) * 1000)
      : 0
    const scheduleDelayMs = Math.max(0, (startTime - currentTime) * 1000)

    source.start(startTime)
    this.nextStartTime = startTime + buffer.duration
    this.onChunkScheduled?.({ startTime, duration: buffer.duration })
    window.electronAPI.notifyAudioScheduled({
      durationMs: buffer.duration * 1000,
      scheduleDelayMs,
      bufferAheadMs: Math.max(0, (this.nextStartTime - currentTime) * 1000),
      underrunMs,
    })

    // 记录当前 stopGeneration，用于检测 onended 回调时是否已经被 stop()
    const generationAtStart = this.stopGeneration

    source.onended = () => {
      // 如果 stop() 在这个 source 播放期间被调用，忽略这个回调
      // 这防止了旧 source 的 onended 污染新的播放状态
      if (this.stopGeneration !== generationAtStart) {
        console.log('[AudioPlayer] Ignoring onended from stopped source')
        return
      }

      this.activeSources.delete(source)
      if (this.activeSources.size === 0) {
        this.isPlaying = false
        this.notifyPlaybackComplete()
      }
    }
  }

  async addAudioChunk(pcm16Bytes: Uint8Array, contextId?: number): Promise<void> {
    this.pendingAudioAdds++
    try {
      // 记录当前的 stopGeneration，用于检测 async 期间是否调用了 stop()
      const generationAtStart = this.stopGeneration

      // 验证上下文 ID（如果提供）
      if (contextId !== undefined) {
        if (!this.isContextValid(contextId)) {
          console.log(`[AudioPlayer] Rejecting audio chunk from invalid context #${contextId} (valid: #${this.validContextId})`)
          return
        }
      }

      console.log(`[AudioPlayer] Adding chunk (context #${contextId ?? 'N/A'}):`, pcm16Bytes.byteLength, 'bytes, context state:', this.audioContext?.state)

      if (this.audioContext?.state === 'suspended') {
        console.log('[AudioPlayer] Resuming suspended context')
        await this.audioContext.resume()
        // 恢复后重新预热以减少延迟
        await this.warmup()
      }

      // 关键检查：在 await 之后重新验证
      // 1. 检查是否在 await 期间调用了 stop()
      if (this.stopGeneration !== generationAtStart) {
        console.log(`[AudioPlayer] Dropping chunk - stop() was called during await (gen ${generationAtStart} -> ${this.stopGeneration})`)
        return
      }

      // 2. 重新验证上下文（可能在 await 期间被 invalidate）
      if (contextId !== undefined && !this.isContextValid(contextId)) {
        console.log(`[AudioPlayer] Dropping chunk - context #${contextId} invalidated during await`)
        return
      }

      updateOrbAudioEnergy('output', pcm16Bytes)
      const audioBuffer = this.pcm16ToAudioBuffer(pcm16Bytes)
      console.log('[AudioPlayer] Created buffer:', audioBuffer.duration.toFixed(2), 'seconds')

      if (!this.isPlaying) {
        this.isPlaying = true
        this.nextStartTime = this.audioContext!.currentTime + 0.01

        console.log('[AudioPlayer] Starting playback')
        this.onPlaybackStart?.()
      }

      this.playBuffer(audioBuffer)
      if (this.isFirstAudioOfSession) {
        this.isFirstAudioOfSession = false
        console.log('[AudioPlayer] First audio of session - notifying latency tracker')
        window.electronAPI.notifyFirstAudioPlay()
      }
    } catch (error) {
      console.error('[AudioPlayer] Failed to add audio chunk:', error)
    } finally {
      this.pendingAudioAdds--
      this.notifyPlaybackComplete()
    }
  }

  stop(): void {
    console.log('[AudioPlayer] Stopping playback')

    // 递增 stopGeneration，使所有正在进行的 async addAudioChunk 失效
    this.stopGeneration++

    // 停止当前和已预排的音频
    for (const source of this.activeSources) {
      try {
        source.stop()
      } catch (e) {
        // 忽略已停止的错误
      }
    }
    this.activeSources.clear()

    this.isPlaying = false
    this.nextStartTime = 0

    // 通知等待者（被中断也算完成）
    this.notifyPlaybackComplete()
  }

  setVolume(percent: number): void {
    if (!this.gainNode) return
    this.gainNode.gain.value = Math.max(0, Math.min(1, percent / 100))
  }
}

type RevealUnit = {
  text: string
  weight: number
}

class AudioSyncedTextRevealer {
  private pendingChunks: RevealUnit[][] = []
  private visibleText = ''
  private generation = 0

  constructor(
    private getAudioTime: () => number,
    private onReveal: (text: string) => void
  ) {}

  reset(): void {
    this.pendingChunks = []
    this.visibleText = ''
    this.generation += 1
    this.onReveal('')
  }

  enqueueText(text: string): void {
    const chunk: RevealUnit[] = []
    for (const char of Array.from(text)) {
      chunk.push({
        text: char,
        weight: revealWeight(char)
      })
    }

    if (chunk.length > 0) {
      this.pendingChunks.push(chunk)
    }
  }

  scheduleAudioWindow(startTime: number, duration: number): void {
    if (duration <= 0 || this.pendingChunks.length === 0) {
      return
    }

    const budget = duration / 0.085
    const units = this.consumeUnitsForBudget(budget)
    if (units.length === 0) {
      return
    }

    const totalWeight = units.reduce((sum, unit) => sum + unit.weight, 0)
    const generation = this.generation
    let elapsed = 0

    for (const unit of units) {
      const revealAt = startTime + elapsed
      const unitDuration = duration * (unit.weight / totalWeight)
      this.scheduleReveal(unit.text, revealAt, generation)
      elapsed += unitDuration
    }
  }

  private consumeUnitsForBudget(budget: number): RevealUnit[] {
    const currentChunk = this.pendingChunks[0]
    if (!currentChunk || currentChunk.length === 0) {
      if (currentChunk && currentChunk.length === 0) {
        this.pendingChunks.shift()
      }
      return []
    }

    let remaining = budget
    const consumed: RevealUnit[] = []

    while (currentChunk.length > 0) {
      const next = currentChunk[0]

      if (consumed.length > 0 && remaining < next.weight) {
        break
      }

      consumed.push(currentChunk.shift()!)
      remaining -= next.weight

      if (remaining <= 0) {
        break
      }
    }

    if (currentChunk.length === 0) {
      this.pendingChunks.shift()
    }

    return consumed
  }

  private scheduleReveal(text: string, revealAt: number, generation: number): void {
    const delayMs = Math.max(0, (revealAt - this.getAudioTime()) * 1000)
    window.setTimeout(() => {
      if (generation !== this.generation) {
        return
      }

      this.visibleText += text
      this.onReveal(this.visibleText)
    }, delayMs)
  }
}

function revealWeight(char: string): number {
  if (!char.trim()) {
    return 0.18
  }

  if (/[，。！？、；：,.!?]/.test(char)) {
    return 1.8
  }

  if (/[A-Za-z0-9]/.test(char)) {
    return 0.55
  }

  return 1
}

// VoiceRecorder: 只负责采集和转发
// 集成噪声过滤：
// - 高通滤波器 (80Hz) - 去除低频噪声（风扇、空调等）
// - 低通滤波器 (8kHz) - 去除高频噪声
// - 浏览器原生: echoCancellation, noiseSuppression, autoGainControl
// 所有处理（降采样）在 AudioWorklet 线程完成
// VAD 和 ASR 在 Main Process 完成
class VoiceRecorder {
  private context: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private workletNode: AudioWorkletNode | null = null
  private highPassFilter: BiquadFilterNode | null = null
  private lowPassFilter: BiquadFilterNode | null = null
  private recording = false
  private warmedUp = false

  /**
   * 预热麦克风输入
   * 提前获取麦克风权限并初始化 AudioContext，减少首次录音延迟
   */
  async warmup(): Promise<void> {
    if (this.warmedUp) return

    console.log('[VoiceRecorder] Starting warmup...')
    const startTime = performance.now()

    try {
      // 获取麦克风权限（这是最耗时的部分）
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })

      // 初始化 AudioContext 和 Worklet
      this.context = new AudioContext()
      await this.context.audioWorklet.addModule('./audio-worklet-processor.js')

      // 创建噪声过滤器
      this.createNoiseFilters()

      // 创建但不连接，让系统准备好
      this.source = this.context.createMediaStreamSource(this.stream)
      this.workletNode = new AudioWorkletNode(this.context, 'audio-chunk-processor')

      // 暂时不连接，等待正式开始录音

      this.warmedUp = true
      const elapsed = performance.now() - startTime
      console.log(`[VoiceRecorder] Warmup complete in ${elapsed.toFixed(1)}ms`)
    } catch (error) {
      console.warn('[VoiceRecorder] Warmup failed:', error)
    }
  }

  /**
   * 创建噪声过滤器
   * - 高通滤波器 (80Hz): 去除低频噪声（风扇、空调、脚步声等）
   * - 低通滤波器 (8kHz): 去除高频噪声（电子设备干扰等）
   */
  private createNoiseFilters(): void {
    if (!this.context) return

    // 高通滤波器 - 去除 80Hz 以下的低频噪声
    this.highPassFilter = this.context.createBiquadFilter()
    this.highPassFilter.type = 'highpass'
    this.highPassFilter.frequency.value = 80
    this.highPassFilter.Q.value = 0.7 // 平滑的滚降曲线

    // 低通滤波器 - 去除 8kHz 以上的高频噪声
    // 对于语音来说，大部分能量在 300Hz-3400Hz，8kHz 已经足够宽松
    this.lowPassFilter = this.context.createBiquadFilter()
    this.lowPassFilter.type = 'lowpass'
    this.lowPassFilter.frequency.value = 8000
    this.lowPassFilter.Q.value = 0.7

    console.log('[VoiceRecorder] Noise filters created (80Hz highpass, 8kHz lowpass)')
  }

  async start(): Promise<void> {
    if (this.recording) return

    console.log('[VoiceRecorder] Starting...')

    // 如果没有预热，现在初始化
    if (!this.warmedUp) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })

      this.context = new AudioContext()
      await this.context.audioWorklet.addModule('./audio-worklet-processor.js')

      // 创建噪声过滤器
      this.createNoiseFilters()

      this.source = this.context.createMediaStreamSource(this.stream)
      this.workletNode = new AudioWorkletNode(this.context, 'audio-chunk-processor')
    }

    if (!this.source || !this.workletNode || !this.context) {
      throw new Error('VoiceRecorder not properly initialized')
    }

    // 直接转发 Int16 音频到 Main Process，不在主线程做任何处理
    this.workletNode.port.onmessage = (event) => {
      if (!this.recording) return
      const { samples } = event.data
      if (samples) {
        updateOrbAudioEnergy('input', samples)
        // 直接发送到 Main Process，VAD 在那边处理
        window.electronAPI.appendSpeechStream(samples)
      }
    }

    // 通过噪声过滤器连接音频链
    // source -> highpass -> lowpass -> worklet -> destination
    if (this.highPassFilter && this.lowPassFilter) {
      this.source.connect(this.highPassFilter)
      this.highPassFilter.connect(this.lowPassFilter)
      this.lowPassFilter.connect(this.workletNode)
      console.log('[VoiceRecorder] Connected with noise filters')
    } else {
      // 降级：直接连接
      this.source.connect(this.workletNode)
      console.log('[VoiceRecorder] Connected without noise filters')
    }

    this.workletNode.connect(this.context.destination)
    this.recording = true
    console.log('[VoiceRecorder] Started')
  }

  async stop(): Promise<void> {
    this.recording = false

    // 断开所有节点连接
    this.workletNode?.disconnect()
    this.lowPassFilter?.disconnect()
    this.highPassFilter?.disconnect()
    this.source?.disconnect()

    // 停止麦克风
    this.stream?.getTracks().forEach((track) => track.stop())

    // 关闭 AudioContext
    await this.context?.close()

    // 清理所有引用
    this.workletNode = null
    this.lowPassFilter = null
    this.highPassFilter = null
    this.source = null
    this.stream = null
    this.context = null
    this.warmedUp = false // 重置预热状态
  }

  isRecording(): boolean {
    return this.recording
  }
}

// ========== UI ==========

const audioPlayer = new AudioPlayer()
const textRevealer = new AudioSyncedTextRevealer(
  () => audioPlayer.getCurrentTime(),
  (text) => setTextDisplay(text)
)
let isInitialized = false
let activeMode: 'conversation' | null = null
let ttsEnabled = false
let voiceInputEnabled = true
let isVoiceListening = false
let conversationStreamActive = false

type LLMModelConfig = {
  id: string
  modelName: string
  apiKey: string
  baseUrl: string
}

type TTSProviderType = 'fish'

type TTSModelConfig = {
  id: string
  provider: TTSProviderType
  modelName: string
  apiKey: string
  voiceId?: string
}

type ASRProviderType = 'qwen'

type ASRModelConfig = {
  id: string
  provider: ASRProviderType
  modelName: string
  apiKey: string
}

type SystemConfig = {
  proxy: string
  llmModels: LLMModelConfig[]
  activeLLMId: string
  taskModels: LLMModelConfig[]
  activeTaskId: string
  ttsModels: TTSModelConfig[]
  activeTTSId: string
  asrModels: ASRModelConfig[]
  activeASRId: string
}

type LocalModelStatus = {
  id: 'silero-vad' | 'smart-turn'
  name: string
  filename: string
  purpose: string
  exists: boolean
  sizeBytes?: number
  path: string
}

type SetupIssueKind = 'llm' | 'task' | 'tts' | 'asr' | 'models'

type SetupIssue = {
  kind: SetupIssueKind
  label: string
  message: string
}

type SetupReadiness = {
  ready: boolean
  issues: SetupIssue[]
}

type UISettings = {
  voiceInputEnabled: boolean
  voiceOutputEnabled: boolean
  volume: number
  selectedPersonality: string
  plugins: Record<string, boolean>
  pluginConfigs: Record<string, Record<string, unknown>>
  system: SystemConfig
}

type PluginConfigField =
  | {
      key: string
      label?: string
      description?: string
      type: 'string'
      default?: string
      placeholder?: string
      multiline?: boolean
      rows?: number
    }
  | {
      key: string
      label?: string
      description?: string
      type: 'number'
      default?: number
      min?: number
      max?: number
      step?: number
    }
  | {
      key: string
      label?: string
      description?: string
      type: 'boolean'
      default?: boolean
    }
  | {
      key: string
      label?: string
      description?: string
      type: 'select'
      default?: string
      options: Array<{ label: string; value: string }>
    }

type PluginInfo = {
  id: string
  name: string
  description?: string
  version?: string
  enabled: boolean
  pluginDir: string
  config: Record<string, unknown>
  configSchema: PluginConfigField[]
}

type ConversationFrame =
  | { type: 'system.reset' }
  | { type: 'control.phase_start'; phase: 'reply' | 'task' | 'task_result' }
  | { type: 'control.phase_end'; phase: 'reply' | 'task' | 'task_result' }
  | { type: 'control.task_start'; taskDescription: string }
  | { type: 'control.task_end'; success: boolean; summary: string; error?: string }
  | { type: 'data.tts_text'; text: string }
  | {
      type: 'expression.show'
      id: string
      emotion: string
      src: string
      durationMs: number
      priority?: number
    }

const voiceRecorder = new VoiceRecorder()

// Canvas rendering
const canvas = document.getElementById('orb-canvas') as HTMLCanvasElement
const ctx = canvas.getContext('2d', { alpha: true })!

interface OrbState {
  mode: 'idle' | 'listening' | 'thinking' | 'speaking' | 'interrupted'
  glow: number
  breatheRate: number
  modeChangedAt: number
}

let orbState: OrbState = {
  mode: 'idle',
  glow: 4,
  breatheRate: 1.2,
  modeChangedAt: performance.now()
}
let orbAnimationFrameId: number | null = null
let orbAnimationPaused = false
let orbInputEnergy = 0
let orbOutputEnergy = 0
let orbEnergyUpdatedAt = performance.now()

// Store current radius for mouse detection
let currentOrbRadius = 22

function updateOrbAudioEnergy(source: 'input' | 'output', samples: Int16Array | Uint8Array): void {
  const next = calculatePcmEnergy(samples)
  if (source === 'input') {
    orbInputEnergy = Math.max(orbInputEnergy * 0.72, next)
  } else {
    orbOutputEnergy = Math.max(orbOutputEnergy * 0.70, next)
  }
  orbEnergyUpdatedAt = performance.now()
}

function calculatePcmEnergy(samples: Int16Array | Uint8Array): number {
  const pcm = samples instanceof Int16Array
    ? samples
    : new Int16Array(samples.buffer, samples.byteOffset, Math.floor(samples.byteLength / 2))

  if (pcm.length === 0) {
    return 0
  }

  let sumSquares = 0
  let peak = 0
  const stride = Math.max(1, Math.floor(pcm.length / 2400))

  for (let i = 0; i < pcm.length; i += stride) {
    const normalized = Math.abs(pcm[i]) / 32768
    sumSquares += normalized * normalized
    if (normalized > peak) {
      peak = normalized
    }
  }

  const count = Math.ceil(pcm.length / stride)
  const rms = Math.sqrt(sumSquares / count)
  const energy = rms * 4.8 + peak * 0.55
  return Math.max(0, Math.min(1, energy))
}

function getOrbAudioEnergy(mode: OrbState['mode']): number {
  const now = performance.now()
  const decay = Math.exp(-(now - orbEnergyUpdatedAt) / 220)
  orbInputEnergy *= decay
  orbOutputEnergy *= decay
  orbEnergyUpdatedAt = now

  if (mode === 'listening') {
    return orbInputEnergy
  }

  if (mode === 'speaking') {
    return orbOutputEnergy
  }

  return Math.max(orbInputEnergy, orbOutputEnergy) * 0.35
}

function drawOrb() {
  if (orbAnimationPaused) {
    orbAnimationFrameId = null
    return
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const centerX = canvas.width / 2
  const centerY = canvas.height / 2
  const time = Date.now() / 1000
  const elapsed = performance.now() - orbState.modeChangedAt
  const palette = getOrbPalette(orbState.mode)
  const audioEnergy = getOrbAudioEnergy(orbState.mode)
  const breathe = Math.sin(time * orbState.breatheRate) * palette.breathe
  const interruptedPulse = orbState.mode === 'interrupted'
    ? Math.max(0, 1 - elapsed / 220)
    : 0
  const speakingPulse = orbState.mode === 'speaking'
    ? Math.sin(time * 8.2) * 1.5 + Math.sin(time * 13.1) * 0.8
    : 0
  const currentRadius = 22 + breathe + speakingPulse + audioEnergy * 4.5 - interruptedPulse * 3
  currentOrbRadius = currentRadius // Update for mouse detection

  drawOrbAura(centerX, centerY, currentRadius, time, palette, interruptedPulse, audioEnergy)

  ctx.save()
  ctx.shadowColor = palette.shadow
  ctx.shadowBlur = 14 + orbState.glow * palette.shadowStrength
  ctx.shadowOffsetY = 3

  const coreGradient = ctx.createRadialGradient(
    centerX - currentRadius * 0.48,
    centerY - currentRadius * 0.54,
    0,
    centerX + currentRadius * 0.22,
    centerY + currentRadius * 0.34,
    currentRadius * 1.28
  )
  coreGradient.addColorStop(0, palette.coreTop)
  coreGradient.addColorStop(0.26, palette.coreMid)
  coreGradient.addColorStop(0.55, palette.coreTint)
  coreGradient.addColorStop(0.78, palette.coreLow)
  coreGradient.addColorStop(1, 'rgba(0, 0, 0, 1)')

  ctx.fillStyle = coreGradient
  ctx.beginPath()
  ctx.arc(centerX, centerY, currentRadius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  drawOrbColorVeil(centerX, centerY, currentRadius, time, palette)
  drawOrbInnerLight(centerX, centerY, currentRadius, time, palette)
  drawOrbMembrane(centerX, centerY, currentRadius, time, palette, audioEnergy)

  const highlight = ctx.createRadialGradient(
    centerX - currentRadius * 0.34,
    centerY - currentRadius * 0.46,
    0,
    centerX - currentRadius * 0.34,
    centerY - currentRadius * 0.46,
    currentRadius * 0.42
  )
  highlight.addColorStop(0, palette.highlight)
  highlight.addColorStop(0.42, 'rgba(255, 255, 255, 0.16)')
  highlight.addColorStop(1, 'rgba(255, 255, 255, 0)')

  ctx.fillStyle = highlight
  ctx.beginPath()
  ctx.arc(centerX, centerY, currentRadius, 0, Math.PI * 2)
  ctx.fill()

  orbAnimationFrameId = requestAnimationFrame(drawOrb)
}

type OrbPalette = {
  breathe: number
  shadow: string
  shadowStrength: number
  coreTop: string
  coreMid: string
  coreTint: string
  coreLow: string
  highlight: string
  ring: string
  ringSoft: string
  inner: string
  veilA: string
  veilB: string
}

function getOrbPalette(mode: OrbState['mode']): OrbPalette {
  switch (mode) {
    case 'listening':
      return {
        breathe: 1.5,
        shadow: 'rgba(76, 210, 190, 0.42)',
        shadowStrength: 1.05,
        coreTop: 'rgba(136, 186, 176, 1)',
        coreMid: 'rgba(35, 76, 72, 1)',
        coreTint: 'rgba(7, 36, 35, 1)',
        coreLow: 'rgba(1, 9, 10, 1)',
        highlight: 'rgba(225, 255, 250, 0.58)',
        ring: 'rgba(105, 225, 205, 0.34)',
        ringSoft: 'rgba(105, 225, 205, 0.12)',
        inner: 'rgba(125, 235, 214, 0.24)',
        veilA: 'rgba(83, 230, 205, 0.16)',
        veilB: 'rgba(90, 155, 255, 0.10)',
      }
    case 'thinking':
      return {
        breathe: 1.2,
        shadow: 'rgba(226, 74, 144, 0.38)',
        shadowStrength: 1.15,
        coreTop: 'rgba(156, 114, 150, 1)',
        coreMid: 'rgba(70, 36, 63, 1)',
        coreTint: 'rgba(35, 14, 35, 1)',
        coreLow: 'rgba(9, 3, 12, 1)',
        highlight: 'rgba(255, 226, 242, 0.56)',
        ring: 'rgba(226, 74, 144, 0.28)',
        ringSoft: 'rgba(226, 74, 144, 0.10)',
        inner: 'rgba(255, 180, 220, 0.26)',
        veilA: 'rgba(226, 74, 144, 0.16)',
        veilB: 'rgba(118, 98, 255, 0.12)',
      }
    case 'speaking':
      return {
        breathe: 1.25,
        shadow: 'rgba(255, 190, 112, 0.36)',
        shadowStrength: 1.05,
        coreTop: 'rgba(180, 126, 80, 1)',
        coreMid: 'rgba(82, 49, 28, 1)',
        coreTint: 'rgba(43, 20, 10, 1)',
        coreLow: 'rgba(11, 5, 2, 1)',
        highlight: 'rgba(255, 238, 212, 0.56)',
        ring: 'rgba(255, 197, 120, 0.32)',
        ringSoft: 'rgba(255, 197, 120, 0.12)',
        inner: 'rgba(255, 198, 126, 0.28)',
        veilA: 'rgba(255, 172, 91, 0.18)',
        veilB: 'rgba(255, 95, 118, 0.10)',
      }
    case 'interrupted':
      return {
        breathe: 0.7,
        shadow: 'rgba(255, 255, 255, 0.30)',
        shadowStrength: 1.2,
        coreTop: 'rgba(160, 160, 160, 1)',
        coreMid: 'rgba(58, 58, 58, 1)',
        coreTint: 'rgba(21, 21, 24, 1)',
        coreLow: 'rgba(5, 5, 6, 1)',
        highlight: 'rgba(255, 255, 255, 0.64)',
        ring: 'rgba(255, 255, 255, 0.36)',
        ringSoft: 'rgba(255, 255, 255, 0.12)',
        inner: 'rgba(255, 255, 255, 0.20)',
        veilA: 'rgba(255, 255, 255, 0.12)',
        veilB: 'rgba(190, 210, 255, 0.08)',
      }
    default:
      return {
        breathe: 1.0,
        shadow: 'rgba(0, 0, 0, 0.55)',
        shadowStrength: 0.7,
        coreTop: 'rgba(98, 98, 104, 1)',
        coreMid: 'rgba(29, 29, 33, 1)',
        coreTint: 'rgba(11, 12, 15, 1)',
        coreLow: 'rgba(2, 2, 3, 1)',
        highlight: 'rgba(255, 255, 255, 0.58)',
        ring: 'rgba(255, 255, 255, 0.11)',
        ringSoft: 'rgba(255, 255, 255, 0.045)',
        inner: 'rgba(255, 255, 255, 0.08)',
        veilA: 'rgba(130, 150, 170, 0.06)',
        veilB: 'rgba(255, 255, 255, 0.035)',
      }
  }
}

function drawOrbAura(
  centerX: number,
  centerY: number,
  radius: number,
  time: number,
  palette: OrbPalette,
  interruptedPulse: number,
  audioEnergy: number
): void {
  if (
    orbState.mode !== 'listening' &&
    orbState.mode !== 'speaking' &&
    orbState.mode !== 'thinking' &&
    orbState.mode !== 'interrupted'
  ) {
    return
  }

  ctx.save()
  ctx.lineWidth = 1.1 + audioEnergy * 1.1

  if (orbState.mode === 'thinking') {
    const orbit = radius + 8 + Math.sin(time * 1.3) * 1.6 + audioEnergy * 5
    ctx.strokeStyle = palette.ringSoft
    ctx.beginPath()
    ctx.arc(centerX, centerY, orbit, Math.PI * 0.18 + time * 0.5, Math.PI * 1.28 + time * 0.5)
    ctx.stroke()
    ctx.restore()
    return
  }

  const pulseSpeed = 3.2 + audioEnergy * 5
  const pulseA = orbState.mode === 'interrupted' ? interruptedPulse : (Math.sin(time * pulseSpeed) + 1) / 2
  const pulseB = orbState.mode === 'interrupted' ? interruptedPulse * 0.65 : (Math.sin(time * pulseSpeed + Math.PI) + 1) / 2
  const rings = [
    { amount: pulseA, alpha: 0.55 },
    { amount: pulseB, alpha: 0.32 },
  ]

  for (const ring of rings) {
    const ringRadius = radius + 6 + ring.amount * (13 + audioEnergy * 16)
    ctx.globalAlpha = (ring.alpha + audioEnergy * 0.26) * (1 - ring.amount * 0.65)
    ctx.strokeStyle = palette.ring
    ctx.beginPath()
    ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2)
    ctx.stroke()
  }

  ctx.restore()
}

function drawOrbColorVeil(
  centerX: number,
  centerY: number,
  radius: number,
  time: number,
  palette: OrbPalette
): void {
  const angleA = time * 0.55
  const angleB = -time * 0.38
  const veilA = ctx.createRadialGradient(
    centerX + Math.cos(angleA) * radius * 0.34,
    centerY + Math.sin(angleA * 0.8) * radius * 0.26,
    0,
    centerX + Math.cos(angleA) * radius * 0.34,
    centerY + Math.sin(angleA * 0.8) * radius * 0.26,
    radius * 1.05
  )
  veilA.addColorStop(0, palette.veilA)
  veilA.addColorStop(1, 'rgba(255, 255, 255, 0)')

  const veilB = ctx.createRadialGradient(
    centerX + Math.cos(angleB) * radius * 0.28,
    centerY + Math.sin(angleB * 0.9) * radius * 0.32,
    0,
    centerX + Math.cos(angleB) * radius * 0.28,
    centerY + Math.sin(angleB * 0.9) * radius * 0.32,
    radius * 0.92
  )
  veilB.addColorStop(0, palette.veilB)
  veilB.addColorStop(1, 'rgba(255, 255, 255, 0)')

  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  ctx.beginPath()
  ctx.arc(centerX, centerY, radius * 0.99, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = veilA
  ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2)
  ctx.fillStyle = veilB
  ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2)
  ctx.restore()
}

function drawOrbInnerLight(
  centerX: number,
  centerY: number,
  radius: number,
  time: number,
  palette: OrbPalette
): void {
  if (orbState.mode === 'idle') {
    return
  }

  const angle = time * (orbState.mode === 'thinking' ? 0.9 : 1.45)
  const offsetX = Math.cos(angle) * radius * 0.26
  const offsetY = Math.sin(angle * 0.85) * radius * 0.18
  const inner = ctx.createRadialGradient(
    centerX + offsetX,
    centerY + offsetY,
    0,
    centerX + offsetX,
    centerY + offsetY,
    radius * 0.9
  )
  inner.addColorStop(0, palette.inner)
  inner.addColorStop(1, 'rgba(255, 255, 255, 0)')

  ctx.save()
  ctx.fillStyle = inner
  ctx.beginPath()
  ctx.arc(centerX, centerY, radius * 0.98, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawOrbMembrane(
  centerX: number,
  centerY: number,
  radius: number,
  time: number,
  palette: OrbPalette,
  audioEnergy: number
): void {
  if (audioEnergy < 0.015 && orbState.mode !== 'speaking' && orbState.mode !== 'listening') {
    return
  }

  const points = 96
  const baseRipple = orbState.mode === 'speaking' || orbState.mode === 'listening'
    ? 0.7
    : 0.25
  const rippleAmount = baseRipple + audioEnergy * 4.8

  ctx.save()
  ctx.globalAlpha = Math.min(0.72, 0.22 + audioEnergy * 0.72)
  ctx.strokeStyle = palette.ring
  ctx.lineWidth = 0.9 + audioEnergy * 1.5
  ctx.beginPath()

  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * Math.PI * 2
    const ripple =
      Math.sin(angle * 7 + time * 8.5) * rippleAmount * 0.42 +
      Math.sin(angle * 11 - time * 5.7) * rippleAmount * 0.32 +
      Math.sin(angle * 17 + time * 3.6) * rippleAmount * 0.18
    const nextRadius = radius + 1.5 + ripple
    const x = centerX + Math.cos(angle) * nextRadius
    const y = centerY + Math.sin(angle) * nextRadius

    if (i === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  }

  ctx.stroke()

  if (audioEnergy > 0.08) {
    ctx.globalAlpha = Math.min(0.26, audioEnergy * 0.42)
    ctx.lineWidth = 0.7
    ctx.beginPath()
    for (let i = 0; i <= points; i++) {
      const angle = (i / points) * Math.PI * 2
      const ripple = Math.sin(angle * 9 - time * 9.2) * audioEnergy * 6
      const nextRadius = radius + 6 + ripple
      const x = centerX + Math.cos(angle) * nextRadius
      const y = centerY + Math.sin(angle) * nextRadius

      if (i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.stroke()
  }

  ctx.restore()
}

function startOrbAnimation(): void {
  if (orbAnimationFrameId !== null || orbAnimationPaused) {
    return
  }

  drawOrb()
}

function stopOrbAnimation(): void {
  if (orbAnimationFrameId !== null) {
    cancelAnimationFrame(orbAnimationFrameId)
    orbAnimationFrameId = null
  }
}

startOrbAnimation()

// Helper function to check if point is inside orb
function isPointInOrb(clientX: number, clientY: number): boolean {
  const rect = canvas.getBoundingClientRect()
  const x = clientX - rect.left
  const y = clientY - rect.top
  const centerX = canvas.width / 2
  const centerY = canvas.height / 2

  const dx = x - centerX
  const dy = y - centerY
  const distance = Math.sqrt(dx * dx + dy * dy)

  return distance <= currentOrbRadius
}

// Track drag state
let isDragging = false
let lastMouseX = 0
let lastMouseY = 0

// Mouse interaction - canvas 区域任意位置都可拖动
canvas.addEventListener('mousemove', (e) => {
  if (isDragging) {
    const deltaX = e.screenX - lastMouseX
    const deltaY = e.screenY - lastMouseY
    lastMouseX = e.screenX
    lastMouseY = e.screenY
    window.electronAPI.moveWindow(deltaX, deltaY)
  } else {
    // 在小球上显示 grab 光标，其他区域显示 move
    canvas.style.cursor = isPointInOrb(e.clientX, e.clientY) ? 'grab' : 'move'
  }
})

canvas.addEventListener('mouseleave', () => {
  if (!isDragging) {
    canvas.style.cursor = 'default'
  }
})

// Canvas 任意位置都可以开始拖动
canvas.addEventListener('mousedown', (e) => {
  isDragging = true
  lastMouseX = e.screenX
  lastMouseY = e.screenY
  canvas.style.cursor = 'grabbing'
})

canvas.addEventListener('mouseup', (e) => {
  if (isDragging) {
    isDragging = false
    canvas.style.cursor = isPointInOrb(e.clientX, e.clientY) ? 'grab' : 'move'
  }
})

document.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false
    canvas.style.cursor = 'default'
  }
})

function setOrbMode(mode: OrbState['mode']) {
  if (orbState.mode === mode) {
    return
  }

  orbState.mode = mode
  orbState.modeChangedAt = performance.now()
  switch (mode) {
    case 'listening':
      orbState.glow = 8
      orbState.breatheRate = 2.8
      break
    case 'thinking':
      orbState.glow = 11
      orbState.breatheRate = 1.65
      break
    case 'speaking':
      orbState.glow = 10
      orbState.breatheRate = 2.15
      break
    case 'interrupted':
      orbState.glow = 13
      orbState.breatheRate = 3.6
      break
    default:
      orbState.glow = 4
      orbState.breatheRate = 1.2
  }
}

function flashOrbInterrupted(): void {
  setOrbMode('interrupted')
  window.setTimeout(() => {
    if (orbState.mode === 'interrupted') {
      setOrbMode('listening')
    }
  }, 180)
}

let lastStatusText = ''
function setStatus(text: string) {
  if (text === lastStatusText) return
  lastStatusText = text
  const statusEl = document.getElementById('status')!
  statusEl.textContent = text
}

function setTextDisplay(text: string) {
  const textDisplay = document.getElementById('text-display')!
  textDisplay.textContent = text
}

function clearTextDisplay() {
  setTextDisplay('')
}

let currentExpressionPriority = 0
let expressionClearTimer: number | undefined
let expressionRevealTimer: number | undefined
let expressionShownAt = 0

function clearExpression(): void {
  const layer = document.getElementById('expression-layer')!
  const image = document.getElementById('expression-image') as HTMLImageElement
  layer.classList.remove('visible', 'bubbles-visible')
  currentExpressionPriority = 0

  if (expressionClearTimer !== undefined) {
    window.clearTimeout(expressionClearTimer)
  }
  if (expressionRevealTimer !== undefined) {
    window.clearTimeout(expressionRevealTimer)
    expressionRevealTimer = undefined
  }

  expressionClearTimer = window.setTimeout(() => {
    if (!layer.classList.contains('visible')) {
      image.removeAttribute('src')
    }
    expressionClearTimer = undefined
  }, 220)
}

function showExpression(frame: Extract<ConversationFrame, { type: 'expression.show' }>): void {
  const priority = frame.priority ?? 0
  if (currentExpressionPriority > priority) {
    return
  }

  const layer = document.getElementById('expression-layer')!
  const image = document.getElementById('expression-image') as HTMLImageElement
  if (expressionClearTimer !== undefined) {
    window.clearTimeout(expressionClearTimer)
    expressionClearTimer = undefined
  }

  currentExpressionPriority = priority
  image.src = frame.src
  expressionShownAt = performance.now()
  layer.classList.remove('visible', 'bubbles-visible')
  layer.classList.add('bubbles-visible')
  expressionRevealTimer = window.setTimeout(() => {
    layer.classList.add('visible')
    expressionRevealTimer = undefined
  }, 180)
}

function clearExpressionAfterMinimum(): void {
  const elapsed = performance.now() - expressionShownAt
  const remaining = Math.max(0, 4000 - elapsed)
  if (expressionClearTimer !== undefined) {
    window.clearTimeout(expressionClearTimer)
  }

  expressionClearTimer = window.setTimeout(() => {
    clearExpression()
  }, remaining)
}

function handleConversationFrame(frame: ConversationFrame) {
  switch (frame.type) {
    case 'system.reset':
      textRevealer.reset()
      clearExpression()
      setStatus('Thinking...')
      setOrbMode('thinking')
      break
    case 'control.phase_start':
      if (frame.phase === 'reply') {
        setStatus('Replying...')
      } else if (frame.phase === 'task_result') {
        // 任务结果阶段开始前，停止之前的音频并清空文字
        // 注意：Main Process 的同步机制已确保 Phase 1 音频播放完毕
        // 这里的 stop() 是防御性措施，处理边缘情况
        audioPlayer.stop()
        textRevealer.reset()
        setStatus('Sharing result...')
      }
      setOrbMode('thinking')
      break
    case 'control.phase_end':
      // reply 阶段结束后，如果紧接着有任务，会收到 task_start
      // 如果没有任务，这就是最终状态，应该变成 idle
      // task_result 阶段结束后，一定是最终状态
      if (frame.phase === 'reply' || frame.phase === 'task_result') {
        setStatus(getReadyStatus())
        setOrbMode('idle')
        clearExpressionAfterMinimum()
      }
      break
    case 'control.task_start':
      setStatus('Working...')
      setOrbMode('thinking')
      break
    case 'control.task_end':
      if (!frame.success) {
        setStatus(frame.error ? `Task Error: ${frame.error}` : 'Task failed')
      }
      break
    case 'data.tts_text':
      textRevealer.enqueueText(frame.text)
      break
    case 'expression.show':
      showExpression(frame)
      break
  }
}

// ========== Event Handlers ==========

const startConversationBtn = document.getElementById('start-conversation-btn') as HTMLButtonElement

function updateConversationButton(): void {
  startConversationBtn.textContent = voiceInputEnabled
    ? (activeMode === 'conversation' ? 'Stop' : 'Start Conversation')
    : 'Voice Disabled'
}

function getReadyStatus(): string {
  return activeMode === 'conversation' ? 'Listening...' : 'Ready'
}

async function initialize() {
  if (isInitialized) {
    return
  }

  setStatus('Initializing...')
  startConversationBtn.disabled = true

  try {
    await audioPlayer.initialize()
    audioPlayer.setChunkScheduledHandler(({ startTime, duration }) => {
      textRevealer.scheduleAudioWindow(startTime, duration)
    })
    audioPlayer.setPlaybackStartHandler(() => {
      setOrbMode('speaking')
    })

    // 调用初始化（不传 config）
    const result = await window.electronAPI.initializeConversation()

    if (!result.success) {
      throw new Error(result.error || 'Initialization failed')
    }

    isInitialized = true
    ttsEnabled = Boolean(result.ttsEnabled)

    // 可选：输出 SDK 状态
    if (result.stats) {
      console.log('[SDK] Stats:', result.stats)
    }

    startConversationBtn.disabled = !voiceInputEnabled
    updateConversationButton()
    setStatus('Ready')

    // 监听 TTS 音频（带上下文 ID）
    window.electronAPI.onTTSAudio((audioData, contextId) => {
      console.log(`[UI] Received TTS audio (context #${contextId}):`, audioData.byteLength, 'bytes')
      audioPlayer.addAudioChunk(audioData, contextId)
    })

    // 监听 TTS 上下文开始
    window.electronAPI.onTTSContextStart((contextId) => {
      console.log(`[UI] TTS context started: #${contextId}`)
      audioPlayer.setValidContextId(contextId)
    })

    // 监听 TTS 上下文失效（打断时触发）
    window.electronAPI.onTTSContextInvalidated((contextId) => {
      console.log(`[UI] TTS context invalidated: #${contextId}`)
      audioPlayer.invalidateContext(contextId)
    })

    // 监听对话响应
    window.electronAPI.onConversationResponse((text) => {
      if (!ttsEnabled) {
        setTextDisplay(text)
      }
    })

    window.electronAPI.onConversationFrame((frame) => {
      handleConversationFrame(frame as ConversationFrame)
    })

    // 监听 TTS 事件
    window.electronAPI.onTTSConnected((contextId) => {
      console.log(`[UI] TTS connected (context #${contextId})`)
      setOrbMode('thinking')
      // 重置延迟追踪
      audioPlayer.resetLatencyTracking()
    })

    window.electronAPI.onTTSClosed(() => {
      console.log('[UI] TTS closed')
    })

    window.electronAPI.onTTSError((error) => {
      console.error('[UI] TTS error:', error)
      setStatus(`TTS Error: ${error}`)
    })

    // 监听延迟数据
    window.electronAPI.onLatencyData((data) => {
      console.log('[Latency] Received data:', data)
      if (data.total) {
        const msg = `延迟: ${data.total.toFixed(0)}ms`
        console.log(`[Latency] ${msg}`)
        // 显示在状态栏（短暂显示）
        setStatus(msg)
        setTimeout(() => setStatus('Ready'), 3000)
      }
    })

    // 监听语音识别事件 (VAD 在 Main Process 处理)
    window.electronAPI.onSpeechState((state) => {
      console.log('[UI] Speech state:', state)
      if (state === 'listening') {
        setStatus('Listening...')
        setOrbMode('listening')
      } else if (state === 'processing') {
        setStatus('Processing...')
        setOrbMode('thinking')
      }
    })

    window.electronAPI.onSpeechTranscript((text) => {
      console.log('[UI] Transcript:', text)
      // 语音 turn 已在 Main Process 的 frame graph 内部送入 LLM。
      // Renderer 只负责展示/状态更新，避免 transcript -> sendText 回环。
    })

    window.electronAPI.onSpeechError((error) => {
      console.error('[UI] Speech error:', error)
      setStatus(`Speech Error: ${error}`)
      setOrbMode('idle')
    })

    // WebSocket 重连事件
    window.electronAPI.onSpeechReconnecting(() => {
      console.log('[UI] Speech WebSocket reconnecting...')
      setStatus('Reconnecting...')
    })

    window.electronAPI.onSpeechReconnected(() => {
      console.log('[UI] Speech WebSocket reconnected')
      setStatus('Listening...')
    })

    window.electronAPI.onSpeechConnectionFailed(() => {
      console.error('[UI] Speech WebSocket connection failed')
      setStatus('Connection failed')
      setOrbMode('idle')
    })

    // 用户开始说话时停止当前播放
    window.electronAPI.onUserSpeaking(() => {
      console.log('[UI] User started speaking, stopping playback')
      audioPlayer.stop()
      textRevealer.reset()
      clearTextDisplay()
      setOrbMode('listening')
    })

    // 打断事件处理（用户在机器人说话时开始说话）
    window.electronAPI.onInterruption((turnId) => {
      console.log(`[UI] Interruption detected for turn #${turnId}, clearing all queues`)
      // 停止所有音频播放
      audioPlayer.stop()
      // 清空文字显示队列
      textRevealer.reset()
      // 清空当前显示的文字
      clearTextDisplay()
      // 切换到监听状态
      flashOrbInterrupted()
    })

    // 新轮次开始
    window.electronAPI.onTurnStart((turnId) => {
      console.log(`[UI] New turn started: #${turnId}`)
      // 新轮次开始时，清空之前的状态
      audioPlayer.stop()
      textRevealer.reset()
      clearTextDisplay()
    })

    // 响应 Main Process 的播放完成等待请求
    window.electronAPI.onPlaybackWaitRequest(async (requestId) => {
      console.log('[UI] Playback wait request received:', requestId)
      await audioPlayer.waitForPlaybackComplete()
      console.log('[UI] Playback complete, notifying main process:', requestId)
      window.electronAPI.notifyPlaybackComplete(requestId)
    })
  } catch (error: any) {
    console.error('Initialization error:', error)
    setStatus(`Error: ${error.message}`)
    startConversationBtn.disabled = false
  }
}

async function stopConversationStreaming(): Promise<void> {
  try {
    conversationStreamActive = false
    isVoiceListening = false

    if (voiceRecorder.isRecording()) {
      await voiceRecorder.stop()
    }

    await window.electronAPI.stopSpeechStream()
  } catch (error: any) {
    setStatus(`Voice Error: ${error.message}`)
    setOrbMode('idle')
  }
}

// 简化的对话流 - VAD 和 ASR 全在 Main Process 处理
async function startConversationStreaming(): Promise<void> {
  if (conversationStreamActive && voiceRecorder.isRecording()) {
    return
  }

  const streamResult = await window.electronAPI.startSpeechStream()
  if (!streamResult.success) {
    throw new Error(streamResult.error || 'Failed to start speech stream')
  }

  // VoiceRecorder 现在直接发送音频到 Main Process
  await voiceRecorder.start()

  conversationStreamActive = true
  isVoiceListening = true
  setStatus('Listening...')
  setOrbMode('listening')
}

startConversationBtn.addEventListener('click', async () => {
  if (activeMode === 'conversation') {
    await stopConversationStreaming()
    activeMode = null
    updateConversationButton()
    setStatus('Ready')
    setOrbMode('idle')
    return
  }

  if (!voiceInputEnabled) {
    setStatus('Voice input is disabled')
    return
  }

  if (!await ensureSetupReadyForConversation()) {
    return
  }

  await initialize()

  // 预热麦克风（用户已交互，可以安全初始化）
  voiceRecorder.warmup().catch(console.warn)

  activeMode = 'conversation'
  await startConversationStreaming()
  updateConversationButton()
})

async function sendMessage(text: string) {
  if (!text.trim() || !isInitialized) return

  audioPlayer.stop()
  textRevealer.reset()
  setOrbMode('thinking')
  clearTextDisplay()

  try {
    const result = await window.electronAPI.sendText(text, ttsEnabled)

    if (!result.success) {
      throw new Error(result.error)
    }
  } catch (error: any) {
    console.error('Send error:', error)
    setStatus(`Error: ${error.message}`)
    setOrbMode('idle')
  } finally {
    if (activeMode === 'conversation' && conversationStreamActive && voiceInputEnabled) {
      setStatus('Listening...')
    } else {
      setStatus(getReadyStatus())
    }
  }
}

// ========== Context Menu & Settings Panel ==========

const contextMenu = document.getElementById('context-menu')!
const settingsPanel = document.getElementById('settings-panel')!
const settingsClose = document.getElementById('settings-close')!
const mainView = document.getElementById('main-view')!
const settingsNav = document.querySelector('.settings-nav') as HTMLElement
const systemNavItem = document.querySelector('.nav-item[data-section="system"]') as HTMLElement | null
const systemNavLabel = systemNavItem?.querySelector('.nav-label') as HTMLElement | null

let setupReadiness: SetupReadiness = { ready: true, issues: [] }
const volumeSlider = document.getElementById('volume-slider') as HTMLInputElement
const volumeValue = document.getElementById('volume-value')!
const voiceInputBtn = document.getElementById('voice-input-btn') as HTMLButtonElement
const voiceOutputToggle = document.getElementById('voice-output-toggle') as HTMLInputElement
const personalitySelect = document.getElementById('personality-select') as HTMLSelectElement
const addPersonalityFileBtn = document.getElementById('add-personality-file-btn') as HTMLButtonElement
const pluginsList = document.getElementById('plugins-list') as HTMLElement
let memoryRefreshPromise: Promise<void> | null = null
let cachedPlugins: PluginInfo[] = []

function applySettingsToUI(settings: UISettings) {
  voiceInputEnabled = settings.voiceInputEnabled
  ttsEnabled = settings.voiceOutputEnabled
  voiceInputBtn.textContent = settings.voiceInputEnabled ? '已开启' : '开启'
  voiceInputBtn.classList.toggle('active', settings.voiceInputEnabled)
  voiceOutputToggle.checked = settings.voiceOutputEnabled
  volumeSlider.value = String(settings.volume)
  volumeValue.textContent = `${settings.volume}%`
  audioPlayer.setVolume(settings.volume)

  startConversationBtn.disabled = !settings.voiceInputEnabled
  updateConversationButton()
}

async function loadSettings(): Promise<void> {
  const settings = await window.electronAPI.getSettings()
  const permission = await window.electronAPI.getMicrophonePermissionStatus()

  if (
    settings.voiceInputEnabled &&
    permission.success &&
    permission.status &&
    permission.status !== 'granted' &&
    permission.status !== 'not-determined'
  ) {
    settings.voiceInputEnabled = false
    await window.electronAPI.updateSettings({ voiceInputEnabled: false })
  }

  applySettingsToUI(settings)
}

async function disableVoiceInput(): Promise<void> {
  const settings = await window.electronAPI.updateSettings({
    voiceInputEnabled: false
  })

  if (voiceRecorder.isRecording()) {
    await voiceRecorder.stop()
    isVoiceListening = false
    conversationStreamActive = false
    await window.electronAPI.stopSpeechStream()
  }

  applySettingsToUI(settings)
  setStatus('语音输入已关闭')
}

async function enableVoiceInput(): Promise<void> {
  const permissionStatus = await window.electronAPI.getMicrophonePermissionStatus()
  const currentStatus = permissionStatus.success ? permissionStatus.status : undefined

  if (currentStatus !== 'granted') {
    const permission = await window.electronAPI.requestMicrophonePermission()
    if (!permission.success || !permission.granted) {
      setStatus(permission.openedSettings
        ? '请在系统设置中开启麦克风权限'
        : (permission.error || '麦克风权限未授予'))
      return
    }
  }

  const settings = await window.electronAPI.updateSettings({
    voiceInputEnabled: true
  })
  applySettingsToUI(settings)
  setStatus('语音输入已开启')
}

async function loadPersonalities(): Promise<void> {
  const result = await window.electronAPI.listPersonalities()
  if (!result.success) {
    setStatus(`人格列表加载失败: ${result.error ?? 'unknown error'}`)
    return
  }

  personalitySelect.innerHTML = ''
  result.items.forEach((item) => {
    const option = document.createElement('option')
    option.value = item.id
    option.textContent = item.source === 'file'
      ? `${item.name} · 外部文件`
      : item.name
    option.title = item.path
    option.selected = item.id === result.current
    personalitySelect.appendChild(option)
  })
}

// Hide context menu when clicking elsewhere
document.addEventListener('click', () => {
  contextMenu.classList.remove('visible')
})

// Right-click on canvas to show context menu
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault()

  // Position the menu at click location
  const x = Math.min(e.clientX, window.innerWidth - 180)
  const y = Math.min(e.clientY, window.innerHeight - 150)

  contextMenu.style.left = `${x}px`
  contextMenu.style.top = `${y}px`
  contextMenu.classList.add('visible')
})

// Context menu actions
contextMenu.addEventListener('click', (e) => {
  const target = e.target as HTMLElement
  const item = target.closest('.context-menu-item') as HTMLElement
  if (!item) return

  const action = item.dataset.action

  switch (action) {
    case 'settings':
      openSettings()
      break
    case 'clear-history':
      clearHistory()
      break
    case 'about':
      // Could show about dialog
      console.log('About Her-Text v0.1.0')
      break
  }

  contextMenu.classList.remove('visible')
})

// Open settings panel
function switchSettingsSection(section: string): void {
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'))
  document.querySelector(`.nav-item[data-section="${cssEscape(section)}"]`)?.classList.add('active')
  document.querySelectorAll('.settings-section').forEach(sec => sec.classList.remove('active'))
  document.getElementById(`section-${section}`)?.classList.add('active')

  if (section === 'memory') {
    void refreshMemorySection()
  }
  if (section === 'system') {
    void loadSystemConfig()
  }
  if (section === 'plugins') {
    void loadPluginsSection()
  }
}

function openSettings(section?: string) {
  orbAnimationPaused = true
  stopOrbAnimation()
  document.body.classList.add('settings-open')
  settingsPanel.classList.add('visible')
  mainView.setAttribute('aria-hidden', 'true')
  void refreshSetupReadiness()

  if (section) {
    switchSettingsSection(section)
  } else if (isMemorySectionActive()) {
    void refreshMemorySection()
  }
}

// Close settings panel
function closeSettings() {
  orbAnimationPaused = false
  document.body.classList.remove('settings-open')
  settingsPanel.classList.remove('visible')
  mainView.removeAttribute('aria-hidden')
  startOrbAnimation()
}

function handleSettingsClose(event: Event) {
  event.preventDefault()
  event.stopPropagation()
  closeSettings()
}

settingsClose.addEventListener('pointerdown', handleSettingsClose)
settingsClose.addEventListener('click', handleSettingsClose)

type ConfirmDialogTone = 'danger' | 'default'

type ConfirmDialogOptions = {
  title: string
  message: string
  detail?: string
  confirmText?: string
  cancelText?: string
  tone?: ConfirmDialogTone
}

function showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'confirm-dialog-overlay'
    overlay.setAttribute('role', 'presentation')
    let settled = false

    const tone = options.tone ?? 'default'
    const confirmText = options.confirmText ?? '确认'
    const cancelText = options.cancelText ?? '取消'

    overlay.innerHTML = `
      <div class="confirm-dialog ${tone}" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <div class="confirm-dialog-icon" aria-hidden="true"></div>
        <div class="confirm-dialog-content">
          <h3 id="confirm-dialog-title">${escapeHtml(options.title)}</h3>
          <p>${escapeHtml(options.message)}</p>
          ${options.detail ? `<div class="confirm-dialog-detail">${escapeHtml(options.detail)}</div>` : ''}
        </div>
        <div class="confirm-dialog-actions">
          <button class="confirm-dialog-btn secondary" type="button" data-confirm-action="cancel">${escapeHtml(cancelText)}</button>
          <button class="confirm-dialog-btn primary" type="button" data-confirm-action="confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `

    const cleanup = (value: boolean) => {
      if (settled) return
      settled = true
      document.removeEventListener('keydown', handleKeydown, true)
      overlay.classList.add('closing')
      window.setTimeout(() => {
        overlay.remove()
        resolve(value)
      }, 120)
    }

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cleanup(false)
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        cleanup(true)
      }
    }

    overlay.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      const action = target.closest<HTMLButtonElement>('[data-confirm-action]')?.dataset.confirmAction
      if (action === 'confirm') {
        cleanup(true)
      } else if (action === 'cancel' || target === overlay) {
        cleanup(false)
      }
    })

    document.body.appendChild(overlay)
    document.addEventListener('keydown', handleKeydown, true)
    requestAnimationFrame(() => {
      overlay.classList.add('visible')
      overlay.querySelector<HTMLButtonElement>('[data-confirm-action="cancel"]')?.focus({ preventScroll: true })
    })
  })
}

// Close settings with Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.querySelector('.confirm-dialog-overlay')) {
      return
    }
    if (settingsPanel.classList.contains('visible')) {
      closeSettings()
    }
  }
})

// Settings nav - 支持拖动和点击切换
let isNavDragging = false
let navDragStartX = 0
let navDragStartY = 0
let navMouseDownTarget: HTMLElement | null = null
let navTotalMovement = 0

settingsNav.addEventListener('mousedown', (e) => {
  isNavDragging = true
  navDragStartX = e.screenX
  navDragStartY = e.screenY
  navMouseDownTarget = e.target as HTMLElement
  navTotalMovement = 0
  settingsNav.style.cursor = 'grabbing'
})

settingsNav.addEventListener('mousemove', (e) => {
  if (isNavDragging) {
    const deltaX = e.screenX - navDragStartX
    const deltaY = e.screenY - navDragStartY
    navDragStartX = e.screenX
    navDragStartY = e.screenY
    navTotalMovement += Math.abs(deltaX) + Math.abs(deltaY)
    window.electronAPI.moveWindow(deltaX, deltaY)
  }
})

settingsNav.addEventListener('mouseup', (e) => {
  if (isNavDragging) {
    isNavDragging = false
    settingsNav.style.cursor = ''

    // 如果移动距离很小，视为点击，触发导航切换
    if (navTotalMovement < 5 && navMouseDownTarget) {
      const navItem = navMouseDownTarget.closest('.nav-item') as HTMLElement
      if (navItem) {
        const section = navItem.dataset.section
        if (section) {
          switchSettingsSection(section)
        }
      }
    }
    navMouseDownTarget = null
  }
})

settingsNav.addEventListener('mouseleave', () => {
  // 鼠标离开时继续支持拖动（通过 document 事件）
})

document.addEventListener('mouseup', () => {
  if (isNavDragging) {
    isNavDragging = false
    settingsNav.style.cursor = ''
    navMouseDownTarget = null
  }
})

document.addEventListener('mousemove', (e) => {
  if (isNavDragging) {
    const deltaX = e.screenX - navDragStartX
    const deltaY = e.screenY - navDragStartY
    navDragStartX = e.screenX
    navDragStartY = e.screenY
    navTotalMovement += Math.abs(deltaX) + Math.abs(deltaY)
    window.electronAPI.moveWindow(deltaX, deltaY)
  }
})

// Volume slider
volumeSlider.addEventListener('input', () => {
  const value = Number(volumeSlider.value)
  volumeValue.textContent = `${value}%`
  audioPlayer.setVolume(value)
  void window.electronAPI.updateSettings({ volume: value })
})

voiceInputBtn.addEventListener('click', async () => {
  voiceInputBtn.disabled = true

  try {
    if (voiceInputEnabled) {
      await disableVoiceInput()
    } else {
      await enableVoiceInput()
    }
  } finally {
    voiceInputBtn.disabled = false
  }
})

voiceOutputToggle.addEventListener('change', async () => {
  const settings = await window.electronAPI.updateSettings({
    voiceOutputEnabled: voiceOutputToggle.checked
  })
  applySettingsToUI(settings)
  if (!settings.voiceOutputEnabled) {
    await window.electronAPI.stopTTS()
    audioPlayer.stop()
  }
  setStatus(settings.voiceOutputEnabled ? '语音输出已开启' : '语音输出已关闭')
})

personalitySelect.addEventListener('change', async () => {
  const selected = personalitySelect.value
  const result = await window.electronAPI.setPersonality(selected)
  if (!result.success) {
    setStatus(`人格切换失败: ${result.error}`)
    return
  }

  await loadSettings()
  setStatus(`人格已切换为 ${personalitySelect.selectedOptions[0]?.textContent ?? selected}`)
})

async function loadPluginsSection(): Promise<void> {
  pluginsList.innerHTML = '<div class="profile-loading">加载中...</div>'

  const result = await window.electronAPI.listPlugins()
  if (!result.success) {
    pluginsList.innerHTML = `<div class="profile-loading">插件加载失败: ${escapeHtml(result.error ?? 'unknown error')}</div>`
    return
  }

  renderPluginsSection(result.plugins)
}

function renderPluginsSection(plugins: PluginInfo[]): void {
  cachedPlugins = plugins
  if (plugins.length === 0) {
    pluginsList.innerHTML = '<div class="profile-loading">未发现插件</div>'
    return
  }

  pluginsList.innerHTML = plugins.map(plugin => `
    <div class="plugin-card plugin-card-list" data-plugin-id="${escapeHtml(plugin.id)}">
      <div class="plugin-card-main">
        <div class="plugin-info">
          <div class="plugin-title-row">
            <span class="plugin-name">${escapeHtml(plugin.name)}</span>
            ${plugin.version ? `<span class="plugin-version">v${escapeHtml(plugin.version)}</span>` : ''}
          </div>
          <div class="plugin-id">${escapeHtml(plugin.id)}</div>
          ${plugin.description ? `<div class="plugin-description">${escapeHtml(plugin.description)}</div>` : ''}
        </div>
        <label class="settings-toggle plugin-toggle">
          <input type="checkbox" ${plugin.enabled ? 'checked' : ''} data-plugin-toggle="${escapeHtml(plugin.id)}" />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="plugin-card-footer">
        <span>${plugin.configSchema.length ? `${plugin.configSchema.length} 个参数` : '无可配置参数'}</span>
        <span class="plugin-enter">管理</span>
      </div>
    </div>
  `).join('')

  pluginsList.querySelectorAll<HTMLElement>('.plugin-card-list').forEach(card => {
    card.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('.plugin-toggle')) {
        return
      }
      const pluginId = card.dataset.pluginId
      const plugin = cachedPlugins.find(item => item.id === pluginId)
      if (plugin) {
        renderPluginDetail(plugin)
      }
    })
  })

  pluginsList.querySelectorAll<HTMLInputElement>('input[data-plugin-toggle]').forEach(input => {
    input.addEventListener('click', (event) => {
      event.stopPropagation()
    })
    input.addEventListener('change', async (event) => {
      event.stopPropagation()
      const pluginId = input.dataset.pluginToggle
      if (!pluginId) return

      input.disabled = true
      try {
        const settings = await window.electronAPI.getSettings()
        const nextPlugins = {
          ...(settings.plugins ?? {}),
          [pluginId]: input.checked,
        }
        await window.electronAPI.updateSettings({ plugins: nextPlugins })
        setStatus(input.checked ? '插件已启用' : '插件已禁用')
      } catch (error: any) {
        input.checked = !input.checked
        setStatus(`插件设置失败: ${error.message}`)
      } finally {
        input.disabled = false
      }
    })
  })

  bindPluginConfigInputs()
}

function renderPluginDetail(plugin: PluginInfo): void {
  pluginsList.innerHTML = `
    <div class="plugin-detail-header">
      <button class="plugin-back-btn" type="button">返回</button>
      <div class="plugin-detail-title">
        <span class="plugin-name">${escapeHtml(plugin.name)}</span>
        ${plugin.version ? `<span class="plugin-version">v${escapeHtml(plugin.version)}</span>` : ''}
      </div>
    </div>
    <div class="plugin-card plugin-detail-card" data-plugin-id="${escapeHtml(plugin.id)}">
      <div class="plugin-card-main">
        <div class="plugin-info">
          <div class="plugin-id">${escapeHtml(plugin.id)}</div>
          ${plugin.description ? `<div class="plugin-description plugin-detail-description">${escapeHtml(plugin.description)}</div>` : ''}
        </div>
        <label class="settings-toggle plugin-toggle">
          <input type="checkbox" ${plugin.enabled ? 'checked' : ''} data-plugin-toggle="${escapeHtml(plugin.id)}" />
          <span class="toggle-slider"></span>
        </label>
      </div>
      ${renderPluginConfigFields(plugin)}
    </div>
    ${renderPluginAdminContainer(plugin)}
  `

  pluginsList.querySelector<HTMLButtonElement>('.plugin-back-btn')?.addEventListener('click', () => {
    renderPluginsSection(cachedPlugins)
  })

  pluginsList.querySelector<HTMLInputElement>('input[data-plugin-toggle]')?.addEventListener('change', async (event) => {
    const input = event.currentTarget as HTMLInputElement
    const pluginId = input.dataset.pluginToggle
    if (!pluginId) return

    input.disabled = true
    try {
      const settings = await window.electronAPI.getSettings()
      const nextPlugins = {
        ...(settings.plugins ?? {}),
        [pluginId]: input.checked,
      }
      await window.electronAPI.updateSettings({ plugins: nextPlugins })
      const target = cachedPlugins.find(item => item.id === pluginId)
      if (target) {
        target.enabled = input.checked
      }
      setStatus(input.checked ? '插件已启用' : '插件已禁用')
    } catch (error: any) {
      input.checked = !input.checked
      setStatus(`插件设置失败: ${error.message}`)
    } finally {
      input.disabled = false
    }
  })

  bindPluginConfigInputs()
  loadPluginAdminPanel(plugin)
}

function renderPluginAdminContainer(plugin: PluginInfo): string {
  if (plugin.id !== 'mcp-manager' && plugin.id !== 'skills-manager') {
    return ''
  }

  return `
    <div class="plugin-card plugin-admin-card" data-plugin-admin="${escapeHtml(plugin.id)}">
      <div class="plugin-admin-loading">加载管理信息...</div>
    </div>
  `
}

async function loadPluginAdminPanel(plugin: PluginInfo): Promise<void> {
  if (plugin.id !== 'mcp-manager' && plugin.id !== 'skills-manager') {
    return
  }

  const container = pluginsList.querySelector<HTMLElement>(`[data-plugin-admin="${cssEscape(plugin.id)}"]`)
  if (!container) return

  const result = await window.electronAPI.pluginAdminAction(plugin.id, 'state')
  if (!result.success) {
    container.innerHTML = `<div class="plugin-admin-loading">管理信息加载失败: ${escapeHtml(result.error ?? 'unknown error')}</div>`
    return
  }

  if (plugin.id === 'mcp-manager') {
    renderMCPAdmin(container, plugin, result.state as any)
  } else {
    renderSkillsAdmin(container, plugin, result.state as any)
  }
}

async function runPluginAdminAction(plugin: PluginInfo, action: string, payload?: unknown): Promise<any | null> {
  const result = await window.electronAPI.pluginAdminAction(plugin.id, action, payload)
  if (!result.success) {
    setStatus(`插件操作失败: ${result.error ?? 'unknown error'}`)
    return null
  }
  setStatus('插件操作已完成')
  await loadPluginAdminPanel(plugin)
  return result.result
}

function renderMCPAdmin(container: HTMLElement, plugin: PluginInfo, state: any): void {
  const servers = Array.isArray(state?.servers) ? state.servers : []
  container.innerHTML = `
    <div class="plugin-admin-header">
      <div>
        <div class="plugin-admin-title">远程 MCP Servers</div>
        <div class="plugin-admin-subtitle">只管理远程 MCP HTTP endpoint，不启动本地命令。</div>
      </div>
    </div>
    <div class="plugin-admin-form">
      <input class="plugin-config-input" data-mcp-field="id" placeholder="id，例如 github" />
      <input class="plugin-config-input" data-mcp-field="name" placeholder="名称，可选" />
      <input class="plugin-config-input plugin-admin-wide-input" data-mcp-field="url" placeholder="https://example.com/mcp" />
      <textarea class="plugin-config-input plugin-config-textarea" data-mcp-field="headers" rows="3" placeholder='Headers JSON，可选，例如 {"authorization":"Bearer ..."}'></textarea>
      <button class="plugin-admin-button" type="button" data-mcp-action="add">添加远程 MCP</button>
    </div>
    <div class="plugin-admin-list">
      ${servers.length ? servers.map((server: any) => `
        <div class="plugin-admin-item" data-server-id="${escapeHtml(server.id)}">
          <div class="plugin-admin-item-main">
            <div class="plugin-admin-item-title">${escapeHtml(server.name || server.id)}</div>
            <div class="plugin-admin-item-meta">${escapeHtml(server.id)} · ${escapeHtml(server.url || '')}</div>
          </div>
          <label class="settings-toggle plugin-config-toggle">
            <input type="checkbox" ${server.enabled ? 'checked' : ''} data-mcp-action="toggle" />
            <span class="toggle-slider"></span>
          </label>
          <button class="plugin-admin-button secondary" type="button" data-mcp-action="test">测试</button>
          <button class="plugin-admin-button danger" type="button" data-mcp-action="remove">删除</button>
        </div>
      `).join('') : '<div class="plugin-admin-empty">暂无远程 MCP server。</div>'}
    </div>
  `

  container.querySelector<HTMLButtonElement>('[data-mcp-action="add"]')?.addEventListener('click', async () => {
    const id = readAdminField(container, 'mcp', 'id')
    const url = readAdminField(container, 'mcp', 'url')
    const name = readAdminField(container, 'mcp', 'name')
    const headersText = readAdminField(container, 'mcp', 'headers')
    let headers = {}
    if (headersText.trim()) {
      try {
        headers = JSON.parse(headersText)
      } catch {
        setStatus('Headers 必须是合法 JSON')
        return
      }
    }
    await runPluginAdminAction(plugin, 'upsertServer', { id, name, url, headers, enabled: true })
  })

  bindMCPAdminItemActions(container, plugin)
}

function bindMCPAdminItemActions(container: HTMLElement, plugin: PluginInfo): void {
  container.querySelectorAll<HTMLElement>('.plugin-admin-item').forEach(item => {
    const serverId = item.dataset.serverId
    if (!serverId) return

    item.querySelector<HTMLInputElement>('[data-mcp-action="toggle"]')?.addEventListener('change', async (event) => {
      await runPluginAdminAction(plugin, 'setServerEnabled', {
        serverId,
        enabled: (event.currentTarget as HTMLInputElement).checked,
      })
    })
    item.querySelector<HTMLButtonElement>('[data-mcp-action="test"]')?.addEventListener('click', async () => {
      const result = await runPluginAdminAction(plugin, 'testServer', { serverId })
      if (result?.tools) {
        setStatus(`MCP 测试成功: ${result.tools.length} 个 tools`)
      }
    })
    item.querySelector<HTMLButtonElement>('[data-mcp-action="remove"]')?.addEventListener('click', async () => {
      await runPluginAdminAction(plugin, 'removeServer', { serverId })
    })
  })
}

function renderSkillsAdmin(container: HTMLElement, plugin: PluginInfo, state: any): void {
  const sources = Array.isArray(state?.sources) ? state.sources : []
  const skills = Array.isArray(state?.skills) ? state.skills : []
  container.innerHTML = `
    <div class="plugin-admin-header">
      <div>
        <div class="plugin-admin-title">Skills Sources</div>
        <div class="plugin-admin-subtitle">从 GitHub 或本地目录导入 SKILL.md。</div>
      </div>
    </div>
    <div class="plugin-admin-form">
      <input class="plugin-config-input plugin-admin-wide-input" data-skill-field="githubUrl" placeholder="GitHub URL，例如 https://github.com/user/repo" />
      <button class="plugin-admin-button" type="button" data-skill-action="add-github">添加 GitHub Source</button>
      <input class="plugin-config-input plugin-admin-wide-input" data-skill-field="localPath" placeholder="本地 skills 目录路径" />
      <button class="plugin-admin-button secondary" type="button" data-skill-action="add-local">添加本地目录</button>
    </div>
    <div class="plugin-admin-section-title">Sources</div>
    <div class="plugin-admin-list">
      ${sources.length ? sources.map((source: any) => `
        <div class="plugin-admin-item" data-source-id="${escapeHtml(source.id)}" data-source-type="${escapeHtml(source.type)}">
          <div class="plugin-admin-item-main">
            <button class="plugin-admin-expand" type="button" data-skill-action="expand" aria-expanded="false"></button>
            <div class="plugin-admin-source-text">
              <div class="plugin-admin-item-title">${escapeHtml(source.id)}</div>
              <div class="plugin-admin-item-meta">
                ${escapeHtml(source.type)} · ${skillsForSource(skills, source).length} skills · ${escapeHtml(source.url || source.path || '')}
              </div>
            </div>
          </div>
          <label class="settings-toggle plugin-config-toggle">
            <input type="checkbox" ${source.enabled ? 'checked' : ''} data-skill-action="toggle" />
            <span class="toggle-slider"></span>
          </label>
          ${source.type === 'github' ? '<button class="plugin-admin-button secondary" type="button" data-skill-action="rescan">更新</button>' : ''}
          <button class="plugin-admin-button danger" type="button" data-skill-action="remove">删除</button>
          <div class="plugin-admin-source-skills" hidden>
            ${renderSourceSkills(skillsForSource(skills, source))}
          </div>
        </div>
      `).join('') : '<div class="plugin-admin-empty">暂无 skill source。</div>'}
    </div>
  `

  container.querySelector<HTMLButtonElement>('[data-skill-action="add-github"]')?.addEventListener('click', async () => {
    await runPluginAdminAction(plugin, 'addGithubSource', {
      url: readAdminField(container, 'skill', 'githubUrl'),
      enabled: true,
    })
  })
  container.querySelector<HTMLButtonElement>('[data-skill-action="add-local"]')?.addEventListener('click', async () => {
    await runPluginAdminAction(plugin, 'addLocalSource', {
      path: readAdminField(container, 'skill', 'localPath'),
      enabled: true,
    })
  })

  bindSkillsAdminItemActions(container, plugin)
}

function bindSkillsAdminItemActions(container: HTMLElement, plugin: PluginInfo): void {
  container.querySelectorAll<HTMLElement>('.plugin-admin-item').forEach(item => {
    const sourceId = item.dataset.sourceId
    if (!sourceId) return
    item.querySelector<HTMLInputElement>('[data-skill-action="toggle"]')?.addEventListener('change', async (event) => {
      await runPluginAdminAction(plugin, 'setSourceEnabled', {
        sourceId,
        enabled: (event.currentTarget as HTMLInputElement).checked,
      })
    })
    item.querySelector<HTMLButtonElement>('[data-skill-action="rescan"]')?.addEventListener('click', async () => {
      await runPluginAdminAction(plugin, 'rescanGithubSource', { sourceId })
    })
    item.querySelector<HTMLButtonElement>('[data-skill-action="remove"]')?.addEventListener('click', async () => {
      await runPluginAdminAction(plugin, 'removeSource', { sourceId })
    })
    item.querySelector<HTMLButtonElement>('[data-skill-action="expand"]')?.addEventListener('click', (event) => {
      const button = event.currentTarget as HTMLButtonElement
      const skillsPanel = item.querySelector<HTMLElement>('.plugin-admin-source-skills')
      const expanded = button.getAttribute('aria-expanded') === 'true'
      button.setAttribute('aria-expanded', String(!expanded))
      item.classList.toggle('plugin-admin-item-expanded', !expanded)
      if (skillsPanel) {
        skillsPanel.hidden = expanded
      }
    })
  })
}

function skillsForSource(skills: any[], source: any): any[] {
  return skills.filter(skill => {
    if (skill.sourceId) {
      return skill.sourceId === source.id
    }
    return skill.source === source.type && String(skill.path || '').startsWith(String(source.path || ''))
  })
}

function renderSourceSkills(skills: any[]): string {
  if (!skills.length) {
    return '<div class="plugin-admin-empty">这个 source 下没有扫描到 SKILL.md。</div>'
  }

  return skills.map((skill: any) => `
    <div class="plugin-admin-skill">
      <div class="plugin-admin-item-title">${escapeHtml(skill.name || skill.id)}</div>
      <div class="plugin-admin-item-meta">${escapeHtml(skill.id)}${skill.path ? ` · ${escapeHtml(skill.path)}` : ''}</div>
      ${skill.description ? `<div class="plugin-admin-desc">${escapeHtml(skill.description)}</div>` : ''}
    </div>
  `).join('')
}

function readAdminField(container: HTMLElement, scope: string, field: string): string {
  return container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[data-${scope}-field="${cssEscape(field)}"]`
  )?.value.trim() ?? ''
}

function bindPluginConfigInputs(): void {
  pluginsList.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    'input[data-plugin-config], select[data-plugin-config], textarea[data-plugin-config]'
  ).forEach(input => {
    input.addEventListener('change', async () => {
      const pluginId = input.dataset.pluginId
      const key = input.dataset.pluginConfig
      const type = input.dataset.pluginType
      if (!pluginId || !key || !type) return

      input.disabled = true
      try {
        const settings = await window.electronAPI.getSettings()
        const currentPluginConfig = settings.pluginConfigs?.[pluginId] ?? {}
        const nextPluginConfigs = {
          ...(settings.pluginConfigs ?? {}),
          [pluginId]: {
            ...currentPluginConfig,
            [key]: readPluginConfigValue(input, type),
          },
        }
        await window.electronAPI.updateSettings({ pluginConfigs: nextPluginConfigs })
        const target = cachedPlugins.find(item => item.id === pluginId)
        if (target) {
          target.config = nextPluginConfigs[pluginId]
        }
        setStatus('插件参数已更新')
      } catch (error: any) {
        setStatus(`插件参数保存失败: ${error.message}`)
      } finally {
        input.disabled = false
      }
    })
  })

  pluginsList.querySelectorAll<HTMLButtonElement>('.plugin-number-step').forEach(button => {
    button.addEventListener('click', () => {
      const pluginId = button.dataset.pluginId
      const key = button.dataset.pluginConfig
      const direction = button.dataset.stepDir
      if (!pluginId || !key) return

      const input = pluginsList.querySelector<HTMLInputElement>(
        `input[data-plugin-id="${cssEscape(pluginId)}"][data-plugin-config="${cssEscape(key)}"]`
      )
      if (!input) return

      if (direction === 'up') {
        input.stepUp()
      } else {
        input.stepDown()
      }
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
  })
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/["\\]/g, '\\$&')
}

function renderPluginConfigFields(plugin: PluginInfo): string {
  if (!plugin.configSchema.length) {
    return ''
  }

  return `
    <div class="plugin-config-fields">
      ${plugin.configSchema.map(field => renderPluginConfigField(plugin, field)).join('')}
    </div>
  `
}

function renderPluginConfigField(plugin: PluginInfo, field: PluginConfigField): string {
  const rawValue = plugin.config[field.key] ?? field.default
  const label = escapeHtml(field.label ?? field.key)
  const desc = field.description
    ? `<div class="plugin-config-desc">${escapeHtml(field.description)}</div>`
    : ''
  const commonAttrs = `data-plugin-id="${escapeHtml(plugin.id)}" data-plugin-config="${escapeHtml(field.key)}" data-plugin-type="${field.type}"`

  let control = ''
  if (field.type === 'boolean') {
    control = `
      <label class="settings-toggle plugin-config-toggle">
        <input type="checkbox" ${rawValue === true ? 'checked' : ''} ${commonAttrs} />
        <span class="toggle-slider"></span>
      </label>
    `
  } else if (field.type === 'number') {
    control = `
      <div class="plugin-number-control">
        <input class="plugin-config-input plugin-config-number" type="number" value="${escapeHtml(String(rawValue ?? ''))}" ${field.min !== undefined ? `min="${field.min}"` : ''} ${field.max !== undefined ? `max="${field.max}"` : ''} ${field.step !== undefined ? `step="${field.step}"` : ''} ${commonAttrs} />
        <div class="plugin-number-stepper">
          <button class="plugin-number-step" type="button" data-step-dir="up" data-plugin-id="${escapeHtml(plugin.id)}" data-plugin-config="${escapeHtml(field.key)}" tabindex="-1" title="增加"></button>
          <button class="plugin-number-step" type="button" data-step-dir="down" data-plugin-id="${escapeHtml(plugin.id)}" data-plugin-config="${escapeHtml(field.key)}" tabindex="-1" title="减少"></button>
        </div>
      </div>
    `
  } else if (field.type === 'select') {
    control = `
      <select class="plugin-config-input" ${commonAttrs}>
        ${field.options.map(option => `
          <option value="${escapeHtml(option.value)}" ${option.value === rawValue ? 'selected' : ''}>${escapeHtml(option.label)}</option>
        `).join('')}
      </select>
    `
  } else if (field.type === 'string' && field.multiline) {
    control = `<textarea class="plugin-config-input plugin-config-textarea" rows="${field.rows ?? 5}" placeholder="${escapeHtml(field.placeholder ?? '')}" ${commonAttrs}>${escapeHtml(String(rawValue ?? ''))}</textarea>`
  } else {
    control = `<input class="plugin-config-input" type="text" value="${escapeHtml(String(rawValue ?? ''))}" placeholder="${escapeHtml(field.placeholder ?? '')}" ${commonAttrs} />`
  }

  return `
    <div class="plugin-config-row ${field.type === 'string' && field.multiline ? 'plugin-config-row-multiline' : ''}">
      <div class="plugin-config-meta">
        <div class="plugin-config-label">${label}</div>
        ${desc}
      </div>
      ${control}
    </div>
  `
}

function readPluginConfigValue(
  input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  type: string
): unknown {
  if (type === 'boolean') {
    return (input as HTMLInputElement).checked
  }
  if (type === 'number') {
    return Number(input.value)
  }
  return input.value
}

addPersonalityFileBtn.addEventListener('click', async () => {
  const result = await window.electronAPI.addPersonalityFile()
  if (result.canceled) {
    return
  }

  if (!result.success || !result.item) {
    setStatus(`添加角色失败: ${result.error ?? 'unknown error'}`)
    return
  }

  await loadPersonalities()
  personalitySelect.value = result.item.id
  const setResult = await window.electronAPI.setPersonality(result.item.id)
  if (!setResult.success) {
    setStatus(`人格切换失败: ${setResult.error}`)
    return
  }

  setStatus(`已添加并切换为 ${result.item.name}`)
})

// ========== Section Clear Buttons ==========

// Clear profile button
const clearProfileBtn = document.getElementById('clear-profile-btn')
clearProfileBtn?.addEventListener('click', async () => {
  const confirmed = await showConfirmDialog({
    title: '清空用户画像',
    message: '将移除 EVA 已整理的个人信息、偏好和标签。',
    detail: '之后可以通过新的对话重新建立画像。',
    confirmText: '清空',
    tone: 'danger',
  })
  if (!confirmed) return

  try {
    const result = await window.electronAPI.clearProfile()
    if (!result.success) {
      throw new Error(result.error)
    }
    setStatus('用户画像已清空')
    await loadUserProfile()
  } catch (error: any) {
    console.error('Clear profile error:', error)
  }
})

// Clear memories button
const clearMemoriesBtn = document.getElementById('clear-memories-btn')
clearMemoriesBtn?.addEventListener('click', async () => {
  const confirmed = await showConfirmDialog({
    title: '清空重要记忆',
    message: '将删除所有被标记为重要的长期记忆。',
    detail: '这个操作不会影响用户画像和对话摘要。',
    confirmText: '清空',
    tone: 'danger',
  })
  if (!confirmed) return

  try {
    const result = await window.electronAPI.clearImportantMemories()
    if (!result.success) {
      throw new Error(result.error)
    }
    setStatus('重要记忆已清空')
    await loadImportantMemories()
  } catch (error: any) {
    console.error('Clear memories error:', error)
  }
})

// Clear summaries button
const clearSummariesBtn = document.getElementById('clear-summaries-btn')
clearSummariesBtn?.addEventListener('click', async () => {
  const confirmed = await showConfirmDialog({
    title: '清空对话摘要',
    message: '将删除已压缩保存的历史对话摘要。',
    detail: '最近对话和用户画像不会被同时清空。',
    confirmText: '清空',
    tone: 'danger',
  })
  if (!confirmed) return

  try {
    const result = await window.electronAPI.clearConversationSummaries()
    if (!result.success) {
      throw new Error(result.error)
    }
    setStatus('对话摘要已清空')
    await loadConversationSummaries()
  } catch (error: any) {
    console.error('Clear summaries error:', error)
  }
})

// Clear conversations button
const clearConversationsBtn = document.getElementById('clear-conversations-btn')
clearConversationsBtn?.addEventListener('click', async () => {
  const confirmed = await showConfirmDialog({
    title: '清空最近对话',
    message: '将清空当前工作记忆里的最近对话记录。',
    detail: 'EVA 会从新的上下文重新开始对话。',
    confirmText: '清空',
    tone: 'danger',
  })
  if (!confirmed) return

  try {
    const result = await window.electronAPI.clearWorkingMemory()
    if (!result.success) {
      throw new Error(result.error)
    }
    clearTextDisplay()
    setStatus('最近对话已清空')
    await loadWorkingMemory()
  } catch (error: any) {
    console.error('Clear conversations error:', error)
  }
})

// Reset all button
const resetAllBtn = document.getElementById('reset-all-btn')
resetAllBtn?.addEventListener('click', async () => {
  await clearHistory()
})

async function clearHistory(): Promise<void> {
  const confirmed = await showConfirmDialog({
    title: '重置所有记忆',
    message: '将清除用户画像、重要记忆、对话摘要和最近对话。',
    detail: '此操作不可恢复。',
    confirmText: '全部重置',
    tone: 'danger',
  })
  if (!confirmed) return

  try {
    const result = await window.electronAPI.clearHistory()
    if (!result.success) {
      throw new Error(result.error)
    }
    clearTextDisplay()
    setStatus('所有数据已重置')
    await refreshMemorySection()
  } catch (error: any) {
    console.error('Reset all error:', error)
  }
}

// ========== Memory Management ==========

const profileContent = document.getElementById('profile-content')!
const importantMemoriesContent = document.getElementById('important-memories-content')!
const summariesContent = document.getElementById('summaries-content')!
const conversationsContent = document.getElementById('conversations-content')!
const profileCount = document.getElementById('profile-count')!
const importantMemoriesCount = document.getElementById('important-memories-count')!
const summariesCount = document.getElementById('summaries-count')!
const conversationsCount = document.getElementById('conversations-count')!

type UserProfile = {
  basic: {
    name?: string
    nickname?: string
    age?: number
    gender?: string
    location?: string
    occupation?: string
  }
  personality?: string[]
  interests?: string[]
  importantMemories?: Record<string, string>
  lastUpdated?: number
}

let currentProfile: UserProfile | null = null

function isMemorySectionActive(): boolean {
  return document.getElementById('section-memory')?.classList.contains('active') === true
}

async function refreshMemorySection(): Promise<void> {
  if (memoryRefreshPromise) {
    return memoryRefreshPromise
  }

  setMemoryLoadingState()
  memoryRefreshPromise = Promise.all([
    loadUserProfile(),
    loadImportantMemories(),
    loadConversationSummaries(),
    loadWorkingMemory()
  ]).then(() => undefined).finally(() => {
    memoryRefreshPromise = null
  })

  return memoryRefreshPromise
}

function setMemoryLoadingState(): void {
  profileCount.textContent = '加载中'
  importantMemoriesCount.textContent = '加载中'
  summariesCount.textContent = '加载中'
  conversationsCount.textContent = '加载中'
  profileContent.innerHTML = '<div class="profile-loading"><span class="loading-spinner"></span>加载中...</div>'
  importantMemoriesContent.innerHTML = '<div class="profile-loading"><span class="loading-spinner"></span>加载中...</div>'
  summariesContent.innerHTML = '<div class="profile-loading"><span class="loading-spinner"></span>加载中...</div>'
  conversationsContent.innerHTML = '<div class="profile-loading"><span class="loading-spinner"></span>加载中...</div>'
}

async function loadUserProfile(): Promise<void> {
  try {
    const result = await window.electronAPI.getUserProfile()
    if (!result.success || !result.profile) {
      throw new Error(result.error || '用户画像返回为空')
    }

    currentProfile = result.profile
    renderProfile(result.profile)
  } catch (error) {
    console.error('Failed to load profile:', error)
    profileCount.textContent = '0 条'
    profileContent.innerHTML = '<div class="profile-error">加载失败</div>'
  }
}

function renderProfile(profile: UserProfile): void {
  const { basic, personality, interests } = profile

  // 预定义字段的中文标签映射
  const labelMap: Record<string, string> = {
    nickname: '称呼',
    name: '姓名',
    age: '年龄',
    gender: '性别',
    location: '所在地',
    occupation: '职业',
    currentMood: '当前心情',
  }

  // 收集所有 basic 中的字段（保留 key）
  const fields: { key: string; label: string; value: string }[] = []
  if (basic) {
    for (const [key, value] of Object.entries(basic)) {
      if (value !== undefined && value !== null && value !== '') {
        const label = labelMap[key] || key
        const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value)
        fields.push({ key, label, value: displayValue })
      }
    }
  }

  const tags = [
    ...(personality || []).map(p => ({ text: p, type: 'personality' })),
    ...(interests || []).map(i => ({ text: i, type: 'interest' })),
  ]

  const profileItemCount = fields.length + tags.length
  profileCount.textContent = `${profileItemCount} 条`

  if (fields.length === 0 && tags.length === 0) {
    profileContent.innerHTML = '<div class="profile-empty">EVA 还不太了解你，多聊聊吧</div>'
    return
  }

  let html = '<div class="profile-fields">'
  fields.forEach(f => {
    html += `
      <div class="profile-field">
        <span class="field-label">${escapeHtml(f.label)}</span>
        <span class="field-value">${escapeHtml(f.value)}</span>
        <button class="delete-icon-btn" data-field="${escapeHtml(f.key)}" title="删除"></button>
      </div>
    `
  })
  html += '</div>'

  if (tags.length > 0) {
    html += '<div class="profile-tags">'
    tags.forEach(t => {
      html += `<span class="profile-tag ${t.type}">${escapeHtml(t.text)}</span>`
    })
    html += '</div>'
  }

  profileContent.innerHTML = html

  // Attach delete handlers
  profileContent.querySelectorAll('.delete-icon-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const field = (e.target as HTMLButtonElement).dataset.field
      if (!field) return

      const confirmed = await showConfirmDialog({
        title: '删除画像字段',
        message: `将删除“${labelMap[field] || field}”。`,
        detail: '删除后可以在新的对话中重新补充。',
        confirmText: '删除',
        tone: 'danger'
      })
      if (confirmed) {
        await deleteProfileField(field)
      }
    })
  })
}

async function deleteProfileField(field: string): Promise<void> {
  try {
    const result = await window.electronAPI.deleteProfileField(field)
    if (!result.success) {
      throw new Error(result.error)
    }
    await loadUserProfile()
    setStatus('已删除')
  } catch (error: any) {
    console.error('Failed to delete profile field:', error)
    setStatus('删除失败')
  }
}

async function loadImportantMemories(): Promise<void> {
  try {
    const result = await window.electronAPI.getUserProfile()
    if (!result.success || !result.profile) {
      throw new Error(result.error || '重要记忆返回为空')
    }

    const memories = result.profile.importantMemories || {}
    renderImportantMemories(memories)
  } catch (error) {
    console.error('Failed to load memories:', error)
    importantMemoriesCount.textContent = '0 条'
    importantMemoriesContent.innerHTML = '<div class="profile-error">加载失败</div>'
  }
}

function renderImportantMemories(memories: Record<string, string>): void {
  const entries = Object.entries(memories)
  importantMemoriesCount.textContent = `${entries.length} 条`

  if (entries.length === 0) {
    importantMemoriesContent.innerHTML = '<div class="profile-empty">暂无重要记忆</div>'
    return
  }

  let html = '<div class="memories-list">'
  entries.forEach(([key, value]) => {
    html += `
      <div class="memory-item">
        <div class="memory-content">
          <span class="memory-key">${escapeHtml(key)}</span>
          <span class="memory-value">${escapeHtml(value)}</span>
        </div>
        <button class="delete-icon-btn" data-key="${escapeHtml(key)}" title="删除"></button>
      </div>
    `
  })
  html += '</div>'

  importantMemoriesContent.innerHTML = html

  // Attach delete handlers
  importantMemoriesContent.querySelectorAll('.delete-icon-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const key = (e.target as HTMLButtonElement).dataset.key
      if (!key) return

      const confirmed = await showConfirmDialog({
        title: '删除重要记忆',
        message: `将删除“${key}”。`,
        detail: '这条长期记忆不会再参与后续上下文。',
        confirmText: '删除',
        tone: 'danger'
      })
      if (confirmed) {
        await deleteImportantMemory(key)
      }
    })
  })
}

async function deleteImportantMemory(key: string): Promise<void> {
  try {
    const result = await window.electronAPI.deleteImportantMemory(key)
    if (!result.success) {
      throw new Error(result.error)
    }
    await loadImportantMemories()
    setStatus('记忆已删除')
  } catch (error: any) {
    console.error('Failed to delete memory:', error)
    setStatus('删除失败')
  }
}

async function loadConversationSummaries(): Promise<void> {
  try {
    const result = await window.electronAPI.getConversationSummaries()
    if (!result.success || !result.summaries) {
      throw new Error(result.error || '对话摘要返回为空')
    }

    summariesCount.textContent = `${result.summaries.length} 条`
    renderSummaries(result.summaries)
  } catch (error) {
    console.error('Failed to load summaries:', error)
    summariesContent.innerHTML = '<div class="profile-error">加载失败</div>'
  }
}

function renderSummaries(summaries: Array<{
  id: string
  timestamp: number
  summary: string
  keyTopics: string[]
}>): void {
  if (summaries.length === 0) {
    summariesContent.innerHTML = '<div class="profile-empty">暂无对话摘要</div>'
    return
  }

  let html = '<div class="summaries-list">'
  summaries.slice(0, 10).forEach(s => {
    const date = new Date(s.timestamp).toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
    html += `
      <div class="summary-item">
        <div class="summary-header">
          <span class="summary-date">${date}</span>
          <button class="delete-icon-btn" data-id="${escapeHtml(s.id)}" title="删除"></button>
        </div>
        <div class="summary-text">${escapeHtml(s.summary)}</div>
        ${s.keyTopics && s.keyTopics.length > 0 ? `
          <div class="summary-topics">
            ${s.keyTopics.map(t => `<span class="topic-tag">${escapeHtml(t)}</span>`).join('')}
          </div>
        ` : ''}
      </div>
    `
  })
  html += '</div>'

  summariesContent.innerHTML = html

  // Attach delete handlers
  summariesContent.querySelectorAll('.delete-icon-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const id = (e.target as HTMLButtonElement).dataset.id
      if (!id) return

      const confirmed = await showConfirmDialog({
        title: '删除对话摘要',
        message: '将删除这条已压缩保存的历史对话摘要。',
        detail: '其他摘要和最近对话不会受到影响。',
        confirmText: '删除',
        tone: 'danger'
      })
      if (confirmed) {
        await deleteConversationSummary(id)
      }
    })
  })
}

async function deleteConversationSummary(id: string): Promise<void> {
  try {
    const result = await window.electronAPI.deleteConversationSummary(id)
    if (!result.success) {
      throw new Error(result.error)
    }
    await loadConversationSummaries()
    setStatus('已删除')
  } catch (error: any) {
    console.error('Failed to delete summary:', error)
    setStatus('删除失败')
  }
}

async function loadWorkingMemory(): Promise<void> {
  try {
    const result = await window.electronAPI.getWorkingMemory()
    if (!result.success || !result.memory) {
      throw new Error(result.error || '最近对话返回为空')
    }

    const turns = result.memory.recentTurns || []
    conversationsCount.textContent = `${turns.length} 条`
    renderConversations(turns)
  } catch (error) {
    console.error('Failed to load working memory:', error)
    conversationsContent.innerHTML = '<div class="profile-error">加载失败</div>'
  }
}

function renderConversations(turns: Array<{
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp?: number
}>): void {
  if (turns.length === 0) {
    conversationsContent.innerHTML = '<div class="profile-empty">暂无对话记录</div>'
    return
  }

  let html = '<div class="conversations-list">'
  turns.slice(-20).forEach(turn => {
    const roleLabel = turn.role === 'user' ? '你' : 'EVA'
    const roleClass = turn.role === 'user' ? 'user' : 'assistant'
    html += `
      <div class="conversation-item ${roleClass}">
        <span class="conversation-role">${roleLabel}</span>
        <span class="conversation-content">${escapeHtml(turn.content)}</span>
        <button class="delete-icon-btn" data-id="${escapeHtml(turn.id)}" title="删除"></button>
      </div>
    `
  })
  html += '</div>'

  conversationsContent.innerHTML = html

  // Attach delete handlers
  conversationsContent.querySelectorAll('.delete-icon-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const id = (e.target as HTMLButtonElement).dataset.id
      if (!id) return

      const confirmed = await showConfirmDialog({
        title: '删除最近对话',
        message: '将从工作记忆中删除这条最近对话。',
        detail: '这不会删除其他记忆内容。',
        confirmText: '删除',
        tone: 'danger'
      })
      if (confirmed) {
        await deleteConversationTurn(id)
      }
    })
  })
}

async function deleteConversationTurn(id: string): Promise<void> {
  try {
    const result = await window.electronAPI.deleteConversationTurn(id)
    if (!result.success) {
      throw new Error(result.error)
    }
    await loadWorkingMemory()
    setStatus('已删除')
  } catch (error: any) {
    console.error('Failed to delete conversation turn:', error)
    setStatus('删除失败')
  }
}

function escapeHtml(str: string): string {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

// ========== System Config Section ==========

const proxyInput = document.getElementById('proxy-input') as HTMLInputElement
const llmModelsList = document.getElementById('llm-models-list')!
const taskModelsList = document.getElementById('task-models-list')!
const ttsModelsList = document.getElementById('tts-models-list')!
const asrModelsList = document.getElementById('asr-models-list')!
const localModelsList = document.getElementById('local-models-list')!
const addLLMBtn = document.getElementById('add-llm-btn') as HTMLButtonElement
const addTaskBtn = document.getElementById('add-task-btn') as HTMLButtonElement
const addTTSBtn = document.getElementById('add-tts-btn') as HTMLButtonElement
const addASRBtn = document.getElementById('add-asr-btn') as HTMLButtonElement
const downloadLocalModelsBtn = document.getElementById('download-local-models-btn') as HTMLButtonElement
const resetSystemBtn = document.getElementById('reset-system-btn') as HTMLButtonElement

let currentSystemConfig: SystemConfig | null = null

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

async function evaluateSetupReadiness(): Promise<SetupReadiness> {
  const settings = await window.electronAPI.getSettings()
  const system = settings.system
  const issues: SetupIssue[] = []

  const activeLLM = system.llmModels.find(model => model.id === system.activeLLMId) || system.llmModels[0]
  if (!activeLLM?.modelName?.trim() || !activeLLM?.apiKey?.trim() || !activeLLM?.baseUrl?.trim()) {
    issues.push({
      kind: 'llm',
      label: '对话模型',
      message: '补全对话模型的模型名、API Key 和 Base URL',
    })
  }

  const activeTask = system.taskModels.find(model => model.id === system.activeTaskId) || system.taskModels[0]
  if (!activeTask?.modelName?.trim() || !activeTask?.apiKey?.trim() || !activeTask?.baseUrl?.trim()) {
    issues.push({
      kind: 'task',
      label: '任务模型',
      message: '补全任务模型的模型名、API Key 和 Base URL',
    })
  }

  const activeTTS = system.ttsModels.find(model => model.id === system.activeTTSId) || system.ttsModels[0]
  if (!activeTTS?.modelName?.trim() || !activeTTS?.apiKey?.trim() || !activeTTS?.voiceId?.trim()) {
    issues.push({
      kind: 'tts',
      label: 'TTS',
      message: '补全 TTS 的模型名、API Key 和 Voice ID',
    })
  }

  const activeASR = system.asrModels.find(model => model.id === system.activeASRId) || system.asrModels[0]
  if (!activeASR?.modelName?.trim() || !activeASR?.apiKey?.trim()) {
    issues.push({
      kind: 'asr',
      label: 'ASR',
      message: '补全 ASR 的模型名和 API Key',
    })
  }

  try {
    const result = await window.electronAPI.getLocalModelStatus()
    if (!result.success) {
      throw new Error(result.error || '本地模型检查失败')
    }
    const missingModels = result.models.filter(model => !model.exists)
    if (missingModels.length > 0) {
      issues.push({
        kind: 'models',
        label: '本地模型',
        message: `下载缺失的本地模型：${missingModels.map(model => model.name).join('、')}`,
      })
    }
  } catch {
    issues.push({
      kind: 'models',
      label: '本地模型',
      message: '检查本地 VAD / SmartTurn 模型状态',
    })
  }

  return {
    ready: issues.length === 0,
    issues,
  }
}

function updateSetupNavIndicator(readiness: SetupReadiness): void {
  if (!systemNavItem || !systemNavLabel) {
    return
  }

  systemNavItem.classList.toggle('has-setup-issues', !readiness.ready)
  systemNavItem.dataset.issueCount = readiness.ready ? '' : String(readiness.issues.length)
  systemNavItem.title = readiness.ready
    ? ''
    : readiness.issues.map(issue => `${issue.label}: ${issue.message}`).join('\n')

  const existingBadge = systemNavItem.querySelector('.nav-issue-badge')
  if (existingBadge) {
    existingBadge.remove()
  }

  if (!readiness.ready) {
    const badge = document.createElement('span')
    badge.className = 'nav-issue-badge'
    badge.textContent = String(readiness.issues.length)
    systemNavItem.appendChild(badge)
  }
}

function renderSetupGuidance(readiness: SetupReadiness): void {
  const existing = document.getElementById('setup-guidance-card')
  if (existing) {
    existing.remove()
  }

  if (readiness.ready) {
    return
  }

  const systemSection = document.getElementById('section-system')
  if (!systemSection) {
    return
  }

  const card = document.createElement('div')
  card.id = 'setup-guidance-card'
  card.className = 'setup-guidance-card'
  card.innerHTML = `
    <div class="setup-guidance-header">
      <span class="setup-guidance-title">启动前需要完成配置</span>
      <span class="setup-guidance-count">${readiness.issues.length} 项</span>
    </div>
    <div class="setup-guidance-list">
      ${readiness.issues.map(issue => `
        <button class="setup-guidance-item" type="button" data-setup-kind="${issue.kind}">
          <span class="setup-guidance-dot"></span>
          <span>
            <strong>${escapeHtml(issue.label)}</strong>
            <small>${escapeHtml(issue.message)}</small>
          </span>
        </button>
      `).join('')}
    </div>
  `

  const title = systemSection.querySelector('.section-title')
  title?.insertAdjacentElement('afterend', card)

  card.querySelectorAll<HTMLElement>('.setup-guidance-item').forEach(item => {
    item.addEventListener('click', () => {
      const kind = item.dataset.setupKind as SetupIssueKind | undefined
      const targetId = kind === 'models' ? 'local-models-list' : `${kind}-models-list`
      document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  })
}

async function refreshSetupReadiness(): Promise<SetupReadiness> {
  setupReadiness = await evaluateSetupReadiness()
  updateSetupNavIndicator(setupReadiness)
  renderSetupGuidance(setupReadiness)
  return setupReadiness
}

async function ensureSetupReadyForConversation(): Promise<boolean> {
  const readiness = await refreshSetupReadiness()
  if (readiness.ready) {
    return true
  }

  setStatus(`需要完成 ${readiness.issues.length} 项配置`)
  openSettings('system')
  return false
}

async function loadSystemConfig(): Promise<void> {
  const settings = await window.electronAPI.getSettings()
  currentSystemConfig = settings.system
  renderSystemConfig()
  void loadLocalModelStatus()
}

function renderSystemConfig(): void {
  if (!currentSystemConfig) return

  proxyInput.value = currentSystemConfig.proxy

  renderLLMModels()
  renderTaskModels()
  renderTTSModels()
  renderASRModels()
}

async function loadLocalModelStatus(): Promise<void> {
  localModelsList.innerHTML = '<div class="profile-loading"><span class="loading-spinner"></span>检查中...</div>'
  downloadLocalModelsBtn.disabled = true

  try {
    const result = await window.electronAPI.getLocalModelStatus()
    if (!result.success) {
      throw new Error(result.error || '本地模型状态返回失败')
    }
    renderLocalModels(result.models)
  } catch (error: any) {
    localModelsList.innerHTML = `<div class="profile-error">检查失败: ${escapeHtml(error.message ?? String(error))}</div>`
    downloadLocalModelsBtn.disabled = false
  }
}

function renderLocalModels(models: LocalModelStatus[]): void {
  const missingCount = models.filter(model => !model.exists).length
  downloadLocalModelsBtn.disabled = missingCount === 0
  downloadLocalModelsBtn.textContent = missingCount > 0 ? `下载缺失模型 (${missingCount})` : '模型已就绪'

  localModelsList.innerHTML = models.map(model => `
    <div class="config-model-card local-model-card ${model.exists ? 'active' : 'missing'}">
      <div class="config-model-header">
        <div class="config-model-name local-model-name">
          <span>${escapeHtml(model.name)}</span>
          <span class="config-model-active-badge ${model.exists ? '' : 'missing'}">
            ${model.exists ? '已安装' : '缺失'}
          </span>
        </div>
      </div>
      <div class="config-model-fields">
        <div class="config-field">
          <span class="config-field-label">用途</span>
          <span class="config-field-static">${escapeHtml(model.purpose)}</span>
        </div>
        <div class="config-field">
          <span class="config-field-label">文件</span>
          <span class="config-field-static">${escapeHtml(model.filename)}</span>
        </div>
        <div class="config-field">
          <span class="config-field-label">大小</span>
          <span class="config-field-static">${model.exists ? formatFileSize(model.sizeBytes ?? 0) : '-'}</span>
        </div>
      </div>
    </div>
  `).join('')
}

function formatFileSize(bytes: number): string {
  if (bytes <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function renderLLMModels(): void {
  if (!currentSystemConfig) return

  const models = currentSystemConfig.llmModels
  if (models.length === 0) {
    llmModelsList.innerHTML = '<div class="config-empty">暂无 LLM 配置</div>'
    return
  }

  llmModelsList.innerHTML = models.map(model => `
    <div class="config-model-card ${model.id === currentSystemConfig!.activeLLMId ? 'active' : ''}" data-id="${escapeHtml(model.id)}">
      <div class="config-model-header">
        <div class="config-model-name">
          <input type="text" value="${escapeHtml(model.modelName)}" data-field="modelName" placeholder="deepseek-chat" />
          ${model.id === currentSystemConfig!.activeLLMId ? '<span class="config-model-active-badge">使用中</span>' : ''}
        </div>
        <div class="config-model-actions">
          ${model.id !== currentSystemConfig!.activeLLMId ? '<button class="config-model-btn config-activate-btn" data-action="activate">启用</button>' : ''}
          ${models.length > 1 ? '<button class="config-model-btn config-delete-btn" data-action="delete">删除</button>' : ''}
        </div>
      </div>
      <div class="config-model-fields">
        <div class="config-field">
          <span class="config-field-label">API Key</span>
          <input type="text" class="config-field-input masked" value="${escapeHtml(model.apiKey)}" data-field="apiKey" placeholder="sk-..." />
        </div>
        <div class="config-field">
          <span class="config-field-label">Base URL</span>
          <input type="text" class="config-field-input" value="${escapeHtml(model.baseUrl)}" data-field="baseUrl" placeholder="https://api.openai.com/v1" />
        </div>
      </div>
    </div>
  `).join('')

  attachLLMEventListeners()
}

function renderTaskModels(): void {
  if (!currentSystemConfig) return

  const models = currentSystemConfig.taskModels
  if (models.length === 0) {
    taskModelsList.innerHTML = '<div class="config-empty">暂无任务模型配置</div>'
    return
  }

  taskModelsList.innerHTML = models.map(model => `
    <div class="config-model-card ${model.id === currentSystemConfig!.activeTaskId ? 'active' : ''}" data-id="${escapeHtml(model.id)}">
      <div class="config-model-header">
        <div class="config-model-name">
          <input type="text" value="${escapeHtml(model.modelName)}" data-field="modelName" placeholder="gemini-3.1-pro-preview" />
          ${model.id === currentSystemConfig!.activeTaskId ? '<span class="config-model-active-badge">使用中</span>' : ''}
        </div>
        <div class="config-model-actions">
          ${model.id !== currentSystemConfig!.activeTaskId ? '<button class="config-model-btn config-activate-btn" data-action="activate">启用</button>' : ''}
          ${models.length > 1 ? '<button class="config-model-btn config-delete-btn" data-action="delete">删除</button>' : ''}
        </div>
      </div>
      <div class="config-model-fields">
        <div class="config-field">
          <span class="config-field-label">API Key</span>
          <input type="text" class="config-field-input masked" value="${escapeHtml(model.apiKey)}" data-field="apiKey" placeholder="sk-..." />
        </div>
        <div class="config-field">
          <span class="config-field-label">Base URL</span>
          <input type="text" class="config-field-input" value="${escapeHtml(model.baseUrl)}" data-field="baseUrl" placeholder="https://generativelanguage.googleapis.com/v1beta/openai" />
        </div>
      </div>
    </div>
  `).join('')

  attachTaskEventListeners()
}

const TTS_PROVIDERS: { value: TTSProviderType; label: string }[] = [
  { value: 'fish', label: 'Fish Audio' }
]

function getTTSProviderLabel(provider: TTSProviderType): string {
  return TTS_PROVIDERS.find(p => p.value === provider)?.label || provider
}

function renderTTSModels(): void {
  if (!currentSystemConfig) return

  const models = currentSystemConfig.ttsModels
  if (models.length === 0) {
    ttsModelsList.innerHTML = '<div class="config-empty">暂无 TTS 配置</div>'
    return
  }

  ttsModelsList.innerHTML = models.map(model => `
    <div class="config-model-card ${model.id === currentSystemConfig!.activeTTSId ? 'active' : ''}" data-id="${escapeHtml(model.id)}">
      <div class="config-model-header">
        <div class="config-model-name">
          <span class="config-provider-label">${getTTSProviderLabel(model.provider)}</span>
          <input type="text" value="${escapeHtml(model.modelName)}" data-field="modelName" placeholder="s2-pro" />
          ${model.id === currentSystemConfig!.activeTTSId ? '<span class="config-model-active-badge">使用中</span>' : ''}
        </div>
        <div class="config-model-actions">
          ${model.id !== currentSystemConfig!.activeTTSId ? '<button class="config-model-btn config-activate-btn" data-action="activate">启用</button>' : ''}
          ${models.length > 1 ? '<button class="config-model-btn config-delete-btn" data-action="delete">删除</button>' : ''}
        </div>
      </div>
      <div class="config-model-fields">
        <div class="config-field">
          <span class="config-field-label">Provider</span>
          <select class="config-field-input" data-field="provider">
            ${TTS_PROVIDERS.map(p => `<option value="${p.value}" ${p.value === model.provider ? 'selected' : ''}>${p.label}</option>`).join('')}
          </select>
        </div>
        <div class="config-field">
          <span class="config-field-label">API Key</span>
          <input type="text" class="config-field-input masked" value="${escapeHtml(model.apiKey)}" data-field="apiKey" placeholder="API Key" />
        </div>
        <div class="config-field">
          <span class="config-field-label">Voice ID</span>
          <input type="text" class="config-field-input" value="${escapeHtml(model.voiceId || '')}" data-field="voiceId" placeholder="音色 ID（可选）" />
        </div>
      </div>
    </div>
  `).join('')

  attachTTSEventListeners()
}

const ASR_PROVIDERS: { value: ASRProviderType; label: string }[] = [
  { value: 'qwen', label: 'Qwen' }
]

function getASRProviderLabel(provider: ASRProviderType): string {
  return ASR_PROVIDERS.find(p => p.value === provider)?.label || provider
}

function renderASRModels(): void {
  if (!currentSystemConfig) return

  const models = currentSystemConfig.asrModels
  if (models.length === 0) {
    asrModelsList.innerHTML = '<div class="config-empty">暂无 ASR 配置</div>'
    return
  }

  asrModelsList.innerHTML = models.map(model => `
    <div class="config-model-card ${model.id === currentSystemConfig!.activeASRId ? 'active' : ''}" data-id="${escapeHtml(model.id)}">
      <div class="config-model-header">
        <div class="config-model-name">
          <span class="config-provider-label">${getASRProviderLabel(model.provider)}</span>
          <input type="text" value="${escapeHtml(model.modelName)}" data-field="modelName" placeholder="realtime" />
          ${model.id === currentSystemConfig!.activeASRId ? '<span class="config-model-active-badge">使用中</span>' : ''}
        </div>
        <div class="config-model-actions">
          ${model.id !== currentSystemConfig!.activeASRId ? '<button class="config-model-btn config-activate-btn" data-action="activate">启用</button>' : ''}
          ${models.length > 1 ? '<button class="config-model-btn config-delete-btn" data-action="delete">删除</button>' : ''}
        </div>
      </div>
      <div class="config-model-fields">
        <div class="config-field">
          <span class="config-field-label">Provider</span>
          <select class="config-field-input" data-field="provider">
            ${ASR_PROVIDERS.map(p => `<option value="${p.value}" ${p.value === model.provider ? 'selected' : ''}>${p.label}</option>`).join('')}
          </select>
        </div>
        <div class="config-field">
          <span class="config-field-label">API Key</span>
          <input type="text" class="config-field-input masked" value="${escapeHtml(model.apiKey)}" data-field="apiKey" placeholder="API Key" />
        </div>
      </div>
    </div>
  `).join('')

  attachASREventListeners()
}

function attachLLMEventListeners(): void {
  llmModelsList.querySelectorAll('.config-model-card').forEach(card => {
    const id = (card as HTMLElement).dataset.id!

    // Field changes
    card.querySelectorAll('input[data-field]').forEach(input => {
      input.addEventListener('change', async () => {
        const field = (input as HTMLInputElement).dataset.field!
        const value = (input as HTMLInputElement).value
        await updateLLMModel(id, { [field]: value })
      })
    })

    // Action buttons
    card.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = (btn as HTMLButtonElement).dataset.action
        if (action === 'activate') {
          await activateLLMModel(id)
        } else if (action === 'delete') {
          await deleteLLMModel(id)
        }
      })
    })
  })
}

function attachTaskEventListeners(): void {
  taskModelsList.querySelectorAll('.config-model-card').forEach(card => {
    const id = (card as HTMLElement).dataset.id!

    card.querySelectorAll('input[data-field]').forEach(input => {
      input.addEventListener('change', async () => {
        const field = (input as HTMLInputElement).dataset.field!
        const value = (input as HTMLInputElement).value
        await updateTaskModel(id, { [field]: value })
      })
    })

    card.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = (btn as HTMLButtonElement).dataset.action
        if (action === 'activate') {
          await activateTaskModel(id)
        } else if (action === 'delete') {
          await deleteTaskModel(id)
        }
      })
    })
  })
}

function attachTTSEventListeners(): void {
  ttsModelsList.querySelectorAll('.config-model-card').forEach(card => {
    const id = (card as HTMLElement).dataset.id!

    card.querySelectorAll('input[data-field]').forEach(input => {
      input.addEventListener('change', async () => {
        const field = (input as HTMLInputElement).dataset.field!
        const value = (input as HTMLInputElement).value
        await updateTTSModel(id, { [field]: value })
      })
    })

    card.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = (btn as HTMLButtonElement).dataset.action
        if (action === 'activate') {
          await activateTTSModel(id)
        } else if (action === 'delete') {
          await deleteTTSModel(id)
        }
      })
    })
  })
}

function attachASREventListeners(): void {
  asrModelsList.querySelectorAll('.config-model-card').forEach(card => {
    const id = (card as HTMLElement).dataset.id!

    card.querySelectorAll('input[data-field]').forEach(input => {
      input.addEventListener('change', async () => {
        const field = (input as HTMLInputElement).dataset.field!
        const value = (input as HTMLInputElement).value
        await updateASRModel(id, { [field]: value })
      })
    })

    card.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = (btn as HTMLButtonElement).dataset.action
        if (action === 'activate') {
          await activateASRModel(id)
        } else if (action === 'delete') {
          await deleteASRModel(id)
        }
      })
    })
  })
}

async function saveSystemConfig(): Promise<void> {
  if (!currentSystemConfig) return
  await window.electronAPI.updateSettings({ system: currentSystemConfig })
  await refreshSetupReadiness()
}

async function updateLLMModel(id: string, updates: Partial<LLMModelConfig>): Promise<void> {
  if (!currentSystemConfig) return
  const model = currentSystemConfig.llmModels.find(m => m.id === id)
  if (model) {
    Object.assign(model, updates)
    await saveSystemConfig()
  }
}

async function activateLLMModel(id: string): Promise<void> {
  if (!currentSystemConfig) return
  currentSystemConfig.activeLLMId = id
  await saveSystemConfig()
  renderLLMModels()
}

async function deleteLLMModel(id: string): Promise<void> {
  if (!currentSystemConfig || currentSystemConfig.llmModels.length <= 1) return
  currentSystemConfig.llmModels = currentSystemConfig.llmModels.filter(m => m.id !== id)
  if (currentSystemConfig.activeLLMId === id && currentSystemConfig.llmModels.length > 0) {
    currentSystemConfig.activeLLMId = currentSystemConfig.llmModels[0].id
  }
  await saveSystemConfig()
  renderLLMModels()
}

async function addLLMModel(): Promise<void> {
  if (!currentSystemConfig) return
  const newModel: LLMModelConfig = {
    id: generateId(),
    modelName: '',
    apiKey: '',
    baseUrl: ''
  }
  currentSystemConfig.llmModels.push(newModel)
  await saveSystemConfig()
  renderLLMModels()
}

async function updateTaskModel(id: string, updates: Partial<LLMModelConfig>): Promise<void> {
  if (!currentSystemConfig) return
  const model = currentSystemConfig.taskModels.find(m => m.id === id)
  if (model) {
    Object.assign(model, updates)
    await saveSystemConfig()
  }
}

async function activateTaskModel(id: string): Promise<void> {
  if (!currentSystemConfig) return
  currentSystemConfig.activeTaskId = id
  await saveSystemConfig()
  renderTaskModels()
}

async function deleteTaskModel(id: string): Promise<void> {
  if (!currentSystemConfig || currentSystemConfig.taskModels.length <= 1) return
  currentSystemConfig.taskModels = currentSystemConfig.taskModels.filter(m => m.id !== id)
  if (currentSystemConfig.activeTaskId === id && currentSystemConfig.taskModels.length > 0) {
    currentSystemConfig.activeTaskId = currentSystemConfig.taskModels[0].id
  }
  await saveSystemConfig()
  renderTaskModels()
}

async function addTaskModel(): Promise<void> {
  if (!currentSystemConfig) return
  const newModel: LLMModelConfig = {
    id: generateId(),
    modelName: 'gemini-3.1-pro-preview',
    apiKey: '',
    baseUrl: ''
  }
  currentSystemConfig.taskModels.push(newModel)
  await saveSystemConfig()
  renderTaskModels()
}

async function updateTTSModel(id: string, updates: Partial<TTSModelConfig>): Promise<void> {
  if (!currentSystemConfig) return
  const model = currentSystemConfig.ttsModels.find(m => m.id === id)
  if (model) {
    Object.assign(model, updates)
    await saveSystemConfig()
  }
}

async function activateTTSModel(id: string): Promise<void> {
  if (!currentSystemConfig) return
  currentSystemConfig.activeTTSId = id
  await saveSystemConfig()
  renderTTSModels()
}

async function deleteTTSModel(id: string): Promise<void> {
  if (!currentSystemConfig || currentSystemConfig.ttsModels.length <= 1) return
  currentSystemConfig.ttsModels = currentSystemConfig.ttsModels.filter(m => m.id !== id)
  if (currentSystemConfig.activeTTSId === id && currentSystemConfig.ttsModels.length > 0) {
    currentSystemConfig.activeTTSId = currentSystemConfig.ttsModels[0].id
  }
  await saveSystemConfig()
  renderTTSModels()
}

async function addTTSModel(): Promise<void> {
  if (!currentSystemConfig) return
  const newModel: TTSModelConfig = {
    id: generateId(),
    provider: 'fish',
    modelName: 's2-pro',
    apiKey: '',
    voiceId: ''
  }
  currentSystemConfig.ttsModels.push(newModel)
  await saveSystemConfig()
  renderTTSModels()
}

async function updateASRModel(id: string, updates: Partial<ASRModelConfig>): Promise<void> {
  if (!currentSystemConfig) return
  const model = currentSystemConfig.asrModels.find(m => m.id === id)
  if (model) {
    Object.assign(model, updates)
    await saveSystemConfig()
  }
}

async function activateASRModel(id: string): Promise<void> {
  if (!currentSystemConfig) return
  currentSystemConfig.activeASRId = id
  await saveSystemConfig()
  renderASRModels()
}

async function deleteASRModel(id: string): Promise<void> {
  if (!currentSystemConfig || currentSystemConfig.asrModels.length <= 1) return
  currentSystemConfig.asrModels = currentSystemConfig.asrModels.filter(m => m.id !== id)
  if (currentSystemConfig.activeASRId === id && currentSystemConfig.asrModels.length > 0) {
    currentSystemConfig.activeASRId = currentSystemConfig.asrModels[0].id
  }
  await saveSystemConfig()
  renderASRModels()
}

async function addASRModel(): Promise<void> {
  if (!currentSystemConfig) return
  const newModel: ASRModelConfig = {
    id: generateId(),
    provider: 'qwen',
    modelName: 'realtime',
    apiKey: ''
  }
  currentSystemConfig.asrModels.push(newModel)
  await saveSystemConfig()
  renderASRModels()
}

// Proxy input handler
proxyInput.addEventListener('change', async () => {
  if (!currentSystemConfig) return
  currentSystemConfig.proxy = proxyInput.value.trim()
  await saveSystemConfig()
})

// Add button handlers
addLLMBtn.addEventListener('click', () => void addLLMModel())
addTaskBtn.addEventListener('click', () => void addTaskModel())
addTTSBtn.addEventListener('click', () => void addTTSModel())
addASRBtn.addEventListener('click', () => void addASRModel())

downloadLocalModelsBtn.addEventListener('click', async () => {
  downloadLocalModelsBtn.disabled = true
  downloadLocalModelsBtn.textContent = '下载中...'
  localModelsList.querySelectorAll('.local-model-card.missing').forEach(card => {
    card.classList.add('downloading')
  })

  try {
    const result = await window.electronAPI.downloadMissingLocalModels()
    if (!result.success) {
      throw new Error(result.error || '模型下载失败')
    }
    renderLocalModels(result.models)
    setStatus('本地模型已就绪')
    await refreshSetupReadiness()
  } catch (error: any) {
    setStatus(`模型下载失败: ${error.message ?? String(error)}`)
    await loadLocalModelStatus()
    await refreshSetupReadiness()
  }
})

// Reset system config from .env
async function resetSystemConfigFromEnv(): Promise<void> {
  resetSystemBtn.disabled = true
  resetSystemBtn.textContent = '加载中...'

  try {
    const result = await window.electronAPI.resetSystemConfigFromEnv()
    if (result.success) {
      await loadSystemConfig()
      await refreshSetupReadiness()
      console.log('[Settings] System config reloaded from .env')
    } else {
      console.error('[Settings] Failed to reset:', result.error)
    }
  } catch (error) {
    console.error('[Settings] Reset error:', error)
  } finally {
    resetSystemBtn.disabled = false
    resetSystemBtn.innerHTML = '<span class="reset-icon">↻</span>从 .env 重新加载配置'
  }
}

resetSystemBtn.addEventListener('click', () => void resetSystemConfigFromEnv())

function isSystemSectionActive(): boolean {
  return document.getElementById('section-system')?.classList.contains('active') === true
}

// 应用启动时加载设置
async function initializeApp(): Promise<void> {
  try {
    await loadSettings()
    await loadPersonalities()
    await loadSystemConfig()
    await refreshSetupReadiness()
    updateConversationButton()
    console.log('Her-Text Renderer initialized')
  } catch (error) {
    console.error('Failed to initialize app:', error)
  }
}

// 立即执行初始化
void initializeApp()
