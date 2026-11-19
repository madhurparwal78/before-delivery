import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { ProviderRefused, providerFetch, providerJson, reachable } from './http.js';
import { ROLES } from '../domain/types.js';
import type { Role } from '../domain/types.js';

const PROVIDER = 'keycloak';
const admin = `${config.keycloak.url}/admin/realms/${config.keycloak.realm}`;

interface TokenResponse {
  access_token: string;
  expires_in: number;
  id_token?: string;
}

let serviceToken: { value: string; expiresAt: number } | null = null;

async function tokenRequest(form: Record<string, string>): Promise<TokenResponse> {
  return providerJson<TokenResponse>(
    PROVIDER,
    `${config.keycloak.url}/realms/${config.keycloak.realm}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    },
  );
}

async function serviceAccountToken(): Promise<string> {
  if (serviceToken !== null && serviceToken.expiresAt > Date.now() + 5_000) return serviceToken.value;
  const token = await tokenRequest({
    grant_type: 'client_credentials',
    client_id: config.keycloak.clientId,
    client_secret: config.keycloak.clientSecret,
  });
  serviceToken = { value: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
  return token.access_token;
}

async function adminRequest<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = await serviceAccountToken();
  return providerJson<T>(PROVIDER, `${admin}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

async function adminCreate(path: string, body: unknown): Promise<string | null> {
  const token = await serviceAccountToken();
  const response = await providerFetch(PROVIDER, `${admin}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status === 409) return null;
  if (response.status >= 400) throw new ProviderRefused(PROVIDER, response.status, response.text);
  const location = response.headers.get('location');
  return location === null ? null : (location.split('/').pop() ?? null);
}

export interface AuthorizationRequest {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export function buildAuthorizationRequest(redirectUri: string): AuthorizationRequest {
  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const codeVerifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: config.keycloak.clientId,
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return {
    url: `${config.keycloak.issuerUrl}/protocol/openid-connect/auth?${query.toString()}`,
    state,
    nonce,
    codeVerifier,
  };
}

export interface Identity {
  keycloakUserId: string;
  username: string;
  email: string;
  displayName: string;
  roles: Role[];
}

function decodeClaims(jwt: string): Record<string, unknown> {
  const payload = jwt.split('.')[1];
  if (payload === undefined) throw new ProviderRefused(PROVIDER, 500, 'malformed token');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function identityFromToken(accessToken: string): Identity {
  const claims = decodeClaims(accessToken);
  const realmAccess = claims.realm_access as { roles?: string[] } | undefined;
  const granted = realmAccess?.roles ?? [];
  return {
    keycloakUserId: String(claims.sub),
    username: String(claims.preferred_username ?? ''),
    email: String(claims.email ?? ''),
    displayName: String(claims.name ?? claims.preferred_username ?? ''),
    roles: ROLES.filter((role) => granted.includes(role)),
  };
}

export async function exchangeCode(
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<Identity> {
  const token = await tokenRequest({
    grant_type: 'authorization_code',
    client_id: config.keycloak.clientId,
    client_secret: config.keycloak.clientSecret,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  return identityFromToken(token.access_token);
}

export class InvalidCredentials extends Error {}

export async function passwordGrant(username: string, password: string): Promise<Identity> {
  const response = await providerFetch(
    PROVIDER,
    `${config.keycloak.url}/realms/${config.keycloak.realm}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: config.keycloak.clientId,
        client_secret: config.keycloak.clientSecret,
        scope: 'openid profile email',
        username,
        password,
      }).toString(),
    },
  );
  if (response.status === 400 || response.status === 401) throw new InvalidCredentials();
  if (response.status >= 400) throw new ProviderRefused(PROVIDER, response.status, response.text);
  return identityFromToken((JSON.parse(response.text) as TokenResponse).access_token);
}

interface RealmRole {
  id: string;
  name: string;
}
interface RealmGroup {
  id: string;
  name: string;
}

export async function ensureRealmRoles(): Promise<void> {
  const existing = await adminRequest<RealmRole[]>('/roles?max=200');
  const names = new Set(existing.map((role) => role.name));
  for (const role of ROLES) {
    if (!names.has(role)) await adminCreate('/roles', { name: role });
  }
}

export async function ensureVenueGroup(slug: string): Promise<string> {
  const name = `venue-${slug}`;
  const found = await adminRequest<RealmGroup[]>(`/groups?search=${encodeURIComponent(name)}&max=50`);
  const match = found.find((group) => group.name === name);
  if (match !== undefined) return match.id;
  const created = await adminCreate('/groups', { name });
  if (created !== null) return created;
  const again = await adminRequest<RealmGroup[]>(`/groups?search=${encodeURIComponent(name)}&max=50`);
  const existing = again.find((group) => group.name === name);
  if (existing === undefined) throw new ProviderRefused(PROVIDER, 500, `group ${name} missing`);
  return existing.id;
}

export async function groupNamesOfUser(userId: string): Promise<string[]> {
  const groups = await adminRequest<RealmGroup[]>(`/users/${userId}/groups`);
  return groups.map((group) => group.name);
}

async function assignRoles(userId: string, roles: readonly Role[]): Promise<void> {
  const all = await adminRequest<RealmRole[]>('/roles?max=200');
  const wanted = all.filter((role) => roles.includes(role.name as Role));
  if (wanted.length > 0) await adminRequest(`/users/${userId}/role-mappings/realm`, { method: 'POST', body: wanted });
}

export interface UserSpec {
  username: string;
  email: string;
  displayName: string;
  roles: readonly Role[];
  venueSlug: string | null;
  password?: string;
  requireUpdatePassword?: boolean;
}

interface KeycloakUser {
  id: string;
  username: string;
  email?: string;
}

export async function findUserByUsername(username: string): Promise<KeycloakUser | null> {
  const users = await adminRequest<KeycloakUser[]>(
    `/users?username=${encodeURIComponent(username)}&exact=true`,
  );
  return users[0] ?? null;
}

/** Creates the user if missing; an existing user is left as it is. */
export async function ensureUser(spec: UserSpec): Promise<{ id: string; created: boolean }> {
  const existing = await findUserByUsername(spec.username);
  if (existing !== null) return { id: existing.id, created: false };

  const [firstName, ...rest] = spec.displayName.split(' ');
  const created = await adminCreate('/users', {
    username: spec.username,
    email: spec.email,
    emailVerified: true,
    enabled: true,
    firstName: firstName ?? spec.displayName,
    lastName: rest.join(' '),
    ...(spec.requireUpdatePassword === true ? { requiredActions: ['UPDATE_PASSWORD'] } : {}),
    ...(spec.password === undefined
      ? {}
      : { credentials: [{ type: 'password', value: spec.password, temporary: false }] }),
  });
  const id = created ?? (await findUserByUsername(spec.username))?.id;
  if (id === undefined) throw new ProviderRefused(PROVIDER, 500, `user ${spec.username} missing`);

  await assignRoles(id, spec.roles);
  if (spec.venueSlug !== null) {
    const groupId = await ensureVenueGroup(spec.venueSlug);
    await adminRequest(`/users/${id}/groups/${groupId}`, { method: 'PUT' });
  }
  return { id, created: true };
}

export async function setPassword(userId: string, password: string): Promise<void> {
  await adminRequest(`/users/${userId}/reset-password`, {
    method: 'PUT',
    body: { type: 'password', value: password, temporary: false },
  });
  await adminRequest(`/users/${userId}`, { method: 'PUT', body: { requiredActions: [] } });
}

export async function up(): Promise<boolean> {
  return reachable(PROVIDER, `${config.keycloak.url}/realms/${config.keycloak.realm}`);
}
