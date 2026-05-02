export function parseServersConfig(value) {
  if (Array.isArray(value)) {
    return normalizeServers(value)
  }

  const text = String(value || '').trim()
  if (!text) {
    return []
  }

  try {
    const parsed = JSON.parse(text)
    return normalizeServers(Array.isArray(parsed) ? parsed : [])
  } catch (error) {
    console.warn('[MCPManager] Invalid legacy remote servers config:', error)
    return []
  }
}

export function normalizeRemoteServers(servers) {
  return servers
    .filter(server => server && typeof server === 'object')
    .map((server, index) => ({
      id: String(server.id || `server-${index + 1}`),
      name: String(server.name || server.id || `Remote MCP ${index + 1}`),
      url: String(server.url || server.endpoint || ''),
      headers: server.headers && typeof server.headers === 'object' ? server.headers : {},
      enabled: server.enabled !== false,
    }))
    .filter(server => server.url)
}

function normalizeServers(servers) {
  return normalizeRemoteServers(servers)
}

export function clampInteger(value, min, max) {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.max(min, Math.min(max, Math.round(value)))
}
