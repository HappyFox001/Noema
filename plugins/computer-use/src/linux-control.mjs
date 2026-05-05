/**
 * Linux desktop control helpers for the computer-use plugin.
 *
 * This controller targets local X11 desktops through common command line tools.
 */
import { mkdir, readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  coordinateMetadata,
  createCoordinateMapper,
  detectPngSize,
  mapPoint,
} from './coordinates.mjs'

const execFileAsync = promisify(execFile)

const XDOTOOL_BUTTONS = {
  left: '1',
  middle: '2',
  right: '3',
}

export class LinuxComputerController {
  constructor(options) {
    this.dataDir = options.dataDir
    this.screenshotFormat = options.screenshotFormat === 'path' ? 'path' : 'base64'
    this.lastCoordinateMapper = null
  }

  async observe(options = {}) {
    assertLinux()
    const includeImage = options.includeImage !== false
    const path = await this.captureScreenshot()
    const buffer = await readFile(path)
    const mapper = this.createMapper(buffer)
    this.lastCoordinateMapper = mapper
    const result = {
      success: true,
      type: 'screenshot',
      format: this.screenshotFormat,
      path,
      note: 'Coordinates returned by this screenshot use screenshot pixels. Mouse tools default to coordinateSpace=screenshot and map them to Linux desktop coordinates. The default backend expects X11-compatible tools.',
      ...coordinateMetadata(mapper),
    }

    if (includeImage && this.screenshotFormat === 'base64') {
      result.image_base64 = buffer.toString('base64')
      result.mime_type = 'image/png'
    }

    return result
  }

  async click(x, y, button = 'left', clickCount = 1, coordinateSpace = 'screenshot') {
    const safeButton = normalizeButton(button)
    const safeClickCount = clampInteger(clickCount, 1, 3)
    const point = await this.mapInputPoint(x, y, coordinateSpace)
    await ensureCommand('xdotool', 'Install xdotool to enable Linux mouse and keyboard control.')
    await execFileAsync('xdotool', ['mousemove', String(point.x), String(point.y)], commandOptions())
    for (let index = 0; index < safeClickCount; index += 1) {
      await execFileAsync('xdotool', ['click', XDOTOOL_BUTTONS[safeButton]], commandOptions())
    }
    return { success: true, action: 'click', x, y, screenX: point.x, screenY: point.y, coordinateSpace: point.coordinateSpace, button: safeButton, clickCount: safeClickCount }
  }

  async move(x, y, coordinateSpace = 'screenshot') {
    const point = await this.mapInputPoint(x, y, coordinateSpace)
    await ensureCommand('xdotool', 'Install xdotool to enable Linux mouse and keyboard control.')
    await execFileAsync('xdotool', ['mousemove', String(point.x), String(point.y)], commandOptions())
    return { success: true, action: 'move', x, y, screenX: point.x, screenY: point.y, coordinateSpace: point.coordinateSpace }
  }

  async drag(startX, startY, endX, endY, durationMs = 500, button = 'left', coordinateSpace = 'screenshot') {
    const safeButton = normalizeButton(button)
    const start = await this.mapInputPoint(startX, startY, coordinateSpace)
    const end = await this.mapInputPoint(endX, endY, coordinateSpace)
    await ensureCommand('xdotool', 'Install xdotool to enable Linux mouse and keyboard control.')
    await execFileAsync('xdotool', [
      'mousemove',
      String(start.x),
      String(start.y),
      'mousedown',
      XDOTOOL_BUTTONS[safeButton],
      'mousemove',
      '--sync',
      '--duration',
      String(clampInteger(durationMs, 50, 10000)),
      String(end.x),
      String(end.y),
      'mouseup',
      XDOTOOL_BUTTONS[safeButton],
    ], commandOptions())
    return { success: true, action: 'drag', startX, startY, endX, endY, screenStartX: start.x, screenStartY: start.y, screenEndX: end.x, screenEndY: end.y, coordinateSpace: start.coordinateSpace, button: safeButton }
  }

  async typeText(text) {
    assertLinux()
    if (typeof text !== 'string') {
      throw new Error('text must be a string')
    }
    await ensureCommand('xdotool', 'Install xdotool to enable Linux mouse and keyboard control.')
    await execFileAsync('xdotool', ['type', '--clearmodifiers', text], commandOptions())
    return { success: true, action: 'type', characters: text.length }
  }

  async pressKeys(keys) {
    const normalized = normalizeLinuxShortcut(keys)
    await ensureCommand('xdotool', 'Install xdotool to enable Linux mouse and keyboard control.')
    await execFileAsync('xdotool', ['key', '--clearmodifiers', normalized], commandOptions())
    return { success: true, action: 'key', keys: normalized }
  }

