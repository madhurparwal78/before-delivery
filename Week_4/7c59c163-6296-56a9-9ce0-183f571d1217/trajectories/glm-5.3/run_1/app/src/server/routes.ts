import * as crypto from 'node:crypto';
import type { AppConfig } from './config.js';
import { AppError, conflict, forbidden, notFound, validationError } from './errors.js';
import type { Pool } from './db.js';
import type { KeycloakClient } from './keycloak.js';
import type { SvixClient } from './svix.js';
import type { RateLimiter } from './valkey.js';
import type { S3ClientLike } from './s3types.js';
import { presignGet, putObjectBytes } from './s3.js';
import type { Exchange } from './exchange.js';
import type { Billing, MemberRow } from './billing.js';
import type { Mailer } from './mailer.js';
import {
  RANGES,
  canCancelOrder,
  luhnValid,
  type OrderStatus,
  planRatePerSecond,
  type MarketKind,
  type OrderMode,
  type OrderSide,
  type Outcome,
} from './domain.js';
import { formatMonth, monthStart, nextMonthStart } from './money.js';
import { memberBalances } from './ledger.js';
import { generateStatementFor } from './workers.js';

export interface SessionData {
  userId: string;
  username: string;
  roles: string[];
  venueId: string | null;
}

export interface RequestCtx {
  method: string;
  url: URL;
  headers: Record<string, string | string[] | undefined>;
  bodyBuffer: Buffer;
  session: SessionData | null;
  member: MemberRow | null;
  apiKeyId: string | null;
}

export interface HandlerDeps {
  pool: Pool;
  config: AppConfig;
  keycloak: KeycloakClient;
  svix: SvixClient;
  mailer: Mailer;
  limiter: RateLimiter;
  redis: { ping(): Promise<string> };
  s3: S3ClientLike;
  exchange: Exchange;
  billing: Billing;
  sessions: Map<string, SessionData>;
  killbillUp: () => Promise<boolean>;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400, { error: 'bad_json' });
  }
  return value as Record<string, unknown>;
}

export function parseJson(buffer: Buffer): unknown {
  if (buffer.length === 0) return {};
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new AppError(400, { error: 'bad_json' });
  }
}

function rejectUnknownFields(body: Record<string, unknown>, allowed: readonly string[]): void {
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) errors[key] = 'unknown_field';
  }
  if (Object.keys(errors).length > 0) throw validationError(errors);
}

function intField(body: Record<string, unknown>, field: string): number | undefined {
  const value = body[field];
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  return undefined;
}

function strField(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  return typeof value === 'string' ? value : undefined;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

async function buildMe(deps: HandlerDeps, session: SessionData, member: MemberRow | null): Promise<Record<string, unknown>> {
  const venueRes = member ? await deps.pool.query(`SELECT id, slug, name, time_zone FROM venues WHERE id = $1`, [member.venue_id]) : null;
  const venue = venueRes ? (venueRes.rows[0] as Record<string, unknown> | undefined) ?? null : null;
  return {
    id: session.userId,
    username: session.username,
    display_name: member?.display_name ?? session.username,
    email: member?.email ?? '',
    roles: session.roles,
    venue,
  };
}

async function resolveMember(deps: HandlerDeps, userId: string): Promise<MemberRow | null> {
  const res = await deps.pool.query(`SELECT * FROM members WHERE keycloak_id = $1`, [userId]);
  return (res.rows[0] as MemberRow | undefined) ?? null;
}

function requireSession(ctx: RequestCtx): SessionData {
  if (!ctx.session) throw new AppError(401, { error: 'unauthenticated' });
  return ctx.session;
}

function requireVenue(ctx: RequestCtx): string {
  const session = requireSession(ctx);
  if (!session.venueId) throw forbidden();
  return session.venueId;
}

async function requireMember(deps: HandlerDeps, ctx: RequestCtx): Promise<{ session: SessionData; venueId: string; member: MemberRow }> {
  const session = requireSession(ctx);
  if (!session.venueId) throw forbidden();
  if (!ctx.member) {
    ctx.member = await resolveMember(deps, session.userId);
  }
  if (!ctx.member) throw forbidden();
  return { session, venueId: session.venueId, member: ctx.member };
}

async function requireRole(deps: HandlerDeps, ctx: RequestCtx, role: string): Promise<{ session: SessionData; venueId: string; member: MemberRow }> {
  const result = await requireMember(deps, ctx);
  if (!result.session.roles.includes(role)) throw forbidden();
  return result;
}

function fillBody(fill: Record<string, unknown>): Record<string, unknown> {
  return {
    id: fill['id'],
    order_id: fill['order_id'],
    market_id: fill['market_id'],
    mode: fill['mode'],
    side: fill['side'],
    outcome: fill['outcome'],
    price: fill['price'],
    quantity: fill['quantity'],
    notional_cents: fill['notional_cents'],
    fee_cents: fill['fee_cents'],
    liquidity: fill['liquidity'],
    filled_at: fill['filled_at'],
  };
}

function depositBody(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row['id'],
    amount_cents: row['amount_cents'],
    refunded_cents: row['refunded_cents'],
    status: row['status'],
    card_last4: row['card_last4'],
    killbill_payment_id: row['killbill_payment_id'],
    created_at: row['created_at'],
  };
}

async function marketFromBodyRow(deps: HandlerDeps, market: Record<string, unknown>, now: Date): Promise<Record<string, unknown>> {
  const kind = market['kind'] as MarketKind;
  const closesAt = market['closes_at'] as Date | null;
  let status = market['status'] as string;
  if (kind === 'event' && status === 'trading' && closesAt && closesAt.getTime() <= now.getTime()) {
    status = 'closed';
  }
  let openInterest = 0;
  if (kind === 'pair') {
    const res = await deps.pool.query(
      `SELECT COALESCE(SUM(quantity),0) AS total FROM margin_positions WHERE market_id = $1 AND status = 'open'`,
      [market['id']]
    );
    openInterest = Number((res.rows[0] as { total: string }).total);
  } else if (status !== 'settled') {
    const res = await deps.pool.query(
      `SELECT COALESCE(SUM(quantity), 0) AS total FROM event_holdings WHERE market_id = $1 AND outcome = 'yes'`,
      [market['id']]
    );
    openInterest = Number((res.rows[0] as { total: string }).total);
  }
  const venueRes = await deps.pool.query(`SELECT taker_fee_bps, maker_fee_bps FROM venues WHERE id = $1`, [market['venue_id']]);
  const fees = venueRes.rows[0] as { taker_fee_bps: number; maker_fee_bps: number } | undefined;
  return {
    id: market['id'],
    kind,
    symbol: market['symbol'],
    title: market['title'],
    status,
    closes_at: closesAt,
    outcome: market['outcome'],
    last_price: market['last_price'],
    open_interest: openInterest,
    taker_fee_bps: fees?.taker_fee_bps ?? 0,
    maker_fee_bps: fees?.maker_fee_bps ?? 0,
  };
}

async function loadOrderFull(deps: HandlerDeps, orderId: string, memberId: string): Promise<Record<string, unknown> | null> {
  const res = await deps.pool.query(`SELECT * FROM orders WHERE id = $1 AND member_id = $2`, [orderId, memberId]);
  const order = res.rows[0] as Record<string, unknown> | undefined;
  if (!order) return null;
  const fills = await deps.pool.query(`SELECT * FROM fills WHERE order_id = $1 ORDER BY filled_at`, [orderId]);
  return {
    ...order,
    remaining_quantity: Number(order['quantity']) - Number(order['filled_quantity']),
    fills: (fills.rows as Record<string, unknown>[]).map(fillBody),
  };
}

