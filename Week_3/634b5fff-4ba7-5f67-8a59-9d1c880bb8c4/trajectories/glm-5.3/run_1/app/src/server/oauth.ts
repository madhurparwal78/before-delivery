import express, { type Request, type Response } from 'express';
import { config } from './config.js';
import { IdentityDown, identityFromToken } from './identity.js';
import { asyncHandler, apiError, errorBody } from './errors.js';

export const SESSION_COOKIE = 'press_staff';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      staff?: { username: string; roles: string[] };
    }
  }
}

export function staffAuth(strictRole?: 'maker' | 'packer' | 'treasurer') {
  return asyncHandler(async (req: Request, _res: Response, next: express.NextFunction) => {
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
    const cookie = req.cookies?.[SESSION_COOKIE] as string | undefined;
    const identity = await identityFromToken(bearer ?? cookie);
    if (!identity) {
      throw apiError(401, 'sign_in_required');
    }
    if (strictRole && !identity.roles.includes(strictRole)) {
      throw apiError(403, 'forbidden');
    }
    if (!strictRole && !identity.roles.some((r) => r === 'maker' || r === 'packer' || r === 'treasurer')) {
      throw apiError(403, 'forbidden');
    }
    req.staff = identity;
    next();
  });
}

/** GET /auth/login starts the sign-in redirect. */
export async function login(_req: Request, res: Response): Promise<void> {
  const state = crypto.randomUUID();
  const redirectUri = `${config.appPublicUrl}/auth/callback`;
  const params = new URLSearchParams({
    client_id: config.keycloak.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid',
    state,
  });
  res.cookie('press_oauth_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 600_000, path: '/' });
  res.redirect(302, `${config.keycloak.issuerUrl.replace(/\/$/, '')}/protocol/openid-connect/auth?${params}`);
}

/** GET /auth/callback finishes the sign-in. */
export async function callback(req: Request, res: Response): Promise<void> {
  const code = typeof req.query.code === 'string' ? req.query.code : null;
  const state = typeof req.query.state === 'string' ? req.query.state : null;
  const expected = req.cookies?.['press_oauth_state'] as string | undefined;
  if (!code || !state || state !== expected) {
    res.status(503).json({ error: { code: 'identity_unreachable', message: 'Sign-in is unavailable right now. Try again shortly.' } });
    return;
  }
  try {
    const tokenUrl = `${config.keycloak.issuerUrl.replace(/\/$/, '')}/protocol/openid-connect/token`;
    const redirectUri = `${config.appPublicUrl}/auth/callback`;
    const r = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: config.keycloak.clientId,
        client_secret: config.keycloak.clientSecret,
        redirect_uri: redirectUri,
      }).toString(),
    });
    if (!r.ok) throw new IdentityDown(`token exchange ${r.status}`);
    const body = await r.json() as { access_token: string };
    const identity = await identityFromToken(body.access_token);
    if (!identity) throw new IdentityDown('token not verified');
    res.cookie(SESSION_COOKIE, body.access_token, { httpOnly: true, sameSite: 'lax', path: '/' });
    res.clearCookie('press_oauth_state', { path: '/' });
    res.redirect(302, '/staff');
  } catch (err) {
    void err;
    res.status(503).json({ error: { code: 'identity_unreachable', message: 'Sign-in is unavailable right now. Try again shortly.' } });
  }
}

/** POST /auth/logout ends the session. */
export function logout(_req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.status(204).end();
}

export function identityUnreachable(err: unknown, res: Response): void {
  if (err instanceof IdentityDown) {
    res.status(503).json(errorBody('identity_unreachable'));
    return;
  }
  res.status(500).json(errorBody('not_found'));
}
