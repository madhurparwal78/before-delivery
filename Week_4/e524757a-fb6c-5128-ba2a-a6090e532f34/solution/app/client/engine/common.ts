import { MathUtils, WebGLRenderer } from 'three'

let available: boolean | undefined

/** True when a WebGL context can be made. */
export function webglAvailable(): boolean {
  if (available === undefined) {
    const probe = document.createElement('canvas')
    available = Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'))
  }
  return available
}

/** Deterministic noise in 0..1 for a pair of integers. */
export function hash2(x: number, y: number, seed = 0): number {
  const v = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453
  return v - Math.floor(v)
}

export function createRenderer(canvas: HTMLCanvasElement, antialias: boolean): WebGLRenderer {
  const renderer = new WebGLRenderer({ canvas, antialias, powerPreference: 'high-performance' })
  renderer.setClearColor(0xffffff, 1)
  return renderer
}

export const ease = (t: number): number => 1 - Math.pow(1 - MathUtils.clamp(t, 0, 1), 3)

/** Shortest signed difference between two angles in radians. */
export function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

/** Exponential approach: the share of the remaining distance covered in `dt` seconds with time constant `tau`. */
export const approach = (dt: number, tau: number): number => 1 - Math.exp(-dt / tau)
