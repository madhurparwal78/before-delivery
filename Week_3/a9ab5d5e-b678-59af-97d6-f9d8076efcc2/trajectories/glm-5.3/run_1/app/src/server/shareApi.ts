/** Share link endpoints and the public share view. */
import { Ctx, sendJson, sendNoContent } from './http';
import { problem } from './problems';
import { AppDeps, ShareLinkRow } from './apiTypes';
import * as auth from './auth';
import { ValidationErrors, fail, hasField, isObject } from './validate';
import { appendLog, withTransaction } from '../db/db';
import { deriveYearDoc } from './planApi';
import { canonicalJson, digestOf } from '../lib/canonical';
import { hasForbiddenChars, nfc } from '../lib/text';
import { parseInstant } from '../lib/time';

export async function listLinks(ctx: Ctx, deps: AppDeps): Promise<void> {
  const res = await deps.pool.query(
    `SELECT * FROM share_links WHERE household_id=$1 ORDER BY created_at DESC`,
    [ctx.householdId!],
  );
  sendJson(ctx, 200, { items: (res.rows as ShareLinkRow[]).map((l) => linkOut(deps, l)), next: null });
}

function linkOut(deps: AppDeps, l: ShareLinkRow): Record<string, unknown> {
  return {
    id: l.id,
    label: l.label,
    url: `${deps.config.appPublicUrl}/share/${l.token}`,
    expiresAt: isoOut(l.expires_at),
    createdAt: isoOut(l.created_at),
  };
}

function isoOut(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, '+00:00').replace('Z', '+00:00');
}

export async function createLink(ctx: Ctx, deps: AppDeps): Promise<void> {
  if (ctx.role !== 'planning') throw problem(403, 'planning_parent_only');
  const body = requireJsonBody(ctx);
  for (const k of Object.keys(body)) {
    if (k !== 'label' && k !== 'expiresAt') fail({ [k]: 'This field is not accepted.' });
  }
  for (const f of ['label', 'expiresAt']) {
    if (!hasField(body, f)) fail({ [f]: 'This field is not accepted.' });
  }
  const label = typeof body.label === 'string' ? body.label : fail({ label: 'Use 1 to 80 characters.' });
  if (hasForbiddenChars(label)) fail({ label: 'Remove hidden or control characters.' });
  const len = [...nfc(label)].length;
  if (len < 1 || len > 80) fail({ label: 'Use 1 to 80 characters.' });
  const expiresAt = typeof body.expiresAt === 'string' ? body.expiresAt
    : fail({ expiresAt: 'Enter an RFC 3339 instant with an offset and no fractional seconds.' });
  let inst;
  try {
    inst = parseInstant(expiresAt);
  } catch {
    fail({ expiresAt: 'Enter an RFC 3339 instant with an offset and no fractional seconds.' });
  }
  const now = Date.now();
  const expiresMs = Number(inst.epochMilliseconds);
  if (expiresMs <= now) fail({ expiresAt: 'Choose a time in the next 90 days.' });
  if (expiresMs > now + 90 * 86400_000) fail({ expiresAt: 'Choose a time in the next 90 days.' });
  const id = auth.randomId();
  const token = auth.randomToken();
  await withTransaction(deps.pool, async (client) => {
    await client.query(
      `INSERT INTO share_links (id, household_id, token, label, expires_at) VALUES ($1,$2,$3,$4,$5)`,
      [id, ctx.householdId, token, nfc(label), new Date(expiresMs)],
    );
    await appendLog(client, ctx.householdId!, 'planning', 'share_link.created', id);
  });
  const res = await deps.pool.query(`SELECT * FROM share_links WHERE id=$1`, [id]);
  sendJson(ctx, 201, linkOut(deps, res.rows[0] as ShareLinkRow));
}

export async function regenerateLink(ctx: Ctx, deps: AppDeps, id: string): Promise<void> {
  if (ctx.role !== 'planning') throw problem(403, 'planning_parent_only');
  if (!/^\d+$/.test(id)) throw problem(404, 'not_found');
  const res = await deps.pool.query(
    `SELECT * FROM share_links WHERE id=$1 AND household_id=$2`,
    [id, ctx.householdId],
  );
  if (res.rows.length === 0) throw problem(404, 'not_found');
  const old = res.rows[0] as ShareLinkRow;
  const token = auth.randomToken();
  await withTransaction(deps.pool, async (client) => {
    await client.query(`UPDATE share_links SET token=$2, created_at=now() WHERE id=$1`, [old.id, token]);
    await appendLog(client, ctx.householdId!, 'planning', 'share_link.regenerated', old.id);
  });
  const res2 = await deps.pool.query(`SELECT * FROM share_links WHERE id=$1`, [old.id]);
  sendJson(ctx, 200, linkOut(deps, res2.rows[0] as ShareLinkRow));
}

