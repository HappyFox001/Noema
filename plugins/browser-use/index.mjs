import { definePlugin } from '@her-text/sdk'
import { ElectronBrowserController } from './src/controller.mjs'
import { createBrowserTools } from './src/tools.mjs'
import { clampInteger, parseDomains } from './src/utils.mjs'

export default definePlugin((ctx) => {
  const config = ctx.config || {}
  const controller = new ElectronBrowserController({
    headed: config.headed !== false,
    sessionPartition: String(config.sessionPartition || 'persist:her-text-browser-use'),
    allowedDomains: parseDomains(String(config.allowedDomains || '')),
    maxStateElements: clampInteger(Number(config.maxStateElements ?? 80), 20, 200),
    searchEngine: String(config.searchEngine || 'duckduckgo'),
  })

  return {
    id: 'browser-use',
    name: 'Browser Use',
    registerTools() {
      return createBrowserTools(controller, {
        timeoutMs: clampInteger(Number(config.actionTimeoutMs ?? 120000), 5000, 300000),
        enableScreenshots: config.enableScreenshots !== false,
        autoObserve: config.autoObserve !== false,
      })
    },
  }
})
