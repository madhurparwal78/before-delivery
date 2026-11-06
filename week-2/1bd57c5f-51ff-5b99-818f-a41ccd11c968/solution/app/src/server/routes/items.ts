import { randomUUID } from "node:crypto";
import { isCrew, type Trade } from "../../shared/domain";
import { PHOTO_UPLOADERS } from "../../shared/lifecycle";
import { canSeeItem, isUuid, jobAccess, lockOpenJob, requireOpenJob, type JobAccess } from "../access";
import { afterCommit, maybeOne, one, pool, transaction, type Tx } from "../db";
import { fail, invalid } from "../errors";
import { emitItems, actOnItem, bulkAct, createItem, deleteItem, editItem, resolveConflict, setBlockers } from "../items";
import { json, noContent, readForm, readJson, route, type Reply } from "../http";
import { cleanImage, uploadedBytes } from "../images";
import { sendQueuedMail } from "../mail";
import { addNote, editNote, noteHistory, redoNote, undoNote } from "../notes";
import { projectItem, projectNote, projectPhoto } from "../projection";
import { loadItems, loadRooms, scopedItemRows, type NoteRecord, type PhotoRecord } from "../records";
import { deleteObject, getObject, putObject } from "../storage";
import { checkOps, runSync } from "../sync";

async function itemReply(access: JobAccess, itemId: string, status = 200, extra: Record<string, unknown> = {}): Promise<Reply> {
  const [item] = await loadItems(pool, access, [itemId]);
  if (!item) fail("not_found");
  return json(status, { ...projectItem(access, item), ...extra });
}

/** Runs an item change in one transaction with any email it queues, then sends the mail. */
function change<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return transaction(async (tx) => {
    afterCommit(tx, () => void sendQueuedMail());
    return work(tx);
  });
}

async function noteReply(access: JobAccess, note: NoteRecord, status = 200): Promise<Reply> {
  const [item] = await loadItems(pool, access, [note.item_id]);
  return json(status, projectNote(access, note, item?.notes ?? [note]));
}

route("GET", "/api/jobs/:jobId/items", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  return json(200, { items: (await loadItems(pool, access)).map((item) => projectItem(access, item)) });
});

route("POST", "/api/jobs/:jobId/items", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  const rooms = await loadRooms(pool, access.job.id);
  const body = readJson(call);
  const id = await change((tx) => createItem(tx, access, body, rooms));
  return itemReply(access, id, 201);
});

route("POST", "/api/jobs/:jobId/items/bulk", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  const rooms = await loadRooms(pool, access.job.id);
  const body = readJson(call);
  const ids = await change((tx) => bulkAct(tx, access, body, rooms));
  const items = await loadItems(pool, access, ids);
  return json(200, { items: items.sort((a, b) => a.number - b.number).map((item) => projectItem(access, item)) });
});

route("GET", "/api/jobs/:jobId/items/:itemId", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  if (!isUuid(call.params.itemId)) fail("not_found");
  return itemReply(access, call.params.itemId);
});

route("PATCH", "/api/jobs/:jobId/items/:itemId", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  const rooms = await loadRooms(pool, access.job.id);
  const body = readJson(call);
  await change((tx) => editItem(tx, access, call.params.itemId!, body, rooms));
  return itemReply(access, call.params.itemId!);
});

route("DELETE", "/api/jobs/:jobId/items/:itemId", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  await deleteItem(access, call.params.itemId!);
  return noContent();
});

route("POST", "/api/jobs/:jobId/items/:itemId/actions", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  const body = readJson(call);
  const reopened = await change((tx) => actOnItem(tx, access, call.params.itemId!, body));
  return itemReply(access, call.params.itemId!, 200, body.action === "reopen" ? { reopened_dependents: reopened } : {});
});

route("PUT", "/api/jobs/:jobId/items/:itemId/blocked-by", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  const body = readJson(call);
  await change((tx) => setBlockers(tx, access, call.params.itemId!, body));
  return itemReply(access, call.params.itemId!);
});

route("POST", "/api/jobs/:jobId/items/:itemId/resolve", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  const rooms = await loadRooms(pool, access.job.id);
  const body = readJson(call);
  await change((tx) => resolveConflict(tx, access, call.params.itemId!, body, rooms));
  return itemReply(access, call.params.itemId!);
});

route("POST", "/api/jobs/:jobId/items/:itemId/notes", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  const body = readJson(call);
  const note = await change((tx) => addNote(tx, access, call.params.itemId!, body));
  return noteReply(access, note, 201);
});

