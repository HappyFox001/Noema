/**
 * Global GPU liquid simulation overlay for the desktop control surface.
 */
type SimulationTarget = {
  texture: WebGLTexture
  framebuffer: WebGLFramebuffer
}

type PointerImpulse = {
  x: number
  y: number
  vx: number
  vy: number
}

const SIMULATION_BASE_SIZE = 320
const MAX_IMPULSES = 8
const SIMULATION_STEPS_PER_FRAME = 2

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

const SIMULATION_SHADER = `
precision highp float;

uniform sampler2D u_state;
uniform vec2 u_texel;
uniform float u_dt;
uniform float u_time;
uniform vec4 u_impulses[${MAX_IMPULSES}];
varying vec2 v_uv;

vec4 readState(vec2 uv) {
  vec4 raw = texture2D(u_state, clamp(uv, vec2(0.0), vec2(1.0)));
  float height = raw.r * 2.0 - 1.0;
  vec2 velocity = raw.gb * 2.0 - 1.0;
  float density = raw.a;
  return vec4(height, velocity, density);
}

vec4 packState(float height, vec2 velocity, float density) {
  return vec4(
    clamp(height * 0.5 + 0.5, 0.0, 1.0),
    clamp(velocity * 0.5 + 0.5, 0.0, 1.0),
    clamp(density, 0.0, 1.0)
  );
}

void main() {
  vec4 center = readState(v_uv);
  vec2 velocity = center.yz;

  vec2 advectUv = v_uv - velocity * u_dt * 0.115;
  vec4 advected = readState(advectUv);

  vec4 left = readState(v_uv - vec2(u_texel.x, 0.0));
  vec4 right = readState(v_uv + vec2(u_texel.x, 0.0));
  vec4 down = readState(v_uv - vec2(0.0, u_texel.y));
  vec4 up = readState(v_uv + vec2(0.0, u_texel.y));

  float height = advected.x;
  velocity = advected.yz;
  float density = advected.w;

  vec2 pressureGradient = vec2(right.x - left.x, up.x - down.x);
  float divergence = (right.y - left.y) + (up.z - down.z);

  velocity -= pressureGradient * 0.34;
  height -= divergence * 0.22;

  for (int i = 0; i < ${MAX_IMPULSES}; i++) {
    vec4 impulse = u_impulses[i];
    vec2 delta = v_uv - impulse.xy;
    float impulseSpeed = length(impulse.zw);
    float radius = mix(0.034, 0.078, clamp(impulseSpeed * 0.08, 0.0, 1.0));
    float falloff = exp(-dot(delta, delta) / max(radius * radius, 0.0001));
    velocity += impulse.zw * falloff * 0.022;
    height += falloff * (0.58 + impulseSpeed * 0.04);
    density += falloff * (0.78 + impulseSpeed * 0.05);
  }

  float topBand = smoothstep(0.72, 1.0, v_uv.y);
  float sourceGate = 0.55 + 0.45 * sin(v_uv.x * 17.0 + u_time * 0.9);
  float source = topBand * smoothstep(0.34, 0.96, sourceGate) * 0.006;
  velocity += vec2(0.006, -0.012) * topBand;
  height += source * 0.82;
  density += source;

  height += (left.x + right.x + down.x + up.x - height * 4.0) * 0.085;
  velocity *= 0.986;
  height *= 0.992;
  density *= 0.991;

  gl_FragColor = packState(height, velocity, density);
}
`

const RENDER_SHADER = `
precision highp float;

uniform sampler2D u_state;
uniform vec2 u_texel;
uniform vec2 u_resolution;
varying vec2 v_uv;

vec4 readState(vec2 uv) {
  vec4 raw = texture2D(u_state, clamp(uv, vec2(0.0), vec2(1.0)));
  float height = raw.r * 2.0 - 1.0;
  vec2 velocity = raw.gb * 2.0 - 1.0;
  float density = raw.a;
  return vec4(height, velocity, density);
}

void main() {
  vec4 center = readState(v_uv);
  vec4 left = readState(v_uv - vec2(u_texel.x, 0.0));
  vec4 right = readState(v_uv + vec2(u_texel.x, 0.0));
  vec4 down = readState(v_uv - vec2(0.0, u_texel.y));
  vec4 up = readState(v_uv + vec2(0.0, u_texel.y));

  vec2 slope = vec2(right.x - left.x, up.x - down.x);
  vec3 normal = normalize(vec3(-slope * 7.5, 1.0));
  vec2 velocity = center.yz;
  float density = smoothstep(0.006, 0.62, center.w);
  float height = abs(center.x);

  vec3 lightDir = normalize(vec3(-0.32, 0.48, 0.82));
  float specular = pow(max(dot(reflect(-lightDir, normal), vec3(0.0, 0.0, 1.0)), 0.0), 38.0);
  float rim = pow(clamp(1.0 - normal.z, 0.0, 1.0), 1.6);
  float flowEdge = smoothstep(0.035, 0.22, length(velocity));
  float thickness = smoothstep(0.08, 0.82, density + height * 0.58);

  vec3 waterTint = vec3(0.74, 0.92, 1.0);
  vec3 color = waterTint * (thickness * 0.18 + rim * 0.32 + flowEdge * 0.13);
  color += vec3(1.0) * specular * (0.36 + density * 0.42);
  color += vec3(0.58, 0.84, 1.0) * height * 0.14;

  float alpha = density * 0.18 + rim * 0.12 + specular * 0.34 + flowEdge * 0.055;
  alpha *= smoothstep(0.0, 0.06, v_uv.x) * smoothstep(1.0, 0.94, v_uv.x);

  gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.34));
}
`

