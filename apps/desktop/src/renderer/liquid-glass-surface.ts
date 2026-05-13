/**
 * Global GPU liquid simulation overlay for the desktop control surface.
 */
type RenderTarget = {
  texture: WebGLTexture
  framebuffer: WebGLFramebuffer
}

type TargetPair = [RenderTarget, RenderTarget]

type PointerImpulse = {
  x: number
  y: number
  vx: number
  vy: number
}

const SIMULATION_BASE_SIZE = 300
const MAX_IMPULSES = 8
const PRESSURE_ITERATIONS = 14
const SIMULATION_STEPS_PER_FRAME = 1

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

const ADVECT_SHADER = `
precision highp float;

uniform sampler2D u_velocity;
uniform sampler2D u_source;
uniform vec2 u_texel;
uniform float u_dt;
uniform float u_dissipation;
varying vec2 v_uv;

vec2 unpackVelocity(vec4 raw) {
  return raw.rg * 2.0 - 1.0;
}

void main() {
  vec2 velocity = unpackVelocity(texture2D(u_velocity, v_uv));
  vec2 backUv = v_uv - velocity * u_dt * 0.18;
  vec4 value = texture2D(u_source, clamp(backUv, vec2(0.0), vec2(1.0)));
  gl_FragColor = value * u_dissipation;
}
`

const VELOCITY_SPLAT_SHADER = `
precision highp float;

uniform sampler2D u_velocity;
uniform sampler2D u_material;
uniform float u_time;
uniform vec4 u_impulses[${MAX_IMPULSES}];
varying vec2 v_uv;

vec2 unpackVelocity(vec4 raw) {
  return raw.rg * 2.0 - 1.0;
}

vec4 packVelocity(vec2 velocity) {
  return vec4(clamp(velocity * 0.5 + 0.5, 0.0, 1.0), 0.0, 1.0);
}

void main() {
  vec2 velocity = unpackVelocity(texture2D(u_velocity, v_uv));
  vec4 material = texture2D(u_material, v_uv);
  float thickness = material.g;

  for (int i = 0; i < ${MAX_IMPULSES}; i++) {
    vec4 impulse = u_impulses[i];
    vec2 delta = v_uv - impulse.xy;
    float speed = length(impulse.zw);
    float radius = mix(0.045, 0.105, clamp(speed * 0.06, 0.0, 1.0));
    float falloff = exp(-dot(delta, delta) / max(radius * radius, 0.0001));
    vec2 radial = normalize(delta + vec2(0.0001, -0.0002)) * 0.035;
    velocity += (impulse.zw * 0.12 + radial) * falloff;
  }

  vec2 driftA = vec2(
    sin(v_uv.y * 7.2 + u_time * 0.34),
    cos(v_uv.x * 6.4 - u_time * 0.29)
  );
  vec2 driftB = vec2(
    cos((v_uv.x + v_uv.y) * 5.1 + u_time * 0.21),
    sin((v_uv.x - v_uv.y) * 6.7 - u_time * 0.25)
  );
  vec2 tangentFlow = normalize(driftA * 0.62 + driftB * 0.38 + vec2(0.001, -0.001));
  float filmMask = smoothstep(0.025, 0.58, thickness);
  velocity += tangentFlow * filmMask * 0.006;
  velocity += vec2(-tangentFlow.y, tangentFlow.x) * filmMask * 0.0025;
  velocity *= 0.994;
  gl_FragColor = packVelocity(clamp(velocity, vec2(-0.98), vec2(0.98)));
}
`

