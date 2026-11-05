// Graded motion on the page clock (requestAnimationFrame + performance.now). One character: a quick
// start and a long, gentle settle. With reduced motion every tween lands on its end state at once.

export const DURATION = { lift: 160, step: 140, place: 260, stubExit: 260, fill: 600, carousel: 260, panel: 260 } as const;

export const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** easeOutQuad: "set a pot down". */
const settleEase = (t: number) => 1 - (1 - t) * (1 - t);
export const linear = (t: number) => t;

/** Runs `frame(progress)` from 0 to 1 over `duration` ms; returns a cancel function. */
export function tween(duration: number, frame: (progress: number) => void, done?: () => void, ease = settleEase): () => void {
  if (prefersReducedMotion()) {
    frame(1);
    done?.();
    return () => undefined;
  }
  const start = performance.now();
  let handle = 0;
  let stopped = false;
  const step = () => {
    if (stopped) return;
    const t = Math.min(1, (performance.now() - start) / duration);
    frame(ease(t));
    if (t < 1) handle = requestAnimationFrame(step);
    else done?.();
  };
  frame(0);
  handle = requestAnimationFrame(step);
  return () => {
    stopped = true;
    cancelAnimationFrame(handle);
  };
}

/** Fades and rises an element a few pixels into place (panels and dialogs). */
export function rise(element: HTMLElement): () => void {
  return tween(DURATION.panel, (p) => {
    element.style.opacity = String(p);
    element.style.transform = `translateY(${(1 - p) * 12}px)`;
  });
}
