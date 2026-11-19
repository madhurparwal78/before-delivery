import { randomUUID } from 'node:crypto';
import { one, query } from '../db.js';
import { invalid, notFound } from '../errors.js';
import { personOrThrow, readJsonBody, route, sendJson } from '../http.js';
import { SESSION_COOKIE, createAuthToken, dropAuthToken, hashPassword, passwordMatches, readCookie } from '../auth.js';
import { isAllowedZone } from '../domain/zones.js';
import { isRank } from '../domain/ranks.js';
import { currentPublishedVersion, getAsset } from '../assets.js';
import { enqueueMail, flushOutbox, linkBase } from '../services/mail.js';
import { storageUp } from '../services/storage.js';
import { valkeyUp } from '../services/valkey.js';
import type { PersonRow } from '../auth.js';

export const ACCOUNT_TEXT = {
  email: 'Enter a valid email address.',
  password: 'Passwords need at least 10 characters.',
  displayName: 'Give a display name of 1 to 40 characters.',
  timeZone: 'Choose a time zone from the list.',
  wrong: 'Email or password is wrong.',
  rank: 'Choose Feather, Linen, Cedar, Granite or none.'
} as const;

export function looksLikeEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(value) && value.length <= 254;
}

export function personPayload(person: PersonRow): Record<string, unknown> {
  return {
    personId: person.id,
    displayName: person.display_name,
    email: person.email,
    siteRole: person.site_role,
    timeZone: person.time_zone,
    avatarId: person.avatar_asset_id,
    hideAbove: person.hide_above,
    worldId: person.world_id
  };
}

function cookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`;
}

route('GET', '/api/health', 'open', async (ctx) => {
  const ok = valkeyUp() && storageUp();
  sendJson(ctx.res, 200, { status: ok ? 'ok' : 'unavailable' });
});

route('POST', '/api/signup', 'open', async (ctx) => {
  const body = await readJsonBody(ctx);
  if (!looksLikeEmail(body['email'])) throw invalid(ACCOUNT_TEXT.email);
  const password = body['password'];
  if (typeof password !== 'string' || password.length < 10) throw invalid(ACCOUNT_TEXT.password);
  const displayName = body['displayName'];
  if (typeof displayName !== 'string' || displayName.length < 1 || displayName.length > 40) {
    throw invalid(ACCOUNT_TEXT.displayName);
  }
  if (!isAllowedZone(body['timeZone'])) throw invalid(ACCOUNT_TEXT.timeZone);
  const email = (body['email'] as string).toLowerCase();
  const existing = await one<{ id: string }>('select id from people where lower(email) = $1', [email]);
  if (existing === null) {
    const personId = randomUUID();
    const token = randomUUID().replace(/-/g, '');
    await query(
      `insert into people (id, world_id, email, password_hash, display_name, time_zone, site_role, confirmed)
       values ($1, 'default', $2, $3, $4, $5, 'member', false)`,
      [personId, body['email'], hashPassword(password), displayName, body['timeZone']]
    );
    await query('insert into confirm_tokens (token, person_id) values ($1, $2)', [token, personId]);
    await enqueueMail(
      body['email'] as string,
      'Confirm your Hearthtile account',
      `Welcome to Hearthtile.\n${linkBase(ctx.origin === '' ? null : ctx.origin)}/confirm/${token}\n`
    );
    void flushOutbox();
  }
  sendJson(ctx.res, 202, { status: 'check-your-email' });
});

route('POST', '/api/confirm/:token', 'open', async (ctx) => {
  const row = await one<{ person_id: string }>(
    'select person_id from confirm_tokens where token = $1 and used = false',
    [ctx.params['token'] ?? '']
  );
  if (row === null) throw notFound();
  await query('update confirm_tokens set used = true where token = $1', [ctx.params['token'] ?? '']);
  await query('update people set confirmed = true where id = $1', [row.person_id]);
  sendJson(ctx.res, 200, { status: 'confirmed' });
});

route('POST', '/api/signin', 'open', async (ctx) => {
  const body = await readJsonBody(ctx);
  const email = typeof body['email'] === 'string' ? body['email'].toLowerCase() : '';
  const password = typeof body['password'] === 'string' ? body['password'] : '';
  const person = await one<PersonRow>('select * from people where lower(email) = $1', [email]);
  if (person === null || !person.confirmed || person.suspended || !passwordMatches(password, person.password_hash)) {
    sendJson(ctx.res, 401, { error: ACCOUNT_TEXT.wrong });
    return;
  }
  const token = await createAuthToken(person.id);
  ctx.res.setHeader('set-cookie', cookieHeader(token));
  sendJson(ctx.res, 200, {
    personId: person.id,
    displayName: person.display_name,
    siteRole: person.site_role,
    timeZone: person.time_zone
  });
});

route('POST', '/api/signout', 'required', async (ctx) => {
  const token = readCookie(ctx.req.headers.cookie, SESSION_COOKIE);
  if (token !== null) await dropAuthToken(token);
  ctx.res.setHeader('set-cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
  sendJson(ctx.res, 200, { status: 'signed-out' });
});

route('GET', '/api/me', 'required', async (ctx) => {
  sendJson(ctx.res, 200, personPayload(personOrThrow(ctx)));
});

route('PUT', '/api/me/avatar', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const body = await readJsonBody(ctx);
  const avatarId = typeof body['avatarId'] === 'string' ? body['avatarId'] : '';
  const asset = await getAsset(avatarId);
  if (asset === null || asset.kind !== 'avatar' || asset.world_id !== person.world_id) throw notFound();
  if ((await currentPublishedVersion(asset.id)) === null) throw notFound();
  await query('update people set avatar_asset_id = $2 where id = $1', [person.id, asset.id]);
  sendJson(ctx.res, 200, { avatarId: asset.id });
});

route('PUT', '/api/me/hide-above', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const body = await readJsonBody(ctx);
  const rank = body['rank'] ?? null;
  if (rank !== null && !isRank(rank)) throw invalid(ACCOUNT_TEXT.rank);
  await query('update people set hide_above = $2 where id = $1', [person.id, rank]);
  sendJson(ctx.res, 200, { hideAbove: rank });
});
