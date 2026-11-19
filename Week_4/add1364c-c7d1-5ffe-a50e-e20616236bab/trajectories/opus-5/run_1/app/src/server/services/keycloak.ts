import { config } from '../config.js';
import { ApiError } from '../errors.js';
import { copy } from '../copy.js';

const TIMEOUT_MS = 5_000;

export function signInUnavailable(): ApiError {
  return new ApiError(503, 'sign_in_unavailable', copy.signInUnavailable);
}

type TokenAnswer = { access_token: string; expires_in: number };

let cachedToken: { value: string; expiresAt: number } | null = null;

async function call(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${config.keycloak.url}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw signInUnavailable();
  }
}

async function adminToken(): Promise<string> {
  if (cachedToken !== null && cachedToken.expiresAt > Date.now() + 5_000) return cachedToken.value;
  const response = await call(`/realms/${config.keycloak.realm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.keycloak.clientId,
      client_secret: config.keycloak.clientSecret,
    }),
  });
  if (!response.ok) throw signInUnavailable();
  const answer = (await response.json()) as TokenAnswer;
  cachedToken = { value: answer.access_token, expiresAt: Date.now() + answer.expires_in * 1_000 };
  return answer.access_token;
}

async function admin(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await adminToken();
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
  };
  return call(`/admin/realms/${config.keycloak.realm}${path}`, { ...init, headers });
}

export function keycloakUsername(handle: string): string {
  return `${config.officeKey}.${handle}`;
}

export function keycloakEmail(handle: string): string {
  return `${config.officeKey}.${handle}@people.lockset.example`;
}

export function splitName(fullName: string): { firstName: string; lastName: string } {
  const words = fullName.trim().split(/\s+/);
  const first = words[0] ?? fullName;
  return { firstName: first, lastName: words.length > 1 ? words.slice(1).join(' ') : first };
}

export type CreateOutcome = { kind: 'created'; id: string } | { kind: 'exists' };

export async function createUser(input: {
  handle: string;
  fullName: string;
  password: string;
  enabled: boolean;
}): Promise<CreateOutcome> {
  const { firstName, lastName } = splitName(input.fullName);
  const response = await admin('/users', {
    method: 'POST',
    body: JSON.stringify({
      username: keycloakUsername(input.handle),
      firstName,
      lastName,
      email: keycloakEmail(input.handle),
      emailVerified: true,
      enabled: input.enabled,
      credentials: [{ type: 'password', value: input.password, temporary: false }],
    }),
  });
  if (response.status === 409) return { kind: 'exists' };
  if (response.status !== 201) throw signInUnavailable();
  const location = response.headers.get('location');
  const id = location === null ? null : (location.split('/').pop() ?? null);
  if (id === null) throw signInUnavailable();
  return { kind: 'created', id };
}

export async function findUserId(handle: string): Promise<string | null> {
  const username = keycloakUsername(handle);
  const response = await admin(`/users?exact=true&username=${encodeURIComponent(username)}`);
  if (!response.ok) throw signInUnavailable();
  const users = (await response.json()) as { id: string; username: string }[];
  return users.find((user) => user.username === username.toLowerCase() || user.username === username)?.id ?? null;
}

export async function setUserEnabled(userId: string, enabled: boolean): Promise<void> {
  const response = await admin(`/users/${userId}`, { method: 'PUT', body: JSON.stringify({ enabled }) });
  if (!response.ok && response.status !== 204) throw signInUnavailable();
}

export async function endUserSessions(userId: string): Promise<void> {
  const response = await admin(`/users/${userId}/logout`, { method: 'POST', body: JSON.stringify({}) });
  if (!response.ok && response.status !== 204) throw signInUnavailable();
}

export type PasswordGrant = 'ok' | 'bad_credentials' | 'account_disabled';

export async function checkPassword(handle: string, password: string): Promise<PasswordGrant> {
  const response = await call(`/realms/${config.keycloak.realm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: config.keycloak.clientId,
      client_secret: config.keycloak.clientSecret,
      username: keycloakUsername(handle),
      password,
      scope: 'openid',
    }),
  });
  if (response.ok) return 'ok';
  if (response.status === 401 || response.status === 400) {
    const body = (await response.json().catch(() => ({}))) as { error_description?: string };
    const reason = (body.error_description ?? '').toLowerCase();
    if (reason.includes('disabled')) return 'account_disabled';
    return 'bad_credentials';
  }
  throw signInUnavailable();
}
