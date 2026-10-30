import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { Note, NoteListItem, NoteSource, NoteStatus } from "../../shared/types.js";
import { errors, NO_SUCH_RECORD } from "../errors.js";
import { allowlistBody, bodyToText } from "../body.js";
import { route, type Route, type RequestContext } from "../router.js";
import { audit } from "../audit.js";
import { iso } from "./session.js";

const NOTE_SOURCES: NoteSource[] = ["support_ticket", "sales_call", "email"];
const MAX_BODY_BYTES = 200_000;

/**
 * Resolve a workspace-local wall-clock time to a UTC instant (DP-03). A local
 * time skipped by a daylight-saving jump moves forward by the size of the
 * jump; a local time that occurs twice uses the first occurrence.
 */
export function resolveLocalTime(
  local: string,
  timeZone: string,
  now: Date,
): { ok: boolean; instant: Date | null } {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (m === null) return { ok: false, instant: null };
  const [, y, mo, d, h, mi] = m;
  const parts = [y!, mo!, d!, h!, mi!].map((v) => Number.parseInt(v, 10));
  const [year, month, day, hour, minute] = parts as [number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return { ok: false, instant: null };
  }
  const isReal = (() => {
    const probe = new Date(Date.UTC(year, month - 1, day));
    return (
      probe.getUTCFullYear() === year &&
      probe.getUTCMonth() === month - 1 &&
      probe.getUTCDate() === day
    );
  })();
  if (!isReal) return { ok: false, instant: null };

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  /** The zone's offset east of UTC in minutes at the given instant. */
  const offsetAt = (instant: number): number => {
    const fields = fmt.formatToParts(new Date(instant));
    const get = (t: string): number =>
      Number.parseInt(fields.find((p) => p.type === t)?.value ?? "0", 10);
    const asUTC = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour") % 24,
      get("minute"),
      get("second"),
    );
    return Math.round((asUTC - instant) / 60000);
  };
  /** The wall clock read back from an instant, in the zone's format. */
  const readback = (instant: number): string => {
    const fields = fmt.formatToParts(new Date(instant));
    const get = (t: string): string => fields.find((p) => p.type === t)?.value ?? "00";
    const hour = String(Number.parseInt(get("hour"), 10) % 24).padStart(2, "0");
    return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")}:${get("second")}`;
  };

  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  const want = `${y}-${mo}-${d} ${h}:${mi}:00`;
  const offsetBefore = offsetAt(naive - 6 * 3600 * 1000);
  const offsetAfter = offsetAt(naive + 6 * 3600 * 1000);

  if (offsetBefore > offsetAfter) {
    // The local time occurs twice; the first occurrence is used.
    const instant = naive - offsetBefore * 60000;
    return { ok: true, instant: new Date(instant) };
  }
  if (offsetBefore === offsetAfter) {
    const instant = naive - offsetBefore * 60000;
    if (readback(instant) === want) return { ok: true, instant: new Date(instant) };
    return { ok: false, instant: null };
  }
  // A jump forward: the time may be skipped. Try the later offset first.
  const instant = naive - offsetAfter * 60000;
  if (readback(instant) === want) {
    return { ok: true, instant: new Date(instant) };
  }
  // Skipped: move the wall clock forward by the size of the jump. The moved
  // wall clock lies after the transition, so the later offset applies.
  const gap = offsetAfter - offsetBefore;
  const movedNaive = naive + gap * 60000;
  const movedUtc = new Date(movedNaive);
  const pad = (n: number): string => String(n).padStart(2, "0");
  const expectedMoved = `${movedUtc.getUTCFullYear()}-${pad(movedUtc.getUTCMonth() + 1)}-${pad(movedUtc.getUTCDate())} ${pad(movedUtc.getUTCHours())}:${pad(movedUtc.getUTCMinutes())}:00`;
  const movedInstant = movedNaive - offsetAfter * 60000;
  if (readback(movedInstant) === expectedMoved) {
    return { ok: true, instant: new Date(movedInstant) };
  }
  return { ok: false, instant: null };
}

