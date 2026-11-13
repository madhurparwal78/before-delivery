import type { Route } from "./http.js";
import { json } from "./respond.js";
import { err, withTransaction, type Ctx } from "./core.js";
import { COPY } from "./copy.js";
import { getFields, hashPassword, hashToken, newToken, loadDocumentBundle } from "./documents.js";
import { writeAudit } from "./audit.js";
import { originalKey } from "./keys.js";
import { sha256Hex } from "./outbox.js";
import { sampleBytes } from "./samples.js";
import { checkPdfBytes } from "./pdfcheck.js";
import { deliver } from "./outbox.js";
import { dateInZone } from "./util.js";
import { sealDocument } from "./seal.js";
import type { PoolClient } from "pg";
import type { FieldKind } from "./domain.js";

interface SetupBody {
  teams?: SetupTeam[];
  documents?: SetupDocument[];
}
interface SetupTeam {
  name?: unknown;
  members?: { email?: unknown; name?: unknown; password?: unknown; role?: unknown }[];
}
interface SetupDocument {
  title?: unknown;
  team?: unknown;
  owner?: unknown;
  sample?: unknown;
  timeZone?: unknown;
  recipients?: { name?: unknown; email?: unknown }[];
  fields?: { recipient?: unknown; kind?: unknown; page?: unknown; x?: unknown; y?: unknown; w?: unknown; h?: unknown; required?: unknown }[];
  state?: unknown;
  signed?: unknown;
}

