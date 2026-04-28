// 加载环境变量（必须在最开始）
import { config as dotenvConfig } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createRequire } from 'module'
import { existsSync } from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const require = createRequire(import.meta.url)

// 尝试多个可能的 .env 文件位置
const possibleEnvPaths = [
  join(__dirname, '../.env'),           // apps/desktop/.env (from dist/)
  join(__dirname, '../../.env'),        // project root .env
  join(process.cwd(), '.env'),          // current working directory
  join(process.cwd(), 'apps/desktop/.env')  // from project root
]

let envLoaded = false
for (const envPath of possibleEnvPaths) {
  if (existsSync(envPath)) {
    const result = dotenvConfig({ path: envPath })
    if (!result.error && result.parsed) {
      console.log('[Env] ✓ Loaded from:', envPath)
      console.log('[Env] Variables loaded:', Object.keys(result.parsed).length)
      envLoaded = true
      break
    }
  }
}

if (!envLoaded) {
  console.warn('[Env] ⚠️  No .env file found in:', possibleEnvPaths)
}

configureProxyFromEnv()

// 检查新格式的环境变量
console.log('[Env] LLM_1_API_KEY:', process.env.LLM_1_API_KEY ? '✓ (set)' : '✗ (not set)')
console.log('[Env] LLM_1_MODEL:', process.env.LLM_1_MODEL || '✗ (not set)')
console.log('[Env] LLM_1_BASE_URL:', process.env.LLM_1_BASE_URL || '✗ (not set)')
console.log('[Env] TTS_1_API_KEY:', process.env.TTS_1_API_KEY ? '✓ (set)' : '✗ (not set)')
console.log('[Env] ASR_1_API_KEY:', process.env.ASR_1_API_KEY ? '✓ (set)' : '✗ (not set)')

import { app, BrowserWindow, ipcMain, systemPreferences, shell, dialog, type OpenDialogOptions } from 'electron'
import {
  HerTextSDK,
  createSTTProvider,
  createTTSProvider,
  type STTProvider,
  type TTSProvider,
  createVADAnalyzer,
  VADAnalyzer,
  TurnController,
  VADState,
  SmartTurnAnalyzer,
  type VADParams,
  type EndpointingConfig,
  type TurnControllerEvents,
  type UserTurnStoppedParams,
  type VoiceConfidenceProvider,
  type SmartTurnOptions,
  VoiceGraphPipeline,
  type Frame,
  type FrameObserver,
  type VoiceFrame,
  type VoiceFrameProcessor,
  OutputFramePipeline,
  type OutputFrameProcessor,
  LLMResponseProcessor,
  LLMStreamBridgeProcessor,
  ResponseFramePipeline,
  type ResponseFrame,
  ResponseDisplayProcessor,
  ResponseTTSProcessor,
} from '@her-text/sdk'
import { initializeSileroVAD, isSileroVADAvailable } from './silero-vad-helper.js'
import { initializeSmartTurn, isSmartTurnAvailable } from './smart-turn-helper.js'
import {
  initializePersonalityManager,
  getPersonalityManager,
  buildSDKConfig,
  setActiveLLMConfig
} from './sdk-config.js'
import { SettingsStore, type AppSettings, type LLMModelConfig, type TTSModelConfig, type ASRModelConfig } from './settings-store.js'
import { NodeRealtimeWebSocketTransport } from './qwen-websocket-transport.js'
import {
  ReconnectingWebSocketTransport,
  type ConnectionState,
} from './reconnecting-websocket-transport.js'
const DEV_SERVER_URL = 'http://127.0.0.1:5173'

type InterruptionReason = 'vad_start' | 'transcript_start' | 'manual' | 'provider_switch'

type ConversationPhase = 'reply' | 'task' | 'task_result'

type ConversationFrame =
  | { type: 'system.reset' }
  | { type: 'control.phase_start'; phase: ConversationPhase }
  | { type: 'control.phase_end'; phase: ConversationPhase }
  | { type: 'control.task_start'; taskDescription: string }
  | { type: 'control.task_end'; success: boolean; summary: string; error?: string }
  | { type: 'data.tts_text'; text: string }

class ConversationDisplayController {
  private visibleText = ''
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private sendText: (text: string) => void,
    private sendFrame: (frame: ConversationFrame) => void
  ) {}

  reset(): void {
    this.visibleText = ''
    this.queue = Promise.resolve()
    this.sendFrame({ type: 'system.reset' })
    this.sendText('')
  }

  startPhase(phase: ConversationPhase): void {
    this.sendFrame({ type: 'control.phase_start', phase })
  }

  async endPhase(phase: ConversationPhase): Promise<void> {
    await this.waitForIdle()
    this.sendFrame({ type: 'control.phase_end', phase })
  }

  startTask(taskDescription: string): void {
    this.sendFrame({ type: 'control.task_start', taskDescription })
  }

  endTask(result: { success: boolean; summary: string; error?: string }): void {
    this.sendFrame({
      type: 'control.task_end',
      success: result.success,
      summary: result.summary,
      ...(result.error ? { error: result.error } : {})
    })
  }

  pushTTSChunkText(text: string): void {
    if (!text) {
      return
    }

    this.sendFrame({ type: 'data.tts_text', text })
  }

  pushTextDelta(delta: string): void {
    if (!delta) {
      return
    }

    for (const unit of splitDisplayUnits(delta)) {
      const delay = estimateDisplayDelay(unit)
      this.queue = this.queue.then(async () => {
        await delayMs(delay)
        this.visibleText += unit
        this.sendText(this.visibleText)
      })
    }
  }

  waitForIdle(): Promise<void> {
    return this.queue
  }
}

/**
 * 延迟追踪器 - 测量语音对话各阶段延迟
 */
class LatencyTracker {
  private timestamps: Map<string, number> = new Map()
  private sessionId: number = 0
  private sendToRenderer?: (data: LatencyData) => void

  constructor() {
    this.reset()
  }

  setSendToRenderer(fn: (data: LatencyData) => void): void {
    this.sendToRenderer = fn
  }

  reset(): void {
    this.sessionId = Date.now()
    this.timestamps.clear()
  }

  mark(point: LatencyPoint): void {
    const now = performance.now()
    this.timestamps.set(point, now)
    console.log(`[Latency] ${point}: ${now.toFixed(1)}ms`)
  }

  calculate(): LatencyData | null {
    const get = (p: LatencyPoint) => this.timestamps.get(p)
    const interval = (start?: number, end?: number) => (
      start !== undefined && end !== undefined
        ? Math.max(0, end - start)
        : undefined
    )

    const vadSpeechStop = get('vad_speech_stop')
    const turnComplete = get('turn_complete')
    const speechEnd = get('speech_end')
    const asrComplete = get('asr_complete')
    const llmStart = get('llm_start')
    const firstLLMToken = get('first_llm_token')
    const firstTTSText = get('first_tts_text')
    const firstTTSAudio = get('first_tts_audio')
    const firstAudioPlay = get('first_audio_play')
    const asrReady = asrComplete !== undefined && speechEnd !== undefined
      ? Math.max(asrComplete, speechEnd)
      : asrComplete ?? speechEnd

    // 使用 VAD 静音检测作为起点（如果有的话）
    const startPoint = vadSpeechStop ?? speechEnd
    if (!startPoint) {
      return null
    }

    const intervals: LatencyIntervals = {
      vadToEndpointing: interval(vadSpeechStop, speechEnd),
      vadToTurnComplete: interval(vadSpeechStop, turnComplete),
      turnCompleteToEndpointing: interval(turnComplete, speechEnd),
      endpointingToASR: interval(speechEnd, asrComplete),
      asrToLLM: interval(asrReady, llmStart),
      llmToFirstToken: interval(llmStart, firstLLMToken),
      firstTokenToTTSText: interval(firstLLMToken, firstTTSText),
      ttsTextToAudio: interval(firstTTSText, firstTTSAudio),
      audioToPlayback: interval(firstTTSAudio, firstAudioPlay),
    }

    const total = firstAudioPlay ? firstAudioPlay - startPoint : undefined

    const data: LatencyData = {
      sessionId: this.sessionId,
      total,
      intervals,
      timestamps: Object.fromEntries(this.timestamps) as Record<LatencyPoint, number>
    }

    console.log('[Latency] ========== Summary ==========')
    console.log(`[Latency] Total (VAD静音 → 播放): ${total?.toFixed(0) ?? '?'}ms`)
    console.log(`[Latency]   ├─ VAD → Endpointing: ${intervals.vadToEndpointing?.toFixed(0) ?? '?'}ms`)
    if (intervals.vadToTurnComplete !== undefined || intervals.turnCompleteToEndpointing !== undefined) {
      console.log(`[Latency]   │  ├─ VAD → SmartTurn: ${intervals.vadToTurnComplete?.toFixed(0) ?? '?'}ms`)
      console.log(`[Latency]   │  └─ SmartTurn → Final/Timeout: ${intervals.turnCompleteToEndpointing?.toFixed(0) ?? '?'}ms`)
    }
    console.log(`[Latency]   ├─ Endpointing → ASR: ${intervals.endpointingToASR?.toFixed(0) ?? '?'}ms`)
    console.log(`[Latency]   ├─ ASR → LLM:         ${intervals.asrToLLM?.toFixed(0) ?? '?'}ms`)
    console.log(`[Latency]   ├─ LLM → First Token: ${intervals.llmToFirstToken?.toFixed(0) ?? '?'}ms`)
    console.log(`[Latency]   ├─ Token → TTS Text:  ${intervals.firstTokenToTTSText?.toFixed(0) ?? '?'}ms`)
    console.log(`[Latency]   ├─ TTS Text → Audio:  ${intervals.ttsTextToAudio?.toFixed(0) ?? '?'}ms`)
    console.log(`[Latency]   └─ Audio → Playback:  ${intervals.audioToPlayback?.toFixed(0) ?? '?'}ms`)
    console.log('[Latency] ================================')

    // 发送到 Renderer
    this.sendToRenderer?.(data)

    return data
  }
}

