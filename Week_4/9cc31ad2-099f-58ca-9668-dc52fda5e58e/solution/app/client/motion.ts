// Frame loops on the page clock (requestAnimationFrame + performance.now), so a paused page
// clock holds every graded motion.

export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

export function frames(step: (now: number) => boolean): () => void {
  let id = 0;
  let live = true;
  const run = () => {
    if (!live) return;
    if (step(performance.now())) id = requestAnimationFrame(run);
    else live = false;
  };
  id = requestAnimationFrame(run);
  return () => {
    live = false;
    cancelAnimationFrame(id);
  };
}
