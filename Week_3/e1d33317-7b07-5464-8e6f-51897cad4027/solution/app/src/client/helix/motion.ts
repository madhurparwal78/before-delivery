// Time-based motion helpers. Every value is driven by the animation-frame clock, never by real time.

const easeOutCubic = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** A value that eases from where it is to a new target; retargeting continues from the current value. */
export class Tween {
  private from: number
  private to: number
  private start = 0
  private duration = 0

  constructor(value: number) {
    this.from = value
    this.to = value
  }

  at(now: number): number {
    if (this.duration <= 0 || now >= this.start + this.duration) return this.to
    if (now <= this.start) return this.from
    return this.from + (this.to - this.from) * easeOutCubic((now - this.start) / this.duration)
  }

  retarget(now: number, to: number, duration: number, delay = 0): void {
    this.from = this.at(now)
    this.to = to
    this.start = now + delay
    this.duration = duration
  }

  jump(to: number): void {
    this.from = to
    this.to = to
    this.duration = 0
  }

  settled(now: number): boolean {
    return this.duration <= 0 || now >= this.start + this.duration
  }

  get target(): number {
    return this.to
  }
}

export interface SpringState {
  x: number
  v: number
}

/** Advances a critically damped spring exactly over `seconds`. It never overshoots its target. */
export function stepCriticallyDamped(state: SpringState, target: number, omega: number, seconds: number): void {
  const d = state.x - target
  const decay = Math.exp(-omega * seconds)
  const carry = state.v + omega * d
  state.x = target + (d + carry * seconds) * decay
  state.v = (state.v - omega * carry * seconds) * decay
}
