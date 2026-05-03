/**
 * Node filesystem and shell operations for base tools.
 */
import { execFile, spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'

export function resolveToolPath(inputPath) {
  if (!inputPath) {
    return process.cwd()
  }

  return isAbsolute(inputPath) ? inputPath : resolve(process.cwd(), inputPath)
}

export async function readTextFile(filePath, offset, limit) {
  const absolutePath = resolveToolPath(filePath)
  const content = await readFile(absolutePath, 'utf8')
  const lines = content.split('\n')
  const start = offset && offset > 0 ? offset - 1 : 0
  const end = limit && limit > 0 ? start + limit : undefined
  const selected = lines.slice(start, end).join('\n')

  return {
    content: selected,
    lines: selected ? selected.split('\n').length : 0,
  }
}

export async function writeTextFile(filePath, content) {
  const absolutePath = resolveToolPath(filePath)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content, 'utf8')
  return Buffer.byteLength(content, 'utf8')
}

export async function editTextFile(filePath, oldString, newString, replaceAll) {
  const absolutePath = resolveToolPath(filePath)
  const original = await readFile(absolutePath, 'utf8')

  if (!oldString) {
    throw new Error('old_string must not be empty')
  }

  const occurrences = original.split(oldString).length - 1
  if (occurrences === 0) {
    throw new Error('old_string not found in file')
  }
  if (!replaceAll && occurrences > 1) {
    throw new Error('old_string is not unique in file; set replace_all=true to replace every occurrence')
  }

  const updated = replaceAll
    ? original.split(oldString).join(newString)
    : original.replace(oldString, newString)

  await writeFile(absolutePath, updated, 'utf8')
  return replaceAll ? occurrences : 1
}

export async function runCommand(command, options = {}) {
  const cwd = resolveToolPath(options.cwd)

  return new Promise((resolvePromise, reject) => {
    execFile('bash', ['-lc', command], {
      cwd,
      timeout: options.timeout,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (!error) {
        resolvePromise({ stdout, stderr, exitCode: 0 })
        return
      }

      const errorCode = error?.code
      const exitCode = typeof errorCode === 'number' ? errorCode : 1

      if (String(error?.message || '').includes('spawn bash ENOENT')) {
        reject(error)
        return
      }

      resolvePromise({ stdout, stderr, exitCode })
    })
  })
}

export function runCommandInBackground(command, cwd) {
  const child = spawn('bash', ['-lc', command], {
    cwd: resolveToolPath(cwd),
    detached: true,
    stdio: 'ignore',
  })

  child.unref()
  return child.pid ?? -1
}
