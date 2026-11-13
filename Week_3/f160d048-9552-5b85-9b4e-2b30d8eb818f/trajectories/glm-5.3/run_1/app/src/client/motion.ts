// Published motion: every moving element carries its name, duration and state.
export function prefersReduced(): boolean {
  return document.documentElement.getAttribute('data-motion-pref') === 'reduced';
}

export interface MotionSpec {
  name: string;
  ms: number;
  states: [string, string];
}

export function motionAttrs(spec: MotionSpec, running: boolean): Record<string, string> {
  const duration = prefersReduced() ? 0 : spec.ms;
  return {
    'data-motion': spec.name,
    'data-motion-ms': String(duration),
    'data-state': running ? spec.states[0] : spec.states[1],
  };
}

export const MOTION = {
  starFill: { name: 'star-fill', ms: 160, states: ['running', 'done'] },
  saveToggle: { name: 'save-toggle', ms: 200, states: ['running', 'done'] },
  filterSheet: { name: 'filter-sheet', ms: 280, states: ['opening', 'open'] },
  toast: { name: 'toast', ms: 200, states: ['opening', 'open'] },
  cardDrop: { name: 'card-drop', ms: 240, states: ['running', 'done'] },
  bandCrossfade: { name: 'band-crossfade', ms: 420, states: ['running', 'done'] },
  bandUnhatch: { name: 'band-unhatch', ms: 320, states: ['running', 'done'] },
  bandCount: { name: 'band-count', ms: 600, states: ['running', 'done'] },
} satisfies Record<string, MotionSpec>;

// Runs a motion: sets running state, then the end state after the duration.
export function runMotion(
  element: HTMLElement,
  spec: MotionSpec,
  onStart?: () => void,
): void {
  const ms = prefersReduced() ? 0 : spec.ms;
  element.setAttribute('data-motion', spec.name);
  element.setAttribute('data-motion-ms', String(ms));
  element.setAttribute('data-state', spec.states[0]);
  onStart?.();
  if (ms === 0) {
    element.setAttribute('data-state', spec.states[1]);
    return;
  }
  window.setTimeout(() => {
    element.setAttribute('data-state', spec.states[1]);
  }, ms);
}

// Counts a figure up to its end value on the page clock.
export function countUp(
  element: HTMLElement,
  endValue: number,
  ms: number,
  format: (value: number) => string,
): void {
  const duration = prefersReduced() ? 0 : ms;
  element.setAttribute('data-motion', 'band-count');
  element.setAttribute('data-motion-ms', String(duration));
  element.setAttribute('data-state', 'running');
  if (duration === 0) {
    element.textContent = format(endValue);
    element.setAttribute('data-state', 'done');
    return;
  }
  const start = performance.now();
  const tick = (now: number) => {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = format(Math.round(endValue * eased));
    if (progress < 1) {
      window.requestAnimationFrame(tick);
    } else {
      element.textContent = format(endValue);
      element.setAttribute('data-state', 'done');
    }
  };
  window.requestAnimationFrame(tick);
}
