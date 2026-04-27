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

console.log('[Env] LLM_API_KEY:', process.env.LLM_API_KEY ? '✓ (set)' : '✗ (not set)')
console.log('[Env] LLM_MODEL:', process.env.LLM_MODEL || '✗ (not set)')
console.log('[Env] LLM_BASE_URL:', process.env.LLM_BASE_URL || '✗ (not set)')

import { app, BrowserWindow, ipcMain, systemPreferences, shell } from 'electron'
import {
  HerTextSDK,
  FishTTSOfficial,
  QwenRealtimeASR,
  createVADAnalyzer,
  TurnController,
  VADState,
  InterruptionHandler,
  type VADParams,
  type EndpointingConfig,
  type TurnControllerEvents,
} from '@her-text/sdk'
import {
  initializePersonalityManager,
  getPersonalityManager,
  buildSDKConfig
} from './sdk-config.js'
import { SettingsStore, type AppSettings } from './settings-store.js'
import { NodeRealtimeWebSocketTransport } from './qwen-websocket-transport.js'
const DEV_SERVER_URL = 'http://127.0.0.1:5173'

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
 * VAD 配置 (移植自 Pipecat)
 * 使用新的 4 状态机 VAD 分析器
 */
const DEFAULT_VAD_CONFIG: Partial<VADParams> = {
  confidence: 0.7,      // 语音置信度阈值
  startSecs: 0.2,       // 200ms 确认开始说话
  stopSecs: 0.2,        // 200ms 确认停止说话
  minVolume: 0.02,      // 最小音量阈值 (针对 RMS VAD 调整)
  sampleRate: 16000,
}

/**
 * Endpointing 配置 (移植自 Pipecat)
 * 双计时器策略
 */
const DEFAULT_ENDPOINTING_CONFIG: Partial<EndpointingConfig> = {
  userSpeechTimeout: 600,   // 600ms 给用户继续说话的窗口
  sttTimeoutMs: 800,        // STT P99 延迟
  userTurnStopTimeout: 5000, // 5s 总超时
}

/**
 * 流式 ASR 会话
 *
 * 集成了 Pipecat 风格的：
 * - 4 状态机 VAD (QUIET → STARTING → SPEAKING → STOPPING)
 * - 双计时器 Endpointing
 * - 轮次管理 (TurnController)
 * - 打断处理 (InterruptionManager)
 */
class StreamingASRSession {
  private asr: QwenRealtimeASR | null = null
  private turnController: TurnController | null = null
  private appendChain: Promise<void> = Promise.resolve()
  private commitInFlight = false

  // 回调
  private onTranscript: ((text: string) => void) | null = null
  private onStateChange: ((state: 'listening' | 'processing' | 'idle') => void) | null = null
  private onSpeechStart: (() => void) | null = null
  private onInterruption: (() => void) | null = null

  // 调试模式
  private debug = true

