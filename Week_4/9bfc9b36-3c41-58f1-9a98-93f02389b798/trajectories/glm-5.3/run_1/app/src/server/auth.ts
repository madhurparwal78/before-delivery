import type { Request } from 'express';
import { Refusal } from '../domain/failure.ts';
import { words } from '../domain/words.ts';
import type { Ctx } from './boot.ts';
import type { Caller } from './caller.ts';
import type { DbClient } from './db.ts';
import { normalizeEmail } from './util.ts';

/**
 * Read the caller from stored records on every call. Role, ownership and authority never come
 * from token claims.
 */
export async function authenticate(ctx: Ctx, req: Request): Promise<Caller | null> {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    const account = await verifyToken(ctx, token);
    return account;
  }
  const cookie = (req as unknown as { cookies?: Record<string, string> }).cookies?.['boltrope_session'];
  if (cookie) {
    const account = await accountBySessionToken(ctx, cookie);
    return account;
  }
  return null;
}

export async function accountBySessionToken(ctx: Ctx, token: string): Promise<Caller | null> {
  const rows = await ctx.db.query<{ id: string; email_norm: string; display_name: string; role: Caller['role'] }>(
    `SELECT a.id, a.email_norm, a.display_name, a.role FROM sessions s JOIN accounts a ON a.id = s.account_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND a.deleted = false`,
    [token],
  );
  return rows[0] ? { id: rows[0].id, email: rows[0].email_norm, displayName: rows[0].display_name, role: rows[0].role } : null;
}

async function verifyToken(ctx: Ctx, token: string): Promise<Caller | null> {
  try {
    const { jwtVerify, createRemoteJWKSet } = await import('jose');
    const jwks = createRemoteJWKSet(new URL(`${ctx.config.keycloakUrl}/realms/${ctx.config.keycloakRealm}/protocol/openid-connect/certs`));
    const { payload } = await jwtVerify(token, jwks, {
      issuer: ctx.config.issuerUrl,
      clockTolerance: 5,
    });
    const sub = payload.sub;
    if (!sub) return null;
    const rows = await ctx.db.query<{ id: string; email_norm: string; display_name: string; role: Caller['role'] }>(
      `SELECT id, email_norm, display_name, role FROM accounts WHERE kc_user_id = $1 AND deleted = false`,
      [sub],
    );
    const row = rows[0];
    return row ? { id: row.id, email: row.email_norm, displayName: row.display_name, role: row.role } : null;
  } catch {
    return null;
  }
}

export async function callerByEmail(db: { query: DbClient['query'] }, email: string): Promise<Caller | null> {
  const rows = await db.query<{ id: string; email_norm: string; display_name: string; role: Caller['role'] }>(
    `SELECT id, email_norm, display_name, role FROM accounts WHERE email_norm = $1 AND deleted = false`,
    [normalizeEmail(email)],
  );
  const row = rows[0];
  return row ? { id: row.id, email: row.email_norm, displayName: row.display_name, role: row.role } : null;
}

export function unauthenticated(): Refusal {
  return new Refusal(401, 'unauthenticated', words.errors.unauthenticated);
}
