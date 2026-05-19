/**
 * Shared Realtime Work Surface protocol types.
 *
 * These types define a constrained UI frame stream that agents can emit while
 * the desktop renderer keeps ownership of DOM, styling, validation, and user
 * interaction behavior.
 */
import type { TaskPlan, TaskRunState, TaskStepStatus } from '../session/task-plan.js'

export const WORK_SURFACE_SCHEMA_VERSION = 1

export type WorkSurfaceMode = 'task' | 'analysis' | 'browser' | 'document' | 'custom'

export type WorkSurfaceFrame =
  | SurfaceCreateFrame
  | SurfacePatchFrame
  | SurfaceFocusFrame
  | SurfaceMessageFrame
  | SurfaceRequestInputFrame
  | SurfaceCloseFrame

export interface WorkSurfaceFrameBase<TType extends string> {
  schemaVersion: typeof WORK_SURFACE_SCHEMA_VERSION
  type: TType
  surfaceId: string
  taskId?: string
  timestamp?: number
}

export interface SurfaceCreateFrame extends WorkSurfaceFrameBase<'surface.create'> {
  title: string
  mode: WorkSurfaceMode
  layout: LayoutNode
}

export interface SurfacePatchFrame extends WorkSurfaceFrameBase<'surface.patch'> {
  patches: UIPatch[]
}

export interface SurfaceFocusFrame extends WorkSurfaceFrameBase<'surface.focus'> {
  targetId: string
  reason?: string
}

export interface SurfaceMessageFrame extends WorkSurfaceFrameBase<'surface.message'> {
  content: string
  tone?: 'info' | 'warning' | 'error' | 'success'
  targetId?: string
}

export interface SurfaceRequestInputFrame extends WorkSurfaceFrameBase<'surface.request_input'> {
  requestId: string
  targetId?: string
  prompt: string
  input: SurfaceInputSpec
}

export interface SurfaceCloseFrame extends WorkSurfaceFrameBase<'surface.close'> {
  reason?: 'completed' | 'cancelled' | 'failed' | 'user_closed' | 'replaced'
}

export type UIPatch =
  | { op: 'add'; parentId: string; component: ComponentNode }
  | { op: 'replace'; targetId: string; component: ComponentNode }
  | { op: 'update'; targetId: string; props: Record<string, unknown> }
  | { op: 'remove'; targetId: string }
  | { op: 'bind'; targetId: string; binding: RuntimeBinding }

export interface LayoutNode {
  id: string
  kind: 'root' | 'row' | 'column' | 'stack' | 'split' | 'grid'
  children?: LayoutNode[]
  componentId?: string
  title?: string
  size?: 'compact' | 'normal' | 'wide' | 'fill'
  minSize?: number
}

export type ComponentNode =
  | MarkdownBlock
  | TaskPlanView
  | DataTable
  | ChartView
  | ArtifactGrid
  | FormPanel
  | ActionBar
  | TimelineView
  | InspectorPanel
  | StatusStrip

export interface ComponentBase<TKind extends string> {
  id: string
  kind: TKind
  title?: string
  bindings?: RuntimeBinding[]
  selectable?: boolean
  selected?: boolean
  loading?: boolean
  hidden?: boolean
}

export interface MarkdownBlock extends ComponentBase<'markdown'> {
  markdown: string
}

export interface TaskPlanView extends ComponentBase<'taskPlan'> {
  taskId?: string
  plan: TaskPlan
  currentStepId?: string
  runState?: TaskRunState
}

export interface DataTable extends ComponentBase<'table'> {
  columns: DataTableColumn[]
  rows: DataTableRow[]
  selectionMode?: 'none' | 'single' | 'multiple'
  sort?: { columnId: string; direction: 'asc' | 'desc' }
  filterText?: string
  pageSize?: number
}

export interface DataTableColumn {
  id: string
  label: string
  type?: 'text' | 'number' | 'date' | 'status' | 'file' | 'link'
  width?: number
  sortable?: boolean
}

export interface DataTableRow {
  id: string
  cells: Record<string, unknown>
  bindings?: RuntimeBinding[]
  actions?: SurfaceActionSpec[]
  selected?: boolean
}

export interface ChartView extends ComponentBase<'chart'> {
  chart: ChartSpec
}

export interface ChartSpec {
  type: 'bar' | 'line' | 'pie' | 'scatter'
  title?: string
  xKey?: string
  yKey?: string
  series?: Array<{ key: string; label?: string }>
  data: Array<Record<string, unknown>>
}

