// The Helix view: the server-engraved systems wound onto a slowly turning drum in raw WebGL, a vermilion
// playhead ribbon, and the Helix peel that lifts a part's staves off the drum onto a portrait page.
// All motion runs on animation-frame timestamps, so a paused or faked page clock moves it deterministically.

import { lookAt, multiply, perspective, pose, rotationY, translation, type Mat4, type Vec3 } from './mat4.js'
import { smoothstep, stepCriticallyDamped, Tween, type SpringState } from './motion.js'
import { DRUM_RADIUS, layoutDrum, restRects, SHEET, SHEET_ASPECT, sheetPitch, type DrumLayout, type RestRect } from './layout.js'
import { shaderSources, UNIFORM_NAMES, type UniformName } from './shaders.js'
import { rasteriseSheet, rasteriseSystem, readSvgInfo, type SheetPlacement, type SvgInfo } from './svgTexture.js'

interface HelixSystem {
  index: number
  svg: string
}

interface PeelRequest {
  staffIds: string[]
  partSystems: { index: number; page: number; svg: string }[]
}

interface HelixOptions {
  reducedMotion: boolean
}

type GL = WebGLRenderingContext | WebGL2RenderingContext
type Phase = 'idle' | 'peeling' | 'peeled' | 'unpeeling'
type StripStage = 'waiting' | 'moving' | 'rest'
type SheetState = 'none' | 'pending' | 'ready' | 'failed'

const FOV = (38 * Math.PI) / 180
const CAMERA_PITCH = 0.3
const IDLE_RATE = 0.05
const MAX_FRAME_MS = 100
/** A drawing that missed the browser's frame is presented this long after, on the browser's own clock. */
const CATCH_UP_MS = 24
const SETTLE_FRAMES = 6
const SEGMENTS = 96
const SPRING_OMEGA = 10
const SPRING_SNAP = 0.003
const STRIP_STAGGER_MS = 40
const FOCUS_MS = 400
const SHEET_FADE_MS = 250
const CROSSFADE_MS = 200
const UNPEEL_LEAD_MS = 150
const DIM_FLOOR = 0.35
const STRIP_LIFT = 0.7
const STRIP_SKIN = 1.004
const SHEET_PIXEL_WIDTH = 1296
const MAX_TEXTURE_PIXELS = 2048
const TEXTURE_JOBS_AT_ONCE = 2
const VERMILION: Vec3 = [0.851, 0.267, 0.122]
const PAPER: Vec3 = [0.965, 0.945, 0.906]
const SHADOW: Vec3 = [0.01, 0.015, 0.03]
const RIBBON_WIDTH_FRACTION = 0.045

interface SystemData {
  index: number
  svg: string
  info: SvgInfo
}

interface SystemTexture {
  texture: WebGLTexture
  width: number
  height: number
}

interface Strip {
  systemPosition: number
  /** Score order of the staff this strip was cut from: each staff starts 40 ms after the one before. */
  staffOrder: number
  /** Top and bottom of the staff's band as fractions of its system's height. */
  bandTop: number
  bandBottom: number
  bandHeight: number
  systemWidth: number
  rest: RestRect
  stage: StripStage
  startAt: number
  lastUpdate: number
  spring: SpringState
  target: 0 | 1
  /** Where on the drum the strip left from: its angle then, and the drum angle then. */
  origin: { yaw: number; drumAngle: number } | null
}

interface Transition {
  kind: 'peel' | 'unpeel'
  started: boolean
  sheetStarted: boolean
  resolve: () => void
}

interface Stage {
  view: Mat4
  projection: Mat4
  eye: Vec3
  pageModel: Mat4
  pageWidth: number
  pageHeight: number
  pageUnit: number
  recede: Vec3
  radiansPerPixel: number
}

interface StripPose {
  model: Mat4
  width: number
  height: number
  curvature: number
  progress: number
}

const wrapAngle = (angle: number): number => angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI))
const mix = (a: number, b: number, t: number): number => a + (b - a) * t

function transformPoint(m: Mat4, x: number, y: number, z: number): Vec3 {
  const at = (i: number): number => m[i] ?? 0
  return [
    at(0) * x + at(4) * y + at(8) * z + at(12),
    at(1) * x + at(5) * y + at(9) * z + at(13),
    at(2) * x + at(6) * y + at(10) * z + at(14),
  ]
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 3
}

export class HelixScene {
  private gl: GL
  private webgl2: boolean
  private program: WebGLProgram | null = null
  private uniforms = {} as Record<UniformName, WebGLUniformLocation | null>
  private meshBuffer: WebGLBuffer | null = null
  private indexBuffer: WebGLBuffer | null = null
  private indexCount = 0
  private paperTexture: WebGLTexture | null = null
  private sheetTexture: WebGLTexture | null = null
  private textures: (SystemTexture | null)[] = []
  private anisotropy: { ext: EXT_texture_filter_anisotropic; max: number } | null = null

  private systems: SystemData[] = []
  private drum: DrumLayout = layoutDrum(1, 3)
  private stage: Stage
  private generation = 0
  private queue: number[] = []
  private activeJobs = 0

