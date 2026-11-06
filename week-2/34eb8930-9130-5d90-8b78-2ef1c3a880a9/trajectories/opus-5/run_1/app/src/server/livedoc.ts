import { applyPrimitives, blocksOf, createEmptyState, type DocState } from '../shared/doc.js';
import type {
  AccessEndedReason,
  Comment,
  CommentStatus,
  OpEntry,
  ServerFrame,
  Suggestion,
  SuggestionKind,
  SuggestionStatus,
  TextEdit,
} from '../shared/types.js';
import { query } from './db.js';
import { notFound, storageUnavailable } from './errors.js';
import { personObject } from './people.js';
import { getObject, putObject } from './storage.js';

export interface DocumentMeta {
  id: string;
  title: string;
  client: string;
  ownerId: string;
  revision: number;
  originRevision: number;
  savedRevision: number;
  saveFailed: boolean;
}

export interface Broadcaster {
  toDocument(documentId: string, frame: ServerFrame, exceptSocketId?: string): void;
  toPerson(personId: string, frame: ServerFrame): void;
  toPersonInDocument(documentId: string, personId: string, frame: ServerFrame): void;
  endAccess(documentId: string, personId: string | null, reason: AccessEndedReason): void;
}

let broadcaster: Broadcaster = {
  toDocument: () => undefined,
  toPerson: () => undefined,
  toPersonInDocument: () => undefined,
  endAccess: () => undefined,
};

export function setBroadcaster(next: Broadcaster): void {
  broadcaster = next;
}

export function broadcast(): Broadcaster {
  return broadcaster;
}

/** Bodies of the seeded proposals, used to write their object when it is missing. */
export const seedBodies = new Map<string, { revision: number; state: DocState }>();

const WRITE_DELAY_MS = 250;
const RETRY_DELAY_MS = 5_000;

export class LiveDocument {
  readonly meta: DocumentMeta;
  readonly state: DocState;
  retainers = 0;
  private dirty = false;
  private writing = false;
  private timer: NodeJS.Timeout | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(meta: DocumentMeta, state: DocState) {
    this.meta = meta;
    this.state = state;
  }

  /** Runs document changes one at a time so revisions keep a single order. */
  async serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  bodyJson(): string {
    return JSON.stringify({
      documentId: this.meta.id,
      revision: this.meta.revision,
      text: this.state.text,
      blocks: blocksOf(this.state),
      marks: this.state.marks,
      suggestions: this.state.suggestions.map((suggestion) => ({
        id: suggestion.id,
        kind: suggestion.kind,
        authorId: suggestion.author.personId,
        inserted: suggestion.inserted,
        deleted: suggestion.deleted,
        contentDeleted: suggestion.contentDeleted,
        status: suggestion.status,
        createdAt: suggestion.createdAt,
      })),
    });
  }

  markChanged(): void {
    this.dirty = true;
    this.schedule(WRITE_DELAY_MS);
  }