export const notesRoutes: Route[] = [
  {
    pattern: route("notes"),
    methods: ["GET"],
    roles: "any",
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const statusParam = ctx.query.get("status") ?? "unprocessed";
      if (!["unprocessed", "snoozed", "processed"].includes(statusParam)) {
        throw errors.validationFailed({ status: "Pick a valid status." });
      }
      const status = statusParam as NoteStatus;
      const limitRaw = ctx.query.get("limit") ?? "50";
      const limit = Number.parseInt(limitRaw, 10);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || limitRaw.includes(".")) {
        throw errors.validationFailed({ limit: "Limit must be a whole number from 1 to 100." });
      }
      const cursor = ctx.query.get("cursor");
      let before: Date | null = null;
      let beforeId: string | null = null;
      if (cursor !== null) {
        const decoded = decodeCursor(cursor);
        if (decoded === null || decoded.status !== status) {
          throw errors.validationFailed({ cursor: "That cursor does not match this filter." });
        }
        before = decoded.createdAt;
        beforeId = decoded.id;
      }

      const client = await ctx.pool.connect();
      try {
        const rows = await queryPage(client, workspaceId, status, limit, before, beforeId);
        const notes: NoteListItem[] = rows.map(noteListItem);
        const nextCursor =
          rows.length === limit && rows.length > 0 ? encodeCursor(status, rows[rows.length - 1]!) : null;
        const counts = await statusCounts(client, workspaceId);
        return { status: 200, body: { notes, nextCursor, counts } };
      } finally {
        client.release();
      }
    },
  },
  {
    pattern: route("notes"),
    methods: ["POST"],
    roles: "any",
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const title = asString(ctx.body.title);
      const bodyHtml = asString(ctx.body.body);
      const source = asString(ctx.body.source);
      const contactId = ctx.body.contactId;

      const fields: Record<string, string> = {};
      if (title === null || title.trim().length < 1 || title.length > 200) {
        fields.title = "Add a title.";
      }
      const reduced = title !== null && bodyHtml !== null ? allowlistBody(bodyHtml) : "";
      const text = bodyToText(reduced);
      if (bodyHtml === null || text.length === 0) {
        fields.body = "Add the note text.";
      } else if (Buffer.byteLength(reduced, "utf-8") > MAX_BODY_BYTES) {
        fields.body = "The note text is too long.";
      }
      if (source === null || !NOTE_SOURCES.includes(source as NoteSource)) {
        fields.source = "Pick a source.";
      }
      let contactUuid: string | null = null;
      if (contactId !== undefined && contactId !== null) {
        if (typeof contactId !== "string") {
          fields.contactId = NO_SUCH_RECORD;
        } else {
          contactUuid = contactId;
        }
      }
      if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

      const client = await ctx.pool.connect();
      let note: Note;
      try {
        await client.query("BEGIN");
        if (contactUuid !== null) {
          const found = await client.query("SELECT id FROM contacts WHERE id = $1 AND workspace_id = $2", [
            contactUuid,
            workspaceId,
          ]);
          if (found.rowCount === 0) {
            throw errors.validationFailed({ contactId: NO_SUCH_RECORD });
          }
        }
        const id = randomUUID();
        await client.query(
          `INSERT INTO notes (id, workspace_id, title, body, text, source, status, contact_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'unprocessed', $7, now())`,
          [id, workspaceId, title!.trim(), reduced, text, source, contactUuid],
        );
        await audit(client, workspaceId, ctx.member!.id, "create_note", "note", id, { title });
        await client.query("COMMIT");
        note = await loadNote(client, id, workspaceId);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
        throw err;
      }
      client.release();
      return { status: 201, body: { note } };
    },
  },
  {
    pattern: route("notes/:id"),
    methods: ["GET"],
    roles: "any",
    handler: async (ctx: RequestContext) => {
      const client = await ctx.pool.connect();
      try {
        const note = await loadNote(client, ctx.params.id!, ctx.member!.workspaceId);
        return { status: 200, body: { note } };
      } finally {
        client.release();
      }
    },
  },
  {
    pattern: route("notes/:id"),
    methods: ["PATCH"],
    roles: ["head_of_product", "product_manager"],
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const id = ctx.params.id!;
      const title = asString(ctx.body.title);
      const bodyHtml = asString(ctx.body.body);
      const contactId = ctx.body.contactId;

      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        const existing = await client.query<NoteRecord>(
          "SELECT id, title, body, text, contact_id FROM notes WHERE id = $1 AND workspace_id = $2",
          [id, workspaceId],
        );
        const noteRow = existing.rows[0];
        if (noteRow === undefined) throw errors.notFound();

        const fields: Record<string, string> = {};
        if (title !== null && (title.trim().length < 1 || title.length > 200)) {
          fields.title = "Add a title.";
        }
        let reduced: string | null = null;
        let text: string | null = null;
        if (bodyHtml !== null) {
          reduced = allowlistBody(bodyHtml);
          text = bodyToText(reduced);
          if (text.length === 0) {
            fields.body = "Add the note text.";
          } else if (Buffer.byteLength(reduced, "utf-8") > MAX_BODY_BYTES) {
            fields.body = "The note text is too long.";
          }
        }
        let contactUuid: string | null | undefined = undefined;
        if (contactId !== undefined) {
          if (contactId === null) {
            contactUuid = null;
          } else if (typeof contactId !== "string") {
            fields.contactId = NO_SUCH_RECORD;
          } else {
            contactUuid = contactId;
          }
        }
        if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

        if (contactUuid !== undefined && contactUuid !== null) {
          const found = await client.query("SELECT id FROM contacts WHERE id = $1 AND workspace_id = $2", [
            contactUuid,
            workspaceId,
          ]);
          if (found.rowCount === 0) throw errors.validationFailed({ contactId: NO_SUCH_RECORD });
        }

        if (text !== null && reduced !== null) {
          // Re-anchor the highlights (DP-11).
          const insights = await client.query<{
            id: string;
            start_offset: number;
            end_offset: number;
            quote: string;
          }>(
            "SELECT id, start_offset, end_offset, quote FROM insights WHERE note_id = $1 ORDER BY start_offset",
            [id],
          );
          const updates: Array<{ id: string; start: number; end: number }> = [];
          const lost: string[] = [];
          for (const insight of insights.rows) {
            const slice = text.slice(insight.start_offset, insight.end_offset);
            if (slice === insight.quote) {
              continue;
            }
            const occurrence = closestOccurrence(text, insight.quote, insight.start_offset);
            if (occurrence === null) {
              lost.push(insight.id);
            } else {
              updates.push({ id: insight.id, start: occurrence, end: occurrence + insight.quote.length });
            }
          }
          if (lost.length > 0) {
            throw errors.highlightConflict(lost);
          }
          for (const u of updates) {
            await client.query(
              "UPDATE insights SET start_offset = $1, end_offset = $2 WHERE id = $3",
              [u.start, u.end, u.id],
            );
          }
        }

        const newTitle = title === null ? noteRow.title : title.trim();
        await client.query(
          "UPDATE notes SET title = $1, body = COALESCE($2, body), text = COALESCE($3, text), contact_id = COALESCE($4, contact_id) WHERE id = $5",
          [
            newTitle,
            reduced,
            text,
            contactUuid === undefined ? null : contactUuid,
            id,
          ],
        );
        if (contactUuid === null) {
          await client.query("UPDATE notes SET contact_id = NULL WHERE id = $1", [id]);
        }
        await audit(client, workspaceId, ctx.member!.id, "edit_note", "note", id, null);
        await client.query("COMMIT");
        const note = await loadNote(client, id, workspaceId);
        return { status: 200, body: { note } };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  },
];

