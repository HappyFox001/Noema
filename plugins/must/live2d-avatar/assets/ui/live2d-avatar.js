/**
 * Live2D iframe controller.
 *
 * Loads PixiJS and pixi-live2d-display, maps Noema UI state into avatar
 * hooks, and drives mouth parameters from renderer output energy.
 */
const DEFAULT_CONFIG = {
  modelUrl: '../models/Mao/Mao.model3.json',
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
  focusStrength: 0.9,
  pointerTrackingStrength: 1,
  stateMotionsEnabled: false,
  idleMotion: 'Idle',
  listeningMotion: 'Tap',
  thinkingMotion: 'Tap',
  speakingMotion: 'Tap',
  taskMotion: 'Tap',
  errorMotion: 'Tap',
}

const PARAM_IDS = {
  mouthOpen: ['ParamMouthOpenY', 'ParamA', 'PARAM_MOUTH_OPEN_Y'],
  mouthForm: ['ParamMouthForm', 'PARAM_MOUTH_FORM'],
  mouseX: ['ParamMouseX'],
  mouseY: ['ParamMouseY'],
  angleX: ['ParamAngleX'],
  angleY: ['ParamAngleY'],
  angleZ: ['ParamAngleZ'],
  bodyAngleX: ['ParamBodyAngleX'],
  bodyAngleY: ['ParamBodyAngleY'],
  bodyAngleZ: ['ParamBodyAngleZ'],
  bodyUpper: ['ParamBodyUpper'],
  eyeBallX: ['ParamEyeBallX', 'PARAM_EYE_BALL_X'],
  eyeBallY: ['ParamEyeBallY', 'PARAM_EYE_BALL_Y'],
}

const ZERO_POSE = {
  angleX: 0,
  angleY: 0,
  angleZ: 0,
  bodyAngleX: 0,
  bodyAngleY: 0,
  bodyAngleZ: 0,
  bodyUpper: 0,
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
  focusPoint: null,
  pointer: {
    active: false,
    clientX: 0,
    clientY: 0,
    width: 1,
    height: 1,
    targetX: 0,
    targetY: 0,
    smoothX: 0,
    smoothY: 0,
    eyeX: 0,
    eyeY: 0,
    bodyX: 0,
    bodyY: 0,
    eyeVX: 0,
    eyeVY: 0,
    headVX: 0,
    headVY: 0,
    bodyVX: 0,
    bodyVY: 0,
    velocityX: 0,
    velocityY: 0,
  },
  pose: { ...ZERO_POSE },
  targetPose: { ...ZERO_POSE },
  poseVelocity: { ...ZERO_POSE },
  availableParameters: null,
  parameterRanges: new Map(),
  avatarTickerRegistered: false,
  parameterHookRegistered: false,
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
  if (event.data?.type === 'noema:pointer') {
    handlePointerMessage(event.data)
    return
  }
  if (event.data?.type !== 'noema:ui-state') {
    return
  }
  if (event.data.config && typeof event.data.config === 'object') {
    state.config = normalizeConfig({ ...state.config, ...event.data.config })
    syncPointerTrackingState()
    fitModel()
  }
  applyNoemaState(event.data.state)
})

window.addEventListener('resize', resize)
window.addEventListener('pointermove', handlePointerMove, { passive: true })
window.addEventListener('pointerleave', handlePointerLeave, { passive: true })
window.addEventListener('blur', handlePointerLeave)
window.addEventListener('contextmenu', (event) => {
  event.preventDefault()
  window.parent.postMessage({
    type: 'noema:context-menu',
    x: event.clientX,
    y: event.clientY,
  }, '*')
})

