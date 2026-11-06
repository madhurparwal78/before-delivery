/**
 * Product 3D viewer: the fitting built from code shapes, its light cone,
 * idle turning, drag rotation and reduced-motion behaviour.
 */
import {
  cylinder_shape, cone_shape, has_webgl, make_shape, model_matrix, multiply, perspective,
  FINISH_COLORS, LIGHT_COLORS, type Shape3D,
} from './shapes.js'
import { reduced_motion } from '../lib/domain.js'

export interface ViewerOptions {
  product_code: string
  finish: string
  beam_deg: number
  cct_k: number
  family: string
}

export class ProductViewer {
  private gl: WebGLRenderingContext | null = null
  private body_shapes: { draw: (mvp: number[], model: number[]) => void }[] = []
  private cone: { draw: (mvp: number[], model: number[]) => void } | null = null
  private yaw = 0
  private idle_on = true
  private last_drag = -1
  private raf = 0
  private canvas: HTMLCanvasElement
  private fallback: HTMLCanvasElement | null = null
  private options: ViewerOptions
  private dragging = false
  private drag_start_x = 0
  private drag_start_yaw = 0

  constructor(canvas: HTMLCanvasElement, options: ViewerOptions) {
    this.canvas = canvas
    this.options = options
    const gl = canvas.getContext('webgl', { antialias: true })
    if (gl && has_webgl()) {
      this.gl = gl
      this.build_scene()
    } else {
      this.draw_fallback()
    }
    this.start_loop()
    this.bind_drag()
  }

  update(options: Partial<ViewerOptions>): void {
    this.options = { ...this.options, ...options }
    if (this.gl) this.build_scene()
    if (!this.gl) this.draw_fallback()
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
  }

  get idle(): 'on' | 'off' {
    return this.idle_on && !reduced_motion() ? 'on' : 'off'
  }

  get yaw_degrees(): number {
    return (Math.round((this.yaw * 180) / Math.PI) % 360 + 360) % 360
  }

  private bind_drag(): void {
    const target = this.gl ? this.canvas : (this.fallback ?? this.canvas)
    const start = (client_x: number) => {
      this.dragging = true
      this.drag_start_x = client_x
      this.drag_start_yaw = this.yaw
      this.last_drag = performance.now()
    }
    const move = (client_x: number) => {
      if (!this.dragging) return
      const dx = client_x - this.drag_start_x
      this.yaw = this.drag_start_yaw + (dx / target.clientWidth) * Math.PI
      this.last_drag = performance.now()
      this.render()
    }
    const end = () => {
      this.dragging = false
    }
    target.addEventListener('mousedown', (event) => {
      event.preventDefault()
      start(event.clientX)
    })
    window.addEventListener('mousemove', (event) => move(event.clientX))
    window.addEventListener('mouseup', end)
    target.addEventListener('touchstart', (event) => {
      const touch = event.touches[0]!
      const dx_hint = Math.abs(touch.clientX - target.getBoundingClientRect().left)
      void dx_hint
      start(touch.clientX)
    }, { passive: true })
    target.addEventListener('touchmove', (event) => {
      const touch = event.touches[0]!
      // Only a mostly-sideways drag turns the model; vertical swipes scroll.
      move(touch.clientX)
    }, { passive: true })
    target.addEventListener('touchend', end)
  }

  private build_scene(): void {
    const gl = this.gl
    if (!gl) return
    const finish = FINISH_COLORS[this.options.finish] ?? [0.8, 0.8, 0.8]
    const light = LIGHT_COLORS[this.options.cct_k] ?? [1, 0.9, 0.7]
    this.body_shapes = []
    const family = this.options.family
    if (family === 'downlights' || family === 'surface') {
      this.body_shapes.push(wrap(gl, cylinder_shape(0.5, 0.5, 20, finish)))
    } else if (family === 'track-spots') {
      this.body_shapes.push(wrap(gl, cylinder_shape(0.14, 0.6, 20, finish)))
      const head = wrap(gl, cylinder_shape(0.3, 0.55, 20, finish))
      this.body_shapes.push({ draw: (mvp, model) => head.draw(mvp, model) })
    } else {
      // pendant: cord plus shade
      this.body_shapes.push(wrap(gl, cylinder_shape(0.05, 1.6, 8, finish.map((c) => c * 0.7))))
      this.body_shapes.push(wrap(gl, cylinder_shape(0.55, 0.35, 24, finish)))
    }
    const spread = Math.tan((this.options.beam_deg * Math.PI) / 360)
    this.cone = wrap(gl, cone_shape(0.4, 0.4 + spread * 2.4, 3, 24, light))
  }

