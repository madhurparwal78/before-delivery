// Visits, hoof photos (single-shot and resumable, within the visit's quota), signed file paths, hoof marks with
// versions, history and restore, and the idempotent visit close (brief: API, Visits and photos; Business rules,
// Visits, Hoof photos, Resumable uploads, Photo quota, Angles, Marks versions and restore, Idempotency).
import { randomUUID } from "node:crypto";
import { audit } from "../audit.js";
import { advanceInvoice, creatorLease } from "../billing.js";
import { config } from "../config.js";
import { db, first, transaction } from "../db.js";
import { alignment, angleTenths, isHoof, lineFits, nextVersion, versionIsCurrent } from "../domain/hoofMarks.js";
import { WORK_CODES, isWorkCode } from "../domain/prices.js";
import { ApiError, FIELD_COPY, conflict, illegalTransition, notFound, refuseInvalid, validation } from "../errors.js";
import { json, openRoute, route } from "../http.js";
import { idempotent } from "../idempotency.js";
import { insertInvoice, visitItems } from "../invoices.js";
import { enqueueJob, registerJob } from "../jobs.js";
import { applyDeposit, depositToApply } from "../payments.js";
import { stamp } from "../practice.js";
import { PHOTO_LIMIT, isPhase, photoKey, prepareImage, thumbKey, thumbnail } from "../photos.js";
import { signer, verifyPath } from "../signedPaths.js";
import { StorageUnavailable, deleteObject, getObject, putObject } from "../storage.js";
import { appendEvent, horseStream } from "../streams.js";
import { afterCommit } from "../context.js";
import { dayChange } from "../days.js";
import { errorText, log } from "../log.js";
import { MARKS_SELECT, livePair, historyJson, marksJson, photoJson, visibleVisit, visitJson, } from "../views.js";
import { isWholeNumber, objectBody } from "./input.js";
const STAFF = ["farrier", "apprentice"];
const storageDown = () => new ApiError(503, "storage_unavailable");
route("GET", "/api/visits/:id", [...STAFF, "owner"], async ({ caller, params, now }) => json(200, await visitJson(db, await visibleVisit(db, caller, params.id ?? ""), caller, now)));
// ---- Photo storage and the per-visit quota ----
async function lockVisit(client, id) {
    await client.query(`SELECT 1 FROM visits WHERE id = $1 FOR UPDATE`, [id]);
    return first((await client.query(`SELECT v.*, h.name AS horse_name, h.owner_id FROM visits v JOIN horses h ON h.id = v.horse_id WHERE v.id = $1`, [id])).rows);
}
/** Bytes left on a visit: the quota less stored photos and live reservations (sessions past expiry hold nothing). */
async function remainingBytes(client, visitId, at) {
    const { rows } = await client.query(`SELECT (SELECT coalesce(sum(size_bytes), 0) FROM photos WHERE visit_id = $1)
          + (SELECT coalesce(sum(size_bytes), 0) FROM upload_sessions WHERE visit_id = $1 AND state = 'active' AND expires_at > $2) AS used`, [visitId, new Date(at)]);
    return config.visitPhotoQuotaBytes - Number(first(rows).used);
}
/**
 * Checks the visit and reserves `size` bytes under the visit's lock: visit_closed, photo_exists, the quota, then
 * the per-photo limit, in that order.
 */
