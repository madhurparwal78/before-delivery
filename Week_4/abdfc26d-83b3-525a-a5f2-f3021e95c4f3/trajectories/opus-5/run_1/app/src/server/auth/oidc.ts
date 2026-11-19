import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { config } from '../config.js';
import { query, transaction } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { grantDefaultRoles, realmRolesOfUser, userProfile } from './keycloakAdmin.js';
import { isAppRole, upsertUser, type AppRole, type Principal } from './identity.js';

const authorizationEndpoint = `${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/auth`;
const tokenEndpoint = `${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/token`;
const jwks = createRemoteJWKSet(
  new URL(`${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/certs`),
);

export const redirectUri = `${config.appPublicUrl}/auth/callback`;

/** Only in-app paths are followed after sign-in. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return '/';
  }
  return value;
}

export interface LoginRedirect {
  readonly url: string;
}

export async function beginLogin(returnTo: string): Promise<LoginRedirect> {
  const state = randomBytes(24).toString('base64url');
  const codeVerifier = randomBytes(48).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

  await query(
    'INSERT INTO auth_login_flows (state, code_verifier, return_to) VALUES ($1, $2, $3)',
    [state, codeVerifier, returnTo],
  );

  const params = new URLSearchParams({
    client_id: config.authClientId,
    response_type: 'code',
    scope: 'openid profile email',
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return { url: `${authorizationEndpoint}?${params.toString()}` };
}

interface KeycloakTokenSet {
  access_token: string;
}

interface AccessTokenClaims extends JWTPayload {
  azp?: string;
  preferred_username?: string;
  name?: string;
  email?: string;
  realm_access?: { roles?: string[] };
}

async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify<AccessTokenClaims>(token, jwks, {
    issuer: config.authIssuerUrl,
  });
  if (payload.azp !== config.authClientId) {
    throw ApiError.unauthenticated();
  }
  return payload;
}

async function principalFromClaims(claims: AccessTokenClaims): Promise<Principal> {
  const userId = claims.sub;
  if (!userId) throw ApiError.unauthenticated();

  let roles: AppRole[] = (claims.realm_access?.roles ?? []).filter(isAppRole);
  if (roles.length === 0) {
    roles = (await realmRolesOfUser(userId)).filter(isAppRole);
    if (roles.length === 0) {
      await grantDefaultRoles(userId);
      roles = (await realmRolesOfUser(userId)).filter(isAppRole);
    }
  }

  const profile = await userProfile(userId);
  const username = claims.preferred_username ?? profile?.username ?? userId;
  const displayName = profile?.displayName ?? claims.name ?? username;
  const email = profile?.email ?? claims.email ?? '';

  return transaction((client) =>
    upsertUser(client, { id: userId, username, displayName, email, roles }),
  );
}

export interface CompletedLogin {
  readonly principal: Principal;
  readonly returnTo: string;
}

export async function completeLogin(code: string, state: string): Promise<CompletedLogin> {
  const flow = await query<{ code_verifier: string; return_to: string }>(
    'DELETE FROM auth_login_flows WHERE state = $1 RETURNING code_verifier, return_to',
    [state],
  );
  const row = flow.rows[0];
  if (!row) throw ApiError.unauthenticated();

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.authClientId,
      client_secret: config.authClientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: row.code_verifier,
    }),
  });
  if (!response.ok) throw ApiError.unauthenticated();

  const tokens = (await response.json()) as KeycloakTokenSet;
  const claims = await verifyAccessToken(tokens.access_token);
  return { principal: await principalFromClaims(claims), returnTo: row.return_to };
}

export async function principalFromBearer(token: string): Promise<Principal> {
  const claims = await verifyAccessToken(token).catch(() => {
    throw ApiError.unauthenticated();
  });
  return principalFromClaims(claims);
}
