import type { Route, Request } from "./http.js";
import { json, requireAuth } from "./respond.js";
import {
  err, validation, withTransaction, clampGeometry, geometryBreaksRules,
  nextStepText, linkIsExpired, type Actor,
} from "./core.js";
import { COPY } from "./copy.js";
import { docRow, recipientRow, fieldRow } from "./core.js";
import {
  getDocument, getRecipients, getFields, documentJson, loadDocumentBundle,
  hashToken, newToken, verifyPassword,
} from "./documents.js";
import { writeAudit, isoWithMillis } from "./audit.js";
import { sha256Hex } from "./outbox.js";
import { createSession, destroySession, SESSION_COOKIE } from "./session.js";
import { checkPdfBytes } from "./pdfcheck.js";
import { originalKey, completedKey } from "./keys.js";
import { flowRoutes } from "./flows.js";
import { isValidTimeZone, isValidEmail, cpLength } from "./util.js";
import type { DocumentRow, DocumentStatus, Field, Recipient, RecipientStatus } from "./domain.js";

/* ================= shared helpers ================= */

export function requireRole(actor: Actor, roles: Actor["role"][]): void {
  if (!roles.includes(actor.role)) throw err(403, "forbidden");
}

export function requireOwnerOrTeamOwner(actor: Actor, doc: DocumentRow): void {
  if (actor.role === "owner") return;
  if (actor.role === "member" && doc.ownerId === actor.userId) return;
  throw err(403, "forbidden");
}

export function requireDraft(doc: DocumentRow): void {
  if (doc.status !== "draft") throw err(409, "invalid_state", { status: doc.status });
}

/** Effective recipient status with server-decided expiry. */
export function effStatus(r: Recipient, docStatus: DocumentStatus, now: Date): RecipientStatus {
  if (docStatus === "in_progress" && linkIsExpired(r, now)) return "expired";
  return r.status;
}

/** The single place deciding link state precedence. */
export function linkState(
  doc: DocumentRow,
  recipient: Recipient,
  token: { superseded: boolean } | null,
  now: Date,
): "your_turn" | "signed_waiting" | "sealing" | "completed" | "declined" | "voided" | "expired" {
  if (doc.status === "voided") return "voided";
  if (doc.status === "declined") return "declined";
  if (doc.status === "completed") return "completed";
  if (doc.status === "sealing") return "sealing";
  if (recipient.status === "signed") return "signed_waiting";
  if (token !== null && token.superseded) return "expired";
  if (doc.status !== "in_progress") return "expired";
  if (linkIsExpired(recipient, now)) return "expired";
  return "your_turn";
}

export async function touchDocument(client: { query: unknown }, documentId: string): Promise<void> {
  await (client as { query: (s: string, v: unknown[]) => Promise<unknown> }).query(
    "UPDATE documents SET version = version + 1, updated_at = now() WHERE id = $1", [documentId]);
}

export async function issueLinkToken(client: { query: (s: string, v: unknown[]) => Promise<unknown> }, documentId: string, recipientId: string): Promise<string> {
  const token = newToken();
  await client.query("UPDATE link_tokens SET superseded = true WHERE recipient_id = $1", [recipientId]);
  await client.query("INSERT INTO link_tokens (recipient_id, document_id, token) VALUES ($1, $2, $3)", [recipientId, documentId, token]);
  await client.query("UPDATE recipients SET link_hash = $2 WHERE id = $1", [recipientId, hashToken(token)]);
  return token;
}

export function kindLabel(kind: string): string {
  switch (kind) {
    case "signature": return "Signature";
    case "initials": return "Initials";
    case "date": return "Date";
    case "text": return "Text";
    default: return "Field";
  }
}

export function recipientJson(r: Recipient): Record<string, unknown> {
  return {
    id: r.id, name: r.name, email: r.email, order: r.order, status: r.status,
    delivery: r.delivery, linkExpiresAt: r.linkExpiresAt === null ? null : r.linkExpiresAt.toISOString(),
    signedAt: r.signedAt === null ? null : r.signedAt.toISOString(),
    declineReason: r.declineReason, binding: r.binding,
  };
}

export function fieldJson(f: Field): Record<string, unknown> {
  return {
    id: f.id, recipientId: f.recipientId, kind: f.kind, label: f.label, required: f.required,
    page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, value: f.value,
  };
}

/* ================= multipart ================= */

