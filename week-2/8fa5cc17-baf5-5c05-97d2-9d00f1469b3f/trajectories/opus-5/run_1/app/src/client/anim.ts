import { prefersReducedMotion } from './dom';
import { QUIRE_CURVE, REDUCED_FADE_MS, springAt, springSettled, quireEase } from '../shared/motion';

export { QUIRE_CURVE };

/** A browser-managed animation, so the page can list, pause and seek it. */
export function animate(
  node: Element,
  keyframes: Keyframe[],
  durationMs: number,
  easing: string | undefined = QUIRE_CURVE,
  delayMs = 0,
): Animation {
  return node.animate(keyframes, {
    duration: durationMs,
    easing: easing ?? QUIRE_CURVE,
    delay: delayMs,
    fill: delayMs > 0 ? 'backwards' : 'none',
  });
}

export function fadeIn(node: Element, durationMs = REDUCED_FADE_MS): Animation {
  return node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: durationMs, easing: 'linear' });
}

/** The critically damped spring of the library drawer and the margin sheet. */
export class Spring {
  private startOffset: number;
  private startVelocity = 0;
  private startTime = 0;
  private frame = 0;
  offset: number;
  velocity = 0;
  target: number;

  constructor(
    initial: number,
    private readonly apply: (offset: number, progress: number) => void,
    private readonly onSettled: (target: number) => void,
  ) {
    this.offset = initial;
    this.startOffset = initial;
    this.target = initial;
  }

  retarget(target: number, openOffset: number, closedOffset: number): void {
    this.target = target;
    this.startOffset = this.offset;
    this.startVelocity = this.velocity;
    this.startTime = 0;
    if (prefersReducedMotion()) {
      this.offset = target;
      this.velocity = 0;
      this.apply(target, this.progressOf(target, openOffset, closedOffset));
      this.onSettled(target);
      return;
    }
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    const step = (now: number): void => {
      if (this.startTime === 0) this.startTime = now;
      const seconds = (now - this.startTime) / 1000;
      const state = springAt(this.startOffset, this.startVelocity, this.target, seconds);
      this.offset = state.offset;
      this.velocity = state.velocity;
      this.apply(this.offset, this.progressOf(this.offset, openOffset, closedOffset));
      if (springSettled(this.offset, this.velocity, this.target)) {
        this.offset = this.target;
        this.velocity = 0;
        this.apply(this.offset, this.progressOf(this.offset, openOffset, closedOffset));
        this.frame = 0;
        this.onSettled(this.target);
        return;
      }
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  private progressOf(offset: number, openOffset: number, closedOffset: number): number {
    const span = closedOffset - openOffset;
    if (span === 0) return 1;
    return Math.min(1, Math.max(0, 1 - (offset - openOffset) / span));
  }

  setOffset(offset: number, openOffset: number, closedOffset: number): void {
    if (this.frame !== 0) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.offset = offset;
    this.velocity = 0;
    this.apply(offset, this.progressOf(offset, openOffset, closedOffset));
  }
}

/** A scripted tween on the page clock, for numerals, cameras and coasts. */
export function tween(
  durationMs: number,
  step: (eased: number, raw: number) => void,
  options: { easing?: (t: number) => number; onDone?: () => void } = {},
): () => void {
  const easing = options.easing ?? quireEase;
  if (prefersReducedMotion()) {
    step(1, 1);
    if (options.onDone !== undefined) options.onDone();
    return () => undefined;
  }
  let frame = 0;
  let start = 0;
  let cancelled = false;
  const run = (now: number): void => {
    if (cancelled) return;
    if (start === 0) start = now;
    const raw = Math.min(1, (now - start) / durationMs);
    step(easing(raw), raw);
    if (raw < 1) frame = requestAnimationFrame(run);
    else if (options.onDone !== undefined) options.onDone();
  };
  frame = requestAnimationFrame(run);
  return () => {
    cancelled = true;
    if (frame !== 0) cancelAnimationFrame(frame);
  };
}
