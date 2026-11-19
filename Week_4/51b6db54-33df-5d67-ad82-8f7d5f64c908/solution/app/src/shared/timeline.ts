import { rh, type Direction } from './rules';

export interface Tag {
  id: number;
  name: string;
  from: number;
  to: number;
  direction: Direction;
  repeat: number;
}

export type Speed = 'Half' | 'Normal' | 'Double';
export const SPEEDS: readonly Speed[] = ['Half', 'Normal', 'Double'];

/** One pass of a tag: forward, reverse, or pingpong (end frames never repeat). */
export function tagSequence(from: number, to: number, direction: Direction): number[] {
  const forward = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  if (direction === 'forward') return forward;
  if (direction === 'reverse') return [...forward].reverse();
  const back = Array.from({ length: Math.max(0, to - from - 1) }, (_, i) => to - 1 - i);
  return [...forward, ...back];
}

/** How long a frame shows: Half 2 x, Normal 1 x, Double rh(ms, 2). */
export function shownMs(durationMs: number, speed: Speed): number {
  if (speed === 'Half') return durationMs * 2;
  return speed === 'Double' ? rh(durationMs, 2) : durationMs;
}

export interface PreviewPlan {
  /** The frames of one pass. */
  sequence: number[];
  /** 0 plays forever. */
  repeat: number;
  /** The frame shown once more after the last pass, for pingpong. */
  closing: number | null;
}

export function previewPlan(tag: Tag | null, frameCount: number): PreviewPlan {
  if (!tag) return { sequence: Array.from({ length: frameCount }, (_, i) => i + 1), repeat: 0, closing: null };
  return {
    sequence: tagSequence(tag.from, tag.to, tag.direction),
    repeat: tag.repeat,
    closing: tag.direction === 'pingpong' ? tag.from : null,
  };
}

export interface PreviewCursor {
  position: number;
  pass: number;
  finished: boolean;
}

/** The cursor after the current frame's time is up. */
export function advancePreview(plan: PreviewPlan, cursor: PreviewCursor): PreviewCursor {
  if (cursor.finished) return cursor;
  const last = plan.sequence.length - 1;
  if (cursor.position === plan.sequence.length) return { ...cursor, finished: true };
  if (cursor.position < last) return { ...cursor, position: cursor.position + 1 };
  if (plan.repeat !== 0 && cursor.pass >= plan.repeat) {
    return plan.closing === null ? { ...cursor, finished: true } : { ...cursor, position: plan.sequence.length };
  }
  return { position: 0, pass: cursor.pass + 1, finished: false };
}

/** The frame a cursor shows. */
export const previewFrame = (plan: PreviewPlan, cursor: PreviewCursor): number =>
  cursor.position === plan.sequence.length ? (plan.closing ?? 1) : (plan.sequence[cursor.position] ?? 1);

/** Step controls: one pass, wrapping at its ends. */
export function stepPreview(plan: PreviewPlan, position: number, delta: 1 | -1): number {
  const count = plan.sequence.length;
  return (((position + delta) % count) + count) % count;
}
