import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { MCPRemoteHttpClient } from './remote-http-client.mjs'
import { normalizeRemoteServers } from './utils.mjs'

export class MCPManager {
  constructor(options) {
    this.dataDir = options.dataDir
    this.filePath = join(this.dataDir, 'servers.json')
    this.defaultServers = options.servers
    this.defaultTimeoutMs = options.defaultTimeoutMs
    this.clients = new Map()
  }

  async listServers() {
    const servers = await this.loadServers()
    return {
      success: true,
      servers: servers.map(server => ({
        id: server.id,
        name: server.name,
        url: server.url,
        headers: redactHeaders(server.headers),
        enabled: server.enabled,
        running: this.clients.get(server.id)?.running ?? false,
      })),
    }
  }

  async listTools(serverId) {
    const allServers = await this.loadServers()
    const servers = serverId ? [this.getServer(allServers, serverId)] : allServers.filter(server => server.enabled)
    const results = []

    for (const server of servers) {
      const client = this.getClient(server)
      const result = await client.listTools()
      results.push({
        serverId: server.id,
        tools: result.tools || [],
      })
    }

    return { success: true, servers: results }
  }

  async callTool(serverId, toolName, args) {
    const servers = await this.loadServers()
    const client = this.getClient(this.getServer(servers, serverId))
    const result = await client.callTool(toolName, args)
    return {
      success: true,
      serverId,
      toolName,
      result,
    }
  }

  async stopServer(serverId) {
    const client = this.clients.get(serverId)
    if (!client) {
      return { success: true, serverId, stopped: false }
    }
    const result = await client.stop()
    this.clients.delete(serverId)
    return { ...result, stopped: true }
  }

  async testServer(serverId) {
    const servers = await this.loadServers()
    const server = this.getServer(servers, serverId)
    const startedAt = Date.now()
    const tools = await this.getClient(server).listTools()
    return {
      success: true,
      serverId,
      elapsedMs: Date.now() - startedAt,
      tools: tools.tools || [],
    }
  }

  async upsertServer(input) {
    const servers = await this.loadServers()
    const server = normalizeRemoteServers([input])[0]
    if (!server) {
      throw new Error('Remote MCP server requires a url')
    }

    const next = servers.filter(item => item.id !== server.id)
    next.push(server)
    await this.saveServers(next)
    await this.stopServer(server.id)
    return { success: true, server }
  }

  async removeServer(serverId) {
    const servers = await this.loadServers()
    const next = servers.filter(item => item.id !== serverId)
    await this.saveServers(next)
    await this.stopServer(serverId)
    return { success: true, serverId }
  }

  async setServerEnabled(serverId, enabled) {
    const servers = await this.loadServers()
    const next = servers.map(server => server.id === serverId ? { ...server, enabled: Boolean(enabled) } : server)
    await this.saveServers(next)
    if (!enabled) {
      await this.stopServer(serverId)
    }
    return { success: true, serverId, enabled: Boolean(enabled) }
  }

  getServer(servers, serverId) {
    const server = servers.find(item => item.id === serverId)
    if (!server) {
      throw new Error(`MCP server not configured: ${serverId}`)
    }
    if (!server.enabled) {
      throw new Error(`MCP server disabled: ${serverId}`)
    }
    return server
  }

  getClient(server) {
    let client = this.clients.get(server.id)
    if (!client) {
      client = new MCPRemoteHttpClient(server, this.defaultTimeoutMs)
      this.clients.set(server.id, client)
    }
    return client
  }

  async loadServers() {
    if (!existsSync(this.filePath)) {
      return this.defaultServers
    }

    const text = await readFile(this.filePath, 'utf8')
    const parsed = JSON.parse(text)
    return normalizeRemoteServers(Array.isArray(parsed.servers) ? parsed.servers : parsed)
  }

  async saveServers(servers) {
    await mkdir(this.dataDir, { recursive: true })
    await writeFile(this.filePath, JSON.stringify({ servers }, null, 2), 'utf8')
  }
}

function redactHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => {
    return [/authorization/i, /api[-_]?key/i, /token/i].some(pattern => pattern.test(key))
      ? [key, value ? '***' : '']
      : [key, value]
  }))
}
