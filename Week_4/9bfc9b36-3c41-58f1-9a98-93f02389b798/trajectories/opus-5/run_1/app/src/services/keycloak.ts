import { createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';
import { config } from '../config';

/**
 * The one place that talks to Keycloak. The browser never talks to it directly:
 * sign-in goes through the password grant of client AUTH_CLIENT_ID.
 */

export class IdentityUnreachable extends Error {
  constructor(cause: string) {
    super(`The identity provider did not answer: ${cause}`);
    this.name = 'IdentityUnreachable';
  }
}

export type RealmRole = 'sailmaker' | 'loft-hand' | 'yacht-owner';
export const REALM_ROLES: readonly RealmRole[] = ['sailmaker', 'loft-hand', 'yacht-owner'];

const TIMEOUT_MS = 5000;

async function call(path: string, init: RequestInit & { admin?: boolean } = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { ...((init.headers as Record<string, string>) ?? {}) };
    if (init.admin !== false) headers['authorization'] = `Bearer ${await adminToken()}`;
    return await fetch(`${config.keycloakUrl}${path}`, { ...init, headers, signal: controller.signal });
  } catch (cause) {
    throw new IdentityUnreachable(cause instanceof Error ? cause.message : 'unknown');
  } finally {
    clearTimeout(timer);
  }
}

let cachedAdminToken: { token: string; expiresAt: number } | null = null;

async function adminToken(): Promise<string> {
  const now = Date.now();
  if (cachedAdminToken && cachedAdminToken.expiresAt > now + 5000) return cachedAdminToken.token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.authClientId,
        client_secret: config.authClientSecret,
      }).toString(),
      signal: controller.signal,
    });
  } catch (cause) {
    throw new IdentityUnreachable(cause instanceof Error ? cause.message : 'unknown');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new IdentityUnreachable(`client credentials answered ${response.status}`);
  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (typeof body.access_token !== 'string') throw new IdentityUnreachable('client credentials gave no token');
  cachedAdminToken = {
    token: body.access_token,
    expiresAt: now + (body.expires_in ?? 60) * 1000,
  };
  return cachedAdminToken.token;
}

export interface SignedInTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
}

async function tokenGrant(form: Readonly<Record<string, string>>): Promise<SignedInTokens | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.authClientId,
        client_secret: config.authClientSecret,
        ...form,
      }).toString(),
      signal: controller.signal,
    });
  } catch (cause) {
    throw new IdentityUnreachable(cause instanceof Error ? cause.message : 'unknown');
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 401 || response.status === 400) {
    await response.text();
    return null;
  }
  if (!response.ok) throw new IdentityUnreachable(`token grant answered ${response.status}`);
  const body = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') {
    throw new IdentityUnreachable('token grant gave no token');
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresIn: body.expires_in ?? 300,
  };
}

/** The password grant. Wrong credentials give null; an unreachable realm throws. */
export async function signIn(email: string, password: string): Promise<SignedInTokens | null> {
  return tokenGrant({ grant_type: 'password', username: email, password, scope: 'openid' });
}

/** The refresh grant, behind `GET /api/session`. */
export async function refreshAccessToken(refreshToken: string): Promise<SignedInTokens | null> {
  return tokenGrant({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

interface JsonWebKey {
  readonly kid: string;
  readonly kty: string;
  readonly alg?: string;
  readonly use?: string;
}

let keyCache: { keys: Map<string, KeyObject>; fetchedAt: number } | null = null;
const KEY_CACHE_MS = 300000;

async function realmKeys(force: boolean): Promise<Map<string, KeyObject>> {
  const now = Date.now();
  if (!force && keyCache && now - keyCache.fetchedAt < KEY_CACHE_MS) return keyCache.keys;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${config.authIssuerUrl}/protocol/openid-connect/certs`, { signal: controller.signal });
  } catch (cause) {
    throw new IdentityUnreachable(cause instanceof Error ? cause.message : 'unknown');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new IdentityUnreachable(`jwks answered ${response.status}`);
  const body = (await response.json()) as { keys?: readonly JsonWebKey[] };
  const keys = new Map<string, KeyObject>();
  for (const jwk of body.keys ?? []) {
    if (jwk.kty !== 'RSA') continue;
    try {
      keys.set(jwk.kid, createPublicKey({ key: jwk as never, format: 'jwk' }));
    } catch {
      continue;
    }
  }
  keyCache = { keys, fetchedAt: now };
  return keys;
}

/** A quick liveness probe, also used to keep the realm keys fresh. */
export async function probeIdentity(): Promise<void> {
  await realmKeys(true);
}

export interface TokenSubject {
  readonly subject: string;
}

/**
 * Checks a bearer access token against the realm's published keys, along with
 * its issuer, its client and its expiry. A token that fails any of these is not
 * a caller: the refusal is the same for every reason.
 */
export async function verifyAccessToken(token: string): Promise<TokenSubject | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  let header: { alg?: unknown; kid?: unknown };
  let payload: { iss?: unknown; exp?: unknown; sub?: unknown; azp?: unknown; aud?: unknown };
  try {
    header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as typeof header;
    payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as typeof payload;
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;

  let keys = await realmKeys(false);
  let key = keys.get(header.kid);
  if (!key) {
    keys = await realmKeys(true);
    key = keys.get(header.kid);
  }
  if (!key) return null;

  const signature = Buffer.from(signaturePart, 'base64url');
  if (signature.length === 0) return null;
  const signed = Buffer.from(`${headerPart}.${payloadPart}`, 'utf8');
  if (!verifySignature('RSA-SHA256', signed, key, signature)) return null;

  if (payload.iss !== config.authIssuerUrl) return null;
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return null;
  if (typeof payload.sub !== 'string' || payload.sub === '') return null;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.azp !== config.authClientId && !audiences.includes(config.authClientId)) return null;
  return { subject: payload.sub };
}

const realmPath = `/admin/realms/${config.keycloakRealm}`;

export async function ensureRealmRoles(): Promise<void> {
  const response = await call(`${realmPath}/roles`);
  if (!response.ok) throw new IdentityUnreachable(`roles answered ${response.status}`);
  const existing = (await response.json()) as readonly { name: string }[];
  const have = new Set(existing.map((role) => role.name));
  for (const role of REALM_ROLES) {
    if (have.has(role)) continue;
    const made = await call(`${realmPath}/roles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: role }),
    });
    if (!made.ok && made.status !== 409) throw new IdentityUnreachable(`role create answered ${made.status}`);
    await made.text();
  }
}

