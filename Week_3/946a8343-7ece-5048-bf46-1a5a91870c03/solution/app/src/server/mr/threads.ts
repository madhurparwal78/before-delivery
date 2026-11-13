// Threads and notes of a request: how they are stored, shown, created and carried onto a new version.
import type { Queryable, Tx } from "../db.ts";
import { iso, now } from "../clock.ts";
import { VersionMapper, type Side } from "./mapper.ts";
import { parseSuggestionBlocks, suggestionRegion } from "./suggestions.ts";
import { versionsOf, type MrRow, type ThreadRow } from "./store.ts";

interface NoteView {
  readonly id: number;
  readonly author: string;
  readonly body: string;
  readonly system: boolean;
  readonly pending: boolean;
  readonly thread_id: number | null;
  readonly created_at: string;
}

interface PositionView {
  readonly path: string;
  readonly old_line: number | null;
  readonly new_line: number | null;
  readonly end_line: number | null;
  readonly version: number;
}

type SuggestionState = "open" | "applied" | "outdated";

interface SuggestionView {
  readonly id: number;
  readonly note_id: number;
  readonly path: string;
  readonly start_line: number;
  readonly end_line: number;
  readonly lines: string[];
  readonly state: SuggestionState;
}

interface ThreadView {
  readonly id: number;
  readonly position: PositionView | null;
  readonly current_line: number | null;
  readonly resolved: boolean;
  readonly outdated: boolean;
  readonly notes: NoteView[];
  readonly suggestions: SuggestionView[];
}

interface NoteRow {
  readonly id: number;
  readonly thread_id: number | null;
  readonly author: string;
  readonly body: string;
  readonly system: boolean;
  readonly pending: boolean;
  readonly created_at: number;
}

export interface SuggestionRow {
  readonly id: number;
  readonly mr_id: number;
  readonly thread_id: number;
  readonly note_id: number;
  readonly above: number;
  readonly below: number;
  readonly lines: string[];
  readonly start_line: number;
  readonly end_line: number;
  readonly outdated: boolean;
  readonly applied: boolean;
}

export function noteView(row: NoteRow): NoteView {
  return { id: row.id, author: row.author, body: row.body, system: row.system, pending: row.pending, thread_id: row.thread_id, created_at: iso(row.created_at) };
}

function threadSide(thread: Pick<ThreadRow, "old_line">): Side {
  return thread.old_line === null ? "new" : "old";
}

function threadStart(thread: Pick<ThreadRow, "old_line" | "new_line">): number {
  return thread.new_line ?? thread.old_line ?? 0;
}

function positionOf(thread: ThreadRow): PositionView | null {
  if (thread.path === null || thread.version === null) return null;
  return { path: thread.path, old_line: thread.old_line, new_line: thread.new_line, end_line: thread.end_line, version: thread.version };
}

function suggestionState(row: Pick<SuggestionRow, "applied" | "outdated">, thread: Pick<ThreadRow, "outdated">): SuggestionState {
  if (row.applied) return "applied";
  return row.outdated || thread.outdated ? "outdated" : "open";
}

/** The threads a person may see, oldest first: published ones, and the person's own pending ones. */
export async function threadViews(q: Queryable, mrId: number, viewerId: number): Promise<ThreadView[]> {
  const threads = await q.q<ThreadRow>("SELECT * FROM mr_threads WHERE mr_id = $1 AND (NOT pending OR author_id = $2) ORDER BY id", [mrId, viewerId]);
  const notes = await q.q<NoteRow>(
    "SELECT id, thread_id, author, body, system, pending, created_at FROM mr_notes WHERE mr_id = $1 AND thread_id IS NOT NULL AND (NOT pending OR user_id = $2) ORDER BY id",
    [mrId, viewerId],
  );
  const suggestions = await q.q<SuggestionRow>("SELECT * FROM mr_suggestions WHERE mr_id = $1 ORDER BY id", [mrId]);
  const visibleNotes = new Set(notes.map((note) => note.id));
  return threads.map((thread) => ({
    id: thread.id,
    position: positionOf(thread),
    current_line: thread.outdated ? null : thread.current_line,
    resolved: thread.resolved,
    outdated: thread.outdated,
    notes: notes.filter((note) => note.thread_id === thread.id).map(noteView),
    suggestions: suggestions
      .filter((row) => row.thread_id === thread.id && visibleNotes.has(row.note_id))
      .map((row) => ({
        id: row.id,
        note_id: row.note_id,
        path: thread.path ?? "",
        start_line: row.start_line,
        end_line: row.end_line,
        lines: row.lines,
        state: suggestionState(row, thread),
      })),
  }));
}

export async function threadViewOf(q: Queryable, mrId: number, viewerId: number, threadId: number): Promise<ThreadView | undefined> {
  return (await threadViews(q, mrId, viewerId)).find((view) => view.id === threadId);
}

export interface NewPosition {
  readonly path: string;
  readonly old_line: number | null;
  readonly new_line: number | null;
  readonly end_line: number | null;
  readonly version: number;
}

interface NoteInput {
  readonly userId: number;
  readonly username: string;
  readonly body: string;
  readonly pending: boolean;
}

