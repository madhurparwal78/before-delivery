import { shiftSpan, shiftSpanThrough } from './ot.js';
import type { Block, BlockStyle, Comment, EditMode, Mark, MarkType, OpEntry, Span, Suggestion, TextEdit } from './types.js';

export interface DocState {
  text: string;
  blockStyles: BlockStyle[];
  marks: Mark[];
  suggestions: Suggestion[];
  comments: Comment[];
}

export interface ApplyOutcome {
  /** The text changes the entry really made, in the order they were applied. */
  textEdits: TextEdit[];
  /** Ranges a suggesting-mode delete should strike, after the text changes. */
  strikeSpans: Span[];
  /** Open suggestions whose text is now gone, and whether their author removed their own insertion. */
  emptiedSuggestionIds: string[];
  withdrawnSuggestionIds: string[];
  /** Comments whose anchor text is now gone. */
  emptiedCommentIds: string[];
  changedSuggestionIds: string[];
}

export function createEmptyState(): DocState {
  return { text: '', blockStyles: ['paragraph'], marks: [], suggestions: [], comments: [] };
}

export function blockIndexAt(text: string, at: number): number {
  let count = 0;
  for (let i = 0; i < at && i < text.length; i += 1) if (text[i] === '\n') count += 1;
  return count;
}

export function blocksOf(state: DocState): Block[] {
  const blocks: Block[] = [];
  let at = 0;
  const segments = state.text.split('\n');
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i] as string;
    blocks.push({ style: state.blockStyles[i] ?? 'paragraph', at, length: segment.length });
    at += segment.length + 1;
  }
  return blocks;
}


function newBlockStyleAfterSplit(style: BlockStyle): BlockStyle {
  return style === 'bullet' || style === 'numbered' ? style : 'paragraph';
}

function emptyOutcome(): ApplyOutcome {
  return {
    textEdits: [],
    strikeSpans: [],
    emptiedSuggestionIds: [],
    withdrawnSuggestionIds: [],
    emptiedCommentIds: [],
    changedSuggestionIds: [],
  };
}

function shiftMarkOnInsert(mark: Mark, at: number, length: number): Mark {
  const end = mark.at + mark.length;
  if (at > mark.at && at <= end) return { ...mark, length: mark.length + length };
  if (at <= mark.at) return { ...mark, at: mark.at + length };
  return mark;
}

function normaliseMarks(marks: Mark[]): Mark[] {
  const kept = marks.filter((mark) => mark.length > 0);
  kept.sort((a, b) => (a.type === b.type ? a.at - b.at : a.type < b.type ? -1 : 1));
  const out: Mark[] = [];
  for (const mark of kept) {
    const last = out[out.length - 1];
    if (last && last.type === mark.type && last.href === mark.href && mark.at <= last.at + last.length) {
      last.length = Math.max(last.length, mark.at + mark.length - last.at);
    } else {
      out.push({ ...mark });
    }
  }
  return out;
}

function subtractMark(marks: Mark[], type: MarkType, at: number, length: number): Mark[] {
  const end = at + length;
  const out: Mark[] = [];
  for (const mark of marks) {
    if (mark.type !== type) {
      out.push(mark);
      continue;
    }
    const markEnd = mark.at + mark.length;
    if (markEnd <= at || mark.at >= end) {
      out.push(mark);
      continue;
    }
    if (mark.at < at) out.push({ ...mark, length: at - mark.at });
    if (markEnd > end) out.push({ ...mark, at: end, length: markEnd - end });
  }
  return out;
}

export function setMark(state: DocState, type: MarkType, value: boolean | string | null, at: number, length: number): void {
  const without = subtractMark(state.marks, type, at, length);
  if (value === false || value === null) {
    state.marks = normaliseMarks(without);
    return;
  }
  const mark: Mark = type === 'link' ? { type, at, length, href: value as string } : { type, at, length };
  state.marks = normaliseMarks([...without, mark]);
}

function applyInsert(state: DocState, at: number, text: string, outcome: ApplyOutcome): void {
  const edit: TextEdit = { kind: 'insert', at, length: text.length };
  state.text = state.text.slice(0, at) + text + state.text.slice(at);
  const newlines = text.split('\n').length - 1;
  if (newlines > 0) {
    const index = blockIndexAt(state.text, at);
    const style = state.blockStyles[index] ?? 'paragraph';
    const added: BlockStyle[] = [];
    for (let i = 0; i < newlines; i += 1) added.push(newBlockStyleAfterSplit(style));
    state.blockStyles.splice(index + 1, 0, ...added);
  }
  state.marks = normaliseMarks(state.marks.map((mark) => shiftMarkOnInsert(mark, at, text.length)));
  for (const suggestion of state.suggestions) {
    if (suggestion.inserted) suggestion.inserted = shiftSpan(suggestion.inserted, edit);
    if (suggestion.deleted) suggestion.deleted = shiftSpan(suggestion.deleted, edit);
  }
  for (const comment of state.comments) {
    if (comment.anchor) comment.anchor = shiftSpan(comment.anchor, edit);
  }
  outcome.textEdits.push(edit);
}