export async function revokeLink(ctx: Ctx, deps: AppDeps, id: string): Promise<void> {
  if (ctx.role !== 'planning') throw problem(403, 'planning_parent_only');
  if (!/^\d+$/.test(id)) throw problem(404, 'not_found');
  const res = await deps.pool.query(
    `SELECT * FROM share_links WHERE id=$1 AND household_id=$2`,
    [id, ctx.householdId],
  );
  if (res.rows.length === 0) throw problem(404, 'not_found');
  const old = res.rows[0] as ShareLinkRow;
  await withTransaction(deps.pool, async (client) => {
    await client.query(`UPDATE share_links SET revoked_at=now() WHERE id=$1`, [old.id]);
    await appendLog(client, ctx.householdId!, 'planning', 'share_link.revoked', old.id);
  });
  sendNoContent(ctx);
}

/** The public read-only share view. Only GET and HEAD; every response carries
 *  Cache-Control: no-store; dead links are 404 byte-identical. */
export async function shareView(ctx: Ctx, deps: AppDeps, token: string, headOnly = false): Promise<void> {
  const res = await deps.pool.query(
    `SELECT s.*, h.name, h.id AS hid FROM share_links s JOIN households h ON h.id = s.household_id
     WHERE s.token = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [token],
  );
  if (res.rows.length === 0) {
    sendJson(ctx, 404, {
      type: 'urn:twohouse:problem:not_found',
      title: "We couldn't find that page.",
      status: 404,
      code: 'not_found',
    });
    return;
  }
  const row = res.rows[0] as ShareLinkRow & { hid: string; name: string };
  let year: number;
  const yearParam = ctx.query('year');
  if (yearParam === null) {
    year = defaultYear();
  } else if (/^\d{4}$/.test(yearParam)) {
    const y = Number(yearParam);
    if (y < 2000 || y > 2100) {
      throw new ValidationErrors({ year: 'Choose a year from 2000 to 2100.' });
    }
    year = y;
  } else {
    throw new ValidationErrors({ year: 'Choose a year from 2000 to 2100.' });
  }
  const doc = await deriveYearDoc(deps, row.hid, year);
  const days = doc.days as Array<Record<string, unknown>>;
  const handovers = days
    .filter((d) => d.exchangeAt !== null)
    .map((d) => ({
      date: d.date,
      exchangeAt: d.exchangeAt,
      zone: d.exchangeZone,
      from: d.owner === 'planning' ? 'other' : 'planning',
      to: d.owner,
    }));
  const h = await deps.pool.query(`SELECT planning_name, other_name FROM households WHERE id=$1`, [row.hid]);
  const canon = canonicalJson(doc);
  const digest = digestOf(Buffer.from(canon, 'utf8'));
  const body = {
    householdName: row.name,
    year,
    yearDigest: digest,
    handovers: handovers.map((hd) => ({
      ...hd,
      from: hd.to === 'planning' ? h.rows[0].other_name : h.rows[0].planning_name,
      to: hd.to === 'planning' ? h.rows[0].planning_name : h.rows[0].other_name,
    })),
  };
  if (headOnly) {
    ctx.res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    ctx.res.end();
    return;
  }
  sendJson(ctx, 200, body, { 'cache-control': 'no-store', etag: `"${digest}"` });
}

function defaultYear(): number {
  return new Date().getUTCFullYear();
}

function requireJsonBody(ctx: Ctx): Record<string, unknown> {
  const body = ctx.body ?? Buffer.alloc(0);
  if (body.length === 0) return {};
  const ct = ctx.header('content-type') ?? '';
  if (!ct.startsWith('application/json')) throw problem(415, 'unsupported_media_type');
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    if (!isObject(parsed)) fail({ '': 'This field is not accepted.' });
    return parsed;
  } catch (e) {
    if (e instanceof ValidationErrors) throw e;
    throw problem(400, 'malformed_json');
  }
}
