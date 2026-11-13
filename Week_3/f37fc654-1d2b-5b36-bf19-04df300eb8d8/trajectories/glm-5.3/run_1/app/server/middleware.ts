import type { Request, RequestHandler } from 'express';
import type { AppUser, Session } from './auth.js';
import { loadSession, loadUser, readSessionCookie } from './auth.js';
import { pool } from './db.js';

export interface AuthedRequest extends Request {
  user?: AppUser;
  sessionId?: string;
}

export type AuthedHandler = (req: AuthedRequest, res: import('express').Response) => Promise<void> | void;

const inflightRefresh = new Map<string, Promise<Session | null>>();

/** Loads the session; refreshes it once, shared by concurrent requests. */
async function sessionWithRefresh(sessionId: string, accessTtlSeconds: number): Promise<Session | null> {
  const existing = inflightRefresh.get(sessionId);
  if (existing) return existing;
  const promise = (async (): Promise<Session | null> => {
    const tx = await pool.connect();
    try {
      const session = await loadSession(tx, sessionId);
      if (!session) return null;
      if (Date.now() < session.accessExpiresAt) return session;
      // Access has lapsed: try to refresh once.
      const { KeycloakOidc, updateSessionAccess } = await import('./auth.js');
      const cfg = (await import('./config.js')).loadConfig();
      const oidc = new KeycloakOidc(cfg);
      try {
        const tokens = await oidc.refresh(session.refreshToken);
        await updateSessionAccess(tx, sessionId, tokens, accessTtlSeconds);
        return { ...session, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, accessExpiresAt: Date.now() + accessTtlSeconds * 1000 };
      } catch {
        const { deleteSession } = await import('./auth.js');
        await deleteSession(tx, sessionId);
        return 'expired' as unknown as Session | null;
      }
    } finally {
      tx.release();
    }
  })();
  inflightRefresh.set(sessionId, promise);
  try {
    return await promise;
  } finally {
    inflightRefresh.delete(sessionId);
  }
}

type AuthOutcome = { user: AppUser; sessionId: string } | { expired: true } | null;

export async function authenticate(req: AuthedRequest, accessTtlSeconds: number): Promise<AuthOutcome> {
  // Bearer token first.
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    const { KeycloakOidc, roleFromRealmRoles, upsertAppUser } = await import('./auth.js');
    const cfg = (await import('./config.js')).loadConfig();
    const oidc = new KeycloakOidc(cfg);
    const intro = await oidc.introspect(token);
    if (intro?.active && intro.sub) {
      const roles = intro.realm_access?.roles ?? [];
      const role = roleFromRealmRoles(roles);
      const email = intro.email ?? intro.preferred_username ?? '';
      const name = intro.name ?? email;
      const tx = await pool.connect();
      try {
        const user = await upsertAppUser(tx, intro.sub, email, name, role);
        if (roles.length === 0 || !roles.includes('client')) {
          // A signed-in user with none of the four roles gets client.
          const kc = new (await import('./services/keycloak.js')).KeycloakAdmin(cfg);
          await kc.ensureRole(intro.sub, 'client').catch(() => undefined);
        }
        return { user, sessionId: '' };
      } finally {
        tx.release();
      }
    }
    return null;
  }
  const cookie = readSessionCookie(req.headers.cookie);
  if (!cookie) return null;
  const session = await sessionWithRefresh(cookie, accessTtlSeconds);
  if (!session) return null;
  if ((session as unknown as string) === 'expired') return { expired: true };
  const tx = await pool.connect();
  try {
    const user = await loadUser(tx, session.userId);
    if (!user) return null;
    return { user, sessionId: cookie };
  } finally {
    tx.release();
  }
}

export function requireRole(user: AppUser | undefined, roles: Array<'producer' | 'client' | 'sponsor' | 'crew'>): boolean {
  if (!user) return false;
  return roles.includes(user.role);
}

export function requireAuth(accessTtlSeconds: number): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      const outcome = await authenticate(req as AuthedRequest, accessTtlSeconds);
      if (!outcome) {
        res.status(401).json({ error: { code: 'unauthenticated' } });
        return;
      }
      if ('expired' in outcome) {
        res.status(401).json({ error: { code: 'session_expired' } });
        return;
      }
      (req as AuthedRequest).user = outcome.user;
      (req as AuthedRequest).sessionId = outcome.sessionId;
      next();
    })();
  };
}
