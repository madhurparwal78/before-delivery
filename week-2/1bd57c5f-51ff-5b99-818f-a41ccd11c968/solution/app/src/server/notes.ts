import { randomUUID } from "node:crypto";
import { mayEditNote, type NoteAudience, type NoteHistoryEntry, type Role } from "../shared/domain";
import { canSeeNote, isUuid, lockOpenJob, type JobAccess } from "./access";
import { maybeOne, one, rows, type Tx } from "./db";
import { fail, invalid } from "./errors";
import { emit } from "./events";
import { visibleItem } from "./items";
import { NOTE_MAX, applyEdit, body, codePointLength, createNote, currentRev, history, redo, undo, type NoteState } from "./notetext";
import type { ItemRow, NoteRecord } from "./records";

// Notes threads and their shared editing: every applied edit, undo and redo is a revision of
// the note's character sequence (notetext.ts), stored with who made it, and announced as a
// note event to everyone who can see the note.


const NOTE_COLUMNS = `n.id, n.item_id, n.parent_id, n.body, n.audience, n.author_id, p.name AS author_name, n.author_role, n.rev, n.created_at`;

async function noteRecord(tx: Tx, noteId: string): Promise<NoteRecord> {
  return one<NoteRecord>(tx, `SELECT ${NOTE_COLUMNS} FROM notes n JOIN people p ON p.id = n.author_id WHERE n.id = $1`, [noteId]);
}

async function emitNote(tx: Tx, access: JobAccess, item: ItemRow, noteId: string): Promise<NoteRecord> {
  const note = await noteRecord(tx, noteId);
  const thread = await rows<NoteRecord>(
    tx,
    `SELECT ${NOTE_COLUMNS} FROM notes n JOIN people p ON p.id = n.author_id WHERE n.item_id = $1 ORDER BY n.position`,
    [item.id],
  );
  emit(tx, access.job.id, { type: "note", itemId: item.id, itemTrade: item.trade, note, thread });
  return note;
}

export async function addNote(tx: Tx, access: JobAccess, itemId: unknown, raw: Record<string, unknown>, id = randomUUID()) {
  const item = await visibleItem(tx, access, itemId);
  let parent: { id: string; parent_id: string | null; audience: NoteAudience } | null = null;
  if (raw.parent_id !== undefined && raw.parent_id !== null) {
    parent = isUuid(raw.parent_id)
      ? await maybeOne(tx, "SELECT id, parent_id, audience FROM notes WHERE id = $1 AND item_id = $2", [raw.parent_id, item.id])
      : null;
    if (!parent || !canSeeNote(access, parent.audience)) fail("not_found");
  }
  if (raw.audience === "crew" && !canSeeNote(access, "crew")) fail("forbidden");
  await lockOpenJob(tx, access.job.id);
  const errors: Record<string, string> = {};
  const text = typeof raw.body === "string" ? raw.body.trim() : "";
  const length = codePointLength(text);
  if (length < 1 || length > NOTE_MAX) errors.body = `Write a note of 1 to ${NOTE_MAX.toLocaleString("en-US")} characters.`;
  if (raw.audience !== "crew" && raw.audience !== "everyone") errors.audience = "Choose who can see this note.";
  if (parent?.parent_id) errors.parent_id = "Replies go one level deep; reply to the first note instead.";
  else if (parent?.audience === "crew" && raw.audience !== "crew") errors.audience = "A reply to a crew note stays crew only.";
  if (Object.keys(errors).length > 0) invalid(errors);
  const state = createNote(text, access.memberId);
  await tx.query(
    `INSERT INTO notes (id, item_id, parent_id, audience, author_id, author_role, body, rev, state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8::jsonb)`,
    [id, item.id, parent?.id ?? null, raw.audience, access.person.id, access.role, text, JSON.stringify(state)],
  );
  await tx.query("INSERT INTO note_revisions (note_id, rev, author_id, author_role) VALUES ($1, 0, $2, $3)", [id, access.person.id, access.role]);
  return emitNote(tx, access, item, id);
}

interface LockedNote {
  id: string;
  audience: NoteAudience;
  author_id: string;
  state: NoteState;
}

