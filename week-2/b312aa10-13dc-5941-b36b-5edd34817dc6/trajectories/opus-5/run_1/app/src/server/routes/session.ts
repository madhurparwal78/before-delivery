import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { db, lock, transact } from '../db/pool.js';
import { verifyPassword } from '../domain/passwords.js';
import type { RequestContext, SignedContext } from '../http/context.js';
import { errors, fieldCopy } from '../http/errors.js';
import { json, type Result } from '../http/respond.js';
import { kitchenObject } from '../api/shapes.js';
import { asString, exactBody, FieldErrors } from '../api/validate.js';
import { loadKitchen, personByEmail } from '../store/kitchens.js';
import { pendingItemCount } from '../store/ledger.js';
import { queuedReportCount } from '../store/sanitation.js';
import { serviceStates } from '../services/status.js';

export const sessionCookieName = 'lineboard_session';

function cookieHeader(value: string | null): string {
  return value === null
    ? `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
    : `${sessionCookieName}=${value}; Path=/; HttpOnly; SameSite=Lax`;
}

function sessionBody(
  person: { id: string; name: string; email: string; role: string; memberId: string | null },
  kitchen: { id: string; name: string; slug: string; timeZone: string },
): Record<string, unknown> {
  return {
    user: {
      id: person.id,
      name: person.name,
      email: person.email,
      role: person.role,
      memberId: person.memberId,
    },
    kitchen: {
      id: kitchen.id,
      name: kitchen.name,
      slug: kitchen.slug,
      timeZone: kitchen.timeZone,
    },
  };
}

/** POST /api/session */
export async function signIn(context: RequestContext): Promise<Result> {
  const body = exactBody(context.json, ['email', 'password']);
  const fieldErrors = new FieldErrors();
  const rawEmail = asString(body['email']);
  if (rawEmail === null || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail.trim())) {
    fieldErrors.add('email', fieldCopy.email);
  }
  const password = asString(body['password']);
  if (password === null || password.length === 0) fieldErrors.add('password', fieldCopy.password);
  fieldErrors.throwIfAny();

  const email = rawEmail!.trim().toLowerCase();
  const windowSeconds = config.signinWindowSeconds;

  const outcome = await transact(async (client) => {
    await lock(client, 'signinEmail', email);
    const failures = await client.query<{ at: Date }>(
      `select at from signin_failures
        where email = $1 and at > now() - ($2::text || ' seconds')::interval
        order by at asc`,
      [email, String(windowSeconds)],
    );
    if (failures.rows.length >= 5) {
      const oldest = failures.rows[0]!.at.getTime();
      const retryAfter = Math.max(
        1,
        Math.ceil((oldest + windowSeconds * 1000 - Date.now()) / 1000),
      );
      return { kind: 'throttled' as const, retryAfter };
    }
    const person = await personByEmail(email);
    if (!person || !verifyPassword(password!, person.passwordHash)) {
      await client.query(`insert into signin_failures (email) values ($1)`, [email]);
      return { kind: 'invalid' as const };
    }
    await client.query(`delete from signin_failures where email = $1`, [email]);
    const sessionId = randomBytes(32).toString('base64url');
    if (context.sessionId !== null) {
      await client.query(`delete from sessions where id = $1`, [context.sessionId]);
    }
    await client.query(`insert into sessions (id, person_id) values ($1,$2)`, [
      sessionId,
      person.id,
    ]);
    return { kind: 'signed_in' as const, person, sessionId };
  });

  if (outcome.kind === 'throttled') throw errors.rateLimited(outcome.retryAfter);
  if (outcome.kind === 'invalid') throw errors.invalidCredentials();

  const kitchen = await loadKitchen(db(), outcome.person.kitchenId);
  return json(200, sessionBody(outcome.person, kitchen), {
    'set-cookie': cookieHeader(outcome.sessionId),
  });
}

/** GET /api/session */
export async function readSession(context: RequestContext): Promise<Result> {
  const signedContext = context as SignedContext;
  return json(200, sessionBody(signedContext.person, signedContext.kitchen));
}

/** DELETE /api/session */
export async function signOut(context: RequestContext): Promise<Result> {
  await db().query(`delete from sessions where id = $1`, [context.sessionId]);
  return { kind: 'empty', status: 204, headers: { 'set-cookie': cookieHeader(null) } };
}

/** GET /api/kitchen */
export async function readKitchen(context: RequestContext): Promise<Result> {
  const signedContext = context as SignedContext;
  return json(200, kitchenObject(signedContext.kitchen, signedContext.nowMs));
}

/** GET /api/service-status */
export async function readServiceStatus(context: RequestContext): Promise<Result> {
  const signedContext = context as SignedContext;
  const states = await serviceStates();
  return json(200, {
    billing: states.billing,
    storage: states.storage,
    queued: {
      billing: await pendingItemCount(db(), signedContext.kitchen.id),
      storage: await queuedReportCount(db(), signedContext.kitchen.id),
    },
  });
}

/** GET /api/health */
export async function health(): Promise<Result> {
  return json(200, { status: 'ok' });
}