export class LiquidGlassSurface {
  private gl: WebGLRenderingContext | null = null
  private simulationProgram: WebGLProgram | null = null
  private renderProgram: WebGLProgram | null = null
  private positionBuffer: WebGLBuffer | null = null
  private targets: [SimulationTarget, SimulationTarget] | null = null
  private readTargetIndex = 0
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

    const simulationProgram = this.createProgram(gl, SIMULATION_SHADER)
    const renderProgram = this.createProgram(gl, RENDER_SHADER)
    const positionBuffer = gl.createBuffer()
    if (!simulationProgram || !renderProgram || !positionBuffer) {
      this.canvas.hidden = true
      return
    }

    this.gl = gl
    this.simulationProgram = simulationProgram
    this.renderProgram = renderProgram
    this.positionBuffer = positionBuffer
    this.prepareGeometry(gl)
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
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    )
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
      nextSimulationWidth !== this.simulationWidth ||
      nextSimulationHeight !== this.simulationHeight ||
      !this.targets
    ) {
      this.simulationWidth = nextSimulationWidth
      this.simulationHeight = nextSimulationHeight
      this.targets = [
        this.createSimulationTarget(gl, this.simulationWidth, this.simulationHeight),
        this.createSimulationTarget(gl, this.simulationWidth, this.simulationHeight),
      ]
      this.clearSimulationTargets(gl)
    }
  }

  private createSimulationTarget(gl: WebGLRenderingContext, width: number, height: number): SimulationTarget {
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
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    return { texture, framebuffer }
  }

  private clearSimulationTargets(gl: WebGLRenderingContext): void {
    if (!this.targets) {
      return
    }

    gl.disable(gl.BLEND)
    gl.viewport(0, 0, this.simulationWidth, this.simulationHeight)
    gl.clearColor(0.5, 0.5, 0.5, 0)
    for (const target of this.targets) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.enable(gl.BLEND)
    this.readTargetIndex = 0
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
    if (!gl || !this.targets || !this.simulationProgram || !this.renderProgram) {
      return
    }

    const dt = Math.min(0.033, Math.max(0.001, (now - this.lastFrameAt) / 1000))
    this.lastFrameAt = now
    const seconds = (now - this.startedAt) / 1000
    const impulses = this.consumeImpulseUniforms()

    gl.disable(gl.BLEND)
    for (let i = 0; i < SIMULATION_STEPS_PER_FRAME; i++) {
      this.runSimulationPass(gl, dt / SIMULATION_STEPS_PER_FRAME, seconds, i === 0 ? impulses : null)
    }

    gl.enable(gl.BLEND)
    this.runRenderPass(gl)

    this.animationFrameId = document.hidden || this.reducedMotion
      ? null
      : requestAnimationFrame((time) => this.render(time))
  }

  private runSimulationPass(
    gl: WebGLRenderingContext,
    dt: number,
    seconds: number,
    impulses: { values: Float32Array; count: number } | null
  ): void {
    if (!this.targets || !this.simulationProgram) {
      return
    }

    const source = this.targets[this.readTargetIndex]
    const destinationIndex = 1 - this.readTargetIndex
    const destination = this.targets[destinationIndex]

    gl.bindFramebuffer(gl.FRAMEBUFFER, destination.framebuffer)
    gl.viewport(0, 0, this.simulationWidth, this.simulationHeight)
    gl.useProgram(this.simulationProgram)
    this.bindGeometry(gl, this.simulationProgram)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, source.texture)
    gl.uniform1i(gl.getUniformLocation(this.simulationProgram, 'u_state'), 0)
    gl.uniform2f(
      gl.getUniformLocation(this.simulationProgram, 'u_texel'),
      1 / this.simulationWidth,
      1 / this.simulationHeight
    )
    gl.uniform1f(gl.getUniformLocation(this.simulationProgram, 'u_dt'), dt)
    gl.uniform1f(gl.getUniformLocation(this.simulationProgram, 'u_time'), seconds)
    gl.uniform4fv(
      gl.getUniformLocation(this.simulationProgram, 'u_impulses'),
      impulses?.values ?? this.createInactiveImpulseUniform()
    )
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    this.readTargetIndex = destinationIndex
  }

  private runRenderPass(gl: WebGLRenderingContext): void {
    if (!this.targets || !this.renderProgram) {
      return
    }

    const source = this.targets[this.readTargetIndex]
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.renderProgram)
    this.bindGeometry(gl, this.renderProgram)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, source.texture)
    gl.uniform1i(gl.getUniformLocation(this.renderProgram, 'u_state'), 0)
    gl.uniform2f(
      gl.getUniformLocation(this.renderProgram, 'u_texel'),
      1 / this.simulationWidth,
      1 / this.simulationHeight
    )
    gl.uniform2f(gl.getUniformLocation(this.renderProgram, 'u_resolution'), this.canvas.width, this.canvas.height)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  private bindGeometry(gl: WebGLRenderingContext, program: WebGLProgram): void {
    const positionLocation = gl.getAttribLocation(program, 'a_position')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer)
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)
  }

  private consumeImpulseUniforms(): { values: Float32Array; count: number } {
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
    return { values, count: impulses.length }
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
    this.pendingImpulses.push({
      ...point,
      vx: 0.001,
      vy: 0.001,
    })
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
      vx: (point.x - previous.x) * 34,
      vy: (point.y - previous.y) * 34,
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
