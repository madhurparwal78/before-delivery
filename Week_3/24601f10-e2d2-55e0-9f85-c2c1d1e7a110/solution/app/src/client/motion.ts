export const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const MOTION = { swap: 330, advance: 320, segment: 320, stagger: 90, slat: 240 } as const;

// Every animation runs on animation frames and page timers, so a paused page clock holds it.
export function tween(durationMs: number, onFrame: (progress: number) => void, onDone?: () => void): () => void {
  let frame = 0;
  let start: number | null = null;
  const step = (now: number): void => {
    start ??= now;
    const progress = Math.min(1, (now - start) / durationMs);
    onFrame(1 - (1 - progress) ** 3);
    if (progress < 1) frame = requestAnimationFrame(step);
    else onDone?.();
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}