export function midnightToday(timeZone: string, now: Date): Date {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const label = fmt.format(now);
  for (let offset = -14; offset <= 14; offset += 0.25) {
    const candidate = new Date(now.getTime() - offset * 3600000);
    if (fmt.format(candidate) === label) {
      const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(candidate);
      if (time === '00:00') return candidate;
    }
  }
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

async function venueSummary(deps: HandlerDeps, venueId: string, now: Date): Promise<Record<string, unknown>> {
  const venueRes = await deps.pool.query(`SELECT time_zone, flagship_market_id FROM venues WHERE id = $1`, [venueId]);
  const venue = venueRes.rows[0] as { time_zone: string; flagship_market_id: string | null };
  const startOfDay = midnightToday(venue.time_zone, now);
  const volumeRes = await deps.pool.query(
    `SELECT COALESCE(SUM(price * quantity),0) AS total FROM trades WHERE venue_id = $1 AND at >= $2`,
    [venueId, startOfDay]
  );
  const marketsRes = await deps.pool.query(`SELECT id, kind FROM markets WHERE venue_id = $1`, [venueId]);
  let openInterest = 0;
  for (const row of marketsRes.rows as { id: string; kind: string }[]) {
    if (row.kind === 'pair') {
      const res = await deps.pool.query(
        `SELECT COALESCE(SUM(quantity),0) AS total FROM margin_positions WHERE market_id = $1 AND status = 'open'`,
        [row.id]
      );
      openInterest += Number((res.rows[0] as { total: string }).total);
    } else {
      const res = await deps.pool.query(
        `SELECT COALESCE(SUM(quantity),0) AS total FROM event_holdings WHERE market_id = $1 AND outcome = 'yes'`,
        [row.id]
      );
      openInterest += Number((res.rows[0] as { total: string }).total);
    }
  }
  return {
    volume_cents_today: Number((volumeRes.rows[0] as { total: string }).total),
    open_interest_contracts: openInterest,
    flagship_market_id: venue.flagship_market_id,
  };
}

async function venueTotals(deps: HandlerDeps, venueId: string, now: Date): Promise<Record<string, unknown>> {
  const venueRes = await deps.pool.query(`SELECT time_zone FROM venues WHERE id = $1`, [venueId]);
  const timeZone = (venueRes.rows[0] as { time_zone: string }).time_zone;
  const startOfDay = midnightToday(timeZone, now);
  const members = await deps.pool.query(`SELECT count(*)::int AS n FROM members WHERE venue_id = $1`, [venueId]);
  const openOrders = await deps.pool.query(
    `SELECT count(*)::int AS n FROM orders WHERE venue_id = $1 AND status IN ('resting','partially_filled')`,
    [venueId]
  );
  const deposits = await deps.pool.query(
    `SELECT COALESCE(SUM(amount_cents),0) AS total FROM deposits WHERE venue_id = $1 AND status = 'succeeded'`,
    [venueId]
  );
  const refundsTotal = await deps.pool.query(
    `SELECT COALESCE(SUM(amount_cents),0) AS total FROM refunds WHERE venue_id = $1`,
    [venueId]
  );
  const fees = await deps.pool.query(
    `SELECT COALESCE(SUM(fee_cents),0) AS total FROM fills WHERE venue_id = $1`,
    [venueId]
  );
  const volume = await deps.pool.query(
    `SELECT COALESCE(SUM(price * quantity),0) AS total FROM trades WHERE venue_id = $1 AND at >= $2`,
    [venueId, startOfDay]
  );
  const summary = await venueSummary(deps, venueId, now);
  return {
    members: (members.rows[0] as { n: number }).n,
    open_orders: (openOrders.rows[0] as { n: number }).n,
    deposits_cents: Number((deposits.rows[0] as { total: string }).total),
    refunds_cents: Number((refundsTotal.rows[0] as { total: string }).total),
    fees_cents: Number((fees.rows[0] as { total: string }).total),
    volume_cents_today: Number((volume.rows[0] as { total: string }).total),
    open_interest_contracts: summary['open_interest_contracts'],
  };
}

export interface MultipartFile {
  filename: string;
  bytes: Buffer;
}

export function parseMultipart(body: Buffer, contentType: string): MultipartFile | null {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) return null;
  const sep = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let index = body.indexOf(sep);
  while (index !== -1) {
    const next = body.indexOf(sep, index + sep.length);
    if (next === -1) break;
    parts.push(body.subarray(index + sep.length, next));
    index = next;
  }
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headers = part.subarray(0, headerEnd).toString('utf8');
    if (!/name="document"/i.test(headers)) continue;
    let filename = 'document';
    const nameMatch = headers.match(/filename="([^"]*)"/i);
    if (nameMatch?.[1]) filename = nameMatch[1];
    const bytes = part.subarray(headerEnd + 4);
    const trimmed = bytes.subarray(0, Math.max(0, bytes.length - 2));
    return { filename, bytes: Buffer.from(trimmed) };
  }
  return null;
}

export function detectDocumentType(bytes: Buffer): string | null {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'application/pdf';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

export type ApiResult =
  | { status: number; body: unknown; headers?: Record<string, string> }
  | { status: number; body: Buffer; contentType: string; headers?: Record<string, string> };

async function idempotencyLookup(
  deps: HandlerDeps,
  memberId: string,
  endpoint: string,
  key: string,
  body: Record<string, unknown>
): Promise<{ storedStatus: number; storedBody: unknown } | null> {
  const res = await deps.pool.query(
    `SELECT * FROM idempotency_keys WHERE member_id = $1 AND endpoint = $2 AND idem_key = $3`,
    [memberId, endpoint, key]
  );
  const row = res.rows[0] as { body_json: unknown; response_status: number; response_body: unknown } | undefined;
  if (!row) return null;
  const sorted = (value: unknown): string => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return JSON.stringify(value);
    const entries = Object.entries(value as Record<string, unknown>).map(([k, v]): [string, unknown] => [k, v]);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    return JSON.stringify(Object.fromEntries(entries));
  };
  if (sorted(row.body_json) !== sorted(body)) {
    throw conflict('idempotency_conflict');
  }
  return { storedStatus: row.response_status, storedBody: row.response_body };
}

async function idempotencyStore(
  deps: HandlerDeps,
  memberId: string,
  endpoint: string,
  key: string,
  body: Record<string, unknown>,
  status: number,
  responseBody: unknown
): Promise<void> {
  // pg parses a jsonb parameter into an object on read, so store the canonical
  // parsed form to keep JSON.stringify comparisons in the replay check stable.
  await deps.pool.query(
    `INSERT INTO idempotency_keys (id, member_id, endpoint, idem_key, body_json, response_status, response_body)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb)
     ON CONFLICT (member_id, endpoint, idem_key) DO NOTHING`,
    [crypto.randomUUID(), memberId, endpoint, key, JSON.stringify(body), status, JSON.stringify(responseBody)]
  );
}

async function venueIdFromGroup(deps: HandlerDeps, groupName: string): Promise<string | null> {
  const slug = groupName.replace(/^venue-/, '');
  const res = await deps.pool.query(`SELECT id FROM venues WHERE slug = $1`, [slug]);
  const row = res.rows[0] as { id: string } | undefined;
  return row?.id ?? null;
}

