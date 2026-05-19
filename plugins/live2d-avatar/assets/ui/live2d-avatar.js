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
  bodyAngleX: ['ParamBodyAngleX'],
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
}

const canvas = document.getElementById('stage')
const statusEl = document.getElementById('status')

boot()

window.addEventListener('message', (event) => {
  if (event.data?.type !== 'her-text:ui-state') {
    return
  }
  if (event.data.config && typeof event.data.config === 'object') {
    state.config = normalizeConfig({ ...state.config, ...event.data.config })
    fitModel()
  }
  applyHerTextState(event.data.state)
})

window.addEventListener('resize', resize)
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
  state.app.ticker.add(updateAvatar)
}

async function loadModel(modelUrl) {
  const Live2DModel = PIXI.live2d?.Live2DModel
  if (!Live2DModel) {
    throw new Error('PIXI.live2d.Live2DModel is unavailable')
  }

  const modelSettings = await loadModelSettings(modelUrl)
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
  fitModel()
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
  startMotion(motionByMode[mode])
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
  setModelParam(PARAM_IDS.mouthOpen, state.mouth, 1)
  setModelParam(PARAM_IDS.mouthForm, Math.sin(performance.now() / 85) * state.mouth * 0.22, 0.35)

  const now = performance.now() / 1000
  const listeningEnergy = clampNumber(state.statePayload?.orb?.inputEnergy, 0, 1)
  const outputEnergy = clampNumber(state.statePayload?.orb?.outputEnergy, 0, 1)
  const attention = Math.max(listeningEnergy, outputEnergy)
  const modePose = getModePose(state.lastMode)
  setModelParam(PARAM_IDS.angleX, modePose.angleX + Math.sin(now * 0.9) * (4 + attention * 5), 30)
  setModelParam(PARAM_IDS.angleY, modePose.angleY + Math.sin(now * 0.7) * (2 + attention * 3), 30)
  setModelParam(PARAM_IDS.bodyAngleX, modePose.bodyAngleX + Math.sin(now * 0.55) * 3, 10)
  setModelParam(PARAM_IDS.breath, 0.45 + Math.sin(now * 2.1) * 0.18 + attention * 0.16, 1)
}

function setModelParam(ids, value, maxAbs) {
  const coreModel = state.model?.internalModel?.coreModel
  if (!coreModel || typeof coreModel.setParameterValueById !== 'function') {
    return
  }

  const clamped = Math.max(-maxAbs, Math.min(maxAbs, value))
  for (const id of ids) {
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
  }
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
