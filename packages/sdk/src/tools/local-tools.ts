/**
 * Built-in local work tool registry.
 */
import type { Tool } from '@her-text/types'
import { createFileTools } from './local-file-tools.js'
import { createSearchTools } from './local-search-tools.js'
import { createShellTools } from './local-shell-tools.js'
import { createPatchTools } from './local-patch-tool.js'
import { createImageTools } from './local-image-tool.js'

export function createLocalTools(): Tool[] {
  return [
    ...createFileTools(),
    ...createSearchTools(),
    ...createShellTools(),
    ...createPatchTools(),
    ...createImageTools(),
  ]
}
