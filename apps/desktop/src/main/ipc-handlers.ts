/**
 * Registers grouped Electron IPC handlers for desktop main services.
 */
import type { IpcMain } from 'electron'
import type { AppLogStore } from './app-log-store.js'

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
