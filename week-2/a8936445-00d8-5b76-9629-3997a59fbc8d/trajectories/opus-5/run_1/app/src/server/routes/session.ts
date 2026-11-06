import { route } from '../http/router.js';
import { signIn, signOut } from '../services/session.js';
import { userJson } from './serialize.js';
import { stringField } from './params.js';

const COOKIE = 'sk_session';

function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

function clearedCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function tokenFromCookies(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

route('GET', '/api/health', { public: true }, async () => ({
  status: 200,
  json: { status: 'ok' },
}));

route('POST', '/api/session', { public: true, bodyKind: 'json' }, async (ctx) => {
  const body = ctx.jsonBody();
  const { user, token } = await signIn(stringField(body, 'email'), stringField(body, 'password'));
  return {
    status: 200,
    json: { user: userJson(user) },
    headers: { 'set-cookie': sessionCookie(token) },
  };
});

route('GET', '/api/session', {}, async (ctx) => ({
  status: 200,
  json: { user: userJson(ctx.actor) },
}));

route('DELETE', '/api/session', {}, async (ctx) => {
  const token = tokenFromCookies(ctx.req.headers.cookie);
  if (token) await signOut(token);
  return { status: 204, json: null, headers: { 'set-cookie': clearedCookie() } };
});
