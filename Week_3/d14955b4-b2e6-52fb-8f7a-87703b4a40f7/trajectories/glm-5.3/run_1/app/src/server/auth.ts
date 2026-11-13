import jwt from 'jsonwebtoken';
import { query, transaction } from './db';
import { loadConfig } from './config';
import { newId, newToken, sha256Hex } from './crypto';
import { ERRORS } from './http';

export interface StaffRow {
  id: string;
  game_id: string;
  name: string;
  email: string;
  role: 'developer' | 'moderator';
}

export interface GameRow {
  id: string;
  slug: string;
  name: string;
}

export interface SessionTokens {
  user: { id: string; name: string; email: string; role: 'developer' | 'moderator' };
  game: { slug: string; name: string };
  change_token: string;
  familyId: string;
  jti: string;
  accessToken: string;
  refreshToken: string;
}

export interface GameAndStaff {
  game: GameRow;
  staff: StaffRow;
}

let signingKey: string | null = null;

async function ensureSigningKey(): Promise<string> {
  if (signingKey) return signingKey;
  const existing = await query<{ key: string }>('SELECT key FROM access_key WHERE singleton = true');
  if (existing.rows.length > 0) {
    signingKey = existing.rows[0].key;
    return signingKey;
  }
  const key = newToken(48);
  await transaction(async (client) => {
    await client.query('INSERT INTO access_key (singleton, key) VALUES (true, $1) ON CONFLICT DO NOTHING', [key]);
  });
  const after = await query<{ key: string }>('SELECT key FROM access_key WHERE singleton = true');
  signingKey = after.rows[0].key;
  return signingKey;
}

export async function loadProfile(staffId: string): Promise<GameAndStaff> {
  const result = await query<StaffRow & { game_slug: string; game_name: string }>(
    `SELECT s.id, s.game_id, s.name, s.email, s.role, g.slug AS game_slug, g.name AS game_name
       FROM staff s JOIN games g ON g.id = s.game_id WHERE s.id = $1`,
    [staffId],
  );
  if (result.rows.length === 0) throw ERRORS.notFound();
  const row = result.rows[0];
  return {
    game: { id: row.game_id, slug: row.game_slug, name: row.game_name },
    staff: { id: row.id, game_id: row.game_id, name: row.name, email: row.email, role: row.role },
  };
}

function sessionBody(profile: GameAndStaff, changeToken: string, familyId: string, jti: string, accessToken: string, refreshToken: string): SessionTokens {
  return {
    user: { id: profile.staff.id, name: profile.staff.name, email: profile.staff.email, role: profile.staff.role },
    game: { slug: profile.game.slug, name: profile.game.name },
    change_token: changeToken,
    familyId,
    jti,
    accessToken,
    refreshToken,
  };
}

export async function createSessionTokens(staffId: string): Promise<SessionTokens> {
  const familyId = newId('fam');
  const refreshToken = newToken(32);
  const changeToken = newToken(24);
  await transaction(async (client) => {
    await client.query(
      'INSERT INTO refresh_families (id, staff_id, current_token_hash, change_token, expires_at) VALUES ($1,$2,$3,$4, now() + ($5 || \' seconds\')::interval)',
      [familyId, staffId, sha256Hex(refreshToken), changeToken, String(loadConfig().refreshTokenTtlSeconds)],
    );
  });
  return rotateAndIssue(staffId, familyId, changeToken, refreshToken);
}

async function rotateAndIssue(staffId: string, familyId: string, changeToken: string, refreshToken: string): Promise<SessionTokens> {
  const profile = await loadProfile(staffId);
  const key = await ensureSigningKey();
  const jti = newId('jti');
  const ttl = loadConfig().accessTokenTtlSeconds;
  const accessToken = jwt.sign({ sub: staffId, fam: familyId }, key, { jwtid: jti, expiresIn: ttl });
  return sessionBody(profile, changeToken, familyId, jti, accessToken, refreshToken);
}

export interface AccessClaims extends jwt.JwtPayload {
  sub: string;
  fam: string;
}

export async function verifyAccess(token: string): Promise<{ staffId: string; familyId: string; jti: string }> {
  const key = await ensureSigningKey();
  let claims: AccessClaims;
  try {
    claims = jwt.verify(token, key) as AccessClaims;
  } catch {
    throw ERRORS.unauthenticated();
  }
  const revoked = await query<{ jti: string }>('SELECT jti FROM revoked_jtis WHERE jti = $1', [claims.jti]);
  if (revoked.rows.length > 0) throw ERRORS.unauthenticated();
  const family = await query<{ revoked: boolean; expires_at: Date }>(
    'SELECT revoked, expires_at FROM refresh_families WHERE id = $1',
    [claims.fam],
  );
  if (family.rows.length === 0 || family.rows[0].revoked || family.rows[0].expires_at.getTime() < Date.now()) throw ERRORS.unauthenticated();
  return { staffId: claims.sub, familyId: claims.fam, jti: String(claims.jti) };
}

export async function rotateRefresh(rawToken: string): Promise<SessionTokens> {
  const hash = sha256Hex(rawToken);
  const rotatedBefore = await query<{ family_id: string }>('SELECT family_id FROM rotated_refresh_tokens WHERE token_hash = $1', [hash]);
  if (rotatedBefore.rows.length > 0) {
    await revokeFamily(rotatedBefore.rows[0].family_id);
    throw ERRORS.refreshReused();
  }
  const found = await query<{ id: string; staff_id: string; change_token: string; expires_at: Date; revoked: boolean }>(
    'SELECT id, staff_id, change_token, expires_at, revoked FROM refresh_families WHERE current_token_hash = $1',
    [hash],
  );
  if (found.rows.length === 0) throw ERRORS.unauthenticated();
  const family = found.rows[0];
  if (family.revoked || family.expires_at.getTime() < Date.now()) throw ERRORS.unauthenticated();
  const nextToken = newToken(32);
  const staffId = await transaction(async (client) => {
    await client.query('INSERT INTO rotated_refresh_tokens (id, family_id, token_hash) VALUES ($1,$2,$3)', [newId('rot'), family.id, hash]);
    const move = await client.query<{ staff_id: string }>(
      `UPDATE refresh_families
          SET current_token_hash = $2,
              expires_at = now() + ($3 || ' seconds')::interval,
              last_rotated_at = now(),
              revoked = false
        WHERE id = $1 AND current_token_hash = $4
        RETURNING staff_id`,
      [family.id, sha256Hex(nextToken), String(loadConfig().refreshTokenTtlSeconds), hash],
    );
    if (move.rows.length === 0) throw ERRORS.refreshReused();
    return move.rows[0].staff_id;
  });
  return rotateAndIssue(staffId, family.id, family.change_token, nextToken);
}

export async function revokeFamily(familyId: string): Promise<void> {
  await transaction(async (client) => {
    await client.query('UPDATE refresh_families SET revoked = true WHERE id = $1', [familyId]);
  });
}

export async function revokeJti(jti: string, expiresAt: Date): Promise<void> {
  await query('INSERT INTO revoked_jtis (jti, expires_at) VALUES ($1,$2) ON CONFLICT DO NOTHING', [jti, expiresAt]);
}

export async function familyChangeToken(familyId: string): Promise<string | null> {
  const result = await query<{ change_token: string }>('SELECT change_token FROM refresh_families WHERE id = $1', [familyId]);
  return result.rows[0]?.change_token ?? null;
}

