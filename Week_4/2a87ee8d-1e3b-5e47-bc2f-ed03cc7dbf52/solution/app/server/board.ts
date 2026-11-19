// Board endpoints: frames, notes, clusters, connectors, dots, images, presence and search.
import { db, newId, notify, tx, type Db } from "./db.js";
import { ApiError, FIELD, fail, type Fields } from "./errors.js";
import { reply, type Reply, type Req } from "./http.js";
import { ACTIVE_SESSION_SQL, actorFor, actorKey, authenticate, type Actor, type Caller } from "./auth.js";
import { consume, type LimitClass } from "./rateLimit.js";
import { once } from "./ops.js";
import { findWorkshop, lockWorkshop, workshopOf, type WorkshopRow } from "./store.js";
import { assertWritable } from "./billing.js";
import { commit } from "./versions.js";
import { record } from "./activity.js";
import { returnAllOn, returnDot, spendDot } from "./dots.js";
import { cleanImage, imageKey, releaseImage } from "./images.js";
import { getObject, putObject, StorageDown } from "./storage.js";
import { restoreTrash, trashFrame, liveTrash } from "./trash.js";
import { boardView, clusterView, frameView, loadBoard, noteView, readableBy, sentTo, type NoteRow } from "./projection.js";
import {
  ACCEPTED,
  asObject,
  boundedText,
  checkState,
  isCoordinate,
  isInteger,
  isSize,
  phaseLocked,
  throwFields,
  unknownKeys,
} from "./rules.js";

type Kind = "workshop" | "frame" | "note" | "cluster" | "connector" | "trash";

interface Context {
  caller: Caller;
  actor: Actor;
  w: WorkshopRow;
}

/** Steps 2–4 of the error order: session, rate limit, then the resource and its workspace. */
export async function resolve(req: Req, kind: Kind, id: string, limit?: LimitClass): Promise<Context> {
  const caller = await authenticate(req);
  const workshopId = kind === "workshop" ? id : await workshopOf(db, kind, id);
  const w = workshopId ? await findWorkshop(db, workshopId) : undefined;
  let actor: Actor | null = null;
  if (w) {
    try {
      actor = actorFor(caller, w);
    } catch {
      actor = null;
    }
  }
  if (limit) await consume(req, limit, actorKey(actor ?? callerActor(caller)));
  if (!w || !actor) fail("not_found");
  return { caller, actor, w };
}

/** The acting identity before the resource is known: authenticate() guarantees one exists. */
function callerActor(caller: Caller): Actor {
  const actor = caller.facilitator ?? caller.participants[0];
  if (!actor) fail("unauthenticated");
  return actor;
}

function forbidUnless(condition: boolean): void {
  if (!condition) fail("forbidden");
}

/** Re-reads the participant's session under the workshop lock, so a write racing a revoke either wins or ends. */
async function stillActive(t: Db, actor: Actor): Promise<void> {
  if (actor.kind === "facilitator") return;
  const row = await t.one<{ active: boolean }>(
    `SELECT ${ACTIVE_SESSION_SQL} AS active FROM participants p JOIN join_links l ON l.id = p.link_id JOIN workshops w ON w.id = p.workshop_id WHERE p.id = $1`,
    [actor.id],
  );
  if (!row?.active) fail("session_ended");
}

async function begin(t: Db, ctx: Context): Promise<WorkshopRow> {
  const w = await lockWorkshop(t, ctx.w.id);
  await stillActive(t, ctx.actor);
  await assertWritable(t, w.facilitator_id);
  return w;
}

async function noteRow(t: Db, id: string): Promise<NoteRow | undefined> {
  return t.one<NoteRow>(
    `SELECT n.*, coalesce(p.display_name, f.name) AS author_name FROM notes n
     JOIN workshops w ON w.id = n.workshop_id JOIN facilitators f ON f.id = w.facilitator_id
     JOIN frames fr ON fr.id = n.frame_id AND fr.trash_id IS NULL
     LEFT JOIN participants p ON p.id = n.author_participant_id WHERE n.id = $1`,
    [id],
  );
}

