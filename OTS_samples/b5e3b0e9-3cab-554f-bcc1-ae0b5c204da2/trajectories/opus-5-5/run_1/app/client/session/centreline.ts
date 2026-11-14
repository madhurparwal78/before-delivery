import { useLayoutEffect, useRef, useState } from 'preact/hooks';

export interface RunTarget {
  route: string[];
  stop: string | null;
  /** Changes when the run must jump to its target in one frame, as after an accepted clearance. */
  instant: number;
}

const LIGHT_INTERVAL_MS = 90;
const STOP_BAR_DELAY_MS = 200;
const RETRACT_TOTAL_MS = 250;

/**
 * Centreline Run: lights the previewed route one segment at a time from the aircraft outward,
 * drops the stop bar after the last segment, and retracts from the end when the route shrinks.
 */
export function useCentrelineRun(target: RunTarget, reduced: boolean): { lit: string[]; stopBar: string | null } {
  const [lit, setLit] = useState<string[]>([]);
  const [stopBar, setStopBar] = useState<string | null>(null);
  const litRef = useRef<string[]>([]);
  const barRef = useRef<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const lastInstant = useRef(target.instant);

  const key = `${target.route.join(' ')}|${target.stop ?? ''}`;
  useLayoutEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const showLit = (next: string[]) => {
      litRef.current = next;
      setLit(next);
    };
    const showBar = (next: string | null) => {
      barRef.current = next;
      setStopBar(next);
    };
    const finalBar = target.route.length > 0 ? target.stop : null;
    const jump = reduced || lastInstant.current !== target.instant;
    lastInstant.current = target.instant;
    if (jump) {
      showLit(target.route);
      showBar(finalBar);
      return;
    }
    const current = litRef.current;
    let common = 0;
    while (common < current.length && common < target.route.length && current[common] === target.route[common]) common++;
    const schedule = (delay: number, step: () => void) => {
      if (delay <= 0) step();
      else timers.current.push(setTimeout(step, delay));
    };
    let at = 0;
    const retracting = current.length > common;
    if (barRef.current !== null && (retracting || barRef.current !== finalBar)) showBar(null);
    if (retracting) {
      const count = current.length - common;
      const interval = RETRACT_TOTAL_MS / count;
      for (let i = 1; i <= count; i++) {
        const next = current.slice(0, current.length - i);
        at = interval * i;
        schedule(at, () => showLit(next));
      }
    }
    for (let i = common; i < target.route.length; i++) {
      const next = target.route.slice(0, i + 1);
      schedule(at, () => showLit(next));
      at += LIGHT_INTERVAL_MS;
    }
    if (finalBar !== null && barRef.current !== finalBar) {
      const lastLitAt = target.route.length > common ? at - LIGHT_INTERVAL_MS : at;
      schedule(lastLitAt + STOP_BAR_DELAY_MS, () => showBar(finalBar));
    }
  }, [key, reduced, target.instant]);

  useLayoutEffect(() => () => timers.current.forEach(clearTimeout), []);
  return { lit, stopBar };
}
