/**
 * Three.js renderer for the advanced glass orb.
 *
 * Reuses the glass-ball reference assets while keeping WebGL scene ownership
 * separate from the main renderer UI state machine.
 */
import * as THREE from 'three'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'

const GLASS_ENV_URL = new URL('./glass-assets/env/warehouse-low.hdr', import.meta.url).href

export type AdvancedOrbMode = 'idle' | 'listening' | 'thinking' | 'speaking' | 'interrupted'

type AdvancedOrbPalette = {
  color: number
  emissive: number
  point: number
  bloom: number
}

type GlassFragment = {
  mesh: THREE.Mesh
  center: THREE.Vector3
  velocity: THREE.Vector3
  weight: number
}

export class AdvancedGlassOrbRenderer {
  private renderer: THREE.WebGLRenderer | null = null
  private scene: THREE.Scene | null = null
  private camera: THREE.PerspectiveCamera | null = null
  private group: THREE.Group | null = null
  private material: THREE.MeshPhysicalMaterial | null = null
  private fragments: GlassFragment[] = []
  private pointLight: THREE.PointLight | null = null
  private animationFrame: number | null = null
  private mode: AdvancedOrbMode = 'idle'
  private inputEnergy = 0
  private outputEnergy = 0
  private energyUpdatedAt = performance.now()
  private enabled = false
  private loading: Promise<void> | null = null
  private motionTarget = new THREE.Vector3()
  private motionCurrent = new THREE.Vector3()
  private previousPointer = new THREE.Vector2(Number.NaN, Number.NaN)
  private previousScreen = new THREE.Vector2(Number.NaN, Number.NaN)
  private readonly pointerMoveHandler = (event: PointerEvent) => this.handlePointerMove(event)