export async function handleApi(deps: HandlerDeps, ctx: RequestCtx): Promise<ApiResult> {
  const { pool, config, keycloak, svix, limiter, s3, exchange, billing, mailer, killbillUp } = deps;
  const { url, method } = ctx;
  const pathName = url.pathname;
  const now = new Date();

  if (pathName === '/api/health' && method === 'GET') {
    return { status: 200, body: { status: 'ok' } };
  }

  if (pathName === '/api/session' && method === 'POST') {
    const body = asRecord(parseJson(ctx.bodyBuffer));
    rejectUnknownFields(body, ['username', 'password']);
    const username = strField(body, 'username');
    const password = strField(body, 'password');
    if (!username || !password) throw validationError({ username: 'invalid', password: 'invalid' });
    const token = await keycloak.passwordGrant(username, password);
    const info = await keycloak.decodeTokenUser(token.access_token);
    const groups = await keycloak.userGroups(info.userId);
    const venueGroup = groups.find((g) => g.name.startsWith('venue-'));
    const roles = await keycloak.userRoles(info.userId).catch(() => info.roles);
    const session: SessionData = {
      userId: info.userId,
      username: info.username,
      roles: roles.filter((r) => ['trader', 'builder', 'market_admin', 'org_owner', 'founder_operator'].includes(r)),
      venueId: venueGroup ? await venueIdFromGroup(deps, venueGroup.name) : null,
    };
    const sessionId = crypto.randomBytes(24).toString('hex');
    deps.sessions.set(sessionId, session);
    const member = await resolveMember(deps, info.userId);
    return {
      status: 200,
      body: await buildMe(deps, session, member),
      headers: { 'Set-Cookie': `pv_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax` },
    };
  }

  if (pathName === '/api/session' && method === 'DELETE') {
    return {
      status: 204,
      body: null,
      headers: { 'Set-Cookie': 'pv_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' },
    };
  }

  if (pathName === '/api/me' && method === 'GET') {
    const session = requireSession(ctx);
    const member = await resolveMember(deps, session.userId);
    return { status: 200, body: await buildMe(deps, session, member) };
  }

  if (pathName === '/api/me' && method === 'PATCH') {
    const { member, session } = await requireMember(deps, ctx);
    const body = asRecord(parseJson(ctx.bodyBuffer));
    rejectUnknownFields(body, ['display_name']);
    const displayName = strField(body, 'display_name');
    if (displayName === undefined) throw validationError({ display_name: 'invalid' });
    const trimmed = displayName.trim();
    if (trimmed.length < 1 || trimmed.length > 60) throw validationError({ display_name: 'invalid' });
    await pool.query(`UPDATE members SET display_name = $2 WHERE id = $1`, [member.id, trimmed]);
    return { status: 200, body: await buildMe(deps, session, { ...member, display_name: trimmed }) };
  }

  if (pathName === '/api/me/documents' && method === 'POST') {
    const { member, venueId } = await requireMember(deps, ctx);
    const contentType = String(ctx.headers['content-type'] ?? '');
    if (!contentType.includes('multipart/form-data')) throw validationError({ document: 'invalid' });
    const parsed = parseMultipart(ctx.bodyBuffer, contentType);
    if (!parsed) throw validationError({ document: 'invalid' });
    if (parsed.bytes.length < 1 || parsed.bytes.length > 5_000_000) throw new AppError(413, { error: 'payload_too_large' });
    const detected = detectDocumentType(parsed.bytes);
    if (!detected) throw validationError({ document: 'unsupported_type' });
    const id = crypto.randomUUID();
    const key = `venues/${venueId}/documents/${member.id}/${id}`;
    try {
      await putObjectBytes(s3, config.s3.bucket, key, new Uint8Array(parsed.bytes), detected);
    } catch {
      throw new AppError(503, { error: 'documents_unavailable' });
    }
    await pool.query(
      `INSERT INTO id_documents (id, venue_id, member_id, filename, content_type, size_bytes) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, venueId, member.id, parsed.filename, detected, parsed.bytes.length]
    );
    return {
      status: 201,
      body: {
        id,
        filename: parsed.filename,
        content_type: detected,
        size_bytes: parsed.bytes.length,
        uploaded_at: new Date().toISOString(),
      },
    };
  }

  if (pathName === '/api/me/documents' && method === 'GET') {
    const { member } = await requireMember(deps, ctx);
    const rows = await pool.query(
      `SELECT id, filename, content_type, size_bytes, created_at FROM id_documents WHERE member_id = $1 ORDER BY created_at DESC`,
      [member.id]
    );
    return {
      status: 200,
      body: {
        documents: (rows.rows as Record<string, unknown>[]).map((r) => ({
          id: r['id'], filename: r['filename'], content_type: r['content_type'], size_bytes: r['size_bytes'], uploaded_at: r['created_at'],
        })),
      },
    };
  }

  const inviteMatch = pathName.match(/^\/api\/invites\/([^/]+)$/);
  if (inviteMatch && method === 'GET') {
    const token = inviteMatch[1]!;
    const resq = await pool.query(`SELECT * FROM invites WHERE token = $1`, [token]);
    const invite = resq.rows[0] as { email: string; venue_id: string; expires_at: Date; accepted_at: Date | null } | undefined;
    if (!invite || invite.accepted_at) throw notFound();
    if (invite.expires_at.getTime() < Date.now()) throw new AppError(410, { error: 'invite_expired' });
    const venueRes = await pool.query(`SELECT name FROM venues WHERE id = $1`, [invite.venue_id]);
    return { status: 200, body: { email: invite.email, venue_name: (venueRes.rows[0] as { name: string }).name } };
  }

  const inviteAccept = pathName.match(/^\/api\/invites\/([^/]+)\/accept$/);
  if (inviteAccept && method === 'POST') {
    const token = inviteAccept[1]!;
    const body = asRecord(parseJson(ctx.bodyBuffer));
    rejectUnknownFields(body, ['password']);
    const password = strField(body, 'password');
    if (!password || password.length < 12 || password.length > 128) throw validationError({ password: 'invalid' });
    const resq = await pool.query(`SELECT * FROM invites WHERE token = $1`, [token]);
    const invite = resq.rows[0] as { email: string; venue_id: string; roles: string[]; display_name: string; keycloak_id: string | null; expires_at: Date; accepted_at: Date | null } | undefined;
    if (!invite || invite.accepted_at) throw notFound();
    if (invite.expires_at.getTime() < Date.now()) throw new AppError(410, { error: 'invite_expired' });
    if (invite.keycloak_id) {
      await keycloak.setUserPassword(invite.keycloak_id, password);
      await keycloak.setRequiredActions(invite.keycloak_id, []);
    } else {
      const venueRes = await pool.query(`SELECT slug FROM venues WHERE id = $1`, [invite.venue_id]);
      const user = await keycloak.createUser({
        username: invite.email.split('@')[0]!,
        email: invite.email,
        password,
        roles: invite.roles,
        groupName: `venue-${(venueRes.rows[0] as { slug: string }).slug}`,
      });
      await pool.query(`UPDATE invites SET keycloak_id = $2 WHERE token = $1`, [token, user.id]);
    }
    await pool.query(`UPDATE invites SET accepted_at = now() WHERE token = $1`, [token]);
    return { status: 200, body: { email: invite.email } };
  }

  if (pathName === '/api/markets' && method === 'GET') {
    const venueId = requireVenue(ctx);
    const rows = await pool.query(`SELECT * FROM markets WHERE venue_id = $1 ORDER BY created_at`, [venueId]);
    const markets = await Promise.all((rows.rows as Record<string, unknown>[]).map((m) => marketFromBodyRow(deps, m, now)));
    return { status: 200, body: { markets } };
  }

  if (pathName === '/api/markets' && method === 'POST') {
    const { venueId } = await requireRole(deps, ctx, 'market_admin');
    const body = asRecord(parseJson(ctx.bodyBuffer));
    rejectUnknownFields(body, ['kind', 'symbol', 'title', 'closes_at']);
    const kind = strField(body, 'kind');
    const symbol = strField(body, 'symbol');
    const title = strField(body, 'title');
    const closesAt = strField(body, 'closes_at');
    const errors: Record<string, string> = {};
    if (kind !== 'pair' && kind !== 'event') errors['kind'] = 'invalid';
    if (!symbol || !/^[A-Z0-9]{2,12}$/.test(symbol)) errors['symbol'] = 'invalid';
    if (!title || title.length < 1 || title.length > 120) errors['title'] = 'invalid';
    if (kind === 'event' && (!closesAt || Number.isNaN(Date.parse(closesAt)) || Date.parse(closesAt) <= Date.now())) errors['closes_at'] = 'invalid';
    if (Object.keys(errors).length > 0) throw validationError(errors);
    const taken = await pool.query(`SELECT 1 FROM markets WHERE venue_id = $1 AND symbol = $2`, [venueId, symbol]);
    if ((taken.rowCount ?? 0) > 0) throw conflict('symbol_taken');
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO markets (id, venue_id, kind, symbol, title, status, closes_at) VALUES ($1,$2,$3,$4,$5,'listed',$6)`,
      [id, venueId, kind, symbol, title, kind === 'event' ? new Date(closesAt!) : null]
    );
    const rows = await pool.query(`SELECT * FROM markets WHERE id = $1`, [id]);
    return { status: 201, body: await marketFromBodyRow(deps, rows.rows[0] as Record<string, unknown>, now) };
  }

  const marketMatch = pathName.match(/^\/api\/markets\/([^/]+)$/);
  if (marketMatch && method === 'GET') {
    const venueId = requireVenue(ctx);
    const id = marketMatch[1]!;
    if (!isUuid(id)) throw notFound();
    const client = await pool.connect();
    try {
      const market = await exchange.loadMarket(client, venueId, id);
      const body = await marketFromBodyRow(deps, market as unknown as Record<string, unknown>, now);
      return { status: 200, body: { ...body, server_time: now.toISOString() } };
    } finally {
      client.release();
    }
  }

  const bookMatch = pathName.match(/^\/api\/markets\/([^/]+)\/book$/);
  if (bookMatch && method === 'GET') {
    const venueId = requireVenue(ctx);
    const id = bookMatch[1]!;
    if (!isUuid(id)) throw notFound();
    const client = await pool.connect();
    try {
      const market = await exchange.loadMarket(client, venueId, id);
      const snapshot = await exchange.bookSnapshot(client, market);
      return { status: 200, body: snapshot };
    } finally {
      client.release();
    }
  }

  for (const action of ['open', 'halt', 'resume'] as const) {
    const match = pathName.match(new RegExp(`^/api/markets/([^/]+)/${action}$`));
    if (match && method === 'POST') {
      const { venueId } = await requireRole(deps, ctx, 'market_admin');
      const id = match[1]!;
      if (!isUuid(id)) throw notFound();
      const target = action === 'halt' ? 'halted' : 'trading';
      const market = await exchange.transitionMarket(venueId, id, target);
      return { status: 200, body: await marketFromBodyRow(deps, market as unknown as Record<string, unknown>, now) };
    }
  }

  const resolveMatch = pathName.match(/^\/api\/markets\/([^/]+)\/resolve$/);
  if (resolveMatch && method === 'POST') {
    const { venueId } = await requireRole(deps, ctx, 'market_admin');
    const id = resolveMatch[1]!;
    if (!isUuid(id)) throw notFound();
    const body = asRecord(parseJson(ctx.bodyBuffer));
    rejectUnknownFields(body, ['outcome']);
    const outcome = strField(body, 'outcome');
    if (outcome !== 'yes' && outcome !== 'no') throw validationError({ outcome: 'invalid' });
    const market = await exchange.resolveEvent(venueId, id, outcome);
    return { status: 200, body: await marketFromBodyRow(deps, market as unknown as Record<string, unknown>, now) };
  }

  const liquidationsMatch = pathName.match(/^\/api\/markets\/([^/]+)\/liquidations$/);
  if (liquidationsMatch && method === 'POST') {
    const { venueId } = await requireRole(deps, ctx, 'market_admin');
    const id = liquidationsMatch[1]!;
    if (!isUuid(id)) throw notFound();
    const result = await exchange.runMaintenanceCheck(venueId, id);
    return { status: 200, body: result };
  }

  const ordersResult = await handleOrdersApi(deps, ctx, now);
  if (ordersResult) return ordersResult;
  const moneyResult = await handleMoneyApi(deps, ctx, now);
  if (moneyResult) return moneyResult;
  const builderResult = await handleBuilderApi(deps, ctx, now);
  if (builderResult) return builderResult;
  const venueResult = await handleVenueApi(deps, ctx, now);
  if (venueResult) return venueResult;
  const platformResult = await handlePlatformApi(deps, ctx, now);
  if (platformResult) return platformResult;

  throw notFound();
}

