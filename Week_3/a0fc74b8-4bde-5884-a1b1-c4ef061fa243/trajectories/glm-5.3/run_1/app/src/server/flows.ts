import type { Route } from "./http.js";
import type { PoolClient } from "pg";
import { json, requireAuth } from "./respond.js";
import { err, withTransaction, type Ctx } from "./core.js";
import { COPY } from "./copy.js";
import { getDocument, getRecipients, getFields, documentJson, loadDocumentBundle } from "./documents.js";
import { writeAudit } from "./audit.js";
import { deliver } from "./outbox.js";
import { cpLength } from "./util.js";
import type { DocumentRow, Recipient } from "./domain.js";
import { issueLinkToken, touchDocument, requireOwnerOrTeamOwner, effStatus } from "./routes.js";

/* ================= send, remind, links, void ================= */

/** Begins recipient k's turn: issue link, set expiry, send or hold the invitation. */
export async function beginTurn(ctx: Ctx, client: PoolClient, doc: DocumentRow, recipient: Recipient, kind: "invite" | "new_link", actorEmail: string): Promise<{ token: string; delivery: "sent" | "held" }> {
  const now = new Date();
  const expires = new Date(now.getTime() + ctx.cfg.linkTtlSeconds * 1000);
  const token = await issueLinkToken(client, doc.id, recipient.id);
  await client.query(
    "UPDATE recipients SET status = 'invited', turn_started_at = $2, link_expires_at = $3 WHERE id = $1",
    [recipient.id, now, expires],
  );
  const link = `${ctx.cfg.publicUrl}/sign/${token}`;
  const subject = kind === "invite" ? `Please sign: ${doc.title}` : `New link: ${doc.title}`;
  const body = `Open the document: ${link}`;
  const sender = await client.query<{ name: string }>("SELECT name FROM users WHERE id = $1", [doc.ownerId]);
  const senderName = sender.rows[0]?.name ?? "";
  const mailOk = await deliver(ctx, {
    kind, to: recipient.email, subject, body, documentId: doc.id, senderName,
  });
  const delivery = mailOk === "sent" ? "sent" as const : "held" as const;
  await client.query("UPDATE recipients SET delivery = $2 WHERE id = $1", [recipient.id, delivery]);
  await writeAudit(client, doc.id, delivery === "sent" ? "invite.sent" : "invite.held", "system", recipient.id, now);
  return { token, delivery };
}

