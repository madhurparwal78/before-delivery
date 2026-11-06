import { env } from '../env.js';

export class PocketBaseUnavailable extends Error {}

let adminToken: string | null = null;
let tokenAt = 0;

async function adminAuth(): Promise<string> {
  if (adminToken && Date.now() - tokenAt < 60 * 60 * 1000) return adminToken;
  let res: Response;
  try {
    res = await fetch(`${env.pocketbaseUrl}/api/admins/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: env.pocketbaseAdminEmail, password: env.pocketbaseAdminPassword }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new PocketBaseUnavailable();
  }
  if (res.status !== 200) throw new PocketBaseUnavailable();
  const body = (await res.json()) as { token: string };
  adminToken = body.token;
  tokenAt = Date.now();
  return adminToken;
}

export function invalidateAdminToken(): void {
  adminToken = null;
  tokenAt = 0;
}

async function pb(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<Response> {
  const token = await adminAuth();
  const url = new URL(env.pocketbaseUrl + path);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    throw new PocketBaseUnavailable();
  }
  if (res.status === 401) {
    invalidateAdminToken();
    throw new PocketBaseUnavailable();
  }
  return res;
}

export interface PbUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface PbAddress {
  id: string;
  user: string;
  name: string;
  line1: string;
  line2: string;
  city: string;
  province: string;
  postal_code: string;
  is_default: boolean;
}

export interface PbReview {
  id: string;
  scope: string;
  flavour: string;
  user: string;
  rating: number;
  body: string;
  status: string;
  created: string;
}

export interface PbStockLevel {
  id: string;
  scope: string;
  flavour: string;
  stock_left: number;
}

async function ensureCollection(name: string, schema: unknown[]): Promise<void> {
  const res = await pb('GET', `/api/collections/${name}`);
  if (res.status === 200) {
    const existing = (await res.json()) as { schema: { name: string }[] };
    const have = new Set(existing.schema.map((f) => f.name));
    const missing = (schema as { name: string }[]).filter((f) => !have.has(f.name));
    if (missing.length === 0) return;
    await pb('PATCH', `/api/collections/${name}`, { schema });
    return;
  }
  if (res.status === 404) {
    const created = await pb('POST', '/api/collections', {
      name,
      type: 'base',
      schema,
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
    });
    if (created.status >= 400) throw new Error(`collection create ${name} failed ${created.status}`);
    return;
  }
  throw new Error(`collection check ${name} failed ${res.status}`);
}

export async function initCollections(): Promise<void> {
  const usersRes = await pb('GET', '/api/collections/_pb_users_auth_');
  if (usersRes.status === 200) {
    const users = (await usersRes.json()) as { schema: { name: string }[] };
    if (!users.schema.some((f) => f.name === 'role')) {
      await pb('PATCH', '/api/collections/_pb_users_auth_', {
        schema: [
          {
            name: 'role',
            type: 'select',
            required: true,
            options: { maxSelect: 1, values: ['customer', 'fulfilment', 'support', 'owner'] },
          },
        ],
      });
    }
  } else {
    throw new Error('users collection missing');
  }
  await ensureCollection('addresses', [
    { name: 'user', type: 'text', required: true },
    { name: 'name', type: 'text', required: true },
    { name: 'line1', type: 'text', required: true },
    { name: 'line2', type: 'text' },
    { name: 'city', type: 'text', required: true },
    { name: 'province', type: 'text', required: true },
    { name: 'postal_code', type: 'text', required: true },
    { name: 'is_default', type: 'bool' },
  ]);
  await ensureCollection('reviews', [
    { name: 'scope', type: 'text', required: true },
    { name: 'flavour', type: 'text', required: true },
    { name: 'user', type: 'text', required: true },
    { name: 'rating', type: 'number', required: true },
    { name: 'body', type: 'text', required: true },
    {
      name: 'status',
      type: 'select',
      required: true,
      options: { maxSelect: 1, values: ['pending', 'approved', 'rejected'] },
    },
  ]);
  await ensureCollection('stock_levels', [
    { name: 'scope', type: 'text', required: true },
    { name: 'flavour', type: 'text', required: true },
    { name: 'stock_left', type: 'number', required: true },
  ]);
}

export async function authUser(email: string, password: string): Promise<PbUser> {
  let res: Response;
  try {
    res = await fetch(`${env.pocketbaseUrl}/api/collections/users/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: email, password }),
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    throw new PocketBaseUnavailable();
  }
  if (res.status === 404 || res.status === 400) throw new PocketBaseUnavailable();
  if (res.status !== 200) throw new Error('invalid credentials');
  const body = (await res.json()) as { record: PbUser };
  return body.record;
}

