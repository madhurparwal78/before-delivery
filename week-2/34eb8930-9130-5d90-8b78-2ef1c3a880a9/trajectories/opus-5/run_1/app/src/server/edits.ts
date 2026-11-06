import {
  type ApplyOutcome,
  applyEntry,
  applySettlement,
  findMatches,
  openSuggestionSpans,
} from '../shared/doc.js';
import { rebaseEntry } from '../shared/ot.js';
import { MAX_DOCUMENT_CHARACTERS, type Comment, type Decision, type EditMode, type OpEntry, type Span, type Suggestion } from '../shared/types.js';
import { query } from './db.js';
import { conflict, invalid, invalidFrame, notFound, tooLarge } from './errors.js';
import {
  type LiveDocument,
  broadcast,
  commentById,
  concurrentTextEdits,
  isoString,
  persistRevision,
  suggestionById,
} from './livedoc.js';
import { createNotice, newId } from './notices.js';
import { personObject } from './people.js';
import { projectComment, projectSuggestion, roleMapFor, withRole } from './snapshot.js';

const CONTROL_CHARACTERS = /[\u0000-\u0009\u000B-\u001F\u007F]/u;
const BLOCK_STYLES = new Set(['title', 'heading1', 'heading2', 'heading3', 'paragraph', 'bullet', 'numbered']);

