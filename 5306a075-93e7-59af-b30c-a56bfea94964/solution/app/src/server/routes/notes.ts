import type { NoteListItem, NoteSource } from "../../shared/api.js";
import { noteTransition, type NoteStatus } from "../../shared/lifecycles.js";
import { db, type Queryable } from "../db.js";
import { reanchor } from "../domain/anchoring.js";
import { noteObjectPrefix } from "../domain/attachmentRules.js";
import { afterPosition, decodeCursor, encodeCursor, INBOX_ORDER } from "../domain/inboxCursor.js";
import { cleanBody } from "../domain/noteBody.js";
import { iso } from "../domain/time.js";
import { localToInstant } from "../domain/wallClock.js";
import { conflict, notFound } from "../http/errors.js";
import { ANY, HP, member, type MemberCtx, type Router } from "../http/router.js";
import { Fields } from "../http/validate.js";
import { kick } from "../services/workers.js";
import { audit, loadNote } from "./records.js";

const STATUSES: NoteStatus[] = ["unprocessed", "snoozed", "processed"];
const SOURCES: NoteSource[] = ["support_ticket", "sales_call", "email"];
const MAX_BODY_BYTES = 200_000;

const contactKnown = async (q: Queryable, workspaceId: string, id: unknown): Promise<boolean> =>
  typeof id === "string" && (await q.query("SELECT 1 FROM contacts WHERE id = $1 AND workspace_id = $2", [id, workspaceId])).length > 0;

/** Validates title and body as the brief's create rules state; returns the reduced body. */
function readBodyField(fields: Fields): { body: string; text: string } {
  const raw = fields.raw("body");
  if (typeof raw !== "string") {
    fields.fail("body", "Add the note text.");
    return { body: "", text: "" };
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) fields.fail("body", "Keep the note under 200,000 bytes.");
  const clean = cleanBody(raw);
  if (clean.text.trim() === "") fields.fail("body", "Add the note text.");
  return clean;
}

const TITLE = { min: 1, max: 200, message: "Add a title." };

async function noteId(ctx: MemberCtx): Promise<string> {
  const id = ctx.params.id ?? "";
  const [row] = await db.query("SELECT id FROM notes WHERE id = $1 AND workspace_id = $2", [id, ctx.session.workspace.id]);
  if (!row) throw notFound();
  return id;
}

async function liveStatus(q: Queryable, id: string): Promise<NoteStatus> {
  const [row] = await q.query<{ status: NoteStatus }>("SELECT status FROM notes_live WHERE id = $1", [id]);
  return row.status;
}

const transitionError = (from: NoteStatus, to: NoteStatus) =>
  conflict("invalid_transition", `This note can't move from ${from} to ${to}.`);

