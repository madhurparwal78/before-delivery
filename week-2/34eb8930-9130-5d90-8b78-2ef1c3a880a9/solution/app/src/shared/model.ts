import {
  BLOCK_STYLES, MAX_DOC_CHARS, MAX_INSERT_CHARS, MAX_LINK_CHARS, TOGGLE_MARKS,
  type Block, type BlockStyle, type Decision, type EditMode, type Mark, type Op, type Range, type SaveState, type SuggestionKind,
} from "./types.js";

/** An open suggestion span as the document model holds it (author by id). */
export interface Span {
  id: string;
  kind: SuggestionKind;
  authorId: string;
  inserted: Range | null;
  deleted: Range | null;
  contentDeleted: boolean;
  createdAt: string;
}

/** A comment anchor; `range` becomes null for good once all of its text is deleted. */
interface Anchor { id: string; range: Range | null }

export interface ProposalState {
  text: string;
  styles: BlockStyle[];
  marks: Mark[];
  spans: Span[];
  anchors: Anchor[];
}

/** A physical text change, in order; the transform maps positions through these. */
export type Change = { ins: number; len: number } | { del: number; len: number };

export class OpError extends Error {
  constructor(readonly code: "invalid" | "too_large") { super(code); }
}

interface ApplyContext {
  authorId: string;
  mode: EditMode;
  newId: () => string;
  now: string;
}

interface ApplyResult {
  changes: Change[];
  created: Span[];
  withdrawn: Span[];
}

export function emptyProposal(): ProposalState {
  return { text: "", styles: ["paragraph"], marks: [], spans: [], anchors: [] };
}

export function cloneProposal(d: ProposalState): ProposalState {
  return {
    text: d.text,
    styles: [...d.styles],
    marks: d.marks.map((m) => ({ ...m })),
    spans: d.spans.map((s) => ({ ...s, inserted: s.inserted && { ...s.inserted }, deleted: s.deleted && { ...s.deleted } })),
    anchors: d.anchors.map((a) => ({ id: a.id, range: a.range && { ...a.range } })),
  };
}

export function blocksOf(d: ProposalState): Block[] {
  const out: Block[] = [];
  let at = 0;
  d.text.split("\n").forEach((line, i) => {
    out.push({ style: d.styles[i] ?? "paragraph", at, length: line.length });
    at += line.length + 1;
  });
  return out;
}

export function proposalFromStyles(text: string, styles: BlockStyle[]): ProposalState {
  const proposal = emptyProposal();
  proposal.text = text;
  proposal.styles = styles;
  return proposal;
}

const end = (r: Range): number => r.at + r.length;
const count = (s: string, ch: string): number => s.split(ch).length - 1;
const isHeading = (s: BlockStyle): boolean => s === "title" || s.startsWith("heading");
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F]/;

function isInt(n: unknown): n is number { return typeof n === "number" && Number.isInteger(n); }

/** Every open span's ranges, for shifting. */
function ranges(d: ProposalState): Range[] {
  const out: Range[] = [];
  for (const s of d.spans) {
    if (s.inserted) out.push(s.inserted);
    if (s.deleted) out.push(s.deleted);
  }
  for (const a of d.anchors) if (a.range) out.push(a.range);
  return out;
}

function insertRaw(d: ProposalState, at: number, s: string, changes: Change[]): void {
  const len = s.length;
  const before = d.text.slice(0, at);
  const lines = count(s, "\n");
  if (lines) {
    const block = count(before, "\n");
    const nextBreak = d.text.indexOf("\n", at);
    const atBlockEnd = at === (nextBreak === -1 ? d.text.length : nextBreak);
    const style = d.styles[block];
    const added: BlockStyle = atBlockEnd && isHeading(style) ? "paragraph" : style;
    d.styles.splice(block + 1, 0, ...Array<BlockStyle>(lines).fill(added));
  }
  d.text = before + s + d.text.slice(at);
  for (const m of d.marks) {
    const e = end(m);
    if (at <= m.at) m.at += len;
    else if (at < e || (at === e && m.type !== "link")) m.length += len;
  }
  for (const r of ranges(d)) {
    if (at <= r.at) r.at += len;
    else if (at < end(r)) r.length += len;
  }
  changes.push({ ins: at, len });
}

function mapThroughDelete(p: number, at: number, len: number): number {
  if (p <= at) return p;
  if (p >= at + len) return p - len;
  return at;
}