export function buildGradingRoutes(): Route[] {
  return [
    {
      method: "GET", pattern: "/api/grading/samples/:name",
      handler: async (req, res, _ctx) => {
        const bytes = sampleBytes(req.params.name!);
        if (bytes === null) throw err(404, "not_found");
        res.writeHead(200, { "content-type": "application/pdf", "content-length": bytes.length });
        res.end(bytes);
      },
    },
    {
      method: "POST", pattern: "/api/grading/setup",
      handler: async (req, res, ctx) => {
        const key = req.headers["x-grading-key"];
        const provided = Array.isArray(key) ? key[0] : key;
        if (ctx.cfg.gradingKey === null || provided !== ctx.cfg.gradingKey) {
          throw err(404, "not_found");
        }
        const body = (req.body ?? {}) as SetupBody;
        const teamsOut: { name: string; id: string }[] = [];
        const usersOut: { email: string; id: string }[] = [];
        const docsOut: { title: string; id: string }[] = [];

        const teamIdByName = new Map<string, string>();
        const userIdByEmail = new Map<string, string>();
        const seededDate = new Date();

        // validate teams
        const teamList = Array.isArray(body.teams) ? body.teams : [];
        for (const team of teamList) {
          const name = typeof team.name === "string" ? team.name : "";
          if (name === "") throw err(422, "validation", { fields: { teams: "Enter a name." } });
        }
        // check email conflicts
        const allEmails: string[] = [];
        for (const team of teamList) {
          for (const m of team.members ?? []) {
            const email = typeof m.email === "string" ? m.email.trim().toLowerCase() : "";
            if (allEmails.includes(email)) throw err(409, "email_taken");
            allEmails.push(email);
          }
        }
        for (const email of allEmails) {
          const exists = await ctx.pool.query("SELECT 1 FROM users WHERE lower(email) = $1", [email]);
          if (exists.rows.length > 0) throw err(409, "email_taken");
        }

        for (const team of teamList) {
          const teamName = String(team.name);
          const teamId = crypto.randomUUID();

          await withTransaction(ctx.pool, async (client) => {
            await client.query("INSERT INTO teams (id, name) VALUES ($1, $2)", [teamId, teamName]);
            for (const m of team.members ?? []) {
              const email = String(m.email).trim().toLowerCase();
              const name = String(m.name);
              const password = String(m.password ?? "");
              const role = m.role === "owner" || m.role === "member" || m.role === "viewer" ? m.role : "member";
              const hash = await hashPassword(password);
              const ins = await client.query(
                "INSERT INTO users (team_id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id",
                [teamId, email, name, hash, role],
              );
              userIdByEmail.set(email, ins.rows[0].id);
              usersOut.push({ email, id: ins.rows[0].id });
            }
          });
          teamIdByName.set(teamName, teamId);
          teamsOut.push({ name: teamName, id: teamId });
        }

        for (const doc of Array.isArray(body.documents) ? body.documents : []) {
          const title = typeof doc.title === "string" ? doc.title : "";
          if (title === "") throw err(422, "validation", { fields: { title: COPY.titleLength } });
          const teamName = String(doc.team);
          const teamId = teamIdByName.get(teamName);
          if (!teamId) throw err(422, "validation", { fields: { team: "Enter a name." } });
          const ownerEmail = String(doc.owner).trim().toLowerCase();
          const ownerId = userIdByEmail.get(ownerEmail);
          if (!ownerId) throw err(422, "validation", { fields: { owner: "Enter a name." } });
          const sample = String(doc.sample);
          const sampleBytesBuffer = sampleBytes(sample);
          if (sampleBytesBuffer === null) throw err(422, "validation", { fields: { sample: COPY.file } });
          const check = checkPdfBytes(sampleBytesBuffer);
          if (typeof check !== "number") throw err(422, "validation", { fields: { sample: COPY.file } });
          const timeZone = typeof doc.timeZone === "string" ? doc.timeZone : "UTC";
          const state = String(doc.state);
          const signedCount = Number(doc.signed ?? 0);
          const documentId = crypto.randomUUID();
          const hash = sha256Hex(sampleBytesBuffer);
          // A seeded document needs its original in object storage.
          if (!ctx.health.storageOk) {
            throw err(503, "storage_unavailable");
          }
          await ctx.storage.put(originalKey(documentId), sampleBytesBuffer);
          const recipients = (doc.recipients ?? []).map((r, i) => ({
            name: String(r.name), email: String(r.email).trim().toLowerCase(), order: i + 1,
          }));
          const fields = (doc.fields ?? []).map((f) => ({
            recipient: Number(f.recipient), kind: String(f.kind) as FieldKind,
            page: Number(f.page), x: Number(f.x), y: Number(f.y), w: Number(f.w), h: Number(f.h),
            required: f.required === undefined ? true : Boolean(f.required),
          }));
          await withTransaction(ctx.pool, async (client) => {
            await client.query(
              "INSERT INTO documents (id, team_id, owner_id, title, status, page_count, original_sha256, version, time_zone) VALUES ($1, $2, $3, $4, 'draft', $5, $6, 1, $7)",
              [documentId, teamId, ownerId, title, check, hash, timeZone],
            );
            await writeAudit(client, documentId, "document.created", ownerEmail, null, seededDate);
            const recipientIds: string[] = [];
            for (const r of recipients) {
              const ins = await client.query(
                'INSERT INTO recipients (document_id, name, email, "order", status) VALUES ($1, $2, $3, $4, \'waiting\') RETURNING id',
                [documentId, r.name, r.email, r.order],
              );
              recipientIds.push(ins.rows[0].id);
            }
            for (const f of fields) {
              const rid = recipientIds[f.recipient - 1];
              if (!rid) continue;
              await client.query(
                "INSERT INTO fields (document_id, recipient_id, kind, label, required, page, x, y, w, h) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
                [documentId, rid, f.kind, `${f.kind[0].toUpperCase()}${f.kind.slice(1)} ${fields.indexOf(f) + 1}`, f.required, f.page, f.x, f.y, f.w, f.h],
              );
            }
          });
          docsOut.push({ title, id: documentId });

          // State seeding
          if (state === "draft") continue;
          const docRow0 = await loadDocumentBundle({ ...ctx, actor: null }, documentId);
          const recipientsAll = docRow0.recipients;

          if (state === "in_progress" || state === "completed" || state === "declined" || state === "voided") {
            await seedSendFlow(ctx, documentId, ownerEmail, recipientsAll, signedCount, state, timeZone);
          }
        }
        json(res, 201, { teams: teamsOut, users: usersOut, documents: docsOut });
      },
    },
  ];
}

