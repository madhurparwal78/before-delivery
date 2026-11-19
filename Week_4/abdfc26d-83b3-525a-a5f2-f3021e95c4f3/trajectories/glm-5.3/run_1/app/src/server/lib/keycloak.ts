import { config } from '../../config.js';
import { fetchWithTimeout } from './http.js';

export interface KcUser {
  id: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  emailVerified: boolean;
  requiredActions?: string[];
}

export interface KcRole { id: string; name: string }

const adminToken = async (): Promise<string> => {
  const body = new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: process.env.KC_BOOTSTRAP_ADMIN_USERNAME ?? 'admin', password: process.env.KC_BOOTSTRAP_ADMIN_PASSWORD ?? 'admin' });
  const res = await fetchWithTimeout(
    `${config.keycloakUrl}/realms/master/protocol/openid-connect/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() },
    15_000
  );
  if (res.status !== 200) throw new Error('keycloak_admin_login_failed');
  return (JSON.parse(res.body) as { access_token: string }).access_token;
};

const api = async (path: string, init: RequestInit): Promise<{ status: number; body: string }> => {
  const token = await adminToken();
  return fetchWithTimeout(
    `${config.keycloakUrl}/admin/realms/${config.keycloakRealm}${path}`,
    { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } },
    15_000
  );
};

export class KeycloakAdmin {
  async ensureRoles(): Promise<void> {
    const res = await api('/roles', { method: 'GET' });
    if (res.status !== 200) throw new Error('keycloak_roles_read_failed');
    const roles = JSON.parse(res.body) as KcRole[];
    for (const name of ['creator', 'collector', 'founder-operator']) {
      if (!roles.some((r) => r.name === name)) {
        await api('/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description: `Phosphene Yard ${name}` }) });
      }
    }
  }

  async ensureUser(username: string, email: string, password: string, displayName: string, roles: string[]): Promise<string> {
    const search = await api(`/users?username=${encodeURIComponent(username)}&exact=true`, { method: 'GET' });
    let userId: string;
    if (search.status === 200) {
      const found = JSON.parse(search.body) as KcUser[];
      if (found.length > 0) {
        userId = found[0].id;
        await api(`/users/${userId}/reset-password`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'password', value: password, temporary: false }) }).catch(() => null);
      } else {
        userId = await this.createUser(username, email, password, displayName);
      }
    } else {
      userId = await this.createUser(username, email, password, displayName);
    }
    for (const roleName of roles) {
      const roleRes = await api(`/roles/${roleName}`, { method: 'GET' });
      if (roleRes.status !== 200) continue;
      const mapping = JSON.parse(roleRes.body) as KcRole;
      await api(`/users/${userId}/role-mappings/realm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ id: mapping.id, name: mapping.name }]) });
    }
    return userId;
  }

  private async createUser(username: string, email: string, password: string, displayName: string): Promise<string> {
    const created = await api('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, enabled: true, emailVerified: true, firstName: displayName.split(' ')[0], lastName: displayName.split(' ').slice(1).join(' ') })
    });
    if (created.status !== 201) throw new Error(`keycloak_user_create_failed ${created.status} ${created.body}`);
    const search = await api(`/users?username=${encodeURIComponent(username)}&exact=true`, { method: 'GET' });
    if (search.status !== 200) throw new Error('keycloak_user_read_failed');
    const found = JSON.parse(search.body) as KcUser[];
    if (found.length === 0) throw new Error('keycloak_user_missing');
    await api(`/users/${found[0].id}/reset-password`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'password', value: password, temporary: false }) });
    return found[0].id;
  }

  async probe(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${config.keycloakUrl}/realms/${config.keycloakRealm}/.well-known/openid-configuration`, { method: 'GET' }, 5_000);
      return res.status === 200;
    } catch {
      return false;
    }
  }
}
