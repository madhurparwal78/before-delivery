import type { Config } from '../config.ts';

/** PocketBase admin client: accounts, saved paths, bookmarks, preferences. */

export interface PbUser {
  id: string;
  email: string;
  name: string;
  role: 'visitor' | 'curator' | 'lead_curator' | 'manager';
}

export interface PbRecord {
  id: string;
  [k: string]: unknown;
}

export class PocketBaseUnavailable extends Error {}

/** The index name inside a CREATE ... INDEX statement. */
function indexNameOf(statement: string): string {
  const m = statement.match(/INDEX\s+(\S+)/i);
  return m?.[1]?.replace(/["'`]/g, '') ?? statement;
}

export class PocketBase {
  private token: string | null = null;
  private tokenExpires = 0;

  constructor(private config: Config) {}

  private async auth(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpires) return this.token;
    try {
      const res = await fetch(`${this.config.pocketbaseUrl}/api/admins/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: this.config.pocketbaseAdminEmail, password: this.config.pocketbaseAdminPassword }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`auth ${res.status}`);
      const data = (await res.json()) as { token: string };
      this.token = data.token;
      this.tokenExpires = Date.now() + 60 * 60 * 1000;
      return this.token;
    } catch {
      this.token = null;
      throw new PocketBaseUnavailable('PocketBase unreachable');
    }
  }

  private async req<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
    const token = await this.auth();
    const headers: Record<string, string> = { Authorization: token };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await fetch(`${this.config.pocketbaseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? (JSON.stringify(body) as BodyInit) : null,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new PocketBaseUnavailable('PocketBase unreachable');
    }
    if (res.status === 401 && retry) {
      this.token = null;
      return this.req<T>(method, path, body, false);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PocketBase ${res.status}: ${text.slice(0, 300)}`);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async ping(): Promise<void> {
    await this.auth();
  }

  async ensureCollections(): Promise<void> {
    // users: name (text) + role (select)
    const users = await this.req<PbRecord>('GET', '/api/collections/users');
    const schema = (users.schema as Array<Record<string, unknown>>) ?? [];
    let roleField = schema.find((f) => f['name'] === 'role');
    if (!roleField) {
      const newSchema = [
        ...schema,
        {
          system: false,
          id: 'users_role',
          name: 'role',
          type: 'select',
          required: false,
          presentable: false,
          unique: false,
          options: { maxSelect: 1, values: ['visitor', 'curator', 'lead_curator', 'manager'] },
        },
      ];
      await this.req('PATCH', '/api/collections/users', { schema: newSchema });
      roleField = { name: 'role' };
    }

    const ensureBase = async (
      name: string,
      fields: Array<Record<string, unknown>>,
      indexes: string[],
    ): Promise<void> => {
      let coll: PbRecord;
      try {
        coll = await this.req<PbRecord>('GET', `/api/collections/${name}`);
      } catch {
        await this.req('POST', '/api/collections', {
          name,
          type: 'base',
          schema: fields,
          indexes,
          listRule: null,
          viewRule: null,
          createRule: null,
          updateRule: null,
          deleteRule: null,
        });
        return;
      }
      // ensure fields exist
      const existingFields = (coll.schema as Array<Record<string, unknown>>) ?? [];
      const fieldNames = new Set(existingFields.map((f) => f['name']));
      const missingFields = fields.filter((f) => !fieldNames.has(f['name'] as string));
      if (missingFields.length) {
        await this.req('PATCH', `/api/collections/${name}`, { schema: [...existingFields, ...missingFields] });
      }
      const existingIndexes = (coll.indexes as string[]) ?? [];
      const indexNames = new Set(existingIndexes.map((i) => indexNameOf(i)));
      const missingIndexes = indexes.filter((i) => !indexNames.has(indexNameOf(i)));
      if (missingIndexes.length) {
        await this.req('PATCH', `/api/collections/${name}`, { indexes: [...existingIndexes, ...missingIndexes] });
      }
    };

    const usersId = users.id ?? '_pb_users_auth_';
    await ensureBase(
      'saved_paths',
      [
        { system: false, id: 'sp_user', name: 'user', type: 'relation', required: true, presentable: false, unique: false, options: { collectionId: usersId, cascadeDelete: false, minSelect: null, maxSelect: 1 } },
        { system: false, id: 'sp_resolved', name: 'resolved', type: 'json', required: false, presentable: false, unique: false, options: { maxSize: 5_000_000 } },
        { system: false, id: 'sp_last_chapter', name: 'last_chapter', type: 'number', required: false, presentable: false, unique: false, options: { min: null, max: null, noDecimal: true } },
        { system: false, id: 'sp_last_exhibit', name: 'last_exhibit', type: 'text', required: false, presentable: false, unique: false, options: { min: null, max: null, pattern: '' } },
      ],
      ['CREATE UNIQUE INDEX idx_saved_paths_user ON saved_paths (user)'],
    );
    await ensureBase(
      'bookmarks',
      [
        { system: false, id: 'bm_user', name: 'user', type: 'relation', required: true, presentable: false, unique: false, options: { collectionId: usersId, cascadeDelete: false, minSelect: null, maxSelect: 1 } },
        { system: false, id: 'bm_target_type', name: 'target_type', type: 'text', required: true, presentable: false, unique: false, options: { min: null, max: null, pattern: '' } },
        { system: false, id: 'bm_target_id', name: 'target_id', type: 'text', required: true, presentable: false, unique: false, options: { min: null, max: null, pattern: '' } },
      ],
      ['CREATE INDEX idx_bookmarks_user ON bookmarks (user)'],
    );
    await ensureBase(
      'preferences',
      [
        { system: false, id: 'pr_user', name: 'user', type: 'relation', required: true, presentable: false, unique: false, options: { collectionId: usersId, cascadeDelete: false, minSelect: null, maxSelect: 1 } },
        { system: false, id: 'pr_motion', name: 'motion', type: 'bool', required: false, presentable: false, unique: false, options: {} },
        { system: false, id: 'pr_sound', name: 'sound', type: 'bool', required: false, presentable: false, unique: false, options: {} },
      ],
      ['CREATE UNIQUE INDEX idx_preferences_user ON preferences (user)'],
    );
  }

  async ensureUser(name: string, email: string, role: string, password: string): Promise<PbUser> {
    const filter = encodeURIComponent(`email = "${email}"`);
    const list = await this.req<{ items: PbRecord[] }>('GET', `/api/collections/users/records?filter=${filter}`);
    const existing = list.items?.[0];
    if (existing) {
      const recRole = existing['role'];
      if (recRole !== role) {
        await this.req('PATCH', `/api/collections/users/records/${existing.id}`, { role });
      }
      if (existing['name'] !== name) {
        await this.req('PATCH', `/api/collections/users/records/${existing.id}`, { name });
      }
      return { id: existing.id, email, name, role: role as PbUser['role'] };
    }
    const created = await this.req<PbRecord>('POST', '/api/collections/users/records', {
      email,
      password,
      passwordConfirm: password,
      name,
      role,
    });
    return { id: created.id, email, name, role: role as PbUser['role'] };
  }

  async getUserByEmail(email: string): Promise<PbUser | null> {
    const filter = encodeURIComponent(`email = "${email}"`);
    const list = await this.req<{ items: PbRecord[] }>('GET', `/api/collections/users/records?filter=${filter}`);
    const item = list.items?.[0];
    if (!item) return null;
    return {
      id: item.id,
      email: String(item['email'] ?? ''),
      name: String(item['name'] ?? ''),
      role: (item['role'] ?? 'visitor') as PbUser['role'],
    };
  }

  async getUserById(id: string): Promise<PbUser | null> {
    try {
      const item = await this.req<PbRecord>('GET', `/api/collections/users/records/${id}`);
      return {
        id: item.id,
        email: String(item['email'] ?? ''),
        name: String(item['name'] ?? ''),
        role: (item['role'] ?? 'visitor') as PbUser['role'],
      };
    } catch {
      return null;
    }
  }

  async authUser(email: string, password: string): Promise<PbUser | null> {
    try {
      const res = await fetch(`${this.config.pocketbaseUrl}/api/collections/users/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: email, password }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { record: PbRecord };
      const r = data.record;
      return {
        id: r.id,
        email: String(r['email'] ?? ''),
        name: String(r['name'] ?? ''),
        role: (r['role'] ?? 'visitor') as PbUser['role'],
      };
    } catch {
      throw new PocketBaseUnavailable('PocketBase unreachable');
    }
  }

  async createUser(name: string, email: string, password: string): Promise<PbUser> {
    try {
      await this.req<PbRecord>('POST', '/api/collections/users/records', {
        email,
        password,
        passwordConfirm: password,
        name,
        role: 'visitor',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('400')) {
        // Distinguish taken email from weak password
        if (msg.includes('email') || msg.includes('value')) {
          throw new Error('email_taken');
        }
        if (msg.includes('password') || msg.includes('chars')) {
          throw new Error('password_invalid');
        }
        throw new Error('invalid');
      }
      throw e;
    }
    const user = await this.getUserByEmail(email);
    if (!user) throw new Error('invalid');
    return user;
  }

  // saved paths

  private pathFilter(userId: string): string {
    return encodeURIComponent(`user = "${userId}"`);
  }

  async getSavedPath(userId: string): Promise<{ resolved: number[]; last_chapter: number | null; last_exhibit: string } | null> {
    const filter = this.pathFilter(userId);
    const list = await this.req<{ items: PbRecord[] }>('GET', `/api/collections/saved_paths/records?filter=${filter}`);
    const item = list.items?.[0];
    if (!item) return null;
    const resolved = Array.isArray(item['resolved']) ? (item['resolved'] as number[]) : [];
    return {
      resolved,
      last_chapter: typeof item['last_chapter'] === 'number' ? (item['last_chapter'] as number) : null,
      last_exhibit: typeof item['last_exhibit'] === 'string' ? (item['last_exhibit'] as string) : '',
    };
  }

  async upsertSavedPath(
    userId: string,
    data: { resolved?: number[]; last_chapter?: number | null; last_exhibit?: string },
  ): Promise<{ resolved: number[]; last_chapter: number | null; last_exhibit: string }> {
    const filter = this.pathFilter(userId);
    const list = await this.req<{ items: PbRecord[] }>('GET', `/api/collections/saved_paths/records?filter=${filter}`);
    const item = list.items?.[0];
    const current = item
      ? {
          resolved: Array.isArray(item['resolved']) ? (item['resolved'] as number[]) : [],
          last_chapter: typeof item['last_chapter'] === 'number' ? (item['last_chapter'] as number) : null,
          last_exhibit: typeof item['last_exhibit'] === 'string' ? (item['last_exhibit'] as string) : '',
        }
      : { resolved: [], last_chapter: null, last_exhibit: '' };
    const merged = {
      resolved: data.resolved !== undefined ? data.resolved : current.resolved,
      last_chapter: data.last_chapter !== undefined ? data.last_chapter : current.last_chapter,
      last_exhibit: data.last_exhibit !== undefined ? data.last_exhibit : current.last_exhibit,
    };
    if (item) {
      const updated = await this.req<PbRecord>('PATCH', `/api/collections/saved_paths/records/${item.id}`, {
        user: userId,
        resolved: merged.resolved,
        last_chapter: merged.last_chapter,
        last_exhibit: merged.last_exhibit,
      });
      void updated;
    } else {
      await this.req<PbRecord>('POST', '/api/collections/saved_paths/records', {
        user: userId,
        resolved: merged.resolved,
        last_chapter: merged.last_chapter,
        last_exhibit: merged.last_exhibit,
      });
    }
    return merged;
  }

  // bookmarks

  async listBookmarks(userId: string): Promise<PbRecord[]> {
    const filter = encodeURIComponent(`user = "${userId}"`);
    const list = await this.req<{ items: PbRecord[] }>('GET', `/api/collections/bookmarks/records?filter=${filter}&sort=-created`);
    return list.items ?? [];
  }

  async createBookmark(userId: string, targetType: string, targetId: string): Promise<PbRecord> {
    const filter = encodeURIComponent(`user = "${userId}" && target_id = "${targetId}"`);
    const list = await this.req<{ items: PbRecord[] }>('GET', `/api/collections/bookmarks/records?filter=${filter}`);
    const existing = list.items?.[0];
    if (existing) return existing;
    return await this.req<PbRecord>('POST', '/api/collections/bookmarks/records', {
      user: userId,
      target_type: targetType,
      target_id: targetId,
    });
  }

  async deleteBookmark(userId: string, id: string): Promise<boolean> {
    const filter = encodeURIComponent(`user = "${userId}"`);
    const list = await this.req<{ items: PbRecord[] }>('GET', `/api/collections/bookmarks/records?filter=${filter}`);
    const found = (list.items ?? []).find((b) => b.id === id);
    if (!found) return false;
    await this.req<void>('DELETE', `/api/collections/bookmarks/records/${id}`);
    return true;
  }

  // preferences

  async getPreferences(userId: string): Promise<{ motion: boolean; sound: boolean } | null> {
    const filter = this.pathFilter(userId);
    const list = await this.req<{ items: PbRecord[] }>('GET', `/api/collections/preferences/records?filter=${filter}`);
    const item = list.items?.[0];
    if (!item) return null;
    return {
      motion: item['motion'] !== false,
      sound: item['sound'] === true,
    };
  }

  async setPreferences(userId: string, motion: boolean, sound: boolean): Promise<{ motion: boolean; sound: boolean }> {
    const filter = this.pathFilter(userId);
    const list = await this.req<{ items: PbRecord[] }>('GET', `/api/collections/preferences/records?filter=${filter}`);
    const item = list.items?.[0];
    if (item) {
      await this.req<PbRecord>('PATCH', `/api/collections/preferences/records/${item.id}`, { user: userId, motion, sound });
    } else {
      await this.req<PbRecord>('POST', '/api/collections/preferences/records', { user: userId, motion, sound });
    }
    return { motion, sound };
  }

  /** All users with a role, used for notices. */
  async listAllUsersByRole(role: string): Promise<PbRecord[]> {
    const filter = encodeURIComponent(`role = "${role}"`);
    const list = await this.req<{ items: PbRecord[] }>('GET', `/api/collections/users/records?filter=${filter}&perPage=50`);
    return list.items ?? [];
  }
}