async function seedSendFlow(
  ctx: Ctx,
  documentId: string,
  ownerEmail: string,
  recipients: { id: string; name: string; email: string; order: number }[],
  signedCount: number,
  state: string,
  timeZone: string,
): Promise<void> {
  const seedAt = new Date();
  await withTransaction(ctx.pool, async (client) => {
    await client.query("UPDATE documents SET status = 'in_progress', current_order = 1 WHERE id = $1", [documentId]);
    await writeAudit(client, documentId, "document.sent", ownerEmail, null, seedAt);
  });
  // Sign the first `signedCount` recipients in turn
  for (let i = 0; i < Math.min(signedCount, recipients.length); i++) {
    const r = recipients[i];
    await withTransaction(ctx.pool, async (client) => {
      await seedInvite(ctx, client, documentId, r, seedAt);
    });
    const fields = await getFields(ctx.pool, documentId);
    const mine = fields.filter((f) => f.recipientId === r.id);
    const signAt = new Date(seedAt.getTime() + (i + 1) * 1000);
    await withTransaction(ctx.pool, async (client) => {
      for (const f of mine) {
        if (f.kind === "date") {
          await client.query("UPDATE fields SET value = $2 WHERE id = $1", [f.id, dateInZone(signAt, timeZone)]);
        } else if (f.kind === "signature" || f.kind === "initials") {
          await client.query("UPDATE fields SET value = $2 WHERE id = $1", [f.id, `typed:${r.name}`]);
        } else if (f.kind === "text" && f.required) {
          await client.query("UPDATE fields SET value = $2 WHERE id = $1", [f.id, r.name]);
        }
      }
      await client.query("UPDATE recipients SET status = 'signed', signed_at = $2, delivery = 'sent' WHERE id = $1", [r.id, signAt]);
      await writeAudit(client, documentId, "recipient.signed", r.email, r.id, signAt);
    });
  }
  const signed = Math.min(signedCount, recipients.length);
  if (state === "in_progress") {
    if (signed < recipients.length) {
      const next = recipients[signed];
      await withTransaction(ctx.pool, async (client) => {
        await client.query("UPDATE documents SET current_order = $2 WHERE id = $1", [documentId, next.order]);
        await seedInvite(ctx, client, documentId, next, new Date());
      });
    }
  } else if (state === "completed") {
    await withTransaction(ctx.pool, async (client) => {
      await client.query("UPDATE documents SET status = 'sealing', current_order = NULL WHERE id = $1", [documentId]);
    });
    await sealDocument(ctx, documentId);
  } else if (state === "declined") {
    const decliner = recipients[Math.min(signed, recipients.length - 1)];
    await withTransaction(ctx.pool, async (client) => {
      await client.query("UPDATE recipients SET status = 'declined', decline_reason = 'Seeded decline' WHERE id = $1", [decliner.id]);
      await client.query("UPDATE documents SET status = 'declined', declined_by_recipient_id = $2, declined_by_name = $3, current_order = NULL WHERE id = $1", [documentId, decliner.id, decliner.name]);
      await client.query("UPDATE recipients SET binding = false WHERE document_id = $1", [documentId]);
      await writeAudit(client, documentId, "recipient.declined", decliner.email, decliner.id, new Date());
    });
  } else if (state === "voided") {
    await withTransaction(ctx.pool, async (client) => {
      await client.query("UPDATE documents SET status = 'voided', void_reason = 'Seeded void', voided_by = $2, current_order = NULL WHERE id = $1", [documentId, "Owner"]);
      await client.query("UPDATE recipients SET binding = false WHERE document_id = $1", [documentId]);
      await writeAudit(client, documentId, "document.voided", ownerEmail, null, new Date());
    });
  }
}

async function seedInvite(ctx: Ctx, client: PoolClient, documentId: string, r: { id: string; name: string; email: string }, at: Date): Promise<void> {
  const docRow = (await client.query("SELECT * FROM documents WHERE id = $1", [documentId])).rows[0];
  const expires = new Date(at.getTime() + ctx.cfg.linkTtlSeconds * 1000);
  const token = newToken();
  await client.query("UPDATE link_tokens SET superseded = true WHERE recipient_id = $1", [r.id]);
  await client.query("INSERT INTO link_tokens (recipient_id, document_id, token) VALUES ($1, $2, $3)", [r.id, documentId, token]);
  await client.query("UPDATE recipients SET link_hash = $2 WHERE id = $1", [r.id, hashToken(token)]);
  const outcome = await deliver(ctx, {
    kind: "invite", to: r.email, subject: `Please sign: ${docRow.title}`,
    body: `Open the document: ${ctx.cfg.publicUrl}/sign/${token}`,
    documentId, senderName: null,
  });
  await client.query(
    "UPDATE recipients SET status = 'invited', turn_started_at = $2, link_expires_at = $3, delivery = $4 WHERE id = $1",
    [r.id, at, expires, outcome],
  );
  await writeAudit(client, documentId, outcome === "sent" ? "invite.sent" : "invite.held", "system", r.id, at);
}
