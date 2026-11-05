import { config } from './util.js';

export class CmsError extends Error {}

export interface EntryRecord {
  id: string;
  kind: 'case_study' | 'journal';
  slug: string;
  title: string;
  client: string;
  year: string;
  summary: string;
  body: string;
  status: 'draft' | 'published' | 'withdrawn';
  publishedAt: string | null;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function pbToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const res = await fetch(`${config.pocketbase.url}/api/admins/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: config.pocketbase.adminEmail, password: config.pocketbase.adminPassword }),
  });
  if (!res.ok) {
    throw new CmsError(`PocketBase auth failed: ${res.status}`);
  }
  const data = (await res.json()) as { token: string };
  cachedToken = { token: data.token, expiresAt: Date.now() + 20 * 60_000 };
  return data.token;
}

async function pbRequest<T>(path: string, init: RequestInit, retry = true): Promise<T> {
  const token = await pbToken();
  const res = await fetch(`${config.pocketbase.url}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (res.status === 401 && retry) {
    cachedToken = null;
    return pbRequest<T>(path, init, false);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new CmsError(`PocketBase ${path} answered ${res.status}: ${text.slice(0, 200)}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function cmsHealthy(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_500);
    try {
      const res = await fetch(`${config.pocketbase.url}/api/health`, { signal: controller.signal });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

export async function ensureEntriesCollection(): Promise<void> {
  try {
    const token = await pbToken();
    const res = await fetch(`${config.pocketbase.url}/api/collections/entries`, {
      headers: { Authorization: token },
    });
    if (res.ok) return;
  } catch {
    // fall through and create the collection
  }
  const schema: unknown[] = [
    { name: 'kind', type: 'select', required: true, options: { maxSelect: 1, values: ['case_study', 'journal'] } },
    { name: 'slug', type: 'text', required: true, options: { min: 1, max: 200 } },
    { name: 'title', type: 'text', required: true, options: { min: 1, max: 200 } },
    { name: 'client', type: 'text', options: { max: 200 } },
    { name: 'year', type: 'text', options: { max: 8 } },
    { name: 'summary', type: 'text', options: { max: 2000 } },
    { name: 'body', type: 'text', options: { max: 40000 } },
    { name: 'status', type: 'select', required: true, options: { maxSelect: 1, values: ['draft', 'published', 'withdrawn'] } },
    { name: 'publishedAt', type: 'text', options: { max: 40 } },
  ];
  await pbRequest('/api/collections', {
    method: 'POST',
    body: JSON.stringify({
      name: 'entries',
      type: 'base',
      schema,
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    }),
  });
}

export async function listEntries(kind: 'case_study' | 'journal', status?: 'published'): Promise<EntryRecord[]> {
  const params = new URLSearchParams();
  params.set('filter', `kind = "${kind}"`);
  if (status) {
    params.set('filter', `kind = "${kind}" && status = "${status}"`);
  }
  params.set('perPage', '200');
  const data = await pbRequest<{ items: EntryRecord[] }>(`/api/collections/entries/records?${params.toString()}`, {});
  return data.items ?? [];
}

export async function getEntry(id: string): Promise<EntryRecord> {
  return await pbRequest<EntryRecord>(`/api/collections/entries/records/${id}`, {});
}

export async function getEntryBySlug(slug: string): Promise<EntryRecord | null> {
  const params = new URLSearchParams();
  params.set('filter', `slug = "${slug}"`);
  params.set('perPage', '1');
  const data = await pbRequest<{ items: EntryRecord[] }>(`/api/collections/entries/records?${params.toString()}`, {});
  return data.items?.[0] ?? null;
}

export async function createEntry(entry: Omit<EntryRecord, 'id'>): Promise<EntryRecord> {
  return await pbRequest<EntryRecord>('/api/collections/entries/records', {
    method: 'POST',
    body: JSON.stringify(entry),
  });
}

export async function updateEntry(id: string, patch: Partial<EntryRecord>): Promise<EntryRecord> {
  return await pbRequest<EntryRecord>(`/api/collections/entries/records/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}
