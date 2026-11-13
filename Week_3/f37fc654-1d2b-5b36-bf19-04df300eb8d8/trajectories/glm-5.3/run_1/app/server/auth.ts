import crypto from 'node:crypto';
import type { Config } from './config.js';
import type { Role } from './config.js';
import type { DbClient } from './db.js';

export interface AuthAttempt {
  state: string;
  verifier: string;
  nonce: string;
  returnTo: string;
  createdAt: number;
}

export interface AppUser {
  id: string;
  keycloakId: string;
  email: string;
  name: string;
  role: Role;
}

export interface Session {
  userId: string;
  refreshToken: string;
  accessToken: string;
  accessExpiresAt: number;
  createdAt: number;
}

const ATTEMPT_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/** In-memory sign-in attempts; the callback must land on the same instance. */
const attempts = new Map<string, AuthAttempt>();

export function createAttempt(returnTo: string): AuthAttempt {
  const state = crypto.randomBytes(24).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const nonce = crypto.randomBytes(16).toString('hex');
  const attempt: AuthAttempt = { state, verifier, nonce, returnTo, createdAt: Date.now() };
  attempts.set(state, attempt);
  // Prune old attempts.
  const now = Date.now();
  for (const [key, value] of attempts) {
    if (now - value.createdAt > ATTEMPT_TTL_MS) attempts.delete(key);
  }
  return attempt;
}

export function takeAttempt(state: string): AuthAttempt | null {
  const attempt = attempts.get(state) ?? null;
  if (attempt) attempts.delete(state);
  return attempt;
}

export function challengeFor(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function safeReturnTo(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  return value;
}

const SESSION_COOKIE = 'spindrift_session';

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  id_token: string;
}

export class KeycloakOidc {
  constructor(private cfg: Config) {}

  authorizationUrl(attempt: AuthAttempt): string {
    const params = new URLSearchParams({
      client_id: this.cfg.authClientId,
      response_type: 'code',
      scope: 'openid',
      state: attempt.state,
      nonce: attempt.nonce,
      code_challenge: challengeFor(attempt.verifier),
      code_challenge_method: 'S256',
      redirect_uri: `${this.cfg.publicUrl}/auth/callback`,
    });
    return `${this.cfg.authIssuerUrl}/protocol/openid-connect/auth?${params}`;
  }