type LatencyPoint =
  | 'vad_speech_stop'   // VAD 检测到静音（最早时间点）
  | 'turn_complete'     // SmartTurn 判定用户说完
  | 'speech_end'        // Endpointing 确认说话结束
  | 'asr_complete'      // ASR 转录完成
  | 'llm_start'         // LLM 调用开始
  | 'first_llm_token'   // 首个 LLM token
  | 'first_tts_text'    // 首个 TTS 文本块发送
  | 'first_tts_audio'   // 首个 TTS 音频块接收
  | 'first_audio_play'  // 首个音频开始播放

interface LatencyIntervals {
  vadToEndpointing?: number
  vadToTurnComplete?: number
  turnCompleteToEndpointing?: number
  endpointingToASR?: number
  asrToLLM?: number
  llmToFirstToken?: number
  firstTokenToTTSText?: number
  ttsTextToAudio?: number
  audioToPlayback?: number
}

interface LatencyData {
  sessionId: number
  total?: number
  intervals: LatencyIntervals
  timestamps: Record<LatencyPoint, number>
}

// 全局延迟追踪器实例
const latencyTracker = new LatencyTracker()

class LatencyObserver implements FrameObserver<Frame> {
  private firstLLMTokenSeen = false
  private firstTTSTextSeen = false
  private firstTTSAudioSeen = false
  private firstAudioPlaySeen = false

  constructor(private readonly tracker: LatencyTracker) {}

  onFrame(frame: Frame): void {
    switch (frame.type) {
      case 'vad_speech_stop':
        this.tracker.reset()
        this.resetFirstMarkers()
        this.tracker.mark('vad_speech_stop')
        return
      case 'user_turn_end':
        this.tracker.mark('speech_end')
        return
      case 'transcription':
        if ((frame as VoiceFrame).type === 'transcription' && (frame as VoiceFrame & { finalized: boolean }).finalized) {
          this.tracker.mark('asr_complete')
        }
        return
      case 'bot_thinking_start':
        this.tracker.mark('llm_start')
        return
      case 'llm_text_delta':
      case 'display_text_delta':
        if (!this.firstLLMTokenSeen) {
          this.firstLLMTokenSeen = true
          this.tracker.mark('first_llm_token')
        }
        return
      case 'tts_text':
        if (!this.firstTTSTextSeen) {
          this.firstTTSTextSeen = true
          this.tracker.mark('first_tts_text')
        }
        return
      case 'tts_audio':
        if (!this.firstTTSAudioSeen) {
          this.firstTTSAudioSeen = true
          this.tracker.mark('first_tts_audio')
        }
        return
      case 'audio_playback_started':
        if (!this.firstAudioPlaySeen) {
          this.firstAudioPlaySeen = true
          this.tracker.mark('first_audio_play')
          this.tracker.calculate()
        }
        return
    }
  }

  markTurnComplete(): void {
    this.tracker.mark('turn_complete')
  }

  markFirstTTSText(): void {
    if (!this.firstTTSTextSeen) {
      this.firstTTSTextSeen = true
      this.tracker.mark('first_tts_text')
    }
  }

  private resetFirstMarkers(): void {
    this.firstLLMTokenSeen = false
    this.firstTTSTextSeen = false
    this.firstTTSAudioSeen = false
    this.firstAudioPlaySeen = false
  }
}

const latencyObserver = new LatencyObserver(latencyTracker)

type FrameTraceEntry = {
  time: number
  type: string
  kind: Frame['kind']
}

class FrameTraceObserver implements FrameObserver<Frame> {
  private readonly entries: FrameTraceEntry[] = []
  private readonly maxEntries = 500

  onFrame(frame: Frame): void {
    this.entries.push({
      time: Date.now(),
      type: frame.type,
      kind: frame.kind,
    })

    if (this.entries.length > this.maxEntries) {
      this.entries.shift()
    }
  }

  getTrace(): FrameTraceEntry[] {
    return [...this.entries]
  }

  clear(): void {
    this.entries.length = 0
  }
}

const frameTraceObserver = new FrameTraceObserver()

/**
 * VAD 配置 (移植自 Pipecat)
 * 使用新的 4 状态机 VAD 分析器
 */
const DEFAULT_VAD_CONFIG: Partial<VADParams> = {
  confidence: 0.7,      // 语音置信度阈值
  startSecs: 0.2,       // 200ms 确认开始说话
  stopSecs: 0.2,        // 200ms 确认停止说话
  minVolume: 0.02,      // 最小音量阈值 (Silero VAD 不需要此参数，但保留兼容性)
  sampleRate: 16000,
}

// Silero VAD 实例（全局缓存）
let sileroVADProvider: VoiceConfidenceProvider | null = null
let sileroVADInitPromise: Promise<VoiceConfidenceProvider | null> | null = null

/**
 * 初始化 Silero VAD（异步，带缓存）
 */
async function getSileroVADProvider(): Promise<VoiceConfidenceProvider | null> {
  if (sileroVADProvider) {
    return sileroVADProvider
  }

  if (sileroVADInitPromise) {
    return sileroVADInitPromise
  }

  sileroVADInitPromise = (async () => {
    try {
      if (!isSileroVADAvailable()) {
        console.log('[VAD] Silero VAD not available, falling back to RMS VAD')
        return null
      }

      console.log('[VAD] Initializing Silero VAD...')
      sileroVADProvider = await initializeSileroVAD(16000)
      console.log('[VAD] Silero VAD initialized successfully')
      return sileroVADProvider
    } catch (error) {
      console.error('[VAD] Failed to initialize Silero VAD:', error)
      console.log('[VAD] Falling back to RMS VAD')
      return null
    }
  })()

  return sileroVADInitPromise
}

// Smart Turn 实例（全局缓存）
let smartTurnAnalyzer: SmartTurnAnalyzer | null = null
let smartTurnInitPromise: Promise<SmartTurnAnalyzer | null> | null = null

/**
 * 初始化 Smart Turn（异步，带缓存）
 */
async function getSmartTurnAnalyzer(): Promise<SmartTurnAnalyzer | null> {
  if (smartTurnAnalyzer) {
    return smartTurnAnalyzer
  }

  if (smartTurnInitPromise) {
    return smartTurnInitPromise
  }

  smartTurnInitPromise = (async () => {
    try {
      if (!isSmartTurnAvailable()) {
        console.log('[SmartTurn] Smart Turn not available, falling back to fixed timeout')
        return null
      }

      console.log('[SmartTurn] Initializing Smart Turn...')
      smartTurnAnalyzer = await initializeSmartTurn(16000)
      console.log('[SmartTurn] Smart Turn initialized successfully')
      return smartTurnAnalyzer
    } catch (error) {
      console.error('[SmartTurn] Failed to initialize Smart Turn:', error)
      console.log('[SmartTurn] Falling back to fixed timeout')
      return null
    }
  })()

  return smartTurnInitPromise
}

/**
 * Endpointing 配置 (备用 - 当 Smart Turn 不可用时使用)
 *
 * 对齐 Pipecat SpeechTimeoutUserTurnStopStrategy：
 * - userSpeechTimeout 是用户短暂停顿后可能续说的 policy floor
 * - sttTimeoutMs 是 Qwen STT final transcript 的 P99 safety net
 */
const FALLBACK_ENDPOINTING_CONFIG: Partial<EndpointingConfig> = {
  userSpeechTimeout: 600,
  sttTimeoutMs: 1000,
  userTurnStopTimeout: 5000,
}

// ========== 全局 Frame Graph ==========
const voiceGraphPipeline = new VoiceGraphPipeline()

/**
 * 流式 ASR 会话
 *
 * 集成了 Pipecat 风格的：
 * - 4 状态机 VAD (QUIET → STARTING → SPEAKING → STOPPING)
 * - 双计时器 Endpointing
 * - 轮次管理 (TurnController)
 * - 打断处理 (system interruption frame)
 */
class StreamingASRSession {
  private asr: STTProvider | null = null
  private turnController: TurnController | null = null
  private voiceFramePipeline = voiceGraphPipeline.createInputLane('input')
  private audioFrameSequence = 0
  private commitInFlight = false
  private pendingUserTurnEnd: { voiceTurnId: number; params: UserTurnStoppedParams } | null = null
  private voiceTurnSequence = 0
  private activeVoiceTurnId = 0
  private providerGeneration = 0
  private removeLatencyObserver: (() => void) | null = null
  private removeTraceObserver: (() => void) | null = null

  // 回调
  private onTranscript: ((text: string) => void) | null = null
  private onUserText: ((text: string) => void | Promise<void>) | null = null
  private onStateChange: ((state: 'listening' | 'processing' | 'idle') => void) | null = null
  private onSpeechStart: (() => void) | null = null
  private onInterruption: ((reason: InterruptionReason) => void) | null = null
  private callbacks: {
    onTranscript?: (text: string) => void
    onUserText?: (text: string) => void | Promise<void>
    onStateChange?: (state: 'listening' | 'processing' | 'idle') => void
    onSpeechStart?: () => void
    onInterruption?: (reason: InterruptionReason) => void
  } | null = null

  // 调试模式
  private debug = true

