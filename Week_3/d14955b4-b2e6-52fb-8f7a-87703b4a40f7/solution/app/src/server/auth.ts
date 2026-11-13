import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { argon2Verify, argon2id } from 'hash-wasm';
import type { SessionBody, Role } from '../shared/types.js';
import { config } from './config.js';
import { pool, withTransaction } from './db.js';
import { HttpError, changeRefused, cookies, sameOrigin, unauthenticated } from './http.js';
import type { Ctx } from './http.js';
import { newId, newToken } from './ids.js';

export interface Staff {
  id: string;
  name: string;
  email: string;
  role: Role;
  gameId: string;
  gameSlug: string;
  gameName: string;
  familyId: string;
  changeToken: string;
}

interface AccessClaims {
  sub: string;
  fam: string;
  jti: string;
  exp: number;
}

let signingKey = '';

export async function loadSigningKey(): Promise<void> {
  await pool.query('insert into signing_key (id, key) values (1, $1) on conflict do nothing', [randomBytes(48).toString('base64')]);
  const { rows } = await pool.query<{ key: string }>('select key from signing_key where id = 1');
  signingKey = (rows[0] as { key: string }).key;
}

const sign = (data: string): string => createHmac('sha256', signingKey).update(data).digest('base64url');

function issueAccessToken(claims: AccessClaims): string {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${head}.${payload}.${sign(`${head}.${payload}`)}`;
}

function readAccessToken(token: string): AccessClaims | null {
  const [head, payload, signature] = token.split('.');
  if (!head || !payload || !signature) return null;
  const expected = Buffer.from(sign(`${head}.${payload}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AccessClaims;
    return claims.exp * 1000 > Date.now() ? claims : null;
  } catch {
    return null;
  }
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

interface StaffRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  game_id: string;
  slug: string;
  game_name: string;
  change_token: string;
  revoked: boolean;
  jti_revoked: boolean;
}

