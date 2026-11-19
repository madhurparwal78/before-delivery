// The product's one easing: cubic-bezier(0.65, 0, 0.35, 1), a symmetrical gentle S-curve.

const X1 = 0.65
const X2 = 0.35

function bezier(a: number, b: number, t: number): number {
  const m = 1 - t
  return 3 * m * m * t * a + 3 * m * t * t * b + t * t * t
}

function slope(t: number): number {
  const m = 1 - t
  return 3 * m * m * X1 + 6 * m * t * (X2 - X1) + 3 * t * t * (1 - X2)
}

function ease(x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  let t = x
  for (let i = 0; i < 8; i += 1) {
    const error = bezier(X1, X2, t) - x
    const s = slope(t)
    if (Math.abs(error) < 1e-5 || s === 0) break
    t -= error / s
  }
  return bezier(0, 1, t)
}

// A timed step measured on the requestAnimationFrame clock: it starts at the first frame that sees it.
export class Step {
  private startedAt: number | null = null
  constructor(readonly durationMs: number) {}

  progress(now: number): number {
    if (this.startedAt === null) this.startedAt = now
    return Math.min(Math.max((now - this.startedAt) / this.durationMs, 0), 1)
  }

  eased(now: number): number {
    return ease(this.progress(now))
  }

  done(now: number): boolean {
    return this.progress(now) >= 1
  }
}