function checkEntryShape(entry: OpEntry, mode: EditMode): void {
  if ('insert' in entry) {
    if (typeof entry.insert !== 'string' || entry.insert.length < 1 || entry.insert.length > 10_000) throw invalidFrame();
    if (CONTROL_CHARACTERS.test(entry.insert)) throw invalidFrame();
    return;
  }
  if ('delete' in entry) {
    if (!Number.isInteger(entry.delete) || entry.delete < 1) throw invalidFrame();
    return;
  }
  if (mode === 'suggesting') throw invalidFrame();
  if ('style' in entry) {
    if (!BLOCK_STYLES.has(entry.style)) throw invalidFrame();
    return;
  }
  if (entry.mark === 'link') {
    if (entry.value === null) return;
    if (typeof entry.value !== 'string' || entry.value.length > 2_000) throw invalidFrame();
    let url: URL;
    try {
      url = new URL(entry.value);
    } catch {
      throw invalidFrame();
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalidFrame();
    return;
  }
  if (typeof entry.value !== 'boolean') throw invalidFrame();
}

function checkFrameSize(document: LiveDocument, entries: readonly OpEntry[]): void {
  let total = document.state.text.length;
  for (const entry of entries) if ('insert' in entry) total += entry.insert.length;
  if (total > MAX_DOCUMENT_CHARACTERS) throw tooLarge();
}

function checkEntryRange(document: LiveDocument, entry: OpEntry): void {
  const length = document.state.text.length;
  if ('insert' in entry) {
    if (entry.at < 0 || entry.at > length) throw invalidFrame();
    return;
  }
  if ('delete' in entry) {
    if (entry.at < 0 || entry.at + entry.delete > length) throw invalidFrame();
    return;
  }
  if ('style' in entry) {
    if (entry.at < 0 || entry.at > length) throw invalidFrame();
    return;
  }
  if (entry.at < 0 || entry.length < 0 || entry.at + entry.length > length) throw invalidFrame();
}

function primitivesOf(entry: OpEntry, outcome: ApplyOutcome): OpEntry[] {
  if ('insert' in entry) return [entry];
  if ('delete' in entry) return outcome.textEdits.map((edit) => ({ delete: edit.length, at: edit.at }));
  return [entry];
}

async function insertSuggestionRow(document: LiveDocument, suggestion: Suggestion): Promise<void> {
  await query(
    `insert into suggestions (id, document_id, author_id, kind, inserted_at, inserted_length, deleted_at, deleted_length,
       content_deleted, status, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', $10)`,
    [
      suggestion.id,
      document.meta.id,
      suggestion.author.personId,
      suggestion.kind,
      suggestion.inserted?.at ?? null,
      suggestion.inserted?.length ?? null,
      suggestion.deleted?.at ?? null,
      suggestion.deleted?.length ?? null,
      suggestion.contentDeleted,
      suggestion.createdAt,
    ],
  );
}

async function closeSuggestionRow(id: string, status: 'accepted' | 'rejected', decidedBy: string): Promise<void> {
  await query('update suggestions set status = $2, decided_by = $3, decided_at = now() where id = $1', [id, status, decidedBy]);
}

function newSuggestion(personId: string, kind: Suggestion['kind'], inserted: Span | null, deleted: Span | null): Suggestion {
  return {
    id: newId(),
    kind,
    author: personObject(personId),
    inserted,
    deleted,
    contentDeleted: false,
    status: 'open',
    createdAt: isoString(new Date()),
  };
}

interface CardEffects {
  added: Suggestion[];
  changed: Set<string>;
  closed: { id: string; status: 'accepted' | 'rejected'; by: string }[];
  changedComments: Set<string>;
}

function emptyEffects(): CardEffects {
  return { added: [], changed: new Set(), closed: [], changedComments: new Set() };
}

function collectOutcome(effects: CardEffects, outcome: ApplyOutcome, authorId: string): void {
  for (const id of outcome.changedSuggestionIds) effects.changed.add(id);
  for (const id of outcome.emptiedSuggestionIds) effects.changed.add(id);
  for (const id of outcome.emptiedCommentIds) effects.changedComments.add(id);
  for (const id of outcome.withdrawnSuggestionIds) effects.closed.push({ id, status: 'rejected', by: authorId });
}

async function publish(document: LiveDocument, effects: CardEffects): Promise<void> {
  const bus = broadcast();
  const roles = await roleMapFor(document.meta.id);
  for (const suggestion of effects.added) {
    await insertSuggestionRow(document, suggestion);
    bus.toDocument(document.meta.id, { type: 'card_added', card: projectSuggestion(suggestion, roles) });
  }
  for (const id of effects.changed) {
    const card = suggestionById(document, id);
    if (card) bus.toDocument(document.meta.id, { type: 'card_changed', card: projectSuggestion(card, roles) });
  }
  for (const id of effects.changedComments) {
    const card = commentById(document, id);
    if (card) bus.toDocument(document.meta.id, { type: 'card_changed', card: projectComment(card, roles) });
  }
  for (const entry of effects.closed) {
    await closeSuggestionRow(entry.id, entry.status, entry.by);
    bus.toDocument(document.meta.id, {
      type: 'card_closed',
      cardId: entry.id,
      status: entry.status,
      decidedBy: withRole(entry.by, roles),
    });
  }
}

/** Applies one op frame: the server's order, transform, suggestion crediting and broadcast. */
export async function applyOpFrame(
  document: LiveDocument,
  personId: string,
  mode: EditMode,
  baseRevision: number,
  entries: readonly OpEntry[],
  originSocket?: string,
): Promise<number> {
  if (!Number.isInteger(baseRevision) || baseRevision < 0 || baseRevision > document.meta.revision) throw invalidFrame();
  if (!Array.isArray(entries) || entries.length === 0) throw invalidFrame();
  for (const entry of entries) checkEntryShape(entry, mode);
  checkFrameSize(document, entries);

  let pending = await concurrentTextEdits(document.meta.id, baseRevision);
  const effects = emptyEffects();
  const broadcastOps: OpEntry[] = [];
  let lastDeletion: { suggestion: Suggestion; strikeEnd: number } | null = null;

  for (const entry of entries) {
    const rebased = rebaseEntry(entry, mode, pending, false);
    pending = rebased.against;
    for (const moved of rebased.entries) {
      checkEntryRange(document, moved);
      const outcome = applyEntry(document.state, moved, mode, personId);
      broadcastOps.push(...primitivesOf(moved, outcome));
      collectOutcome(effects, outcome, personId);
      if (mode !== 'suggesting') {
        lastDeletion = null;
        continue;
      }
      if ('insert' in moved) {
        const extended = outcome.changedSuggestionIds.length > 0;
        if (!extended) {
          const inserted: Span = { at: moved.at, length: moved.insert.length };
          if (lastDeletion && lastDeletion.strikeEnd === moved.at) {
            lastDeletion.suggestion.kind = 'replace';
            lastDeletion.suggestion.inserted = inserted;
          } else {
            const suggestion = newSuggestion(personId, 'insert', inserted, null);
            document.state.suggestions.push(suggestion);
            effects.added.push(suggestion);
          }
        }
        lastDeletion = null;
        continue;
      }
      if ('delete' in moved) {
        lastDeletion = null;
        for (const span of outcome.strikeSpans) {
          const own = document.state.suggestions.find(
            (candidate) =>
              candidate.author.personId === personId &&
              candidate.kind === 'delete' &&
              candidate.deleted !== null &&
              (candidate.deleted.at + candidate.deleted.length === span.at || candidate.deleted.at === span.at + span.length),
          );
          if (own && own.deleted) {
            const at = Math.min(own.deleted.at, span.at);
            own.deleted = { at, length: own.deleted.length + span.length };
            effects.changed.add(own.id);
            lastDeletion = { suggestion: own, strikeEnd: at + own.deleted.length };
          } else {
            const suggestion = newSuggestion(personId, 'delete', null, span);
            document.state.suggestions.push(suggestion);
            effects.added.push(suggestion);
            lastDeletion = { suggestion, strikeEnd: span.at + span.length };
          }
        }
      }
    }
  }

  await persistRevision(document, personId, mode, broadcastOps);
  if (broadcastOps.length > 0) {
    broadcast().toDocument(
      document.meta.id,
      { type: 'op', revision: document.meta.revision, authorId: personId, mode, ops: broadcastOps },
      originSocket,
    );
  }
  await publish(document, effects);
  return document.meta.revision;
}

export async function applyReplaceAll(
  document: LiveDocument,
  personId: string,
  mode: EditMode,
  baseRevision: number,
  find: string,
  replace: string,
  matchCase: boolean,
): Promise<{ revision: number; count: number }> {
  if (!Number.isInteger(baseRevision) || baseRevision < 0 || baseRevision > document.meta.revision) throw invalidFrame();
  if (typeof find !== 'string' || typeof replace !== 'string' || typeof matchCase !== 'boolean') throw invalidFrame();
  if (find.length === 0 || replace.length > 10_000 || CONTROL_CHARACTERS.test(replace)) throw invalidFrame();
  const matches = findMatches(document.state.text, find, matchCase, openSuggestionSpans(document.state));
  if (matches.length === 0) return { revision: document.meta.revision, count: 0 };
  if (document.state.text.length + matches.length * replace.length > MAX_DOCUMENT_CHARACTERS) throw tooLarge();

  const effects = emptyEffects();
  const ops: OpEntry[] = [];
  for (const match of [...matches].reverse()) {
    if (mode === 'editing') {
      const deleteEntry: OpEntry = { delete: match.length, at: match.at };
      collectOutcome(effects, applyEntry(document.state, deleteEntry, mode, personId), personId);
      ops.push(deleteEntry);
      if (replace.length > 0) {
        const insertEntry: OpEntry = { insert: replace, at: match.at };
        collectOutcome(effects, applyEntry(document.state, insertEntry, mode, personId), personId);
        ops.push(insertEntry);
      }
      continue;
    }
    const at = match.at + match.length;
    const insertEntry: OpEntry = { insert: replace, at };
    const outcome = applyEntry(document.state, insertEntry, 'editing', personId);
    collectOutcome(effects, outcome, personId);
    ops.push(insertEntry);
    const suggestion = newSuggestion(personId, 'replace', { at, length: replace.length }, { at: match.at, length: match.length });
    document.state.suggestions.push(suggestion);
    effects.added.push(suggestion);
  }
  await persistRevision(document, personId, mode, ops);
  broadcast().toDocument(document.meta.id, {
    type: 'op',
    revision: document.meta.revision,
    authorId: personId,
    mode: 'editing',
    ops,
  });
  await publish(document, effects);
  return { revision: document.meta.revision, count: matches.length };
}

function settlementSpan(suggestion: Suggestion, decision: Decision): Span | null {
  if (suggestion.contentDeleted) return null;
  if (suggestion.kind === 'insert') return decision === 'accept' ? null : suggestion.inserted;
  if (suggestion.kind === 'delete') return decision === 'accept' ? suggestion.deleted : null;
  return decision === 'accept' ? suggestion.deleted : suggestion.inserted;
}

/** The one place a decision is settled: the first one the server receives applies. */
export async function decideSuggestion(
  document: LiveDocument,
  personId: string,
  suggestionId: string,
  decision: Decision,
): Promise<{ applied: boolean; status: 'accepted' | 'rejected'; revision: number }> {
  const open = suggestionById(document, suggestionId);
  if (!open) {
    const existing = await query<{ status: 'accepted' | 'rejected' }>(
      "select status from suggestions where id = $1 and document_id = $2 and status <> 'open'",
      [suggestionId, document.meta.id],
    );
    const row = existing.rows[0];
    if (!row) throw notFound();
    return { applied: false, status: row.status, revision: document.meta.revision };
  }
  const status = decision === 'accept' ? 'accepted' : 'rejected';
  const span = settlementSpan(open, decision);
  const effects = emptyEffects();
  const ops: OpEntry[] = [];
  document.state.suggestions = document.state.suggestions.filter((candidate) => candidate.id !== suggestionId);
  if (span && span.length > 0) {
    collectOutcome(effects, applySettlement(document.state, span), personId);
    ops.push({ delete: span.length, at: span.at });
  }
  effects.closed.push({ id: suggestionId, status, by: personId });
  await persistRevision(document, personId, 'editing', ops);
  if (ops.length > 0) {
    broadcast().toDocument(document.meta.id, {
      type: 'op',
      revision: document.meta.revision,
      authorId: personId,
      mode: 'editing',
      ops,
    });
  }
  await publish(document, effects);
  return { applied: true, status, revision: document.meta.revision };
}

export async function decideAll(
  document: LiveDocument,
  personId: string,
  decision: Decision,
): Promise<{ count: number; suggestionIds: string[]; revision: number }> {
  const open = [...document.state.suggestions];
  if (open.length === 0) return { count: 0, suggestionIds: [], revision: document.meta.revision };
  const status = decision === 'accept' ? 'accepted' : 'rejected';
  const effects = emptyEffects();
  const ops: OpEntry[] = [];
  const ordered = [...open].sort((a, b) => {
    const spanA = settlementSpan(a, decision);
    const spanB = settlementSpan(b, decision);
    return (spanB?.at ?? -1) - (spanA?.at ?? -1);
  });
  document.state.suggestions = [];
  for (const suggestion of ordered) {
    const span = settlementSpan(suggestion, decision);
    if (span && span.length > 0) {
      collectOutcome(effects, applySettlement(document.state, span), personId);
      ops.push({ delete: span.length, at: span.at });
    }
    effects.closed.push({ id: suggestion.id, status, by: personId });
  }
  await persistRevision(document, personId, 'editing', ops);
  if (ops.length > 0) {
    broadcast().toDocument(document.meta.id, {
      type: 'op',
      revision: document.meta.revision,
      authorId: personId,
      mode: 'editing',
      ops,
    });
  }
  await publish(document, effects);
  return { count: ordered.length, suggestionIds: ordered.map((suggestion) => suggestion.id), revision: document.meta.revision };
}

export interface CommentInput {
  anchor?: { at: number; length: number } | null;
  body: unknown;
  mentions?: unknown;
  parentId?: unknown;
}

export async function addComment(
  document: LiveDocument,
  personId: string,
  input: CommentInput,
  peopleWithAccessIds: Set<string>,
): Promise<Comment> {
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  const fields: Record<string, string> = {};
  if (body.length < 1 || body.length > 2_000) fields.body = 'Write a comment of 1 to 2,000 characters.';
  const mentionsRaw = input.mentions ?? [];
  const mentions: string[] = Array.isArray(mentionsRaw) ? mentionsRaw.filter((id): id is string => typeof id === 'string') : [];
  if (!Array.isArray(mentionsRaw) || mentions.length !== (mentionsRaw as unknown[]).length) {
    fields.mentions = 'Only people with access to this proposal can be mentioned.';
  } else if (mentions.some((id) => !peopleWithAccessIds.has(id))) {
    fields.mentions = 'Only people with access to this proposal can be mentioned.';
  }
  const parentId = typeof input.parentId === 'string' ? input.parentId : null;
  let parent: Comment | null = null;
  if (parentId !== null) {
    parent = commentById(document, parentId) ?? null;
    if (!parent) throw notFound();
  }
  let anchor: Span | null = null;
  if (parent === null) {
    const raw = input.anchor;
    const at = raw && typeof raw.at === 'number' ? raw.at : -1;
    const length = raw && typeof raw.length === 'number' ? raw.length : 0;
    if (!Number.isInteger(at) || !Number.isInteger(length) || length < 1 || at < 0 || at + length > document.state.text.length) {
      fields.anchor = 'Select the text this comment is about.';
    } else {
      anchor = { at, length };
    }
  }
  if (Object.keys(fields).length > 0) throw invalid(fields);

  const id = newId();
  const createdAt = isoString(new Date());
  await query(
    `insert into comments (id, document_id, parent_id, author_id, body, anchor_at, anchor_length, content_deleted, status, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, false, 'open', $8)`,
    [id, document.meta.id, parentId, personId, body, anchor?.at ?? null, anchor?.length ?? null, createdAt],
  );
  for (const mentioned of mentions) {
    await query('insert into comment_mentions (comment_id, person_id) values ($1, $2)', [id, mentioned]);
  }
  await query('update documents set updated_at = now() where id = $1', [document.meta.id]);

  const bus = broadcast();
  const roles = await roleMapFor(document.meta.id);
  let result: Comment;
  if (parent) {
    parent.replies.push({ id, author: personObject(personId), body, createdAt });
    result = parent;
    bus.toDocument(document.meta.id, { type: 'card_changed', card: projectComment(parent, roles) });
  } else {
    const comment: Comment = {
      id,
      author: personObject(personId),
      body,
      mentions: mentions.map((mentioned) => personObject(mentioned)),
      anchor,
      contentDeleted: false,
      status: 'open',
      replies: [],
      createdAt,
    };
    document.state.comments.push(comment);
    result = comment;
    bus.toDocument(document.meta.id, { type: 'card_added', card: projectComment(comment, roles) });
  }
  for (const mentioned of mentions) {
    if (mentioned === personId) continue;
    await createNotice({
      personId: mentioned,
      kind: 'mention',
      documentId: document.meta.id,
      documentTitle: document.meta.title,
      actorId: personId,
      commentId: parent ? parent.id : id,
    });
  }
  return projectComment(result, roles);
}

export async function setCommentStatus(
  document: LiveDocument,
  commentId: string,
  action: 'resolve' | 'reopen',
): Promise<Comment> {
  const comment = commentById(document, commentId);
  if (!comment) throw notFound();
  if (action === 'resolve' && comment.status === 'resolved') throw conflict('not_open');
  if (action === 'reopen' && comment.status !== 'resolved') throw conflict('not_resolved');
  const status = action === 'resolve' ? 'resolved' : 'reopened';
  comment.status = status;
  await query('update comments set status = $2 where id = $1', [commentId, status]);
  const roles = await roleMapFor(document.meta.id);
  broadcast().toDocument(document.meta.id, { type: 'card_changed', card: projectComment(comment, roles) });
  return projectComment(comment, roles);
}

export async function renameDocument(document: LiveDocument, title: string, client: string): Promise<void> {
  document.meta.title = title;
  document.meta.client = client;
  await query('update documents set title = $2, client = $3, updated_at = now() where id = $1', [
    document.meta.id,
    title,
    client,
  ]);
  broadcast().toDocument(document.meta.id, { type: 'title_changed', title, client });
}
