import { newToken, verifyPassword } from '../db.js';
import { invalidCredentials } from '../errors.js';
import { clearedSessionCookie, sessionCookie } from '../http.js';
import { asObject, asString } from '../json.js';
import type { PublicRouteContext, Reply, RouteContext } from './types.js';

export async function signIn(context: PublicRouteContext): Promise<Reply> {
  const body = asObject(context.request.body) ?? {};
  const email = asString(body['email']) ?? '';
  const password = asString(body['password']) ?? '';
  const found = await context.client.query<{
    id: string;
    email: string;
    display_name: string;
    password_hash: string;
  }>('select id, email, display_name, password_hash from accounts where lower(email) = lower($1)', [
    email,
  ]);
  const account = found.rows[0];
  if (account === undefined || !(await verifyPassword(password, account.password_hash))) {
    throw invalidCredentials();
  }
  const token = newToken();
  await context.client.query('insert into sessions (token, account_id) values ($1, $2)', [
    token,
    account.id,
  ]);
  return {
    status: 200,
    body: {
      user: { id: account.id, email: account.email, display_name: account.display_name },
    },
    headers: { 'set-cookie': sessionCookie(token) },
  };
}

export async function signOut(context: RouteContext): Promise<Reply> {
  const token = context.request.cookies['tf_session'];
  await context.client.query('delete from sessions where token = $1', [token]);
  return { status: 204, headers: { 'set-cookie': clearedSessionCookie() } };
}

export function me(context: RouteContext): Reply {
  return {
    status: 200,
    body: {
      user: {
        id: context.account.id,
        email: context.account.email,
        display_name: context.account.display_name,
      },
    },
  };
}
