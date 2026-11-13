import type { AppContext } from "./route-context.js";
import type { Request } from "express";
import { ApiError } from "./errors.js";
import { copy, FIELD_ERRORS } from "../shared/copy.js";
import { newId } from "./crypto.js";
import { sniffKind, cleanedPhotoCopy } from "./photos.js";
import type { AttachmentKind } from "../shared/enums.js";
import { rateLimit, recordRateEvent } from "./routes-member.js";
import { localTimeIn, zoneFor, instantZ } from "../shared/time.js";
import type { TimeZoneKey } from "../shared/enums.js";
import { DateTime } from "luxon";
import { memberCore } from "./memberships.js";

const MESSAGE_MAX = 10;

export type SendOutcome = { status: number; body: unknown };

/** Send a care message (member or staff reply) with an optional attachment. */
export async function sendMessage(
  ctx: AppContext,
  memberId: string,
  req: Request,
  fromRole: "member" | string,
  fromName: string,
  staffId?: string
): Promise<SendOutcome> {
  const core = await memberCore(ctx.db, memberId);
  if (!core) throw new ApiError(404, "not_found", copy("not_found"));
  const parts = readMultipart(req);
  const bodyText = typeof parts["body"] === "string" ? parts["body"] : "";
  const codePoints = [...bodyText].length;
  if (codePoints === 0) {
    throw new ApiError(422, "invalid", "Check the highlighted fields.", { body: FIELD_ERRORS.bodyRequired });
  }
  if (codePoints > 2000) {
    throw new ApiError(422, "invalid", "Check the highlighted fields.", { body: FIELD_ERRORS.bodyTooLong });
  }
  // A member's 11th message inside the window is refused before anything is written.
  if (fromRole === "member") {
    await memberMessageRateLimit(ctx, memberId);
  }
  const attachmentBytes = parts["attachment"] as Buffer | undefined;
  if (attachmentBytes !== undefined) {
    const kind = sniffKind(attachmentBytes);
    if (kind === "other") {
      throw new ApiError(422, "invalid", "Check the highlighted fields.", {
        attachment: FIELD_ERRORS.attachmentKind,
      });
    }
  }

  let attachmentId: string | null = null;
  if (attachmentBytes !== undefined) {
    const kind = sniffKind(attachmentBytes) as AttachmentKind;
    attachmentId = newId("att");
    const originalKey = ctx.store.attachmentOriginalKey(memberId, attachmentId);
    const putOriginal = await ctx.store.put(originalKey, attachmentBytes, contentTypeFor(kind));
    if (putOriginal === "unavailable") {
      throw new ApiError(503, "attachment_store_unavailable", copy("attachment_store_unavailable"));
    }
    let cleanKey: string | null = null;
    if (kind === "jpeg" || kind === "png") {
      const cleaned = await cleanedPhotoCopy(attachmentBytes);
      cleanKey = ctx.store.attachmentCleanKey(memberId, attachmentId);
      const putClean = await ctx.store.put(cleanKey, cleaned, "image/jpeg");
      if (putClean === "unavailable") {
        await ctx.store.delete(originalKey);
        throw new ApiError(503, "attachment_store_unavailable", copy("attachment_store_unavailable"));
      }
    }
    await ctx.db.exec(
      `INSERT INTO attachments (id, member_id, kind, size_bytes, object_key_original, object_key_clean)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [attachmentId, memberId, kind, attachmentBytes.length, originalKey, cleanKey]
    );
  }

  const id = newId("msg");
  await ctx.db.exec(
    `INSERT INTO messages (id, member_id, from_role, from_name, staff_id, body, attachment_id, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
    [id, memberId, fromRole, fromName, staffId ?? null, bodyText, attachmentId]
  );
  await ctx.db.exec(
    `INSERT INTO message_threads (member_id, state, last_message_at) VALUES ($1, 'open', now())
     ON CONFLICT (member_id) DO UPDATE SET state = 'open', last_message_at = now()`,
    [memberId]
  );
  if (fromRole === "member") {
    await recordRateEvent(ctx, memberId, "message");
  }
  const view = await messageView(ctx, id);
  return { status: 201, body: { message: view } };
}

export async function memberMessageRateLimit(
  ctx: AppContext,
  memberId: string
): Promise<void> {
  const { ok, retryAfter } = await rateLimit(
    ctx,
    memberId,
    "message",
    ctx.config.timers.messageRateWindowSeconds,
    MESSAGE_MAX
  );
  if (ok) return;
  const core = await memberCore(ctx.db, memberId);
  const timeZone = (core?.time_zone ?? "phoenix") as TimeZoneKey;
  const instant = new Date(Date.now() + retryAfter * 1000);
  const rounded = roundUpToMinute(instant);
  const message = copy("message_rate_limited", {
    "HH:MM": localTimeIn(rounded, zoneFor(timeZone)),
    city: cityOf(timeZone),
  });
  throw new ApiError(429, "rate_limited", message, undefined, retryAfter);
}

function roundUpToMinute(instant: Date): Date {
  const dt = DateTime.fromJSDate(instant, { zone: "utc" });
  if (dt.second === 0 && dt.millisecond === 0) return instant;
  return dt.plus({ minutes: 1 }).set({ second: 0, millisecond: 0 }).toJSDate();
}

function cityOf(timeZone: TimeZoneKey): string {
  const map: Record<TimeZoneKey, string> = {
    newYork: "New York",
    chicago: "Chicago",
    denver: "Denver",
    phoenix: "Phoenix",
    losAngeles: "Los Angeles",
  };
  return map[timeZone];
}

export async function messageView(ctx: AppContext, messageId: string) {
  const row = await ctx.db.one<{
    id: string;
    from_role: string;
    from_name: string;
    body: string;
    sent_at: Date;
    attachment_id: string | null;
  }>(
    `SELECT id, from_role, from_name, body, sent_at, attachment_id FROM messages WHERE id = $1`,
    [messageId]
  );
  if (!row) throw new ApiError(404, "not_found", copy("not_found"));
  let attachment = null;
  if (row.attachment_id) {
    const att = await ctx.db.one<{ id: string; kind: string; size_bytes: number }>(
      `SELECT id, kind, size_bytes FROM attachments WHERE id = $1`,
      [row.attachment_id]
    );
    if (att) attachment = { id: att.id, kind: att.kind, bytes: att.size_bytes };
  }
  return {
    id: row.id,
    from: { role: row.from_role, name: row.from_name },
    body: row.body,
    attachment,
    sentAt: instantZ(row.sent_at),
  };
}

export function markThreadHandled(ctx: AppContext, memberId: string): Promise<void> {
  return ctx.db
    .exec(
      `INSERT INTO message_threads (member_id, state, last_message_at) VALUES ($1, 'handled', now())
       ON CONFLICT (member_id) DO UPDATE SET state = 'handled'`,
      [memberId]
    )
    .then(() => undefined);
}

function contentTypeFor(kind: AttachmentKind): string {
  if (kind === "pdf") return "application/pdf";
  if (kind === "jpeg") return "image/jpeg";
  return "image/png";
}

type MultipartParts = Record<string, string | Buffer | undefined>;

/** Multipart body reader with per-file limits enforced while the part streams. */
export function readMultipart(req: Request): MultipartParts {
  const raw = (req as Request & { parsedParts?: MultipartParts }).parsedParts;
  if (raw) return raw;
  return {};
}
