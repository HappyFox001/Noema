/**
 * Electron main process entrypoint.
 *
 * Owns application lifecycle, SDK startup, voice pipeline orchestration,
 * TTS playback coordination, plugin loading, and IPC handlers for the renderer.
 */
import { config as dotenvConfig } from 'dotenv'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { createRequire } from 'module'
import { existsSync } from 'fs'
import { stat } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)

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
  SmartTurnAnalyzer,
  type VADParams,
  type EndpointingConfig,
  type TurnControllerEvents,
  type UserTurnStoppedParams,
  type VoiceConfidenceProvider,
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
  ResponseDisplayProcessor,
  ResponseTTSProcessor,
  type ExpressionFrame,
  type PluginRuntimeContext,
  type TaskUserInputRequest,
  type TaskUserInputResponse,
  type TaskPlan,
} from '@her-text/sdk'
import { discoverRuntimePlugins, invokeRuntimePluginAdminAction, loadRuntimePlugins } from './plugin-loader.js'
import { initializeSileroVAD, isSileroVADAvailable } from './silero-vad-helper.js'
import { initializeSmartTurn, isSmartTurnAvailable } from './smart-turn-helper.js'
import {
  initializePersonalityManager,
  getPersonalityManager,
  buildSDKConfig,
  getStorageDir,
  setActiveLLMConfig,
  setActiveTaskLLMConfig,
  setActiveTaskRuntimeConfig
} from './sdk-config.js'
import { SettingsStore, type AppSettings, type LLMModelConfig, type TTSModelConfig, type ASRModelConfig } from './settings-store.js'
import { InteractiveInputStore, type StoredInteractiveInput, type StoredInteractiveInputGroup } from './interactive-input-store.js'
import { NodeRealtimeWebSocketTransport } from './qwen-websocket-transport.js'
import {
  ReconnectingWebSocketTransport,
  type ConnectionState,
} from './reconnecting-websocket-transport.js'
const DEV_SERVER_URL = 'http://127.0.0.1:5173'

type InterruptionReason = 'vad_start' | 'transcript_start' | 'manual' | 'provider_switch'

type ConversationPhase = 'reply' | 'task' | 'task_result'

type LocalModelStatus = {
  id: 'silero-vad' | 'smart-turn'
  name: string
  filename: string
  purpose: string
  exists: boolean
  sizeBytes?: number
  path: string
}

const LOCAL_MODEL_DEFINITIONS: Array<Omit<LocalModelStatus, 'exists' | 'sizeBytes' | 'path'>> = [
  {
    id: 'silero-vad',
    name: 'Silero VAD',
    filename: 'silero_vad.onnx',
    purpose: '本地语音活动检测',
  },
  {
    id: 'smart-turn',
    name: 'Smart Turn v3.2',
    filename: 'smart-turn-v3.2-cpu.onnx',
    purpose: '本地智能话音结束判断',
  },
]

