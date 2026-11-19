/** One frame loop drives every page-time motion on the page. */
type Task = (now: number) => boolean;

const tasks = new Set<Task>();
let running = false;

function tick(now: number): void {
  for (const task of [...tasks]) {
    if (!task(now)) tasks.delete(task);
  }
  if (tasks.size > 0) requestAnimationFrame(tick);
  else running = false;
}

export function addFrameTask(task: Task): () => void {
  tasks.add(task);
  if (!running) {
    running = true;
    requestAnimationFrame(tick);
  }
  return () => tasks.delete(task);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface TweenOptions {
  duration: number;
  /** Starts quickly and settles softly. */
  apply: (fraction: number) => void;
  done?: () => void;
}

/** Cancels any previous tween on the same key before starting. */
const activeTweens = new Map<string, () => void>();

export function tween(key: string, options: TweenOptions): void {
  cancelTween(key);
  if (options.duration <= 0) {
    options.apply(1);
    options.done?.();
    return;
  }
  const started = performance.now();
  const stop = addFrameTask((now) => {
    const elapsed = now - started;
    const linear = Math.min(1, elapsed / options.duration);
    options.apply(settle(linear));
    if (linear < 1) return true;
    activeTweens.delete(key);
    options.done?.();
    return false;
  });
  activeTweens.set(key, stop);
}

export function cancelTween(key: string): void {
  const stop = activeTweens.get(key);
  if (stop !== undefined) {
    stop();
    activeTweens.delete(key);
  }
}

export function tweenRunning(key: string): boolean {
  return activeTweens.has(key);
}

function settle(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** A debounce on page time, used for the published commit and search delays. */
export class Delay {
  private handle: number | null = null;

  schedule(ms: number, run: () => void): void {
    this.cancel();
    this.handle = window.setTimeout(() => {
      this.handle = null;
      run();
    }, ms);
  }

  cancel(): void {
    if (this.handle !== null) {
      window.clearTimeout(this.handle);
      this.handle = null;
    }
  }

  get pending(): boolean {
    return this.handle !== null;
  }
}
