type Listener = () => void;

class Preference {
  private readonly listeners = new Set<Listener>();
  private readonly media = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor() {
    this.media.addEventListener('change', () => {
      for (const listener of this.listeners) listener();
    });
  }

  get reduced(): boolean {
    return this.media.matches;
  }

  subscribe(listener: Listener): void {
    this.listeners.add(listener);
  }
}

/** The device's reduced-motion preference, read live by every animation. */
export const motion = new Preference();

class PageVisibility {
  private readonly listeners = new Set<Listener>();

  constructor() {
    document.addEventListener('visibilitychange', () => {
      for (const listener of this.listeners) listener();
    });
  }

  get visible(): boolean {
    return document.visibilityState !== 'hidden';
  }

  subscribe(listener: Listener): void {
    this.listeners.add(listener);
  }
}

export const page = new PageVisibility();

/** Time that advances only while the page is visible, so ambient motion resumes where it paused. */
export class AmbientClock {
  private accumulated = 0;
  private lastFrame = performance.now();

  advance(now: number): number {
    const step = now - this.lastFrame;
    this.lastFrame = now;
    if (page.visible && !motion.reduced) this.accumulated += step;
    return this.accumulated / 1000;
  }

  get seconds(): number {
    return this.accumulated / 1000;
  }
}

/** A timed move that follows elapsed real time, including time spent hidden. */
export class Tween {
  private startedAt = 0;
  private durationMs = 0;
  private running = false;

  start(durationMs: number, now = performance.now()): void {
    this.startedAt = now;
    this.durationMs = durationMs;
    this.running = durationMs > 0;
  }

  stop(): void {
    this.running = false;
  }

  get active(): boolean {
    return this.running;
  }

  progress(now = performance.now()): number {
    if (!this.running) return 1;
    if (this.durationMs <= 0) return 1;
    const value = (now - this.startedAt) / this.durationMs;
    if (value >= 1) {
      this.running = false;
      return 1;
    }
    return Math.max(0, value);
  }

  get elapsedMs(): number {
    return performance.now() - this.startedAt;
  }
}

/** Starts quickly and settles softly, never overshooting. */
export function ease(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

const frameListeners: Array<(now: number) => void> = [];
let looping = false;

export function onFrame(listener: (now: number) => void): void {
  frameListeners.push(listener);
  if (looping) return;
  looping = true;
  const step = (now: number): void => {
    for (const each of frameListeners) each(now);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

/** Rounds up to the next tenth, as the reduced-motion ribbon fraction does. */
export function upToTenth(value: number): number {
  return Math.min(1, Math.ceil(value * 10 - 1e-9) / 10);
}