async function handleOrdersApi(deps: HandlerDeps, ctx: RequestCtx, now: Date): Promise<ApiResult | null> {
  const { pool, exchange } = deps;
  const { url, method } = ctx;
  const pathName = url.pathname;
  void now;

  if (pathName === '/api/orders' && method === 'POST') {
    const { venueId, member } = await requireMember(deps, ctx);
    if (!member.roles.some((r) => r === 'trader' || r === 'builder')) throw forbidden();
    const body = asRecord(parseJson(ctx.bodyBuffer));
    const idemKey = typeof ctx.headers['idempotency-key'] === 'string' ? (ctx.headers['idempotency-key'] as string) : undefined;
    if (idemKey !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(idemKey)) {
      throw validationError({ 'Idempotency-Key': 'invalid' });
    }
    if (idemKey) {
      const lookup = await idempotencyLookup(deps, member.id, 'orders', idemKey, body);
      if (lookup) {
        return { status: lookup.storedStatus, body: lookup.storedBody, headers: { 'Idempotent-Replayed': 'true' } };
      }
    }
    const marketId = strField(body, 'market_id');
    if (!marketId || !isUuid(marketId)) throw validationError({ market_id: 'invalid' });
    const marketRes = await pool.query(`SELECT * FROM markets WHERE id = $1 AND venue_id = $2`, [marketId, venueId]);
    const marketRow = marketRes.rows[0] as Record<string, unknown> | undefined;
    if (!marketRow) throw notFound();
    const kind = marketRow['kind'] as MarketKind;

    let mode: OrderMode = null;
    let side: OrderSide = 'buy';
    let outcome: Outcome | null = null;
    const errors: Record<string, string> = {};
    if (kind === 'event') {
      rejectUnknownFields(body, ['market_id', 'outcome', 'price', 'quantity']);
      const outcomeRaw = strField(body, 'outcome');
      if (outcomeRaw !== 'yes' && outcomeRaw !== 'no') errors['outcome'] = 'invalid';
      outcome = outcomeRaw as Outcome;
    } else {
      rejectUnknownFields(body, ['market_id', 'mode', 'side', 'price', 'quantity']);
      const modeRaw = strField(body, 'mode');
      const sideRaw = strField(body, 'side');
      if (modeRaw !== 'spot' && modeRaw !== 'margin') errors['mode'] = 'invalid';
      if (sideRaw !== 'buy' && sideRaw !== 'sell') errors['side'] = 'invalid';
      mode = modeRaw === 'margin' ? 'margin' : modeRaw === 'spot' ? 'spot' : null;
      side = sideRaw === 'sell' ? 'sell' : 'buy';
    }
    const price = intField(body, 'price');
    const quantity = intField(body, 'quantity');
    if (price === undefined) errors['price'] = 'invalid';
    if (quantity === undefined) errors['quantity'] = 'invalid';
    if (Object.keys(errors).length > 0) throw validationError(errors);

    const range = kind === 'event' ? RANGES.eventPrice : RANGES.pairPrice;
    if (price! < range.min || price! > range.max) throw validationError({ price: 'out_of_range' });
    if (quantity! < RANGES.quantity.min || quantity! > RANGES.quantity.max) throw validationError({ quantity: 'out_of_range' });

    const result = await exchange.placeOrder({
      venueId, memberId: member.id, marketId, mode, side, outcome, price: price!, quantity: quantity!,
    });
    const full = await loadOrderFull(deps, result.order.id, member.id);
    if (idemKey) {
      await idempotencyStore(deps, member.id, 'orders', idemKey, body, 201, full ?? {});
    }
    return { status: 201, body: full };
  }

  if (pathName === '/api/orders' && method === 'GET') {
    const { member } = await requireMember(deps, ctx);
    const status = url.searchParams.get('status');
    const marketId = url.searchParams.get('market_id');
    const params: unknown[] = [member.id];
    let where = `member_id = $1`;
    if (status === 'open') {
      where += ` AND status IN ('resting','partially_filled')`;
    } else if (status !== 'all' && status !== null) {
      throw validationError({ status: 'invalid' });
    }
    if (marketId) {
      if (!isUuid(marketId)) throw notFound();
      params.push(marketId);
      where += ` AND market_id = $${params.length}`;
    }
    const rows = await pool.query(`SELECT id FROM orders WHERE ${where} ORDER BY created_at DESC LIMIT 200`, params);
    const orders = await Promise.all((rows.rows as { id: string }[]).map(async (r) => await loadOrderFull(deps, r.id, member.id)));
    return { status: 200, body: { orders: orders.filter((o) => o !== null) } };
  }

  const orderMatch = pathName.match(/^\/api\/orders\/([^/]+)$/);
  if (orderMatch && (method === 'GET' || method === 'DELETE')) {
    const { member } = await requireMember(deps, ctx);
    const id = orderMatch[1]!;
    if (!isUuid(id)) throw notFound();
    const existing = await loadOrderFull(deps, id, member.id);
    if (!existing) throw notFound();
    if (method === 'GET') return { status: 200, body: existing };
    if (!canCancelOrder(existing['status'] as OrderStatus)) {
      throw conflict('invalid_transition', { from: existing['status'], to: 'cancelled' });
    }
    await exchange.cancelOrder(existing['venue_id'] as string, member.id, id);
    const full = await loadOrderFull(deps, id, member.id);
    return { status: 200, body: full };
  }

  if (pathName === '/api/fills' && method === 'GET') {
    const { member } = await requireMember(deps, ctx);
    const marketId = url.searchParams.get('market_id');
    const params: unknown[] = [member.id];
    let where = `member_id = $1`;
    if (marketId) {
      if (!isUuid(marketId)) throw notFound();
      params.push(marketId);
      where += ` AND market_id = $${params.length}`;
    }
    const rows = await pool.query(`SELECT * FROM fills WHERE ${where} ORDER BY filled_at DESC LIMIT 200`, params);
    return { status: 200, body: { fills: (rows.rows as Record<string, unknown>[]).map(fillBody) } };
  }

  const fillMatch = pathName.match(/^\/api\/fills\/([^/]+)$/);
  if (fillMatch && method === 'GET') {
    const { member } = await requireMember(deps, ctx);
    const id = fillMatch[1]!;
    if (!isUuid(id)) throw notFound();
    const rows = await pool.query(`SELECT * FROM fills WHERE id = $1 AND member_id = $2`, [id, member.id]);
    const fill = rows.rows[0] as Record<string, unknown> | undefined;
    if (!fill) throw notFound();
    return { status: 200, body: fillBody(fill) };
  }

  if (pathName === '/api/balance' && method === 'GET') {
    const { venueId, member } = await requireMember(deps, ctx);
    const balances = await memberBalances(pool, venueId, member.id);
    return {
      status: 200,
      body: {
        available_cents: balances.available,
        held_cents: balances.held,
        collateral_cents: balances.collateral,
        total_cents: balances.available + balances.held + balances.collateral,
      },
    };
  }

  if (pathName === '/api/positions' && method === 'GET') {
    const { member } = await requireMember(deps, ctx);
    const spot = await pool.query(`SELECT market_id, quantity, reserved FROM spot_holdings WHERE member_id = $1 AND quantity > 0`, [member.id]);
    const margin = await pool.query(`SELECT * FROM margin_positions WHERE member_id = $1`, [member.id]);
    const event = await pool.query(`SELECT market_id, outcome, quantity FROM event_holdings WHERE member_id = $1 AND quantity > 0`, [member.id]);
    return { status: 200, body: { spot: spot.rows, margin: margin.rows, event: event.rows } };
  }

  return null;
}

