import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { query, queryOne, transactionNow, withTransaction } from '../db';
import { kitchenDate, kitchenIso, kitchenTimeZone } from '../kitchen-time';
import { hashPassword, verifyPassword } from '../passwords';
import {
  CLEANUP_MINUTES,
  CLOSES_AT,
  KITCHEN_NAME,
  MINIMUM_BOOKING_MINUTES,
  OPENS_AT,
  applyMessage,
  serverMessage,
} from '../../shared/copy';
import { currentDocuments } from '../domain/documents';
import { normaliseEmail, recordSigninAttempt, signinLimitFor } from '../domain/limits';
import { tenantById, tenantStanding } from '../domain/tenants';
import { ApiError, conflict, tooManyAttempts, unauthenticated } from '../http/errors';
import {
  clearedSessionCookie,
  createSession,
  endSession,
  readCookie,
  recordPasswordConfirmation,
  sessionCookie,
  SESSION_COOKIE,
} from '../http/session';
import { finishValidation, hasControlCharacters, looksLikeEmail, readString } from '../http/validate';
import type { Ctx, Reply, Route } from '../http/route';
import { meView } from '../views';
import type { Db } from '../db';
import type { Me } from '../../shared/types';

async function meFor(client: Db, user: { id: string; role: Me['role']; email: string; displayName: string; tenantId: string | null }): Promise<Me> {
  if (user.tenantId === null) {
    return meView(user, null);
  }
  const tenant = await tenantById(client, user.tenantId);
  if (tenant === null) return meView(user, null);
  const now = await transactionNow(client);
  const standing = tenantStanding(tenant, await currentDocuments(client, tenant.id), kitchenDate(now));
  return meView(user, {
    id: tenant.id,
    businessName: tenant.business_name,
    status: standing.status,
    suspendedReason: standing.suspendedReason,
  });
}

const signIn: Route = {
  method: 'POST',
  pattern: '/api/session',
  roles: 'open',
  bodyFields: ['email', 'password'],
  handler: async (ctx: Ctx): Promise<Reply> => {
    const email = readString(ctx.body.email) ?? '';
    const password = readString(ctx.body.password) ?? '';
    const fields: Record<string, string> = {};
    if (email.trim() === '') fields.email = serverMessage.emailRequired;
    if (password === '') fields.password = serverMessage.passwordRequired;
    finishValidation(ctx, fields);

    const normalised = normaliseEmail(email);
    return withTransaction(async (client) => {
      const limit = await signinLimitFor(client, normalised);
      if (limit.limited) throw tooManyAttempts(limit.retryAfterSeconds);

      const account = await queryOne<{
        id: string;
        role: Me['role'];
        email: string;
        display_name: string;
        tenant_id: string | null;
        password_hash: string;
      }>(
        client,
        `select id, role, email, display_name, tenant_id, password_hash from users
         where lower(email) = $1`,
        [normalised],
      );
      const matches = account !== null && (await verifyPassword(password, account.password_hash));
      if (!matches || account === null) {
        await recordSigninAttempt(normalised, 'failure');
        throw new ApiError(401, 'invalid_credentials', serverMessage.invalidCredentials);
      }
      await recordSigninAttempt(normalised, 'success');
      const token = await createSession(client, account.id);
      const me = await meFor(client, {
        id: account.id,
        role: account.role,
        email: account.email,
        displayName: account.display_name,
        tenantId: account.tenant_id,
      });
      return { status: 200, body: { user: me }, cookie: sessionCookie(token) };
    });
  },
};

const signOut: Route = {
  method: 'DELETE',
  pattern: '/api/session',
  roles: ['owner', 'shift_lead', 'tenant'],
  handler: async (ctx: Ctx): Promise<Reply> => {
    const token = readCookie(ctx.request, SESSION_COOKIE);
    if (token !== null) {
      await withTransaction((client) => endSession(client, token));
    }
    return { status: 204, cookie: clearedSessionCookie() };
  },
};

