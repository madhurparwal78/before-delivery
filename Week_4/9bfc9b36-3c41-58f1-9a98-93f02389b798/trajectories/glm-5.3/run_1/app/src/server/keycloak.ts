import type { Config } from './config.ts';

export interface KcUser {
  id: string;
  email: string;
}

/**
 * Keycloak admin operations through the app client's service account. The client holds
 * realm-management manage-users, so creating and deleting users needs no master admin.
 */
export class Keycloak {
  private serviceToken: { token: string; expiresAt: number } | null = null;
  constructor(private readonly config: Config) {}

  private realmUrl(path: string): string {
    return `${this.config.keycloakUrl}/realms/${this.config.keycloakRealm}${path}`;
  }

  private adminUrl(path: string): string {
    return `${this.config.keycloakUrl}/admin/realms/${this.config.keycloakRealm}${path}`;
  }

  async passwordToken(email: string, password: string): Promise<{ access_token: string; expires_in: number }> {
    const res = await fetch(this.realmUrl('/protocol/openid-connect/token'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: this.config.authClientId,
        client_secret: this.config.authClientSecret,
        username: email,
        password,
        scope: 'openid email profile',
      }),
    });
    if (res.status === 401 || res.status === 400) {
      throw new KcError('bad_credentials');
    }
    if (!res.ok) throw new KcError('unreachable');
    return (await res.json()) as { access_token: string; expires_in: number };
  }

  private async serviceAccountToken(): Promise<string> {
    const now = Date.now();
    if (this.serviceToken && this.serviceToken.expiresAt > now + 5_000) return this.serviceToken.token;
    const res = await fetch(this.realmUrl('/protocol/openid-connect/token'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.authClientId,
        client_secret: this.config.authClientSecret,
      }),
    });
    if (!res.ok) throw new KcError('unreachable');
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.serviceToken = { token: body.access_token, expiresAt: now + body.expires_in * 1000 };
    return body.access_token;
  }

  async ensureRealmRoles(): Promise<void> {
    const token = await this.serviceAccountToken();
    const res = await fetch(this.adminUrl('/roles'), { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new KcError('unreachable');
    const roles = (await res.json()) as { name: string }[];
    for (const role of ['sailmaker', 'loft-hand', 'yacht-owner']) {
      if (roles.some((r) => r.name === role)) continue;
      const created = await fetch(this.adminUrl('/roles'), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: role }),
      });
      if (!created.ok) throw new KcError('unreachable');
    }
  }

  async findUserByEmail(email: string): Promise<KcUser | null> {
    const token = await this.serviceAccountToken();
    const res = await fetch(`${this.adminUrl('/users')}?email=${encodeURIComponent(email)}&exact=true`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new KcError('unreachable');
    const users = (await res.json()) as KcUser[];
    return users.find((u) => u.email === email) ?? null;
  }

  /** Create the user, or link an existing one, and set its password and realm role. */
  async ensureUser(email: string, password: string, role: string): Promise<KcUser> {
    const token = await this.serviceAccountToken();
    let user = await this.findUserByEmail(email);
    if (!user) {
      const created = await fetch(this.adminUrl('/users'), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        // firstName and lastName satisfy the realm's user profile policy; without them the
        // password grant answers "Account is not fully set up".
        body: JSON.stringify({ username: email, email, enabled: true, emailVerified: true, firstName: email.split('@')[0]!, lastName: role }),
      });
      if (created.status === 409) {
        user = await this.findUserByEmail(email);
        if (!user) throw new KcError('unreachable');
      } else if (!created.ok) {
        throw new KcError('unreachable');
      } else {
        const location = created.headers.get('location');
        if (!location) throw new KcError('unreachable');
        const id = location.split('/').pop()!;
        user = { id, email };
      }
    }
    // An existing user may still miss the names the realm's login policy needs.
    await fetch(this.adminUrl(`/users/${user.id}`), {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ firstName: email.split('@')[0]!, lastName: role }),
    });
    await fetch(this.adminUrl(`/users/${user.id}/reset-password`), {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'password', value: password, temporary: false }),
    });
    const roleRes = await fetch(this.adminUrl(`/users/${user.id}/role-mappings/realm`), {
      headers: { authorization: `Bearer ${token}` },
    });
    if (roleRes.ok) {
      const existing = (await roleRes.json()) as { name: string }[];
      const have = existing.map((r) => r.name);
      const wanted = ['default-roles-' + this.config.keycloakRealm, role].filter((r) => !have.includes(r));
      for (const name of wanted) {
        const rep = await fetch(this.adminUrl(`/roles/${encodeURIComponent(name)}`), {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!rep.ok) continue; // default-roles composite may 404 on some versions
        const roleRep = (await rep.json()) as { id: string; name: string };
        await fetch(this.adminUrl(`/users/${user.id}/role-mappings/realm`), {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify([roleRep]),
        });
      }
    } else {
      throw new KcError('unreachable');
    }
    return user;
  }

  async deleteUser(userId: string): Promise<void> {
    const token = await this.serviceAccountToken();
    const res = await fetch(this.adminUrl(`/users/${userId}`), {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 404) throw new KcError('unreachable');
  }

  async jwks(): Promise<unknown> {
    const res = await fetch(this.realmUrl('/protocol/openid-connect/certs'));
    if (!res.ok) throw new KcError('unreachable');
    return res.json();
  }
}

export class KcError extends Error {
  constructor(readonly kind: 'unreachable' | 'bad_credentials') {
    super(kind);
  }
}
