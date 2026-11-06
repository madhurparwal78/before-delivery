// Ops on a block's edit text, and the transform shared by the server merge and the browser rebase.
// Offsets and lengths count UTF-16 code units. Op lists always cover the whole base text.

export type Op = { retain: number } | { insert: string } | { delete: number };

export const MAX_OPS = 1000;

type Kind = 'retain' | 'insert' | 'delete';

function kindOf(op: Op): Kind {
  if ('insert' in op) return 'insert';
  return 'retain' in op ? 'retain' : 'delete';
}

function opLength(op: Op): number {
  if ('insert' in op) return op.insert.length;
  return 'retain' in op ? op.retain : op.delete;
}

/** Counts retains and deletes: the length of text an op list applies to. */
function baseLengthOf(ops: Op[]): number {
  let n = 0;
  for (const op of ops) if (!('insert' in op)) n += opLength(op);
  return n;
}

function isPositiveInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isOp(value: unknown): value is Op {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 1) return false;
  const record = value as Record<string, unknown>;
  switch (keys[0]) {
    case 'retain':
      return isPositiveInteger(record.retain);
    case 'delete':
      return isPositiveInteger(record.delete);
    case 'insert':
      return typeof record.insert === 'string' && record.insert.length > 0;
    default:
      return false;
  }
}

export function opsFit(value: unknown, baseLength: number): value is Op[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_OPS) return false;
  if (!value.every(isOp)) return false;
  return baseLengthOf(value) === baseLength;
}

/** Appends an op, merging it into the last one when they are the same kind; empty ops are skipped. */
function pushOp(out: Op[], op: Op): void {
  if (opLength(op) === 0) return;
  const last = out[out.length - 1];
  if (last !== undefined && kindOf(last) === kindOf(op)) {
    if ('insert' in last && 'insert' in op) out[out.length - 1] = { insert: last.insert + op.insert };
    else if ('retain' in last && 'retain' in op) out[out.length - 1] = { retain: last.retain + op.retain };
    else if ('delete' in last && 'delete' in op) out[out.length - 1] = { delete: last.delete + op.delete };
    return;
  }
  out.push(op);
}

export function normaliseOps(ops: Op[]): Op[] {
  const out: Op[] = [];
  for (const op of ops) pushOp(out, op);
  return out;
}

type Cursor = { ops: Op[]; index: number; offset: number };

function cursor(ops: Op[]): Cursor {
  return { ops, index: 0, offset: 0 };
}

function kindAt(c: Cursor): Kind | undefined {
  return c.index < c.ops.length ? kindOf(c.ops[c.index]) : undefined;
}

function remaining(c: Cursor): number {
  return c.index < c.ops.length ? opLength(c.ops[c.index]) - c.offset : 0;
}

/** Takes up to `max` units of the current op. */
function take(c: Cursor, max: number): Op {
  const op = c.ops[c.index];
  const n = Math.min(max, opLength(op) - c.offset);
  let piece: Op;
  if ('insert' in op) piece = { insert: op.insert.slice(c.offset, c.offset + n) };
  else if ('retain' in op) piece = { retain: n };
  else piece = { delete: n };
  c.offset += n;
  if (c.offset === opLength(op)) {
    c.index += 1;
    c.offset = 0;
  }
  return piece;
}

function sameBase(): never {
  throw new RangeError('The op lists were not made against texts of the same length.');
}

type Footprint = { deletes: Array<[number, number]>; inserts: number[] };

/** Deleted ranges (contiguous ones merged, even across this side's own inserts) and insert offsets, in base offsets. */
function footprint(ops: Op[]): Footprint {
  const deletes: Array<[number, number]> = [];
  const inserts: number[] = [];
  let pos = 0;
  for (const op of ops) {
    if ('retain' in op) pos += op.retain;
    else if ('insert' in op) inserts.push(pos);
    else {
      const last = deletes[deletes.length - 1];
      if (last !== undefined && last[1] === pos) last[1] = pos + op.delete;
      else deletes.push([pos, pos + op.delete]);
      pos += op.delete;
    }
  }
  return { deletes, inserts };
}

function insertInsideDelete(inserts: number[], deletes: Array<[number, number]>): boolean {
  return inserts.some((p) => deletes.some(([start, end]) => start < p && p < end));
}

/** The conflict cases that ops alone can show (Business rules, Transform). */
function isConflict(a: Op[], b: Op[]): boolean {
  const fa = footprint(a);
  const fb = footprint(b);
  const deletesOverlap = fa.deletes.some(([s1, e1]) => fb.deletes.some(([s2, e2]) => Math.min(e1, e2) - Math.max(s1, s2) > 0));
  return deletesOverlap || insertInsideDelete(fa.inserts, fb.deletes) || insertInsideDelete(fb.inserts, fa.deletes);
}

