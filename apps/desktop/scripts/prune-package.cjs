// Rewrites the packaged asar after removing development files and other-platform binaries.

const fs = require('fs')
const fsp = require('fs/promises')
const os = require('os')
const path = require('path')
const asar = require('@electron/asar')

const appAsarRelativePathByPlatform = {
  darwin: ['Noema.app', 'Contents', 'Resources', 'app.asar'],
  win32: ['resources', 'app.asar'],
  linux: ['resources', 'app.asar']
}

const onnxRuntimePlatformPruneMap = {
  darwin: ['linux', 'win32'],
  win32: ['darwin', 'linux'],
  linux: ['darwin', 'win32']
}

module.exports = async function prunePackage(context) {
  const relativeAsarPath = appAsarRelativePathByPlatform[context.electronPlatformName]
  if (!relativeAsarPath) {
    return
  }

  const appAsarPath = path.join(context.appOutDir, ...relativeAsarPath)
  if (!fs.existsSync(appAsarPath)) {
    return
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'noema-package-'))
  const unpackedPath = path.join(tempRoot, 'app')
  const repackedPath = path.join(tempRoot, 'app.asar')

  try {
    asar.extractAll(appAsarPath, unpackedPath)
    pruneCommonDevelopmentFiles(unpackedPath)
    pruneOnnxRuntimeBinaries(unpackedPath, context.electronPlatformName)
    fs.rmSync(appAsarPath, { force: true })
    fs.rmSync(`${appAsarPath}.unpacked`, { recursive: true, force: true })
    await asar.createPackageWithOptions(unpackedPath, repackedPath, {
      unpack: '**/*.{node,dylib,dll,so,so.*}'
    })
    fs.renameSync(repackedPath, appAsarPath)
    if (fs.existsSync(`${repackedPath}.unpacked`)) {
      fs.renameSync(`${repackedPath}.unpacked`, `${appAsarPath}.unpacked`)
    }
  } finally {
    await removeTempRoot(tempRoot)
  }
}

function pruneCommonDevelopmentFiles(appPath) {
  removePath(path.join(appPath, 'src'))
  removePath(path.join(appPath, 'node_modules', '@noema', 'sdk', 'src'))
  removePath(path.join(appPath, 'node_modules', '@noema', 'sdk', 'jest.config.cjs'))
  removePath(path.join(appPath, 'node_modules', '@noema', 'sdk', 'tsconfig.json'))
  removeMatchingFiles(path.join(appPath, 'dist'), (filePath) => filePath.endsWith('.d.ts') || filePath.endsWith('.d.ts.map'))
  removeMatchingFiles(path.join(appPath, 'node_modules', '@noema', 'sdk'), (filePath) => {
    return filePath.endsWith('.d.ts') || filePath.endsWith('.d.ts.map')
  })
}

function pruneOnnxRuntimeBinaries(appPath, platform) {
  const binPath = path.join(appPath, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6')
  for (const targetPlatform of onnxRuntimePlatformPruneMap[platform] ?? []) {
    removePath(path.join(binPath, targetPlatform))
  }
}

function removeMatchingFiles(directory, shouldRemove) {
  if (!fs.existsSync(directory)) {
    return
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      removeMatchingFiles(entryPath, shouldRemove)
    } else if (entry.isFile() && shouldRemove(entryPath)) {
      removePath(entryPath)
    }
  }
}

function removePath(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true })
}

async function removeTempRoot(tempRoot) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fsp.rm(tempRoot, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      })
      return
    } catch (error) {
      if (attempt === 4) {
        console.warn('[PackagePrune] Failed to remove temporary directory:', tempRoot, error)
        return
      }
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)))
    }
  }
}
