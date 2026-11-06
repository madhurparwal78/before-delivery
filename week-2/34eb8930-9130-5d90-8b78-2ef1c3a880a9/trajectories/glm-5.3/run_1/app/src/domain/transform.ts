import type { Op } from './ot.js';

/**
 * A change the server has already applied, in the order it received it.
 * Used to transform each incoming op against every change made after its baseRevision.
 */
export type AppliedChange =
  | { kind: 'insert'; at: number; length: number }
  | { kind: 'delete'; from: number; cut: number };

/**
 * Transforms an incoming op against one applied insert. Inserts land after text the
 * server received earlier, so an insert at the same offset shifts right (DP-11).
 */
export function transformAgainstInsert(op: Op, p: number, len: number): Op[] {
  if ('delete' in op) {
    const end = op.at + op.delete;
    if (op.at >= p) return [{ ...op, at: op.at + len }];
    if (end <= p) return [op];
    // the insert splits the deleted range; the new text survives
    const left = p - op.at;
    const right = op.delete - left;
    const out: Op[] = [{ delete: left, at: op.at }];
    if (right > 0) out.push({ delete: right, at: p + len });
    return out;
  }
  if ('mark' in op) {
    const end = op.at + op.length;
    if (op.at >= p) return [{ ...op, at: op.at + len }];
    if (end <= p) return [op];
    const left = p - op.at;
    const right = op.length - left;
    const out: Op[] = [{ ...op, at: op.at, length: left }];
    if (right > 0) out.push({ ...op, at: p + len, length: right });
    return out;
  }
  // insert and style: a single position
  return [{ ...op, at: op.at >= p ? op.at + len : op.at }];
}

/** Position of an offset after [from, from+cut) was removed. */
function moveDelete(offset: number, from: number, cut: number): number {
  if (offset <= from) return offset;
  if (offset >= from + cut) return offset - cut;
  return from;
}

/** Transforms an incoming op against one applied delete; overlapping deletes remove each character once. */
export function transformAgainstDelete(op: Op, from: number, cut: number): Op[] {
  const end = from + cut;
  if ('insert' in op || 'style' in op) {
    return [{ ...op, at: moveDelete(op.at, from, cut) }];
  }
  if ('mark' in op) {
    const at = moveDelete(op.at, from, cut);
    const opEnd = moveDelete(op.at + op.length, from, cut);
    const length = Math.max(0, opEnd - at);
    if (length === 0) return [];
    return [{ ...op, at, length }];
  }
  if ('delete' in op) {
    const dEnd = op.at + op.delete;
    if (dEnd <= from) return [op];
    if (op.at >= end) return [{ ...op, at: op.at - cut }];
    const overlap = Math.max(0, Math.min(dEnd, end) - Math.max(op.at, from));
    const newLen = op.delete - overlap;
    const newAt = moveDelete(op.at, from, cut);
    if (newLen <= 0) return [];
    return [{ delete: newLen, at: newAt }];
  }
  return [op];
}

/** Transforms an op against one applied change, possibly splitting it into several ops. */
export function transformAgainstApplied(op: Op, applied: AppliedChange): Op[] {
  if (applied.kind === 'insert') return transformAgainstInsert(op, applied.at, applied.length);
  return transformAgainstDelete(op, applied.from, applied.cut);
}

/** Transforms an op against a whole run of applied changes, in server order. */
export function transformAll(op: Op, applied: AppliedChange[]): Op[] {
  let cur: Op[] = [op];
  for (const a of applied) {
    const next: Op[] = [];
    for (const o of cur) next.push(...transformAgainstApplied(o, a));
    cur = next;
  }
  return cur;
}
