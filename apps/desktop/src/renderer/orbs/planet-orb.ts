/**
 * WebGPU renderer for the singularity black-hole orb.
 *
 * This file ports the original other/singularity BlackHole.js NodeMaterial
 * path instead of approximating the effect with a 2D fragment shader.
 */
import * as THREE from 'three/webgpu'
import {
  Fn,
  If,
  Loop,
  abs,
  asin,
  cameraPosition,
  clamp,
  color,
  cos,
  dot,
  equirectUV,
  faceDirection,
  float,
  fract,
  length,
  mat3,
  max,
  mix,
  modelWorldMatrix,
  mul,
  normalize,
  positionGeometry,
  positionWorld,
  pow,
  sin,
  smoothstep,
  step,
  sub,
  texture,
  time,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'

const SINGULARITY_NOISE_URL = new URL('./singularity-assets/noise_deep.png', import.meta.url).href
const SINGULARITY_NEBULA_URL = new URL('./singularity-assets/nebula.webp', import.meta.url).href

export type PlanetOrbMode = 'idle' | 'listening' | 'thinking' | 'speaking' | 'interrupted'

type SingularityUniforms = {
  iterations: ReturnType<typeof uniform>
  stepSize: ReturnType<typeof uniform>
  noiseFactor: ReturnType<typeof uniform>
  power: ReturnType<typeof uniform>
  originRadius: ReturnType<typeof uniform>
  width: ReturnType<typeof uniform>
  rampCol1: ReturnType<typeof uniform>
  rampPos1: ReturnType<typeof uniform>
  rampCol2: ReturnType<typeof uniform>
  rampPos2: ReturnType<typeof uniform>
  rampCol3: ReturnType<typeof uniform>
  rampPos3: ReturnType<typeof uniform>
  rampEmission: ReturnType<typeof uniform>
  emissionColor: ReturnType<typeof uniform>
}

type PlanetOrbPalette = {
  rampCol1: [number, number, number]
  rampCol2: [number, number, number]
  rampCol3: [number, number, number]
  emissionColor: [number, number, number]
  baseEmission: number
  energyEmission: number
  energyStep: number
  energyPower: number
  noiseFactor: number
}

export class PlanetOrbRenderer {
  private renderer: any = null
  private scene: THREE.Scene | null = null
  private camera: THREE.PerspectiveCamera | null = null
  private material: any = null
  private mesh: THREE.Mesh | null = null
  private noiseTexture: THREE.Texture | null = null
  private nebulaTexture: THREE.Texture | null = null
  private uniforms: SingularityUniforms | null = null
  private animationFrame: number | null = null
  private enabled = false
  private initialized = false
  private mode: PlanetOrbMode = 'idle'
  private inputEnergy = 0
  private outputEnergy = 0
  private energyUpdatedAt = performance.now()
  private pointerTarget = new THREE.Vector2()
  private pointerCurrent = new THREE.Vector2()
  private cursorSampledAt = 0
  private cursorRequestPending = false
  private renderFailureReported = false

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onRenderFailure?: () => void
  ) {}

  async setEnabled(enabled: boolean): Promise<boolean> {
    this.enabled = enabled
    this.canvas.classList.toggle('active', enabled)
    if (!enabled) {
      this.stop()
      return true
    }

    try {
      await this.initialize()
      this.start()
      return true
    } catch (error) {
      console.error('[PlanetOrb] Failed to initialize singularity orb:', error)
      this.enabled = false
      this.canvas.classList.remove('active')
      return false
    }
  }

  setMode(mode: PlanetOrbMode): void {
    this.mode = mode
    this.applyMode()
  }

  updateAudioEnergy(source: 'input' | 'output', samples: Int16Array | Uint8Array): void {
    const next = calculatePcmEnergy(samples)
    if (source === 'input') {
      this.inputEnergy = Math.max(this.inputEnergy * 0.72, next)
    } else {
      this.outputEnergy = Math.max(this.outputEnergy * 0.70, next)
    }
    this.energyUpdatedAt = performance.now()
  }

  resize(): void {
    if (!this.renderer || !this.camera) return
    const rect = this.canvas.getBoundingClientRect()
    const width = Math.max(1, Math.round(rect.width || 180))
    const height = Math.max(1, Math.round(rect.height || 180))
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  dispose(): void {
    this.stop()
    this.material?.dispose?.()
    this.mesh?.geometry.dispose()
    this.noiseTexture?.dispose()
    this.nebulaTexture?.dispose()
    this.renderer?.dispose?.()
    this.renderer = null
    this.scene = null
    this.camera = null
    this.material = null
    this.mesh = null
    this.noiseTexture = null
    this.nebulaTexture = null
    this.uniforms = null
    this.initialized = false
  }

  private async initialize(): Promise<void> {
    if (this.initialized && this.renderer && this.scene && this.camera && this.material) return

    const renderer = new THREE.WebGPURenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      stencil: false,
      depth: true,
      forceWebGL: true,
    })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.2
    renderer.setClearColor(0x000000, 0)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    camera.position.set(1, 0.5, 3)
    camera.lookAt(0, 0, 0)
    scene.add(camera)

    const textureLoader = new THREE.TextureLoader()
    const noiseTexture = await loadTexture(textureLoader, SINGULARITY_NOISE_URL)
    noiseTexture.wrapS = THREE.RepeatWrapping
    noiseTexture.wrapT = THREE.RepeatWrapping
    noiseTexture.generateMipmaps = false
    noiseTexture.minFilter = THREE.LinearFilter
    noiseTexture.magFilter = THREE.LinearFilter
    noiseTexture.needsUpdate = true

    const nebulaTexture = await loadTexture(textureLoader, SINGULARITY_NEBULA_URL)
    nebulaTexture.mapping = THREE.EquirectangularReflectionMapping
    nebulaTexture.colorSpace = THREE.SRGBColorSpace
    nebulaTexture.generateMipmaps = false
    nebulaTexture.minFilter = THREE.LinearFilter
    nebulaTexture.magFilter = THREE.LinearFilter
    nebulaTexture.needsUpdate = true

    const uniforms = createSingularityUniforms()
    const material = createSingularityNodeMaterial(uniforms, noiseTexture, nebulaTexture)
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 16), material)
    scene.add(mesh)

    this.renderer = renderer
    this.scene = scene
    this.camera = camera
    this.material = material
    this.mesh = mesh
    this.noiseTexture = noiseTexture
    this.nebulaTexture = nebulaTexture
    this.uniforms = uniforms
    this.resize()
    this.applyMode()
    await renderer.init()
    renderer.render(scene, camera)
    this.initialized = true
  }

  private start(): void {
    if (this.animationFrame !== null) return
    this.render()
  }

  private stop(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame)
      this.animationFrame = null
    }
  }

  private render = (): void => {
    if (!this.enabled || !this.renderer || !this.scene || !this.camera || !this.uniforms) {
      this.animationFrame = null
      return
    }

    this.resize()
    const seconds = performance.now() / 1000
    this.updatePointerFromGlobalCursor()
    const orbit = 0.34 + seconds * 0.18
    this.pointerCurrent.lerp(this.pointerTarget, 0.085)
    const yaw = orbit + this.pointerCurrent.x * (Math.PI / 2)
    const basePitch = 0.17 + Math.sin(orbit * 0.72 + 0.8) * 0.04
    const pitch = Math.max(
      -Math.PI / 2,
      Math.min(Math.PI / 2, basePitch + this.pointerCurrent.y * (Math.PI / 2))
    )
    const distance = 3.05
    const horizontalDistance = Math.cos(pitch) * distance
    this.camera.position.set(
      Math.sin(yaw) * horizontalDistance,
      Math.sin(pitch) * distance,
      Math.cos(yaw) * horizontalDistance
    )
    this.camera.lookAt(0, 0, 0)

    const energy = this.getEnergy()
    const palette = getPlanetOrbPalette(this.mode)
    this.uniforms.stepSize.value = 0.0071 * (1 + energy * palette.energyStep)
    this.uniforms.power.value = 0.3 * (1 + energy * palette.energyPower)
    this.uniforms.noiseFactor.value = palette.noiseFactor * (1 + energy * 0.28)
    this.uniforms.rampEmission.value = palette.baseEmission + energy * palette.energyEmission
    try {
      this.renderer.render(this.scene, this.camera)
    } catch (error) {
      this.reportRenderFailure(error)
      return
    }
    this.animationFrame = requestAnimationFrame(this.render)
  }

  private reportRenderFailure(error: unknown): void {
    if (!this.renderFailureReported) {
      console.error('[PlanetOrb] Failed to render singularity orb:', error)
      this.renderFailureReported = true
    }
    this.enabled = false
    this.canvas.classList.remove('active')
    this.stop()
    this.onRenderFailure?.()
  }

  private applyMode(): void {
    if (!this.uniforms) return
    const palette = getPlanetOrbPalette(this.mode)
    this.uniforms.rampCol1.value.setRGB(...palette.rampCol1)
    this.uniforms.rampCol2.value.setRGB(...palette.rampCol2)
    this.uniforms.rampCol3.value.setRGB(...palette.rampCol3)
    this.uniforms.emissionColor.value.setRGB(...palette.emissionColor)
    this.uniforms.noiseFactor.value = palette.noiseFactor
    this.uniforms.power.value = 0.3
    this.uniforms.rampEmission.value = palette.baseEmission
  }

  private getEnergy(): number {
    const now = performance.now()
    const decay = Math.exp(-(now - this.energyUpdatedAt) / 240)
    this.inputEnergy *= decay
    this.outputEnergy *= decay
    this.energyUpdatedAt = now

    if (this.mode === 'listening') return this.inputEnergy
    if (this.mode === 'speaking') return this.outputEnergy
    return Math.max(this.inputEnergy, this.outputEnergy) * 0.35
  }

  private updatePointerFromGlobalCursor(): void {
    const now = performance.now()
    if (this.cursorRequestPending || now - this.cursorSampledAt < 50) return
    this.cursorSampledAt = now
    this.cursorRequestPending = true
    void window.electronAPI.getCursorScreenPoint()
      .then(({ x, y, displayBounds }) => {
        const localX = (x - displayBounds.x) / Math.max(1, displayBounds.width)
        const localY = (y - displayBounds.y) / Math.max(1, displayBounds.height)
        this.pointerTarget.set(
          Math.max(-1, Math.min(1, (localX - 0.5) * 2)),
          Math.max(-1, Math.min(1, (localY - 0.5) * 2))
        )
      })
      .catch(() => {
        this.pointerTarget.set(0, 0)
      })
      .finally(() => {
        this.cursorRequestPending = false
      })
  }
}

