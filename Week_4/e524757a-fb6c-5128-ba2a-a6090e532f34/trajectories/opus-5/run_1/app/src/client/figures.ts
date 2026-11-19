import { all, reducedMotion } from './dom.js';

export const COUNT_MS = 600;

export type Formatter = (value: number) => string;

const running = new WeakMap<HTMLElement, number>();

/** Count-up motion on page time: strictly between at 300 ms, the exact final text at 600 ms. */
export function countTo(element: HTMLElement, from: number, to: number, format: Formatter): void {
  const token = (running.get(element) ?? 0) + 1;
  running.set(element, token);
  if (reducedMotion() || from === to) {
    element.textContent = format(to);
    return;
  }
  const start = performance.now();
  const step = (now: number): void => {
    if (running.get(element) !== token) return;
    const share = Math.min(1, (now - start) / COUNT_MS);
    if (share >= 1) {
      element.textContent = format(to);
      return;
    }
    element.textContent = format(between(from, to, share));
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  window.setTimeout(() => {
    if (running.get(element) === token) element.textContent = format(to);
  }, COUNT_MS);
}

function between(from: number, to: number, share: number): number {
  const direction = to > from ? 1 : -1;
  let value = Math.round(from + (to - from) * share);
  if (Math.abs(to - from) >= 2) {
    if (value === from) value = from + direction;
    if (value === to) value = to - direction;
  }
  return value;
}

export function figuresNamed(name: string): HTMLElement[] {
  return all<HTMLElement>(`[data-figure="${name}"]`);
}

export function readFigure(element: HTMLElement): number {
  const match = /-?\d+/.exec(element.textContent ?? '0');
  return match ? Number.parseInt(match[0], 10) : 0;
}

export function setFigure(name: string, to: number, format: Formatter): void {
  for (const element of figuresNamed(name)) countTo(element, readFigure(element), to, format);
}