  async start(callbacks?: {
    onTranscript?: (text: string) => void
    onUserText?: (text: string) => void | Promise<void>
    onStateChange?: (state: 'listening' | 'processing' | 'idle') => void
    onSpeechStart?: () => void
    onInterruption?: (reason: InterruptionReason) => void
  }): Promise<void> {
    await this.stop()
    this.callbacks = callbacks ?? null

    this.onTranscript = callbacks?.onTranscript || null
    this.onUserText = callbacks?.onUserText || null
    this.onStateChange = callbacks?.onStateChange || null
    this.onSpeechStart = callbacks?.onSpeechStart || null
    this.onInterruption = callbacks?.onInterruption || null

    const asrConfig = getActiveASRConfig()
    activeASRSignature = getASRConfigSignature(asrConfig)
    const apiKey = asrConfig?.apiKey?.trim()
    if (!apiKey) {
      throw new Error('QWEN_API_KEY is not configured. Please set it in Settings > System > ASR.')
    }

    // 创建支持重连的 WebSocket 传输层
    const baseTransport = new NodeRealtimeWebSocketTransport()
    const reconnectingTransport = new ReconnectingWebSocketTransport(baseTransport, {
      maxRetries: 5,
      initialRetryDelayMs: 1000,
      maxRetryDelayMs: 16000,
      onConnectionStateChange: (state: ConnectionState) => {
        this.log(`ASR WebSocket state: ${state}`)
        // 通知 Renderer 连接状态变化
        if (state === 'reconnecting') {
          mainWindow?.webContents.send('speech:reconnecting')
        } else if (state === 'connected') {
          mainWindow?.webContents.send('speech:reconnected')
        } else if (state === 'failed') {
          mainWindow?.webContents.send('speech:connectionFailed')
        }
      },
      onReconnectAttempt: (attempt, maxRetries) => {
        this.log(`ASR reconnect attempt ${attempt}/${maxRetries}`)
      },
    })

    // 初始化 ASR（带中间转录回调，用于 endpointing）
    const providerGeneration = ++this.providerGeneration

    this.asr = createSTTProvider({
      kind: 'qwen-realtime',
      config: {
        apiKey,
        model: normalizeASRModelName(asrConfig?.modelName),
        sampleRate: 16000,
        language: 'zh',
        receiveTimeoutMs: 1000,
      },
      transport: reconnectingTransport,
    })
    this.asr.setEventHandler((event) => {
      if (event.type !== 'transcript') {
        return
      }

      if (event.final) {
        this.log(`Final transcript frame: "${event.text.slice(0, 30)}..."`)
      }

      // 将转录结果也作为 frame 放入同一条输入 pipeline，避免
      // VAD/ASR 分散 callback 造成状态乱序。interim 只保留为 frame，
      // 不打印、不进入最终用户文本。
      void this.voiceFramePipeline.queueFrame({
        type: 'transcription',
        kind: 'data',
        providerGeneration,
        voiceTurnId: this.activeVoiceTurnId,
        text: event.text,
        finalized: event.final,
        timestamp: Date.now(),
      })
    })
    await this.asr.connect()

    // 初始化 VAD 分析器 (Pipecat 风格 4 状态机)
    // 优先使用 Silero VAD（神经网络），否则回退到 RMS VAD
    const sileroProvider = await getSileroVADProvider()
    let vadAnalyzer: VADAnalyzer
    if (sileroProvider) {
      this.log('Using Silero VAD (neural network)')
      vadAnalyzer = new VADAnalyzer(sileroProvider, DEFAULT_VAD_CONFIG)
    } else {
      this.log('Using RMS VAD (fallback)')
      vadAnalyzer = createVADAnalyzer(DEFAULT_VAD_CONFIG)
    }

    // 初始化 Smart Turn (ML 智能话音结束检测)
    const smartTurn = await getSmartTurnAnalyzer()

    // 初始化轮次控制器
    // 优先使用 Smart Turn (~100ms)，否则回退到固定超时 (400ms)
    if (smartTurn) {
      this.log('Using Pipecat TurnAnalyzer Smart Turn endpointing')
      this.turnController = new TurnController(vadAnalyzer, {
        smartTurn: {
          analyzer: smartTurn,
          analyzeIntervalMs: 200,      // 200ms 静音后开始分析
          maxAnalyzeAttempts: 10,      // 最多分析 10 次
          // 对齐 Pipecat TurnAnalyzerUserTurnStopStrategy：
          // SmartTurn 判定 complete 后仍等待 finalized TranscriptionFrame。
          // Qwen Omni 的 interim 只用于观察，不能作为最终用户输入。
          sttTimeoutMs: 1000,
          onResult: (result) => {
            if (result.isComplete) {
              latencyObserver.markTurnComplete()
            }
          },
        },
        enableInterruption: true,
        debug: this.debug,
      })
    } else {
      this.log('Using fixed timeout endpointing (400ms)')
      this.turnController = new TurnController(vadAnalyzer, {
        endpointing: FALLBACK_ENDPOINTING_CONFIG,
        enableInterruption: true,
        debug: this.debug,
      })
    }

    // 设置轮次控制器事件
    const events: TurnControllerEvents = {
      onUserTurnStart: () => {
        const voiceTurnId = this.beginVoiceTurn()
        void this.voiceFramePipeline.queueFrame({
          type: 'user_turn_start',
          kind: 'control',
          voiceTurnId,
          timestamp: Date.now(),
        })
      },

      onVADSpeechStop: () => {
        void this.voiceFramePipeline.queueFrame({
          type: 'vad_speech_stop',
          kind: 'control',
          voiceTurnId: this.activeVoiceTurnId,
          timestamp: Date.now(),
        })
      },

      onUserTurnEnd: async (params) => {
        const voiceTurnId = this.activeVoiceTurnId
        void this.voiceFramePipeline.queueFrame({
          type: 'user_turn_end',
          kind: 'control',
          voiceTurnId,
          params,
          timestamp: Date.now(),
        })
      },

      onInterruption: (reason) => {
        void this.voiceFramePipeline.queueFrame({
          type: 'interruption',
          kind: 'system',
          voiceTurnId: this.activeVoiceTurnId,
          reason,
          timestamp: Date.now(),
        })
      },

      onUserTurnTimeout: () => {
        void this.voiceFramePipeline.queueFrame({
          type: 'user_turn_timeout',
          kind: 'control',
          voiceTurnId: this.activeVoiceTurnId,
          timestamp: Date.now(),
        })
      },
    }

    this.turnController.setEvents(events)

    const processors: VoiceFrameProcessor[] = [
      {
        processFrame: async (frame) => {
          if (frame.type !== 'input_audio' || !this.asr) {
            return
          }

          await this.asr.appendAudio(frame.samples)
        }
      },
      {
        processFrame: async (frame) => {
          if (!this.turnController) {
            return
          }

          if (frame.type === 'stt_metadata') {
            if (!this.isCurrentProviderGeneration(frame.providerGeneration)) {
              this.log(`Dropping stale STT metadata for provider generation #${frame.providerGeneration}`)
              return
            }
            this.turnController.updateSTTProviderCapabilities(frame.capabilities)
            return
          }

          if (frame.type === 'input_audio') {
            await this.turnController.processAudio(frame.samples)
            return
          }

          if (frame.type === 'bot_thinking_start') {
            await this.turnController.startBotThinking()
            return
          }

          if (frame.type === 'bot_thinking_end') {
            await this.turnController.endBotThinking()
            return
          }

          if (frame.type === 'bot_started_speaking') {
            await this.turnController.startBotTurn()
            return
          }

          if (frame.type === 'bot_stopped_speaking') {
            await this.turnController.endBotTurn()
            return
          }

          if (frame.type !== 'transcription') {
            return
          }

          if (!this.isCurrentProviderGeneration(frame.providerGeneration)) {
            this.log(`Dropping stale transcription for provider generation #${frame.providerGeneration}`)
            return
          }

          if (!this.isCurrentVoiceTurn(frame.voiceTurnId)) {
            if (!this.shouldStartVoiceTurnFromTranscription(frame)) {
              this.log(`Dropping stale transcription for voice turn #${frame.voiceTurnId}`)
              return
            }
            frame.voiceTurnId = this.beginVoiceTurn()
            this.log(`Transcription started fallback voice turn #${frame.voiceTurnId}`)
          }

          if (!frame.finalized) {
            return
          }

          await this.turnController.processTranscription({
            text: frame.text,
            finalized: frame.finalized,
            timestamp: frame.timestamp,
          })
        }
      },
      {
        processFrame: (frame) => {
          switch (frame.type) {
            case 'user_turn_start':
              if (!this.isCurrentVoiceTurn(frame.voiceTurnId)) {
                this.log(`Dropping stale user_turn_start for voice turn #${frame.voiceTurnId}`)
                return
              }
              this.log('User turn started')
              this.asr?.clearBufferedTranscripts()
              this.onSpeechStart?.()
              break
            case 'vad_speech_stop':
              if (!this.isCurrentVoiceTurn(frame.voiceTurnId)) {
                this.log(`Dropping stale vad_speech_stop for voice turn #${frame.voiceTurnId}`)
                return
              }
              this.startVADStopCommit()
              break
            case 'user_turn_end':
              if (!this.isCurrentVoiceTurn(frame.voiceTurnId)) {
                this.log(`Dropping stale user_turn_end for voice turn #${frame.voiceTurnId}`)
                return
              }
              this.log(`User turn ended, text: ${frame.params.text?.slice(0, 50)}...`)
              this.endVoiceTurn(frame.voiceTurnId)
              void this.finalizeUserTurn(frame.voiceTurnId, frame.params)
              break
            case 'interruption':
              this.log(`Interruption detected! reason=${frame.reason}`)
              this.asr?.clearBufferedTranscripts()
              this.onInterruption?.(frame.reason)
              break
            case 'user_turn_timeout':
              this.log('User turn timeout')
              break
            case 'stt_metadata':
              if (!this.isCurrentProviderGeneration(frame.providerGeneration)) {
                this.log(`Dropping stale STT metadata log for provider generation #${frame.providerGeneration}`)
                return
              }
              this.log(
                `STT metadata: provider=${frame.capabilities.provider}, model=${frame.capabilities.model ?? 'default'}, streaming=${frame.capabilities.streamingTranscripts}`
              )
              break
            case 'bot_thinking_start':
              this.log('Bot thinking started')
              break
            case 'bot_thinking_end':
              this.log('Bot thinking ended')
              break
            case 'bot_started_speaking':
              this.log('Bot started speaking')
              break
            case 'bot_stopped_speaking':
              this.log('Bot stopped speaking')
              break
          }
        }
      },
    ]

    this.voiceFramePipeline.setProcessors(processors)
    this.voiceFramePipeline.reset()
    this.removeLatencyObserver?.()
    this.removeLatencyObserver = this.voiceFramePipeline.addObserver(latencyObserver)
    this.removeTraceObserver?.()
    this.removeTraceObserver = this.voiceFramePipeline.addObserver(frameTraceObserver)
    this.audioFrameSequence = 0
    this.voiceTurnSequence = 0
    this.activeVoiceTurnId = 0
    this.commitInFlight = false
    void this.voiceFramePipeline.queueFrame({
      type: 'stt_metadata',
      kind: 'control',
      providerGeneration: this.providerGeneration,
      capabilities: this.asr.getCapabilities(),
      timestamp: Date.now(),
    })
    this.onStateChange?.('listening')

    this.log('StreamingASRSession started with Pipecat-style VAD')
  }

