import { BrowserWindow, session } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'
import {
  buildDropdownOptionsScript,
  buildEvalScript,
  buildExtractScript,
  buildFindTextScript,
  buildGetScript,
  buildMarkFileInputScript,
  buildSelectScript,
  buildStateScript,
  buildWaitConditionScript,
} from './page-scripts.mjs'
import { clampInteger, domainMatches, getPlatformSelectModifier, normalizeKey, normalizeModifier, normalizeUrl, truncate } from './utils.mjs'

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

  async snapshot(args = {}) {
    await this.ensureWindow()
    const maxAxNodes = clampInteger(Number(args.maxAxNodes ?? this.options.maxAxNodes ?? 120), 20, 500)
    const maxDomNodes = clampInteger(Number(args.maxDomNodes ?? this.options.maxDomNodes ?? 200), 20, 1000)
    const includeDomSnapshot = args.includeDomSnapshot !== false
    const includeAccessibility = args.includeAccessibility !== false
    const page = await this.currentPageSummary()
    const layout = await this.captureLayoutMetrics()
    const accessibility = includeAccessibility ? await this.captureAccessibilityTree(maxAxNodes) : undefined
    const domSnapshot = includeDomSnapshot ? await this.captureDomSnapshot(maxDomNodes) : undefined

    return {
      success: true,
      page,
      layout,
      accessibility,
      domSnapshot,
      note: 'Snapshot is captured through Chrome DevTools Protocol. Coordinates are viewport CSS pixels.',
    }
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

  async observeDetailed(args = {}) {
    await this.ensureWindow()
    const mode = String(args.mode || 'state')
    const includeState = mode === 'state' || mode === 'snapshot' || mode === 'visual' || mode === 'full'
    const includeSnapshot = mode === 'snapshot' || mode === 'full'
    const includeScreenshot = mode === 'visual' || mode === 'full'
    const observation = {
      success: true,
      mode,
      page: await this.currentPageSummary(),
    }

    if (includeState) {
      observation.state = await this.state()
    }
    if (includeSnapshot) {
      observation.snapshot = await this.snapshot(args)
    }
    if (includeScreenshot) {
      observation.screenshot = await this.screenshot()
    }

    return observation
  }

  async click(index) {
    await this.ensureWindow()
    const target = await this.getElementTarget(Number(index))
    if (!target.success) {
      return target
    }

    const result = await this.clickAt(target.center.x, target.center.y, { clickCount: 1 })
    await this.wait(300)
    return { success: true, index: Number(index), element: target.element, coordinate: target.center, action: result }
  }

  async clickCoordinate(x, y, clickCount = 1) {
    await this.ensureWindow()
    if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) {
      return { success: false, error: 'x and y coordinates are required when index is omitted' }
    }
    const coordinate = this.normalizeViewportCoordinate(x, y)
    const result = await this.clickAt(coordinate.x, coordinate.y, { clickCount })
    await this.wait(300)
    return { success: true, coordinate, action: result }
  }

  async mouse(index, action) {
    await this.ensureWindow()
    const target = await this.getElementTarget(Number(index))
    if (!target.success) {
      return target
    }

    const point = target.center
    let result
    if (action === 'hover') {
      result = this.sendMouseMove(point.x, point.y)
    } else if (action === 'double_click') {
      result = await this.clickAt(point.x, point.y, { clickCount: 2 })
    } else if (action === 'right_click') {
      result = await this.clickAt(point.x, point.y, { button: 'right', clickCount: 1 })
    } else {
      return { success: false, error: 'Unsupported mouse action', action }
    }
    await this.wait(150)
    return { success: true, action, index: Number(index), element: target.element, coordinate: point, result }
  }

  async input(index, text, clear = true) {
    await this.ensureWindow()
    const target = await this.getElementTarget(Number(index))
    if (!target.success) {
      return target
    }

    await this.clickAt(target.center.x, target.center.y, { clickCount: 1 })
    if (clear !== false) {
      await this.sendShortcut(`${getPlatformSelectModifier()}+A`)
      this.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' })
      this.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' })
    }
    const value = String(text ?? '')
    if (value) {
      await this.webContents.insertText(value)
    }
    await this.wait(200)
    return { success: true, index: Number(index), value, clear: clear !== false, element: target.element }
  }

  async type(text) {
    await this.ensureWindow()
    const value = String(text ?? '')
    if (value) {
      await this.webContents.insertText(value)
    }
    await this.wait(100)
    return { success: true, typed: value }
  }

  async keys(keys) {
    await this.ensureWindow()
    const result = await this.sendShortcut(keys)
    await this.wait(100)
    return result
  }

  async scroll(direction, amount) {
    await this.ensureWindow()
    const pixels = clampInteger(Number(amount ?? 700), 1, 5000)
    const deltaY = direction === 'up' ? -pixels : pixels
    this.webContents.sendInputEvent({ type: 'mouseWheel', x: 10, y: 10, deltaY, canScroll: true })
    await this.wait(250)
    const scroll = await this.webContents.executeJavaScript('({ x: window.scrollX, y: window.scrollY })', true)
    return { success: true, scroll, deltaY }
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

  async captureLayoutMetrics() {
    return this.withDebugger(async debuggerApi => {
      const metrics = await debuggerApi.sendCommand('Page.getLayoutMetrics')
      const viewport = metrics.visualViewport || {}
      const layoutViewport = metrics.layoutViewport || {}
      return {
        visualViewport: {
          x: Math.round(viewport.pageX ?? 0),
          y: Math.round(viewport.pageY ?? 0),
          width: Math.round(viewport.clientWidth ?? layoutViewport.clientWidth ?? 0),
          height: Math.round(viewport.clientHeight ?? layoutViewport.clientHeight ?? 0),
          scale: viewport.scale ?? 1,
        },
        layoutViewport: {
          x: Math.round(layoutViewport.pageX ?? 0),
          y: Math.round(layoutViewport.pageY ?? 0),
          width: Math.round(layoutViewport.clientWidth ?? 0),
          height: Math.round(layoutViewport.clientHeight ?? 0),
        },
      }
    })
  }

  async captureAccessibilityTree(maxNodes) {
    return this.withDebugger(async debuggerApi => {
      const result = await debuggerApi.sendCommand('Accessibility.getFullAXTree')
      const nodes = Array.isArray(result.nodes) ? result.nodes : []
      const interactiveRoles = new Set([
        'button',
        'link',
        'textbox',
        'searchbox',
        'checkbox',
        'radio',
        'combobox',
        'listbox',
        'menuitem',
        'tab',
        'switch',
        'slider',
        'spinbutton',
      ])
      const visibleNodes = nodes
        .filter(node => !node.ignored)
        .filter(node => interactiveRoles.has(readAxValue(node.role)) || readAxValue(node.name))
        .slice(0, maxNodes)
        .map(node => ({
          nodeId: node.nodeId,
          backendDOMNodeId: node.backendDOMNodeId,
          role: readAxValue(node.role),
          name: truncate(readAxValue(node.name), 180),
          value: truncate(readAxValue(node.value), 180),
          description: truncate(readAxValue(node.description), 180),
          childIds: Array.isArray(node.childIds) ? node.childIds.slice(0, 12) : [],
        }))

      return {
        nodeCount: nodes.length,
        returned: visibleNodes.length,
        nodes: visibleNodes,
      }
    })
  }

  async captureDomSnapshot(maxNodes) {
    return this.withDebugger(async debuggerApi => {
      const result = await debuggerApi.sendCommand('DOMSnapshot.captureSnapshot', {
        computedStyles: ['display', 'visibility', 'opacity', 'pointer-events'],
        includeDOMRects: true,
        includePaintOrder: true,
      })
      const strings = result.strings || []
      const documents = Array.isArray(result.documents) ? result.documents : []
      const summaries = documents.map((document, documentIndex) => {
        const nodes = document.nodes || {}
        const layout = document.layout || {}
        const nodeNames = nodes.nodeName || []
        const nodeValues = nodes.nodeValue || []
        const attributes = nodes.attributes || []
        const textValueIndexes = nodes.textValue || {}
        const layoutNodeIndexes = layout.nodeIndex || []
        const bounds = layout.bounds || []
        const paintOrders = layout.paintOrders || []
        const returnedNodes = []
        const layoutByNode = new Map()

        for (let i = 0; i < layoutNodeIndexes.length; i += 1) {
          layoutByNode.set(layoutNodeIndexes[i], {
            bounds: Array.isArray(bounds[i])
              ? {
                  x: Math.round(bounds[i][0] ?? 0),
                  y: Math.round(bounds[i][1] ?? 0),
                  width: Math.round(bounds[i][2] ?? 0),
                  height: Math.round(bounds[i][3] ?? 0),
                }
              : undefined,
            paintOrder: paintOrders[i],
          })
        }

        for (let nodeIndex = 0; nodeIndex < Math.min(nodeNames.length, maxNodes); nodeIndex += 1) {
          const tag = readSnapshotString(strings, nodeNames[nodeIndex])
          const textIndex = Array.isArray(textValueIndexes.index) ? textValueIndexes.index.indexOf(nodeIndex) : -1
          const text = textIndex >= 0 && Array.isArray(textValueIndexes.value)
            ? readSnapshotString(strings, textValueIndexes.value[textIndex])
            : readSnapshotString(strings, nodeValues[nodeIndex])
          returnedNodes.push({
            nodeIndex,
            tag,
            text: truncate(text, 120),
            attributes: readSnapshotAttributes(strings, attributes[nodeIndex]).slice(0, 12),
            layout: layoutByNode.get(nodeIndex),
          })
        }

        return {
          documentIndex,
          url: readSnapshotString(strings, document.documentURL),
          title: readSnapshotString(strings, document.title),
          nodeCount: nodeNames.length,
          layoutCount: layoutNodeIndexes.length,
          returned: returnedNodes.length,
          nodes: returnedNodes,
        }
      })

      return {
        documents: summaries,
      }
    })
  }

  async getElementTarget(index) {
    if (!Number.isInteger(index) || index < 0) {
      return { success: false, error: 'Element index must be a non-negative integer', index }
    }
    const state = await this.state()
    const element = Array.isArray(state.elements) ? state.elements[index] : undefined
    if (!element?.bbox) {
      return { success: false, error: 'Element index not found', index }
    }

    const bbox = element.bbox
    const coordinate = this.normalizeViewportCoordinate(
      Number(bbox.x) + Number(bbox.width) / 2,
      Number(bbox.y) + Number(bbox.height) / 2
    )
    return {
      success: true,
      index,
      element,
      center: coordinate,
    }
  }

  normalizeViewportCoordinate(x, y) {
    return {
      x: Math.max(0, Math.round(Number(x) || 0)),
      y: Math.max(0, Math.round(Number(y) || 0)),
    }
  }

  sendMouseMove(x, y) {
    const coordinate = this.normalizeViewportCoordinate(x, y)
    this.webContents.sendInputEvent({ type: 'mouseMove', x: coordinate.x, y: coordinate.y, button: 'none' })
    return { success: true, coordinate }
  }

  async clickAt(x, y, options = {}) {
    const coordinate = this.normalizeViewportCoordinate(x, y)
    const button = options.button || 'left'
    const clickCount = clampInteger(Number(options.clickCount ?? 1), 1, 3)
    this.webContents.sendInputEvent({ type: 'mouseMove', x: coordinate.x, y: coordinate.y, button: 'none' })
    for (let count = 1; count <= clickCount; count += 1) {
      this.webContents.sendInputEvent({ type: 'mouseDown', x: coordinate.x, y: coordinate.y, button, clickCount: count })
      this.webContents.sendInputEvent({ type: 'mouseUp', x: coordinate.x, y: coordinate.y, button, clickCount: count })
    }
    return { success: true, coordinate, button, clickCount }
  }

  async sendShortcut(keys) {
    const parts = String(keys || '').split('+').map(part => part.trim()).filter(Boolean)
    if (parts.length === 0) {
      return { success: false, error: 'No keys provided' }
    }

    const key = normalizeKey(parts[parts.length - 1])
    const modifiers = parts.slice(0, -1).map(normalizeModifier).filter(Boolean)
    this.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers })
    this.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers })
    return { success: true, keys: String(keys), key, modifiers }
  }

  async withDebugger(callback) {
    const debuggerApi = this.webContents.debugger
    const attachedBefore = debuggerApi.isAttached()
    if (!attachedBefore) {
      debuggerApi.attach('1.3')
    }
    try {
      return await callback(debuggerApi)
    } finally {
      if (!attachedBefore && debuggerApi.isAttached()) {
        debuggerApi.detach()
      }
    }
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
    const partition = this.options.sessionPartition || 'persist:noema-browser-use'
    const browserWindow = new BrowserWindow({
      width: 1100,
      height: 760,
      show: Boolean(this.options.headed),
      title: 'Noema Browser Use',
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

function readAxValue(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (value.value === undefined || value.value === null) return ''
  return String(value.value)
}

function readSnapshotString(strings, index) {
  if (!Number.isInteger(index)) return ''
  return String(strings[index] ?? '')
}

function readSnapshotAttributes(strings, rawAttributes) {
  if (!Array.isArray(rawAttributes)) return []
  const result = []
  for (let i = 0; i < rawAttributes.length; i += 2) {
    const name = readSnapshotString(strings, rawAttributes[i])
    const value = readSnapshotString(strings, rawAttributes[i + 1])
    if (name) {
      result.push({ name, value: truncate(value, 160) })
    }
  }
  return result
}
