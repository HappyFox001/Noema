/**
 * Local computer-use runtime plugin.
 *
 * Registers native desktop observation and input tools for the current machine.
 */
import { createComputerUseTools } from './src/tools.mjs'
import { createLocalComputerController } from './src/controller.mjs'

export default function plugin(ctx) {
  const config = ctx.config || {}
  const controller = createLocalComputerController({
    dataDir: ctx.dataDir,
    screenshotFormat: String(config.screenshotFormat || 'base64'),
  })

  return {
    id: 'computer-use',
    name: 'Computer Use',
    registerTools() {
      return createComputerUseTools(controller, {
        timeoutMs: clampInteger(Number(config.actionTimeoutMs ?? 30000), 1000, 120000),
        autoObserve: config.autoObserve !== false,
      })
    },
  }
}

function clampInteger(value, min, max) {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.max(min, Math.min(max, Math.trunc(value)))
}
