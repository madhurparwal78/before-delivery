/** Frame-driven motion on the page clock: the same frames in a browser and under a stepped test clock. */

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const easeOut = (progress: number): number => 1 - (1 - progress) ** 3;

/** Runs `frame` with an eased 0..1 progress over `duration` ms, ending exactly on 1. Returns a function that stops it. */
export function tween(duration: number, frame: (eased: number) => void): () => void {
  const start = performance.now();
  let handle = 0;
  const step = (): void => {
    const progress = Math.min(1, (performance.now() - start) / duration);
    frame(easeOut(progress));
    if (progress < 1) handle = requestAnimationFrame(step);
  };
  frame(0);
  handle = requestAnimationFrame(step);
  return () => cancelAnimationFrame(handle);
}