const MATERIAL_SPLAT_SHADER = `
precision highp float;

uniform sampler2D u_material;
uniform sampler2D u_velocity;
uniform float u_time;
uniform vec4 u_impulses[${MAX_IMPULSES}];
varying vec2 v_uv;

vec2 unpackVelocity(vec4 raw) {
  return raw.rg * 2.0 - 1.0;
}

void main() {
  vec4 material = texture2D(u_material, v_uv);
  vec2 velocity = unpackVelocity(texture2D(u_velocity, v_uv));
  float height = material.r;
  float thickness = material.g;
  float foam = material.b;

  for (int i = 0; i < ${MAX_IMPULSES}; i++) {
    vec4 impulse = u_impulses[i];
    vec2 delta = v_uv - impulse.xy;
    float speed = length(impulse.zw);
    float radius = mix(0.052, 0.115, clamp(speed * 0.055, 0.0, 1.0));
    float falloff = exp(-dot(delta, delta) / max(radius * radius, 0.0001));
    height += falloff * (0.42 + speed * 0.035);
    thickness += falloff * (0.30 + speed * 0.026);
    foam += falloff * (0.18 + speed * 0.025);
  }

  float filmA = 0.5 + 0.5 * sin(v_uv.x * 8.7 + v_uv.y * 4.3 + u_time * 0.19);
  float filmB = 0.5 + 0.5 * sin(v_uv.x * -5.2 + v_uv.y * 7.9 - u_time * 0.16);
  float wettingPattern = smoothstep(0.72, 0.98, filmA * 0.55 + filmB * 0.45);
  float targetFilm = wettingPattern * 0.16;
  float wetting = max(targetFilm - thickness, 0.0) * 0.004;
  height += wetting * 0.55;
  thickness += wetting;
  foam += wetting * 0.12;

  float motion = smoothstep(0.05, 0.48, length(velocity));
  height += motion * thickness * 0.006;
  foam += motion * thickness * 0.004;

  height *= 0.996;
  thickness *= 0.997;
  foam *= 0.974;
  gl_FragColor = vec4(clamp(height, 0.0, 1.0), clamp(thickness, 0.0, 1.0), clamp(foam, 0.0, 1.0), 1.0);
}
`

const DIVERGENCE_SHADER = `
precision highp float;

uniform sampler2D u_velocity;
uniform vec2 u_texel;
varying vec2 v_uv;

vec2 unpackVelocity(vec4 raw) {
  return raw.rg * 2.0 - 1.0;
}

void main() {
  float left = unpackVelocity(texture2D(u_velocity, v_uv - vec2(u_texel.x, 0.0))).x;
  float right = unpackVelocity(texture2D(u_velocity, v_uv + vec2(u_texel.x, 0.0))).x;
  float down = unpackVelocity(texture2D(u_velocity, v_uv - vec2(0.0, u_texel.y))).y;
  float up = unpackVelocity(texture2D(u_velocity, v_uv + vec2(0.0, u_texel.y))).y;
  float divergence = (right - left + up - down) * 0.5;
  gl_FragColor = vec4(clamp(divergence * 0.5 + 0.5, 0.0, 1.0), 0.0, 0.0, 1.0);
}
`

const PRESSURE_SHADER = `
precision highp float;

uniform sampler2D u_pressure;
uniform sampler2D u_divergence;
uniform vec2 u_texel;
varying vec2 v_uv;

float unpackSigned(float value) {
  return value * 2.0 - 1.0;
}

float packSigned(float value) {
  return clamp(value * 0.5 + 0.5, 0.0, 1.0);
}

void main() {
  float left = unpackSigned(texture2D(u_pressure, v_uv - vec2(u_texel.x, 0.0)).r);
  float right = unpackSigned(texture2D(u_pressure, v_uv + vec2(u_texel.x, 0.0)).r);
  float down = unpackSigned(texture2D(u_pressure, v_uv - vec2(0.0, u_texel.y)).r);
  float up = unpackSigned(texture2D(u_pressure, v_uv + vec2(0.0, u_texel.y)).r);
  float divergence = unpackSigned(texture2D(u_divergence, v_uv).r);
  float pressure = (left + right + down + up - divergence) * 0.25;
  gl_FragColor = vec4(packSigned(pressure), 0.0, 0.0, 1.0);
}
`

const GRADIENT_SHADER = `
precision highp float;

uniform sampler2D u_velocity;
uniform sampler2D u_pressure;
uniform vec2 u_texel;
varying vec2 v_uv;

vec2 unpackVelocity(vec4 raw) {
  return raw.rg * 2.0 - 1.0;
}

float unpackSigned(float value) {
  return value * 2.0 - 1.0;
}

vec4 packVelocity(vec2 velocity) {
  return vec4(clamp(velocity * 0.5 + 0.5, 0.0, 1.0), 0.0, 1.0);
}

void main() {
  vec2 velocity = unpackVelocity(texture2D(u_velocity, v_uv));
  float left = unpackSigned(texture2D(u_pressure, v_uv - vec2(u_texel.x, 0.0)).r);
  float right = unpackSigned(texture2D(u_pressure, v_uv + vec2(u_texel.x, 0.0)).r);
  float down = unpackSigned(texture2D(u_pressure, v_uv - vec2(0.0, u_texel.y)).r);
  float up = unpackSigned(texture2D(u_pressure, v_uv + vec2(0.0, u_texel.y)).r);
  vec2 gradient = vec2(right - left, up - down) * 0.5;
  velocity -= gradient * 0.82;
  gl_FragColor = packVelocity(clamp(velocity, vec2(-0.98), vec2(0.98)));
}
`

