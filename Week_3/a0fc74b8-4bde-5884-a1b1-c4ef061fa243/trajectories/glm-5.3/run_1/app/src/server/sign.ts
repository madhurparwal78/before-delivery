import type { Route } from "./http.js";
import { json } from "./respond.js";
import { err, withTransaction, type Ctx } from "./core.js";
import { COPY } from "./copy.js";
import { getRecipients, getFields } from "./documents.js";
import { writeAudit } from "./audit.js";
import { deliver } from "./outbox.js";
import { cpLength, dateInZone } from "./util.js";
import { originalKey } from "./keys.js";
import type { DocumentRow, Field, Recipient } from "./domain.js";
import { beginTurn } from "./flows.js";
import { sealDocument } from "./seal.js";
import { linkState } from "./routes.js";

interface SignLookup {
  doc: DocumentRow;
  recipient: Recipient;
  token: { token: string; superseded: boolean };
}

async function lookupLink(ctx: Ctx, token: string): Promise<SignLookup> {
  const res = await ctx.pool.query(
    `SELECT d.*, r.id AS recipient_row_id, lt.token AS token_text, lt.superseded
     FROM link_tokens lt
     JOIN recipients r ON r.id = lt.recipient_id
     JOIN documents d ON d.id = lt.document_id
     WHERE lt.token = $1`,
    [token],
  );
  if (res.rows.length === 0) throw err(404, "not_found");
  const row = res.rows[0];
  const doc: DocumentRow = {
    id: row.id, teamId: row.team_id, ownerId: row.owner_id, title: row.title,
    status: row.status, timeZone: row.time_zone, pageCount: Number(row.page_count),
    originalSha256: row.original_sha256, completedSha256: row.completed_sha256,
    version: Number(row.version), createdAt: row.created_at, updatedAt: row.updated_at,
    currentOrder: row.current_order === null ? null : Number(row.current_order),
    reminderAvailableAt: row.reminder_available_at, voidReason: row.void_reason,
    voidedBy: row.voided_by, declinedByRecipientId: row.declined_by_recipient_id,
    declinedByName: row.declined_by_name, sendToken: row.send_token, reminderToken: row.reminder_token,
  };
  const rec = (await getRecipients(ctx.pool, doc.id)).find((r) => r.id === row.recipient_row_id);
  if (!rec) throw err(404, "not_found");
  return { doc, recipient: rec, token: { token: row.token_text, superseded: row.superseded } };
}