/** Inserts a thread note and the suggestion blocks in it (line threads on the new side only). */
export async function insertThreadNote(tx: Tx, mr: MrRow, thread: ThreadRow, input: NoteInput, mapper: VersionMapper): Promise<number> {
  const note = await tx.one<{ id: number }>(
    "INSERT INTO mr_notes (mr_id, thread_id, author, user_id, body, system, pending, created_at) VALUES ($1, $2, $3, $4, $5, false, $6, $7) RETURNING id",
    [mr.id, thread.id, input.username, input.userId, input.body, input.pending, now()],
  );
  if (thread.path === null || thread.version === null || thread.new_line === null) return note.id;
  const first = thread.new_line;
  const last = thread.end_line ?? first;
  for (const block of parseSuggestionBlocks(input.body)) {
    const region = suggestionRegion(first, last, block);
    const mapped = await mapper.map(thread.version, "new", thread.path, region.start, region.end);
    await tx.q(
      `INSERT INTO mr_suggestions (mr_id, thread_id, note_id, above, below, lines, start_line, end_line, outdated, applied)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)`,
      [mr.id, thread.id, note.id, block.above, block.below, block.lines, mapped?.start ?? region.start, mapped?.end ?? region.end, mapped === null],
    );
  }
  return note.id;
}

/** A thread on a line, a range, or the request itself, with its first note. Returns the new thread row. */
export async function insertThread(tx: Tx, mr: MrRow, input: NoteInput, position: NewPosition | null): Promise<ThreadRow> {
  const versions = await versionsOf(tx, mr.id);
  const mapper = new VersionMapper(tx, mr.project_id, versions);
  let current: { start: number; end: number } | null = null;
  if (position !== null) {
    const side: Side = position.old_line === null ? "new" : "old";
    const start = position.new_line ?? position.old_line ?? 0;
    current = await mapper.map(position.version, side, position.path, start, position.end_line ?? start);
  }
  const outdated = position !== null && current === null;
  const thread = await tx.one<ThreadRow>(
    `INSERT INTO mr_threads (mr_id, author_id, path, old_line, new_line, end_line, version, current_line, current_end, outdated, resolved, pending, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, $11, $12) RETURNING *`,
    [
      mr.id, input.userId, position?.path ?? null, position?.old_line ?? null, position?.new_line ?? null, position?.end_line ?? null,
      position?.version ?? null, current?.start ?? null, current?.end ?? null, outdated, input.pending, now(),
    ],
  );
  await insertThreadNote(tx, mr, thread, input, mapper);
  return thread;
}

interface ThreadChange {
  readonly thread: ThreadRow;
  readonly autoResolved: boolean;
}

/** Carries every thread and open suggestion onto the latest version. Outdated stays outdated; with `autoResolve` an
 *  unresolved thread that just became outdated resolves. Returns the threads that changed. */
export async function remapThreads(tx: Tx, mr: MrRow, autoResolve: boolean): Promise<ThreadChange[]> {
  const versions = await versionsOf(tx, mr.id);
  const mapper = new VersionMapper(tx, mr.project_id, versions);
  const threads = await tx.q<ThreadRow>("SELECT * FROM mr_threads WHERE mr_id = $1 AND path IS NOT NULL ORDER BY id", [mr.id]);
  const changes: ThreadChange[] = [];
  for (const thread of threads) {
    if (thread.path === null || thread.version === null) continue;
    let changed = false;
    let outdated = thread.outdated;
    let current = { start: thread.current_line, end: thread.current_end };
    if (!thread.outdated) {
      const start = threadStart(thread);
      const mapped = await mapper.map(thread.version, threadSide(thread), thread.path, start, thread.end_line ?? start);
      if (mapped === null) {
        outdated = true;
        current = { start: null, end: null };
      } else {
        current = { start: mapped.start, end: mapped.end };
      }
      changed = outdated !== thread.outdated || current.start !== thread.current_line || current.end !== thread.current_end;
    }
    const resolve = autoResolve && outdated && !thread.outdated && !thread.resolved;
    changed = changed || resolve;
    const suggestionsChanged = await remapSuggestions(tx, thread, mapper);
    if (!changed && !suggestionsChanged) continue;
    const row = await tx.one<ThreadRow>(
      "UPDATE mr_threads SET outdated = $2, current_line = $3, current_end = $4, resolved = resolved OR $5 WHERE id = $1 RETURNING *",
      [thread.id, outdated, current.start, current.end, resolve],
    );
    changes.push({ thread: row, autoResolved: resolve });
  }
  return changes;
}

async function remapSuggestions(tx: Tx, thread: ThreadRow, mapper: VersionMapper): Promise<boolean> {
  if (thread.path === null || thread.version === null || thread.new_line === null) return false;
  const rows = await tx.q<SuggestionRow>("SELECT * FROM mr_suggestions WHERE thread_id = $1 AND NOT applied AND NOT outdated ORDER BY id", [thread.id]);
  let changed = false;
  for (const row of rows) {
    const first = thread.new_line - row.above;
    const last = (thread.end_line ?? thread.new_line) + row.below;
    const mapped = await mapper.map(thread.version, "new", thread.path, first, last);
    const start = mapped?.start ?? row.start_line;
    const end = mapped?.end ?? row.end_line;
    if (mapped === null || start !== row.start_line || end !== row.end_line) {
      await tx.q("UPDATE mr_suggestions SET start_line = $2, end_line = $3, outdated = $4 WHERE id = $1", [row.id, start, end, mapped === null]);
      changed = true;
    }
  }
  return changed;
}
