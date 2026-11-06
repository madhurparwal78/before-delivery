// The Exposure Ring crossing sequence (Motion and effects, "Signature"). Each ring crossed plays
// four steps in order — fill, cut, count, preview — and moving back reverses them one hop at a time.
// Under reduced motion every step lands at once.
import { useEffect, useRef, useState } from "react";

const FILL_MS = 170;
const CUT_MS = 280;
const COUNT_MS = 440;
const COUNT_TICK_MS = 40;

export type Counts = readonly [publicCount: number, severedCount: number];

interface CrossingView {
  fillHop: number;
  cutHop: number;
  previewHop: number;
  counts: Counts;
  /** The hop the last finished crossing announced. */
  announcedHop: number;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useCrossing(target: number, countsAt: (hop: number) => Counts): CrossingView {
  const [view, setView] = useState<CrossingView>(() => ({
    fillHop: target, cutHop: target, previewHop: target, counts: countsAt(target), announcedHop: target,
  }));
  const busy = useRef(false);
  const targetRef = useRef(target);
  const countsRef = useRef(countsAt);
  const timers = useRef<number[]>([]);
  targetRef.current = target;
  countsRef.current = countsAt;

  const later = (ms: number, step: () => void) => {
    timers.current.push(window.setTimeout(step, ms));
  };

  const cross = (from: number) => {
    const goal = targetRef.current;
    if (from === goal) {
      busy.current = false;
      return;
    }
    if (prefersReducedMotion()) {
      setView({ fillHop: goal, cutHop: goal, previewHop: goal, counts: countsRef.current(goal), announcedHop: goal });
      busy.current = false;
      return;
    }
    busy.current = true;
    const next = from + Math.sign(goal - from);
    const [startN, startM] = countsRef.current(from);
    setView((v) => ({ ...v, fillHop: next }));
    later(FILL_MS, () => setView((v) => ({ ...v, cutHop: next })));
    const ticks = Math.round(COUNT_MS / COUNT_TICK_MS);
    for (let i = 1; i <= ticks; i += 1) {
      later(FILL_MS + CUT_MS + i * COUNT_TICK_MS, () => {
        const [endN, endM] = countsRef.current(next);
        const t = i / ticks;
        const eased = 1 - (1 - t) ** 2;
        setView((v) => ({ ...v, counts: [Math.round(startN + (endN - startN) * eased), Math.round(startM + (endM - startM) * eased)] }));
      });
    }
    later(FILL_MS + CUT_MS + COUNT_MS + COUNT_TICK_MS, () => {
      setView((v) => ({ ...v, previewHop: next, counts: countsRef.current(next), announcedHop: next }));
      cross(next);
    });
  };

  useEffect(() => {
    if (!busy.current) cross(view.previewHop);
  }, [target]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  return busy.current ? view : { ...view, counts: countsAt(view.previewHop) };
}
