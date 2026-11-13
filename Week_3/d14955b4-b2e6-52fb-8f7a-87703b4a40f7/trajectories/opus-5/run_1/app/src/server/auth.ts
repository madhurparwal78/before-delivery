import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';
import { config } from './config';
import { one, query } from './db';
import { ApiError, changeRefused, unauthenticated } from './errors';
import { newId, randomToken } from './ids';
import { parseCookies, type Ctx } from './http';
import type { Caller } from './domain/permissions';
import type { Rule, StaffRole } from '../shared/types';

export const ACCESS_COOKIE = 'hl_access';
export const REFRESH_COOKIE = 'hl_refresh';
export const ACCESS_COOKIE_PATH = '/';
export const REFRESH_COOKIE_PATH = '/api/auth';

export async function hashPassword(password: string): Promise<string> {
  return argon2id({
    password,
    salt: randomBytes(16),
    parallelism: 1,
    iterations: 2,
    memorySize: 19_456,
    hashLength: 32,
    outputType: 'encoded',
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash });
  } catch {
    return false;
  }
}

let signingKey: Buffer | null = null;

export async function loadSigningKey(): Promise<Buffer> {
  if (signingKey) return signingKey;
  const existing = await one<{ value: string }>(`SELECT value FROM app_keys WHERE name = 'access_signing_key'`);
  if (existing) {
    signingKey = Buffer.from(existing.value, 'base64');
    return signingKey;
  }
  const generated = randomBytes(32);
  await query(
    `INSERT INTO app_keys (name, value) VALUES ('access_signing_key', $1) ON CONFLICT (name) DO NOTHING`,
    [generated.toString('base64')],
  );
  const stored = await one<{ value: string }>(`SELECT value FROM app_keys WHERE name = 'access_signing_key'`);
  signingKey = Buffer.from((stored?.value ?? generated.toString('base64')), 'base64');
  return signingKey;
}

interface AccessClaims {
  sub: string;
  fam: string;
  jti: string;
  exp: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  const key = await loadSigningKey();
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify(claims));
  const signature = createHmac('sha256', key).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

async function readAccessToken(token: string): Promise<AccessClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];
  const key = await loadSigningKey();
  const expected = createHmac('sha256', key).update(`${header}.${payload}`).digest('base64url');
  const given = Buffer.from(signature, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;
  let claims: AccessClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AccessClaims;
  } catch {
    return null;
  }
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) return null;
  return claims;
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface Session {
  caller: Caller;
  email: string;
  familyId: string;
  changeToken: string;
  jti: string;
}

interface StaffRow {
  id: string;
  game_id: string;
  name: string;
  email: string;
  role: StaffRole;
}

export async function loadRules(moderatorId: string): Promise<Rule[]> {
  const result = await query<Rule>(
    `SELECT id, effect, action, topic FROM rules WHERE moderator_id = $1 ORDER BY seq ASC`,
    [moderatorId],
  );
  return result.rows;
}

async function buildCaller(staff: StaffRow): Promise<Caller> {
  const rules = staff.role === 'moderator' ? await loadRules(staff.id) : [];
  return {
    staffId: staff.id,
    gameId: staff.game_id,
    name: staff.name,
    role: staff.role,
    rules,
  };
}

/** A missing, expired or revoked access token answers 401 `unauthenticated`. */
export async function requireSession(ctx: Ctx): Promise<Session> {
  const cookies = parseCookies(ctx.req);
  const token = cookies[ACCESS_COOKIE];
  if (!token) throw unauthenticated();
  const claims = await readAccessToken(token);
  if (!claims) throw unauthenticated();
  const revoked = await one<{ jti: string }>(`SELECT jti FROM revoked_access_tokens WHERE jti = $1`, [claims.jti]);
  if (revoked) throw unauthenticated();
  const family = await one<{ id: string; change_token: string; revoked: boolean; last_rotated_at: Date }>(
    `SELECT id, change_token, revoked, last_rotated_at FROM refresh_families WHERE id = $1`,
    [claims.fam],
  );
  if (!family || family.revoked) throw unauthenticated();
  if (family.last_rotated_at.getTime() + config.refreshFamilyTtlSeconds * 1000 <= Date.now()) {
    throw unauthenticated();
  }
  const staff = await one<StaffRow>(`SELECT id, game_id, name, email, role FROM staff WHERE id = $1`, [claims.sub]);
  if (!staff) throw unauthenticated();
  return {
    caller: await buildCaller(staff),
    email: staff.email,
    familyId: family.id,
    changeToken: family.change_token,
    jti: claims.jti,
  };
}