const RENDER_SHADER = `
precision highp float;

uniform sampler2D u_velocity;
uniform sampler2D u_material;
uniform sampler2D u_pressure;
uniform vec2 u_texel;
uniform float u_themeDay;
varying vec2 v_uv;

vec2 unpackVelocity(vec4 raw) {
  return raw.rg * 2.0 - 1.0;
}

float unpackSigned(float value) {
  return value * 2.0 - 1.0;
}

void main() {
  vec4 center = texture2D(u_material, v_uv);
  vec4 left = texture2D(u_material, v_uv - vec2(u_texel.x, 0.0));
  vec4 right = texture2D(u_material, v_uv + vec2(u_texel.x, 0.0));
  vec4 down = texture2D(u_material, v_uv - vec2(0.0, u_texel.y));
  vec4 up = texture2D(u_material, v_uv + vec2(0.0, u_texel.y));

  vec2 velocity = unpackVelocity(texture2D(u_velocity, v_uv));
  float pressure = abs(unpackSigned(texture2D(u_pressure, v_uv).r));
  float height = center.r;
  float thickness = smoothstep(0.012, 0.72, center.g);
  float foam = smoothstep(0.08, 0.72, center.b);

  vec2 heightSlope = vec2(right.r - left.r, up.r - down.r);
  vec2 thicknessSlope = vec2(right.g - left.g, up.g - down.g);
  vec3 normal = normalize(vec3(-(heightSlope * 8.6 + thicknessSlope * 4.2), 1.0));

  vec3 lightDir = normalize(vec3(-0.34, 0.42, 0.84));
  float diffuse = max(dot(normal, lightDir), 0.0);
  float specular = pow(max(dot(reflect(-lightDir, normal), vec3(0.0, 0.0, 1.0)), 0.0), 44.0);
  float rim = pow(clamp(1.0 - normal.z, 0.0, 1.0), 1.5);
  float speed = length(velocity);
  float flowLine = smoothstep(0.04, 0.42, speed);
  float body = smoothstep(0.018, 0.26, height + center.g * 0.72);

  vec3 nightShallowTint = vec3(0.66, 0.88, 1.0);
  vec3 nightDeepTint = vec3(0.36, 0.68, 0.92);
  vec3 dayShallowTint = vec3(0.18, 0.44, 0.58);
  vec3 dayDeepTint = vec3(0.08, 0.25, 0.36);
  vec3 shallowTint = mix(nightShallowTint, dayShallowTint, u_themeDay);
  vec3 deepTint = mix(nightDeepTint, dayDeepTint, u_themeDay);
  vec3 color = mix(shallowTint, deepTint, thickness * 0.62);
  color *= mix(0.08 + body * 0.16 + diffuse * 0.13, 0.22 + body * 0.34 + diffuse * 0.18, u_themeDay);
  color += mix(vec3(1.0), vec3(0.80, 0.96, 1.0), u_themeDay) * specular * (0.42 + thickness * 0.38);
  color += mix(vec3(0.80, 0.95, 1.0), vec3(0.14, 0.38, 0.50), u_themeDay) * rim * 0.24;
  color += mix(vec3(0.92, 0.98, 1.0), vec3(0.28, 0.58, 0.70), u_themeDay) * foam * 0.15;
  color += mix(vec3(0.54, 0.82, 1.0), vec3(0.10, 0.34, 0.46), u_themeDay) * pressure * 0.08;
  color += mix(vec3(0.74, 0.92, 1.0), vec3(0.16, 0.48, 0.62), u_themeDay) * flowLine * 0.07;

  float alpha = body * 0.16 + thickness * 0.12 + specular * 0.28 + rim * 0.10 + foam * 0.08 + flowLine * 0.04;
  alpha *= mix(1.0, 1.34, u_themeDay);
  alpha *= smoothstep(0.0, 0.055, v_uv.x) * smoothstep(1.0, 0.945, v_uv.x);
  gl_FragColor = vec4(color, clamp(alpha, 0.0, mix(0.42, 0.48, u_themeDay)));
}
`