async function activeFrame(t: Db, workshopId: string, frameId: unknown) {
  if (typeof frameId !== "string") return undefined;
  return t.one<{ id: string; title: string }>("SELECT id, title FROM frames WHERE id = $1 AND workshop_id = $2 AND trash_id IS NULL", [frameId, workshopId]);
}

async function renumber(t: Db, clusterId: string, order: string[]): Promise<void> {
  for (const [index, id] of order.entries()) await t.run("UPDATE notes SET cluster_index = $2, cluster_id = $3 WHERE id = $1", [id, index, clusterId]);
}

async function members(t: Db, clusterId: string): Promise<string[]> {
  return (await t.rows<{ id: string }>("SELECT id FROM notes WHERE cluster_id = $1 ORDER BY cluster_index, seq", [clusterId])).map((r) => r.id);
}

/** The placement write: frame, cluster and order. Every cluster stays a gap-free order with each note once. */
async function place(t: Db, note: { id: string; cluster_id: string | null }, frameId: string, clusterId: string | null, index: number | undefined) {
  if (note.cluster_id) await renumber(t, note.cluster_id, (await members(t, note.cluster_id)).filter((id) => id !== note.id));
  await t.run("UPDATE notes SET frame_id = $2, cluster_id = NULL, cluster_index = NULL WHERE id = $1", [note.id, frameId]);
  if (!clusterId) return;
  const order = (await members(t, clusterId)).filter((id) => id !== note.id);
  order.splice(Math.min(index ?? order.length, order.length), 0, note.id);
  await renumber(t, clusterId, order);
}

async function removeNote(t: Db, w: WorkshopRow, note: NoteRow): Promise<void> {
  if (note.cluster_id) await renumber(t, note.cluster_id, (await members(t, note.cluster_id)).filter((id) => id !== note.id));
  await t.run("DELETE FROM connectors WHERE from_note = $1 OR to_note = $1", [note.id]);
  await t.run("DELETE FROM notes WHERE id = $1", [note.id]);
  if (note.image_id) await releaseImage(t, w.id, note.image_id);
}

// ---- reads ----

export async function getBoard(req: Req, p: Record<string, string>): Promise<Reply> {
  const ctx = await resolve(req, "workshop", p.id ?? "");
  return reply(200, await boardView(db, ctx.actor, ctx.w));
}

export async function search(req: Req, p: Record<string, string>): Promise<Reply> {
  const ctx = await resolve(req, "workshop", p.id ?? "");
  const q = boundedText(req.query.get("q") ?? "", 1, 100);
  if (q === null) throw new ApiError("validation", { fields: { q: FIELD.query } });
  const viewer = ctx.actor;
  const rows = await db.rows<{ id: string; frame_id: string; text: string }>(
    `SELECT n.id, n.frame_id, n.text FROM notes n JOIN frames f ON f.id = n.frame_id AND f.trash_id IS NULL,
       websearch_to_tsquery('simple', $2) query
     WHERE n.workshop_id = $1 AND n.kind = 'text' AND to_tsvector('simple', coalesce(n.text, '')) @@ query
       AND (${viewer.kind === "facilitator" ? "n.revealed OR n.author_participant_id IS NULL" : "(n.revealed AND NOT n.facilitator_only) OR n.author_participant_id = $3"})
     ORDER BY ts_rank_cd(to_tsvector('simple', coalesce(n.text, '')), query) DESC, n.created_at, n.id LIMIT 20`,
    viewer.kind === "facilitator" ? [ctx.w.id, q] : [ctx.w.id, q, viewer.id],
  );
  return reply(200, { results: rows.map((r) => ({ noteId: r.id, frameId: r.frame_id, text: r.text })) });
}

