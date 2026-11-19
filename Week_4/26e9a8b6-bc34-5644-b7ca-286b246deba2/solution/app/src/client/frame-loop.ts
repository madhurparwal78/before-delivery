/** The one frame loop: every animation, count, fade and render in the page runs from this single requestAnimationFrame. */

type System = (now: number) => boolean;

const systems = new Set<System>();
let pending = 0;
let running = false;
let again = false;

function tick(now: number): void {
  pending = 0;
  running = true;
  again = false;
  let busy = false;
  for (const system of [...systems]) busy = system(now) || busy;
  running = false;
  if (busy || again) pending = requestAnimationFrame(tick);
}

/** Wakes the loop so the next frame runs every registered system. */
export function wake(): void {
  if (running) again = true;
  else if (!pending) pending = requestAnimationFrame(tick);
}

/** Registers a system that runs on every awake frame; it returns true while it still needs frames. */
export function register(system: System): () => void {
  systems.add(system);
  wake();
  return () => systems.delete(system);
}

export const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Runs `apply(progress)` with eased progress over `duration` ms of page time, ending exactly on 1. Returns a canceller. */
export function animate(duration: number, apply: (progress: number) => void, ease: (t: number) => number = easeOut): () => void {
  const start = performance.now();
  const stop = register((now) => {
    const t = Math.min(1, Math.max(0, (now - start) / duration));
    apply(t >= 1 ? 1 : ease(t));
    if (t >= 1) stop();
    return t < 1;
  });
  return stop;
}
