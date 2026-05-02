import type { Tool } from '@her-text/types'


export * from './types.js'

export { ReadTool, readToolSpec } from './file/read.js'
export { WriteTool, writeToolSpec } from './file/write.js'
export { EditTool, editToolSpec } from './file/edit.js'
export { GlobTool, globToolSpec } from './file/glob.js'
export { GrepTool, grepToolSpec } from './file/grep.js'

export { BashTool, bashToolSpec } from './shell/bash.js'

import { ReadTool } from './file/read.js'
import { WriteTool } from './file/write.js'
import { EditTool } from './file/edit.js'
import { GlobTool } from './file/glob.js'
import { GrepTool } from './file/grep.js'
import { BashTool } from './shell/bash.js'


export function createBaseTools(): Tool[] {
  const executors = [
    new ReadTool(),
    new WriteTool(),
    new EditTool(),
    new GlobTool(),
    new GrepTool(),
    new BashTool()
  ]

  return executors.map(executor => ({
    name: executor.spec.function.name,
    description: executor.spec.function.description,
    parameters: executor.spec.function.parameters,
    pluginId: 'base-tools',
    safety: getBaseToolSafety(executor.spec.function.name),
    execute: async (params: any) => executor.execute(params)
  }))
}

/**
 * @deprecated Use createBaseTools() from the base-tools plugin.
 */
export function createDefaultTools(): Tool[] {
  return createBaseTools()
}

function getBaseToolSafety(name: string): Tool['safety'] {
  if (name === 'read' || name === 'grep' || name === 'glob') {
    return 'read'
  }

  if (name === 'write' || name === 'edit') {
    return 'write'
  }

  if (name === 'bash') {
    return 'external'
  }

  return 'safe'
}
