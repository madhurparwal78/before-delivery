import { transaction } from '../db.js';
import { fail, validationFailed } from '../errors.js';
import type { Router } from '../http/router.js';
import { requireUser } from '../http/router.js';
import {
  FIELD_COPY,
  authenticate,
  checkPassword,
  createSession,
  destroySession,
  findByEmail,
  findByHandle,
  findById,
  hashPassword,
  markVerified,
  normaliseEmail,
  setPassword,
  toMe,
  validateSignup,
} from '../services/accounts.js';
import { consumeLink, issueAndSendLink } from '../services/links.js';
import { probeMail } from '../services/mail.js';
import { createSoloParty } from '../services/parties.js';

function tokenFrom(body: Record<string, unknown>): string {
  const token = body.token;
  if (typeof token !== 'string' || token.length === 0) throw fail.linkInvalid();
  return token;
}

export function registerAuthRoutes(router: Router): void {
  router.add(
    'POST',
    '/api/auth/signup',
    async (ctx) => {
      const input = validateSignup(ctx.body);
      if (await findByEmail(input.email)) throw fail.emailTaken();
      if (await findByHandle(input.handle)) throw fail.handleTaken();
      const user = await transaction(async (tx) => {
        const row = await tx.queryOne<{
          id: number;
          email: string;
          handle: string;
          email_verified: boolean;
        }>(
          `INSERT INTO users (email, handle, password_hash) VALUES ($1, $2, $3)
           RETURNING id, email, handle, email_verified`,
          [input.email, input.handle, hashPassword(input.password)],
        );
        if (row === null) throw fail.internal();
        await createSoloParty(tx, row.id);
        return row;
      });
      const token = await createSession(user.id);
      const sent = await issueAndSendLink(user.id, user.email, 'verification');
      return {
        status: 201,
        body: { user: toMe(user), verificationEmail: sent ? 'sent' : 'failed' },
        cookie: { value: token },
      };
    },
    { open: true },
  );

  router.add(
    'POST',
    '/api/auth/verify',
    async (ctx) => {
      const userId = await consumeLink(tokenFrom(ctx.body), 'verification');
      await markVerified(userId);
      const user = await findById(userId);
      if (user === null) throw fail.linkInvalid();
      return { status: 200, body: { user: toMe(user) } };
    },
    { open: true },
  );

  router.add('POST', '/api/auth/verification/resend', async (ctx) => {
    const user = requireUser(ctx);
    if (user.email_verified) throw fail.alreadyVerified();
    const sent = await issueAndSendLink(user.id, user.email, 'verification');
    if (!sent) throw fail.mailUnavailable();
    return { status: 202, body: { verificationEmail: 'sent' } };
  });

  router.add(
    'POST',
    '/api/auth/login',
    async (ctx) => {
      const email = normaliseEmail(ctx.body.email);
      const password = checkPassword(ctx.body.password);
      if (email === null || password === null) throw fail.invalidCredentials();
      const user = await authenticate(email, password);
      if (user === null) throw fail.invalidCredentials();
      const token = await createSession(user.id);
      return { status: 200, body: { user: toMe(user) }, cookie: { value: token } };
    },
    { open: true },
  );

  router.add(
    'POST',
    '/api/auth/logout',
    async (ctx) => {
      if (ctx.sessionToken !== null) await destroySession(ctx.sessionToken);
      return { status: 204, cookie: { clear: true } };
    },
    { open: true },
  );

  router.add('GET', '/api/me', async (ctx) => ({
    status: 200,
    body: { user: toMe(requireUser(ctx)) },
  }));

  router.add(
    'POST',
    '/api/auth/password-reset',
    async (ctx) => {
      const email = normaliseEmail(ctx.body.email);
      if (email === null) throw validationFailed({ email: FIELD_COPY.email });
      const user = await findByEmail(email);
      if (user === null) {
        if (!(await probeMail())) throw fail.mailUnavailable();
        return { status: 202, body: { status: 'accepted' } };
      }
      const sent = await issueAndSendLink(user.id, user.email, 'reset');
      if (!sent) throw fail.mailUnavailable();
      return { status: 202, body: { status: 'accepted' } };
    },
    { open: true },
  );

  router.add(
    'POST',
    '/api/auth/password-reset/confirm',
    async (ctx) => {
      const token = tokenFrom(ctx.body);
      const password = checkPassword(ctx.body.password);
      if (password === null) throw validationFailed({ password: FIELD_COPY.password });
      const userId = await consumeLink(token, 'reset');
      await setPassword(userId, password);
      return { status: 200, body: { status: 'password_changed' } };
    },
    { open: true },
  );
}
