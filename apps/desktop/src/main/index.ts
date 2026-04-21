// 加载环境变量（必须在最开始）
import { config as dotenvConfig } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 加载 .env 文件
dotenvConfig({ path: join(__dirname, '../../.env') })

console.log('[Env] LLM_API_KEY loaded:', process.env.LLM_API_KEY ? '✓' : '✗')
console.log('[Env] LLM_MODEL:', process.env.LLM_MODEL || 'not set')
console.log('[Env] LLM_BASE_URL:', process.env.LLM_BASE_URL || 'not set')

import { app, BrowserWindow, ipcMain } from 'electron'
import { TTSService } from './tts.js'
import { HerTextSDK } from '@her-text/sdk'
import {
  initializePersonalityManager,
  getPersonalityManager,
  buildSDKConfig
} from './sdk-config.js'
const DEV_SERVER_URL = 'http://127.0.0.1:5173'

let mainWindow: BrowserWindow | null = null
let ttsService: TTSService | null = null
let sdkInstance: HerTextSDK | null = null

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

app.whenReady().then(async () => {
  // 初始化人格管理器
  await initializePersonalityManager()
  console.log('[App] Personality manager initialized')

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
    // 构建 SDK 配置（不从 renderer 接收）
    const sdkConfig = await buildSDKConfig()

    // 初始化完整的 HerTextSDK
    sdkInstance = await HerTextSDK.initialize(sdkConfig)
    console.log('[SDK] Initialized successfully')

    // 初始化 TTS（独立于 SDK）
    if (process.env.FISH_API_KEY?.trim()) {
      ttsService = new TTSService(
        process.env.FISH_API_KEY,
        process.env.FISH_VOICE_ID || '',
        process.env.FISH_MODEL || 's2-pro'
      )

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

      console.log('[TTS] Initialized successfully')
    } else {
      ttsService = null
      console.log('[TTS] Disabled: missing Fish Audio API key')
    }

    return {
      success: true,
      ttsEnabled: Boolean(ttsService),
      stats: sdkInstance.getStats()
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

    const shouldUseTTS = enableTTS && Boolean(ttsService)

    // 开始 TTS 流
    if (shouldUseTTS && ttsService) {
      await ttsService.startStreaming()
    }

    // 使用 SDK 的 chatStream（参数改为对象）
    const responseStream = sdkInstance.chatStream({
      text,
      timestamp: Date.now()
    })
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

    // 记忆会自动由 SDK 保存

    return { success: true, response: fullResponse, ttsEnabled: shouldUseTTS }
  } catch (error: any) {
    console.error('[Chat] Failed to send text:', error)
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
    // SDK 暂时没有 clearHistory 方法，可以通过重新初始化实现
    // 或者等待 SDK 添加此功能
    console.log('[Conversation] Clear history requested (not implemented in SDK)')
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// ========== SDK 相关 IPC Handlers ==========

// 获取记忆信息
ipcMain.handle('sdk:getMemory', async () => {
  if (!sdkInstance) return null

  try {
    // MemoryEngine 目前没有公开的 getter 方法
    // 可以在未来添加或者通过其他方式访问
    return {
      message: 'Memory API not yet implemented'
    }
  } catch (error: any) {
    console.error('[SDK] Failed to get memory:', error)
    return null
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

// ========== Helper Functions ==========

function shouldFlushTTS(buffer: string): boolean {
  const trimmed = buffer.trim()
  return trimmed.length >= 18 || /[。！？.!?]\s*$/.test(trimmed)
}

console.log('Her-Text Electron app started')
