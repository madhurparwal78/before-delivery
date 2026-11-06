// The Coverage tide's timing: every movement starts quickly and settles softly, just under half a
// second, driven by animation frames. Reduced motion jumps straight to the end.

import { prefersReducedMotion } from "../hooks";

const TIDE_MS = 450;

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Calls `frame` with eased progress 0..1 until done; returns a cancel function. */
export function tide(frame: (progress: number) => void): () => void {
  if (prefersReducedMotion()) {
    frame(1);
    return () => undefined;
  }
  const began = performance.now();
  let handle = requestAnimationFrame(function step() {
    const t = Math.min(1, (performance.now() - began) / TIDE_MS);
    frame(easeOut(t));
    if (t < 1) handle = requestAnimationFrame(step);
  });
  return () => cancelAnimationFrame(handle);
}

/** `tide` as whole thousandths of the eased progress (0n..1000n), for exact bigint interpolation. */
export function tidePermille(frame: (permille: bigint) => void): () => void {
  return tide((progress) => frame(BigInt(Math.min(1000, Math.max(0, Math.round(progress * 1000))))));
}