async function reserve(visitId, hoof, phase, size, resumable, at) {
    return transaction(async (client) => {
        const visit = await lockVisit(client, visitId);
        if (visit.status !== "open")
            throw conflict("visit_closed");
        if (isHoof(hoof) && isPhase(phase)) {
            const taken = await client.query(`SELECT 1 FROM photos WHERE visit_id = $1 AND hoof = $2 AND phase = $3`, [visitId, hoof, phase]);
            if (taken.rowCount)
                throw conflict("photo_exists");
        }
        const remaining = await remainingBytes(client, visitId, at);
        if (size > remaining)
            throw conflict("visit_quota_exceeded", { remaining_bytes: Math.max(0, remaining) });
        if (size > PHOTO_LIMIT)
            throw new ApiError(413, "photo_too_large");
        if (!isHoof(hoof) || !isPhase(phase))
            return null;
        const id = randomUUID();
        const seconds = resumable ? config.uploadSessionSeconds : config.jobLeaseSeconds * 10;
        await client.query(`INSERT INTO upload_sessions (id, visit_id, hoof, phase, size_bytes, chunk_bytes, resumable, state, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9)`, [id, visitId, hoof, phase, size, config.uploadChunkBytes, resumable, new Date(at + seconds * 1000), new Date(at)]);
        return { id, visitId, hoof, phase };
    });
}
const release = async (sessionId) => {
    await db.query(`UPDATE upload_sessions SET state = 'released' WHERE id = $1 AND state = 'active'`, [sessionId]);
};
/** Stores a validated image; the reservation becomes the stored image's bytes. A refused image releases it. */
async function storePhoto(reservation, image, at) {
    if (!image) {
        await release(reservation.id);
        throw new ApiError(415, "unsupported_image");
    }
    const photoId = randomUUID();
    const key = photoKey(reservation.visitId, reservation.hoof, reservation.phase, photoId, image.extension);
    try {
        await putObject(key, image.data, image.contentType);
    }
    catch (error) {
        await release(reservation.id);
        if (error instanceof StorageUnavailable)
            throw storageDown();
        throw error;
    }
    return transaction(async (client) => {
        const visit = await lockVisit(client, reservation.visitId);
        if (visit.status !== "open")
            throw conflict("visit_closed");
        const inserted = await client.query(`INSERT INTO photos (id, visit_id, hoof, phase, content_type, width, height, size_bytes, object_key, thumbnail_status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10) ON CONFLICT (visit_id, hoof, phase) DO NOTHING RETURNING *`, [photoId, reservation.visitId, reservation.hoof, reservation.phase, image.contentType, image.width, image.height, image.data.length, key, new Date(at)]);
        const photo = inserted.rows[0];
        if (!photo)
            throw conflict("photo_exists");
        await client.query(`UPDATE upload_sessions SET state = 'stored' WHERE id = $1`, [reservation.id]);
        await enqueueJob(client, { kind: "thumbnail", payload: { photo_id: photoId } });
        return photo;
    });
}
/** Parses the already size-limited multipart body with Node's built-in form-data reader. */
async function parseMultipart(contentType, raw) {
    const form = await new Request("http://localhost/", { method: "POST", headers: { "content-type": contentType }, body: new Uint8Array(raw) }).formData();
    const parsed = { fields: {}, file: null };
    for (const [name, value] of form) {
        if (typeof value === "string")
            parsed.fields[name] = value;
        else if (name === "file")
            parsed.file = Buffer.from(await value.arrayBuffer());
    }
    return parsed;
}
const placeErrors = (hoof, phase) => ({
    ...(isHoof(hoof) ? {} : { hoof: FIELD_COPY.required }),
    ...(isPhase(phase) ? {} : { phase: FIELD_COPY.required }),
});
route("POST", "/api/visits/:id/photos", STAFF, async ({ caller, params, req, raw, now }) => {
    const visit = await visibleVisit(db, caller, params.id ?? "");
    let upload;
    try {
        upload = await parseMultipart(req.headers["content-type"] ?? "", raw);
    }
    catch {
        throw new ApiError(422, "validation", { errors: { file: FIELD_COPY.required } });
    }
    const { hoof, phase } = upload.fields;
    const file = upload.file ?? Buffer.alloc(0);
    const reservation = await reserve(visit.id, hoof, phase, file.length, false, now);
    const image = file.length ? await prepareImage(file) : null;
    if (!image || !reservation) {
        if (reservation)
            await release(reservation.id);
        if (file.length && !image)
            throw new ApiError(415, "unsupported_image");
        throw validation({ ...placeErrors(hoof, phase), ...(file.length ? {} : { file: FIELD_COPY.required }) });
    }
    return json(201, photoJson(await storePhoto(reservation, image, now), await signer(db, now)));
}, { body: "multipart", allowance: "upload" });
const sessionJson = (session) => ({
    id: session.id,
    hoof: session.hoof,
    phase: session.phase,
    size_bytes: session.size_bytes,
    chunk_bytes: session.chunk_bytes,
    offset: session.upload_offset,
    expires_at: stamp(session.expires_at),
});
const chunkKey = (sessionId, index) => `uploads/${sessionId}/${index}`;
/** Removes a session's chunk objects; MinIO being unreachable answers the storage 503. */
async function removeChunks(session) {
    const count = Math.ceil(session.upload_offset / session.chunk_bytes);
    try {
        for (let index = 0; index < count; index += 1)
            await deleteObject(chunkKey(session.id, index));
    }
    catch (error) {
        if (error instanceof StorageUnavailable)
            throw storageDown();
        throw error;
    }
}
route("POST", "/api/visits/:id/uploads", STAFF, async ({ caller, params, body, now }) => {
    const visit = await visibleVisit(db, caller, params.id ?? "");
    const fields = objectBody(body);
    const size = isWholeNumber(fields.size_bytes) && fields.size_bytes > 0 ? fields.size_bytes : 0;
    const reservation = await reserve(visit.id, fields.hoof, fields.phase, size, true, now);
    const errors = { ...placeErrors(fields.hoof, fields.phase), ...(size ? {} : { size_bytes: FIELD_COPY.range(1, PHOTO_LIMIT) }) };
    if (!reservation || !size) {
        if (reservation)
            await release(reservation.id);
        throw validation(errors);
    }
    const session = first((await db.query(`SELECT * FROM upload_sessions WHERE id = $1`, [reservation.id])).rows);
    return json(201, { id: session.id, chunk_bytes: session.chunk_bytes, offset: 0, expires_at: stamp(session.expires_at) });
}, { allowance: "upload" });
route("GET", "/api/visits/:id/uploads", STAFF, async ({ caller, params, now }) => {
    const visit = await visibleVisit(db, caller, params.id ?? "");
    const { rows } = await db.query(`SELECT * FROM upload_sessions WHERE visit_id = $1 AND resumable AND state = 'active' AND expires_at > $2 ORDER BY created_at`, [visit.id, new Date(now)]);
    return json(200, rows.map(sessionJson));
});
/** A live session; one its visit's close ended answers visit_closed ahead of every other session error. */
async function findSession(client, id, lock) {
    const { rows } = await client.query(`SELECT s.*, v.status AS visit_status FROM upload_sessions s JOIN visits v ON v.id = s.visit_id
      WHERE s.id = $1 AND s.resumable ${lock ? "FOR UPDATE OF s" : ""}`, [id]);
    const session = rows[0];
    if (session?.state === "ended" || (session?.state === "active" && session.visit_status !== "open"))
        throw conflict("visit_closed");
    if (session?.state !== "active")
        throw notFound();
    return session;
}
const expired = (session, at) => at >= session.expires_at.getTime();
route("GET", "/api/uploads/:id", STAFF, async ({ params, now }) => {
    const session = await findSession(db, params.id ?? "", false);
    if (expired(session, now))
        throw new ApiError(410, "upload_expired");
    return json(200, sessionJson(session));
});
route("DELETE", "/api/uploads/:id", STAFF, async ({ params }) => {
    const session = await findSession(db, params.id ?? "", false);
    await removeChunks(session);
    await release(session.id);
    return { status: 204 };
});
/** One chunk at the stored offset; two PATCHes at one offset are serialised on the session row and one advances. */
async function patchUpload(ctx) {
    const { params, raw, now, req } = ctx;
    const outcome = await transaction(async (client) => {
        const session = await findSession(client, params.id ?? "", true);
        const header = req.headers["upload-offset"];
        const offset = typeof header === "string" && /^\d+$/.test(header) ? Number(header) : -1;
        if (offset !== session.upload_offset)
            throw conflict("offset_mismatch", { offset: session.upload_offset });
        if (expired(session, now))
            throw new ApiError(410, "upload_expired");
        const left = session.size_bytes - session.upload_offset;
        if (raw.length !== Math.min(session.chunk_bytes, left))
            refuseInvalid({ chunk: FIELD_COPY.chunk(session.chunk_bytes) });
        try {
            if (raw.length)
                await putObject(chunkKey(session.id, Math.floor(offset / session.chunk_bytes)), raw, "application/octet-stream");
        }
        catch (error) {
            if (error instanceof StorageUnavailable)
                throw storageDown();
            throw error;
        }
        const advanced = offset + raw.length;
        await client.query(`UPDATE upload_sessions SET upload_offset = $2 WHERE id = $1`, [session.id, advanced]);
        return { session: { ...session, upload_offset: advanced }, done: advanced === session.size_bytes };
    });
    if (!outcome.done)
        return json(200, { offset: outcome.session.upload_offset });
    const session = outcome.session;
    const parts = [];
    try {
        for (let index = 0; index < Math.ceil(session.size_bytes / session.chunk_bytes); index += 1)
            parts.push(await getObject(chunkKey(session.id, index)));
    }
    catch (error) {
        if (error instanceof StorageUnavailable)
            throw storageDown();
        throw error;
    }
    // The chunks are removed once the whole file is in hand, before it is validated and stored.
    await removeChunks(session);
    const reservation = { id: session.id, visitId: session.visit_id, hoof: session.hoof, phase: session.phase };
    const photo = await storePhoto(reservation, await prepareImage(Buffer.concat(parts)), now);
    return json(201, photoJson(photo, await signer(db, now)));
}
route("PATCH", "/api/uploads/:id", STAFF, patchUpload, { body: "octet", allowance: "upload" });
// ---- Photos and signed paths ----
async function visiblePhoto(caller, id) {
    const { rows } = await db.query(`SELECT p.*, v.status AS visit_status, v.horse_id, h.owner_id FROM photos p JOIN visits v ON v.id = p.visit_id
       JOIN horses h ON h.id = v.horse_id WHERE p.id = $1`, [id]);
    const photo = rows[0];
    if (!photo || (caller.role === "owner" && (photo.owner_id !== caller.id || photo.visit_status === "open")))
        throw notFound();
    return photo;
}
route("GET", "/api/photos/:id", [...STAFF, "owner"], async ({ caller, params, now }) => json(200, photoJson(await visiblePhoto(caller, params.id ?? ""), await signer(db, now))));
/** Removes a stored object; MinIO being unreachable answers the storage 503. */
async function removeObject(key) {
    try {
        await deleteObject(key);
    }
    catch (error) {
        if (error instanceof StorageUnavailable)
            throw storageDown();
        throw error;
    }
}
/**
 * Removes a photo from an open visit: its object and thumbnail, its signed paths (they now find no photo) and its
 * quota bytes; removing an after photo also removes that hoof's marks and history. The thumbnail is removed once
 * more after the row is gone, so a thumbnail job that wrote it in between leaves nothing (brief: Deleting a photo).
 */