export function noteRoutes(router: Router): void {
  router.add("/api/notes", {
    GET: member({
      roles: ANY,
      handle: async (ctx) => {
        const ws = ctx.session.workspace.id;
        const query = ctx.url.searchParams;
        const limitText = query.get("limit") ?? "50";
        const fields = new Fields({
          status: query.get("status") ?? "unprocessed",
          limit: /^\d{1,3}$/.test(limitText) ? Number(limitText) : null,
        });
        const status = fields.oneOf("status", STATUSES, "Choose unprocessed, snoozed or processed.");
        const limit = fields.integer("limit", 1, 100, "Limit must be a whole number from 1 to 100.");
        const cursorText = query.get("cursor");
        const position = cursorText === null ? null : decodeCursor(cursorText);
        if (cursorText !== null && (position === null || position.status !== status)) fields.fail("cursor", "This cursor belongs to another list.");
        fields.check();
        const rows = await db.query<{
          id: string; title: string; source: NoteSource; status: NoteStatus; snoozed_until: Date | null;
          contact_name: string | null; company_name: string | null; created_at: Date; insight_count: number;
        }>(
          `SELECT n.id, n.title, n.source, n.status, n.snoozed_until, c.name AS contact_name, co.name AS company_name, n.created_at,
                  (SELECT count(*) FROM insights i WHERE i.note_id = n.id) AS insight_count
             FROM notes_live n LEFT JOIN contacts c ON c.id = n.contact_id LEFT JOIN companies co ON co.id = c.company_id
            WHERE n.workspace_id = $1 AND n.status = $2 AND ($3::text IS NULL OR ${afterPosition(4, 5)})
            ORDER BY ${INBOX_ORDER} LIMIT $6`,
          [ws, status, position ? "after" : null, position?.createdAt ?? null, position?.id ?? null, limit + 1],
        );
        const page = rows.slice(0, limit);
        const last = page.at(-1);
        const counts = { unprocessed: 0, snoozed: 0, processed: 0 };
        for (const row of await db.query<{ status: NoteStatus; total: number }>(
          "SELECT status, count(*) AS total FROM notes_live WHERE workspace_id = $1 GROUP BY status",
          [ws],
        )) counts[row.status] = row.total;
        const notes: NoteListItem[] = page.map((r) => ({
          id: r.id, title: r.title, source: r.source, status: r.status, snoozedUntil: r.snoozed_until && iso(r.snoozed_until),
          contactName: r.contact_name, companyName: r.company_name, createdAt: iso(r.created_at), insightCount: r.insight_count,
        }));
        const nextCursor = rows.length > limit && last ? encodeCursor({ status, createdAt: iso(last.created_at), id: last.id }) : null;
        return { status: 200, json: { notes, nextCursor, counts } };
      },
    }),
    POST: member({
      roles: ANY,
      handle: async (ctx) => {
        const ws = ctx.session.workspace.id;
        const fields = new Fields(ctx.body);
        const title = fields.text("title", TITLE);
        const { body, text } = readBodyField(fields);
        const source = fields.oneOf("source", SOURCES, "Choose a source.");
        const contactId = fields.raw("contactId");
        const hasContact = contactId !== undefined && contactId !== null;
        if (hasContact && !(await contactKnown(db, ws, contactId))) fields.id("contactId", () => false);
        fields.check();
        const id = await db.transaction(async (tx) => {
          const [row] = await tx.query<{ id: string }>(
            "INSERT INTO notes (workspace_id, title, body, text, source, status, contact_id) VALUES ($1, $2, $3, $4, $5, 'unprocessed', $6) RETURNING id",
            [ws, title, body, text, source, hasContact ? String(contactId) : null],
          );
          await audit(tx, ctx, ws, "note.created", row.id);
          return row.id;
        });
        return { status: 201, json: { note: await loadNote(db, ws, id) } };
      },
    }),
  });

  router.add("/api/notes/:id", {
    GET: member({ roles: ANY, load: noteId, handle: async (ctx, id) => ({ status: 200, json: { note: await loadNote(db, ctx.session.workspace.id, id) } }) }),
    PATCH: member({
      roles: HP,
      load: noteId,
      handle: async (ctx, id) => {
        const ws = ctx.session.workspace.id;
        const fields = new Fields(ctx.body);
        await db.transaction(async (tx) => {
          await tx.query("SELECT id FROM notes WHERE id = $1 FOR UPDATE", [id]);
          const changes: { body?: string; text?: string; title?: string; contactId?: string | null } = {};
          if (fields.has("body")) {
            const clean = readBodyField(fields);
            const insights = (await tx.query<{ id: string; start_offset: number; end_offset: number; quote: string }>(
              "SELECT id, start_offset, end_offset, quote FROM insights WHERE note_id = $1", [id],
            )).map((i) => ({ id: i.id, start: i.start_offset, end: i.end_offset, quote: i.quote }));
            const anchored = reanchor(insights, clean.text);
            if (!anchored.ok) {
              throw conflict(
                "highlight_conflict",
                `This edit removes highlighted text from ${anchored.lostIds.length} linked insights. Unlink them first or keep that text.`,
                { insightIds: anchored.lostIds },
              );
            }
            fields.check();
            for (const moved of anchored.moved) {
              await tx.query("UPDATE insights SET start_offset = $2, end_offset = $3 WHERE id = $1", [moved.id, moved.start, moved.end]);
            }
            changes.body = clean.body;
            changes.text = clean.text;
          }
          if (fields.has("title")) changes.title = fields.text("title", TITLE);
          if (fields.has("contactId")) {
            const contactId = fields.raw("contactId");
            if (contactId === null) changes.contactId = null;
            else if (await contactKnown(tx, ws, contactId)) changes.contactId = String(contactId);
            else fields.id("contactId", () => false);
          }
          fields.check();
          await tx.query(
            `UPDATE notes SET body = coalesce($2, body), text = coalesce($3, text), title = coalesce($4, title),
                    contact_id = CASE WHEN $5::boolean THEN $6::text ELSE contact_id END
              WHERE id = $1`,
            [id, changes.body ?? null, changes.text ?? null, changes.title ?? null, "contactId" in changes, changes.contactId ?? null],
          );
          await audit(tx, ctx, ws, "note.updated", id, { fields: Object.keys(changes) });
        });
        return { status: 200, json: { note: await loadNote(db, ws, id) } };
      },
    }),
    DELETE: member({
      roles: HP,
      load: noteId,
      handle: async (ctx, id) => {
        const ws = ctx.session.workspace.id;
        await db.transaction(async (tx) => {
          await tx.query("DELETE FROM insights WHERE note_id = $1", [id]);
          await tx.query("DELETE FROM attachments WHERE note_id = $1", [id]);
          await tx.query("DELETE FROM notes WHERE id = $1", [id]);
          await tx.query("INSERT INTO object_deletions (prefix) VALUES ($1)", [noteObjectPrefix(id)]);
          await audit(tx, ctx, ws, "note.deleted", id);
        });
        kick("attachments");
        return { status: 204 };
      },
    }),
  });

  router.add("/api/notes/:id/status", {
    POST: member({
      roles: HP,
      load: noteId,
      handle: async (ctx, id) => {
        const ws = ctx.session.workspace.id;
        await db.transaction(async (tx) => {
          await tx.query("SELECT id FROM notes WHERE id = $1 FOR UPDATE", [id]);
          const fields = new Fields(ctx.body);
          const to = fields.oneOf("to", ["processed", "unprocessed"] as const, "Choose processed or unprocessed.");
          fields.check();
          const from = await liveStatus(tx, id);
          if (noteTransition(from, to) === null) throw transitionError(from, to);
          await tx.query("UPDATE notes SET status = $2, snoozed_until = NULL WHERE id = $1", [id, to]);
          await audit(tx, ctx, ws, `note.${to}`, id, { from });
        });
        return { status: 200, json: { note: await loadNote(db, ws, id) } };
      },
    }),
  });

  router.add("/api/notes/:id/snooze", {
    POST: member({
      roles: HP,
      load: noteId,
      handle: async (ctx, id) => {
        const ws = ctx.session.workspace;
        await db.transaction(async (tx) => {
          await tx.query("SELECT id FROM notes WHERE id = $1 FOR UPDATE", [id]);
          const from = await liveStatus(tx, id);
          if (noteTransition(from, "snooze") === null) throw transitionError(from, "snoozed");
          const fields = new Fields(ctx.body);
          const local = fields.text("until", { min: 16, max: 16, message: "Pick a time in the future." });
          const until = localToInstant(local, ws.timeZone);
          if (until === null || until.getTime() <= Date.now()) fields.fail("until", "Pick a time in the future.");
          const { until: instant } = fields.check({ until });
          await tx.query("UPDATE notes SET status = 'snoozed', snoozed_until = $2 WHERE id = $1", [id, instant]);
          await audit(tx, ctx, ws.id, "note.snoozed", id, { until: iso(instant) });
        });
        return { status: 200, json: { note: await loadNote(db, ws.id, id) } };
      },
    }),
  });
}
