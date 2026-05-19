/**
 * Live2D iframe controller.
 *
 * Loads PixiJS and pixi-live2d-display, maps Her-Text UI state into avatar
 * hooks, and drives mouth parameters from renderer output energy.
 */
const DEFAULT_CONFIG = {
  modelUrl: '../models/Haru/haru_greeter_t03.model3.json',
  pixiUrl: 'https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js',
  cubismCoreUrl: 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js',
  live2dDisplayUrl: 'https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism4.min.js',
  scale: 1,
  autoFit: true,
  fitPadding: 12,
  maxWidthRatio: 0.96,
  maxHeightRatio: 0.98,
  offsetX: 0,
  offsetY: 0,
  lipSyncGain: 1.8,
  lipSyncAttack: 0.42,
  lipSyncRelease: 0.16,
  mouseTracking: true,
  lookAtSmoothing: 0.32,
  focusStrength: 1,
  eyeTrackingStrength: 1,
  headTrackingStrength: 0.85,
  bodyTrackingStrength: 0.35,
  idleMotion: 'Idle',
  listeningMotion: 'Tap',
  thinkingMotion: 'Tap',
  speakingMotion: 'Tap',
  taskMotion: 'Tap',
  errorMotion: 'Tap',
}

const OLD_BUNDLED_MODEL_URLS = new Set([
  '../models/Mao/Mao.model3.json',
  'models/Mao/Mao.model3.json',
])

const PARAM_IDS = {
  mouthOpen: ['ParamMouthOpenY', 'ParamA', 'PARAM_MOUTH_OPEN_Y'],
  mouthForm: ['ParamMouthForm', 'PARAM_MOUTH_FORM'],
  angleX: ['ParamAngleX'],
  angleY: ['ParamAngleY'],
  angleZ: ['ParamAngleZ'],
  eyeBallX: ['ParamEyeBallX', 'PARAM_EYE_BALL_X'],
  eyeBallY: ['ParamEyeBallY', 'PARAM_EYE_BALL_Y'],
  bodyAngleX: ['ParamBodyAngleX'],
  bodyAngleY: ['ParamBodyAngleY'],
  bodyAngleZ: ['ParamBodyAngleZ'],
  breath: ['ParamBreath'],
}

const state = {
  config: readInitialConfig(),
  app: null,
  model: null,
  lastMode: '',
  targetMouth: 0,
  mouth: 0,
  energyEnvelope: 0,
  lastExpression: '',
  lastMotionAt: 0,
  statePayload: null,
  modelBounds: null,
  pointer: {
    active: false,
    targetX: 0,
    targetY: 0,
    x: 0,
    y: 0,
  },
  availableParameters: null,
  avatarTickerRegistered: false,
  modelCapabilities: {
    motionGroups: new Set(),
    expressions: new Set(),
    lipSyncParameters: [],
  },
}

const canvas = document.getElementById('stage')
const statusEl = document.getElementById('status')

boot()

window.addEventListener('message', (event) => {
  if (event.data?.type === 'her-text:pointer') {
    handlePointerMessage(event.data)
    return
  }
  if (event.data?.type !== 'her-text:ui-state') {
    return
  }
  if (event.data.config && typeof event.data.config === 'object') {
    state.config = normalizeConfig({ ...state.config, ...event.data.config })
    syncPointerTrackingState()
    fitModel()
  }
  applyHerTextState(event.data.state)
})

window.addEventListener('resize', resize)
window.addEventListener('pointermove', handlePointerMove, { passive: true })
window.addEventListener('pointerleave', handlePointerLeave, { passive: true })
window.addEventListener('blur', handlePointerLeave)
window.addEventListener('contextmenu', (event) => {
  event.preventDefault()
  window.parent.postMessage({
    type: 'her-text:context-menu',
    x: event.clientX,
    y: event.clientY,
  }, '*')
})

