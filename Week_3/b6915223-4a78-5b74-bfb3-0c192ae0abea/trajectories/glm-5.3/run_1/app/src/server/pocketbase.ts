import type { Config } from './config';
import { ApiError } from './errors';

interface PocketBaseUser {
  id: string;
  email: string;
  name: string;
}

interface PocketBaseAdminToken {
  token: string;
}

export interface PocketBaseUserView {
  id: string;
  email: string;
  name: string;
}

export class PocketBaseClient {
  private adminToken: string | null = null;
  private readonly baseUrl: string;
  private readonly adminEmail: string;
  private readonly adminPassword: string;

  constructor(config: Config) {
    this.baseUrl = config.pocketbase.url.replace(/\/$/, '');
    this.adminEmail = config.pocketbase.adminEmail;
    this.adminPassword = config.pocketbase.adminPassword;
  }

  async authAdmin(): Promise<string> {
    const token = await this.request<PocketBaseAdminToken>('/api/admins/auth-with-password', {
      method: 'POST',
      body: JSON.stringify({ identity: this.adminEmail, password: this.adminPassword }),
    });
    this.adminToken = token.token;
    return token.token;
  }

  async findUserByEmail(email: string): Promise<PocketBaseUserView | null> {
    const token = await this.ensureAdminToken();
    const record = await this.request<{ items: { id: string; email: string; name: string }[] }>(
      `/api/collections/users/records?filter=${encodeURIComponent(`email = "${email.replace(/"/g, '')}"`)}`,
      { method: 'GET', headers: { Authorization: token } },
    );
    if (record.items.length === 0) return null;
    const user = record.items[0];
    return { id: user.id, email: user.email, name: user.name };
  }

  async createUser(email: string, password: string, name: string): Promise<PocketBaseUserView> {
    const token = await this.ensureAdminToken();
    const user = await this.request<PocketBaseUser>('/api/collections/users/records', {
      method: 'POST',
      headers: { Authorization: token },
      body: JSON.stringify({
        email,
        password,
        passwordConfirm: password,
        name,
        emailVisibility: false,
      }),
    });
    return { id: user.id, email: user.email, name: user.name };
  }

  async authUser(email: string, password: string): Promise<PocketBaseUserView> {
    const auth = await this.request<{ record: { id: string; email: string; name: string } }>(
      '/api/collections/users/auth-with-password',
      { method: 'POST', body: JSON.stringify({ identity: email, password }) },
    );
    return { id: auth.record.id, email: auth.record.email, name: auth.record.name };
  }

  async renameUser(userId: string, name: string): Promise<void> {
    const token = await this.ensureAdminToken();
    await this.request(`/api/collections/users/records/${userId}`, {
      method: 'PATCH',
      headers: { Authorization: token },
      body: JSON.stringify({ name }),
    });
  }

  async ensureNoticesCollection(): Promise<void> {
    const token = await this.ensureAdminToken();
    try {
      await this.request('/api/collections/notices', {
        method: 'GET',
        headers: { Authorization: token },
      });
      return;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
    }
    await this.request('/api/collections/import', {
      method: 'PUT',
      headers: { Authorization: token },
      body: JSON.stringify({
        collections: [
          {
            name: 'notices',
            type: 'base',
            schema: [
              { name: 'manager', type: 'text', required: true },
              { name: 'kind', type: 'text', required: true },
              { name: 'gameweek', type: 'number' },
              { name: 'message', type: 'text', required: true },
              { name: 'read', type: 'bool' },
            ],
            listRule: '@request.auth.id != "" && manager = @request.auth.id',
            viewRule: '@request.auth.id != "" && manager = @request.auth.id',
            createRule: null,
            updateRule: '@request.auth.id != "" && manager = @request.auth.id',
            deleteRule: null,
          },
        ],
      }),
    });
    await this.request('/api/collections/notices', {
      method: 'GET',
      headers: { Authorization: token },
    });
  }

  async createNotice(input: { manager: string; kind: string; gameweek: number; message: string }): Promise<void> {
    const token = await this.ensureAdminToken();
    await this.request('/api/collections/notices/records', {
      method: 'POST',
      headers: { Authorization: token },
      body: JSON.stringify({ ...input, read: false }),
    });
  }

  async listNotices(managerId: string): Promise<{ id: string; kind: string; gameweek: number; message: string; read: boolean; created: string }[]> {
    const token = await this.ensureAdminToken();
    const page = await this.request<{
      items: { id: string; kind: string; gameweek: number; message: string; read: boolean; created: string }[];
    }>(
      `/api/collections/notices/records?filter=${encodeURIComponent(`manager = "${managerId}"`)}&sort=-created&page=1&perPage=200`,
      { method: 'GET', headers: { Authorization: token } },
    );
    return page.items;
  }

  async markAllRead(managerId: string): Promise<void> {
    const token = await this.ensureAdminToken();
    const page = await this.request<{ items: { id: string }[] }>(
      `/api/collections/notices/records?filter=${encodeURIComponent(`manager = "${managerId}" && read = false`)}&perPage=200`,
      { method: 'GET', headers: { Authorization: token } },
    );
    for (const item of page.items) {
      await this.request(`/api/collections/notices/records/${item.id}`, {
        method: 'PATCH',
        headers: { Authorization: token },
        body: JSON.stringify({ read: true }),
      });
    }
  }

  async healthy(): Promise<boolean> {
    try {
      await this.request('/api/health', { method: 'GET' });
      return true;
    } catch {
      return false;
    }
  }

  private async ensureAdminToken(): Promise<string> {
    if (this.adminToken === null) await this.authAdmin();
    return this.adminToken as string;
  }

  private async request<T>(path: string, init: { method: string; headers?: Record<string, string>; body?: string }): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: { 'Content-Type': 'application/json', ...init.headers },
        body: init.body,
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      this.adminToken = null;
      throw new ApiError(503, 'accounts_unavailable', 'The accounts service is unreachable right now.');
    }
    if (!response.ok) {
      const text = await response.text();
      if (response.status === 400 && init.body !== undefined) {
        const parsed = JSON.parse(text) as { message?: string; data?: Record<string, { message: string }> };
        const fields: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed.data ?? {})) {
          if (typeof value?.message === 'string') fields[key] = value.message;
        }
        if (Object.keys(fields).length > 0) {
          throw new ApiError(422, 'validation', parsed.message ?? 'Some fields need a second look.', { fields });
        }
        throw new ApiError(400, 'validation', parsed.message ?? 'PocketBase rejected the request.');
      }
      if (response.status === 401) {
        this.adminToken = null;
        try {
          await this.authAdmin();
        } catch {
          throw new ApiError(503, 'accounts_unavailable', 'The accounts service is unreachable right now.');
        }
        throw new ApiError(503, 'accounts_unavailable', 'The accounts service is unreachable right now.');
      }
      const parsed = (() => { try { return JSON.parse(text) as { message?: string }; } catch { return {}; } })();
      throw new ApiError(response.status, 'accounts_unavailable', parsed.message ?? `PocketBase answered ${response.status}.`);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (text === '') return undefined as T;
    return JSON.parse(text) as T;
  }
}
