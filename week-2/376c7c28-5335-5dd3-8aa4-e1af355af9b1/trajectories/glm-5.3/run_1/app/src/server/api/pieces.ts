import { randomUUID } from "node:crypto";
import { newId } from "../config";
import { now } from "../clock";
import { pool, q, one, tx } from "../db";
import { lockName } from "../lockname";
import { ApiError, conflict, validation, fieldMsg } from "../errors";
import type { Ctx, Person, Studio } from "../http/context";
import { sendJson } from "../http/context";
import type { PieceRow } from "../types";
import { PIECE_STATUSES } from "../types";
import { checkInRefusal } from "../domain/piecestates";
import { passportBody, ticketBody, ticketById } from "./bodies";
import { scheduleInForce } from "./studio";
import { roundDims, cubicEighths } from "../quote";
import { checkDimension, checkTitle } from "./validate";
import { publish } from "../events";
import { dayStart, addDays } from "../studiodays";
import { putObject, deleteObject, getObject, StorageUnavailable } from "../services/s3";
import { parseMultipartFile } from "../http/body";

export async function postPiece(ctx: Ctx): Promise<void> {
  const person = ctx.person as Person;
  const studio = ctx.studio as Studio;
  const title = checkTitle(ctx.body.title);
  const clayBodyId = typeof ctx.body.clay_body_id === "string" ? ctx.body.clay_body_id : "";
  const clayBody = await one<{ id: string }>(pool, "SELECT id FROM clay_bodies WHERE studio_id = $1 AND id = $2", [studio.id, clayBodyId]);
  if (!clayBody) throw validation({ clay_body_id: fieldMsg.clayBody });
  const [lengthIn, widthIn, heightIn] = checkDimension(["length_in", "width_in", "height_in"], ctx.body);
  const schedule = await scheduleInForce(studio.id, studio.time_zone);
  if (!schedule) throw new ApiError(409, "no_rates", "No rate schedule is in force.");
  const membership = (person.membership as "member" | "drop_off") ?? "member";
  const bisqueRate = membership === "member" ? schedule.member_bisque_cents : schedule.dropoff_bisque_cents;
  const glazeRate = membership === "member" ? schedule.member_glaze_cents : schedule.dropoff_glaze_cents;
  const rounded = roundDims(lengthIn, widthIn, heightIn);
  const cubicE = cubicEighths(rounded);
  const piece = await tx(async (client) => {
    const id = newId();
    const rows = await q<PieceRow>(
      client,
      `INSERT INTO pieces (id, studio_id, owner_id, title, clay_body_id, status, length_in, width_in, height_in,
                           rounded_l_half, rounded_w_half, rounded_h_half, cubic_eighths, membership,
                           bisque_rate_cents, glaze_rate_cents, rates_effective_from, quoted_at, created_at)
       VALUES ($1,$2,$3,$4,$5,'logged',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [
        id, studio.id, person.id, title, clayBodyId, lengthIn, widthIn, heightIn,
        rounded.lengthHalf, rounded.widthHalf, rounded.heightHalf, cubicE, membership,
        bisqueRate, glazeRate, schedule.effective_from, now(), now(),
      ],
    );
    const piece = rows[0];
    await client.query("INSERT INTO piece_history (id, piece_id, status, at) VALUES ($1,$2,'logged',$3)", [newId(), id, now()]);
    return piece;
  });
  await publish(pool, "piece", piece.id, studio.id, { memberId: person.id });
  sendJson(ctx.res, 201, await passportBody(pool, piece));
}

export async function listPieces(ctx: Ctx): Promise<void> {
  const person = ctx.person as Person;
  const studio = ctx.studio as Studio;
  if (person.role === "member") {
    const pieces = await q<PieceRow>(pool, "SELECT * FROM pieces WHERE owner_id = $1 ORDER BY created_at DESC, id", [person.id]);
    const out = [];
    for (const piece of pieces) out.push(await passportBody(pool, piece));
    sendJson(ctx.res, 200, out);
    return;
  }
  // Staff tickets, never a member's email, balance or card status.
  const statusParam = ctx.query.get("status");
  const unplacedParam = ctx.query.get("unplaced");
  const errors: Record<string, string> = {};
  if (statusParam !== null && !PIECE_STATUSES.includes(statusParam as never)) {
    errors.status = fieldMsg.pieceFilter;
  }
  if (unplacedParam !== null && unplacedParam !== "1") {
    errors.unplaced = fieldMsg.unplacedFilter;
  }
  if (Object.keys(errors).length > 0) throw validation(errors);
  const where: string[] = ["p.studio_id = $1"];
  const params: unknown[] = [studio.id];
  if (statusParam !== null) {
    params.push(statusParam);
    where.push(`p.status = $${params.length}`);
  }
  // Staff listings never include logged pieces of inactive members.
  where.push(`NOT (p.status = 'logged' AND NOT o.active)`);
  if (unplacedParam === "1") {
    where.push(`NOT EXISTS (
      SELECT 1 FROM placements pl JOIN loads l ON l.id = pl.load_id
       WHERE pl.piece_id = p.id AND l.status IN ('planning','loaded','firing','cooling'))`);
  }
  const rows = await q<{ id: string }>(
    pool,
    `SELECT p.id FROM pieces p JOIN people o ON o.id = p.owner_id
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE(p.waiting_since, p.created_at), p.id`,
    params,
  );
  const out = [];
  for (const row of rows) {
    const t = await ticketById(pool, row.id);
    if (t) out.push(ticketBody(t));
  }
  sendJson(ctx.res, 200, out);
}

async function loadPieceForViewer(ctx: Ctx): Promise<PieceRow> {
  const person = ctx.person as Person;
  const studio = ctx.studio as Studio;
  const piece = await one<PieceRow>(pool, "SELECT * FROM pieces WHERE id = $1 AND studio_id = $2", [ctx.params.id, studio.id]);
  if (!piece) throw new ApiError(404, "not_found", "Not found.");
  if (person.role === "member" && piece.owner_id !== person.id) {
    // A member reaches only their own pieces.
    throw new ApiError(404, "not_found", "Not found.");
  }
  return piece;
}

export async function getPiece(ctx: Ctx): Promise<void> {
  const piece = await loadPieceForViewer(ctx);
  sendJson(ctx.res, 200, await passportBody(pool, piece));
}

// Photo type is judged by leading bytes only.
export function sniffImage(buf: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return "image/png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export async function putPhoto(ctx: Ctx): Promise<void> {
  const person = ctx.person as Person;
  const studio = ctx.studio as Studio;
  const piece = await loadPieceForViewer(ctx);
  if (person.role !== "member" || piece.owner_id !== person.id) {
    throw new ApiError(403, "forbidden", "Only the owning member may add a photo.");
  }
  if (piece.status !== "logged") {
    throw conflict("photo_locked", "A piece can be photographed before check-in.");
  }
  const boundaryMatch = (ctx.req.headers["content-type"] ?? "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const parsed = parseMultipartFile(ctx.rawBody, boundaryMatch ? (boundaryMatch[1] ?? boundaryMatch[2]).trim() : null, "photo");
  if (!parsed.fileField) {
    throw new ApiError(415, "unsupported_photo", "Use a JPEG, PNG or WebP photo.");
  }
  const file = parsed.fileField;
  if (file.length > 5000000) {
    throw new ApiError(413, "photo_too_large", "Photo is larger than 5,000,000 bytes.");
  }
  const contentType = sniffImage(file);
  if (!contentType) {
    throw new ApiError(415, "unsupported_photo", "Use a JPEG, PNG or WebP photo.");
  }
  const ext = contentType === "image/jpeg" ? "jpg" : contentType === "image/png" ? "png" : "webp";
  const key = `studios/${studio.id}/pieces/${piece.id}/${randomUUID()}.${ext}`;
  try {
    await putObject(key, file, contentType);
  } catch {
    throw new ApiError(503, "storage_unavailable", "Photo storage is unavailable.");
  }
  // One stored photo object per piece: the upload, pointer swap and old delete are
  // applied one after another for the piece.
  let previous: string | null = null;
  try {
    previous = await tx(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.photo(piece.id)]);
      const fresh = await one<PieceRow>(client, "SELECT * FROM pieces WHERE id = $1", [piece.id]);
      if (!fresh) throw new ApiError(404, "not_found", "Not found.");
      if (fresh.status !== "logged") {
        // A check-in committed while we were uploading.
        throw conflict("photo_locked", "A piece can be photographed before check-in.");
      }
      await client.query("UPDATE pieces SET photo_key = $1, photo_content_type = $2 WHERE id = $3", [key, contentType, piece.id]);
      return fresh.photo_key;
    });
  } catch (e) {
    // The stored object is not the piece's photo; leave exactly none behind.
    void deleteObject(key).catch(() => {});
    throw e;
  }
  if (previous) {
    void deleteObject(previous).catch(() => {});
  }
  await publish(pool, "piece", piece.id, studio.id, { memberId: person.id });
  sendJson(ctx.res, 200, { photo_url: `/api/pieces/${piece.id}/photo` });
}

export async function getPhoto(ctx: Ctx): Promise<void> {
  const piece = await loadPieceForViewer(ctx);
  if (!piece.photo_key) {
    throw new ApiError(404, "not_found", "Not found.");
  }
  let bytes: Buffer;
  try {
    bytes = await getObject(piece.photo_key);
  } catch {
    throw new ApiError(503, "storage_unavailable", "Photo storage is unavailable.");
  }
  ctx.res.writeHead(200, {
    "Content-Type": piece.photo_content_type ?? "application/octet-stream",
    "Content-Length": bytes.length,
    "Cache-Control": "private, no-store",
  });
  ctx.res.end(bytes);
}

export async function checkIn(ctx: Ctx): Promise<void> {
  const person = ctx.person as Person;
  const studio = ctx.studio as Studio;
  const piece = await loadPieceForViewer(ctx);
  const owner = await one<{ active: boolean }>(pool, "SELECT active FROM people WHERE id = $1", [piece.owner_id]);
  const refusal = checkInRefusal(piece.status, { ownerActive: owner?.active ?? false, hasPhoto: piece.photo_key !== null });
  if (refusal === "member_inactive") throw conflict("member_inactive", `${piece.title} belongs to an inactive member.`);
  if (refusal === "photo_required") throw conflict("photo_required", `${piece.title} needs an intake photo before check-in.`);
  if (refusal === "illegal_transition") throw conflict("illegal_transition", `${piece.title} can't be checked in now.`);
  const target = piece.status === "logged" ? "waiting_bisque" : "waiting_glaze";
  const updated = await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.piece(piece.id)]);
    const rows = await one<PieceRow>(
      client,
      "UPDATE pieces SET status = $1, waiting_since = $2 WHERE id = $3 AND status = $4 RETURNING *",
      [target, now(), piece.id, piece.status],
    );
    if (!rows) return null;
    await client.query("INSERT INTO piece_history (id, piece_id, status, at) VALUES ($1,$2,$3,$4)", [newId(), piece.id, target, now()]);
    return rows;
  });
  if (!updated) throw conflict("illegal_transition", `${piece.title} can't be checked in now.`);
  await publish(pool, "piece", piece.id, studio.id, { memberId: updated.owner_id });
  sendJson(ctx.res, 200, await passportBody(pool, updated));
}

