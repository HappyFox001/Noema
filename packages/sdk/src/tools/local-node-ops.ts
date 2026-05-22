/**
 * Local filesystem primitives used by the built-in work tools.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'

export function resolveToolPath(inputPath?: string): string {
  if (!inputPath) {
    return process.cwd()
  }

  return isAbsolute(inputPath) ? inputPath : resolve(process.cwd(), inputPath)
}

export async function readTextFile(filePath: string, offset?: number, limit?: number): Promise<{ content: string; lines: number }> {
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

export async function writeTextFile(filePath: string, content: string): Promise<number> {
  const absolutePath = resolveToolPath(filePath)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content, 'utf8')
  return Buffer.byteLength(content, 'utf8')
}

export async function editTextFile(
  filePath: string,
  oldString: string,
  newString: string,
  replaceAll: boolean
): Promise<number> {
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

export async function deleteFile(filePath: string): Promise<void> {
  const absolutePath = resolveToolPath(filePath)
  await rm(absolutePath, { force: false })
}

export async function readImageFile(filePath: string): Promise<{
  path: string
  base64: string
  mimeType: string
  width?: number
  height?: number
  bytes: number
}> {
  const absolutePath = resolveToolPath(filePath)
  const buffer = await readFile(absolutePath)
  const metadata = detectImageMetadata(buffer, absolutePath)
  return {
    path: absolutePath,
    base64: buffer.toString('base64'),
    mimeType: metadata.mimeType,
    width: metadata.width,
    height: metadata.height,
    bytes: buffer.byteLength,
  }
}

function detectImageMetadata(buffer: Buffer, filePath: string): { mimeType: string; width?: number; height?: number } {
  const png = detectPng(buffer)
  if (png) {
    return png
  }

  const jpeg = detectJpeg(buffer)
  if (jpeg) {
    return jpeg
  }

  const extension = filePath.toLowerCase().split('.').pop()
  if (extension === 'webp') {
    return { mimeType: 'image/webp' }
  }
  if (extension === 'gif') {
    return { mimeType: 'image/gif' }
  }

  return { mimeType: 'application/octet-stream' }
}

function detectPng(buffer: Buffer): { mimeType: string; width: number; height: number } | null {
  if (
    buffer.length < 24 ||
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47
  ) {
    return null
  }

  return {
    mimeType: 'image/png',
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

function detectJpeg(buffer: Buffer): { mimeType: string; width?: number; height?: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null
  }

  let offset = 2
  while (offset < buffer.length - 9) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }

    const marker = buffer[offset + 1]
    const length = buffer.readUInt16BE(offset + 2)
    if (length < 2) {
      break
    }

    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        mimeType: 'image/jpeg',
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      }
    }

    offset += 2 + length
  }

  return { mimeType: 'image/jpeg' }
}
