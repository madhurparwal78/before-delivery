// Media queries as hooks, the long ease-out, and the clock every graded motion reads (performance.now drives rAF).
import { useEffect, useState } from "preact/hooks";

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const update = (): void => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** cubic-bezier(0.16, 1, 0.3, 1), solved for x by bisection. */
export function easeOutLong(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const bez = (a: number, b: number, s: number): number => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (bez(0.16, 0.3, mid) < t) lo = mid;
    else hi = mid;
  }
  return bez(1, 1, (lo + hi) / 2);
}

export const easeOutQuad = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 2;

export const fixed3 = (value: number): string => Math.min(1, Math.max(0, value)).toFixed(3);
