import { query } from '../db.js';
import { errors } from './errors.js';
import { jsonOk, parseJsonBody, requireJsonContentType, type Ctx } from './http.js';
import { resolveWorkspace } from './auth.js';
import { formatInstant, isStr, invalid, codePoints } from './helpers.js';
import { newToken, hashPartnerKey } from '../domain/crypto.js';
import { sha256Hex } from '../domain/crypto.js';
import { config } from '../config.js';

export async function createPartnerCase(ctx: Ctx): Promise<Response> {
  const requestKey = ctx.req.headers.get('request-key') ?? '';
  if (requestKey.length < 1 || requestKey.length > 100) invalid({ requestKey: 'Send a Request-Key header.' });
  const raw = await ctx.rawBody();
  const bodySha = sha256Hex(raw);
  const partner = ctx.partnerKey!;

  const rateLimitKey = `partner:${partner.id}`;
  await enforceRateLimit(rateLimitKey, 30, config.partnerRateWindowSeconds);

  const stored = await query<{ status: number; body: unknown; body_sha256: string }>('SELECT status, body, body_sha256 FROM request_keys WHERE partner_key_id = $1 AND request_key = $2', [partner.id, requestKey]);
  if (stored.rows.length > 0) {
    if (stored.rows[0].body_sha256 !== bodySha) throw errors.conflict('request_key_reused', 'This request key was already used with a different body.');
    const body = stored.rows[0].body as Record<string, unknown>;
    return new Response(JSON.stringify(body), { status: stored.rows[0].status, headers: { 'Content-Type': 'application/json' } });
  }

  const response = await capturePartnerResponse(async () => {
    const { createCase } = await import('./cases.js');
    return await createCase(ctx, { label: await partnerLabel(partner.id) });
  });

  if (response.status === 401 || response.status === 429 || response.status === 503) {
    return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json' } });
  }
  await query('INSERT INTO request_keys (partner_key_id, request_key, body_sha256, status, body, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (partner_key_id, request_key) DO NOTHING',
    [partner.id, requestKey, bodySha, response.status, JSON.parse(response.body), new Date()]);
  return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json' } });
}

async function partnerLabel(id: string): Promise<string> {
  const r = await query<{ label: string }>('SELECT label FROM partner_keys WHERE id = $1', [id]);
  return r.rows[0]?.label ?? 'Partner key';
}

async function capturePartnerResponse(fn: () => Promise<Response>): Promise<{ status: number; body: string }> {
  try {
    const response = await fn();
    return { status: response.status, body: await response.text() };
  } catch (err) {
    const { errorResponse } = await import('./http.js');
    const response = errorResponse(err);
    return { status: response.status, body: await response.text() };
  }
}

export async function enforceRateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const recent = await query<{ request_at: Date }>('SELECT request_at FROM rate_windows WHERE key = $1 AND window_start = $2 ORDER BY request_at DESC', [key, windowStart]);
  const inWindow = recent.rows.filter((r) => now.getTime() - r.request_at.getTime() < windowSeconds * 1000);
  if (inWindow.length >= limit) {
    const oldest = inWindow[inWindow.length - 1].request_at;
    const retryAfter = Math.ceil((oldest.getTime() + windowSeconds * 1000 - now.getTime()) / 1000);
    throw errors.rateLimited(Math.max(1, retryAfter));
  }
  await query('INSERT INTO rate_windows (key, window_start, request_at) VALUES ($1,$2,$3)', [key, windowStart, now]);
  await query('DELETE FROM rate_windows WHERE request_at < $1', [new Date(now.getTime() - windowSeconds * 1000)]);
}

export async function listPartnerKeys(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  const r = await query<{ id: string; label: string; starts_with: string; created_at: Date; last_used_at: Date | null; revoked_at: Date | null }>('SELECT id, label, starts_with, created_at, last_used_at, revoked_at FROM partner_keys WHERE workspace_slug = $1 ORDER BY created_at', [ws.slug]);
  return jsonOk({ keys: r.rows.map((k) => ({ id: k.id, label: k.label, startsWith: k.starts_with, createdAt: formatInstant(k.created_at), lastUsedAt: k.last_used_at === null ? null : formatInstant(k.last_used_at), revokedAt: k.revoked_at === null ? null : formatInstant(k.revoked_at) })) });
}

export async function createPartnerKey(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  requireJsonContentType(ctx, ['application/json']);
  const body = parseJsonBody(await ctx.rawBody());
  const label = isStr(body.label) ? body.label : '';
  if (codePoints(label) < 1 || codePoints(label) > 80) invalid({ label: 'Enter a label of 1 to 80 characters.' });
  const secret = `lnlk_${newToken(16).replace(/[^a-f0-9]/g, '0').slice(0, 32).padEnd(32, '0')}`;
  const id = `pk-${newToken(8).toLowerCase()}`;
  const now = new Date();
  await query('INSERT INTO partner_keys (id, workspace_slug, label, starts_with, key_hash, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [id, ws.slug, label, secret.slice(0, 9), hashPartnerKey(secret), now]);
  return jsonOk({ key: { id, label, startsWith: secret.slice(0, 9), createdAt: formatInstant(now), lastUsedAt: null, revokedAt: null }, secret }, 201);
}

export async function revokePartnerKey(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  const r = await query<{ id: string; label: string; starts_with: string; created_at: Date; last_used_at: Date | null; revoked_at: Date | null }>('SELECT id, label, starts_with, created_at, last_used_at, revoked_at FROM partner_keys WHERE id = $1 AND workspace_slug = $2', [ctx.params.id, ws.slug]);
  if (r.rows.length === 0) throw errors.notFound();
  if (r.rows[0].revoked_at !== null) throw errors.conflict('key_revoked', 'Key revoked.');
  const now = new Date();
  await query('UPDATE partner_keys SET revoked_at = $1 WHERE id = $2', [now, ctx.params.id]);
  return jsonOk({ key: { id: r.rows[0].id, label: r.rows[0].label, startsWith: r.rows[0].starts_with, createdAt: formatInstant(r.rows[0].created_at), lastUsedAt: r.rows[0].last_used_at === null ? null : formatInstant(r.rows[0].last_used_at), revokedAt: formatInstant(now) } });
}
