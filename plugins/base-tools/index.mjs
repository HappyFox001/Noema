/**
 * Base tools runtime plugin.
 *
 * Registers file and shell tools implemented inside this plugin.
 */
import { createBaseTools } from './src/tools.mjs'

export default function plugin(ctx) {
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
          if (IMAGE_TOOL_NAMES.has(tool.name)) {
            return enableReadTools
          }
          if (SHELL_TOOL_NAMES.has(tool.name)) {
            return enableShell
          }
          return true
        })
        .map(tool => {
          if (!SHELL_TOOL_NAMES.has(tool.name)) {
            return tool
          }
          return {
            ...tool,
            timeoutMs: shellTimeoutMs,
          }
        })
    },
    getToolStrategyHints() {
      return [
        {
          id: 'file-shell-loop',
          title: 'File and shell workflow',
          priority: 100,
          content: [
            '- Use glob/grep to locate unknown files or symbols, then read the relevant files before editing.',
            '- Prefer apply_patch for precise multi-file changes; if it fails, read nearby context and retry with a smaller patch.',
            '- For shell commands, inspect package scripts, docs, or existing commands before guessing; use exec_command background sessions for long-running processes.',
            '- After code changes, run the narrowest relevant build, test, or typecheck command when practical.',
          ].join('\n'),
        },
      ]
    },
  }
}

const READ_TOOL_NAMES = new Set(['read', 'glob', 'grep'])
const WRITE_TOOL_NAMES = new Set(['write', 'edit', 'apply_patch'])
const IMAGE_TOOL_NAMES = new Set(['view_image'])
const SHELL_TOOL_NAMES = new Set(['bash', 'exec_command', 'write_stdin', 'list_exec_sessions'])

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.max(min, Math.min(max, value))
}