  async switchProvider(reason: InterruptionReason = 'provider_switch'): Promise<void> {
    const callbacks = this.callbacks
    this.log(`Switching ASR provider, reason=${reason}`)
    mainWindow?.webContents.send('speech:reconnecting')
    await this.stop()
    if (callbacks) {
      await this.start(callbacks)
    }
    mainWindow?.webContents.send('speech:reconnected')
  }

  async startBotThinking(): Promise<void> {
    await this.voiceFramePipeline.queueFrame({
      type: 'bot_thinking_start',
      kind: 'control',
      timestamp: Date.now(),
    })
  }

  async startBotTurn(): Promise<void> {
    await this.voiceFramePipeline.queueFrame({
      type: 'bot_started_speaking',
      kind: 'control',
      timestamp: Date.now(),
    })
  }

  async endBotThinking(): Promise<void> {
    await this.voiceFramePipeline.queueFrame({
      type: 'bot_thinking_end',
      kind: 'control',
      timestamp: Date.now(),
    })
  }

  /**
   * 结束机器人轮次
   * 在回复完成后调用
   */
  async endBotTurn(): Promise<void> {
    await this.voiceFramePipeline.queueFrame({
      type: 'bot_stopped_speaking',
      kind: 'control',
      timestamp: Date.now(),
    })
  }

  private beginVoiceTurn(): number {
    if (this.activeVoiceTurnId > 0) {
      return this.activeVoiceTurnId
    }

    this.activeVoiceTurnId = ++this.voiceTurnSequence
    return this.activeVoiceTurnId
  }

  private endVoiceTurn(voiceTurnId: number): void {
    if (this.activeVoiceTurnId === voiceTurnId) {
      this.activeVoiceTurnId = 0
    }
  }

  private isCurrentVoiceTurn(voiceTurnId: number): boolean {
    return voiceTurnId > 0 && voiceTurnId === this.activeVoiceTurnId
  }

  private isCurrentProviderGeneration(providerGeneration: number): boolean {
    return providerGeneration === this.providerGeneration
  }

  private shouldStartVoiceTurnFromTranscription(frame: Extract<VoiceFrame, { type: 'transcription' }>): boolean {
    if (frame.type !== 'transcription') {
      return false
    }

    if (!frame.text.trim()) {
      return false
    }

    if (this.activeVoiceTurnId > 0) {
      return false
    }

    // Pipecat defaults to TranscriptionUserTurnStartStrategy(use_interim=True).
    // We only use finalized Qwen transcripts as authoritative user text, so
    // interim transcripts can still be observed but do not create turns.
    return frame.finalized
  }

  private async finalizeUserTurn(
    voiceTurnId: number,
    params: UserTurnStoppedParams
  ): Promise<void> {
    if (!this.asr) {
      return
    }

    if (this.commitInFlight) {
      this.pendingUserTurnEnd = { voiceTurnId, params }
      this.log(`User turn #${voiceTurnId} end queued while ASR commit is in flight`)
      return
    }

    this.commitInFlight = true
    this.onStateChange?.('processing')

    try {
      // Pipecat 中 TranscriptionFrame 是持续进入 pipeline 的；endpointing
      // 完成时已经持有最终文本。Qwen realtime 在 VAD stop 时只需要 flush。
      const text = params.text?.trim() ?? ''

      const finalText = text.trim()

      if (finalText) {
        this.log(`Transcript: ${finalText}`)
        this.onTranscript?.(finalText)
        void Promise.resolve(this.onUserText?.(finalText)).catch((error) => {
          this.log(`Failed to process user text frame: ${error.message ?? String(error)}`)
        })
      }
    } catch (error) {
      this.log(`Commit error: ${error}`)
      // 如果 ASR 提交失败，使用 endpointing 累积的文本
      if (params.text?.trim()) {
        const fallbackText = params.text.trim()
        this.onTranscript?.(fallbackText)
        void Promise.resolve(this.onUserText?.(fallbackText)).catch((processError) => {
          this.log(`Failed to process fallback user text frame: ${processError.message ?? String(processError)}`)
        })
      }
    } finally {
      this.commitInFlight = false
      if (this.asr) {
        this.onStateChange?.('listening')
      }

      const pending = this.pendingUserTurnEnd
      this.pendingUserTurnEnd = null
      if (pending) {
        void this.finalizeUserTurn(pending.voiceTurnId, pending.params)
      }
    }
  }

  private startVADStopCommit(): void {
    if (!this.asr) {
      return
    }

    const flushAudio = getFlushAudio(this.asr)
    if (flushAudio) {
      void flushAudio().catch((error: any) => {
        this.log(`ASR flush error: ${error.message ?? String(error)}`)
      })
    }
  }

  /**
   * 追加音频数据
   */
  append(samples: number[] | Int16Array): Promise<void> {
    const normalized = samples instanceof Int16Array
      ? samples
      : Int16Array.from(samples)

    return this.voiceFramePipeline.queueFrame({
      type: 'input_audio',
      kind: 'data',
      sequence: ++this.audioFrameSequence,
      timestamp: Date.now(),
      samples: normalized,
    }).catch((error: Error) => {
      // 忽略停止时的预期错误
      if (error.message === 'WebSocket connection aborted' ||
          error.message === 'Qwen STT WebSocket closed') {
        return
      }
      throw error
    })
  }

  /**
   * 停止会话
   */
  async stop(): Promise<void> {
    this.onStateChange?.('idle')
    this.onTranscript = null
    this.onStateChange = null
    this.onUserText = null
    this.onSpeechStart = null
    this.onInterruption = null

    // 清理轮次控制器
    if (this.turnController) {
      this.turnController.cleanup()
      this.turnController = null
    }

    this.voiceFramePipeline.stop()
    this.removeLatencyObserver?.()
    this.removeLatencyObserver = null
    this.removeTraceObserver?.()
    this.removeTraceObserver = null
    this.pendingUserTurnEnd = null
    this.commitInFlight = false
    this.activeVoiceTurnId = 0
    this.providerGeneration += 1

    if (!this.asr) {
      return
    }

    const current = this.asr
    this.asr = null

    await (current.cleanup?.() ?? current.close()).catch((error: Error) => {
      if (error.message === 'Qwen STT WebSocket closed' ||
          error.message === 'WebSocket connection aborted') {
        return
      }
      throw error
    })
  }

  private log(message: string): void {
    if (this.debug) {
      console.log(`[StreamingASR] ${message}`)
    }
  }
}

function getFlushAudio(asr: STTProvider): (() => Promise<void>) | null {
  const maybe = asr as STTProvider & { flushAudio?: () => Promise<void> }
  return typeof maybe.flushAudio === 'function'
    ? maybe.flushAudio.bind(asr)
    : null
}

let currentTTSChunkSequence = 0

// ========== 输出 Frame Pipeline ==========
const outputFramePipeline: OutputFramePipeline = voiceGraphPipeline.createOutputLane('output')
const invalidatedTTSContexts = new Set<number>()

const electronOutputProcessor: OutputFrameProcessor = {
  processFrame(frame) {
    switch (frame.type) {
      case 'tts_started':
        if (frame.providerGeneration !== ttsProviderGeneration) {
          console.log(`[TTS] Dropping stale started frame for provider generation #${frame.providerGeneration}`)
          return
        }
        invalidatedTTSContexts.delete(frame.contextId)
        currentTTSContextId = frame.contextId
        mainWindow?.webContents.send('tts:connected', frame.contextId)
        mainWindow?.webContents.send('tts:contextStart', frame.contextId)
        break
      case 'tts_audio':
        if (frame.providerGeneration !== ttsProviderGeneration) {
          console.log(`[TTS] Dropping stale audio frame for provider generation #${frame.providerGeneration}`)
          return
        }
        if (frame.contextId !== currentTTSContextId || invalidatedTTSContexts.has(frame.contextId)) {
          console.log(`[TTS] Dropping stale output frame for context #${frame.contextId}`)
          return
        }
        mainWindow?.webContents.send('tts:audio', {
          contextId: frame.contextId,
          data: frame.audio
        })
        break
      case 'tts_stopped':
        if (frame.providerGeneration !== ttsProviderGeneration) {
          return
        }
        mainWindow?.webContents.send('tts:closed')
        break
      case 'tts_error':
        mainWindow?.webContents.send('tts:error', frame.error)
        break
      case 'audio_playback_started':
        break
      case 'interruption':
        invalidatedTTSContexts.add(frame.ttsContextId)
        mainWindow?.webContents.send('tts:contextInvalidated', frame.ttsContextId)
        mainWindow?.webContents.send('speech:interruption', frame.turnId)
        break
    }
  }
}

