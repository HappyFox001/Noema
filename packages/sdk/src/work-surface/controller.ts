/**
 * In-memory state controller for Realtime Work Surface frames.
 *
 * The controller validates and applies schema-level updates without knowing
 * anything about renderer DOM details.
 */
import {
  WORK_SURFACE_SCHEMA_VERSION,
  type ComponentNode,
  type LayoutNode,
  type RuntimeBinding,
  type SurfaceCloseFrame,
  type SurfaceCreateFrame,
  type SurfaceMessageFrame,
  type SurfacePatchFrame,
  type SurfaceUserEvent,
  type UIPatch,
  type WorkSurfaceFrame,
  type WorkSurfaceSnapshot,
} from './types.js'

export interface WorkSurfaceControllerOptions {
  maxMessages?: number
}

export interface WorkSurfaceValidationResult {
  ok: boolean
  errors: string[]
}

export interface WorkSurfaceApplyResult {
  accepted: boolean
  errors: string[]
  snapshot?: WorkSurfaceSnapshot
}

export class WorkSurfaceController {
  private surfaces = new Map<string, WorkSurfaceSnapshot>()
  private readonly maxMessages: number

  constructor(options: WorkSurfaceControllerOptions = {}) {
    this.maxMessages = Math.max(1, options.maxMessages ?? 50)
  }

  applyFrame(frame: WorkSurfaceFrame): WorkSurfaceApplyResult {
    const validation = validateWorkSurfaceFrame(frame)
    if (!validation.ok) {
      return { accepted: false, errors: validation.errors }
    }

    switch (frame.type) {
      case 'surface.create':
        return this.applyCreate(frame)
      case 'surface.patch':
        return this.applyPatch(frame)
      case 'surface.focus':
        return this.applyUpdate(frame.surfaceId, (snapshot) => {
          snapshot.focusedId = frame.targetId
        })
      case 'surface.message':
        return this.applyMessage(frame)
      case 'surface.request_input':
        return this.applyUpdate(frame.surfaceId, (snapshot) => {
          snapshot.messages.push({
            schemaVersion: frame.schemaVersion,
            type: 'surface.message',
            surfaceId: frame.surfaceId,
            taskId: frame.taskId,
            timestamp: frame.timestamp ?? Date.now(),
            targetId: frame.targetId,
            tone: 'info',
            content: frame.prompt,
          })
          trimMessages(snapshot.messages, this.maxMessages)
        })
      case 'surface.close':
        return this.applyClose(frame)
    }
  }

  getSnapshot(surfaceId: string): WorkSurfaceSnapshot | undefined {
    const snapshot = this.surfaces.get(surfaceId)
    return snapshot ? cloneSnapshot(snapshot) : undefined
  }

  listSnapshots(): WorkSurfaceSnapshot[] {
    return Array.from(this.surfaces.values(), cloneSnapshot)
  }

  getSnapshotByTaskId(taskId: string): WorkSurfaceSnapshot | undefined {
    const snapshot = Array.from(this.surfaces.values()).find(surface => surface.taskId === taskId)
    return snapshot ? cloneSnapshot(snapshot) : undefined
  }

  restoreSnapshot(snapshot: WorkSurfaceSnapshot, readonly = true): WorkSurfaceApplyResult {
    const validation = validateWorkSurfaceSnapshot(snapshot)
    if (!validation.ok) {
      return { accepted: false, errors: validation.errors }
    }
    const restored = cloneSnapshot(snapshot)
    if (readonly && !restored.closedAt) {
      restored.closedAt = Date.now()
      restored.closeReason = restored.closeReason ?? 'completed'
    }
    this.surfaces.set(restored.surfaceId, restored)
    return { accepted: true, errors: [], snapshot: cloneSnapshot(restored) }
  }

  restoreSnapshots(snapshots: WorkSurfaceSnapshot[], readonly = true): WorkSurfaceApplyResult[] {
    return snapshots.map(snapshot => this.restoreSnapshot(snapshot, readonly))
  }

  closeSurface(surfaceId: string, reason: SurfaceCloseFrame['reason'] = 'user_closed'): WorkSurfaceApplyResult {
    return this.applyClose({
      schemaVersion: WORK_SURFACE_SCHEMA_VERSION,
      type: 'surface.close',
      surfaceId,
      reason,
      timestamp: Date.now(),
    })
  }

  reset(surfaceId?: string): void {
    if (surfaceId) {
      this.surfaces.delete(surfaceId)
      return
    }
    this.surfaces.clear()
  }

