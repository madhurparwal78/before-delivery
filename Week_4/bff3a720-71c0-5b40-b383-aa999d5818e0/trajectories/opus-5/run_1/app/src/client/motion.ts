export const MOTION_MS = {
  'handle-snap': 160,
  'price-roll': 280,
  'shutter-reveal': 420,
  'swap-rotate': 280,
  'result-reveal': 240,
  'seat-fill': 280,
  'booking-confirm': 420,
  sheet: 280,
  'rating-reveal': 420,
  toast: 200,
} as const;

export type MotionName = keyof typeof MOTION_MS;

const query = window.matchMedia('(prefers-reduced-motion: reduce)');

export function reduced(): boolean {
  return query.matches;
}

function applyPreference(): void {
  document.documentElement.setAttribute(
    'data-motion-pref',
    reduced() ? 'reduced' : 'full',
  );
}

export function watchMotionPreference(): void {
  applyPreference();
  query.addEventListener('change', applyPreference);
}

export function motionMs(name: MotionName): number {
  return reduced() ? 0 : MOTION_MS[name];
}

/**
 * Publish the motion attributes and move `data-state` to its end after the published
 * duration on the page clock. Under reduced motion the end state is set at once.
 */
export function runMotion(
  el: HTMLElement,
  name: MotionName,
  phase: 'play' | 'open' | 'close' = 'play',
  whenDone?: () => void,
): void {
  const start = phase === 'play' ? 'running' : phase === 'open' ? 'opening' : 'closing';
  const end = phase === 'play' ? 'done' : phase === 'open' ? 'open' : 'closed';
  const ms = motionMs(name);
  el.setAttribute('data-motion', name);
  el.setAttribute('data-motion-ms', String(ms));
  el.style.setProperty('--motion', `${ms}ms`);
  el.setAttribute('data-state', start);
  if (ms === 0) {
    el.setAttribute('data-state', end);
    whenDone?.();
    return;
  }
  window.setTimeout(() => {
    el.setAttribute('data-state', end);
    whenDone?.();
  }, ms);
}

/** A still element that still publishes its finished motion, as a direct page load does. */
export function settledMotion(el: HTMLElement, name: MotionName): void {
  el.setAttribute('data-motion', name);
  el.setAttribute('data-motion-ms', String(motionMs(name)));
  el.style.setProperty('--motion', `${motionMs(name)}ms`);
  el.setAttribute('data-state', 'done');
}
