import { ElectronBrowserController } from './src/controller.mjs'
import { createBrowserTools } from './src/tools.mjs'
import { clampInteger, parseDomains } from './src/utils.mjs'

export default function plugin(ctx) {
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
    getToolStrategyHints() {
      return [
        {
          id: 'browser-loop',
          title: 'Browser workflow',
          priority: 80,
          content: [
            '- Use browser_open or browser_search to enter a page, then browser_state to inspect URL, title, text, and numbered elements.',
            '- Use tool_search when a browser action is needed but the specific browser tool is not currently visible.',
            '- Prefer browser_state element indexes over coordinate clicks; observe state after navigation, click, form input, scroll, and wait.',
          ].join('\n'),
        },
      ]
    },
  }
}
