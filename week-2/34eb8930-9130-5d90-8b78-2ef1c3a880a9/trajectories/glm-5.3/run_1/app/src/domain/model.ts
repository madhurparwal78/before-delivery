import type { BlockStyle, MarkType, Op } from './ot.js';
import type { DomainRole, Mode, Span } from './types.js';

export type ModelSuggestion = {
  id: string;
  kind: 'insert' | 'delete' | 'replace';
  authorId: string;
  authorRole: DomainRole;
  inserted: Span | null;
  deleted: Span | null;
  contentDeleted: boolean;
  status: 'open' | 'accepted' | 'rejected';
  createdAt: string;
  closedAt: string | null;
  closedById: string | null;
  /** 'withdrawn' when the author deleted all of their own open insertion */
  closedAs: 'withdrawn' | null;
  decidedById: string | null;
};

export type ModelCommentReply = { id: string; authorId: string; body: string; createdAt: string };

export type ModelComment = {
  id: string;
  authorId: string;
  body: string;
  mentions: string[];
  anchor: Span | null;
  contentDeleted: boolean;
  status: 'open' | 'resolved' | 'reopened';
  replies: ModelCommentReply[];
  createdAt: string;
};

export type ModelMark = { type: MarkType; at: number; length: number; href?: string };

/**
 * The document model. Blocks are one per line (a line is text up to and including
 * its '\n'); lineStyles[i] is the paragraph style of line i.
 */
export type DocModel = {
  revision: number;
  text: string;
  lineStyles: BlockStyle[];
  marks: ModelMark[];
  suggestions: ModelSuggestion[];
  comments: ModelComment[];
};

/** A text change as broadcast and recorded for replay. */
export type TextDelta =
  | { ins: string; at: number }
  | { del: number; at: number }
  | { mark: MarkType; value: boolean | string | null; at: number; length: number }
  | { style: BlockStyle; at: number };

/** Suggestion events as recorded for replay: rebuilding suggestion state deterministically. */
export type SuggestionDelta =
  | { created: ModelSuggestion }
  | { changed: { id: string; kind?: 'insert' | 'delete' | 'replace'; inserted?: Span | null; deleted?: Span | null; contentDeleted?: boolean } }
  | { closed: { id: string; status: 'accepted' | 'rejected'; closedAs?: 'withdrawn'; closedById?: string; decidedById?: string; closedAt?: string } };

export type RevisionDelta = {
  revision: number;
  authorId: string;
  mode: Mode;
  textOps: TextDelta[];
  suggestionOps: SuggestionDelta[];
};

export function emptyModel(): DocModel {
  return { revision: 0, text: '', lineStyles: [], marks: [], suggestions: [], comments: [] };
}

export function cloneModel(m: DocModel): DocModel {
  return {
    revision: m.revision,
    text: m.text,
    lineStyles: [...m.lineStyles],
    marks: m.marks.map((x) => ({ ...x })),
    suggestions: m.suggestions.map((s) => ({ ...s, inserted: s.inserted ? { ...s.inserted } : null, deleted: s.deleted ? { ...s.deleted } : null })),
    comments: modelCommentsClone(m.comments),
  };
}

function modelCommentsClone(comments: ModelComment[]): ModelComment[] {
  return comments.map((c) => ({ ...c, anchor: c.anchor ? { ...c.anchor } : null, replies: c.replies.map((r) => ({ ...r })) }));
}

/** Blocks for the snapshot: one per line, range includes the line's trailing '\n'. */
export function modelBlocks(model: DocModel): { style: BlockStyle; at: number; length: number }[] {
  const out: { style: BlockStyle; at: number; length: number }[] = [];
  let at = 0;
  const lines = model.text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const len = lines[i]!.length + (i < lines.length - 1 ? 1 : 0);
    out.push({ style: model.lineStyles[i] ?? 'paragraph', at, length: len });
    at += len;
  }
  return out;
}

export function lineIndexOf(model: DocModel, pos: number): number {
  let at = 0;
  const lines = model.text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const len = lines[i]!.length + (i < lines.length - 1 ? 1 : 0);
    if (pos < at + len) return i;
    at += len;
  }
  return lines.length - 1;
}

function moveOffset(offset: number, from: number, cut: number, delta: number, appliedAt: number): number {
  if (offset <= from) return offset;
  if (offset >= from + cut) return offset + delta;
  return appliedAt;
}

/**
 * Moves spans across a plain-text insert at position p.
 * A span starting at p is pushed after the new text; a span ending at p keeps its end;
 * a span containing p strictly grows to include the new text.
 */
function moveSpansInsert(model: DocModel, p: number, len: number): void {
  const moveStart = (o: number): number => (o >= p ? o + len : o);
  const moveEnd = (o: number): number => (o > p ? o + len : o);
  const kept: ModelMark[] = [];
  for (const m of model.marks) {
    const at = moveStart(m.at);
    const end = moveEnd(m.at + m.length);
    if (end - at > 0) kept.push({ ...m, at, length: end - at });
  }
  model.marks = kept;
  for (const s of model.suggestions) {
    for (const key of ['inserted', 'deleted'] as const) {
      const span = s[key];
      if (!span) continue;
      const at = moveStart(span.at);
      const end = moveEnd(span.at + span.length);
      s[key] = { at, length: Math.max(0, end - at) };
      if (s[key]!.length === 0 && s.status === 'open' && !s.contentDeleted) s.contentDeleted = true;
    }
  }
  for (const c of model.comments) {
    if (!c.anchor) continue;
    const at = moveStart(c.anchor.at);
    const end = moveEnd(c.anchor.at + c.anchor.length);
    const length = Math.max(0, end - at);
    if (length === 0) {
      c.anchor = null;
      c.contentDeleted = true;
    } else {
      c.anchor = { at, length };
    }
  }
}

