// Every published endpoint. Error precedence: 403 cross_origin, 413 too_large,
// 415 unsupported_media_type, 400 malformed_json, 404 not_found,
// 400 idempotency_key_required, idempotent replay, 409 idempotency_in_flight,
// 409 idempotency_conflict, state conflicts, 422 validation, 503 storage_unavailable.

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { ServerClock } from "./clock.js";
import { errorBody, FIELD_COPY, MESSAGES } from "./errors.js";
import { referenceTransition, sheetTransition } from "./states.js";
import { sniffPhotoType, readPhotoHeader, overPixelLimit } from "./photo.js";
import { upright, computedSwatch, eyedropperSwatch, displayCrop } from "./images.js";
import { s3Get, s3PutConfirmed, s3Delete, sha256, newId } from "./storage.js";
import { idempotencyAcquire, idempotencyRecord, idempotencySweep } from "./idempotency.js";
import {
  getReference, insertReference, listStored, getReel, listReels, getSheet, listSheets, rowToSheet, toIsoSecond, rowToReference,
} from "./repo.js";
import { getSettings, saveHomeZone, saveUnit, applyDueZoneChange } from "./settings.js";
import { getDailyPull } from "./dailyPull.js";
import { effectiveZone, isAcceptedZone, startOfDay, ZONES } from "./zones.js";
import { searchDoc, meili, indexName, ensureIndexSettings, indexExists, searchDoc as doc } from "./search.js";
import { recordSearchUpdate } from "./searchUpdates.js";
import { fallbackSearch } from "./fallbackSearch.js";
import { COLOUR_FAMILIES, sizeText, type Reference, type Sheet } from "../shared/domain.js";
import { purgeReference } from "./purge.js";
import { renderSheet } from "./sheetRender.js";
import { statuses } from "./status.js";

const JSON_LIMIT = 65_536;
const MULTIPART_LIMIT = 16_000_000;

