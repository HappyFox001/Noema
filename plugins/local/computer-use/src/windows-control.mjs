/**
 * Windows desktop control helpers for the computer-use plugin.
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

const BUTTON_FLAGS = {
  left: { down: 0x0002, up: 0x0004 },
  right: { down: 0x0008, up: 0x0010 },
  middle: { down: 0x0020, up: 0x0040 },
}

const VIRTUAL_KEYS = {
  backspace: 0x08,
  tab: 0x09,
  enter: 0x0d,
  return: 0x0d,
  shift: 0x10,
  control: 0x11,
  ctrl: 0x11,
  alt: 0x12,
  option: 0x12,
  escape: 0x1b,
  esc: 0x1b,
  space: 0x20,
  pageup: 0x21,
  pagedown: 0x22,
  end: 0x23,
  home: 0x24,
  left: 0x25,
  up: 0x26,
  right: 0x27,
  down: 0x28,
  delete: 0x2e,
  f1: 0x70,
  f2: 0x71,
  f3: 0x72,
  f4: 0x73,
  f5: 0x74,
  f6: 0x75,
  f7: 0x76,
  f8: 0x77,
  f9: 0x78,
  f10: 0x79,
  f11: 0x7a,
  f12: 0x7b,
}

for (let code = 65; code <= 90; code += 1) {
  VIRTUAL_KEYS[String.fromCharCode(code).toLowerCase()] = code
}
for (let code = 48; code <= 57; code += 1) {
  VIRTUAL_KEYS[String.fromCharCode(code)] = code
}

export class WindowsComputerController {
  constructor(options) {
    this.dataDir = options.dataDir
    this.screenshotFormat = options.screenshotFormat === 'path' ? 'path' : 'base64'
    this.lastCoordinateMapper = null
  }

  async observe(options = {}) {
    assertWindows()
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
      note: 'Coordinates returned by this screenshot use screenshot pixels. Mouse tools default to coordinateSpace=screenshot and map them to Windows screen coordinates.',
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
    await runPowerShell(WINDOWS_INPUT_SCRIPT, [
      JSON.stringify({
        action: 'click',
        x: point.x,
        y: point.y,
        button: safeButton,
        clickCount: safeClickCount,
      }),
    ])
    return { success: true, action: 'click', x, y, screenX: point.x, screenY: point.y, coordinateSpace: point.coordinateSpace, button: safeButton, clickCount: safeClickCount }
  }

  async move(x, y, coordinateSpace = 'screenshot') {
    const point = await this.mapInputPoint(x, y, coordinateSpace)
    await runPowerShell(WINDOWS_INPUT_SCRIPT, [
      JSON.stringify({ action: 'move', x: point.x, y: point.y }),
    ])
    return { success: true, action: 'move', x, y, screenX: point.x, screenY: point.y, coordinateSpace: point.coordinateSpace }
  }

  async drag(startX, startY, endX, endY, durationMs = 500, button = 'left', coordinateSpace = 'screenshot') {
    const safeButton = normalizeButton(button)
    const start = await this.mapInputPoint(startX, startY, coordinateSpace)
    const end = await this.mapInputPoint(endX, endY, coordinateSpace)
    await runPowerShell(WINDOWS_INPUT_SCRIPT, [
      JSON.stringify({
        action: 'drag',
        startX: start.x,
        startY: start.y,
        endX: end.x,
        endY: end.y,
        durationMs: clampInteger(durationMs, 50, 10000),
        button: safeButton,
      }),
    ])
    return { success: true, action: 'drag', startX, startY, endX, endY, screenStartX: start.x, screenStartY: start.y, screenEndX: end.x, screenEndY: end.y, coordinateSpace: start.coordinateSpace, button: safeButton }
  }

  async typeText(text) {
    assertWindows()
    if (typeof text !== 'string') {
      throw new Error('text must be a string')
    }
    await runPowerShell(WINDOWS_INPUT_SCRIPT, [
      JSON.stringify({ action: 'type', text }),
    ])
    return { success: true, action: 'type', characters: text.length }
  }

  async pressKeys(keys) {
    const parsed = parseShortcut(keys)
    await runPowerShell(WINDOWS_INPUT_SCRIPT, [
      JSON.stringify({ action: 'key', keyCodes: parsed.keyCodes }),
    ])
    return { success: true, action: 'key', keys: parsed.normalized }
  }

  async scroll(direction, amount = 5, x, y, coordinateSpace = 'screenshot') {
    const delta = directionToDelta(direction, amount)
    const point = x === undefined || y === undefined
      ? null
      : await this.mapInputPoint(x, y, coordinateSpace)
    await runPowerShell(WINDOWS_INPUT_SCRIPT, [
      JSON.stringify({
        action: 'scroll',
        x: point ? point.x : null,
        y: point ? point.y : null,
        deltaX: delta.x,
        deltaY: delta.y,
      }),
    ])
    return { success: true, action: 'scroll', direction, amount: Math.abs(delta.x || delta.y), x, y, screenX: point?.x, screenY: point?.y, coordinateSpace: point?.coordinateSpace }
  }

  async wait(ms = 1000) {
    const duration = clampInteger(ms, 0, 120000)
    await new Promise(resolve => setTimeout(resolve, duration))
    return { success: true, action: 'wait', ms: duration }
  }

  async captureScreenshot() {
    assertWindows()
    await mkdir(this.dataDir, { recursive: true })
    const path = join(this.dataDir, `screenshot-${Date.now()}.png`)
    await runPowerShell(WINDOWS_SCREENSHOT_SCRIPT, [path])
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

function assertWindows() {
  if (process.platform !== 'win32') {
    throw new Error('WindowsComputerController can only run on Windows')
  }
}

async function runPowerShell(script, args) {
  assertWindows()
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
    ...args.map(String),
  ], {
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  })
}

const WINDOWS_SCREENSHOT_SCRIPT = `
param([string]$Path)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
`

const WINDOWS_INPUT_SCRIPT = `
param([string]$PayloadJson)
$payload = $PayloadJson | ConvertFrom-Json
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class NativeInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
Add-Type -AssemblyName System.Windows.Forms
function MouseEvent([uint32]$flag) {
  [NativeInput]::mouse_event($flag, 0, 0, 0, [UIntPtr]::Zero)
}
function KeyDown([int]$code) {
  [NativeInput]::keybd_event([byte]$code, 0, 0, [UIntPtr]::Zero)
}
function KeyUp([int]$code) {
  [NativeInput]::keybd_event([byte]$code, 0, 2, [UIntPtr]::Zero)
}
if ($payload.action -eq "move") {
  [NativeInput]::SetCursorPos([int]$payload.x, [int]$payload.y) | Out-Null
} elseif ($payload.action -eq "click") {
  $buttons = @{
    left = @{ down = 2; up = 4 }
    right = @{ down = 8; up = 16 }
    middle = @{ down = 32; up = 64 }
  }
  $button = $buttons[$payload.button]
  [NativeInput]::SetCursorPos([int]$payload.x, [int]$payload.y) | Out-Null
  for ($i = 0; $i -lt [int]$payload.clickCount; $i++) {
    MouseEvent $button.down
    Start-Sleep -Milliseconds 50
    MouseEvent $button.up
    Start-Sleep -Milliseconds 80
  }
} elseif ($payload.action -eq "drag") {
  $buttons = @{
    left = @{ down = 2; up = 4 }
    right = @{ down = 8; up = 16 }
    middle = @{ down = 32; up = 64 }
  }
  $button = $buttons[$payload.button]
  $steps = [Math]::Max(4, [Math]::Min(80, [Math]::Round([double]$payload.durationMs / 16)))
  [NativeInput]::SetCursorPos([int]$payload.startX, [int]$payload.startY) | Out-Null
  MouseEvent $button.down
  for ($i = 1; $i -le $steps; $i++) {
    $x = [Math]::Round([double]$payload.startX + (([double]$payload.endX - [double]$payload.startX) * $i / $steps))
    $y = [Math]::Round([double]$payload.startY + (([double]$payload.endY - [double]$payload.startY) * $i / $steps))
    [NativeInput]::SetCursorPos([int]$x, [int]$y) | Out-Null
    Start-Sleep -Milliseconds ([Math]::Max(1, [Math]::Round([double]$payload.durationMs / $steps)))
  }
  MouseEvent $button.up
} elseif ($payload.action -eq "type") {
  Set-Clipboard -Value ([string]$payload.text)
  [System.Windows.Forms.SendKeys]::SendWait("^v")
} elseif ($payload.action -eq "key") {
  foreach ($code in $payload.keyCodes) { KeyDown ([int]$code) }
  [Array]::Reverse($payload.keyCodes)
  foreach ($code in $payload.keyCodes) { KeyUp ([int]$code) }
} elseif ($payload.action -eq "scroll") {
  if ($null -ne $payload.x -and $null -ne $payload.y) {
    [NativeInput]::SetCursorPos([int]$payload.x, [int]$payload.y) | Out-Null
  }
  if ([int]$payload.deltaY -ne 0) {
    [NativeInput]::mouse_event(2048, 0, 0, [int]([int]$payload.deltaY * 120), [UIntPtr]::Zero)
  }
  if ([int]$payload.deltaX -ne 0) {
    [NativeInput]::mouse_event(4096, 0, 0, [int]([int]$payload.deltaX * 120), [UIntPtr]::Zero)
  }
} else {
  throw "Unsupported input action: $($payload.action)"
}
`

function normalizeButton(button) {
  const normalized = String(button || 'left').toLowerCase()
  if (!BUTTON_FLAGS[normalized]) {
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

function parseShortcut(keys) {
  if (typeof keys !== 'string' || !keys.trim()) {
    throw new Error('keys must be a non-empty string')
  }

  const keyCodes = []
  const normalized = []
  for (const rawPart of keys.split('+')) {
    const part = normalizeKeyName(rawPart)
    if (!part) continue
    const mapped = part === 'command' || part === 'cmd' ? 'control' : part
    const keyCode = VIRTUAL_KEYS[mapped]
    if (keyCode === undefined) {
      throw new Error(`Unsupported Windows key: ${part}`)
    }
    keyCodes.push(keyCode)
    normalized.push(mapped)
  }

  return {
    keyCodes,
    normalized: normalized.join('+'),
  }
}

function normalizeKeyName(key) {
  return String(key || '').trim().toLowerCase().replace(/\s+/g, '')
}

function directionToDelta(direction, amount) {
  const safeAmount = clampInteger(amount, 1, 100)
  switch (String(direction).toLowerCase()) {
    case 'up':
      return { x: 0, y: safeAmount }
    case 'down':
      return { x: 0, y: -safeAmount }
    case 'left':
      return { x: -safeAmount, y: 0 }
    case 'right':
      return { x: safeAmount, y: 0 }
    default:
      throw new Error(`Unsupported scroll direction: ${direction}`)
  }
}
