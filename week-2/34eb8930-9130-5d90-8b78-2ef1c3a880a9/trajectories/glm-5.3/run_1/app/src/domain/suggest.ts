import { applyMarkDelta, applyStyleDelta, applyTextDelete, applyTextInsert, type DocModel, type RevisionDelta, type SuggestionDelta, type TextDelta } from './model.js';
import type { Op } from './ot.js';
import { MAX_DOCUMENT_CHARS } from './ot.js';
import { id, type DomainRole, type Mode } from './types.js';

export type FrameOutcome = {
  broadcast: TextDelta[];
  delta: RevisionDelta;
  /** suggestion ids that closed this frame, for card_closed frames */
  closedIds: string[];
};

type ModelSug = DocModel['suggestions'][number];

function newSuggestion(kind: 'insert' | 'delete' | 'replace', authorId: string, authorRole: DomainRole, spans: { inserted?: { at: number; length: number } | null; deleted?: { at: number; length: number } | null }): ModelSug {
  return { id: id(), kind, authorId, authorRole, inserted: spans.inserted ?? null, deleted: spans.deleted ?? null, contentDeleted: false, status: 'open', createdAt: new Date().toISOString(), closedAt: null, closedById: null, closedAs: null, decidedById: null };
}

/** True when a text range is entirely inside the typist's own open insertion span. */
function ownInsertionAt(model: DocModel, authorId: string, pos: number, side: 'start' | 'end'): ModelSug | null {
  for (const s of model.suggestions) {
    if (s.authorId !== authorId || s.status !== 'open' || !s.inserted) continue;
    const start = s.inserted.at;
    const end = start + s.inserted.length;
    if (side === 'end' && pos === end) return s;
    if (side === 'start' && pos === start) return s;
  }
  return null;
}

function ownDeletionAt(model: DocModel, authorId: string, pos: number, side: 'start' | 'end'): ModelSug | null {
  for (const s of model.suggestions) {
    if (s.authorId !== authorId || s.status !== 'open' || !s.deleted || s.inserted) continue;
    const start = s.deleted.at;
    const end = start + s.deleted.length;
    if (side === 'end' && pos === end) return s;
    if (side === 'start' && pos === start) return s;
  }
  return null;
}

/** The typist's own open insertion span containing pos (inside or at the ends). */
function ownInsertionAround(model: DocModel, authorId: string, pos: number): ModelSug | null {
  for (const s of model.suggestions) {
    if (s.authorId !== authorId || s.status !== 'open' || !s.inserted) continue;
    if (pos >= s.inserted.at && pos <= s.inserted.at + s.inserted.length) return s;
  }
  return null;
}

/**
 * Applies an op frame. In editing mode ops change the text directly; in suggesting
 * mode deletes keep their text (struck) and every change becomes a credited suggestion.
 */