  constructor(private readonly canvas: HTMLCanvasElement) {}

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
      console.error('[AdvancedOrb] Failed to initialize glass orb:', error)
      this.enabled = false
      this.canvas.classList.remove('active')
      return false
    }
  }

  setMode(mode: AdvancedOrbMode): void {
    this.mode = mode
    this.applyPalette()
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
    window.removeEventListener('pointermove', this.pointerMoveHandler)
    const environment = this.scene?.environment
    environment?.dispose?.()
    this.scene?.traverse((object) => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose?.()
    })
    this.material?.dispose()
    this.renderer?.dispose()
    this.renderer = null
    this.scene = null
    this.camera = null
    this.group = null
    this.material = null
    this.pointLight = null
    this.fragments = []
    this.loading = null
  }

  private async initialize(): Promise<void> {
    if (this.renderer && this.scene && this.camera && this.group) return
    if (this.loading) return this.loading

    this.loading = this.createScene()
    await this.loading
    this.loading = null
  }

  private async createScene(): Promise<void> {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      stencil: false,
    })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.25

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
    camera.position.set(0, 0, 4.2)

    const group = new THREE.Group()
    group.scale.setScalar(0.46)
    scene.add(group)

    const ambient = new THREE.AmbientLight(0xffffff, 1.05)
    scene.add(ambient)
    const pointLight = new THREE.PointLight(0x7debd6, 2.4, 8)
    pointLight.position.set(-1.8, 2, 2.8)
    scene.add(pointLight)
    const rimLight = new THREE.DirectionalLight(0xffffff, 1.35)
    rimLight.position.set(2.2, -1.2, 2.6)
    scene.add(rimLight)

    try {
      const environment = await new RGBELoader().loadAsync(GLASS_ENV_URL)
      environment.mapping = THREE.EquirectangularReflectionMapping
      scene.environment = environment
    } catch (error) {
      console.warn('[AdvancedOrb] Failed to load environment map; continuing with direct lighting.', error)
    }

    const material = new THREE.MeshPhysicalMaterial({
      color: 0xeeefff,
      emissive: 0x000012,
      reflectivity: 0.2,
      roughness: 0.1,
      metalness: 0.1,
      transparent: true,
      opacity: 0.72,
      transmission: 1,
      thickness: 0.6,
      ior: 1.4,
      side: THREE.DoubleSide,
    })

    const modelRoot = new THREE.Group()
    const fragments: GlassFragment[] = []
    const fallback = createFallbackGlassShape(material)
    for (const child of [...fallback.children]) {
      const mesh = child as THREE.Mesh
      modelRoot.add(mesh)
      fragments.push(createFragment(mesh))
    }
    normalizeModelRoot(modelRoot)
    group.add(modelRoot)

    this.renderer = renderer
    this.scene = scene
    this.camera = camera
    this.group = group
    this.material = material
    this.fragments = fragments
    this.pointLight = pointLight
    this.resize()
    this.applyPalette()
    window.addEventListener('pointermove', this.pointerMoveHandler)
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
    if (!this.enabled || !this.renderer || !this.scene || !this.camera || !this.group || !this.material) {
      this.animationFrame = null
      return
    }

    this.resize()
    const time = performance.now() / 1000
    const energy = this.getEnergy()
    const breathe = Math.sin(time * this.getBreatheRate()) * 0.035
    const pulse = this.mode === 'speaking' ? Math.sin(time * 9) * 0.012 + energy * 0.035 : energy * 0.022
    const scale = 0.46 + breathe * 0.34 + pulse

    this.updateScreenMotion()
    this.motionTarget.multiplyScalar(0.91)
    this.motionCurrent.lerp(this.motionTarget, 0.12)
    this.updateFragments(energy)
    this.group.rotation.x = this.motionCurrent.y * 0.62 + Math.sin(time * 0.42) * 0.025
    this.group.rotation.y = this.motionCurrent.x * 0.62
    this.group.rotation.z = Math.sin(time * 0.31) * 0.045
    this.group.position.x = this.motionCurrent.x * 0.045
    this.group.position.y = -this.motionCurrent.y * 0.045
    this.group.scale.setScalar(scale)
    this.material.opacity = Math.min(0.86, 0.66 + energy * 0.22)
    this.material.roughness = Math.max(0.035, 0.12 - energy * 0.05)
    if (this.pointLight) {
      this.pointLight.intensity = this.getPalette().bloom + energy * 2.2
    }

    this.renderer.render(this.scene, this.camera)
    this.animationFrame = requestAnimationFrame(this.render)
  }

  private applyPalette(): void {
    if (!this.material) return
    const palette = this.getPalette()
    this.material.color.setHex(palette.color)
    this.material.emissive.setHex(palette.emissive)
    if (this.pointLight) {
      this.pointLight.color.setHex(palette.point)
      this.pointLight.intensity = palette.bloom
    }
  }

  private getPalette(): AdvancedOrbPalette {
    switch (this.mode) {
      case 'listening':
        return { color: 0x8fffea, emissive: 0x063c38, point: 0x7debd6, bloom: 3.0 }
      case 'thinking':
        return { color: 0xffc4e1, emissive: 0x3b0924, point: 0xe24a90, bloom: 3.15 }
      case 'speaking':
        return { color: 0xffd6a0, emissive: 0x3a1a04, point: 0xffbe70, bloom: 3.05 }
      case 'interrupted':
        return { color: 0xffffff, emissive: 0x202026, point: 0xffffff, bloom: 3.4 }
      default:
        return { color: 0xeeefff, emissive: 0x000012, point: 0xbfd7ff, bloom: 2.25 }
    }
  }

  private getBreatheRate(): number {
    switch (this.mode) {
      case 'listening':
        return 2.8
      case 'thinking':
        return 1.65
      case 'speaking':
        return 2.15
      case 'interrupted':
        return 3.6
      default:
        return 1.2
    }
  }

  private getEnergy(): number {
    const now = performance.now()
    const decay = Math.exp(-(now - this.energyUpdatedAt) / 220)
    this.inputEnergy *= decay
    this.outputEnergy *= decay
    this.energyUpdatedAt = now

    if (this.mode === 'listening') return this.inputEnergy
    if (this.mode === 'speaking') return this.outputEnergy
    return Math.max(this.inputEnergy, this.outputEnergy) * 0.35
  }

  private handlePointerMove(event: PointerEvent): void {
    const x = ((event.clientX - window.innerWidth / 2) / Math.max(1, window.innerWidth / 2))
    const y = ((event.clientY - window.innerHeight / 2) / Math.max(1, window.innerHeight / 2))
    if (Number.isNaN(this.previousPointer.x) || Number.isNaN(this.previousPointer.y)) {
      this.previousPointer.set(x, y)
      return
    }

    this.motionTarget.x += x - this.previousPointer.x
    this.motionTarget.y += y - this.previousPointer.y
    this.previousPointer.set(x, y)
  }

  private updateFragments(energy: number): void {
    const pointer = new THREE.Vector3(
      this.motionCurrent.x * 2.1,
      -this.motionCurrent.y * 2.1,
      0
    )
    const pointerRadius = 0.74 + energy * 0.16
    const spring = 0.018 + energy * 0.01
    const damping = 0.915 - energy * 0.025

    for (const fragment of this.fragments) {
      const center = fragment.center.clone().add(fragment.mesh.position)
      const away = center.sub(pointer)
      const distance = Math.max(0.001, away.length())
      if (distance < pointerRadius) {
        const strength = (1 - distance / pointerRadius) * 0.034 * fragment.weight
        fragment.velocity.add(away.multiplyScalar(strength / distance))
      }

      fragment.velocity.add(fragment.mesh.position.clone().multiplyScalar(-spring))
      fragment.velocity.multiplyScalar(damping)
      fragment.mesh.position.add(fragment.velocity)
    }
  }

  private updateScreenMotion(): void {
    const x = window.screenX / Math.max(1, window.screen.width / 2)
    const y = window.screenY / Math.max(1, window.screen.height / 2)
    if (Number.isNaN(this.previousScreen.x) || Number.isNaN(this.previousScreen.y)) {
      this.previousScreen.set(x, y)
      return
    }

    this.motionTarget.x += (this.previousScreen.x - x) * 5
    this.motionTarget.y += (this.previousScreen.y - y) * 5
    this.previousScreen.set(x, y)
  }
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

function normalizeModelRoot(root: THREE.Group): void {
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxAxis = Math.max(size.x, size.y, size.z)
  if (!Number.isFinite(maxAxis) || maxAxis <= 0) {
    return
  }

  root.position.sub(center)
  root.scale.setScalar(2.05 / maxAxis)
}

function createFragment(mesh: THREE.Mesh): GlassFragment {
  mesh.geometry.computeBoundingSphere()
  const center = mesh.geometry.boundingSphere?.center.clone() ?? new THREE.Vector3()
  return {
    mesh,
    center,
    velocity: new THREE.Vector3(),
    weight: 0.86 + Math.random() * 0.28
  }
}

function createFallbackGlassShape(material: THREE.Material): THREE.Group {
  const root = new THREE.Group()
  const geometry = new THREE.IcosahedronGeometry(0.52, 4)
  const points = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(-0.36, 0.26, 0.08),
    new THREE.Vector3(0.35, -0.2, 0.1),
    new THREE.Vector3(0.2, 0.34, -0.12),
    new THREE.Vector3(-0.18, -0.36, -0.06),
    new THREE.Vector3(0.04, 0.02, 0.34)
  ]

  points.forEach((position, index) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.copy(position)
    mesh.scale.setScalar(index === 0 ? 1 : 0.72)
    root.add(mesh)
  })

  return root
}
