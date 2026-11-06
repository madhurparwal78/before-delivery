// The pool placement sequence (brief: Motion and effects → Signature): cone, pool, tint, count, then settled,
// within 1.5 s. Timings in ms from the moment the fitting is placed.
type Phase = "cone" | "pool" | "tint" | "count" | "settled";

const CONE = { start: 0, length: 330 };
const POOL = { start: 330, length: 400 };
const TINT = { start: 570, length: 330 };
const COUNT = { start: 900, length: 400 };
export const SEQUENCE_END = COUNT.start + COUNT.length;

export interface SequenceProgress {
  cone: number;
  pool: number;
  tint: number;
  count: number;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Springs very slightly past 1 and back. */
function spring(t: number): number {
  if (t >= 1) return 1;
  return 1 - Math.exp(-6 * t) * Math.cos(t * Math.PI * 1.25) + 0.06 * Math.sin(t * Math.PI) * (1 - t);
}

export function phaseAt(elapsed: number): Phase {
  if (elapsed < POOL.start) return "cone";
  if (elapsed < TINT.start) return "pool";
  if (elapsed < COUNT.start) return "tint";
  if (elapsed < SEQUENCE_END) return "count";
  return "settled";
}

export function progressAt(elapsed: number): SequenceProgress {
  return {
    cone: easeOut(clamp((elapsed - CONE.start) / CONE.length)),
    pool: spring(clamp((elapsed - POOL.start) / POOL.length)),
    tint: clamp((elapsed - TINT.start) / TINT.length),
    count: easeOut(clamp((elapsed - COUNT.start) / COUNT.length)),
  };
}

export const SETTLED: SequenceProgress = { cone: 1, pool: 1, tint: 1, count: 1 };
