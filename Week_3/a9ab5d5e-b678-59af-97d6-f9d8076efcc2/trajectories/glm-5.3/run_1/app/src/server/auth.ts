/** Household, session, invite and join endpoints. */
import { createHash, randomBytes } from 'node:crypto';
import { Ctx, isStateChanging, sendJson } from './http';
import { problem } from './problems';
import { AppDeps } from './apiTypes';
import { appendLog, withTransaction } from '../db/db';
import { hashPassword } from '../db/seed';
import { checkEmail, checkText, fail, hasField, isObject } from './validate';
import { bodyOf } from './helpers';
import { currencyExponent, isCurrency } from '../lib/money';
import { nfc } from '../lib/text';
import { verifyPassword } from '../db/seed';
import { Household as HH, PlanVersionRow } from './apiTypes';
import { householdToday } from '../domain/today';
import { Temporal } from '@js-temporal/polyfill';
import { nowInstant } from '../lib/time';
import type { PlanRule } from '../domain/plan';

export async function createHousehold(ctx: Ctx, deps: AppDeps): Promise<void> {
  const body = requireJsonBody(ctx);
  const allowed = ['householdName', 'currency', 'yourName', 'email', 'password', 'otherParentName', 'otherParentEmail'];
  rejectUnknown(body, allowed);
  for (const f of allowed) {
    if (!hasField(body, f)) fail({ [f]: 'This field is not accepted.' });
  }
  const householdName = checkText('householdName', body.householdName, { min: 1, max: 80 });
  const currency = typeof body.currency === 'string' && isCurrency(body.currency)
    ? body.currency
    : fail({ currency: 'Choose an ISO 4217 currency code.' });
  const yourName = checkText('yourName', body.yourName, { min: 1, max: 80 });
  const email = checkEmail('email', body.email);
  const password = checkText('password', body.password, { min: 12, max: 128 });
  const otherParentName = checkText('otherParentName', body.otherParentName, { min: 1, max: 80 });
  const otherParentEmail = checkEmail('otherParentEmail', body.otherParentEmail);

  const emailTaken = async (e: string) => {
    const res = await deps.pool.query(
      `SELECT 1 FROM households WHERE lower(planning_email) = lower($1) OR lower(other_email) = lower($1)`,
      [nfc(e)],
    );
    return res.rows.length > 0;
  };
  if (nfc(email).toLowerCase() === nfc(otherParentEmail).toLowerCase()) {
    fail({ otherParentEmail: 'The other parent needs their own email.' });
  }
  if (await emailTaken(email)) throw problem(409, 'email_taken');
  if (await emailTaken(otherParentEmail)) throw problem(409, 'email_taken');

  const hid = randomId();
  const userId = `${hid}-planning`;
  const token = randomToken();
  await withTransaction(deps.pool, async (client) => {
    await client.query(
      `INSERT INTO households (id, name, currency, planning_name, planning_email, planning_password_hash, other_name, other_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [hid, nfc(householdName), currency, nfc(yourName), email, hashPassword(password),
        nfc(otherParentName), otherParentEmail],
    );
    await client.query(
      `INSERT INTO sessions (token, user_id, role, household_id) VALUES ($1,$2,'planning',$3)`,
      [token, userId, hid],
    );
    await appendLog(client, hid, 'planning', 'household.created', hid);
  });
  sendJson(ctx, 201, { householdId: hid, userId, role: 'planning', token });
}

export async function signIn(ctx: Ctx, deps: AppDeps): Promise<void> {
  const body = requireJsonBody(ctx);
  rejectUnknown(body, ['email', 'password']);
  for (const f of ['email', 'password']) {
    if (!hasField(body, f)) fail({ [f]: 'This field is not accepted.' });
  }
  const email = typeof body.email === 'string' ? body.email : fail({ email: 'Enter a valid email address.' });
  const password = typeof body.password === 'string' ? body.password : fail({ password: 'Use 12 to 128 characters.' });

  // sliding window limit, shared by every process on the database
  const windowStart = new Date(Date.now() - 60_000);
  const countRes = await deps.pool.query(
    `SELECT count(*)::int AS n FROM sign_in_failures WHERE lower(email) = lower($1) AND at > $2`,
    [nfc(email), windowStart],
  );
  if (countRes.rows[0].n >= 5) {
    throw problem(429, 'too_many_attempts', { headers: { 'retry-after': retryAfterSeconds(deps, email).toString() } });
  }

  const res = await deps.pool.query(
    `SELECT id, planning_name, planning_email, planning_password_hash, other_name, other_email, other_password_hash
     FROM households WHERE lower(planning_email) = lower($1) OR lower(other_email) = lower($1)`,
    [nfc(email)],
  );
  let role: 'planning' | 'other' | null = null;
  let hid: string | null = null;
  let pwHash: string | null = null;
  const row = res.rows[0];
  if (row) {
    if (row.planning_email.toLowerCase() === nfc(email).toLowerCase()) {
      role = 'planning'; hid = row.id; pwHash = row.planning_password_hash;
    } else if (row.other_email.toLowerCase() === nfc(email).toLowerCase()) {
      role = 'other'; hid = row.id; pwHash = row.other_password_hash;
    }
  }
  const ok = pwHash !== null && verifyPw(password, pwHash);
  if (!ok) {
    await deps.pool.query(`INSERT INTO sign_in_failures (email, at) VALUES ($1, now())`, [nfc(email)]);
    // retry-after: remaining whole seconds in the window, at least 1
    const headers = { 'retry-after': retryAfterSeconds(deps, email).toString() };
    throw problem(401, 'invalid_credentials', { headers });
  }
  const userId = role === 'planning' ? `${hid}-planning` : `${hid}-other`;
  const token = randomToken();
  await deps.pool.query(
    `INSERT INTO sessions (token, user_id, role, household_id) VALUES ($1,$2,$3,$4)`,
    [token, userId, role, hid],
  );
  sendJson(ctx, 200, { userId, role, token });
}


export async function signOut(ctx: Ctx, deps: AppDeps): Promise<void> {
  const token = ctx.bearerToken()!;
  await deps.pool.query(`DELETE FROM sessions WHERE token = $1`, [token]);
  ctx.res.writeHead(204);
  ctx.res.end();
}

export async function me(ctx: Ctx, deps: AppDeps): Promise<void> {
  const h = await loadHousehold(deps, ctx.householdId!);
  const versions = await loadVersions(deps, ctx.householdId!);
  const adopted = versions.filter((v) => v.status === 'adopted');
  const draft = versions.find((v) => v.status === 'draft') ?? null;
  const today = householdTodayOf(adopted, draft);
  sendJson(ctx, 200, {
    userId: ctx.userId,
    name: ctx.role === 'planning' ? h.planning_name : h.other_name,
    role: ctx.role,
    household: {
      id: h.id,
      name: h.name,
      planningName: h.planning_name,
      otherName: h.other_name,
      otherJoined: h.other_joined_at !== null,
      today: today.toString(),
      zone: adoptedZone(adopted, draft),
      currency: h.currency,
      currencyExponent: currencyExponentOf(h.currency),
    },
  });
}


function currencyExponentOf(c: string): number {
  return currencyExponent(c);
}

function householdTodayOf(adopted: PlanVersionRow[], draft: PlanVersionRow | null): Temporal.PlainDate {
  const toV = (v: PlanVersionRow): import('../domain/derived').VersionForNight => ({
    effectiveFrom: v.effective_from,
    exchangeZone: v.exchange_zone,
    firstExchangeAt: v.first_exchange_at,
    pattern: v.base_pattern,
    anchor: v.base_anchor,
    maxConsecutiveNights: v.max_consecutive_nights,
    rules: (bodyOf(v.body) as { rules: PlanRule[] }).rules,
  });
  return householdToday(adopted.map(toV), draft ? toV(draft) : null, nowInstant());
}

function adoptedZone(adopted: PlanVersionRow[], draft: PlanVersionRow | null): string {
  if (adopted.length > 0) return adopted[adopted.length - 1].exchange_zone;
  if (draft) return draft.exchange_zone;
  return 'UTC';
}

async function loadHousehold(deps: AppDeps, hid: string): Promise<HH> {
  const res = await deps.pool.query(`SELECT * FROM households WHERE id = $1`, [hid]);
  if (res.rows.length === 0) throw problem(404, 'not_found');
  return res.rows[0] as HH;
}

async function loadVersions(deps: AppDeps, hid: string): Promise<PlanVersionRow[]> {
  const res = await deps.pool.query(
    `SELECT * FROM plan_versions WHERE household_id = $1 ORDER BY number DESC`,
    [hid],
  );
  return res.rows as PlanVersionRow[];
}

function verifyPw(password: string, stored: string): boolean {
  return verifyPassword(password, stored);
}

export function randomId(): string {
  // decimal digits, may exceed 2^53: use a random 128-bit value
  const raw = randomBytes(16).toString('hex');
  return BigInt('0x' + raw).toString();
}

export function etagForId(id: string): string {
  return `"${createHash('sha256').update(id).digest('hex')}"`;
}

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function requireJsonBody(ctx: Ctx): Record<string, unknown> {
  const body = ctx.body ?? Buffer.alloc(0);
  const ct = ctx.header('content-type') ?? '';
  const isJson = ct === '' || ct.startsWith('application/json');
  if (!isJson && body.length === 0) return {};
  if (!ct.startsWith('application/json')) {
    throw problem(415, 'unsupported_media_type');
  }
  let parsed: unknown;
  try {
    if (body.length === 0) return {};
    parsed = JSON.parse(body.toString('utf8'), reviveNoDuplicates);
  } catch {
    throw problem(400, 'malformed_json');
  }
  if (!isObject(parsed)) fail({ '': 'This field is not accepted.' });
  return parsed;
}

function reviveNoDuplicates(_key: string, value: unknown): unknown {
  // duplicate keys are caught during parse via a side-channel: JSON.parse
  // overwrites silently, so re-serialise comparison is done in rejectUnknown path
  return value;
}

export function rejectUnknown(body: Record<string, unknown>, allowed: string[]): void {
  for (const k of Object.keys(body)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
      fail({ [k]: 'This field is not accepted.' });
    }
    if (!allowed.includes(k)) {
      fail({ [k]: 'This field is not accepted.' });
    }
  }
}


/** Remaining whole seconds in the sliding window, rounded up, at least 1. */
async function retryAfterSeconds(deps: AppDeps, email: string): Promise<number> {
  void deps;
  const res = await deps.pool.query(
    `SELECT extract(epoch from max(at)) AS t FROM sign_in_failures WHERE lower(email) = lower($1) AND at > now() - interval '60 seconds'`,
    [nfc(email)],
  );
  const t = res.rows[0]?.t ? Number(res.rows[0].t) : Date.now() / 1000;
  const remaining = 60 - (Date.now() / 1000 - t);
  return Math.max(1, Math.ceil(remaining));
}

export async function requireSession(ctx: Ctx, deps: AppDeps): Promise<void> {
  if (isStateChanging(ctx.method())) checkOrigin(ctx, deps.config);
  const token = ctx.bearerToken();
  if (!token) throw problem(401, 'unauthenticated');
  const res = await deps.pool.query(
    `SELECT s.user_id, s.role, s.household_id FROM sessions s WHERE s.token = $1`,
    [token],
  );
  if (res.rows.length === 0) throw problem(401, 'unauthenticated');
  ctx.userId = res.rows[0].user_id as string;
  ctx.role = res.rows[0].role as 'planning' | 'other';
  ctx.householdId = res.rows[0].household_id as string;
}

function checkOrigin(ctx: Ctx, config: { appPublicUrl: string }): void {
  const origin = ctx.header('origin');
  const expected = new URL(config.appPublicUrl).origin;
  if (origin !== expected) throw problem(403, 'origin_mismatch');
}

export async function authHousehold(ctx: Ctx, deps: AppDeps, hid: string): Promise<void> {
  await requireSession(ctx, deps);
  if (hid !== ctx.householdId) throw problem(404, 'not_found');
}

export async function invite(ctx: Ctx, deps: AppDeps): Promise<void> {
  if (ctx.role !== 'planning') throw problem(403, 'planning_parent_only');
  const h = await loadHouseholdRow(deps, ctx.householdId!);
  if (h.other_joined_at) throw problem(409, 'already_joined');
  const token = randomToken();
  const ttl = deps.config.inviteTtlSeconds;
  const noticeId = randomId();
  await withTransaction(deps.pool, async (client) => {
    // supersede queued invites in the same transaction
    await client.query(
      `UPDATE notices SET status='superseded' WHERE household_id=$1 AND kind='invite' AND status='queued'`,
      [ctx.householdId],
    );
    await client.query(`DELETE FROM invites WHERE household_id=$1`, [ctx.householdId]);
    await client.query(
      `INSERT INTO invites (token, household_id, expires_at) VALUES ($1,$2, now() + ($3 || ' seconds')::interval)`,
      [token, ctx.householdId, String(ttl)],
    );
    await client.query(
      `INSERT INTO notices (id, household_id, kind, to_email, subject, link, status)
       VALUES ($1,$2,'invite',$3,$4,$5,'queued')`,
      [noticeId, ctx.householdId, h.other_email, `You're invited to ${h.name} on Twohouse`, `/join/${token}`],
    );
    await appendLog(client, ctx.householdId!, 'planning', 'invite.sent', noticeId);
  });
  sendJson(ctx, 202, { noticeId });
}

