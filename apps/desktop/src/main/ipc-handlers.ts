/**
 * Registers grouped Electron IPC handlers for desktop main services.
 */
import { app, BrowserWindow, clipboard, net, screen, shell, type IpcMain } from 'electron'
import type { AppLogStore } from './app-log-store.js'
import type { AppSettings } from './settings-store.js'

interface CaptureRect {
  x: number
  y: number
  width: number
  height: number
  scaleFactor?: number
}

let themeTransitionCoverWindow: BrowserWindow | null = null
const APP_RELEASES_API_URL = 'https://api.github.com/repos/HappyFox001/Noema/releases/latest'
const APP_RELEASES_PAGE_URL = 'https://github.com/HappyFox001/Noema/releases'
let appUpdateCache: { checkedAt: number; result: AppUpdateCheckResult } | null = null

interface AppUpdateCheckResult {
  success: boolean
  error?: string
  currentVersion: string
  latestVersion?: string
  updateAvailable: boolean
  releaseName?: string
  releaseNotes?: string
  releaseUrl?: string
  publishedAt?: string
  checkedAt: number
}

function normalizeCaptureRect(rect: CaptureRect, bounds: { width: number; height: number }): CaptureRect | null {
  const scaleFactor = Number.isFinite(Number(rect.scaleFactor))
    ? Math.max(1, Math.min(4, Number(rect.scaleFactor)))
    : 1
  const x = Math.max(0, Math.floor(Number(rect.x) * scaleFactor))
  const y = Math.max(0, Math.floor(Number(rect.y) * scaleFactor))
  const width = Math.max(1, Math.ceil(Number(rect.width) * scaleFactor))
  const height = Math.max(1, Math.ceil(Number(rect.height) * scaleFactor))
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(scaleFactor)) {
    return null
  }

  const clampedWidth = Math.min(width, Math.max(0, bounds.width - x))
  const clampedHeight = Math.min(height, Math.max(0, bounds.height - y))
  if (clampedWidth < 1 || clampedHeight < 1) {
    return null
  }

  return {
    x,
    y,
    width: clampedWidth,
    height: clampedHeight,
    scaleFactor,
  }
}

function closeThemeTransitionCoverWindow(): void {
  const cover = themeTransitionCoverWindow
  themeTransitionCoverWindow = null
  if (cover && !cover.isDestroyed()) {
    cover.close()
  }
}

async function checkAppUpdates(force = false): Promise<AppUpdateCheckResult> {
  const now = Date.now()
  const currentVersion = app.getVersion()
  if (!force && appUpdateCache && now - appUpdateCache.checkedAt < 30 * 60 * 1000) {
    return appUpdateCache.result
  }

  try {
    const response = await Promise.race([
      net.fetch(APP_RELEASES_API_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `Noema/${currentVersion}`,
        },
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Update check timed out')), 10000)
      }),
    ])
    if (!response.ok) {
      throw new Error(`GitHub release check failed: HTTP ${response.status}`)
    }

    const release = await response.json() as {
      tag_name?: string
      name?: string
      body?: string
      html_url?: string
      published_at?: string
    }
    const latestVersion = normalizeVersion(release.tag_name || release.name || '')
    if (!latestVersion) {
      throw new Error('Latest release does not include a version tag')
    }

    const result: AppUpdateCheckResult = {
      success: true,
      currentVersion,
      latestVersion,
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      releaseName: release.name || release.tag_name || latestVersion,
      releaseNotes: typeof release.body === 'string' ? release.body : '',
      releaseUrl: release.html_url || APP_RELEASES_PAGE_URL,
      publishedAt: release.published_at,
      checkedAt: Date.now(),
    }
    appUpdateCache = { checkedAt: result.checkedAt, result }
    return result
  } catch (error: any) {
    const result: AppUpdateCheckResult = {
      success: false,
      error: error?.message || String(error),
      currentVersion,
      updateAvailable: false,
      checkedAt: Date.now(),
    }
    appUpdateCache = { checkedAt: result.checkedAt, result }
    return result
  }
}

function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, '').split(/[+\s]/)[0]
}

function compareVersions(left: string, right: string): number {
  const leftParts = parseVersionParts(left)
  const rightParts = parseVersionParts(right)
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (diff !== 0) {
      return diff > 0 ? 1 : -1
    }
  }
  return 0
}

