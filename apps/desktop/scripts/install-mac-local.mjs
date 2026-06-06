import { access, readdir, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const desktopDir = resolve(dirname(__filename), '..')
const releaseDir = join(desktopDir, 'release')
const productName = 'Noema'
const appName = `${productName}.app`
const applicationsAppPath = join('/Applications', appName)
const args = new Set(process.argv.slice(2))

if (args.has('--help') || args.has('-h')) {
  console.log([
    'Usage: pnpm run install:mac:local [--skip-build]',
    '',
    'Builds a local macOS .app, installs it to /Applications, and clears xattrs.',
    'Use --skip-build to install the newest release/*/Noema.app already on disk.',
  ].join('\n'))
  process.exit(0)
}

if (process.platform !== 'darwin') {
  console.error('install:mac:local only supports macOS.')
  process.exit(1)
}

try {
  if (!args.has('--skip-build')) {
    await run('pnpm', ['run', 'build'], desktopDir)
    await run('pnpm', ['exec', 'electron-builder', '--dir'], desktopDir)
  }

  const sourceAppPath = await findBuiltApp()
  await run('xattr', ['-cr', sourceAppPath], desktopDir, { allowFailure: true })
  await rm(applicationsAppPath, { recursive: true, force: true })
  await run('ditto', [sourceAppPath, applicationsAppPath], desktopDir)
  await run('xattr', ['-cr', applicationsAppPath], desktopDir, { allowFailure: true })

  console.log(`Installed ${sourceAppPath} -> ${applicationsAppPath}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

async function findBuiltApp() {
  const candidates = []
  const entries = await readdir(releaseDir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    candidates.push(join(releaseDir, entry.name, appName))
  }

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.R_OK)
      return candidate
    } catch {
      // Try the next build output directory.
    }
  }

  throw new Error(`Built app not found under ${releaseDir}. Run without --skip-build first.`)
}

function run(command, commandArgs, cwd, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, commandArgs, {
      cwd,
      stdio: 'inherit',
      env: process.env,
    })

    child.on('error', rejectRun)
    child.on('exit', (code) => {
      if (code === 0 || options.allowFailure) {
        resolveRun()
        return
      }
      rejectRun(new Error(`${command} ${commandArgs.join(' ')} exited with ${code}`))
    })
  })
}
