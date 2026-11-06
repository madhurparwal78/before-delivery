/** Applying, signing in and out, and reading the current user. */

import { db, transaction } from '../db.js';
import * as errors from '../http/errors.js';
import { Validator } from '../http/validate.js';
import {
  clearedSessionCookie,
  createSession,
  deleteSession,
  hashPassword,
  sessionCookie,
  verifyPassword,
  type Principal,
} from '../http/auth.js';
import { json, empty, type PublicContext, type Route, type RouteResult } from '../http/router.js';
import { EMAIL_TAKEN } from '../../shared/copy.js';
import type { SessionUser } from '../../shared/types.js';
import type { UserRow } from '../rows.js';

function presentUser(principal: Principal): SessionUser {
  return {
    id: principal.userId,
    name: principal.name,
    email: principal.email,
    role: principal.role,
    renter_id: principal.renterId,
    renter_status: principal.renterStatus,
  };
}

async function apply(context: PublicContext): Promise<RouteResult> {
  const validator = new Validator(context.body);
  const businessName = validator.text('business_name', 1, 120);
  const contactName = validator.text('contact_name', 1, 120);
  const email = validator.email('email');
  const phone = validator.text('phone', 7, 30);
  const password = validator.secret('password', 10, 200);
  if (!validator.hasFailed('email')) {
    const taken = await db.maybeOne<{ id: string }>('SELECT id FROM users WHERE email = $1', [
      email,
    ]);
    if (taken) validator.fail('email', EMAIL_TAKEN);
  }
  validator.done();

  const passwordHash = await hashPassword(password);
  const created = await transaction(async (tx) => {
    const user = await tx.one<{ id: string }>(
      `INSERT INTO users (email, name, role, password_hash)
       VALUES ($1, $2, 'renter', $3) RETURNING id`,
      [email, contactName, passwordHash],
    );
    const renter = await tx.one<{ id: string; status: string }>(
      `INSERT INTO renters (user_id, business_name, contact_name, email, phone, status)
       VALUES ($1, $2, $3, $4, $5, 'applied') RETURNING id, status`,
      [user.id, businessName, contactName, email, phone],
    );
    const sessionId = await createSession(tx, user.id);
    return { userId: user.id, renter, sessionId };
  });

  context.setCookie(sessionCookie(created.sessionId));
  return json(201, {
    user: {
      id: created.userId,
      name: contactName,
      email,
      role: 'renter',
      renter_id: created.renter.id,
      renter_status: 'applied',
    } satisfies SessionUser,
    renter: { id: created.renter.id, status: 'applied' },
  });
}

async function signIn(context: PublicContext): Promise<RouteResult> {
  const validator = new Validator(context.body);
  const email = validator.text('email', 1, 320);
  const password = validator.secret('password', 1, 200);
  validator.done();

  const user = await db.maybeOne<UserRow>(
    'SELECT id, email, name, role, password_hash FROM users WHERE email = $1',
    [email.toLowerCase()],
  );
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw errors.invalidCredentials();
  }
  const renter = await db.maybeOne<{ id: string; status: string }>(
    'SELECT id, status FROM renters WHERE user_id = $1',
    [user.id],
  );
  const sessionId = await transaction((tx) => createSession(tx, user.id));
  context.setCookie(sessionCookie(sessionId));
  return json(200, {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      renter_id: renter?.id ?? null,
      renter_status: (renter?.status as SessionUser['renter_status']) ?? null,
    } satisfies SessionUser,
  });
}

export const sessionRoutes: Route[] = [
  { method: 'POST', path: '/api/applications', auth: 'none', body: 'json', handle: apply },
  { method: 'POST', path: '/api/session', auth: 'none', body: 'json', handle: signIn },
  {
    method: 'DELETE',
    path: '/api/session',
    auth: 'session',
    async handle(context) {
      if (context.sessionId !== null) await deleteSession(context.sessionId);
      context.setCookie(clearedSessionCookie());
      return empty(204);
    },
  },
  {
    method: 'GET',
    path: '/api/me',
    auth: 'session',
    async handle(context) {
      return json(200, { user: presentUser(context.principal) });
    },
  },
];
