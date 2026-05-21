/**
 * File walking and glob matching helpers for built-in work search tools.
 */
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { resolveToolPath } from './local-node-ops.js'

export async function walkFiles(rootPath?: string): Promise<string[]> {
  const root = resolveToolPath(rootPath)
  const results: string[] = []

  async function visit(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true })

    for (const entry of entries) {
      const entryPath = join(currentPath, entry.name)
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name)) {
          continue
        }
        await visit(entryPath)
        continue
      }

      if (entry.isFile()) {
        results.push(entryPath)
      }
    }
  }

  await visit(root)
  return results
}

export function matchesGlobPattern(filePath: string, rootPath: string | undefined, pattern?: string): boolean {
  if (!pattern) {
    return true
  }

  const relativePath = normalizePath(relative(resolveToolPath(rootPath), filePath))
  const regex = globToRegExp(pattern)
  return regex.test(relativePath)
}

export function matchesAnyGlobPattern(filePath: string, rootPath: string | undefined, patterns: string[]): boolean {
  return patterns.some(pattern => matchesGlobPattern(filePath, rootPath, pattern))
}

function shouldSkipDirectory(name: string): boolean {
  return name === '.git' || name === 'node_modules' || name === 'dist' || name === 'release'
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePath(pattern)
  let regex = '^'

  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index]
    const next = normalized[index + 1]

    if (char === '*') {
      if (next === '*') {
        const afterDoubleStar = normalized[index + 2]
        if (afterDoubleStar === '/') {
          regex += '(?:.*/)?'
          index += 2
        } else {
          regex += '.*'
          index += 1
        }
      } else {
        regex += '[^/]*'
      }
      continue
    }

    if (char === '?') {
      regex += '.'
      continue
    }

    if ('\\.[]{}()+-^$|'.includes(char)) {
      regex += `\\${char}`
      continue
    }

    regex += char
  }

  regex += '$'
  return new RegExp(regex)
}
