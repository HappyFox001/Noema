import './styles.css'
import { ConversationManager, type ConversationState } from './conversation-manager'

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <div class="container">
    <canvas id="orb-canvas" width="180" height="180"></canvas>
    <div id="text-display" class="text-display"></div>
    <div class="controls">
      <button id="start-btn" class="start-button">Start Conversation</button>
      <div id="status" class="status">Ready</div>
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

// Conversation Manager
const conversationManager = new ConversationManager()
let isInitialized = false
let isConversing = false

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
const startBtn = document.getElementById('start-btn') as HTMLButtonElement

startBtn.addEventListener('click', async () => {
  try {
    // Initialize on first click
    if (!isInitialized) {
      setStatus('Initializing...')
      startBtn.disabled = true

      // Get API keys from environment
      const llmApiKey = import.meta.env.VITE_LLM_API_KEY || ''
      const llmModel = import.meta.env.VITE_LLM_MODEL || 'gpt-4o-mini'
      const llmBaseURL = import.meta.env.VITE_LLM_BASE_URL || undefined
      const qwenApiKey = import.meta.env.VITE_QWEN_API_KEY || ''
      const fishApiKey = import.meta.env.VITE_FISH_API_KEY || ''
      const fishVoiceId = import.meta.env.VITE_FISH_VOICE_ID

      // Validate API keys
      if (!llmApiKey) {
        setStatus('Error: LLM API key not configured')
        setTextDisplay('Please set VITE_LLM_API_KEY in .env')
        startBtn.disabled = false
        return
      }

      if (!qwenApiKey) {
        setStatus('Error: Qwen API key not configured')
        setTextDisplay('Please set VITE_QWEN_API_KEY in .env')
        startBtn.disabled = false
        return
      }

      if (!fishApiKey) {
        setStatus('Error: Fish API key not configured')
        setTextDisplay('Please set VITE_FISH_API_KEY in .env')
        startBtn.disabled = false
        return
      }

      // Initialize conversation manager
      await conversationManager.initialize({
        llmApiKey,
        llmModel,
        llmBaseURL,
        sttApiKey: qwenApiKey,
        ttsApiKey: fishApiKey,
        ttsVoiceId: fishVoiceId,
      })

      // Set up event listeners
      conversationManager.onStateChanged((state) => {
        setOrbMode(state)

        switch (state) {
          case 'idle':
            setStatus('Ready')
            clearTextDisplay()  // 返回闲置状态时清空文本
            break
          case 'listening':
            setStatus('Listening...')
            clearTextDisplay()  // 开始监听时清空文本
            break
          case 'thinking':
            setStatus('Thinking...')
            break
          case 'speaking':
            setStatus('Speaking...')
            // 文本在 onResponseReceived 中显示
            break
        }
      })

      conversationManager.onTranscriptReceived((text) => {
        console.log('Transcript:', text)
        // 不显示用户输入，保持简洁
      })

      conversationManager.onResponseReceived((text) => {
        console.log('Response:', text)
        // 流式显示 LLM 响应
        setTextDisplay(text)
      })

      conversationManager.onErrorOccurred((error) => {
        console.error('Error:', error)
        setStatus(`Error: ${error.message}`)
        setOrbMode('idle')

        if (isConversing) {
          conversationManager.stopConversation()
          isConversing = false
          startBtn.textContent = 'Start Conversation'
          startBtn.disabled = false
        }
      })

      isInitialized = true
      setStatus('Ready')
      startBtn.disabled = false
    }

    // Toggle conversation
    if (isConversing) {
      // Stop conversation
      conversationManager.stopConversation()
      isConversing = false
      setOrbMode('idle')
      setStatus('Ready')
      startBtn.textContent = 'Start Conversation'
    } else {
      // Start conversation
      conversationManager.startConversation()
      isConversing = true
      setOrbMode('listening')
      setStatus('Listening...')
      startBtn.textContent = 'Stop Conversation'
    }
  } catch (error) {
    console.error('Conversation error:', error)
    setStatus(`Error: ${error}`)
    setOrbMode('idle')
    startBtn.disabled = false
    startBtn.textContent = 'Start Conversation'
  }
})

// Cleanup on page unload
window.addEventListener('beforeunload', async () => {
  await conversationManager.shutdown()
})

console.log('Her-Text initialized')
