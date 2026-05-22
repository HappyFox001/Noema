/**
 * IPC handlers for work surface snapshots, renderer events, and surface actions.
 */
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { dialog, shell, type BrowserWindow, type IpcMain } from 'electron'
import type {
  SurfaceUserEvent,
  WorkSurfaceController,
  WorkSurfaceSnapshot,
} from '@her-text/sdk'

type WorkSurfaceSelection = {
  surfaceId: string
  selectedIds: string[]
  bindings: Array<{ kind: string; path?: string }>
}

export function registerWorkSurfaceIpcHandlers(
  ipcMain: IpcMain,
  options: {
    getController(): WorkSurfaceController | null
    getRestoredSnapshots(): WorkSurfaceSnapshot[]
    getMainWindow(): BrowserWindow | null
    getStorageDir(): string
    getVoiceOutputEnabled(): boolean
    sendToRenderer(channel: string, ...args: unknown[]): void
    setLatestSelection(selection: WorkSurfaceSelection): void
    cancelCurrentTurn(options: { closeTTS?: boolean; reason?: 'manual' }): Promise<void>
    runTextConversationTurn(prompt: string, enableTTS: boolean): Promise<unknown>
  }
): void {
  ipcMain.handle('workSurface:ready', async () => {
    return { success: true }
  })

  ipcMain.handle('workSurface:requestSnapshot', async (_event, surfaceId?: string) => {
    const controller = options.getController()
    if (!controller) {
      return { success: false, error: 'Work surface is disabled' }
    }
    const snapshot = surfaceId
      ? controller.getSnapshot(surfaceId)
      : controller.listSnapshots()[0]
    return { success: true, snapshot }
  })

  ipcMain.handle('workSurface:listSnapshots', async () => {
    const controller = options.getController()
    const snapshots = controller ? controller.listSnapshots() : options.getRestoredSnapshots()
    return {
      success: true,
      snapshots: snapshots.map(snapshot => ({
        surfaceId: snapshot.surfaceId,
        taskId: snapshot.taskId,
        title: snapshot.title,
        mode: snapshot.mode,
        updatedAt: snapshot.updatedAt,
        closedAt: snapshot.closedAt,
      })),
    }
  })

  ipcMain.handle('workSurface:searchSnapshots', async (_event, query: string) => {
    const normalized = String(query || '').trim().toLowerCase()
    const controller = options.getController()
    const snapshots = controller ? controller.listSnapshots() : options.getRestoredSnapshots()
    return {
      success: true,
      snapshots: snapshots
        .filter(snapshot => !normalized || JSON.stringify({
          title: snapshot.title,
          taskId: snapshot.taskId,
          components: snapshot.components,
        }).toLowerCase().includes(normalized))
        .slice(0, 25)
        .map(snapshot => ({
          surfaceId: snapshot.surfaceId,
          taskId: snapshot.taskId,
          title: snapshot.title,
          mode: snapshot.mode,
          updatedAt: snapshot.updatedAt,
          closedAt: snapshot.closedAt,
        })),
    }
  })

  ipcMain.handle('workSurface:event', async (_event, userEvent: SurfaceUserEvent) => {
    const controller = options.getController()
    if (!controller) {
      return { success: false, error: 'Work surface is disabled' }
    }
    if (!userEvent || typeof userEvent !== 'object' || typeof userEvent.type !== 'string' || typeof userEvent.surfaceId !== 'string') {
      console.warn('[WorkSurface] Dropping invalid renderer event')
      return { success: false, error: 'Invalid work surface event' }
    }
    const result = controller.applyUserEvent({
      ...userEvent,
      timestamp: userEvent.timestamp ?? Date.now(),
    })
    if (!result.accepted) {
      return { success: false, error: result.errors.join('; ') }
    }
    if (result.snapshot) {
      options.sendToRenderer('workSurface:snapshot', result.snapshot)
    }
    if (
      userEvent.type === 'surface.select' ||
      userEvent.type === 'surface.action' ||
      userEvent.type === 'surface.input_submitted'
    ) {
      options.setLatestSelection({
        surfaceId: userEvent.surfaceId,
        selectedIds: userEvent.selectedIds ?? (userEvent.targetId ? [userEvent.targetId] : []),
        bindings: userEvent.bindings ?? [],
      })
    }
    if (userEvent.type === 'surface.action') {
      void handleWorkSurfaceAction(userEvent, options).catch((error) => {
        console.warn('[WorkSurface] Action failed:', error instanceof Error ? error.message : String(error))
      })
    }
    return { success: true }
  })
}