export async function createUser(email: string, password: string, name: string, role: string): Promise<PbUser> {
  const res = await pb('POST', '/api/collections/users/records', {
    email,
    password,
    passwordConfirm: password,
    name,
    role,
    emailVisibility: false,
  });
  if (res.status >= 400) {
    const text = await res.text();
    if (text.includes('already')) throw new Error('email taken');
    throw new Error(`user create failed ${res.status} ${text.slice(0, 120)}`);
  }
  const record = (await res.json()) as PbUser;
  return record;
}

export async function getUser(id: string): Promise<PbUser> {
  const res = await pb('GET', `/api/collections/users/records/${id}`);
  if (res.status !== 200) throw new Error('user not found');
  return (await res.json()) as PbUser;
}

export async function findUserByEmail(email: string): Promise<PbUser | null> {
  const res = await pb('GET', '/api/collections/users/records', undefined, {
    filter: `email = "${email.replace(/"/g, '')}"`,
  });
  if (res.status !== 200) throw new Error('user search failed');
  const body = (await res.json()) as { items: PbUser[] };
  return body.items.length > 0 ? body.items[0] : null;
}

export async function listAddresses(userId: string): Promise<PbAddress[]> {
  const res = await pb('GET', '/api/collections/addresses/records', undefined, {
    filter: `user = "${userId}"`,
    sort: '-is_default,created',
  });
  if (res.status !== 200) throw new Error('address list failed');
  const body = (await res.json()) as { items: PbAddress[] };
  return body.items;
}

export async function createAddress(data: Omit<PbAddress, 'id'>): Promise<PbAddress> {
  if (data.is_default) {
    const existing = await listAddresses(data.user);
    for (const a of existing) {
      if (a.is_default) {
        await pb('PATCH', `/api/collections/addresses/records/${a.id}`, { is_default: false });
      }
    }
  } else {
    const existing = await listAddresses(data.user);
    if (existing.length === 0) data.is_default = true;
  }
  const res = await pb('POST', '/api/collections/addresses/records', data);
  if (res.status >= 400) throw new Error('address create failed');
  return (await res.json()) as PbAddress;
}

export async function updateAddress(id: string, patch: Record<string, unknown>): Promise<PbAddress> {
  if (patch.is_default === true) {
    const res0 = await pb('GET', '/api/collections/addresses/records', undefined, { filter: `id = "${id}"` });
    const current = ((await res0.json()) as { items: PbAddress[] }).items[0];
    if (current) {
      const existing = await listAddresses(current.user);
      for (const a of existing) {
        if (a.is_default && a.id !== id) {
          await pb('PATCH', `/api/collections/addresses/records/${a.id}`, { is_default: false });
        }
      }
    }
  }
  const res = await pb('PATCH', `/api/collections/addresses/records/${id}`, patch);
  if (res.status >= 400) throw new Error('address update failed');
  return (await res.json()) as PbAddress;
}

export async function getAddress(id: string): Promise<PbAddress | null> {
  const res = await pb('GET', `/api/collections/addresses/records/${id}`);
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error('address fetch failed');
  return (await res.json()) as PbAddress;
}

