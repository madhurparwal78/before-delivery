import { prefersReducedMotion } from '../dom.ts';

export const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

export interface Running {
  cancel: () => void;
}

/**
 * Every motion runs on the browser's own animation frames, so a paused or
 * advanced clock samples it exactly where the browser is.
 */
export const animate = (
  durationMs: number,
  step: (progress: number) => void,
  done?: () => void,
): Running => {
  if (prefersReducedMotion() || durationMs <= 0) {
    step(1);
    done?.();
    return { cancel: () => undefined };
  }
  const started = performance.now();
  let frame = 0;
  let cancelled = false;
  const tick = (): void => {
    if (cancelled) return;
    const elapsed = performance.now() - started;
    const progress = Math.min(1, elapsed / durationMs);
    step(progress);
    if (progress < 1) {
      frame = requestAnimationFrame(tick);
      return;
    }
    done?.();
  };
  frame = requestAnimationFrame(tick);
  return {
    cancel: () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    },
  };
};

/**
 * A value that travels to its target at a steady speed, so flipping the target
 * mid-travel reverses from wherever it is instead of jumping.
 */
export class Glide {
  private current: number;
  private target: number;
  private readonly fullDurationMs: number;
  private readonly apply: (eased: number) => void;
  private readonly settled: (value: number) => void;
  private frame = 0;
  private lastAt = 0;

  constructor(
    start: number,
    fullDurationMs: number,
    apply: (eased: number) => void,
    settled: (value: number) => void,
  ) {
    this.current = start;
    this.target = start;
    this.fullDurationMs = fullDurationMs;
    this.apply = apply;
    this.settled = settled;
    this.apply(easeOut(this.current));
  }

  to(target: number): void {
    this.target = target;
    if (prefersReducedMotion()) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.current = target;
      this.apply(easeOut(target));
      this.settled(target);
      return;
    }
    if (this.current === target) {
      this.settled(target);
      return;
    }
    if (this.frame !== 0) return;
    this.lastAt = performance.now();
    this.frame = requestAnimationFrame(() => this.tick());
  }

  private tick(): void {
    const now = performance.now();
    const delta = now - this.lastAt;
    this.lastAt = now;
    const speed = delta / this.fullDurationMs;
    if (this.current < this.target) {
      this.current = Math.min(this.target, this.current + speed);
    } else {
      this.current = Math.max(this.target, this.current - speed);
    }
    this.apply(easeOut(this.current));
    if (this.current !== this.target) {
      this.frame = requestAnimationFrame(() => this.tick());
      return;
    }
    this.frame = 0;
    this.settled(this.current);
  }
}