export function applyOpFrame(model: DocModel, authorId: string, authorRole: DomainRole, mode: Mode, ops: Op[], baseRevision: number): FrameOutcome | { error: string; fields?: Record<string, string> } {
  if (baseRevision > model.revision) return { error: 'invalid' };
  const broadcast: TextDelta[] = [];
  const suggestionOps: SuggestionDelta[] = [];
  const closedIds: string[] = [];
  let textOps: TextDelta[] = [];

  // validate each op against the text left by the one before; a refusal changes nothing
  let vlen = model.text.length;
  for (const op of ops) {
    if ('insert' in op) {
      if (typeof op.insert !== 'string' || op.insert.length < 1 || op.insert.length > 10_000) return { error: 'invalid' };
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(op.insert)) return { error: 'invalid' };
      if (!Number.isInteger(op.at) || op.at < 0 || op.at > vlen) return { error: 'invalid' };
      if (vlen + op.insert.length > MAX_DOCUMENT_CHARS) return { error: 'too_large' };
      vlen += op.insert.length;
    } else if ('delete' in op) {
      if (!Number.isInteger(op.at) || !Number.isInteger(op.delete) || op.delete < 1 || op.at < 0 || op.at + op.delete > vlen) return { error: 'invalid' };
      if (mode === 'editing') vlen -= op.delete;
    } else if ('mark' in op) {
      if (mode === 'suggesting') return { error: 'invalid' };
      if (!['bold', 'italic', 'underline', 'link'].includes(op.mark)) return { error: 'invalid' };
      if (op.mark === 'link' && !(op.value === null || (typeof op.value === 'string' && /^https?:\/\//.test(op.value) && op.value.length <= 2000))) return { error: 'invalid' };
      if (op.mark !== 'link' && typeof op.value !== 'boolean') return { error: 'invalid' };
      if (!Number.isInteger(op.at) || op.at < 0 || !Number.isInteger(op.length) || op.length < 0 || op.at + op.length > vlen) return { error: 'invalid' };
    } else if ('style' in op) {
      if (mode === 'suggesting') return { error: 'invalid' };
      if (!['title', 'heading1', 'heading2', 'heading3', 'paragraph', 'bullet', 'numbered'].includes(op.style)) return { error: 'invalid' };
      if (!Number.isInteger(op.at) || op.at < 0 || op.at >= Math.max(vlen, 1) || vlen === 0) return { error: 'invalid' };
    } else {
      return { error: 'invalid' };
    }
  }

  let prevDeleteSuggestion: ModelSug | null = null;

  for (const op of ops) {
    if ('insert' in op) {
      const at = Math.max(0, Math.min(op.at, model.text.length));
      const text = op.insert;
      if (mode === 'editing') {
        const deltas = applyTextInsert(model, at, text);
        textOps = textOps.concat(deltas);
        broadcast.push(...deltas);
        prevDeleteSuggestion = null;
        continue;
      }
      // a replacement pair: the insert lands at the end of the just-struck text
      if (prevDeleteSuggestion && at === prevDeleteSuggestion.deleted!.at + prevDeleteSuggestion.deleted!.length) {
        const sug = prevDeleteSuggestion;
        const deltas = applyTextInsert(model, at, text);
        sug.kind = 'replace';
        sug.inserted = { at, length: text.length };
        suggestionOps.push({ changed: { id: sug.id, kind: 'replace', inserted: { at, length: text.length } } });
        textOps = textOps.concat(deltas);
        broadcast.push(...deltas);
        prevDeleteSuggestion = null;
        continue;
      }
      // extending the typist's own open insertion (touching its start or end, or inside it)
      const ownEnd = ownInsertionAt(model, authorId, at, 'end');
      if (ownEnd) {
        const preAt = ownEnd.inserted!.at;
        const preLen = ownEnd.inserted!.length;
        const deltas = applyTextInsert(model, at, text);
        ownEnd.inserted = { at: preAt, length: preLen + text.length };
        suggestionOps.push({ changed: { id: ownEnd.id, inserted: { ...ownEnd.inserted! } } });
        textOps = textOps.concat(deltas);
        broadcast.push(...deltas);
        prevDeleteSuggestion = null;
        continue;
      }
      // at the start of, or inside, the own insertion the generic span move already extends it
      const ownTouched = ownInsertionAt(model, authorId, at, 'start') ?? ownInsertionAround(model, authorId, at);
      if (ownTouched) {
        const deltas = applyTextInsert(model, at, text);
        suggestionOps.push({ changed: { id: ownTouched.id, inserted: { ...ownTouched.inserted! } } });
        textOps = textOps.concat(deltas);
        broadcast.push(...deltas);
        prevDeleteSuggestion = null;
        continue;
      }
      const deltas = applyTextInsert(model, at, text);
      const sug = newSuggestion('insert', authorId, authorRole, { inserted: { at, length: text.length } });
      model.suggestions.push(sug);
      suggestionOps.push({ created: structuredClone(sug) });
      textOps = textOps.concat(deltas);
      broadcast.push(...deltas);
      prevDeleteSuggestion = null;
    } else if ('delete' in op) {
      const from = Math.max(0, Math.min(op.at, model.text.length - 1));
      const cut = Math.min(op.delete, model.text.length - from);
      if (cut <= 0) {
        prevDeleteSuggestion = null;
        continue;
      }
      if (mode === 'editing') {
        const deltas = applyTextDelete(model, from, cut);
        textOps = textOps.concat(deltas);
        broadcast.push(...deltas);
        prevDeleteSuggestion = null;
        continue;
      }
      // deleting inside the typist's own open insertion shrinks it; deleting all withdraws it
      const own = ownInsertionAround(model, authorId, from);
      if (own && from >= own.inserted!.at && from + cut <= own.inserted!.at + own.inserted!.length) {
        const start = own.inserted!.at;
        const end = start + own.inserted!.length;
        const overlap = Math.max(0, Math.min(end, from + cut) - Math.max(start, from));
        const newLen = own.inserted!.length - overlap;
        if (newLen <= 0) {
          own.status = 'rejected';
          own.closedAs = 'withdrawn';
          own.closedAt = new Date().toISOString();
          own.closedById = authorId;
          closedIds.push(own.id);
          const deltas = applyTextDelete(model, from, cut);
          suggestionOps.push({ closed: { id: own.id, status: 'rejected', closedAs: 'withdrawn', closedById: authorId, closedAt: own.closedAt! } });
          textOps = textOps.concat(deltas);
          broadcast.push(...deltas);
          prevDeleteSuggestion = null;
          continue;
        }
        const deltas = applyTextDelete(model, from, cut);
        own.inserted = { at: start, length: newLen };
        suggestionOps.push({ changed: { id: own.id, inserted: { at: start, length: newLen } } });
        textOps = textOps.concat(deltas);
        broadcast.push(...deltas);
        prevDeleteSuggestion = null;
        continue;
      }
      // extending the typist's own open deletion; the struck text stays in place
      const ownDelEnd = ownDeletionAt(model, authorId, from, 'end');
      if (ownDelEnd) {
        ownDelEnd.deleted = { at: ownDelEnd.deleted!.at, length: ownDelEnd.deleted!.length + cut };
        suggestionOps.push({ changed: { id: ownDelEnd.id, deleted: { ...ownDelEnd.deleted! } } });
        prevDeleteSuggestion = null;
        continue;
      }
      const ownDelStart = ownDeletionAt(model, authorId, from + cut, 'start');
      if (ownDelStart) {
        ownDelStart.deleted = { at: from, length: ownDelStart.deleted!.length + cut };
        suggestionOps.push({ changed: { id: ownDelStart.id, deleted: { ...ownDelStart.deleted! } } });
        prevDeleteSuggestion = null;
        continue;
      }
      const sug = newSuggestion('delete', authorId, authorRole, { deleted: { at: from, length: cut } });
      model.suggestions.push(sug);
      suggestionOps.push({ created: structuredClone(sug) });
      prevDeleteSuggestion = sug;
    } else if ('mark' in op) {
      const d: Extract<TextDelta, { mark: unknown }> = { mark: op.mark, value: op.value as boolean | string | null, at: op.at, length: op.length };
      const deltas = applyMarkDelta(model, d);
      textOps = textOps.concat(deltas);
      broadcast.push(d);
      prevDeleteSuggestion = null;
    } else if ('style' in op) {
      const d: Extract<TextDelta, { style: unknown }> = { style: op.style, at: op.at };
      const deltas = applyStyleDelta(model, d);
      textOps = textOps.concat(deltas);
      broadcast.push(d);
      prevDeleteSuggestion = null;
    }
  }

  const delta: RevisionDelta = { revision: model.revision + 1, authorId, mode, textOps, suggestionOps };
  model.revision += 1;
  return { broadcast, delta, closedIds };
}

/** Replaces every match in editing mode directly; in suggesting mode each match becomes a replacement suggestion. */
export function applyReplaceAll(model: DocModel, authorId: string, authorRole: DomainRole, mode: Mode, find: string, replace: string, matchCase: boolean): FrameOutcome {
  const delta: RevisionDelta = { revision: model.revision + 1, authorId, mode, textOps: [], suggestionOps: [] };
  const broadcast: TextDelta[] = [];
  const closedIds: string[] = [];
  const openSpans = model.suggestions
    .filter((s) => s.status === 'open')
    .flatMap((s) => [s.inserted, s.deleted])
    .filter((x): x is { at: number; length: number } => x !== null);

  const overlapsSuggestion = (start: number, end: number): boolean =>
    openSpans.some((sp) => Math.max(start, sp.at) < Math.min(end, sp.at + sp.length));

  const matches: { at: number; length: number }[] = [];
  const hay = matchCase ? model.text : model.text.toLowerCase();
  const needle = matchCase ? find : find.toLowerCase();
  let idx = 0;
  while (idx + needle.length <= hay.length) {
    const found = hay.indexOf(needle, idx);
    if (found === -1) break;
    if (!overlapsSuggestion(found, found + needle.length)) matches.push({ at: found, length: needle.length });
    idx = found + needle.length;
  }
  // apply from the end so earlier offsets stay valid
  for (const m of matches.reverse()) {
    if (mode === 'editing') {
      const dels = applyTextDelete(model, m.at, m.length);
      const ins = replace.length > 0 ? applyTextInsert(model, m.at, replace) : [];
      delta.textOps.push(...dels, ...ins);
      broadcast.push(...dels, ...ins);
    } else {
      // the old text stays in place, struck, with the replacement inserted right after it
      const sug = newSuggestion('replace', authorId, authorRole, { deleted: { at: m.at, length: m.length }, inserted: replace.length > 0 ? { at: m.at + m.length, length: replace.length } : null });
      if (replace.length > 0) {
        const ins = applyTextInsert(model, m.at + m.length, replace);
        delta.textOps.push(...ins);
        broadcast.push(...ins);
      }
      model.suggestions.push(sug);
      delta.suggestionOps.push({ created: structuredClone(sug) });
    }
  }
  model.revision += 1;
  delta.revision = model.revision;
  return { broadcast, delta, closedIds };
}

/** First decision wins: returns null when the suggestion is already closed. */
export function applyDecision(model: DocModel, suggestion: ModelSug, decision: 'accept' | 'reject', decidedById: string): { applied: boolean; status: 'accepted' | 'rejected'; delta: RevisionDelta } | null {
  if (suggestion.status !== 'open') return null;
  const now = new Date().toISOString();
  const suggestionOps: SuggestionDelta[] = [];
  const textOps: TextDelta[] = [];
  if (suggestion.contentDeleted) {
    // nothing to change: the card closes as decided
  } else if (decision === 'accept') {
    if (suggestion.inserted) {
      // accepted insertion stays as plain text
    }
    if (suggestion.deleted) {
      textOps.push(...applyTextDelete(model, suggestion.deleted.at, suggestion.deleted.length));
    }
  } else {
    if (suggestion.inserted) {
      textOps.push(...applyTextDelete(model, suggestion.inserted.at, suggestion.inserted.length));
    }
  }
  suggestion.status = decision === 'accept' ? 'accepted' : 'rejected';
  suggestion.closedAt = now;
  suggestion.closedById = decidedById;
  suggestion.decidedById = decidedById;
  suggestionOps.push({ closed: { id: suggestion.id, status: suggestion.status, closedById: decidedById, decidedById, closedAt: now } });
  const delta: RevisionDelta = { revision: model.revision + 1, authorId: decidedById, mode: 'editing', textOps, suggestionOps };
  model.revision += 1;
  return { applied: true, status: suggestion.status, delta };
}

/** Accept all or Reject all as one revision: settles every card still open when processed. */
export function applyDecideAll(
  model: DocModel,
  decision: 'accept' | 'reject',
  decidedById: string,
): { count: number; suggestionIds: string[]; delta: RevisionDelta } {
  const open = model.suggestions.filter((s) => s.status === 'open').map((s) => s.id);
  const now = new Date().toISOString();
  const suggestionOps: SuggestionDelta[] = [];
  const textOps: TextDelta[] = [];
  for (const sugId of open) {
    const sug = model.suggestions.find((s) => s.id === sugId);
    if (!sug || sug.status !== 'open') continue;
    if (!sug.contentDeleted) {
      if (decision === 'accept') {
        if (sug.deleted) textOps.push(...applyTextDelete(model, sug.deleted.at, sug.deleted.length));
      } else if (sug.inserted) {
        textOps.push(...applyTextDelete(model, sug.inserted.at, sug.inserted.length));
      }
    }
    sug.status = decision === 'accept' ? 'accepted' : 'rejected';
    sug.closedAt = now;
    sug.closedById = decidedById;
    sug.decidedById = decidedById;
    suggestionOps.push({ closed: { id: sug.id, status: sug.status, closedById: decidedById, decidedById, closedAt: now } });
  }
  const delta: RevisionDelta = { revision: model.revision + 1, authorId: decidedById, mode: 'editing', textOps, suggestionOps };
  model.revision += 1;
  return { count: open.length, suggestionIds: open, delta };
}

/** Word count of the proposal as it reads without open suggestions: open insertions left out, deletions kept. */
export function wordCount(model: DocModel): number {
  let text = model.text;
  const openInsertions = model.suggestions
    .filter((s) => s.status === 'open' && s.inserted)
    .map((s) => s.inserted!)
    .sort((a, b) => b.at - a.at);
  for (const span of openInsertions) {
    text = text.slice(0, span.at) + ' '.repeat(span.length) + text.slice(span.at + span.length);
  }
  return text.split(/\s+/).filter((w) => /\S/.test(w)).length;
}
