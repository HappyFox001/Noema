/**
 * Global WebGL overlay for the liquid glass film above the desktop controls.
 */
type Ripple = {
  x: number
  y: number
  startedAt: number
  strength: number
}

const MAX_RIPPLES = 12
const RIPPLE_LIFETIME_SECONDS = 2.8

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec4 u_ripples[${MAX_RIPPLES}];
varying vec2 v_uv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 rotate = mat2(0.8, -0.6, 0.6, 0.8);

  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p = rotate * p * 2.03 + 17.2;
    amplitude *= 0.52;
  }

  return value;
}

float rippleField(vec2 uv) {
  float field = 0.0;
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);

  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 ripple = u_ripples[i];
    float age = u_time - ripple.z;
    if (age <= 0.0 || age >= ${RIPPLE_LIFETIME_SECONDS.toFixed(1)}) {
      continue;
    }

    float fade = pow(1.0 - age / ${RIPPLE_LIFETIME_SECONDS.toFixed(1)}, 1.75);
    float distanceToCenter = length((uv - ripple.xy) * aspect);
    float radius = age * 0.34;
    float ring = sin((distanceToCenter - radius) * 56.0 - age * 8.0);
    float envelope = exp(-pow((distanceToCenter - radius) * 10.5, 2.0));
    field += ring * envelope * fade * ripple.w;
  }

  return field;
}

void main() {
  vec2 uv = v_uv;
  vec2 pixel = 1.0 / max(u_resolution, vec2(1.0));
  float time = u_time;

  vec2 flow = vec2(
    fbm(uv * vec2(3.6, 5.2) + vec2(time * 0.035, -time * 0.026)),
    fbm(uv * vec2(5.8, 3.4) + vec2(-time * 0.024, time * 0.032))
  ) - 0.5;
  float film = fbm(uv * 9.0 + flow * 0.8 + time * 0.018);
  float ripple = rippleField(uv);
  float surface = film + ripple * 0.54;

  float right = fbm((uv + vec2(pixel.x * 7.0, 0.0)) * 9.0 + flow * 0.8 + time * 0.018);
  float up = fbm((uv + vec2(0.0, pixel.y * 7.0)) * 9.0 + flow * 0.8 + time * 0.018);
  vec2 normal = vec2(surface - right, surface - up) * 3.2 + flow * 0.06;

  float diagonalSheen = smoothstep(0.74, 1.0, 1.0 - abs((uv.x + uv.y * 0.72 + normal.x * 0.3) - 0.92));
  float verticalEdge = smoothstep(0.0, 0.18, uv.x) * smoothstep(1.0, 0.82, uv.x);
  float topEdge = 1.0 - smoothstep(0.0, 0.22, uv.y);
  float caustic = smoothstep(0.76, 0.98, film + abs(normal.x) * 1.18 + abs(normal.y) * 0.98);
  float rippleLight = smoothstep(0.24, 0.86, abs(ripple));

  vec3 tint = vec3(0.80, 0.94, 1.0);
  vec3 color = tint * (caustic * 0.14 + diagonalSheen * 0.08 + topEdge * 0.045);
  color += vec3(1.0) * rippleLight * 0.16;
  color += vec3(0.56, 0.78, 0.92) * length(normal) * 0.22;
  color *= verticalEdge;

  float alpha = caustic * 0.07 + diagonalSheen * 0.05 + rippleLight * 0.12 + topEdge * 0.018;
  alpha *= verticalEdge;

  gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.18));
}
`

export class LiquidGlassSurface {
  private gl: WebGLRenderingContext | null = null
  private program: WebGLProgram | null = null
  private animationFrameId: number | null = null
  private ripples: Ripple[] = []
  private startedAt = performance.now()
  private reducedMotion = false
  private readonly handleResize = () => this.resize()
  private readonly handlePointerDown = (event: PointerEvent) => this.addRippleFromPointer(event)
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

    const program = this.createProgram(gl)
    if (!program) {
      this.canvas.hidden = true
      return
    }

    this.gl = gl
    this.program = program
    this.prepareGeometry(gl, program)
    this.resize()

    window.addEventListener('resize', this.handleResize)
    document.addEventListener('pointerdown', this.handlePointerDown, { capture: true, passive: true })
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
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
  }

  private createProgram(gl: WebGLRenderingContext): WebGLProgram | null {
    const vertexShader = this.compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    const fragmentShader = this.compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
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

  private prepareGeometry(gl: WebGLRenderingContext, program: WebGLProgram): void {
    const positionLocation = gl.getAttribLocation(program, 'a_position')
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    )
    gl.useProgram(program)
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  }

  private resize(): void {
    const gl = this.gl
    if (!gl) {
      return
    }

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.max(1, Math.floor(window.innerWidth * pixelRatio))
    const height = Math.max(1, Math.floor(window.innerHeight * pixelRatio))
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
    gl.viewport(0, 0, width, height)
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
    const program = this.program
    if (!gl || !program) {
      return
    }

    const seconds = (now - this.startedAt) / 1000
    this.ripples = this.ripples.filter(ripple => seconds - ripple.startedAt < RIPPLE_LIFETIME_SECONDS)

    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(program)

    gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), this.canvas.width, this.canvas.height)
    gl.uniform1f(gl.getUniformLocation(program, 'u_time'), seconds)
    gl.uniform4fv(gl.getUniformLocation(program, 'u_ripples'), this.buildRippleUniform(seconds))
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    this.animationFrameId = document.hidden || this.reducedMotion
      ? null
      : requestAnimationFrame((time) => this.render(time))
  }

  private buildRippleUniform(seconds: number): Float32Array {
    const values = new Float32Array(MAX_RIPPLES * 4)
    for (let i = 0; i < MAX_RIPPLES; i++) {
      const ripple = this.ripples[i]
      const offset = i * 4
      values[offset] = ripple?.x ?? -10
      values[offset + 1] = ripple?.y ?? -10
      values[offset + 2] = ripple?.startedAt ?? seconds + 10
      values[offset + 3] = ripple?.strength ?? 0
    }
    return values
  }

  private addRippleFromPointer(event: PointerEvent): void {
    const target = event.target as Element | null
    if (target?.closest('#liquid-glass-surface')) {
      return
    }

    const seconds = (performance.now() - this.startedAt) / 1000
    this.ripples.unshift({
      x: event.clientX / Math.max(window.innerWidth, 1),
      y: 1 - event.clientY / Math.max(window.innerHeight, 1),
      startedAt: seconds,
      strength: event.pointerType === 'mouse' ? 0.9 : 1.12,
    })

    if (this.ripples.length > MAX_RIPPLES) {
      this.ripples.length = MAX_RIPPLES
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