function deleteRaw(d: ProposalState, at: number, len: number, changes: Change[]): void {
  const block = count(d.text.slice(0, at), "\n");
  d.styles.splice(block + 1, count(d.text.slice(at, at + len), "\n"));
  d.text = d.text.slice(0, at) + d.text.slice(at + len);
  const remap = (r: Range): void => {
    const s = mapThroughDelete(r.at, at, len);
    r.length = mapThroughDelete(end(r), at, len) - s;
    r.at = s;
  };
  d.marks.forEach(remap);
  d.marks = d.marks.filter((m) => m.length > 0);
  ranges(d).forEach(remap);
  changes.push({ del: at, len });
}

function spanLength(s: Span): number {
  return (s.inserted?.length ?? 0) + (s.deleted?.length ?? 0);
}

/**
 * Suggestion crediting after a physical removal (Business rules, Suggestions): in Suggesting mode
 * the typist's own insertion that loses all its text is withdrawn; any other span whose text is
 * all gone reads Original content deleted. Comment anchors with no text left become null.
 */
function settleEmpty(d: ProposalState, ctx: ApplyContext, result: ApplyResult): void {
  for (const s of [...d.spans]) {
    if (s.contentDeleted) continue;
    const own = ctx.mode === "suggesting" && s.authorId === ctx.authorId;
    if (spanLength(s) === 0) {
      if (own) {
        d.spans.splice(d.spans.indexOf(s), 1);
        result.withdrawn.push(s);
      } else {
        s.contentDeleted = true;
        s.inserted = null;
        s.deleted = null;
      }
    } else if (own && s.kind === "replace" && s.inserted && s.inserted.length === 0) {
      s.kind = "delete";
      s.inserted = null;
    }
  }
  for (const a of d.anchors) if (a.range && a.range.length === 0) a.range = null;
}

