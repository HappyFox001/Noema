import './styles.css'

// ========== Audio Player ==========

class AudioPlayer {
  private audioContext: AudioContext | null = null
  private gainNode: GainNode | null = null
  private isPlaying = false
  private audioQueue: AudioBuffer[] = []
  private nextStartTime = 0
  private onChunkScheduled?: (payload: { startTime: number; duration: number }) => void

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

    const currentTime = this.audioContext.currentTime
    const startTime = Math.max(currentTime, this.nextStartTime)

    source.start(startTime)
    this.nextStartTime = startTime + buffer.duration
    this.onChunkScheduled?.({ startTime, duration: buffer.duration })

    source.onended = () => {
      if (this.audioQueue.length > 0) {
        const nextBuffer = this.audioQueue.shift()!
        this.playBuffer(nextBuffer)
      } else {
        this.isPlaying = false
      }
    }
  }

  async addAudioChunk(pcm16Bytes: Uint8Array): Promise<void> {
    try {
      if (this.audioContext?.state === 'suspended') {
        await this.audioContext.resume()
      }

      const audioBuffer = this.pcm16ToAudioBuffer(pcm16Bytes)

      if (this.isPlaying) {
        this.audioQueue.push(audioBuffer)
      } else {
        this.isPlaying = true
        this.nextStartTime = this.audioContext!.currentTime
        this.playBuffer(audioBuffer)
      }
    } catch (error) {
      console.error('[AudioPlayer] Failed to add audio chunk:', error)
    }
  }

  stop(): void {
    this.audioQueue = []
    this.isPlaying = false
    this.nextStartTime = 0
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

class VoiceRecorder {
  private context: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private sink: GainNode | null = null
  private recording = false
  private chunkHandler: ((chunk: Int16Array, level: number) => void) | null = null

  async start(onChunk?: (chunk: Int16Array, level: number) => void): Promise<void> {
    if (this.recording) {
      return
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })

    this.context = new AudioContext()
    this.source = this.context.createMediaStreamSource(this.stream)
    this.processor = this.context.createScriptProcessor(4096, 1, 1)
    this.sink = this.context.createGain()
    this.sink.gain.value = 0

    this.chunkHandler = onChunk || null
    this.recording = true

    this.processor.onaudioprocess = (event) => {
      if (!this.recording || !this.context) {
        return
      }

      const input = event.inputBuffer.getChannelData(0)
      const downsampled = downsampleToInt16(input, this.context.sampleRate, 16000)
      if (downsampled.length > 0) {
        this.chunkHandler?.(downsampled, calculateRms(input))
      }
    }

    this.source.connect(this.processor)
    this.processor.connect(this.sink)
    this.sink.connect(this.context.destination)
  }

  async stop(): Promise<void> {
    this.recording = false

    this.processor?.disconnect()
    this.source?.disconnect()
    this.sink?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    await this.context?.close()

    this.processor = null
    this.source = null
    this.sink = null
    this.stream = null
    this.context = null
    this.chunkHandler = null
  }

  isRecording(): boolean {
    return this.recording
  }
}

function downsampleToInt16(input: Float32Array, sourceRate: number, targetRate: number): Int16Array {
  if (sourceRate === targetRate) {
    return float32ToInt16(input)
  }

  const ratio = sourceRate / targetRate
  const length = Math.floor(input.length / ratio)
  const output = new Int16Array(length)

  let offsetResult = 0
  let offsetInput = 0

  while (offsetResult < output.length) {
    const nextOffsetInput = Math.round((offsetResult + 1) * ratio)
    let accumulator = 0
    let count = 0

    for (let i = offsetInput; i < nextOffsetInput && i < input.length; i++) {
      accumulator += input[i]
      count += 1
    }

    const sample = count > 0 ? accumulator / count : 0
    output[offsetResult] = toInt16Sample(sample)
    offsetResult += 1
    offsetInput = nextOffsetInput
  }

  return output
}

function float32ToInt16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    output[i] = toInt16Sample(input[i])
  }
  return output
}

function toInt16Sample(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value))
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
}

function calculateRms(input: Float32Array): number {
  let sum = 0
  for (let i = 0; i < input.length; i++) {
    sum += input[i] * input[i]
  }
  return Math.sqrt(sum / input.length)
}

// ========== UI ==========

const audioPlayer = new AudioPlayer()
const textRevealer = new AudioSyncedTextRevealer(
  () => audioPlayer.getCurrentTime(),
  (text) => setTextDisplay(text)
)
let isInitialized = false
let activeMode: 'conversation' | 'text' | null = null
let ttsEnabled = false
let voiceInputEnabled = true
let isSendingMessage = false
let isVoiceListening = false
let conversationStreamActive = false
let conversationStreamSuspended = false
let conversationSpeechStarted = false
let conversationSpeechStartAt = 0
let conversationLastSpeechAt = 0
let conversationCommitInFlight = false