function smoothstepNumber(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export class LiquidGlassSurface {
  private gl: WebGLRenderingContext | null = null
  private programs = new Map<string, WebGLProgram>()
  private positionBuffer: WebGLBuffer | null = null
  private velocityTargets: TargetPair | null = null
  private materialTargets: TargetPair | null = null
  private pressureTargets: TargetPair | null = null
  private divergenceTarget: RenderTarget | null = null
  private velocityReadIndex = 0
  private materialReadIndex = 0
  private pressureReadIndex = 0
  private simulationWidth = 1
  private simulationHeight = 1
  private animationFrameId: number | null = null
  private startedAt = performance.now()
  private lastFrameAt = this.startedAt
  private reducedMotion = false
  private pointerActive = false
  private lastPointer: { x: number; y: number } | null = null
  private pendingImpulses: PointerImpulse[] = []
  private readonly handleResize = () => this.resize()
  private readonly handlePointerDown = (event: PointerEvent) => this.beginPointerImpulse(event)
  private readonly handlePointerMove = (event: PointerEvent) => this.dragPointerImpulse(event)
  private readonly handlePointerUp = () => this.endPointerImpulse()
  private readonly handleVisibilityChange = () => this.syncAnimationState()

  constructor(private readonly canvas: HTMLCanvasElement) {}

  initialize(): void {
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const gl = this.canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    })

    if (!gl) {
      this.canvas.hidden = true
      console.warn('[LiquidGlassSurface] WebGL is not available.')
      return
    }

    const positionBuffer = gl.createBuffer()
    if (!positionBuffer) {
      this.canvas.hidden = true
      return
    }

    this.gl = gl
    this.positionBuffer = positionBuffer
    this.prepareGeometry(gl)

    const shaders: Array<[string, string]> = [
      ['advect', ADVECT_SHADER],
      ['velocitySplat', VELOCITY_SPLAT_SHADER],
      ['materialSplat', MATERIAL_SPLAT_SHADER],
      ['divergence', DIVERGENCE_SHADER],
      ['pressure', PRESSURE_SHADER],
      ['gradient', GRADIENT_SHADER],
      ['render', RENDER_SHADER],
    ]
    for (const [name, shader] of shaders) {
      const program = this.createProgram(gl, shader)
      if (!program) {
        this.canvas.hidden = true
        return
      }
      this.programs.set(name, program)
    }

    this.resize()
    window.addEventListener('resize', this.handleResize)
    document.addEventListener('pointerdown', this.handlePointerDown, { capture: true, passive: true })
    document.addEventListener('pointermove', this.handlePointerMove, { capture: true, passive: true })
    document.addEventListener('pointerup', this.handlePointerUp, { capture: true, passive: true })
    document.addEventListener('pointercancel', this.handlePointerUp, { capture: true, passive: true })
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
    this.syncAnimationState()
  }

  destroy(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
    window.removeEventListener('resize', this.handleResize)
    document.removeEventListener('pointerdown', this.handlePointerDown, { capture: true })
    document.removeEventListener('pointermove', this.handlePointerMove, { capture: true })
    document.removeEventListener('pointerup', this.handlePointerUp, { capture: true })
    document.removeEventListener('pointercancel', this.handlePointerUp, { capture: true })
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
  }

  private createProgram(gl: WebGLRenderingContext, fragmentSource: string): WebGLProgram | null {
    const vertexShader = this.compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    const fragmentShader = this.compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
    if (!vertexShader || !fragmentShader) {
      return null
    }

    const program = gl.createProgram()
    if (!program) {
      return null
    }

    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('[LiquidGlassSurface] Shader link failed:', gl.getProgramInfoLog(program))
      return null
    }
    return program
  }

  private compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
    const shader = gl.createShader(type)
    if (!shader) {
      return null
    }

    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('[LiquidGlassSurface] Shader compile failed:', gl.getShaderInfoLog(shader))
      gl.deleteShader(shader)
      return null
    }
    return shader
  }

  private prepareGeometry(gl: WebGLRenderingContext): void {
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  }

  private resize(): void {
    const gl = this.gl
    if (!gl) {
      return
    }

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    const canvasWidth = Math.max(1, Math.floor(window.innerWidth * pixelRatio))
    const canvasHeight = Math.max(1, Math.floor(window.innerHeight * pixelRatio))
    if (this.canvas.width !== canvasWidth || this.canvas.height !== canvasHeight) {
      this.canvas.width = canvasWidth
      this.canvas.height = canvasHeight
    }

    const aspect = canvasWidth / Math.max(canvasHeight, 1)
    const nextSimulationWidth = Math.max(96, Math.round(SIMULATION_BASE_SIZE * Math.min(aspect, 1.8)))
    const nextSimulationHeight = Math.max(96, Math.round(SIMULATION_BASE_SIZE / Math.max(aspect, 1)))
    if (
      nextSimulationWidth === this.simulationWidth &&
      nextSimulationHeight === this.simulationHeight &&
      this.velocityTargets &&
      this.materialTargets &&
      this.pressureTargets &&
      this.divergenceTarget
    ) {
      return
    }

    this.simulationWidth = nextSimulationWidth
    this.simulationHeight = nextSimulationHeight
    this.velocityTargets = this.createTargetPair(gl)
    this.materialTargets = this.createTargetPair(gl)
    this.pressureTargets = this.createTargetPair(gl)
    this.divergenceTarget = this.createRenderTarget(gl)
    this.clearSimulationTargets(gl)
  }

  private createTargetPair(gl: WebGLRenderingContext): TargetPair {
    return [this.createRenderTarget(gl), this.createRenderTarget(gl)]
  }

  private createRenderTarget(gl: WebGLRenderingContext): RenderTarget {
    const texture = gl.createTexture()
    const framebuffer = gl.createFramebuffer()
    if (!texture || !framebuffer) {
      throw new Error('Failed to allocate liquid simulation target.')
    }

    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      this.simulationWidth,
      this.simulationHeight,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    )

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    return { texture, framebuffer }
  }

  private clearSimulationTargets(gl: WebGLRenderingContext): void {
    gl.disable(gl.BLEND)
    gl.viewport(0, 0, this.simulationWidth, this.simulationHeight)
    this.clearTargets(gl, this.velocityTargets, [0.5, 0.5, 0, 1])
    this.clearTargets(gl, this.materialTargets, [0, 0, 0, 1])
    this.clearTargets(gl, this.pressureTargets, [0.5, 0, 0, 1])
    if (this.divergenceTarget) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.divergenceTarget.framebuffer)
      gl.clearColor(0.5, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
    this.seedInitialFields(gl)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.enable(gl.BLEND)
    this.velocityReadIndex = 0
    this.materialReadIndex = 0
    this.pressureReadIndex = 0
  }

  private clearTargets(gl: WebGLRenderingContext, targets: TargetPair | null, color: [number, number, number, number]): void {
    if (!targets) {
      return
    }

    gl.clearColor(color[0], color[1], color[2], color[3])
    for (const target of targets) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
  }

  private seedInitialFields(gl: WebGLRenderingContext): void {
    if (!this.velocityTargets || !this.materialTargets) {
      return
    }

    const material = new Uint8Array(this.simulationWidth * this.simulationHeight * 4)
    const velocity = new Uint8Array(this.simulationWidth * this.simulationHeight * 4)
    const blobs = [
      { x: 0.22, y: 0.72, rx: 0.24, ry: 0.16, amount: 0.55 },
      { x: 0.58, y: 0.56, rx: 0.34, ry: 0.20, amount: 0.42 },
      { x: 0.78, y: 0.30, rx: 0.20, ry: 0.18, amount: 0.34 },
      { x: 0.34, y: 0.24, rx: 0.28, ry: 0.14, amount: 0.26 },
    ]

    for (let y = 0; y < this.simulationHeight; y++) {
      for (let x = 0; x < this.simulationWidth; x++) {
        const u = x / Math.max(this.simulationWidth - 1, 1)
        const v = y / Math.max(this.simulationHeight - 1, 1)
        let film = 0
        for (const blob of blobs) {
          const dx = (u - blob.x) / blob.rx
          const dy = (v - blob.y) / blob.ry
          film += Math.exp(-(dx * dx + dy * dy) * 2.2) * blob.amount
        }
        const ribbon = 0.5 + 0.5 * Math.sin(u * 12.0 + v * 7.0)
        const edgeFade = smoothstepNumber(0.03, 0.16, u) * smoothstepNumber(0.97, 0.84, u)
        const thickness = Math.min(1, Math.max(0, film * (0.72 + ribbon * 0.18) * edgeFade))
        const height = Math.min(1, thickness * 0.68 + ribbon * thickness * 0.12)
        const foam = Math.min(1, thickness * 0.16)
        const swirlX = Math.sin(v * 8.0 + u * 3.0) * 0.018 + Math.cos((u + v) * 6.0) * 0.012
        const swirlY = Math.cos(u * 7.0 - v * 2.0) * 0.018 + Math.sin((u - v) * 6.0) * 0.012
        const index = (y * this.simulationWidth + x) * 4
        material[index] = Math.round(height * 255)
        material[index + 1] = Math.round(thickness * 255)
        material[index + 2] = Math.round(foam * 255)
        material[index + 3] = 255
        velocity[index] = Math.round((swirlX * 0.5 + 0.5) * 255)
        velocity[index + 1] = Math.round((swirlY * 0.5 + 0.5) * 255)
        velocity[index + 2] = 0
        velocity[index + 3] = 255
      }
    }

    this.uploadTextureData(gl, this.materialTargets, material)
    this.uploadTextureData(gl, this.velocityTargets, velocity)
  }

  private uploadTextureData(gl: WebGLRenderingContext, targets: TargetPair, data: Uint8Array): void {
    for (const target of targets) {
      gl.bindTexture(gl.TEXTURE_2D, target.texture)
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        this.simulationWidth,
        this.simulationHeight,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        data
      )
    }
  }

  private syncAnimationState(): void {
    if (document.hidden || this.reducedMotion) {
      if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId)
        this.animationFrameId = null
      }
      this.render(performance.now())
      return
    }

    if (this.animationFrameId === null) {
      this.animationFrameId = requestAnimationFrame((time) => this.render(time))
    }
  }

  private render(now: number): void {
    const gl = this.gl
    if (!this.canRender(gl)) {
      return
    }

    const dt = Math.min(0.033, Math.max(0.001, (now - this.lastFrameAt) / 1000))
    this.lastFrameAt = now
    const seconds = (now - this.startedAt) / 1000
    const impulses = this.consumeImpulseUniforms()

    gl.disable(gl.BLEND)
    for (let i = 0; i < SIMULATION_STEPS_PER_FRAME; i++) {
      const stepDt = dt / SIMULATION_STEPS_PER_FRAME
      this.advectVelocity(gl, stepDt)
      this.splatVelocity(gl, seconds, impulses)
      this.advectMaterial(gl, stepDt)
      this.splatMaterial(gl, seconds, impulses)
      this.computeDivergence(gl)
      this.solvePressure(gl)
      this.subtractPressureGradient(gl)
    }
    gl.enable(gl.BLEND)
    this.renderSurface(gl)

    this.animationFrameId = document.hidden || this.reducedMotion
      ? null
      : requestAnimationFrame((time) => this.render(time))
  }

  private canRender(gl: WebGLRenderingContext | null): gl is WebGLRenderingContext {
    return Boolean(
      gl &&
      this.velocityTargets &&
      this.materialTargets &&
      this.pressureTargets &&
      this.divergenceTarget &&
      this.positionBuffer
    )
  }

  private advectVelocity(gl: WebGLRenderingContext, dt: number): void {
    const targets = this.velocityTargets!
    const source = targets[this.velocityReadIndex]
    const destinationIndex = 1 - this.velocityReadIndex
    this.runAdvectPass(gl, source.texture, source.texture, targets[destinationIndex], dt, 0.997)
    this.velocityReadIndex = destinationIndex
  }

  private advectMaterial(gl: WebGLRenderingContext, dt: number): void {
    const targets = this.materialTargets!
    const source = targets[this.materialReadIndex]
    const destinationIndex = 1 - this.materialReadIndex
    const velocity = this.velocityTargets![this.velocityReadIndex]
    this.runAdvectPass(gl, velocity.texture, source.texture, targets[destinationIndex], dt, 0.996)
    this.materialReadIndex = destinationIndex
  }

  private runAdvectPass(
    gl: WebGLRenderingContext,
    velocityTexture: WebGLTexture,
    sourceTexture: WebGLTexture,
    destination: RenderTarget,
    dt: number,
    dissipation: number
  ): void {
    const program = this.program('advect')
    this.beginTargetPass(gl, program, destination)
    this.bindTexture(gl, program, 'u_velocity', velocityTexture, 0)
    this.bindTexture(gl, program, 'u_source', sourceTexture, 1)
    this.setTexelUniform(gl, program)
    gl.uniform1f(gl.getUniformLocation(program, 'u_dt'), dt)
    gl.uniform1f(gl.getUniformLocation(program, 'u_dissipation'), dissipation)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  private splatVelocity(gl: WebGLRenderingContext, seconds: number, impulses: Float32Array): void {
    const targets = this.velocityTargets!
    const destinationIndex = 1 - this.velocityReadIndex
    const program = this.program('velocitySplat')
    this.beginTargetPass(gl, program, targets[destinationIndex])
    this.bindTexture(gl, program, 'u_velocity', targets[this.velocityReadIndex].texture, 0)
    this.bindTexture(gl, program, 'u_material', this.materialTargets![this.materialReadIndex].texture, 1)
    gl.uniform1f(gl.getUniformLocation(program, 'u_time'), seconds)
    gl.uniform4fv(gl.getUniformLocation(program, 'u_impulses'), impulses)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    this.velocityReadIndex = destinationIndex
  }

  private splatMaterial(gl: WebGLRenderingContext, seconds: number, impulses: Float32Array): void {
    const targets = this.materialTargets!
    const destinationIndex = 1 - this.materialReadIndex
    const program = this.program('materialSplat')
    this.beginTargetPass(gl, program, targets[destinationIndex])
    this.bindTexture(gl, program, 'u_material', targets[this.materialReadIndex].texture, 0)
    this.bindTexture(gl, program, 'u_velocity', this.velocityTargets![this.velocityReadIndex].texture, 1)
    gl.uniform1f(gl.getUniformLocation(program, 'u_time'), seconds)
    gl.uniform4fv(gl.getUniformLocation(program, 'u_impulses'), impulses)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    this.materialReadIndex = destinationIndex
  }

  private computeDivergence(gl: WebGLRenderingContext): void {
    const program = this.program('divergence')
    this.beginTargetPass(gl, program, this.divergenceTarget!)
    this.bindTexture(gl, program, 'u_velocity', this.velocityTargets![this.velocityReadIndex].texture, 0)
    this.setTexelUniform(gl, program)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  private solvePressure(gl: WebGLRenderingContext): void {
    this.clearTargets(gl, this.pressureTargets, [0.5, 0, 0, 1])
    const program = this.program('pressure')
    for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
      const source = this.pressureTargets![this.pressureReadIndex]
      const destinationIndex = 1 - this.pressureReadIndex
      this.beginTargetPass(gl, program, this.pressureTargets![destinationIndex])
      this.bindTexture(gl, program, 'u_pressure', source.texture, 0)
      this.bindTexture(gl, program, 'u_divergence', this.divergenceTarget!.texture, 1)
      this.setTexelUniform(gl, program)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      this.pressureReadIndex = destinationIndex
    }
  }

  private subtractPressureGradient(gl: WebGLRenderingContext): void {
    const targets = this.velocityTargets!
    const destinationIndex = 1 - this.velocityReadIndex
    const program = this.program('gradient')
    this.beginTargetPass(gl, program, targets[destinationIndex])
    this.bindTexture(gl, program, 'u_velocity', targets[this.velocityReadIndex].texture, 0)
    this.bindTexture(gl, program, 'u_pressure', this.pressureTargets![this.pressureReadIndex].texture, 1)
    this.setTexelUniform(gl, program)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    this.velocityReadIndex = destinationIndex
  }

  private renderSurface(gl: WebGLRenderingContext): void {
    const program = this.program('render')
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(program)
    this.bindGeometry(gl, program)
    this.bindTexture(gl, program, 'u_velocity', this.velocityTargets![this.velocityReadIndex].texture, 0)
    this.bindTexture(gl, program, 'u_material', this.materialTargets![this.materialReadIndex].texture, 1)
    this.bindTexture(gl, program, 'u_pressure', this.pressureTargets![this.pressureReadIndex].texture, 2)
    this.setTexelUniform(gl, program)
    gl.uniform1f(gl.getUniformLocation(program, 'u_themeDay'), document.body.classList.contains('theme-day') ? 1 : 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  private beginTargetPass(gl: WebGLRenderingContext, program: WebGLProgram, target: RenderTarget): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
    gl.viewport(0, 0, this.simulationWidth, this.simulationHeight)
    gl.useProgram(program)
    this.bindGeometry(gl, program)
  }

  private bindGeometry(gl: WebGLRenderingContext, program: WebGLProgram): void {
    const positionLocation = gl.getAttribLocation(program, 'a_position')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer)
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)
  }

  private bindTexture(
    gl: WebGLRenderingContext,
    program: WebGLProgram,
    name: string,
    texture: WebGLTexture,
    unit: number
  ): void {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.uniform1i(gl.getUniformLocation(program, name), unit)
  }

  private setTexelUniform(gl: WebGLRenderingContext, program: WebGLProgram): void {
    gl.uniform2f(gl.getUniformLocation(program, 'u_texel'), 1 / this.simulationWidth, 1 / this.simulationHeight)
  }

  private program(name: string): WebGLProgram {
    const program = this.programs.get(name)
    if (!program) {
      throw new Error(`Missing liquid shader program: ${name}`)
    }
    return program
  }

  private consumeImpulseUniforms(): Float32Array {
    const impulses = this.pendingImpulses.splice(0, MAX_IMPULSES)
    const values = this.createInactiveImpulseUniform()
    for (let i = 0; i < impulses.length; i++) {
      const impulse = impulses[i]
      const offset = i * 4
      values[offset] = impulse.x
      values[offset + 1] = impulse.y
      values[offset + 2] = impulse.vx
      values[offset + 3] = impulse.vy
    }
    return values
  }

  private createInactiveImpulseUniform(): Float32Array {
    const values = new Float32Array(MAX_IMPULSES * 4)
    for (let i = 0; i < MAX_IMPULSES; i++) {
      const offset = i * 4
      values[offset] = -10
      values[offset + 1] = -10
    }
    return values
  }

  private beginPointerImpulse(event: PointerEvent): void {
    if (!document.body.classList.contains('settings-open')) {
      return
    }

    this.pointerActive = true
    const point = this.pointerToUv(event)
    this.lastPointer = point
    this.pendingImpulses.push({ ...point, vx: 0.001, vy: 0.001 })
    this.trimImpulses()
  }

  private dragPointerImpulse(event: PointerEvent): void {
    if (!this.pointerActive || !document.body.classList.contains('settings-open')) {
      return
    }

    const point = this.pointerToUv(event)
    const previous = this.lastPointer ?? point
    this.lastPointer = point
    this.pendingImpulses.push({
      ...point,
      vx: (point.x - previous.x) * 28,
      vy: (point.y - previous.y) * 28,
    })
    this.trimImpulses()
  }

  private endPointerImpulse(): void {
    this.pointerActive = false
    this.lastPointer = null
  }

  private pointerToUv(event: PointerEvent): { x: number; y: number } {
    return {
      x: event.clientX / Math.max(window.innerWidth, 1),
      y: 1 - event.clientY / Math.max(window.innerHeight, 1),
    }
  }

  private trimImpulses(): void {
    if (this.pendingImpulses.length > MAX_IMPULSES * 2) {
      this.pendingImpulses.splice(0, this.pendingImpulses.length - MAX_IMPULSES * 2)
    }

    if (this.reducedMotion) {
      this.render(performance.now())
    }
  }
}

export function initializeLiquidGlassSurface(): LiquidGlassSurface | null {
  const canvas = document.getElementById('liquid-glass-surface')
  if (!(canvas instanceof HTMLCanvasElement)) {
    return null
  }

  const surface = new LiquidGlassSurface(canvas)
  surface.initialize()
  return surface
}
