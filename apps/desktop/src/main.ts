import './styles.css'
import { ConversationManager, type ConversationState } from './conversation-manager'

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <div class="container">
    <canvas id="orb-canvas" width="300" height="300"></canvas>
    <div id="text-display" class="text-display"></div>
    <div class="controls">
      <button id="start-btn" class="start-button">Start Conversation</button>
      <div id="status" class="status">Ready</div>
    </div>
  </div>
`

// 初始化小球渲染
const canvas = document.getElementById('orb-canvas') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!

interface OrbState {
  mode: ConversationState
  color: string
  glow: number
}

let orbState: OrbState = {
  mode: 'idle',
  color: '#4A90E2',
  glow: 0
}

function drawOrb() {
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const centerX = canvas.width / 2
  const centerY = canvas.height / 2
  const baseRadius = 60

  // 呼吸效果
  const time = Date.now() / 1000
  const breathe = Math.sin(time * 2) * 5

  // 绘制发光效果
  const gradient = ctx.createRadialGradient(
    centerX, centerY, 0,
    centerX, centerY, baseRadius + breathe + orbState.glow
  )
  gradient.addColorStop(0, orbState.color)
  gradient.addColorStop(0.5, orbState.color + '80')
  gradient.addColorStop(1, orbState.color + '00')

  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(centerX, centerY, baseRadius + breathe + orbState.glow, 0, Math.PI * 2)
  ctx.fill()

  // 绘制核心球体
  ctx.fillStyle = orbState.color
  ctx.beginPath()
  ctx.arc(centerX, centerY, baseRadius + breathe, 0, Math.PI * 2)
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
      orbState.color = '#4AE290'
      orbState.glow = 20
      break
    case 'thinking':
      orbState.color = '#E2904A'
      orbState.glow = 10
      break
    case 'speaking':
      orbState.color = '#E24A90'
      orbState.glow = 15
      break
    default:
      orbState.color = '#4A90E2'
      orbState.glow = 0
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
