/**
 * The single home of the op transform and the conflict cases, shared by the
 * server merge and the browser rebase.
 */
import { FlatItem, Mark, PLAIN_MARK, ContainerKind, editTextOfItems } from './richtext';

export type Op = { retain: number } | { insert: string } | { delete: number };

export const MAX_OPS_PER_REQUEST = 1000;

export function isRetain(op: Op): op is { retain: number } {
  return typeof (op as { retain?: unknown }).retain === 'number';
}
export function isInsert(op: Op): op is { insert: string } {
  return typeof (op as { insert?: unknown }).insert === 'string';
}
export function isDelete(op: Op): op is { delete: number } {
  return typeof (op as { delete?: unknown }).delete === 'number';
}

export function parseOps(value: unknown): Op[] | null {
  if (!Array.isArray(value)) return null;
  const ops: Op[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const keys = Object.keys(raw as Record<string, unknown>);
    if (keys.length !== 1) return null;
    const record = raw as Record<string, unknown>;
    if (keys[0] === 'retain' || keys[0] === 'delete') {
      const count = record[keys[0]];
      if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) return null;
      ops.push(keys[0] === 'retain' ? { retain: count } : { delete: count });
      continue;
    }
    if (keys[0] === 'insert') {
      const text = record['insert'];
      if (typeof text !== 'string' || text.length === 0) return null;
      ops.push({ insert: text });
      continue;
    }
    return null;
  }
  return ops;
}

/** The length of the edit text the ops expect: retains plus deletes. */
export function baseLength(ops: Op[]): number {
  let total = 0;
  for (const op of ops) {
    if (isRetain(op)) total += op.retain;
    else if (isDelete(op)) total += op.delete;
  }
  return total;
}

function addRetain(ops: Op[], count: number): void {
  if (count <= 0) return;
  const last = ops[ops.length - 1];
  if (last !== undefined && isRetain(last)) ops[ops.length - 1] = { retain: last.retain + count };
  else ops.push({ retain: count });
}

function addDelete(ops: Op[], count: number): void {
  if (count <= 0) return;
  const last = ops[ops.length - 1];
  if (last !== undefined && isDelete(last)) ops[ops.length - 1] = { delete: last.delete + count };
  else ops.push({ delete: count });
}

function addInsert(ops: Op[], text: string): void {
  if (text.length === 0) return;
  const last = ops[ops.length - 1];
  if (last !== undefined && isInsert(last)) ops[ops.length - 1] = { insert: last.insert + text };
  else ops.push({ insert: text });
}

/**
 * Classic operational transform. `a` has priority: on inserts at the same
 * offset, a's insert comes first.
 */
export function transform(a: Op[], b: Op[]): { aPrime: Op[]; bPrime: Op[] } {
  const aPrime: Op[] = [];
  const bPrime: Op[] = [];
  let i = 0;
  let j = 0;
  let opA: Op | undefined = a[i++];
  let opB: Op | undefined = b[j++];
  for (;;) {
    if (opA === undefined && opB === undefined) break;
    if (opA !== undefined && isInsert(opA)) {
      addInsert(aPrime, opA.insert);
      addRetain(bPrime, opA.insert.length);
      opA = a[i++];
      continue;
    }
    if (opB !== undefined && isInsert(opB)) {
      addRetain(aPrime, opB.insert.length);
      addInsert(bPrime, opB.insert);
      opB = b[j++];
      continue;
    }
    if (opA === undefined) {
      if (opB !== undefined && isRetain(opB)) addRetain(aPrime, opB.retain);
      opB = b[j++];
      continue;
    }
    if (opB === undefined) {
      if (isRetain(opA)) addRetain(bPrime, opA.retain);
      opA = a[i++];
      continue;
    }
    const lenA: number = isRetain(opA) ? opA.retain : (opA as { delete: number }).delete;
    const lenB: number = isRetain(opB) ? opB.retain : (opB as { delete: number }).delete;
    const shared = Math.min(lenA, lenB);
    if (isRetain(opA) && isRetain(opB)) {
      addRetain(aPrime, shared);
      addRetain(bPrime, shared);
    } else if (isDelete(opA) && isDelete(opB)) {
      // both removed the same characters: nothing left to do on either side
    } else if (isDelete(opA) && isRetain(opB)) {
      addDelete(aPrime, shared);
    } else {
      addDelete(bPrime, shared);
    }
    if (lenA === shared) opA = a[i++];
    else opA = isRetain(opA) ? { retain: lenA - shared } : { delete: lenA - shared };
    if (lenB === shared) opB = b[j++];
    else opB = isRetain(opB) ? { retain: lenB - shared } : { delete: lenB - shared };
  }
  return { aPrime, bPrime };
}