function loadTexture(loader: THREE.TextureLoader, url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject)
  })
}

function createSingularityUniforms(): SingularityUniforms {
  return {
    iterations: uniform(float(128)),
    stepSize: uniform(float(0.0071)),
    noiseFactor: uniform(float(0.01)),
    power: uniform(float(0.3)),
    originRadius: uniform(float(0.13)),
    width: uniform(float(0.03)),
    rampCol1: uniform(color(0.95, 0.71, 0.44)),
    rampPos1: uniform(float(0.050)),
    rampCol2: uniform(color(0.14, 0.05, 0.03)),
    rampPos2: uniform(float(0.425)),
    rampCol3: uniform(color(0, 0, 0)),
    rampPos3: uniform(float(1.0)),
    rampEmission: uniform(float(2.0)),
    emissionColor: uniform(color(0.14, 0.129, 0.09)),
  }
}

function getPlanetOrbPalette(mode: PlanetOrbMode): PlanetOrbPalette {
  switch (mode) {
    case 'listening':
      return {
        rampCol1: [0.56, 0.92, 1.0],
        rampCol2: [0.025, 0.16, 0.26],
        rampCol3: [0.0, 0.006, 0.018],
        emissionColor: [0.025, 0.10, 0.16],
        baseEmission: 2.05,
        energyEmission: 0.95,
        energyStep: 0.18,
        energyPower: 0.22,
        noiseFactor: 0.012,
      }
    case 'thinking':
      return {
        rampCol1: [0.98, 0.78, 1.0],
        rampCol2: [0.16, 0.055, 0.24],
        rampCol3: [0.012, 0.0, 0.026],
        emissionColor: [0.11, 0.055, 0.16],
        baseEmission: 2.18,
        energyEmission: 0.55,
        energyStep: 0.12,
        energyPower: 0.18,
        noiseFactor: 0.014,
      }
    case 'speaking':
      return {
        rampCol1: [1.0, 0.66, 0.36],
        rampCol2: [0.25, 0.055, 0.018],
        rampCol3: [0.026, 0.0, 0.0],
        emissionColor: [0.18, 0.07, 0.035],
        baseEmission: 2.18,
        energyEmission: 1.15,
        energyStep: 0.25,
        energyPower: 0.34,
        noiseFactor: 0.013,
      }
    case 'interrupted':
      return {
        rampCol1: [1.0, 0.96, 0.88],
        rampCol2: [0.30, 0.32, 0.42],
        rampCol3: [0.0, 0.0, 0.0],
        emissionColor: [0.20, 0.19, 0.18],
        baseEmission: 2.55,
        energyEmission: 0.20,
        energyStep: 0.08,
        energyPower: 0.10,
        noiseFactor: 0.010,
      }
    default:
      return {
        rampCol1: [0.95, 0.71, 0.44],
        rampCol2: [0.14, 0.05, 0.03],
        rampCol3: [0.0, 0.0, 0.0],
        emissionColor: [0.14, 0.129, 0.09],
        baseEmission: 2.0,
        energyEmission: 0.45,
        energyStep: 0.12,
        energyPower: 0.12,
        noiseFactor: 0.010,
      }
  }
}

