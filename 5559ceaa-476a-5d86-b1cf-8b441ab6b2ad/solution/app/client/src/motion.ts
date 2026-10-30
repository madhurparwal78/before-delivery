export const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const EASE_OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const PANEL_IN_MS = 200;
const PANEL_OUT_MS = 160;

export interface Offset {
  x: number;
  y: number;
}

const running = new WeakMap<HTMLElement, number>();
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeIn = (t: number): number => t * t;

/**
 * A short fade-and-slide driven by animation frames on the page clock. Starts in its first state at once and
 * resolves when it ends or when a newer tween on the same element replaces it.
 */
function tween(element: HTMLElement, from: Offset, to: Offset, opacity: [number, number], ms: number, ease: (t: number) => number): Promise<void> {
  const token = (running.get(element) ?? 0) + 1;
  running.set(element, token);
  const paint = (t: number) => {
    const k = ease(t);
    element.style.opacity = String(opacity[0] + (opacity[1] - opacity[0]) * k);
    element.style.translate = `${from.x + (to.x - from.x) * k}px ${from.y + (to.y - from.y) * k}px`;
  };
  paint(0);
  const start = performance.now();
  return new Promise((resolve) => {
    const step = (now: number) => {
      if (running.get(element) !== token) return resolve();
      const t = Math.min(1, (now - start) / ms);
      paint(t);
      if (t < 1) return void requestAnimationFrame(step);
      element.style.removeProperty("opacity");
      element.style.removeProperty("translate");
      resolve();
    };
    requestAnimationFrame(step);
  });
}

/** Fades and slides an element in from `offset`; nothing under reduced motion. */
export function enter(element: HTMLElement, offset: Offset): void {
  if (reducedMotion()) return;
  void tween(element, offset, { x: 0, y: 0 }, [0, 1], PANEL_IN_MS, easeOut);
}

/** Fades and slides an element out towards `offset`, then resolves; instant under reduced motion. */
export async function leave(element: HTMLElement, offset: Offset): Promise<void> {
  if (reducedMotion()) return;
  await tween(element, { x: 0, y: 0 }, offset, [1, 0], PANEL_OUT_MS, easeIn);
}
