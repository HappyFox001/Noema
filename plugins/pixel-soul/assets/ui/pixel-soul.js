const canvas = document.getElementById('stage')
const ctx = canvas.getContext('2d', { alpha: true })

const particles = []
const targetState = {
  mode: 'idle',
  inputEnergy: 0,
  outputEnergy: 0,
  taskVisible: false,
}

let width = 1
let height = 1
let dpr = 1
let lastTime = performance.now()
let interruptBurst = 0
let previousMode = 'idle'

const PALETTE = {
  fur: ['#ffe86a', '#ffd43b', '#ffbf2f', '#f6a81f'],
  belly: ['#fff3a0', '#ffe377', '#ffd45a'],
  shadow: ['#7a4b16', '#5a3511', '#2a2112'],
  ear: ['#ffe86a', '#ffd43b', '#2a2112', '#11110d'],
  eye: ['#fffdf2', '#1b1b14', '#55d8ff'],
  cheek: ['#ff5a5f', '#ff7872', '#ffd43b'],
  spark: ['#fff9a8', '#ffe44d', '#62d8ff', '#ffffff'],
}

function rand(min, max) {
  return min + Math.random() * (max - min)
}

function choose(items) {
  return items[Math.floor(Math.random() * items.length)]
}

function sampleEllipse(cx, cy, rx, ry) {
  const angle = Math.random() * Math.PI * 2
  const radius = Math.sqrt(Math.random())
  return {
    x: cx + Math.cos(angle) * rx * radius,
    y: cy + Math.sin(angle) * ry * radius,
  }
}

function sampleTriangle(a, b, c) {
  let r1 = Math.random()
  let r2 = Math.random()
  if (r1 + r2 > 1) {
    r1 = 1 - r1
    r2 = 1 - r2
  }
  return {
    x: a.x + r1 * (b.x - a.x) + r2 * (c.x - a.x),
    y: a.y + r1 * (b.y - a.y) + r2 * (c.y - a.y),
  }
}

function sampleCurve(points, thickness) {
  const index = Math.floor(rand(0, points.length - 1))
  const a = points[index]
  const b = points[Math.min(points.length - 1, index + 1)]
  const t = Math.random()
  const x = a.x + (b.x - a.x) * t
  const y = a.y + (b.y - a.y) * t
  const angle = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2
  const offset = rand(-thickness, thickness)
  return {
    x: x + Math.cos(angle) * offset,
    y: y + Math.sin(angle) * offset,
  }
}

function sampleTail() {
  return sampleCurve([
    { x: 52, y: 24 },
    { x: 72, y: 6 },
    { x: 58, y: -12 },
    { x: 86, y: -28 },
    { x: 72, y: -48 },
    { x: 108, y: -68 },
  ], 7)
}

function sampleMouth() {
  const side = Math.random() > 0.5 ? 1 : -1
  return sampleCurve([
    { x: 0, y: -31 },
    { x: side * 6, y: -26 },
    { x: side * 13, y: -29 },
  ], 0.9)
}

function makeParticle(part, point, color, size = 2) {
  const scale = getFigureScale()
  const origin = getFigureOrigin()
  return {
    part,
    lx: point.x,
    ly: point.y,
    x: origin.x + point.x * scale + rand(-50, 50),
    y: origin.y + point.y * scale + rand(-50, 50),
    vx: 0,
    vy: 0,
    color,
    size,
    seed: Math.random() * 1000,
    tension: rand(0.05, 0.105),
  }
}

function addParticles(count, part, sampler, colors, sizeMin, sizeMax) {
  for (let i = 0; i < count; i++) {
    particles.push(makeParticle(part, sampler(), choose(colors), rand(sizeMin, sizeMax)))
  }
}

