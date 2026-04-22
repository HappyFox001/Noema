import './styles.css'

// ========== Audio Player ==========

class AudioPlayer {
  private audioContext: AudioContext | null = null
  private isPlaying = false
  private audioQueue: AudioBuffer[] = []
  private nextStartTime = 0
  private onChunkScheduled?: (payload: { startTime: number; duration: number }) => void

  async initialize(): Promise<void> {
    this.audioContext = new AudioContext({ sampleRate: 16000 })
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
    source.connect(this.audioContext.destination)

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

// ========== UI ==========

const audioPlayer = new AudioPlayer()
const textRevealer = new AudioSyncedTextRevealer(
  () => audioPlayer.getCurrentTime(),
  (text) => setTextDisplay(text)
)
let isInitialized = false
let activeMode: 'conversation' | 'text' | null = null
let ttsEnabled = false

type ConversationFrame =
  | { type: 'system.reset' }
  | { type: 'control.phase_start'; phase: 'reply' | 'task' | 'task_result' }
  | { type: 'control.phase_end'; phase: 'reply' | 'task' | 'task_result' }
  | { type: 'control.task_start'; taskDescription: string }
  | { type: 'control.task_end'; success: boolean; summary: string; error?: string }
  | { type: 'data.tts_text'; text: string }

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

// Store current radius for mouse detection
let currentOrbRadius = 22

function drawOrb() {
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

  requestAnimationFrame(drawOrb)
}

drawOrb()

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

    setStatus(mode === 'conversation' ? 'Conversation Ready' : 'Text Ready')
    startConversationBtn.textContent = 'Conversation Ready'
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

startConversationBtn.addEventListener('click', async () => {
  await initialize('conversation')
})

startTextBtn.addEventListener('click', async () => {
  await initialize('text')
})

async function sendMessage() {
  const text = textInput.value.trim()
  if (!text || !isInitialized) return

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
    textInput.disabled = false
    sendBtn.disabled = false
    setStatus(activeMode === 'conversation' ? 'Conversation Ready' : 'Text Ready')
    textInput.focus()
  }
}

sendBtn.addEventListener('click', sendMessage)
textInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendMessage()
  }
})

console.log('Her-Text Renderer initialized')
