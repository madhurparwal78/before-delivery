import { DURATION, MAX_ZOOM, MIN_ZOOM } from './constants'
import { Step } from './easing'

// Camera state shared by the WebGL stage and the SVG schematic: heading, zoom and pan (world millimetres,
// relative to the layout centre). Discrete moves (dial, Q, E, Reset view) ease over 400 ms on the
// requestAnimationFrame clock; gestures, wheel and keyboard pan cut straight to the new value.

interface Tween {
  step: Step
  heading: [number, number]
  zoom: [number, number]
  pan: [[number, number], [number, number]]
}

export class ViewState {
  heading = 0
  zoom = 1
  panX = 0
  panY = 0
  reduced = false
  private tween: Tween | null = null

  get animating(): boolean {
    return this.tween !== null
  }

  private ease(heading: number, zoom: number, panX: number, panY: number): void {
    if (this.reduced) {
      this.tween = null
      this.heading = heading
      this.zoom = zoom
      this.panX = panX
      this.panY = panY
      return
    }
    this.tween = {
      step: new Step(DURATION.camera),
      heading: [this.heading, heading],
      zoom: [this.zoom, zoom],
      pan: [[this.panX, this.panY], [panX, panY]],
    }
  }

  private headingTarget(): number {
    return this.tween === null ? this.heading : this.tween.heading[1]
  }

  turnHeading(deltaDeg: number): void {
    const zoom = this.tween === null ? this.zoom : this.tween.zoom[1]
    const [panX, panY] = this.tween === null ? [this.panX, this.panY] : this.tween.pan[1]
    this.ease(this.headingTarget() + deltaDeg, zoom, panX, panY)
  }

  setHeading(deg: number): void {
    this.tween = null
    this.heading = deg
  }

  // Gestures, wheel and keyboard pan adjust the move already under way instead of cancelling it.
  rotateBy(deltaDeg: number): void {
    this.heading += deltaDeg
    if (this.tween !== null) this.tween.heading = [this.tween.heading[0] + deltaDeg, this.tween.heading[1] + deltaDeg]
  }

  zoomBy(factor: number): void {
    const clamp = (zoom: number): number => Math.min(Math.max(zoom * factor, MIN_ZOOM), MAX_ZOOM)
    this.zoom = clamp(this.zoom)
    if (this.tween !== null) this.tween.zoom = [clamp(this.tween.zoom[0]), clamp(this.tween.zoom[1])]
  }

  panWorld(dxMm: number, dyMm: number): void {
    this.panX += dxMm
    this.panY += dyMm
    if (this.tween !== null) {
      const [from, to] = this.tween.pan
      this.tween.pan = [[from[0] + dxMm, from[1] + dyMm], [to[0] + dxMm, to[1] + dyMm]]
    }
  }

  easePanToward(xMm: number, yMm: number, fraction: number): void {
    const toX = this.panX + (xMm - this.panX) * fraction
    const toY = this.panY + (yMm - this.panY) * fraction
    this.ease(this.headingTarget(), this.tween === null ? this.zoom : this.tween.zoom[1], toX, toY)
  }

  reset(): void {
    const turns = Math.round(this.headingTarget() / 360)
    this.ease(turns * 360, 1, 0, 0)
  }

  // Advances the tween to `now`; returns true when anything changed.
  step(now: number): boolean {
    const tween = this.tween
    if (tween === null) return false
    const t = tween.step.eased(now)
    const mix = (pair: [number, number]): number => pair[0] + (pair[1] - pair[0]) * t
    this.heading = mix(tween.heading)
    this.zoom = mix(tween.zoom)
    this.panX = mix([tween.pan[0][0], tween.pan[1][0]])
    this.panY = mix([tween.pan[0][1], tween.pan[1][1]])
    if (tween.step.done(now)) this.tween = null
    return true
  }

  // Ground-plane movement for a drag of (dx, dy) screen pixels, where one pixel spans `perPixelMm` across the
  // screen and `perPixelDepthMm` up the screen.
  panScreen(dxPx: number, dyPx: number, perPixelMm: number, perPixelDepthMm: number): void {
    const h = (this.heading * Math.PI) / 180
    const rightX = Math.cos(h)
    const rightY = -Math.sin(h)
    const forwardX = Math.sin(h)
    const forwardY = Math.cos(h)
    this.panWorld(-dxPx * perPixelMm * rightX + dyPx * perPixelDepthMm * forwardX, -dxPx * perPixelMm * rightY + dyPx * perPixelDepthMm * forwardY)
  }

  reportedHeading(): number {
    return Math.round((((this.heading % 360) + 360) % 360) * 100) / 100
  }
}
