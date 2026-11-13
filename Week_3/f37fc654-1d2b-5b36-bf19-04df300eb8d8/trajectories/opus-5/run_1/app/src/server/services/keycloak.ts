import { createPublicKey, createVerify } from 'node:crypto';
import { env } from '../env.js';
import { APP_ROLES, SEED_USERS, type AppRole } from '../../shared/seed.js';

/** Sign-in goes through Keycloak; the app never holds a password of its own. */

export class SignInUnavailable extends Error {}

const realmBase = `${env.keycloakUrl}/realms/${env.keycloakRealm}`;
const adminBase = `${env.keycloakUrl}/admin/realms/${env.keycloakRealm}`;

export const oidc = {
  authorizationEndpoint: `${realmBase}/protocol/openid-connect/auth`,
  tokenEndpoint: `${realmBase}/protocol/openid-connect/token`,
  logoutEndpoint: `${realmBase}/protocol/openid-connect/logout`,
  jwksUri: `${realmBase}/protocol/openid-connect/certs`,
  issuer: env.authIssuerUrl,
};

async function request(url: string, init: RequestInit, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw new SignInUnavailable(String(error));
  } finally {
    clearTimeout(timer);
  }
}

export async function signInIsUp(): Promise<boolean> {
  try {
    const res = await request(`${realmBase}/.well-known/openid-configuration`, {}, 3_000);
    return res.ok;
  } catch {
    return false;
  }
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  idToken: string | null;
}

function readTokenSet(json: Record<string, unknown>): TokenSet {
  return {
    accessToken: String(json['access_token'] ?? ''),
    refreshToken: String(json['refresh_token'] ?? ''),
    expiresInSeconds: Number(json['expires_in'] ?? 300),
    idToken: json['id_token'] === undefined ? null : String(json['id_token']),
  };
}