export async function upsertStockLevel(scope: string, flavour: string, stockLeft: number): Promise<void> {
  const res = await pb('GET', '/api/collections/stock_levels/records', undefined, {
    filter: `scope = "${scope}" && flavour = "${flavour}"`,
  });
  if (res.status !== 200) throw new Error('stock level search failed');
  const body = (await res.json()) as { items: PbStockLevel[] };
  if (body.items.length > 0) {
    await pb('PATCH', `/api/collections/stock_levels/records/${body.items[0].id}`, { stock_left: stockLeft });
  } else {
    await pb('POST', '/api/collections/stock_levels/records', { scope, flavour, stock_left: stockLeft });
  }
}

export async function listReviews(scope: string, flavour: string, status?: string): Promise<PbReview[]> {
  const parts = [`scope = "${scope}"`, `flavour = "${flavour}"`];
  if (status) parts.push(`status = "${status}"`);
  const res = await pb('GET', '/api/collections/reviews/records', undefined, {
    filter: parts.join(' && '),
    sort: '-created',
  });
  if (res.status !== 200) throw new Error('review list failed');
  const body = (await res.json()) as { items: PbReview[] };
  return body.items;
}

export async function createReview(data: Omit<PbReview, 'id' | 'created'>): Promise<PbReview> {
  const res = await pb('POST', '/api/collections/reviews/records', data);
  if (res.status >= 400) throw new Error('review create failed');
  return (await res.json()) as PbReview;
}

export async function getReview(id: string): Promise<PbReview | null> {
  const res = await pb('GET', `/api/collections/reviews/records/${id}`);
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error('review fetch failed');
  return (await res.json()) as PbReview;
}

export async function decideReview(id: string, status: 'approved' | 'rejected'): Promise<void> {
  const res = await pb('PATCH', `/api/collections/reviews/records/${id}`, { status });
  if (res.status >= 400) throw new Error('review update failed');
}

export async function listPendingReviews(scope: string): Promise<PbReview[]> {
  const res = await pb('GET', '/api/collections/reviews/records', undefined, {
    filter: `scope = "${scope}" && status = "pending"`,
    sort: '-created',
  });
  if (res.status !== 200) throw new Error('pending review list failed');
  const body = (await res.json()) as { items: PbReview[] };
  return body.items;
}

export async function userFirstName(userId: string): Promise<string> {
  try {
    const user = await getUser(userId);
    return user.name.split(' ')[0] ?? user.name;
  } catch {
    return 'Ceibo';
  }
}

export interface RealtimeEvent {
  collection: string;
  record: Record<string, unknown>;
  action: string;
}

export async function openRealtime(onEvent: (event: RealtimeEvent) => void): Promise<() => void> {
  let closed = false;
  let clientId = '';
  const start = async () => {
    while (!closed) {
      try {
        const res = await fetch(`${env.pocketbaseUrl}/api/realtime`, {
          headers: { Accept: 'text/event-stream' },
          signal: AbortSignal.timeout(60000 * 10),
        });
        if (res.body === null) throw new Error('no body');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const handle = (rawEvent: string) => {
          const lines = rawEvent.split('\n');
          const dataLines = lines.filter((l) => l.startsWith('data:'));
          const eventLines = lines.filter((l) => l.startsWith('event:'));
          const data = dataLines.map((l) => l.slice(5).trim()).join('');
          const name = eventLines.length > 0 ? eventLines[0].slice(6).trim() : 'message';
          if (name === 'PB_CONNECT') {
            const parsed = JSON.parse(data) as { clientId: string };
            clientId = parsed.clientId;
            fetch(`${env.pocketbaseUrl}/api/realtime`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ clientId, subscriptions: ['stock_levels', 'reviews'] }),
            }).catch(() => {});
          } else if (name === 'stock_levels' || name === 'reviews') {
            const parsed = JSON.parse(data) as { record: Record<string, unknown>; action: string };
            onEvent({ collection: name, record: parsed.record, action: parsed.action });
          }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          for (;;) {
            const idx = buffer.indexOf('\n\n');
            if (idx === -1) break;
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            handle(block);
          }
        }
      } catch {
        if (closed) return;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  };
  start();
  return () => {
    closed = true;
  };
}
