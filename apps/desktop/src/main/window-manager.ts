/**
 * Creates and sizes the Electron main window.
 */
import { BrowserWindow } from 'electron'
import { join } from 'path'

export const COMPACT_WINDOW_SIZE = { width: 380, height: 380 }
export const TASK_WINDOW_SIZE = { width: 600, height: 380 }
export const SETTINGS_WINDOW_SIZE = { width: 500, height: 600 }

export interface CreateMainWindowOptions {
  dirname: string
  devServerUrl: string
  isDevMode(): boolean
  appIconPath?: string
  onClosed(): void
}

export function resizeWindowAroundCenter(window: BrowserWindow, width: number, height: number): void {
  const bounds = window.getBounds()
  const nextX = Math.round(bounds.x + (bounds.width - width) / 2)
  const nextY = Math.round(bounds.y + (bounds.height - height) / 2)
  window.setBounds({ x: nextX, y: nextY, width, height }, false)
}

export async function createMainWindow(options: CreateMainWindowOptions): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: COMPACT_WINDOW_SIZE.width,
    height: COMPACT_WINDOW_SIZE.height,
    ...(options.appIconPath ? { icon: options.appIconPath } : {}),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      preload: join(options.dirname, 'preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  try {
    await loadRenderer(window, options)
  } catch (error) {
    console.error('[Electron] Failed to load renderer:', error)
  }

  window.on('closed', options.onClosed)
  return window
}

async function loadRenderer(window: BrowserWindow, options: CreateMainWindowOptions): Promise<void> {
  if (!options.isDevMode()) {
    await window.loadFile(join(options.dirname, 'renderer/index.html'))
    return
  }

  const maxAttempts = 20

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await window.loadURL(options.devServerUrl)
      window.webContents.openDevTools()
      return
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error
      }

      console.warn(`[Electron] Dev server not ready (${attempt}/${maxAttempts}), retrying...`)
      await new Promise((resolve) => setTimeout(resolve, 500))
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
}
