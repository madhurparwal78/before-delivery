import type { Queryable } from '../db.js';
import { takeLock } from '../db.js';
import { ApiError, fail } from '../http/errors.js';
import {
  checkFields,
  FieldErrors,
  readDisplayName,
  readEmail,
  readPassword,
  readTimeZone,
  readToken
} from '../http/validate.js';
import { publicRoute, sessionRoute, type Reply, type Route } from '../http/route.js';
import {
  findAccountByEmail,
  hashPassword,
  normaliseEmail,
  verifyPassword
} from '../domain/accounts.js';
import { createSession, cookieHeader, endAllSessionsOf, endSession } from '../domain/sessions.js';
import { issueToken, consumeToken } from '../domain/tokens.js';
import { enforceThrottle } from '../domain/throttle.js';
import { createStarterIsland } from '../domain/village.js';
import { meView } from '../domain/presenters.js';
import { enqueueMail } from '../mail/queue.js';
import {
  alreadyVerifiedMail,
  confirmationMail,
  noAccountConfirmationMail,
  noAccountResetMail,
  resetMail
} from '../mail/templates.js';

const ACCEPTED: Reply = { status: 202, body: { status: 'check_email' } };

async function sendConfirmation(
  client: Queryable,
  email: string,
  at: Date,
  allowCreate: boolean,
  newAccount: { password: string; displayName: string; timeZone: string } | null
): Promise<void> {
  const existing = await findAccountByEmail(client, email);
  if (existing === null) {
    if (!allowCreate || newAccount === null) {
      await enqueueMail(client, noAccountConfirmationMail(email), at);
      return;
    }
    const passwordHash = await hashPassword(newAccount.password);
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO accounts
         (email, email_lower, password_hash, display_name, time_zone, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email_lower) DO NOTHING
       RETURNING id`,
      [
        email,
        normaliseEmail(email),
        passwordHash,
        newAccount.displayName,
        newAccount.timeZone,
        at.toISOString()
      ]
    );
    const row = rows[0];
    if (!row) {
      await enqueueMail(client, alreadyVerifiedMail(email), at);
      return;
    }
    const accountId = Number(row.id);
    await createStarterIsland(client, accountId, at);
    const token = await issueToken(client, accountId, 'verify', at);
    await enqueueMail(client, confirmationMail(email, token), at);
    return;
  }
  if (existing.verified) {
    await enqueueMail(client, alreadyVerifiedMail(email), at);
    return;
  }
  const token = await issueToken(client, existing.id, 'verify', at);
  await enqueueMail(client, confirmationMail(email, token), at);
}

export const authRoutes: Route[] = [
  publicRoute('GET', '/api/session', async (ctx, client) => {
    if (ctx.session !== null) {
      return {
        status: 200,
        body: {
          user: ctx.account === null ? null : await meView(client, ctx.account),
          csrfToken: ctx.session.csrfToken
        }
      };
    }
    const session = await createSession(client, null, ctx.now);
    return {
      status: 200,
      body: { user: null, csrfToken: session.csrfToken },
      setSessionCookie: cookieHeader(session.id)
    };
  }),

  publicRoute('POST', '/api/auth/signup', async (ctx, client) => {
    const errors = new FieldErrors();
    checkFields(
      ctx.body,
      ['email', 'password', 'displayName', 'timeZone'],
      ['email', 'password', 'displayName', 'timeZone'],
      errors
    );
    const email = readEmail(ctx.body, errors);
    const password = readPassword(ctx.body, 'password', errors);
    const displayName = readDisplayName(ctx.body, errors);
    const timeZone = readTimeZone(ctx.body, errors);
    errors.throwIfAny();
    await sendConfirmation(client, email, ctx.now, true, { password, displayName, timeZone });
    return ACCEPTED;
  }),

  publicRoute('POST', '/api/auth/resend-verification', async (ctx, client) => {
    const raw = ctx.body.email;
    if (typeof raw === 'string') {
      await enforceThrottle('resend', normaliseEmail(raw), ctx.now);
    }
    const errors = new FieldErrors();
    checkFields(ctx.body, ['email'], ['email'], errors);
    const email = readEmail(ctx.body, errors);
    errors.throwIfAny();
    await sendConfirmation(client, email, ctx.now, false, null);
    return ACCEPTED;
  }),

  publicRoute('POST', '/api/auth/verify', async (ctx, client) => {
    const errors = new FieldErrors();
    checkFields(ctx.body, ['token'], ['token'], errors);
    const token = readToken(ctx.body, errors);
    errors.throwIfAny();
    const accountId = await consumeToken(client, token, 'verify', ctx.now);
    if (accountId === null) fail('invalid_token');
    await client.query('UPDATE accounts SET verified = true WHERE id = $1', [accountId]);
    return { status: 200, body: { status: 'verified' } };
  }),

  publicRoute('POST', '/api/auth/forgot', async (ctx, client) => {
    const raw = ctx.body.email;
    if (typeof raw === 'string') {
      await enforceThrottle('forgot', normaliseEmail(raw), ctx.now);
    }
    const errors = new FieldErrors();
    checkFields(ctx.body, ['email'], ['email'], errors);
    const email = readEmail(ctx.body, errors);
    errors.throwIfAny();
    const account = await findAccountByEmail(client, email);
    if (account === null) {
      await enqueueMail(client, noAccountResetMail(email), ctx.now);
    } else {
      const token = await issueToken(client, account.id, 'reset', ctx.now);
      await enqueueMail(client, resetMail(email, token), ctx.now);
    }
    return ACCEPTED;
  }),

  publicRoute('POST', '/api/auth/reset', async (ctx, client) => {
    const errors = new FieldErrors();
    checkFields(ctx.body, ['token', 'password'], ['token', 'password'], errors);
    const token = readToken(ctx.body, errors);
    const password = readPassword(ctx.body, 'password', errors);
    errors.throwIfAny();
    const accountId = await consumeToken(client, token, 'reset', ctx.now);
    if (accountId === null) fail('invalid_token');
    await takeLock(client, 'account', accountId);
    await client.query(
      'UPDATE accounts SET password_hash = $2, verified = true WHERE id = $1',
      [accountId, await hashPassword(password)]
    );
    await endAllSessionsOf(client, accountId, ctx.now);
    return { status: 200, body: { status: 'password_reset' } };
  }),

  publicRoute('POST', '/api/auth/signin', async (ctx, client) => {
    const raw = ctx.body.email;
    if (typeof raw === 'string') {
      await enforceThrottle('signin', normaliseEmail(raw), ctx.now);
    }
    const errors = new FieldErrors();
    checkFields(ctx.body, ['email', 'password'], ['email', 'password'], errors);
    const email = readEmail(ctx.body, errors);
    const password = readPassword(ctx.body, 'password', errors);
    errors.throwIfAny();
    const account = await findAccountByEmail(client, email);
    if (account === null || !(await verifyPassword(account.passwordHash, password))) {
      throw new ApiError('invalid_credentials');
    }
    if (ctx.session !== null) await endSession(client, ctx.session.id, ctx.now);
    const session = await createSession(client, account.id, ctx.now);
    return {
      status: 200,
      body: { user: await meView(client, account), csrfToken: session.csrfToken },
      setSessionCookie: cookieHeader(session.id)
    };
  }),

  sessionRoute('POST', '/api/auth/signout', async (ctx, client) => {
    await endSession(client, ctx.session.id, ctx.now);
    return { status: 204 };
  })
];