async function handleWorkSurfaceAction(
  event: Extract<SurfaceUserEvent, { type: 'surface.action' }>,
  options: {
    getController(): WorkSurfaceController | null
    getMainWindow(): BrowserWindow | null
    getStorageDir(): string
    getVoiceOutputEnabled(): boolean
    cancelCurrentTurn(options: { closeTTS?: boolean; reason?: 'manual' }): Promise<void>
    runTextConversationTurn(prompt: string, enableTTS: boolean): Promise<unknown>
  }
): Promise<void> {
  const actionId = String(event.actionId || '')
  if (!actionId) {
    throw new Error('Missing action id')
  }
  const snapshot = options.getController()?.getSnapshot(event.surfaceId)
  const action = snapshot ? findWorkSurfaceAction(snapshot, actionId, event.targetId) : null
  if (!action) {
    throw new Error(`Unknown work surface action: ${actionId}`)
  }
  if (isHighRiskWorkSurfaceAction(actionId, action)) {
    const confirmed = await confirmWorkSurfaceAction(options.getMainWindow(), action)
    if (!confirmed) {
      return
    }
  }
  if (actionId === 'cancel_task') {
    await options.cancelCurrentTurn({ closeTTS: true, reason: 'manual' })
    return
  }
  if (actionId === 'open_file') {
    const filePath = resolveWorkSurfaceActionFilePath(event, action)
    if (!filePath) {
      throw new Error('Open file action is missing a file path')
    }
    await shell.openPath(filePath)
    return
  }
  if (actionId === 'rerun_step') {
    const stepId = event.targetId || getActionPayloadValue(action, 'stepId')
    const prompt = [
      'Work surface requested rerun of a task step.',
      stepId ? `Step: ${stepId}` : '',
      event.payload ? `Payload: ${safeJsonStringify(event.payload)}` : '',
    ].filter(Boolean).join('\n')
    await options.runTextConversationTurn(prompt, options.getVoiceOutputEnabled())
    return
  }
  if (actionId === 'replay_task') {
    const prompt = [
      'Replay this completed work surface task from its saved snapshot.',
      event.targetId ? `Target: ${event.targetId}` : '',
      event.payload ? `Payload: ${safeJsonStringify(event.payload)}` : '',
    ].filter(Boolean).join('\n')
    await options.runTextConversationTurn(prompt, options.getVoiceOutputEnabled())
    return
  }
  if (actionId === 'export_surface_report') {
    const currentSnapshot = options.getController()?.getSnapshot(event.surfaceId)
    if (!currentSnapshot) {
      throw new Error('Cannot export missing work surface snapshot')
    }
    const reportPath = await exportWorkSurfaceReport(options.getStorageDir(), currentSnapshot)
    await shell.openPath(reportPath)
    return
  }
  const prompt = [
    `Work surface action selected: ${actionId}`,
    event.targetId ? `Target: ${event.targetId}` : '',
    event.payload ? `Payload: ${safeJsonStringify(event.payload)}` : '',
  ].filter(Boolean).join('\n')
  await options.runTextConversationTurn(prompt, options.getVoiceOutputEnabled())
}

