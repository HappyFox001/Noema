/**
 * IPC handlers for personality selection and SDK metadata reads.
 */
import { dialog, type BrowserWindow, type IpcMain, type OpenDialogOptions } from 'electron'
import type { NoemaSDK } from '@noema/sdk'
import type { AppSettings } from './settings-store.js'

type PersonalityManagerLike = {
  listRoleItems(externalRolePaths: string[]): Promise<unknown[]>
  setCurrentPersonality(ref: string): Promise<void>
  validateRoleFile(filePath: string): Promise<void>
}

export function registerPersonalityIpcHandlers(
  ipcMain: IpcMain,
  options: {
    getSdk(): NoemaSDK | null
    getMainWindow(): BrowserWindow | null
    getPersonalityManager(): PersonalityManagerLike
    getSettings(): AppSettings
    updateSettings(partial: Partial<AppSettings>): Promise<AppSettings>
    rebuildSdk(): Promise<void>
  }
): void {
  ipcMain.handle('sdk:getPersonality', async () => {
    const sdk = options.getSdk()
    if (!sdk) return null

    try {
      return sdk.personality.getPersonality()
    } catch (error: any) {
      console.error('[SDK] Failed to get personality:', error)
      return null
    }
  })

  ipcMain.handle('personality:list', async () => {
    try {
      const settings = options.getSettings()
      const personalityManager = options.getPersonalityManager()
      return {
        success: true,
        current: settings.selectedPersonality,
        items: await personalityManager.listRoleItems(settings.externalRolePaths),
      }
    } catch (error: any) {
      return { success: false, error: error.message, items: [] }
    }
  })

  ipcMain.handle('personality:set', async (_, ref: string) => {
    try {
      const personalityManager = options.getPersonalityManager()
      await personalityManager.setCurrentPersonality(ref)
      await options.updateSettings({ selectedPersonality: ref })
      await options.rebuildSdk()
      return { success: true, current: ref }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('personality:addFile', async () => {
    try {
      const dialogOptions: OpenDialogOptions = {
        title: '选择角色 JSON 文件',
        properties: ['openFile'],
        filters: [
          { name: 'Character Profile', extensions: ['json'] },
        ],
      }
      const mainWindow = options.getMainWindow()
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true }
      }

      const filePath = result.filePaths[0]
      const personalityManager = options.getPersonalityManager()
      await personalityManager.validateRoleFile(filePath)

      const externalRolePaths = Array.from(new Set([
        ...options.getSettings().externalRolePaths,
        filePath,
      ]))
      await options.updateSettings({ externalRolePaths })

      const ref = `file:${filePath}`
      return {
        success: true,
        item: {
          id: ref,
          name: filePath.split(/[\\/]/).pop()?.replace(/\.json$/i, '') ?? filePath,
          path: filePath,
          source: 'file',
        },
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('sdk:getStats', async () => {
    const sdk = options.getSdk()
    if (!sdk) return null

    try {
      return sdk.getStats()
    } catch (error: any) {
      console.error('[SDK] Failed to get stats:', error)
      return null
    }
  })
}