  async exchange(code: string, attempt: AuthAttempt): Promise<TokenSet> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.cfg.authClientId,
      client_secret: this.cfg.authClientSecret,
      code,
      redirect_uri: `${this.cfg.publicUrl}/auth/callback`,
      code_verifier: attempt.verifier,
    });
    const res = await fetch(`${this.cfg.authIssuerUrl}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`token exchange failed ${res.status}`);
    return (await res.json()) as TokenSet;
  }

  async refresh(refreshToken: string): Promise<TokenSet> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.cfg.authClientId,
      client_secret: this.cfg.authClientSecret,
      refresh_token: refreshToken,
    });
    const res = await fetch(`${this.cfg.authIssuerUrl}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`refresh failed ${res.status}`);
    return (await res.json()) as TokenSet;
  }

  async logout(refreshToken: string): Promise<void> {
    const body = new URLSearchParams({
      client_id: this.cfg.authClientId,
      client_secret: this.cfg.authClientSecret,
      refresh_token: refreshToken,
    });
    await fetch(`${this.cfg.authIssuerUrl}/protocol/openid-connect/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }

  /** Verifies an id token's nonce without full JWT validation, relying on the token endpoint over TLS. */
  idTokenNonce(idToken: string): string | null {
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;
    try {
      const payload = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')) as { nonce?: string };
      return payload.nonce ?? null;
    } catch {
      return null;
    }
  }

  async introspect(accessToken: string): Promise<{ active: boolean; sub?: string; email?: string; name?: string; realm_access?: { roles?: string[] }; preferred_username?: string } | null> {
    const body = new URLSearchParams({
      token: accessToken,
      client_id: this.cfg.authClientId,
      client_secret: this.cfg.authClientSecret,
    });
    try {
      const res = await fetch(`${this.cfg.authIssuerUrl}/protocol/openid-connect/token/introspect`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return null;
      return (await res.json()) as { active: boolean; sub?: string; email?: string; name?: string; realm_access?: { roles?: string[] }; preferred_username?: string };
    } catch {
      return null;
    }
  }

  async userInfo(accessToken: string): Promise<{ sub: string; email: string; name?: string; preferred_username?: string } | null> {
    try {
      const res = await fetch(`${this.cfg.authIssuerUrl}/protocol/openid-connect/userinfo`, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return null;
      return (await res.json()) as { sub: string; email: string; name?: string; preferred_username?: string };
    } catch {
      return null;
    }
  }
}

// --- Sessions: stored in Postgres, keyed by a random cookie id. ---

interface SessionRow {
  id: string;
  user_id: string;
  refresh_token: string;
  access_token: string;
  access_expires_at: Date;
  created_at: Date;
}

export async function createSession(cfg: Config, tx: DbClient, userId: string, tokens: TokenSet): Promise<string> {
  const id = crypto.randomBytes(32).toString('base64url');
  const accessExpiresAt = new Date(Date.now() + cfg.accessTtlSeconds * 1000);
  await tx.query(
    `INSERT INTO sessions (id, user_id, refresh_token, access_token, access_expires_at) VALUES ($1, $2, $3, $4, $5)`,
    [id, userId, tokens.refresh_token, tokens.access_token, accessExpiresAt],
  );
  return id;
}

export async function loadSession(tx: DbClient, id: string): Promise<Session | null> {
  const res = await tx.query<SessionRow>(`SELECT id, user_id, refresh_token, access_token, access_expires_at, created_at FROM sessions WHERE id = $1`, [id]);
  const row = res.rows[0];
  if (!row) return null;
  return {
    userId: row.user_id,
    refreshToken: row.refresh_token,
    accessToken: row.access_token,
    accessExpiresAt: row.access_expires_at.getTime(),
    createdAt: row.created_at.getTime(),
  };
}

export async function updateSessionAccess(tx: DbClient, id: string, tokens: TokenSet, accessTtlSeconds: number): Promise<void> {
  const accessExpiresAt = new Date(Date.now() + accessTtlSeconds * 1000);
  await tx.query(`UPDATE sessions SET access_token = $2, refresh_token = $3, access_expires_at = $4 WHERE id = $1`, [id, tokens.access_token, tokens.refresh_token, accessExpiresAt]);
}

export async function deleteSession(tx: DbClient, id: string): Promise<void> {
  await tx.query(`DELETE FROM sessions WHERE id = $1`, [id]);
}

export function sessionCookie(id: string): string {
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readSessionCookie(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=');
  }
  return null;
}

/** Ensures the app user row exists for a Keycloak user and returns it. */
export async function upsertAppUser(tx: DbClient, keycloakId: string, email: string, name: string, role: Role): Promise<AppUser> {
  const byKc = await tx.query<{ id: string; keycloak_id: string; email: string; name: string; role: Role }>(`SELECT id, keycloak_id, email, name, role FROM app_users WHERE keycloak_id = $1`, [keycloakId]);
  let row = byKc.rows[0];
  if (!row) {
    // Seeded rows created before a first sign-in carry a placeholder Keycloak id;
    // matching by email keeps their assignments under the real account.
    const byEmail = await tx.query<{ id: string; keycloak_id: string; email: string; name: string; role: Role }>(`SELECT id, keycloak_id, email, name, role FROM app_users WHERE email = $1`, [email]);
    row = byEmail.rows[0];
  }
  if (row) {
    const roleFinal = row.role !== role ? role : row.role;
    if (row.role !== role || row.keycloak_id !== keycloakId) {
      await tx.query(`UPDATE app_users SET role = $2, keycloak_id = $3 WHERE id = $1`, [row.id, roleFinal, keycloakId]);
    }
    return { id: row.id, keycloakId, email: row.email, name: row.name, role: roleFinal };
  }
  const id = crypto.randomUUID();
  await tx.query(`INSERT INTO app_users (id, keycloak_id, email, name, role) VALUES ($1, $2, $3, $4, $5)`, [id, keycloakId, email, name, role]);
  return { id, keycloakId, email, name, role };
}

export async function loadUser(tx: DbClient, id: string): Promise<AppUser | null> {
  const res = await tx.query(`SELECT id, keycloak_id, email, name, role FROM app_users WHERE id = $1`, [id]);
  const row = res.rows[0] as { id: string; keycloak_id: string; email: string; name: string; role: Role } | undefined;
  if (!row) return null;
  return { id: row.id, keycloakId: row.keycloak_id, email: row.email, name: row.name, role: row.role };
}

/** Resolves the app role from realm roles, defaulting a first-time user to client. */
export function roleFromRealmRoles(roles: string[]): Role {
  if (roles.includes('producer')) return 'producer';
  if (roles.includes('crew')) return 'crew';
  if (roles.includes('sponsor')) return 'sponsor';
  if (roles.includes('client')) return 'client';
  return 'client';
}