function buildParticles() {
  particles.length = 0

  addParticles(270, 'body', () => sampleEllipse(0, 21, 47, 48), PALETTE.fur, 1.9, 3.1)
  addParticles(115, 'belly', () => sampleEllipse(-3, 34, 22, 25), PALETTE.belly, 1.7, 2.8)
  addParticles(230, 'head', () => sampleEllipse(-4, -42, 43, 36), PALETTE.fur, 1.8, 3)
  addParticles(72, 'leftEar', () => sampleTriangle({ x: -39, y: -70 }, { x: -54, y: -116 }, { x: -14, y: -76 }), PALETTE.ear, 1.7, 2.7)
  addParticles(72, 'rightEar', () => sampleTriangle({ x: 21, y: -76 }, { x: 50, y: -116 }, { x: 44, y: -68 }), PALETTE.ear, 1.7, 2.7)
  addParticles(42, 'earTip', () => sampleTriangle({ x: -48, y: -93 }, { x: -54, y: -116 }, { x: -32, y: -92 }), ['#1a1710', '#11110d'], 1.7, 2.5)
  addParticles(42, 'earTip', () => sampleTriangle({ x: 38, y: -94 }, { x: 50, y: -116 }, { x: 45, y: -90 }), ['#1a1710', '#11110d'], 1.7, 2.5)
  addParticles(145, 'tail', sampleTail, [...PALETTE.fur, ...PALETTE.shadow], 1.8, 3)
  addParticles(56, 'paw', () => sampleEllipse(-25, 64, 13, 9), PALETTE.fur, 1.7, 2.6)
  addParticles(56, 'paw', () => sampleEllipse(25, 64, 13, 9), PALETTE.fur, 1.7, 2.6)
  addParticles(40, 'paw', () => sampleEllipse(-42, 22, 11, 8), PALETTE.fur, 1.6, 2.4)
  addParticles(40, 'paw', () => sampleEllipse(42, 24, 11, 8), PALETTE.fur, 1.6, 2.4)
  addParticles(24, 'eye', () => sampleEllipse(-20, -50, 4, 6), ['#1b1b14', '#11110d', '#fffdf2'], 1.4, 2.2)
  addParticles(24, 'eye', () => sampleEllipse(12, -50, 4, 6), ['#1b1b14', '#11110d', '#fffdf2'], 1.4, 2.2)
  addParticles(40, 'cheek', () => sampleEllipse(-31, -36, 8, 7), PALETTE.cheek, 1.5, 2.3)
  addParticles(40, 'cheek', () => sampleEllipse(25, -36, 8, 7), PALETTE.cheek, 1.5, 2.3)
  addParticles(18, 'nose', () => sampleTriangle({ x: -5, y: -42 }, { x: 2, y: -42 }, { x: -2, y: -37 }), ['#1b1b14', '#11110d'], 1.3, 1.8)
  addParticles(28, 'mouth', sampleMouth, ['#5a3511', '#fff3a0'], 1.1, 1.6)
  addParticles(160, 'spark', () => {
    const angle = Math.random() * Math.PI * 2
    return {
      x: Math.cos(angle) * rand(72, 108),
      y: Math.sin(angle) * rand(62, 105) - 8,
    }
  }, PALETTE.spark, 1.1, 2.2)
}

function getFigureScale() {
  return Math.min(width / 285, height / 285, 1.34)
}

function getFigureOrigin() {
  return {
    x: width / 2,
    y: height / 2 + 30,
  }
}

function resize() {
  const nextDpr = Math.min(window.devicePixelRatio || 1, 2)
  const rect = canvas.getBoundingClientRect()
  const nextWidth = Math.max(1, Math.round(rect.width))
  const nextHeight = Math.max(1, Math.round(rect.height))

  if (nextWidth === width && nextHeight === height && nextDpr === dpr) {
    return
  }

  width = nextWidth
  height = nextHeight
  dpr = nextDpr
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  buildParticles()
}

function updateState(state) {
  if (!state) return
  const nextMode = state.orb?.mode || 'idle'
  if (nextMode !== previousMode && nextMode === 'interrupted') {
    interruptBurst = 1
  }
  previousMode = nextMode
  targetState.mode = nextMode
  targetState.inputEnergy = Number(state.orb?.inputEnergy || 0)
  targetState.outputEnergy = Number(state.orb?.outputEnergy || 0)
  targetState.taskVisible = Boolean(state.task?.visible)
}

function getPose(time) {
  const energy = Math.max(targetState.inputEnergy, targetState.outputEnergy)
  const listening = targetState.mode === 'listening'
  const speaking = targetState.mode === 'speaking'
  const thinking = targetState.mode === 'thinking'
  const task = targetState.taskVisible
  return {
    breathe: Math.sin(time * (speaking ? 5.6 : 1.8)) * (speaking ? 3.8 : 2.2),
    headTilt: listening ? -4 : thinking ? Math.sin(time * 1.4) * 5 : Math.sin(time * 0.8) * 2.5,
    tail: Math.sin(time * (task ? 3.2 : listening ? 2.6 : 1.35)) * (task ? 10 : listening ? 8 : 5),
    ear: listening ? -7 : thinking ? Math.sin(time * 2.1) * 4 : 0,
    spark: speaking || listening || energy > 0.08,
    crouch: speaking ? Math.sin(time * 8.4) * 2.5 : 0,
    pulse: energy,
    listening,
    speaking,
    thinking,
  }
}

function rotateAround(x, y, pivotX, pivotY, angle) {
  const dx = x - pivotX
  const dy = y - pivotY
  return {
    x: pivotX + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: pivotY + dx * Math.sin(angle) + dy * Math.cos(angle),
  }
}

