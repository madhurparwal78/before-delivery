// All API routes in one file, in the published precedence order.
import crypto from 'node:crypto';
import type { RouteContext } from './http.js';
import { route, sendJson, readJsonBody, JSON_HEADERS, type Route } from './http.js';
import { errors, ApiError } from '../lib/errors.js';
import { config } from '../lib/config.js';
import {
  randomId,
  randomToken,
  randomCode,
  nowMs,
  now,
  monthKey,
  hashPassword,
  verifyPassword,
  isoDate,
} from '../lib/clock.js';
import { CITIES, ROLE_FAMILIES, WORK_PATTERNS, COMPANY_SIZES, OUTCOMES, POST_KINDS, REJECTION_REASONS, STAGES, payBandFor, cityName, roleName, workPatternName, AUTHOR_LABEL } from '../lib/reference.js';
import { ratingAverage, payBand, threshold } from '../lib/derived.js';
import { createSession, setSession, SESSION_COOKIE, userFromSession } from '../lib/sessions.js';
import {
  containsContact,
  isEmail,
  isPhone,
  text,
  COPY,
  requireString,
  requireInt,
  requireEnum,
  throwFields,
  stripReviewPaths,
  type Body,
  type Fields,
} from '../lib/validation.js';
import { meili } from '../lib/meili.js';
import { s3 } from '../lib/s3.js';
import { sendMail, smtpAvailable } from '../lib/mail.js';
import { migrateAndSeed, seedFounder } from './seed.js';
import {
  companyView,
  companyHitBySlug,
  companyJobs,
  unlockedFor,
  type Viewer,
  type JobSummary,
} from './projection.js';
import { indexJob, deleteJobDoc, indexCompany, queueSync } from './search.js';
import type { App } from '../lib/app.js';

const CITY_IDS = CITIES.map((c) => c.id);
const ROLE_IDS = ROLE_FAMILIES.map((r) => r.id);
const REMOTE_IDS = WORK_PATTERNS.map((w) => w.id);

function body(ctx: RouteContext): Body {
  return (ctx.body ?? {}) as Body;
}

function viewerOf(ctx: RouteContext): Viewer {
  const user = ctx.user;
  if (!user) return { role: 'anonymous', unlocked: false, userId: null };
  return { role: user.role, unlocked: user.unlocked, userId: user.id };
}

// ---------- helpers ----------

async function findCompanyBySlugOr404(app: App, slug: string): Promise<{ id: string; slug: string; name: string; city: string; size: string; verified: boolean; email_domain: string; mark_file_id: string | null }> {
  const row = await app.db.one<{ id: string; slug: string; name: string; city: string; size: string; verified: boolean; email_domain: string; mark_file_id: string | null }>('select id, slug, name, city, size, verified, email_domain, mark_file_id from companies where slug = $1', [slug]);
  if (!row) throw errors.notFound();
  return row;
}

async function requireCompany(app: App, body: Body, field: string, fields: Fields): Promise<{ id: string; slug: string; name: string }> {
  const raw = body[field];
  if (typeof raw !== 'string' || raw.length === 0) {
    fields[field] = COPY.company_id;
    return { id: '', slug: '', name: '' };
  }
  const row = await app.db.one<{ id: string; slug: string; name: string }>('select id, slug, name from companies where id = $1', [raw]);
  if (!row) throw errors.notFound();
  return row;
}

function postLabel(kind: string, row: { title?: string | null; role_family?: string | null; company_name: string }): string {
  if (kind === 'review') return row.title ?? '';
  if (kind === 'pay_report') return `Pay report: ${roleName(row.role_family ?? '')} at ${row.company_name}`;
  return `Interview note: ${roleName(row.role_family ?? '')} at ${row.company_name}`;
}

async function outbox(
  app: App,
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  kind: string,
  to: string,
  subject: string,
  bodyText: string,
): Promise<void> {
  await client.query(
    'insert into outbox (kind, to_email, subject, body) values ($1, $2, $3, $4)',
    [kind, to, subject, bodyText],
  );
}

function publicCompanyChanged(app: App, slug: string, company: unknown): void {
  app.live.publish({ type: 'company.changed', data: { slug, company } });
}

// ---------- routes ----------

const routes: Route[] = [];

function add(
  method: string,
  path: string,
  handler: (ctx: RouteContext) => Promise<void>,
  auth?: Route['auth'],
): void {
  routes.push(route(method, path, handler, auth));
}

// Health

add('GET', '/api/health', async (ctx) => {
  const [searchOk, storageOk] = await Promise.all([meili.health(), s3Health()]);
  const ok = searchOk && storageOk;
  sendJson(ctx.res, 200, { status: ok ? 'ok' : 'unavailable' });
});

