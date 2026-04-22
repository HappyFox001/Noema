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

import { app, BrowserWindow, ipcMain } from 'electron'
import { HerTextSDK, FishTTSOfficial } from '@her-text/sdk'
import {
  initializePersonalityManager,
  getPersonalityManager,
  buildSDKConfig
} from './sdk-config.js'
const DEV_SERVER_URL = 'http://127.0.0.1:5173'

// This app uses a transparent frameless window and simple canvas effects.
// Disabling GPU avoids macOS/Electron ANGLE initialization failures.
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')

let mainWindow: BrowserWindow | null = null
let ttsService: FishTTSOfficial | null = null
let sdkInstance: HerTextSDK | null = null
let ttsAvailable = true

function configureProxyFromEnv(): void {
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.ALL_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy ||
    process.env.all_proxy

  if (!proxyUrl?.trim()) {
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
    console.log('[Proxy] Enabled global proxy for Node/Electron:', proxyUrl)
  } catch (error) {
    console.warn('[Proxy] Failed to enable global proxy:', error)
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

    let shouldUseTTS = enableTTS && Boolean(ttsService) && ttsAvailable

    // 开始 TTS 流（捕获连接错误）
    if (shouldUseTTS && ttsService) {
      try {
        await ttsService.startStreaming()
      } catch (error: any) {
        console.warn('[TTS] Failed to start streaming:', error.message)
        console.warn('[TTS] Continuing without TTS...')
        ttsAvailable = false
        shouldUseTTS = false // 禁用 TTS 但继续执行
        await ttsService.close().catch(() => undefined)
      }
    }

    // 使用 SDK 的 chatStream，TTS 分句逻辑由 SDK 处理
    const responseStream = sdkInstance.chatStream(
      {
        text,
        timestamp: Date.now()
      },
      shouldUseTTS && ttsService
        ? {
            onTTSChunk: async (chunk) => {
              if (!ttsAvailable) {
                return
              }

              try {
                console.log('[Main] onTTSChunk called, pushing:', chunk)
                await ttsService!.pushText(chunk)
              } catch (error: any) {
                ttsAvailable = false
                console.warn('[TTS] Failed to push chunk:', error.message)
              }
            }
          }
        : undefined
    )

    let fullResponse = ''
    for await (const chunk of responseStream) {
      fullResponse += chunk
      // 发送到渲染进程显示
      mainWindow?.webContents.send('conversation:response', fullResponse)
    }

    // 完成 TTS（SDK 已经正确处理关闭）
    if (shouldUseTTS && ttsService) {
      try {
        await ttsService.finishStreaming()
      } catch (error: any) {
        ttsAvailable = false
        console.warn('[TTS] Failed to finish streaming:', error.message)
      }
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

console.log('Her-Text Electron app started')