function targetFor(p, time, pose) {
  const scale = getFigureScale()
  const origin = getFigureOrigin()
  let lx = p.lx
  let ly = p.ly

  if (p.part === 'head' || p.part === 'eye' || p.part === 'nose' || p.part === 'cheek' || p.part === 'mouth') {
    const rotated = rotateAround(lx, ly, -4, -42, pose.headTilt * Math.PI / 180)
    lx = rotated.x
    ly = rotated.y
    ly += pose.crouch * 0.35
  }

  if (p.part === 'leftEar' || p.part === 'rightEar' || p.part === 'earTip') {
    const isLeft = lx < 0
    const pivotX = isLeft ? -23 : 28
    const pivotY = -72
    const direction = isLeft ? -1 : 1
    const rotated = rotateAround(lx, ly, pivotX, pivotY, (pose.headTilt + pose.ear * direction) * Math.PI / 180)
    lx = rotated.x
    ly = rotated.y
  }

  if (p.part === 'body' || p.part === 'belly') {
    ly += pose.breathe * 0.35 + pose.crouch
    lx += Math.sin(time * 0.7 + p.seed) * 0.8
  }

  if (p.part === 'tail') {
    const bend = Math.sin((ly + 80) * 0.028 + time * 1.8) * 2.2 + pose.tail
    lx += bend
    ly += Math.cos(time * 1.2 + p.seed) * 1.2
  }

  if (p.part === 'paw') {
    ly += pose.crouch * 0.45
    if (pose.listening || pose.spark) {
      lx += Math.sin(time * 3.2 + p.seed) * 1.4
    }
  }

  if (p.part === 'spark') {
    const orbit = time * 0.32 + p.seed
    lx += Math.cos(orbit) * (6 + pose.pulse * 24)
    ly += Math.sin(orbit * 1.3) * (7 + pose.pulse * 20)
    if (pose.spark) {
      lx += Math.sign(Math.sin(p.seed)) * Math.sin(time * 12 + p.seed) * 6
      ly += Math.cos(time * 10 + p.seed) * 4
    }
    if (pose.thinking) {
      lx += Math.cos(time * 2.2 + p.seed) * 11
      ly += Math.sin(time * 2.2 + p.seed) * 11
    }
  }

  if (pose.speaking && (p.part === 'head' || p.part === 'nose' || p.part === 'mouth' || p.part === 'cheek')) {
    ly += Math.sin(time * 12 + p.seed) * (1.1 + pose.pulse * 4)
  }

  const scatter = interruptBurst > 0
    ? {
        x: Math.cos(p.seed * 6.283) * 72 * interruptBurst,
        y: Math.sin(p.seed * 6.283) * 72 * interruptBurst,
      }
    : { x: 0, y: 0 }

  return {
    x: origin.x + lx * scale + scatter.x,
    y: origin.y + ly * scale + scatter.y,
  }
}

function drawPixel(x, y, size, color, alpha) {
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(size)), Math.max(1, Math.round(size)))
}

function render(now) {
  resize()
  const dt = Math.min(32, now - lastTime) / 16.67
  lastTime = now
  const time = now / 1000
  const pose = getPose(time)

  ctx.globalCompositeOperation = 'source-over'
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.001)'
  ctx.fillRect(0, 0, width, height)

  interruptBurst = Math.max(0, interruptBurst - 0.055 * dt)
  ctx.globalCompositeOperation = 'lighter'

  for (const p of particles) {
    const target = targetFor(p, time, pose)
    const flowX = Math.sin(time * 0.9 + p.seed) * (p.part === 'spark' ? 0.18 : 0.04)
    const flowY = Math.cos(time * 0.8 + p.seed * 1.7) * (p.part === 'spark' ? 0.18 : 0.04)
    const tension = p.tension * (p.part === 'spark' ? 0.42 : 1) * (1 + pose.pulse * 0.7)
    p.vx += (target.x - p.x) * tension + flowX
    p.vy += (target.y - p.y) * tension + flowY
    p.vx *= p.part === 'spark' ? 0.86 : 0.78
    p.vy *= p.part === 'spark' ? 0.86 : 0.78
    p.x += p.vx * dt
    p.y += p.vy * dt

    const alpha = p.part === 'spark'
      ? 0.20 + pose.pulse * 0.36
      : p.part === 'eye' || p.part === 'nose'
          ? 0.95
          : p.part === 'cheek'
            ? 0.88
          : 0.78 + pose.pulse * 0.16
    const size = p.size * getFigureScale() * (1 + (p.part === 'spark' ? pose.pulse * 2.1 : pose.pulse * 0.36))
    drawPixel(p.x, p.y, size, p.color, alpha)
  }

  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  requestAnimationFrame(render)
}

window.addEventListener('resize', resize)
window.addEventListener('message', (event) => {
  if (event.data?.type === 'her-text:ui-state') {
    updateState(event.data.state)
  }
})

window.addEventListener('contextmenu', (event) => {
  event.preventDefault()
  window.parent.postMessage({
    type: 'her-text:context-menu',
    x: event.clientX,
    y: event.clientY,
  }, '*')
})

window.parent.postMessage({ type: 'her-text:ui-ready' }, '*')
resize()
requestAnimationFrame(render)