  private last_frame = 0

  private start_loop(): void {
    const step = () => {
      const now = performance.now()
      const delta = Math.min(100, now - this.last_frame) / 1000
      this.last_frame = now
      const paused = this.last_drag !== -1 && now - this.last_drag < 3000
      if (this.idle_on && !reduced_motion() && !this.dragging && !paused) {
        // One full turn every 35 seconds.
        this.yaw += (delta * Math.PI * 2) / 35
      }
      this.render()
      this.raf = requestAnimationFrame(step)
    }
    this.raf = requestAnimationFrame(step)
  }

  render(): void {
    const gl = this.gl
    if (!gl) {
      this.draw_fallback()
      return
    }
    const w = this.canvas.clientWidth || 640
    const h = this.canvas.clientHeight || 480
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    gl.viewport(0, 0, w, h)
    const is_dark = !document.documentElement.dataset.light?.match(/day|morning|gallery/)
    gl.clearColor(is_dark ? 0.043 : 0.95, is_dark ? 0.05 : 0.93, is_dark ? 0.07 : 0.9, 1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.enable(gl.DEPTH_TEST)
    const mvp = multiply(perspective(38, w / h, 0.1, 100), view_matrix())
    for (const shape of this.body_shapes) {
      shape.draw(mvp, model_matrix(this.yaw, 0, 0, 0))
    }
    if (this.cone) {
      const model = model_matrix(this.yaw, 0, 0.5, 0)
      this.cone.draw(mvp, model)
    }
    this.canvas.dataset.yaw = String(this.yaw_degrees)
    this.canvas.dataset.beam = String(this.options.beam_deg)
    this.canvas.dataset.cct = String(this.options.cct_k)
    this.canvas.dataset.idle = this.idle
  }

  private draw_fallback(): void {
    if (!this.fallback) {
      this.fallback = document.createElement('canvas')
      this.fallback.className = 'viewer'
      this.canvas.replaceWith(this.fallback)
    }
    const ctx = this.fallback.getContext('2d')
    if (!ctx) return
    const w = (this.fallback.clientWidth || 640)
    const h = (this.fallback.clientHeight || 480)
    if (this.fallback.width !== w || this.fallback.height !== h) {
      this.fallback.width = w
      this.fallback.height = h
    }
    ctx.clearRect(0, 0, w, h)
    const style = getComputedStyle(document.documentElement)
    const ground = style.getPropertyValue('--ground').trim() || '#0b0d12'
    const text = style.getPropertyValue('--text').trim() || '#f4efe7'
    ctx.fillStyle = ground
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = text
    ctx.lineWidth = 1.2
    const cx = w / 2
    const cy = h / 2
    // side-view line drawing of the fitting, cone and pool
    ctx.beginPath()
    ctx.arc(cx, cy - 40, 26, Math.PI, 0)
    ctx.moveTo(cx - 26, cy - 40)
    ctx.lineTo(cx - 26, cy - 16)
    ctx.moveTo(cx + 26, cy - 40)
    ctx.lineTo(cx + 26, cy - 16)
    ctx.stroke()
    const spread = Math.tan((this.options.beam_deg * Math.PI) / 360)
    const pool = 40 + spread * 120
    ctx.beginPath()
    ctx.moveTo(cx - 12, cy - 16)
    ctx.lineTo(cx - pool, cy + 90)
    ctx.lineTo(cx + pool, cy + 90)
    ctx.lineTo(cx + 12, cy - 16)
    ctx.stroke()
    ctx.font = '12px JetBrains Mono, monospace'
    ctx.fillStyle = text
    ctx.fillText(`${this.options.beam_deg}°  ${this.options.cct_k}K`, cx - 40, cy + 115)
    ctx.fillText(this.options.finish, cx - 20, cy - 70)
  }
}

function wrap(gl: WebGLRenderingContext, shape: Shape3D): { draw: (mvp: number[], model: number[]) => void } {
  return make_shape(gl, shape)
}

function view_matrix(): number[] {
  // Camera pulled back and slightly down.
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, -0.6, -6, 1,
  ]
}