function createSingularityNodeMaterial(
  uniforms: SingularityUniforms,
  noiseTexture: THREE.Texture,
  nebulaTexture: THREE.Texture
): any {
  const material = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  })

  material.colorNode = Fn(() => {
    const objCoords = positionGeometry.mul(vec3(1, 1, -1)).xzy
    const isBackface = step(0.0, faceDirection.negate())
    const camPointObj = cameraPosition.mul(modelWorldMatrix).mul(vec3(1, 1, -1)).xzy
    const startCoords = mix(objCoords, camPointObj.xyz, isBackface)

    const viewInWorld = normalize(sub(cameraPosition, positionWorld)).mul(vec3(1, 1, -1)).xzy
    const rayDir = viewInWorld.negate()
    const noiseWhite = whiteNoise2D(objCoords.xy).mul(uniforms.noiseFactor)
    const rayPos = startCoords.sub(rayDir.mul(noiseWhite))

    const colorAcc = vec3(0)
    const alphaAcc = float(0.0)

    Loop(uniforms.iterations, () => {
      const rNorm = normalize(rayPos)
      const rLen = lengthSqrt(rayPos)
      const steerMag = uniforms.stepSize.mul(uniforms.power).div(rLen.mul(rLen))
      const range = remapClamp(rLen, 1.0, 0.5, 0.0, 1.0)
      const steer = rNorm.mul(steerMag.mul(range))
      const steeredDir = rayDir.sub(steer).normalize()

      const advance = rayDir.mul(uniforms.stepSize)
      rayPos.addAssign(advance)

      const xyLen = lengthSqrt(rayPos.mul(vec3(1, 1, 0)))
      const rotPhase = xyLen.mul(4.270).sub(time.mul(0.1))
      const uvRot = rayPos.mul(rotateAxis(vec3(0, 0, 1), rotPhase))
      const diskUv = uvRot.mul(2)

      const noiseDeep = texture(noiseTexture, diskUv)
      const bandMin = uniforms.width.negate()
      const bandEnds = vec3(bandMin, 0.0, uniforms.width)
      const dz = sub(bandEnds, vec3(rayPos.z))
      const zQuad = dz.mul(dz).div(uniforms.width)
      const zBand = max(uniforms.width.sub(zQuad).div(uniforms.width), 0.0)

      const noiseAmp3 = noiseDeep.mul(zBand)
      const noiseAmpLen = lengthSqrt(noiseAmp3)
      const noiseNormal = texture(noiseTexture, diskUv.mul(1.002)).mul(zBand)
      const noiseNormalLen = lengthSqrt(noiseNormal)

      const rampInput = xyLen
        .add(noiseAmpLen.sub(0.780).mul(1.5))
        .add(noiseAmpLen.sub(noiseNormalLen).mul(19.750))

      const rampA = vec4(uniforms.rampCol1, uniforms.rampPos1)
      const rampB = vec4(uniforms.rampCol2, uniforms.rampPos2)
      const rampC = vec4(uniforms.rampCol3, uniforms.rampPos3)
      const baseCol = ColorRamp3_BSpline(rampInput.x, rampA, rampB, rampC)
      const emissiveCol = baseCol.mul(uniforms.rampEmission).add(uniforms.emissionColor)

      const rLenNow = lengthSqrt(rayPos)
      const insideCore = rLenNow.lessThan(uniforms.originRadius)
      const shadedCol = mix(emissiveCol, vec3(0), insideCore)

      const zAbs = abs(rayPos.z)
      const aNoise = noiseAmpLen.sub(0.750).mul(-0.60)
      const aPre = zAbs.add(aNoise)
      const aRadial = smoothRange(xyLen, 1.0, 0.0, 0.0, 1.0)
      const aBand = smoothRange(aPre, uniforms.width, 0, 0, aRadial)
      const alphaLocal = mix(aBand, 1.0, insideCore)

      const weight = alphaAcc.oneMinus().mul(vecToFac(alphaLocal))
      colorAcc.assign(mix(colorAcc, shadedCol, weight))
      alphaAcc.assign(mix(alphaAcc, 1.0, vecToFac(alphaLocal)))

      rayPos.addAssign(advance)
      rayDir.assign(steeredDir)
    })

    return srgbToLinear(colorAcc)
  })()

  material.opacityNode = Fn(() => {
    const objCoords = positionGeometry.mul(vec3(1, 1, -1)).xzy
    const isBackface = step(0.0, faceDirection.negate())
    const camPointObj = cameraPosition.mul(modelWorldMatrix).mul(vec3(1, 1, -1)).xzy
    const startCoords = mix(objCoords, camPointObj.xyz, isBackface)

    const viewInWorld = normalize(sub(cameraPosition, positionWorld)).mul(vec3(1, 1, -1)).xzy
    const rayDir = viewInWorld.negate()
    const noiseWhite = whiteNoise2D(objCoords.xy).mul(uniforms.noiseFactor)
    const rayPos = startCoords.sub(rayDir.mul(noiseWhite))
    const alphaAcc = float(0.0)

    Loop(uniforms.iterations, () => {
      const rNorm = normalize(rayPos)
      const rLen = lengthSqrt(rayPos)
      const steerMag = uniforms.stepSize.mul(uniforms.power).div(rLen.mul(rLen))
      const range = remapClamp(rLen, 1.0, 0.5, 0.0, 1.0)
      const steer = rNorm.mul(steerMag.mul(range))
      const steeredDir = rayDir.sub(steer).normalize()

      const advance = rayDir.mul(uniforms.stepSize)
      rayPos.addAssign(advance)

      const xyLen = lengthSqrt(rayPos.mul(vec3(1, 1, 0)))
      const rotPhase = xyLen.mul(4.270).sub(time.mul(0.1))
      const uvRot = rayPos.mul(rotateAxis(vec3(0, 0, 1), rotPhase))
      const diskUv = uvRot.mul(2)

      const noiseDeep = texture(noiseTexture, diskUv)
      const bandMin = uniforms.width.negate()
      const bandEnds = vec3(bandMin, 0.0, uniforms.width)
      const dz = sub(bandEnds, vec3(rayPos.z))
      const zQuad = dz.mul(dz).div(uniforms.width)
      const zBand = max(uniforms.width.sub(zQuad).div(uniforms.width), 0.0)

      const noiseAmp3 = noiseDeep.mul(zBand)
      const noiseAmpLen = lengthSqrt(noiseAmp3)
      const zAbs = abs(rayPos.z)
      const aNoise = noiseAmpLen.sub(0.750).mul(-0.60)
      const aPre = zAbs.add(aNoise)
      const aRadial = smoothRange(xyLen, 1.0, 0.0, 0.0, 1.0)
      const aBand = smoothRange(aPre, uniforms.width, 0, 0, aRadial)
      const insideCore = lengthSqrt(rayPos).lessThan(uniforms.originRadius)
      const alphaLocal = mix(aBand, 1.0, insideCore)

      alphaAcc.assign(mix(alphaAcc, 1.0, vecToFac(alphaLocal)))
      rayPos.addAssign(advance)
      rayDir.assign(steeredDir)
    })

    return smoothstep(0.18, 0.62, alphaAcc)
  })()

  material.emissiveNode = material.colorNode
  return material
}