route("DELETE", "/api/photos/:id", STAFF, async ({ caller, params }) => {
    const photo = await visiblePhoto(caller, params.id ?? "");
    if (photo.visit_status !== "open")
        throw conflict("visit_closed");
    const thumb = thumbKey(photo.visit_id, photo.hoof, photo.phase, photo.id);
    await removeObject(photo.object_key);
    await removeObject(thumb);
    await transaction(async (client) => {
        const visit = await lockVisit(client, photo.visit_id);
        if (visit.status !== "open")
            throw conflict("visit_closed");
        await client.query(`SELECT 1 FROM horses WHERE id = $1 FOR UPDATE`, [photo.horse_id]);
        await client.query(`DELETE FROM photos WHERE id = $1`, [photo.id]);
        if (photo.phase === "after") {
            const removed = await client.query(`DELETE FROM hoof_marks WHERE visit_id = $1 AND hoof = $2`, [photo.visit_id, photo.hoof]);
            if (removed.rowCount) {
                await appendEvent(client, horseStream(photo.horse_id, "staff"), "marks_saved", { visit_id: photo.visit_id, hoof: photo.hoof, version: null });
            }
        }
    });
    await removeObject(thumb);
    return { status: 204 };
});
const urlInvalid = () => new ApiError(403, "url_invalid");
/**
 * A vet path verifies only while its link is live and the photo is an after photo of one of the link's live pair,
 * checked at each read (brief: Vet links, Vet photo paths).
 */
