import type { Route } from "./http.js";
import { json, requireAuth } from "./respond.js";
import { err, withTransaction, type Ctx } from "./core.js";
import { COPY } from "./copy.js";
import { getDocument, getFields, getRecipients, loadDocumentBundle } from "./documents.js";
import { sha256Hex } from "./outbox.js";
import { writeAudit } from "./audit.js";
import { templateOriginalKey, originalKey } from "./keys.js";
import { isValidEmail } from "./util.js";
import type { DocumentRow, Recipient } from "./domain.js";

export function buildTeamRoutes(): Route[] {
  return [
    {
      method: "GET", pattern: "/api/team",
      handler: async (req, res, ctx) => {
        const actor = requireAuth(req, ctx);
        const team = await ctx.pool.query<{ id: string; name: string }>("SELECT id, name FROM teams WHERE id = $1", [actor.teamId]);
        const members = await ctx.pool.query("SELECT id, email, name, role FROM users WHERE team_id = $1 ORDER BY created_at", [actor.teamId]);
        json(res, 200, {
          id: team.rows[0].id,
          name: team.rows[0].name,
          members: members.rows,
        });
      },
    },
    {
      method: "PATCH", pattern: "/api/team/members/:userId",
      handler: async (req, res, ctx) => {
        const actor = requireAuth(req, ctx);
        if (actor.role !== "owner") throw err(403, "forbidden");
        const body = req.body as { role?: unknown };
        const role = body.role;
        if (role !== "owner" && role !== "member" && role !== "viewer") {
          throw err(422, "validation", { fields: { role: COPY.kind } });
        }
        const target = await ctx.pool.query("SELECT id, role, team_id FROM users WHERE id = $1", [req.params.userId]);
        if (target.rows.length === 0 || target.rows[0].team_id !== actor.teamId) throw err(404, "not_found");
        if (target.rows[0].role === "owner" && role !== "owner") {
          const owners = await ctx.pool.query<{ count: string }>("SELECT count(*) AS count FROM users WHERE team_id = $1 AND role = 'owner'", [actor.teamId]);
          if (Number(owners.rows[0].count) <= 1) throw err(409, "last_owner");
        }
        const updated = await ctx.pool.query("UPDATE users SET role = $2 WHERE id = $1 RETURNING id, email, name, role", [req.params.userId, role]);
        ctx.live.publishTeam(actor.teamId, { type: "role", userId: req.params.userId, role });
        ctx.live.publishTeam(actor.teamId, { type: "documents" });
        json(res, 200, updated.rows[0]);
      },
    },
  ];
}

