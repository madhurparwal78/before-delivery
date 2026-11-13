import { createHash, randomBytes } from "node:crypto";
import type { Material, PrepLink } from "../../shared/api.js";
import { isEnded } from "../../shared/status.js";
import { isoAt } from "../agency.js";
import { config } from "../config.js";
import { one, transaction } from "../db.js";
import { apiErrors } from "../errors.js";
import { type Reply, created, hashToken, route } from "../http.js";
import { FIELD_MESSAGES } from "../messages.js";
import { MAX_FILES_PER_BOOKING, UPLOAD_LIMIT_BYTES, prepAccessOpen } from "../prep.js";
import { loadBooking, statusOf } from "../bookings.js";
import { attachmentDisposition, detectKind, displayName } from "../services/fileKind.js";
import { parseFilePart } from "../services/multipart.js";
import { StorageUnavailable, deleteObject, getObjectStream, putObject } from "../services/s3.js";
import { parseId, requireRole, visibleBooking } from "./bookings.js";

interface MaterialRecord {
  id: number;
  name: string;
  size_bytes: number;
  content_type: string;
  sha256: string;
  uploaded_at: Date;
}

const materialJson = (record: MaterialRecord): Material => ({
  id: String(record.id),
  name: record.name,
  size_bytes: record.size_bytes,
  content_type: record.content_type,
  sha256: record.sha256,
  uploaded_at: isoAt(record.uploaded_at.getTime()),
});

export function registerMaterialRoutes(): void {
  route(
    "POST",
    "/api/bookings/:id/materials",
    async (ctx): Promise<Reply> => {
      const visible = await visibleBooking(ctx, ctx.params["id"] ?? "");
      requireRole(ctx, "requester", "coordinator");
      const part = parseFilePart(ctx.body, String(ctx.headers["content-type"] ?? ""));
      if (part === null || part.data.length === 0) throw apiErrors.validation({ file: FIELD_MESSAGES.file });
      if (part.data.length > UPLOAD_LIMIT_BYTES) throw apiErrors.payloadTooLarge();
      const kind = detectKind(part.data);
      if (kind === null) throw apiErrors.unsupportedType();

      const bookingId = visible.row.id;
      const key = `prep/${bookingId}/${randomBytes(16).toString("hex")}`;
      let stored = false;
      try {
        const record = await transaction(async (client) => {
          await client.query("SELECT pg_advisory_xact_lock(4174, $1)", [bookingId]);
          const count = await one<{ count: number }>(client, "SELECT count(*)::int AS count FROM materials WHERE booking_id = $1", [bookingId]);
          if ((count?.count ?? 0) >= MAX_FILES_PER_BOOKING) throw apiErrors.validation({ file: FIELD_MESSAGES.fileFull });
          const current = await loadBooking(client, bookingId);
          if (current === null) throw apiErrors.notFound();
          if (isEnded(current.row.phase)) throw apiErrors.invalidTransition(statusOf(current));
          await putObject(key, part.data, kind);
          stored = true;
          const inserted = await one<MaterialRecord>(
            client,
            `INSERT INTO materials (booking_id, name, size_bytes, content_type, sha256, object_key)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, size_bytes, content_type, sha256, uploaded_at`,
            [bookingId, displayName(part.filename), part.data.length, kind, createHash("sha256").update(part.data).digest("hex"), key],
          );
          if (inserted === null) throw new Error("the material record was not stored");
          return inserted;
        });
        return created(materialJson(record));
      } catch (error) {
        if (stored) await deleteObject(key).catch(() => undefined);
        throw error instanceof StorageUnavailable ? apiErrors.storageUnavailable() : error;
      }
    },
    { transactional: false, idempotent: false },
  );

  route("POST", "/api/bookings/:id/materials/:mid/link", async (ctx): Promise<Reply> => {
    const data = await visibleBooking(ctx, ctx.params["id"] ?? "");
    const materialId = parseId(ctx.params["mid"] ?? "");
    const material = await one<{ id: number }>(ctx.db, "SELECT id FROM materials WHERE id = $1 AND booking_id = $2", [materialId, data.row.id]);
    if (material === null) throw apiErrors.notFound();
    requireRole(ctx, "interpreter");
    if (!prepAccessOpen(data, ctx.user.id, ctx.nowMs)) throw apiErrors.accessEnded();
    const token = randomBytes(24).toString("hex");
    const expiresAt = new Date(ctx.nowMs + config.prepLinkTtlSeconds * 1000);
    await ctx.db.query(
      "INSERT INTO prep_links (token_hash, material_id, booking_id, interpreter_id, expires_at) VALUES ($1, $2, $3, $4, $5)",
      [hashToken(token), materialId, data.row.id, ctx.user.id, expiresAt],
    );
    const link: PrepLink = { url: `/api/prep/${token}`, expires_at: isoAt(expiresAt.getTime()) };
    return created(link);
  });

  route(
    "GET",
    "/api/prep/:token",
    async (ctx): Promise<Reply> => {
      const link = await one<{ material_id: number; booking_id: number; interpreter_id: string; expires_at: Date }>(
        ctx.db,
        "SELECT material_id, booking_id, interpreter_id, expires_at FROM prep_links WHERE token_hash = $1",
        [hashToken(ctx.params["token"] ?? "")],
      );
      if (link === null || link.interpreter_id !== ctx.user.id) throw apiErrors.notFound();
      const data = await loadBooking(ctx.db, link.booking_id);
      if (data === null || !prepAccessOpen(data, ctx.user.id, ctx.nowMs)) throw apiErrors.accessEnded();
      if (ctx.nowMs >= link.expires_at.getTime()) throw apiErrors.linkExpired();
      const material = await one<{ name: string; content_type: string; object_key: string; size_bytes: number }>(
        ctx.db,
        "SELECT name, content_type, object_key, size_bytes FROM materials WHERE id = $1",
        [link.material_id],
      );
      if (material === null) throw apiErrors.notFound();
      try {
        const stream = await getObjectStream(material.object_key);
        return { status: 200, stream, length: material.size_bytes, headers: { "content-type": material.content_type, "content-disposition": attachmentDisposition(material.name) } };
      } catch (error) {
        throw error instanceof StorageUnavailable ? apiErrors.storageUnavailable() : error;
      }
    },
    { transactional: false },
  );
}
