export type MotionState = "opening" | "open" | "closing" | "closed";

export const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A reversible open/close motion driven from animation frames on the page clock. Toggling mid-motion
 * reverses from the current progress (progress × duration back, (1 − progress) × duration forward);
 * with reduced motion it reaches its end state in the same frame it is toggled.
 */
export class Reversible {
  progress: number;
  private target: number;
  private frame = 0;
  private last = 0;

  constructor(
    private readonly duration: number,
    open: boolean,
    private readonly paint: (state: MotionState, progress: number) => void,
    private readonly settled: (state: "open" | "closed") => void = () => undefined,
  ) {
    this.progress = open ? 1 : 0;
    this.target = this.progress;
  }

  get state(): MotionState {
    if (this.progress === this.target) return this.target === 1 ? "open" : "closed";
    return this.target === 1 ? "opening" : "closing";
  }

  /** True while opening or open (where a toggle closes). */
  get heading(): boolean {
    return this.target === 1;
  }

  set(open: boolean): void {
    this.target = open ? 1 : 0;
    if (prefersReducedMotion() || this.progress === this.target) {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.progress = this.target;
      this.paint(this.state, this.progress);
      this.settled(this.target === 1 ? "open" : "closed");
      return;
    }
    if (!this.frame) {
      this.last = performance.now();
      this.frame = requestAnimationFrame(this.step);
    }
    this.paint(this.state, this.progress);
  }

  toggle(): void {
    this.set(this.target === 0);
  }

  private step = (now: number) => {
    const delta = Math.max(0, now - this.last) / this.duration;
    this.last = now;
    this.progress = this.target === 1 ? Math.min(1, this.progress + delta) : Math.max(0, this.progress - delta);
    this.frame = this.progress === this.target ? 0 : requestAnimationFrame(this.step);
    this.paint(this.state, this.progress);
    if (!this.frame) this.settled(this.target === 1 ? "open" : "closed");
  };
}

/**
 * Mark elements with `attribute="true"` for `duration` ms of page time, driven from animation frames.
 * `--flash` runs from 1 to 0 so the stylesheet can fade the effect; the attribute is removed at the end.
 */
export function flash(elements: HTMLElement[], attribute: string, duration: number): void {
  if (!elements.length) return;
  const start = performance.now();
  const paint = (value: number) => elements.forEach((e) => e.style.setProperty("--flash", value.toFixed(3)));
  elements.forEach((e) => e.setAttribute(attribute, "true"));
  paint(1);
  const step = (now: number) => {
    const t = (now - start) / duration;
    if (t < 1) {
      paint(1 - t);
      requestAnimationFrame(step);
      return;
    }
    elements.forEach((e) => {
      e.removeAttribute(attribute);
      e.style.removeProperty("--flash");
    });
  };
  requestAnimationFrame(step);
}

/** Fast start, soft settle. */
export function easeOut(t: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
}