export async function presence(req: Req, p: Record<string, string>): Promise<Reply> {
  const caller = await authenticate(req);
  const w = await findWorkshop(db, p.id ?? "");
  let actor: Actor | null = null;
  if (w) {
    try {
      actor = actorFor(caller, w);
    } catch {
      actor = null;
    }
  }
  await consume(req, "presence", actorKey(actor ?? callerActor(caller)));
  if (!w || !actor) fail("not_found");
  const body = asObject(req.json);
  const fields: Fields = unknownKeys(body, { top: ["x", "y"] });
  if (!isCoordinate(body.x)) fields.x = FIELD.other;
  if (!isCoordinate(body.y)) fields.y = FIELD.other;
  throwFields(fields);
  const cursorId = actor.kind === "facilitator" ? `f-${actor.id.slice(0, 8)}` : actor.cursorId;
  const hue = actor.kind === "facilitator" ? 32 : actor.hue;
  const name = actor.kind === "facilitator" ? actor.name : actor.displayName;
  await notify(db, { t: "presence", w: w.id, from: actorKey(actor), cursorId, hue, x: body.x as number, y: body.y as number, name });
  return reply(204);
}

// ---- frames ----

export async function createFrame(req: Req, p: Record<string, string>): Promise<Reply> {
  const ctx = await resolve(req, "workshop", p.id ?? "", "boardWrites");
  forbidUnless(ctx.actor.kind === "facilitator");
  return once(req, actorKey(ctx.actor), async (t) => {
    const w = await begin(t, ctx);
    checkState(ctx.actor, w, "frame");
    const body = asObject(req.json);
    const fields = unknownKeys(body, ACCEPTED.createFrame);
    const title = boundedText(body.title, 1, 60);
    if (title === null) fields.title = FIELD.other;
    for (const key of ["x", "y"] as const) if (!isCoordinate(body[key])) fields[key] = FIELD.other;
    for (const key of ["width", "height"] as const) if (!isSize(body[key])) fields[key] = FIELD.other;
    throwFields(fields);
    const id = newId();
    await t.run(
      `INSERT INTO frames (id, workshop_id, title, x, y, width, height, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT coalesce(max(position), -1) + 1 FROM frames WHERE workshop_id = $2))`,
      [id, w.id, title, body.x as number, body.y as number, body.width as number, body.height as number],
    );
    await commit(t, w.id);
    return reply(201, { frame: await frameJson(t, w, id) });
  });
}

export async function patchFrame(req: Req, p: Record<string, string>): Promise<Reply> {
  const ctx = await resolve(req, "frame", p.id ?? "", "boardWrites");
  forbidUnless(ctx.actor.kind === "facilitator");
  return once(req, actorKey(ctx.actor), async (t) => {
    const w = await begin(t, ctx);
    const frame = await activeFrame(t, w.id, p.id);
    if (!frame) fail("not_found");
    checkState(ctx.actor, w, "frame");
    const body = asObject(req.json);
    const fields = unknownKeys(body, ACCEPTED.patchFrame);
    const updates: Record<string, string | number> = {};
    if ("title" in body) {
      const title = boundedText(body.title, 1, 60);
      if (title === null) fields.title = FIELD.other;
      else updates.title = title;
    }
    for (const key of ["x", "y"] as const) if (key in body) (isCoordinate(body[key]) ? (updates[key] = body[key] as number) : (fields[key] = FIELD.other));
    for (const key of ["width", "height"] as const) if (key in body) (isSize(body[key]) ? (updates[key] = body[key] as number) : (fields[key] = FIELD.other));
    throwFields(fields);
    for (const [key, value] of Object.entries(updates)) await t.run(`UPDATE frames SET ${key} = $2 WHERE id = $1`, [frame.id, value]);
    await commit(t, w.id);
    return reply(200, { frame: await frameJson(t, w, frame.id) });
  });
}