function applyDelete(state: DocState, at: number, length: number, outcome: ApplyOutcome, deleterId: string | null): void {
  const edit: TextEdit = { kind: 'delete', at, length };
  const index = blockIndexAt(state.text, at);
  const endIndex = blockIndexAt(state.text, at + length);
  state.text = state.text.slice(0, at) + state.text.slice(at + length);
  if (endIndex > index) state.blockStyles.splice(index + 1, endIndex - index);
  state.marks = normaliseMarks(
    state.marks.flatMap((mark) => {
      const moved = shiftSpan({ at: mark.at, length: mark.length }, edit);
      return moved ? [{ ...mark, at: moved.at, length: moved.length }] : [];
    }),
  );
  for (const suggestion of state.suggestions) {
    const hadInserted = suggestion.inserted !== null;
    const hadDeleted = suggestion.deleted !== null;
    if (suggestion.inserted) suggestion.inserted = shiftSpan(suggestion.inserted, edit);
    if (suggestion.deleted) suggestion.deleted = shiftSpan(suggestion.deleted, edit);
    const lostInserted = hadInserted && suggestion.inserted === null;
    const lostDeleted = hadDeleted && suggestion.deleted === null;
    if (!lostInserted && !lostDeleted) continue;
    if (suggestion.inserted === null && suggestion.deleted === null) {
      if (lostInserted && deleterId !== null && suggestion.author.personId === deleterId && !hadDeleted) {
        outcome.withdrawnSuggestionIds.push(suggestion.id);
      } else {
        suggestion.contentDeleted = true;
        outcome.emptiedSuggestionIds.push(suggestion.id);
      }
      continue;
    }
    if (suggestion.kind === 'replace') suggestion.kind = lostInserted ? 'delete' : 'insert';
    outcome.changedSuggestionIds.push(suggestion.id);
  }
  state.suggestions = state.suggestions.filter((s) => !outcome.withdrawnSuggestionIds.includes(s.id));
  for (const comment of state.comments) {
    if (!comment.anchor) continue;
    const moved = shiftSpan(comment.anchor, edit);
    if (!moved) {
      comment.anchor = null;
      comment.contentDeleted = true;
      outcome.emptiedCommentIds.push(comment.id);
    } else {
      comment.anchor = moved;
    }
  }
  outcome.textEdits.push(edit);
}

/** The character ranges of open insertions by one author, and of every struck range. */
function coverage(state: DocState, authorId: string): { own: Span[]; struck: Span[] } {
  const own: Span[] = [];
  const struck: Span[] = [];
  for (const suggestion of state.suggestions) {
    if (suggestion.inserted && suggestion.author.personId === authorId) own.push(suggestion.inserted);
    if (suggestion.deleted) struck.push(suggestion.deleted);
  }
  return { own, struck };
}

function inSpans(spans: Span[], index: number): boolean {
  return spans.some((span) => index >= span.at && index < span.at + span.length);
}

/**
 * Splits a suggesting-mode delete into the author's own insertion text (really removed)
 * and plain text (struck in place). Text already struck is left alone.
 */
export function suggestingDeleteSegments(
  state: DocState,
  at: number,
  length: number,
  authorId: string,
): { remove: Span[]; strike: Span[] } {
  const { own, struck } = coverage(state, authorId);
  const remove: Span[] = [];
  const strike: Span[] = [];
  let kind: 'remove' | 'strike' | 'skip' | null = null;
  let start = at;
  const push = (end: number): void => {
    if (kind === 'remove') remove.push({ at: start, length: end - start });
    if (kind === 'strike') strike.push({ at: start, length: end - start });
  };
  for (let i = at; i < at + length; i += 1) {
    const next: 'remove' | 'strike' | 'skip' = inSpans(own, i) ? 'remove' : inSpans(struck, i) ? 'skip' : 'strike';
    if (next !== kind) {
      if (kind !== null) push(i);
      kind = next;
      start = i;
    }
  }
  if (kind !== null) push(at + length);
  return { remove, strike };
}