export function transformPair(committed: Op[], incoming: Op[]): { incoming: Op[]; committed: Op[] } | null {
  if (isConflict(committed, incoming)) return null;
  const c = cursor(committed);
  const i = cursor(incoming);
  const committedOut: Op[] = [];
  const incomingOut: Op[] = [];
  for (;;) {
    const kc = kindAt(c);
    const ki = kindAt(i);
    // At the same offset the committed insert goes first.
    if (kc === 'insert') {
      const piece = take(c, Infinity);
      pushOp(committedOut, piece);
      pushOp(incomingOut, { retain: opLength(piece) });
      continue;
    }
    if (ki === 'insert') {
      const piece = take(i, Infinity);
      pushOp(incomingOut, piece);
      pushOp(committedOut, { retain: opLength(piece) });
      continue;
    }
    if (kc === undefined || ki === undefined) {
      if (kc !== ki) sameBase();
      break;
    }
    const n = Math.min(remaining(c), remaining(i));
    take(c, n);
    take(i, n);
    if (kc === 'retain' && ki === 'retain') {
      pushOp(committedOut, { retain: n });
      pushOp(incomingOut, { retain: n });
    } else if (kc === 'delete' && ki === 'retain') {
      pushOp(committedOut, { delete: n });
    } else if (kc === 'retain' && ki === 'delete') {
      pushOp(incomingOut, { delete: n });
    }
  }
  return { incoming: incomingOut, committed: committedOut };
}

export function applyToText(text: string, ops: Op[]): string {
  let out = '';
  let pos = 0;
  for (const op of ops) {
    if ('retain' in op) {
      out += text.slice(pos, pos + op.retain);
      pos += op.retain;
    } else if ('insert' in op) {
      out += op.insert;
    } else {
      pos += op.delete;
    }
  }
  return out + text.slice(pos);
}

export function transformOffset(offset: number, ops: Op[]): number {
  let moved = offset;
  let pos = 0;
  for (const op of ops) {
    if ('insert' in op) {
      if (pos <= offset) moved += op.insert.length;
    } else if ('retain' in op) {
      pos += op.retain;
    } else {
      if (offset >= pos + op.delete) moved -= op.delete;
      else if (offset > pos) moved -= offset - pos;
      pos += op.delete;
    }
    if (pos > offset) break;
  }
  return moved;
}

export function invertOps(ops: Op[], text: string): Op[] {
  const out: Op[] = [];
  let pos = 0;
  for (const op of ops) {
    if ('retain' in op) {
      pushOp(out, op);
      pos += op.retain;
    } else if ('insert' in op) {
      pushOp(out, { delete: op.insert.length });
    } else {
      pushOp(out, { insert: text.slice(pos, pos + op.delete) });
      pos += op.delete;
    }
  }
  return out;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

export function diffOps(before: string, after: string): Op[] {
  if (before === after) return [];
  const max = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < max && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix += 1;
  // Never split a surrogate pair between the kept and the changed region.
  if (prefix > 0 && isHighSurrogate(before.charCodeAt(prefix - 1))) prefix -= 1;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  if (suffix > 0 && isLowSurrogate(before.charCodeAt(before.length - suffix))) suffix -= 1;
  const out: Op[] = [];
  pushOp(out, { retain: prefix });
  pushOp(out, { delete: before.length - prefix - suffix });
  pushOp(out, { insert: after.slice(prefix, after.length - suffix) });
  pushOp(out, { retain: suffix });
  return out;
}

export function composeOps(a: Op[], b: Op[]): Op[] {
  const ca = cursor(a);
  const cb = cursor(b);
  const out: Op[] = [];
  for (;;) {
    const ka = kindAt(ca);
    const kb = kindAt(cb);
    if (ka === 'delete') {
      pushOp(out, take(ca, Infinity));
      continue;
    }
    if (kb === 'insert') {
      pushOp(out, take(cb, Infinity));
      continue;
    }
    if (ka === undefined || kb === undefined) {
      if (ka !== kb) sameBase();
      break;
    }
    const n = Math.min(remaining(ca), remaining(cb));
    const piece = take(ca, n);
    take(cb, n);
    if (kb === 'retain') pushOp(out, piece);
    else if (ka === 'retain') pushOp(out, { delete: n });
    // An insert from `a` deleted by `b` leaves nothing.
  }
  return out;
}