async function boot() {
  try {
    if (!state.config.modelUrl) {
      showStatus('请在插件设置里配置 Live2D .model3.json 路径')
      window.parent.postMessage({ type: 'noema:ui-ready' }, '*')
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
    window.parent.postMessage({ type: 'noema:ui-ready' }, '*')
  } catch (error) {
    console.error('[Live2DAvatar] Failed to initialize:', error)
    showStatus(`Live2D 初始化失败：${formatError(error)}`)
    window.parent.postMessage({ type: 'noema:ui-ready' }, '*')
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
    model = await Live2DModel.from(modelSettings, { autoInteract: false, ticker: state.app.ticker })
  } catch (error) {
    throw new Error(`model load failed for ${modelUrl}: ${formatError(error)}`)
  }
  model.anchor?.set?.(0.5, 0.5)
  state.app.stage.addChild(model)
  state.model = model
  state.modelBounds = measureModelBounds(model)
  state.availableParameters = detectAvailableParameters(model)
  state.parameterRanges = detectParameterRanges(model)
  state.focusPoint = new PIXI.Point()
  registerParameterHook()
  ensureAvatarTicker()
  syncPointerTrackingState()
  fitModel()
}

function registerParameterHook() {
  const internalModel = state.model?.internalModel
  if (state.parameterHookRegistered || !internalModel || typeof internalModel.on !== 'function') {
    return
  }
  internalModel.on('beforeModelUpdate', applyLive2DParameterHooks)
  state.parameterHookRegistered = true
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

function applyNoemaState(nextState) {
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

  if (!state.config.mouseTracking && nextState?.expression?.emotion) {
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
  if (state.config.mouseTracking) {
    state.targetPose = { ...ZERO_POSE }
    return
  }

  state.targetPose = getModePose(mode)
  if (!state.config.stateMotionsEnabled) {
    return
  }

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
    // Some models do not name expressions after Noema emotions.
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
  updatePointerTracking(delta)
  updatePoseTracking(delta)
}

function applyLive2DParameterHooks() {
  applyPointerParameterHooks()
  addModelParam(getMouthOpenParamIds(), state.mouth, 1)
  addModelParam(PARAM_IDS.mouthForm, Math.sin(performance.now() / 85) * state.mouth * 0.22, 0.35)
}

function applyPointerParameterHooks() {
  if (!state.config.mouseTracking) {
    return
  }

  const dragX = clampNumber(state.pointer.eyeX, -1, 1, 0)
  const dragY = clampNumber(state.pointer.eyeY, -1, 1, 0)
  const xRatio = (1 - dragX) / 2
  const yRatio = (1 - dragY) / 2
  const strength = state.config.pointerTrackingStrength
  const pose = state.pose

  setRangedModelParam(PARAM_IDS.mouseX, xRatio, strength)
  setRangedModelParam(PARAM_IDS.mouseY, yRatio, strength)
  addTrackingParam(PARAM_IDS.angleX, pose.angleX, 30)
  addTrackingParam(PARAM_IDS.angleY, pose.angleY, 30)
  addTrackingParam(PARAM_IDS.angleZ, pose.angleZ, 30)
  addTrackingParam(PARAM_IDS.bodyAngleX, pose.bodyAngleX, 10)
  addTrackingParam(PARAM_IDS.bodyAngleY, pose.bodyAngleY, 10)
  addTrackingParam(PARAM_IDS.bodyAngleZ, pose.bodyAngleZ, 10)
  addTrackingParam(PARAM_IDS.bodyUpper, pose.bodyUpper, 1)
  addTrackingParam(PARAM_IDS.eyeBallX, dragX * 0.68 * strength, 1)
  addTrackingParam(PARAM_IDS.eyeBallY, dragY * 0.68 * strength, 1)
}

function setRangedModelParam(ids, ratio, strength, normalizedOverride) {
  const coreModel = state.model?.internalModel?.coreModel
  if (!coreModel) {
    return
  }

  for (const id of ids) {
    if (state.availableParameters && !state.availableParameters.has(id)) {
      continue
    }

    const range = state.parameterRanges.get(id) || getFallbackParameterRange(id)
    if (!range) {
      continue
    }

    const normalized = normalizedOverride ?? (1 - ratio * 2)
    const value = range.default + normalized * (normalized >= 0
      ? range.max - range.default
      : range.default - range.min) * strength

    try {
      if (typeof coreModel.setParameterValueById === 'function') {
        coreModel.setParameterValueById(id, clampNumber(value, range.min, range.max, range.default))
        return
      }
    } catch {
      // Try the next common parameter alias.
    }
  }
}

function addTrackingParam(ids, value, maxAbs) {
  addModelParam(ids, value, maxAbs)
}

function getFallbackParameterRange(id) {
  if (id.includes('EyeBall')) {
    return { min: -1, max: 1, default: 0 }
  }
  if (id.includes('BodyAngle')) {
    return { min: -10, max: 10, default: 0 }
  }
  if (id.includes('BodyUpper')) {
    return { min: -1, max: 1, default: 0 }
  }
  if (id.includes('Angle')) {
    return { min: -30, max: 30, default: 0 }
  }
  if (id.includes('Mouse')) {
    return { min: -1, max: 1, default: 0 }
  }
  return null
}

function addModelParam(ids, value, maxAbs) {
  const coreModel = state.model?.internalModel?.coreModel
  if (!coreModel) {
    return
  }

  const clamped = Math.max(-maxAbs, Math.min(maxAbs, value))
  for (const id of ids) {
    if (state.availableParameters && !state.availableParameters.has(id)) {
      continue
    }
    try {
      if (typeof coreModel.addParameterValueById === 'function') {
        coreModel.addParameterValueById(id, clamped)
      } else if (typeof coreModel.setParameterValueById === 'function') {
        coreModel.setParameterValueById(id, clamped)
      } else {
        return
      }
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
    focusStrength: normalizeFocusStrength(config.focusStrength),
    pointerTrackingStrength: clampNumber(config.pointerTrackingStrength, 0.1, 2, DEFAULT_CONFIG.pointerTrackingStrength),
    stateMotionsEnabled: config.stateMotionsEnabled === true,
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

function updatePointerTarget(clientX, clientY, width = window.innerWidth, height = window.innerHeight) {
  const centerX = width / 2 + state.config.offsetX
  const centerY = height / 2 + state.config.offsetY
  const rangeX = Math.max(1, width * 0.5)
  const rangeY = Math.max(1, height * 0.5)
  state.pointer.active = true
  state.pointer.clientX = clientX
  state.pointer.clientY = clientY
  state.pointer.width = width
  state.pointer.height = height
  const nextX = clampNumber((clientX - centerX) / rangeX, -1, 1, 0)
  const nextY = clampNumber((centerY - clientY) / rangeY, -1, 1, 0)
  state.pointer.velocityX = nextX - state.pointer.targetX
  state.pointer.velocityY = nextY - state.pointer.targetY
  state.pointer.targetX = nextX
  state.pointer.targetY = nextY
  if (!state.config.mouseTracking) {
    focusModelAt(clientX, clientY, true)
  }
}

function handlePointerLeave() {
  state.pointer.active = false
  state.pointer.clientX = window.innerWidth / 2 + state.config.offsetX
  state.pointer.clientY = window.innerHeight / 2 + state.config.offsetY
  state.pointer.width = window.innerWidth
  state.pointer.height = window.innerHeight
  state.pointer.targetX = 0
  state.pointer.targetY = 0
  state.pointer.velocityX = 0
  state.pointer.velocityY = 0
  resetModelFocus()
}

function updatePointerTracking(delta) {
  const targetX = state.pointer.active ? shapeLookInput(state.pointer.targetX) : 0
  const targetY = state.pointer.active ? shapeLookInput(state.pointer.targetY) : 0

  const eyeX = stepSecondOrder(state.pointer.eyeX, state.pointer.eyeVX, targetX, 11.5, 0.78, 16, delta)
  const eyeY = stepSecondOrder(state.pointer.eyeY, state.pointer.eyeVY, targetY, 11.5, 0.78, 16, delta)
  state.pointer.eyeX = eyeX.value
  state.pointer.eyeVX = eyeX.velocity
  state.pointer.eyeY = eyeY.value
  state.pointer.eyeVY = eyeY.velocity

  const headX = stepSecondOrder(state.pointer.smoothX, state.pointer.headVX, targetX, 5.8, 0.86, 8, delta)
  const headY = stepSecondOrder(state.pointer.smoothY, state.pointer.headVY, targetY, 5.8, 0.86, 8, delta)
  state.pointer.smoothX = headX.value
  state.pointer.headVX = headX.velocity
  state.pointer.smoothY = headY.value
  state.pointer.headVY = headY.velocity

  const bodyTargetX = targetX * 0.86
  const bodyTargetY = targetY * 0.72
  const bodyX = stepSecondOrder(state.pointer.bodyX, state.pointer.bodyVX, bodyTargetX, 2.7, 0.95, 3.2, delta)
  const bodyY = stepSecondOrder(state.pointer.bodyY, state.pointer.bodyVY, bodyTargetY, 2.7, 0.95, 3.2, delta)
  state.pointer.bodyX = bodyX.value
  state.pointer.bodyVX = bodyX.velocity
  state.pointer.bodyY = bodyY.value
  state.pointer.bodyVY = bodyY.velocity
}

function updatePoseTracking(delta) {
  const dragX = clampNumber(state.pointer.smoothX, -1, 1, 0)
  const dragY = clampNumber(state.pointer.smoothY, -1, 1, 0)
  const bodyX = clampNumber(state.pointer.bodyX, -1, 1, 0)
  const bodyY = clampNumber(state.pointer.bodyY, -1, 1, 0)
  const strength = state.config.pointerTrackingStrength
  const basePose = state.config.mouseTracking ? ZERO_POSE : getModePose(state.lastMode)
  const activeWeight = state.pointer.active ? 1 : 0.38
  const mouseWeight = state.config.mouseTracking ? 1 : 0

  state.targetPose = {
    angleX: basePose.angleX + dragX * 20 * strength * activeWeight * mouseWeight,
    angleY: basePose.angleY + dragY * 14 * strength * activeWeight * mouseWeight,
    angleZ: basePose.angleZ + -dragX * dragY * 8 * strength * activeWeight * mouseWeight,
    bodyAngleX: basePose.bodyAngleX + bodyX * 8.5 * strength * activeWeight * mouseWeight,
    bodyAngleY: basePose.bodyAngleY + bodyY * 4 * strength * activeWeight * mouseWeight,
    bodyAngleZ: basePose.bodyAngleZ + -bodyX * bodyY * 3.5 * strength * activeWeight * mouseWeight,
    bodyUpper: basePose.bodyUpper + Math.abs(bodyX) * 0.16 * strength * activeWeight * mouseWeight,
  }

  for (const key of Object.keys(ZERO_POSE)) {
    const next = stepSecondOrder(
      state.pose[key],
      state.poseVelocity[key],
      state.targetPose[key],
      getPoseFrequency(key, state.pointer.active),
      getPoseDamping(key),
      getPoseMaxSpeed(key),
      delta
    )
    state.pose[key] = next.value
    state.poseVelocity[key] = next.velocity
  }
}

function syncPointerTrackingState() {
  if (state.config.mouseTracking) {
    return
  }
  handlePointerLeave()
}

function focusModelAt(clientX, clientY, instant = false) {
  if (!state.config.mouseTracking || !state.config.focusStrength || !state.model) {
    return
  }
  try {
    if (typeof state.model.focus === 'function') {
      state.model.focus(clientX, clientY, instant)
      const focusController = state.model.internalModel?.focusController
      if (focusController && Number.isFinite(focusController.targetX) && Number.isFinite(focusController.targetY)) {
        focusController.targetX = clampNumber(focusController.targetX * state.config.focusStrength, -1, 1, 0)
        focusController.targetY = clampNumber(focusController.targetY * state.config.focusStrength, -1, 1, 0)
        if (instant || state.pointer.active) {
          focusController.x += (focusController.targetX - focusController.x) * 0.78
          focusController.y += (focusController.targetY - focusController.y) * 0.78
          focusController.vx = 0
          focusController.vy = 0
        }
      }
      return
    }

    const focusController = state.model.internalModel?.focusController
    if (!focusController || typeof focusController.focus !== 'function' || !state.focusPoint || typeof state.model.toModelPosition !== 'function') {
      return
    }
    state.focusPoint.x = clientX
    state.focusPoint.y = clientY
    state.model.toModelPosition(state.focusPoint, state.focusPoint, true)
    const tx = (state.focusPoint.x / state.model.internalModel.originalWidth) * 2 - 1
    const ty = (state.focusPoint.y / state.model.internalModel.originalHeight) * 2 - 1
    const radian = Math.atan2(ty, tx)
    focusController.focus(
      Math.cos(radian) * state.config.focusStrength,
      -Math.sin(radian) * state.config.focusStrength,
      instant
    )
  } catch {
    // Some model implementations do not expose the same focus helpers.
  }
}

function resetModelFocus() {
  const focusController = state.model?.internalModel?.focusController
  if (!focusController || typeof focusController.focus !== 'function') {
    return
  }
  try {
    focusController.focus(0, 0)
  } catch {
    // Focus will naturally remain where the model runtime leaves it.
  }
}

function normalizeFocusStrength(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0.5) {
    return DEFAULT_CONFIG.focusStrength
  }
  return Math.max(0.05, Math.min(1.5, number))
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

function detectParameterRanges(model) {
  const coreModel = model?.internalModel?.coreModel
  const ranges = new Map()
  if (!coreModel) {
    return ranges
  }

  const ids = readCoreModelParameterIds(coreModel)
  ids.forEach((id, index) => {
    const range = readParameterRange(coreModel, id, index)
    if (range) {
      ranges.set(id, range)
    }
  })
  return ranges
}

function readParameterRange(coreModel, id, index) {
  const min = readParameterBound(coreModel, id, index, 'min')
  const max = readParameterBound(coreModel, id, index, 'max')
  const defaultValue = readParameterBound(coreModel, id, index, 'default')
  if (![min, max, defaultValue].every(Number.isFinite)) {
    return null
  }
  return { min, max, default: defaultValue }
}

function readParameterBound(coreModel, id, index, type) {
  const methodNames = {
    min: ['getParameterMinimumValueById', 'getParameterMinimumValue'],
    max: ['getParameterMaximumValueById', 'getParameterMaximumValue'],
    default: ['getParameterDefaultValueById', 'getParameterDefaultValue'],
  }[type]

  for (const methodName of methodNames) {
    if (typeof coreModel[methodName] !== 'function') {
      continue
    }
    try {
      const value = coreModel[methodName](methodName.endsWith('ById') ? id : index)
      if (Number.isFinite(value)) {
        return value
      }
    } catch {
      // Try array-backed metadata next.
    }
  }

  const arrayNames = {
    min: ['minimumValues', 'minValues'],
    max: ['maximumValues', 'maxValues'],
    default: ['defaultValues'],
  }[type]

  for (const arrayName of arrayNames) {
    const value = coreModel.parameters?.[arrayName]?.[index] ?? coreModel[arrayName]?.[index]
    if (Number.isFinite(value)) {
      return value
    }
  }

  return NaN
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
      return { ...ZERO_POSE, angleX: -4, angleY: 3, bodyAngleX: -2.5, bodyAngleY: 0.8 }
    case 'thinking':
      return { ...ZERO_POSE, angleX: 5, angleY: -3, angleZ: -1, bodyAngleX: 2.5, bodyAngleY: -0.8 }
    case 'speaking':
      return { ...ZERO_POSE, angleY: 1.5, bodyUpper: 0.08 }
    case 'task':
      return { ...ZERO_POSE, angleX: 4, angleY: 1.5, bodyAngleX: 3, bodyAngleY: 0.6 }
    default:
      return { ...ZERO_POSE }
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
  return String(value || DEFAULT_CONFIG.modelUrl).trim()
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

function shapeLookInput(value) {
  const clamped = clampNumber(value, -1, 1, 0)
  const sign = Math.sign(clamped)
  const magnitude = Math.abs(clamped)
  const deadzone = 0.025
  if (magnitude <= deadzone) {
    return 0
  }
  const normalized = (magnitude - deadzone) / (1 - deadzone)
  return sign * Math.pow(normalized, 0.78)
}

function stepSecondOrder(current, velocity, target, frequency, damping, maxSpeed, delta) {
  let value = Number.isFinite(current) ? current : 0
  let nextVelocity = Number.isFinite(velocity) ? velocity : 0
  const safeTarget = Number.isFinite(target) ? target : 0
  const totalDt = Math.max(0.001, Math.min(0.05, Number(delta) / 60))
  const steps = Math.max(1, Math.ceil(totalDt / (1 / 120)))
  const dt = totalDt / steps
  const omega = Math.max(0.001, frequency) * Math.PI * 2
  const zeta = Math.max(0.05, damping)

  for (let i = 0; i < steps; i++) {
    const acceleration = omega * omega * (safeTarget - value) - 2 * zeta * omega * nextVelocity
    nextVelocity += acceleration * dt
    nextVelocity = clampNumber(nextVelocity, -maxSpeed, maxSpeed, 0)
    value += nextVelocity * dt
  }

  return { value, velocity: nextVelocity }
}

function getPoseFrequency(key, active) {
  if (key.startsWith('body') || key === 'bodyUpper') {
    return active ? 2.5 : 1.7
  }
  if (key === 'angleZ') {
    return active ? 4.2 : 2.5
  }
  return active ? 5.6 : 3
}

function getPoseDamping(key) {
  if (key.startsWith('body') || key === 'bodyUpper') {
    return 0.96
  }
  if (key === 'angleZ') {
    return 0.9
  }
  return 0.84
}

function getPoseMaxSpeed(key) {
  if (key === 'bodyUpper') {
    return 1.2
  }
  if (key.startsWith('body')) {
    return 32
  }
  return 72
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
