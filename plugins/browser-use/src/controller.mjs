import { BrowserWindow, session } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'
import {
  buildClickScript,
  buildDropdownOptionsScript,
  buildEvalScript,
  buildExtractScript,
  buildFindTextScript,
  buildGetScript,
  buildInputScript,
  buildMarkFileInputScript,
  buildMouseActionScript,
  buildSelectScript,
  buildStateScript,
  buildTypeScript,
  buildWaitConditionScript,
} from './page-scripts.mjs'
import { clampInteger, domainMatches, normalizeKey, normalizeModifier, normalizeUrl, truncate } from './utils.mjs'

export class ElectronBrowserController {
  constructor(options) {
    this.options = options
    this.windows = []
    this.activeIndex = -1
  }

  async open(rawUrl) {
    const url = normalizeUrl(rawUrl)
    this.assertAllowedUrl(url)
    await this.ensureWindow()
    await this.loadURL(url)
    return this.currentPageSummary()
  }

  async search(query, engine = this.options.searchEngine || 'duckduckgo') {
    const normalizedEngine = String(engine || 'duckduckgo').toLowerCase()
    const encoded = encodeURIComponent(String(query || '').trim())
    if (!encoded) {
      return { success: false, error: 'query is required' }
    }

    const searchUrl = {
      google: `https://www.google.com/search?q=${encoded}`,
      bing: `https://www.bing.com/search?q=${encoded}`,
      duckduckgo: `https://duckduckgo.com/?q=${encoded}`,
    }[normalizedEngine] || `https://duckduckgo.com/?q=${encoded}`

    return this.open(searchUrl)
  }

  async state() {
    await this.ensureWindow()
    return this.webContents.executeJavaScript(buildStateScript(this.options.maxStateElements), true)
  }