async function handleMoneyApi(deps: HandlerDeps, ctx: RequestCtx, now: Date): Promise<ApiResult | null> {
  const { pool, config, billing, s3 } = deps;
  const { url, method } = ctx;
  const pathName = url.pathname;
  void now;

  if (pathName === '/api/deposits' && method === 'POST') {
    const { venueId, member } = await requireMember(deps, ctx);
    if (!member.roles.some((r) => r === 'trader' || r === 'builder')) throw forbidden();
    const body = asRecord(parseJson(ctx.bodyBuffer));
    const idemKey = typeof ctx.headers['idempotency-key'] === 'string' ? (ctx.headers['idempotency-key'] as string) : undefined;
    if (idemKey !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(idemKey)) {
      throw validationError({ 'Idempotency-Key': 'invalid' });
    }
    if (idemKey) {
      const lookup = await idempotencyLookup(deps, member.id, 'deposits', idemKey, body);
      if (lookup) {
        return { status: lookup.storedStatus, body: lookup.storedBody, headers: { 'Idempotent-Replayed': 'true' } };
      }
    }
    rejectUnknownFields(body, ['amount_cents', 'card_number']);
    const amount = intField(body, 'amount_cents');
    const card = strField(body, 'card_number');
    const errors: Record<string, string> = {};
    if (amount === undefined) errors['amount_cents'] = 'invalid';
    else if (amount < RANGES.deposit.min || amount > RANGES.deposit.max) errors['amount_cents'] = 'out_of_range';
    if (!card || !luhnValid(card)) errors['card_number'] = 'invalid';
    if (Object.keys(errors).length > 0) throw validationError(errors);

    const deposit = await billing.createDeposit({ venueId, memberId: member.id, amountCents: amount!, cardNumber: card! });
    const bodyOut = depositBody(deposit as unknown as Record<string, unknown>);
    if (idemKey) {
      await idempotencyStore(deps, member.id, 'deposits', idemKey, body, 201, bodyOut);
    }
    return { status: 201, body: bodyOut };
  }

  if (pathName === '/api/deposits' && method === 'GET') {
    const { member } = await requireMember(deps, ctx);
    const rows = await pool.query(`SELECT * FROM deposits WHERE member_id = $1 ORDER BY created_at DESC`, [member.id]);
    return { status: 200, body: { deposits: (rows.rows as Record<string, unknown>[]).map(depositBody) } };
  }

  const depositMatch = pathName.match(/^\/api\/deposits\/([^/]+)$/);
  if (depositMatch && method === 'GET') {
    const { member } = await requireMember(deps, ctx);
    const id = depositMatch[1]!;
    if (!isUuid(id)) throw notFound();
    const rows = await pool.query(`SELECT * FROM deposits WHERE id = $1 AND member_id = $2`, [id, member.id]);
    const deposit = rows.rows[0] as Record<string, unknown> | undefined;
    if (!deposit) throw notFound();
    return { status: 200, body: depositBody(deposit) };
  }

  const refundMatch = pathName.match(/^\/api\/deposits\/([^/]+)\/refunds$/);
  if (refundMatch && method === 'POST') {
    const { member: admin, venueId: adminVenue } = await requireRole(deps, ctx, 'market_admin');
    const id = refundMatch[1]!;
    if (!isUuid(id)) throw notFound();
    const body = asRecord(parseJson(ctx.bodyBuffer));
    rejectUnknownFields(body, ['amount_cents']);
    const amount = intField(body, 'amount_cents');
    if (amount === undefined) throw validationError({ amount_cents: 'invalid' });
    const depositRow = await pool.query(`SELECT * FROM deposits WHERE id = $1 AND venue_id = $2`, [id, adminVenue]);
    const deposit = depositRow.rows[0] as { venue_id: string } | undefined;
    if (!deposit) throw notFound();
    const refund = await billing.refundDeposit({ venueId: deposit.venue_id, depositId: id, adminId: admin.id, amountCents: amount });
    return {
      status: 201,
      body: {
        id: refund.id,
        deposit_id: refund.deposit_id,
        amount_cents: refund.amount_cents,
        killbill_transaction_id: refund.killbill_transaction_id,
        created_at: refund.created_at,
      },
    };
  }

  if (pathName === '/api/admin/deposits' && method === 'GET') {
    const { venueId } = await requireRole(deps, ctx, 'market_admin');
    const q = url.searchParams.get('q') ?? '';
    const rows = await pool.query(
      `SELECT d.*, m.id AS member_id, m.display_name, m.email FROM deposits d
       JOIN members m ON m.id = d.member_id
       WHERE d.venue_id = $1 AND ($2 = '' OR lower(m.display_name) LIKE '%' || lower($2) || '%' OR lower(m.email) LIKE '%' || lower($2) || '%')
       ORDER BY d.created_at DESC LIMIT 200`,
      [venueId, q]
    );
    return {
      status: 200,
      body: {
        deposits: (rows.rows as Record<string, unknown>[]).map((r) => ({
          ...depositBody(r),
          member: { id: r['member_id'], display_name: r['display_name'], email: r['email'] },
        })),
      },
    };
  }

  if (pathName === '/api/admin/documents' && method === 'GET') {
    const { venueId } = await requireRole(deps, ctx, 'market_admin');
    const rows = await pool.query(
      `SELECT d.*, m.display_name FROM id_documents d JOIN members m ON m.id = d.member_id WHERE d.venue_id = $1 ORDER BY d.created_at DESC`,
      [venueId]
    );
    return {
      status: 200,
      body: {
        documents: (rows.rows as Record<string, unknown>[]).map((r) => ({
          id: r['id'],
          member: { id: r['member_id'], display_name: r['display_name'] },
          filename: r['filename'],
          content_type: r['content_type'],
          size_bytes: r['size_bytes'],
          uploaded_at: r['created_at'],
        })),
      },
    };
  }

  const docLinkMatch = pathName.match(/^\/api\/admin\/documents\/([^/]+)\/link$/);
  if (docLinkMatch && method === 'GET') {
    const { venueId } = await requireRole(deps, ctx, 'market_admin');
    const id = docLinkMatch[1]!;
    if (!isUuid(id)) throw notFound();
    const rows = await pool.query(`SELECT * FROM id_documents WHERE id = $1 AND venue_id = $2`, [id, venueId]);
    const doc = rows.rows[0] as { member_id: string } | undefined;
    if (!doc) throw notFound();
    const signed = await presignGet(s3, config.s3.bucket, `venues/${venueId}/documents/${doc.member_id}/${id}`, 60);
    return { status: 200, body: { url: signed, expires_at: new Date(Date.now() + 60000).toISOString() } };
  }

  if (pathName === '/api/statements' && method === 'GET') {
    const { member } = await requireMember(deps, ctx);
    const rows = await pool.query(`SELECT id, month, created_at FROM statements WHERE member_id = $1 ORDER BY month DESC`, [member.id]);
    return { status: 200, body: { statements: rows.rows } };
  }

  const statementLink = pathName.match(/^\/api\/statements\/([^/]+)\/link$/);
  if (statementLink && method === 'GET') {
    const { member, venueId } = await requireMember(deps, ctx);
    const id = statementLink[1]!;
    if (!isUuid(id)) throw notFound();
    const rows = await pool.query(`SELECT * FROM statements WHERE id = $1 AND member_id = $2`, [id, member.id]);
    const statement = rows.rows[0] as { month: string } | undefined;
    if (!statement) throw notFound();
    const signed = await presignGet(s3, config.s3.bucket, `venues/${venueId}/statements/${member.id}/${statement.month}.pdf`, 60);
    return { status: 200, body: { url: signed, expires_at: new Date(Date.now() + 60000).toISOString() } };
  }

  return null;
}