outputFramePipeline.setProcessors([electronOutputProcessor])
outputFramePipeline.addObserver(latencyObserver)
outputFramePipeline.addObserver(frameTraceObserver)

// ========== 轮次管理（打断控制）==========
let currentTurnId = 0
let currentTurnAbortController: AbortController | null = null
let currentResponseFramePipeline: ResponseFramePipeline | null = null
const cancelledTurnIds = new Set<number>()
let currentTurnUserText: string | null = null

// ========== TTS 音频上下文管理 ==========
/**
 * TTS 音频上下文 ID
 * 每次开始新的 TTS 流时递增
 * Renderer 用此 ID 验证音频是否属于当前上下文
 */
let currentTTSContextId = 0
let ttsProviderGeneration = 0

/**
 * 生成新的 TTS 上下文 ID
 */
function invalidateTTSContext(reason: InterruptionReason = 'manual'): void {
  console.log(`[TTS Context] Invalidating context #${currentTTSContextId}`)
  void outputFramePipeline.queueFrame({
    type: 'interruption',
    kind: 'system',
    turnId: currentTurnId,
    ttsContextId: currentTTSContextId,
    reason,
    timestamp: Date.now(),
  })
}

/**
 * 生成新的轮次 ID
 * 每次用户开始新的对话时调用
 */
async function startNewTurn(): Promise<number> {
  // 先取消上一个轮次
  await cancelCurrentTurn({ closeTTS: true, reason: 'manual' })

  currentTurnId++
  cancelledTurnIds.delete(currentTurnId)
  currentTurnAbortController = new AbortController()
  currentTurnUserText = null
  console.log(`[Turn] Started new turn #${currentTurnId}`)
  return currentTurnId
}

/**
 * 取消当前轮次
 * 打断时调用，取消所有正在进行的 LLM/TTS 请求
 */
async function cancelCurrentTurn(
  options: { closeTTS?: boolean; reason?: InterruptionReason } = {}
): Promise<void> {
  const reason = options.reason ?? 'manual'
  let cancelledExistingTurn = false

  if (currentTurnAbortController) {
    console.log(`[Turn] Cancelling turn #${currentTurnId}`)
    cancelledTurnIds.add(currentTurnId)
    currentTurnAbortController.abort()
    currentTurnAbortController = null
    voiceGraphPipeline.broadcastInterruption()
    void currentResponseFramePipeline?.queueFrame({
      type: 'response_interruption',
      kind: 'system',
      reason,
      timestamp: Date.now(),
    })
    currentResponseFramePipeline?.stop()
    currentResponseFramePipeline = null
    cancelledExistingTurn = true
  }

  if (cancelledExistingTurn) {
    // 同时使 TTS 上下文失效
    invalidateTTSContext(reason)
  }

  if (options.closeTTS && cancelledExistingTurn) {
    await ttsService?.interrupt().catch((error: Error) => {
      console.warn('[TTS] Failed to close during turn cancellation:', error.message)
    })
  }
}

function completeCurrentTurn(turnId: number, pipeline: ResponseFramePipeline | null): void {
  if (turnId !== currentTurnId) {
    return
  }

  if (currentResponseFramePipeline === pipeline) {
    currentResponseFramePipeline = null
  }

  currentTurnAbortController = null
  currentTurnUserText = null
}

/**
 * 检查轮次是否已被取消
 */
function isTurnCancelled(turnId: number): boolean {
  return (
    cancelledTurnIds.has(turnId) ||
    turnId !== currentTurnId ||
    currentTurnAbortController?.signal.aborted === true
  )
}