function parseVersionParts(value: string): number[] {
  const normalized = normalizeVersion(value).split('-')[0]
  return normalized.split('.').map(part => {
    const parsed = Number.parseInt(part, 10)
    return Number.isFinite(parsed) ? parsed : 0
  })
}

async function showThemeTransitionCoverWindow(win: BrowserWindow, dataUrl: string): Promise<void> {
  closeThemeTransitionCoverWindow()

  const bounds = win.getBounds()
  const cover = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    parent: win,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    focusable: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  cover.setIgnoreMouseEvents(true, { forward: true })
  themeTransitionCoverWindow = cover

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: transparent;
    }
    img {
      display: block;
      width: 100vw;
      height: 100vh;
      object-fit: fill;
      user-select: none;
      -webkit-user-drag: none;
    }
    canvas {
      position: fixed;
      inset: 0;
      display: block;
      width: 100vw;
      height: 100vh;
      opacity: 0;
      background: transparent;
    }
    canvas.visible {
      opacity: 1;
    }
  </style>
</head>
<body>
  <img id="fallback" src="${dataUrl}" alt="">
  <canvas id="transition"></canvas>
  <script>
    window.__beforeUrl = ${JSON.stringify(dataUrl)};
    const TILE_SIZE = 48;
    const CAMERA_Z = 150;
    const CAMERA_FOV = 50;
    const PROGRESS_EASE = 0.095;
    const PROGRESS_DONE_THRESHOLD = 0.003;

    function random(seed) {
      const value = Math.sin(seed * 12.9898) * 43758.5453;
      return value - Math.floor(value);
    }

    function loadImage(src) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Theme transition image failed to load.'));
        image.src = src;
      });
    }

    function createShader(gl, type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) || 'Shader compile failed.');
      }
      return shader;
    }

    function createProgram(gl) {
      const vertex = createShader(gl, gl.VERTEX_SHADER, \`#version 300 es
        precision highp float;

        in vec2 a_position;
        in vec2 a_uv;
        in vec2 i_center;
        in vec2 i_size;
        in vec2 i_uvOffset;
        in vec2 i_uvSize;
        in vec3 i_offset;
        in vec3 i_rotation;

        uniform vec2 u_worldSize;
        uniform float u_cameraZ;
        uniform float u_progress;
        uniform float u_meshZ;

        out vec2 v_uv;

        mat3 rotationMatrixXYZ(vec3 r) {
          float cx = cos(r.x);
          float sx = sin(r.x);
          float cy = cos(r.y);
          float sy = sin(r.y);
          float cz = cos(r.z);
          float sz = sin(r.z);

          return mat3(
             cy * cz, cx * sz + sx * sy * cz, sx * sz - cx * sy * cz,
            -cy * sz, cx * cz - sx * sy * sz, sx * cz + cx * sy * sz,
                  sy,               -sx * cy,                cx * cy
          );
        }

        void main() {
          vec3 transformed = vec3(a_position * i_size, 0.0);
          transformed = rotationMatrixXYZ(u_progress * i_rotation) * transformed;
          transformed += vec3(i_center, u_meshZ);
          transformed += u_progress * i_offset;

          float cameraDepth = max(1.0, u_cameraZ - transformed.z);
          float perspective = u_cameraZ / cameraDepth;
          vec2 projected = transformed.xy * perspective;
          vec2 clip = vec2(projected.x / (u_worldSize.x * 0.5), projected.y / (u_worldSize.y * 0.5));
          float depth = (u_cameraZ - transformed.z) / (u_cameraZ * 2.0);

          gl_Position = vec4(clip, depth, 1.0);
          v_uv = i_uvOffset + a_uv * i_uvSize;
        }
      \`);
      const fragment = createShader(gl, gl.FRAGMENT_SHADER, \`#version 300 es
        precision highp float;

        uniform sampler2D u_texture;
        uniform float u_opacity;

        in vec2 v_uv;
        out vec4 outColor;

        void main() {
          vec4 color = texture(u_texture, v_uv);
          outColor = vec4(color.rgb, color.a * u_opacity);
        }
      \`);
      const program = gl.createProgram();
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || 'Program link failed.');
      }
      return program;
    }

    function createTexture(gl, image) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      return texture;
    }

    function colorToCss(color) {
      return 'rgb(' + Math.round(color[0] * 255) + ', ' + Math.round(color[1] * 255) + ', ' + Math.round(color[2] * 255) + ')';
    }

    function inferThemeBackgroundColor(image) {
      const sampleSize = 32;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) {
        return [0.012, 0.016, 0.02];
      }

      canvas.width = sampleSize;
      canvas.height = sampleSize;
      context.clearRect(0, 0, sampleSize, sampleSize);
      context.drawImage(image, 0, 0, sampleSize, sampleSize);
      const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;
      let luminance = 0;
      let weight = 0;

      for (let y = 0; y < sampleSize; y += 1) {
        for (let x = Math.floor(sampleSize * 0.36); x < sampleSize; x += 1) {
          const offset = (y * sampleSize + x) * 4;
          const alpha = pixels[offset + 3] / 255;
          if (alpha <= 0.03) {
            continue;
          }

          const r = pixels[offset] / 255;
          const g = pixels[offset + 1] / 255;
          const b = pixels[offset + 2] / 255;
          luminance += (r * 0.2126 + g * 0.7152 + b * 0.0722) * alpha;
          weight += alpha;
        }
      }

      const average = weight > 0 ? luminance / weight : 0;
      return average > 0.48 ? [0.89, 0.915, 0.905] : [0.012, 0.016, 0.02];
    }

    function flattenImage(image, backgroundColor) {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { alpha: false });
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;

      canvas.width = width;
      canvas.height = height;
      if (!context) {
        return image;
      }

      context.fillStyle = colorToCss(backgroundColor);
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      return canvas;
    }

    function bindAttribute(gl, program, name, size, data, divisor) {
      const location = gl.getAttribLocation(program, name);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(location, divisor);
      return buffer;
    }

    function getWorldSize(width, height) {
      const vFov = (CAMERA_FOV * Math.PI) / 180;
      const worldHeight = 2 * Math.tan(vFov / 2) * Math.abs(CAMERA_Z);
      return {
        width: worldHeight * (width / Math.max(1, height)),
        height: worldHeight,
      };
    }

    function createPlane(gl, program, width, height, anim, worldSize) {
      const nx = Math.ceil(width / TILE_SIZE);
      const ny = Math.ceil(height / TILE_SIZE);
      const count = nx * ny;
      const centers = new Float32Array(count * 2);
      const sizes = new Float32Array(count * 2);
      const uvOffsets = new Float32Array(count * 2);
      const uvSizes = new Float32Array(count * 2);
      const offsets = new Float32Array(count * 3);
      const rotations = new Float32Array(count * 3);
      const tileWidth = worldSize.width / nx;
      const tileHeight = worldSize.height / ny;
      let index = 0;

      for (let i = 0; i < nx; i += 1) {
        for (let j = 0; j < ny; j += 1) {
          const seed = i * ny + j + anim * 1000;

          centers[index * 2] = -worldSize.width / 2 + tileWidth * (i + 0.5);
          centers[index * 2 + 1] = worldSize.height / 2 - tileHeight * (j + 0.5);
          sizes[index * 2] = tileWidth;
          sizes[index * 2 + 1] = tileHeight;
          uvOffsets[index * 2] = i / nx;
          uvOffsets[index * 2 + 1] = 1 - (j + 1) / ny;
          uvSizes[index * 2] = 1 / nx;
          uvSizes[index * 2 + 1] = 1 / ny;

          if (anim === 1) {
            offsets[index * 3] = (random(seed + 1) - 0.5) * 10;
            offsets[index * 3 + 1] = 50 + random(seed + 2) * 50;
            offsets[index * 3 + 2] = 20 + random(seed + 3) * 30;
          } else {
            offsets[index * 3] = (random(seed + 1) - 0.5) * 20;
            offsets[index * 3 + 1] = (random(seed + 2) - 0.5) * 20;
            offsets[index * 3 + 2] = 20 + random(seed + 3) * 180;
          }

          rotations[index * 3] = (random(seed + 4) - 0.5) * Math.PI * 4;
          rotations[index * 3 + 1] = (random(seed + 5) - 0.5) * Math.PI * 4;
          rotations[index * 3 + 2] = (random(seed + 6) - 0.5) * Math.PI * 4;
          index += 1;
        }
      }

      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const buffers = [
        bindAttribute(gl, program, 'a_position', 2, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), 0),
        bindAttribute(gl, program, 'a_uv', 2, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 0),
        bindAttribute(gl, program, 'i_center', 2, centers, 1),
        bindAttribute(gl, program, 'i_size', 2, sizes, 1),
        bindAttribute(gl, program, 'i_uvOffset', 2, uvOffsets, 1),
        bindAttribute(gl, program, 'i_uvSize', 2, uvSizes, 1),
        bindAttribute(gl, program, 'i_offset', 3, offsets, 1),
        bindAttribute(gl, program, 'i_rotation', 3, rotations, 1),
      ];
      gl.bindVertexArray(null);
      return { vao, count, buffers };
    }

    window.playThemeTransition = async function(afterUrl) {
      const fallback = document.getElementById('fallback');
      const canvas = document.getElementById('transition');
      const gl = canvas.getContext('webgl2', { alpha: true, antialias: true });
      if (!gl) {
        fallback.src = afterUrl;
        return false;
      }

      const beforeImage = await loadImage(window.__beforeUrl);
      const afterImage = await loadImage(afterUrl);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);

      const program = createProgram(gl);
      gl.useProgram(program);
      const uWorldSize = gl.getUniformLocation(program, 'u_worldSize');
      const uCameraZ = gl.getUniformLocation(program, 'u_cameraZ');
      const uProgress = gl.getUniformLocation(program, 'u_progress');
      const uMeshZ = gl.getUniformLocation(program, 'u_meshZ');
      const uOpacity = gl.getUniformLocation(program, 'u_opacity');
      const uTexture = gl.getUniformLocation(program, 'u_texture');
      gl.uniform1i(uTexture, 0);
      gl.uniform1f(uCameraZ, CAMERA_Z);

      const beforeBackground = inferThemeBackgroundColor(beforeImage);
      const afterBackground = inferThemeBackgroundColor(afterImage);
      const beforeTexture = createTexture(gl, flattenImage(beforeImage, beforeBackground));
      const afterTexture = createTexture(gl, flattenImage(afterImage, afterBackground));
      const worldSize = getWorldSize(width, height);
      const plane1 = createPlane(gl, program, width, height, 1, worldSize);
      const plane2 = createPlane(gl, program, width, height, 2, worldSize);
      const stageColor = beforeBackground;
      let firstFrame = true;

      gl.uniform2f(uWorldSize, worldSize.width, worldSize.height);

      function drawPlane(plane, texture, planeProgress, opacity, meshZ) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1f(uProgress, planeProgress);
        gl.uniform1f(uOpacity, opacity);
        gl.uniform1f(uMeshZ, meshZ);
        gl.bindVertexArray(plane.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, plane.count);
      }

      return await new Promise((resolve) => {
        let progress = 0;

        function tick() {
          progress += (1 - progress) * PROGRESS_EASE;

          if (Math.abs(1 - progress) < PROGRESS_DONE_THRESHOLD) {
            progress = 1;
          }

          gl.clearColor(stageColor[0], stageColor[1], stageColor[2], 1);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
          drawPlane(plane2, afterTexture, -1 + progress, progress, progress - 1);
          drawPlane(plane1, beforeTexture, progress, 1 - progress, progress);

          if (firstFrame) {
            firstFrame = false;
            canvas.classList.add('visible');
            fallback.style.visibility = 'hidden';
          }

          if (progress === 1) {
            resolve(true);
            return;
          }

          requestAnimationFrame(tick);
        }

        requestAnimationFrame(tick);
      });
    };
  </script>
</body>
</html>`

  cover.once('closed', () => {
    if (themeTransitionCoverWindow === cover) {
      themeTransitionCoverWindow = null
    }
  })

  await cover.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  if (!cover.isDestroyed()) {
    cover.showInactive()
  }
}

async function playThemeTransitionCoverWindow(afterDataUrl: string): Promise<void> {
  const cover = themeTransitionCoverWindow
  if (!cover || cover.isDestroyed()) {
    throw new Error('Theme transition cover window is not available')
  }

  try {
    await cover.webContents.executeJavaScript(
      `window.playThemeTransition(${JSON.stringify(afterDataUrl)})`,
      true
    )
  } finally {
    closeThemeTransitionCoverWindow()
  }
}

export function registerLogIpcHandlers(ipcMain: IpcMain, appLogStore: AppLogStore): void {
  ipcMain.handle('logs:list', async (_, limit?: number) => {
    return {
      success: true,
      logs: appLogStore.list(Number(limit) || undefined),
    }
  })

  ipcMain.handle('logs:clear', async () => {
    appLogStore.clear()
    return { success: true }
  })

  ipcMain.on('logs:setStreaming', (_, streaming: boolean) => {
    appLogStore.setRendererStreaming(streaming === true)
  })
}

export function registerDebugIpcHandlers(
  ipcMain: IpcMain,
  frameTraceObserver: {
    getTrace(): unknown[]
    clear(): void
  }
): void {
  ipcMain.handle('debug:frameTrace', async () => {
    return frameTraceObserver.getTrace()
  })

  ipcMain.handle('debug:clearFrameTrace', async () => {
    frameTraceObserver.clear()
    return { success: true }
  })
}

export function registerSystemIpcHandlers(
  ipcMain: IpcMain,
  options: {
    isDevMode(): boolean
    getTelemetry(): {
      success: true
      memoryBytes: number
      activeNetworkInterfaces: number
      proxyActive: boolean
      activeProxyUrl: string
    }
  }
): void {
  ipcMain.handle('system:telemetry', async () => options.getTelemetry())
  ipcMain.handle('app:isDevMode', () => options.isDevMode())
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:checkForUpdates', async (_event, request?: { force?: boolean }) => {
    return checkAppUpdates(request?.force === true)
  })
  ipcMain.handle('app:openReleasePage', async (_event, releaseUrl?: string) => {
    const target = isAllowedReleaseUrl(releaseUrl) ? releaseUrl! : APP_RELEASES_PAGE_URL
    await shell.openExternal(target)
    return { success: true }
  })
}

