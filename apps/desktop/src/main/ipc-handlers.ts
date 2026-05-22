/**
 * Registers grouped Electron IPC handlers for desktop main services.
 */
import type { IpcMain } from 'electron'
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
