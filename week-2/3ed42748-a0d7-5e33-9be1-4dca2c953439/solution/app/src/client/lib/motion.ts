// The reduced-motion mode every animation reads live, the page clock and the shared easings.

const query = matchMedia("(prefers-reduced-motion: reduce)");
const listeners = new Set<(reduced: boolean) => void>();
let reduced = query.matches;

/** Read live on every call, so a change applies on the very next frame even if no event arrives. */
export function reducedMotion(): boolean {
  const now = query.matches;
  if (now !== reduced) {
    reduced = now;
    for (const listener of listeners) listener(now);
  }
  return now;
}

query.addEventListener("change", () => reducedMotion());

export function onReducedMotionChange(listener: (reduced: boolean) => void): void {
  listeners.add(listener);
}

/** The page's own clock: every timed sequence is measured on it, hidden time included. */
export const now = (): number => performance.now();

export const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
/** Starts quickly, settles softly, never overshoots. */
export const easePrint = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInOut = (t: number): number => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

export const pageHidden = (): boolean => document.visibilityState === "hidden";
