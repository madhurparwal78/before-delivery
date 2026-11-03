// Motion driven from animation frames, with the page clock. The same code
// honours reduced motion by jumping to the end state.
export type MotionState = 'opening' | 'open' | 'closing' | 'closed';

interface MotionRun {
  el: HTMLElement;
  duration: number;
  start: number; // progress at reversal
  reverse: boolean;
  attribute: string;
  progressAttribute: string;
  onUpdate: (progress: number) => void;
  onDone: (state: MotionState) => void;
  raf: number;
}

const runs = new Map<HTMLElement, MotionRun>();

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Start or reverse a motion. Returns the state it will end in. */
export function toggleMotion(
  el: HTMLElement,
  open: boolean,
  duration: number,
  attribute: string,
  progressAttribute: string,
  onUpdate: (progress: number) => void,
  onDone: (state: MotionState) => void,
): void {
  const existing = runs.get(el);
  const currentProgress = existing ? currentProgressOf(existing) : readProgress(el, progressAttribute);
  if (reducedMotion()) {
    if (existing) { cancelAnimationFrame(existing.raf); runs.delete(el); }
    const endProgress = open ? 1 : 0;
    el.setAttribute(attribute, open ? 'open' : 'closed');
    el.setAttribute(progressAttribute, endProgress.toFixed(2));
    onUpdate(endProgress);
    onDone(open ? 'open' : 'closed');
    return;
  }
  let from: number, to: number, ms: number, reverse: boolean;
  if (existing) {
    cancelAnimationFrame(existing.raf);
    runs.delete(el);
    // reversing from current progress
    from = currentProgress;
    to = open ? 1 : 0;
    ms = Math.round(Math.abs(to - from) * duration);
    reverse = true;
  } else {
    from = open ? 0 : 1;
    to = open ? 1 : 0;
    ms = duration;
    reverse = false;
  }
  const startTime = performance.now();
  el.setAttribute(attribute, open ? 'opening' : 'closing');
  const run: MotionRun = {
    el, duration, start: from, reverse, attribute, progressAttribute, onUpdate, onDone, raf: 0,
  };
  const step = () => {
    const elapsed = performance.now() - startTime;
    const t = ms <= 0 ? 1 : Math.min(1, elapsed / ms);
    const progress = from + (to - from) * t;
    el.setAttribute(progressAttribute, progress.toFixed(2));
    onUpdate(progress);
    if (t >= 1) {
      runs.delete(el);
      el.setAttribute(attribute, open ? 'open' : 'closed');
      el.setAttribute(progressAttribute, (open ? 1 : 0).toFixed(2));
      onDone(open ? 'open' : 'closed');
      return;
    }
    run.raf = requestAnimationFrame(step);
  };
  run.raf = requestAnimationFrame(step);
  runs.set(el, run);
}

function currentProgressOf(run: MotionRun): number {
  const v = parseFloat(run.el.getAttribute(run.progressAttribute) ?? '0');
  return Number.isFinite(v) ? v : 0;
}

function readProgress(el: HTMLElement, progressAttribute: string): number {
  const v = parseFloat(el.getAttribute(progressAttribute) ?? '0');
  return Number.isFinite(v) ? v : 0;
}

export function motionStateOf(el: HTMLElement): MotionState | null {
  const a = el.getAttribute('data-motion') ?? el.getAttribute('data-fan');
  if (a === 'opening' || a === 'open' || a === 'closing' || a === 'closed') return a;
  return null;
}

/** Run a ripple/pulse effect for a fixed page-time duration. */
export function timedEffect(el: HTMLElement, attribute: string, ms: number): void {
  if (reducedMotion()) return;
  el.setAttribute(attribute, 'true');
  setTimeout(() => el.removeAttribute(attribute), ms);
}