async function vetPathAllowed(vetLinkId, kind, photo, at) {
    const { rows } = await db.query(`SELECT horse_id, expires_at, revoked_at FROM vet_links WHERE id = $1`, [vetLinkId]);
    const link = rows[0];
    if (!link || link.revoked_at || at >= link.expires_at.getTime() || kind !== "photo")
        return false;
    if (!photo)
        return true;
    const pair = await livePair(db, link.horse_id);
    return photo.horse_id === link.horse_id && photo.phase === "after" && Boolean(pair?.some((visit) => visit.id === photo.visit_id));
}
/** The object a verified path reads; a correctly signed path for a photo or export that is gone answers 404. */
async function mediaObject(kind, id, vetLinkId, at) {
    if (kind === "csv") {
        const { rows } = await db.query(`SELECT result->>'key' AS key FROM jobs WHERE id = $1 AND kind = 'csv_export' AND status = 'succeeded'`, [id]);
        if (vetLinkId)
            throw urlInvalid();
        const key = rows[0]?.key;
        if (!key)
            throw notFound();
        return { key, type: "text/csv; charset=utf-8" };
    }
    const { rows } = await db.query(`SELECT p.object_key, p.thumbnail_key, p.content_type, p.visit_id, p.phase, v.horse_id FROM photos p JOIN visits v ON v.id = p.visit_id WHERE p.id = $1`, [id]);
    const photo = rows[0];
    if (vetLinkId && !(await vetPathAllowed(vetLinkId, kind, photo, at)))
        throw urlInvalid();
    if (!photo)
        throw notFound();
    if (kind === "thumb") {
        if (!photo.thumbnail_key)
            throw notFound();
        return { key: photo.thumbnail_key, type: "image/jpeg" };
    }
    return { key: photo.object_key, type: photo.content_type };
}
for (const [suffix, kind] of [["", "photo"], ["/thumb", "thumb"], ["/csv", "csv"]]) {
    openRoute("GET", `/media/:id${suffix}`, async ({ params, query, now }) => {
        const id = params.id ?? "";
        const verified = await verifyPath(db, kind, id, query, now);
        if (!verified)
            throw urlInvalid();
        const found = await mediaObject(kind, id, verified.vetLinkId, now);
        try {
            const data = await getObject(found.key);
            const headers = { "cache-control": "private, no-store" };
            if (kind === "csv")
                headers["content-disposition"] = `attachment; filename="ledger-${found.key.split("/")[1] ?? "export"}.csv"`;
            return { status: 200, bytes: { data, contentType: found.type }, headers };
        }
        catch (error) {
            if (error instanceof StorageUnavailable)
                throw storageDown();
            throw error;
        }
    });
}
registerJob("thumbnail", {
    run: async (job) => {
        const photoId = job.payload.photo_id ?? "";
        const { rows } = await db.query(`SELECT * FROM photos WHERE id = $1`, [photoId]);
        const photo = rows[0];
        if (!photo)
            return { photo_id: photoId };
        const key = thumbKey(photo.visit_id, photo.hoof, photo.phase, photo.id);
        await putObject(key, await thumbnail(await getObject(photo.object_key)), "image/jpeg");
        const marked = await db.query(`UPDATE photos SET thumbnail_status = 'ready', thumbnail_key = $2 WHERE id = $1`, [photo.id, key]);
        // The photo was deleted while this job ran: the object it wrote goes too (brief: Deleting a photo).
        if (!marked.rowCount)
            await deleteObject(key);
        return { photo_id: photo.id };
    },
    onDead: async (client, job) => {
        await client.query(`UPDATE photos SET thumbnail_status = 'failed' WHERE id = $1 AND thumbnail_status = 'pending'`, [job.payload.photo_id]);
    },
});
// ---- Hoof marks ----
async function currentMarks(client, visitId, hoof) {
    const { rows } = await client.query(`${MARKS_SELECT} WHERE m.visit_id = $1 AND m.hoof = $2 ORDER BY m.version DESC LIMIT 1`, [
        visitId,
        hoof,
    ]);
    return rows[0] ?? null;
}
const stale = (current) => new ApiError(412, "stale_marks", { current: current ? marksJson(current, true) : null });
function readLine(value) {
    const line = objectBody(value);
    const coordinates = [line.x1, line.y1, line.x2, line.y2];
    if (!coordinates.every((c) => typeof c === "number" && Number.isFinite(c)))
        return null;
    return { x1: Number(line.x1), y1: Number(line.y1), x2: Number(line.x2), y2: Number(line.y2) };
}
/** Locks the visit and its horse (whose stream the save writes to) and checks the marks version first (412). */
async function marksChange(client, visit, hoof, sentVersion) {
    const locked = await lockVisit(client, visit.id);
    await client.query(`SELECT 1 FROM horses WHERE id = $1 FOR UPDATE`, [visit.horse_id]);
    const current = await currentMarks(client, visit.id, hoof);
    if (!versionIsCurrent(sentVersion, current?.version ?? null))
        throw stale(current);
    if (locked.status !== "open")
        throw conflict("visit_closed");
    const photos = await client.query(`SELECT * FROM photos WHERE visit_id = $1 AND hoof = $2 AND phase = 'after'`, [visit.id, hoof]);
    return { current, after: photos.rows[0] };
}
async function writeMarks(client, visit, hoof, marks, caller, at) {
    await client.query(`INSERT INTO hoof_marks (visit_id, hoof, version, hoof_wall, pastern, wall_tenths, pastern_tenths, alignment, saved_by, saved_at, restored_from)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [visit.id, hoof, marks.version, JSON.stringify(marks.wall), JSON.stringify(marks.pastern), marks.wallTenths, marks.pasternTenths, marks.alignment, caller.id, new Date(at), marks.restoredFrom]);
    await appendEvent(client, horseStream(visit.horse_id, "staff"), "marks_saved", { visit_id: visit.id, hoof, version: marks.version });
    return first((await client.query(`${MARKS_SELECT} WHERE m.visit_id = $1 AND m.hoof = $2 AND m.version = $3`, [visit.id, hoof, marks.version])).rows);
}
function hoofParam(value) {
    if (!isHoof(value))
        throw notFound();
    return value;
}
route("PUT", "/api/visits/:id/hooves/:hoof/marks", STAFF, async ({ caller, params, body, now }) => {
    const visit = await visibleVisit(db, caller, params.id ?? "");
    const hoof = hoofParam(params.hoof);
    const fields = objectBody(body);
    const saved = await transaction(async (client) => {
        const { current, after } = await marksChange(client, visit, hoof, fields.version ?? null);
        if (!after)
            throw conflict("photo_required");
        const wall = readLine(fields.hoof_wall);
        const pastern = readLine(fields.pastern);
        const wallFits = wall !== null && lineFits(wall, after.width, after.height);
        const pasternFits = pastern !== null && lineFits(pastern, after.width, after.height);
        if (!wall || !pastern || !wallFits || !pasternFits) {
            throw validation({
                ...(wallFits ? {} : { hoof_wall: FIELD_COPY.coordinates }),
                ...(pasternFits ? {} : { pastern: FIELD_COPY.coordinates }),
            });
        }
        const wallTenths = angleTenths(wall);
        const pasternTenths = angleTenths(pastern);
        return writeMarks(client, visit, hoof, { version: nextVersion(current?.version ?? null), wall, pastern, wallTenths, pasternTenths, alignment: alignment(wallTenths, pasternTenths), restoredFrom: null }, caller, now);
    });
    return json(200, marksJson(saved, true));
});
route("GET", "/api/visits/:id/hooves/:hoof/marks/history", STAFF, async ({ caller, params }) => {
    const visit = await visibleVisit(db, caller, params.id ?? "");
    const hoof = hoofParam(params.hoof);
    const { rows } = await db.query(`${MARKS_SELECT} WHERE m.visit_id = $1 AND m.hoof = $2 ORDER BY m.version`, [visit.id, hoof]);
    return json(200, rows.map(historyJson));
});
route("POST", "/api/visits/:id/hooves/:hoof/marks/restore", STAFF, async ({ caller, params, body, now }) => {
    const visit = await visibleVisit(db, caller, params.id ?? "");
    const hoof = hoofParam(params.hoof);
    const fields = objectBody(body);
    const restored = await transaction(async (client) => {
        const { current } = await marksChange(client, visit, hoof, fields.version ?? null);
        const { rows } = await client.query(`${MARKS_SELECT} WHERE m.visit_id = $1 AND m.hoof = $2 AND m.version = $3`, [
            visit.id,
            hoof,
            isWholeNumber(fields.restore_version) ? fields.restore_version : -1,
        ]);
        const source = rows[0];
        if (!source)
            throw validation({ restore_version: FIELD_COPY.unknownVersion });
        return writeMarks(client, visit, hoof, {
            version: nextVersion(current?.version ?? null),
            wall: source.hoof_wall,
            pastern: source.pastern,
            wallTenths: source.wall_tenths,
            pasternTenths: source.pastern_tenths,
            alignment: source.alignment,
            restoredFrom: source.version,
        }, caller, now);
    });
    return json(200, marksJson(restored, true));
});
function closeInput(body) {
    const fields = objectBody(body);
    const errors = {};
    const work = Array.isArray(fields.work) ? fields.work : [];
    if (!work.length || !work.every(isWorkCode) || new Set(work).size !== work.length)
        errors.work = FIELD_COPY.required;
    const note = fields.note === undefined || fields.note === null ? "" : fields.note;
    if (typeof note !== "string" || note.length > 500)
        errors.note = "Keep the note to 500 characters or fewer.";
    refuseInvalid(errors);
    return { work: WORK_CODES.filter((code) => work.includes(code)), note: String(note) };
}
/**
 * Closes the visit once per key: the invoice is written pending in the same transaction and taken to Kill Bill
 * at once. A same-key retry after a crash finds the visit this key closed and finishes the invoice.
 */
route("POST", "/api/visits/:id/close", ["farrier"], async (ctx) => {
    const { caller, params, now } = ctx;
    const visit = await visibleVisit(db, caller, params.id ?? "");
    return idempotent(ctx, async ({ key }) => {
        const facts = first((await db.query(`SELECT bk.id AS booking_id, bk.barn_day_id, b.name AS barn_name, bk.payment_id, bk.owner_id
             FROM bookings bk JOIN barn_days d ON d.id = bk.barn_day_id JOIN barns b ON b.id = d.barn_id WHERE bk.id = $1`, [visit.booking_id])).rows);
        const invoiceId = await transaction((client) => dayChange(client, facts.barn_day_id, now, async () => {
            const locked = await lockVisit(client, visit.id);
            const own = await client.query(`SELECT v.close_key, i.id FROM visits v LEFT JOIN invoices i ON i.visit_id = v.id WHERE v.id = $1`, [visit.id]);
            const stored = first(own.rows);
            if (locked.status !== "open") {
                if (stored.close_key === key && stored.id)
                    return stored.id;
                throw illegalTransition(locked.status, "close");
            }
            const photos = await client.query(`SELECT 1 FROM photos WHERE visit_id = $1 AND phase = 'after' LIMIT 1`, [visit.id]);
            if (!photos.rowCount)
                throw conflict("photos_required");
            const input = closeInput(ctx.body);
            // The trip item is the booking's share as it stands under the day's lock (brief: Excuse against close).
            const { rows: share } = await client.query(`SELECT trip_share_cents FROM bookings WHERE id = $1`, [facts.booking_id]);
            const depositLeft = await depositToApply(client, facts.payment_id);
            const { items, creditCents } = await visitItems(client, {
                horse: visit.horse_name,
                barn: facts.barn_name,
                businessDate: visit.business_date,
                work: input.work,
                shareCents: share[0]?.trip_share_cents ?? 0,
                depositLeftCents: depositLeft,
            });
            await client.query(`UPDATE visits SET status = 'closed', work = $2, note = $3, close_key = $4, closed_at = $5 WHERE id = $1`, [
                visit.id,
                JSON.stringify(input.work),
                input.note,
                key,
                new Date(now),
            ]);
            await audit(client, { action: "close", entityType: "visit", entityId: visit.id, from: "open", to: "closed" });
            // Closing ends the visit's live upload sessions: reservations released now, chunks removed after commit.
            const { rows: ended } = await client.query(`UPDATE upload_sessions SET state = 'ended' WHERE visit_id = $1 AND state = 'active' RETURNING *`, [visit.id]);
            afterCommit(async () => {
                for (const session of ended) {
                    await removeChunks(session).catch((error) => log("warn", "upload chunks not removed", { upload_id: session.id, error: errorText(error) }));
                }
            });
            const id = await insertInvoice(client, {
                kind: "visit",
                horseId: visit.horse_id,
                ownerId: facts.owner_id,
                visitId: visit.id,
                bookingId: null,
                barnDayId: facts.barn_day_id,
                businessDate: visit.business_date,
                items,
                creditCents,
                depositPaymentId: creditCents > 0 ? facts.payment_id : null,
                nextAttemptAt: creatorLease(now),
            });
            if (creditCents > 0 && facts.payment_id)
                await applyDeposit(client, facts.payment_id, creditCents, "visit");
            await client.query(`SELECT 1 FROM horses WHERE id = $1 FOR UPDATE`, [visit.horse_id]);
            for (const audience of ["staff", "owner"]) {
                await appendEvent(client, horseStream(visit.horse_id, audience), "visit_closed", { visit_id: visit.id });
            }
            return id;
        }));
        await advanceInvoice(invoiceId, true);
        return json(200, await visitJson(db, await visibleVisit(db, caller, visit.id), caller, now));
    });
});