async function boot() {
  try {
    if (!state.config.modelUrl) {
      showStatus('请在插件设置里配置 Live2D .model3.json 路径')
      window.parent.postMessage({ type: 'her-text:ui-ready' }, '*')
      return
    }

    state.config.modelUrl = resolveModelUrl(state.config.modelUrl)
    await loadScript(state.config.pixiUrl, 'PIXI')
    window.PIXI = window.PIXI || PIXI
    await loadScript(state.config.cubismCoreUrl, 'Live2DCubismCore')
    await loadScript(state.config.live2dDisplayUrl, 'PIXI.live2d')
    await createPixiApp()
    await loadModel(state.config.modelUrl)
    hideStatus()
    window.parent.postMessage({ type: 'her-text:ui-ready' }, '*')
  } catch (error) {
    console.error('[Live2DAvatar] Failed to initialize:', error)
    showStatus(`Live2D 初始化失败：${formatError(error)}`)
    window.parent.postMessage({ type: 'her-text:ui-ready' }, '*')
  }
}

async function createPixiApp() {
  const resolution = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
  state.app = new PIXI.Application({
    view: canvas,
    autoStart: true,
    autoDensity: true,
    resolution,
    resizeTo: window,
    transparent: true,
    antialias: true,
    backgroundAlpha: 0,
  })
}

async function loadModel(modelUrl) {
  const Live2DModel = PIXI.live2d?.Live2DModel
  if (!Live2DModel) {
    throw new Error('PIXI.live2d.Live2DModel is unavailable')
  }

  const modelSettings = await loadModelSettings(modelUrl)
  state.modelCapabilities = extractModelCapabilities(modelSettings)
  let model
  try {
    model = await Live2DModel.from(modelSettings, { autoInteract: false })
  } catch (error) {
    throw new Error(`model load failed for ${modelUrl}: ${formatError(error)}`)
  }
  model.anchor?.set?.(0.5, 0.5)
  state.app.stage.addChild(model)
  state.model = model
  state.modelBounds = measureModelBounds(model)
  state.availableParameters = detectAvailableParameters(model)
  ensureAvatarTicker()
  syncPointerTrackingState()
  fitModel()
}

function ensureAvatarTicker() {
  if (state.avatarTickerRegistered) {
    return
  }
  const priority = PIXI.UPDATE_PRIORITY?.LOW ?? -25
  state.app.ticker.add(updateAvatar, null, priority)
  state.avatarTickerRegistered = true
}

async function loadModelSettings(modelUrl) {
  const response = await fetch(modelUrl)
  if (!response.ok) {
    throw new Error(`model settings request failed: ${response.status} ${modelUrl}`)
  }

  const settings = await response.json()
  settings.url = modelUrl
  return settings
}

function applyHerTextState(nextState) {
  state.statePayload = nextState || null
  const mode = pickAvatarMode(nextState)
  const outputEnergy = clampNumber(nextState?.orb?.outputEnergy, 0, 1)
  const gatedEnergy = mode === 'speaking' || mode === 'task'
    ? outputEnergy
    : outputEnergy * 0.35
  state.targetMouth = Math.min(1, gatedEnergy * state.config.lipSyncGain)

  if (mode !== state.lastMode) {
    state.lastMode = mode
    triggerModeHook(mode)
  }

  if (nextState?.expression?.emotion) {
    applyExpressionHook(nextState.expression.emotion)
  }
}

function pickAvatarMode(nextState) {
  if (nextState?.task?.visible) {
    return 'task'
  }
  if (nextState?.activeMode === 'listening' || nextState?.orb?.mode === 'listening') {
    return 'listening'
  }
  if (nextState?.orb?.mode === 'speaking') {
    return 'speaking'
  }
  if (nextState?.orb?.mode === 'thinking' || nextState?.phase === 'task_progress') {
    return 'thinking'
  }
  return 'idle'
}

function triggerModeHook(mode) {
  const motionByMode = {
    idle: state.config.idleMotion,
    listening: state.config.listeningMotion,
    thinking: state.config.thinkingMotion,
    speaking: state.config.speakingMotion,
    task: state.config.taskMotion,
    error: state.config.errorMotion,
  }
  startMotion(resolveMotionGroup(mode, motionByMode[mode]))
}

function applyExpressionHook(emotion) {
  const expressionManager = state.model?.internalModel?.motionManager?.expressionManager
  if (!expressionManager || typeof expressionManager.setExpression !== 'function') {
    return
  }

  const expression = mapEmotionToExpression(emotion)
  if (!expression || expression === state.lastExpression) {
    return
  }
  if (state.modelCapabilities.expressions.size && !state.modelCapabilities.expressions.has(expression)) {
    return
  }

  try {
    expressionManager.setExpression(expression)
    state.lastExpression = expression
  } catch {
    // Some models do not name expressions after Her-Text emotions.
  }
}