export async function collect(ctx: Ctx): Promise<void> {
  const studio = ctx.studio as Studio;
  const piece = await loadPieceForViewer(ctx);
  const updated = await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.piece(piece.id)]);
    const rows = await one<PieceRow>(
      client,
      "UPDATE pieces SET status = 'collected' WHERE id = $1 AND status = 'ready_for_pickup' RETURNING *",
      [piece.id],
    );
    if (!rows) return null;
    await client.query("INSERT INTO piece_history (id, piece_id, status, at) VALUES ($1,$2,'collected',$3)", [newId(), piece.id, now()]);
    return rows;
  });
  if (!updated) throw conflict("illegal_transition", `${piece.title} can't be collected now.`);
  await publish(pool, "piece", piece.id, studio.id, { memberId: updated.owner_id });
  sendJson(ctx.res, 200, await passportBody(pool, updated));
}

export async function markUncollected(ctx: Ctx): Promise<void> {
  const studio = ctx.studio as Studio;
  const person = ctx.person as Person;
  if (person.role !== "owner") {
    // Only the studio owner may mark a piece uncollected (role check after visibility).
    throw new ApiError(403, "forbidden", "Only the studio owner may do that.");
  }
  const piece = await loadPieceForViewer(ctx);
  if (piece.status !== "ready_for_pickup") {
    throw conflict("illegal_transition", `${piece.title} can't be marked uncollected now.`);
  }
  if (!piece.pickup_deadline) {
    throw conflict("illegal_transition", `${piece.title} can't be marked uncollected now.`);
  }
  // Only once the deadline day has ended in the studio's time zone.
  const deadlineEnd = dayStart(addDays(piece.pickup_deadline, 1), studio.time_zone);
  if (now().getTime() < deadlineEnd) {
    throw conflict("pickup_not_due", `${piece.title} can still be collected until the end of ${piece.pickup_deadline}.`);
  }
  const updated = await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.piece(piece.id)]);
    const rows = await one<PieceRow>(
      client,
      "UPDATE pieces SET status = 'uncollected' WHERE id = $1 AND status = 'ready_for_pickup' RETURNING *",
      [piece.id],
    );
    if (!rows) return null;
    await client.query("INSERT INTO piece_history (id, piece_id, status, at) VALUES ($1,$2,'uncollected',$3)", [newId(), piece.id, now()]);
    return rows;
  });
  if (!updated) throw conflict("illegal_transition", `${piece.title} can't be marked uncollected now.`);
  await publish(pool, "piece", piece.id, studio.id, { memberId: updated.owner_id });
  sendJson(ctx.res, 200, await passportBody(pool, updated));
}