export async function routes(app: FastifyInstance, pool: Pool, clock: ServerClock): Promise<void> {
  const fail = (reply: { code: (n: number) => { send: (b: unknown) => void } }, status: number, body: unknown) =>
    reply.code(status).send(body);

  const validationError = (reply: never, fields: Record<string, string>) =>
    fail(reply as never, 422, errorBody("validation", MESSAGES.validation, fields));

  // --- health and status -------------------------------------------------

  app.get("/api/health", async () => ({ status: "ok" }));

  app.get("/api/status", async () => {
    const now = clock.now();
    return {
      server_now: toIsoSecond(now),
      services: { search: statuses.search ? "up" : "down", storage: statuses.storage ? "up" : "down", printing: statuses.printing ? "up" : "down" },
    };
  });

  // --- references ---------------------------------------------------------

  app.post("/api/references", async (req, reply) => {
    if (!req.isMultipart()) return fail(reply, 415, errorBody("unsupported_media_type", MESSAGES.unsupportedMediaType));
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || !/^[\x20-\x7E]{1,64}$/.test(key)) {
      return fail(reply, 400, errorBody("idempotency_key_required", MESSAGES.idempotencyKeyRequired));
    }

    // Read the parts within the multipart limit.
    const fields = new Map<string, string>();
    let photo: Buffer | null = null;
    let total = 0;
    try {
      const parts = req.parts();
      for await (const part of parts) {
        if (part.type === "file") {
          if ((part.filename ?? "") !== "") {
            const chunks: Buffer[] = [];
            for await (const chunk of part.file) {
              total += (chunk as Buffer).length;
              if (total > MULTIPART_LIMIT) return fail(reply, 413, errorBody("too_large", MESSAGES.tooLarge));
              chunks.push(chunk as Buffer);
            }
            photo = Buffer.concat(chunks);
          }
        } else {
          fields.set(part.fieldname, part.value as string);
        }
      }
    } catch {
      return fail(reply, 413, errorBody("too_large", MESSAGES.tooLarge));
    }

    const f = (name: string) => fields.get(name) ?? "";
    const requestHash = sha256(Buffer.concat([photo ?? Buffer.alloc(0), Buffer.from(JSON.stringify([...fields.entries()]))]));
    const path = "/api/references";
    const idem = await idempotencyAcquire(pool, "POST", path, key, requestHash);
    if (idem.result.kind === "in_flight") return fail(reply, 409, errorBody("idempotency_in_flight", MESSAGES.idempotencyInFlight));
    if (idem.result.kind === "content_conflict") return fail(reply, 409, errorBody("idempotency_conflict", MESSAGES.idempotencyConflict));
    if (idem.result.kind === "replay") {
      reply.header("Idempotent-Replay", "true");
      return fail(reply, idem.result.status, JSON.parse(idem.result.body));
    }

    const settings = await getSettings(pool, clock.nowMs());
    const zoneEntries = settings.history.map((h) => ({ zone: h.zone, effective_from: Date.parse(h.effective_from) }));
    const home = effectiveZone(zoneEntries, clock.nowMs());
    const currentYear = new Intl.DateTimeFormat("en-US", { timeZone: home, year: "numeric" }).format(clock.now());

    // Validation: photo, then fields (422s before anything is stored).
    const fields422: Record<string, string> = {};
    if (!photo) {
      fields422.photo = FIELD_COPY.photo();
    } else {
      const kind = sniffPhotoType(photo);
      if (!kind) {
        fields422.photo = FIELD_COPY.photo();
      } else if (photo.length > 15_000_000) {
        fields422.photo = FIELD_COPY.photo_bytes();
      } else {
        const header = readPhotoHeader(photo);
        if (!header || overPixelLimit(header.width, header.height)) {
          fields422.photo = header ? FIELD_COPY.photo_pixels() : FIELD_COPY.photo();
        }
      }
    }

    const title = f("title").trim();
    if (title.length < 1 || title.length > 80) fields422.title = FIELD_COPY.title();
    const maker = f("maker").trim();
    if (maker.length > 80) fields422.maker = FIELD_COPY.maker();
    let year: number | null = null;
    const yearText = f("year").trim();
    if (yearText.length > 0) {
      year = /^\d+$/.test(yearText) ? Number(yearText) : null;
      if (year === null || year < 1800 || year > Number(currentYear)) fields422.year = FIELD_COPY.year({ year: Number(currentYear) });
    }
    const unit = f("unit") === "in" ? "in" : "mm";
    if (f("unit") !== "mm" && f("unit") !== "in") fields422.unit = FIELD_COPY.unit();
    const sizes: Array<[string, number | null]> = [];
    for (const name of ["width", "height", "depth"] as const) {
      const raw = f(name);
      const mmPattern = /^\d+(\.\d)?$/;
      const inPattern = /^\d+(\.\d{1,2})?$/;
      const ok = unit === "mm" ? mmPattern.test(raw) : inPattern.test(raw);
      if (!ok) { sizes.push([name, null]); continue; }
      const v = Number(raw);
      const tenths = unit === "mm" ? v * 10 : Math.floor(v * 254 + 0.5);
      sizes.push([name, tenths >= 10 && tenths <= 50000 ? tenths : null]);
    }
    for (const [name, tenths] of sizes) {
      if (tenths === null) fields422[name] = FIELD_COPY[name]();
    }
    const materials = f("materials").split(",").map((m) => m.trim()).filter((m) => m.length > 0);
    if (materials.length > 8 || materials.some((m) => m.length < 1 || m.length > 40)) {
      fields422.materials = FIELD_COPY.materials();
    }
    const finish = f("finish").trim();
    if (finish.length > 80) fields422.finish = FIELD_COPY.finish();
    const colour = f("colour_family").trim();
    if (!COLOUR_FAMILIES.includes(colour as never)) fields422.colour_family = FIELD_COPY.colour_family();
    const sourceUrl = f("source_url").trim();
    if (sourceUrl.length > 0 && (sourceUrl.length > 500 || !/^https?:\/\//.test(sourceUrl))) {
      fields422.source_url = FIELD_COPY.source_url();
    }
    const sourceNote = f("source_note").trim();
    if (sourceNote.length > 120) fields422.source_note = FIELD_COPY.source_note();
    const notes = f("notes").trim();
    if (notes.length > 2000) fields422.notes = FIELD_COPY.notes();
    const sx = f("swatch_x"), sy = f("swatch_y");
    if ((sx.length > 0) !== (sy.length > 0)) {
      if (sx.length === 0) fields422.swatch_x = FIELD_COPY.swatch_x();
      if (sy.length === 0) fields422.swatch_y = FIELD_COPY.swatch_y();
    }
    if (Object.keys(fields422).length > 0) {
      await idem.release();
      return validationError(reply as never, fields422);
    }

    // Storage first: original and display crop, confirmed, then the row and the
    // search document. On failure everything is deleted and the answer is 503.
    const kind = sniffPhotoType(photo!);
    const id = newId("ref");
    const contentType = kind === "png" ? "image/png" : "image/jpeg";
    const ext = kind === "png" ? "png" : "jpg";
    let reference: Reference;
    try {
      const img = upright(photo!);
      if (!img) {
        await idem.release();
        return validationError(reply as never, { photo: FIELD_COPY.photo() });
      }
      const originalKey = `references/${id}/original.${ext}`;
      await s3PutConfirmed(originalKey, photo!, contentType);
      const swatch = sx.length > 0
        ? eyedropperSwatch(img, Number(sx), Number(sy))
        : computedSwatch(img);
      const crop = displayCrop(img);
      await s3PutConfirmed(`references/${id}/display.jpg`, crop, "image/jpeg");
      const capturedAt = clock.now();
      reference = await insertReference(pool, {
        id, title, maker: maker || null, year, materials, finish: finish || null,
        colour_family: colour, source_url: sourceUrl || null, source_note: sourceNote || null,
        notes: notes || null, widthTenths: sizes[0][1]!, heightTenths: sizes[1][1]!, depthTenths: sizes[2][1]!,
        capturedAt, photoContentType: contentType, photoBytes: photo!.length,
        photoSha256: sha256(photo!), photoWidth: img.width, photoHeight: img.height,
      }, swatch);
      // Confirmed search write; on failure the update is recorded for catch-up.
      try {
        const task = await meili.index(indexName).addDocuments([searchDoc(reference)]);
        await meili.index(indexName).waitForTask(task.taskUid);
      } catch {
        await recordSearchUpdate(pool, id, "upsert");
      }
    } catch (err) {
      if ((err as { code?: string }).code === "23514" || (err as Error).message.includes("storage")) {
        // fall through to the 503 cleanup below
      }
      await idem.release();
      await cleanupPartial(pool, id, ext);
      return fail(reply, 503, errorBody("storage_unavailable", MESSAGES.storageUnavailable));
    }

    const body = JSON.stringify(reference);
    await idempotencyRecord(pool, "POST", path, key, requestHash, 201, body);
    return reply.code(201).send(reference);
  });

  app.get("/api/references", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    const colour = query.colour_family ?? undefined;
    const material = query.material ?? undefined;
    const finish = query.finish ?? undefined;
    const settings = await getSettings(pool, clock.nowMs());
    const zoneEntries = settings.history.map((h) => ({ zone: h.zone, effective_from: Date.parse(h.effective_from) }));
    const home = effectiveZone(zoneEntries, clock.nowMs());
    const start = startOfDay(home, clock.nowMs());
    const all = await listStored(pool);
    const matches = all.filter((r) =>
      (!colour || r.colour_family === colour) &&
      (!material || r.materials.some((m) => m.toLowerCase() === material.toLowerCase())) &&
      (!finish || (r.finish ?? "").toLowerCase() === finish.toLowerCase()));
    return {
      zone: home,
      today_starts_at: toIsoSecond(new Date(start)),
      saved_today: matches.filter((r) => Date.parse(r.captured_at) >= start),
      earlier: matches.filter((r) => Date.parse(r.captured_at) < start),
    };
  });

  app.get("/api/references/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ref = await getReference(pool, id);
    if (!ref) return fail(reply, 404, errorBody("not_found", MESSAGES.notFound));
    return ref;
  });

  app.patch("/api/references/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ref = await getReference(pool, id);
    if (!ref) return fail(reply, 404, errorBody("not_found", MESSAGES.notFound));
    const body = req.body as Record<string, unknown>;
    const settings = await getSettings(pool, clock.nowMs());
    const zoneEntries = settings.history.map((h) => ({ zone: h.zone, effective_from: Date.parse(h.effective_from) }));
    const home = effectiveZone(zoneEntries, clock.nowMs());
    const currentYear = new Intl.DateTimeFormat("en-US", { timeZone: home, year: "numeric" }).format(clock.now());
    const fields422: Record<string, string> = {};
    if (!Number.isInteger(body.version)) fields422.version = FIELD_COPY.version();
    const bad = parseEdit(body, ref, String(currentYear), fields422);
    if (Object.keys(fields422).length > 0) return validationError(reply as never, fields422);

    // reference_trashed precedes reference_version_conflict; the transition
    // module is the single decision point for the event's legality.
    const editCheck = referenceTransition(ref.state, "edit");
    if (!editCheck.ok) return fail(reply, 409, errorBody(editCheck.code, MESSAGES.referenceTrashed));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE "references" SET title = $2, maker = $3, year = $4, materials = $5, finish = $6,
          colour_family = $7, source_url = $8, source_note = $9, notes = $10,
          width_tenths = $11, height_tenths = $12, depth_tenths = $13, version = version + 1
         WHERE id = $1 AND version = $14 AND state = 'stored'
         RETURNING id, state, version, title, maker, year, materials, finish, colour_family,
           source_url, source_note, notes, width_tenths, height_tenths, depth_tenths,
           swatch, swatch_source, captured_at, trashed_at, purge_at,
           photo_content_type, photo_bytes, photo_sha256, photo_width, photo_height`,
        [id, bad.title, bad.maker, bad.year, bad.materials, bad.finish, bad.colour_family,
         bad.source_url, bad.source_note, bad.notes, bad.width, bad.height, bad.depth, body.version]);
      if (updated.rows.length === 0) {
        await client.query("ROLLBACK");
        return fail(reply, 409, errorBody("reference_version_conflict", MESSAGES.referenceVersionConflict));
      }
      await client.query("COMMIT");
      const next = rowToReference(updated.rows[0]);
      try {
        const task = await meili.index(indexName).addDocuments([searchDoc(next)]);
        await meili.index(indexName).waitForTask(task.taskUid);
      } catch {
        await recordSearchUpdate(pool, id, "upsert");
      }
      return next;
    } finally {
      client.release();
    }
  });

  app.get("/api/references/:id/original", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ref = await getReference(pool, id);
    if (!ref) return fail(reply, 404, errorBody("not_found", MESSAGES.notFound));
    const ext = ref.photo.content_type === "image/png" ? "png" : "jpg";
    try {
      const obj = await s3Get(`references/${id}/original.${ext}`);
      if (!obj) return fail(reply, 503, errorBody("storage_unavailable", MESSAGES.storageUnavailable));
      reply.header("content-type", ref.photo.content_type);
      reply.header("content-length", obj.buf.length);
      return reply.send(obj.buf);
    } catch {
      return fail(reply, 503, errorBody("storage_unavailable", MESSAGES.storageUnavailable));
    }
  });

  app.get("/api/references/:id/display", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ref = await getReference(pool, id);
    if (!ref) return fail(reply, 404, errorBody("not_found", MESSAGES.notFound));
    try {
      const obj = await s3Get(`references/${id}/display.jpg`);
      if (!obj) return fail(reply, 503, errorBody("storage_unavailable", MESSAGES.storageUnavailable));
      reply.header("content-type", "image/jpeg");
      return reply.send(obj.buf);
    } catch {
      return fail(reply, 503, errorBody("storage_unavailable", MESSAGES.storageUnavailable));
    }
  });

  app.post("/api/references/:id/swatch", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ref = await getReference(pool, id);
    if (!ref) return fail(reply, 404, errorBody("not_found", MESSAGES.notFound));
    const body = req.body as { x?: number; y?: number };
    const fields422: Record<string, string> = {};
    for (const k of ["x", "y"] as const) {
      const v = body?.[k];
      if (typeof v !== "number" || v < 0 || v > 1) fields422[k] = FIELD_COPY[k]();
    }
    if (Object.keys(fields422).length > 0) return validationError(reply as never, fields422);
    const reswatchCheck = referenceTransition(ref.state, "reswatch");
    if (!reswatchCheck.ok) return fail(reply, 409, errorBody(reswatchCheck.code, MESSAGES.referenceTrashed));
    try {
      const ext = ref.photo.content_type === "image/png" ? "png" : "jpg";
      const original = await s3Get(`references/${id}/original.${ext}`);
      if (!original) return fail(reply, 503, errorBody("storage_unavailable", MESSAGES.storageUnavailable));
      const img = upright(original.buf);
      if (!img) return fail(reply, 503, errorBody("storage_unavailable", MESSAGES.storageUnavailable));
      const swatch = eyedropperSwatch(img, body.x!, body.y!);
      const updated = await applySwatch(pool, id, swatch, "eyedropper");
      try {
        const task = await meili.index(indexName).addDocuments([searchDoc(updated)]);
        await meili.index(indexName).waitForTask(task.taskUid);
      } catch { /* swatch is not part of the search document */ }
      return updated;
    } catch {
      return fail(reply, 503, errorBody("storage_unavailable", MESSAGES.storageUnavailable));
    }
  });

  app.delete("/api/references/:id/swatch", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ref = await getReference(pool, id);
    if (!ref) return fail(reply, 404, errorBody("not_found", MESSAGES.notFound));
    const resetCheck = referenceTransition(ref.state, "reswatch");
    if (!resetCheck.ok) return fail(reply, 409, errorBody(resetCheck.code, MESSAGES.referenceTrashed));
    try {
      const ext = ref.photo.content_type === "image/png" ? "png" : "jpg";
      const original = await s3Get(`references/${id}/original.${ext}`);
      if (!original) return fail(reply, 503, errorBody("storage_unavailable", MESSAGES.storageUnavailable));
      const img = upright(original.buf);
      if (!img) return fail(reply, 503, errorBody("storage_unavailable", MESSAGES.storageUnavailable));
      const swatch = computedSwatch(img);
      const updated = await applySwatch(pool, id, swatch, "computed");
      return updated;
    } catch {
      return fail(reply, 503, errorBody("storage_unavailable", MESSAGES.storageUnavailable));
    }
  });

  app.delete("/api/references/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ref = await getReference(pool, id);
    if (!ref) return fail(reply, 404, errorBody("not_found", MESSAGES.notFound));
    const trashCheck = referenceTransition(ref.state, "trash");
    if (!trashCheck.ok) return fail(reply, 409, errorBody(trashCheck.code, MESSAGES.alreadyTrashed));
    const retention = Number(process.env.STOWDECK_TRASH_RETENTION_SECONDS ?? 2_592_000);
    const trashedAt = clock.now();
    const purgeAt = new Date(trashedAt.getTime() + retention * 1000);
    const { rows } = await pool.query(
      `UPDATE "references" SET state = 'trashed', trashed_at = $2, purge_at = $3, version = version + 1
       WHERE id = $1 AND state = 'stored'
       RETURNING id, state, version, title, maker, year, materials, finish, colour_family,
         source_url, source_note, notes, width_tenths, height_tenths, depth_tenths,
         swatch, swatch_source, captured_at, trashed_at, purge_at,
         photo_content_type, photo_bytes, photo_sha256, photo_width, photo_height`,
      [id, trashedAt, purgeAt]);
    if (rows.length === 0) return fail(reply, 409, errorBody("already_trashed", MESSAGES.alreadyTrashed));
    const updated = rowToReference(rows[0]);
    try {
      const task = await meili.index(indexName).deleteDocument(id);
      await meili.index(indexName).waitForTask(task.taskUid);
    } catch {
      await recordSearchUpdate(pool, id, "delete");
    }
    return updated;
  });

  app.post("/api/references/:id/restore", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ref = await getReference(pool, id);
    if (!ref) return fail(reply, 410, errorBody("restore_window_closed", MESSAGES.restoreWindowClosed));
    const restoreCheck = referenceTransition(ref.state, "restore");
    if (!restoreCheck.ok) return fail(reply, 409, errorBody(restoreCheck.code, MESSAGES.notTrashed));
    const nowMs = clock.nowMs();
    if (ref.purge_at && Date.parse(ref.purge_at) < nowMs) {
      await purgeReference(pool, id);
      return fail(reply, 410, errorBody("restore_window_closed", MESSAGES.restoreWindowClosed));
    }
    const { rows } = await pool.query(
      `UPDATE "references" SET state = 'stored', trashed_at = NULL, purge_at = NULL, version = version + 1
       WHERE id = $1 AND state = 'trashed'
       RETURNING id, state, version, title, maker, year, materials, finish, colour_family,
         source_url, source_note, notes, width_tenths, height_tenths, depth_tenths,
         swatch, swatch_source, captured_at, trashed_at, purge_at,
         photo_content_type, photo_bytes, photo_sha256, photo_width, photo_height`,
      [id]);
    const updated = rowToReference(rows[0]);
    try {
      const task = await meili.index(indexName).addDocuments([searchDoc(updated)]);
      await meili.index(indexName).waitForTask(task.taskUid);
    } catch {
      await recordSearchUpdate(pool, id, "upsert");
    }
    return updated;
  });

  app.get("/api/trash", async () => {
    const { rows } = await pool.query(
      `SELECT id, title, maker, trashed_at, purge_at FROM "references" WHERE state = 'trashed' ORDER BY trashed_at DESC`);
    const nowMs = clock.nowMs();
    return {
      server_now: toIsoSecond(clock.now()),
      items: rows.map((r: { id: string; title: string; maker: string | null; trashed_at: Date; purge_at: Date }) => ({
        id: r.id, title: r.title, maker: r.maker,
        trashed_at: toIsoSecond(r.trashed_at), purge_at: toIsoSecond(r.purge_at),
        seconds_left: Math.max(0, Math.floor((Date.parse(toIsoSecond(r.purge_at)) - nowMs) / 1000)),
      })),
    };
  });

  // --- search -------------------------------------------------------------

  app.get("/api/search", async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const q = (query.q ?? "").slice(0, 200);
    const filters = {
      colour_family: query.colour_family,
      material: query.material,
      finish: query.finish,
    };
    if (statuses.search) {
      try {
        const filter: string[] = [];
        if (filters.colour_family) filter.push(`colour_family = "${filters.colour_family}"`);
        if (filters.material) filter.push(`materials = "${filters.material}"`);
        if (filters.finish) filter.push(`finish = "${filters.finish}"`);
        const res = await meili.index(indexName).search(q, filter.length ? { filter: filter.join(" AND ") } : {});
        const ids = res.hits.map((h) => (h as { id: string }).id);
        const all = await listStored(pool, ids.length ? ids : []);
        const byId = new Map(all.map((r) => [r.id, r]));
        const results = ids.map((id2) => byId.get(id2)).filter((r): r is Reference => Boolean(r));
        return { source: "index", results };
      } catch {
        return fallbackSearch(pool, q, filters);
      }
    }
    return fallbackSearch(pool, q, filters);
  });

  // --- reels --------------------------------------------------------------

  app.get("/api/reels", async () => {
    const rows = await listReels(pool);
    return { reels: rows };
  });

  app.post("/api/reels", async (req, reply) => {
    const body = req.body as { name?: unknown };
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (name.length < 1 || name.length > 60) {
      return validationError(reply as never, { name: FIELD_COPY.name() });
    }
    const id = newId("reel");
    await pool.query(`INSERT INTO reels (id, name, demo, version) VALUES ($1, $2, false, 1)`, [id, name]);
    return reply.code(201).send(await getReel(pool, id));
  });

  app.get("/api/reels/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const reel = await getReel(pool, id);
    if (!reel) return fail(reply, 404, errorBody("not_found", MESSAGES.notFound));
    return reel;
  });

  app.post("/api/reels/:id/stops", async (req, reply) => {
    const { id } = req.params as { id: string };
    const reel = await getReel(pool, id);
    if (!reel) return fail(reply, 404, errorBody("not_found", MESSAGES.notFound));
    const body = req.body as { reference_id?: unknown };
    if (typeof body?.reference_id !== "string" || body.reference_id.length === 0) {
      return validationError(reply as never, { reference_id: FIELD_COPY.reference_id() });
    }
    const ref = await getReference(pool, body.reference_id);
    if (!ref) return validationError(reply as never, { reference_id: FIELD_COPY.reference_id() });
    const appendCheck = referenceTransition(ref.state, "append");
    if (!appendCheck.ok) return fail(reply, 409, errorBody(appendCheck.code, MESSAGES.referenceTrashed));
    if (reel.stops.length >= 60) return fail(reply, 409, errorBody("reel_full", MESSAGES.reelFull));
    if (reel.stops.some((s) => s.reference.id === body.reference_id)) {
      return fail(reply, 409, errorBody("already_in_reel", MESSAGES.alreadyInReel));
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`LOCK TABLE reel_stops IN ACCESS EXCLUSIVE MODE`);
      const count = await client.query(`SELECT count(*)::int AS n, max(position)::int AS maxp FROM reel_stops WHERE reel_id = $1`, [id]);
      const dup = await client.query(`SELECT 1 FROM reel_stops WHERE reel_id = $1 AND reference_id = $2`, [id, body.reference_id]);
      const stillStored = await client.query(`SELECT state FROM "references" WHERE id = $1`, [body.reference_id]);
      if (count.rows[0].n >= 60) { await client.query("ROLLBACK"); return fail(reply, 409, errorBody("reel_full", MESSAGES.reelFull)); }
      if (dup.rows.length > 0) { await client.query("ROLLBACK"); return fail(reply, 409, errorBody("already_in_reel", MESSAGES.alreadyInReel)); }
      if (stillStored.rows[0]?.state !== "stored") { await client.query("ROLLBACK"); return fail(reply, 409, errorBody("reference_trashed", MESSAGES.referenceTrashed)); }
      await client.query(
        `INSERT INTO reel_stops (reel_id, position, reference_id) VALUES ($1, $2, $3)`,
        [id, count.rows[0].maxp ? count.rows[0].maxp + 1 : 1, body.reference_id]);
      await client.query(`UPDATE reels SET version = version + 1 WHERE id = $1`, [id]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return getReel(pool, id);
  });

  app.put("/api/reels/:id/stops", async (req, reply) => {
    const { id } = req.params as { id: string };
    const reel = await getReel(pool, id);
    if (!reel) return fail(reply, 404, errorBody("not_found", MESSAGES.notFound));
    const body = req.body as { version?: unknown; reference_ids?: unknown };
    const fields422: Record<string, string> = {};
    if (!Number.isInteger(body?.version) || (body?.version as number) < 1) {
      fields422.version = FIELD_COPY.reel_version();
    }
    const ids = Array.isArray(body?.reference_ids) ? body.reference_ids as unknown[] : [];
    if (ids.some((v) => typeof v !== "string")) fields422.reference_ids = FIELD_COPY.reference_ids();
    const seen = new Set<string>();
    for (const v of ids) { if (typeof v === "string") { if (seen.has(v)) { fields422.reference_ids = FIELD_COPY.reference_ids(); break; } seen.add(v); } }
    if (ids.length > 60) fields422.reference_ids = FIELD_COPY.reference_ids();
    if (Object.keys(fields422).length > 0) return validationError(reply as never, fields422);
    // Each id must be a stored or trashed reference.
    const known = await pool.query(`SELECT id, state FROM "references" WHERE id = ANY($1)`, [seen.size ? [...seen] : [""]]);
    const knownIds = new Set(known.rows.map((r: { id: string }) => r.id));
    if (seen.size !== knownIds.size || [...seen].some((v) => !knownIds.has(v))) {
      return validationError(reply as never, { reference_ids: FIELD_COPY.reference_ids() });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const cur = await client.query(`SELECT version FROM reels WHERE id = $1 FOR UPDATE`, [id]);
      if (cur.rows[0].version !== body.version) {
        await client.query("ROLLBACK");
        return fail(reply, 409, errorBody("reel_version_conflict", MESSAGES.reelVersionConflict));
      }
      await client.query(`DELETE FROM reel_stops WHERE reel_id = $1`, [id]);
      let pos = 1;
      for (const rid of ids as string[]) {
        await client.query(`INSERT INTO reel_stops (reel_id, position, reference_id) VALUES ($1, $2, $3)`, [id, pos++, rid]);
      }
      await client.query(`UPDATE reels SET version = version + 1 WHERE id = $1`, [id]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return getReel(pool, id);
  });

  // --- sheets ---------------------------------------------------------------

  app.post("/api/reels/:id/sheets", async (req, reply) => {
    const { id } = req.params as { id: string };
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || !/^[\x20-\x7E]{1,64}$/.test(key)) {
      return fail(reply, 400, errorBody("idempotency_key_required", MESSAGES.idempotencyKeyRequired));
    }
    const reel = await getReel(pool, id);
    if (!reel) return fail(reply, 404, errorBody("not_found", MESSAGES.notFound));
    const body = req.body as { paper?: unknown; unit?: unknown };
    const fields422: Record<string, string> = {};
    if (body?.paper !== "a4" && body?.paper !== "letter") fields422.paper = FIELD_COPY.paper();
    if (body?.unit !== "mm" && body?.unit !== "in") fields422.unit = FIELD_COPY.unit();
    if (Object.keys(fields422).length > 0) return validationError(reply as never, fields422);
    const playable = reel.stops.filter((s) => s.reference.state === "stored");
    if (playable.length === 0) return fail(reply, 409, errorBody("reel_empty", MESSAGES.reelEmpty));

    const requestHash = sha256(Buffer.from(JSON.stringify([req.url, body])));
    const idem = await idempotencyAcquire(pool, "POST", req.url.split("?")[0], key, requestHash);
    if (idem.result.kind === "in_flight") return fail(reply, 409, errorBody("idempotency_in_flight", MESSAGES.idempotencyInFlight));
    if (idem.result.kind === "content_conflict") return fail(reply, 409, errorBody("idempotency_conflict", MESSAGES.idempotencyConflict));
    if (idem.result.kind === "replay") {
      reply.header("Idempotent-Replay", "true");
      return reply.code(idem.result.status).send(JSON.parse(idem.result.body));
    }

    const sheetId = newId("sheet");
    const sheetUnit = body.unit as "mm" | "in";
    const stops = playable.map((s, i) => ({
      position: i + 1,
      reference_id: s.reference.id,
      title: s.reference.title,
      maker: s.reference.maker,
      year: s.reference.year,
      size_text: s.reference.size_text[sheetUnit],
      swatch: s.reference.swatch,
    }));
    await pool.query(
      `INSERT INTO sheets (id, reel_id, state, paper, unit, requested_at, stops)
       VALUES ($1, $2, 'queued', $3, $4, $5, $6::jsonb)`,
      [sheetId, id, body.paper, body.unit, clock.now(), JSON.stringify(stops)]);
    const sheet = await getSheet(pool, sheetId);
    const bodyText = JSON.stringify(sheet);
    await idempotencyRecord(pool, "POST", req.url.split("?")[0], key, requestHash, 202, bodyText);
    return reply.code(202).send(sheet);
  });

  app.get("/api/reels/:id/sheets", async (req) => {
    const { id } = req.params as { id: string };
    return { sheets: await listSheets(pool, id) };
  });

  app.get("/api/sheets/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const sheet = await getSheet(pool, id);
    if (!sheet) return fail(reply, 404, errorBody("not_found", MESSAGES.notFound));
    return sheet;
  });

  app.post("/api/sheets/:id/retry", async (req, reply) => {
    const { id } = req.params as { id: string };
    const sheet = await getSheet(pool, id);
    if (!sheet) return fail(reply, 404, errorBody("not_found", MESSAGES.notFound));
    // The sheet state machine decides whether a retry is legal.
    if (!sheetTransition(sheet.state, "retry").ok) return fail(reply, 409, errorBody("sheet_not_failed", MESSAGES.sheetNotFailed));
    const { rows } = await pool.query(
      `UPDATE sheets SET state = 'queued', fail_count = 0
       WHERE id = $1 AND state = 'failed' RETURNING id`,
      [id]);
    return reply.code(202).send(await getSheet(pool, id));
  });

  app.get("/api/sheets/:id/pdf", async (req, reply) => {
    const { id } = req.params as { id: string };
    const sheet = await getSheet(pool, id);
    if (!sheet) return fail(reply, 404, errorBody("not_found", MESSAGES.notFound));
    if (sheet.state !== "ready") return fail(reply, 409, errorBody("sheet_not_ready", MESSAGES.sheetNotReady));
    try {
      const obj = await s3Get(`sheets/${id}.pdf`);
      if (!obj) return fail(reply, 503, errorBody("storage_unavailable", MESSAGES.storageUnavailable));
      reply.header("content-type", "application/pdf");
      return reply.send(obj.buf);
    } catch {
      return fail(reply, 503, errorBody("storage_unavailable", MESSAGES.storageUnavailable));
    }
  });

  // --- daily pull and settings ----------------------------------------------

  app.get("/api/daily-pull", async () => {
    const settings = await getSettings(pool, clock.nowMs());
    const zoneEntries = settings.history.map((h) => ({ zone: h.zone, effective_from: Date.parse(h.effective_from) }));
    return getDailyPull(pool, zoneEntries, clock.nowMs());
  });

  app.get("/api/settings", async () => getSettings(pool, clock.nowMs()));

  // The accepted zones for the Settings picker, in code-point order.
  app.get("/api/settings/zones", async () => ({ zones: ZONES }));

  app.put("/api/settings/home-zone", async (req, reply) => {
    const body = req.body as { zone?: unknown };
    if (typeof body?.zone !== "string" || !isAcceptedZone(body.zone)) {
      return validationError(reply as never, { zone: FIELD_COPY.zone() });
    }
    return saveHomeZone(pool, body.zone, clock.nowMs());
  });

  app.put("/api/settings/unit", async (req, reply) => {
    const body = req.body as { unit?: unknown };
    if (body?.unit !== "mm" && body?.unit !== "in") {
      return validationError(reply as never, { unit: FIELD_COPY.unit() });
    }
    return saveUnit(pool, body.unit, clock.nowMs());
  });
}

interface EditValues {
  title: string; maker: string | null; year: number | null; materials: string[];
  finish: string | null; colour_family: string; source_url: string | null;
  source_note: string | null; notes: string | null;
  width: number; height: number; depth: number;
}

function parseEdit(body: Record<string, unknown>, ref: Reference, currentYear: string, fields: Record<string, string>): EditValues {
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : null);
  const title = body.title === undefined ? ref.title : text(body.title);
  if (title === null || title.length < 1 || title.length > 80) fields.title = FIELD_COPY.title();
  const maker = body.maker === undefined ? ref.maker : text(body.maker);
  if (maker !== null && maker.length > 80) fields.maker = FIELD_COPY.maker();
  let year: number | null = ref.year;
  if (body.year !== undefined) {
    const y = text(body.year);
    year = y === null || y.length === 0 ? null : Number(y);
    if (year !== null && (!Number.isInteger(year) || year < 1800 || year > Number(currentYear))) {
      fields.year = FIELD_COPY.year({ year: Number(currentYear) });
    }
  }
  let materials = ref.materials;
  if (body.materials !== undefined) {
    const raw = body.materials;
    materials = Array.isArray(raw) ? raw.map((m) => String(m).trim()).filter((m) => m.length > 0) : [];
    if (typeof raw === "string") materials = raw.split(",").map((m) => m.trim()).filter((m) => m.length > 0);
    if (materials.length > 8 || materials.some((m) => m.length > 40)) fields.materials = FIELD_COPY.materials();
  }
  const finish = body.finish === undefined ? ref.finish : text(body.finish);
  if (finish !== null && finish.length > 80) fields.finish = FIELD_COPY.finish();
  const colour = body.colour_family === undefined ? ref.colour_family : text(body.colour_family);
  if (colour === null || !COLOUR_FAMILIES.includes(colour as never)) fields.colour_family = FIELD_COPY.colour_family();
  const sourceUrl = body.source_url === undefined ? ref.source_url : text(body.source_url);
  if (sourceUrl !== null && (sourceUrl.length > 500 || !/^https?:\/\//.test(sourceUrl))) fields.source_url = FIELD_COPY.source_url();
  const sourceNote = body.source_note === undefined ? ref.source_note : text(body.source_note);
  if (sourceNote !== null && sourceNote.length > 120) fields.source_note = FIELD_COPY.source_note();
  const notes = body.notes === undefined ? ref.notes : text(body.notes);
  if (notes !== null && notes.length > 2000) fields.notes = FIELD_COPY.notes();

  // Sizes: the unit decides how numbers are read; an inch value equal to the
  // stored display keeps the stored tenths.
  const unit = body.unit === "in" ? "in" : body.unit === "mm" ? "mm" : null;
  const tenths = { width: ref.size_tenths_mm.width, height: ref.size_tenths_mm.height, depth: ref.size_tenths_mm.depth };
  for (const k of ["width", "height", "depth"] as const) {
    if (body[k] !== undefined) {
      if (unit === null) { fields.unit = FIELD_COPY.unit(); continue; }
      const raw = String(body[k]).trim();
      const mmPattern = /^\d+(\.\d)?$/;
      const inPattern = /^\d+(\.\d{1,2})?$/;
      if (!(unit === "mm" ? mmPattern : inPattern).test(raw)) { fields[k] = FIELD_COPY[k](); continue; }
      const v = Number(raw);
      if (unit === "in" && Math.floor(v * 254 + 0.5) === tenths[k]) continue; // no drift
      tenths[k] = unit === "mm" ? v * 10 : Math.floor(v * 254 + 0.5);
      if (tenths[k] < 10 || tenths[k] > 50000) fields[k] = FIELD_COPY[k]();
    }
  }
  return {
    title: title ?? ref.title, maker: maker || null, year, materials,
    finish: finish || null, colour_family: colour ?? ref.colour_family,
    source_url: sourceUrl || null, source_note: sourceNote || null, notes: notes || null,
    width: tenths.width, height: tenths.height, depth: tenths.depth,
  };
}

async function applySwatch(pool: Pool, id: string, swatch: string, source: "computed" | "eyedropper"): Promise<Reference> {
  const { rows } = await pool.query(
    `UPDATE "references" SET swatch = $2, swatch_source = $3, version = version + 1
     WHERE id = $1 AND state = 'stored'
     RETURNING id, state, version, title, maker, year, materials, finish, colour_family,
       source_url, source_note, notes, width_tenths, height_tenths, depth_tenths,
       swatch, swatch_source, captured_at, trashed_at, purge_at,
       photo_content_type, photo_bytes, photo_sha256, photo_width, photo_height`,
    [id, swatch, source]);
  return rowToReference(rows[0]);
}

async function cleanupPartial(pool: Pool, id: string, ext: string): Promise<void> {
  await pool.query(`DELETE FROM "references" WHERE id = $1`, [id]).catch(() => undefined);
  await s3Delete(`references/${id}/original.${ext}`).catch(() => undefined);
  await s3Delete(`references/${id}/display.jpg`).catch(() => undefined);
}
