import { randomBytes } from 'node:crypto';
import type { AppConfig } from './config.js';
import { AppError } from './errors.js';

export interface KeycloakUser {
  id: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  requiredActions?: string[];
  realmRoles?: string[];
  groups?: string[];
}

export interface KeycloakGroup {
  id: string;
  name: string;
}

const ROLE_NAMES = ['trader', 'builder', 'market_admin', 'org_owner', 'founder_operator'] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

export class KeycloakClient {
  private adminToken: { token: string; expiresAt: number } | null = null;

  constructor(private readonly config: AppConfig) {}

  private realmUrl(): string {
    return `${this.config.keycloak.url.replace(/\/$/, '')}/admin/realms/${this.config.keycloak.realm}`;
  }

  private issuerUrl(): string {
    return this.config.keycloak.issuerUrl.replace(/\/$/, '');
  }

  async serviceToken(): Promise<string> {
    if (this.adminToken && this.adminToken.expiresAt > Date.now() + 5000) {
      return this.adminToken.token;
    }
    const body = new URLSearchParams({
      client_id: this.config.keycloak.clientId,
      client_secret: this.config.keycloak.clientSecret,
      grant_type: 'client_credentials',
    });
    const res = await fetch(`${this.issuerUrl()}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new AppError(503, { error: 'sign_in_unavailable' });
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new AppError(503, { error: 'sign_in_unavailable' });
    this.adminToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 30) * 1000 };
    return this.adminToken.token;
  }

  private async adminFetch(path: string, init?: RequestInit): Promise<Response> {
    const token = await this.serviceToken();
    return fetch(this.realmUrl() + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  }

  async ensureRoles(): Promise<void> {
    for (const name of ROLE_NAMES) {
      const res = await this.adminFetch('/roles', { method: 'POST', body: JSON.stringify({ name }) });
      if (!res.ok && res.status !== 409) {
        throw new Error(`Could not ensure role ${name}: ${res.status}`);
      }
    }
  }

  async ensureVenueGroup(slug: string): Promise<KeycloakGroup> {
    const name = `venue-${slug}`;
    const existing = await this.adminFetch(`/groups?search=${encodeURIComponent(name)}&exact=true`);
    if (existing.ok) {
      const groups = (await existing.json()) as KeycloakGroup[];
      const found = groups.find((g) => g.name === name);
      if (found) return found;
    }
    const created = await this.adminFetch('/groups', { method: 'POST', body: JSON.stringify({ name }) });
    if (!created.ok && created.status !== 409) {
      throw new Error(`Could not create group ${name}: ${created.status}`);
    }
    const again = await this.adminFetch(`/groups?search=${encodeURIComponent(name)}&exact=true`);
    const groups = (await again.json()) as KeycloakGroup[];
    const found = groups.find((g) => g.name === name);
    if (!found) throw new Error(`Group ${name} missing after create`);
    return found;
  }

  async findUserByUsername(username: string): Promise<KeycloakUser | null> {
    const res = await this.adminFetch(`/users?username=${encodeURIComponent(username)}&exact=true`);
    if (!res.ok) throw new Error(`user lookup failed ${res.status}`);
    const users = (await res.json()) as KeycloakUser[];
    return users.find((u) => u.username === username) ?? null;
  }

  async findUserByEmail(email: string): Promise<KeycloakUser | null> {
    const res = await this.adminFetch(`/users?email=${encodeURIComponent(email)}&exact=true`);
    if (!res.ok) throw new Error(`user email lookup failed ${res.status}`);
    const users = (await res.json()) as KeycloakUser[];
    return users.find((u) => u.email === email) ?? null;
  }

  async createUser(user: {
    username: string;
    email: string;
    firstName?: string | undefined;
    lastName?: string | undefined;
    password?: string | undefined;
    roles: string[];
    groupName?: string | undefined;
    requiredActions?: string[] | undefined;
    emailVerified?: boolean | undefined;
  }): Promise<KeycloakUser> {
    const payload: Record<string, unknown> = {
      username: user.username,
      email: user.email,
      enabled: true,
      emailVerified: user.emailVerified ?? true,
      // Keycloak treats an account missing a name as "not fully set up", which
      // blocks the password grant, so every account carries at least a fallback.
      firstName: user.firstName ?? user.username,
      lastName: user.lastName ?? user.username,
    };
    if (user.requiredActions) payload['requiredActions'] = user.requiredActions;
    const created = await this.adminFetch('/users', { method: 'POST', body: JSON.stringify(payload) });
    if (!created.ok && created.status !== 409) {
      throw new Error(`Could not create user ${user.username}: ${created.status}`);
    }
    const location = created.headers.get('Location');
    const storedId = location?.split('/').pop() ?? '';
    let stored = storedId ? await this.getUser(storedId) : null;
    if (!stored) stored = await this.findUserByUsername(user.username);
    if (!stored) throw new Error(`User ${user.username} missing after create`);
    if (user.password) {
      const reset = await this.adminFetch(`/users/${stored.id}/reset-password`, {
        method: 'PUT',
        body: JSON.stringify({ type: 'password', value: user.password, temporary: false }),
      });
      if (!reset.ok) throw new Error(`Could not set password for ${user.username}: ${reset.status}`);
    }
    await this.assignRealmRoles(stored.id, user.roles);
    if (user.groupName) {
      const group = await this.ensureVenueGroup(user.groupName);
      await this.adminFetch(`/users/${stored.id}/groups/${group.id}`, { method: 'PUT' });
    }
    return stored;
  }

  async getUser(id: string): Promise<KeycloakUser | null> {
    const res = await this.adminFetch(`/users/${id}`);
    if (!res.ok) return null;
    return (await res.json()) as KeycloakUser;
  }

  async assignRealmRoles(userId: string, roles: string[]): Promise<void> {
    const mappings: Record<string, unknown>[] = [];
    for (const role of roles) {
      const res = await this.adminFetch(`/roles/${role}`);
      if (!res.ok) throw new Error(`Role ${role} missing`);
      // Keycloak resolves the mapping by role id, so the whole role object is sent.
      mappings.push(await res.json());
    }
    if (mappings.length > 0) {
      const res = await this.adminFetch(`/users/${userId}/role-mappings/realm`, {
        method: 'POST',
        body: JSON.stringify(mappings),
      });
      if (!res.ok) throw new Error(`role mapping failed ${res.status}`);
    }
  }

  async ensureRealmRoles(userId: string, roles: string[]): Promise<void> {
    const existing = await this.userRoles(userId).catch(() => [] as string[]);
    const missing = roles.filter((r) => !existing.includes(r));
    if (missing.length > 0) await this.assignRealmRoles(userId, missing);
  }

  async ensureUserGroup(userId: string, groupName: string): Promise<void> {
    const groups = await this.userGroups(userId);
    if (groups.some((g) => g.name === groupName)) return;
    const group = await this.ensureVenueGroup(groupName.replace(/^venue-/, ''));
    const res = await this.adminFetch(`/users/${userId}/groups/${group.id}`, { method: 'PUT' });
    if (!res.ok && res.status !== 404) throw new Error(`Could not join group ${groupName}: ${res.status}`);
  }

  async userGroups(userId: string): Promise<KeycloakGroup[]> {
    const res = await this.adminFetch(`/users/${userId}/groups`);
    if (!res.ok) throw new Error(`groups lookup failed ${res.status}`);
    return (await res.json()) as KeycloakGroup[];
  }

  async userRoles(userId: string): Promise<string[]> {
    const res = await this.adminFetch(`/users/${userId}/role-mappings/realm`);
    if (!res.ok) throw new Error(`role lookup failed ${res.status}`);
    const roles = (await res.json()) as { name: string }[];
    return roles.map((r) => r.name);
  }

  async userTokenInfo(accessToken: string): Promise<KeycloakUser> {
    const res = await fetch(`${this.issuerUrl()}/protocol/openid-connect/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new AppError(503, { error: 'sign_in_unavailable' });
    return (await res.json()) as KeycloakUser;
  }

  async passwordGrant(username: string, password: string): Promise<{ access_token: string; expires_in: number }> {
    const body = new URLSearchParams({
      client_id: this.config.keycloak.clientId,
      client_secret: this.config.keycloak.clientSecret,
      grant_type: 'password',
      username,
      password,
      scope: 'openid',
    });
    const res = await fetch(`${this.issuerUrl()}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new AppError(401, { error: 'invalid_credentials' });
    const data = (await res.json()) as { access_token: string; expires_in: number };
    if (!data.access_token) throw new AppError(401, { error: 'invalid_credentials' });
    return data;
  }

  async decodeTokenUser(accessToken: string): Promise<{ userId: string; username: string; roles: string[] }> {
    const parts = accessToken.split('.');
    if (parts.length !== 3) throw new AppError(503, { error: 'sign_in_unavailable' });
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64').toString('utf8')) as {
      sub: string;
      preferred_username?: string;
      realm_access?: { roles?: string[] };
      resource_access?: Record<string, { roles?: string[] }>;
    };
    const clientRoles = payload.resource_access?.[this.config.keycloak.clientId]?.roles ?? [];
    const realmRoles = payload.realm_access?.roles ?? [];
    return {
      userId: payload.sub,
      username: payload.preferred_username ?? '',
      roles: [...new Set([...realmRoles, ...clientRoles])],
    };
  }

  async setRequiredActions(userId: string, actions: string[]): Promise<void> {
    await this.adminFetch(`/users/${userId}`, { method: 'PUT', body: JSON.stringify({ requiredActions: actions }) });
  }

  async setUserPassword(userId: string, password: string): Promise<void> {
    const res = await this.adminFetch(`/users/${userId}/reset-password`, {
      method: 'PUT',
      body: JSON.stringify({ type: 'password', value: password, temporary: false }),
    });
    if (!res.ok) throw new Error(`Could not set password: ${res.status}`);
  }
}

export function randomApiSecret(): string {
  return randomBytes(20).toString('hex');
}
