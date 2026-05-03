/**
 * macOS desktop control helpers for the computer-use plugin.
 */
import { mkdir, readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const BUTTONS = {
  left: {
    button: 'kCGMouseButtonLeft',
    down: 'kCGEventLeftMouseDown',
    up: 'kCGEventLeftMouseUp',
    drag: 'kCGEventLeftMouseDragged',
  },
  right: {
    button: 'kCGMouseButtonRight',
    down: 'kCGEventRightMouseDown',
    up: 'kCGEventRightMouseUp',
    drag: 'kCGEventRightMouseDragged',
  },
  middle: {
    button: 'kCGMouseButtonCenter',
    down: 'kCGEventOtherMouseDown',
    up: 'kCGEventOtherMouseUp',
    drag: 'kCGEventOtherMouseDragged',
  },
}

const KEY_CODES = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9,
  b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17, 1: 18, 2: 19,
  3: 20, 4: 21, 6: 22, 5: 23, '=': 24, 9: 25, 7: 26, '-': 27,
  8: 28, 0: 29, ']': 30, o: 31, u: 32, '[': 33, i: 34, p: 35,
  enter: 36, return: 36, l: 37, j: 38, "'": 39, k: 40, ';': 41,
  '\\': 42, ',': 43, '/': 44, n: 45, m: 46, '.': 47, tab: 48,
  space: 49, '`': 50, delete: 51, backspace: 51, escape: 53, esc: 53,
  command: 55, cmd: 55, shift: 56, capslock: 57, option: 58, alt: 58,
  control: 59, ctrl: 59, rightshift: 60, rightoption: 61, rightcontrol: 62,
  fn: 63, f17: 64, volumeup: 72, volumedown: 73, mute: 74, f18: 79,
  f19: 80, f20: 90, f5: 96, f6: 97, f7: 98, f3: 99, f8: 100, f9: 101,
  f11: 103, f13: 105, f16: 106, f14: 107, f10: 109, f12: 111,
  f15: 113, help: 114, home: 115, pageup: 116, forwarddelete: 117,
  f4: 118, end: 119, f2: 120, pagedown: 121, f1: 122, left: 123,
  right: 124, down: 125, up: 126,
}

const MODIFIERS = new Set(['command', 'cmd', 'shift', 'option', 'alt', 'control', 'ctrl', 'fn'])

export class LocalComputerController {
  constructor(options) {
    this.dataDir = options.dataDir
    this.screenshotFormat = options.screenshotFormat === 'path' ? 'path' : 'base64'
  }

  async observe(options = {}) {
    assertMacOS()
    const includeImage = options.includeImage !== false
    const path = await this.captureScreenshot()
    const result = {
      success: true,
      type: 'screenshot',
      format: this.screenshotFormat,
      path,
      note: 'Coordinates use the macOS global screen coordinate system with origin at the top-left of the main display.',
    }

    if (includeImage && this.screenshotFormat === 'base64') {
      result.image_base64 = (await readFile(path)).toString('base64')
      result.mime_type = 'image/png'
    }

    return result
  }

  async click(x, y, button = 'left', clickCount = 1) {
    const safeButton = normalizeButton(button)
    const safeClickCount = clampInteger(clickCount, 1, 3)
    await runJxa(mouseScript(), {
      action: 'click',
      x: integerCoord(x, 'x'),
      y: integerCoord(y, 'y'),
      button: safeButton,
      clickCount: safeClickCount,
    })
    return { success: true, action: 'click', x, y, button: safeButton, clickCount: safeClickCount }
  }

  async move(x, y) {
    await runJxa(mouseScript(), {
      action: 'move',
      x: integerCoord(x, 'x'),
      y: integerCoord(y, 'y'),
    })
    return { success: true, action: 'move', x, y }
  }

  async drag(startX, startY, endX, endY, durationMs = 500, button = 'left') {
    const safeButton = normalizeButton(button)
    await runJxa(mouseScript(), {
      action: 'drag',
      startX: integerCoord(startX, 'startX'),
      startY: integerCoord(startY, 'startY'),
      endX: integerCoord(endX, 'endX'),
      endY: integerCoord(endY, 'endY'),
      durationMs: clampInteger(durationMs, 50, 10000),
      button: safeButton,
    })
    return { success: true, action: 'drag', startX, startY, endX, endY, button: safeButton }
  }

  async typeText(text) {
    assertMacOS()
    if (typeof text !== 'string') {
      throw new Error('text must be a string')
    }
    await runAppleScript(PASTE_TEXT_APPLESCRIPT, [text])
    return { success: true, action: 'type', characters: text.length }
  }

  async pressKeys(keys) {
    assertMacOS()
    const parsed = parseShortcut(keys)
    await runAppleScript(KEY_APPLESCRIPT, [
      String(parsed.keyCode),
      parsed.modifiers.join(','),
    ])
    return { success: true, action: 'key', keys: parsed.normalized }
  }

  async scroll(direction, amount = 5, x, y) {
    const delta = directionToDelta(direction, amount)
    await runJxa(mouseScript(), {
      action: 'scroll',
      x: x === undefined ? null : integerCoord(x, 'x'),
      y: y === undefined ? null : integerCoord(y, 'y'),
      deltaX: delta.x,
      deltaY: delta.y,
    })
    return { success: true, action: 'scroll', direction, amount: Math.abs(delta.x || delta.y), x, y }
  }

  async wait(ms = 1000) {
    const duration = clampInteger(ms, 0, 120000)
    await new Promise(resolve => setTimeout(resolve, duration))
    return { success: true, action: 'wait', ms: duration }
  }