function sanitizeTextForSpeech(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/[\u{1F000}-\u{1F02F}]/gu, '')
    .replace(/[\u{1F0A0}-\u{1F0FF}]/gu, '')
    .replace(/[\u{200D}]/gu, '')
    .replace(/[\u{20E3}]/gu, '')
    .replace(/[\u{E0020}-\u{E007F}]/gu, '')
    .replace(/[★☆●○◆◇■□▲△▼▽◎※]/g, '')
    .replace(/[♪♫♬♩♭♮♯]/g, '')
    .replace(/[←→↑↓↔↕↖↗↘↙]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ========== 播放完成同步机制 ==========
let playbackRequestIdCounter = 0
const playbackResolvers = new Map<number, () => void>()

/**
 * 等待 Renderer 端的音频播放完成
 * 用于 Phase 之间的同步，确保前一阶段的音频播放完毕再开始下一阶段
 */
async function waitForRendererPlayback(timeoutMs = 30000): Promise<void> {
  if (!mainWindow) {
    return
  }

  const requestId = ++playbackRequestIdCounter
  console.log('[Playback] Requesting playback complete wait, requestId:', requestId)

  return new Promise((resolve) => {
    playbackResolvers.set(requestId, resolve)
    mainWindow?.webContents.send('playback:waitRequest', requestId)

    // 超时保护
    setTimeout(() => {
      if (playbackResolvers.has(requestId)) {
        console.log('[Playback] Wait timeout, requestId:', requestId)
        playbackResolvers.delete(requestId)
        resolve()
      }
    }, timeoutMs)
  })
}

// 接收 Renderer 的播放完成通知
ipcMain.on('playback:complete', (_, requestId: number) => {
  console.log('[Playback] Received complete notification, requestId:', requestId)
  const resolver = playbackResolvers.get(requestId)
  if (resolver) {
    playbackResolvers.delete(requestId)
    resolver()
  }
})

// 接收 Renderer 的首个音频播放通知
ipcMain.on('latency:firstAudioPlay', () => {
  void outputFramePipeline.queueFrame({
    type: 'audio_playback_started',
    kind: 'data',
    timestamp: Date.now(),
  })
})

// 设置延迟数据发送到 Renderer
latencyTracker.setSendToRenderer((data) => {
  mainWindow?.webContents.send('latency:data', data)
})

ipcMain.handle('debug:frameTrace', async () => {
  return frameTraceObserver.getTrace()
})

ipcMain.handle('debug:clearFrameTrace', async () => {
  frameTraceObserver.clear()
  return { success: true }
})

function splitDisplayUnits(text: string): string[] {
  const units: string[] = []
  let asciiBuffer = ''
  let cjkBuffer = ''

  const flushAscii = () => {
    if (asciiBuffer) {
      units.push(asciiBuffer)
      asciiBuffer = ''
    }
  }

  const flushCjk = () => {
    if (cjkBuffer) {
      units.push(cjkBuffer)
      cjkBuffer = ''
    }
  }

  for (const char of text) {
    if (/\s/.test(char)) {
      flushAscii()
      flushCjk()
      units.push(char)
      continue
    }

    if (/[，。！？、；：,.!?]/.test(char)) {
      flushAscii()
      flushCjk()
      units.push(char)
      continue
    }

    if (/[A-Za-z0-9]/.test(char)) {
      flushCjk()
      asciiBuffer += char
      continue
    }

    flushAscii()
    cjkBuffer += char
    if (cjkBuffer.length >= 2) {
      flushCjk()
    }
  }

  flushAscii()
  flushCjk()

  return units
}

function estimateDisplayDelay(unit: string): number {
  if (!unit.trim()) {
    return 20
  }

  if (/^[，。！？、；：,.!?]$/.test(unit)) {
    return 180
  }

  if (/^[A-Za-z0-9]+$/.test(unit)) {
    return Math.min(160, Math.max(50, unit.length * 35))
  }

  return Math.min(220, Math.max(70, unit.length * 95))
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// This app uses a transparent frameless window and simple canvas effects.
// Disabling GPU avoids macOS/Electron ANGLE initialization failures.
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')

let mainWindow: BrowserWindow | null = null
let ttsService: TTSProvider | null = null
let sdkInstance: HerTextSDK | null = null
let ttsAvailable = true
let settingsStore: SettingsStore | null = null
let streamingASRSession: StreamingASRSession | null = null
let appSettings: AppSettings = {
  voiceInputEnabled: true,
  voiceOutputEnabled: true,
  volume: 70,
  selectedPersonality: 'role:eva',
  externalRolePaths: [],
  system: {
    proxy: '',
    llmModels: [{ id: 'default-llm', modelName: '', apiKey: '', baseUrl: '' }],
    activeLLMId: 'default-llm',
    ttsModels: [{ id: 'default-tts', provider: 'fish', modelName: 's2-pro', apiKey: '', voiceId: '' }],
    activeTTSId: 'default-tts',
    asrModels: [{ id: 'default-asr', provider: 'qwen', modelName: 'qwen3-asr-flash-realtime', apiKey: '' }],
    activeASRId: 'default-asr'
  }
}

/**
 * 获取当前激活的 LLM 模型配置
 */
function getActiveLLMConfig(): LLMModelConfig | null {
  const { llmModels, activeLLMId } = appSettings.system
  return llmModels.find(m => m.id === activeLLMId) || llmModels[0] || null
}

/**
 * 获取当前激活的 TTS 模型配置
 */
function getActiveTTSConfig(): TTSModelConfig | null {
  const { ttsModels, activeTTSId } = appSettings.system
  return ttsModels.find(m => m.id === activeTTSId) || ttsModels[0] || null
}

/**
 * 获取当前激活的 ASR 模型配置
 */
function getActiveASRConfig(): ASRModelConfig | null {
  const { asrModels, activeASRId } = appSettings.system
  return asrModels.find(m => m.id === activeASRId) || asrModels[0] || null
}

function normalizeASRModelName(modelName?: string): string {
  const normalized = modelName?.trim()
  if (!normalized || normalized === 'realtime' || normalized === 'qwen-realtime') {
    return 'qwen3-asr-flash-realtime'
  }
  return normalized
}

function getTTSConfigSignature(config: TTSModelConfig | null): string {
  if (!config) {
    return 'none'
  }
  return JSON.stringify({
    id: config.id,
    provider: config.provider,
    modelName: config.modelName,
    voiceId: config.voiceId,
    apiKey: config.apiKey ? 'set' : '',
  })
}

function getASRConfigSignature(config: ASRModelConfig | null): string {
  if (!config) {
    return 'none'
  }
  return JSON.stringify({
    id: config.id,
    provider: config.provider,
    modelName: config.modelName,
    apiKey: config.apiKey ? 'set' : '',
  })
}

let activeTTSSignature = ''
let activeASRSignature = ''

function attachTTSProviderEvents(provider: TTSProvider, providerGeneration: number): void {
  let isFirstAudioChunk = true

  provider.setEventHandler((event) => {
    if (providerGeneration !== ttsProviderGeneration) {
      console.log(`[TTS] Dropping event from stale provider generation #${providerGeneration}`)
      return
    }

    switch (event.type) {
      case 'connected': {
        const ttsContextId = event.contextId
        console.log(`[TTS] Connected event (context #${ttsContextId})`)
        isFirstAudioChunk = true
        void outputFramePipeline.queueFrame({
          type: 'tts_started',
          kind: 'control',
          contextId: ttsContextId,
          providerGeneration,
          timestamp: Date.now(),
        })
        break
      }
      case 'audio': {
        const ttsContextId = event.contextId
        if (isFirstAudioChunk) {
          isFirstAudioChunk = false
          void streamingASRSession?.startBotTurn()
        }
        if (ttsContextId < 0) {
          console.log('[TTS] Dropping audio chunk - context invalidated')
          return
        }
        console.log(`[TTS] Audio chunk received (context #${ttsContextId}):`, event.audio.length, 'bytes')
        void outputFramePipeline.queueFrame({
          type: 'tts_audio',
          kind: 'data',
          contextId: ttsContextId,
          providerGeneration,
          audio: event.audio,
          timestamp: Date.now(),
        })
        break
      }
      case 'closed':
        console.log(`[TTS] Closed event (context #${event.contextId})`)
        void outputFramePipeline.queueFrame({
          type: 'tts_stopped',
          kind: 'control',
          contextId: event.contextId,
          providerGeneration,
          timestamp: Date.now(),
        })
        break
      case 'error':
        console.log('[TTS] Error event:', event.error.message)
        ttsAvailable = false
        void outputFramePipeline.queueFrame({
          type: 'tts_error',
          kind: 'control',
          providerGeneration,
          error: event.error.message,
          timestamp: Date.now(),
        })
        break
    }
  })
}

async function initializeTTSProvider(): Promise<void> {
  const ttsConfig = getActiveTTSConfig()
  const nextSignature = getTTSConfigSignature(ttsConfig)
  if (ttsService && activeTTSSignature === nextSignature) {
    return
  }

  if (ttsService) {
    await switchTTSProvider('provider_switch')
    return
  }

  if (!ttsConfig?.apiKey?.trim()) {
    ttsService = null
    ttsAvailable = false
    activeTTSSignature = nextSignature
    console.log('[TTS] Disabled: missing Fish Audio API key')
    return
  }

  const provider = createTTSProvider({
    kind: 'fish-realtime',
    config: {
      apiKey: ttsConfig.apiKey,
      voiceId: ttsConfig.voiceId,
      model: ttsConfig.modelName || 's2-pro',
      format: 'pcm',
      sampleRate: 16000,
      latency: 'balanced',
    },
  })

  const providerGeneration = ++ttsProviderGeneration
  attachTTSProviderEvents(provider, providerGeneration)
  await provider.setup?.()

  ttsService = provider
  ttsAvailable = true
  activeTTSSignature = nextSignature

  const capabilities = provider.getCapabilities()
  console.log(
    `[TTS] Initialized provider=${capabilities.provider}, model=${capabilities.model ?? 'default'}, streaming=${capabilities.streaming}`
  )
}

async function switchTTSProvider(reason: InterruptionReason = 'provider_switch'): Promise<void> {
  const previous = ttsService
  const nextSignature = getTTSConfigSignature(getActiveTTSConfig())

  await cancelCurrentTurn({ closeTTS: false, reason })
  invalidateTTSContext(reason)
  ttsProviderGeneration += 1
  ttsService = null
  ttsAvailable = false

  await previous?.interrupt?.().catch((error: Error) => {
    console.warn('[TTS] Failed to interrupt previous provider:', error.message)
  })
  await previous?.cleanup?.().catch((error: Error) => {
    console.warn('[TTS] Failed to cleanup previous provider:', error.message)
  })

  activeTTSSignature = ''
  const ttsConfig = getActiveTTSConfig()
  if (!ttsConfig?.apiKey?.trim()) {
    activeTTSSignature = nextSignature
    console.log('[TTS] Disabled after provider switch: missing API key')
    return
  }

  await initializeTTSProvider()
}

function configureProxyFromEnv(): void {
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.ALL_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy ||
    process.env.all_proxy

  if (!proxyUrl?.trim()) {
    console.log('[Proxy] No proxy configured (HTTPS_PROXY/HTTP_PROXY not set or empty)')
    return
  }

  process.env.GLOBAL_AGENT_HTTP_PROXY = proxyUrl
  process.env.GLOBAL_AGENT_FORCE_GLOBAL_AGENT = 'true'
  process.env.GLOBAL_AGENT_NO_PROXY =
    process.env.NO_PROXY ||
    process.env.no_proxy ||
    ''

  app.commandLine.appendSwitch('proxy-server', proxyUrl)

  try {
    const { bootstrap } = require('global-agent')
    bootstrap()
    console.log('[Proxy] ✓ Enabled global proxy:', proxyUrl)
  } catch (error) {
    console.warn('[Proxy] ⚠️ Failed to enable global proxy:', error)
  }
}

function isDevMode(): boolean {
  return process.env.NODE_ENV === 'development'
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  if (!isDevMode()) {
    await window.loadFile(join(__dirname, 'renderer/index.html'))
    return
  }

  const maxAttempts = 20

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await window.loadURL(DEV_SERVER_URL)
      window.webContents.openDevTools()
      return
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error
      }

      console.warn(`[Electron] Dev server not ready (${attempt}/${maxAttempts}), retrying...`)
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 500,
    height: 600,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      preload: join(__dirname, 'preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  try {
    await loadRenderer(mainWindow)
  } catch (error) {
    console.error('[Electron] Failed to load renderer:', error)
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

async function initializeSDK(): Promise<void> {
  // 设置激活的 LLM 配置
  setActiveLLMConfig(getActiveLLMConfig())
  const sdkConfig = await buildSDKConfig()
  sdkInstance = await HerTextSDK.initialize(sdkConfig)
  console.log('[SDK] Initialized successfully')
}

async function rebuildSDK(): Promise<void> {
  if (sdkInstance) {
    await sdkInstance.shutdown()
  }
  await initializeSDK()
}

function getSettingsStore(): SettingsStore {
  if (!settingsStore) {
    throw new Error('Settings store not initialized')
  }
  return settingsStore
}

app.whenReady().then(async () => {
  settingsStore = new SettingsStore()
  await settingsStore.initialize()
  appSettings = settingsStore.getSettings()

  // 初始化人格管理器
  await initializePersonalityManager()
  console.log('[App] Personality manager initialized')

  if (appSettings.selectedPersonality && appSettings.selectedPersonality !== 'role:eva') {
    try {
      await getPersonalityManager().setCurrentPersonality(appSettings.selectedPersonality)
    } catch (error) {
      console.warn('[App] Failed to restore selected personality:', error)
      appSettings = await getSettingsStore().update({ selectedPersonality: 'role:eva' })
    }
  }

  // 初始化 SDK（加载记忆数据）
  try {
    await initializeSDK()
    console.log('[App] SDK initialized at startup')
  } catch (error) {
    console.error('[App] Failed to initialize SDK at startup:', error)
  }

  void createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async (event) => {
  event.preventDefault()
  console.log('[App] Shutting down...')

  if (sdkInstance) {
    console.log('[App] Shutting down SDK...')
    await sdkInstance.shutdown()
    console.log('[App] SDK shutdown complete')
  }

  const personalityManager = getPersonalityManager()
  if (personalityManager) {
    console.log('[App] Shutting down personality manager...')
    await personalityManager.shutdown()
    console.log('[App] Personality manager shutdown complete')
  }

  // 真正退出
  app.exit(0)
})

// ========== IPC Handlers ==========

// 窗口拖拽
ipcMain.on('window:move', (event, deltaX, deltaY) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    const [x, y] = win.getPosition()
    win.setPosition(x + deltaX, y + deltaY)
  }
})

ipcMain.handle('window:get-position', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    return win.getPosition()
  }
  return [0, 0]
})

// 初始化 SDK 和对话服务
ipcMain.handle('conversation:initialize', async () => {
  try {
    if (!sdkInstance) {
      await initializeSDK()
    }

    await initializeTTSProvider()

    return {
      success: true,
      ttsEnabled: Boolean(ttsService) && appSettings.voiceOutputEnabled,
      settings: appSettings,
      stats: sdkInstance?.getStats()
    }
  } catch (error: any) {
    console.error('[Initialization] Failed:', error)
    return { success: false, error: error.message }
  }
})

