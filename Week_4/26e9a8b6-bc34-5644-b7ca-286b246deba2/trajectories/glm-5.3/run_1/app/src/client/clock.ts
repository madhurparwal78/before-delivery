// The one frame loop driving every page-time motion; the page clock is pausable.

type FrameCallback = (now: number, delta: number) => void;

interface Ticker {
  callbacks: Set<FrameCallback>;
  running: boolean;
  last: number;
}

const ticker: Ticker = { callbacks: new Set(), running: false, last: 0 };

function ensureRunning(): void {
  if (ticker.running) return;
  ticker.running = true;
  ticker.last = performance.now();
  const step = (): void => {
    const now = performance.now();
    const delta = now - ticker.last;
    ticker.last = now;
    for (const callback of ticker.callbacks) {
      callback(now, delta);
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Registers a per-frame callback; returns a stop function. */
export function onFrame(callback: FrameCallback): () => void {
  ticker.callbacks.add(callback);
  ensureRunning();
  return () => ticker.callbacks.delete(callback);
}

interface Timer {
  id: number | null;
}

/** A page-time timeout, driven by the frame loop so a paused clock holds it. */
export function pageTimeout(callback: () => void, ms: number): () => void {
  const timer: Timer = { id: null };
  const start = performance.now();
  const stop = onFrame((now) => {
    if (now - start >= ms) {
      stop();
      timer.id = null;
      callback();
    }
  });
  return () => {
    stop();
  };
}

/** A page-time interval driven by the frame loop. */
export function pageInterval(callback: () => void, ms: number): () => void {
  let last = performance.now();
  const stop = onFrame((now) => {
    if (now - last >= ms) {
      last = now;
      callback();
    }
  });
  return stop;
}

/** Runs a tween on page time; `apply` receives progress 0 to 1. */
export function tween(ms: number, apply: (t: number) => void, done?: () => void): () => void {
  const start = performance.now();
  const stop = onFrame((now) => {
    const t = Math.min(1, (now - start) / ms);
    apply(t);
    if (t >= 1) {
      stop();
      done?.();
    }
  });
  return stop;
}

/** Eases progress so motion settles softly. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** True when the reader asked for reduced motion. */
export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