export async function trash(req: Req, p: Record<string, string>): Promise<Reply> {
  const ctx = await resolve(req, "frame", p.id ?? "", "boardWrites");
  forbidUnless(ctx.actor.kind === "facilitator");
  return once(req, actorKey(ctx.actor), async (t) => {
    const w = await begin(t, ctx);
    const frame = await activeFrame(t, w.id, p.id);
    if (!frame) fail("not_found");
    checkState(ctx.actor, w, "frame");
    throwFields(unknownKeys(asObject(req.json), ACCEPTED.opOnly));
    const trashItem = await trashFrame(t, w.id, frame);
    await record(t, w.facilitator_id, "frame.trashed", w.id);
    await commit(t, w.id);
    return reply(200, { trashItem });
  });
}

export async function restore(req: Req, p: Record<string, string>): Promise<Reply> {
  const ctx = await resolve(req, "trash", p.id ?? "", "boardWrites");
  forbidUnless(ctx.actor.kind === "facilitator");
  return once(req, actorKey(ctx.actor), async (t) => {
    const w = await begin(t, ctx);
    const live = await t.one(`SELECT 1 AS ok FROM trash_items t WHERE t.id = $1 AND ${liveTrash("t")}`, [p.id ?? ""]);
    if (!live) fail("not_found");
    checkState(ctx.actor, w, "frame");
    throwFields(unknownKeys(asObject(req.json), ACCEPTED.opOnly));
    const out = await restoreTrash(t, w.id, p.id ?? "");
    await record(t, w.facilitator_id, "frame.restored", w.id);
    await commit(t, w.id);
    return reply(200, { frame: await frameJson(t, w, out.frameId), restored: out.restored });
  });
}

// ---- images ----

