/**
 * IPC handlers for conversation lifecycle and clear/stop commands.
 */
import { type IpcMain } from 'electron'
import type { NoemaSDK } from '@noema/sdk'
import type { AppSettings } from './settings-store.js'

export interface ConversationTurnResult {
  success: boolean
  response?: string
  ttsEnabled?: boolean
  error?: string
}

export function registerConversationIpcHandlers(
  ipcMain: IpcMain,
  options: {
    getSdk(): NoemaSDK | null
    getSettings(): AppSettings
    getTtsEnabled(): boolean
    initializeSdk(): Promise<void>
    initializeTtsProvider(): Promise<void>
    runConversationTurn(text: string, enableTTS: boolean, source: 'text' | 'voice'): Promise<ConversationTurnResult>
    cancelCurrentTurn(options: { closeTTS?: boolean; reason?: 'manual' }): Promise<void>
    invalidateTTSContext(reason: 'manual'): void
    clearInteractiveInputs(): Promise<void>
  }
): void {
  ipcMain.handle('conversation:initialize', async () => {
    try {
      if (!options.getSdk()) {
        await options.initializeSdk()
      }

      await options.initializeTtsProvider()

      return {
        success: true,
        ttsEnabled: options.getTtsEnabled(),
        settings: options.getSettings(),
        stats: options.getSdk()?.getStats(),
      }
    } catch (error: any) {
      console.error('[Initialization] Failed:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('conversation:sendText', async (_, text, enableTTS) => {
    return options.runConversationTurn(text, enableTTS, 'text')
  })

  ipcMain.handle('tts:stop', async () => {
    try {
      await options.cancelCurrentTurn({ closeTTS: true, reason: 'manual' })
      options.invalidateTTSContext('manual')
      return { success: true }
    } catch (error: any) {
      console.error('[TTS] Failed to stop:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('conversation:clearHistory', async () => {
    try {
      const sdk = options.getSdk()
      if (sdk) {
        await sdk.memory.clearAll()
        sdk.clearHistory()
      }
      await options.clearInteractiveInputs()
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('profile:clear', async () => {
    try {
      const sdk = options.getSdk()
      if (!sdk) {
        throw new Error('SDK not initialized')
      }

      await sdk.memory.clearUserProfile()
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
}