  async start(callbacks?: {
    onTranscript?: (text: string) => void
    onStateChange?: (state: 'listening' | 'processing' | 'idle') => void
    onSpeechStart?: () => void
    onInterruption?: () => void
  }): Promise<void> {
    await this.stop()

    this.onTranscript = callbacks?.onTranscript || null
    this.onStateChange = callbacks?.onStateChange || null
    this.onSpeechStart = callbacks?.onSpeechStart || null
    this.onInterruption = callbacks?.onInterruption || null

    const apiKey = process.env.QWEN_API_KEY?.trim()
    if (!apiKey) {
      throw new Error('QWEN_API_KEY is not configured')
    }

    // 初始化 ASR
    this.asr = new QwenRealtimeASR(
      {
        apiKey,
        sampleRate: 16000,
        language: 'zh',
      },
      new NodeRealtimeWebSocketTransport()
    )
    await this.asr.connect()

    // 初始化 VAD 分析器 (Pipecat 风格 4 状态机)
    const vadAnalyzer = createVADAnalyzer(DEFAULT_VAD_CONFIG)

    // 初始化轮次控制器
    this.turnController = new TurnController(vadAnalyzer, {
      endpointing: DEFAULT_ENDPOINTING_CONFIG,
      enableInterruption: true,
      debug: this.debug,
    })

    // 设置轮次控制器事件
    const events: TurnControllerEvents = {
      onUserTurnStart: () => {
        this.log('User turn started')
        this.onSpeechStart?.()
      },

      onUserTurnEnd: async (params) => {
        this.log(`User turn ended, text: ${params.text?.slice(0, 50)}...`)

        if (!this.asr || this.commitInFlight) return

        this.commitInFlight = true
        this.onStateChange?.('processing')

        try {
          // 提交 ASR 获取最终转录
          const text = await this.asr.commit()
          const finalText = text?.trim() || params.text?.trim()

          if (finalText) {
            this.log(`Transcript: ${finalText}`)
            this.onTranscript?.(finalText)
          }
        } catch (error) {
          this.log(`Commit error: ${error}`)
          // 如果 ASR 提交失败，使用 endpointing 累积的文本
          if (params.text?.trim()) {
            this.onTranscript?.(params.text.trim())
          }
        } finally {
          this.commitInFlight = false
          if (this.asr) {
            this.onStateChange?.('listening')
          }
        }
      },

      onInterruption: () => {
        this.log('Interruption detected!')
        this.onInterruption?.()
      },

      onUserTurnTimeout: () => {
        this.log('User turn timeout')
      },
    }

    this.turnController.setEvents(events)

    this.appendChain = Promise.resolve()
    this.commitInFlight = false
    this.onStateChange?.('listening')

    this.log('StreamingASRSession started with Pipecat-style VAD')
  }

  /**
   * 注册打断处理器
   * 允许外部组件（如 TTS）响应打断事件
   */
  registerInterruptionHandler(handler: InterruptionHandler): void {
    this.turnController?.getInterruptionManager().register(handler)
  }

  /**
   * 注销打断处理器
   */
  unregisterInterruptionHandler(handler: InterruptionHandler): void {
    this.turnController?.getInterruptionManager().unregister(handler)
  }

  /**
   * 开始机器人轮次
   * 在开始生成回复时调用
   */
  async startBotTurn(): Promise<void> {
    await this.turnController?.startBotTurn()
  }

  /**
   * 结束机器人轮次
   * 在回复完成后调用
   */
  async endBotTurn(): Promise<void> {
    await this.turnController?.endBotTurn()
  }

  /**
   * 追加音频数据
   */
  append(samples: number[] | Int16Array): Promise<void> {
    const normalized = samples instanceof Int16Array
      ? samples
      : Int16Array.from(samples)

    // 使用轮次控制器处理音频（包含 VAD 分析）
    if (this.turnController) {
      // 异步处理 VAD，不阻塞音频流
      this.turnController.processAudio(normalized).catch((error) => {
        this.log(`VAD error: ${error}`)
      })
    }

    // 发送音频到 ASR
    this.appendChain = this.appendChain.then(async () => {
      if (!this.asr) return
      await this.asr.appendAudio(normalized)
    }).catch((error: Error) => {
      // 忽略停止时的预期错误
      if (error.message === 'WebSocket connection aborted' ||
          error.message === 'Qwen STT WebSocket closed') {
        return
      }
      throw error
    })

    return this.appendChain
  }

  /**
   * 处理转录结果
   * 当收到 ASR 的中间或最终结果时调用
   */
  processTranscription(text: string, finalized: boolean): void {
    if (!this.turnController) return

    this.turnController.processTranscription({
      text,
      finalized,
      timestamp: Date.now(),
    })
  }

  /**
   * 手动提交（用于按钮触发等场景）
   */
  async commit(): Promise<string> {
    if (!this.asr) {
      throw new Error('ASR stream is not started')
    }

    this.commitInFlight = true
    this.onStateChange?.('processing')

    try {
      const text = await this.asr.commit()

      // 强制结束用户轮次
      await this.turnController?.forceEndUserTurn()

      return text
    } finally {
      this.commitInFlight = false
      if (this.asr) {
        this.onStateChange?.('listening')
      }
    }
  }