export interface ArtifactGrid extends ComponentBase<'artifacts'> {
  artifacts: ArtifactItem[]
}

export interface ArtifactItem {
  id: string
  title: string
  path?: string
  src?: string
  mimeType?: string
  kind?: 'file' | 'image' | 'webpage' | 'report' | 'custom'
  caption?: string
  createdAt?: number
  bindings?: RuntimeBinding[]
  actions?: SurfaceActionSpec[]
}

export interface FormPanel extends ComponentBase<'form'> {
  requestId: string
  prompt?: string
  fields: SurfaceFormField[]
  submitAction: string
  cancelAction?: string
}

export type SurfaceInputKind = 'text' | 'textarea' | 'password' | 'select' | 'checkbox' | 'number'

export interface SurfaceInputSpec {
  kind: SurfaceInputKind
  placeholder?: string
  options?: Array<{ label: string; value: string }>
  required?: boolean
  sensitivity?: 'normal' | 'secret' | 'verification'
}

export interface SurfaceFormField extends SurfaceInputSpec {
  id: string
  label: string
  value?: unknown
}

export interface ActionBar extends ComponentBase<'actions'> {
  actions: SurfaceActionSpec[]
}

export interface SurfaceActionSpec {
  id: string
  label: string
  variant?: 'primary' | 'secondary' | 'danger'
  targetId?: string
  disabled?: boolean
  loading?: boolean
  payloadSchema?: Record<string, unknown>
}

export interface TimelineView extends ComponentBase<'timeline'> {
  items: TimelineItem[]
}

export interface TimelineItem {
  id: string
  title: string
  description?: string
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'blocked'
  timestamp?: number
  bindings?: RuntimeBinding[]
}

export interface InspectorPanel extends ComponentBase<'inspector'> {
  targetId?: string
  properties: InspectorProperty[]
}

export interface InspectorProperty {
  id: string
  label: string
  value: unknown
}

export interface StatusStrip extends ComponentBase<'status'> {
  status: 'idle' | 'running' | 'waiting_user' | 'completed' | 'failed' | 'cancelled'
  label: string
  detail?: string
  taskId?: string
  stepStatus?: TaskStepStatus
}

export type RuntimeBinding =
  | { kind: 'task'; taskId: string }
  | { kind: 'task_step'; taskId: string; stepId: string }
  | { kind: 'tool_result'; taskId: string; toolCallId: string; path?: string }
  | { kind: 'file'; path: string; mimeType?: string }
  | { kind: 'memory'; memoryId: string }
  | { kind: 'custom'; source: string; id: string }

export type SurfaceUserEvent =
  | SurfaceSelectEvent
  | SurfaceActionEvent
  | SurfaceVoiceEvent
  | SurfaceTextEvent
  | SurfaceInputSubmittedEvent

export interface SurfaceUserEventBase<TType extends string> {
  type: TType
  surfaceId: string
  targetId?: string
  selectedIds?: string[]
  bindings?: RuntimeBinding[]
  timestamp?: number
}

export interface SurfaceSelectEvent extends SurfaceUserEventBase<'surface.select'> {
  targetId: string
  selectedIds: string[]
}

export interface SurfaceActionEvent extends SurfaceUserEventBase<'surface.action'> {
  actionId: string
  payload?: unknown
}

export interface SurfaceVoiceEvent extends SurfaceUserEventBase<'surface.voice'> {
  transcript: string
  selectedIds: string[]
}

export interface SurfaceTextEvent extends SurfaceUserEventBase<'surface.text'> {
  text: string
  selectedIds: string[]
}

export interface SurfaceInputSubmittedEvent extends SurfaceUserEventBase<'surface.input_submitted'> {
  requestId: string
  value: unknown
}

export interface WorkSurfaceSnapshot {
  schemaVersion: typeof WORK_SURFACE_SCHEMA_VERSION
  surfaceId: string
  taskId?: string
  title: string
  mode: WorkSurfaceMode
  createdAt: number
  updatedAt: number
  closedAt?: number
  closeReason?: SurfaceCloseFrame['reason']
  layout: LayoutNode
  components: Record<string, ComponentNode>
  bindings: Record<string, RuntimeBinding[]>
  selectedIds: string[]
  focusedId?: string
  messages: SurfaceMessageFrame[]
}
