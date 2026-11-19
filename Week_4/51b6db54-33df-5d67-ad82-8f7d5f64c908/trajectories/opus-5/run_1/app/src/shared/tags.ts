import { rh } from './composite.js';
import type { TagDirection } from './types.js';

export type PreviewSpeed = 'Half' | 'Normal' | 'Double';

/** One pass of frame numbers for a tag range and direction. */
export function tagSequence(from: number, to: number, direction: TagDirection): number[] {
  const forward: number[] = [];
  for (let n = from; n <= to; n += 1) forward.push(n);
  if (direction === 'forward') return forward;
  if (direction === 'reverse') return [...forward].reverse();
  if (forward.length <= 2) return forward;
  const back = forward.slice(1, forward.length - 1).reverse();
  return [...forward, ...back];
}

/** The frame a stopping preview rests on after its last pass. */
export function finalFrame(from: number, to: number, direction: TagDirection): number {
  if (direction === 'forward') return to;
  if (direction === 'reverse') return from;
  return from;
}

export function frameDurationMs(durationMs: number, speed: PreviewSpeed): number {
  if (speed === 'Half') return durationMs * 2;
  if (speed === 'Double') return rh(durationMs, 2);
  return durationMs;
}
