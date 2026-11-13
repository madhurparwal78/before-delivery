import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { env } from '../env.js';
import { query } from '../db/pool.js';
import { ApiError } from '../http/errors.js';
import { route } from '../http/handler.js';
import { sendServerPage } from '../http/spa.js';
import {
  LOGIN_COOKIE,
  SESSION_COOKIE,
  clearCookie,
  createSession,
  deleteSession,
  readCookie,
  refreshSessionRow,
  requireCaller,
  sessionRefreshToken,
  setCookie,
  upsertUserFromClaims,
} from '../http/session.js';
import {
  SignInUnavailable,
  endSession,
  exchangeCode,
  oidc,
  readClaims,
  refreshTokens,
  signInIsUp,
} from '../services/keycloak.js';
import { ROLE_LANDING_ROUTE } from '../../shared/states.js';
import type { AppRole } from '../../shared/seed.js';

export const authRouter = Router();

/** A return route is kept only when it is a path starting with one slash. */
function safeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}

/**
 * Where each role lands after signing in. A sponsor reaches the share of their
 * most recently accepted commission; an account that also commissions work of
 * its own lands on its commissions instead.
 */
async function landingRouteFor(userId: string, roles: AppRole[]): Promise<string> {
  if (roles.includes('producer')) return ROLE_LANDING_ROUTE.producer;
  if (roles.includes('crew')) return ROLE_LANDING_ROUTE.crew;
  if (roles.includes('sponsor')) {
    const own = await query<{ count: number }>(
      'SELECT count(*)::int AS count FROM commissions WHERE client_id = $1',
      [userId],
    );
    if ((own.rows[0]?.count ?? 0) === 0) {
      const result = await query<{ commission_id: string }>(
        `SELECT commission_id FROM funders
          WHERE accepted_user_id = $1 AND kind = 'sponsor'
          ORDER BY accepted_at DESC NULLS LAST LIMIT 1`,
        [userId],
      );
      const commissionId = result.rows[0]?.commission_id;
      if (commissionId) return `/c/${commissionId}/share`;
    }
  }
  return ROLE_LANDING_ROUTE.client;
}

authRouter.get(
  '/auth/login',
  route(async (req, res) => {
    if (!(await signInIsUp())) {
      await sendServerPage(res, 503, 'signin_unavailable');
      return;
    }
    // A fresh state and code challenge for every attempt.
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(64).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const browserToken = randomBytes(32).toString('base64url');
    const returnTo = safeReturnTo(req.query['returnTo']) ?? '';

    await query(
      `INSERT INTO login_attempts (state, code_verifier, nonce, return_to, browser_token)
       VALUES ($1, $2, $3, $4, $5)`,
      [state, codeVerifier, nonce, returnTo, browserToken],
    );
    setCookie(res, LOGIN_COOKIE, browserToken, { maxAgeSeconds: 900 });

    const params = new URLSearchParams({
      response_type: 'code',
      scope: 'openid',
      client_id: env.authClientId,
      redirect_uri: `${env.publicUrl}/auth/callback`,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    res.redirect(302, `${oidc.authorizationEndpoint}?${params.toString()}`);
  }),
);

interface AttemptRow {
  state: string;
  code_verifier: string;
  nonce: string;
  return_to: string;
  browser_token: string;
}

function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

authRouter.get(
  '/auth/callback',
  route(async (req, res) => {
    const state = req.query['state'];
    const code = req.query['code'];
    const browserToken = readCookie(req, LOGIN_COOKIE);

    if (typeof state !== 'string' || typeof code !== 'string' || !browserToken) {
      await sendServerPage(res, 400, 'signin_error');
      return;
    }
    // One use only: the attempt is claimed as it is read.
    const claimed = await query<AttemptRow>(
      `UPDATE login_attempts SET used_at = now()
        WHERE state = $1 AND used_at IS NULL
        RETURNING state, code_verifier, nonce, return_to, browser_token`,
      [state],
    );
    const attempt = claimed.rows[0];
    if (!attempt || !tokensMatch(attempt.browser_token, browserToken)) {
      await sendServerPage(res, 400, 'signin_error');
      return;
    }

    let tokens;
    try {
      tokens = await exchangeCode(code, attempt.code_verifier);
    } catch (error) {
      if (error instanceof SignInUnavailable) {
        await sendServerPage(res, 503, 'signin_unavailable');
        return;
      }
      throw error;
    }
    if (!tokens) {
      await sendServerPage(res, 400, 'signin_error');
      return;
    }
    const claims = readClaims(tokens.idToken ?? tokens.accessToken);
    if (!claims || (claims.nonce !== null && claims.nonce !== attempt.nonce)) {
      await sendServerPage(res, 400, 'signin_error');
      return;
    }
    const accessClaims = readClaims(tokens.accessToken);
    if (!accessClaims) {
      await sendServerPage(res, 400, 'signin_error');
      return;
    }

    const user = await upsertUserFromClaims({
      ...accessClaims,
      email: accessClaims.email || claims.email,
      name: accessClaims.name || claims.name,
    });
    const sessionId = await createSession(user.id, tokens.accessToken, tokens.refreshToken);
    setCookie(res, SESSION_COOKIE, sessionId);
    clearCookie(res, LOGIN_COOKIE);

    const destination =
      attempt.return_to !== ''
        ? attempt.return_to
        : await landingRouteFor(user.id, user.roles);
    res.redirect(302, destination);
  }),
);

authRouter.post(
  '/auth/refresh',
  route(async (req, res) => {
    const sessionId = readCookie(req, SESSION_COOKIE);
    if (!sessionId) throw new ApiError(401, 'signed_out');
    const refreshToken = await sessionRefreshToken(sessionId);
    if (!refreshToken) throw new ApiError(401, 'signed_out');

    const tokens = await refreshTokens(refreshToken);
    if (!tokens) {
      await deleteSession(sessionId);
      clearCookie(res, SESSION_COOKIE);
      throw new ApiError(401, 'signed_out');
    }
    await refreshSessionRow(sessionId, tokens.accessToken, tokens.refreshToken);
    res.status(204).end();
  }),
);

authRouter.post(
  '/auth/logout',
  route(async (req, res) => {
    const sessionId = readCookie(req, SESSION_COOKIE);
    if (sessionId) {
      const refreshToken = await sessionRefreshToken(sessionId);
      if (refreshToken) await endSession(refreshToken);
      await deleteSession(sessionId);
    }
    clearCookie(res, SESSION_COOKIE);
    res.status(204).end();
  }),
);

authRouter.get(
  '/api/me',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    res.json({
      id: caller.user.id,
      email: caller.user.email,
      name: caller.user.name,
      roles: caller.user.roles,
    });
  }),
);

/** The route a role lands on after sign-in without a return route. */
authRouter.get(
  '/api/me/landing',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    res.json({ route: await landingRouteFor(caller.user.id, caller.user.roles) });
  }),
);

export { randomUUID };