function startMotion(group) {
  if (!group || !state.model || performance.now() - state.lastMotionAt < 900) {
    return
  }
  state.lastMotionAt = performance.now()
  try {
    state.model.motion(group)
  } catch {
    // Motion groups are model-specific; missing groups should not break the avatar.
  }
}

function updateAvatar(delta) {
  if (!state.model) {
    return
  }

  const attack = state.config.lipSyncAttack
  const release = state.config.lipSyncRelease
  const envelopeEase = state.targetMouth > state.energyEnvelope ? attack : release
  state.energyEnvelope += (state.targetMouth - state.energyEnvelope) * Math.min(1, delta * envelopeEase)
  const ease = state.energyEnvelope > state.mouth ? 0.42 : 0.22
  state.mouth += (state.energyEnvelope - state.mouth) * Math.min(1, delta * ease)
  setModelParam(getMouthOpenParamIds(), state.mouth, 1)
  setModelParam(PARAM_IDS.mouthForm, Math.sin(performance.now() / 85) * state.mouth * 0.22, 0.35)

  const now = performance.now() / 1000
  const listeningEnergy = clampNumber(state.statePayload?.orb?.inputEnergy, 0, 1)
  const outputEnergy = clampNumber(state.statePayload?.orb?.outputEnergy, 0, 1)
  const attention = Math.max(listeningEnergy, outputEnergy)
  const modePose = getModePose(state.lastMode)
  const look = updateLookAt(delta)
  setModelParam(PARAM_IDS.eyeBallX, look.eyeX, 1)
  setModelParam(PARAM_IDS.eyeBallY, look.eyeY, 1)
  setModelParam(PARAM_IDS.angleX, modePose.angleX + Math.sin(now * 0.9) * (4 + attention * 5) + look.headX, 30)
  setModelParam(PARAM_IDS.angleY, modePose.angleY + Math.sin(now * 0.7) * (2 + attention * 3) + look.headY, 30)
  setModelParam(PARAM_IDS.angleZ, look.headZ, 30)
  setModelParam(PARAM_IDS.bodyAngleX, modePose.bodyAngleX + Math.sin(now * 0.55) * 3 + look.bodyX, 10)
  setModelParam(PARAM_IDS.bodyAngleY, look.bodyY, 10)
  setModelParam(PARAM_IDS.bodyAngleZ, look.bodyZ, 10)
  setModelParam(PARAM_IDS.breath, 0.45 + Math.sin(now * 2.1) * 0.18 + attention * 0.16, 1)
}

function updateLookAt(delta) {
  if (!state.config.mouseTracking) {
    state.pointer.x += (0 - state.pointer.x) * Math.min(1, delta * 0.16)
    state.pointer.y += (0 - state.pointer.y) * Math.min(1, delta * 0.16)
  } else {
    const smoothing = state.config.lookAtSmoothing
    state.pointer.x += (state.pointer.targetX - state.pointer.x) * Math.min(1, delta * smoothing)
    state.pointer.y += (state.pointer.targetY - state.pointer.y) * Math.min(1, delta * smoothing)
  }

  const x = clampNumber(state.pointer.x, -1, 1, 0)
  const y = clampNumber(state.pointer.y, -1, 1, 0)
  return {
    eyeX: x * state.config.eyeTrackingStrength,
    eyeY: -y * state.config.eyeTrackingStrength,
    headX: x * 24 * state.config.headTrackingStrength,
    headY: -y * 16 * state.config.headTrackingStrength,
    headZ: -x * 9 * state.config.headTrackingStrength,
    bodyX: x * 10 * state.config.bodyTrackingStrength,
    bodyY: -y * 6 * state.config.bodyTrackingStrength,
    bodyZ: -x * 6 * state.config.bodyTrackingStrength,
  }
}

function setModelParam(ids, value, maxAbs) {
  const coreModel = state.model?.internalModel?.coreModel
  if (!coreModel || typeof coreModel.setParameterValueById !== 'function') {
    return
  }

  const clamped = Math.max(-maxAbs, Math.min(maxAbs, value))
  for (const id of ids) {
    if (state.availableParameters && !state.availableParameters.has(id)) {
      continue
    }
    try {
      coreModel.setParameterValueById(id, clamped)
      return
    } catch {
      // Try the next common parameter alias.
    }
  }
}