/** Transform an incoming edit over an already committed one; the committed ops win ties. */
export function transformOverCommitted(incoming: Op[], committed: Op[]): Op[] {
  return transform(committed, incoming).bPrime;
}

type Span =
  | { type: 'insert'; pos: number; text: string }
  | { type: 'delete'; start: number; end: number };

export function spansOf(ops: Op[]): Span[] {
  const spans: Span[] = [];
  let pos = 0;
  for (const op of ops) {
    if (isRetain(op)) {
      pos += op.retain;
    } else if (isDelete(op)) {
      spans.push({ type: 'delete', start: pos, end: pos + op.delete });
      pos += op.delete;
    } else {
      spans.push({ type: 'insert', pos, text: op.insert });
    }
  }
  return spans;
}

/**
 * The published conflict cases between an incoming edit and one already
 * committed edit, both expressed against the same base version.
 */
export function hasOpConflict(incoming: Op[], committed: Op[]): boolean {
  const mine = spansOf(incoming);
  const theirs = spansOf(committed);
  for (const a of mine) {
    for (const b of theirs) {
      if (a.type === 'delete' && b.type === 'delete') {
        const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
        if (overlap > 0) return true;
      } else if (a.type === 'insert' && b.type === 'delete') {
        if (a.pos > b.start && a.pos < b.end) return true;
      } else if (a.type === 'delete' && b.type === 'insert') {
        if (b.pos > a.start && b.pos < a.end) return true;
      }
    }
  }
  return false;
}

/** Apply ops to the flat items of a block body. */
export function applyOps(items: FlatItem[], ops: Op[]): FlatItem[] {
  const out: FlatItem[] = [];
  let index = 0;
  const markBefore = (): { mark: Mark; container: ContainerKind } => {
    for (let k = out.length - 1; k >= 0; k -= 1) {
      const item = out[k];
      if (item.kind === 'text') return { mark: item.mark, container: item.container };
    }
    for (let k = index; k < items.length; k += 1) {
      const item = items[k];
      if (item.kind === 'text') return { mark: item.mark, container: item.container };
    }
    const near = out[out.length - 1] ?? items[index];
    return { mark: PLAIN_MARK, container: near === undefined ? 'p' : near.container };
  };
  for (const op of ops) {
    if (isRetain(op)) {
      for (let k = 0; k < op.retain; k += 1) {
        const item = items[index++];
        if (item !== undefined) out.push(item);
      }
      continue;
    }
    if (isDelete(op)) {
      index += op.delete;
      continue;
    }
    const { mark, container } = markBefore();
    for (let k = 0; k < op.insert.length; k += 1) {
      const ch = op.insert.charAt(k);
      if (ch === '\n') out.push({ kind: 'br', container });
      else out.push({ kind: 'text', ch, mark: { ...mark }, container });
    }
  }
  while (index < items.length) out.push(items[index++]);
  return out;
}

/** Apply ops to a plain string, for carets and drafts. */
export function applyOpsToText(text: string, ops: Op[]): string {
  let out = '';
  let index = 0;
  for (const op of ops) {
    if (isRetain(op)) {
      out += text.slice(index, index + op.retain);
      index += op.retain;
    } else if (isDelete(op)) {
      index += op.delete;
    } else {
      out += op.insert;
    }
  }
  out += text.slice(index);
  return out;
}

/** Move a caret offset through ops, keeping it on the same character. */
export function transformOffset(offset: number, ops: Op[], ownEdit: boolean): number {
  let result = offset;
  let pos = 0;
  for (const op of ops) {
    if (isRetain(op)) {
      pos += op.retain;
    } else if (isInsert(op)) {
      if (pos < offset || (pos === offset && ownEdit)) result += op.insert.length;
      pos += 0;
    } else {
      const start = pos;
      const end = pos + op.delete;
      if (offset > end) result -= op.delete;
      else if (offset > start) result -= offset - start;
      pos += op.delete;
    }
  }
  return Math.max(0, result);
}

/** The ops that turn one text into another, as a single replace of the changed middle. */
export function diffToOps(before: string, after: string): Op[] {
  if (before === after) return [];
  let prefix = 0;
  const max = Math.min(before.length, after.length);
  while (prefix < max && before.charAt(prefix) === after.charAt(prefix)) prefix += 1;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    before.charAt(before.length - 1 - suffix) === after.charAt(after.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  const ops: Op[] = [];
  if (prefix > 0) ops.push({ retain: prefix });
  const deleted = before.length - prefix - suffix;
  if (deleted > 0) ops.push({ delete: deleted });
  const inserted = after.slice(prefix, after.length - suffix);
  if (inserted.length > 0) ops.push({ insert: inserted });
  if (suffix > 0) ops.push({ retain: suffix });
  return ops;
}