  private schedule(delay: number): void {
    if (this.timer || this.writing) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  private async flush(): Promise<void> {
    if (this.writing || !this.dirty) return;
    this.writing = true;
    const revision = this.meta.revision;
    const body = this.bodyJson();
    this.dirty = false;
    try {
      await putObject(this.meta.id, body);
      this.meta.savedRevision = revision;
      this.meta.saveFailed = false;
      await query('update documents set saved_revision = $2, save_failed = false where id = $1', [this.meta.id, revision]);
      broadcaster.toDocument(this.meta.id, { type: 'saved', revision });
    } catch {
      this.dirty = true;
      this.meta.saveFailed = true;
      await query('update documents set save_failed = true where id = $1', [this.meta.id]).catch(() => undefined);
      broadcaster.toDocument(this.meta.id, { type: 'save_failed', revision });
    } finally {
      this.writing = false;
      if (this.dirty) this.schedule(this.meta.saveFailed ? RETRY_DELAY_MS : WRITE_DELAY_MS);
    }
  }

  get unsaved(): boolean {
    return this.dirty || this.writing;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

const live = new Map<string, LiveDocument>();

async function metaOf(documentId: string): Promise<DocumentMeta | null> {
  const result = await query<{
    id: string;
    title: string;
    client: string;
    owner_id: string;
    revision: number;
    origin_revision: number;
    saved_revision: number;
    save_failed: boolean;
  }>(
    'select id, title, client, owner_id, revision, origin_revision, saved_revision, save_failed from documents where id = $1',
    [documentId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    client: row.client,
    ownerId: row.owner_id,
    revision: row.revision,
    originRevision: row.origin_revision,
    savedRevision: row.saved_revision,
    saveFailed: row.save_failed,
  };
}

interface StoredBody {
  revision: number;
  text: string;
  blocks: { style: DocState['blockStyles'][number]; at: number; length: number }[];
  marks: DocState['marks'];
}

async function baseState(meta: DocumentMeta): Promise<{ state: DocState; revision: number }> {
  let raw: string | null = null;
  try {
    raw = await getObject(meta.id);
  } catch {
    if (meta.originRevision > 0 || meta.savedRevision > 0) throw storageUnavailable();
    raw = null;
  }
  if (raw === null) {
    const seed = seedBodies.get(meta.id);
    if (seed) return { state: { ...seed.state, blockStyles: [...seed.state.blockStyles], marks: seed.state.marks.map((m) => ({ ...m })), suggestions: [], comments: [] }, revision: seed.revision };
    if (meta.originRevision > 0 || meta.savedRevision > 0) throw storageUnavailable();
    return { state: createEmptyState(), revision: 0 };
  }
  const body = JSON.parse(raw) as StoredBody;
  const state: DocState = {
    text: body.text,
    blockStyles: body.blocks.map((block) => block.style),
    marks: body.marks.map((mark) => ({ ...mark })),
    suggestions: [],
    comments: [],
  };
  if (state.blockStyles.length === 0) state.blockStyles.push('paragraph');
  return { state, revision: body.revision };
}

async function attachCards(documentId: string, state: DocState): Promise<void> {
  const suggestions = await query<{
    id: string;
    author_id: string;
    kind: SuggestionKind;
    inserted_at: number | null;
    inserted_length: number | null;
    deleted_at: number | null;
    deleted_length: number | null;
    content_deleted: boolean;
    status: SuggestionStatus;
    created_at: Date;
  }>(
    `select id, author_id, kind, inserted_at, inserted_length, deleted_at, deleted_length, content_deleted, status, created_at
     from suggestions where document_id = $1 and status = 'open' order by created_at, id`,
    [documentId],
  );
  state.suggestions = suggestions.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    author: personObject(row.author_id),
    inserted: row.inserted_at === null || row.inserted_length === null ? null : { at: row.inserted_at, length: row.inserted_length },
    deleted: row.deleted_at === null || row.deleted_length === null ? null : { at: row.deleted_at, length: row.deleted_length },
    contentDeleted: row.content_deleted,
    status: row.status,
    createdAt: isoString(row.created_at),
  }));

  const comments = await query<{
    id: string;
    parent_id: string | null;
    author_id: string;
    body: string;
    anchor_at: number | null;
    anchor_length: number | null;
    content_deleted: boolean;
    status: CommentStatus;
    created_at: Date;
  }>(
    `select id, parent_id, author_id, body, anchor_at, anchor_length, content_deleted, status, created_at
     from comments where document_id = $1 order by created_at, id`,
    [documentId],
  );
  const mentions = await query<{ comment_id: string; person_id: string }>(
    'select comment_id, person_id from comment_mentions where comment_id in (select id from comments where document_id = $1)',
    [documentId],
  );
  const byComment = new Map<string, string[]>();
  for (const row of mentions.rows) {
    const list = byComment.get(row.comment_id) ?? [];
    list.push(row.person_id);
    byComment.set(row.comment_id, list);
  }
  const tops = new Map<string, Comment>();
  for (const row of comments.rows) {
    if (row.parent_id === null) {
      tops.set(row.id, {
        id: row.id,
        author: personObject(row.author_id),
        body: row.body,
        mentions: (byComment.get(row.id) ?? []).map((id) => personObject(id)),
        anchor: row.anchor_at === null || row.anchor_length === null ? null : { at: row.anchor_at, length: row.anchor_length },
        contentDeleted: row.content_deleted,
        status: row.status,
        replies: [],
        createdAt: isoString(row.created_at),
      });
    }
  }
  for (const row of comments.rows) {
    if (row.parent_id === null) continue;
    const parent = tops.get(row.parent_id);
    if (!parent) continue;
    parent.replies.push({
      id: row.id,
      author: personObject(row.author_id),
      body: row.body,
      createdAt: isoString(row.created_at),
    });
  }
  state.comments = [...tops.values()];
}

export function isoString(value: Date): string {
  return `${value.toISOString().slice(0, 19)}Z`;
}

async function replayOperations(documentId: string, state: DocState, fromRevision: number): Promise<void> {
  const result = await query<{ revision: number; ops: OpEntry[] }>(
    'select revision, ops from operations where document_id = $1 and revision > $2 order by revision',
    [documentId, fromRevision],
  );
  for (const row of result.rows) applyPrimitives(state, row.ops);
}

/** Loads a proposal's live body: the stored object plus every operation recorded after it. */
export async function loadDocument(documentId: string): Promise<LiveDocument> {
  const existing = live.get(documentId);
  if (existing) return existing;
  const meta = await metaOf(documentId);
  if (!meta) throw notFound();
  const base = await baseState(meta);
  await replayOperations(documentId, base.state, base.revision);
  await attachCards(documentId, base.state);
  const again = live.get(documentId);
  if (again) return again;
  const document = new LiveDocument(meta, base.state);
  live.set(documentId, document);
  if (seedBodies.has(documentId) && meta.savedRevision < meta.revision) document.markChanged();
  return document;
}

export function loadedDocument(documentId: string): LiveDocument | undefined {
  return live.get(documentId);
}

export function retain(documentId: string): void {
  const document = live.get(documentId);
  if (document) document.retainers += 1;
}

export function release(documentId: string): void {
  const document = live.get(documentId);
  if (!document) return;
  document.retainers = Math.max(0, document.retainers - 1);
  if (document.retainers === 0 && !document.unsaved) {
    document.dispose();
    live.delete(documentId);
  }
}

export function forget(documentId: string): void {
  const document = live.get(documentId);
  if (document) document.dispose();
  live.delete(documentId);
}

export async function persistRevision(document: LiveDocument, authorId: string, mode: string, ops: OpEntry[]): Promise<void> {
  document.meta.revision += 1;
  await query(
    'insert into operations (document_id, revision, author_id, mode, ops) values ($1, $2, $3, $4, $5::jsonb)',
    [document.meta.id, document.meta.revision, authorId, mode, JSON.stringify(ops)],
  );
  await query('update documents set revision = $2, updated_at = now() where id = $1', [
    document.meta.id,
    document.meta.revision,
  ]);
  await persistCardOffsets(document);
  document.markChanged();
}

export async function persistCardOffsets(document: LiveDocument): Promise<void> {
  for (const suggestion of document.state.suggestions) {
    await query(
      `update suggestions set kind = $2, inserted_at = $3, inserted_length = $4, deleted_at = $5, deleted_length = $6,
        content_deleted = $7 where id = $1`,
      [
        suggestion.id,
        suggestion.kind,
        suggestion.inserted?.at ?? null,
        suggestion.inserted?.length ?? null,
        suggestion.deleted?.at ?? null,
        suggestion.deleted?.length ?? null,
        suggestion.contentDeleted,
      ],
    );
  }
  for (const comment of document.state.comments) {
    await query('update comments set anchor_at = $2, anchor_length = $3, content_deleted = $4 where id = $1', [
      comment.id,
      comment.anchor?.at ?? null,
      comment.anchor?.length ?? null,
      comment.contentDeleted,
    ]);
  }
}

export async function concurrentTextEdits(documentId: string, fromRevision: number): Promise<TextEdit[]> {
  const result = await query<{ ops: OpEntry[] }>(
    'select ops from operations where document_id = $1 and revision > $2 order by revision',
    [documentId, fromRevision],
  );
  const edits: TextEdit[] = [];
  for (const row of result.rows) {
    for (const entry of row.ops) {
      if ('insert' in entry) edits.push({ kind: 'insert', at: entry.at, length: entry.insert.length });
      else if ('delete' in entry) edits.push({ kind: 'delete', at: entry.at, length: entry.delete });
    }
  }
  return edits;
}

export function suggestionById(document: LiveDocument, id: string): Suggestion | undefined {
  return document.state.suggestions.find((suggestion) => suggestion.id === id);
}

export function commentById(document: LiveDocument, id: string): Comment | undefined {
  return document.state.comments.find((comment) => comment.id === id);
}