function fitModel() {
  if (!state.model || !state.app) {
    return
  }
  const width = state.app.screen.width
  const height = state.app.screen.height
  const scale = state.config.autoFit
    ? getFittedScale(width, height) * state.config.scale
    : state.config.scale
  state.model.scale.set(scale)
  state.model.x = width / 2 + state.config.offsetX
  state.model.y = height / 2 + state.config.offsetY
}

function resize() {
  const nextResolution = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
  if (state.app?.renderer && state.app.renderer.resolution !== nextResolution) {
    state.app.renderer.resolution = nextResolution
  }
  state.app?.renderer?.resize?.(window.innerWidth, window.innerHeight)
  fitModel()
}

function readInitialConfig() {
  const params = new URLSearchParams(window.location.search)
  const encoded = params.get('pluginConfig')
  if (!encoded) {
    return normalizeConfig(DEFAULT_CONFIG)
  }

  try {
    return normalizeConfig({
      ...DEFAULT_CONFIG,
      ...JSON.parse(decodeURIComponent(escape(atob(encoded)))),
    })
  } catch (error) {
    console.warn('[Live2DAvatar] Failed to parse plugin config:', error)
    return normalizeConfig(DEFAULT_CONFIG)
  }
}

function normalizeConfig(config) {
  const modelUrl = normalizeModelUrl(config.modelUrl)
  return {
    ...DEFAULT_CONFIG,
    ...config,
    modelUrl,
    pixiUrl: String(config.pixiUrl || DEFAULT_CONFIG.pixiUrl),
    cubismCoreUrl: String(config.cubismCoreUrl || DEFAULT_CONFIG.cubismCoreUrl),
    live2dDisplayUrl: String(config.live2dDisplayUrl || DEFAULT_CONFIG.live2dDisplayUrl),
    scale: clampNumber(config.scale, 0.05, 1.5, DEFAULT_CONFIG.scale),
    autoFit: config.autoFit !== false,
    fitPadding: clampNumber(config.fitPadding, 0, 160, DEFAULT_CONFIG.fitPadding),
    maxWidthRatio: clampNumber(config.maxWidthRatio, 0.35, 1, DEFAULT_CONFIG.maxWidthRatio),
    maxHeightRatio: clampNumber(config.maxHeightRatio, 0.35, 1, DEFAULT_CONFIG.maxHeightRatio),
    offsetX: clampNumber(config.offsetX, -600, 600, 0),
    offsetY: clampNumber(config.offsetY, -600, 600, 0),
    lipSyncGain: clampNumber(config.lipSyncGain, 0, 8, DEFAULT_CONFIG.lipSyncGain),
    lipSyncAttack: clampNumber(config.lipSyncAttack, 0.05, 1, DEFAULT_CONFIG.lipSyncAttack),
    lipSyncRelease: clampNumber(config.lipSyncRelease, 0.02, 1, DEFAULT_CONFIG.lipSyncRelease),
    mouseTracking: config.mouseTracking !== false,
    lookAtSmoothing: clampNumber(config.lookAtSmoothing, 0.02, 0.65, DEFAULT_CONFIG.lookAtSmoothing),
    focusStrength: clampNumber(config.focusStrength, 0, 1.5, DEFAULT_CONFIG.focusStrength),
    eyeTrackingStrength: clampNumber(config.eyeTrackingStrength, 0, 1.5, DEFAULT_CONFIG.eyeTrackingStrength),
    headTrackingStrength: clampNumber(config.headTrackingStrength, 0, 1.5, DEFAULT_CONFIG.headTrackingStrength),
    bodyTrackingStrength: clampNumber(config.bodyTrackingStrength, 0, 1.5, DEFAULT_CONFIG.bodyTrackingStrength),
  }
}

function handlePointerMove(event) {
  if (!state.config.mouseTracking || !state.model) {
    return
  }

  updatePointerTarget(event.clientX, event.clientY, window.innerWidth, window.innerHeight)
}

function handlePointerMessage(payload) {
  const width = Math.max(1, Number(payload.width) || window.innerWidth)
  const height = Math.max(1, Number(payload.height) || window.innerHeight)
  if (!state.config.mouseTracking || !state.model || payload.active === false) {
    handlePointerLeave(width, height)
    return
  }

  const x = clampNumber(payload.x, -width, width * 2, width / 2)
  const y = clampNumber(payload.y, -height, height * 2, height / 2)
  updatePointerTarget(x, y, width, height)
}