/** Exchange an authorization code, proving possession of the attempt's verifier. */
export async function exchangeCode(code: string, codeVerifier: string): Promise<TokenSet | null> {
  const res = await request(oidc.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${env.publicUrl}/auth/callback`,
      client_id: env.authClientId,
      client_secret: env.authClientSecret,
      code_verifier: codeVerifier,
    }).toString(),
  });
  if (!res.ok) return null;
  return readTokenSet((await res.json()) as Record<string, unknown>);
}

export async function refreshTokens(refreshToken: string): Promise<TokenSet | null> {
  const res = await request(oidc.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: env.authClientId,
      client_secret: env.authClientSecret,
    }).toString(),
  });
  if (!res.ok) return null;
  return readTokenSet((await res.json()) as Record<string, unknown>);
}

export async function endSession(refreshToken: string): Promise<void> {
  await request(oidc.logoutEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.authClientId,
      client_secret: env.authClientSecret,
      refresh_token: refreshToken,
    }).toString(),
  }).catch(() => undefined);
}

export interface TokenClaims {
  sub: string;
  email: string;
  name: string;
  roles: AppRole[];
  nonce: string | null;
  expiresAt: number;
}

function decodeSegment(segment: string): Record<string, unknown> {
  const padded = segment.padEnd(segment.length + ((4 - (segment.length % 4)) % 4), '=');
  return JSON.parse(Buffer.from(padded, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function claimsFrom(payload: Record<string, unknown>): TokenClaims {
  const realmAccess = payload['realm_access'] as { roles?: string[] } | undefined;
  const roles = (realmAccess?.roles ?? []).filter((r): r is AppRole =>
    (APP_ROLES as readonly string[]).includes(r),
  );
  const email = String(payload['email'] ?? '');
  return {
    sub: String(payload['sub'] ?? ''),
    email,
    name: String(payload['name'] ?? payload['preferred_username'] ?? email),
    roles,
    nonce: payload['nonce'] === undefined ? null : String(payload['nonce']),
    expiresAt: Number(payload['exp'] ?? 0) * 1000,
  };
}

/** Read the claims of a token the app itself obtained from Keycloak. */
export function readClaims(accessToken: string): TokenClaims | null {
  const parts = accessToken.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    return claimsFrom(decodeSegment(parts[1]));
  } catch {
    return null;
  }
}

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;

async function jwks(): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < 300_000) return jwksCache.keys;
  const res = await request(oidc.jwksUri, {});
  if (!res.ok) throw new SignInUnavailable(`jwks ${res.status}`);
  const json = (await res.json()) as { keys?: Jwk[] };
  jwksCache = { keys: json.keys ?? [], fetchedAt: Date.now() };
  return jwksCache.keys;
}

const ALGORITHMS: Record<string, string> = {
  RS256: 'RSA-SHA256',
  RS384: 'RSA-SHA384',
  RS512: 'RSA-SHA512',
};

/**
 * Verify a bearer token presented by a caller: signature against the realm's
 * keys, issuer and expiry.
 */
export async function verifyAccessToken(token: string): Promise<TokenClaims | null> {
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  if (!headerPart || !payloadPart || !signaturePart) return null;
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decodeSegment(headerPart);
    payload = decodeSegment(payloadPart);
  } catch {
    return null;
  }
  const algorithm = ALGORITHMS[String(header['alg'])];
  if (!algorithm) return null;
  const key = (await jwks()).find((k) => k.kid === String(header['kid']) && k.kty === 'RSA');
  if (!key?.n || !key.e) return null;

  const publicKey = createPublicKey({
    key: { kty: 'RSA', n: key.n, e: key.e },
    format: 'jwk',
  });
  const verifier = createVerify(algorithm);
  verifier.update(`${headerPart}.${payloadPart}`);
  if (!verifier.verify(publicKey, Buffer.from(signaturePart, 'base64url'))) return null;

  if (String(payload['iss']) !== oidc.issuer) return null;
  const claims = claimsFrom(payload);
  if (claims.expiresAt <= Date.now()) return null;
  return claims;
}

async function serviceToken(): Promise<string> {
  const res = await request(oidc.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.authClientId,
      client_secret: env.authClientSecret,
    }).toString(),
  });
  if (!res.ok) throw new SignInUnavailable(`service token ${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new SignInUnavailable('service token missing');
  return json.access_token;
}

async function admin(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<Response> {
  const bearer = token ?? (await serviceToken());
  return request(`${adminBase}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

interface KeycloakUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

async function ensureRealmRole(name: string, token: string): Promise<void> {
  const existing = await admin(`/roles/${encodeURIComponent(name)}`, {}, token);
  if (existing.ok) return;
  await admin('/roles', { method: 'POST', body: JSON.stringify({ name }) }, token);
}

async function findUserByUsername(username: string, token: string): Promise<KeycloakUser | null> {
  const res = await admin(
    `/users?username=${encodeURIComponent(username)}&exact=true`,
    {},
    token,
  );
  if (!res.ok) return null;
  const users = (await res.json()) as KeycloakUser[];
  return users[0] ?? null;
}

async function grantRealmRole(userId: string, role: AppRole, token: string): Promise<void> {
  const roleRes = await admin(`/roles/${encodeURIComponent(role)}`, {}, token);
  if (!roleRes.ok) return;
  const roleJson = (await roleRes.json()) as { id: string; name: string };
  await admin(
    `/users/${userId}/role-mappings/realm`,
    { method: 'POST', body: JSON.stringify([{ id: roleJson.id, name: roleJson.name }]) },
    token,
  );
}

/** Give a first-time self-registered user the client role. */
export async function ensureClientRole(keycloakSub: string): Promise<void> {
  const token = await serviceToken();
  await grantRealmRole(keycloakSub, 'client', token);
}

/** Accepting an invite gives the account the sponsor role. */
export async function ensureSponsorRole(keycloakSub: string): Promise<void> {
  const token = await serviceToken();
  await grantRealmRole(keycloakSub, 'sponsor', token);
}

/**
 * Keycloak refuses brackets in a person's name, so the account carries the
 * plain person name while the app keeps the published display name.
 */
function personNameParts(name: string): { firstName: string; lastName: string } {
  const plain = name.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  const [firstName, ...rest] = plain.split(/\s+/);
  return { firstName: firstName ?? plain, lastName: rest.join(' ') };
}

/**
 * Ensure the four realm roles and the seeded accounts exist. Runs on every
 * start until it succeeds.
 */
export async function ensureRealmSetup(): Promise<void> {
  const token = await serviceToken();
  for (const role of APP_ROLES) {
    await ensureRealmRole(role, token);
  }
  for (const seed of SEED_USERS) {
    let user = await findUserByUsername(seed.email, token);
    if (!user) {
      const { firstName, lastName } = personNameParts(seed.name);
      const created = await admin(
        '/users',
        {
          method: 'POST',
          body: JSON.stringify({
            username: seed.email,
            email: seed.email,
            firstName,
            lastName,
            enabled: true,
            emailVerified: true,
            credentials: [{ type: 'password', value: seed.password, temporary: false }],
          }),
        },
        token,
      );
      if (!created.ok && created.status !== 409) {
        throw new SignInUnavailable(`create user ${seed.email} ${created.status}`);
      }
      user = await findUserByUsername(seed.email, token);
    }
    if (user) await grantRealmRole(user.id, seed.role, token);
  }
}