async function exportWorkSurfaceReport(storageDir: string, snapshot: WorkSurfaceSnapshot): Promise<string> {
  const reportsDir = join(storageDir, 'work-surface-reports')
  await mkdir(reportsDir, { recursive: true })
  const filePath = join(reportsDir, `${snapshot.surfaceId.replace(/[^a-zA-Z0-9_-]+/g, '_')}.md`)
  const lines = [
    `# ${snapshot.title}`,
    '',
    `- Surface: ${snapshot.surfaceId}`,
    snapshot.taskId ? `- Task: ${snapshot.taskId}` : '',
    `- Updated: ${new Date(snapshot.updatedAt).toISOString()}`,
    '',
    ...Object.values(snapshot.components).flatMap(component => renderWorkSurfaceComponentReport(component)),
  ].filter(Boolean)
  await writeFile(filePath, lines.join('\n'), 'utf-8')
  return filePath
}

function renderWorkSurfaceComponentReport(component: any): string[] {
  const title = component.title || component.kind || component.id
  if (component.kind === 'markdown') {
    return [`## ${title}`, '', component.markdown || '', '']
  }
  if (component.kind === 'table') {
    const columns = component.columns ?? []
    const header = `| ${columns.map((column: any) => column.label || column.id).join(' | ')} |`
    const divider = `| ${columns.map(() => '---').join(' | ')} |`
    const rows = (component.rows ?? []).slice(0, 200).map((row: any) =>
      `| ${columns.map((column: any) => String(row.cells?.[column.id] ?? '').replace(/\|/g, '\\|')).join(' | ')} |`
    )
    return [`## ${title}`, '', header, divider, ...rows, '']
  }
  return [`## ${title}`, '', '```json', JSON.stringify(component, null, 2), '```', '']
}

function findWorkSurfaceAction(snapshot: WorkSurfaceSnapshot, actionId: string, targetId?: string): any | null {
  for (const component of Object.values(snapshot.components)) {
    if (component.kind === 'actions') {
      const action = component.actions.find(item => item.id === actionId && (!targetId || !item.targetId || item.targetId === targetId))
      if (action) {
        return action
      }
    }
    if (component.kind === 'table') {
      for (const row of component.rows) {
        const action = row.actions?.find(item => item.id === actionId && (!targetId || row.id === targetId || !item.targetId || item.targetId === targetId))
        if (action) {
          return action
        }
      }
    }
    if (component.kind === 'artifacts') {
      for (const artifact of component.artifacts) {
        const action = artifact.actions?.find(item => item.id === actionId && (!targetId || artifact.id === targetId || !item.targetId || item.targetId === targetId))
        if (action) {
          return action
        }
      }
    }
  }
  return null
}

function resolveWorkSurfaceActionFilePath(
  event: Extract<SurfaceUserEvent, { type: 'surface.action' }>,
  action: any
): string | null {
  const payloadPath = getPayloadPath(event.payload) || getActionPayloadValue(action, 'path')
  if (payloadPath) {
    return payloadPath
  }
  for (const binding of event.bindings ?? []) {
    if (binding.kind === 'file' && binding.path) {
      return binding.path
    }
  }
  return null
}

function getPayloadPath(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'path' in payload && typeof (payload as any).path === 'string') {
    return (payload as any).path
  }
  return null
}

function getActionPayloadValue(action: any, key: string): string | null {
  const value = action?.payload?.[key] ?? action?.payloadSchema?.default?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function isHighRiskWorkSurfaceAction(actionId: string, action: any): boolean {
  if (action?.variant === 'danger') {
    return true
  }
  return /delete|remove|cancel|reset|overwrite|shell|terminal|deploy|publish/i.test(actionId)
}

async function confirmWorkSurfaceAction(mainWindow: BrowserWindow | null, action: any): Promise<boolean> {
  if (!mainWindow) {
    return false
  }
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Continue'],
    defaultId: 0,
    cancelId: 0,
    title: 'Confirm work surface action',
    message: action?.label ? `Continue with "${action.label}"?` : 'Continue with this high-risk action?',
    detail: 'This action came from the work surface and may change task state or local files.',
  })
  return result.response === 1
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '[]'
  }
}