add('GET', '/health', async (ctx) => {
  const [searchOk, storageOk] = await Promise.all([meili.health(), s3Health()]);
  sendJson(ctx.res, 200, { status: searchOk && storageOk ? 'ok' : 'unavailable' });
});

async function s3Health(): Promise<boolean> {
  try {
    await s3.stat('health/probe');
    return false;
  } catch (err) {
    const message = String(err);
    return !/fetch failed|ENOTFOUND|ECONNREFUSED|timeout/i.test(message) && !/s3 5\d\d/.test(message) ? true : !/s3 404/.test(message) ? true : false;
  }
}

// Accounts

add('POST', '/api/auth/sign-in', async (ctx) => {
  const b = body(ctx);
  const fields: Fields = {};
  const email = requireString(b, 'email', 3, 320, COPY.email, fields).trim().toLowerCase();
  const password = text(b.password);
  if (typeof b.password !== 'string' || password.length === 0) fields.password = COPY.password;
  throwFields(fields);
  const row = await ctx.app.db.one<{ id: string; password_hash: string; display_name: string; role: string; unlocked: boolean }>(
    'select id, password_hash, display_name, role, unlocked from users where email = $1',
    [email],
  );
  // The same password work runs whether or not the account exists.
  const hashToCheck = row?.password_hash ?? 'scrypt$00$00';
  const okPassword = verifyPassword(password, hashToCheck);
  if (!row || !okPassword) throw errors.invalidCredentials();
  const token = await createSession(ctx.app, row.id);
  setSession(ctx.res, token);
  sendJson(ctx.res, 200, {
    user: { id: row.id, display_name: row.display_name, role: row.role, unlocked: row.unlocked },
  });
});

add('POST', '/api/auth/sign-out', async (ctx) => {
  setSession(ctx.res, null);
  ctx.res.writeHead(204);
  ctx.res.end();
});

add('GET', '/api/me', async (ctx) => {
  if (!ctx.user) throw errors.unauthenticated();
  const companyRow = ctx.user.company_slug
    ? await ctx.app.db.one<{ id: string }>('select id from companies where slug = $1', [ctx.user.company_slug])
    : null;
  sendJson(ctx.res, 200, {
    id: ctx.user.id,
    display_name: ctx.user.display_name,
    email: ctx.user.email,
    role: ctx.user.role,
    company_slug: ctx.user.company_slug,
    unlocked: ctx.user.unlocked,
    company_id: companyRow?.id ?? null,
  });
});

add('POST', '/api/auth/join', async (ctx) => {
  const b = body(ctx);
  const fields: Fields = {};
  const displayName = requireString(b, 'display_name', 2, 40, COPY.display_name, fields);
  const email = requireString(b, 'email', 3, 320, COPY.email, fields).trim().toLowerCase();
  if (!isEmail(email)) fields.email = COPY.email;
  const password = text(b.password);
  if (typeof b.password !== 'string' || password.length < 10) fields.password = COPY.password;
  throwFields(fields);
  const existing = await ctx.app.db.one<{ id: string }>('select id from users where email = $1', [email]);
  const cfg = config();
  const token = randomToken();
  if (!existing) {
    await ctx.app.db.query(
      `insert into tokens (token, kind, email, expires_at) values ($1, 'join', $2, $3)`,
      [token, email, new Date(nowMs() + cfg.emailLinkTtlSeconds * 1000)],
    );
  } else {
    await ctx.app.db.query(
      `insert into tokens (token, kind, email, expires_at) values ($1, 'reset', $2, $3)`,
      [token, email, new Date(nowMs() + 1000)],
    );
  }
  // The reply is identical either way; mail is queued after the reply.
  sendJson(ctx.res, 202, { status: 'check_email' });
  if (!existing) {
    await outbox(
      ctx.app,
      ctx.app.db,
      'join',
      email,
      'Finish joining Candour Bench',
      `${cfg.publicUrl}/join/confirm?token=${token}`,
    );
  } else {
    await outbox(
      ctx.app,
      ctx.app.db,
      'join_existing',
      email,
      'You already have a Candour Bench account',
      `Sign in at ${cfg.publicUrl}/sign-in or reset your password at ${cfg.publicUrl}/forgot-password`,
    );
  }
});

