/**
 * Numeral counts: readouts count from their previous value to the new one in about
 * 0.4 seconds, fast at first and slowing into the final figure. Under reduced
 * motion the final value shows with no counting.
 *
 * Counts the app fills in from its own data are plain digits with no separator.
 */

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "../state/app.js";

const COUNT_MS = 400;

/** Eases out so the figure slows into place. */
const easeOut = (t: number): number => 1 - (1 - t) ** 3;

export function useCountedValue(target: number, enabled = true): number {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef(0);

  useEffect(() => {
    if (reduced || !enabled) {
      fromRef.current = target;
      setShown(target);
      return;
    }
    const from = fromRef.current;
    if (from === target) return;

    const start = performance.now();
    const step = (now: number): void => {
      const progress = Math.min(1, (now - start) / COUNT_MS);
      const value = from + (target - from) * easeOut(progress);
      setShown(progress === 1 ? target : Math.round(value));
      if (progress < 1) frameRef.current = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, reduced, enabled]);

  return reduced || !enabled ? target : shown;
}

/** A whole-number readout that counts to its new value. */
export function CountedNumber({
  value,
  suffix = "",
  prefix = "",
}: {
  value: number;
  suffix?: string;
  prefix?: string;
}) {
  const shown = useCountedValue(value);
  return (
    <>
      {prefix}
      {Math.round(shown)}
      {suffix}
    </>
  );
}
