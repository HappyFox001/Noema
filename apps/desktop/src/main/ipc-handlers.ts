/**
 * Registers grouped Electron IPC handlers for desktop main services.
 */
import { BrowserWindow, clipboard, screen, type IpcMain } from 'electron'
import type { AppLogStore } from './app-log-store.js'
import type { AppSettings } from './settings-store.js'

interface CaptureRect {
  x: number
  y: number
  width: number
  height: number
  scaleFactor?: number
}

function normalizeCaptureRect(rect: CaptureRect, bounds: { width: number; height: number }): CaptureRect | null {
  const scaleFactor = Number.isFinite(Number(rect.scaleFactor))
    ? Math.max(1, Math.min(4, Number(rect.scaleFactor)))
    : 1
  const x = Math.max(0, Math.floor(Number(rect.x) * scaleFactor))
  const y = Math.max(0, Math.floor(Number(rect.y) * scaleFactor))
  const width = Math.max(1, Math.ceil(Number(rect.width) * scaleFactor))
  const height = Math.max(1, Math.ceil(Number(rect.height) * scaleFactor))
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(scaleFactor)) {
    return null
  }

  const clampedWidth = Math.min(width, Math.max(0, bounds.width - x))
  const clampedHeight = Math.min(height, Math.max(0, bounds.height - y))
  if (clampedWidth < 1 || clampedHeight < 1) {
    return null
  }

  return {
    x,
    y,
    width: clampedWidth,
    height: clampedHeight,
    scaleFactor,
  }
}

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

  ipcMain.handle('window:capture-to-clipboard', async (event, rect: CaptureRect) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) {
      return { success: false, error: 'Window is not available' }
    }

    const scaleFactor = Number.isFinite(Number(rect.scaleFactor))
      ? Math.max(1, Math.min(4, Number(rect.scaleFactor)))
      : 1
    const bounds = win.getContentBounds()
    const pixelBounds = {
      width: Math.round(bounds.width * scaleFactor),
      height: Math.round(bounds.height * scaleFactor),
    }
    const normalized = normalizeCaptureRect(rect, pixelBounds)
    if (!normalized) {
      return { success: false, error: 'Invalid capture area' }
    }

    try {
      const image = await win.webContents.capturePage(normalized)
      if (image.isEmpty()) {
        return { success: false, error: 'Capture returned an empty image' }
      }
      clipboard.writeImage(image)
      const size = image.getSize()
      return {
        success: true,
        width: size.width,
        height: size.height,
      }
    } catch (error: any) {
      return { success: false, error: error.message || String(error) }
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

export function registerMemoryIpcHandlers(
  ipcMain: IpcMain,
  options: {
    getSdk(): any | null
    getInteractiveInputStore(): {
      list(): Promise<unknown[]>
      delete(key: string): Promise<void>
      clear(): Promise<void>
    } | null
  }
): void {
  const requireSdk = () => {
    const sdk = options.getSdk()
    if (!sdk) {
      return { sdk: null, error: { success: false, error: 'SDK not initialized' } }
    }
    return { sdk, error: null }
  }

  ipcMain.handle('memory:getUserProfile', async () => {
    const { sdk, error } = requireSdk()
    if (!sdk) return error

    try {
      const profile = sdk.memory.getUserProfile()
      const importantMemories: Record<string, string> = {}
      if (profile.importantMemories instanceof Map) {
        profile.importantMemories.forEach((value: string, key: string) => {
          importantMemories[key] = value
        })
      } else if (profile.importantMemories && typeof profile.importantMemories === 'object') {
        Object.entries(profile.importantMemories as Record<string, unknown>).forEach(([key, value]) => {
          importantMemories[key] = String(value)
        })
      }

      return {
        success: true,
        profile: {
          basic: profile.basic,
          importantMemories,
        },
      }
    } catch (error: any) {
      console.error('[Memory] Failed to get user profile:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:updateUserProfile', async (_, updates: Record<string, string>) => {
    const { sdk, error } = requireSdk()
    if (!sdk) return error

    try {
      await sdk.memory.updateUserProfileBasic(updates)
      return { success: true }
    } catch (error: any) {
      console.error('[Memory] Failed to update user profile:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:addImportantMemory', async (_, key: string, value: string) => {
    const { sdk, error } = requireSdk()
    if (!sdk) return error

    try {
      await sdk.memory.addImportantMemory(key, value)
      return { success: true }
    } catch (error: any) {
      console.error('[Memory] Failed to add important memory:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:deleteImportantMemory', async (_, key: string) => {
    const { sdk, error } = requireSdk()
    if (!sdk) return error

    try {
      await sdk.memory.deleteImportantMemory(key)
      return { success: true }
    } catch (error: any) {
      console.error('[Memory] Failed to delete important memory:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:getConversationSummaries', async () => {
    const { sdk, error } = requireSdk()
    if (!sdk) return error

    try {
      const summaries = sdk.memory.getAllConversationSummaries()
      return { success: true, summaries }
    } catch (error: any) {
      console.error('[Memory] Failed to get conversation summaries:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:getWorkingMemory', async () => {
    const { sdk, error } = requireSdk()
    if (!sdk) return error

    try {
      const recentTurns = sdk.memory.getWorkingMemory()
      return { success: true, memory: { recentTurns } }
    } catch (error: any) {
      console.error('[Memory] Failed to get working memory:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:deleteConversationSummary', async (_, id: string) => {
    const { sdk, error } = requireSdk()
    if (!sdk) return error

    try {
      await sdk.memory.deleteConversationSummary(id)
      return { success: true }
    } catch (error: any) {
      console.error('[Memory] Failed to delete conversation summary:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:deleteConversationTurn', async (_, id: string) => {
    const { sdk, error } = requireSdk()
    if (!sdk) return error

    try {
      await sdk.memory.deleteConversationTurn(id)
      return { success: true }
    } catch (error: any) {
      console.error('[Memory] Failed to delete conversation turn:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:deleteProfileField', async (_, field: string) => {
    const { sdk, error } = requireSdk()
    if (!sdk) return error

    try {
      await sdk.memory.deleteProfileField(field)
      return { success: true }
    } catch (error: any) {
      console.error('[Memory] Failed to delete profile field:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:clearImportantMemories', async () => {
    const { sdk, error } = requireSdk()
    if (!sdk) return error

    try {
      await sdk.memory.clearImportantMemories()
      return { success: true }
    } catch (error: any) {
      console.error('[Memory] Failed to clear important memories:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:clearConversationSummaries', async () => {
    const { sdk, error } = requireSdk()
    if (!sdk) return error

    try {
      await sdk.memory.clearConversationSummaries()
      return { success: true }
    } catch (error: any) {
      console.error('[Memory] Failed to clear conversation summaries:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:clearWorkingMemory', async () => {
    const { sdk, error } = requireSdk()
    if (!sdk) return error

    try {
      await sdk.memory.clearWorkingMemory()
      return { success: true }
    } catch (error: any) {
      console.error('[Memory] Failed to clear working memory:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:listAccountInputs', async () => {
    const interactiveInputStore = options.getInteractiveInputStore()
    if (!interactiveInputStore) return { success: false, error: 'Interactive input store not initialized' }

    try {
      const inputs = await interactiveInputStore.list()
      return { success: true, inputs }
    } catch (error: any) {
      console.error('[Memory] Failed to list account inputs:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:deleteAccountInput', async (_, key: string) => {
    const interactiveInputStore = options.getInteractiveInputStore()
    if (!interactiveInputStore) return { success: false, error: 'Interactive input store not initialized' }

    try {
      await interactiveInputStore.delete(key)
      return { success: true }
    } catch (error: any) {
      console.error('[Memory] Failed to delete account input:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:clearAccountInputs', async () => {
    const interactiveInputStore = options.getInteractiveInputStore()
    if (!interactiveInputStore) return { success: false, error: 'Interactive input store not initialized' }

    try {
      await interactiveInputStore.clear()
      return { success: true }
    } catch (error: any) {
      console.error('[Memory] Failed to clear account inputs:', error)
      return { success: false, error: error.message }
    }
  })
}

export function registerLearningIpcHandlers(
  ipcMain: IpcMain,
  options: {
    getSdk(): any | null
    isSelfLearningEnabled(): boolean
  }
): void {
  const requireLearning = () => {
    const sdk = options.getSdk()
    if (!sdk) {
      return { sdk: null, error: { success: false, error: 'SDK not initialized' } }
    }
    if (!options.isSelfLearningEnabled()) {
      return { sdk: null, error: { success: false, error: 'Self-learning is disabled.' } }
    }
    return { sdk, error: null }
  }

  ipcMain.handle('learning:overview', async () => {
    const sdk = options.getSdk()
    if (!sdk) return { success: false, error: 'SDK not initialized' }
    if (!options.isSelfLearningEnabled()) {
      return {
        success: true,
        disabled: true,
        events: [],
        reflections: [],
        candidates: [],
        assets: [],
        agents: [],
        automationDecisions: [],
        rollbacks: [],
      }
    }

    try {
      const [
        events,
        reflections,
        pendingCandidates,
        assets,
        agents,
        automationDecisions,
        rollbacks,
      ] = await Promise.all([
        sdk.learning.listEvents(80),
        sdk.learning.listReflections(20),
        sdk.learning.listCandidates(undefined, 50),
        sdk.learning.listAssets(undefined, 80),
        sdk.agentSociety.listAgents(),
        sdk.learning.listAutomationDecisions(50),
        sdk.learning.listAssetRollbacks(undefined, 50),
      ])
      return {
        success: true,
        events,
        reflections,
        candidates: pendingCandidates,
        assets,
        agents,
        automationDecisions,
        rollbacks,
      }
    } catch (error: any) {
      console.error('[Learning] Failed to load overview:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('learning:reflectRecent', async () => {
    const { sdk, error } = requireLearning()
    if (!sdk) return error

    try {
      const result = await sdk.reflection.reflectRecentEvents()
      return { success: true, result }
    } catch (error: any) {
      console.error('[Learning] Failed to reflect recent events:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('learning:deployCandidate', async (_event, payload: {
    candidateId: string
    scope: string
    status?: 'draft' | 'active'
  }) => {
    const { sdk, error } = requireLearning()
    if (!sdk) return error

    try {
      const asset = await sdk.learning.deployCandidate({
        candidateId: payload.candidateId,
        scope: payload.scope,
        status: payload.status ?? 'draft',
      })
      return { success: true, asset }
    } catch (error: any) {
      console.error('[Learning] Failed to deploy candidate:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('learning:setAssetStatus', async (_event, id: string, status: 'draft' | 'active' | 'disabled' | 'archived') => {
    const { sdk, error } = requireLearning()
    if (!sdk) return error

    try {
      await sdk.learning.setAssetStatus(id, status)
      return { success: true }
    } catch (error: any) {
      console.error('[Learning] Failed to set asset status:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('learning:deleteAsset', async (_event, id: string) => {
    const { sdk, error } = requireLearning()
    if (!sdk) return error

    try {
      await sdk.learning.deleteAsset(id)
      return { success: true }
    } catch (error: any) {
      console.error('[Learning] Failed to delete asset:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('learning:rollbackAsset', async (_event, id: string, reason: string) => {
    const { sdk, error } = requireLearning()
    if (!sdk) return error

    try {
      const rollback = await sdk.learning.rollbackAsset(id, reason || 'Rolled back from Learning Center')
      return { success: true, rollback }
    } catch (error: any) {
      console.error('[Learning] Failed to rollback asset:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('learning:setAgentStatus', async (_event, id: string, status: 'draft' | 'active' | 'disabled') => {
    const { sdk, error } = requireLearning()
    if (!sdk) return error

    try {
      await sdk.agentSociety.setAgentStatus(id, status)
      return { success: true }
    } catch (error: any) {
      console.error('[Learning] Failed to set agent status:', error)
      return { success: false, error: error.message }
    }
  })
}