export function buildTemplateRoutes(): Route[] {
  return [
    {
      method: "GET", pattern: "/api/templates",
      handler: async (req, res, ctx) => {
        const actor = requireAuth(req, ctx);
        const rows = actor.role === "owner"
          ? await ctx.pool.query("SELECT * FROM templates WHERE team_id = $1 ORDER BY created_at", [actor.teamId])
          : await ctx.pool.query("SELECT * FROM templates WHERE team_id = $1 AND status = 'shared' ORDER BY created_at", [actor.teamId]);
        const out = [];
        for (const row of rows.rows) {
          const fields = await ctx.pool.query("SELECT * FROM template_fields WHERE template_id = $1", [row.id]);
          out.push(templateJson(row, fields.rows));
        }
        json(res, 200, { templates: out });
      },
    },
    {
      method: "GET", pattern: "/api/templates/:id",
      handler: async (req, res, ctx) => {
        const actor = requireAuth(req, ctx);
        const row = await ctx.pool.query("SELECT * FROM templates WHERE id = $1", [req.params.id]);
        if (row.rows.length === 0 || row.rows[0].team_id !== actor.teamId) throw err(404, "not_found");
        if (actor.role !== "owner" && row.rows[0].status !== "shared") throw err(404, "not_found");
        const fields = await ctx.pool.query("SELECT * FROM template_fields WHERE template_id = $1", [row.rows[0].id]);
        json(res, 200, templateJson(row.rows[0], fields.rows));
      },
    },
    {
      method: "POST", pattern: "/api/documents/:id/template",
      handler: async (req, res, ctx) => {
        const actor = requireAuth(req, ctx);
        if (actor.role !== "owner") throw err(403, "forbidden");
        const doc = await getDocument(ctx, req.params.id!);
        const recipients = await getRecipients(ctx.pool, doc.id);
        const fields = await getFields(ctx.pool, doc.id);
        const templateId = crypto.randomUUID();
        // Copy original
        const original = await ctx.storage.get(originalKey(doc.id));
        if (!original.exists) throw err(503, "storage_unavailable");
        await ctx.storage.put(templateOriginalKey(templateId), original.body);
        await withTransaction(ctx.pool, async (client) => {
          await client.query(
            "INSERT INTO templates (id, team_id, owner_id, name, status, page_count) VALUES ($1, $2, $3, $4, 'draft', $5)",
            [templateId, doc.teamId, actor.userId, doc.title, doc.pageCount],
          );
          await client.query("INSERT INTO template_originals (template_id, stored) VALUES ($1, true)", [templateId]);
          const orderById = new Map(recipients.map((r) => [r.id, r.order]));
          for (const f of fields) {
            await client.query(
              "INSERT INTO template_fields (template_id, signer, kind, label, required, page, x, y, w, h) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
              [templateId, orderById.get(f.recipientId) ?? 1, f.kind, f.label, f.required, f.page, f.x, f.y, f.w, f.h],
            );
          }
        });
        const row = await ctx.pool.query("SELECT * FROM templates WHERE id = $1", [templateId]);
        const tFields = await ctx.pool.query("SELECT * FROM template_fields WHERE template_id = $1", [templateId]);
        json(res, 201, templateJson(row.rows[0], tFields.rows));
      },
    },
    {
      method: "POST", pattern: "/api/templates/:id/share",
      handler: async (req, res, ctx) => {
        const actor = requireAuth(req, ctx);
        if (actor.role !== "owner") throw err(403, "forbidden");
        await transitionTemplate(ctx, req.params.id!, "draft", "shared");
        const row = await ctx.pool.query("SELECT * FROM templates WHERE id = $1", [req.params.id]);
        const tFields = await ctx.pool.query("SELECT * FROM template_fields WHERE template_id = $1", [req.params.id]);
        json(res, 200, templateJson(row.rows[0], tFields.rows));
      },
    },
    {
      method: "POST", pattern: "/api/templates/:id/retire",
      handler: async (req, res, ctx) => {
        const actor = requireAuth(req, ctx);
        if (actor.role !== "owner") throw err(403, "forbidden");
        await transitionTemplate(ctx, req.params.id!, "shared", "retired");
        const row = await ctx.pool.query("SELECT * FROM templates WHERE id = $1", [req.params.id]);
        const tFields = await ctx.pool.query("SELECT * FROM template_fields WHERE template_id = $1", [req.params.id]);
        json(res, 200, templateJson(row.rows[0], tFields.rows));
      },
    },
    {
      method: "POST", pattern: "/api/templates/:id/use",
      handler: async (req, res, ctx) => {
        const actor = requireAuth(req, ctx);
        if (actor.role === "viewer") throw err(403, "forbidden");
        const tpl = await ctx.pool.query("SELECT * FROM templates WHERE id = $1", [req.params.id]);
        if (tpl.rows.length === 0 || tpl.rows[0].team_id !== actor.teamId) throw err(404, "not_found");
        if (tpl.rows[0].status !== "shared") throw err(409, "invalid_state", { status: tpl.rows[0].status });
        const body = req.body as { signers?: unknown };
        const signers = Array.isArray(body.signers) ? body.signers : [];
        const invalid: Record<string, string> = {};
        const cleaned: { name: string; email: string }[] = [];
        for (const s of signers) {
          const rec = s as { name?: unknown; email?: unknown };
          const name = typeof rec.name === "string" ? rec.name.trim() : "";
          const email = typeof rec.email === "string" ? rec.email.trim().toLowerCase() : "";
          if (name === "" || !isValidEmail(email)) { invalid.signers = COPY.signers; break; }
          cleaned.push({ name, email });
        }


        const signerOrders = new Set<string>();
        for (const s of signers) { signerOrders.add(String((s as { order?: unknown }).order ?? "")); }
        const tFieldRows = (await ctx.pool.query("SELECT * FROM template_fields WHERE template_id = $1", [req.params.id])).rows;

        const recipientCount = await ctx.pool.query<{ max: number | null }>(
          "SELECT max(signer) AS max FROM template_fields WHERE template_id = $1", [req.params.id]);
        const needed = Number(recipientCount.rows[0]?.max ?? 0);
        if (cleaned.length !== needed) invalid.signers = COPY.signers;
        if (Object.keys(invalid).length > 0) throw err(422, "validation", { fields: invalid });
        const documentId = crypto.randomUUID();
        const original = await ctx.storage.get(templateOriginalKey(req.params.id!));
        if (!original.exists) throw err(503, "storage_unavailable");
        await ctx.storage.put(originalKey(documentId), original.body);
        const hash = sha256Hex(original.body);
        const created = await withTransaction(ctx.pool, async (client) => {
          await client.query(
            "INSERT INTO documents (id, team_id, owner_id, title, status, page_count, original_sha256, version) VALUES ($1, $2, $3, $4, 'draft', $5, $6, 1)",
            [documentId, actor.teamId, actor.userId, tpl.rows[0].name, tpl.rows[0].page_count, hash],
          );
          await writeAudit(client, documentId, "document.created", actor.email, null, new Date());
          const recipientIds: string[] = [];
          for (const s of cleaned) {
            const ins = await client.query(
              'INSERT INTO recipients (document_id, name, email, "order", status) VALUES ($1, $2, $3, $4, \'waiting\') RETURNING id',
              [documentId, s.name, s.email, cleaned.indexOf(s) + 1],
            );
            recipientIds.push(ins.rows[0].id);
          }
          for (const f of tFieldRows) {
            const recipientId = recipientIds[Number(f.signer) - 1];
            if (!recipientId) continue;
            await client.query(
              "INSERT INTO fields (document_id, recipient_id, kind, label, required, page, x, y, w, h) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
              [documentId, recipientId, f.kind, f.label, f.required, f.page, f.x, f.y, f.w, f.h],
            );
          }
          return documentId;
        });
        ctx.live.publishTeam(actor.teamId, { type: "documents" });
        const bundle = await loadDocumentBundle(ctx, created);
        json(res, 201, jsonDoc(bundle.doc, bundle.recipients, bundle.fields));
      },
    },
  ];
}