  private reduced: boolean
  private angle = 0
  private dragging = false
  private lastPointerX = 0
  private playhead: { systemIndex: number; fraction: number } | null = null

  private phase: Phase = 'idle'
  private strips: Strip[] = []
  private transition: Transition | null = null
  private sheetState: SheetState = 'none'
  private lastRequest: PeelRequest | null = null
  private focus = new Tween(0)
  private backing = new Tween(0)
  private sheetAlpha = new Tween(0)

  private clock = 0
  private lastFrame: number | null = null
  private frameHandle = 0
  private quietFrames = 0
  /** The browser frame (document timeline time) of the last drawing, so at most one drawing reaches the GPU per frame. */
  private presentedAt: number | null = null
  private presentPending = false
  private catchUp: AbortSignal | null = null
  private visible = true
  private lost = false
  private disposed = false
  private cssWidth = 1
  private cssHeight = 1
  private intersection: IntersectionObserver | null = null
  private resizeObserver: ResizeObserver | null = null

  static create(canvas: HTMLCanvasElement, options: HelixOptions): HelixScene | null {
    const attributes: WebGLContextAttributes = { antialias: true, alpha: true, depth: true, premultipliedAlpha: true, preserveDrawingBuffer: false }
    const context = canvas.getContext('webgl2', attributes) ?? canvas.getContext('webgl', attributes)
    if (!context) return null
    try {
      return new HelixScene(canvas, context, options)
    } catch {
      return null
    }
  }

