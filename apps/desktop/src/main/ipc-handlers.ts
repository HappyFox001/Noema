/**
 * Registers grouped Electron IPC handlers for desktop main services.
 */
import { BrowserWindow, screen, type IpcMain } from 'electron'
import type { AppLogStore } from './app-log-store.js'
import type { AppSettings } from './settings-store.js'

export function registerLogIpcHandlers(ipcMain: IpcMain, appLogStore: AppLogStore): void {
  ipcMain.handle('logs:list', async (_, limit?: number) => {
    return {
      success: true,
      logs: appLogStore.list(Number(limit) || undefined),
    }
  })

  ipcMain.handle('logs:clear', async () => {
    appLogStore.clear()
    return { success: true }
  })

  ipcMain.on('logs:setStreaming', (_, streaming: boolean) => {
    appLogStore.setRendererStreaming(streaming === true)
  })
}

export function registerDebugIpcHandlers(
  ipcMain: IpcMain,
  frameTraceObserver: {
    getTrace(): unknown[]
    clear(): void
  }
): void {
  ipcMain.handle('debug:frameTrace', async () => {
    return frameTraceObserver.getTrace()
  })

  ipcMain.handle('debug:clearFrameTrace', async () => {
    frameTraceObserver.clear()
    return { success: true }
  })
}

export function registerSystemIpcHandlers(
  ipcMain: IpcMain,
  options: {
    isDevMode(): boolean
    getTelemetry(): {
      success: true
      memoryBytes: number
      activeNetworkInterfaces: number
      proxyActive: boolean
      activeProxyUrl: string
    }
  }
): void {
  ipcMain.handle('system:telemetry', async () => options.getTelemetry())
  ipcMain.handle('app:isDevMode', () => options.isDevMode())
}

export function registerSettingsReadIpcHandlers(
  ipcMain: IpcMain,
  options: {
    getSettings(): AppSettings
  }
): void {
  ipcMain.handle('settings:get', async () => options.getSettings())
}

export function registerWindowIpcHandlers(
  ipcMain: IpcMain,
  options: {
    compactWindowSize: { width: number; height: number }
    settingsWindowSize: { width: number; height: number }
    taskWindowSize: { width: number; height: number }
    resizeWindowAroundCenter(window: BrowserWindow, width: number, height: number): void
  }
): void {
  ipcMain.on('window:move', (event, deltaX, deltaY) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      const [x, y] = win.getPosition()
      win.setPosition(x + deltaX, y + deltaY)
    }
  })

  ipcMain.handle('cursor:get-screen-point', () => {
    const point = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(point)
    return {
      x: point.x,
      y: point.y,
      displayBounds: display.bounds,
    }
  })

  ipcMain.on('window:set-compact-mode', (event, compact) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) {
      return
    }

    const size = compact ? options.compactWindowSize : options.settingsWindowSize
    options.resizeWindowAroundCenter(win, size.width, size.height)
  })

  ipcMain.on('window:set-task-mode', (event, active) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) {
      return
    }

    const size = active ? options.taskWindowSize : options.compactWindowSize
    options.resizeWindowAroundCenter(win, size.width, size.height)
  })
}