const STREAM_SPEECH_THRESHOLD = 0.015
const STREAM_MIN_SPEECH_MS = 250
const STREAM_SILENCE_MS = 900

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

// Mouse interaction for orb dragging
canvas.addEventListener('mousemove', (e) => {
  if (isDragging) {
    // Calculate movement delta
    const deltaX = e.screenX - lastMouseX
    const deltaY = e.screenY - lastMouseY

    // Update last position
    lastMouseX = e.screenX
    lastMouseY = e.screenY

    // Move window
    window.electronAPI.moveWindow(deltaX, deltaY)
  } else if (isPointInOrb(e.clientX, e.clientY)) {
    canvas.style.cursor = 'grab'
  } else {
    canvas.style.cursor = 'default'
  }
})

// Reset cursor when mouse leaves canvas
canvas.addEventListener('mouseleave', () => {
  if (!isDragging) {
    canvas.style.cursor = 'default'
  }
})

// Start dragging when mouse down on orb
canvas.addEventListener('mousedown', (e) => {
  if (isPointInOrb(e.clientX, e.clientY)) {
    isDragging = true
    lastMouseX = e.screenX
    lastMouseY = e.screenY
    canvas.style.cursor = 'grabbing'
  }
})

// Stop dragging on mouse up
canvas.addEventListener('mouseup', (e) => {
  if (isDragging) {
    isDragging = false
    if (isPointInOrb(e.clientX, e.clientY)) {
      canvas.style.cursor = 'grab'
    } else {
      canvas.style.cursor = 'default'
    }
  }
})

// Handle global mouse up to stop dragging even if released outside canvas
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