const rotateAxis = Fn(([axisImmutable, angleImmutable]) => {
  const angle = float(angleImmutable).toVar()
  const axis = vec3(axisImmutable).toVar()
  const s = sin(angle).toVar()
  const c = cos(angle).toVar()
  const oc = sub(1.0, c).toVar()

  return mat3(
    oc.mul(axis.x).mul(axis.x).add(c),
    oc.mul(axis.x).mul(axis.y).sub(axis.z.mul(s)),
    oc.mul(axis.z).mul(axis.x).add(axis.y.mul(s)),
    oc.mul(axis.x).mul(axis.y).add(axis.z.mul(s)),
    oc.mul(axis.y).mul(axis.y).add(c),
    oc.mul(axis.y).mul(axis.z).sub(axis.x.mul(s)),
    oc.mul(axis.z).mul(axis.x).sub(axis.y.mul(s)),
    oc.mul(axis.y).mul(axis.z).add(axis.x.mul(s)),
    oc.mul(axis.z).mul(axis.z).add(c)
  )
}, { axis: 'vec3', angle: 'float', return: 'mat3' } as any)

const srgbToLinear = Fn(([rgb]) => {
  return mix(rgb.div(12.92), pow(rgb.add(0.055).div(1.055), vec3(2.4)), step(0.04045, rgb))
})