function updatePointerTarget(clientX, clientY, width, height) {
  const centerX = width / 2 + state.config.offsetX
  const centerY = height / 2 + state.config.offsetY
  const rangeX = Math.max(1, width * 0.5)
  const rangeY = Math.max(1, height * 0.5)
  state.pointer.active = true
  state.pointer.targetX = clampNumber((clientX - centerX) / rangeX, -1, 1, 0)
  state.pointer.targetY = clampNumber((clientY - centerY) / rangeY, -1, 1, 0)
  applyBuiltInFocus(clientX, clientY, width, height)
}

function handlePointerLeave(width = window.innerWidth, height = window.innerHeight) {
  state.pointer.active = false
  state.pointer.targetX = 0
  state.pointer.targetY = 0
  if (state.config.focusStrength && typeof state.model?.focus === 'function') {
    try {
      state.model.focus(width / 2 + state.config.offsetX, height / 2 + state.config.offsetY)
    } catch {
      // Explicit parameters ease back to center even if built-in focus is unavailable.
    }
  }
}

function syncPointerTrackingState() {
  if (state.config.mouseTracking) {
    return
  }
  handlePointerLeave()
  if (state.model && typeof state.model.focus === 'function') {
    try {
      state.model.focus(window.innerWidth / 2 + state.config.offsetX, window.innerHeight / 2 + state.config.offsetY, true)
    } catch {
      // The next ticker update will also ease explicit parameters back to center.
    }
  }
}

function applyBuiltInFocus(clientX, clientY, width = window.innerWidth, height = window.innerHeight) {
  if (!state.config.focusStrength || typeof state.model?.focus !== 'function') {
    return
  }

  const centerX = width / 2 + state.config.offsetX
  const centerY = height / 2 + state.config.offsetY
  const x = centerX + (clientX - centerX) * state.config.focusStrength
  const y = centerY + (clientY - centerY) * state.config.focusStrength
  try {
    state.model.focus(x, y)
  } catch {
    // The explicit parameter layer still provides a conservative fallback.
  }
}

function extractModelCapabilities(settings) {
  const fileReferences = settings.FileReferences || settings.fileReferences || {}
  const motions = fileReferences.Motions || fileReferences.motions || {}
  const expressions = fileReferences.Expressions || fileReferences.expressions || []
  const groups = settings.Groups || settings.groups || []
  const lipSyncParameters = []

  for (const group of Array.isArray(groups) ? groups : []) {
    const target = String(group.Target || group.target || '').toLowerCase()
    const name = String(group.Name || group.name || '').toLowerCase()
    if (!target.includes('parameter') || name !== 'lipsync') {
      continue
    }
    const ids = group.Ids || group.ids || []
    for (const id of Array.isArray(ids) ? ids : []) {
      if (typeof id === 'string' && !lipSyncParameters.includes(id)) {
        lipSyncParameters.push(id)
      }
    }
  }

  return {
    motionGroups: new Set(Object.keys(motions)),
    expressions: new Set(expressions
      .map(expression => expression.Name || expression.name)
      .filter(name => typeof name === 'string' && name.length > 0)),
    lipSyncParameters,
  }
}

function resolveMotionGroup(mode, configuredGroup) {
  const motionGroups = state.modelCapabilities.motionGroups
  if (!motionGroups.size) {
    return configuredGroup
  }
  if (configuredGroup && motionGroups.has(configuredGroup)) {
    return configuredGroup
  }

  const fallbackByMode = {
    idle: ['Idle', 'idle'],
    listening: ['Tap', 'TapBody', 'Touch', 'Idle'],
    thinking: ['Tap', 'TapBody', 'Touch', 'Idle'],
    speaking: ['Tap', 'TapBody', 'Touch', 'Idle'],
    task: ['Tap', 'TapBody', 'Touch', 'Idle'],
    error: ['Tap', 'TapBody', 'Touch', 'Idle'],
  }
  const candidates = fallbackByMode[mode] || ['Idle']
  for (const candidate of candidates) {
    if (motionGroups.has(candidate)) {
      return candidate
    }
  }
  return motionGroups.values().next().value || ''
}

function getMouthOpenParamIds() {
  const lipSyncParameters = state.modelCapabilities.lipSyncParameters || []
  return lipSyncParameters.length
    ? [...lipSyncParameters, ...PARAM_IDS.mouthOpen]
    : PARAM_IDS.mouthOpen
}