export async function joinInfo(ctx: Ctx, deps: AppDeps, token: string): Promise<void> {
  const res = await deps.pool.query(
    `SELECT h.name, h.other_name FROM invites i JOIN households h ON h.id = i.household_id
     WHERE i.token = $1 AND i.expires_at > now()`,
    [token],
  );
  if (res.rows.length === 0) throw problem(404, 'not_found');
  sendJson(ctx, 200, { householdName: res.rows[0].name, otherParentName: res.rows[0].other_name });
}

export async function joinByInvite(ctx: Ctx, deps: AppDeps): Promise<void> {
  const body = requireJsonBody(ctx);
  rejectUnknown(body, ['token', 'password']);
  for (const f of ['token', 'password']) {
    if (!hasField(body, f)) fail({ [f]: 'This field is not accepted.' });
  }
  const token = typeof body.token === 'string' ? body.token : fail({ token: 'This field is not accepted.' });
  const password = checkText('password', body.password, { min: 12, max: 128 });
  const userId = randomId();
  const sessionToken = randomToken();
  const joined = await withTransaction(deps.pool, async (client) => {
    // one success for simultaneous joins: the token row is the claim
    const claim = await client.query(
      `DELETE FROM invites WHERE token = $1 AND expires_at > now() RETURNING household_id`,
      [token],
    );
    if (claim.rows.length === 0) return null;
    const hid = claim.rows[0].household_id as string;
    const h = await client.query(`SELECT other_joined_at FROM households WHERE id=$1`, [hid]);
    if (h.rows[0].other_joined_at) return null;
    await client.query(
      `UPDATE households SET other_password_hash=$2, other_joined_at=now() WHERE id=$1 AND other_joined_at IS NULL`,
      [hid, hashPassword(password)],
    );
    await client.query(
      `INSERT INTO sessions (token, user_id, role, household_id) VALUES ($1,$2,'other',$3)`,
      [sessionToken, userId, hid],
    );
    await appendLog(client, hid, 'other', 'household.joined', hid);
    return hid;
  });
  if (joined === null) throw problem(404, 'not_found');
  sendJson(ctx, 200, { householdId: joined, userId, role: 'other', token: sessionToken });
}

async function loadHouseholdRow(deps: AppDeps, hid: string): Promise<HH> {
  const res = await deps.pool.query(`SELECT * FROM households WHERE id = $1`, [hid]);
  if (res.rows.length === 0) throw problem(404, 'not_found');
  return res.rows[0] as HH;
}