function jsonDoc(doc: DocumentRow, recipients: Recipient[], fields: unknown[]): Record<string, unknown> {
  return {
    id: doc.id, title: doc.title, status: doc.status, teamId: doc.teamId, ownerId: doc.ownerId,
    timeZone: doc.timeZone, pageCount: doc.pageCount, originalSha256: doc.originalSha256,
    completedSha256: doc.completedSha256, version: doc.version, currentOrder: doc.currentOrder,
    reminderAvailableAt: doc.reminderAvailableAt === null ? null : doc.reminderAvailableAt.toISOString(),
    recipients: recipients.map((r) => ({
      id: r.id, name: r.name, email: r.email, order: r.order, status: r.status,
      delivery: r.delivery, linkExpiresAt: r.linkExpiresAt === null ? null : r.linkExpiresAt.toISOString(),
      signedAt: r.signedAt === null ? null : r.signedAt.toISOString(),
      declineReason: r.declineReason, binding: r.binding,
    })),
    fields,
  };
}

async function transitionTemplate(ctx: Ctx, id: string, from: string, to: string): Promise<void> {
  const updated = await withTransaction(ctx.pool, async (client) => {
    const row = await client.query("SELECT team_id, status FROM templates WHERE id = $1 FOR UPDATE", [id]);
    if (row.rows.length === 0) throw err(404, "not_found");
    if (row.rows[0].status !== from) throw err(409, "invalid_state", { status: row.rows[0].status });
    await client.query("UPDATE templates SET status = $2 WHERE id = $1", [id, to]);
    return row.rows[0].team_id;
  });
  ctx.live.publishTeam(updated, { type: "templates" });
}

function templateJson(row: Record<string, unknown>, fields: Record<string, unknown>[]): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    pageCount: Number(row.page_count),
    signerCount: fields.length > 0 ? Math.max(...fields.map((f) => Number(f.signer))) : 0,
    fields: fields.map((f) => ({
      signer: Number(f.signer), kind: f.kind, label: f.label, required: f.required,
      page: Number(f.page), x: Number(f.x), y: Number(f.y), w: Number(f.w), h: Number(f.h),
    })),
  };
}