type ConversationFrame =
  | { type: 'system.reset' }
  | { type: 'control.phase_start'; phase: ConversationPhase }
  | { type: 'control.phase_end'; phase: ConversationPhase }
  | { type: 'control.task_start'; taskDescription: string }
  | { type: 'control.task_plan'; plan: TaskPlan }
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

  showExpression(frame: {
    id: string
    emotion: string
    assetPath: string
    durationMs: number
    priority?: number
  }): void {
    this.sendFrame({
      type: 'expression.show',
      id: frame.id,
      emotion: frame.emotion,
      src: pathToFileURL(frame.assetPath).toString(),
      durationMs: frame.durationMs,
      ...(frame.priority !== undefined ? { priority: frame.priority } : {}),
    })
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


class LatencyTracker {
  private timestamps: Map<string, number> = new Map()
  private sessionId: number = 0
  private sendToRenderer?: (data: LatencyData) => void
  private ttsChunkArrivalTimes: number[] = []
  private playbackStats: TTSPlaybackMetrics = {
    chunks: 0,
    totalAudioMs: 0,
  }

  constructor() {
    this.reset()
  }

  setSendToRenderer(fn: (data: LatencyData) => void): void {
    this.sendToRenderer = fn
  }

  reset(): void {
    this.sessionId = Date.now()
    this.timestamps.clear()
    this.ttsChunkArrivalTimes = []
    this.playbackStats = {
      chunks: 0,
      totalAudioMs: 0,
    }
  }

  mark(point: LatencyPoint): void {
    const now = performance.now()
    this.timestamps.set(point, now)
    console.log(`[Latency] ${point}: ${now.toFixed(1)}ms`)
  }

  recordTTSAudioChunk(): void {
    this.ttsChunkArrivalTimes.push(performance.now())
  }

  recordPlaybackSchedule(metrics: {
    durationMs: number
    scheduleDelayMs: number
    bufferAheadMs: number
    underrunMs: number
  }): void {
    this.playbackStats.chunks += 1
    this.playbackStats.totalAudioMs += metrics.durationMs
    this.playbackStats.maxScheduleDelayMs = Math.max(
      this.playbackStats.maxScheduleDelayMs ?? 0,
      metrics.scheduleDelayMs
    )
    this.playbackStats.minBufferAheadMs = Math.min(
      this.playbackStats.minBufferAheadMs ?? metrics.bufferAheadMs,
      metrics.bufferAheadMs
    )
    this.playbackStats.maxUnderrunMs = Math.max(
      this.playbackStats.maxUnderrunMs ?? 0,
      metrics.underrunMs
    )
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

    const ttsPlayback = this.calculateTTSPlaybackMetrics()

    const data: LatencyData = {
      sessionId: this.sessionId,
      total,
      intervals,
      timestamps: Object.fromEntries(this.timestamps) as Record<LatencyPoint, number>,
      ttsPlayback,
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
    if (ttsPlayback) {
      console.log(
        `[Latency]   └─ Playback Health: chunks=${ttsPlayback.chunks}, audio=${ttsPlayback.totalAudioMs.toFixed(0)}ms, ` +
        `arrivalGap(avg/max)=${ttsPlayback.avgArrivalGapMs?.toFixed(0) ?? '?'} / ${ttsPlayback.maxArrivalGapMs?.toFixed(0) ?? '?'}ms, ` +
        `bufferAhead(min)=${ttsPlayback.minBufferAheadMs?.toFixed(0) ?? '?'}ms, underrun(max)=${ttsPlayback.maxUnderrunMs?.toFixed(0) ?? '?'}ms`
      )
    }
    console.log('[Latency] ================================')

    this.sendToRenderer?.(data)

    return data
  }

  private calculateTTSPlaybackMetrics(): TTSPlaybackMetrics | undefined {
    if (this.playbackStats.chunks === 0 && this.ttsChunkArrivalTimes.length === 0) {
      return undefined
    }

    const arrivalGaps: number[] = []
    for (let i = 1; i < this.ttsChunkArrivalTimes.length; i++) {
      arrivalGaps.push(this.ttsChunkArrivalTimes[i] - this.ttsChunkArrivalTimes[i - 1])
    }

    const avgArrivalGapMs = arrivalGaps.length > 0
      ? arrivalGaps.reduce((sum, value) => sum + value, 0) / arrivalGaps.length
      : undefined
    const maxArrivalGapMs = arrivalGaps.length > 0
      ? Math.max(...arrivalGaps)
      : undefined

    return {
      ...this.playbackStats,
      avgArrivalGapMs,
      maxArrivalGapMs,
    }
  }
}

type LatencyPoint =
  | 'vad_speech_stop'
  | 'turn_complete'
  | 'speech_end'
  | 'asr_complete'
  | 'llm_start'
  | 'first_llm_token'
  | 'first_tts_text'
  | 'first_tts_audio'
  | 'first_audio_play'

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

interface TTSPlaybackMetrics {
  chunks: number
  totalAudioMs: number
  avgArrivalGapMs?: number
  maxArrivalGapMs?: number
  maxScheduleDelayMs?: number
  minBufferAheadMs?: number
  maxUnderrunMs?: number
}

interface LatencyData {
  sessionId: number
  total?: number
  intervals: LatencyIntervals
  timestamps: Record<LatencyPoint, number>
  ttsPlayback?: TTSPlaybackMetrics
}

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
        this.tracker.recordTTSAudioChunk()
        if (!this.firstTTSAudioSeen) {
          this.firstTTSAudioSeen = true
          this.tracker.mark('first_tts_audio')
        }
        return
      case 'audio_playback_started':
        if (!this.firstAudioPlaySeen) {
          this.firstAudioPlaySeen = true
          this.tracker.mark('first_audio_play')
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

  calculate(): LatencyData | null {
    return this.tracker.calculate()
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


const DEFAULT_VAD_CONFIG: Partial<VADParams> = {
  confidence: 0.7,
  startSecs: 0.2,
  stopSecs: 0.2,
  minVolume: 0.02,
  sampleRate: 16000,
}

let sileroVADProvider: VoiceConfidenceProvider | null = null
let sileroVADInitPromise: Promise<VoiceConfidenceProvider | null> | null = null


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

let smartTurnAnalyzer: SmartTurnAnalyzer | null = null
let smartTurnInitPromise: Promise<SmartTurnAnalyzer | null> | null = null


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


const FALLBACK_ENDPOINTING_CONFIG: Partial<EndpointingConfig> = {
  userSpeechTimeout: 600,
  sttTimeoutMs: 1000,
  userTurnStopTimeout: 5000,
}

const voiceGraphPipeline = new VoiceGraphPipeline()


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

    const baseTransport = new NodeRealtimeWebSocketTransport()
    const reconnectingTransport = new ReconnectingWebSocketTransport(baseTransport, {
      maxRetries: 5,
      initialRetryDelayMs: 1000,
      maxRetryDelayMs: 16000,
      onConnectionStateChange: (state: ConnectionState) => {
        this.log(`ASR WebSocket state: ${state}`)
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

    const sileroProvider = await getSileroVADProvider()
    let vadAnalyzer: VADAnalyzer
    if (sileroProvider) {
      this.log('Using Silero VAD (neural network)')
      vadAnalyzer = new VADAnalyzer(sileroProvider, DEFAULT_VAD_CONFIG)
    } else {
      this.log('Using RMS VAD (fallback)')
      vadAnalyzer = createVADAnalyzer(DEFAULT_VAD_CONFIG)
    }

    const smartTurn = await getSmartTurnAnalyzer()

    if (smartTurn) {
      this.log('Using Pipecat TurnAnalyzer Smart Turn endpointing')
      this.turnController = new TurnController(vadAnalyzer, {
        smartTurn: {
          analyzer: smartTurn,
          analyzeIntervalMs: 200,
          maxAnalyzeAttempts: 10,
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
              if (frame.finalized) {
                this.log(`Dropping stale finalized transcription for voice turn #${frame.voiceTurnId}`)
              }
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
      if (error.message === 'WebSocket connection aborted' ||
          error.message === 'Qwen STT WebSocket closed') {
        return
      }
      throw error
    })
  }

  
  async stop(): Promise<void> {
    this.onStateChange?.('idle')
    this.onTranscript = null
    this.onStateChange = null
    this.onUserText = null
    this.onSpeechStart = null
    this.onInterruption = null

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

let currentTurnId = 0
let currentTurnAbortController: AbortController | null = null
let currentResponseFramePipeline: ResponseFramePipeline | null = null
let currentTaskPlanFrameSender: ((plan: TaskPlan) => void) | null = null
const cancelledTurnIds = new Set<number>()


let currentTTSContextId = 0
let ttsProviderGeneration = 0


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


async function startNewTurn(): Promise<number> {
  await cancelCurrentTurn({ closeTTS: true, reason: 'manual' })

  currentTurnId++
  cancelledTurnIds.delete(currentTurnId)
  currentTurnAbortController = new AbortController()
  console.log(`[Turn] Started new turn #${currentTurnId}`)
  return currentTurnId
}


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
    currentResponseFramePipeline?.interrupt()
    cancelledExistingTurn = true
  }

  if (cancelledExistingTurn) {
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
}


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

function getPluginRuntimeContext(enabled: boolean): PluginRuntimeContext {
  if (!enabled) {
    return {}
  }

  const ttsConfig = getActiveTTSConfig()
  if (ttsConfig?.provider !== 'fish') {
    return {}
  }

  return {
    voiceOutputEnabled: true,
    tts: {
      provider: 'fish-audio',
      model: ttsConfig.modelName || 's2-pro',
    },
  }
}

function resolveRuntimePluginsDir(): string {
  const candidates = [
    join(process.cwd(), 'plugins'),
    join(app.getAppPath(), '../../plugins'),
    join(__dirname, '../../../plugins'),
  ]

  const found = candidates.find(candidate => existsSync(candidate))
  if (found) {
    return found
  }

  console.warn('[PluginLoader] Runtime plugins directory not found. Tried:', candidates)
  return candidates[0]
}

function resolveProjectModelsDir(): string {
  return join(__dirname, '../../../models')
}

function resolveDownloadModelsScript(): string {
  const candidates = [
    join(__dirname, '../../../scripts/download-models.sh'),
    join(__dirname, '../../../../scripts/download-models.sh'),
    join(process.cwd(), 'scripts/download-models.sh'),
    join(process.cwd(), '../../scripts/download-models.sh'),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error(`download-models.sh not found. Searched paths:\n${candidates.join('\n')}`)
}

async function getLocalModelStatuses(): Promise<LocalModelStatus[]> {
  const modelsDir = resolveProjectModelsDir()

  return Promise.all(LOCAL_MODEL_DEFINITIONS.map(async (model) => {
    const modelPath = join(modelsDir, model.filename)
    try {
      const file = await stat(modelPath)
      return {
        ...model,
        exists: file.isFile(),
        sizeBytes: file.size,
        path: modelPath,
      }
    } catch {
      return {
        ...model,
        exists: false,
        path: modelPath,
      }
    }
  }))
}

async function downloadMissingLocalModels(): Promise<LocalModelStatus[]> {
  const before = await getLocalModelStatuses()
  if (before.every((model) => model.exists)) {
    return before
  }

  const scriptPath = resolveDownloadModelsScript()
  console.log('[Models] Downloading missing local models with:', scriptPath)
  await execFileAsync('/bin/bash', [scriptPath], {
    cwd: join(dirname(scriptPath), '..'),
    env: { ...process.env },
    timeout: 10 * 60 * 1000,
    maxBuffer: 1024 * 1024,
  })

  sileroVADProvider = null
  sileroVADInitPromise = null
  smartTurnAnalyzer = null
  smartTurnInitPromise = null

  return getLocalModelStatuses()
}

let playbackRequestIdCounter = 0
const playbackResolvers = new Map<number, () => void>()


async function waitForRendererPlayback(timeoutMs = 30000): Promise<void> {
  if (!mainWindow) {
    return
  }

  const requestId = ++playbackRequestIdCounter
  console.log('[Playback] Requesting playback complete wait, requestId:', requestId)

  return new Promise((resolve) => {
    playbackResolvers.set(requestId, resolve)
    mainWindow?.webContents.send('playback:waitRequest', requestId)

    setTimeout(() => {
      if (playbackResolvers.has(requestId)) {
        console.log('[Playback] Wait timeout, requestId:', requestId)
        playbackResolvers.delete(requestId)
        resolve()
      }
    }, timeoutMs)
  })
}

ipcMain.on('playback:complete', (_, requestId: number) => {
  console.log('[Playback] Received complete notification, requestId:', requestId)
  const resolver = playbackResolvers.get(requestId)
  if (resolver) {
    playbackResolvers.delete(requestId)
    resolver()
  }
  latencyObserver.calculate()
})

ipcMain.on('latency:firstAudioPlay', () => {
  void outputFramePipeline.queueFrame({
    type: 'audio_playback_started',
    kind: 'data',
    timestamp: Date.now(),
  })
})

ipcMain.on('latency:audioScheduled', (_, metrics: {
  durationMs: number
  scheduleDelayMs: number
  bufferAheadMs: number
  underrunMs: number
}) => {
  latencyTracker.recordPlaybackSchedule(metrics)
})

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
const COMPACT_WINDOW_SIZE = { width: 380, height: 380 }
const TASK_WINDOW_SIZE = { width: 600, height: 380 }
const SETTINGS_WINDOW_SIZE = { width: 500, height: 600 }

function resizeWindowAroundCenter(window: BrowserWindow, width: number, height: number): void {
  const bounds = window.getBounds()
  const nextX = Math.round(bounds.x + (bounds.width - width) / 2)
  const nextY = Math.round(bounds.y + (bounds.height - height) / 2)
  window.setBounds({ x: nextX, y: nextY, width, height }, false)
}
let ttsService: TTSProvider | null = null
let sdkInstance: HerTextSDK | null = null
let ttsAvailable = true
let settingsStore: SettingsStore | null = null
let interactiveInputStore: InteractiveInputStore | null = null
let streamingASRSession: StreamingASRSession | null = null
let appSettings: AppSettings = {
  voiceInputEnabled: true,
  voiceOutputEnabled: true,
  volume: 70,
  selectedPersonality: 'role:eva',
  externalRolePaths: [],
  plugins: {},
  pluginConfigs: {},
  system: {
    proxy: '',
    llmModels: [{ id: 'default-llm', modelName: '', apiKey: '', baseUrl: '' }],
    activeLLMId: 'default-llm',
    taskModels: [{ id: 'default-task', modelName: 'gemini-3.1-pro-preview', apiKey: '', baseUrl: '' }],
    activeTaskId: 'default-task',
    taskRuntime: {
      maxTurns: 24,
      compactAfterTurns: 8,
      keepRecentTurns: 4,
      noOpLimit: 2
    },
    ttsModels: [{ id: 'default-tts', provider: 'fish', modelName: 's2-pro', apiKey: '', voiceId: '' }],
    activeTTSId: 'default-tts',
    asrModels: [{ id: 'default-asr', provider: 'qwen', modelName: 'qwen3-asr-flash-realtime', apiKey: '' }],
    activeASRId: 'default-asr'
  }
}


function getActiveLLMConfig(): LLMModelConfig | null {
  const { llmModels, activeLLMId } = appSettings.system
  return llmModels.find(m => m.id === activeLLMId) || llmModels[0] || null
}


function getActiveTaskConfig(): LLMModelConfig | null {
  const { taskModels, activeTaskId } = appSettings.system
  return taskModels.find(m => m.id === activeTaskId) || taskModels[0] || null
}


function getActiveTTSConfig(): TTSModelConfig | null {
  const { ttsModels, activeTTSId } = appSettings.system
  return ttsModels.find(m => m.id === activeTTSId) || ttsModels[0] || null
}


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

function getLLMConfigSignature(config: LLMModelConfig | null): string {
  if (!config) {
    return 'none'
  }
  return JSON.stringify({
    id: config.id,
    modelName: config.modelName,
    baseUrl: config.baseUrl,
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
      normalize: true,
      prosody: {
        speed: 1.0,
        volume: 0,
      },
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
    width: COMPACT_WINDOW_SIZE.width,
    height: COMPACT_WINDOW_SIZE.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
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

async function requestTaskUserInput(request: TaskUserInputRequest): Promise<TaskUserInputResponse> {
  const identity = request.persistence === 'persistent' && request.sensitivity !== 'verification'
    ? normalizeTaskInputRequestIdentity(request)
    : null
  if (
    request.persistence === 'persistent' &&
    identity &&
    request.sensitivity !== 'verification' &&
    interactiveInputStore
  ) {
    const stored = await interactiveInputStore.get(identity.key)
    if (stored?.value) {
      return {
        value: stored.value,
        remembered: true,
        fromCache: true,
      }
    }
  }

  const semanticMatch = await resolveStoredTaskInput(request)
  if (semanticMatch?.value) {
    return {
      value: semanticMatch.value,
      remembered: true,
      fromCache: true,
    }
  }

  if (!mainWindow) {
    throw new Error('No renderer window available for user input request')
  }

  const response = await new Promise<TaskUserInputResponse>((resolve) => {
    const channel = `interactive-input:response:${request.id}`
    const timeout = setTimeout(() => {
      ipcMain.removeHandler(channel)
      resolve({ value: '', cancelled: true })
    }, 10 * 60 * 1000)

    ipcMain.handle(channel, async (_event, payload: TaskUserInputResponse) => {
      clearTimeout(timeout)
      ipcMain.removeHandler(channel)
      return resolve(payload)
    })

    mainWindow?.webContents.send('interactive-input:request', request)
  })

  if (
    response.value &&
    request.persistence === 'persistent' &&
    identity &&
    request.sensitivity !== 'verification' &&
    interactiveInputStore
  ) {
    const group = await resolveStoredTaskInputGroup(request)
    await interactiveInputStore.set({
      groupKey: group?.groupKey ?? identity.groupKey,
      groupLabel: group?.groupLabel ?? identity.groupLabel,
      itemKey: identity.itemKey,
      itemLabel: identity.itemLabel,
      label: request.label,
      value: response.value,
      sensitivity: request.sensitivity,
    })
  }

  return response
}

async function resolveStoredTaskInput(request: TaskUserInputRequest): Promise<StoredInteractiveInput | null> {
  if (
    request.persistence !== 'persistent' ||
    request.sensitivity === 'verification' ||
    !interactiveInputStore ||
    !sdkInstance
  ) {
    return null
  }

  const candidates = await interactiveInputStore.list()
  if (candidates.length === 0) {
    return null
  }

  try {
    const response = await sdkInstance.getTaskLLM().chat([
      {
        role: 'system',
        content: [
          '你是账户信息匹配器。判断本次请求需要的信息，是否已经存在于候选账户信息中。',
          '候选信息不包含真实值，只有 group、item、key、label、sensitivity、scope。不要要求看到真实值。',
          '必须基于语义判断，不要只做字符串相等。',
          '只有高度确定是同一个服务下的同一个具体字段时才匹配，例如 Google 密码匹配 Google password。',
          '同一个服务但字段不同不能匹配，例如 Google 密码不能匹配 Google 邮箱；这只能说明属于同一 group，不能复用 value。',
          '验证码、一次性 MFA、临时确认不要匹配。',
          '只输出 JSON object，不要 Markdown。',
          '格式：{"matched":true,"key":"候选key","reason":"一句话原因"} 或 {"matched":false,"key":null,"reason":"一句话原因"}'
        ].join('\n')
      },
      {
        role: 'user',
        content: JSON.stringify({
          request: {
            key: request.key,
            label: request.label,
            description: request.description,
            placeholder: request.placeholder,
            sensitivity: request.sensitivity,
            persistence: request.persistence,
            groupKey: request.groupKey,
            groupLabel: request.groupLabel,
            itemKey: request.itemKey,
            itemLabel: request.itemLabel
          },
          candidates: candidates.slice(0, 40).map(item => ({
            key: item.key,
            groupKey: item.groupKey,
            groupLabel: item.groupLabel,
            itemKey: item.itemKey,
            itemLabel: item.itemLabel,
            label: item.label,
            sensitivity: item.sensitivity,
            scope: item.scope,
            updatedAt: item.updatedAt
          }))
        }, null, 2)
      }
    ], {
      max_tokens: 200
    })

    const decision = parseSemanticInputMatch(response.content)
    if (!decision.matched || !decision.key) {
      return null
    }

    const matched = candidates.find(item => item.key === decision.key)
    if (!matched) {
      return null
    }

    console.log(`[InteractiveInput] Reusing stored input by semantic match: ${matched.key} (${decision.reason})`)
    return matched
  } catch (error) {
    console.warn(`[InteractiveInput] Semantic input match failed: ${(error as Error).message}`)
    return null
  }
}

async function resolveStoredTaskInputGroup(request: TaskUserInputRequest): Promise<StoredInteractiveInputGroup | null> {
  if (
    request.persistence !== 'persistent' ||
    request.sensitivity === 'verification' ||
    !interactiveInputStore ||
    !sdkInstance
  ) {
    return null
  }

  const groups = await interactiveInputStore.listGroups()
  if (groups.length === 0) {
    return null
  }

  const identity = normalizeTaskInputRequestIdentity(request)
  const exact = groups.find(group => group.groupKey === identity.groupKey)
  if (exact) {
    return exact
  }

  try {
    const response = await sdkInstance.getTaskLLM().chat([
      {
        role: 'system',
        content: [
          '你是账户信息分组器。判断本次请求的新信息应该归入哪个已有信息大类。',
          '候选信息不包含真实值，只有 group 和已有 item 元数据。不要要求看到真实值。',
          '如果是同一服务、同一账号、同一平台或同一 API 提供商的信息，应匹配已有 group。',
          '字段不同也可以匹配 group，例如已有 Google 邮箱，请求 Google 密码，应匹配 Google group。',
          '如果服务或账号明显不同，应不匹配。',
          '只输出 JSON object，不要 Markdown。',
          '格式：{"matched":true,"groupKey":"候选groupKey","reason":"一句话原因"} 或 {"matched":false,"groupKey":null,"reason":"一句话原因"}'
        ].join('\n')
      },
      {
        role: 'user',
        content: JSON.stringify({
          request: {
            key: request.key,
            label: request.label,
            description: request.description,
            placeholder: request.placeholder,
            sensitivity: request.sensitivity,
            persistence: request.persistence,
            groupKey: request.groupKey,
            groupLabel: request.groupLabel,
            itemKey: request.itemKey,
            itemLabel: request.itemLabel,
          },
          groups: groups.slice(0, 30).map(group => ({
            groupKey: group.groupKey,
            groupLabel: group.groupLabel,
            items: group.items.map(item => ({
              key: item.key,
              itemKey: item.itemKey,
              itemLabel: item.itemLabel,
              label: item.label,
              sensitivity: item.sensitivity,
            })),
            updatedAt: group.updatedAt,
          }))
        }, null, 2)
      }
    ], {
      max_tokens: 200
    })

    const decision = parseSemanticInputGroupMatch(response.content)
    if (!decision.matched || !decision.groupKey) {
      return null
    }

    const matched = groups.find(group => group.groupKey === decision.groupKey)
    if (!matched) {
      return null
    }

    console.log(`[InteractiveInput] Storing input under existing group: ${matched.groupKey} (${decision.reason})`)
    return matched
  } catch (error) {
    console.warn(`[InteractiveInput] Semantic input group match failed: ${(error as Error).message}`)
    return null
  }
}

function parseSemanticInputMatch(content: string): {
  matched: boolean
  key: string | null
  reason: string
} {
  let parsed: any
  try {
    parsed = JSON.parse(content)
  } catch {
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) {
      return { matched: false, key: null, reason: 'no JSON returned' }
    }
    parsed = JSON.parse(match[0])
  }

  return {
    matched: parsed?.matched === true,
    key: typeof parsed?.key === 'string' && parsed.key.trim() ? parsed.key.trim() : null,
    reason: typeof parsed?.reason === 'string' ? parsed.reason : 'semantic match decision'
  }
}

function parseSemanticInputGroupMatch(content: string): {
  matched: boolean
  groupKey: string | null
  reason: string
} {
  let parsed: any
  try {
    parsed = JSON.parse(content)
  } catch {
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) {
      return { matched: false, groupKey: null, reason: 'no JSON returned' }
    }
    parsed = JSON.parse(match[0])
  }

  return {
    matched: parsed?.matched === true,
    groupKey: typeof parsed?.groupKey === 'string' && parsed.groupKey.trim()
      ? cleanTaskInputKey(parsed.groupKey) ?? null
      : null,
    reason: typeof parsed?.reason === 'string' ? parsed.reason : 'semantic group match decision'
  }
}

function normalizeTaskInputRequestIdentity(request: TaskUserInputRequest): {
  key: string
  groupKey: string
  groupLabel: string
  itemKey: string
  itemLabel: string
} {
  const groupKey = cleanTaskInputKey(request.groupKey)
  const itemKey = cleanTaskInputKey(request.itemKey)
  if (!groupKey || !itemKey) {
    throw new Error('Persistent user input requires groupKey and itemKey')
  }
  return {
    key: `${groupKey}.${itemKey}`,
    groupKey,
    groupLabel: cleanTaskInputLabel(request.groupLabel) || formatTaskInputLabel(groupKey),
    itemKey,
    itemLabel: cleanTaskInputLabel(request.itemLabel) || formatTaskInputLabel(itemKey),
  }
}

function cleanTaskInputKey(value: unknown): string | undefined {
  const key = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .replace(/^[_:.-]+|[_:.-]+$/g, '')
  return key || undefined
}

function cleanTaskInputLabel(value: unknown): string | undefined {
  const label = String(value ?? '').trim().replace(/\s+/g, ' ')
  return label || undefined
}

function formatTaskInputLabel(key: string): string {
  return key
    .split(/[_.:-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Global'
}

async function initializeSDK(): Promise<void> {
  setActiveLLMConfig(getActiveLLMConfig())
  setActiveTaskLLMConfig(getActiveTaskConfig())
  setActiveTaskRuntimeConfig(appSettings.system.taskRuntime)
  const sdkConfig = await buildSDKConfig()
  const pluginsDir = resolveRuntimePluginsDir()
  console.log('[PluginLoader] Runtime plugins directory:', pluginsDir)
  const plugins = await loadRuntimePlugins(pluginsDir, appSettings.plugins, appSettings.pluginConfigs)
  sdkInstance = await HerTextSDK.initialize(sdkConfig, {
    plugins,
    onTaskUserInputRequest: requestTaskUserInput,
    onTaskPlanUpdated: (plan) => {
      currentTaskPlanFrameSender?.(plan)
    },
  })
  console.log('[SDK] Initialized successfully')
}

async function rebuildSDK(): Promise<void> {
  if (sdkInstance) {
    await sdkInstance.shutdown()
  }
  await initializeSDK()
}

async function applyRuntimeSystemConfigChanges(
  previous: {
    llm: string
    taskLLM: string
    taskRuntime: string
    tts: string
    asr: string
  },
  options: {
    pluginsChanged?: boolean
  } = {}
): Promise<void> {
  const nextLLMSignature = getLLMConfigSignature(getActiveLLMConfig())
  const nextTaskLLMSignature = getLLMConfigSignature(getActiveTaskConfig())
  const nextTaskRuntimeSignature = JSON.stringify(appSettings.system.taskRuntime)
  const nextTTSSignature = getTTSConfigSignature(getActiveTTSConfig())
  const nextASRSignature = getASRConfigSignature(getActiveASRConfig())
  const llmChanged =
    previous.llm !== nextLLMSignature ||
    previous.taskLLM !== nextTaskLLMSignature ||
    previous.taskRuntime !== nextTaskRuntimeSignature

  if (
    previous.tts !== nextTTSSignature ||
    (ttsService && activeTTSSignature !== nextTTSSignature)
  ) {
    await switchTTSProvider('provider_switch')
  }

  if (
    streamingASRSession &&
    (previous.asr !== nextASRSignature || activeASRSignature !== nextASRSignature)
  ) {
    await cancelCurrentTurn({ closeTTS: true, reason: 'provider_switch' })
    await streamingASRSession.switchProvider('provider_switch')
  }

  if (options.pluginsChanged || llmChanged) {
    await rebuildSDK()
  }
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

  await initializePersonalityManager()
  console.log('[App] Personality manager initialized')

  interactiveInputStore = new InteractiveInputStore(getStorageDir())
  await interactiveInputStore.initialize()
  console.log('[InteractiveInput] Store initialized')

  if (appSettings.selectedPersonality && appSettings.selectedPersonality !== 'role:eva') {
    try {
      await getPersonalityManager().setCurrentPersonality(appSettings.selectedPersonality)
    } catch (error) {
      console.warn('[App] Failed to restore selected personality:', error)
      appSettings = await getSettingsStore().update({ selectedPersonality: 'role:eva' })
    }
  }

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

  app.exit(0)
})

// ========== IPC Handlers ==========

ipcMain.on('window:move', (event, deltaX, deltaY) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    const [x, y] = win.getPosition()
    win.setPosition(x + deltaX, y + deltaY)
  }
})

ipcMain.on('window:set-compact-mode', (event, compact) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) {
    return
  }

  const size = compact ? COMPACT_WINDOW_SIZE : SETTINGS_WINDOW_SIZE
  resizeWindowAroundCenter(win, size.width, size.height)
})

ipcMain.on('window:set-task-mode', (event, active) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) {
    return
  }

  const size = active ? TASK_WINDOW_SIZE : COMPACT_WINDOW_SIZE
  resizeWindowAroundCenter(win, size.width, size.height)
})

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
    const sdk = sdkInstance

    if (!text.trim()) {
      return { success: true, response: '', ttsEnabled: false }
    }

    turnId = await startNewTurn()
    const turnAbortSignal = currentTurnAbortController!.signal

    mainWindow?.webContents.send('turn:start', turnId)

    const displayController = new ConversationDisplayController(
      (nextText) => {
        if (isTurnCancelled(turnId)) return
        mainWindow?.webContents.send('conversation:response', nextText)
      },
      (frame) => {
        if (isTurnCancelled(turnId)) return
        mainWindow?.webContents.send('conversation:frame', frame)
      }
    )
    const taskPlanFrameSender = (plan: TaskPlan) => {
      if (isTurnCancelled(turnId)) return
      mainWindow?.webContents.send('conversation:frame', {
        type: 'control.task_plan',
        plan,
      } satisfies ConversationFrame)
    }
    currentTaskPlanFrameSender = taskPlanFrameSender
    displayController.reset()
    currentTTSChunkSequence = 0
    const interruptedTTSTextChunks: string[] = []

    const responseLaneName = `response:${turnId}`
    responseFramePipeline = voiceGraphPipeline.createResponseLane(responseLaneName)
    responseFramePipeline.addObserver(latencyObserver)
    responseFramePipeline.addObserver(frameTraceObserver)
    currentResponseFramePipeline = responseFramePipeline

    let isFirstTTSChunk = true
    let pendingExpressionFrame: ExpressionFrame | null = null
    let expressionShown = false

    const showPendingExpression = () => {
      if (expressionShown || !pendingExpressionFrame || isTurnCancelled(turnId)) {
        return
      }

      expressionShown = true
      console.log('[Expression] Showing sticker:', pendingExpressionFrame)
      displayController.showExpression(pendingExpressionFrame)
    }

    let shouldUseTTS = enableTTS && appSettings.voiceOutputEnabled && Boolean(ttsService) && ttsAvailable
    const pluginContext = getPluginRuntimeContext(shouldUseTTS)

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
      preserveUserInputOnAbort: source === 'voice',
      getInterruptedAssistantText: () => interruptedTTSTextChunks.join(''),
      pluginContext,
      queueFrame: (frame) => {
        void responseFramePipeline?.queueFrame(frame)
      },
      waitForIdle: () => Promise.resolve(),
      onExpression: async (frame) => {
        if (isTurnCancelled(turnId)) return
        pendingExpressionFrame = frame
        if (!shouldUseTTS) {
          showPendingExpression()
        }
      },
      log: (message) => console.log(message),
    })

    // The LLM/task runner produces response frames outside this lane. Keeping
    // this lane consumer-only lets reply TTS continue while tools run.
    responseFramePipeline.setProcessors([
      new ResponseTTSProcessor({
        isCancelled: () => isTurnCancelled(turnId),
        isEnabled: () => shouldUseTTS && ttsAvailable,
        getService: () => ttsService,
        sanitizeText: sanitizeTextForSpeech,
        transformTTSInput: (text) => sdk.transformText('tts_input', text, pluginContext),
        toDisplayText: (text) => sdk.transformText('display', text, pluginContext),
        onFirstText: () => {
          if (isFirstTTSChunk) {
            isFirstTTSChunk = false
            latencyObserver.markFirstTTSText()
            showPendingExpression()
          }
        },
        onText: (textFrame, displayText) => {
          currentTTSChunkSequence += 1
          interruptedTTSTextChunks.push(displayText)
          console.log(`[Main] TTS text frame #${turnId}:${currentTTSChunkSequence}, pushing:`, JSON.stringify(textFrame))
          displayController.pushTTSChunkText(displayText)
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

    const fullResponse = sdk.transformText(
      'display',
      await llmResponseProcessor.processUserText(text),
      pluginContext
    )
    await responseFramePipeline.waitForIdle()

    if (!isTurnCancelled(turnId)) {
      await streamingASRSession?.endBotTurn()
    }

    completeCurrentTurn(turnId, responseFramePipeline)
    if (currentTaskPlanFrameSender === taskPlanFrameSender) {
      currentTaskPlanFrameSender = null
    }
    voiceGraphPipeline.removeLane(responseLaneName)

    return { success: true, response: fullResponse, ttsEnabled: shouldUseTTS }
  } catch (error: any) {
    if (currentResponseFramePipeline === responseFramePipeline) {
      currentResponseFramePipeline?.stop()
      currentResponseFramePipeline = null
    }
    currentTaskPlanFrameSender = null
    if (turnId > 0) {
      voiceGraphPipeline.removeLane(`response:${turnId}`)
    }
    await streamingASRSession?.endBotTurn().catch(() => undefined)
    console.error(`[Chat] Failed to process ${source} turn:`, error)
    return { success: false, error: error.message }
  }
}

ipcMain.handle('conversation:sendText', async (_, text, enableTTS) => {
  return runConversationTurn(text, enableTTS, 'text')
})

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

ipcMain.handle('conversation:clearHistory', async () => {
  try {
    if (sdkInstance) {
      await sdkInstance.memory.clearAll()
      sdkInstance.clearHistory()
    }
    await interactiveInputStore?.clear()
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
        mainWindow?.webContents.send('speech:transcript', text)
      },
      onUserText: async (text) => {
        await runConversationTurn(text, appSettings.voiceOutputEnabled, 'voice')
      },
      onStateChange: (state) => {
        mainWindow?.webContents.send('speech:state', state)
      },
      onSpeechStart: () => {
        mainWindow?.webContents.send('speech:user-speaking')
      },
      onInterruption: (reason) => {
        console.log(`[Speech] Interruption detected, cancelling turn, reason=${reason}`)

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


ipcMain.handle('memory:getUserProfile', async () => {
  if (!sdkInstance) return { success: false, error: 'SDK not initialized' }

  try {
    const profile = sdkInstance.memory.getUserProfile()
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

ipcMain.handle('memory:listAccountInputs', async () => {
  if (!interactiveInputStore) return { success: false, error: 'Interactive input store not initialized' }

  try {
    const inputs = await interactiveInputStore.list()
    return { success: true, inputs }
  } catch (error: any) {
    console.error('[Memory] Failed to list account inputs:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('memory:deleteAccountInput', async (_, key: string) => {
  if (!interactiveInputStore) return { success: false, error: 'Interactive input store not initialized' }

  try {
    await interactiveInputStore.delete(key)
    return { success: true }
  } catch (error: any) {
    console.error('[Memory] Failed to delete account input:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('memory:clearAccountInputs', async () => {
  if (!interactiveInputStore) return { success: false, error: 'Interactive input store not initialized' }

  try {
    await interactiveInputStore.clear()
    return { success: true }
  } catch (error: any) {
    console.error('[Memory] Failed to clear account inputs:', error)
    return { success: false, error: error.message }
  }
})

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
  const previous = {
    llm: getLLMConfigSignature(getActiveLLMConfig()),
    taskLLM: getLLMConfigSignature(getActiveTaskConfig()),
    taskRuntime: JSON.stringify(appSettings.system.taskRuntime),
    tts: getTTSConfigSignature(getActiveTTSConfig()),
    asr: getASRConfigSignature(getActiveASRConfig()),
  }
  const previousPlugins = appSettings.plugins
  const previousPluginConfigs = appSettings.pluginConfigs
  appSettings = await getSettingsStore().update(partial)
  const pluginsChanged =
    (partial.plugins !== undefined && previousPlugins !== appSettings.plugins) ||
    (partial.pluginConfigs !== undefined && previousPluginConfigs !== appSettings.pluginConfigs)

  await applyRuntimeSystemConfigChanges(previous, { pluginsChanged })

  return appSettings
})

ipcMain.handle('plugins:list', async () => {
  try {
    return {
      success: true,
      plugins: await discoverRuntimePlugins(
        resolveRuntimePluginsDir(),
        appSettings.plugins,
        appSettings.pluginConfigs
      ),
    }
  } catch (error: any) {
    return { success: false, error: error.message, plugins: [] }
  }
})

ipcMain.handle('plugins:adminAction', async (_event, pluginId: string, action: string, payload: unknown) => {
  return invokeRuntimePluginAdminAction(
    resolveRuntimePluginsDir(),
    pluginId,
    action,
    payload,
    appSettings.pluginConfigs
  )
})

ipcMain.handle('settings:resetSystemFromEnv', async () => {
  try {
    const previous = {
      llm: getLLMConfigSignature(getActiveLLMConfig()),
      taskLLM: getLLMConfigSignature(getActiveTaskConfig()),
      taskRuntime: JSON.stringify(appSettings.system.taskRuntime),
      tts: getTTSConfigSignature(getActiveTTSConfig()),
      asr: getASRConfigSignature(getActiveASRConfig()),
    }
    appSettings = await getSettingsStore().reloadSystemConfigFromEnv()
    await applyRuntimeSystemConfigChanges(previous)
    return { success: true, settings: appSettings }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('models:localStatus', async () => {
  try {
    return {
      success: true,
      models: await getLocalModelStatuses(),
    }
  } catch (error: any) {
    return { success: false, error: error.message, models: [] }
  }
})

ipcMain.handle('models:downloadMissing', async () => {
  try {
    return {
      success: true,
      models: await downloadMissingLocalModels(),
    }
  } catch (error: any) {
    return { success: false, error: error.message, models: [] }
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
