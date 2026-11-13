import type { Comment } from "../shared/types";
import { MENTIONS_MAX, NOTE_MAX } from "../shared/limits";
import { codePoints } from "../shared/codepoints";
import { FIELD_ERRORS, mentionCopy } from "../shared/copy";
import { one, pool, query, tx, type Db } from "./db";
import { invalid, notFound } from "./errors";
import { newId } from "./ids";
import { hub } from "./live";
import { enqueueNotifications } from "./mail";
import { loadProjectRow } from "./timeline/store";
import { clipsOf } from "./projects";
import type { Actor } from "./access";
import type { PinEffect } from "./timeline/effects";

interface CommentRow {
  id: string;
  author_name: string;
  body: string;
  visibility: Comment["visibility"];
  parent_id: string | null;
  cut_id: string | null;
  pin_frame: number;
  pin_row_id: string | null;
  pin_clip_id: string | null;
  pin_offset: number | null;
  mentions: string[];
  created_at: Date;
}

interface PinClip {
  id: string;
  row_id: string;
  start_frame: number;
}

/** A note as the API shows it; its live frame follows the clip it is pinned to. */
export function commentFromRow(row: CommentRow, clips: ReadonlyMap<string, PinClip>): Comment {
  const clip = row.pin_clip_id ? clips.get(row.pin_clip_id) : undefined;
  return {
    id: row.id,
    author_name: row.author_name,
    body: row.body,
    visibility: row.visibility,
    parent_id: row.parent_id,
    cut_id: row.cut_id,
    pin: {
      frame: row.pin_frame,
      row_id: clip ? clip.row_id : row.pin_row_id,
      clip_id: row.pin_clip_id,
      live_frame: clip && row.pin_offset !== null ? clip.start_frame + row.pin_offset : row.pin_frame,
    },
    mentions: row.mentions,
    created_at: row.created_at.toISOString(),
  };
}

export async function pinClips(db: Db, projectId: string): Promise<Map<string, PinClip>> {
  const project = await loadProjectRow(db, projectId);
  if (!project) return new Map();
  return new Map((await clipsOf(db, project)).map((clip) => [clip.id, clip]));
}

export async function listComments(db: Db, projectId: string, where = "", params: unknown[] = []): Promise<Comment[]> {
  const rows = await query<CommentRow>(`SELECT * FROM comments WHERE project_id = $1 ${where} ORDER BY seq`, [projectId, ...params], db);
  const clips = await pinClips(db, projectId);
  return rows.map((row) => commentFromRow(row, clips));
}

/** Applies row-ripple shifts and last-frame freezes to the stored pin frames; returns the notes that changed. */
export async function applyPins(
  db: Db,
  projectId: string,
  effects: readonly PinEffect[],
): Promise<{ ids: string[]; before: { id: string; frame: number }[]; after: { id: string; frame: number }[] }> {
  const before = new Map<string, number>();
  const after = new Map<string, number>();
  for (const effect of effects) {
    const rows =
      effect.kind === "shift"
        ? await query<CommentRow>(
            "SELECT * FROM comments WHERE project_id=$1 AND pin_row_id=$2 AND pin_clip_id IS NULL AND pin_frame >= $3 FOR UPDATE",
            [projectId, effect.row_id, effect.from_frame],
            db,
          )
        : await query<CommentRow>("SELECT * FROM comments WHERE project_id=$1 AND pin_clip_id=$2 FOR UPDATE", [projectId, effect.clip_id], db);
    for (const row of rows) {
      const next = effect.kind === "shift" ? row.pin_frame + effect.delta : effect.start_frame + (row.pin_offset ?? 0);
      if (next === row.pin_frame) continue;
      if (!before.has(row.id)) before.set(row.id, row.pin_frame);
      after.set(row.id, next);
      await db.query("UPDATE comments SET pin_frame = $2 WHERE id = $1", [row.id, next]);
    }
  }
  const toList = (map: Map<string, number>): { id: string; frame: number }[] => [...map].map(([id, frame]) => ({ id, frame }));
  return { ids: [...after.keys()], before: toList(before), after: toList(after) };
}

export async function setPinFrames(db: Db, pins: readonly { id: string; frame: number }[]): Promise<string[]> {
  for (const pin of pins) await db.query("UPDATE comments SET pin_frame = $2 WHERE id = $1", [pin.id, pin.frame]);
  return pins.map((pin) => pin.id);
}

export async function commentsByIds(db: Db, projectId: string, ids: readonly string[]): Promise<Comment[]> {
  if (!ids.length) return [];
  return listComments(db, projectId, "AND id = ANY($2)", [ids]);
}

const MENTION = /(?<![\w@])@([A-Za-z0-9_]+)/g;

function mentionedHandles(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION)].map((match) => (match[1] ?? "").toLowerCase()))];
}

