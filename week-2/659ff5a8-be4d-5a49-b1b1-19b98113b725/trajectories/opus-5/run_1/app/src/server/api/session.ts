import {
  SESSION_COOKIE,
  createSession,
  createUser,
  deleteSession,
  findAccountByEmail,
  sessionUser,
  verifyPassword,
  type Actor,
} from '../auth';
import { queryOne } from '../db/pool';
import { apiError } from '../http/errors';
import { json, memberRoute, noContent, publicRoute, type Route } from '../http/router';
import { FieldErrors, readEmail, readString } from '../http/validate';

function setCookie(token: string): [string, string][] {
  return [
    [
      'Set-Cookie',
      `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 7}`,
    ],
  ];
}

function clearCookie(): [string, string][] {
  return [['Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`]];
}

function userPayload(actor: Actor): { user: ReturnType<typeof sessionUser> } {
  return { user: sessionUser(actor) };
}

export const sessionRoutes: Route[] = [
  publicRoute('POST', '/api/session', async (ctx) => {
    const errors = new FieldErrors();
    const email = readEmail(ctx.body, 'email', errors);
    const password = readString(ctx.body, 'password', { min: 1, max: 200, label: 'Password' }, errors);
    if (!errors.empty) throw apiError.invalidCredentials();
    const account = await findAccountByEmail(email);
    if (!account || !verifyPassword(password, account.password_hash)) {
      throw apiError.invalidCredentials();
    }
    const token = await createSession(account.id);
    const club = account.club_id
      ? await queryOne<{ id: string; slug: string; name: string; time_zone: string }>(
          'SELECT id, slug, name, time_zone FROM clubs WHERE id = $1',
          [account.club_id],
        )
      : null;
    return json(
      200,
      userPayload({
        id: account.id,
        name: account.name,
        email: account.email,
        roles: account.roles,
        club,
      }),
      setCookie(token),
    );
  }),

  memberRoute('GET', '/api/session', async (ctx) => json(200, userPayload(ctx.actor))),

  memberRoute('DELETE', '/api/session', async (ctx) => {
    if (ctx.sessionToken) await deleteSession(ctx.sessionToken);
    return noContent(clearCookie());
  }),

  publicRoute('POST', '/api/clubs/:clubSlug/signup', async (ctx) => {
    const club = await queryOne<{ id: string; slug: string; name: string; time_zone: string }>(
      'SELECT id, slug, name, time_zone FROM clubs WHERE slug = $1',
      [ctx.params.clubSlug ?? ''],
    );
    if (!club) throw apiError.notFound();

    const errors = new FieldErrors();
    const name = readString(ctx.body, 'name', { min: 1, max: 80, label: 'Full name' }, errors);
    const email = readEmail(ctx.body, 'email', errors);
    const password = readString(
      ctx.body,
      'password',
      { min: 10, max: 200, label: 'Password' },
      errors,
    );
    errors.throwIfAny();

    if (await findAccountByEmail(email)) {
      throw apiError.conflict('email_taken', 'That email already has an account.');
    }
    const account = await createUser({
      clubId: club.id,
      name,
      email,
      password,
      roles: [],
    });
    const token = await createSession(account.id);
    return json(
      201,
      userPayload({
        id: account.id,
        name: account.name,
        email: account.email,
        roles: account.roles,
        club,
      }),
      setCookie(token),
    );
  }),
];
