export function createBrowserTools(controller, options) {
  const timeoutMs = options.timeoutMs
  const observe = (execute, observeOptions) => async (params) => {
    const action = await execute(params)
    if (!options.autoObserve) {
      return action
    }

    const shouldObserve = typeof observeOptions?.when === 'function'
      ? observeOptions.when(action, params)
      : true
    if (!shouldObserve) {
      return action
    }

    return {
      action,
      observation: await controller.observe(),
    }
  }

  const tools = [
    tool('browser_open', 'Open a URL in the browser session. Use this before browser_state when starting a web task.', 'external', timeoutMs, {
      url: { type: 'string', description: 'The absolute URL to open, including https:// when possible.' },
    }, ['url'], observe(({ url }) => controller.open(url))),

    tool('browser_search', 'Search the web using the configured or specified search engine, then open the results page.', 'external', timeoutMs, {
      query: { type: 'string', description: 'Search query.' },
      engine: { type: 'string', description: 'Optional search engine.', enum: ['duckduckgo', 'google', 'bing'] },
    }, ['query'], observe(({ query, engine }) => controller.search(query, engine))),

    tool('browser_state', 'Get current page URL, title, visible text preview, and numbered clickable/input elements. Call this before clicking or filling by index.', 'read', timeoutMs, {}, [], () => controller.state()),

    tool('browser_observe', 'Browser-task observation entry point. Use state for normal steps, snapshot for DOM/AX ambiguity, visual for screenshot verification, and full for difficult pages.', 'read', timeoutMs, {
      mode: { type: 'string', description: 'Observation mode.', enum: ['state', 'snapshot', 'visual', 'full'] },
      maxAxNodes: { type: 'number', description: 'Maximum accessibility nodes when mode includes snapshot.' },
      maxDomNodes: { type: 'number', description: 'Maximum DOM snapshot nodes per document when mode includes snapshot.' },
    }, [], params => controller.observeDetailed(params)),

    tool('browser_snapshot', 'Capture a Chrome DevTools Protocol DOM/Accessibility snapshot. Use this when browser_state is not enough for complex pages, iframe-like UI, hidden controls, or visual/semantic ambiguity.', 'read', timeoutMs, {
      includeAccessibility: { type: 'boolean', description: 'Include Accessibility.getFullAXTree summary. Defaults to true.' },
      includeDomSnapshot: { type: 'boolean', description: 'Include DOMSnapshot.captureSnapshot summary. Defaults to true.' },
      maxAxNodes: { type: 'number', description: 'Maximum accessibility nodes to return. Defaults to plugin config.' },
      maxDomNodes: { type: 'number', description: 'Maximum DOM snapshot nodes per document to return. Defaults to plugin config.' },
    }, [], params => controller.snapshot(params)),

    tool('browser_click', 'Click a numbered element from browser_state using real Electron mouse input. You may also click viewport coordinates from a screenshot/snapshot. Observe page state after the click.', 'external', timeoutMs, {
      index: { type: 'number', description: 'Element index from browser_state.' },
      x: { type: 'number', description: 'Viewport CSS pixel x coordinate. Use only when an element index is unavailable.' },
      y: { type: 'number', description: 'Viewport CSS pixel y coordinate. Use only when an element index is unavailable.' },
      clickCount: { type: 'number', description: 'Click count. Defaults to 1.' },
    }, [], observe(({ index, x, y, clickCount }) => {
      if (index !== undefined && index !== null) return controller.click(index)
      return controller.clickCoordinate(x, y, clickCount)
    })),

    tool('browser_mouse', 'Run a mouse action on a numbered element: hover, double click, or right click. Use browser_state first.', 'external', timeoutMs, {
      index: { type: 'number', description: 'Element index from browser_state.' },
      action: { type: 'string', description: 'Mouse action.', enum: ['hover', 'double_click', 'right_click'] },
    }, ['index', 'action'], observe(({ index, action }) => controller.mouse(index, action))),

    tool('browser_input', 'Click a numbered input-like element from browser_state using real mouse input, optionally clear it with keyboard select-all, then insert text. Observe after form input.', 'external', timeoutMs, {
      index: { type: 'number', description: 'Input element index from browser_state.' },
      text: { type: 'string', description: 'Text to enter.' },
      clear: { type: 'boolean', description: 'Clear existing text before typing. Defaults to true.' },
    }, ['index', 'text'], observe(({ index, text, clear }) => controller.input(index, text, clear))),

    tool('browser_type', 'Insert text into the currently focused element using the browser input pipeline. Prefer browser_input when an indexed input is available.', 'external', timeoutMs, {
      text: { type: 'string', description: 'Text to type into the focused element.' },
    }, ['text'], observe(({ text }) => controller.type(text))),

    tool('browser_keys', 'Send a real keyboard shortcut or key sequence to the page, such as Enter, Escape, Tab, Control+A, Meta+L. Observe after state-changing keys.', 'external', timeoutMs, {
      keys: { type: 'string', description: 'Key or shortcut, such as Enter, Escape, Tab, Control+A.' },
    }, ['keys'], observe(({ keys }) => controller.keys(keys))),

    tool('browser_scroll', 'Scroll the current page up or down, then observe the new page state.', 'external', timeoutMs, {
      direction: { type: 'string', description: 'Scroll direction.', enum: ['up', 'down'] },
      amount: { type: 'number', description: 'Scroll pixels. Defaults to 700.' },
    }, ['direction'], observe(({ direction, amount }) => controller.scroll(direction, amount))),

    tool('browser_find_text', 'Scroll to the first visible occurrence of text on the current page.', 'read', timeoutMs, {
      text: { type: 'string', description: 'Text to find on the page.' },
    }, ['text'], observe(({ text }) => controller.findText(text))),

    tool('browser_wait', 'Wait for milliseconds, a CSS selector, or text to appear.', 'safe', timeoutMs, {
      ms: { type: 'number', description: 'Milliseconds to wait. Used when selector/text is omitted.' },
      selector: { type: 'string', description: 'Optional CSS selector to wait for.' },
      text: { type: 'string', description: 'Optional text to wait for.' },
      timeoutMs: { type: 'number', description: 'Wait timeout when selector/text is provided. Defaults to 10000.' },
    }, [], ({ ms, selector, text, timeoutMs: waitTimeout }) => {
      if (selector) return observe(() => controller.waitFor('selector', selector, waitTimeout))()
      if (text) return observe(() => controller.waitFor('text', text, waitTimeout))()
      return controller.wait(ms)
    }),

    tool('browser_extract', 'Extract readable text and links from the current page. Use when browser_state is too short for summarization.', 'read', timeoutMs, {
      maxChars: { type: 'number', description: 'Maximum number of text characters to return. Defaults to 6000.' },
    }, [], ({ maxChars }) => controller.extract(maxChars)),

    tool('browser_get', 'Get page title, HTML, text, value, attributes, or bounding box from the page or a numbered element.', 'read', timeoutMs, {
      kind: { type: 'string', description: 'Information to get.', enum: ['title', 'html', 'text', 'value', 'attributes', 'bbox'] },
      index: { type: 'number', description: 'Optional element index from browser_state. Omit for page-level title/html/text.' },
      selector: { type: 'string', description: 'Optional CSS selector. Takes precedence over index.' },
      maxChars: { type: 'number', description: 'Maximum characters for html/text. Defaults to 6000.' },
    }, ['kind'], ({ kind, index, selector, maxChars }) => controller.get(kind, index, selector, maxChars)),

    tool('browser_eval', 'Execute JavaScript in the current page and return the result. Use sparingly when browser_state/browser_get cannot express the operation.', 'external', timeoutMs, {
      code: { type: 'string', description: 'JavaScript function body. Return a JSON-serializable value.' },
    }, ['code'], observe(({ code }) => controller.evaluate(code))),

    tool('browser_dropdown_options', 'Get options from a numbered select dropdown element.', 'read', timeoutMs, {
      index: { type: 'number', description: 'Select element index from browser_state.' },
    }, ['index'], ({ index }) => controller.dropdownOptions(index)),

    tool('browser_select', 'Select an option in a numbered select dropdown by value or visible text.', 'external', timeoutMs, {
      index: { type: 'number', description: 'Select element index from browser_state.' },
      value: { type: 'string', description: 'Option value or visible text.' },
    }, ['index', 'value'], observe(({ index, value }) => controller.select(index, value))),

    tool('browser_upload', 'Upload one or more files to a numbered file input element.', 'external', timeoutMs, {
      index: { type: 'number', description: 'File input element index from browser_state.' },
      paths: {
        type: 'array',
        description: 'Absolute or workspace-relative file paths to upload.',
        items: { type: 'string' },
      },
    }, ['index', 'paths'], observe(({ index, paths }) => controller.upload(index, paths))),

    tool('browser_tab', 'Manage browser tabs: list, new, switch, or close.', 'external', timeoutMs, {
      action: { type: 'string', description: 'Tab action.', enum: ['list', 'new', 'switch', 'close'] },
      index: { type: 'number', description: 'Tab index for switch/close.' },
      url: { type: 'string', description: 'Optional URL for new tab.' },
    }, ['action'], observe(({ action, index, url }) => controller.tab(action, index, url), {
      when: (_action, params) => params.action !== 'list' && params.action !== 'close',
    })),

    tool('browser_cookies', 'Manage browser cookies: get, set, clear, export, import.', 'external', timeoutMs, {
      action: { type: 'string', description: 'Cookie action.', enum: ['get', 'set', 'clear', 'export', 'import'] },
      url: { type: 'string', description: 'Cookie URL for get/set/clear.' },
      name: { type: 'string', description: 'Cookie name for set.' },
      value: { type: 'string', description: 'Cookie value for set.' },
      domain: { type: 'string', description: 'Optional cookie domain for set.' },
      path: { type: 'string', description: 'Optional cookie path for set, or file path for export/import when action is export/import.' },
      secure: { type: 'boolean', description: 'Optional secure flag for set.' },
      httpOnly: { type: 'boolean', description: 'Optional httpOnly flag for set.' },
    }, ['action'], params => controller.cookies(params.action, params)),

    tool('browser_back', 'Navigate back in the current browser history.', 'external', timeoutMs, {}, [], observe(() => controller.back())),
    tool('browser_reload', 'Reload the current page.', 'external', timeoutMs, {}, [], observe(() => controller.reload())),
    tool('browser_save_pdf', 'Save the current page as a PDF file.', 'write', timeoutMs, {
      path: { type: 'string', description: 'Output PDF file path.' },
    }, ['path'], ({ path }) => controller.savePdf(path)),
    tool('browser_close', 'Close all browser windows and clear the active browser session.', 'external', timeoutMs, {}, [], () => controller.close()),
  ]

  if (options.enableScreenshots) {
    tools.push(tool('browser_screenshot', 'Take a PNG screenshot of the current browser viewport and return it as base64.', 'read', timeoutMs, {}, [], () => controller.screenshot()))
  }

  return tools.map(item => ({
    ...item,
    deferLoading: shouldDeferBrowserTool(item.name),
    searchKeywords: browserToolKeywords(item.name),
  }))
}