export const flowRoutes: Route[] = [
  {
    method: "POST", pattern: "/api/documents/:id/send",
    handler: async (req, res, ctx) => {
      const actor = requireAuth(req, ctx);
      const idempotencyKey = req.headers["idempotency-key"];
      const key = Array.isArray(idempotencyKey) ? idempotencyKey[0] : idempotencyKey;

      // Auth and team scoping come first, then the replay is checked before any state rule.
      const doc0 = await getDocument(ctx, req.params.id!);
      requireOwnerOrTeamOwner(actor, doc0);

      if (key !== undefined && key !== "") {
        if (key.length < 1 || key.length > 100) throw err(422, "validation", { fields: { idempotencyKey: "Enter 1 to 100 characters." } });
        const stored = await ctx.pool.query<{ document_id: string; status: number; body: string }>(
          "SELECT document_id, status, body FROM idempotency WHERE key = $1 AND document_id = $2", [key, doc0.id],
        );
        if (stored.rows.length > 0) {
          if (stored.rows[0].document_id !== doc0.id) throw err(422, "idempotency_key_reused");
          if (stored.rows[0].body === "pending") {
            // A send with this key is in flight; the caller waits for the first outcome.
            throw err(409, "invalid_state", { status: doc0.status });
          }
          res.writeHead(stored.rows[0].status, { "content-type": "application/json; charset=utf-8" });
          res.end(stored.rows[0].body);
          return;
        }
      }

      if (doc0.status !== "draft") throw err(409, "invalid_state", { status: doc0.status });
      const recipients = await getRecipients(ctx.pool, doc0.id);
      const fields = await getFields(ctx.pool, doc0.id);
      if (recipients.length === 0) throw err(422, "no_recipients");
      const missing = recipients.filter((r) => !fields.some((f) => f.recipientId === r.id && f.kind === "signature" && f.required));
      if (missing.length > 0) {
        throw err(422, "missing_signature_fields", { recipients: missing.map((r) => r.name) });
      }

      const body = await withTransaction(ctx.pool, async (client) => {
        const locked = await client.query("SELECT * FROM documents WHERE id = $1 FOR UPDATE", [doc0.id]);
        if ((locked.rows[0] as { status: string }).status !== "draft") {
          throw err(409, "invalid_state", { status: (locked.rows[0] as { status: string }).status });
        }
        await client.query("UPDATE documents SET status = 'in_progress', current_order = 1, version = version + 1, updated_at = now() WHERE id = $1", [doc0.id]);
        await writeAudit(client, doc0.id, "document.sent", actor.email, null, new Date());
        const recips = await getRecipients(client, doc0.id);
        await beginTurn(ctx, client, doc0, recips[0], "invite", actor.email);
        const fresh = await getRecipients(client, doc0.id);
        const freshFields = await getFields(client, doc0.id);
        const lockedRow = (locked.rows[0]) as unknown as DocumentRow;
        return JSON.stringify(documentJson({ ...lockedRow, status: "in_progress", currentOrder: 1 }, fresh, freshFields));
      });

      if (key !== undefined && key !== "") {
        const prior = await ctx.pool.query<{ document_id: string }>(
          "SELECT document_id FROM idempotency WHERE key = $1 AND document_id <> $2", [key, doc0.id],
        );
        if (prior.rows.length > 0) throw err(422, "idempotency_key_reused");
        // Reserve the key before sending so a replay finds the stored response,
        // whatever has happened to the document since.
        await ctx.pool.query(
          "INSERT INTO idempotency (key, document_id, status, body) VALUES ($1, $2, 200, $3) ON CONFLICT (document_id, key) DO NOTHING",
          [key, doc0.id, body],
        );
      }
      ctx.live.publishDocument(doc0.id, { type: "document", id: doc0.id });
      ctx.live.publishTeam(doc0.teamId, { type: "documents" });
      const bundle = await loadDocumentBundle(ctx, doc0.id);
      json(res, 200, documentJson(bundle.doc, bundle.recipients, bundle.fields));
    },
  },
  {
    method: "POST", pattern: "/api/documents/:id/remind",
    handler: async (req, res, ctx) => {
      const actor = requireAuth(req, ctx);
      const doc = await getDocument(ctx, req.params.id!);
      requireOwnerOrTeamOwner(actor, doc);
      if (doc.status !== "in_progress") throw err(409, "invalid_state", { status: doc.status });
      const now = new Date();
      const recipients = (await getRecipients(ctx.pool, doc.id)).map((r) => ({ ...r, status: effStatus(r, doc.status, now) }));
      const current = recipients.find((r) => r.order === doc.currentOrder);
      if (!current) throw err(409, "invalid_state", { status: doc.status });
      if (current.status !== "invited" && current.status !== "viewed") {
        throw err(409, "invalid_state", { status: current.status });
      }
      if (doc.reminderAvailableAt !== null && now < doc.reminderAvailableAt) {
        throw err(429, "reminder_cooldown", { availableAt: doc.reminderAvailableAt.toISOString() });
      }
      const tokenRow = await ctx.pool.query<{ token: string }>(
        "SELECT token FROM link_tokens WHERE recipient_id = $1 AND superseded = false ORDER BY created_at DESC LIMIT 1", [current.id],
      );
      const token = tokenRow.rows[0]?.token;
      if (!token) throw err(409, "invalid_state", { status: current.status });
      const link = `${ctx.cfg.publicUrl}/sign/${token}`;
      const sender = await ctx.pool.query<{ name: string }>("SELECT name FROM users WHERE id = $1", [doc.ownerId]);
      const mailOk = await deliver(ctx, {
        kind: "reminder", to: current.email, subject: `Reminder: please sign ${doc.title}`,
        body: `Open the document: ${link}`, documentId: doc.id, senderName: sender.rows[0]?.name ?? "",
      });
      if (!mailOk) throw err(503, "mail_unavailable");
      const availableAt = new Date(now.getTime() + ctx.cfg.reminderCooldownSeconds * 1000);
      await withTransaction(ctx.pool, async (client) => {
        await client.query("UPDATE documents SET reminder_available_at = $2 WHERE id = $1", [doc.id, availableAt]);
        await writeAudit(client, doc.id, "reminder.sent", actor.email, current.id, now);
        await touchDocument(client, doc.id);
      });
      ctx.live.publishDocument(doc.id, { type: "document", id: doc.id });
      json(res, 200, { reminderAvailableAt: availableAt.toISOString() });
    },
  },
  {
    method: "POST", pattern: "/api/documents/:id/recipients/:recipientId/new-link",
    handler: async (req, res, ctx) => {
      const actor = requireAuth(req, ctx);
      const doc = await getDocument(ctx, req.params.id!);
      requireOwnerOrTeamOwner(actor, doc);
      if (doc.status !== "in_progress") throw err(409, "invalid_state", { status: doc.status });
      const now = new Date();
      const recipientRow0 = await ctx.pool.query("SELECT * FROM recipients WHERE id = $1 AND document_id = $2", [req.params.recipientId, doc.id]);
      if (recipientRow0.rows.length === 0) throw err(404, "not_found");
      const recipient = (await getRecipients(ctx.pool, doc.id)).find((r) => r.id === req.params.recipientId)!;
      const effective = effStatus(recipient, doc.status, now);
      if (effective !== "expired") throw err(409, "invalid_state", { status: effective });
      if (doc.currentOrder !== recipient.order) throw err(409, "invalid_state", { status: effective });
      await withTransaction(ctx.pool, async (client) => {
        await writeAudit(client, doc.id, "link.resent", actor.email, recipient.id, now);
        await beginTurn(ctx, client, doc, recipient, "new_link", actor.email);
        await touchDocument(client, doc.id);
      });
      ctx.live.publishDocument(doc.id, { type: "document", id: doc.id });
      const bundle = await loadDocumentBundle(ctx, doc.id);
      json(res, 200, documentJson(bundle.doc, bundle.recipients.map((r) => ({ ...r, status: effStatus(r, bundle.doc.status, new Date()) })), bundle.fields));
    },
  },
  {
    method: "POST", pattern: "/api/documents/:id/void",
    handler: async (req, res, ctx) => {
      const actor = requireAuth(req, ctx);
      const doc = await getDocument(ctx, req.params.id!);
      requireOwnerOrTeamOwner(actor, doc);
      if (doc.status !== "in_progress") throw err(409, "invalid_state", { status: doc.status });
      const body = req.body as { reason?: unknown };
      const reason = typeof body.reason === "string" ? body.reason : "";
      const invalid: Record<string, string> = {};
      if (cpLength(reason.trim()) < 1) invalid.reason = COPY.reasonEmptyVoid;
      else if (cpLength(reason) > 500) invalid.reason = COPY.reasonTooLong;
      if (Object.keys(invalid).length > 0) throw err(422, "validation", { fields: invalid });
      const now = new Date();
      const notice = await withTransaction(ctx.pool, async (client) => {
        const locked = await client.query("SELECT status FROM documents WHERE id = $1 FOR UPDATE", [doc.id]);
        if ((locked.rows[0] as { status: string }).status !== "in_progress") {
          throw err(409, "invalid_state", { status: (locked.rows[0] as { status: string }).status });
        }
        const recipients = await getRecipients(client, doc.id);
        await client.query(
          "UPDATE documents SET status = 'voided', void_reason = $2, voided_by = $3, current_order = NULL, version = version + 1, updated_at = $4 WHERE id = $1",
          [doc.id, reason, actor.name, now],
        );
        await client.query("UPDATE recipients SET binding = false WHERE document_id = $1", [doc.id]);
        await writeAudit(client, doc.id, "document.voided", actor.email, null, now);
        await touchDocument(client, doc.id);
        return recipients;
      });
      // Void notices
      const signed = notice.filter((r) => r.status === "signed");
      const turnRecipient = notice.find((r) => r.order === doc.currentOrder);
      const targets = [...signed];
      if (turnRecipient && turnRecipient.status !== "signed") targets.push(turnRecipient);
      for (const r of targets) {
        await deliver(ctx, {
          kind: "void_notice", to: r.email, subject: `Voided: ${doc.title}`,
          body: `Reason: ${reason}`, documentId: doc.id, senderName: null,
        });
      }
      await deliver(ctx, {
        kind: "void_notice", to: (await ctx.pool.query<{ email: string }>("SELECT email FROM users WHERE id = $1", [doc.ownerId])).rows[0].email,
        subject: `Voided: ${doc.title}`, body: `Reason: ${reason}`, documentId: doc.id, senderName: null,
      });
      ctx.live.publishDocument(doc.id, { type: "document", id: doc.id });
      ctx.live.publishTeam(doc.teamId, { type: "documents" });
      const bundle = await loadDocumentBundle(ctx, doc.id);
      json(res, 200, documentJson(bundle.doc, bundle.recipients, bundle.fields));
    },
  },
];

export function buildFlowRoutes(): Route[] {
  return flowRoutes;
}