async function loadStaff(familyId: string, userId: string, jti: string): Promise<{ staff: Staff; usable: boolean } | null> {
  const { rows } = await pool.query<StaffRow>(
    `select s.id, s.name, s.email, s.role, s.game_id, g.slug, g.name as game_name, f.change_token, f.revoked,
            exists (select 1 from revoked_jtis j where j.jti = $2) as jti_revoked
       from refresh_families f
       join staff s on s.id = f.user_id
       join games g on g.id = s.game_id
      where f.id = $1 and s.id = $3`,
    [familyId, jti, userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    usable: !row.revoked && !row.jti_revoked,
    staff: {
      id: row.id, name: row.name, email: row.email, role: row.role, gameId: row.game_id, gameSlug: row.slug,
      gameName: row.game_name, familyId, changeToken: row.change_token,
    },
  };
}

export async function authenticateStaff(ctx: Ctx): Promise<Staff> {
  const token = cookies(ctx.req).hl_access;
  const claims = token ? readAccessToken(token) : null;
  if (!claims) throw unauthenticated();
  const loaded = await loadStaff(claims.fam, claims.sub, claims.jti);
  if (!loaded?.usable) throw unauthenticated();
  return loaded.staff;
}

export function requireChange(ctx: Ctx, staff: Pick<Staff, 'changeToken'>): void {
  if (!sameOrigin(ctx.req) || ctx.req.headers['x-change-token'] !== staff.changeToken) throw changeRefused();
}

export function sessionBody(staff: Staff): SessionBody {
  return {
    user: { id: staff.id, name: staff.name, email: staff.email, role: staff.role },
    game: { slug: staff.gameSlug, name: staff.gameName },
    change_token: staff.changeToken,
  };
}

const COOKIE_FLAGS = 'HttpOnly; SameSite=Strict';

function sessionCookies(accessToken: string, refreshToken: string): string[] {
  return [
    `hl_access=${accessToken}; Path=/; Max-Age=${config.accessTokenTtlSeconds}; ${COOKIE_FLAGS}`,
    `hl_refresh=${refreshToken}; Path=/api/auth; Max-Age=${config.refreshFamilyTtlSeconds}; ${COOKIE_FLAGS}`,
  ];
}

export function clearedCookies(): string[] {
  const gone = 'Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
  return [`hl_access=; Path=/; ${gone}; ${COOKIE_FLAGS}`, `hl_refresh=; Path=/api/auth; ${gone}; ${COOKIE_FLAGS}`];
}

function accessFor(userId: string, familyId: string): string {
  return issueAccessToken({ sub: userId, fam: familyId, jti: newId(), exp: Math.floor(Date.now() / 1000) + config.accessTokenTtlSeconds });
}

export const hashPassword = (password: string): Promise<string> =>
  argon2id({ password, salt: randomBytes(16), parallelism: 1, iterations: 2, memorySize: 19456, hashLength: 32, outputType: 'encoded' });

let unknownEmailHash: Promise<string> | null = null;

export async function login(email: string, password: string): Promise<{ staff: Staff; cookies: string[] } | null> {
  const { rows } = await pool.query<{ id: string; password_hash: string }>('select id, password_hash from staff where lower(email) = lower($1)', [email]);
  const user = rows[0];
  unknownEmailHash ??= hashPassword(randomBytes(16).toString('hex'));
  const valid = await argon2Verify({ password, hash: user?.password_hash ?? (await unknownEmailHash) }).catch(() => false);
  if (!user || !valid) return null;
  const familyId = newId();
  const refreshToken = newToken();
  await withTransaction(async (tx) => {
    await tx.query(`insert into refresh_families (id, user_id, change_token, expires_at) values ($1, $2, $3, now() + make_interval(secs => $4))`, [
      familyId, user.id, newToken(), config.refreshFamilyTtlSeconds,
    ]);
    await tx.query(`insert into refresh_tokens (token_hash, family_id, state) values ($1, $2, 'active')`, [hashToken(refreshToken), familyId]);
  });
  const staff = await staffForFamily(familyId, user.id);
  return { staff, cookies: sessionCookies(accessFor(user.id, familyId), refreshToken) };
}

async function staffForFamily(familyId: string, userId: string): Promise<Staff> {
  return ((await loadStaff(familyId, userId, '')) as { staff: Staff }).staff;
}

export async function refresh(ctx: Ctx): Promise<{ staff: Staff; cookies: string[] }> {
  const given = cookies(ctx.req).hl_refresh;
  if (!given) throw unauthenticated();
  const tokenHash = hashToken(given);
  const outcome = await withTransaction(async (tx) => {
    const found = await tx.query<{ family_id: string }>('select family_id from refresh_tokens where token_hash = $1', [tokenHash]);
    const familyId = found.rows[0]?.family_id;
    if (!familyId) return { kind: 'unknown' as const };
    const family = (
      await tx.query<{ user_id: string; change_token: string; revoked: boolean; expired: boolean }>(
        'select user_id, change_token, revoked, expires_at <= now() as expired from refresh_families where id = $1 for update',
        [familyId],
      )
    ).rows[0];
    if (!family || family.revoked || family.expired) return { kind: 'unknown' as const };
    const state = (await tx.query<{ state: string }>('select state from refresh_tokens where token_hash = $1', [tokenHash])).rows[0]?.state;
    if (state === 'rotated') {
      await tx.query('update refresh_families set revoked = true where id = $1', [familyId]);
      return { kind: 'reused' as const };
    }
    if (!sameOrigin(ctx.req) || ctx.req.headers['x-change-token'] !== family.change_token) return { kind: 'refused' as const };
    const next = newToken();
    await tx.query(`update refresh_tokens set state = 'rotated' where token_hash = $1`, [tokenHash]);
    await tx.query(`insert into refresh_tokens (token_hash, family_id, state) values ($1, $2, 'active')`, [hashToken(next), familyId]);
    await tx.query('update refresh_families set expires_at = now() + make_interval(secs => $2) where id = $1', [familyId, config.refreshFamilyTtlSeconds]);
    return { kind: 'rotated' as const, familyId, userId: family.user_id, next };
  });
  if (outcome.kind === 'reused') throw new HttpError(401, 'refresh_reused', 'Sign in again.');
  if (outcome.kind === 'unknown') throw unauthenticated();
  if (outcome.kind === 'refused') throw changeRefused();
  const staff = await staffForFamily(outcome.familyId, outcome.userId);
  return { staff, cookies: sessionCookies(accessFor(staff.id, outcome.familyId), outcome.next) };
}

export async function logout(ctx: Ctx, staff: Staff): Promise<void> {
  const claims = readAccessToken(cookies(ctx.req).hl_access ?? '');
  await withTransaction(async (tx) => {
    if (claims) await tx.query('insert into revoked_jtis (jti, expires_at) values ($1, to_timestamp($2)) on conflict do nothing', [claims.jti, claims.exp]);
    await tx.query('update refresh_families set revoked = true where id = $1', [staff.familyId]);
    await tx.query('delete from revoked_jtis where expires_at < now()');
  });
}
