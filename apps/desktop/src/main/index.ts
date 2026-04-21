import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { TTSService } from './tts.js'
import { ConversationService } from './conversation.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DEV_SERVER_URL = 'http://127.0.0.1:5173'

let mainWindow: BrowserWindow | null = null
let ttsService: TTSService | null = null
let conversationService: ConversationService | null = null

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

app.whenReady().then(() => {
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

// ========== IPC Handlers ==========

// 初始化对话服务
ipcMain.handle('conversation:initialize', async (_, config) => {
  try {
    conversationService = new ConversationService()
    await conversationService.initialize(config)

    if (config.ttsApiKey?.trim()) {
      ttsService = new TTSService(config.ttsApiKey, config.ttsVoiceId, config.ttsModel)
    } else {
      ttsService = null
      console.log('[ConversationService] TTS disabled: missing Fish Audio API key')
    }

    if (ttsService) {
      // 设置 TTS 事件处理
      ttsService.on('audio', (audioData) => {
        mainWindow?.webContents.send('tts:audio', audioData)
      })

      ttsService.on('connected', () => {
        mainWindow?.webContents.send('tts:connected')
      })

      ttsService.on('closed', () => {
        mainWindow?.webContents.send('tts:closed')
      })

      ttsService.on('error', (error) => {
        mainWindow?.webContents.send('tts:error', error.message)
      })
    }

    return { success: true, ttsEnabled: Boolean(ttsService) }
  } catch (error: any) {
    console.error('Failed to initialize:', error)
    return { success: false, error: error.message }
  }
})

// 发送文本消息
ipcMain.handle('conversation:sendText', async (_, text, enableTTS) => {
  try {
    if (!conversationService) {
      throw new Error('Conversation service not initialized')
    }

    const shouldUseTTS = enableTTS && Boolean(ttsService)

    // 开始 TTS 流
    if (shouldUseTTS && ttsService) {
      await ttsService.startStreaming()
    }

    // 获取 LLM 响应流
    const responseStream = conversationService.chatStream(text)
    let fullResponse = ''
    let buffer = ''

    for await (const chunk of responseStream) {
      fullResponse += chunk
      buffer += chunk

      // 发送到渲染进程显示
      mainWindow?.webContents.send('conversation:response', fullResponse)

      // 推送到 TTS（每句话或达到一定长度）
      if (shouldUseTTS && ttsService && shouldFlushTTS(buffer)) {
        await ttsService.pushText(buffer)
        buffer = ''
      }
    }

    // 推送剩余文本到 TTS
    if (shouldUseTTS && ttsService && buffer.trim()) {
      await ttsService.pushText(buffer)
    }

    // 完成 TTS
    if (shouldUseTTS && ttsService) {
      await ttsService.finishStreaming()
    }

    return { success: true, response: fullResponse, ttsEnabled: shouldUseTTS }
  } catch (error: any) {
    console.error('Failed to send text:', error)
    return { success: false, error: error.message }
  }
})

// 停止 TTS
ipcMain.handle('tts:stop', async () => {
  try {
    await ttsService?.stop()
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// 清空历史
ipcMain.handle('conversation:clearHistory', async () => {
  try {
    conversationService?.clearHistory()
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// ========== Helper Functions ==========

function shouldFlushTTS(buffer: string): boolean {
  const trimmed = buffer.trim()
  return trimmed.length >= 18 || /[。！？.!?]\s*$/.test(trimmed)
}

console.log('Her-Text Electron app started')