function ownInsertionToExtend(state: DocState, at: number, authorId: string): Suggestion | null {
  const candidates = state.suggestions.filter(
    (suggestion) =>
      suggestion.author.personId === authorId &&
      suggestion.inserted !== null &&
      at >= suggestion.inserted.at &&
      at <= suggestion.inserted.at + suggestion.inserted.length,
  );
  candidates.sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1));
  const chosen = candidates[0];
  if (!chosen || !chosen.inserted) return null;
  const sameBlock = blockIndexAt(state.text, chosen.inserted.at) === blockIndexAt(state.text, at);
  return sameBlock ? chosen : null;
}

/**
 * Applies one op entry to the text, blocks, marks and the ranges of existing cards.
 * Creating or closing card records is the server's job; this keeps every screen's
 * text and offsets identical.
 */
export function applyEntry(state: DocState, entry: OpEntry, mode: EditMode, authorId: string): ApplyOutcome {
  const outcome = emptyOutcome();
  if ('insert' in entry) {
    const extended = mode === 'suggesting' ? ownInsertionToExtend(state, entry.at, authorId) : null;
    const before = extended?.inserted ? { ...extended.inserted } : null;
    applyInsert(state, entry.at, entry.insert, outcome);
    if (extended && before) {
      extended.inserted = {
        at: Math.min(before.at, entry.at),
        length: before.length + entry.insert.length,
      };
      outcome.changedSuggestionIds.push(extended.id);
    }
    return outcome;
  }
  if ('delete' in entry) {
    if (mode === 'editing') {
      applyDelete(state, entry.at, entry.delete, outcome, null);
      return outcome;
    }
    const { remove, strike } = suggestingDeleteSegments(state, entry.at, entry.delete, authorId);
    for (const span of [...remove].sort((a, b) => b.at - a.at)) {
      applyDelete(state, span.at, span.length, outcome, authorId);
    }
    outcome.strikeSpans = strike.flatMap((span) => {
      const moved = shiftSpanThrough(span, outcome.textEdits);
      return moved ? [moved] : [];
    });
    return outcome;
  }
  if ('style' in entry) {
    const index = blockIndexAt(state.text, entry.at);
    if (index < state.blockStyles.length) state.blockStyles[index] = entry.style;
    return outcome;
  }
  setMark(state, entry.mark, entry.value, entry.at, entry.length);
  return outcome;
}

/** Applies op entries as plain text, mark and style changes, the way the server recorded them. */
export function applyPrimitives(state: DocState, entries: readonly OpEntry[]): ApplyOutcome {
  const merged = emptyOutcome();
  for (const entry of entries) {
    const outcome = applyEntry(state, entry, 'editing', '');
    merged.textEdits.push(...outcome.textEdits);
    merged.emptiedSuggestionIds.push(...outcome.emptiedSuggestionIds);
    merged.withdrawnSuggestionIds.push(...outcome.withdrawnSuggestionIds);
    merged.emptiedCommentIds.push(...outcome.emptiedCommentIds);
    merged.changedSuggestionIds.push(...outcome.changedSuggestionIds);
  }
  return merged;
}

/** Removes a span of text as a settled decision: no card bookkeeping beyond offsets. */
export function applySettlement(state: DocState, span: Span): ApplyOutcome {
  const outcome = emptyOutcome();
  applyDelete(state, span.at, span.length, outcome, null);
  return outcome;
}


/** The proposal as it reads without open suggestions: insertions left out, deletions kept. */
export function textWithoutOpenSuggestions(state: DocState): string {
  const insertions = state.suggestions.flatMap((s) => (s.inserted ? [s.inserted] : []));
  if (insertions.length === 0) return state.text;
  let out = '';
  for (let i = 0; i < state.text.length; i += 1) {
    if (!inSpans(insertions, i)) out += state.text[i];
  }
  return out;
}

export function countWords(text: string): number {
  const runs = text.split(/\s+/u).filter((run) => run.length > 0);
  return runs.length;
}

export function wordCount(state: DocState): number {
  return countWords(textWithoutOpenSuggestions(state));
}

export function findMatches(text: string, find: string, matchCase: boolean, skip: Span[]): Span[] {
  if (find.length === 0) return [];
  const haystack = matchCase ? text : text.toLowerCase();
  const needle = matchCase ? find : find.toLowerCase();
  const out: Span[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return out;
    const overlaps = skip.some((span) => at < span.at + span.length && span.at < at + needle.length);
    if (!overlaps) out.push({ at, length: needle.length });
    from = at + (overlaps ? 1 : needle.length);
  }
}

export function openSuggestionSpans(state: DocState): Span[] {
  const spans: Span[] = [];
  for (const suggestion of state.suggestions) {
    if (suggestion.inserted) spans.push(suggestion.inserted);
    if (suggestion.deleted) spans.push(suggestion.deleted);
  }
  return spans;
}

export function spanText(state: DocState, span: Span | null): string {
  return span ? state.text.slice(span.at, span.at + span.length) : '';
}

