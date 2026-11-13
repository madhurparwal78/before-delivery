import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config.js';

export class IdentityUnreachable extends Error {}

export const staffRoles = ['maker', 'packer', 'treasurer'] as const;
export type StaffRole = (typeof staffRoles)[number];

const jwks = createRemoteJWKSet(new URL(`${config.keycloak.issuerUrl}/protocol/openid-connect/certs`), {
  cacheMaxAge: 24 * 60 * 60 * 1000,
  cooldownDuration: 5000,
});

const realmBase = `${config.keycloak.url}/admin/realms/${config.keycloak.realm}`;

async function serviceToken(): Promise<string> {
  const response = await fetch(`${config.keycloak.issuerUrl}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.keycloak.clientId,
      client_secret: config.keycloak.clientSecret,
    }),
  });
  if (!response.ok) throw new IdentityUnreachable(`identity ${response.status}`);
  const tokens = (await response.json()) as { access_token: string };
  return tokens.access_token;
}

async function admin(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const token = await serviceToken();
  const response = await fetch(`${realmBase}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
}

export interface SeededStaff {
  username: string;
  password: string;
  role: StaffRole;
}

/** Creates the realm roles and the seeded staff, idempotently, on every serve. */
export async function ensureRealm(staff: readonly SeededStaff[]): Promise<void> {
  for (const role of staffRoles) {
    const existing = await admin('GET', `/roles/${role}`);
    if (existing.status === 404) {
      await admin('POST', '/roles', { name: role });
    }
  }
  for (const person of staff) {
    const found = (await admin('GET', `/users?username=${person.username}&exact=true`)).body as
      | { id: string }[]
      | null;
    const profile = {
      username: person.username,
      enabled: true,
      emailVerified: true,
      firstName: person.username,
      lastName: 'Svovlstik',
      email: `${person.username}@svovlstik.example`,
      requiredActions: [],
    };
    let userId = found?.[0]?.id;
    if (userId === undefined) {
      await admin('POST', '/users', {
        ...profile,
        credentials: [{ type: 'password', value: person.password, temporary: false }],
      });
      const created = (await admin('GET', `/users?username=${person.username}&exact=true`)).body as {
        id: string;
      }[];
      userId = created[0]?.id;
    } else {
      await admin('PUT', `/users/${userId}`, profile);
    }
    if (userId === undefined) continue;
    const role = (await admin('GET', `/roles/${person.role}`)).body as { id: string; name: string };
    await admin('POST', `/users/${userId}/role-mappings/realm`, [{ id: role.id, name: role.name }]);
  }
}

export interface StaffIdentity {
  username: string;
  roles: StaffRole[];
}

function readRoles(claims: Record<string, unknown>): StaffRole[] {
  const realmAccess = claims.realm_access as { roles?: string[] } | undefined;
  const roles = realmAccess?.roles ?? [];
  return staffRoles.filter((role) => roles.includes(role));
}

export async function identityFromAccessToken(token: string): Promise<StaffIdentity | null> {
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: config.keycloak.issuerUrl });
    const claims = payload as Record<string, unknown>;
    return { username: String(claims.preferred_username ?? ''), roles: readRoles(claims) };
  } catch {
    return null;
  }
}

export async function identityUp(): Promise<boolean> {
  try {
    const response = await fetch(`${config.keycloak.issuerUrl}/.well-known/openid-configuration`);
    return response.ok;
  } catch {
    return false;
  }
}

export function authorizationUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: config.keycloak.clientId,
    response_type: 'code',
    scope: 'openid profile email',
    redirect_uri: redirectUri,
    state,
  });
  return `${config.keycloak.issuerUrl}/protocol/openid-connect/auth?${params.toString()}`;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<StaffIdentity> {
  let response: Response;
  try {
    response = await fetch(`${config.keycloak.issuerUrl}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.keycloak.clientId,
        client_secret: config.keycloak.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
  } catch (error) {
    throw new IdentityUnreachable(String(error));
  }
  if (!response.ok) throw new IdentityUnreachable(`identity ${response.status}`);
  const tokens = (await response.json()) as { access_token: string };
  const identity = await identityFromAccessToken(tokens.access_token);
  if (identity === null) throw new IdentityUnreachable('identity token refused');
  return identity;
}
