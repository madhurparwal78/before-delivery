export const RING_PX_PER_FREEDOM = 6;

const RING_RESIZE_MS = 220;
const COUNT_STEP_TOTAL_MS = 330;
const FLASH_HALF_MS = 160;

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function wait(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t) * (1 - t);
}

export type RingChange = { node: SVGCircleElement; from: number; to: number };

/** Rings resize first; the readout only counts afterwards. */
export function resizeRings(changes: RingChange[]): Promise<void> {
  if (changes.length === 0) return Promise.resolve();
  if (reducedMotion()) {
    for (const change of changes) change.node.setAttribute('r', String(change.to));
    return Promise.resolve();
  }
  return new Promise((done) => {
    const started = performance.now();
    const step = (now: number): void => {
      const progress = Math.min(1, (now - started) / RING_RESIZE_MS);
      const eased = easeOut(progress);
      for (const change of changes) {
        const radius = change.from + (change.to - change.from) * eased;
        change.node.setAttribute('r', String(radius));
        change.node.style.opacity = radius < 0.5 ? '0' : '1';
      }
      if (progress < 1) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  });
}

/** Shows every whole number between the totals once, evenly spaced. */
export async function countTo(
  from: number,
  to: number,
  show: (value: number) => void,
): Promise<void> {
  if (reducedMotion() || from === to) {
    show(to);
    return;
  }
  const direction = to > from ? 1 : -1;
  const steps = Math.abs(to - from);
  const perStep = COUNT_STEP_TOTAL_MS / steps;
  for (let i = 1; i <= steps; i += 1) {
    await wait(perStep);
    show(from + direction * i);
  }
}

/** Two turns of conflict red. The caller redraws for each half-turn. */
export async function flashTurns(show: (on: boolean) => void): Promise<void> {
  for (let turn = 0; turn < 2; turn += 1) {
    show(true);
    await wait(FLASH_HALF_MS);
    show(false);
    await wait(FLASH_HALF_MS);
  }
}

/** The depth handle overshoots by a few pixels and springs back to its target. */
export function settleHandle(node: HTMLElement): void {
  if (reducedMotion()) {
    node.style.removeProperty('--settle');
    return;
  }
  node.classList.remove('settling');
  void node.offsetWidth;
  node.classList.add('settling');
  setTimeout(() => node.classList.remove('settling'), 500);
}
