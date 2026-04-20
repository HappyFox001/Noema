import './styles.css'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { ConversationManager, type ConversationState } from './conversation-manager'

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <div class="container">
    <canvas id="orb-canvas" width="180" height="180"></canvas>
    <div id="text-display" class="text-display"></div>
    <div class="controls">
      <div style="width: 100%; display: flex; gap: 8px; align-items: center;">
        <button id="start-voice-btn" class="start-button" style="flex: 1;">Start Voice</button>
        <button id="start-text-btn" class="tts-button" style="flex: 1;">Start Text</button>
      </div>
      <div id="status" class="status">Ready</div>
      <div style="width: 100%; display: flex; gap: 8px; align-items: center;">
        <input type="text" id="text-input" class="text-input" placeholder="Type your message..." />
        <button id="send-btn" class="tts-button" style="flex-shrink: 0; padding: 10px 20px;">Send</button>
      </div>
    </div>
  </div>
`

// 初始化小球渲染
const canvas = document.getElementById('orb-canvas') as HTMLCanvasElement
const ctx = canvas.getContext('2d', { alpha: true })!

interface OrbState {
  mode: ConversationState
  glow: number
  breatheRate: number
}

let orbState: OrbState = {
  mode: 'idle',
  glow: 4,
  breatheRate: 1.2
}

function drawOrb() {
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const centerX = canvas.width / 2
  const centerY = canvas.height / 2
  const time = Date.now() / 1000
  const breathe = Math.sin(time * orbState.breatheRate) * 1.8
  const glowPulse = (Math.sin(time * orbState.breatheRate) + 1) * 0.5
  const currentRadius = 22 + breathe
  const glowRadius = currentRadius + 10 + orbState.glow * glowPulse

  const ambientGlow = ctx.createRadialGradient(centerX, centerY, currentRadius * 0.5, centerX, centerY, glowRadius)
  ambientGlow.addColorStop(0, 'rgba(255, 255, 255, 0.10)')
  ambientGlow.addColorStop(0.45, 'rgba(20, 20, 20, 0.18)')
  ambientGlow.addColorStop(1, 'rgba(0, 0, 0, 0)')

  ctx.fillStyle = ambientGlow
  ctx.beginPath()
  ctx.arc(centerX, centerY, glowRadius, 0, Math.PI * 2)
  ctx.fill()

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

// 小球拖拽功能
const appWindow = getCurrentWindow()

canvas.style.cursor = 'grab'

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return

  e.preventDefault()
  canvas.style.cursor = 'grabbing'

  void appWindow.startDragging().catch((err) => {
    canvas.style.cursor = 'grab'
    console.error('Failed to start window dragging:', err)
  })
})

document.addEventListener('mouseup', () => {
  canvas.style.cursor = 'grab'
})

// Conversation Manager
const conversationManager = new ConversationManager()
let isTextInitialized = false
let isVoiceInitialized = false
let isConversing = false
let areConversationEventsRegistered = false

// Helper function to update orb state
function setOrbMode(mode: ConversationState) {
  orbState.mode = mode

  switch (mode) {
    case 'listening':
      orbState.glow = 8
      orbState.breatheRate = 1.7
      break
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

// Helper function to update status text
function setStatus(text: string) {
  const statusEl = document.getElementById('status')!
  statusEl.textContent = text
}

// Helper function to update text display
function setTextDisplay(text: string) {
  const textDisplay = document.getElementById('text-display')!
  textDisplay.textContent = text
}

// Helper function to clear text display
function clearTextDisplay() {
  const textDisplay = document.getElementById('text-display')!
  textDisplay.textContent = ''
}

// Start/Stop button handler
const startVoiceBtn = document.getElementById('start-voice-btn') as HTMLButtonElement
const startTextBtn = document.getElementById('start-text-btn') as HTMLButtonElement

function getConversationConfig() {
  const llmApiKey = import.meta.env.VITE_LLM_API_KEY || ''
  const llmModel = import.meta.env.VITE_LLM_MODEL || 'gpt-4o-mini'
  const llmBaseURL = import.meta.env.VITE_LLM_BASE_URL || undefined
  const qwenApiKey = import.meta.env.VITE_QWEN_API_KEY || ''
  const qwenSttUrl = import.meta.env.VITE_QWEN_STT_URL || undefined
  const fishApiKey = import.meta.env.VITE_FISH_API_KEY || ''
  const fishVoiceId = import.meta.env.VITE_FISH_VOICE_ID
  const fishModel = import.meta.env.VITE_FISH_MODEL || 's1'

  return {
    llmApiKey,
    llmModel,
    llmBaseURL,
    sttApiKey: qwenApiKey,
    sttUrl: qwenSttUrl,
    ttsApiKey: fishApiKey,
    ttsVoiceId: fishVoiceId,
    ttsModel: fishModel,
  }
}

function validateBaseConfig(config: ReturnType<typeof getConversationConfig>): boolean {
  if (!config.llmApiKey) {
    setStatus('Error: LLM API key not configured')
    setTextDisplay('Please set VITE_LLM_API_KEY in .env')
    return false
  }

  if (!config.ttsApiKey) {
    console.warn('Fish API key not configured - TTS disabled')
  }

  return true
}

function registerConversationEvents() {
  if (areConversationEventsRegistered) return

  conversationManager.onStateChanged((state) => {
    setOrbMode(state)

    switch (state) {
      case 'idle':
        setStatus('Ready')
        clearTextDisplay()
        break
      case 'listening':
        setStatus('Listening...')
        clearTextDisplay()
        break
      case 'thinking':
        setStatus('Thinking...')
        break
      case 'speaking':
        setStatus('Speaking...')
        break
    }
  })

  conversationManager.onTranscriptReceived((text) => {
    console.log('Transcript:', text)
  })

  conversationManager.onResponseReceived((text) => {
    console.log('Response:', text)
    setTextDisplay(text)
  })

  conversationManager.onErrorOccurred((error) => {
    console.error('Error:', error)
    setStatus(`Error: ${error.message}`)
    setOrbMode('idle')

    if (isConversing) {
      conversationManager.stopConversation()
      isConversing = false
      startVoiceBtn.textContent = 'Start Voice'
      startVoiceBtn.disabled = false
    }
  })

  areConversationEventsRegistered = true
}

startTextBtn.addEventListener('click', async () => {
  try {
    if (isTextInitialized) {
      setStatus('Text Ready')
      textInput.focus()
      return
    }

    setStatus('Initializing text...')
    startTextBtn.disabled = true

    const config = getConversationConfig()
    if (!validateBaseConfig(config)) {
      startTextBtn.disabled = false
      return
    }

    await conversationManager.initialize(config, { enableVoiceInput: false })
    registerConversationEvents()

    isTextInitialized = true
    setStatus('Text Ready')
    startTextBtn.textContent = 'Text Ready'
    textInput.focus()
  } catch (error) {
    console.error('Text initialization error:', error)
    setStatus(`Error: ${error}`)
    setOrbMode('idle')
    startTextBtn.disabled = false
    startTextBtn.textContent = 'Start Text'
  }
})

startVoiceBtn.addEventListener('click', async () => {
  try {
    const config = getConversationConfig()
    if (!validateBaseConfig(config)) return

    if (!config.sttApiKey) {
      setStatus('Error: Qwen API key not configured')
      setTextDisplay('Please set VITE_QWEN_API_KEY in .env for voice mode')
      return
    }

    if (!isVoiceInitialized) {
      setStatus('Initializing voice...')
      startVoiceBtn.disabled = true

      await conversationManager.initialize(config, { enableVoiceInput: true })
      registerConversationEvents()

      isTextInitialized = true
      isVoiceInitialized = true
      startTextBtn.textContent = 'Text Ready'
      setStatus('Ready')
      startVoiceBtn.disabled = false
    }

    if (isConversing) {
      conversationManager.stopConversation()
      isConversing = false
      setOrbMode('idle')
      setStatus('Ready')
      startVoiceBtn.textContent = 'Start Voice'
    } else {
      conversationManager.startConversation()
      isConversing = true
      setOrbMode('listening')
      setStatus('Listening...')
      startVoiceBtn.textContent = 'Stop Voice'
    }
  } catch (error) {
    console.error('Voice conversation error:', error)
    setStatus(`Error: ${error}`)
    setOrbMode('idle')
    startVoiceBtn.disabled = false
    startVoiceBtn.textContent = 'Start Voice'
  }
})

// Text input handler
const textInput = document.getElementById('text-input') as HTMLInputElement
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement

async function sendTextMessage() {
  const text = textInput.value.trim()
  if (!text) return

  if (!isTextInitialized) {
    setStatus('Please start text first')
    return
  }

  try {
    // 禁用输入
    textInput.disabled = true
    sendBtn.disabled = true

    // 清空输入框
    textInput.value = ''

    await conversationManager.sendTextMessage(text, true)

  } catch (error) {
    console.error('Text message error:', error)
    setStatus(`Error: ${error}`)
  } finally {
    // 恢复输入
    textInput.disabled = false
    sendBtn.disabled = false
    textInput.focus()
  }
}

// Send button click
sendBtn.addEventListener('click', sendTextMessage)

// Enter key to send
textInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendTextMessage()
  }
})

// Cleanup on page unload
window.addEventListener('beforeunload', async () => {
  await conversationManager.shutdown()
})

console.log('Her-Text initialized')
