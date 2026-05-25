/**
 * Remote MCP manager plugin.
 *
 * Registers task tools for listing and calling remote MCP tools, and exposes
 * admin actions for managing remote HTTP MCP server entries.
 */
import { MCPManager } from './src/mcp-manager.mjs'
import { clampInteger, parseServersConfig } from './src/utils.mjs'

export default function plugin(ctx) {
  const config = ctx.config || {}
  const manager = new MCPManager({
    dataDir: ctx.dataDir || ctx.pluginDir,
    servers: parseServersConfig(config.serversJson),
    defaultTimeoutMs: clampInteger(Number(config.defaultTimeoutMs ?? 60000), 5000, 300000),
  })

  return {
    id: 'mcp-manager',
    name: 'MCP Manager',
    getAdminState() {
      return manager.listServers()
    },
    handleAdminAction(action, payload) {
      if (action === 'upsertServer') {
        return manager.upsertServer(payload || {})
      }
      if (action === 'removeServer') {
        return manager.removeServer(String(payload?.serverId || ''))
      }
      if (action === 'setServerEnabled') {
        return manager.setServerEnabled(String(payload?.serverId || ''), payload?.enabled)
      }
      if (action === 'testServer') {
        return manager.testServer(String(payload?.serverId || ''))
      }
      if (action === 'listTools') {
        return manager.listTools(String(payload?.serverId || ''))
      }
      throw new Error(`Unknown MCP admin action: ${action}`)
    },
    registerTools() {
      return [
        {
          name: 'mcp_list_servers',
          description: 'List configured MCP servers and their connection state.',
          safety: 'read',
          timeoutMs: manager.defaultTimeoutMs,
          parameters: { type: 'object', properties: {}, required: [] },
          execute: async () => manager.listServers(),
        },
        {
          name: 'mcp_list_tools',
          description: 'List tools exposed by one MCP server, or all enabled MCP servers.',
          safety: 'read',
          timeoutMs: manager.defaultTimeoutMs,
          parameters: {
            type: 'object',
            properties: {
              serverId: { type: 'string', description: 'Optional MCP server id. Omit to list all enabled servers.' },
            },
            required: [],
          },
          execute: async ({ serverId }) => manager.listTools(serverId),
        },
        {
          name: 'mcp_call_tool',
          description: 'Call a tool on a configured MCP server. Use mcp_list_tools first to discover tool names and schemas.',
          safety: 'external',
          timeoutMs: manager.defaultTimeoutMs,
          parameters: {
            type: 'object',
            properties: {
              serverId: { type: 'string', description: 'MCP server id.' },
              toolName: { type: 'string', description: 'MCP tool name.' },
              arguments: { type: 'object', description: 'Arguments object for the MCP tool.' },
            },
            required: ['serverId', 'toolName'],
          },
          execute: async ({ serverId, toolName, arguments: args }) => manager.callTool(serverId, toolName, args || {}),
        },
        {
          name: 'mcp_stop_server',
          description: 'Stop a running MCP server process managed by this plugin.',
          safety: 'external',
          timeoutMs: manager.defaultTimeoutMs,
          parameters: {
            type: 'object',
            properties: {
              serverId: { type: 'string', description: 'MCP server id.' },
            },
            required: ['serverId'],
          },
          execute: async ({ serverId }) => manager.stopServer(serverId),
        },
      ]
    },
  }
}
