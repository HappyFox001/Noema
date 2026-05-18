/**
 * Live2D iframe controller.
 *
 * Loads PixiJS and pixi-live2d-display, maps Her-Text UI state into avatar
 * hooks, and drives mouth parameters from renderer output energy.
 */
const DEFAULT_CONFIG = {
  modelUrl: '',
  pixiUrl: 'https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js',
  cubismCoreUrl: 'https://cdn.jsdelivr.net/npm/live2dcubismcore@1.0.2/live2dcubismcore.min.js',
  live2dDisplayUrl: 'https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism4.min.js',
  scale: 0.24,
  offsetX: 0,
  offsetY: 0,
  lipSyncGain: 1.8,
  idleMotion: 'Idle',
  listeningMotion: 'TapBody',
  thinkingMotion: 'Thinking',
  speakingMotion: 'TapBody',
  taskMotion: 'FlickHead',
  errorMotion: 'Shake',
}

const PARAM_IDS = {
  mouthOpen: ['ParamMouthOpenY', 'PARAM_MOUTH_OPEN_Y'],
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
  lastMotionAt: 0,
  statePayload: null,
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
    showStatus(`Live2D 初始化失败：${error instanceof Error ? error.message : String(error)}`)
    window.parent.postMessage({ type: 'her-text:ui-ready' }, '*')
  }
}

async function createPixiApp() {
  state.app = new PIXI.Application({
    view: canvas,
    autoStart: true,
    autoDensity: true,
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

  const model = await Live2DModel.from(modelUrl, { autoInteract: false })
  model.anchor?.set?.(0.5, 0.5)
  state.app.stage.addChild(model)
  state.model = model
  fitModel()
}

function applyHerTextState(nextState) {
  state.statePayload = nextState || null
  const mode = pickAvatarMode(nextState)
  const outputEnergy = clampNumber(nextState?.orb?.outputEnergy, 0, 1)
  state.targetMouth = Math.min(1, outputEnergy * state.config.lipSyncGain)

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

  try {
    expressionManager.setExpression(emotion)
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

  const ease = Math.min(1, delta * 0.22)
  state.mouth += (state.targetMouth - state.mouth) * ease
  setModelParam(PARAM_IDS.mouthOpen, state.mouth, 1)
  setModelParam(PARAM_IDS.mouthForm, state.mouth * 0.3, 0.35)

  const now = performance.now() / 1000
  const listeningEnergy = clampNumber(state.statePayload?.orb?.inputEnergy, 0, 1)
  const outputEnergy = clampNumber(state.statePayload?.orb?.outputEnergy, 0, 1)
  const attention = Math.max(listeningEnergy, outputEnergy)
  setModelParam(PARAM_IDS.angleX, Math.sin(now * 0.9) * (4 + attention * 5), 30)
  setModelParam(PARAM_IDS.angleY, Math.sin(now * 0.7) * (2 + attention * 3), 30)
  setModelParam(PARAM_IDS.bodyAngleX, Math.sin(now * 0.55) * 3, 10)
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
  const width = state.app.renderer.width
  const height = state.app.renderer.height
  state.model.x = width / 2 + state.config.offsetX
  state.model.y = height * 0.64 + state.config.offsetY
  state.model.scale.set(state.config.scale)
}

function resize() {
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
  return {
    ...DEFAULT_CONFIG,
    ...config,
    modelUrl: String(config.modelUrl || '').trim(),
    pixiUrl: String(config.pixiUrl || DEFAULT_CONFIG.pixiUrl),
    cubismCoreUrl: String(config.cubismCoreUrl || DEFAULT_CONFIG.cubismCoreUrl),
    live2dDisplayUrl: String(config.live2dDisplayUrl || DEFAULT_CONFIG.live2dDisplayUrl),
    scale: clampNumber(config.scale, 0.05, 1.5, DEFAULT_CONFIG.scale),
    offsetX: clampNumber(config.offsetX, -600, 600, 0),
    offsetY: clampNumber(config.offsetY, -600, 600, 0),
    lipSyncGain: clampNumber(config.lipSyncGain, 0, 8, DEFAULT_CONFIG.lipSyncGain),
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