const confirmPassword: Route = {
  method: 'POST',
  pattern: '/api/session/confirm',
  roles: ['owner', 'shift_lead', 'tenant'],
  bodyFields: ['password'],
  handler: async (ctx: Ctx): Promise<Reply> => {
    const password = readString(ctx.body.password) ?? '';
    const fields: Record<string, string> = {};
    if (password === '') fields.password = serverMessage.passwordRequired;
    finishValidation(ctx, fields);

    const user = ctx.user;
    if (user === null) throw unauthenticated();
    const normalised = normaliseEmail(user.email);
    return withTransaction(async (client) => {
      const limit = await signinLimitFor(client, normalised);
      if (limit.limited) throw tooManyAttempts(limit.retryAfterSeconds);

      const stored = await queryOne<{ password_hash: string }>(
        client,
        'select password_hash from users where id = $1',
        [user.id],
      );
      const matches = stored !== null && (await verifyPassword(password, stored.password_hash));
      if (!matches) {
        await recordSigninAttempt(normalised, 'failure');
        throw new ApiError(401, 'invalid_credentials', serverMessage.passwordMismatch);
      }
      await recordSigninAttempt(normalised, 'success');
      await recordPasswordConfirmation(client, user.sessionId);
      return { status: 204 };
    });
  },
};

const me: Route = {
  method: 'GET',
  pattern: '/api/me',
  roles: ['owner', 'shift_lead', 'tenant'],
  handler: async (ctx: Ctx): Promise<Reply> => {
    const user = ctx.user;
    if (user === null) throw unauthenticated();
    return withTransaction(async (client) => ({
      status: 200,
      body: await meFor(client, user),
    }));
  },
};

const apply: Route = {
  method: 'POST',
  pattern: '/api/tenants/apply',
  roles: 'open',
  bodyFields: ['businessName', 'contactName', 'email', 'password'],
  handler: async (ctx: Ctx): Promise<Reply> => {
    const businessName = readString(ctx.body.businessName);
    const contactName = readString(ctx.body.contactName);
    const email = readString(ctx.body.email);
    const password = readString(ctx.body.password);
    const fields: Record<string, string> = {};

    for (const [name, value] of [
      ['businessName', businessName],
      ['contactName', contactName],
    ] as const) {
      if (value === null || value.trim() === '') fields[name] = applyMessage.required;
      else if (hasControlCharacters(value)) fields[name] = applyMessage.controlCharacters;
      else if ([...value].length > 80) fields[name] = applyMessage.tooLongName;
    }
    if (email === null || email.trim() === '') fields.email = applyMessage.required;
    else if (!looksLikeEmail(email)) fields.email = applyMessage.invalidEmail;
    if (password === null || password === '') fields.password = applyMessage.required;
    else if (password.length < 10) fields.password = applyMessage.shortPassword;
    else if (password.length > 200) fields.password = applyMessage.tooLongPassword;
    finishValidation(ctx, fields);

    const normalised = normaliseEmail(email ?? '');
    const passwordHash = await hashPassword(password ?? '');
    return withTransaction(async (client) => {
      const taken = await queryOne<{ id: string }>(client, 'select id from users where lower(email) = $1', [
        normalised,
      ]);
      if (taken !== null) throw conflict('email_taken', applyMessage.emailTaken);

      const tenantId = randomUUID();
      await query(
        client,
        `insert into tenants (id, business_name, contact_name, email, base_status)
         values ($1,$2,$3,$4,'applied')`,
        [tenantId, (businessName ?? '').trim(), (contactName ?? '').trim(), normalised],
      );
      const userId = randomUUID();
      await query(
        client,
        `insert into users (id, role, email, password_hash, display_name, tenant_id)
         values ($1,'tenant',$2,$3,$4,$5)`,
        [userId, normalised, passwordHash, (contactName ?? '').trim(), tenantId],
      );
      const token = await createSession(client, userId);
      const body = await meFor(client, {
        id: userId,
        role: 'tenant',
        email: normalised,
        displayName: (contactName ?? '').trim(),
        tenantId,
      });
      return { status: 201, body: { user: body }, cookie: sessionCookie(token) };
    });
  },
};

const kitchen: Route = {
  method: 'GET',
  pattern: '/api/kitchen',
  roles: 'open',
  handler: async (): Promise<Reply> =>
    withTransaction(async (client) => {
      const now = await transactionNow(client);
      return {
        status: 200,
        body: {
          name: KITCHEN_NAME,
          timeZone: kitchenTimeZone,
          opensAt: OPENS_AT,
          closesAt: CLOSES_AT,
          cleanupMinutes: CLEANUP_MINUTES,
          minimumBookingMinutes: MINIMUM_BOOKING_MINUTES,
          holdSeconds: config.holdSeconds,
          today: kitchenDate(now),
          now: kitchenIso(now),
        },
      };
    }),
};

const health: Route = {
  method: 'GET',
  pattern: '/api/health',
  roles: 'open',
  handler: async (): Promise<Reply> => ({ status: 200, body: { status: 'ok' } }),
};

export const accountRoutes: ReadonlyArray<Route> = [
  health,
  signIn,
  signOut,
  confirmPassword,
  me,
  apply,
  kitchen,
];