  /**
   * 停止会话
   */
  async stop(): Promise<void> {
    this.onStateChange?.('idle')
    this.onTranscript = null
    this.onStateChange = null
    this.onSpeechStart = null
    this.onInterruption = null

    // 清理轮次控制器
    if (this.turnController) {
      this.turnController.cleanup()
      this.turnController = null
    }

    if (!this.asr) {
      this.appendChain = Promise.resolve()
      return
    }

    const current = this.asr
    this.asr = null
    this.appendChain = Promise.resolve()

    await current.close().catch((error: Error) => {
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

let currentTTSChunkSequence = 0

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
let ttsService: FishTTSOfficial | null = null
let sdkInstance: HerTextSDK | null = null
let ttsAvailable = true
let settingsStore: SettingsStore | null = null
let streamingASRSession: StreamingASRSession | null = null
let appSettings: AppSettings = {
  voiceInputEnabled: true,
  voiceOutputEnabled: true,
  volume: 70,
  selectedPersonality: 'eva'
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

  if (appSettings.selectedPersonality && appSettings.selectedPersonality !== 'eva') {
    try {
      await getPersonalityManager().setCurrentPersonality(appSettings.selectedPersonality)
    } catch (error) {
      console.warn('[App] Failed to restore selected personality:', error)
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

    // 初始化 TTS（使用 SDK）
    if (process.env.FISH_API_KEY?.trim()) {
      ttsService = new FishTTSOfficial({
        apiKey: process.env.FISH_API_KEY,
        voiceId: process.env.FISH_VOICE_ID,
        model: process.env.FISH_MODEL || 's2-pro',
        format: 'pcm',
        sampleRate: 16000,
        latency: 'balanced'
      })

      ttsAvailable = true

      // 设置 TTS 事件处理
      ttsService.setEventHandler((event) => {
        switch (event.type) {
          case 'connected':
            console.log('[TTS] Connected event')
            mainWindow?.webContents.send('tts:connected')
            break
          case 'audio':
            console.log('[TTS] Audio chunk received:', event.audio.length, 'bytes')
            mainWindow?.webContents.send('tts:audio', event.audio)
            break
          case 'closed':
            console.log('[TTS] Closed event')
            mainWindow?.webContents.send('tts:closed')
            break
          case 'error':
            console.log('[TTS] Error event:', event.error.message)
            ttsAvailable = false
            mainWindow?.webContents.send('tts:error', event.error.message)
            break
        }
      })

      console.log('[TTS] Initialized successfully (using SDK)')
    } else {
      ttsService = null
      ttsAvailable = false
      console.log('[TTS] Disabled: missing Fish Audio API key')
    }

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

// 发送文本消息
ipcMain.handle('conversation:sendText', async (_, text, enableTTS) => {
  try {
    if (!sdkInstance) {
      throw new Error('SDK not initialized')
    }

    const displayController = new ConversationDisplayController(
      (nextText) => mainWindow?.webContents.send('conversation:response', nextText),
      (frame) => mainWindow?.webContents.send('conversation:frame', frame)
    )
    displayController.reset()
    currentTTSChunkSequence = 0

    let shouldUseTTS = enableTTS && appSettings.voiceOutputEnabled && Boolean(ttsService) && ttsAvailable

    // 使用 SDK 的 chatStream，TTS 分句逻辑由 SDK 处理
    const responseStream = sdkInstance.chatStream(
      {
        text,
        timestamp: Date.now()
      },
      {
        onPhaseStart: async (phase) => {
          displayController.startPhase(phase)

          if (!shouldUseTTS || !ttsService) {
            return
          }

          try {
            await ttsService.startStreaming()
          } catch (error: any) {
            console.warn('[TTS] Failed to start streaming:', error.message)
            console.warn('[TTS] Continuing without TTS...')
            ttsAvailable = false
            shouldUseTTS = false
            await ttsService.close().catch(() => undefined)
          }
        },
        onDisplayChunk: async (_, delta) => {
          if (!shouldUseTTS) {
            displayController.pushTextDelta(delta)
          }
        },
        onTTSChunk: async (chunk) => {
          if (!shouldUseTTS || !ttsAvailable || !ttsService) {
            return
          }

          try {
            currentTTSChunkSequence += 1
            console.log(`[Main] onTTSChunk #${currentTTSChunkSequence}, pushing:`, JSON.stringify(chunk))
            displayController.pushTTSChunkText(chunk)
            await ttsService.pushText(chunk)
          } catch (error: any) {
            ttsAvailable = false
            shouldUseTTS = false
            console.warn('[TTS] Failed to push chunk:', error.message)
          }
        },
        onPhaseEnd: async (phase) => {
          console.log(`[Conversation] Phase "${phase}" ending...`)

          if (shouldUseTTS && ttsService) {
            try {
              await ttsService.finishStreaming()
            } catch (error: any) {
              ttsAvailable = false
              shouldUseTTS = false
              console.warn('[TTS] Failed to finish streaming:', error.message)
            }

            // 等待 Renderer 端的音频播放完成
            // 这是关键的同步点，确保 Phase 1 的音频播放完毕再开始 Phase 2
            console.log(`[Conversation] Waiting for playback to complete before ending phase "${phase}"...`)
            await waitForRendererPlayback()
            console.log(`[Conversation] Playback complete for phase "${phase}"`)
          }

          await displayController.endPhase(phase)
        },
        onTaskStart: async (taskDescription) => {
          displayController.startTask(taskDescription)
        },
        onTaskEnd: async (result) => {
          displayController.endTask(result)
        }
      }
    )

    let fullResponse = ''
    for await (const chunk of responseStream) {
      fullResponse += chunk
    }

    return { success: true, response: fullResponse, ttsEnabled: shouldUseTTS }
  } catch (error: any) {
    console.error('[Chat] Failed to send text:', error)
    return { success: false, error: error.message }
  }
})

// 停止 TTS
ipcMain.handle('tts:stop', async () => {
  try {
    await ttsService?.close()
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
    const apiKey = process.env.QWEN_API_KEY?.trim()
    if (!apiKey) {
      throw new Error('QWEN_API_KEY is not configured')
    }

    const transport = new NodeRealtimeWebSocketTransport()
    const asr = new QwenRealtimeASR(
      {
        apiKey,
        sampleRate: 16000,
        language: 'zh',
      },
      transport
    )

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
        // VAD + Endpointing 检测到语音结束，发送转录文本到 Renderer
        // Renderer 会通过 sendText IPC 发送消息
        mainWindow?.webContents.send('speech:transcript', text)
      },
      onStateChange: (state) => {
        mainWindow?.webContents.send('speech:state', state)
      },
      onSpeechStart: () => {
        // 用户开始说话，通知 Renderer
        mainWindow?.webContents.send('speech:user-speaking')
      },
      onInterruption: () => {
        // 打断发生（用户在机器人说话时说话）
        console.log('[Speech] Interruption detected, stopping TTS')
        mainWindow?.webContents.send('speech:interruption')

        // 停止 TTS 流
        if (ttsService) {
          ttsService.close().catch(() => undefined)
        }
      }
    })

    // 注册 TTS 作为打断处理器
    if (ttsService) {
      streamingASRSession.registerInterruptionHandler({
        async onInterruption() {
          console.log('[TTS] Handling interruption, closing stream')
          await ttsService?.close().catch(() => undefined)
        }
      })
    }

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

ipcMain.handle('speech:stream:commit', async () => {
  try {
    if (!streamingASRSession) {
      throw new Error('ASR stream is not started')
    }

    const text = await streamingASRSession.commit()
    return { success: true, text }
  } catch (error: any) {
    console.error('[Speech] Failed to commit streaming audio:', error)
    return { success: false, error: error.message }
  }
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
    profile.importantMemories.forEach((value, key) => {
      importantMemories[key] = value
    })

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
  appSettings = await getSettingsStore().update(partial)
  return appSettings
})

ipcMain.handle('personality:list', async () => {
  try {
    const personalityManager = getPersonalityManager()
    return {
      success: true,
      current: appSettings.selectedPersonality,
      items: await personalityManager.listPersonalities()
    }
  } catch (error: any) {
    return { success: false, error: error.message, items: [] }
  }
})

ipcMain.handle('personality:set', async (_, name: string) => {
  try {
    const personalityManager = getPersonalityManager()
    await personalityManager.setCurrentPersonality(name)
    appSettings = await getSettingsStore().update({ selectedPersonality: name })
    await rebuildSDK()
    return { success: true, current: name }
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
