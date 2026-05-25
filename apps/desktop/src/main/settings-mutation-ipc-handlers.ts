/**
 * IPC handlers for mutating settings and refreshing runtime configuration.
 */
import { type IpcMain } from 'electron'
import type { AppSettings } from './settings-store.js'

export type RuntimeConfigSnapshot = {
  proxy: string
  llm: string
  taskLLM: string
  taskRuntime: string
  tts: string
  asr: string
}

export function registerSettingsMutationIpcHandlers(
  ipcMain: IpcMain,
  options: {
    isDevMode(): boolean
    getSettings(): AppSettings
    updateSettings(partial: Partial<AppSettings>): Promise<AppSettings>
    reloadSystemConfigFromEnv(): Promise<AppSettings>
    setSettings(settings: AppSettings): void
    getRuntimeConfigSnapshot(): RuntimeConfigSnapshot
    applyRuntimeSystemConfigChanges(
      previous: RuntimeConfigSnapshot,
      options?: { pluginsChanged?: boolean }
    ): Promise<void>
  }
): void {
  ipcMain.handle('settings:update', async (_, partial: Partial<AppSettings>) => {
    const previous = options.getRuntimeConfigSnapshot()
    const previousSettings = options.getSettings()
    const appSettings = await options.updateSettings(partial)

    const pluginsChanged =
      (partial.plugins !== undefined && previousSettings.plugins !== appSettings.plugins) ||
      (partial.pluginConfigs !== undefined && previousSettings.pluginConfigs !== appSettings.pluginConfigs)
    const selfLearningChanged = partial.experimental?.selfLearningEnabled !== undefined
    if (selfLearningChanged) {
      console.log('[SelfLearning] Enabled:', appSettings.experimental.selfLearningEnabled)
    }

    const runtimeSettingsChanged = partial.system !== undefined || pluginsChanged || selfLearningChanged
    if (runtimeSettingsChanged) {
      await options.applyRuntimeSystemConfigChanges(previous, { pluginsChanged: pluginsChanged || selfLearningChanged })
    }

    return appSettings
  })

  ipcMain.handle('settings:resetSystemFromEnv', async () => {
    if (!options.isDevMode()) {
      return { success: false, error: 'Reloading .env is only available in development mode.' }
    }
    try {
      const previous = options.getRuntimeConfigSnapshot()
      const appSettings = await options.reloadSystemConfigFromEnv()
      options.setSettings(appSettings)
      await options.applyRuntimeSystemConfigChanges(previous)
      return { success: true, settings: appSettings }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
}
