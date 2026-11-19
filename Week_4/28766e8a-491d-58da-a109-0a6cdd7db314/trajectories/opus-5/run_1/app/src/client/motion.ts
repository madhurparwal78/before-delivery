/**
 * Every animation runs on page timers and animation frames, driven frame by frame, so
 * advancing the page clock advances the motion. Nothing depends on a CSS animation ending.
 */

export const SETTLE_MS = 200;
export const GLIDE_MS = 240;
export const RAIL_MS = 200;
export const PORT_FADE_MS = 120;

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface Animation {
  cancel(): void;
  readonly progress: number;
}

/** Eases out, so motion starts quickly and settles softly into place. */
export function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export function animate(
  duration: number,
  onFrame: (progress: number) => void,
  onDone?: () => void,
): Animation {
  if (duration <= 0) {
    onFrame(1);
    onDone?.();
    return { cancel: () => undefined, progress: 1 };
  }
  const start = Date.now();
  let handle = 0;
  let progress = 0;
  let cancelled = false;
  const step = (): void => {
    if (cancelled) return;
    progress = Math.min(1, (Date.now() - start) / duration);
    onFrame(progress);
    if (progress < 1) handle = requestAnimationFrame(step);
    else onDone?.();
  };
  handle = requestAnimationFrame(step);
  return {
    cancel: () => {
      cancelled = true;
      cancelAnimationFrame(handle);
    },
    get progress() {
      return progress;
    },
  };
}

/** Runs a callback on every animation frame until it is stopped. */
export function onEveryFrame(callback: () => void): () => void {
  let handle = 0;
  let running = true;
  const step = (): void => {
    if (!running) return;
    callback();
    handle = requestAnimationFrame(step);
  };
  handle = requestAnimationFrame(step);
  return () => {
    running = false;
    cancelAnimationFrame(handle);
  };
}

export function formatProgress(value: number): string {
  return Math.min(1, Math.max(0, value)).toFixed(2);
}

/**
 * A two-state slide that reverses mid-motion from its current progress: a close that
 * starts at progress p takes p x duration and an open takes (1 - p) x duration.
 */
export class ReversibleSlide {
  private value: number;
  private running: Animation | null = null;

  constructor(
    private readonly duration: number,
    private readonly onChange: (state: 'opening' | 'open' | 'closing' | 'closed', progress: number) => void,
    open: boolean,
  ) {
    this.value = open ? 1 : 0;
    this.onChange(open ? 'open' : 'closed', this.value);
  }

  get progress(): number {
    return this.value;
  }

  set(open: boolean): void {
    this.running?.cancel();
    this.running = null;
    if (reducedMotion()) {
      this.value = open ? 1 : 0;
      this.onChange(open ? 'open' : 'closed', this.value);
      return;
    }
    const from = this.value;
    const span = open ? 1 - from : from;
    if (span <= 0) {
      this.value = open ? 1 : 0;
      this.onChange(open ? 'open' : 'closed', this.value);
      return;
    }
    this.onChange(open ? 'opening' : 'closing', this.value);
    this.running = animate(
      span * this.duration,
      (t) => {
        this.value = open ? from + (1 - from) * t : from * (1 - t);
        this.onChange(open ? 'opening' : 'closing', this.value);
      },
      () => {
        this.value = open ? 1 : 0;
        this.onChange(open ? 'open' : 'closed', this.value);
        this.running = null;
      },
    );
  }
}
