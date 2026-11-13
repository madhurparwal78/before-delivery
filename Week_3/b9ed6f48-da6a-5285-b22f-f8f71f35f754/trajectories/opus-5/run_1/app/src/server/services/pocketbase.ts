import { config } from '../config.js';
import { AppError } from '../errors.js';
import type { Preferences, Role, User } from '../../shared/types.js';

const REQUEST_TIMEOUT_MS = 10_000;

interface PocketBaseFailure {
  status: number;
  data: Record<string, { code?: string; message?: string }> | undefined;
}

class PocketBaseError extends Error {
  readonly failure: PocketBaseFailure;

  constructor(failure: PocketBaseFailure) {
    super(`PocketBase answered ${failure.status}`);
    this.failure = failure;
  }
}

let adminToken: string | null = null;

async function call<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = options.token;
  let response: Response;
  try {
    response = await fetch(`${config.pocketbase.url}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AppError('accounts_unavailable');
  }
  const text = await response.text();
  if (response.status >= 500) throw new AppError('accounts_unavailable');
  if (!response.ok) {
    let data: PocketBaseFailure['data'];
    try {
      data = (JSON.parse(text) as { data?: PocketBaseFailure['data'] }).data;
    } catch {
      data = undefined;
    }
    throw new PocketBaseError({ status: response.status, data });
  }
  return (text ? JSON.parse(text) : null) as T;
}

async function signInAdmin(): Promise<string> {
  const result = await call<{ token: string }>('/api/admins/auth-with-password', {
    method: 'POST',
    body: { identity: config.pocketbase.adminEmail, password: config.pocketbase.adminPassword },
  });
  adminToken = result.token;
  return result.token;
}

/** Runs an admin call, signing in again when the cached token has expired. */
async function asAdmin<T>(run: (token: string) => Promise<T>): Promise<T> {
  const token = adminToken ?? (await signInAdmin());
  try {
    return await run(token);
  } catch (error) {
    if (error instanceof PocketBaseError && (error.failure.status === 401 || error.failure.status === 403)) {
      adminToken = null;
      return run(await signInAdmin());
    }
    throw error;
  }
}

/* ------------------------------------------------------------ collections */

interface SchemaField {
  name: string;
  type: string;
  required?: boolean;
  options?: Record<string, unknown>;
}

interface CollectionRecord {
  id: string;
  name: string;
  type: string;
  schema: SchemaField[];
}

const ROLE_VALUES: Role[] = ['visitor', 'curator', 'lead_curator', 'manager'];

const COLLECTIONS: { name: string; schema: SchemaField[] }[] = [
  {
    name: 'saved_paths',
    schema: [
      { name: 'user', type: 'text', required: true, options: { min: 1 } },
      { name: 'resolved', type: 'json', options: { maxSize: 20000 } },
      { name: 'last_chapter', type: 'number', options: {} },
      { name: 'last_exhibit', type: 'text', options: {} },
    ],
  },
  {
    name: 'bookmarks',
    schema: [
      { name: 'user', type: 'text', required: true, options: { min: 1 } },
      { name: 'target_type', type: 'text', required: true, options: { min: 1 } },
      { name: 'target_id', type: 'text', required: true, options: { min: 1 } },
    ],
  },
  {
    name: 'preferences',
    schema: [
      { name: 'user', type: 'text', required: true, options: { min: 1 } },
      { name: 'motion', type: 'bool', options: {} },
      { name: 'sound', type: 'bool', options: {} },
    ],
  },
];

const UNIQUE_USER_INDEXES: Record<string, string[]> = {
  saved_paths: ['CREATE UNIQUE INDEX `idx_saved_paths_user` ON `saved_paths` (`user`)'],
  preferences: ['CREATE UNIQUE INDEX `idx_preferences_user` ON `preferences` (`user`)'],
  bookmarks: ['CREATE INDEX `idx_bookmarks_user` ON `bookmarks` (`user`)'],
};

export async function ensureCollections(): Promise<void> {
  await asAdmin(async (token) => {
    const list = await call<{ items: CollectionRecord[] }>('/api/collections?perPage=200', { token });
    const byName = new Map(list.items.map((collection) => [collection.name, collection]));

    const users = byName.get('users');
    if (users) {
      const fields = [...users.schema];
      if (!fields.some((field) => field.name === 'name')) {
        fields.push({ name: 'name', type: 'text', options: {} });
      }
      if (!fields.some((field) => field.name === 'role')) {
        fields.push({ name: 'role', type: 'select', options: { maxSelect: 1, values: ROLE_VALUES } });
        await call(`/api/collections/${users.id}`, { method: 'PATCH', body: { schema: fields }, token });
      }
    }

    for (const wanted of COLLECTIONS) {
      if (byName.has(wanted.name)) continue;
      await call('/api/collections', {
        method: 'POST',
        body: {
          name: wanted.name,
          type: 'base',
          schema: wanted.schema,
          indexes: UNIQUE_USER_INDEXES[wanted.name] ?? [],
        },
        token,
      });
    }
  });
}

/* ----------------------------------------------------------------- users */

interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: Role | '';
}

function toUser(record: UserRecord): User {
  return { id: record.id, name: record.name, email: record.email, role: record.role === '' ? 'visitor' : record.role };
}

export async function createUser(input: { name: string; email: string; password: string; role: Role }): Promise<User> {
  try {
    const record = await asAdmin((token) =>
      call<UserRecord>('/api/collections/users/records', {
        method: 'POST',
        body: {
          email: input.email,
          password: input.password,
          passwordConfirm: input.password,
          name: input.name,
          role: input.role,
          emailVisibility: true,
          verified: true,
        },
        token,
      }),
    );
    return toUser(record);
  } catch (error) {
    if (error instanceof PocketBaseError && error.failure.status === 400) {
      if (error.failure.data?.email?.code === 'validation_not_unique') throw new AppError('email_taken');
      throw new AppError('email_taken');
    }
    throw error;
  }
}

export async function authenticate(email: string, password: string): Promise<User | null> {
  try {
    const result = await call<{ record: UserRecord }>('/api/collections/users/auth-with-password', {
      method: 'POST',
      body: { identity: email, password },
    });
    return toUser(result.record);
  } catch (error) {
    if (error instanceof PocketBaseError && error.failure.status === 400) return null;
    throw error;
  }
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const result = await asAdmin((token) =>
    call<{ items: UserRecord[] }>(
      `/api/collections/users/records?perPage=1&filter=${encodeURIComponent(`email='${email}'`)}`,
      { token },
    ),
  );
  const record = result.items[0];
  return record ? toUser(record) : null;
}

/* ------------------------------------------- per-user records, always scoped */

interface Listed<T> {
  items: T[];
}

function scopedFilter(userId: string): string {
  return encodeURIComponent(`user='${userId}'`);
}

interface PathRecord {
  id: string;
  user: string;
  resolved: number[] | null;
  last_chapter: number | null;
  last_exhibit: string;
}

export interface StoredPath {
  resolved: number[];
  lastChapter: number | null;
  lastExhibit: string;
}

export async function readPath(userId: string): Promise<StoredPath> {
  const result = await asAdmin((token) =>
    call<Listed<PathRecord>>(`/api/collections/saved_paths/records?perPage=1&filter=${scopedFilter(userId)}`, {
      token,
    }),
  );
  const record = result.items[0];
  if (!record) return { resolved: [], lastChapter: null, lastExhibit: '' };
  return {
    resolved: Array.isArray(record.resolved) ? record.resolved : [],
    lastChapter: record.last_chapter === 0 ? null : record.last_chapter,
    lastExhibit: record.last_exhibit ?? '',
  };
}

export async function writePath(userId: string, path: StoredPath): Promise<void> {
  await asAdmin(async (token) => {
    const result = await call<Listed<PathRecord>>(
      `/api/collections/saved_paths/records?perPage=1&filter=${scopedFilter(userId)}`,
      { token },
    );
    const body = {
      user: userId,
      resolved: path.resolved,
      last_chapter: path.lastChapter ?? 0,
      last_exhibit: path.lastExhibit,
    };
    const existing = result.items[0];
    if (existing) {
      await call(`/api/collections/saved_paths/records/${existing.id}`, { method: 'PATCH', body, token });
      return;
    }
    await call('/api/collections/saved_paths/records', { method: 'POST', body, token });
  });
}

interface BookmarkRecord {
  id: string;
  user: string;
  target_type: 'chapter' | 'event';
  target_id: string;
  created: string;
}

export interface StoredBookmark {
  id: string;
  targetType: 'chapter' | 'event';
  targetId: string;
}

export async function listBookmarks(userId: string): Promise<StoredBookmark[]> {
  const result = await asAdmin((token) =>
    call<Listed<BookmarkRecord>>(
      `/api/collections/bookmarks/records?perPage=200&sort=-created,-id&filter=${scopedFilter(userId)}`,
      { token },
    ),
  );
  return result.items.map((record) => ({
    id: record.id,
    targetType: record.target_type,
    targetId: record.target_id,
  }));
}

export async function createBookmark(
  userId: string,
  targetType: 'chapter' | 'event',
  targetId: string,
): Promise<{ bookmark: StoredBookmark; created: boolean }> {
  const existing = (await listBookmarks(userId)).find(
    (bookmark) => bookmark.targetType === targetType && bookmark.targetId === targetId,
  );
  if (existing) return { bookmark: existing, created: false };
  const record = await asAdmin((token) =>
    call<BookmarkRecord>('/api/collections/bookmarks/records', {
      method: 'POST',
      body: { user: userId, target_type: targetType, target_id: targetId },
      token,
    }),
  );
  return { bookmark: { id: record.id, targetType, targetId }, created: true };
}

export async function deleteBookmark(userId: string, bookmarkId: string): Promise<boolean> {
  try {
    const record = await asAdmin((token) =>
      call<BookmarkRecord>(`/api/collections/bookmarks/records/${bookmarkId}`, { token }),
    );
    if (record.user !== userId) return false;
    await asAdmin((token) =>
      call(`/api/collections/bookmarks/records/${bookmarkId}`, { method: 'DELETE', token }),
    );
    return true;
  } catch (error) {
    if (error instanceof PocketBaseError && error.failure.status === 404) return false;
    throw error;
  }
}

interface PreferenceRecord {
  id: string;
  user: string;
  motion: boolean;
  sound: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = { motion: true, sound: false };

export async function readPreferences(userId: string): Promise<Preferences> {
  const result = await asAdmin((token) =>
    call<Listed<PreferenceRecord>>(`/api/collections/preferences/records?perPage=1&filter=${scopedFilter(userId)}`, {
      token,
    }),
  );
  const record = result.items[0];
  return record ? { motion: record.motion, sound: record.sound } : { ...DEFAULT_PREFERENCES };
}

export async function writePreferences(userId: string, preferences: Preferences): Promise<Preferences> {
  await asAdmin(async (token) => {
    const result = await call<Listed<PreferenceRecord>>(
      `/api/collections/preferences/records?perPage=1&filter=${scopedFilter(userId)}`,
      { token },
    );
    const body = { user: userId, motion: preferences.motion, sound: preferences.sound };
    const existing = result.items[0];
    if (existing) {
      await call(`/api/collections/preferences/records/${existing.id}`, { method: 'PATCH', body, token });
      return;
    }
    await call('/api/collections/preferences/records', { method: 'POST', body, token });
  });
  return preferences;
}

export async function reachable(): Promise<boolean> {
  try {
    await call('/api/health');
    return true;
  } catch {
    return false;
  }
}
