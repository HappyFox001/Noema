/**
 * Proxy helpers for SDK network requests.
 */
import { ProxyAgent as NodeProxyAgent } from 'proxy-agent'
import { ProxyAgent as UndiciProxyAgent } from 'undici'

export interface ProxyFetchOptions {
  proxyUrl?: string
}

export function createProxyHttpAgent(proxyUrl?: string): any {
  const normalized = normalizeProxyUrl(proxyUrl)
  if (!normalized) {
    return undefined
  }
  return new NodeProxyAgent({
    getProxyForUrl: () => normalized,
  })
}

export function createProxyFetch(proxyUrl?: string): typeof fetch {
  const normalized = normalizeProxyUrl(proxyUrl)
  if (!normalized) {
    return fetch
  }
  const dispatcher = new UndiciProxyAgent(normalized)
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    return fetch(input, {
      ...(init ?? {}),
      dispatcher,
    } as RequestInit & { dispatcher: unknown })
  }) as typeof fetch
}

export function normalizeProxyUrl(proxyUrl?: string): string {
  return typeof proxyUrl === 'string' ? proxyUrl.trim() : ''
}