route("POST", "/api/jobs/:jobId/items/:itemId/notes/:noteId/edits", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  const body = readJson(call);
  return noteReply(access, await change((tx) => editNote(tx, access, call.params.itemId!, call.params.noteId!, body)));
});

route("POST", "/api/jobs/:jobId/items/:itemId/notes/:noteId/undo", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  return noteReply(access, await change((tx) => undoNote(tx, access, call.params.itemId!, call.params.noteId!)));
});

route("POST", "/api/jobs/:jobId/items/:itemId/notes/:noteId/redo", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  return noteReply(access, await change((tx) => redoNote(tx, access, call.params.itemId!, call.params.noteId!)));
});

route("GET", "/api/jobs/:jobId/items/:itemId/notes/:noteId/history", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  const revisions = await transaction((tx) => noteHistory(tx, access, call.params.itemId!, call.params.noteId!));
  return json(200, { revisions });
});

route("POST", "/api/jobs/:jobId/sync", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  requireOpenJob(access);
  const ops = checkOps(readJson(call).ops);
  const response = await runSync(access, ops);
  void sendQueuedMail();
  return json(200, response);
});

route("POST", "/api/jobs/:jobId/items/:itemId/photos", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  const itemId = call.params.itemId;
  const [item] = isUuid(itemId) ? await scopedItemRows(pool, access, [itemId]) : [];
  if (!item) fail("not_found");
  const form = await readForm(call);
  const kind = form.get("kind");
  const known = kind === "defect" || kind === "completion";
  if (!(known ? PHOTO_UPLOADERS[kind] : PHOTO_UPLOADERS.completion).includes(access.role)) fail("forbidden");
  requireOpenJob(access);
  if (!known) invalid({ kind: "Choose a defect or completion photo." });
  const bytes = await uploadedBytes(form);
  if (!bytes) invalid({ file: "Choose a photo to upload." });
  const image = cleanImage(bytes);
  const id = randomUUID();
  const key = `jobs/${access.job.id}/items/${item.id}/photos/${id}.${image.ext}`;
  await putObject(key, image.bytes, image.contentType);
  const photo = await transaction(async (tx) => {
    await lockOpenJob(tx, access.job.id);
    const stored = await one<PhotoRecord>(
      tx,
      `WITH photo AS (
         INSERT INTO photos (id, job_id, item_id, kind, object_key, content_type, bytes, uploaded_by, uploaded_by_role)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
       )
       SELECT photo.*, p.name AS uploader_name FROM photo JOIN people p ON p.id = photo.uploaded_by`,
      [id, access.job.id, item.id, kind, key, image.contentType, image.bytes.length, access.person.id, access.role],
    );
    await emitItems(tx, access.job.id, new Map([[item.id, item.trade]]));
    return stored;
  }).catch(async (error: unknown) => {
    await deleteObject(key).catch(() => undefined);
    throw error;
  });
  return json(201, projectPhoto(photo));
});

async function visiblePhoto(access: JobAccess, photoId: string | undefined): Promise<PhotoRecord & { item_trade: Trade | null }> {
  const photo = isUuid(photoId)
    ? await maybeOne<PhotoRecord & { item_trade: Trade | null }>(
        pool,
        `SELECT ph.*, p.name AS uploader_name, i.trade AS item_trade
         FROM photos ph JOIN people p ON p.id = ph.uploaded_by JOIN items i ON i.id = ph.item_id
         WHERE ph.id = $1 AND ph.job_id = $2`,
        [photoId, access.job.id],
      )
    : null;
  if (!photo || !canSeeItem(access, photo.item_trade)) fail("not_found");
  return photo;
}

route("GET", "/api/jobs/:jobId/photos/:photoId", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  const photo = await visiblePhoto(access, call.params.photoId);
  const bytes = await getObject(photo.object_key);
  if (!bytes) fail("not_found");
  return { status: 200, bytes, contentType: photo.content_type, headers: { "Cache-Control": "private, max-age=86400" } };
});

route("DELETE", "/api/jobs/:jobId/photos/:photoId", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  const photo = await visiblePhoto(access, call.params.photoId);
  if (!isCrew(access.role) && photo.uploaded_by !== access.person.id) fail("forbidden");
  requireOpenJob(access);
  await deleteObject(photo.object_key);
  await transaction(async (tx) => {
    await lockOpenJob(tx, access.job.id);
    await tx.query("DELETE FROM photos WHERE id = $1", [photo.id]);
    await emitItems(tx, access.job.id, new Map([[photo.item_id, photo.item_trade]]));
  });
  return noContent();
});