function setStatus(text: string) {
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
        // 任务结果阶段开始前，清空之前的文字
        textRevealer.reset()
        setStatus('Sharing result...')
      }
      setOrbMode('speaking')
      break
    case 'control.phase_end':
      if (frame.phase === 'task_result') {
        setStatus(activeMode === 'conversation' ? 'Conversation Ready' : 'Text Ready')
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
const startTextBtn = document.getElementById('start-text-btn') as HTMLButtonElement
const textInput = document.getElementById('text-input') as HTMLInputElement
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement

async function initialize(mode: 'conversation' | 'text') {
  if (isInitialized) {
    activeMode = mode
    setStatus(mode === 'conversation' ? 'Conversation Ready' : 'Text Ready')
    textInput.focus()
    return
  }

  setStatus(mode === 'conversation' ? 'Initializing...' : 'Initializing...')
  startConversationBtn.disabled = true
  startTextBtn.disabled = true

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
    activeMode = mode
    ttsEnabled = Boolean(result.ttsEnabled)

    // 可选：输出 SDK 状态
    if (result.stats) {
      console.log('[SDK] Stats:', result.stats)
    }

    await loadSettings()
    await loadPersonalities()

    setStatus(mode === 'conversation' ? 'Conversation Ready' : 'Text Ready')
    if (voiceInputEnabled) {
      startConversationBtn.textContent = 'Conversation Ready'
    }
    startTextBtn.textContent = 'Text Ready'
    textInput.focus()

    // 监听 TTS 音频
    window.electronAPI.onTTSAudio((audioData) => {
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
  } catch (error: any) {
    console.error('Initialization error:', error)
    setStatus(`Error: ${error.message}`)
    startConversationBtn.disabled = false
    startTextBtn.disabled = false
  }
}

async function stopConversationStreaming(): Promise<void> {
  try {
    conversationStreamActive = false
    conversationStreamSuspended = false
    conversationSpeechStarted = false
    conversationCommitInFlight = false
    isVoiceListening = false

    if (voiceRecorder.isRecording()) {
      await voiceRecorder.stop()
    }

    await window.electronAPI.stopSpeechStream()
  } catch (error: any) {
    setStatus(`Voice Error: ${error.message}`)
    if (!isSendingMessage) {
      setOrbMode('idle')
    }
  }
}

async function commitConversationUtterance(): Promise<void> {
  if (!conversationSpeechStarted || conversationCommitInFlight) {
    return
  }

  conversationCommitInFlight = true
  conversationSpeechStarted = false
  conversationStreamSuspended = true
  isVoiceListening = false
  setStatus('Understanding...')

  try {
    const result = await window.electronAPI.commitSpeechStream()
    const transcript = result.text?.trim()

    if (!result.success) {
      throw new Error(result.error || 'Failed to transcribe speech')
    }

    if (transcript) {
      textInput.value = transcript
      await sendMessage(transcript)
    }
  } catch (error: any) {
    setStatus(`Voice Error: ${error.message}`)
    setOrbMode('idle')
  } finally {
    conversationCommitInFlight = false
    if (conversationStreamActive && activeMode === 'conversation' && voiceInputEnabled) {
      conversationStreamSuspended = false
      isVoiceListening = true
      setStatus('Listening...')
      if (!isSendingMessage) {
        setOrbMode('thinking')
      }
    }
  }
}

async function handleConversationAudioChunk(chunk: Int16Array, level: number): Promise<void> {
  if (!conversationStreamActive || conversationStreamSuspended || activeMode !== 'conversation') {
    return
  }

  const appendResult = await window.electronAPI.appendSpeechStream(Array.from(chunk))
  if (!appendResult.success) {
    throw new Error(appendResult.error || 'Failed to stream speech audio')
  }

  const now = Date.now()
  const isSpeech = level >= STREAM_SPEECH_THRESHOLD

  if (isSpeech) {
    if (!conversationSpeechStarted) {
      conversationSpeechStarted = true
      conversationSpeechStartAt = now
    }
    conversationLastSpeechAt = now
    isVoiceListening = true
    setStatus('Listening...')
    return
  }

  if (
    conversationSpeechStarted &&
    !conversationCommitInFlight &&
    now - conversationSpeechStartAt >= STREAM_MIN_SPEECH_MS &&
    now - conversationLastSpeechAt >= STREAM_SILENCE_MS
  ) {
    void commitConversationUtterance()
  }
}

async function startConversationStreaming(): Promise<void> {
  if (conversationStreamActive && voiceRecorder.isRecording()) {
    isVoiceListening = true
    setStatus('Listening...')
    return
  }

  const streamResult = await window.electronAPI.startSpeechStream()
  if (!streamResult.success) {
    throw new Error(streamResult.error || 'Failed to start speech stream')
  }

  await voiceRecorder.start((chunk, level) => {
    void handleConversationAudioChunk(chunk, level).catch((error: any) => {
      setStatus(`Voice Error: ${error.message}`)
      setOrbMode('idle')
      void stopConversationStreaming()
    })
  })

  conversationStreamActive = true
  conversationStreamSuspended = false
  conversationSpeechStarted = false
  conversationCommitInFlight = false
  isVoiceListening = true
  setStatus('Listening...')
  setOrbMode('thinking')
}

startConversationBtn.addEventListener('click', async () => {
  if (!voiceInputEnabled) {
    setStatus('Voice input is disabled')
    return
  }

  await initialize('conversation')
  await startConversationStreaming()
})

startTextBtn.addEventListener('click', async () => {
  await stopConversationStreaming()
  await initialize('text')
})

async function sendMessage(overrideText?: string) {
  const text = (overrideText ?? textInput.value).trim()
  if (!text || !isInitialized) return

  const shouldSuspendConversationStream = activeMode === 'conversation' && conversationStreamActive

  if (shouldSuspendConversationStream) {
    conversationStreamSuspended = true
    isVoiceListening = false
  }

  isSendingMessage = true
  textInput.disabled = true
  sendBtn.disabled = true
  textInput.value = ''

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
    isSendingMessage = false
    textInput.disabled = false
    sendBtn.disabled = false
    if (shouldSuspendConversationStream && conversationStreamActive && voiceInputEnabled) {
      conversationStreamSuspended = false
      isVoiceListening = true
    }

    if (activeMode === 'conversation' && conversationStreamActive && voiceInputEnabled) {
      setStatus('Listening...')
    } else {
      setStatus(activeMode === 'conversation' ? 'Conversation Ready' : 'Text Ready')
    }
    textInput.focus()
  }
}

sendBtn.addEventListener('click', sendMessage)
textInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendMessage()
  }
})

// ========== Context Menu & Settings Panel ==========

const contextMenu = document.getElementById('context-menu')!
const settingsPanel = document.getElementById('settings-panel')!
const settingsClose = document.getElementById('settings-close')!
const mainView = document.getElementById('main-view')!
const settingsNav = document.querySelector('.settings-nav')!
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
  startConversationBtn.textContent = settings.voiceInputEnabled
    ? (isInitialized ? 'Conversation Ready' : 'Start Conversation')
    : 'Voice Disabled'
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
    conversationStreamSuspended = false
    conversationSpeechStarted = false
    conversationCommitInFlight = false
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

// Settings navigation
settingsNav.addEventListener('click', (e) => {
  const target = e.target as HTMLElement
  const navItem = target.closest('.nav-item') as HTMLElement
  if (!navItem) return

  const section = navItem.dataset.section
  if (!section) return

  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'))
  navItem.classList.add('active')

  // Show corresponding section
  document.querySelectorAll('.settings-section').forEach(sec => sec.classList.remove('active'))
  document.getElementById(`section-${section}`)?.classList.add('active')
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
    } catch (error: any) {
      console.error('Clear profile error:', error)
    }
  }
})

console.log('Her-Text Renderer initialized')
