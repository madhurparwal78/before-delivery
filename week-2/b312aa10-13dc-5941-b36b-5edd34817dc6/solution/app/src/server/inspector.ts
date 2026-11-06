// Inspector links: time-limited, read-only access to one kitchen's records, with an unchangeable
// access record for every successful request.

import { randomBytes } from "node:crypto";
import type pg from "pg";
import { pool, tx } from "./db.js";
import { apiError, forbidden, notFound, refuseInvalid, route, type Reply } from "./http.js";
import { BODIES, bodyObject, keyErrors, refuseAnyKey } from "./bodies.js";
import { EMAIL } from "./text.js";
import { tokenHash, type Session } from "./auth.js";
import { queueMail } from "./mail.js";
import { currentDocuments, documentFile, documentStatus, memberDocuments } from "./documents.js";
import { entriesBetween, entryJson, reportFile } from "./sanitation.js";
import { addDays, isoWithOffset, localDateOf, localStamp, startOfDay } from "../shared/time.js";

const MAX_DAYS = 30;
const LOG_DAYS = 90;

interface LinkRow { id: string; kitchen_id: string; email: string; expires_at: Date; revoked_at: Date | null; created_at: Date }

const linkStatus = (l: LinkRow): string => (l.revoked_at ? "revoked" : Date.now() >= l.expires_at.getTime() ? "expired" : "active");

async function linkJson(l: LinkRow, zone: string, url?: string): Promise<Record<string, unknown>> {
  const { rows } = await pool.query("SELECT at, action, target FROM inspector_access WHERE link_id = $1 ORDER BY at DESC, id DESC", [l.id]);
  const access = rows.map((r) => ({ at: isoWithOffset((r.at as Date).getTime(), zone), action: r.action, target: r.target }));
  return {
    id: l.id, email: l.email, expiresAt: isoWithOffset(l.expires_at.getTime(), zone), status: linkStatus(l),
    lastAccessAt: access[0]?.at ?? null, views: access.filter((a) => a.action === "view").length,
    downloads: access.filter((a) => a.action !== "view").length, access: access.slice(0, 50), ...(url ? { url } : {}),
  };
}

/**
 * Retires the link's live token and issues a new one with its invitation, under the link's row lock,
 * so after concurrent regenerations only the last one to complete opens the link.
 */
async function issueToken(client: pg.PoolClient, s: Session, link: LinkRow, origin: string): Promise<string> {
  await client.query("SELECT 1 FROM inspector_links WHERE id = $1 FOR UPDATE", [link.id]);
  await client.query("UPDATE inspector_tokens SET retired_at = clock_timestamp() WHERE link_id = $1 AND retired_at IS NULL", [link.id]);
  const token = randomBytes(32).toString("base64url");
  await client.query("INSERT INTO inspector_tokens (token_hash, link_id) VALUES ($1, $2)", [tokenHash(token), link.id]);
  const url = `${origin}/inspect/${token}`;
  await invite(client, s, link, url);
  return url;
}

async function invite(client: pg.PoolClient, s: Session, l: LinkRow, url: string): Promise<void> {
  await queueMail(client, l.email, `Read-only kitchen records: ${s.kitchen.name}`, [
    `${s.kitchen.name} has shared its sanitation log and current member certificates with you.`,
    "",
    `Open the records: ${url}`,
    "",
    `The link is read-only and works until ${localStamp(l.expires_at.getTime(), s.kitchen.timeZone)} (${s.kitchen.timeZone}).`,
  ]);
}

async function ownLink(s: Session, id: string): Promise<LinkRow> {
  const { rows } = await pool.query("SELECT * FROM inspector_links WHERE id = $1 AND kitchen_id = $2", [id, s.kitchen.id]);
  if (!rows[0]) throw notFound();
  if (s.person.role !== "operator") throw forbidden();
  return rows[0];
}

route("POST", "/api/inspector-links", async (ctx) => {
  const s = ctx.session!;
  if (s.person.role !== "operator") throw forbidden();
  const body = bodyObject(ctx.body);
  const errors = keyErrors(Object.keys(body), BODIES.inspectorLink);
  const email = typeof body.email === "string" ? body.email : "";
  if (!errors.email && (!EMAIL.test(email) || email.length > 254)) errors.email = "Enter a valid email address.";
  const raw = body.expiresAt;
  const at = typeof raw === "string" && /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(raw) ? Date.parse(raw) : Number.NaN;
  if (!errors.expiresAt && !(at > Date.now() && at <= Date.now() + MAX_DAYS * 86_400_000)) errors.expiresAt = "Choose an expiry in the future, at most 30 days away.";
  refuseInvalid(errors);
  const { link, url } = await tx(async (client) => {
    const { rows } = await client.query(
      "INSERT INTO inspector_links (id, kitchen_id, email, expires_at) VALUES ($1, $2, $3, $4) RETURNING *",
      [`lnk_${randomBytes(8).toString("hex")}`, s.kitchen.id, email, new Date(at)],
    );
    return { link: rows[0] as LinkRow, url: await issueToken(client, s, rows[0], ctx.origin) };
  });
  return { status: 201, body: { link: await linkJson(link, s.kitchen.timeZone, url) } };
});