/** A note the caller can see on a visible item, locked, with the caller's right to edit it checked. */
async function editableNote(tx: Tx, access: JobAccess, itemId: unknown, noteId: unknown): Promise<{ item: ItemRow; note: LockedNote }> {
  const item = await visibleItem(tx, access, itemId);
  const note = isUuid(noteId)
    ? await maybeOne<LockedNote>(tx, "SELECT id, audience, author_id, state FROM notes WHERE id = $1 AND item_id = $2 FOR UPDATE", [
        noteId,
        item.id,
      ])
    : null;
  if (!note || !canSeeNote(access, note.audience)) fail("not_found");
  if (!mayEditNote(access.role, note.author_id === access.person.id)) fail("forbidden");
  await lockOpenJob(tx, access.job.id);
  return { item, note };
}

async function saveRevision(tx: Tx, access: JobAccess, item: ItemRow, noteId: string, state: NoteState): Promise<NoteRecord> {
  const rev = currentRev(state);
  await tx.query("UPDATE notes SET state = $2::jsonb, body = $3, rev = $4 WHERE id = $1", [noteId, JSON.stringify(state), body(state), rev]);
  await tx.query("INSERT INTO note_revisions (note_id, rev, author_id, author_role) VALUES ($1, $2, $3, $4)", [
    noteId,
    rev,
    access.person.id,
    access.role,
  ]);
  return emitNote(tx, access, item, noteId);
}

function integer(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? value : Number.NaN;
}

/** One edit against a base revision, merged by the published character model. */
export async function editNote(tx: Tx, access: JobAccess, itemId: unknown, noteId: unknown, raw: Record<string, unknown>) {
  const { item, note } = await editableNote(tx, access, itemId, noteId);
  if (raw.insert !== undefined && typeof raw.insert !== "string") invalid({ insert: "Send the inserted text as a string." });
  const outcome = applyEdit(note.state, {
    base: integer(raw.base_rev),
    pos: integer(raw.pos),
    del: raw.delete === undefined ? 0 : integer(raw.delete),
    insert: raw.insert ?? "",
    author: access.memberId,
  });
  if (!outcome.ok) invalid({ [outcome.field]: outcome.message });
  return saveRevision(tx, access, item, note.id, outcome.state);
}

export async function undoNote(tx: Tx, access: JobAccess, itemId: unknown, noteId: unknown) {
  const { item, note } = await editableNote(tx, access, itemId, noteId);
  const outcome = undo(note.state, access.memberId);
  if (!outcome.ok) fail("nothing_to_undo");
  return saveRevision(tx, access, item, note.id, outcome.state);
}

export async function redoNote(tx: Tx, access: JobAccess, itemId: unknown, noteId: unknown) {
  const { item, note } = await editableNote(tx, access, itemId, noteId);
  const outcome = redo(note.state, access.memberId);
  if (!outcome.ok) fail("nothing_to_redo");
  return saveRevision(tx, access, item, note.id, outcome.state);
}

export async function noteHistory(tx: Tx, access: JobAccess, itemId: unknown, noteId: unknown): Promise<NoteHistoryEntry[]> {
  const item = await visibleItem(tx, access, itemId);
  const note = isUuid(noteId)
    ? await maybeOne<{ audience: NoteAudience; state: NoteState }>(tx, "SELECT audience, state FROM notes WHERE id = $1 AND item_id = $2", [
        noteId,
        item.id,
      ])
    : null;
  if (!note || !canSeeNote(access, note.audience)) fail("not_found");
  const authors = await rows<{ rev: number; name: string; role: Role; created_at: string }>(
    tx,
    `SELECT r.rev, p.name, r.author_role AS role, r.created_at FROM note_revisions r JOIN people p ON p.id = r.author_id
     WHERE r.note_id = $1 ORDER BY r.rev`,
    [noteId],
  );
  return history(note.state).map((entry) => {
    const author = authors.find((candidate) => candidate.rev === entry.rev)!;
    return { rev: entry.rev, kind: entry.kind, author: { name: author.name, role: author.role }, body: entry.body, created_at: author.created_at };
  });
}
