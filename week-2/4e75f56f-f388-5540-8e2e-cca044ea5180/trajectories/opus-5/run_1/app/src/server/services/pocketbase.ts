import { config } from '../config.js';

export class ContentUnavailable extends Error {
  constructor(detail: string) {
    super(`PocketBase is not answering: ${detail}`);
    this.name = 'ContentUnavailable';
  }
}

const TIMEOUT_MS = 8_000;

export type ContentKind = 'sessions' | 'hospitality' | 'hotels' | 'faq';

export const COLLECTIONS: Record<ContentKind, string> = {
  sessions: 'agenda_sessions',
  hospitality: 'hospitality_events',
  hotels: 'hotels',
  faq: 'faq_entries',
};

interface FieldSpec {
  readonly name: string;
  readonly type: 'text' | 'number';
}

const SCHEMAS: Record<string, readonly FieldSpec[]> = {
  agenda_sessions: [
    { name: 'number', type: 'number' },
    { name: 'day', type: 'number' },
    { name: 'title', type: 'text' },
    { name: 'format', type: 'text' },
    { name: 'minutes', type: 'number' },
    { name: 'outcomes', type: 'text' },
  ],
  hospitality_events: [
    { name: 'title', type: 'text' },
    { name: 'day', type: 'number' },
    { name: 'starts_at', type: 'text' },
    { name: 'venue', type: 'text' },
    { name: 'tier', type: 'text' },
    { name: 'description', type: 'text' },
  ],
  hotels: [
    { name: 'name', type: 'text' },
    { name: 'distance', type: 'text' },
    { name: 'rate', type: 'text' },
    { name: 'map_url', type: 'text' },
  ],
  faq_entries: [
    { name: 'question', type: 'text' },
    { name: 'answer', type: 'text' },
    { name: 'sort', type: 'number' },
  ],
};

let adminToken: string | null = null;

async function request(
  method: string,
  path: string,
  options: { body?: unknown; token?: string | null } = {},
): Promise<{ status: number; text: string }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token !== undefined && options.token !== null) {
    headers['authorization'] = options.token;
  }
  try {
    const response = await fetch(`${config.pocketbase.url}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    if (response.status >= 500) {
      throw new ContentUnavailable(`${method} ${path} answered ${response.status}`);
    }
    return { status: response.status, text };
  } catch (error) {
    if (error instanceof ContentUnavailable) throw error;
    throw new ContentUnavailable(error instanceof Error ? error.message : 'request failed');
  }
}

async function authenticate(): Promise<string> {
  const result = await request('POST', '/api/admins/auth-with-password', {
    body: { identity: config.pocketbase.adminEmail, password: config.pocketbase.adminPassword },
  });
  if (result.status !== 200) {
    throw new ContentUnavailable(`admin sign-in answered ${result.status}`);
  }
  const parsed = JSON.parse(result.text) as { token: string };
  adminToken = parsed.token;
  return parsed.token;
}

async function adminRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const token = adminToken ?? (await authenticate());
  const first = await request(method, path, { body, token });
  if (first.status !== 401 && first.status !== 403) return first;
  adminToken = null;
  const retryToken = await authenticate();
  return request(method, path, { body, token: retryToken });
}

function expectOk(result: { status: number; text: string }, what: string): unknown {
  if (result.status >= 400) {
    throw new ContentUnavailable(`${what} answered ${result.status}: ${result.text.slice(0, 200)}`);
  }
  return result.text === '' ? null : JSON.parse(result.text);
}

export interface ContentRecord {
  readonly id: string;
  readonly [field: string]: unknown;
}

export async function listRecords(collection: string, sort: string): Promise<ContentRecord[]> {
  const path = `/api/collections/${collection}/records?perPage=200&sort=${encodeURIComponent(sort)}`;
  const parsed = expectOk(await adminRequest('GET', path), `list ${collection}`) as {
    items: ContentRecord[];
  };
  return parsed.items;
}

export async function createRecord(
  collection: string,
  values: Record<string, unknown>,
): Promise<ContentRecord> {
  const path = `/api/collections/${collection}/records`;
  return expectOk(await adminRequest('POST', path, values), `create ${collection}`) as ContentRecord;
}

export async function updateRecord(
  collection: string,
  id: string,
  values: Record<string, unknown>,
): Promise<ContentRecord | null> {
  const path = `/api/collections/${collection}/records/${encodeURIComponent(id)}`;
  const result = await adminRequest('PATCH', path, values);
  if (result.status === 404) return null;
  return expectOk(result, `update ${collection}`) as ContentRecord;
}

export async function getRecord(collection: string, id: string): Promise<ContentRecord | null> {
  const path = `/api/collections/${collection}/records/${encodeURIComponent(id)}`;
  const result = await adminRequest('GET', path);
  if (result.status === 404) return null;
  return expectOk(result, `get ${collection}`) as ContentRecord;
}

export async function deleteRecord(collection: string, id: string): Promise<boolean> {
  const path = `/api/collections/${collection}/records/${encodeURIComponent(id)}`;
  const result = await adminRequest('DELETE', path);
  if (result.status === 404) return false;
  expectOk(result, `delete ${collection}`);
  return true;
}

async function ensureCollection(name: string, fields: readonly FieldSpec[]): Promise<void> {
  const existing = await adminRequest('GET', `/api/collections/${name}`);
  if (existing.status === 200) return;
  const created = await adminRequest('POST', '/api/collections', {
    name,
    type: 'base',
    listRule: '',
    viewRule: '',
    schema: fields.map((field) => ({ name: field.name, type: field.type })),
  });
  if (created.status === 400 && created.text.includes('name')) return;
  expectOk(created, `create collection ${name}`);
}

export async function ensureCollections(): Promise<void> {
  for (const [name, fields] of Object.entries(SCHEMAS)) {
    await ensureCollection(name, fields);
  }
}

export async function countRecords(collection: string): Promise<number> {
  const path = `/api/collections/${collection}/records?perPage=1`;
  const parsed = expectOk(await adminRequest('GET', path), `count ${collection}`) as {
    totalItems: number;
  };
  return parsed.totalItems;
}