export interface NoteRecord {
  id: string;
  title: string;
  body: string;
  text: string;
  source: NoteSource;
  status: NoteStatus;
  snoozed_until: Date | null;
  received_on: string | null;
  created_at: Date;
  contact_id: string | null;
}

interface NoteJoinRow extends NoteRecord {
  contact_name: string | null;
  contact_email: string | null;
  company_id: string | null;
  company_name: string | null;
}

export async function loadNote(client: PoolClient, id: string, workspaceId: string): Promise<Note> {
  const result = await client.query<NoteJoinRow>(
    `SELECT n.id, n.title, n.body, n.text, n.source, n.status, n.snoozed_until, n.received_on::text AS received_on,
            n.created_at, n.contact_id, c.name AS contact_name, c.email AS contact_email,
            co.id AS company_id, co.name AS company_name
     FROM notes n
     LEFT JOIN contacts c ON c.id = n.contact_id
     LEFT JOIN companies co ON co.id = c.company_id
     WHERE n.id = $1 AND n.workspace_id = $2`,
    [id, workspaceId],
  );
  const row = result.rows[0];
  if (row === undefined) throw errors.notFound();
  const attachments = await client.query<{
    id: string;
    filename: string;
    content_type: string;
    size: string | number;
    status: "available" | "pending";
  }>(
    "SELECT id, filename, content_type, size, status FROM attachments WHERE note_id = $1 ORDER BY created_at",
    [id],
  );
  const insights = await client.query<{
    id: string;
    note_id: string;
    feature_id: string;
    start_offset: number;
    end_offset: number;
    quote: string;
    importance: "nice_to_have" | "important" | "critical";
    feature_name: string;
    company_id: string | null;
  }>(
    `SELECT i.id, i.note_id, i.feature_id, i.start_offset, i.end_offset, i.quote, i.importance,
            f.name AS feature_name, ct.company_id
     FROM insights i
     JOIN features f ON f.id = i.feature_id
     LEFT JOIN notes n2 ON n2.id = i.note_id
     LEFT JOIN contacts ct ON ct.id = n2.contact_id
     WHERE i.note_id = $1`,
    [id],
  );
  const now = Date.now();
  let status = row.status;
  let snoozedUntil = row.snoozed_until;
  if (status === "snoozed" && snoozedUntil !== null && snoozedUntil.getTime() <= now) {
    status = "unprocessed";
    snoozedUntil = null;
  }
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    text: row.text,
    source: row.source,
    status,
    snoozedUntil: snoozedUntil === null ? null : iso(snoozedUntil),
    receivedOn: row.received_on,
    createdAt: iso(row.created_at),
    contact:
      row.contact_id === null || row.contact_name === null || row.contact_email === null
        ? null
        : { id: row.contact_id, name: row.contact_name, email: row.contact_email },
    company:
      row.company_id === null || row.company_name === null
        ? null
        : { id: row.company_id, name: row.company_name },
    attachments: attachments.rows.map((a) => ({
      id: a.id,
      filename: a.filename,
      contentType: a.content_type,
      size: typeof a.size === "string" ? Number.parseInt(a.size, 10) : a.size,
      status: a.status,
    })),
    insights: insights.rows.map((i) => ({
      id: i.id,
      noteId: i.note_id,
      featureId: i.feature_id,
      featureName: i.feature_name,
      start: i.start_offset,
      end: i.end_offset,
      quote: i.quote,
      importance: i.importance,
      companyId: i.company_id,
    })),
  };
}

