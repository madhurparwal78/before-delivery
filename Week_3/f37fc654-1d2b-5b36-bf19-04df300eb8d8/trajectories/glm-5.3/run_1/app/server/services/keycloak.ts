import type { Config } from '../config.js';

export interface KeycloakUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  realmRoles?: string[];
}

export interface SeededUser {
  name: string;
  email: string;
  password: string;
  role: 'producer' | 'client' | 'sponsor' | 'crew';
}

export const SEEDED_USERS: SeededUser[] = [
  { name: 'Mara Lind', email: 'mara@spindrift.test', password: 'Spindrift-Producer-26', role: 'producer' },
  { name: 'Theo Vance', email: 'theo@northwake.test', password: 'Northwake-Client-26', role: 'client' },
  { name: 'Priya Raman', email: 'priya@lumenhall.test', password: 'Lumenhall-Client-26', role: 'client' },
  { name: 'Jonah Reyes', email: 'jonah@crew.spindrift.test', password: 'Crew-Jonah-26', role: 'crew' },
  { name: 'Ama Boateng', email: 'ama@crew.spindrift.test', password: 'Crew-Ama-26', role: 'crew' },
];

export const REALM_ROLES = ['producer', 'client', 'sponsor', 'crew'];

interface TokenCache {
  token: string;
  expiresAt: number;
}

export class KeycloakAdmin {
  private tokenCache: TokenCache | null = null;
  private inflight: Promise<string> | null = null;

  constructor(private cfg: Config) {}

  async serviceToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt) return this.tokenCache.token;
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.cfg.authClientId,
        client_secret: this.cfg.authClientSecret,
      });
      const res = await fetch(`${this.cfg.keycloakUrl}/realms/${this.cfg.keycloakRealm}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) throw new Error(`keycloak token failed ${res.status}`);
      const json = (await res.json()) as { access_token: string; expires_in: number };
      this.tokenCache = { token: json.access_token, expiresAt: Date.now() + (json.expires_in - 30) * 1000 };
      return json.access_token;
    })();
    try {
      return await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  private async adminCall<T>(fn: (token: string) => Promise<T>): Promise<T> {
    const token = await this.serviceToken();
    return fn(token);
  }

  async available(): Promise<boolean> {
    try {
      const res = await fetch(`${this.cfg.keycloakUrl}/realms/${this.cfg.keycloakRealm}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async ensureRealmRoles(): Promise<void> {
    await this.adminCall(async (token) => {
      const existing = await this.get<{ id: string; name: string }[]>(token, '/admin/realms/' + this.cfg.keycloakRealm + '/roles');
      const have = new Set(existing.map((r) => r.name));
      for (const role of REALM_ROLES) {
        if (have.has(role)) continue;
        const res = await fetch(`${this.cfg.keycloakUrl}/admin/realms/${this.cfg.keycloakRealm}/roles`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ name: role }),
        });
        if (!res.ok && res.status !== 409) throw new Error(`role create failed ${res.status}`);
      }
    });
  }

  private async get<T>(token: string, path: string): Promise<T> {
    const res = await fetch(`${this.cfg.keycloakUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`kc get ${path} failed ${res.status}`);
    return (await res.json()) as T;
  }

  private async roleIds(token: string): Promise<Map<string, string>> {
    const roles = await this.get<{ id: string; name: string }[]>(token, `/admin/realms/${this.cfg.keycloakRealm}/roles`);
    return new Map(roles.filter((r) => REALM_ROLES.includes(r.name)).map((r) => [r.name, r.id]));
  }

  async ensureSeededUsers(): Promise<void> {
    await this.adminCall(async (token) => {
      const roleIds = await this.roleIds(token);
      for (const user of SEEDED_USERS) {
        const search = await fetch(`${this.cfg.keycloakUrl}/admin/realms/${this.cfg.keycloakRealm}/users?email=${encodeURIComponent(user.email)}&exact=true`, {
          headers: { authorization: `Bearer ${token}` },
        });
        const found = (await search.json()) as { id: string }[];
        let userId = found[0]?.id;
        if (!userId) {
          const [firstName, ...rest] = user.name.split(' ');
          const create = await fetch(`${this.cfg.keycloakUrl}/admin/realms/${this.cfg.keycloakRealm}/users`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              username: user.email,
              email: user.email,
              firstName,
              lastName: rest.join(' '),
              enabled: true,
              emailVerified: true,
            }),
          });
          if (create.status !== 201 && create.status !== 409) throw new Error(`user create failed ${create.status}`);
          const loc = create.headers.get('location');
          const again = await fetch(`${this.cfg.keycloakUrl}/admin/realms/${this.cfg.keycloakRealm}/users?email=${encodeURIComponent(user.email)}&exact=true`, {
            headers: { authorization: `Bearer ${token}` },
          });
          const list = (await again.json()) as { id: string }[];
          userId = loc?.split('/').pop() ?? list[0]?.id;
          if (!userId) throw new Error('user id not found after create');
        }
        const roleId = roleIds.get(user.role);
        if (roleId) {
          await fetch(`${this.cfg.keycloakUrl}/admin/realms/${this.cfg.keycloakRealm}/users/${userId}/role-mappings/realm`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify([{ id: roleId, name: user.role }]),
          });
        }
        // Reset credentials only when the user cannot sign in with the seed password.
        const ok = await this.canAuthenticate(user.email, user.password);
        if (!ok) {
          await fetch(`${this.cfg.keycloakUrl}/admin/realms/${this.cfg.keycloakRealm}/users/${userId}/reset-password`, {
            method: 'PUT',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'password', value: user.password, temporary: false }),
          });
        }
      }
    });
  }

  /** Direct grant probe: verifies a user's password works. */
  async canAuthenticate(email: string, password: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.cfg.keycloakUrl}/realms/${this.cfg.keycloakRealm}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'password', client_id: this.cfg.authClientId, username: email, password }),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async findUserByEmail(email: string): Promise<{ id: string } | null> {
    const token = await this.serviceToken();
    const res = await fetch(
      `${this.cfg.keycloakUrl}/admin/realms/${this.cfg.keycloakRealm}/users?email=${encodeURIComponent(email)}&exact=true`,
      { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    const list = (await res.json()) as Array<{ id: string }>;
    return list[0] ?? null;
  }

  async ensureRole(userId: string, role: 'client' | 'sponsor'): Promise<void> {
    await this.adminCall(async (token) => {
      const roleIds = await this.roleIds(token);
      const roleId = roleIds.get(role);
      if (!roleId) return;
      await fetch(`${this.cfg.keycloakUrl}/admin/realms/${this.cfg.keycloakRealm}/users/${userId}/role-mappings/realm`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify([{ id: roleId, name: role }]),
      });
    });
  }
}