async function parseMultipart(req: Request, maxFileBytes: number): Promise<{ file?: { name: string; data: Buffer }; fields: Record<string, string> }> {
  const Busboy = (await import("busboy")).default;
  const contentType = String(req.headers["content-type"] ?? "");
  const busboy = Busboy({ headers: { "content-type": contentType }, limits: { fileSize: maxFileBytes } });
  const fileData: Buffer[] = [];
  let fileName = "";
  const fields: Record<string, string> = {};
  return new Promise((resolve, reject) => {
    busboy.on("file", (name, stream, info) => {
      fileName = info.filename ?? "";
      stream.on("data", (chunk: Buffer) => { fileData.push(chunk); });
      stream.on("limit", () => { reject(err(413, "too_large", { limit: 25000000 })); });
    });
    busboy.on("field", (name, value) => { fields[name] = value; });
    busboy.on("error", (e) => reject(e));
    busboy.on("close", () => {
      const total = fileData.reduce((n, b) => n + b.length, 0);
      if (total > maxFileBytes) {
        reject(err(413, "too_large", { limit: 25000000 }));
        return;
      }
      resolve({ file: fileName ? { name: fileName, data: Buffer.concat(fileData) } : undefined, fields });
    });
    req.req.pipe(busboy);
  });
}

/* ================= session routes ================= */