function closestOccurrence(text: string, quote: string, oldStart: number): number | null {
  const first = text.indexOf(quote);
  if (first === -1) return null;
  let best = first;
  let bestDistance = Math.abs(first - oldStart);
  let idx = first;
  while (true) {
    const next = text.indexOf(quote, idx + 1);
    if (next === -1) break;
    const distance = Math.abs(next - oldStart);
    if (distance < bestDistance) {
      best = next;
      bestDistance = distance;
    }
    idx = next;
  }
  return best;
}

interface PageRow extends NoteRecord {
  contact_name: string | null;
  company_name: string | null;
  insight_count: number;
}

async function queryPage(
  client: PoolClient,
  workspaceId: string,
  status: NoteStatus,
  limit: number,
  before: Date | null,
  beforeId: string | null,
): Promise<PageRow[]> {
  // A snooze that has ended returns the note to unprocessed (DP-03).
  if (status === "unprocessed") {
    await client.query(
      `UPDATE notes SET status = 'unprocessed', snoozed_until = NULL
       WHERE workspace_id = $1 AND status = 'snoozed' AND snoozed_until <= now()`,
      [workspaceId],
    );
  }
  const effectiveStatus = status === "snoozed" ? "snoozed" : status;
  const params: unknown[] = [workspaceId, effectiveStatus];
  let predicate = "";
  if (before !== null && beforeId !== null) {
    params.push(before, beforeId);
    predicate = " AND (n.created_at < $3 OR (n.created_at = $3 AND n.id < $4))";
  }
  const result = await client.query<PageRow>(
    `SELECT n.id, n.title, n.source, n.status, n.snoozed_until, n.created_at, n.contact_id,
            c.name AS contact_name, co.name AS company_name,
            (SELECT count(*)::int FROM insights i WHERE i.note_id = n.id) AS insight_count
     FROM notes n
     LEFT JOIN contacts c ON c.id = n.contact_id
     LEFT JOIN companies co ON co.id = c.company_id
     WHERE n.workspace_id = $1 AND n.status = $2${predicate}
     ORDER BY n.created_at DESC, n.id DESC
     LIMIT ${limit}`,
    params,
  );
  return result.rows;
}

