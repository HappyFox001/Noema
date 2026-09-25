// Ensures a release tag matches every published package version.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const expectedVersion = process.argv[2]?.replace(/^v/, '')

if (!expectedVersion || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(expectedVersion)) {
  fail('Usage: pnpm check:release-version <version>')
}

const packageFiles = [
  'package.json',
  'packages/sdk/package.json',
  'apps/desktop/package.json',
]

for (const relativePath of packageFiles) {
  const packageJson = JSON.parse(readFileSync(join(repositoryRoot, relativePath), 'utf8'))
  if (packageJson.version !== expectedVersion) {
    fail(`${relativePath} has version ${packageJson.version}; expected ${expectedVersion}.`)
  }
}

console.log(`Release version ${expectedVersion} is consistent.`)

function fail(message) {
  console.error(message)
  process.exit(1)
}