function detectAvailableParameters(model) {
  const coreModel = model?.internalModel?.coreModel
  if (!coreModel) {
    return null
  }

  const ids = readCoreModelParameterIds(coreModel)
  return ids.length ? new Set(ids) : null
}

function readCoreModelParameterIds(coreModel) {
  if (Array.isArray(coreModel.parameterIds)) {
    return coreModel.parameterIds.filter(id => typeof id === 'string')
  }
  if (Array.isArray(coreModel.parameters?.ids)) {
    return coreModel.parameters.ids.filter(id => typeof id === 'string')
  }
  if (typeof coreModel.getParameterIds === 'function') {
    try {
      const ids = coreModel.getParameterIds()
      return Array.from(ids || []).filter(id => typeof id === 'string')
    } catch {
      return []
    }
  }
  if (typeof coreModel.getParameterCount === 'function' && typeof coreModel.getParameterId === 'function') {
    try {
      const count = coreModel.getParameterCount()
      const ids = []
      for (let index = 0; index < count; index++) {
        const id = coreModel.getParameterId(index)
        if (typeof id === 'string') {
          ids.push(id)
        }
      }
      return ids
    } catch {
      return []
    }
  }
  return []
}

function measureModelBounds(model) {
  const bounds = model.getLocalBounds?.()
  if (bounds?.width > 0 && bounds?.height > 0) {
    return {
      width: bounds.width,
      height: bounds.height,
    }
  }

  const width = model.internalModel?.width || model.width || 1
  const height = model.internalModel?.height || model.height || 1
  return { width, height }
}

function getFittedScale(viewWidth, viewHeight) {
  const bounds = state.modelBounds || measureModelBounds(state.model)
  const padding = state.config.fitPadding * 2
  const maxWidth = Math.max(1, viewWidth * state.config.maxWidthRatio - padding)
  const maxHeight = Math.max(1, viewHeight * state.config.maxHeightRatio - padding)
  return Math.max(0.01, Math.min(maxWidth / bounds.width, maxHeight / bounds.height))
}

function getModePose(mode) {
  switch (mode) {
    case 'listening':
      return { angleX: -5, angleY: 2, bodyAngleX: -2 }
    case 'thinking':
      return { angleX: 5, angleY: -2, bodyAngleX: 2 }
    case 'speaking':
      return { angleX: 0, angleY: 1, bodyAngleX: 0 }
    case 'task':
      return { angleX: 4, angleY: 1, bodyAngleX: 3 }
    default:
      return { angleX: 0, angleY: 0, bodyAngleX: 0 }
  }
}

function mapEmotionToExpression(emotion) {
  const normalized = String(emotion || '').toLowerCase()
  if (normalized.includes('happy') || normalized.includes('joy') || normalized.includes('smile')) {
    return 'f01'
  }
  if (normalized.includes('sad') || normalized.includes('cry')) {
    return 'f03'
  }
  if (normalized.includes('angry') || normalized.includes('annoy')) {
    return 'f04'
  }
  if (normalized.includes('surprise') || normalized.includes('shock')) {
    return 'f05'
  }
  if (normalized.includes('shy') || normalized.includes('embarrass')) {
    return 'f06'
  }
  return ''
}

function resolveModelUrl(modelUrl) {
  return new URL(modelUrl, window.location.href).toString()
}

function normalizeModelUrl(value) {
  const raw = String(value || DEFAULT_CONFIG.modelUrl).trim()
  return OLD_BUNDLED_MODEL_URLS.has(raw) ? DEFAULT_CONFIG.modelUrl : raw
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message || error.name
  }
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function clampNumber(value, min, max, fallback = min) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return fallback
  }
  return Math.max(min, Math.min(max, number))
}

function loadScript(src, globalName) {
  return new Promise((resolve, reject) => {
    if (hasGlobal(globalName)) {
      resolve()
      return
    }

    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`failed to load ${src}`))
    document.head.appendChild(script)
  })
}

function hasGlobal(globalName) {
  return globalName.split('.').reduce((value, key) => value?.[key], window) !== undefined
}

function showStatus(text) {
  statusEl.textContent = text
  statusEl.classList.add('visible')
}

function hideStatus() {
  statusEl.classList.remove('visible')
}