function noteListItem(row: PageRow): NoteListItem {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    status: row.status,
    snoozedUntil: row.snoozed_until === null ? null : iso(row.snoozed_until),
    contactName: row.contact_name,
    companyName: row.company_name,
    createdAt: iso(row.created_at),
    insightCount: row.insight_count,
  };
}

async function statusCounts(
  client: PoolClient,
  workspaceId: string,
): Promise<{ unprocessed: number; snoozed: number; processed: number }> {
  await client.query(
    `UPDATE notes SET status = 'unprocessed', snoozed_until = NULL
     WHERE workspace_id = $1 AND status = 'snoozed' AND snoozed_until <= now()`,
    [workspaceId],
  );
  const result = await client.query<{ status: NoteStatus; count: number }>(
    "SELECT status, count(*)::int AS count FROM notes WHERE workspace_id = $1 GROUP BY status",
    [workspaceId],
  );
  const counts = { unprocessed: 0, snoozed: 0, processed: 0 };
  for (const row of result.rows) {
    counts[row.status] = row.count;
  }
  return counts;
}

/**
 * The cursor encodes the last note's createdAt and id together with the
 * status, bound to its filter (DP-45).
 */
function encodeCursor(status: NoteStatus, row: PageRow): string {
  const payload = `${iso(row.created_at)}|${row.id}|${status}`;
  return Buffer.from(payload, "utf-8").toString("base64url");
}

interface DecodedCursor {
  createdAt: Date;
  id: string;
  status: NoteStatus;
}

export function decodeCursor(cursor: string): DecodedCursor | null {
  try {
    const payload = Buffer.from(cursor, "base64url").toString("utf-8");
    const [createdAt, id, status] = payload.split("|");
    if (createdAt === undefined || id === undefined || status === undefined) return null;
    if (!["unprocessed", "snoozed", "processed"].includes(status)) return null;
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return null;
    return { createdAt: date, id, status: status as NoteStatus };
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value;
}