  async scroll(direction, amount = 5, x, y, coordinateSpace = 'screenshot') {
    const safeAmount = clampInteger(amount, 1, 100)
    const button = scrollButton(direction)
    await ensureCommand('xdotool', 'Install xdotool to enable Linux mouse and keyboard control.')
    const point = x === undefined || y === undefined
      ? null
      : await this.mapInputPoint(x, y, coordinateSpace)
    if (x !== undefined && y !== undefined) {
      await execFileAsync('xdotool', ['mousemove', String(point.x), String(point.y)], commandOptions())
    }
    for (let index = 0; index < safeAmount; index += 1) {
      await execFileAsync('xdotool', ['click', button], commandOptions())
    }
    return { success: true, action: 'scroll', direction, amount: safeAmount, x, y, screenX: point?.x, screenY: point?.y, coordinateSpace: point?.coordinateSpace }
  }

  async wait(ms = 1000) {
    const duration = clampInteger(ms, 0, 120000)
    await new Promise(resolve => setTimeout(resolve, duration))
    return { success: true, action: 'wait', ms: duration }
  }

  async captureScreenshot() {
    assertLinux()
    await mkdir(this.dataDir, { recursive: true })
    const path = join(this.dataDir, `screenshot-${Date.now()}.png`)
    const command = await findScreenshotCommand()
    if (command.name === 'gnome-screenshot') {
      await execFileAsync(command.name, ['-f', path], commandOptions())
    } else if (command.name === 'spectacle') {
      await execFileAsync(command.name, ['-b', '-n', '-o', path], commandOptions())
    } else if (command.name === 'scrot') {
      await execFileAsync(command.name, [path], commandOptions())
    } else if (command.name === 'import') {
      await execFileAsync(command.name, ['-window', 'root', path], commandOptions())
    } else {
      throw new Error(`Unsupported screenshot command: ${command.name}`)
    }
    return path
  }

  createMapper(buffer) {
    const screenshotSize = detectPngSize(buffer)
    if (!screenshotSize) {
      throw new Error('Unable to detect screenshot dimensions')
    }
    return createCoordinateMapper({}, screenshotSize)
  }

  async getCoordinateMapper() {
    if (this.lastCoordinateMapper) {
      return this.lastCoordinateMapper
    }
    const path = await this.captureScreenshot()
    const buffer = await readFile(path)
    this.lastCoordinateMapper = this.createMapper(buffer)
    return this.lastCoordinateMapper
  }

  async mapInputPoint(x, y, coordinateSpace) {
    const mapper = await this.getCoordinateMapper()
    return mapPoint({ x, y }, mapper, coordinateSpace)
  }
}

function assertLinux() {
  if (process.platform !== 'linux') {
    throw new Error('LinuxComputerController can only run on Linux')
  }
}

function commandOptions() {
  return {
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  }
}

async function findScreenshotCommand() {
  const candidates = ['gnome-screenshot', 'spectacle', 'scrot', 'import']
  for (const name of candidates) {
    if (await hasCommand(name)) {
      return { name }
    }
  }
  throw new Error('No Linux screenshot command found. Install gnome-screenshot, spectacle, scrot, or ImageMagick import.')
}

async function ensureCommand(name, hint) {
  if (await hasCommand(name)) {
    return
  }
  throw new Error(`${name} was not found. ${hint}`)
}

async function hasCommand(name) {
  try {
    await execFileAsync('which', [name], commandOptions())
    return true
  } catch {
    return false
  }
}

function normalizeButton(button) {
  const normalized = String(button || 'left').toLowerCase()
  if (!XDOTOOL_BUTTONS[normalized]) {
    throw new Error(`Unsupported mouse button: ${button}`)
  }
  return normalized
}

function clampInteger(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return min
  }
  return Math.max(min, Math.min(max, Math.trunc(number)))
}

function normalizeLinuxShortcut(keys) {
  if (typeof keys !== 'string' || !keys.trim()) {
    throw new Error('keys must be a non-empty string')
  }
  return keys
    .split('+')
    .map(part => normalizeLinuxKey(part))
    .filter(Boolean)
    .join('+')
}

function normalizeLinuxKey(key) {
  const normalized = String(key || '').trim()
  const lower = normalized.toLowerCase().replace(/\s+/g, '')
  if (lower === 'command' || lower === 'cmd') return 'ctrl'
  if (lower === 'control') return 'ctrl'
  if (lower === 'option') return 'alt'
  if (lower === 'escape') return 'Escape'
  if (lower === 'enter' || lower === 'return') return 'Return'
  if (lower === 'space') return 'space'
  if (lower === 'tab') return 'Tab'
  if (lower === 'backspace') return 'BackSpace'
  if (lower === 'delete') return 'Delete'
  if (lower === 'pageup') return 'Page_Up'
  if (lower === 'pagedown') return 'Page_Down'
  if (lower.length === 1) return lower
  return normalized
}

function scrollButton(direction) {
  switch (String(direction).toLowerCase()) {
    case 'up':
      return '4'
    case 'down':
      return '5'
    case 'left':
      return '6'
    case 'right':
      return '7'
    default:
      throw new Error(`Unsupported scroll direction: ${direction}`)
  }
}