  async captureScreenshot() {
    assertMacOS()
    await mkdir(this.dataDir, { recursive: true })
    const path = join(this.dataDir, `screenshot-${Date.now()}.png`)
    await execFileAsync('/usr/sbin/screencapture', ['-x', '-t', 'png', path], {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    })
    return path
  }
}

function assertMacOS() {
  if (process.platform !== 'darwin') {
    throw new Error('computer-use currently supports local macOS control only')
  }
}

async function runAppleScript(script, args) {
  assertMacOS()
  await execFileAsync('/usr/bin/osascript', ['-e', script, ...args.map(String)], {
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  })
}

async function runJxa(script, payload) {
  assertMacOS()
  await execFileAsync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, JSON.stringify(payload)], {
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  })
}

function mouseScript() {
  return `
ObjC.import('ApplicationServices')

const buttons = ${JSON.stringify(BUTTONS)}

function point(x, y) {
  return $.CGPointMake(x, y)
}

function postMouse(typeName, x, y, buttonName) {
  const event = $.CGEventCreateMouseEvent(null, $[typeName], point(x, y), $[buttonName])
  $.CGEventPost($.kCGHIDEventTap, event)
}

function postMove(x, y) {
  postMouse('kCGEventMouseMoved', x, y, 'kCGMouseButtonLeft')
}

function run(argv) {
  const payload = JSON.parse(argv[0])
  if (payload.action === 'move') {
    postMove(payload.x, payload.y)
    return JSON.stringify({ ok: true })
  }

  if (payload.action === 'click') {
    const button = buttons[payload.button]
    postMove(payload.x, payload.y)
    for (let i = 0; i < payload.clickCount; i += 1) {
      postMouse(button.down, payload.x, payload.y, button.button)
      $.usleep(50000)
      postMouse(button.up, payload.x, payload.y, button.button)
      $.usleep(80000)
    }
    return JSON.stringify({ ok: true })
  }

  if (payload.action === 'drag') {
    const button = buttons[payload.button]
    const steps = Math.max(4, Math.min(80, Math.round(payload.durationMs / 16)))
    postMove(payload.startX, payload.startY)
    postMouse(button.down, payload.startX, payload.startY, button.button)
    for (let i = 1; i <= steps; i += 1) {
      const x = Math.round(payload.startX + ((payload.endX - payload.startX) * i / steps))
      const y = Math.round(payload.startY + ((payload.endY - payload.startY) * i / steps))
      postMouse(button.drag, x, y, button.button)
      $.usleep(Math.round(payload.durationMs * 1000 / steps))
    }
    postMouse(button.up, payload.endX, payload.endY, button.button)
    return JSON.stringify({ ok: true })
  }

  if (payload.action === 'scroll') {
    if (payload.x !== null && payload.y !== null) {
      postMove(payload.x, payload.y)
    }
    const event = $.CGEventCreateScrollWheelEvent(null, $.kCGScrollEventUnitLine, 2, payload.deltaY, payload.deltaX)
    $.CGEventPost($.kCGHIDEventTap, event)
    return JSON.stringify({ ok: true })
  }

  throw new Error('Unsupported mouse action: ' + payload.action)
}
`
}

const PASTE_TEXT_APPLESCRIPT = `
on run argv
  set textToType to item 1 of argv
  set oldClipboard to missing value
  try
    set oldClipboard to the clipboard
  end try
  set the clipboard to textToType
  delay 0.05
  tell application "System Events"
    keystroke "v" using command down
  end tell
  delay 0.05
  if oldClipboard is not missing value then
    set the clipboard to oldClipboard
  end if
end run
`

const KEY_APPLESCRIPT = `
on run argv
  set targetKeyCode to (item 1 of argv) as integer
  set modifierText to item 2 of argv
  set modifierKeys to {}
  if modifierText contains "command" then set end of modifierKeys to command down
  if modifierText contains "shift" then set end of modifierKeys to shift down
  if modifierText contains "option" then set end of modifierKeys to option down
  if modifierText contains "control" then set end of modifierKeys to control down
  tell application "System Events"
    key code targetKeyCode using modifierKeys
  end tell
end run
`

function normalizeButton(button) {
  const normalized = String(button || 'left').toLowerCase()
  if (!BUTTONS[normalized]) {
    throw new Error(`Unsupported mouse button: ${button}`)
  }
  return normalized
}

function integerCoord(value, name) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    throw new Error(`${name} must be a finite number`)
  }
  return Math.round(number)
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

  const parts = keys.split('+').map(part => normalizeKeyName(part)).filter(Boolean)
  const modifiers = []
  let key = null

  for (const part of parts) {
    if (MODIFIERS.has(part)) {
      const modifier = normalizeModifier(part)
      if (!modifiers.includes(modifier)) {
        modifiers.push(modifier)
      }
    } else {
      key = part
    }
  }

  if (!key) {
    throw new Error(`Shortcut must include a non-modifier key: ${keys}`)
  }

  const keyCode = KEY_CODES[key]
  if (keyCode === undefined) {
    throw new Error(`Unsupported key: ${key}`)
  }

  return {
    keyCode,
    modifiers,
    normalized: [...modifiers, key].join('+'),
  }
}

function normalizeKeyName(key) {
  return String(key || '').trim().toLowerCase().replace(/\s+/g, '')
}

function normalizeModifier(key) {
  if (key === 'cmd') return 'command'
  if (key === 'alt') return 'option'
  if (key === 'ctrl') return 'control'
  return key
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