interface ConversationTurnResult {
  success: boolean
  response?: string
  ttsEnabled?: boolean
  error?: string
}

async function runConversationTurn(
  text: string,
  enableTTS: boolean,
  source: 'text' | 'voice' = 'text'
): Promise<ConversationTurnResult> {
  let turnId = 0
  let responseFramePipeline: ResponseFramePipeline | null = null

  try {
    if (!sdkInstance) {
      throw new Error('SDK not initialized')
    }

    if (!text.trim()) {
      return { success: true, response: '', ttsEnabled: false }
    }

    // 开始新轮次（会取消上一个轮次）
    turnId = await startNewTurn()
    const turnAbortSignal = currentTurnAbortController!.signal
    currentTurnUserText = text

    // 通知 Renderer 新轮次开始
    mainWindow?.webContents.send('turn:start', turnId)

    const displayController = new ConversationDisplayController(
      (nextText) => {
        // 检查轮次是否已取消
        if (isTurnCancelled(turnId)) return
        mainWindow?.webContents.send('conversation:response', nextText)
      },
      (frame) => {
        if (isTurnCancelled(turnId)) return
        mainWindow?.webContents.send('conversation:frame', frame)
      }
    )
    displayController.reset()
    currentTTSChunkSequence = 0

    const responseLaneName = `response:${turnId}`
    responseFramePipeline = voiceGraphPipeline.createResponseLane(responseLaneName)
    responseFramePipeline.addObserver(latencyObserver)
    responseFramePipeline.addObserver(frameTraceObserver)
    currentResponseFramePipeline = responseFramePipeline

    let isFirstTTSChunk = true

    let shouldUseTTS = enableTTS && appSettings.voiceOutputEnabled && Boolean(ttsService) && ttsAvailable

    let resolveLLMCompletion: (value: string) => void = () => undefined
    let rejectLLMCompletion: (error: Error) => void = () => undefined
    const llmCompletion = new Promise<string>((resolve, reject) => {
      resolveLLMCompletion = resolve
      rejectLLMCompletion = reject
    })

    const llmStreamBridge = new LLMStreamBridgeProcessor({
      queueFrame: (frame) => {
        void responseFramePipeline?.queueFrame(frame)
      },
      isCancelled: () => isTurnCancelled(turnId),
      shouldUseTTS: () => shouldUseTTS,
      onFirstToken: () => {
        void streamingASRSession?.endBotThinking()
      },
      log: (message) => console.log(message.replace('turn cancelled', `turn #${turnId} cancelled`)),
    })

    const llmResponseProcessor = new LLMResponseProcessor({
      service: sdkInstance,
      bridge: llmStreamBridge,
      signal: turnAbortSignal,
      queueFrame: (frame) => {
        void responseFramePipeline?.queueFrame(frame)
      },
      waitForIdle: () => Promise.resolve(),
      onComplete: (result) => {
        if (result.error) {
          rejectLLMCompletion(result.error)
          return
        }
        resolveLLMCompletion(result.text)
      },
      log: (message) => console.log(message),
    })

    responseFramePipeline.setProcessors([
      llmResponseProcessor,
      new ResponseTTSProcessor({
        isCancelled: () => isTurnCancelled(turnId),
        isEnabled: () => shouldUseTTS && ttsAvailable,
        getService: () => ttsService,
        sanitizeText: sanitizeTextForSpeech,
        onFirstText: () => {
          if (isFirstTTSChunk) {
            isFirstTTSChunk = false
            latencyObserver.markFirstTTSText()
          }
        },
        onText: (textFrame) => {
          currentTTSChunkSequence += 1
          console.log(`[Main] TTS text frame #${turnId}:${currentTTSChunkSequence}, pushing:`, JSON.stringify(textFrame))
          displayController.pushTTSChunkText(textFrame)
        },
        onError: () => {
          ttsAvailable = false
          shouldUseTTS = false
        },
        waitForPlayback: async (phase) => {
          console.log(`[Conversation] Waiting for playback to complete before ending phase "${phase}"...`)
          await waitForRendererPlayback()
          if (isTurnCancelled(turnId)) {
            console.log(`[Turn] Phase end aborted after playback wait - turn #${turnId} cancelled`)
            return
          }
          console.log(`[Conversation] Playback complete for phase "${phase}"`)
        },
        log: (message) => console.warn(message),
      }),
      new ResponseDisplayProcessor({
        isCancelled: () => isTurnCancelled(turnId),
        startPhase: (phase) => displayController.startPhase(phase),
        endPhase: (phase) => displayController.endPhase(phase),
        pushTextDelta: (delta) => displayController.pushTextDelta(delta),
        startTask: (taskDescription) => displayController.startTask(taskDescription),
        endTask: (result) => displayController.endTask(result),
      }),
    ])

    await streamingASRSession?.startBotThinking()

    await responseFramePipeline.queueFrame({
      type: 'user_text',
      kind: 'data',
      turnId,
      text,
      timestamp: Date.now(),
    })
    const fullResponse = await llmCompletion
    await responseFramePipeline.waitForIdle()

    if (!isTurnCancelled(turnId)) {
      await streamingASRSession?.endBotTurn()
    }

    completeCurrentTurn(turnId, responseFramePipeline)
    voiceGraphPipeline.removeLane(responseLaneName)

    return { success: true, response: fullResponse, ttsEnabled: shouldUseTTS }
  } catch (error: any) {
    if (currentResponseFramePipeline === responseFramePipeline) {
      currentResponseFramePipeline?.stop()
      currentResponseFramePipeline = null
    }
    if (turnId > 0) {
      voiceGraphPipeline.removeLane(`response:${turnId}`)
    }
    await streamingASRSession?.endBotTurn().catch(() => undefined)
    console.error(`[Chat] Failed to process ${source} turn:`, error)
    return { success: false, error: error.message }
  }
}

// 发送文本消息
ipcMain.handle('conversation:sendText', async (_, text, enableTTS) => {
  return runConversationTurn(text, enableTTS, 'text')
})

// 停止 TTS
ipcMain.handle('tts:stop', async () => {
  try {
    await cancelCurrentTurn({ closeTTS: true, reason: 'manual' })
    invalidateTTSContext('manual')
    return { success: true }
  } catch (error: any) {
    console.error('[TTS] Failed to stop:', error)
    return { success: false, error: error.message }
  }
})