  applyUserEvent(event: SurfaceUserEvent): WorkSurfaceApplyResult {
    const snapshot = this.surfaces.get(event.surfaceId)
    if (!snapshot) {
      return { accepted: false, errors: [`Surface not found: ${event.surfaceId}`] }
    }

    if (event.type === 'surface.select') {
      snapshot.selectedIds = [...event.selectedIds]
      snapshot.updatedAt = event.timestamp ?? Date.now()
      return { accepted: true, errors: [], snapshot: cloneSnapshot(snapshot) }
    }

    return { accepted: true, errors: [], snapshot: cloneSnapshot(snapshot) }
  }

  private applyCreate(frame: SurfaceCreateFrame): WorkSurfaceApplyResult {
    const now = frame.timestamp ?? Date.now()
    const components = collectLayoutComponents(frame.layout)
    const snapshot: WorkSurfaceSnapshot = {
      schemaVersion: WORK_SURFACE_SCHEMA_VERSION,
      surfaceId: frame.surfaceId,
      taskId: frame.taskId,
      title: frame.title,
      mode: frame.mode,
      createdAt: now,
      updatedAt: now,
      layout: frame.layout,
      components,
      bindings: collectComponentBindings(components),
      selectedIds: [],
      messages: [],
    }
    this.surfaces.set(frame.surfaceId, snapshot)
    return { accepted: true, errors: [], snapshot: cloneSnapshot(snapshot) }
  }

  private applyPatch(frame: SurfacePatchFrame): WorkSurfaceApplyResult {
    return this.applyUpdate(frame.surfaceId, (snapshot) => {
      for (const patch of frame.patches) {
        applyPatchToSnapshot(snapshot, patch)
      }
    })
  }

  private applyMessage(frame: SurfaceMessageFrame): WorkSurfaceApplyResult {
    return this.applyUpdate(frame.surfaceId, (snapshot) => {
      snapshot.messages.push({ ...frame, timestamp: frame.timestamp ?? Date.now() })
      trimMessages(snapshot.messages, this.maxMessages)
    })
  }

  private applyClose(frame: SurfaceCloseFrame): WorkSurfaceApplyResult {
    return this.applyUpdate(frame.surfaceId, (snapshot) => {
      snapshot.closedAt = frame.timestamp ?? Date.now()
      snapshot.closeReason = frame.reason
    })
  }

  private applyUpdate(
    surfaceId: string,
    update: (snapshot: WorkSurfaceSnapshot) => void
  ): WorkSurfaceApplyResult {
    const snapshot = this.surfaces.get(surfaceId)
    if (!snapshot) {
      return { accepted: false, errors: [`Surface not found: ${surfaceId}`] }
    }

    try {
      update(snapshot)
      snapshot.updatedAt = Date.now()
      snapshot.bindings = collectComponentBindings(snapshot.components)
      return { accepted: true, errors: [], snapshot: cloneSnapshot(snapshot) }
    } catch (error) {
      return {
        accepted: false,
        errors: [error instanceof Error ? error.message : String(error)],
      }
    }
  }
}

export function validateWorkSurfaceFrame(frame: unknown): WorkSurfaceValidationResult {
  const errors: string[] = []
  if (!isRecord(frame)) {
    return { ok: false, errors: ['Frame must be an object'] }
  }

  if (frame.schemaVersion !== WORK_SURFACE_SCHEMA_VERSION) {
    errors.push(`Unsupported schemaVersion: ${String(frame.schemaVersion)}`)
  }
  if (typeof frame.type !== 'string') {
    errors.push('Frame type is required')
  }
  if (!isNonEmptyString(frame.surfaceId)) {
    errors.push('surfaceId is required')
  }

  switch (frame.type) {
    case 'surface.create':
      if (!isNonEmptyString(frame.title)) errors.push('title is required')
      if (!isRecord(frame.layout)) errors.push('layout is required')
      break
    case 'surface.patch':
      if (!Array.isArray(frame.patches)) errors.push('patches must be an array')
      break
    case 'surface.focus':
      if (!isNonEmptyString(frame.targetId)) errors.push('targetId is required')
      break
    case 'surface.message':
      if (!isNonEmptyString(frame.content)) errors.push('content is required')
      break
    case 'surface.request_input':
      if (!isNonEmptyString(frame.requestId)) errors.push('requestId is required')
      if (!isNonEmptyString(frame.prompt)) errors.push('prompt is required')
      if (!isRecord(frame.input)) errors.push('input is required')
      break
    case 'surface.close':
      break
    default:
      errors.push(`Unknown frame type: ${String(frame.type)}`)
  }

  return { ok: errors.length === 0, errors }
}