async function handleBuilderApi(deps: HandlerDeps, ctx: RequestCtx, now: Date): Promise<ApiResult | null> {
  const { pool, svix, limiter, billing } = deps;
  const { url, method } = ctx;
  const pathName = url.pathname;
  void now;

  if (pathName === '/api/keys' && method === 'GET') {
    const { member } = await requireMember(deps, ctx);
    if (!member.roles.includes('builder')) throw forbidden();
    const rows = await pool.query(`SELECT id, name, created_at, revoked_at FROM api_keys WHERE member_id = $1 ORDER BY created_at DESC`, [member.id]);
    return { status: 200, body: { keys: rows.rows } };
  }

  if (pathName === '/api/keys' && method === 'POST') {
    const { member } = await requireMember(deps, ctx);
    if (!member.roles.includes('builder')) throw forbidden();
    const body = asRecord(parseJson(ctx.bodyBuffer));
    rejectUnknownFields(body, ['name']);
    const name = strField(body, 'name');
    if (!name || name.trim().length < 1 || name.trim().length > 40) throw validationError({ name: 'invalid' });
    const id = crypto.randomBytes(6).toString('hex');
    const secret = `pv_${id}_${crypto.randomBytes(20).toString('hex')}`;
    const hash = crypto.createHash('sha256').update(secret).digest('hex');
    await pool.query(`INSERT INTO api_keys (id, member_id, name, secret_hash) VALUES ($1,$2,$3,$4)`, [id, member.id, name.trim(), hash]);
    const snapshot = await billing.billingSnapshot(member).catch(() => null);
    await limiter.setRate(id, planRatePerSecond(snapshot?.effective_plan ?? 'sandbox')).catch(() => undefined);
    return { status: 201, body: { id, name: name.trim(), secret, created_at: new Date().toISOString() } };
  }

  const keyMatch = pathName.match(/^\/api\/keys\/([^/]+)$/);
  if (keyMatch && method === 'DELETE') {
    const { member } = await requireMember(deps, ctx);
    if (!member.roles.includes('builder')) throw forbidden();
    const id = keyMatch[1]!;
    const rows = await pool.query(`SELECT * FROM api_keys WHERE id = $1 AND member_id = $2`, [id, member.id]);
    const key = rows.rows[0] as { id: string } | undefined;
    if (!key) throw notFound();
    await pool.query(`UPDATE api_keys SET revoked_at = now() WHERE id = $1`, [id]);
    await limiter.removeKey(id).catch(() => undefined);
    return { status: 204, body: null };
  }

  if (pathName === '/api/billing' && method === 'GET') {
    const { member } = await requireMember(deps, ctx);
    if (!member.roles.includes('builder')) throw forbidden();
    const snapshot = await billing.billingSnapshot(member);
    return { status: 200, body: snapshot };
  }

  if (pathName === '/api/billing/plan' && method === 'POST') {
    const { member } = await requireMember(deps, ctx);
    if (!member.roles.includes('builder')) throw forbidden();
    const body = asRecord(parseJson(ctx.bodyBuffer));
    rejectUnknownFields(body, ['plan']);
    const plan = strField(body, 'plan');
    if (plan !== 'sandbox' && plan !== 'builder' && plan !== 'desk') throw validationError({ plan: 'invalid' });
    const snapshot = await billing.changePlan(member, plan);
    return { status: 200, body: snapshot };
  }

  if (pathName === '/api/billing/pay' && method === 'POST') {
    const { member } = await requireMember(deps, ctx);
    if (!member.roles.includes('builder')) throw forbidden();
    const snapshot = await billing.payOutstanding(member);
    return { status: 200, body: snapshot };
  }

  if (pathName === '/api/webhooks' && method === 'GET') {
    const { member } = await requireMember(deps, ctx);
    if (!member.roles.includes('builder')) throw forbidden();
    const endpointRow = await pool.query(`SELECT * FROM webhook_endpoints WHERE member_id = $1`, [member.id]);
    const endpoint = endpointRow.rows[0] as { url: string; svix_endpoint_id: string; signing_secret: string } | undefined;
    const venueRes = await pool.query(`SELECT slug FROM venues WHERE id = $1`, [member.venue_id]);
    const slug = (venueRes.rows[0] as { slug: string }).slug;
    let attempts: unknown[] = [];
    let delivery: 'ok' | 'delayed' = 'ok';
    if (endpoint) {
      try {
        attempts = await svix.listAttempts(`venue-${slug}`, endpoint.svix_endpoint_id);
      } catch {
        delivery = 'delayed';
      }
    }
    const mapped = attempts.map((a) => {
      const attempt = a as {
        id?: string; status?: number; statusText?: string; responseStatusCode?: number | null;
        msgId?: string; timestamp?: string;
      };
      // Svix reports numeric statuses; map them to the published names.
      const status = attempt.statusText === 'success' ? 'succeeded' : attempt.statusText === 'fail' ? 'failed' : 'pending';
      return {
        message_id: attempt.id ?? '',
        event_type: 'order.filled',
        event_id: attempt.msgId ?? attempt.id ?? '',
        status,
        response_status: attempt.responseStatusCode ?? null,
        timestamp: attempt.timestamp ?? '',
      };
    });
    return {
      status: 200,
      body: {
        endpoint: endpoint
          ? { url: endpoint.url, svix_endpoint_id: endpoint.svix_endpoint_id, signing_secret: endpoint.signing_secret }
          : null,
        delivery,
        attempts: mapped,
      },
    };
  }

  if (pathName === '/api/webhooks/endpoint' && method === 'PUT') {
    const { member } = await requireMember(deps, ctx);
    if (!member.roles.includes('builder')) throw forbidden();
    const body = asRecord(parseJson(ctx.bodyBuffer));
    rejectUnknownFields(body, ['url']);
    const urlValue = strField(body, 'url');
    if (!urlValue || urlValue.length > 500 || !/^https?:\/\//.test(urlValue)) throw validationError({ url: 'invalid' });
    const venueRes = await pool.query(`SELECT slug FROM venues WHERE id = $1`, [member.venue_id]);
    const slug = (venueRes.rows[0] as { slug: string }).slug;
    const appUid = `venue-${slug}`;
    const endpointUid = `member-${member.id}`;
    await svix.ensureApplication(appUid, slug);
    const existing = await pool.query(`SELECT svix_endpoint_id FROM webhook_endpoints WHERE member_id = $1`, [member.id]);
    const current = (existing.rows[0] as { svix_endpoint_id: string } | undefined)?.svix_endpoint_id;
    let secret = '';
    let endpointId = '';
    if (current) {
      const updated = await svix.updateEndpoint(appUid, endpointUid, urlValue);
      endpointId = updated.id ?? current;
      secret = await svix.getEndpointSecret(appUid, endpointUid);
      await pool.query(`UPDATE webhook_endpoints SET url = $2, svix_endpoint_id = $3, signing_secret = $4 WHERE member_id = $1`, [member.id, urlValue, endpointId, secret]);
    } else {
      const created = await svix.createEndpoint(appUid, endpointUid, urlValue);
      endpointId = created.id;
      secret = await svix.getEndpointSecret(appUid, endpointUid);
      await pool.query(
        `INSERT INTO webhook_endpoints (member_id, venue_id, url, svix_endpoint_id, signing_secret) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (member_id) DO UPDATE SET url = $3, svix_endpoint_id = $4, signing_secret = $5`,
        [member.id, member.venue_id, urlValue, endpointId, secret]
      );
    }
    return { status: 200, body: { url: urlValue, svix_endpoint_id: endpointId, signing_secret: secret } };
  }

  if (pathName === '/api/webhooks/endpoint' && method === 'DELETE') {
    const { member } = await requireMember(deps, ctx);
    if (!member.roles.includes('builder')) throw forbidden();
    const venueRes = await pool.query(`SELECT slug FROM venues WHERE id = $1`, [member.venue_id]);
    const slug = (venueRes.rows[0] as { slug: string }).slug;
    const row = await pool.query(`SELECT svix_endpoint_id FROM webhook_endpoints WHERE member_id = $1`, [member.id]);
    const current = (row.rows[0] as { svix_endpoint_id: string } | undefined)?.svix_endpoint_id;
    if (current) await svix.deleteEndpoint(`venue-${slug}`, current);
    await pool.query(`DELETE FROM webhook_endpoints WHERE member_id = $1`, [member.id]);
    return { status: 204, body: null };
  }

  return null;
}

async function handleVenueApi(deps: HandlerDeps, ctx: RequestCtx, now: Date): Promise<ApiResult | null> {
  const { pool, config, billing, s3, keycloak } = deps;
  const { url, method } = ctx;
  const pathName = url.pathname;

  if (pathName === '/api/venue/summary' && method === 'GET') {
    const venueId = requireVenue(ctx);
    return { status: 200, body: await venueSummary(deps, venueId, now) };
  }

  if (pathName === '/api/venue/totals' && method === 'GET') {
    const { venueId } = await requireRole(deps, ctx, 'org_owner');
    return { status: 200, body: await venueTotals(deps, venueId, now) };
  }

  if (pathName === '/api/venue/members' && method === 'GET') {
    const session = requireSession(ctx);
    if (!session.roles.includes('org_owner') && !session.roles.includes('market_admin')) throw forbidden();
    if (!session.venueId) throw forbidden();
    const q = (url.searchParams.get('q') ?? '').trim();
    if (q.length < 1 || q.length > 60) throw validationError({ q: 'invalid' });
    const rows = await pool.query(
      `SELECT id, display_name, email, roles FROM members WHERE venue_id = $1
       AND (lower(display_name) LIKE '%' || lower($2) || '%' OR lower(email) LIKE '%' || lower($2) || '%')
       ORDER BY display_name LIMIT 10`,
      [session.venueId, q]
    );
    return { status: 200, body: { members: rows.rows } };
  }

  if (pathName === '/api/venue/invites' && method === 'POST') {
    const { venueId } = await requireRole(deps, ctx, 'org_owner');
    const body = asRecord(parseJson(ctx.bodyBuffer));
    rejectUnknownFields(body, ['email', 'display_name', 'roles']);
    const emailRaw = strField(body, 'email');
    const displayNameRaw = strField(body, 'display_name');
    const roles = body['roles'];
    const email = emailRaw ?? '';
    const displayName = displayNameRaw ?? '';
    const errors: Record<string, string> = {};
    if (!emailRaw || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors['email'] = 'invalid';
    if (!displayNameRaw || displayName.trim().length < 1 || displayName.trim().length > 60) errors['display_name'] = 'invalid';
    if (!Array.isArray(roles) || roles.length === 0 || !roles.every((r) => ['trader', 'builder', 'market_admin'].includes(r as string))) {
      errors['roles'] = 'invalid';
    }
    if (Object.keys(errors).length > 0) throw validationError(errors);
    const existing = await pool.query(`SELECT 1 FROM members WHERE venue_id = $1 AND lower(email) = lower($2)`, [venueId, email]);
    if ((existing.rowCount ?? 0) > 0) throw conflict('already_member');
    const token = crypto.randomBytes(24).toString('hex');
    const venueRes = await pool.query(`SELECT slug FROM venues WHERE id = $1`, [venueId]);
    const slug = (venueRes.rows[0] as { slug: string }).slug;
    let memberRowId: string;
    try {
      const keycloakUser = await keycloak.createUser({
        username: `${slug}-${email.split('@')[0]}`.slice(0, 60),
        email,
        firstName: displayName!.split(' ')[0],
        lastName: displayName!.split(' ').slice(1).join(' ') || undefined,
        roles: roles as string[],
        groupName: `venue-${slug}`,
        requiredActions: ['UPDATE_PASSWORD'],
      });
      const invitesRes = await pool.query(
        `INSERT INTO invites (token, venue_id, email, display_name, roles, keycloak_id, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' seconds')::interval)`,
        [token, venueId, email, displayName, roles, keycloakUser.id, String(config.inviteTtlSeconds)]
      );
      void invitesRes;
      const memberRes = await pool.query(
        `INSERT INTO members (id, venue_id, keycloak_id, username, display_name, email, roles) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [crypto.randomUUID(), venueId, keycloakUser.id, `${slug}-${email.split('@')[0]}`.slice(0, 60), displayName, email, roles]
      );
      memberRowId = (memberRes.rows[0] as { id: string }).id;
    } catch (err) {
      if (err instanceof AppError) throw err;
      console.error('invite failed:', err instanceof Error ? err.message : err);
      throw new AppError(503, { error: 'identity_unavailable' });
    }
    await pool.query(
      `INSERT INTO outgoing_queue (id, venue_id, kind, payload) VALUES ($1,$2,'email',$3)`,
      [crypto.randomUUID(), venueId, JSON.stringify({ template: 'invite', invite_token: token })]
    );
    return { status: 201, body: { member_id: memberRowId, email, roles } };
  }

  if (pathName === '/api/venue/fees' && method === 'PUT') {
    const { venueId } = await requireRole(deps, ctx, 'org_owner');
    const body = asRecord(parseJson(ctx.bodyBuffer));
    rejectUnknownFields(body, ['taker_fee_bps', 'maker_fee_bps']);
    const taker = intField(body, 'taker_fee_bps');
    const maker = intField(body, 'maker_fee_bps');
    const errors: Record<string, string> = {};
    if (taker === undefined) errors['taker_fee_bps'] = 'invalid';
    else if (taker < RANGES.feeBps.min || taker > RANGES.feeBps.max) errors['taker_fee_bps'] = 'out_of_range';
    if (maker === undefined) errors['maker_fee_bps'] = 'invalid';
    else if (maker < RANGES.feeBps.min || maker > RANGES.feeBps.max) errors['maker_fee_bps'] = 'out_of_range';
    if (taker !== undefined && maker !== undefined && maker > taker) errors['maker_fee_bps'] = 'exceeds_taker';
    if (Object.keys(errors).length > 0) throw validationError(errors);
    await pool.query(`UPDATE venues SET taker_fee_bps = $2, maker_fee_bps = $3 WHERE id = $1`, [venueId, taker, maker]);
    return { status: 200, body: { taker_fee_bps: taker, maker_fee_bps: maker } };
  }

  if (pathName === '/api/venue/fills.csv' && method === 'GET') {
    const { venueId } = await requireRole(deps, ctx, 'org_owner');
    const month = url.searchParams.get('month') ?? '';
    const tzRes = await pool.query(`SELECT time_zone, slug FROM venues WHERE id = $1`, [venueId]);
    const venue = tzRes.rows[0] as { time_zone: string; slug: string };
    const venueMonth = month || formatMonth(now, venue.time_zone);
    if (!/^\d{4}-\d{2}$/.test(venueMonth)) throw validationError({ month: 'invalid' });
    const start = monthStart(venueMonth, venue.time_zone);
    const end = nextMonthStart(venueMonth, venue.time_zone);
    const rows = await pool.query(
      `SELECT f.id, f.filled_at, m.symbol, mem.email, f.mode, f.side, f.outcome, f.price, f.quantity, f.fee_cents, f.liquidity
       FROM fills f JOIN markets m ON m.id = f.market_id JOIN members mem ON mem.id = f.member_id
       WHERE f.venue_id = $1 AND f.filled_at >= $2 AND f.filled_at < $3
       ORDER BY f.filled_at ASC`,
      [venueId, start, end]
    );
    const lines = [`fill_id,filled_at,market_symbol,member_email,mode,side,outcome,price,quantity,fee_cents,liquidity`];
    for (const row of rows.rows as Record<string, unknown>[]) {
      lines.push([
        row['id'], (row['filled_at'] as Date).toISOString(), row['symbol'], row['email'],
        row['mode'] ?? '', row['side'], row['outcome'] ?? '', row['price'], row['quantity'], row['fee_cents'], row['liquidity'],
      ].join(','));
    }
    return {
      status: 200,
      body: Buffer.from(lines.join('\n')),
      contentType: 'text/csv',
      headers: { 'Content-Disposition': `attachment; filename="fills-${venue.slug}-${venueMonth}.csv"` },
    };
  }

  if (pathName === '/api/venue/billing' && method === 'GET') {
    const { venueId } = await requireRole(deps, ctx, 'org_owner');
    const rows = await pool.query(`SELECT * FROM members WHERE venue_id = $1 AND 'builder' = ANY(roles)`, [venueId]);
    const builders: Record<string, unknown>[] = [];
    for (const row of rows.rows as MemberRow[]) {
      const snapshot = await billing.billingSnapshot(row).catch(() => null);
      builders.push({
        member_id: row.id,
        display_name: row.display_name,
        plan: snapshot?.plan ?? 'sandbox',
        effective_plan: snapshot?.effective_plan ?? 'sandbox',
        state: snapshot?.state ?? 'active',
      });
    }
    return { status: 200, body: { builders } };
  }

  if (pathName === '/api/venue/statements' && method === 'POST') {
    const { venueId } = await requireRole(deps, ctx, 'org_owner');
    const body = asRecord(parseJson(ctx.bodyBuffer));
    rejectUnknownFields(body, ['month']);
    const month = strField(body, 'month');
    if (!month || !/^\d{4}-\d{2}$/.test(month)) throw validationError({ month: 'invalid' });
    const tzRes = await pool.query(`SELECT time_zone FROM venues WHERE id = $1`, [venueId]);
    const timeZone = (tzRes.rows[0] as { time_zone: string }).time_zone;
    const start = monthStart(month, timeZone);
    const end = nextMonthStart(month, timeZone);
    if (end.getTime() > Date.now()) throw validationError({ month: 'not_closed' });
    const members = await pool.query(`SELECT id FROM members WHERE venue_id = $1`, [venueId]);
    const already = await pool.query(`SELECT 1 FROM statement_runs WHERE venue_id = $1 AND month = $2`, [venueId, month]);
    const isRerun = (already.rowCount ?? 0) > 0;
    if (!isRerun) {
      await pool.query(`INSERT INTO statement_runs (venue_id, month) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [venueId, month]);
    }
    for (const member of members.rows as { id: string }[]) {
      const exists = await pool.query(`SELECT 1 FROM statements WHERE member_id = $1 AND month = $2`, [member.id, month]);
      if ((exists.rowCount ?? 0) > 0) continue;
      try {
        await generateStatementFor(pool, config, s3, venueId, member.id, month, start, end);
        await pool.query(
          `INSERT INTO outgoing_queue (id, venue_id, kind, payload) VALUES ($1,$2,'email',$3)`,
          [crypto.randomUUID(), venueId, JSON.stringify({ template: 'statement_ready', member_id: member.id, month })]
        );
      } catch {
        // A failed store stays pending; the scheduled run retries it.
      }
    }
    return { status: isRerun ? 200 : 202, body: { month, members: (members.rows as unknown[]).length } };
  }

  return null;
}

async function handlePlatformApi(deps: HandlerDeps, ctx: RequestCtx, now: Date): Promise<ApiResult | null> {
  const { pool, config, keycloak, svix, limiter, mailer, killbillUp, s3 } = deps;
  const { method } = ctx;
  const pathName = ctx.url.pathname;
  void now;

  if (pathName === '/api/platform/venues' && method === 'GET') {
    const session = requireSession(ctx);
    if (!session.roles.includes('founder_operator')) throw forbidden();
    const rows = await pool.query(
      `SELECT v.id, v.slug, v.name, v.time_zone, v.created_at,
        (SELECT count(*)::int FROM members WHERE venue_id = v.id) AS member_count
       FROM venues v ORDER BY v.created_at`
    );
    return { status: 200, body: { venues: rows.rows } };
  }

  if (pathName === '/api/platform/venues' && method === 'POST') {
    const session = requireSession(ctx);
    if (!session.roles.includes('founder_operator')) throw forbidden();
    const body = asRecord(parseJson(ctx.bodyBuffer));
    rejectUnknownFields(body, ['slug', 'name', 'time_zone', 'owner_email']);
    const slugRaw = strField(body, 'slug');
    const nameRaw = strField(body, 'name');
    const timeZoneRaw = strField(body, 'time_zone');
    const ownerEmailRaw = strField(body, 'owner_email');
    const slug = slugRaw ?? '';
    const name = nameRaw ?? '';
    const timeZone = timeZoneRaw ?? '';
    const ownerEmail = ownerEmailRaw ?? '';
    const errors: Record<string, string> = {};
    if (!slugRaw || !/^[a-z0-9-]{3,20}$/.test(slug)) errors['slug'] = 'invalid';
    if (!nameRaw || name.length < 1 || name.length > 60) errors['name'] = 'invalid';
    if (!timeZoneRaw || !isValidTimeZone(timeZone)) errors['time_zone'] = 'invalid';
    if (!ownerEmailRaw || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail)) errors['owner_email'] = 'invalid';
    if (Object.keys(errors).length > 0) throw validationError(errors);
    const taken = await pool.query(`SELECT 1 FROM venues WHERE slug = $1`, [slug]);
    if ((taken.rowCount ?? 0) > 0) throw conflict('slug_taken');
    const id = crypto.randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO venues (id, slug, name, time_zone) VALUES ($1,$2,$3,$4)`, [id, slug, name, timeZone]);
      await client.query(
        `INSERT INTO members (id, venue_id, username, display_name, email, roles) VALUES ($1,$2,$3,$4,$5,$6)`,
        [crypto.randomUUID(), id, ownerEmail.split('@')[0]!, ownerEmail.split('@')[0]!, ownerEmail, ['org_owner']]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      throw err;
    }
    client.release();
    try {
      await keycloak.ensureVenueGroup(slug);
      await keycloak.createUser({
        username: ownerEmail.split('@')[0]!,
        email: ownerEmail,
        roles: ['org_owner'],
        groupName: `venue-${slug}`,
        requiredActions: ['UPDATE_PASSWORD'],
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(503, { error: 'identity_unavailable' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    await pool.query(
      `INSERT INTO invites (token, venue_id, email, display_name, roles, expires_at)
       VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' seconds')::interval)`,
      [token, id, ownerEmail, ownerEmail.split('@')[0]!, ['org_owner'], String(config.inviteTtlSeconds)]
    );
    await pool.query(
      `INSERT INTO outgoing_queue (id, venue_id, kind, payload) VALUES ($1,$2,'email',$3)`,
      [crypto.randomUUID(), id, JSON.stringify({ template: 'invite', invite_token: token })]
    );
    const rows = await pool.query(`SELECT * FROM venues WHERE id = $1`, [id]);
    return { status: 201, body: { ...rows.rows[0], member_count: 1 } };
  }

  if (pathName === '/api/platform/health' && method === 'GET') {
    const session = requireSession(ctx);
    if (!session.roles.includes('founder_operator')) throw forbidden();
    const providers: Record<string, string> = {};
    const up = async (name: string, probe: Promise<unknown>): Promise<void> => {
      try {
        await Promise.race([probe, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))]);
        providers[name] = 'up';
      } catch {
        providers[name] = 'down';
      }
    };
    const checks: [string, Promise<unknown>][] = [
      ['keycloak', keycloak.serviceToken()],
      ['killbill', Promise.resolve(killbillUp()).then((ok) => { if (!ok) throw new Error('down'); })],
      ['postgres', pool.query('SELECT 1')],
      ['valkey', deps.redis.ping()],
      ['svix', svix.listApplications()],
      ['minio', presignGet(s3, config.s3.bucket, 'health-probe', 60)],
      ['mailpit', mailer.send({ to: 'health@plumtide.example', subject: 'probe', text: 'probe' })],
    ];
    await Promise.all(checks.map(([name, probe]) => up(name, probe)));
    return { status: 200, body: { providers, checked_at: new Date().toISOString() } };
  }

  return null;
}