function tool(name, description, safety, timeoutMs, properties, required, execute) {
  return {
    name,
    description,
    safety,
    timeoutMs,
    parameters: {
      type: 'object',
      properties,
      required,
    },
    execute,
  }
}

function shouldDeferBrowserTool(name) {
  return !['browser_open', 'browser_search', 'browser_state', 'browser_observe', 'browser_snapshot', 'browser_wait'].includes(name)
}

function browserToolKeywords(name) {
  return {
    browser_observe: ['observe', 'browser state', 'screenshot', 'snapshot', 'visual'],
    browser_snapshot: ['snapshot', 'accessibility', 'ax tree', 'dom snapshot', 'cdp', 'iframe', 'hidden elements'],
    browser_click: ['click', 'press', 'button', 'link', 'element', 'coordinate'],
    browser_mouse: ['hover', 'double click', 'right click', 'mouse'],
    browser_input: ['fill', 'form', 'input', 'type', 'text'],
    browser_type: ['type', 'focused element', 'keyboard'],
    browser_keys: ['enter', 'escape', 'tab', 'shortcut', 'keyboard'],
    browser_scroll: ['scroll', 'page down', 'page up'],
    browser_extract: ['extract', 'summarize', 'read page', 'links'],
    browser_get: ['html', 'text', 'attributes', 'bbox', 'selector'],
    browser_eval: ['javascript', 'evaluate', 'dom'],
    browser_select: ['select', 'dropdown', 'option'],
    browser_upload: ['upload', 'file input'],
    browser_screenshot: ['screenshot', 'image', 'viewport'],
  }[name] || []
}
