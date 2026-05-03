/**
 * Base tools runtime plugin.
 *
 * Registers file and shell tools implemented inside this plugin.
 */
import { createBaseTools } from './src/tools.mjs'

export default function createPlugin(ctx) {
  const config = ctx.config || {}
  const enableReadTools = config.enableReadTools !== false
  const enableWriteTools = config.enableWriteTools !== false
  const enableShell = config.enableShell !== false
  const shellTimeoutMs = clampNumber(Number(config.shellTimeoutMs ?? 30000), 1000, 120000)

  return {
    id: 'base-tools',
    name: 'Base Tools',
    registerTools() {
      return createBaseTools()
        .filter(tool => {
          if (READ_TOOL_NAMES.has(tool.name)) {
            return enableReadTools
          }
          if (WRITE_TOOL_NAMES.has(tool.name)) {
            return enableWriteTools
          }
          if (tool.name === 'bash') {
            return enableShell
          }
          return true
        })
        .map(tool => {
          if (tool.name !== 'bash') {
            return tool
          }
          return {
            ...tool,
            timeoutMs: shellTimeoutMs,
          }
        })
    },
  }
}

const READ_TOOL_NAMES = new Set(['read', 'glob', 'grep'])
const WRITE_TOOL_NAMES = new Set(['write', 'edit'])

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.max(min, Math.min(max, value))
}
