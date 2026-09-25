// Validates resources and native runtime dependencies required by packaged desktop builds.
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const desktopRoot = join(repositoryRoot, 'apps', 'desktop')
const requireFromDesktop = createRequire(join(desktopRoot, 'package.json'))
const desktopPackage = readJson(join(desktopRoot, 'package.json'))
const sdkPackage = readJson(join(repositoryRoot, 'packages', 'sdk', 'package.json'))

for (const resource of desktopPackage.build?.extraResources ?? []) {
  if (typeof resource?.from !== 'string') {
    fail('Every desktop extraResource must declare a source path.')
  }

  const sourcePath = resolve(desktopRoot, resource.from)
  if (!existsSync(sourcePath)) {
    fail(`Desktop extraResource does not exist: ${resource.from}`)
  }
}

assertDependency(desktopPackage, '@noema/desktop')
assertDependency(sdkPackage, '@noema/sdk')

const sqliteSources = [
  'apps/desktop/src/main/chat-history-store.ts',
  'apps/desktop/src/main/interactive-input-store.ts',
  'packages/sdk/src/memory/sqlite-runtime.ts',
]

for (const relativePath of sqliteSources) {
  const source = readFileSync(join(repositoryRoot, relativePath), 'utf8')
  if (!source.includes("from 'better-sqlite3'")) {
    fail(`${relativePath} must use the bundled better-sqlite3 runtime.`)
  }
  if (/spawn\s*\(\s*['\"]sqlite3['\"]/.test(source)) {
    fail(`${relativePath} must not require the external sqlite3 CLI.`)
  }
}

if (!existsSync(requireFromDesktop.resolve('better-sqlite3'))) {
  fail('The bundled better-sqlite3 runtime cannot be resolved from the desktop package.')
}

console.log('Desktop packaging contract is valid.')

function assertDependency(packageJson, packageName) {
  if (!packageJson.dependencies?.['better-sqlite3']) {
    fail(`${packageName} must declare better-sqlite3 as a runtime dependency.`)
  }
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