route("GET", "/api/inspector-links", async (ctx) => {
  const s = ctx.session!;
  if (s.person.role !== "operator") throw forbidden();
  const { rows } = await pool.query("SELECT * FROM inspector_links WHERE kitchen_id = $1 ORDER BY created_at DESC, id DESC", [s.kitchen.id]);
  return { status: 200, body: { links: await Promise.all(rows.map((l) => linkJson(l, s.kitchen.timeZone))) } };
});

route("POST", "/api/inspector-links/:id/regenerate", async (ctx) => {
  const s = ctx.session!;
  const link = await ownLink(s, ctx.params.id!);
  refuseAnyKey(ctx.body);
  const url = await tx((client) => issueToken(client, s, link, ctx.origin));
  return { status: 200, body: { link: await linkJson(link, s.kitchen.timeZone, url) } };
});

route("DELETE", "/api/inspector-links/:id", async (ctx) => {
  const s = ctx.session!;
  const link = await ownLink(s, ctx.params.id!);
  const { rows } = await pool.query("UPDATE inspector_links SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1 RETURNING *", [link.id]);
  return { status: 200, body: { link: await linkJson(rows[0], s.kitchen.timeZone) } };
});

interface Holder { link: LinkRow; kitchen: { id: string; name: string; time_zone: string } }

/** Resolves a token to its live link: 404 unknown, 410 revoked or regenerated, 410 expired. */
async function holder(token: string | undefined): Promise<Holder> {
  const { rows } = await pool.query(
    `SELECT t.retired_at, l.*, k.name AS kitchen_name, k.time_zone FROM inspector_tokens t
     JOIN inspector_links l ON l.id = t.link_id JOIN kitchens k ON k.id = l.kitchen_id WHERE t.token_hash = $1`,
    [tokenHash(token ?? "")],
  );
  const row = rows[0];
  if (!row) throw notFound();
  if (row.retired_at || row.revoked_at) throw apiError(410, "link_revoked");
  if (Date.now() >= row.expires_at.getTime()) throw apiError(410, "link_expired");
  return { link: row, kitchen: { id: row.kitchen_id, name: row.kitchen_name, time_zone: row.time_zone } };
}

const recordAccess = (linkId: string, action: string, target: string | null): Promise<unknown> =>
  pool.query("INSERT INTO inspector_access (link_id, action, target) VALUES ($1, $2, $3)", [linkId, action, target]);

async function certificates(kitchenId: string) {
  return [...currentDocuments(await memberDocuments(pool, "d.kitchen_id = $1", [kitchenId])).values()];
}

route("GET", "/api/inspect/:token", async (ctx) => {
  const { link, kitchen } = await holder(ctx.params.token);
  const zone = kitchen.time_zone;
  const today = localDateOf(Date.now(), zone);
  const entries = await entriesBetween(pool, kitchen.id, startOfDay(addDays(today, 1 - LOG_DAYS), zone), Date.now() + 1000);
  const { rows: reports } = await pool.query(
    "SELECT month FROM sanitation_reports WHERE kitchen_id = $1 AND stored_at IS NOT NULL ORDER BY month DESC", [kitchen.id]);
  const certs = (await certificates(kitchen.id)).map((d) => ({
    documentId: d.id, businessName: d.business_name, type: d.type, expiryDate: d.expiry_date, status: documentStatus(d, today),
  }));
  await recordAccess(link.id, "view", null);
  return {
    status: 200,
    body: {
      kitchen: { name: kitchen.name, timeZone: zone }, expiresAt: isoWithOffset(link.expires_at.getTime(), zone),
      sanitationEntries: entries.map((e) => entryJson(e, zone)), sanitationReports: reports.map((r) => ({ month: r.month })),
      certificates: certs,
    },
  };
}, { auth: false });

route("GET", "/api/inspect/:token/documents/:documentId/file", async (ctx): Promise<Reply> => {
  const { link, kitchen } = await holder(ctx.params.token);
  const doc = (await certificates(kitchen.id)).find((d) => d.id === ctx.params.documentId);
  if (!doc) throw notFound();
  const reply = await documentFile(doc);
  await recordAccess(link.id, "document", doc.id);
  return reply;
}, { auth: false });

route("GET", "/api/inspect/:token/sanitation-reports/:month/file", async (ctx): Promise<Reply> => {
  const { link, kitchen } = await holder(ctx.params.token);
  const reply = await reportFile(kitchen.id, ctx.params.month, true);
  await recordAccess(link.id, "report", ctx.params.month!);
  return reply;
}, { auth: false });
