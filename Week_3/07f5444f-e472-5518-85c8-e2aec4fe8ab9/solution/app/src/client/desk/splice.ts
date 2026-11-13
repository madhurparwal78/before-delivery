// The cut splice timeline, stepped by requestAnimationFrame (so the page clock drives it).
//   cut:     hatch sweep 100ms → collapse 330ms (later bars slide left) → count down 330ms → flags
//   restore: flags go → count up 330ms → widen 330ms (later bars slide right) → hatch clears 100ms

import type { SpliceFrame, Span } from "./Ruler";

const HATCH_MS = 100;
const COLLAPSE_MS = 330;
const COUNT_MS = 330;
const SPLICE_TOTAL_MS = HATCH_MS + COLLAPSE_MS + COUNT_MS;

export interface SpliceState {
  /** The span drawn mid-splice, or null once it has landed as a mark (or before it widens). */
  frame: SpliceFrame | null;
  /** Whether the span is still drawn as a cut (a restore drops it once the hatching has cleared). */
  spliced: boolean;
  /** The running time shown while it counts, in whole seconds. */
  seconds: number;
  done: boolean;
}

const clamp = (value: number): number => Math.min(Math.max(value, 0), 1);
const easeOut = (value: number): number => 1 - (1 - value) ** 3;

/** Whole seconds from `from` toward `to`, never stepping back past either end. */
function counted(from: number, to: number, progress: number): number {
  const travelled = Math.floor(Math.abs(to - from) * progress);
  return from + Math.sign(to - from) * travelled;
}

export function spliceAt(kind: "cut" | "restore", span: Span, fromSeconds: number, toSeconds: number, elapsed: number): SpliceState {
  if (kind === "cut") {
    const hatch = clamp(elapsed / HATCH_MS);
    const collapse = easeOut(clamp((elapsed - HATCH_MS) / COLLAPSE_MS));
    const count = clamp((elapsed - HATCH_MS - COLLAPSE_MS) / COUNT_MS);
    return {
      frame: collapse < 1 ? { ...span, hatch, collapse } : null,
      spliced: true,
      seconds: counted(fromSeconds, toSeconds, count),
      done: elapsed >= SPLICE_TOTAL_MS,
    };
  }
  const count = clamp(elapsed / COUNT_MS);
  const widen = easeOut(clamp((elapsed - COUNT_MS) / COLLAPSE_MS));
  const clear = clamp((elapsed - COUNT_MS - COLLAPSE_MS) / HATCH_MS);
  return {
    frame: elapsed >= COUNT_MS && clear < 1 ? { ...span, collapse: 1 - widen, hatch: 1 - clear } : null,
    spliced: clear < 1,
    seconds: counted(fromSeconds, toSeconds, count),
    done: elapsed >= SPLICE_TOTAL_MS,
  };
}
