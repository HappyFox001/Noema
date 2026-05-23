export class MCPRemoteHttpClient {
  constructor(server, defaultTimeoutMs) {
    this.server = server
    this.defaultTimeoutMs = defaultTimeoutMs
    this.nextId = 1
    this.initialized = false
    this.sessionId = null
  }

  get running() {
    return this.initialized
  }

  async ensureStarted() {
    if (!this.initialized) {
      await this.initialize()
    }
  }

  async initialize() {
    const result = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'noema',
        version: '0.1.0',
      },
    })
    await this.notify('notifications/initialized', {})
    this.initialized = true
    return result
  }

  async listTools() {
    await this.ensureStarted()
    return this.request('tools/list', {})
  }

  async callTool(name, args) {
    await this.ensureStarted()
    return this.request('tools/call', {
      name,
      arguments: args || {},
    })
  }

  async stop() {
    this.initialized = false
    this.sessionId = null
    return { success: true, serverId: this.server.id }
  }

  async notify(method, params = {}) {
    await this.send({
      jsonrpc: '2.0',
      method,
      params,
    }, this.defaultTimeoutMs)
  }

  async request(method, params = {}, timeoutMs = this.defaultTimeoutMs) {
    const id = this.nextId++
    const response = await this.send({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }, timeoutMs)

    if (response?.error) {
      throw new Error(response.error.message || `MCP request failed: ${method}`)
    }

    return response?.result ?? response
  }

  async send(message, timeoutMs) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const headers = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...this.server.headers,
      }
      if (this.sessionId) {
        headers['mcp-session-id'] = this.sessionId
      }

      const response = await fetch(this.server.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: controller.signal,
      })

      const sessionId = response.headers.get('mcp-session-id')
      if (sessionId) {
        this.sessionId = sessionId
      }

      const text = await response.text()
      if (!response.ok) {
        throw new Error(`Remote MCP HTTP ${response.status}: ${text.slice(0, 500)}`)
      }

      return parseMCPResponse(text, response.headers.get('content-type') || '')
    } finally {
      clearTimeout(timeout)
    }
  }
}

function parseMCPResponse(text, contentType) {
  const trimmed = String(text || '').trim()
  if (!trimmed) {
    return null
  }

  if (contentType.includes('text/event-stream') || trimmed.startsWith('event:') || trimmed.startsWith('data:')) {
    const dataLines = trimmed
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .filter(Boolean)

    const last = dataLines[dataLines.length - 1]
    return last ? JSON.parse(last) : null
  }

  return JSON.parse(trimmed)
}