export async function findUserIdByEmail(email: string): Promise<string | null> {
  const response = await call(`${realmPath}/users?exact=true&email=${encodeURIComponent(email)}`);
  if (!response.ok) throw new IdentityUnreachable(`user search answered ${response.status}`);
  const found = (await response.json()) as readonly { id: string; email?: string }[];
  const match = found.find((user) => (user.email ?? '').toLowerCase() === email.toLowerCase());
  return match ? match.id : null;
}

async function assignRealmRole(userId: string, role: RealmRole): Promise<void> {
  const lookup = await call(`${realmPath}/roles/${encodeURIComponent(role)}`);
  if (!lookup.ok) throw new IdentityUnreachable(`role lookup answered ${lookup.status}`);
  const representation = (await lookup.json()) as { id: string; name: string };
  const response = await call(`${realmPath}/users/${encodeURIComponent(userId)}/role-mappings/realm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([{ id: representation.id, name: representation.name }]),
  });
  if (!response.ok) throw new IdentityUnreachable(`role mapping answered ${response.status}`);
  await response.text();
}

async function setPassword(userId: string, password: string): Promise<void> {
  const response = await call(`${realmPath}/users/${encodeURIComponent(userId)}/reset-password`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'password', value: password, temporary: false }),
  });
  if (!response.ok) throw new IdentityUnreachable(`reset password answered ${response.status}`);
  await response.text();
}

/**
 * The realm's user profile wants both given and family names, so a display name
 * is split for Keycloak only. Postgres stays the system of record for the name.
 */
function splitName(displayName: string): { firstName: string; lastName: string } {
  const space = displayName.indexOf(' ');
  if (space === -1) return { firstName: displayName, lastName: displayName };
  return { firstName: displayName.slice(0, space), lastName: displayName.slice(space + 1) };
}

/**
 * Makes sure the realm holds a user for this account, with its realm role and
 * the given password. An existing user with that email is linked, not duplicated.
 */
export async function ensureUser(
  email: string,
  displayName: string,
  role: RealmRole,
  password: string,
): Promise<string> {
  const existingId = await findUserIdByEmail(email);
  let userId = existingId;
  if (userId !== null) {
    const repaired = await call(`${realmPath}/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        ...splitName(displayName),
        enabled: true,
        emailVerified: true,
        requiredActions: [],
      }),
    });
    if (!repaired.ok) throw new IdentityUnreachable(`user update answered ${repaired.status}`);
    await repaired.text();
  }
  if (userId === null) {
    const created = await call(`${realmPath}/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: email,
        email,
        ...splitName(displayName),
        enabled: true,
        emailVerified: true,
        requiredActions: [],
        credentials: [{ type: 'password', value: password, temporary: false }],
      }),
    });
    if (created.status === 409) {
      await created.text();
      userId = await findUserIdByEmail(email);
    } else if (created.ok) {
      await created.text();
      userId = await findUserIdByEmail(email);
    } else {
      throw new IdentityUnreachable(`user create answered ${created.status}`);
    }
    if (userId === null) throw new IdentityUnreachable('user create left no user');
  }
  await setPassword(userId, password);
  await assignRealmRole(userId, role);
  return userId;
}

export async function deleteUser(userId: string): Promise<void> {
  const response = await call(`${realmPath}/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) {
    throw new IdentityUnreachable(`user delete answered ${response.status}`);
  }
  await response.text();
}
