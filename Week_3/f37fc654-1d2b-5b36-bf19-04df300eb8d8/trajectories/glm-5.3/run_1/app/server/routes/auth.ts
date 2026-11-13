import { Router } from 'express';
import type { Config } from '../config.js';
import { pool, withTransaction } from '../db.js';
import { KeycloakOidc, createAttempt, takeAttempt, safeReturnTo, upsertAppUser, roleFromRealmRoles, sessionCookie, clearedSessionCookie, readSessionCookie, loadSession, deleteSession, updateSessionAccess, createSession } from '../auth.js';
import { KeycloakAdmin } from '../services/keycloak.js';

export function authRouter(cfg: Config): Router {
  const router = Router();
  const oidc = new KeycloakOidc(cfg);

  const ROLE_LANDING: Record<string, string> = {
    producer: '/studio',
    client: '/commissions',
    crew: '/crew',
    sponsor: '',
  };

  router.get('/login', async (req, res) => {
    const raw = typeof req.query['returnTo'] === 'string' ? req.query['returnTo'] : undefined;
    const returnTo = safeReturnTo(raw, '');
    const kc = new KeycloakAdmin(cfg);
    const available = await kc.available().catch(() => false);
    if (!available) {
      res.status(503).set('content-type', 'text/html').send(signInDownPage());
      return;
    }
    const landing = returnTo || '/commissions';
    const attempt = createAttempt(landing);
    res.cookie('spindrift_oidc', JSON.stringify({ state: attempt.state }), {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000,
    });
    res.status(302).set('location', oidc.authorizationUrl(attempt)).end();
  });

  router.get('/callback', async (req, res) => {
    const code = typeof req.query['code'] === 'string' ? req.query['code'] : undefined;
    const state = typeof req.query['state'] === 'string' ? req.query['state'] : undefined;
    const cookieRaw = readOidcCookie(req.headers.cookie);
    // The attempt binds the browser; a missing, reused or other-browser state fails.
    if (!code || !state || !cookieRaw || cookieRaw !== state) {
      res.status(400).set('content-type', 'text/html').send(signInErrorPage());
      return;
    }
    const attempt = takeAttempt(state);
    if (!attempt) {
      res.status(400).set('content-type', 'text/html').send(signInErrorPage());
      return;
    }
    let tokens;
    try {
      tokens = await oidc.exchange(code, attempt);
    } catch {
      res.status(400).set('content-type', 'text/html').send(signInErrorPage());
      return;
    }
    const nonce = oidc.idTokenNonce(tokens.id_token);
    if (nonce !== attempt.nonce) {
      res.status(400).set('content-type', 'text/html').send(signInErrorPage());
      return;
    }
    const info = await oidc.userInfo(tokens.access_token).catch(() => null);
    if (!info) {
      res.status(400).set('content-type', 'text/html').send(signInErrorPage());
      return;
    }
    const roles = await realmRolesFor(cfg, tokens.access_token).catch(() => [] as string[]);
    const role = roleFromRealmRoles(roles);
    let returnTo = attempt.returnTo;
    await withTransaction(async (tx) => {
      await upsertAppUser(tx, info.sub, info.email, info.name ?? info.email, role);
      if (roles.length === 0) {
        // A signed-in user with none of the four roles gets client.
        const kc = new KeycloakAdmin(cfg);
        await kc.ensureRole(info.sub, 'client').catch(() => undefined);
      }
    });
    if (!returnTo) {
      returnTo = await roleLanding(cfg, role, info.sub);
    }
    const sessionId = await withTransaction(async (tx) => {
      const user = (await tx.query(`SELECT id FROM app_users WHERE keycloak_id = $1`, [info.sub])).rows[0] as { id: string };
      return createSession(cfg, tx, user.id, tokens);
    });
    res.cookie('spindrift_oidc', '', { httpOnly: true, sameSite: 'lax', maxAge: 0 });
    res.set('set-cookie', res.getHeader('set-cookie') as string ?? '');
    res.append('set-cookie', sessionCookie(sessionId));
    res.status(302).set('location', returnTo).end();
  });

  router.post('/refresh', async (req, res) => {
    const sessionId = readSessionCookie(req.headers.cookie);
    if (!sessionId) {
      res.status(401).json({ error: { code: 'signed_out' } });
      return;
    }
    const tx = await pool.connect();
    try {
      const session = await loadSession(tx, sessionId);
      if (!session) {
        res.status(401).json({ error: { code: 'signed_out' } });
        return;
      }
      try {
        const tokens = await oidc.refresh(session.refreshToken);
        await updateSessionAccess(tx, sessionId, tokens, cfg.accessTtlSeconds);
        res.status(204).end();
      } catch {
        await deleteSession(tx, sessionId);
        res.set('set-cookie', clearedSessionCookie());
        res.status(401).json({ error: { code: 'signed_out' } });
      }
    } finally {
      tx.release();
    }
  });

  router.post('/logout', async (req, res) => {
    const sessionId = readSessionCookie(req.headers.cookie);
    if (sessionId) {
      const tx = await pool.connect();
      try {
        const session = await loadSession(tx, sessionId);
        if (session) {
          await oidc.logout(session.refreshToken);
          await deleteSession(tx, sessionId);
        }
      } finally {
        tx.release();
      }
    }
    res.set('set-cookie', clearedSessionCookie());
    res.status(204).end();
  });

  return router;

  async function roleLanding(cfg: Config, role: string, keycloakId: string): Promise<string> {
    if (role === 'sponsor') {
      const tx = await pool.connect();
      try {
        const user = (await tx.query(`SELECT id FROM app_users WHERE keycloak_id = $1`, [keycloakId])).rows[0] as { id: string } | undefined;
        if (user) {
          const funder = (await tx.query(`SELECT commission_id FROM funders WHERE app_user_id = $1 ORDER BY accepted_at DESC NULLS LAST LIMIT 1`, [user.id])).rows[0] as { commission_id: string } | undefined;
          if (funder) return `/c/${funder.commission_id}/share`;
        }
      } finally {
        tx.release();
      }
      return '/commissions';
    }
    return ROLE_LANDING[role] ?? '/commissions';
  }
}