const linearToSrgb = Fn(([lin]) => {
  const low = lin.mul(12.92)
  const high = pow(lin, vec3(1.0 / 2.4)).mul(1.055).sub(0.055)
  return mix(low, high, step(0.0031308, lin))
})

const vecToFac = Fn(([vector]) => {
  return vector.r.mul(0.2126).add(vector.g.mul(0.7152)).add(vector.b.mul(0.0722)).toVar()
})

const CatmulRom = Fn(([T, D, C, B, A]) => {
  return mul(
    0.5,
    mul(2.0, B)
      .add(A.negate().add(C).mul(T))
      .add(mul(2.0, A).sub(mul(5.0, B)).add(mul(4.0, C)).sub(D).mul(T).mul(T))
      .add(A.negate().add(mul(3.0, B)).sub(mul(3.0, C)).add(D).mul(T).mul(T).mul(T))
  )
}, { T: 'float', D: 'vec3', C: 'vec3', B: 'vec3', A: 'vec3', return: 'vec3' } as any)

const ColorRamp3_BSpline = Fn(([T, A, B, C]) => {
  const ab = B.w.sub(A.w)
  const bc = C.w.sub(B.w)
  const iab = T.sub(A.w).div(ab).saturate()
  const ibc = T.sub(B.w).div(bc).saturate()
  const p = vec3(sub(1.0, iab), iab.sub(ibc), ibc)
  const cA = CatmulRom(p.x, A.xyz, A.xyz, B.xyz, C.xyz)
  const cB = CatmulRom(p.y, A.xyz, B.xyz, C.xyz, C.xyz)

  If(T.lessThan(B.w), () => cA.xyz)
  If(T.lessThan(C.w), () => cB.xyz)
  return C.xyz
}, { T: 'float', A: 'vec4', B: 'vec4', C: 'vec4', return: 'vec3' } as any)

