import { useLayoutEffect, useRef, useState } from "preact/hooks";

const LIT_STEP_MS = 90;
const STOP_BAR_MS = 200;
const RETRACT_MS = 250;

const commonPrefix = (a: string[], b: string[]): number => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
};

interface LitRun {
  /** Segment ids lit so far, from the aircraft outward. */
  lit: string[];
  /** The holding point whose stop bar is down, once the last segment is lit. */
  stopBar: string | null;
}

/**
 * Centreline Run: lights `target` one segment at a time, drops the stop bar after the last one, and retracts from the
 * end back when the route shrinks. Under reduced motion every end state is reached in one frame.
 */
export function useLitRun(target: string[], stop: string | null, reduced: boolean): LitRun {
  const [lit, setLit] = useState<string[]>([]);
  const [barOn, setBarOn] = useState(false);
  const current = useRef<string[]>([]);
  const key = target.join(",");

  useLayoutEffect(() => {
    const goal = key === "" ? [] : key.split(",");
    let timer: number | undefined;
    let barTimer: number | undefined;
    const show = (next: string[]): void => {
      current.current = next;
      setLit(next);
    };
    if (reduced) {
      show(goal);
      setBarOn(goal.length > 0 && stop !== null);
      return;
    }
    setBarOn(false);
    const retracting = current.current.length - commonPrefix(current.current, goal);
    const retractStep = retracting > 0 ? RETRACT_MS / retracting : 0;
    const next = (): void => {
      const have = current.current;
      if (have.length > commonPrefix(have, goal)) {
        show(have.slice(0, -1));
        timer = window.setTimeout(next, retractStep);
      } else if (have.length < goal.length) {
        show([...have, goal[have.length] ?? ""]);
        timer = window.setTimeout(next, LIT_STEP_MS);
      }
      if (current.current.length === goal.length && goal.length > 0 && stop !== null && barTimer === undefined) {
        barTimer = window.setTimeout(() => setBarOn(true), STOP_BAR_MS);
      }
    };
    next();
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(barTimer);
    };
  }, [key, stop, reduced]);

  return { lit, stopBar: barOn ? stop : null };
}