const sessionRoutes: Route[] = [
  {
    method: "POST", pattern: "/api/session",
    handler: async (req, res, ctx) => {
      const body = req.body as { email?: unknown; password?: unknown };
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const found = await ctx.pool.query<{ id: string; team_id: string; email: string; name: string; role: string; password_hash: string }>(
        "SELECT * FROM users WHERE lower(email) = $1", [email]);
      let ok = false;
      let user: (typeof found.rows)[number] | null = null;
      if (found.rows.length > 0) {
        user = found.rows[0];
        ok = await verifyPassword(password, user.password_hash);
      }
      if (!ok || !user) throw err(401, "invalid_credentials");
      const { token } = await createSession(ctx, user.id);
      res.setHeader("set-cookie", `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`);
      const team = await ctx.pool.query<{ name: string }>("SELECT name FROM teams WHERE id = $1", [user.team_id]);
      json(res, 200, {
        user: { id: user.id, email: user.email, name: user.name },
        team: { id: user.team_id, name: team.rows[0].name },
        role: user.role,
      });
    },
  },
  {
    method: "GET", pattern: "/api/session",
    handler: async (req, res, ctx) => {
      const actor = requireAuth(req, ctx);
      const team = await ctx.pool.query<{ id: string; name: string }>("SELECT id, name FROM teams WHERE id = $1", [actor.teamId]);
      json(res, 200, {
        user: { id: actor.userId, email: actor.email, name: actor.name },
        team: { id: team.rows[0].id, name: team.rows[0].name },
        role: actor.role,
      });
    },
  },
  {
    method: "DELETE", pattern: "/api/session",
    handler: async (req, res, ctx) => {
      const token = req.cookies[SESSION_COOKIE];
      if (token) await destroySession(ctx, token);
      res.setHeader("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      json(res, 204, {});
    },
  },
];

/* ================= document routes ================= */

const documentRoutes: Route[] = [
  {
    method: "GET", pattern: "/api/documents",
    handler: async (req, res, ctx) => {
      const actor = requireAuth(req, ctx);
      const filter = new URL(req.url).searchParams.get("filter") ?? "all";
      const rows = await ctx.pool.query("SELECT * FROM documents WHERE team_id = $1 ORDER BY updated_at DESC", [actor.teamId]);
      const now = new Date();
      const docs: { id: string; title: string; status: DocumentStatus; nextStep: string; updatedAt: string }[] = [];
      for (const row of rows.rows) {
        const doc = docRow(row);
        const status = doc.status;
        if (filter === "in_progress" && !(status === "in_progress" || status === "sealing")) continue;
        if (filter === "completed" && status !== "completed") continue;
        if (filter === "closed" && !(status === "declined" || status === "voided")) continue;
        const recipients = (await getRecipients(ctx.pool, doc.id)).map((r) => ({ ...r, status: effStatus(r, status, now) }));
        docs.push({
          id: doc.id,
          title: doc.title,
          status,
          nextStep: nextStepText({
            status,
            currentOrder: doc.currentOrder,
            recipientCount: recipients.length,
            currentRecipient: doc.currentOrder === null ? null : recipients.find((r) => r.order === doc.currentOrder) ?? null,
          }),
          updatedAt: doc.updatedAt.toISOString(),
        });
      }
      json(res, 200, { documents: docs });
    },
  },
  {
    method: "POST", pattern: "/api/documents",
    handler: async (req, res, ctx) => {
      const actor = requireAuth(req, ctx);
      requireRole(actor, ["owner", "member"]);
      const parsed = await parseMultipart(req, 25_000_000);
      if (!parsed.file) throw validation({ file: COPY.file });
      const bytes = parsed.file.data;
      const titleInput = parsed.fields["title"] ?? "";
      const check = checkPdfBytes(bytes);
      if (typeof check !== "number") {
        if (check.code === "too_large") throw err(413, "too_large", { limit: 25000000 });
        if (check.code === "not_a_pdf") throw err(415, "not_a_pdf");
        throw err(422, check.code, check.code === "too_many_pages" ? { limit: 60 } : undefined);
      }
      const pageCount: number = check;
      let title = titleInput.trim();
      if (title === "") title = parsed.file.name.replace(/\.pdf$/i, "");
      if (cpLength(title) < 1 || cpLength(title) > 120) throw validation({ title: COPY.titleLength });
      const hash = sha256Hex(bytes);
      const documentId = crypto.randomUUID();
      if (!ctx.health.storageOk) throw err(503, "storage_unavailable");
      await ctx.storage.put(originalKey(documentId), bytes);
      await withTransaction(ctx.pool, async (client) => {
        await client.query(
          "INSERT INTO documents (id, team_id, owner_id, title, status, page_count, original_sha256, version) VALUES ($1, $2, $3, $4, 'draft', $5, $6, 1)",
          [documentId, actor.teamId, actor.userId, title, pageCount, hash],
        );
        await writeAudit(client, documentId, "document.created", actor.email, null, new Date());
      });
      ctx.live.publishTeam(actor.teamId, { type: "documents" });
      const bundle = await loadDocumentBundle(ctx, documentId);
      json(res, 201, documentJson(bundle.doc, bundle.recipients, bundle.fields));
    },
  },
  {
    method: "GET", pattern: "/api/documents/:id",
    handler: async (req, res, ctx) => {
      requireAuth(req, ctx);
      const bundle = await loadDocumentBundle(ctx, req.params.id!);
      const now = new Date();
      const recipients = bundle.recipients.map((r) => ({ ...r, status: effStatus(r, bundle.doc.status, now) }));
      json(res, 200, documentJson(bundle.doc, recipients, bundle.fields));
    },
  },
  {
    method: "PATCH", pattern: "/api/documents/:id",
    handler: async (req, res, ctx) => {
      const actor = requireAuth(req, ctx);
      const doc = await getDocument(ctx, req.params.id!);
      requireOwnerOrTeamOwner(actor, doc);
      requireDraft(doc);
      const body = req.body as { title?: unknown; timeZone?: unknown };
      const invalid: Record<string, string> = {};
      if (body.title !== undefined) {
        const t = typeof body.title === "string" ? body.title.trim() : "";
        if (cpLength(t) < 1 || cpLength(t) > 120) invalid.title = COPY.titleLength;
      }
      if (body.timeZone !== undefined) {
        const tz = typeof body.timeZone === "string" ? body.timeZone : "";
        if (!isValidTimeZone(tz)) invalid.timeZone = COPY.timeZone;
      }
      if (Object.keys(invalid).length > 0) throw validation(invalid);
      await withTransaction(ctx.pool, async (client) => {
        if (body.title !== undefined) {
          await client.query("UPDATE documents SET title = $2 WHERE id = $1", [doc.id, (body.title as string).trim()]);
        }
        if (body.timeZone !== undefined) {
          await client.query("UPDATE documents SET time_zone = $2 WHERE id = $1", [doc.id, body.timeZone as string]);
        }
        await touchDocument(client, doc.id);
      });
      const bundle = await loadDocumentBundle(ctx, doc.id);
      json(res, 200, documentJson(bundle.doc, bundle.recipients, bundle.fields));
    },
  },
  {
    method: "GET", pattern: "/api/documents/:id/original.pdf",
    handler: async (req, res, ctx) => {
      requireAuth(req, ctx);
      const doc = await getDocument(ctx, req.params.id!);
      const bytes = await ctx.storage.get(originalKey(doc.id));
      if (!bytes.exists) throw err(503, "storage_unavailable");
      res.writeHead(200, { "content-type": "application/pdf", "content-length": bytes.body.length, "cache-control": "no-store" });
      res.end(bytes.body);
    },
  },
  {
    method: "GET", pattern: "/api/documents/:id/completed.pdf",
    handler: async (req, res, ctx) => {
      requireAuth(req, ctx);
      const doc = await getDocument(ctx, req.params.id!);
      if (doc.status !== "completed") throw err(409, "invalid_state", { status: doc.status });
      const bytes = await ctx.storage.get(completedKey(doc.id));
      if (!bytes.exists) throw err(503, "storage_unavailable");
      res.writeHead(200, { "content-type": "application/pdf", "content-length": bytes.body.length, "cache-control": "no-store" });
      res.end(bytes.body);
    },
  },
  {
    method: "GET", pattern: "/api/documents/:id/audit",
    handler: async (req, res, ctx) => {
      requireAuth(req, ctx);
      const doc = await getDocument(ctx, req.params.id!);
      const rows = await ctx.pool.query(
        "SELECT seq, type, actor, recipient_id, at, prev_hash, hash FROM audit_events WHERE document_id = $1 ORDER BY seq",
        [doc.id],
      );
      json(res, 200, {
        events: rows.rows.map((row) => ({
          seq: Number(row.seq),
          type: row.type,
          actor: row.actor,
          recipientId: row.recipient_id,
          at: isoWithMillis(new Date(row.at)),
          prevHash: row.prev_hash,
          hash: row.hash,
        })),
      });
    },
  },
  {
    method: "POST", pattern: "/api/documents/:id/recipients",
    handler: async (req, res, ctx) => {
      const actor = requireAuth(req, ctx);
      const doc = await getDocument(ctx, req.params.id!);
      requireOwnerOrTeamOwner(actor, doc);
      requireDraft(doc);
      const body = req.body as { name?: unknown; email?: unknown };
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const invalid: Record<string, string> = {};
      if (name === "") invalid.name = COPY.name;
      if (!isValidEmail(email)) invalid.email = COPY.emailInvalid;
      if (Object.keys(invalid).length === 0) {
        const dup = await ctx.pool.query("SELECT 1 FROM recipients WHERE document_id = $1 AND lower(email) = $2", [doc.id, email]);
        if (dup.rows.length > 0) invalid.email = COPY.emailDuplicate;
        const countRes = await ctx.pool.query<{ count: string }>("SELECT count(*) AS count FROM recipients WHERE document_id = $1", [doc.id]);
        if (Number(countRes.rows[0].count) >= 10) invalid.recipients = COPY.recipientsMax;
      }
      if (Object.keys(invalid).length > 0) throw validation(invalid);
      const created = await withTransaction(ctx.pool, async (client) => {
        const orderRes = await client.query<{ max: number | null }>('SELECT max("order") AS max FROM recipients WHERE document_id = $1', [doc.id]);
        const ins = await client.query(
          'INSERT INTO recipients (document_id, name, email, "order", status) VALUES ($1, $2, $3, $4, \'waiting\') RETURNING *',
          [doc.id, name, email, (orderRes.rows[0].max ?? 0) + 1],
        );
        await touchDocument(client, doc.id);
        return recipientRow(ins.rows[0]);
      });
      ctx.live.publishDocument(doc.id, { type: "document", id: doc.id });
      json(res, 201, recipientJson(created));
    },
  },
  {
    method: "PATCH", pattern: "/api/documents/:id/recipients/:recipientId",
    handler: async (req, res, ctx) => {
      const actor = requireAuth(req, ctx);
      const doc = await getDocument(ctx, req.params.id!);
      requireOwnerOrTeamOwner(actor, doc);
      requireDraft(doc);
      const existing = await ctx.pool.query("SELECT * FROM recipients WHERE id = $1 AND document_id = $2", [req.params.recipientId, doc.id]);
      if (existing.rows.length === 0) throw err(404, "not_found");
      const current = recipientRow(existing.rows[0]);
      const body = req.body as { name?: unknown; email?: unknown };
      const name = body.name !== undefined ? (typeof body.name === "string" ? body.name.trim() : "") : current.name;
      const email = body.email !== undefined ? (typeof body.email === "string" ? body.email.trim().toLowerCase() : "") : current.email;
      const invalid: Record<string, string> = {};
      if (body.name !== undefined && name === "") invalid.name = COPY.name;
      if (body.email !== undefined && !isValidEmail(email)) invalid.email = COPY.emailInvalid;
      if (Object.keys(invalid).length === 0 && body.email !== undefined) {
        const dup = await ctx.pool.query("SELECT 1 FROM recipients WHERE document_id = $1 AND lower(email) = $2 AND id <> $3", [doc.id, email, current.id]);
        if (dup.rows.length > 0) invalid.email = COPY.emailDuplicate;
      }
      if (Object.keys(invalid).length > 0) throw validation(invalid);
      const updated = await withTransaction(ctx.pool, async (client) => {
        const ins = await client.query("UPDATE recipients SET name = $2, email = $3 WHERE id = $1 RETURNING *", [current.id, name, email]);
        await touchDocument(client, doc.id);
        return recipientRow(ins.rows[0]);
      });
      ctx.live.publishDocument(doc.id, { type: "document", id: doc.id });
      json(res, 200, recipientJson(updated));
    },
  },
  {
    method: "DELETE", pattern: "/api/documents/:id/recipients/:recipientId",
    handler: async (req, res, ctx) => {
      const actor = requireAuth(req, ctx);
      const doc = await getDocument(ctx, req.params.id!);
      requireOwnerOrTeamOwner(actor, doc);
      requireDraft(doc);
      await withTransaction(ctx.pool, async (client) => {
        const del = await client.query('DELETE FROM recipients WHERE id = $1 AND document_id = $2 RETURNING "order"', [req.params.recipientId, doc.id]);
        if (del.rows.length === 0) throw err(404, "not_found");
        await client.query('UPDATE recipients SET "order" = "order" - 1 WHERE document_id = $1 AND "order" > $2', [doc.id, Number(del.rows[0].order)]);
        await touchDocument(client, doc.id);
      });
      ctx.live.publishDocument(doc.id, { type: "document", id: doc.id });
      json(res, 204, {});
    },
  },
  {
    method: "POST", pattern: "/api/documents/:id/recipients/:recipientId/move",
    handler: async (req, res, ctx) => {
      const actor = requireAuth(req, ctx);
      const doc = await getDocument(ctx, req.params.id!);
      requireOwnerOrTeamOwner(actor, doc);
      requireDraft(doc);
      const body = req.body as { direction?: unknown };
      const direction = body.direction;
      if (direction !== "up" && direction !== "down") throw err(422, "validation", { fields: { direction: COPY.kind } });
      const all = await withTransaction(ctx.pool, async (client) => {
        const rec = await client.query("SELECT id, \"order\" FROM recipients WHERE id = $1 AND document_id = $2 FOR UPDATE", [req.params.recipientId, doc.id]);
        if (rec.rows.length === 0) throw err(404, "not_found");
        const order = Number(rec.rows[0].order);
        const total = Number((await client.query<{ count: string }>("SELECT count(*) AS count FROM recipients WHERE document_id = $1", [doc.id])).rows[0].count);
        const target = direction === "up" ? order - 1 : order + 1;
        if (target < 1 || target > total) throw err(409, "cannot_move");
        await client.query('UPDATE recipients SET "order" = "order" + $2 WHERE document_id = $1 AND "order" = $3', [doc.id, direction === "up" ? 1 : -1, target]);
        await client.query('UPDATE recipients SET "order" = $2 WHERE document_id = $1 AND id = $3', [doc.id, target, req.params.recipientId]);
        await touchDocument(client, doc.id);
        return getRecipients(client, doc.id);
      });
      ctx.live.publishDocument(doc.id, { type: "document", id: doc.id });
      json(res, 200, { recipients: all.map(recipientJson) });
    },
  },
  {
    method: "POST", pattern: "/api/documents/:id/fields",
    handler: async (req, res, ctx) => {
      const actor = requireAuth(req, ctx);
      const doc = await getDocument(ctx, req.params.id!);
      requireOwnerOrTeamOwner(actor, doc);
      requireDraft(doc);
      const body = req.body as Record<string, unknown>;
      const recipients = await getRecipients(ctx.pool, doc.id);
      const target = recipients.find((r) => r.id === body.recipientId);
      if (!target) throw err(404, "not_found");
      const kind = String(body.kind ?? "");
      if (!["signature", "initials", "date", "text"].includes(kind)) throw validation({ kind: COPY.kind });
      const page = Number(body.page);
      const x = Number(body.x), y = Number(body.y), w = Number(body.w), h = Number(body.h);
      if (!Number.isInteger(page) || page < 1 || page > doc.pageCount || geometryBreaksRules(x, y, w, h)) {
        throw validation({ geometry: COPY.geometry });
      }
      const existingFields = await getFields(ctx.pool, doc.id);
      const kindCount = existingFields.filter((f) => f.kind === kind).length + 1;
      let label = `${kindLabel(kind)} ${kindCount}`;
      if (body.label !== undefined && typeof body.label === "string" && body.label.trim() !== "") {
        label = body.label.trim();
      }
      if (cpLength(label) < 1 || cpLength(label) > 40) throw validation({ label: COPY.label });
      const required = body.required === undefined ? true : Boolean(body.required);
      const clamped = clampGeometry(page, x, y, w, h);
      const created = await withTransaction(ctx.pool, async (client) => {
        const ins = await client.query(
          "INSERT INTO fields (document_id, recipient_id, kind, label, required, page, x, y, w, h) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *",
          [doc.id, target.id, kind, label, required, clamped.page, clamped.x, clamped.y, clamped.w, clamped.h],
        );
        await touchDocument(client, doc.id);
        return fieldRow(ins.rows[0]);
      });
      ctx.live.publishDocument(doc.id, { type: "document", id: doc.id });
      json(res, 201, fieldJson(created));
    },
  },
  {
    method: "PATCH", pattern: "/api/documents/:id/fields/:fieldId",
    handler: async (req, res, ctx) => {
      const actor = requireAuth(req, ctx);
      const doc = await getDocument(ctx, req.params.id!);
      requireOwnerOrTeamOwner(actor, doc);
      requireDraft(doc);
      const existing = await ctx.pool.query("SELECT * FROM fields WHERE id = $1 AND document_id = $2", [req.params.fieldId, doc.id]);
      if (existing.rows.length === 0) throw err(404, "not_found");
      const current = fieldRow(existing.rows[0]);
      const body = req.body as Record<string, unknown>;
      const invalid: Record<string, string> = {};
      if (body.recipientId !== undefined) {
        const exists = await ctx.pool.query("SELECT 1 FROM recipients WHERE id = $1 AND document_id = $2", [body.recipientId, doc.id]);
        if (exists.rows.length === 0) throw err(404, "not_found");
      }
      let label = current.label;
      if (body.label !== undefined) {
        label = typeof body.label === "string" ? body.label.trim() : "";
        if (cpLength(label) < 1 || cpLength(label) > 40) invalid.label = COPY.label;
      }
      const page = body.page !== undefined ? Number(body.page) : current.page;
      const x = body.x !== undefined ? Number(body.x) : current.x;
      const y = body.y !== undefined ? Number(body.y) : current.y;
      const w = body.w !== undefined ? Number(body.w) : current.w;
      const h = body.h !== undefined ? Number(body.h) : current.h;
      if (!Number.isInteger(page) || page < 1 || page > doc.pageCount || geometryBreaksRules(x, y, w, h)) {
        invalid.geometry = COPY.geometry;
      }
      if (Object.keys(invalid).length > 0) throw validation(invalid);
      const clamped = clampGeometry(page, x, y, w, h);
      const recipientId = body.recipientId !== undefined ? String(body.recipientId) : current.recipientId;
      const required = body.required !== undefined ? Boolean(body.required) : current.required;
      const updated = await withTransaction(ctx.pool, async (client) => {
        const ins = await client.query(
          "UPDATE fields SET recipient_id = $2, label = $3, required = $4, page = $5, x = $6, y = $7, w = $8, h = $9 WHERE id = $1 RETURNING *",
          [current.id, recipientId, label, required, clamped.page, clamped.x, clamped.y, clamped.w, clamped.h],
        );
        await touchDocument(client, doc.id);
        return fieldRow(ins.rows[0]);
      });
      ctx.live.publishDocument(doc.id, { type: "document", id: doc.id });
      json(res, 200, fieldJson(updated));
    },
  },
  {
    method: "DELETE", pattern: "/api/documents/:id/fields/:fieldId",
    handler: async (req, res, ctx) => {
      const actor = requireAuth(req, ctx);
      const doc = await getDocument(ctx, req.params.id!);
      requireOwnerOrTeamOwner(actor, doc);
      requireDraft(doc);
      await withTransaction(ctx.pool, async (client) => {
        const del = await client.query("DELETE FROM fields WHERE id = $1 AND document_id = $2 RETURNING id", [req.params.fieldId, doc.id]);
        if (del.rows.length === 0) throw err(404, "not_found");
        await touchDocument(client, doc.id);
      });
      ctx.live.publishDocument(doc.id, { type: "document", id: doc.id });
      json(res, 204, {});
    },
  },
];

export function buildRoutes(): Route[] {
  return [...sessionRoutes, ...documentRoutes, ...flowRoutes];
}