  private constructor(private readonly canvas: HTMLCanvasElement, context: GL, options: HelixOptions) {
    this.gl = context
    this.webgl2 = typeof WebGL2RenderingContext !== 'undefined' && context instanceof WebGL2RenderingContext
    this.reduced = options.reducedMotion
    this.stage = this.layoutStage()
    this.initGraphics()
    this.angle = -Math.PI / this.drum.columns
    canvas.style.touchAction = 'pan-y'
    canvas.style.cursor = 'grab'
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerEnd)
    canvas.addEventListener('pointercancel', this.onPointerEnd)
    canvas.addEventListener('webglcontextlost', this.onContextLost)
    canvas.addEventListener('webglcontextrestored', this.onContextRestored)
    if (typeof IntersectionObserver !== 'undefined') {
      this.intersection = new IntersectionObserver((entries) => {
        const last = entries[entries.length - 1]
        if (!last) return
        this.visible = last.isIntersecting
        if (this.visible) {
          this.lastFrame = null
          this.requestFrame()
        }
      })
      this.intersection.observe(canvas)
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize())
      this.resizeObserver.observe(canvas)
    }
    this.resize()
  }

  setSystems(systems: HelixSystem[]): void {
    if (this.disposed) return
    this.generation++
    const kept = new Map<string, SystemTexture>()
    this.systems.forEach((old, i) => {
      const texture = this.textures[i]
      if (texture && !kept.has(old.svg)) kept.set(old.svg, texture)
    })
    this.systems = systems.map((s) => ({ index: s.index, svg: s.svg, info: readSvgInfo(s.svg) }))
    const aspects = this.systems.map((s) => s.info.width / s.info.height)
    this.drum = layoutDrum(this.systems.length, aspects.length > 0 ? median(aspects) : 3)
    this.textures = this.systems.map((s) => {
      const texture = kept.get(s.svg) ?? null
      kept.delete(s.svg)
      return texture
    })
    if (!this.lost) for (const unused of kept.values()) this.gl.deleteTexture(unused.texture)
    this.queue = this.systems.flatMap((_, i) => (this.textures[i] ? [] : [i]))
    this.layoutStage()
    this.refreshStrips()
    this.pumpTextureQueue()
    this.requestFrame()
  }

  setPlayhead(position: { systemIndex: number; fraction: number } | null): void {
    this.playhead = position
    this.requestFrame()
  }

  setReducedMotion(reduced: boolean): void {
    if (this.reduced === reduced) return
    this.reduced = reduced
    if (reduced) this.finishMotionNow()
    this.lastFrame = null
    this.requestFrame()
  }

  peel(request: PeelRequest): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.settleTransition()
    this.lastRequest = request
    this.strips = this.reduced ? [] : this.buildStrips(request)
    this.refreshStrips()
    this.buildSheet(request)
    this.phase = 'peeling'
    return new Promise<void>((resolve) => {
      this.transition = { kind: 'peel', started: false, sheetStarted: false, resolve }
      this.requestFrame()
    })
  }

  unpeel(): Promise<void> {
    if (this.disposed || (this.phase === 'idle' && !this.transition)) return Promise.resolve()
    this.settleTransition()
    this.phase = 'unpeeling'
    return new Promise<void>((resolve) => {
      this.transition = { kind: 'unpeel', started: false, sheetStarted: false, resolve }
      this.requestFrame()
    })
  }

  /** Where the settled part page stands on screen, in CSS pixels relative to the canvas. */
  sheetRect(): { left: number; top: number; width: number; height: number } {
    const { projection, view, pageModel, pageWidth, pageHeight } = this.stage
    const clip = multiply(multiply(projection, view), pageModel)
    const xs: number[] = []
    const ys: number[] = []
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const px = (x * pageWidth) / 2
      const py = (y * pageHeight) / 2
      const w = (clip[3] ?? 0) * px + (clip[7] ?? 0) * py + (clip[15] ?? 1)
      xs.push((((clip[0] ?? 0) * px + (clip[4] ?? 0) * py + (clip[12] ?? 0)) / w * 0.5 + 0.5) * this.cssWidth)
      ys.push((0.5 - ((clip[1] ?? 0) * px + (clip[5] ?? 0) * py + (clip[13] ?? 0)) / w * 0.5) * this.cssHeight)
    }
    const left = Math.min(...xs)
    const top = Math.min(...ys)
    return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top }
  }

  resize(): void {
    if (this.disposed) return
    const width = Math.max(1, this.canvas.clientWidth)
    const height = Math.max(1, this.canvas.clientHeight)
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    const bufferWidth = Math.max(1, Math.round(width * ratio))
    const bufferHeight = Math.max(1, Math.round(height * ratio))
    if (this.canvas.width !== bufferWidth) this.canvas.width = bufferWidth
    if (this.canvas.height !== bufferHeight) this.canvas.height = bufferHeight
    this.cssWidth = width
    this.cssHeight = height
    this.layoutStage()
    this.requestFrame()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.frameHandle)
    const canvas = this.canvas
    canvas.removeEventListener('pointerdown', this.onPointerDown)
    canvas.removeEventListener('pointermove', this.onPointerMove)
    canvas.removeEventListener('pointerup', this.onPointerEnd)
    canvas.removeEventListener('pointercancel', this.onPointerEnd)
    canvas.removeEventListener('webglcontextlost', this.onContextLost)
    canvas.removeEventListener('webglcontextrestored', this.onContextRestored)
    this.intersection?.disconnect()
    this.resizeObserver?.disconnect()
    this.transition?.resolve()
    this.transition = null
    if (!this.lost) {
      this.freeSystemTextures()
      this.freeSheetTexture()
      const gl = this.gl
      gl.deleteTexture(this.paperTexture)
      gl.deleteBuffer(this.meshBuffer)
      gl.deleteBuffer(this.indexBuffer)
      gl.deleteProgram(this.program)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }

  // Graphics resources

  private initGraphics(): void {
    const gl = this.gl
    const sources = shaderSources(this.webgl2)
    const program = gl.createProgram()
    const vertex = this.compile(gl.VERTEX_SHADER, sources.vertex)
    const fragment = this.compile(gl.FRAGMENT_SHADER, sources.fragment)
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.bindAttribLocation(program, 0, 'aUV')
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link failed')
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    this.program = program
    for (const name of UNIFORM_NAMES) this.uniforms[name] = gl.getUniformLocation(program, name)

    const vertices = new Float32Array((SEGMENTS + 1) * 4)
    for (let i = 0; i <= SEGMENTS; i++) vertices.set([i / SEGMENTS, 0, i / SEGMENTS, 1], i * 4)
    const indices = new Uint16Array(SEGMENTS * 6)
    for (let i = 0; i < SEGMENTS; i++) {
      const top = i * 2
      indices.set([top, top + 1, top + 2, top + 2, top + 1, top + 3], i * 6)
    }
    this.indexCount = indices.length
    this.meshBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
    this.indexBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    const ext = gl.getExtension('EXT_texture_filter_anisotropic')
    this.anisotropy = ext
      ? { ext, max: Math.min(4, Number(gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) || 1) }
      : null
    this.paperTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.paperTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([246, 241, 231, 255]))
    this.setSampling(false)
    gl.useProgram(program)
    gl.uniform1i(this.uniforms.uTex, 0)
    gl.clearColor(0, 0, 0, 0)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.enable(gl.CULL_FACE)
    gl.cullFace(gl.BACK)
  }

  private compile(type: number, source: string): WebGLShader {
    const gl = this.gl
    const shader = gl.createShader(type)
    if (!shader) throw new Error('shader unavailable')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'compile failed')
    return shader
  }

  private setSampling(mipmapped: boolean): void {
    const gl = this.gl
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmapped ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
    if (mipmapped && this.anisotropy) gl.texParameterf(gl.TEXTURE_2D, this.anisotropy.ext.TEXTURE_MAX_ANISOTROPY_EXT, this.anisotropy.max)
  }

  private uploadCanvas(source: HTMLCanvasElement): SystemTexture | null {
    const gl = this.gl
    const texture = gl.createTexture()
    if (!texture) return null
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    if (this.webgl2) gl.generateMipmap(gl.TEXTURE_2D)
    this.setSampling(this.webgl2)
    return { texture, width: source.width, height: source.height }
  }

  private freeSystemTextures(): void {
    if (this.lost) {
      this.textures = []
      return
    }
    for (const entry of this.textures) if (entry) this.gl.deleteTexture(entry.texture)
    this.textures = []
  }

  private freeSheetTexture(): void {
    if (this.sheetTexture && !this.lost) this.gl.deleteTexture(this.sheetTexture)
    this.sheetTexture = null
  }

  // Textures from the server's SVG

  private pumpTextureQueue(): void {
    while (this.activeJobs < TEXTURE_JOBS_AT_ONCE && this.queue.length > 0) {
      const position = this.queue.shift()
      const system = position === undefined ? undefined : this.systems[position]
      if (position === undefined || !system) continue
      this.activeJobs++
      const generation = this.generation
      const pixelWidth = Math.min(this.systems.length <= 8 ? 1792 : 1408, MAX_TEXTURE_PIXELS)
      const aspect = system.info.width / system.info.height
      const width = aspect < 1 ? Math.round(pixelWidth * aspect) : pixelWidth
      const height = Math.max(1, Math.min(MAX_TEXTURE_PIXELS, Math.round(width / aspect)))
      void rasteriseSystem(system.svg, width, height)
        .then((canvas) => {
          if (generation !== this.generation || this.disposed || this.lost) return
          const uploaded = this.uploadCanvas(canvas)
          if (uploaded) this.textures[position] = uploaded
          this.requestFrame()
        })
        .catch(() => undefined)
        .finally(() => {
          this.activeJobs--
          this.pumpTextureQueue()
        })
    }
  }

  private buildSheet(request: PeelRequest): void {
    this.freeSheetTexture()
    const first = Math.min(...request.partSystems.map((s) => s.page))
    const onPage = request.partSystems.filter((s) => s.page === first).sort((a, b) => a.index - b.index)
    if (onPage.length === 0) {
      this.sheetState = 'failed'
      return
    }
    this.sheetState = 'pending'
    const sheetWidth = SHEET_PIXEL_WIDTH
    const sheetHeight = Math.round(sheetWidth / SHEET_ASPECT)
    const scale = sheetWidth / SHEET.width
    const pitch = this.pagePitch(onPage)
    const placements: SheetPlacement[] = onPage.map((system, k) => {
      const info = readSvgInfo(system.svg)
      const natural = SHEET.systemWidth * scale * (info.height / info.width)
      const fit = Math.min(1, (pitch * scale) / natural)
      return {
        svg: system.svg,
        x: SHEET.margin * scale,
        y: (SHEET.systemsTop + k * pitch) * scale,
        width: SHEET.systemWidth * scale * fit,
        height: natural * fit,
      }
    })
    void rasteriseSheet(sheetWidth, sheetHeight, placements)
      .then((canvas) => {
        if (this.lastRequest !== request || this.disposed || this.lost) return
        const uploaded = this.uploadCanvas(canvas)
        this.sheetTexture = uploaded?.texture ?? null
        this.sheetState = uploaded ? 'ready' : 'failed'
        this.requestFrame()
      })
      .catch(() => {
        if (this.lastRequest !== request) return
        this.sheetState = 'failed'
        this.requestFrame()
      })
  }

  private pagePitch(onPage: PeelRequest['partSystems']): number {
    const staffCount = Math.max(1, ...onPage.map((s) => readSvgInfo(s.svg).staves.length))
    return sheetPitch(onPage.length, staffCount)
  }

  // Strips: the staves lifted off the drum

  private buildStrips(request: PeelRequest): Strip[] {
    const strips: Strip[] = []
    this.systems.forEach((system, position) => {
      const { height, width } = system.info
      request.staffIds.forEach((staffId, order) => {
        const band = this.bandFor(system.info, staffId, order, request.staffIds.length)
        if (!band) return
        strips.push({
          systemPosition: position,
          staffOrder: order,
          bandTop: band.top / height,
          bandBottom: band.bottom / height,
          bandHeight: band.bottom - band.top,
          systemWidth: width,
          rest: { cx: 0, cy: 0, width: 0, height: 0 },
          stage: 'waiting',
          startAt: 0,
          lastUpdate: 0,
          spring: { x: 0, v: 0 },
          target: 1,
          origin: null,
        })
      })
    })
    return strips
  }

  /** The vertical extent of a staff's band in a system: out to halfway toward its neighbours, or equal shares as a fallback. */
  private bandFor(info: SvgInfo, staffId: string, order: number, requested: number): { top: number; bottom: number } | null {
    const staves = info.staves
    if (staves.length === 0) {
      const share = info.height / Math.max(1, requested)
      return { top: order * share, bottom: (order + 1) * share }
    }
    const k = staves.findIndex((s) => s.id === staffId)
    const staff = staves[k]
    if (!staff) return null
    const previous = staves[k - 1]
    const next = staves[k + 1]
    const bottom = staff.top + staff.height
    const above = previous ? (staff.top - (previous.top + previous.height)) / 2 : staff.height * 0.9
    const below = next ? (next.top - bottom) / 2 : staff.height * 0.9
    return { top: Math.max(0, staff.top - above), bottom: Math.min(info.height, bottom + below) }
  }

  private refreshStrips(): void {
    const sizes = this.strips.map((s) => ({ bandHeight: s.bandHeight, systemWidth: s.systemWidth }))
    const onPage = this.lastRequest ? this.firstPageSystems(this.lastRequest) : []
    const pitch = onPage.length > 0 ? this.pagePitch(onPage) : sheetPitch(0, 1)
    restRects(sizes, pitch).forEach((rect, i) => {
      const strip = this.strips[i]
      if (strip) strip.rest = rect
    })
  }

  private firstPageSystems(request: PeelRequest): PeelRequest['partSystems'] {
    if (request.partSystems.length === 0) return []
    const first = Math.min(...request.partSystems.map((s) => s.page))
    return request.partSystems.filter((s) => s.page === first)
  }

  // Frame loop

  private requestFrame(): void {
    this.quietFrames = 0
    this.scheduleFrame()
    this.present()
  }

  /**
   * Draws the current state at most once per browser frame. A drawing asked for again within the same frame waits
   * for a catch-up on the browser's own clock, so a burst of animation callbacks never queues more GPU work than
   * the screen can show, and the canvas always ends on the latest state.
   */
  private present(): void {
    if (this.disposed || this.lost || !this.visible) return
    const frame = Number(document.timeline.currentTime ?? 0)
    if (this.presentedAt !== frame) {
      this.presentedAt = frame
      this.presentPending = false
      this.render()
      return
    }
    this.presentPending = true
    if (this.catchUp) return
    const signal = AbortSignal.timeout(CATCH_UP_MS)
    this.catchUp = signal
    signal.addEventListener('abort', () => {
      this.catchUp = null
      if (!this.presentPending) return
      this.presentedAt = null
      this.present()
    }, { once: true })
  }

  private scheduleFrame(): void {
    if (this.disposed || this.lost || !this.visible || this.frameHandle !== 0) return
    this.frameHandle = requestAnimationFrame(this.onFrame)
  }

  private readonly onFrame = (timestamp: number): void => {
    this.frameHandle = 0
    if (this.disposed || this.lost || !this.visible) return
    const delta = this.lastFrame === null ? 0 : Math.min(MAX_FRAME_MS, Math.max(0, timestamp - this.lastFrame))
    this.lastFrame = timestamp
    this.clock += delta
    if (this.turning() && !this.dragging) this.angle -= (IDLE_RATE * delta) / 1000
    this.advanceMotion()
    this.present()
    if (this.needsFrames() || ++this.quietFrames <= SETTLE_FRAMES) this.scheduleFrame()
    else this.lastFrame = null
  }

  private needsFrames(): boolean {
    return this.turning() || this.transition !== null || this.strips.some((s) => s.stage !== 'rest')
  }

  /** The idle turn runs unless motion is reduced or a settled part page stands in front of the drum. */
  private turning(): boolean {
    return !this.reduced && this.phase !== 'peeled'
  }

  // Motion: the peel and unpeel timelines

  private advanceMotion(): void {
    const transition = this.transition
    if (!transition) return
    const now = this.clock
    if (!transition.started) this.beginTransition(transition)
    for (const strip of this.strips) this.advanceStrip(strip, now)
    const stripsRest = this.strips.every((s) => s.stage === 'rest')
    if (transition.kind === 'peel') {
      if (!transition.sheetStarted && stripsRest && this.focus.settled(now) && this.sheetState !== 'pending') {
        transition.sheetStarted = true
        if (this.reduced) this.focus.retarget(now, 1, CROSSFADE_MS)
        if (this.sheetState === 'ready') this.sheetAlpha.retarget(now, 1, this.reduced ? CROSSFADE_MS : SHEET_FADE_MS)
      }
      if (transition.sheetStarted && this.sheetAlpha.settled(now) && this.focus.settled(now)) {
        this.phase = 'peeled'
        this.finishTransition()
      }
      return
    }
    if (stripsRest && this.focus.settled(now) && this.backing.settled(now) && this.sheetAlpha.settled(now)) {
      this.phase = 'idle'
      this.strips = []
      this.sheetState = 'none'
      this.freeSheetTexture()
      this.finishTransition()
    }
  }

  private beginTransition(transition: Transition): void {
    const now = this.clock
    transition.started = true
    if (transition.kind === 'peel') {
      if (!this.reduced) {
        this.focus.retarget(now, 1, FOCUS_MS)
        this.backing.retarget(now, 1, FOCUS_MS, 120)
      }
      this.strips.forEach((strip) => {
        strip.stage = 'waiting'
        strip.target = 1
        strip.startAt = now + strip.staffOrder * STRIP_STAGGER_MS
        strip.lastUpdate = strip.startAt
      })
      return
    }
    if (this.reduced) {
      this.focus.retarget(now, 0, CROSSFADE_MS)
      this.sheetAlpha.retarget(now, 0, CROSSFADE_MS)
      this.backing.jump(0)
      return
    }
    this.sheetAlpha.retarget(now, 0, SHEET_FADE_MS)
    this.focus.retarget(now, 0, FOCUS_MS, UNPEEL_LEAD_MS)
    this.backing.retarget(now, 0, FOCUS_MS, UNPEEL_LEAD_MS)
    const leaving = this.strips.filter((s) => s.spring.x > 0)
    const last = Math.max(0, ...leaving.map((s) => s.staffOrder))
    leaving.forEach((strip) => {
      strip.stage = 'waiting'
      strip.target = 0
      strip.spring.v = 0
      strip.startAt = now + UNPEEL_LEAD_MS + (last - strip.staffOrder) * STRIP_STAGGER_MS
      strip.lastUpdate = strip.startAt
    })
    for (const strip of this.strips) if (strip.spring.x <= 0) strip.stage = 'rest'
  }

  private advanceStrip(strip: Strip, now: number): void {
    if (strip.stage === 'rest') return
    if (strip.stage === 'waiting') {
      if (now < strip.startAt) return
      strip.stage = 'moving'
      if (strip.origin === null) strip.origin = this.originFor(strip)
    }
    const seconds = Math.max(0, now - strip.lastUpdate) / 1000
    strip.lastUpdate = now
    stepCriticallyDamped(strip.spring, strip.target, SPRING_OMEGA, seconds)
    if (Math.abs(strip.spring.x - strip.target) < SPRING_SNAP && Math.abs(strip.spring.v) < 0.05) {
      strip.spring.x = strip.target
      strip.spring.v = 0
      strip.stage = 'rest'
    }
  }

  private originFor(strip: Strip): { yaw: number; drumAngle: number } {
    const cell = this.drum.cells[strip.systemPosition]
    return { yaw: wrapAngle(this.angle + (cell?.yaw ?? 0)), drumAngle: this.angle }
  }

  private finishTransition(): void {
    const transition = this.transition
    this.transition = null
    transition?.resolve()
  }

  /** Ends a transition in progress without finishing its animation; the next one starts from where the scene is. */
  private settleTransition(): void {
    const transition = this.transition
    if (!transition) return
    this.transition = null
    transition.resolve()
  }

  private finishMotionNow(): void {
    for (const strip of this.strips) {
      strip.spring.x = strip.target
      strip.spring.v = 0
      strip.stage = 'rest'
    }
    this.focus.jump(this.focus.target)
    this.backing.jump(this.backing.target)
    this.sheetAlpha.jump(this.sheetAlpha.target)
  }

  // Stage geometry

  private layoutStage(): Stage {
    const aspect = this.cssWidth / this.cssHeight
    const tanHalf = Math.tan(FOV / 2)
    const fill = 0.86
    const fromHeight = DRUM_RADIUS + (this.drum.height * Math.cos(CAMERA_PITCH) + DRUM_RADIUS * Math.sin(CAMERA_PITCH)) / (fill * 2 * tanHalf)
    const fromWidth = DRUM_RADIUS + (2 * DRUM_RADIUS * 1.1) / (fill * aspect * 2 * tanHalf)
    const distance = Math.max(fromHeight, fromWidth)
    const eye: Vec3 = [0, distance * Math.sin(CAMERA_PITCH), distance * Math.cos(CAMERA_PITCH)]
    const standoff = DRUM_RADIUS + 0.9
    const split = smoothstep(0.75, 1.25, aspect)
    const visibleAtPage = 2 * (distance - standoff) * tanHalf
    const pageHeight = Math.min(mix(0.74, 0.82, split) * visibleAtPage, (0.9 * aspect * visibleAtPage) / SHEET_ASPECT)
    const pagePosition: Vec3 = [
      split * 0.17 * visibleAtPage * aspect,
      standoff * Math.sin(CAMERA_PITCH),
      standoff * Math.cos(CAMERA_PITCH),
    ]
    const visibleAtDrum = 2 * (distance - DRUM_RADIUS) * tanHalf
    const pixelsPerUnit = this.cssHeight / visibleAtDrum
    this.stage = {
      view: lookAt(eye, [0, 0, 0]),
      projection: perspective(FOV, aspect, 0.1, 60),
      eye,
      pageModel: pose(pagePosition, -CAMERA_PITCH, 0),
      pageWidth: pageHeight * SHEET_ASPECT,
      pageHeight,
      pageUnit: pageHeight / SHEET.height,
      recede: [-split * 0.34 * visibleAtDrum * aspect, 0, -1.4],
      radiansPerPixel: 1 / (DRUM_RADIUS * pixelsPerUnit),
    }
    return this.stage
  }

  // Rendering

  private render(): void {
    const gl = this.gl
    const u = this.uniforms
    const { width, height } = this.canvas
    if (width < 1 || height < 1 || !this.program) return
    const now = this.clock
    const focus = this.focus.at(now)
    const dim = 1 - (1 - DIM_FLOOR) * focus
    const stage = this.stage
    const travel = this.reduced ? 0 : focus
    const drumModel = multiply(
      translation(stage.recede[0] * travel, stage.recede[1] * travel, stage.recede[2] * travel),
      rotationY(this.angle),
    )

    gl.viewport(0, 0, width, height)
    gl.depthMask(true)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.uniformMatrix4fv(u.uProj, false, stage.projection)
    gl.uniformMatrix4fv(u.uView, false, stage.view)
    gl.uniform3f(u.uEye, stage.eye[0], stage.eye[1], stage.eye[2])
    gl.activeTexture(gl.TEXTURE0)

    this.drawDrum(drumModel, focus, dim)
    this.drawPlayhead(dim)
    if (this.phase !== 'idle' || this.backing.at(now) > 0 || this.sheetAlpha.at(now) > 0) this.drawOverlay(now)
  }

  private drawDrum(model: Mat4, blur: number, opacity: number): void {
    const gl = this.gl
    const u = this.uniforms
    const drum = this.drum
    gl.uniformMatrix4fv(u.uModel, false, model)
    gl.uniform1i(u.uMode, 0)
    gl.uniform1f(u.uCurv, 1 / DRUM_RADIUS)
    gl.uniform2f(u.uSize, drum.cellWidth, drum.cellHeight)
    gl.uniform4f(u.uRect, 0, 0, 1, 1)
    gl.uniform1f(u.uBlur, blur)
    gl.uniform1f(u.uOpacity, opacity)
    gl.uniform1f(u.uLit, 1)
    gl.uniform3f(u.uTint, PAPER[0], PAPER[1], PAPER[2])
    drum.cells.forEach((cell, i) => {
      const texture = this.textures[i] ?? null
      gl.bindTexture(gl.TEXTURE_2D, texture ? texture.texture : this.paperTexture)
      gl.uniform2f(u.uTexel, 1 / (texture?.width ?? 1), 1 / (texture?.height ?? 1))
      gl.uniform3f(u.uOffset, 0, cell.top - drum.cellHeight / 2, DRUM_RADIUS)
      gl.uniform1f(u.uYaw, cell.yaw)
      this.drawMesh()
    })

    gl.disable(gl.CULL_FACE)
    gl.uniform1i(u.uMode, 3)
    gl.uniform2f(u.uCap, DRUM_RADIUS, drum.height / 2)
    gl.uniform1f(u.uOpacity, opacity)
    this.drawMesh()
    gl.enable(gl.CULL_FACE)
  }

  private drawPlayhead(opacity: number): void {
    const playhead = this.playhead
    if (!playhead) return
    const drum = this.drum
    let position = this.systems.findIndex((s) => s.index === playhead.systemIndex)
    if (position < 0) position = playhead.systemIndex
    const cell = drum.cells[position]
    if (!cell) return
    const gl = this.gl
    const u = this.uniforms
    const radius = DRUM_RADIUS * 1.004
    const arc = drum.cellWidth / DRUM_RADIUS
    const fraction = Math.min(1, Math.max(0, playhead.fraction))
    gl.depthMask(false)
    gl.uniform1i(u.uMode, 1)
    gl.uniform2f(u.uSize, drum.cellWidth * RIBBON_WIDTH_FRACTION * 2.2, drum.cellHeight)
    gl.uniform1f(u.uCurv, 1 / radius)
    gl.uniform3f(u.uOffset, 0, cell.top - drum.cellHeight / 2, radius)
    gl.uniform1f(u.uYaw, cell.yaw - arc / 2 + fraction * arc)
    gl.uniform1f(u.uOpacity, opacity)
    gl.uniform3f(u.uTint, VERMILION[0], VERMILION[1], VERMILION[2])
    this.drawMesh()
    gl.depthMask(true)
  }

  private drawOverlay(now: number): void {
    const gl = this.gl
    const u = this.uniforms
    const stage = this.stage
    const backing = this.backing.at(now)
    const sheet = this.sheetAlpha.at(now)
    const pageWidth = stage.pageWidth
    const pageHeight = stage.pageHeight

    gl.depthMask(false)
    gl.uniformMatrix4fv(u.uModel, false, stage.pageModel)
    gl.uniform1f(u.uCurv, 0)
    gl.uniform4f(u.uRect, 0, 0, 1, 1)
    gl.uniform1f(u.uBlur, 0)
    gl.uniform1f(u.uLit, 0)
    gl.uniform2f(u.uTexel, 1, 1)
    gl.bindTexture(gl.TEXTURE_2D, this.paperTexture)

    gl.uniform1i(u.uMode, 2)
    gl.uniform2f(u.uSize, pageWidth * 1.14, pageHeight * 1.09)
    gl.uniform3f(u.uOffset, 0, -pageHeight * 0.025, -0.03)
    gl.uniform1f(u.uYaw, 0)
    gl.uniform1f(u.uOpacity, backing * 0.6)
    gl.uniform3f(u.uTint, SHADOW[0], SHADOW[1], SHADOW[2])
    this.drawMesh()

    gl.uniform1i(u.uMode, 0)
    gl.uniform2f(u.uSize, pageWidth, pageHeight)
    gl.uniform3f(u.uOffset, 0, 0, 0)
    gl.uniform1f(u.uOpacity, backing)
    this.drawMesh()

    gl.uniform3f(u.uOffset, 0, 0, 0)
    gl.uniform1f(u.uYaw, 0)
    gl.uniform1i(u.uMode, 0)
    for (const strip of this.strips) this.drawStrip(strip)

    gl.uniformMatrix4fv(u.uModel, false, stage.pageModel)
    gl.uniform2f(u.uSize, pageWidth, pageHeight)
    gl.uniform3f(u.uOffset, 0, 0, 0)
    gl.uniform1f(u.uCurv, 0)
    gl.uniform1f(u.uYaw, 0)
    gl.uniform4f(u.uRect, 0, 0, 1, 1)
    gl.uniform1f(u.uBlur, 0)
    gl.uniform1f(u.uLit, 0)
    gl.uniform1i(u.uMode, 0)
    gl.uniform1f(u.uOpacity, sheet)
    gl.uniform2f(u.uTexel, 1, 1)
    gl.bindTexture(gl.TEXTURE_2D, this.sheetTexture ?? this.paperTexture)
    if (sheet > 0) this.drawMesh()
    gl.depthMask(true)
  }

  private drawStrip(strip: Strip): void {
    const gl = this.gl
    const u = this.uniforms
    const placed = this.stripPose(strip)
    gl.uniformMatrix4fv(u.uModel, false, placed.model)
    if (placed.progress <= 0) return
    const texture = this.textures[strip.systemPosition] ?? null
    gl.bindTexture(gl.TEXTURE_2D, texture ? texture.texture : this.paperTexture)
    gl.uniform2f(u.uSize, placed.width, placed.height)
    gl.uniform1f(u.uCurv, placed.curvature)
    gl.uniform4f(u.uRect, 0, strip.bandTop, 1, strip.bandBottom)
    gl.uniform1f(u.uLit, 1 - placed.progress)
    gl.uniform1f(u.uOpacity, smoothstep(0, 0.05, placed.progress))
    gl.uniform2f(u.uTexel, 1 / (texture?.width ?? 1), 1 / (texture?.height ?? 1))
    this.drawMesh()
  }

  /** Where a strip is: on the drum at progress 0, on the page at progress 1, swinging round the drum's side between. */
  private stripPose(strip: Strip): StripPose {
    const stage = this.stage
    const drum = this.drum
    const progress = Math.min(1, Math.max(0, strip.spring.x))
    const cell = drum.cells[strip.systemPosition]
    const origin = strip.origin
    const skin = DRUM_RADIUS * STRIP_SKIN
    const bandMid = (strip.bandTop + strip.bandBottom) / 2
    const centreY = (cell?.top ?? 0) - bandMid * drum.cellHeight
    const startYaw = origin ? origin.yaw + (this.angle - origin.drumAngle) : wrapAngle(this.angle + (cell?.yaw ?? 0))
    const yaw = startYaw * (1 - progress)
    const radius = skin + STRIP_LIFT * Math.sin(Math.PI * progress)
    const travel = this.reduced ? 0 : this.focus.at(this.clock)
    const drumShift: Vec3 = [stage.recede[0] * travel, stage.recede[1] * travel, stage.recede[2] * travel]
    const unit = stage.pageUnit
    const rest = transformPoint(stage.pageModel, strip.rest.cx * unit, strip.rest.cy * unit, 0.004)
    const position: Vec3 = [
      mix(drumShift[0] + radius * Math.sin(yaw), rest[0], progress),
      mix(drumShift[1] + centreY, rest[1], progress),
      mix(drumShift[2] + radius * Math.cos(yaw), rest[2], progress),
    ]
    const flat = 1 - progress
    return {
      model: pose(position, -CAMERA_PITCH * progress, yaw),
      width: mix(drum.cellWidth, strip.rest.width * unit, progress),
      height: mix((strip.bandBottom - strip.bandTop) * drum.cellHeight, strip.rest.height * unit, progress),
      curvature: (1 / skin) * flat * flat,
      progress,
    }
  }

  private drawMesh(): void {
    this.gl.drawElements(this.gl.TRIANGLES, this.indexCount, this.gl.UNSIGNED_SHORT, 0)
  }

  // Input

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    this.dragging = true
    this.lastPointerX = event.clientX
    this.canvas.style.cursor = 'grabbing'
    try {
      this.canvas.setPointerCapture(event.pointerId)
    } catch {
      this.dragging = true
    }
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return
    const dx = event.clientX - this.lastPointerX
    this.lastPointerX = event.clientX
    this.angle += dx * this.stage.radiansPerPixel
    this.requestFrame()
  }

  private readonly onPointerEnd = (event: PointerEvent): void => {
    if (!this.dragging) return
    this.dragging = false
    this.canvas.style.cursor = 'grab'
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId)
    this.lastFrame = null
    this.requestFrame()
  }

  // Context loss

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault()
    this.lost = true
    cancelAnimationFrame(this.frameHandle)
    this.frameHandle = 0
    this.textures = []
    this.sheetTexture = null
    this.queue = []
  }

  private readonly onContextRestored = (): void => {
    if (this.disposed) return
    try {
      this.initGraphics()
    } catch {
      return
    }
    this.lost = false
    this.generation++
    this.textures = this.systems.map(() => null)
    this.queue = this.systems.map((_, i) => i)
    this.pumpTextureQueue()
    if (this.lastRequest && this.sheetState !== 'none') this.buildSheet(this.lastRequest)
    this.lastFrame = null
    this.requestFrame()
  }
}