export function buildSignRoutes(): Route[] {
  return [
    {
      method: "GET", pattern: "/api/sign/:token",
      handler: async (req, res, ctx) => {
        const { doc, recipient, token } = await lookupLink(ctx, req.params.token!);
        const now = new Date();
        const state = linkState(doc, recipient, token, now);
        const recipients = await getRecipients(ctx.pool, doc.id);
        const fields = await getFields(ctx.pool, doc.id);

        // First open in your_turn marks viewed.
        if (state === "your_turn" && recipient.status === "invited") {
          await withTransaction(ctx.pool, async (client) => {
            await client.query("UPDATE recipients SET status = 'viewed' WHERE id = $1 AND status = 'invited'", [recipient.id]);
            await writeAudit(client, doc.id, "recipient.viewed", recipient.email, recipient.id, new Date());
          });
          recipient.status = "viewed";
        }

        const currentRecipient = doc.currentOrder === null ? null : recipients.find((r) => r.order === doc.currentOrder) ?? null;
        const declinedBy = doc.declinedByName;
        const sender = await ctx.pool.query<{ name: string }>("SELECT name FROM users WHERE id = $1", [doc.ownerId]);

        json(res, 200, {
          state,
          title: doc.title,
          recipient: { id: recipient.id, name: recipient.name, order: recipient.order, status: recipient.status },
          signerCount: recipients.length,
          current: state === "signed_waiting" && currentRecipient
            ? { name: currentRecipient.name, order: currentRecipient.order }
            : null,
          senderName: sender.rows[0]?.name ?? "",
          declinedBy,
          voidReason: doc.voidReason,
          pageCount: doc.pageCount,
          timeZone: doc.timeZone,
          fields: state === "your_turn"
            ? fields.filter((f) => f.recipientId === recipient.id).map((f) => ({
                id: f.id, kind: f.kind, label: f.label, required: f.required,
                page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, value: f.value,
              }))
            : [],
          otherFields: fields.filter((f) => f.recipientId !== recipient.id).map((f) => ({
            page: f.page, x: f.x, y: f.y, w: f.w, h: f.h,
          })),
        });
      },
    },
    {
      method: "GET", pattern: "/api/sign/:token/original.pdf",
      handler: async (req, res, ctx) => {
        const { doc, recipient, token } = await lookupLink(ctx, req.params.token!);
        const state = linkState(doc, recipient, token, new Date());
        if (state !== "your_turn") throw err(409, "link_closed", { state });
        const bytes = await ctx.storage.get(originalKey(doc.id));
        if (!bytes.exists) throw err(503, "storage_unavailable");
        res.writeHead(200, { "content-type": "application/pdf", "content-length": bytes.body.length, "cache-control": "no-store" });
        res.end(bytes.body);
      },
    },
    {
      method: "GET", pattern: "/sign/:token/completed.pdf",
      handler: async (req, res, ctx) => {
        const { doc } = await lookupLink(ctx, req.params.token!);
        if (doc.status !== "completed") throw err(409, "link_closed", { state: doc.status });
        const bytes = await ctx.storage.get(`documents/${doc.id}/completed.pdf`);
        if (!bytes.exists) throw err(503, "storage_unavailable");
        res.writeHead(200, { "content-type": "application/pdf", "content-length": bytes.body.length, "cache-control": "no-store" });
        res.end(bytes.body);
      },
    },
    {
      method: "PUT", pattern: "/api/sign/:token/fields/:fieldId",
      handler: async (req, res, ctx) => {
        const { doc, recipient, token } = await lookupLink(ctx, req.params.token!);
        const state = linkState(doc, recipient, token, new Date());
        if (state !== "your_turn") throw err(409, "link_closed", { state });
        const fieldRes = await ctx.pool.query("SELECT * FROM fields WHERE id = $1 AND document_id = $2", [req.params.fieldId, doc.id]);
        if (fieldRes.rows.length === 0) throw err(404, "not_found");
        const field = fieldRes.rows[0] as unknown as {
          id: string; recipient_id: string; kind: string; label: string; required: boolean;
          page: number; x: number; y: number; w: number; h: number; value: string | null;
        };
        if (field.recipient_id !== recipient.id) throw err(404, "not_found");
        const body = req.body as Record<string, unknown>;
        if (field.kind === "date") throw err(422, "read_only");
        if (field.kind === "text") {
          const value = typeof body.value === "string" ? body.value : "";
          if (cpLength(value) > 200) throw err(422, "validation", { fields: { value: COPY.valueTooLong } });
          await ctx.pool.query("UPDATE fields SET value = $2 WHERE id = $1", [field.id, value]);
        } else {
          // signature or initials
          if (body.typed !== undefined) {
            const typed = typeof body.typed === "string" ? body.typed : "";
            if (cpLength(typed) < 1 || cpLength(typed) > 100) throw err(422, "validation", { fields: { typed: COPY.typed } });
            await ctx.pool.query("UPDATE fields SET value = $2 WHERE id = $1", [field.id, `typed:${typed}`]);
            // Fill later empty fields of the same kind
            const sameKind = await ctx.pool.query(
              "SELECT id FROM fields WHERE document_id = $1 AND recipient_id = $2 AND kind = $3 AND id <> $4 AND value IS NULL",
              [doc.id, recipient.id, field.kind, field.id],
            );
            for (const row of sameKind.rows) {
              await ctx.pool.query("UPDATE fields SET value = $2 WHERE id = $1", [row.id, `typed:${typed}`]);
            }
          } else if (body.strokes !== undefined) {
            const strokes = body.strokes;
            if (!Array.isArray(strokes) || strokes.length === 0) {
              throw err(422, "validation", { fields: { strokes: COPY.strokes } });
            }
            let points = 0;
            for (const stroke of strokes) {
              if (!Array.isArray(stroke)) throw err(422, "validation", { fields: { strokes: COPY.strokes } });
              points += stroke.length;
            }
            if (points > 5000) throw err(422, "validation", { fields: { strokes: COPY.strokes } });
            await ctx.pool.query("UPDATE fields SET value = 'drawn' WHERE id = $1", [field.id]);
            await ctx.pool.query("DELETE FROM strokes WHERE field_id = $1", [field.id]);
            await ctx.pool.query("INSERT INTO strokes (field_id, data) VALUES ($1, $2)", [field.id, JSON.stringify(strokes)]);
            const sameKind = await ctx.pool.query(
              "SELECT id FROM fields WHERE document_id = $1 AND recipient_id = $2 AND kind = $3 AND id <> $4 AND value IS NULL",
              [doc.id, recipient.id, field.kind, field.id],
            );
            for (const row of sameKind.rows) {
              await ctx.pool.query("UPDATE fields SET value = 'drawn' WHERE id = $1", [row.id]);
              await ctx.pool.query("INSERT INTO strokes (field_id, data) VALUES ($1, $2)", [row.id, JSON.stringify(strokes)]);
            }
          } else {
            throw err(422, "validation", { fields: { typed: COPY.typed } });
          }
        }
        ctx.live.publishDocument(doc.id, { type: "document", id: doc.id });
        const updated = await ctx.pool.query("SELECT * FROM fields WHERE id = $1", [field.id]);
        const f = updated.rows[0] as unknown as { id: string; recipient_id: string; kind: string; label: string; required: boolean; page: number; x: number; y: number; w: number; h: number; value: string | null };
        json(res, 200, {
          id: f.id, recipientId: f.recipient_id, kind: f.kind, label: f.label, required: f.required,
          page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, value: f.value,
        });
      },
    },
    {
      method: "POST", pattern: "/api/sign/:token/finish",
      handler: async (req, res, ctx) => {
        const { doc, recipient, token } = await lookupLink(ctx, req.params.token!);
        const now = new Date();
        const state = linkState(doc, recipient, token, now);
        if (state !== "your_turn") throw err(409, "link_closed", { state });
        const fields = await getFields(ctx.pool, doc.id);
        const mine = fields.filter((f) => f.recipientId === recipient.id);
        const incomplete = mine.filter((f) => f.required && f.kind !== "date" && !isComplete(f));
        if (incomplete.length > 0) {
          throw err(422, "incomplete_fields", { remaining: incomplete.length });
        }
        const dateStr = dateInZone(now, doc.timeZone);
        const recipients = await getRecipients(ctx.pool, doc.id);
        const isLast = recipient.order === recipients.length;
        const resultState = await withTransaction(ctx.pool, async (client) => {
          const locked = await client.query("SELECT status FROM documents WHERE id = $1 FOR UPDATE", [doc.id]);
          if ((locked.rows[0] as { status: string }).status !== "in_progress") {
            throw err(409, "link_closed", { state: "link_closed" });
          }
          const recLocked = await client.query("SELECT status FROM recipients WHERE id = $1 FOR UPDATE", [recipient.id]);
          const status = (recLocked.rows[0] as { status: string }).status;
          if (status !== "invited" && status !== "viewed") {
            throw err(409, "link_closed", { state: "link_closed" });
          }
          // Fill date fields
          for (const f of mine.filter((x) => x.kind === "date")) {
            await client.query("UPDATE fields SET value = $2 WHERE id = $1", [f.id, dateStr]);
          }
          await client.query("UPDATE recipients SET status = 'signed', signed_at = $2 WHERE id = $1", [recipient.id, now]);
          await writeAudit(client, doc.id, "recipient.signed", recipient.email, recipient.id, now);
          let newState: "signed_waiting" | "sealing" | "completed";
          if (isLast) {
            await client.query("UPDATE documents SET status = 'sealing', current_order = NULL, version = version + 1, updated_at = $2 WHERE id = $1", [doc.id, now]);
            newState = "sealing";
          } else {
            const next = recipients.find((r) => r.order === recipient.order + 1)!;
            await client.query("UPDATE documents SET current_order = $2, version = version + 1, updated_at = $3 WHERE id = $1", [doc.id, next.order, now]);
            await beginTurn(ctx, client, doc, next, "invite", recipient.email);
            newState = "signed_waiting";
          }
          await client.query("INSERT INTO seal_jobs (document_id, last_attempt) VALUES ($1, now()) ON CONFLICT (document_id) DO NOTHING", [doc.id]);
          return newState;
        });
        ctx.live.publishDocument(doc.id, { type: "document", id: doc.id });
        ctx.live.publishTeam(doc.teamId, { type: "documents" });
        if (resultState === "sealing") {
          await sealDocument(ctx, doc.id);
        }
        json(res, 200, { state: resultState });
      },
    },
    {
      method: "POST", pattern: "/api/sign/:token/decline",
      handler: async (req, res, ctx) => {
        const { doc, recipient, token } = await lookupLink(ctx, req.params.token!);
        const now = new Date();
        const state = linkState(doc, recipient, token, now);
        if (state !== "your_turn") throw err(409, "link_closed", { state });
        const body = req.body as { reason?: unknown };
        const reason = typeof body.reason === "string" ? body.reason : "";
        const invalid: Record<string, string> = {};
        if (cpLength(reason.trim()) < 1) invalid.reason = COPY.reasonEmptyDecline;
        else if (cpLength(reason) > 500) invalid.reason = COPY.reasonTooLong;
        if (Object.keys(invalid).length > 0) throw err(422, "validation", { fields: invalid });
        const recipients = await withTransaction(ctx.pool, async (client) => {
          const locked = await client.query("SELECT status FROM documents WHERE id = $1 FOR UPDATE", [doc.id]);
          if ((locked.rows[0] as { status: string }).status !== "in_progress") {
            throw err(409, "link_closed", { state: "link_closed" });
          }
          const recLocked = await client.query("SELECT status FROM recipients WHERE id = $1 FOR UPDATE", [recipient.id]);
          const status = (recLocked.rows[0] as { status: string }).status;
          if (status !== "invited" && status !== "viewed") {
            throw err(409, "link_closed", { state: "link_closed" });
          }
          await client.query("UPDATE recipients SET status = 'declined', decline_reason = $2 WHERE id = $1", [recipient.id, reason]);
          await client.query("UPDATE documents SET status = 'declined', declined_by_recipient_id = $2, declined_by_name = $3, current_order = NULL, version = version + 1, updated_at = $4 WHERE id = $1", [doc.id, recipient.id, recipient.name, now]);
          await client.query("UPDATE recipients SET binding = false WHERE document_id = $1", [doc.id]);
          await writeAudit(client, doc.id, "recipient.declined", recipient.email, recipient.id, now);
          return getRecipients(client, doc.id);
        });
        // Decline notices: sender + earlier signers
        const signed = recipients.filter((r) => r.status === "signed" && r.id !== recipient.id);
        const owner = await ctx.pool.query<{ email: string }>("SELECT email FROM users WHERE id = $1", [doc.ownerId]);
        const targets = [owner.rows[0].email, ...signed.map((r) => r.email)];
        for (const to of targets) {
          await deliver(ctx, {
            kind: "decline_notice", to, subject: `Declined: ${doc.title}`,
            body: `Reason: ${reason}`, documentId: doc.id, senderName: null,
          });
        }
        ctx.live.publishDocument(doc.id, { type: "document", id: doc.id });
        ctx.live.publishTeam(doc.teamId, { type: "documents" });
        json(res, 200, { state: "declined" });
      },
    },
  ];
}

function isComplete(f: Field): boolean {
  if (f.value === null || f.value === "") return false;
  if (f.kind === "text") return f.value.trim() !== "";
  return true;
}