function isAllowedReleaseUrl(value?: string): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      /^\/HappyFox001\/Noema\/releases(\/|$)/.test(url.pathname)
  } catch {
    return false
  }
}

export function registerSettingsReadIpcHandlers(
  ipcMain: IpcMain,
  options: {
    getSettings(): AppSettings
  }
): void {
  ipcMain.handle('settings:get', async () => options.getSettings())
}

export function registerWindowIpcHandlers(
  ipcMain: IpcMain,
  options: {
    chatWindowDesignSize: { width: number; height: number }
    compactWindowSize: { width: number; height: number }
    settingsWindowSize: { width: number; height: number }
    taskWindowSize: { width: number; height: number }
    resizeWindowAroundCenter(window: BrowserWindow, width: number, height: number): void
  }
): void {
  function getChatWindowSize(win: BrowserWindow): { width: number; height: number } {
    const bounds = win.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const workArea = display.workArea
    const aspect = options.chatWindowDesignSize.width / options.chatWindowDesignSize.height
    const maxWidth = Math.floor(workArea.width * 0.86)
    const maxHeight = Math.floor(workArea.height * 0.88)
    const minWidth = Math.min(1280, Math.floor(workArea.width * 0.96))
    const minHeight = Math.min(720, Math.floor(workArea.height * 0.96))
    let width = Math.min(options.chatWindowDesignSize.width, Math.max(minWidth, maxWidth))
    let height = Math.round(width / aspect)

    if (height > maxHeight) {
      height = Math.max(minHeight, maxHeight)
      width = Math.round(height * aspect)
    }

    width = Math.min(width, workArea.width)
    height = Math.min(height, workArea.height)
    return { width, height }
  }

  ipcMain.on('window:move', (event, deltaX, deltaY) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      const [x, y] = win.getPosition()
      win.setPosition(x + deltaX, y + deltaY)
    }
  })

  ipcMain.handle('cursor:get-screen-point', () => {
    const point = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(point)
    return {
      x: point.x,
      y: point.y,
      displayBounds: display.bounds,
    }
  })

  ipcMain.handle('window:set-opacity', (event, opacity) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) {
      return { success: false, error: 'Window is not available' }
    }

    const value = Number(opacity)
    win.setOpacity(Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1)
    return { success: true }
  })

  ipcMain.handle('window:capture-to-clipboard', async (event, rect: CaptureRect) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) {
      return { success: false, error: 'Window is not available' }
    }

    const scaleFactor = Number.isFinite(Number(rect.scaleFactor))
      ? Math.max(1, Math.min(4, Number(rect.scaleFactor)))
      : 1
    const bounds = win.getContentBounds()
    const pixelBounds = {
      width: Math.round(bounds.width * scaleFactor),
      height: Math.round(bounds.height * scaleFactor),
    }
    const normalized = normalizeCaptureRect(rect, pixelBounds)
    if (!normalized) {
      return { success: false, error: 'Invalid capture area' }
    }

    try {
      const image = await win.webContents.capturePage(normalized)
      if (image.isEmpty()) {
        return { success: false, error: 'Capture returned an empty image' }
      }
      clipboard.writeImage(image)
      const size = image.getSize()
      return {
        success: true,
        width: size.width,
        height: size.height,
      }
    } catch (error: any) {
      return { success: false, error: error.message || String(error) }
    }
  })

  ipcMain.handle('window:capture', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) {
      return { success: false, error: 'Window is not available' }
    }

    try {
      const image = await win.webContents.capturePage()
      if (image.isEmpty()) {
        return { success: false, error: 'Capture returned an empty image' }
      }
      const size = image.getSize()
      return {
        success: true,
        width: size.width,
        height: size.height,
        dataUrl: image.toDataURL(),
      }
    } catch (error: any) {
      return { success: false, error: error.message || String(error) }
    }
  })

  ipcMain.handle('window:theme-transition-cover-begin', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) {
      return { success: false, error: 'Window is not available' }
    }

    try {
      const image = await win.webContents.capturePage()
      if (image.isEmpty()) {
        return { success: false, error: 'Capture returned an empty image' }
      }
      const size = image.getSize()
      const dataUrl = image.toDataURL()
      await showThemeTransitionCoverWindow(win, dataUrl)
      return {
        success: true,
        width: size.width,
        height: size.height,
        dataUrl,
      }
    } catch (error: any) {
      closeThemeTransitionCoverWindow()
      return { success: false, error: error.message || String(error) }
    }
  })

  ipcMain.handle('window:theme-transition-cover-end', async () => {
    closeThemeTransitionCoverWindow()
    return { success: true }
  })

  ipcMain.handle('window:theme-transition-cover-play', async (_, afterDataUrl: string) => {
    if (!afterDataUrl || typeof afterDataUrl !== 'string') {
      closeThemeTransitionCoverWindow()
      return { success: false, error: 'Missing transition target image' }
    }

    try {
      await playThemeTransitionCoverWindow(afterDataUrl)
      return { success: true }
    } catch (error: any) {
      closeThemeTransitionCoverWindow()
      return { success: false, error: error.message || String(error) }
    }
  })

  ipcMain.handle('window:set-compact-mode', async (event, compact) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) {
      return { success: false, error: 'Window is not available' }
    }

    const size = compact ? options.compactWindowSize : options.settingsWindowSize
    options.resizeWindowAroundCenter(win, size.width, size.height)
    await new Promise(resolve => setTimeout(resolve, 0))
    return { success: true }
  })

  ipcMain.handle('window:set-chat-mode', async (event, active, fullscreen = false) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) {
      return { success: false, error: 'Window is not available' }
    }

    if (!active) {
      options.resizeWindowAroundCenter(win, options.compactWindowSize.width, options.compactWindowSize.height)
      await new Promise(resolve => setTimeout(resolve, 0))
      return { success: true, fullscreen: false }
    }

    if (fullscreen) {
      const display = screen.getDisplayMatching(win.getBounds())
      win.setBounds(display.workArea, false)
      await new Promise(resolve => setTimeout(resolve, 0))
      return { success: true, fullscreen: true }
    }

    const size = getChatWindowSize(win)
    options.resizeWindowAroundCenter(win, size.width, size.height)
    await new Promise(resolve => setTimeout(resolve, 0))
    return { success: true, fullscreen: false, width: size.width, height: size.height }
  })

  ipcMain.handle('window:set-task-mode', async (event, active) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) {
      return { success: false, error: 'Window is not available' }
    }

    const size = active ? options.taskWindowSize : options.compactWindowSize
    options.resizeWindowAroundCenter(win, size.width, size.height)
    await new Promise(resolve => setTimeout(resolve, 0))
    return { success: true }
  })
}

