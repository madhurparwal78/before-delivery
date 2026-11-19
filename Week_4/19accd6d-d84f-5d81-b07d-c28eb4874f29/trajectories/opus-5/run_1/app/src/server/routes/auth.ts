import { config, bodyLimits } from '../config.js';
import { newId, pool, withTransaction } from '../db.js';
import { apiErrors } from '../errors.js';
import type { FieldErrors } from '../../shared/recipe.js';
import { readCookie, type Router } from '../http.js';
import { MailDown, sendVerificationEmail } from '../mail.js';
import {
  createSession,
  deleteSession,
  findUserByEmail,
  hashPassword,
  hashToken,
  newToken,
  passwordMatches,
  teamsOf,
} from '../store.js';

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function userBody(user: {
  id: string;
  email: string;
  displayName: string;
  verified: boolean;
}): Record<string, unknown> {
  return { id: user.id, email: user.email, displayName: user.displayName, verified: user.verified };
}

export function registerAuthRoutes(router: Router): void {
  router.add(
    'POST',
    '/api/auth/signup',
    async (ctx) => {
      const body = await ctx.readJson(bodyLimits.json);
      const email = typeof body['email'] === 'string' ? body['email'].trim() : '';
      const displayName = typeof body['displayName'] === 'string' ? body['displayName'].trim() : '';
      const password = typeof body['password'] === 'string' ? body['password'] : '';
      if (email !== '' && (await findUserByEmail(email)) !== null) throw apiErrors.emailTaken();
      const fields: FieldErrors = {};
      if (displayName.length < 1 || displayName.length > 40) {
        fields['displayName'] = 'A display name needs 1 to 40 characters.';
      }
      if (!EMAIL_PATTERN.test(email)) fields['email'] = 'Enter an email address.';
      if (password.length < 10) fields['password'] = 'A password needs at least 10 characters.';
      if (Object.keys(fields).length > 0) throw apiErrors.validation(fields);

      const id = newId('u');
      const token = newToken();
      try {
        await withTransaction(async (client) => {
          await client.query(
            'insert into users (id, email, display_name, password_hash, verified) values ($1, $2, $3, $4, false)',
            [id, email, displayName, await hashPassword(password)],
          );
          await client.query(
            `insert into verifications (token_hash, user_id, expires_at)
             values ($1, $2, now() + make_interval(secs => $3))`,
            [hashToken(token), id, config.limits.verifyTtlSeconds],
          );
          await sendVerificationEmail(email, displayName, token);
        });
      } catch (cause) {
        if (cause instanceof MailDown) throw apiErrors.mailUnavailable();
        throw cause;
      }
      ctx.json(201, { user: userBody({ id, email, displayName, verified: false }) });
    },
    true,
  );

  router.add(
    'POST',
    '/api/auth/verify',
    async (ctx) => {
      const body = await ctx.readJson(bodyLimits.json);
      const token = typeof body['token'] === 'string' ? body['token'] : '';
      const result = await pool.query<{ user_id: string }>(
        `update verifications set spent = true
         where token_hash = $1 and spent = false and expires_at > now()
         returning user_id`,
        [hashToken(token)],
      );
      const row = result.rows[0];
      if (row === undefined) throw apiErrors.notFound();
      const updated = await pool.query<{ id: string; email: string; display_name: string }>(
        'update users set verified = true where id = $1 returning id, email, display_name',
        [row.user_id],
      );
      const user = updated.rows[0]!;
      ctx.json(200, {
        user: userBody({ id: user.id, email: user.email, displayName: user.display_name, verified: true }),
      });
    },
    true,
  );

  router.add(
    'POST',
    '/api/auth/signin',
    async (ctx) => {
      const body = await ctx.readJson(bodyLimits.json);
      const email = typeof body['email'] === 'string' ? body['email'].trim() : '';
      const password = typeof body['password'] === 'string' ? body['password'] : '';
      const user = email === '' ? null : await findUserByEmail(email);
      if (user === null || !(await passwordMatches(password, user.passwordHash))) {
        throw apiErrors.invalidCredentials();
      }
      if (!user.verified) throw apiErrors.emailUnverified();
      const token = await createSession(user.id);
      ctx.setCookie(token, 30 * 24 * 3600);
      ctx.json(200, { user: userBody(user) });
    },
    true,
  );

  router.add(
    'POST',
    '/api/auth/signout',
    async (ctx) => {
      const token = readCookie(ctx.request, 'wb_session');
      if (token !== null) await deleteSession(token);
      ctx.clearCookie();
      ctx.empty(204);
    },
    true,
  );

  router.add('GET', '/api/me', async (ctx) => {
    const session = ctx.requireSession();
    ctx.json(200, {
      user: userBody({
        id: session.userId,
        email: session.email,
        displayName: session.displayName,
        verified: true,
      }),
      teams: await teamsOf(session.userId),
    });
  });
}