function normaliseMarks(marks: Mark[]): Mark[] {
  const groups = new Map<string, Mark[]>();
  for (const m of marks) {
    if (m.length <= 0) continue;
    const key = `${m.type}\u0000${m.href ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const out: Mark[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.at - b.at);
    let cur: Mark | null = null;
    for (const m of list) {
      if (cur && m.at <= end(cur)) cur.length = Math.max(end(cur), end(m)) - cur.at;
      else { cur = { ...m }; out.push(cur); }
    }
  }
  const order = ["bold", "italic", "underline", "link"];
  return out.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.at - b.at || (a.href ?? "").localeCompare(b.href ?? ""));
}

function setMark(d: ProposalState, type: Mark["type"], at: number, length: number, on: boolean, href?: string): void {
  const cut: Mark[] = [];
  for (const m of d.marks) {
    if (m.type !== type || m.at >= at + length || end(m) <= at) { cut.push(m); continue; }
    if (m.at < at) cut.push({ ...m, length: at - m.at });
    if (end(m) > at + length) cut.push({ ...m, at: at + length, length: end(m) - at - length });
  }
  if (on) cut.push(href === undefined ? { type, at, length } : { type, at, length, href });
  d.marks = normaliseMarks(cut);
}

function isLinkAddress(v: unknown): v is string {
  if (typeof v !== "string" || v.length > MAX_LINK_CHARS) return false;
  try {
    const u = new URL(v);
    return (u.protocol === "http:" || u.protocol === "https:") && /^https?:\/\//i.test(v);
  } catch {
    return false;
  }
}

const SHAPES = ["at,insert", "at,delete", "at,length,mark,value", "at,style"];

/** Shape only (before any transform): every entry is an object of one of the four op shapes with integer offsets. */
export function wellFormed(ops: unknown[]): ops is Op[] {
  return ops.every((op) => {
    if (!op || typeof op !== "object" || Array.isArray(op)) return false;
    const o = op as Record<string, unknown>;
    if (!SHAPES.includes(Object.keys(o).sort().join(","))) return false;
    return isInt(o.at) && (!("delete" in o) || isInt(o.delete)) && (!("length" in o) || isInt(o.length));
  });
}

/** Shape and range checks for one op against the text it applies to. */
function validate(op: Op, d: ProposalState, mode: EditMode): void {
  const o = op as Record<string, unknown>;
  const len = d.text.length;
  const keys = Object.keys(o).sort().join(",");
  if (keys === SHAPES[0]) {
    if (typeof o.insert !== "string" || o.insert.length < 1 || o.insert.length > MAX_INSERT_CHARS || CONTROL.test(o.insert)) throw new OpError("invalid");
    if (!isInt(o.at) || o.at < 0 || o.at > len) throw new OpError("invalid");
    if (len + o.insert.length > MAX_DOC_CHARS) throw new OpError("too_large");
    return;
  }
  if (keys === "at,delete") {
    if (!isInt(o.delete) || o.delete < 1 || !isInt(o.at) || o.at < 0 || o.at + o.delete > len) throw new OpError("invalid");
    return;
  }
  if (keys === "at,length,mark,value") {
    if (mode !== "editing") throw new OpError("invalid");
    if (!isInt(o.at) || !isInt(o.length) || o.at < 0 || o.length < 1 || o.at + o.length > len) throw new OpError("invalid");
    if (o.mark === "link") {
      if (o.value !== null && !isLinkAddress(o.value)) throw new OpError("invalid");
      return;
    }
    if (!TOGGLE_MARKS.includes(o.mark as never) || typeof o.value !== "boolean") throw new OpError("invalid");
    return;
  }
  if (keys === "at,style") {
    if (mode !== "editing") throw new OpError("invalid");
    if (!BLOCK_STYLES.includes(o.style as never) || !isInt(o.at) || o.at < 0 || o.at > len) throw new OpError("invalid");
    return;
  }
  throw new OpError("invalid");
}

/**
 * Suggestion crediting (Business rules, Suggestions): plain text never sits inside a suggestion's
 * credit, so a span holding `cut` (typed text at a point, or an accepted insertion's text) is split
 * around it. The part that keeps the span's id is the head (for a replacement's struck half, the
 * tail, so its struck and inserted halves stay together); the other part becomes a sibling
 * credited to the same author.
 */
function carveOut(d: ProposalState, cut: Range, ctx: ApplyContext, result: ApplyResult): void {
  const inside = (r: Range | null): r is Range => {
    if (r === null) return false;
    const head = cut.at - r.at;
    const tail = end(r) - end(cut);
    return head >= 0 && tail >= 0 && (cut.length > 0 ? head + tail > 0 : head > 0 && tail > 0);
  };
  for (const s of [...d.spans]) {
    if (s.contentDeleted) continue;
    const field = inside(s.inserted) ? "inserted" : inside(s.deleted) ? "deleted" : null;
    if (!field) continue;
    const r = s[field] as Range;
    const head: Range = { at: r.at, length: cut.at - r.at };
    const tail: Range = { at: end(cut), length: end(r) - end(cut) };
    if (!head.length || !tail.length) { s[field] = head.length ? head : tail; continue; }
    const keepTail = field === "deleted" && s.kind === "replace";
    s[field] = keepTail ? tail : head;
    const rest = keepTail ? head : tail;
    const piece = { ...newSpan(ctx, field === "inserted" ? "insert" : "delete", field === "inserted" ? rest : null, field === "deleted" ? rest : null), authorId: s.authorId };
    d.spans.push(piece);
    result.created.push(piece);
  }
}

function ownInsertion(s: Span, ctx: ApplyContext): Range | null {
  return s.authorId === ctx.authorId && !s.contentDeleted && (s.kind === "insert" || s.kind === "replace") ? s.inserted : null;
}

function newSpan(ctx: ApplyContext, kind: SuggestionKind, inserted: Range | null, deleted: Range | null): Span {
  return { id: ctx.newId(), kind, authorId: ctx.authorId, inserted, deleted, contentDeleted: false, createdAt: ctx.now };
}

/**
 * Apply one op frame in order (Op frame details). Mutates `d`; callers clone first so a refused
 * frame changes nothing. Suggesting-mode crediting follows Business rules, Suggestions.
 */
export function applyFrame(d: ProposalState, ops: Op[], ctx: ApplyContext): ApplyResult {
  const result: ApplyResult = { changes: [], created: [], withdrawn: [] };
  let pairing: Span | null = null;
  ops.forEach((op, i) => {
    validate(op, d, ctx.mode);
    const paired = pairing;
    pairing = null;
    if ("insert" in op) {
      if (ctx.mode === "editing") {
        carveOut(d, { at: op.at, length: 0 }, ctx, result);
        insertRaw(d, op.at, op.insert, result.changes);
        return;
      }
      if (paired && paired.deleted && op.at === end(paired.deleted)) {
        insertRaw(d, op.at, op.insert, result.changes);
        paired.inserted = { at: op.at, length: op.insert.length };
        return;
      }
      const own = d.spans.find((s) => { const r = ownInsertion(s, ctx); return r !== null && r.at <= op.at && op.at <= end(r); });
      const was = own?.inserted ? { ...own.inserted } : null;
      insertRaw(d, op.at, op.insert, result.changes);
      if (own && was) { own.inserted = { at: was.at, length: was.length + op.insert.length }; return; }
      const span = newSpan(ctx, "insert", { at: op.at, length: op.insert.length }, null);
      d.spans.push(span);
      result.created.push(span);
      return;
    }
    if ("delete" in op) {
      if (ctx.mode === "editing") {
        deleteRaw(d, op.at, op.delete, result.changes);
        settleEmpty(d, ctx, result);
        return;
      }
      const from = op.at;
      const to = op.at + op.delete;
      const own: Range[] = [];
      for (const s of d.spans) {
        const r = ownInsertion(s, ctx);
        if (r && r.length > 0 && r.at < to && end(r) > from) own.push({ at: Math.max(r.at, from), length: Math.min(end(r), to) - Math.max(r.at, from) });
      }
      own.sort((a, b) => b.at - a.at);
      let removed = 0;
      let floor = Infinity;
      for (const r of own) {
        const stop = Math.min(end(r), floor);
        if (stop > r.at) { deleteRaw(d, r.at, stop - r.at, result.changes); removed += stop - r.at; }
        floor = Math.min(floor, r.at);
      }
      settleEmpty(d, ctx, result);
      const rest: Range = { at: from, length: op.delete - removed };
      if (rest.length <= 0) return;
      const next = ops[i + 1];
      if (next && "insert" in next && next.at === end(rest)) {
        pairing = newSpan(ctx, "replace", null, rest);
        d.spans.push(pairing);
        result.created.push(pairing);
        return;
      }
      const touching = d.spans.find((s) => s.authorId === ctx.authorId && s.kind === "delete" && !s.contentDeleted && s.deleted
        && s.deleted.at <= end(rest) && rest.at <= end(s.deleted));
      if (touching && touching.deleted) {
        const lo = Math.min(touching.deleted.at, rest.at);
        touching.deleted = { at: lo, length: Math.max(end(touching.deleted), end(rest)) - lo };
        return;
      }
      const span = newSpan(ctx, "delete", null, rest);
      d.spans.push(span);
      result.created.push(span);
      return;
    }
    if ("mark" in op) {
      if (op.mark === "link") setMark(d, "link", op.at, op.length, op.value !== null, op.value ?? undefined);
      else setMark(d, op.mark, op.at, op.length, op.value);
      return;
    }
    d.styles[count(d.text.slice(0, op.at), "\n")] = op.style;
  });
  return result;
}

/**
 * The text ops that settle one suggestion (Business rules, Suggestions: accept and reject). Text of
 * another open insertion typed inside it keeps that suggestion's credit, so it is never removed here.
 */
export function decisionOps(s: Span, decision: Decision, spans: Span[]): Op[] {
  if (s.contentDeleted) return [];
  const target = decision === "accept" ? s.deleted : (s.kind === "delete" ? null : s.inserted);
  if (!target || target.length === 0) return [];
  const kept = spans.filter((o) => o !== s && o.inserted && o.inserted.at >= target.at && end(o.inserted) <= end(target))
    .map((o) => o.inserted as Range).sort((a, b) => b.at - a.at);
  const ops: Op[] = [];
  let stop = end(target);
  for (const r of kept) {
    if (end(r) < stop) ops.push({ delete: stop - end(r), at: end(r) });
    stop = Math.min(stop, r.at);
  }
  if (stop > target.at) ops.push({ delete: stop - target.at, at: target.at });
  return ops;
}

/**
 * Closes one decided suggestion (Business rules, Suggestions: accepting an insertion keeps its text
 * as plain text). Accepted inserted text is carved out of any other open suggestion it was typed
 * inside, so rejecting that one later never removes it. Returns the sibling spans the carve made.
 */
export function closeSpan(d: ProposalState, id: string, status: "accepted" | "rejected", ctx: ApplyContext): Span[] {
  const s = d.spans.find((x) => x.id === id);
  if (!s) return [];
  d.spans.splice(d.spans.indexOf(s), 1);
  const result: ApplyResult = { changes: [], created: [], withdrawn: [] };
  if (status === "accepted" && s.inserted && s.inserted.length > 0) carveOut(d, s.inserted, ctx, result);
  return result.created;
}

interface ReplaceAllPlan { ops: Op[]; count: number }

/** Replace all (Business rules, Suggestions): every match that does not overlap an open suggestion. */
export function planReplaceAll(d: ProposalState, find: string, replace: string, matchCase: boolean, mode: EditMode): ReplaceAllPlan {
  const blocked: Range[] = [];
  for (const s of d.spans) {
    if (s.inserted && s.inserted.length) blocked.push(s.inserted);
    if (s.deleted && s.deleted.length) blocked.push(s.deleted);
  }
  const pattern = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), matchCase ? "g" : "gi");
  const hits: number[] = [];
  for (const m of d.text.matchAll(pattern)) {
    const at = m.index;
    if (!blocked.some((r) => at < end(r) && r.at < at + find.length)) hits.push(at);
  }
  const ops: Op[] = [];
  let shift = 0;
  for (const at of hits) {
    const p = at + shift;
    ops.push({ delete: find.length, at: p });
    if (mode === "suggesting") {
      if (replace) ops.push({ insert: replace, at: p + find.length });
      shift += replace.length;
    } else {
      if (replace) ops.push({ insert: replace, at: p });
      shift += replace.length - find.length;
    }
  }
  return { ops, count: hits.length };
}

/** Find matches for the find dialog (case rules as Replace all, no suggestion filter). */
export function findMatches(text: string, find: string, matchCase: boolean): number[] {
  if (!find) return [];
  const pattern = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), matchCase ? "g" : "gi");
  return [...text.matchAll(pattern)].map((m) => m.index);
}

/**
 * Save state (Business rules, Save state), the one rule for the snapshot and every screen: saved only
 * when the saved revision has reached the latest revision and nothing is unacknowledged, failed after
 * a failed write not since followed by a successful one, otherwise saving.
 */
export function saveState(savedRevision: number, revision: number, failed: boolean, acknowledged: boolean): SaveState {
  if (savedRevision >= revision && acknowledged) return "saved";
  return failed ? "failed" : "saving";
}

/** Word count (Business rules): runs of non-whitespace without open insertion text. */
export function wordCount(d: ProposalState): number {
  const hidden = new Uint8Array(d.text.length);
  for (const s of d.spans) if (s.inserted) hidden.fill(1, s.inserted.at, end(s.inserted));
  let words = 0;
  let inWord = false;
  for (let i = 0; i < d.text.length; i++) {
    if (hidden[i]) continue;
    const space = /\s/.test(d.text[i]);
    if (!space && !inWord) words++;
    inWord = !space;
  }
  return words;
}

// ---- Transform (Document model and merge): an op frame is moved past changes the server made first.

function mapInsertPoint(p: number, c: Change): number {
  if ("ins" in c) return c.ins <= p ? p + c.len : p;
  return mapThroughDelete(p, c.del, c.len);
}

function mapRangeEnd(p: number, c: Change): number {
  if ("ins" in c) return c.ins < p ? p + c.len : p;
  return mapThroughDelete(p, c.del, c.len);
}

function transformOp(op: Op, c: Change): Op | null {
  if ("insert" in op) return { insert: op.insert, at: mapInsertPoint(op.at, c) };
  if ("style" in op) return { style: op.style, at: mapInsertPoint(op.at, c) };
  const length = "delete" in op ? op.delete : op.length;
  const at = mapInsertPoint(op.at, c);
  const stop = mapRangeEnd(op.at + length, c);
  if (stop <= at) return null;
  if ("delete" in op) return { delete: stop - at, at };
  return { ...op, at, length: stop - at };
}

/** The nominal text effect of an op already placed after `c`, used to carry `c` past it. */
function carryChange(c: Change, op: Op, mode: EditMode): Change {
  if ("insert" in op) {
    const at = "ins" in c ? c.ins : c.del;
    return op.at <= at ? ("ins" in c ? { ins: c.ins + op.insert.length, len: c.len } : { del: c.del + op.insert.length, len: c.len }) : c;
  }
  if ("delete" in op && mode === "editing") {
    if ("ins" in c) return { ins: mapThroughDelete(c.ins, op.at, op.delete), len: c.len };
    const s = mapThroughDelete(c.del, op.at, op.delete);
    return { del: s, len: mapThroughDelete(c.del + c.len, op.at, op.delete) - s };
  }
  return c;
}

interface Transformed { ops: Op[]; carried: Change[] }

/** Move a frame's ops past `changes`; also returns `changes` carried past the frame. */
export function transformFrame(ops: Op[], mode: EditMode, changes: Change[]): Transformed {
  let carried = changes;
  const out: Op[] = [];
  for (const op of ops) {
    let cur: Op | null = op;
    for (const c of carried) { if (cur) cur = transformOp(cur, c); }
    if (!cur) continue;
    const placed = cur;
    carried = carried.map((c) => carryChange(c, placed, mode)).filter((c) => c.len > 0);
    out.push(placed);
  }
  return { ops: out, carried };
}

/** Map a caret offset through changes (an insert at the caret lands before it). */
export function mapCaret(p: number, changes: Change[]): number {
  return changes.reduce((pos, c) => mapInsertPoint(pos, c), p);
}
