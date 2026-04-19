import './styles.css'
import { ConversationManager, type ConversationState } from './conversation-manager'

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <div class="container">
    <canvas id="orb-canvas" width="400" height="400"></canvas>
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
  color: string
  glow: number
}

let orbState: OrbState = {
  mode: 'idle',
  color: '#60A5FA',  // 更亮的蓝色
  glow: 0
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 96, g: 165, b: 250 }
}

function drawOrb() {
  // 完全清除画布（透明背景）
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const centerX = canvas.width / 2
  const centerY = canvas.height / 2
  const baseRadius = 80

  // 呼吸效果 - 更大更平滑的动画
  const time = Date.now() / 1000
  const breathe = Math.sin(time * 1.5) * 12
  const pulseGlow = Math.sin(time * 2) * 15

  const currentRadius = baseRadius + breathe
  const rgb = hexToRgb(orbState.color)

  // 外层大光晕（最外层，最淡）
  const outerGlow = ctx.createRadialGradient(
    centerX, centerY, 0,
    centerX, centerY, currentRadius + 80 + orbState.glow + pulseGlow
  )
  outerGlow.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)`)
  outerGlow.addColorStop(0.3, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`)
  outerGlow.addColorStop(0.6, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.05)`)
  outerGlow.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`)

  ctx.fillStyle = outerGlow
  ctx.beginPath()
  ctx.arc(centerX, centerY, currentRadius + 80 + orbState.glow + pulseGlow, 0, Math.PI * 2)
  ctx.fill()

  // 中层光晕
  const midGlow = ctx.createRadialGradient(
    centerX, centerY, 0,
    centerX, centerY, currentRadius + 40 + orbState.glow
  )
  midGlow.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6)`)
  midGlow.addColorStop(0.5, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)`)
  midGlow.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`)

  ctx.fillStyle = midGlow
  ctx.beginPath()
  ctx.arc(centerX, centerY, currentRadius + 40 + orbState.glow, 0, Math.PI * 2)
  ctx.fill()

  // 核心球体 - 渐变效果（3D感）
  const coreGradient = ctx.createRadialGradient(
    centerX - currentRadius * 0.3,
    centerY - currentRadius * 0.3,
    0,
    centerX,
    centerY,
    currentRadius
  )
  coreGradient.addColorStop(0, `rgba(${Math.min(rgb.r + 60, 255)}, ${Math.min(rgb.g + 60, 255)}, ${Math.min(rgb.b + 60, 255)}, 1)`)
  coreGradient.addColorStop(0.5, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)`)
  coreGradient.addColorStop(1, `rgba(${Math.max(rgb.r - 30, 0)}, ${Math.max(rgb.g - 30, 0)}, ${Math.max(rgb.b - 30, 0)}, 1)`)

  ctx.fillStyle = coreGradient
  ctx.beginPath()
  ctx.arc(centerX, centerY, currentRadius, 0, Math.PI * 2)
  ctx.fill()

  // 高光效果
  const highlight = ctx.createRadialGradient(
    centerX - currentRadius * 0.4,
    centerY - currentRadius * 0.4,
    0,
    centerX - currentRadius * 0.4,
    centerY - currentRadius * 0.4,
    currentRadius * 0.5
  )
  highlight.addColorStop(0, 'rgba(255, 255, 255, 0.6)')
  highlight.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)')
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
      orbState.color = '#34D399'  // 鲜艳的绿色 - 监听
      orbState.glow = 30
      break
    case 'thinking':
      orbState.color = '#FBBF24'  // 明亮的黄色 - 思考
      orbState.glow = 20
      break
    case 'speaking':
      orbState.color = '#F472B6'  // 亮粉色 - 说话
      orbState.glow = 25
      break
    default:
      orbState.color = '#60A5FA'  // 亮蓝色 - 闲置
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