  async observe() {
    try {
      return await this.state()
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async click(index) {
    await this.ensureWindow()
    const result = await this.webContents.executeJavaScript(buildClickScript(Number(index)), true)
    await this.wait(300)
    return result
  }

  async mouse(index, action) {
    await this.ensureWindow()
    const result = await this.webContents.executeJavaScript(buildMouseActionScript(Number(index), action), true)
    await this.wait(150)
    return result
  }

  async input(index, text) {
    await this.ensureWindow()
    const result = await this.webContents.executeJavaScript(buildInputScript(Number(index), String(text ?? '')), true)
    await this.wait(200)
    return result
  }

  async type(text) {
    await this.ensureWindow()
    const result = await this.webContents.executeJavaScript(buildTypeScript(String(text ?? '')), true)
    await this.wait(100)
    return result
  }

  async keys(keys) {
    await this.ensureWindow()
    const parts = String(keys || '').split('+').map(part => part.trim()).filter(Boolean)
    if (parts.length === 0) {
      return { success: false, error: 'No keys provided' }
    }

    const key = normalizeKey(parts[parts.length - 1])
    const modifiers = parts.slice(0, -1).map(normalizeModifier).filter(Boolean)
    this.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers })
    this.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers })
    await this.wait(100)
    return { success: true, keys: String(keys) }
  }

  async scroll(direction, amount) {
    await this.ensureWindow()
    const pixels = clampInteger(Number(amount ?? 700), 1, 5000)
    const delta = direction === 'up' ? -pixels : pixels
    const result = await this.webContents.executeJavaScript(
      `window.scrollBy({ top: ${delta}, behavior: 'smooth' }); ({ success: true, scrollY: window.scrollY, delta: ${delta} })`,
      true
    )
    await this.wait(250)
    return result
  }

  async findText(text) {
    await this.ensureWindow()
    return this.webContents.executeJavaScript(buildFindTextScript(String(text ?? '')), true)
  }

  async wait(ms) {
    const duration = clampInteger(Number(ms ?? 1000), 0, 30000)
    await new Promise(resolve => setTimeout(resolve, duration))
    return { success: true, waitedMs: duration }
  }

  async waitFor(mode, value, timeoutMs = 10000) {
    await this.ensureWindow()
    const timeout = clampInteger(Number(timeoutMs), 100, 60000)
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeout) {
      const found = await this.webContents.executeJavaScript(
        `(() => {
          function normalizeText(text) { return String(text).replace(/\\s+/g, ' ').trim(); }
          return ${buildWaitConditionScript(mode, value)};
        })()`,
        true
      )
      if (found) {
        return { success: true, mode, value, waitedMs: Date.now() - startedAt }
      }
      await this.wait(250)
    }
    return { success: false, error: 'Wait timed out', mode, value, timeoutMs: timeout }
  }

  async extract(maxChars) {
    await this.ensureWindow()
    return this.webContents.executeJavaScript(buildExtractScript(clampInteger(Number(maxChars ?? 6000), 500, 30000)), true)
  }

  async get(kind, index, selector, maxChars) {
    await this.ensureWindow()
    return this.webContents.executeJavaScript(
      buildGetScript(kind, index, selector, clampInteger(Number(maxChars ?? 6000), 200, 50000)),
      true
    )
  }

  async evaluate(code) {
    await this.ensureWindow()
    const result = await this.webContents.executeJavaScript(buildEvalScript(String(code ?? '')), true)
    return { success: true, result }
  }

  async select(index, value) {
    await this.ensureWindow()
    return this.webContents.executeJavaScript(buildSelectScript(Number(index), String(value ?? '')), true)
  }

  async upload(index, paths) {
    await this.ensureWindow()
    const files = Array.isArray(paths) ? paths : [paths]
    const resolvedFiles = files.map(file => resolve(String(file))).filter(Boolean)
    if (resolvedFiles.length === 0) {
      return { success: false, error: 'At least one file path is required' }
    }

    const markerId = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const marked = await this.webContents.executeJavaScript(buildMarkFileInputScript(Number(index), markerId), true)
    if (!marked.success) {
      return marked
    }

    const debuggerApi = this.webContents.debugger
    const attachedBefore = debuggerApi.isAttached()
    if (!attachedBefore) {
      debuggerApi.attach('1.3')
    }

    try {
      const document = await debuggerApi.sendCommand('DOM.getDocument', { depth: -1, pierce: true })
      const { nodeId } = await debuggerApi.sendCommand('DOM.querySelector', {
        nodeId: document.root.nodeId,
        selector: marked.selector,
      })
      if (!nodeId) {
        return { success: false, error: 'Marked file input not found through CDP', index }
      }
      await debuggerApi.sendCommand('DOM.setFileInputFiles', {
        nodeId,
        files: resolvedFiles,
      })
      await this.webContents.executeJavaScript(
        `(() => {
          const element = document.querySelector(${JSON.stringify(marked.selector)});
          element?.dispatchEvent(new Event('input', { bubbles: true }));
          element?.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`,
        true
      )
      return { success: true, index, files: resolvedFiles }
    } finally {
      if (!attachedBefore && debuggerApi.isAttached()) {
        debuggerApi.detach()
      }
    }
  }

  async dropdownOptions(index) {
    await this.ensureWindow()
    return this.webContents.executeJavaScript(buildDropdownOptionsScript(Number(index)), true)
  }

  async screenshot() {
    await this.ensureWindow()
    const image = await this.webContents.capturePage()
    return {
      success: true,
      mimeType: 'image/png',
      base64: image.toPNG().toString('base64'),
    }
  }

  async savePdf(path) {
    await this.ensureWindow()
    if (!path) {
      return { success: false, error: 'path is required' }
    }
    const outputPath = resolve(String(path))
    const data = await this.webContents.printToPDF({ printBackground: true })
    await writeFile(outputPath, data)
    return { success: true, path: outputPath, bytes: data.length }
  }

  async back() {
    await this.ensureWindow()
    if (this.webContents.canGoBack()) {
      this.webContents.goBack()
      await this.waitForPageSettled()
    }
    return this.currentPageSummary()
  }

  async reload() {
    await this.ensureWindow()
    this.webContents.reload()
    await this.waitForPageSettled()
    return this.currentPageSummary()
  }

  async tab(action, index, url) {
    if (action === 'list') {
      return this.tabList()
    }

    if (action === 'new') {
      const created = await this.createWindow()
      if (url) {
        const targetUrl = normalizeUrl(url)
        this.assertAllowedUrl(targetUrl)
        await created.loadURL(targetUrl)
        await this.waitForPageSettled()
      }
      return this.tabList()
    }

    if (action === 'switch') {
      const targetIndex = clampInteger(Number(index), 0, Math.max(0, this.windows.length - 1))
      if (!this.windows[targetIndex] || this.windows[targetIndex].isDestroyed()) {
        return { success: false, error: 'Tab index not found', index }
      }
      this.activeIndex = targetIndex
      if (this.options.headed) {
        this.windows[targetIndex].show()
        this.windows[targetIndex].focus()
      }
      return this.tabList()
    }

    if (action === 'close') {
      const targetIndex = index === undefined ? this.activeIndex : Number(index)
      const target = this.windows[targetIndex]
      if (!target || target.isDestroyed()) {
        return { success: false, error: 'Tab index not found', index: targetIndex }
      }
      target.close()
      this.windows.splice(targetIndex, 1)
      this.activeIndex = this.windows.length > 0 ? Math.min(targetIndex, this.windows.length - 1) : -1
      return this.tabList()
    }

    return { success: false, error: 'Unsupported tab action', action }
  }

  async cookies(action, args = {}) {
    await this.ensureWindow()
    const cookieStore = this.webContents.session.cookies

    if (action === 'get') {
      return { success: true, cookies: await cookieStore.get(args.url ? { url: args.url } : {}) }
    }

    if (action === 'set') {
      if (!args.url || !args.name || args.value === undefined) {
        return { success: false, error: 'url, name, and value are required for set' }
      }
      await cookieStore.set({
        url: args.url,
        name: args.name,
        value: String(args.value),
        ...(args.domain ? { domain: args.domain } : {}),
        ...(args.path ? { path: args.path } : {}),
        ...(args.secure !== undefined ? { secure: Boolean(args.secure) } : {}),
        ...(args.httpOnly !== undefined ? { httpOnly: Boolean(args.httpOnly) } : {}),
      })
      return { success: true }
    }

    if (action === 'clear') {
      const cookies = await cookieStore.get(args.url ? { url: args.url } : {})
      await Promise.all(cookies.map(cookie => cookieStore.remove(args.url || this.webContents.getURL(), cookie.name)))
      return { success: true, cleared: cookies.length }
    }

    if (action === 'export') {
      if (!args.path) return { success: false, error: 'path is required for export' }
      const cookies = await cookieStore.get({})
      await writeFile(args.path, JSON.stringify(cookies, null, 2), 'utf8')
      return { success: true, path: args.path, count: cookies.length }
    }

    if (action === 'import') {
      if (!args.path) return { success: false, error: 'path is required for import' }
      const cookies = JSON.parse(await readFile(args.path, 'utf8'))
      await Promise.all(cookies.map(cookie => cookieStore.set(cookie)))
      return { success: true, path: args.path, count: cookies.length }
    }

    return { success: false, error: 'Unsupported cookies action', action }
  }

  async close() {
    for (const browserWindow of this.windows) {
      if (!browserWindow.isDestroyed()) {
        browserWindow.close()
      }
    }
    this.windows = []
    this.activeIndex = -1
    return { success: true }
  }

  get webContents() {
    const active = this.windows[this.activeIndex]
    if (!active || active.isDestroyed()) {
      throw new Error('Browser window is not available')
    }
    return active.webContents
  }

  async ensureWindow() {
    if (this.activeIndex >= 0 && this.windows[this.activeIndex] && !this.windows[this.activeIndex].isDestroyed()) {
      return
    }
    await this.createWindow()
  }

  async createWindow() {
    const partition = this.options.sessionPartition || 'persist:her-text-browser-use'
    const browserWindow = new BrowserWindow({
      width: 1100,
      height: 760,
      show: Boolean(this.options.headed),
      title: 'Her Text Browser Use',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        session: session.fromPartition(partition),
      },
    })

    this.windows.push(browserWindow)
    this.activeIndex = this.windows.length - 1

    browserWindow.on('closed', () => {
      const index = this.windows.indexOf(browserWindow)
      if (index >= 0) {
        this.windows.splice(index, 1)
        this.activeIndex = this.windows.length > 0 ? Math.min(this.activeIndex, this.windows.length - 1) : -1
      }
    })

    return browserWindow
  }

  async loadURL(url) {
    await this.ensureWindow()
    await this.webContents.loadURL(url)
    await this.waitForPageSettled()
  }

  async waitForPageSettled() {
    await this.wait(500)
    try {
      await this.webContents.executeJavaScript(
        `new Promise(resolve => {
          if (document.readyState === 'complete') return resolve(true);
          window.addEventListener('load', () => resolve(true), { once: true });
          setTimeout(() => resolve(false), 5000);
        })`,
        true
      )
    } catch {
      // Some navigations detach the frame while waiting. The next state call will surface any real issue.
    }
  }

  async currentPageSummary() {
    await this.ensureWindow()
    return {
      success: true,
      url: this.webContents.getURL(),
      title: await this.webContents.getTitle(),
      activeTab: this.activeIndex,
    }
  }

  async tabList() {
    const tabs = await Promise.all(this.windows.map(async (browserWindow, index) => ({
      index,
      active: index === this.activeIndex,
      closed: browserWindow.isDestroyed(),
      url: browserWindow.isDestroyed() ? '' : browserWindow.webContents.getURL(),
      title: browserWindow.isDestroyed() ? '' : truncate(await browserWindow.webContents.getTitle(), 120),
    })))
    return { success: true, activeTab: this.activeIndex, tabs }
  }

  assertAllowedUrl(rawUrl) {
    const allowed = this.options.allowedDomains || []
    if (allowed.length === 0) {
      return
    }

    const url = new URL(rawUrl)
    const hostname = url.hostname.toLowerCase()
    const ok = allowed.some(domain => domainMatches(hostname, domain))
    if (!ok) {
      throw new Error(`Navigation blocked by allowedDomains: ${hostname}`)
    }
  }
}
