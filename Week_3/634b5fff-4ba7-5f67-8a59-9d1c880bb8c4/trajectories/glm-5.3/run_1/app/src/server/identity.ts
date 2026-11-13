import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from './config.js';

export class IdentityDown extends Error {}

export interface StaffIdentity { username: string; roles: string[] }

interface TokenCache { token: string; expiresAt: number }
let serviceToken: TokenCache | null = null;

async function serviceAccountToken(): Promise<string> {
  if (serviceToken && serviceToken.expiresAt > Date.now() + 5_000) return serviceToken.token;
  const tokenUrl = `${config.keycloak.url}/realms/${config.keycloak.realm}/protocol/openid-connect/token`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.keycloak.clientId,
        client_secret: config.keycloak.clientSecret,
      }).toString(),
      signal: controller.signal,
    });
    if (!res.ok) throw new IdentityDown(`service token ${res.status}`);
    const body = await res.json() as { access_token: string; expires_in: number };
    serviceToken = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  } catch (err) {
    serviceToken = null;
    if (err instanceof IdentityDown) throw err;
    throw new IdentityDown(String(err));
  } finally {
    clearTimeout(timer);
  }
}

async function admin(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const token = await serviceAccountToken();
  const res = await fetch(`${config.keycloak.url}/admin/realms/${config.keycloak.realm}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

export const STAFF_ROLES = ['maker', 'packer', 'treasurer'] as const;
export const STAFF_SEED = [
  { username: 'maker', password: 'Maker-Press-2026!', role: 'maker' },
  { username: 'packer', password: 'Packer-Press-2026!', role: 'packer' },
  { username: 'treasurer', password: 'Treasurer-Press-2026!', role: 'treasurer' },
] as const;

/** Create realm roles and seeded staff idempotently. */
export async function provisionRealm(): Promise<void> {
  for (const role of STAFF_ROLES) {
    const res = await admin('POST', '/roles', { name: role });
    if (res.status !== 201 && res.status !== 409) {
      throw new IdentityDown(`role create ${res.status}`);
    }
  }
  for (const person of STAFF_SEED) {
    const found = await admin('GET', `/users?username=${encodeURIComponent(person.username)}&exact=true`);
    let userId: string | null = null;
    const profile = {
      username: person.username,
      enabled: true,
      email: `${person.username}@svovlstik.example`,
      emailVerified: true,
      firstName: person.username.charAt(0).toUpperCase() + person.username.slice(1),
      lastName: 'Press',
      requiredActions: [],
      credentials: [{ type: 'password', value: person.password, temporary: false }],
    };
    if (Array.isArray(found.body) && found.body.length > 0) {
      userId = found.body[0].id;
      await admin('PUT', `/users/${userId}`, profile);
      await admin('PUT', `/users/${userId}/reset-password`, { type: 'password', value: person.password, temporary: false });
    } else {
      const created = await admin('POST', '/users', profile);
      if (created.status !== 201 && created.status !== 409) throw new IdentityDown(`user create ${created.status}`);
      const again = await admin('GET', `/users?username=${encodeURIComponent(person.username)}&exact=true`);
      if (Array.isArray(again.body) && again.body.length > 0) userId = again.body[0].id;
    }
    if (!userId) continue;
    const realmRoles = await admin('GET', '/users/' + userId + '/realmRoles');
    const have = new Set<string>(Array.isArray(realmRoles.body) ? realmRoles.body.map((r: { name: string }) => r.name) : []);
    if (!have.has(person.role)) {
      const roleDefs = await admin('GET', `/roles/${person.role}`);
      if (roleDefs.status === 200) {
        await admin('POST', `/users/${userId}/role-mappings/realm`, [roleDefs.body]);
      }
    }
  }
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksUrl: string | null = null;

async function verifyToken(token: string): Promise<StaffIdentity | null> {
  const issuer = config.keycloak.issuerUrl;
  if (!issuer) return null;
  const url = `${issuer.replace(/\/$/, '')}/protocol/openid-connect/certs`;
  if (!jwks || jwksUrl !== url) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksUrl = url;
  }
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer });
    const roles = ((payload as { realm_access?: { roles?: string[] } }).realm_access?.roles ?? []) as string[];
    return { username: String(payload.preferred_username ?? payload.sub ?? ''), roles };
  } catch {
    return null;
  }
}

export async function identityFromToken(token: string | undefined): Promise<StaffIdentity | null> {
  if (!token) return null;
  return verifyToken(token);
}