export async function uploadImage(req: Req, p: Record<string, string>): Promise<Reply> {
  const ctx = await resolve(req, "workshop", p.id ?? "", "uploads");
  return tx(async (t) => {
    const w = await findWorkshop(t, ctx.w.id);
    if (!w) fail("not_found");
    await stillActive(t, ctx.actor);
    await assertWritable(t, w.facilitator_id);
    checkState(ctx.actor, w, "noteCreate");
    const image = cleanImage(req.raw, (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "");
    const id = newId();
    try {
      await putObject(imageKey(w.id, id), image.bytes, image.type);
    } catch (error) {
      if (error instanceof StorageDown) throw new ApiError("storage_unavailable");
      throw error;
    }
    await t.run("INSERT INTO images (id, workshop_id, uploader, content_type, width, height) VALUES ($1, $2, $3, $4, $5, $6)", [
      id,
      w.id,
      actorKey(ctx.actor),
      image.type,
      image.width,
      image.height,
    ]);
    return reply(201, { imageId: id, width: image.width, height: image.height });
  });
}

export async function getImage(req: Req, p: Record<string, string>): Promise<Reply> {
  const ctx = await resolve(req, "note", p.id ?? "");
  const note = await noteRow(db, p.id ?? "");
  if (!note || note.kind !== "image" || !note.image_id || !readableBy(ctx.actor, note)) fail("not_found");
  const image = await db.one<{ content_type: string }>("SELECT content_type FROM images WHERE id = $1", [note.image_id]);
  let bytes: Buffer | null;
  try {
    bytes = await getObject(imageKey(ctx.w.id, note.image_id));
  } catch (error) {
    if (error instanceof StorageDown) throw new ApiError("storage_unavailable");
    throw error;
  }
  if (!bytes || !image) fail("not_found");
  return { status: 200, bytes, contentType: image.content_type, headers: { "Content-Disposition": "inline", "Cache-Control": "private, no-store" } };
}

// ---- notes ----

export async function createNote(req: Req, p: Record<string, string>): Promise<Reply> {
  const ctx = await resolve(req, "workshop", p.id ?? "", "boardWrites");
  const body = asObject(req.json);
  forbidUnless(ctx.actor.kind === "facilitator" || body.facilitatorOnly !== true);
  return once(req, actorKey(ctx.actor), async (t) => {
    const w = await begin(t, ctx);
    checkState(ctx.actor, w, "noteCreate");
    const fields = unknownKeys(body, ACCEPTED.createNote);
    const frame = await activeFrame(t, w.id, body.frameId);
    if (!frame) fields.frameId = FIELD.other;
    if (body.kind !== "text" && body.kind !== "image") fields.kind = FIELD.other;
    const text = body.kind === "text" ? boundedText(body.text, 1, 280) : null;
    if (body.kind === "text" && text === null) fields.text = FIELD.other;
    if (body.kind === "image" && "text" in body) fields.text = FIELD.other;
    let imageId: string | null = null;
    if (body.kind === "image") {
      const image = typeof body.imageId === "string" ? await t.one<{ id: string; uploader: string; note_id: string | null }>(
        "SELECT id, uploader, note_id FROM images WHERE id = $1 AND workshop_id = $2 AND NOT gone",
        [body.imageId, w.id],
      ) : undefined;
      if (!image || image.note_id !== null || image.uploader !== actorKey(ctx.actor)) fields.imageId = FIELD.imageId;
      else imageId = image.id;
    } else if ("imageId" in body) fields.imageId = FIELD.other;
    if (!isCoordinate(body.x)) fields.x = FIELD.other;
    if (!isCoordinate(body.y)) fields.y = FIELD.other;
    if ("facilitatorOnly" in body && typeof body.facilitatorOnly !== "boolean") fields.facilitatorOnly = FIELD.other;
    throwFields(fields);
    const id = newId();
    const participant = ctx.actor.kind === "participant" ? ctx.actor.id : null;
    const revealed = !(participant !== null && w.status === "silent_round");
    await t.run(
      `INSERT INTO notes (id, workshop_id, frame_id, kind, text, image_id, x, y, revealed, facilitator_only, author_participant_id, round)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [id, w.id, frame?.id ?? "", body.kind as string, text, imageId, body.x as number, body.y as number, revealed, body.facilitatorOnly === true, participant, w.round_number],
    );
    if (imageId) await t.run("UPDATE images SET note_id = $2 WHERE id = $1", [imageId, id]);
    await commit(t, w.id);
    const row = await noteRow(t, id);
    if (!row) fail("not_found");
    return reply(201, { note: noteView(ctx.actor, row) });
  });
}

export async function patchNote(req: Req, p: Record<string, string>): Promise<Reply> {
  const ctx = await resolve(req, "note", p.id ?? "", "boardWrites");
  const body = asObject(req.json);
  const before = await noteRow(db, p.id ?? "");
  if (!before || !sentTo(ctx.actor, before)) fail("not_found");
  forbidUnless(ctx.actor.kind === "facilitator" || !("facilitatorOnly" in body));
  forbidUnless(readableBy(ctx.actor, before));
  return once(req, actorKey(ctx.actor), async (t) => {
    const w = await begin(t, ctx);
    const note = await noteRow(t, p.id ?? "");
    if (!note || !sentTo(ctx.actor, note)) fail("not_found");
    if (!readableBy(ctx.actor, note)) fail("forbidden");
    const placing = "placement" in body;
    checkState(ctx.actor, w, placing ? "notePlacement" : "noteEdit");
    if (ctx.actor.kind === "participant" && w.status === "silent_round" && (note.revealed || note.author_participant_id !== ctx.actor.id)) {
      phaseLocked(w.status);
    }
    const fields = unknownKeys(body, ACCEPTED.patchNote);
    const changes = Object.keys(body).filter((k) => k !== "clientOpId" && !(k in fields));
    if (changes.length === 0 && Object.keys(fields).length === 0) fields.body = FIELD.other;
    let position: { x: number; y: number } | null = null;
    if ("position" in body) {
      const pos = asObject(body.position);
      if (!isCoordinate(pos.x)) fields["position.x"] = FIELD.other;
      if (!isCoordinate(pos.y)) fields["position.y"] = FIELD.other;
      if (isCoordinate(pos.x) && isCoordinate(pos.y)) position = { x: pos.x, y: pos.y };
    }
    let text: string | null = null;
    if ("text" in body) {
      text = note.kind === "text" ? boundedText(body.text, 1, 280) : null;
      if (text === null) fields.text = FIELD.other;
    }
    let placement: { frameId: string; clusterId: string | null; index: number | undefined } | null = null;
    if (placing) {
      const pl = asObject(body.placement);
      const frame = await activeFrame(t, w.id, pl.frameId);
      if (!frame) fields["placement.frameId"] = FIELD.other;
      const clusterId = pl.clusterId ?? null;
      if (clusterId !== null) {
        const cluster = typeof clusterId === "string" ? await t.one<{ frame_id: string }>("SELECT frame_id FROM clusters WHERE id = $1 AND workshop_id = $2", [clusterId, w.id]) : undefined;
        if (!cluster || cluster.frame_id !== frame?.id) fields["placement.clusterId"] = FIELD.other;
        else if (!note.revealed || note.facilitator_only) fields["placement.clusterId"] = FIELD.other;
      }
      if ("index" in pl && !isInteger(pl.index, 0, 100000)) fields["placement.index"] = FIELD.other;
      if (frame) placement = { frameId: frame.id, clusterId: clusterId as string | null, index: pl.index as number | undefined };
    }
    if ("facilitatorOnly" in body && typeof body.facilitatorOnly !== "boolean") fields.facilitatorOnly = FIELD.other;
    throwFields(fields);
    if (position) await t.run("UPDATE notes SET x = $2, y = $3 WHERE id = $1", [note.id, position.x, position.y]);
    if (text !== null) await t.run("UPDATE notes SET text = $2 WHERE id = $1", [note.id, text]);
    if (placement) await place(t, note, placement.frameId, placement.clusterId, placement.index);
    if (typeof body.facilitatorOnly === "boolean" && body.facilitatorOnly !== note.facilitator_only) {
      const current = await noteRow(t, note.id);
      if (current?.cluster_id) await place(t, current, current.frame_id, null, undefined);
      await t.run("UPDATE notes SET facilitator_only = $2, revealed = true WHERE id = $1", [note.id, body.facilitatorOnly]);
      await record(t, w.facilitator_id, "note.facilitator_only_changed", w.id);
    }
    await commit(t, w.id);
    const row = await noteRow(t, note.id);
    if (!row) fail("not_found");
    return reply(200, { note: noteView(ctx.actor, row) });
  });
}

export async function deleteNote(req: Req, p: Record<string, string>): Promise<Reply> {
  const ctx = await resolve(req, "note", p.id ?? "", "boardWrites");
  const before = await noteRow(db, p.id ?? "");
  if (!before || !sentTo(ctx.actor, before)) fail("not_found");
  forbidUnless(readableBy(ctx.actor, before));
  forbidUnless(ctx.actor.kind === "facilitator" || before.author_participant_id === ctx.actor.id);
  return tx(async (t) => {
    const w = await begin(t, ctx);
    const note = await noteRow(t, p.id ?? "");
    if (!note) fail("not_found");
    checkState(ctx.actor, w, "noteDelete");
    if (ctx.actor.kind === "participant" && w.status === "silent_round" && note.revealed) phaseLocked(w.status);
    await removeNote(t, w, note);
    await commit(t, w.id);
    return reply(204);
  });
}

// ---- clusters ----

async function clusterJson(t: Db, viewer: Actor, w: WorkshopRow, id: string) {
  const state = await loadBoard(t, w);
  const cluster = state.clusters.find((c) => c.id === id);
  return cluster ? clusterView(viewer, state, cluster, w.status) : null;
}

async function frameJson(t: Db, w: WorkshopRow, id: string) {
  const state = await loadBoard(t, w);
  const frame = state.frames.find((f) => f.id === id);
  return frame ? frameView(state, frame) : null;
}

export async function createCluster(req: Req, p: Record<string, string>): Promise<Reply> {
  const ctx = await resolve(req, "workshop", p.id ?? "", "boardWrites");
  return once(req, actorKey(ctx.actor), async (t) => {
    const w = await begin(t, ctx);
    checkState(ctx.actor, w, "cluster");
    const body = asObject(req.json);
    const fields = unknownKeys(body, ACCEPTED.createCluster);
    const frame = await activeFrame(t, w.id, body.frameId);
    if (!frame) fields.frameId = FIELD.other;
    const title = boundedText(body.title, 1, 60);
    if (title === null) fields.title = FIELD.other;
    if (!isCoordinate(body.x)) fields.x = FIELD.other;
    if (!isCoordinate(body.y)) fields.y = FIELD.other;
    throwFields(fields);
    const id = newId();
    await t.run("INSERT INTO clusters (id, workshop_id, frame_id, title, x, y) VALUES ($1, $2, $3, $4, $5, $6)", [
      id, w.id, frame?.id ?? "", title, body.x as number, body.y as number,
    ]);
    await commit(t, w.id);
    return reply(201, { cluster: await clusterJson(t, ctx.actor, w, id) });
  });
}

export async function patchCluster(req: Req, p: Record<string, string>): Promise<Reply> {
  const ctx = await resolve(req, "cluster", p.id ?? "", "boardWrites");
  return once(req, actorKey(ctx.actor), async (t) => {
    const w = await begin(t, ctx);
    const cluster = await t.one<{ id: string }>(
      "SELECT c.id FROM clusters c JOIN frames f ON f.id = c.frame_id AND f.trash_id IS NULL WHERE c.id = $1",
      [p.id ?? ""],
    );
    if (!cluster) fail("not_found");
    checkState(ctx.actor, w, "cluster");
    const body = asObject(req.json);
    const fields = unknownKeys(body, ACCEPTED.patchCluster);
    const updates: Record<string, string | number> = {};
    if ("title" in body) {
      const title = boundedText(body.title, 1, 60);
      if (title === null) fields.title = FIELD.other;
      else updates.title = title;
    }
    for (const key of ["x", "y"] as const) if (key in body) (isCoordinate(body[key]) ? (updates[key] = body[key] as number) : (fields[key] = FIELD.other));
    if (Object.keys(updates).length === 0 && Object.keys(fields).length === 0) fields.body = FIELD.other;
    throwFields(fields);
    for (const [key, value] of Object.entries(updates)) await t.run(`UPDATE clusters SET ${key} = $2 WHERE id = $1`, [cluster.id, value]);
    await commit(t, w.id);
    return reply(200, { cluster: await clusterJson(t, ctx.actor, w, cluster.id) });
  });
}

export async function deleteCluster(req: Req, p: Record<string, string>): Promise<Reply> {
  const ctx = await resolve(req, "cluster", p.id ?? "", "boardWrites");
  return tx(async (t) => {
    const w = await begin(t, ctx);
    const cluster = await t.one<{ id: string }>("SELECT c.id FROM clusters c JOIN frames f ON f.id = c.frame_id AND f.trash_id IS NULL WHERE c.id = $1", [
      p.id ?? "",
    ]);
    if (!cluster) fail("not_found");
    checkState(ctx.actor, w, "cluster");
    await returnAllOn(t, w.id, cluster.id);
    await t.run("UPDATE notes SET cluster_id = NULL, cluster_index = NULL WHERE cluster_id = $1", [cluster.id]);
    await t.run("DELETE FROM clusters WHERE id = $1", [cluster.id]);
    await commit(t, w.id);
    return reply(204);
  });
}

// ---- connectors ----

export async function createConnector(req: Req, p: Record<string, string>): Promise<Reply> {
  const ctx = await resolve(req, "workshop", p.id ?? "", "boardWrites");
  return once(req, actorKey(ctx.actor), async (t) => {
    const w = await begin(t, ctx);
    checkState(ctx.actor, w, "connector");
    const body = asObject(req.json);
    const fields = unknownKeys(body, ACCEPTED.createConnector);
    const visible = async (id: unknown) => {
      if (typeof id !== "string") return null;
      const n = await noteRow(t, id);
      return n && n.workshop_id === w.id && readableBy(ctx.actor, n) ? n : null;
    };
    const from = await visible(body.fromNoteId);
    const to = await visible(body.toNoteId);
    if (!from) fields.fromNoteId = FIELD.other;
    if (!to || to.id === from?.id) fields.toNoteId = FIELD.other;
    if (from && to && from.id !== to.id) {
      const exists = await t.one(
        "SELECT 1 AS ok FROM connectors WHERE (from_note = $1 AND to_note = $2) OR (from_note = $2 AND to_note = $1)",
        [from.id, to.id],
      );
      if (exists) fields.toNoteId = FIELD.other;
    }
    throwFields(fields);
    const id = newId();
    await t.run("INSERT INTO connectors (id, workshop_id, from_note, to_note) VALUES ($1, $2, $3, $4)", [id, w.id, from?.id ?? "", to?.id ?? ""]);
    await commit(t, w.id);
    return reply(201, { connector: { id, fromNoteId: from?.id, toNoteId: to?.id } });
  });
}

export async function deleteConnector(req: Req, p: Record<string, string>): Promise<Reply> {
  const ctx = await resolve(req, "connector", p.id ?? "", "boardWrites");
  return tx(async (t) => {
    const w = await begin(t, ctx);
    const connector = await t.one<{ id: string; from_note: string; to_note: string }>("SELECT id, from_note, to_note FROM connectors WHERE id = $1", [
      p.id ?? "",
    ]);
    if (!connector) fail("not_found");
    if (ctx.actor.kind === "participant") {
      const ends = await Promise.all([noteRow(t, connector.from_note), noteRow(t, connector.to_note)]);
      if (ends.some((n) => !n || !sentTo(ctx.actor, n))) fail("not_found");
    }
    checkState(ctx.actor, w, "connector");
    await t.run("DELETE FROM connectors WHERE id = $1", [connector.id]);
    await commit(t, w.id);
    return reply(204);
  });
}

// ---- dots ----

async function dotWrite(req: Req, p: Record<string, string>, kind: "spend" | "return"): Promise<Reply> {
  const ctx = await resolve(req, "cluster", p.id ?? "", "boardWrites");
  const actor = ctx.actor;
  if (actor.kind !== "participant") fail("forbidden");
  return once(req, actorKey(actor), async (t) => {
    const w = await begin(t, ctx);
    const cluster = await t.one<{ id: string }>("SELECT c.id FROM clusters c JOIN frames f ON f.id = c.frame_id AND f.trash_id IS NULL WHERE c.id = $1", [
      p.id ?? "",
    ]);
    if (!cluster) fail("not_found");
    checkState(actor, w, "dot");
    throwFields(unknownKeys(asObject(req.json), ACCEPTED.opOnly));
    const budget = w.dot_budget ?? 0;
    if (kind === "spend") {
      const dot = await spendDot(t, w.id, budget, actor.id, cluster.id);
      await commit(t, w.id);
      return reply(201, { dot: { id: dot.id, clusterId: cluster.id }, dotsRemaining: dot.remaining });
    }
    const remaining = await returnDot(t, w.id, budget, actor.id, cluster.id);
    await commit(t, w.id);
    return reply(200, { clusterId: cluster.id, dotsRemaining: remaining });
  });
}

export const spend = (req: Req, p: Record<string, string>) => dotWrite(req, p, "spend");
export const giveBack = (req: Req, p: Record<string, string>) => dotWrite(req, p, "return");