export function registerMemoryIpcHandlers(
  ipcMain: IpcMain,
  options: {
    getSdk(): any | null
    getInteractiveInputStore(): {
      list(): Promise<unknown[]>
      delete(key: string): Promise<void>
      clear(): Promise<void>
    } | null
  }
): void {
  const requireSdk = () => {
    const sdk = options.getSdk()
    if (!sdk) {
      return { sdk: null, error: { success: false, error: 'SDK not initialized' } }
    }
    return { sdk, error: null }
  }

  ipcMain.handle('memory:getUserProfile', async () => {
    const { sdk, error } = requireSdk()
    if (!sdk) return error

    try {
      const profile = sdk.memory.getUserProfile()
      const importantMemories: Record<string, string> = {}
      if (profile.importantMemories instanceof Map) {
        profile.importantMemories.forEach((value: string, key: string) => {
          importantMemories[key] = value
        })
      } else if (profile.importantMemories && typeof profile.importantMemories === 'object') {
        Object.entries(profile.importantMemories as Record<string, unknown>).forEach(([key, value]) => {
          importantMemories[key] = String(value)
        })
      }

      return {
        success: true,
        profile: {
          basic: profile.basic,
          importantMemories,
        },
      }
    } catch (error: any) {
      console.error('[Memory] Failed to get user profile:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:updateUserProfile', async (_, updates: Record<string, string>) => {
    const { sdk, error } = requireSdk()
    if (!sdk) return error

    try {
      await sdk.memory.updateUserProfileBasic(updates)
      return { success: true }
    } catch (error: any) {
      console.error('[Memory] Failed to update user profile:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:addImportantMemory', async (_, key: string, value: string) => {
    const { sdk, error } = requireSdk()
    if (!sdk) return error

    try {
      await sdk.memory.addImportantMemory(key, value)
      return { success: true }
    } catch (error: any) {
      console.error('[Memory] Failed to add important memory:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:deleteImportantMemory', async (_, key: string) => {
    const { sdk, error } = requireSdk()
    if (!sdk) return error

    try {
      await sdk.memory.deleteImportantMemory(key)
      return { success: true }
    } catch (error: any) {
      console.error('[Memory] Failed to delete important memory:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:getConversationSummaries', async () => {
    const { sdk, error } = requireSdk()
    if (!sdk) return error

    try {
      const summaries = sdk.memory.getAllConversationSummaries()
      return { success: true, summaries }
    } catch (error: any) {
      console.error('[Memory] Failed to get conversation summaries:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:getWorkingMemory', async () => {
    const { sdk, error } = requireSdk()
    if (!sdk) return error

    try {
      const recentTurns = sdk.memory.getWorkingMemory()
      return { success: true, memory: { recentTurns } }
    } catch (error: any) {
      console.error('[Memory] Failed to get working memory:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:deleteConversationSummary', async (_, id: string) => {
    const { sdk, error } = requireSdk()
    if (!sdk) return error

    try {
      await sdk.memory.deleteConversationSummary(id)
      return { success: true }
    } catch (error: any) {
      console.error('[Memory] Failed to delete conversation summary:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:deleteConversationTurn', async (_, id: string) => {
    const { sdk, error } = requireSdk()
    if (!sdk) return error

    try {
      await sdk.memory.deleteConversationTurn(id)
      return { success: true }
    } catch (error: any) {
      console.error('[Memory] Failed to delete conversation turn:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:deleteProfileField', async (_, field: string) => {
    const { sdk, error } = requireSdk()
    if (!sdk) return error

    try {
      await sdk.memory.deleteProfileField(field)
      return { success: true }
    } catch (error: any) {
      console.error('[Memory] Failed to delete profile field:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:clearImportantMemories', async () => {
    const { sdk, error } = requireSdk()
    if (!sdk) return error

    try {
      await sdk.memory.clearImportantMemories()
      return { success: true }
    } catch (error: any) {
      console.error('[Memory] Failed to clear important memories:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:clearConversationSummaries', async () => {
    const { sdk, error } = requireSdk()
    if (!sdk) return error

    try {
      await sdk.memory.clearConversationSummaries()
      return { success: true }
    } catch (error: any) {
      console.error('[Memory] Failed to clear conversation summaries:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:clearWorkingMemory', async () => {
    const { sdk, error } = requireSdk()
    if (!sdk) return error

    try {
      await sdk.memory.clearWorkingMemory()
      return { success: true }
    } catch (error: any) {
      console.error('[Memory] Failed to clear working memory:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:listAccountInputs', async () => {
    const interactiveInputStore = options.getInteractiveInputStore()
    if (!interactiveInputStore) return { success: false, error: 'Interactive input store not initialized' }

    try {
      const inputs = await interactiveInputStore.list()
      return { success: true, inputs }
    } catch (error: any) {
      console.error('[Memory] Failed to list account inputs:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:deleteAccountInput', async (_, key: string) => {
    const interactiveInputStore = options.getInteractiveInputStore()
    if (!interactiveInputStore) return { success: false, error: 'Interactive input store not initialized' }

    try {
      await interactiveInputStore.delete(key)
      return { success: true }
    } catch (error: any) {
      console.error('[Memory] Failed to delete account input:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('memory:clearAccountInputs', async () => {
    const interactiveInputStore = options.getInteractiveInputStore()
    if (!interactiveInputStore) return { success: false, error: 'Interactive input store not initialized' }

    try {
      await interactiveInputStore.clear()
      return { success: true }
    } catch (error: any) {
      console.error('[Memory] Failed to clear account inputs:', error)
      return { success: false, error: error.message }
    }
  })
}

export function registerLearningIpcHandlers(
  ipcMain: IpcMain,
  options: {
    getSdk(): any | null
    isSelfLearningEnabled(): boolean
  }
): void {
  const requireLearning = () => {
    const sdk = options.getSdk()
    if (!sdk) {
      return { sdk: null, error: { success: false, error: 'SDK not initialized' } }
    }
    if (!options.isSelfLearningEnabled()) {
      return { sdk: null, error: { success: false, error: 'Self-learning is disabled.' } }
    }
    return { sdk, error: null }
  }

  ipcMain.handle('learning:overview', async () => {
    const sdk = options.getSdk()
    if (!sdk) return { success: false, error: 'SDK not initialized' }
    if (!options.isSelfLearningEnabled()) {
      return {
        success: true,
        disabled: true,
        events: [],
        reflections: [],
        candidates: [],
        assets: [],
        agents: [],
        automationDecisions: [],
        rollbacks: [],
      }
    }

    try {
      const [
        events,
        reflections,
        pendingCandidates,
        assets,
        agents,
        automationDecisions,
        rollbacks,
      ] = await Promise.all([
        sdk.learning.listEvents(80),
        sdk.learning.listReflections(20),
        sdk.learning.listCandidates(undefined, 50),
        sdk.learning.listAssets(undefined, 80),
        sdk.agentSociety.listAgents(),
        sdk.learning.listAutomationDecisions(50),
        sdk.learning.listAssetRollbacks(undefined, 50),
      ])
      return {
        success: true,
        events,
        reflections,
        candidates: pendingCandidates,
        assets,
        agents,
        automationDecisions,
        rollbacks,
      }
    } catch (error: any) {
      console.error('[Learning] Failed to load overview:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('learning:reflectRecent', async () => {
    const { sdk, error } = requireLearning()
    if (!sdk) return error

    try {
      const result = await sdk.reflection.reflectRecentEvents()
      return { success: true, result }
    } catch (error: any) {
      console.error('[Learning] Failed to reflect recent events:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('learning:deployCandidate', async (_event, payload: {
    candidateId: string
    scope: string
    status?: 'draft' | 'active'
  }) => {
    const { sdk, error } = requireLearning()
    if (!sdk) return error

    try {
      const asset = await sdk.learning.deployCandidate({
        candidateId: payload.candidateId,
        scope: payload.scope,
        status: payload.status ?? 'draft',
      })
      return { success: true, asset }
    } catch (error: any) {
      console.error('[Learning] Failed to deploy candidate:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('learning:setAssetStatus', async (_event, id: string, status: 'draft' | 'active' | 'disabled' | 'archived') => {
    const { sdk, error } = requireLearning()
    if (!sdk) return error

    try {
      await sdk.learning.setAssetStatus(id, status)
      return { success: true }
    } catch (error: any) {
      console.error('[Learning] Failed to set asset status:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('learning:deleteAsset', async (_event, id: string) => {
    const { sdk, error } = requireLearning()
    if (!sdk) return error

    try {
      await sdk.learning.deleteAsset(id)
      return { success: true }
    } catch (error: any) {
      console.error('[Learning] Failed to delete asset:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('learning:rollbackAsset', async (_event, id: string, reason: string) => {
    const { sdk, error } = requireLearning()
    if (!sdk) return error

    try {
      const rollback = await sdk.learning.rollbackAsset(id, reason || 'Rolled back from Learning Center')
      return { success: true, rollback }
    } catch (error: any) {
      console.error('[Learning] Failed to rollback asset:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('learning:setAgentStatus', async (_event, id: string, status: 'draft' | 'active' | 'disabled') => {
    const { sdk, error } = requireLearning()
    if (!sdk) return error

    try {
      await sdk.agentSociety.setAgentStatus(id, status)
      return { success: true }
    } catch (error: any) {
      console.error('[Learning] Failed to set agent status:', error)
      return { success: false, error: error.message }
    }
  })
}