// 清空历史
ipcMain.handle('conversation:clearHistory', async () => {
  try {
    if (sdkInstance) {
      await sdkInstance.memory.clearAll()
      sdkInstance.clearHistory()
    }
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('profile:clear', async () => {
  try {
    if (!sdkInstance) {
      throw new Error('SDK not initialized')
    }

    await sdkInstance.memory.clearUserProfile()
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('speech:transcribe', async (_, samples: number[]) => {
  try {
    const asrConfig = getActiveASRConfig()
    const apiKey = asrConfig?.apiKey?.trim()
    if (!apiKey) {
      throw new Error('QWEN_API_KEY is not configured. Please set it in Settings > System > ASR.')
    }

    // 单次转录也使用重连传输层，提高可靠性
    const baseTransport = new NodeRealtimeWebSocketTransport()
    const transport = new ReconnectingWebSocketTransport(baseTransport, {
      maxRetries: 3,
      initialRetryDelayMs: 500,
    })
    const asr = createSTTProvider({
      kind: 'qwen-realtime',
      config: {
        apiKey,
        model: normalizeASRModelName(asrConfig?.modelName),
        sampleRate: 16000,
        language: 'zh',
      },
      transport,
    })

    try {
      const text = await asr.transcribe(Int16Array.from(samples))
      return { success: true, text }
    } finally {
      await asr.close().catch(() => undefined)
    }
  } catch (error: any) {
    console.error('[Speech] Transcription failed:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('speech:stream:start', async () => {
  try {
    if (!streamingASRSession) {
      streamingASRSession = new StreamingASRSession()
    }

    await streamingASRSession.start({
      onTranscript: (text) => {
        // VAD + Endpointing 检测到语音结束，通知 Renderer 展示用户文本。
        mainWindow?.webContents.send('speech:transcript', text)
      },
      onUserText: async (text) => {
        await runConversationTurn(text, appSettings.voiceOutputEnabled, 'voice')
      },
      onStateChange: (state) => {
        mainWindow?.webContents.send('speech:state', state)
      },
      onSpeechStart: () => {
        // 用户开始说话，通知 Renderer
        mainWindow?.webContents.send('speech:user-speaking')
      },
      onInterruption: (reason) => {
        // 打断发生（用户在机器人说话时说话）
        console.log(`[Speech] Interruption detected, cancelling turn, reason=${reason}`)

        // 取消当前轮次（这会 abort LLM 请求 + 使 TTS 上下文失效）
        void cancelCurrentTurn({ closeTTS: true, reason })
      }
    })

    return { success: true }
  } catch (error: any) {
    console.error('[Speech] Failed to start streaming:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.on('speech:stream:append', (_, samples: number[] | Int16Array) => {
  if (!streamingASRSession) {
    console.error('[Speech] Failed to append streaming audio: ASR stream is not started')
    return
  }

  void streamingASRSession.append(samples).catch((error: any) => {
    // 忽略停止时的预期错误
    if (error?.message === 'WebSocket connection aborted' ||
        error?.message === 'Qwen STT WebSocket closed') {
      return
    }
    console.error('[Speech] Failed to append streaming audio:', error)
  })
})

ipcMain.handle('speech:stream:stop', async () => {
  try {
    await streamingASRSession?.stop()
    return { success: true }
  } catch (error: any) {
    console.error('[Speech] Failed to stop streaming:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('permissions:getMicrophoneStatus', async () => {
  if (process.platform !== 'darwin') {
    return { success: true, status: 'granted' }
  }

  try {
    return {
      success: true,
      status: systemPreferences.getMediaAccessStatus('microphone')
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('permissions:requestMicrophone', async () => {
  if (process.platform !== 'darwin') {
    return { success: true, granted: true }
  }

  try {
    const currentStatus = systemPreferences.getMediaAccessStatus('microphone')
    if (currentStatus === 'granted') {
      return { success: true, granted: true, status: currentStatus }
    }

    if (currentStatus === 'denied' || currentStatus === 'restricted') {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
      return { success: true, granted: false, status: currentStatus, openedSettings: true }
    }

    const granted = await systemPreferences.askForMediaAccess('microphone')
    return {
      success: true,
      granted,
      status: systemPreferences.getMediaAccessStatus('microphone')
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// ========== SDK 相关 IPC Handlers ==========

// ========== 记忆管理 API ==========

// 获取用户画像
ipcMain.handle('memory:getUserProfile', async () => {
  if (!sdkInstance) return { success: false, error: 'SDK not initialized' }

  try {
    const profile = sdkInstance.memory.getUserProfile()
    // 将 Map 转换为普通对象
    const importantMemories: Record<string, string> = {}
    if (profile.importantMemories instanceof Map) {
      profile.importantMemories.forEach((value, key) => {
        importantMemories[key] = value
      })
    } else if (profile.importantMemories && typeof profile.importantMemories === 'object') {
      Object.entries(profile.importantMemories as Record<string, unknown>).forEach(([key, value]) => {
        importantMemories[key] = String(value)
      })
    }

    return {
      success: true,
      profile: {
        basic: profile.basic,
        importantMemories
      }
    }
  } catch (error: any) {
    console.error('[Memory] Failed to get user profile:', error)
    return { success: false, error: error.message }
  }
})

// 更新用户基本画像
ipcMain.handle('memory:updateUserProfile', async (_, updates: Record<string, string>) => {
  if (!sdkInstance) return { success: false, error: 'SDK not initialized' }

  try {
    await sdkInstance.memory.updateUserProfileBasic(updates)
    return { success: true }
  } catch (error: any) {
    console.error('[Memory] Failed to update user profile:', error)
    return { success: false, error: error.message }
  }
})

// 添加重要记忆
ipcMain.handle('memory:addImportantMemory', async (_, key: string, value: string) => {
  if (!sdkInstance) return { success: false, error: 'SDK not initialized' }

  try {
    await sdkInstance.memory.addImportantMemory(key, value)
    return { success: true }
  } catch (error: any) {
    console.error('[Memory] Failed to add important memory:', error)
    return { success: false, error: error.message }
  }
})

// 删除重要记忆
ipcMain.handle('memory:deleteImportantMemory', async (_, key: string) => {
  if (!sdkInstance) return { success: false, error: 'SDK not initialized' }

  try {
    await sdkInstance.memory.deleteImportantMemory(key)
    return { success: true }
  } catch (error: any) {
    console.error('[Memory] Failed to delete important memory:', error)
    return { success: false, error: error.message }
  }
})

// 获取对话摘要
ipcMain.handle('memory:getConversationSummaries', async () => {
  if (!sdkInstance) return { success: false, error: 'SDK not initialized' }

  try {
    const summaries = sdkInstance.memory.getAllConversationSummaries()
    return { success: true, summaries }
  } catch (error: any) {
    console.error('[Memory] Failed to get conversation summaries:', error)
    return { success: false, error: error.message }
  }
})

// 获取最近对话
ipcMain.handle('memory:getWorkingMemory', async () => {
  if (!sdkInstance) return { success: false, error: 'SDK not initialized' }

  try {
    const recentTurns = sdkInstance.memory.getWorkingMemory()
    return { success: true, memory: { recentTurns } }
  } catch (error: any) {
    console.error('[Memory] Failed to get working memory:', error)
    return { success: false, error: error.message }
  }
})

// 删除对话摘要
ipcMain.handle('memory:deleteConversationSummary', async (_, id: string) => {
  if (!sdkInstance) return { success: false, error: 'SDK not initialized' }

  try {
    await sdkInstance.memory.deleteConversationSummary(id)
    return { success: true }
  } catch (error: any) {
    console.error('[Memory] Failed to delete conversation summary:', error)
    return { success: false, error: error.message }
  }
})

// 删除对话轮次
ipcMain.handle('memory:deleteConversationTurn', async (_, id: string) => {
  if (!sdkInstance) return { success: false, error: 'SDK not initialized' }

  try {
    await sdkInstance.memory.deleteConversationTurn(id)
    return { success: true }
  } catch (error: any) {
    console.error('[Memory] Failed to delete conversation turn:', error)
    return { success: false, error: error.message }
  }
})

// 删除用户画像字段
ipcMain.handle('memory:deleteProfileField', async (_, field: string) => {
  if (!sdkInstance) return { success: false, error: 'SDK not initialized' }

  try {
    await sdkInstance.memory.deleteProfileField(field)
    return { success: true }
  } catch (error: any) {
    console.error('[Memory] Failed to delete profile field:', error)
    return { success: false, error: error.message }
  }
})

// 清空重要记忆
ipcMain.handle('memory:clearImportantMemories', async () => {
  if (!sdkInstance) return { success: false, error: 'SDK not initialized' }

  try {
    await sdkInstance.memory.clearImportantMemories()
    return { success: true }
  } catch (error: any) {
    console.error('[Memory] Failed to clear important memories:', error)
    return { success: false, error: error.message }
  }
})

// 清空对话摘要
ipcMain.handle('memory:clearConversationSummaries', async () => {
  if (!sdkInstance) return { success: false, error: 'SDK not initialized' }

  try {
    await sdkInstance.memory.clearConversationSummaries()
    return { success: true }
  } catch (error: any) {
    console.error('[Memory] Failed to clear conversation summaries:', error)
    return { success: false, error: error.message }
  }
})

// 清空最近对话
ipcMain.handle('memory:clearWorkingMemory', async () => {
  if (!sdkInstance) return { success: false, error: 'SDK not initialized' }

  try {
    await sdkInstance.memory.clearWorkingMemory()
    return { success: true }
  } catch (error: any) {
    console.error('[Memory] Failed to clear working memory:', error)
    return { success: false, error: error.message }
  }
})

// 获取人格信息
ipcMain.handle('sdk:getPersonality', async () => {
  if (!sdkInstance) return null

  try {
    return sdkInstance.personality.getPersonality()
  } catch (error: any) {
    console.error('[SDK] Failed to get personality:', error)
    return null
  }
})

ipcMain.handle('settings:get', async () => {
  return appSettings
})

ipcMain.handle('settings:update', async (_, partial: Partial<AppSettings>) => {
  const previousTTSSignature = getTTSConfigSignature(getActiveTTSConfig())
  const previousASRSignature = getASRConfigSignature(getActiveASRConfig())
  appSettings = await getSettingsStore().update(partial)
  const nextTTSSignature = getTTSConfigSignature(getActiveTTSConfig())
  const nextASRSignature = getASRConfigSignature(getActiveASRConfig())

  if (
    previousTTSSignature !== nextTTSSignature ||
    (ttsService && activeTTSSignature !== nextTTSSignature)
  ) {
    await switchTTSProvider('provider_switch')
  }

  if (
    streamingASRSession &&
    (previousASRSignature !== nextASRSignature || activeASRSignature !== nextASRSignature)
  ) {
    await cancelCurrentTurn({ closeTTS: true, reason: 'provider_switch' })
    await streamingASRSession.switchProvider('provider_switch')
  }

  return appSettings
})

ipcMain.handle('settings:resetSystemFromEnv', async () => {
  try {
    appSettings = await getSettingsStore().reloadSystemConfigFromEnv()
    return { success: true, settings: appSettings }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('personality:list', async () => {
  try {
    const personalityManager = getPersonalityManager()
    return {
      success: true,
      current: appSettings.selectedPersonality,
      items: await personalityManager.listRoleItems(appSettings.externalRolePaths)
    }
  } catch (error: any) {
    return { success: false, error: error.message, items: [] }
  }
})

ipcMain.handle('personality:set', async (_, ref: string) => {
  try {
    const personalityManager = getPersonalityManager()
    await personalityManager.setCurrentPersonality(ref)
    appSettings = await getSettingsStore().update({ selectedPersonality: ref })
    await rebuildSDK()
    return { success: true, current: ref }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('personality:addFile', async () => {
  try {
    const dialogOptions: OpenDialogOptions = {
      title: '选择角色 YAML 文件',
      properties: ['openFile'],
      filters: [
        { name: 'YAML Role', extensions: ['yaml', 'yml'] },
      ],
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    const filePath = result.filePaths[0]
    const personalityManager = getPersonalityManager()
    await personalityManager.validateRoleFile(filePath)

    const externalRolePaths = Array.from(new Set([
      ...appSettings.externalRolePaths,
      filePath,
    ]))
    appSettings = await getSettingsStore().update({ externalRolePaths })

    const ref = `file:${filePath}`
    return {
      success: true,
      item: {
        id: ref,
        name: filePath.split(/[\\/]/).pop()?.replace(/\.ya?ml$/i, '') ?? filePath,
        path: filePath,
        source: 'file',
      }
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// 获取统计信息
ipcMain.handle('sdk:getStats', async () => {
  if (!sdkInstance) return null

  try {
    return sdkInstance.getStats()
  } catch (error: any) {
    console.error('[SDK] Failed to get stats:', error)
    return null
  }
})

console.log('Her-Text Electron app started')
