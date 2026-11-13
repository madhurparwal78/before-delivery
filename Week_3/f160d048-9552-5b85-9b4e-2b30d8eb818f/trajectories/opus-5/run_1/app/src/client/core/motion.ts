export type MotionName =
  | 'star-fill'
  | 'save-toggle'
  | 'filter-sheet'
  | 'toast'
  | 'card-drop'
  | 'band-crossfade'
  | 'band-unhatch'
  | 'band-count';

const MOTION_MS: Readonly<Record<MotionName, number>> = {
  'star-fill': 160,
  'save-toggle': 200,
  'filter-sheet': 280,
  toast: 200,
  'card-drop': 240,
  'band-crossfade': 420,
  'band-unhatch': 320,
  'band-count': 600,
};

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function watchMotionPreference(): void {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  const apply = (): void => {
    document.documentElement.setAttribute('data-motion-pref', query.matches ? 'reduced' : 'full');
  };
  apply();
  query.addEventListener('change', apply);
}

function durationOf(name: MotionName): number {
  return prefersReducedMotion() ? 0 : MOTION_MS[name];
}

/** Publishes the motion's name, duration and current state on the element. */
export function markMotion(element: HTMLElement, name: MotionName, state: string): void {
  element.setAttribute('data-motion', name);
  element.setAttribute('data-motion-ms', String(durationOf(name)));
  element.setAttribute('data-state', state);
}

/**
 * Moves the element from its start state to its end state, reaching the end
 * once the published duration has passed on the page's own timers.
 */
export function runMotion(element: HTMLElement, name: MotionName, from: string, to: string, onEnd?: () => void): void {
  markMotion(element, name, from);
  const finish = (): void => {
    element.setAttribute('data-state', to);
    onEnd?.();
  };
  const ms = durationOf(name);
  if (ms === 0) finish();
  else window.setTimeout(finish, ms);
}

/** Counts a figure up to its final value within the published duration. */
export function countUp(element: HTMLElement, to: number, format: (value: number) => string): void {
  const ms = durationOf('band-count');
  if (ms === 0) {
    element.textContent = format(to);
    return;
  }
  const started = performance.now();
  const step = (): void => {
    const progress = Math.min(1, (performance.now() - started) / ms);
    element.textContent = format(Math.round(to * progress));
    if (progress < 1) requestAnimationFrame(step);
  };
  element.textContent = format(0);
  requestAnimationFrame(step);
  /** The final value lands on the page clock even with no painted frames. */
  window.setTimeout(() => {
    element.textContent = format(to);
  }, ms);
}
