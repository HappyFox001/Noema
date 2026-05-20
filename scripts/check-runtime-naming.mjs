#!/usr/bin/env node
/**
 * Verifies that task runtime source does not introduce reserved reference names.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const runtimeDir = join(root, 'packages/sdk/src/runtime')
const reserved = /codex/i
const failures = []

for (const file of listFiles(runtimeDir)) {
  const rel = relative(root, file)
  if (reserved.test(rel)) {
    failures.push(`${rel}: path contains reserved reference name`)
  }
  const text = readFileSync(file, 'utf8')
  const exportedNames = [...text.matchAll(/\bexport\s+(?:class|interface|type|function|const|enum)\s+([A-Za-z0-9_]+)/g)]
    .map(match => match[1])
  for (const name of exportedNames) {
    if (reserved.test(name)) {
      failures.push(`${rel}: exported name "${name}" contains reserved reference name`)
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log('runtime naming check passed')

function listFiles(dir) {
  const entries = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      entries.push(...listFiles(path))
    } else if (path.endsWith('.ts')) {
      entries.push(path)
    }
  }
  return entries
}