const whiteNoise2D = (coord: any): any => fract(sin(dot(coord, vec2(12.9898, 78.233))).mul(43758.5453))

const lengthSqrt = Fn(([v]) => {
  return v.x.mul(v.x).add(v.y.mul(v.y)).add(v.z.mul(v.z)).sqrt()
})

const smoothRange = Fn(([value, inMin, inMax, outMin, outMax]) => {
  const t = clamp(value.sub(inMin).div(inMax.sub(inMin)), 0.0, 1.0)
  const smoothT = t.mul(t).mul(float(3.0).sub(t.mul(2.0)))
  return mix(outMin, outMax, smoothT)
}, { value: 'float', inMin: 'float', inMax: 'float', outMin: 'float', outMax: 'float', return: 'float' } as any)

function remapClamp(value: any, inMin: number, inMax: number, outMin: number, outMax: number): any {
  const t = clamp(value.sub(inMin).div(inMax - inMin), 0.0, 1.0)
  return mix(outMin, outMax, t)
}

function calculatePcmEnergy(samples: Int16Array | Uint8Array): number {
  const pcm = samples instanceof Int16Array
    ? samples
    : new Int16Array(samples.buffer, samples.byteOffset, Math.floor(samples.byteLength / 2))

  if (pcm.length === 0) return 0

  let sumSquares = 0
  let peak = 0
  const stride = Math.max(1, Math.floor(pcm.length / 2400))
  for (let i = 0; i < pcm.length; i += stride) {
    const normalized = Math.abs(pcm[i]) / 32768
    sumSquares += normalized * normalized
    peak = Math.max(peak, normalized)
  }

  const count = Math.ceil(pcm.length / stride)
  const rms = Math.sqrt(sumSquares / count)
  return Math.max(0, Math.min(1, rms * 4.8 + peak * 0.55))
}