interface NoteInput {
  body: string;
  frame: number;
  row_id: string | null;
  clip_id: string | null;
  cut_id: string | null;
  visibility: Comment["visibility"];
  parent_id: string | null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function parseNote(raw: unknown, allowEmpty = false): NoteInput {
  const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const body = typeof input["body"] === "string" ? input["body"] : "";
  const length = codePoints(body);
  const errors: Record<string, string> = {};
  if (length > NOTE_MAX || (!allowEmpty && (length < 1 || body.trim().length === 0))) errors["body"] = FIELD_ERRORS.body;
  const frame = input["frame"];
  if (typeof frame !== "number" || !Number.isInteger(frame) || frame < 0) errors["frame"] = FIELD_ERRORS.other;
  const visibility = input["visibility"];
  if (visibility !== "team" && visibility !== "review") errors["visibility"] = FIELD_ERRORS.other;
  if (Object.keys(errors).length) throw invalid(errors);
  return {
    body,
    frame: frame as number,
    row_id: str(input["row_id"]),
    clip_id: str(input["clip_id"]),
    cut_id: str(input["cut_id"]),
    visibility: visibility as Comment["visibility"],
    parent_id: str(input["parent_id"]),
  };
}

async function projectHandles(db: Db, projectId: string): Promise<Map<string, { id: string; name: string; email: string }>> {
  const rows = await query<{ id: string; name: string; email: string; handle: string }>(
    `SELECT p.id, p.name, p.email, p.handle FROM people p
       WHERE p.is_owner OR p.id IN (SELECT person_id FROM members WHERE project_id = $1)`,
    [projectId],
    db,
  );
  return new Map(rows.map((row) => [row.handle, row]));
}

/** The review a team note on the live timeline is offered to: the shared cut of the newest link, else the newest cut. */
async function defaultCut(db: Db, projectId: string): Promise<string | null> {
  const link = await one<{ cut_id: string }>("SELECT cut_id FROM review_links WHERE project_id = $1 ORDER BY seq DESC LIMIT 1", [projectId], db);
  if (link) return link.cut_id;
  return (await one<{ id: string }>("SELECT id FROM cuts WHERE project_id = $1 ORDER BY seq DESC LIMIT 1", [projectId], db))?.id ?? null;
}

export async function postNote(projectId: string, actor: Actor, raw: unknown): Promise<Comment> {
  const note = parseNote(raw);
  if (!(await loadProjectRow(pool, projectId))) throw notFound();
  const people = await projectHandles(pool, projectId);
  const handles = mentionedHandles(note.body);
  if (handles.length > MENTIONS_MAX) throw invalid({ mentions: FIELD_ERRORS.mentions });
  const unknown = handles.find((handle) => !people.has(handle));
  if (unknown) throw invalid({ mention: mentionCopy(unknown) });
  const created = await tx(async (db) => {
    const clip = note.clip_id ? (await pinClips(db, projectId)).get(note.clip_id) : undefined;
    if (note.clip_id && !clip) throw notFound();
    const parent = note.parent_id
      ? await one<{ author_id: string | null }>("SELECT author_id FROM comments WHERE id = $1 AND project_id = $2", [note.parent_id, projectId], db)
      : undefined;
    if (note.parent_id && !parent) throw notFound();
    const cutId = note.visibility === "review" ? (note.cut_id ?? (await defaultCut(db, projectId))) : note.cut_id;
    let offset: number | null = null;
    if (clip) {
      const snapshot = cutId
        ? await one<{ snapshot: { clips: PinClip[] } }>("SELECT snapshot FROM cuts WHERE id = $1 AND project_id = $2", [cutId, projectId], db)
        : undefined;
      const inCut = snapshot?.snapshot.clips.find((candidate) => candidate.id === clip.id);
      offset = note.frame - (inCut ?? clip).start_frame;
    }
    const id = newId("n");
    await db.query(
      `INSERT INTO comments (id, project_id, author_id, author_name, body, visibility, parent_id, cut_id, pin_frame,
         pin_row_id, pin_clip_id, pin_offset, mentions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, projectId, actor.id, actor.name, note.body, note.visibility, note.parent_id, cutId, note.frame, note.row_id ?? clip?.row_id ?? null, note.clip_id, offset, JSON.stringify(handles)],
    );
    await db.query("DELETE FROM comment_drafts WHERE project_id = $1 AND person_id = $2", [projectId, actor.id]);
    const recipients = new Set<string>();
    for (const handle of handles) {
      const person = people.get(handle);
      if (person) recipients.add(person.id);
    }
    if (parent?.author_id) recipients.add(parent.author_id);
    recipients.delete(actor.id);
    await enqueueNotifications(db, [...recipients], projectId, actor.name, note.frame, note.body);
    return (await listComments(db, projectId, "AND id = $2", [id]))[0];
  });
  if (!created) throw notFound();
  hub.toProject(projectId, { type: "comment", comment: created });
  return created;
}