function readOidcCookie(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'spindrift_oidc') {
      try {
        return (JSON.parse(decodeURIComponent(rest.join('='))) as { state: string }).state;
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function realmRolesFor(cfg: Config, accessToken: string): Promise<string[]> {
  try {
    const url = `${cfg.authIssuerUrl}/protocol/openid-connect/userinfo`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    // Keycloak userinfo does not include realm roles by default; introspection does.
    const intro = await fetch(`${cfg.authIssuerUrl}/protocol/openid-connect/token/introspect`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: accessToken, client_id: cfg.authClientId, client_secret: cfg.authClientSecret }),
      signal: AbortSignal.timeout(5000),
    });
    if (!intro.ok) return [];
    const json = (await intro.json()) as { realm_access?: { roles?: string[] } };
    return json.realm_access?.roles ?? [];
  } catch {
    return [];
  }
}

export function signInErrorPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign-in didn't complete</title>
  <style>body{background:#050a14;color:#fff;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:560px;padding:32px}h1{font-size:24px}p{color:#b8c4d4;line-height:1.6}a{color:#7cc4ff}</style></head>
  <body><main>
    <h1>Sign-in didn't complete</h1>
    <p>That sign-in link has expired, was already used or was opened in a different browser. Start again from Sign in.</p>
    <p><a href="/auth/login">Sign in</a></p>
  </main></body></html>`;
}

function signInDownPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign-in is paused</title>
  <style>body{background:#050a14;color:#fff;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:560px;padding:32px}h1{font-size:24px}p{color:#b8c4d4;line-height:1.6}</style></head>
  <body><main>
    <h1>Sign-in is paused</h1>
    <p>Sign-in is paused — our sign-in service isn't answering. If you're already signed in, you can keep working for now.</p>
  </main></body></html>`;
}

