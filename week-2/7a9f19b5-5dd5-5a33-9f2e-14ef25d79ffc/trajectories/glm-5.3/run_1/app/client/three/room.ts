/**
 * Light-pool room: 3D room with ceiling grid and floor pools, or a
 * top-down plan drawing without WebGL. Drawn on a single canvas.
 */
import { has_webgl } from './shapes.js'
import { cct_tint, reduced_motion } from '../lib/domain.js'
import type { PlacementPublic } from '../lib/api.js'

export interface RoomOptions {
  width_mm: number
  depth_mm: number
  ceiling_mm: number
  placements: PlacementPublic[]
}

export class RoomView {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private phase: 'cone' | 'pool' | 'tint' | 'count' | 'settled' = 'settled'
  private phase_started = 0
  private animating_placement: number | null = null
  private raf = 0
  private options: RoomOptions
  private progress = 1

  constructor(canvas: HTMLCanvasElement, options: RoomOptions) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.options = options
    void has_webgl()
    this.loop()
  }

  update(options: RoomOptions): void {
    this.options = options
    this.draw()
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
  }

  /** Play the placement sequence: cone, pool, tint, count, then settled. */
  play_placement(placement_id: number): void {
    this.animating_placement = placement_id
    this.phase = 'cone'
    this.phase_started = performance.now()
    this.progress = 0
    this.tick()
  }

  play_removal(placement_id: number): void {
    void placement_id
    this.progress = 0
    this.phase = 'cone'
    this.phase_started = performance.now()
  }

  private tick(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    const step = () => {
      const elapsed = performance.now() - this.phase_started
      const reduced = reduced_motion()
      if (reduced) {
        this.phase = 'settled'
        this.progress = 1
        this.draw()
        return
      }
      if (this.phase === 'cone') {
        this.progress = Math.min(1, elapsed / 320)
        if (this.progress >= 1) {
          this.phase = 'pool'
          this.phase_started = performance.now()
        }
      } else if (this.phase === 'pool') {
        this.progress = Math.min(1, elapsed / 400)
        if (this.progress >= 1) {
          this.phase = 'tint'
          this.phase_started = performance.now()
        }
      } else if (this.phase === 'tint') {
        this.progress = Math.min(1, elapsed / 330)
        if (this.progress >= 1) {
          this.phase = 'count'
          this.phase_started = performance.now()
        }
      } else if (this.phase === 'count') {
        this.progress = Math.min(1, elapsed / 400)
        if (this.progress >= 1) {
          this.phase = 'settled'
          this.progress = 1
          this.animating_placement = null
          this.draw()
          return
        }
      }
      this.draw()
      this.raf = requestAnimationFrame(step)
    }
    this.raf = requestAnimationFrame(step)
  }

  private loop(): void {
    this.draw()
  }

  /** The pixel geometry: room drawn in plan view, origin back-left. */
  private geometry(): { x: (mm: number) => number; y: (mm: number) => number; pad: number; w: number; h: number } {
    const w = this.canvas.clientWidth || 800
    const h = this.canvas.clientHeight || 500
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    const pad = 30
    const x = (mm: number) => pad + (mm / this.options.width_mm) * (w - pad * 2)
    const y = (mm: number) => pad + (mm / this.options.depth_mm) * (h - pad * 2)
    return { x, y, pad, w, h }
  }

  draw(): void {
    const ctx = this.ctx
    const { x, y, pad, w, h } = this.geometry()
    const root = getComputedStyle(document.documentElement)
    const ground = root.getPropertyValue('--ground').trim() || '#0b0d12'
    const text = root.getPropertyValue('--text').trim() || '#f4efe7'
    const hairline = root.getPropertyValue('--hairline').trim() || 'rgba(125,133,148,0.35)'
    ctx.fillStyle = ground
    ctx.fillRect(0, 0, w, h)
    // room outline
    ctx.strokeStyle = hairline
    ctx.lineWidth = 1
    ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2)
    // ceiling grid every 1000mm
    ctx.strokeStyle = hairline.replace(/[\d.]+\)$/, '0.18)')
    for (let gx = 1000; gx < this.options.width_mm; gx += 1000) {
      ctx.beginPath()
      ctx.moveTo(x(gx), pad)
      ctx.lineTo(x(gx), h - pad)
      ctx.stroke()
    }
    for (let gy = 1000; gy < this.options.depth_mm; gy += 1000) {
      ctx.beginPath()
      ctx.moveTo(pad, y(gy))
      ctx.lineTo(w - pad, y(gy))
      ctx.stroke()
    }
    // pools first, then cones, then fittings
    for (const p of this.options.placements) {
      const animating = p.id === this.animating_placement
      let pool_scale = 1
      if (animating) {
        if (this.phase === 'cone') pool_scale = 0
        else if (this.phase === 'pool' || this.phase === 'tint') pool_scale = this.progress
        else if (this.phase === 'count') pool_scale = 1
      }
      const radius_mm = (p.pool_diameter_mm / 2) * pool_scale
      if (radius_mm > 0) {
        ctx.fillStyle = cct_tint(p.cct_k)
        ctx.beginPath()
        ctx.arc(x(p.x_mm), y(p.y_mm), Math.max(1, radius_mm / this.options.width_mm * (w - pad * 2)), 0, Math.PI * 2)
        ctx.fill()
      }
      // cone marker: a soft vertical streak toward the viewer
      if (animating && this.phase === 'cone') {
        ctx.strokeStyle = cct_tint(p.cct_k)
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(x(p.x_mm), y(p.y_mm), 3 + 20 * this.progress, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
    for (const p of this.options.placements) {
      ctx.fillStyle = text
      ctx.beginPath()
      ctx.arc(x(p.x_mm), y(p.y_mm), 4, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.strokeStyle = text
    ctx.lineWidth = 1
    ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2)
    ctx.font = '11px JetBrains Mono, monospace'
    ctx.fillStyle = text
    ctx.fillText('0, 0', pad, pad - 8)
    ctx.fillText(`${this.options.width_mm}, ${this.options.depth_mm}`, w - pad - 90, h - pad + 16)
  }

  data_phase(): string {
    return this.phase
  }
}