export function validateWorkSurfaceSnapshot(snapshot: unknown): WorkSurfaceValidationResult {
  const errors: string[] = []
  if (!isRecord(snapshot)) {
    return { ok: false, errors: ['Snapshot must be an object'] }
  }
  if (snapshot.schemaVersion !== WORK_SURFACE_SCHEMA_VERSION) {
    errors.push(`Unsupported schemaVersion: ${String(snapshot.schemaVersion)}`)
  }
  if (!isNonEmptyString(snapshot.surfaceId)) errors.push('surfaceId is required')
  if (!isNonEmptyString(snapshot.title)) errors.push('title is required')
  if (!isRecord(snapshot.layout)) errors.push('layout is required')
  if (!isRecord(snapshot.components)) errors.push('components are required')
  if (!Array.isArray(snapshot.selectedIds)) errors.push('selectedIds must be an array')
  if (!Array.isArray(snapshot.messages)) errors.push('messages must be an array')
  return { ok: errors.length === 0, errors }
}

function applyPatchToSnapshot(snapshot: WorkSurfaceSnapshot, patch: UIPatch): void {
  switch (patch.op) {
    case 'add':
      ensureComponentIdAvailable(snapshot, patch.component.id)
      snapshot.components[patch.component.id] = patch.component
      attachComponentToLayout(snapshot.layout, patch.parentId, patch.component.id)
      return
    case 'replace':
      ensureComponentExists(snapshot, patch.targetId)
      snapshot.components[patch.targetId] = patch.component
      return
    case 'update':
      ensureComponentExists(snapshot, patch.targetId)
      snapshot.components[patch.targetId] = {
        ...snapshot.components[patch.targetId],
        ...patch.props,
        id: patch.targetId,
      } as ComponentNode
      return
    case 'remove':
      ensureComponentExists(snapshot, patch.targetId)
      delete snapshot.components[patch.targetId]
      detachComponentFromLayout(snapshot.layout, patch.targetId)
      snapshot.selectedIds = snapshot.selectedIds.filter(id => id !== patch.targetId)
      return
    case 'bind':
      ensureComponentExists(snapshot, patch.targetId)
      snapshot.components[patch.targetId] = {
        ...snapshot.components[patch.targetId],
        bindings: appendBinding(snapshot.components[patch.targetId].bindings, patch.binding),
      } as ComponentNode
      return
  }
}

function collectLayoutComponents(layout: LayoutNode): Record<string, ComponentNode> {
  const components: Record<string, ComponentNode> = {}
  collectLayoutComponentsInto(layout, components)
  return components
}

function collectLayoutComponentsInto(layout: LayoutNode, components: Record<string, ComponentNode>): void {
  const embedded = (layout as LayoutNode & { component?: ComponentNode }).component
  if (embedded) {
    components[embedded.id] = embedded
    layout.componentId = embedded.id
    delete (layout as LayoutNode & { component?: ComponentNode }).component
  }
  for (const child of layout.children ?? []) {
    collectLayoutComponentsInto(child, components)
  }
}

function collectComponentBindings(components: Record<string, ComponentNode>): Record<string, RuntimeBinding[]> {
  const bindings: Record<string, RuntimeBinding[]> = {}
  for (const [id, component] of Object.entries(components)) {
    if (component.bindings?.length) {
      bindings[id] = [...component.bindings]
    }
  }
  return bindings
}

function attachComponentToLayout(layout: LayoutNode, parentId: string, componentId: string): boolean {
  if (layout.id === parentId) {
    layout.children = layout.children ?? []
    layout.children.push({
      id: `layout-${componentId}`,
      kind: 'stack',
      componentId,
    })
    return true
  }
  return (layout.children ?? []).some(child => attachComponentToLayout(child, parentId, componentId))
}

function detachComponentFromLayout(layout: LayoutNode, componentId: string): void {
  layout.children = (layout.children ?? []).filter(child => child.componentId !== componentId)
  for (const child of layout.children) {
    detachComponentFromLayout(child, componentId)
  }
}

function ensureComponentExists(snapshot: WorkSurfaceSnapshot, componentId: string): void {
  if (!snapshot.components[componentId]) {
    throw new Error(`Component not found: ${componentId}`)
  }
}

function ensureComponentIdAvailable(snapshot: WorkSurfaceSnapshot, componentId: string): void {
  if (snapshot.components[componentId]) {
    throw new Error(`Component already exists: ${componentId}`)
  }
}

function appendBinding(bindings: RuntimeBinding[] = [], next: RuntimeBinding): RuntimeBinding[] {
  const serialized = JSON.stringify(next)
  if (bindings.some(binding => JSON.stringify(binding) === serialized)) {
    return bindings
  }
  return [...bindings, next]
}

function trimMessages(messages: SurfaceMessageFrame[], maxMessages: number): void {
  if (messages.length > maxMessages) {
    messages.splice(0, messages.length - maxMessages)
  }
}

function cloneSnapshot(snapshot: WorkSurfaceSnapshot): WorkSurfaceSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as WorkSurfaceSnapshot
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
