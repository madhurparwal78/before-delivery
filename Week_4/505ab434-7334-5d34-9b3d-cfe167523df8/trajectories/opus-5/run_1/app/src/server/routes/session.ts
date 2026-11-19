import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db.js';
import { errors } from '../errors.js';
import { parseCookies, requireSignedIn, jsonBody, type Ctx } from '../http/context.js';
import { sendEmpty, sendJson } from '../http/respond.js';
import { verifyPassword } from '../passwords.js';
import { repo } from '../repo.js';
import { storage } from '../storage.js';
import { businessDate } from '../time.js';

export function sessionCookie(sessionId: string): string {
  return `${config.sessionCookieName}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedCookie(): string {
  return `${config.sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function createSession(principalId: string): Promise<string> {
  const sessionId = randomBytes(24).toString('hex');
  await db.query('insert into sessions (id, principal_id, created_at) values ($1,$2,now())', [
    sessionId,
    principalId,
  ]);
  return sessionId;
}

export async function health(ctx: Ctx): Promise<void> {
  const reachable = await storage.isReachable();
  sendJson(ctx.res, 200, { status: reachable ? 'ok' : 'unavailable' });
}

export async function signIn(ctx: Ctx): Promise<void> {
  const body = jsonBody<{ email?: string; password?: string }>(ctx);
  const email = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const principal = await repo.principalByEmail(email);
  if (!principal) throw errors.invalidCredentials();
  const stored = await db.query<{ password_hash: string }>('select password_hash from principals where id = $1', [
    principal.id,
  ]);
  if (!verifyPassword(password, stored.rows[0]!.password_hash)) throw errors.invalidCredentials();

  const sessionId = await createSession(principal.id);
  ctx.res.setHeader('set-cookie', sessionCookie(sessionId));
  sendJson(ctx.res, 200, {
    principal: {
      id: principal.id,
      displayName: principal.displayName,
      role: principal.role,
      organisationId: principal.organisationId,
    },
  });
}

export async function signOut(ctx: Ctx): Promise<void> {
  requireSignedIn(ctx);
  const cookies = parseCookies(ctx.req.headers.cookie);
  const sessionId = cookies[config.sessionCookieName];
  if (sessionId) await db.query('delete from sessions where id = $1', [sessionId]);
  ctx.res.setHeader('set-cookie', clearedCookie());
  sendEmpty(ctx.res, 204);
}

export async function me(ctx: Ctx): Promise<void> {
  const principal = requireSignedIn(ctx);
  sendJson(ctx.res, 200, {
    principal: {
      id: principal.id,
      displayName: principal.displayName,
      role: principal.role,
      organisationId: principal.organisationId,
    },
    today: businessDate(ctx.now),
    now: ctx.now.toISOString(),
    timeZone: config.timeZone,
    weightAnnounceDelayMs: config.weightAnnounceDelayMs,
  });
}
