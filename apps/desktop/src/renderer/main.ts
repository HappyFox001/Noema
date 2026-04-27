import './styles.css'

// ========== Audio Player ==========

class AudioPlayer {
  private audioContext: AudioContext | null = null
  private gainNode: GainNode | null = null
  private isPlaying = false
  private audioQueue: AudioBuffer[] = []
  private nextStartTime = 0
  private onChunkScheduled?: (payload: { startTime: number; duration: number }) => void

  // 播放完成同步机制
  private playbackCompleteResolvers: (() => void)[] = []
  private currentSource: AudioBufferSourceNode | null = null

  async initialize(): Promise<void> {
    this.audioContext = new AudioContext({ sampleRate: 16000 })
    this.gainNode = this.audioContext.createGain()
    this.gainNode.connect(this.audioContext.destination)
    console.log('[AudioPlayer] Initialized')
  }

  setChunkScheduledHandler(
    handler: (payload: { startTime: number; duration: number }) => void
  ): void {
    this.onChunkScheduled = handler
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
    if (!this.isPlaying && this.audioQueue.length === 0) {
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
    if (!this.isPlaying && this.audioQueue.length === 0) {
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
      channelData[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7fff)
    }

    return audioBuffer
  }

  private playBuffer(buffer: AudioBuffer): void {
    if (!this.audioContext) return

    const source = this.audioContext.createBufferSource()
    source.buffer = buffer
    source.connect(this.gainNode ?? this.audioContext.destination)
    this.currentSource = source

    const currentTime = this.audioContext.currentTime
    const startTime = Math.max(currentTime, this.nextStartTime)

    source.start(startTime)
    this.nextStartTime = startTime + buffer.duration
    this.onChunkScheduled?.({ startTime, duration: buffer.duration })

    source.onended = () => {
      this.currentSource = null
      if (this.audioQueue.length > 0) {
        const nextBuffer = this.audioQueue.shift()!
        this.playBuffer(nextBuffer)
      } else {
        this.isPlaying = false
        this.notifyPlaybackComplete()
      }
    }
  }

  async addAudioChunk(pcm16Bytes: Uint8Array): Promise<void> {
    try {
      console.log('[AudioPlayer] Adding chunk:', pcm16Bytes.byteLength, 'bytes, context state:', this.audioContext?.state)

      if (this.audioContext?.state === 'suspended') {
        console.log('[AudioPlayer] Resuming suspended context')
        await this.audioContext.resume()
      }

      const audioBuffer = this.pcm16ToAudioBuffer(pcm16Bytes)
      console.log('[AudioPlayer] Created buffer:', audioBuffer.duration.toFixed(2), 'seconds')

      if (this.isPlaying) {
        this.audioQueue.push(audioBuffer)
        console.log('[AudioPlayer] Queued, queue size:', this.audioQueue.length)
      } else {
        this.isPlaying = true
        this.nextStartTime = this.audioContext!.currentTime
        console.log('[AudioPlayer] Starting playback')
        this.playBuffer(audioBuffer)
      }
    } catch (error) {
      console.error('[AudioPlayer] Failed to add audio chunk:', error)
    }
  }

  stop(): void {
    console.log('[AudioPlayer] Stopping playback')

    // 停止当前播放的音频
    if (this.currentSource) {
      try {
        this.currentSource.stop()
      } catch (e) {
        // 忽略已停止的错误
      }
      this.currentSource = null
    }

    this.audioQueue = []
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

// VoiceRecorder: 只负责采集和转发，不做任何处理
// 所有处理（降采样）在 AudioWorklet 线程完成
// VAD 和 ASR 在 Main Process 完成
class VoiceRecorder {
  private context: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private workletNode: AudioWorkletNode | null = null
  private recording = false

  async start(): Promise<void> {
    if (this.recording) return

    console.log('[VoiceRecorder] Starting...')
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

    this.source = this.context.createMediaStreamSource(this.stream)
    this.workletNode = new AudioWorkletNode(this.context, 'audio-chunk-processor')

    // 直接转发 Int16 音频到 Main Process，不在主线程做任何处理
    this.workletNode.port.onmessage = (event) => {
      if (!this.recording) return
      const { samples } = event.data
      if (samples) {
        // 直接发送到 Main Process，VAD 在那边处理
        window.electronAPI.appendSpeechStream(samples)
      }
    }

    this.source.connect(this.workletNode)
    this.workletNode.connect(this.context.destination)
    this.recording = true
    console.log('[VoiceRecorder] Started')
  }

  async stop(): Promise<void> {
    this.recording = false
    this.workletNode?.disconnect()
    this.source?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    await this.context?.close()
    this.workletNode = null
    this.source = null
    this.stream = null
    this.context = null
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

type UISettings = {
  voiceInputEnabled: boolean
  voiceOutputEnabled: boolean
  volume: number
  selectedPersonality: string
}

type ConversationFrame =
  | { type: 'system.reset' }
  | { type: 'control.phase_start'; phase: 'reply' | 'task' | 'task_result' }
  | { type: 'control.phase_end'; phase: 'reply' | 'task' | 'task_result' }
  | { type: 'control.task_start'; taskDescription: string }
  | { type: 'control.task_end'; success: boolean; summary: string; error?: string }
  | { type: 'data.tts_text'; text: string }

const voiceRecorder = new VoiceRecorder()

// Canvas rendering
const canvas = document.getElementById('orb-canvas') as HTMLCanvasElement
const ctx = canvas.getContext('2d', { alpha: true })!

interface OrbState {
  mode: 'idle' | 'thinking' | 'speaking'
  glow: number
  breatheRate: number
}

let orbState: OrbState = {
  mode: 'idle',
  glow: 4,
  breatheRate: 1.2
}
let orbAnimationFrameId: number | null = null
let orbAnimationPaused = false

// Store current radius for mouse detection
let currentOrbRadius = 22

function drawOrb() {
  if (orbAnimationPaused) {
    orbAnimationFrameId = null
    return
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const centerX = canvas.width / 2
  const centerY = canvas.height / 2
  const time = Date.now() / 1000
  const breathe = Math.sin(time * orbState.breatheRate) * 1.8
  const currentRadius = 22 + breathe
  currentOrbRadius = currentRadius // Update for mouse detection

  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
  ctx.shadowBlur = 14 + orbState.glow * 0.7
  ctx.shadowOffsetY = 3

  const coreGradient = ctx.createRadialGradient(
    centerX - currentRadius * 0.38,
    centerY - currentRadius * 0.45,
    0,
    centerX + currentRadius * 0.18,
    centerY + currentRadius * 0.25,
    currentRadius * 1.15
  )
  coreGradient.addColorStop(0, 'rgba(88, 88, 88, 1)')
  coreGradient.addColorStop(0.32, 'rgba(25, 25, 25, 1)')
  coreGradient.addColorStop(0.72, 'rgba(6, 6, 6, 1)')
  coreGradient.addColorStop(1, 'rgba(0, 0, 0, 1)')

  ctx.fillStyle = coreGradient
  ctx.beginPath()
  ctx.arc(centerX, centerY, currentRadius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  const highlight = ctx.createRadialGradient(
    centerX - currentRadius * 0.34,
    centerY - currentRadius * 0.46,
    0,
    centerX - currentRadius * 0.34,
    centerY - currentRadius * 0.46,
    currentRadius * 0.42
  )
  highlight.addColorStop(0, 'rgba(255, 255, 255, 0.58)')
  highlight.addColorStop(0.42, 'rgba(255, 255, 255, 0.18)')
  highlight.addColorStop(1, 'rgba(255, 255, 255, 0)')

  ctx.fillStyle = highlight
  ctx.beginPath()
  ctx.arc(centerX, centerY, currentRadius, 0, Math.PI * 2)
  ctx.fill()

  orbAnimationFrameId = requestAnimationFrame(drawOrb)
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

function setOrbMode(mode: 'idle' | 'thinking' | 'speaking') {
  orbState.mode = mode
  switch (mode) {
    case 'thinking':
      orbState.glow = 11
      orbState.breatheRate = 2.1
      break
    case 'speaking':
      orbState.glow = 9
      orbState.breatheRate = 1.45
      break
    default:
      orbState.glow = 4
      orbState.breatheRate = 1.2
  }
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

function handleConversationFrame(frame: ConversationFrame) {
  switch (frame.type) {
    case 'system.reset':
      textRevealer.reset()
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
      setOrbMode('speaking')
      break
    case 'control.phase_end':
      // reply 阶段结束后，如果紧接着有任务，会收到 task_start
      // 如果没有任务，这就是最终状态，应该变成 idle
      // task_result 阶段结束后，一定是最终状态
      if (frame.phase === 'reply' || frame.phase === 'task_result') {
        setStatus(getReadyStatus())
        setOrbMode('idle')
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

    await loadSettings()
    await loadPersonalities()

    startConversationBtn.disabled = !voiceInputEnabled
    updateConversationButton()
    setStatus('Ready')

    // 监听 TTS 音频
    window.electronAPI.onTTSAudio((audioData) => {
      console.log('[UI] Received TTS audio:', audioData.byteLength, 'bytes')
      audioPlayer.addAudioChunk(audioData)
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
    window.electronAPI.onTTSConnected(() => {
      console.log('[UI] TTS connected')
      setOrbMode('speaking')
    })

    window.electronAPI.onTTSClosed(() => {
      console.log('[UI] TTS closed')
      setOrbMode('idle')
    })

    window.electronAPI.onTTSError((error) => {
      console.error('[UI] TTS error:', error)
      setStatus(`TTS Error: ${error}`)
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
      // 自动发送转录的文本
      if (text.trim()) {
        void sendMessage(text)
      }
    })

    window.electronAPI.onSpeechError((error) => {
      console.error('[UI] Speech error:', error)
      setStatus(`Speech Error: ${error}`)
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

  await initialize()
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
const volumeSlider = document.getElementById('volume-slider') as HTMLInputElement
const volumeValue = document.getElementById('volume-value')!
const voiceInputBtn = document.getElementById('voice-input-btn') as HTMLButtonElement
const voiceOutputToggle = document.getElementById('voice-output-toggle') as HTMLInputElement
const personalitySelect = document.getElementById('personality-select') as HTMLSelectElement

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
    return
  }

  personalitySelect.innerHTML = ''
  result.items.forEach((name) => {
    const option = document.createElement('option')
    option.value = name
    option.textContent = name
    option.selected = name === result.current
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
function openSettings() {
  orbAnimationPaused = true
  stopOrbAnimation()
  document.body.classList.add('settings-open')
  settingsPanel.classList.add('visible')
  mainView.setAttribute('aria-hidden', 'true')
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

// Close settings with Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
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
          document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'))
          navItem.classList.add('active')
          document.querySelectorAll('.settings-section').forEach(sec => sec.classList.remove('active'))
          document.getElementById(`section-${section}`)?.classList.add('active')

          // 如果切换到记忆管理，加载数据
          if (section === 'memory') {
            void Promise.all([
              loadUserProfile(),
              loadImportantMemories(),
              loadConversationSummaries(),
              loadWorkingMemory()
            ])
          }
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
  setStatus(`人格已切换为 ${selected}`)
})

// Clear history button
const clearHistoryBtn = document.getElementById('clear-history-btn')
clearHistoryBtn?.addEventListener('click', () => {
  clearHistory()
})

async function clearHistory() {
  if (confirm('确定要清除所有对话历史吗？')) {
    try {
      const result = await window.electronAPI.clearHistory()
      if (!result.success) {
        throw new Error(result.error)
      }
      clearTextDisplay()
      setStatus('对话历史已清除')
    } catch (error: any) {
      console.error('Clear history error:', error)
    }
  }
}

// Clear profile button
const clearProfileBtn = document.getElementById('clear-profile-btn')
clearProfileBtn?.addEventListener('click', async () => {
  if (confirm('确定要重置用户画像吗？')) {
    try {
      const result = await window.electronAPI.clearProfile()
      if (!result.success) {
        throw new Error(result.error)
      }
      setStatus('用户画像已重置')
      await loadUserProfile()
    } catch (error: any) {
      console.error('Clear profile error:', error)
    }
  }
})

// ========== Memory Management ==========

const profileContent = document.getElementById('profile-content')!
const importantMemoriesContent = document.getElementById('important-memories-content')!
const summariesContent = document.getElementById('summaries-content')!
const conversationsContent = document.getElementById('conversations-content')!
const summariesCount = document.getElementById('summaries-count')!
const conversationsCount = document.getElementById('conversations-count')!
const editProfileBtn = document.getElementById('edit-profile-btn')!
const addMemoryBtn = document.getElementById('add-memory-btn')!

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
let isEditingProfile = false

async function loadUserProfile(): Promise<void> {
  try {
    const result = await window.electronAPI.getUserProfile()
    if (!result.success || !result.profile) {
      profileContent.innerHTML = '<div class="profile-empty">暂无用户画像</div>'
      return
    }

    currentProfile = result.profile
    renderProfile(result.profile)
  } catch (error) {
    console.error('Failed to load profile:', error)
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

  // 收集所有 basic 中的字段
  const fields: { label: string; value: string }[] = []
  if (basic) {
    for (const [key, value] of Object.entries(basic)) {
      if (value !== undefined && value !== null && value !== '') {
        const label = labelMap[key] || key
        const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value)
        fields.push({ label, value: displayValue })
      }
    }
  }

  const tags = [
    ...(personality || []).map(p => ({ text: p, type: 'personality' })),
    ...(interests || []).map(i => ({ text: i, type: 'interest' })),
  ]

  if (fields.length === 0 && tags.length === 0) {
    profileContent.innerHTML = '<div class="profile-empty">EVA 还不太了解你，多聊聊吧</div>'
    return
  }

  let html = '<div class="profile-fields">'
  fields.forEach(f => {
    html += `<div class="profile-field"><span class="field-label">${escapeHtml(f.label)}</span><span class="field-value">${escapeHtml(f.value)}</span></div>`
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
}

function renderProfileEditForm(profile: UserProfile): void {
  const { basic } = profile

  profileContent.innerHTML = `
    <div class="profile-edit-form">
      <div class="edit-field">
        <label>称呼</label>
        <input type="text" id="edit-nickname" value="${basic.nickname || ''}" placeholder="EVA怎么称呼你">
      </div>
      <div class="edit-field">
        <label>年龄</label>
        <input type="number" id="edit-age" value="${basic.age || ''}" placeholder="你的年龄">
      </div>
      <div class="edit-field">
        <label>性别</label>
        <select id="edit-gender">
          <option value="">不设置</option>
          <option value="男" ${basic.gender === '男' ? 'selected' : ''}>男</option>
          <option value="女" ${basic.gender === '女' ? 'selected' : ''}>女</option>
          <option value="其他" ${basic.gender === '其他' ? 'selected' : ''}>其他</option>
        </select>
      </div>
      <div class="edit-field">
        <label>所在地</label>
        <input type="text" id="edit-location" value="${basic.location || ''}" placeholder="你所在的城市">
      </div>
      <div class="edit-field">
        <label>职业</label>
        <input type="text" id="edit-occupation" value="${basic.occupation || ''}" placeholder="你的职业">
      </div>
      <div class="edit-actions">
        <button id="save-profile-btn" class="edit-save-btn">保存</button>
        <button id="cancel-profile-btn" class="edit-cancel-btn">取消</button>
      </div>
    </div>
  `

  document.getElementById('save-profile-btn')?.addEventListener('click', saveProfile)
  document.getElementById('cancel-profile-btn')?.addEventListener('click', cancelProfileEdit)
}

async function saveProfile(): Promise<void> {
  const nickname = (document.getElementById('edit-nickname') as HTMLInputElement).value.trim()
  const ageStr = (document.getElementById('edit-age') as HTMLInputElement).value
  const gender = (document.getElementById('edit-gender') as HTMLSelectElement).value
  const location = (document.getElementById('edit-location') as HTMLInputElement).value.trim()
  const occupation = (document.getElementById('edit-occupation') as HTMLInputElement).value.trim()

  const updates: Record<string, any> = {}
  if (nickname) updates.nickname = nickname
  if (ageStr) updates.age = parseInt(ageStr, 10)
  if (gender) updates.gender = gender
  if (location) updates.location = location
  if (occupation) updates.occupation = occupation

  try {
    const result = await window.electronAPI.updateUserProfile(updates)
    if (!result.success) {
      throw new Error(result.error)
    }

    isEditingProfile = false
    editProfileBtn.textContent = '编辑'
    await loadUserProfile()
    setStatus('用户画像已更新')
  } catch (error: any) {
    console.error('Failed to save profile:', error)
    setStatus('保存失败')
  }
}

function cancelProfileEdit(): void {
  isEditingProfile = false
  editProfileBtn.textContent = '编辑'
  if (currentProfile) {
    renderProfile(currentProfile)
  } else {
    profileContent.innerHTML = '<div class="profile-empty">暂无用户画像</div>'
  }
}

editProfileBtn.addEventListener('click', () => {
  if (isEditingProfile) {
    cancelProfileEdit()
  } else {
    isEditingProfile = true
    editProfileBtn.textContent = '取消'
    renderProfileEditForm(currentProfile || { basic: {} })
  }
})

async function loadImportantMemories(): Promise<void> {
  try {
    const result = await window.electronAPI.getUserProfile()
    if (!result.success || !result.profile) {
      importantMemoriesContent.innerHTML = '<div class="profile-empty">暂无重要记忆</div>'
      return
    }

    const memories = result.profile.importantMemories || {}
    renderImportantMemories(memories)
  } catch (error) {
    console.error('Failed to load memories:', error)
    importantMemoriesContent.innerHTML = '<div class="profile-error">加载失败</div>'
  }
}

function renderImportantMemories(memories: Record<string, string>): void {
  const entries = Object.entries(memories)

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
        <button class="memory-delete-btn" data-key="${escapeHtml(key)}">删除</button>
      </div>
    `
  })
  html += '</div>'

  importantMemoriesContent.innerHTML = html

  // Attach delete handlers
  importantMemoriesContent.querySelectorAll('.memory-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const key = (e.target as HTMLButtonElement).dataset.key
      if (key && confirm(`确定要删除"${key}"吗？`)) {
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

addMemoryBtn.addEventListener('click', () => {
  showAddMemoryDialog()
})

function showAddMemoryDialog(): void {
  const dialog = document.createElement('div')
  dialog.className = 'memory-dialog-overlay'
  dialog.innerHTML = `
    <div class="memory-dialog">
      <h3>添加重要记忆</h3>
      <div class="dialog-field">
        <label>标签</label>
        <input type="text" id="new-memory-key" placeholder="例如：生日、喜欢的食物">
      </div>
      <div class="dialog-field">
        <label>内容</label>
        <input type="text" id="new-memory-value" placeholder="具体内容">
      </div>
      <div class="dialog-actions">
        <button id="dialog-save" class="dialog-save-btn">保存</button>
        <button id="dialog-cancel" class="dialog-cancel-btn">取消</button>
      </div>
    </div>
  `

  document.body.appendChild(dialog)

  const keyInput = document.getElementById('new-memory-key') as HTMLInputElement
  const valueInput = document.getElementById('new-memory-value') as HTMLInputElement

  document.getElementById('dialog-save')?.addEventListener('click', async () => {
    const key = keyInput.value.trim()
    const value = valueInput.value.trim()

    if (!key || !value) {
      setStatus('请填写完整信息')
      return
    }

    try {
      const result = await window.electronAPI.addImportantMemory(key, value)
      if (!result.success) {
        throw new Error(result.error)
      }
      dialog.remove()
      await loadImportantMemories()
      setStatus('记忆已添加')
    } catch (error: any) {
      console.error('Failed to add memory:', error)
      setStatus('添加失败')
    }
  })

  document.getElementById('dialog-cancel')?.addEventListener('click', () => {
    dialog.remove()
  })

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      dialog.remove()
    }
  })

  keyInput.focus()
}

async function loadConversationSummaries(): Promise<void> {
  try {
    const result = await window.electronAPI.getConversationSummaries()
    if (!result.success || !result.summaries) {
      summariesContent.innerHTML = '<div class="profile-empty">暂无对话摘要</div>'
      summariesCount.textContent = '0 条'
      return
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
}

async function loadWorkingMemory(): Promise<void> {
  try {
    const result = await window.electronAPI.getWorkingMemory()
    if (!result.success || !result.memory) {
      conversationsContent.innerHTML = '<div class="profile-empty">暂无对话记录</div>'
      conversationsCount.textContent = '0 条'
      return
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
      </div>
    `
  })
  html += '</div>'

  conversationsContent.innerHTML = html
}

function escapeHtml(str: string): string {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}


console.log('Her-Text Renderer initialized')