add('POST', '/api/auth/join/confirm', async (ctx) => {
  const b = body(ctx);
  const token = text(b.token);
  if (token.length === 0) throw errors.tokenInvalid();
  const row = await ctx.app.db.withClient(async (client) => {
    const found = await client.query(
      `select token, email, expires_at, used_at from tokens where token = $1 and kind = 'join' for update`,
      [token],
    );
    if (found.rows.length === 0) return null;
    const record = found.rows[0] as { token: string; email: string; expires_at: Date; used_at: Date | null };
    if (record.used_at || record.expires_at.getTime() <= nowMs()) return null;
    const userRow = await client.query(
      'select id, display_name, role, unlocked from users where email = $1',
      [record.email],
    );
    let userId: string;
    let display_name: string;
    let role: string;
    let unlocked: boolean;
    if (userRow.rows.length > 0) {
      const user = userRow.rows[0] as { id: string; display_name: string; role: string; unlocked: boolean };
      userId = user.id;
      display_name = user.display_name;
      role = user.role;
      unlocked = user.unlocked;
    } else {
      userId = randomId();
      display_name = 'New member';
      role = 'member';
      unlocked = false;
      await client.query(
        `insert into users (id, display_name, email, password_hash, role) values ($1, $2, $3, $4, 'member')`,
        [userId, display_name, record.email, hashPassword(randomToken(8))],
      );
    }
    await client.query('update tokens set used_at = now() where token = $1', [token]);
    const sessionToken = randomToken();
    await client.query(
      'insert into sessions (token, user_id, expires_at) values ($1, $2, $3)',
      [sessionToken, userId, new Date(nowMs() + 30 * 24 * 3600 * 1000)],
    );
    return { sessionToken, display_name, role, unlocked, id: userId };
  });
  if (!row) throw errors.tokenInvalid();
  setSession(ctx.res, row.sessionToken);
  sendJson(ctx.res, 201, {
    user: { id: row.id, display_name: row.display_name, role: row.role, unlocked: row.unlocked },
  });
});

add('POST', '/api/auth/forgot', async (ctx) => {
  const b = body(ctx);
  const fields: Fields = {};
  const email = requireString(b, 'email', 3, 320, COPY.email, fields).trim().toLowerCase();
  if (!isEmail(email)) fields.email = COPY.email;
  throwFields(fields);
  const existing = await ctx.app.db.one<{ id: string }>('select id from users where email = $1', [email]);
  const cfg = config();
  sendJson(ctx.res, 202, { status: 'sent' });
  if (existing) {
    const token = randomToken();
    await ctx.app.db.query(
      `insert into tokens (token, kind, email, user_id, expires_at) values ($1, 'reset', $2, $3, $4)`,
      [token, email, existing.id, new Date(nowMs() + cfg.emailLinkTtlSeconds * 1000)],
    );
    await outbox(
      ctx.app,
      ctx.app.db,
      'reset',
      email,
      'Reset your Candour Bench password',
      `${cfg.publicUrl}/reset-password?token=${token}`,
    );
  }
});

add('POST', '/api/auth/reset', async (ctx) => {
  const b = body(ctx);
  const token = text(b.token);
  const password = text(b.password);
  const fields: Fields = {};
  if (typeof b.password !== 'string' || password.length < 10) fields.password = COPY.password;
  throwFields(fields);
  if (token.length === 0) throw errors.tokenInvalid();
  const result = await ctx.app.db.withClient(async (client) => {
    const found = await client.query(
      `select token, email, user_id, expires_at, used_at from tokens where token = $1 and kind in ('reset','set_password') for update`,
      [token],
    );
    if (found.rows.length === 0) return null;
    const record = found.rows[0] as { token: string; email: string; user_id: string | null; expires_at: Date; used_at: Date | null };
    if (record.used_at || record.expires_at.getTime() <= nowMs()) return null;
    const userRow = await client.query(
      'select id, display_name, role, unlocked from users where email = $1',
      [record.email],
    );
    if (userRow.rows.length === 0) return null;
    const user = userRow.rows[0] as { id: string; display_name: string; role: string; unlocked: boolean };
    await client.query('update users set password_hash = $1 where id = $2', [hashPassword(password), user.id]);
    await client.query('update tokens set used_at = now() where token = $1', [token]);
    const sessionToken = randomToken();
    await client.query(
      'insert into sessions (token, user_id, expires_at) values ($1, $2, $3)',
      [sessionToken, user.id, new Date(nowMs() + 30 * 24 * 3600 * 1000)],
    );
    return { sessionToken, user };
  });
  if (!result) throw errors.tokenInvalid();
  setSession(ctx.res, result.sessionToken);
  sendJson(ctx.res, 200, {
    user: {
      id: result.user.id,
      display_name: result.user.display_name,
      role: result.user.role,
      unlocked: result.user.unlocked,
    },
  });
});

export { routes as accountRoutes };