function repairLineStyles(model: DocModel): void {
  const n = model.text === '' ? 0 : model.text.split('\n').length;
  while (model.lineStyles.length < n) model.lineStyles.push('paragraph');
  model.lineStyles.length = n;
}

/** Moves every anchored offset across a delete: [from, from+cut) collapsed to appliedAt. */
function moveSpansDelete(model: DocModel, from: number, cut: number, appliedAt: number): void {
  const move = (o: number): number => moveOffset(o, from, cut, -cut, appliedAt);
  const kept: ModelMark[] = [];
  for (const m of model.marks) {
    const at = move(m.at);
    const end = move(m.at + m.length);
    if (end - at > 0) kept.push({ ...m, at, length: end - at });
  }
  model.marks = kept;
  for (const s of model.suggestions) {
    for (const key of ['inserted', 'deleted'] as const) {
      const span = s[key];
      if (!span) continue;
      const at = move(span.at);
      const end = move(span.at + span.length);
      s[key] = { at, length: Math.max(0, end - at) };
      if (s[key]!.length === 0 && s.status === 'open' && !s.contentDeleted) s.contentDeleted = true;
    }
  }
  for (const c of model.comments) {
    if (!c.anchor) continue;
    const at = move(c.anchor.at);
    const end = move(c.anchor.at + c.anchor.length);
    const length = Math.max(0, end - at);
    if (length === 0) {
      c.anchor = null;
      c.contentDeleted = true;
    } else {
      c.anchor = { at, length };
    }
  }
}

/** Plain text insert: moves spans and splits lines on each inserted '\n'. */
export function applyTextInsert(model: DocModel, at: number, text: string): TextDelta[] {
  const pos = Math.max(0, Math.min(at, model.text.length));
  const newlines = text.split('\n');
  if (newlines.length > 1) {
    const idx = lineIndexOf(model, pos);
    const style = model.lineStyles[idx] ?? 'paragraph';
    model.lineStyles.splice(idx, 1, ...newlines.map(() => style));
  }
  model.text = model.text.slice(0, pos) + text + model.text.slice(pos);
  repairLineStyles(model);
  moveSpansInsert(model, pos, text.length);
  return [{ ins: text, at: pos }];
}

/** Plain text delete: moves spans and merges lines whose '\n' was removed. */
export function applyTextDelete(model: DocModel, at: number, length: number): TextDelta[] {
  if (model.text.length === 0) return [];
  const from = Math.max(0, Math.min(at, model.text.length - 1));
  const cut = Math.max(0, Math.min(length, model.text.length - from));
  if (cut === 0) return [];
  if (model.text.slice(from, from + cut).includes('\n')) {
    const i = lineIndexOf(model, from);
    const j = lineIndexOf(model, from + cut - 1);
    // a range ending on a line separator merges the line after it as well
    const last = model.text[from + cut - 1] === '\n' ? j + 1 : j;
    const style = model.lineStyles[i] ?? 'paragraph';
    if (last > i) model.lineStyles.splice(i, last - i + 1, style);
  }
  model.text = model.text.slice(0, from) + model.text.slice(from + cut);
  repairLineStyles(model);
  moveSpansDelete(model, from, cut, from);
  return [{ del: cut, at: from }];
}

export function applyMarkDelta(model: DocModel, delta: Extract<TextDelta, { mark: unknown }>): TextDelta[] {
  const end = delta.at + delta.length;
  model.marks = model.marks.filter((m) => !(m.type === delta.mark && m.at < end && m.at + m.length > delta.at));
  if (delta.value !== false && delta.value !== null && delta.length > 0) {
    const rec: ModelMark = { type: delta.mark, at: delta.at, length: delta.length };
    if (delta.mark === 'link' && typeof delta.value === 'string') rec.href = delta.value;
    model.marks.push(rec);
  }
  return [delta];
}

export function applyStyleDelta(model: DocModel, delta: Extract<TextDelta, { style: unknown }>): TextDelta[] {
  const idx = lineIndexOf(model, delta.at);
  model.lineStyles[idx] = delta.style;
  return [delta];
}

/** Applies a recorded revision delta; used to rebuild a body from storage plus history. */
export function replayDelta(model: DocModel, delta: RevisionDelta): void {
  for (const op of delta.textOps) {
    if ('ins' in op) applyTextInsert(model, op.at, op.ins);
    else if ('del' in op) applyTextDelete(model, op.at, op.del);
    else if ('mark' in op) applyMarkDelta(model, op);
    else applyStyleDelta(model, op);
  }
  for (const op of delta.suggestionOps) {
    if ('created' in op) {
      if (!model.suggestions.some((s) => s.id === op.created.id)) model.suggestions.push(structuredClone(op.created));
    } else if ('changed' in op) {
      const s = model.suggestions.find((x) => x.id === op.changed.id);
      if (!s) continue;
      if (op.changed.kind !== undefined) s.kind = op.changed.kind;
      if (op.changed.inserted !== undefined) s.inserted = op.changed.inserted ? { ...op.changed.inserted } : null;
      if (op.changed.deleted !== undefined) s.deleted = op.changed.deleted ? { ...op.changed.deleted } : null;
      if (op.changed.contentDeleted !== undefined) s.contentDeleted = op.changed.contentDeleted;
    } else {
      const s = model.suggestions.find((x) => x.id === op.closed.id);
      if (!s) continue;
      s.status = op.closed.status;
      s.closedAs = op.closed.closedAs ?? null;
      s.closedById = op.closed.closedById ?? null;
      s.decidedById = op.closed.decidedById ?? null;
      s.closedAt = op.closed.closedAt ?? null;
    }
  }
  model.revision = delta.revision;
}

export type { Op };
