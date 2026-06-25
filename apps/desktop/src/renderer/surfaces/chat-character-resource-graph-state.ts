/**
 * Defines serializable state for the character resource graph workbench.
 */
export type SerializedCharacterResourceLinkKind =
  | 'guides'
  | 'constrains'
  | 'provides'
  | 'enables'
  | 'grounds'
  | 'weights'
  | 'routes'
  | 'evaluates'
  | 'refines'
  | 'exports'

export interface SerializedCharacterResourceLink {
  id: string
  sourceNodeId: string
  sourceSlotId: string
  targetNodeId: string
  targetSlotId: string
  kind: SerializedCharacterResourceLinkKind
}

export interface CharacterResourceViewState {
  zoom?: number
  panX?: number
  panY?: number
  hideLinks?: boolean
  selectedNodeIds?: string[]
  selectionBox?: {
    x: number
    y: number
    width: number
    height: number
  } | null
  collapsedNodeIds?: string[]
  deletedNodeIds?: string[]
  duplicatedNodes?: Array<{
    id: string
    sourceId: string
    offsetX: number
    offsetY: number
  }>
  addedNodes?: Array<{
    id: string
    type: string
    title: string
    x: number
    y: number
  }>
  nodeSizes?: Record<string, { width: number; height: number }>
  selectedLinkId?: string
  linkKinds?: Record<string, SerializedCharacterResourceLinkKind>
  customLinks?: SerializedCharacterResourceLink[]
  deletedLinkIds?: string[]
  replacedTargetSlots?: string[]
  agentHighlights?: {
    nodeIds?: string[]
    linkIds?: string[]
    deletedNodeIds?: string[]
    deletedLinkIds?: string[]
    nodeActions?: Record<string, string>
    linkActions?: Record<string, string>
  }
}

export interface SerializedCharacterResourceGraph {
  schemaVersion: 2
  graphId: string
  activeTabId: string
  selectedNodeId: string
  viewState: CharacterResourceViewState
  configOverrides: Record<string, Record<string, unknown>>
  positionOverrides: Record<string, { x: number; y: number }>
  graphSnapshot: string
}

export function serializeCharacterResourceGraph(input: Omit<SerializedCharacterResourceGraph, 'schemaVersion'>): string {
  return JSON.stringify({
    schemaVersion: 2,
    ...input,
  } satisfies SerializedCharacterResourceGraph)
}

export function deserializeCharacterResourceGraph(serialized: string): SerializedCharacterResourceGraph {
  const parsed = JSON.parse(serialized) as Partial<SerializedCharacterResourceGraph>
  if (parsed.schemaVersion !== 2 || !parsed.graphId) {
    throw new Error('Unsupported character resource graph snapshot.')
  }
  return {
    schemaVersion: 2,
    graphId: parsed.graphId,
    activeTabId: parsed.activeTabId ?? 'workflow',
    selectedNodeId: parsed.selectedNodeId ?? 'generation-goal',
    viewState: parsed.viewState ?? {},
    configOverrides: parsed.configOverrides ?? {},
    positionOverrides: parsed.positionOverrides ?? {},
    graphSnapshot: parsed.graphSnapshot ?? '{}',
  }
}