export function requireChangeToken(ctx: Ctx, session: Session): void {
  const given = ctx.req.headers['x-change-token'];
  if (typeof given !== 'string' || given.length === 0) throw changeRefused();
  const left = Buffer.from(given, 'utf8');
  const right = Buffer.from(session.changeToken, 'utf8');
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw changeRefused();
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  familyId: string;
  changeToken: string;
}

export async function startFamily(staffId: string): Promise<IssuedSession> {
  const familyId = newId('fam');
  const changeToken = randomToken();
  await query(`INSERT INTO refresh_families (id, staff_id, change_token) VALUES ($1, $2, $3)`, [
    familyId,
    staffId,
    changeToken,
  ]);
  return issueForFamily(staffId, familyId, changeToken);
}

export async function issueForFamily(
  staffId: string,
  familyId: string,
  changeToken: string,
): Promise<IssuedSession> {
  const refreshToken = randomToken();
  await query(`INSERT INTO refresh_tokens (token_hash, family_id, state) VALUES ($1, $2, 'active')`, [
    hashRefreshToken(refreshToken),
    familyId,
  ]);
  const accessToken = await signAccessToken({
    sub: staffId,
    fam: familyId,
    jti: newId('jti'),
    exp: Math.floor(Date.now() / 1000) + config.accessTokenTtlSeconds,
  });
  return { accessToken, refreshToken, familyId, changeToken };
}

export async function revokeFamily(familyId: string): Promise<void> {
  await query(`UPDATE refresh_families SET revoked = true WHERE id = $1`, [familyId]);
  await query(`DELETE FROM refresh_tokens WHERE family_id = $1`, [familyId]);
}

export async function revokeAccessToken(jti: string, expiresAt: Date): Promise<void> {
  await query(
    `INSERT INTO revoked_access_tokens (jti, expires_at) VALUES ($1, $2) ON CONFLICT (jti) DO NOTHING`,
    [jti, expiresAt],
  );
}

export interface RefreshOutcome {
  staffId: string;
  familyId: string;
  changeToken: string;
}

/**
 * Reads the presented refresh token. Rotation has no grace window, so a
 * superseded token revokes its whole family here.
 */
export async function inspectRefreshToken(rawToken: string | undefined): Promise<RefreshOutcome> {
  if (!rawToken) throw unauthenticated();
  const tokenHash = hashRefreshToken(rawToken);
  const row = await one<{
    state: string;
    family_id: string;
    staff_id: string;
    change_token: string;
    revoked: boolean;
    last_rotated_at: Date;
  }>(
    `SELECT rt.state, rt.family_id, rf.staff_id, rf.change_token, rf.revoked, rf.last_rotated_at
       FROM refresh_tokens rt JOIN refresh_families rf ON rf.id = rt.family_id
      WHERE rt.token_hash = $1`,
    [tokenHash],
  );
  if (!row) throw unauthenticated();
  if (row.revoked) throw unauthenticated();
  if (row.last_rotated_at.getTime() + config.refreshFamilyTtlSeconds * 1000 <= Date.now()) {
    throw unauthenticated();
  }
  if (row.state !== 'active') {
    await revokeFamily(row.family_id);
    throw new ApiError(401, 'refresh_reused');
  }
  return { staffId: row.staff_id, familyId: row.family_id, changeToken: row.change_token };
}

export async function rotateRefreshToken(
  rawToken: string,
  outcome: RefreshOutcome,
): Promise<IssuedSession> {
  const rotated = await one<{ token_hash: string }>(
    `UPDATE refresh_tokens SET state = 'rotated' WHERE token_hash = $1 AND state = 'active' RETURNING token_hash`,
    [hashRefreshToken(rawToken)],
  );
  if (!rotated) {
    await revokeFamily(outcome.familyId);
    throw new ApiError(401, 'refresh_reused');
  }
  await query(`UPDATE refresh_families SET last_rotated_at = now() WHERE id = $1`, [outcome.familyId]);
  return issueForFamily(outcome.staffId, outcome.familyId, outcome.changeToken);
}
