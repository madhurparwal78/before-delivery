import { env } from '../env.js';
import { accountsUnavailable } from '../http/errors.js';
import { markService } from './health.js';

export type StaffRole = 'fulfilment' | 'support' | 'owner';
export type UserRole = 'customer' | StaffRole;

export interface PocketBaseUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface PocketBaseAddress {
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

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface PocketBaseReview {
  id: string;
  scope: string;
  flavour: string;
  user: string;
  rating: number;
  body: string;
  status: ReviewStatus;
  created: string;
}

interface PocketBaseListResult<Item> {
  items: Item[];
  totalItems: number;
}

/** Thrown when PocketBase answers but refuses the call, so the caller can map it. */
class PocketBaseRefusal extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(`PocketBase answered ${status}`);
    this.name = 'PocketBaseRefusal';
  }
}

let adminToken: string | null = null;

async function callRaw(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<Response> {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (rest.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (token) headers.set('authorization', token);
  try {
    const response = await fetch(`${env.pocketbase.url}${path}`, {
      ...rest,
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    markService('pocketbase', true);
    return response;
  } catch {
    markService('pocketbase', false);
    throw accountsUnavailable();
  }
}

async function adminAuth(): Promise<string> {
  const response = await callRaw('/api/admins/auth-with-password', {
    method: 'POST',
    body: JSON.stringify({
      identity: env.pocketbase.adminEmail,
      password: env.pocketbase.adminPassword,
    }),
  });
  if (!response.ok) throw new PocketBaseRefusal(response.status, await response.json());
  const payload = (await response.json()) as { token: string };
  adminToken = payload.token;
  return payload.token;
}

async function asAdmin<T>(
  path: string,
  init: RequestInit = {},
  parse: (response: Response) => Promise<T> = (response) => response.json() as Promise<T>,
): Promise<T> {
  const token = adminToken ?? (await adminAuth());
  let response = await callRaw(path, { ...init, token });
  if (response.status === 401 || response.status === 403) {
    response = await callRaw(path, { ...init, token: await adminAuth() });
  }
  if (!response.ok) throw new PocketBaseRefusal(response.status, await response.json());
  return parse(response);
}

export async function probePocketBase(): Promise<void> {
  const response = await callRaw('/api/health');
  if (!response.ok) throw new Error(`PocketBase health answered ${response.status}`);
}

/* ---------------------------------------------------------------- collections */

interface SchemaField {
  name: string;
  type: string;
  required?: boolean;
  options?: Record<string, unknown>;
}

interface CollectionRecordShape {
  id: string;
  name: string;
  type: string;
  schema: SchemaField[];
  indexes?: string[];
}

async function listCollections(): Promise<CollectionRecordShape[]> {
  const result = await asAdmin<PocketBaseListResult<CollectionRecordShape>>(
    '/api/collections?perPage=200',
  );
  return result.items;
}

function text(name: string, required: boolean, max?: number): SchemaField {
  return { name, type: 'text', required, options: { min: null, max: max ?? null, pattern: '' } };
}

export async function ensureCollections(): Promise<void> {
  const collections = await listCollections();
  const users = collections.find((collection) => collection.name === 'users');
  if (users && !users.schema.some((field) => field.name === 'role')) {
    await asAdmin(`/api/collections/${users.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ schema: [...users.schema, text('role', false, 20)] }),
    });
  }
  const usersId = users?.id ?? '';

  const wanted: Array<Omit<CollectionRecordShape, 'id'>> = [
    {
      name: 'addresses',
      type: 'base',
      schema: [
        {
          name: 'user',
          type: 'relation',
          required: true,
          options: {
            collectionId: usersId,
            cascadeDelete: true,
            minSelect: null,
            maxSelect: 1,
            displayFields: null,
          },
        },
        text('name', true, 80),
        text('line1', true, 200),
        text('line2', false, 200),
        text('city', true, 100),
        text('province', true, 2),
        text('postal_code', true, 7),
        { name: 'is_default', type: 'bool', required: false, options: {} },
      ],
      indexes: ['CREATE INDEX `idx_addresses_user` ON `addresses` (`user`)'],
    },
    {
      name: 'reviews',
      type: 'base',
      schema: [
        text('scope', true, 80),
        text('flavour', true, 60),
        {
          name: 'user',
          type: 'relation',
          required: true,
          options: {
            collectionId: usersId,
            cascadeDelete: true,
            minSelect: null,
            maxSelect: 1,
            displayFields: null,
          },
        },
        {
          name: 'rating',
          type: 'number',
          required: true,
          options: { min: 1, max: 5, noDecimal: true },
        },
        text('body', true, 1000),
        text('status', true, 20),
      ],
      indexes: [
        'CREATE UNIQUE INDEX `idx_reviews_once` ON `reviews` (`scope`, `flavour`, `user`)',
      ],
    },
    {
      name: 'stock_levels',
      type: 'base',
      schema: [
        text('scope', true, 80),
        text('flavour', true, 60),
        {
          name: 'stock_left',
          type: 'number',
          required: false,
          options: { min: null, max: null, noDecimal: true },
        },
      ],
      indexes: [
        'CREATE UNIQUE INDEX `idx_stock_levels_scope` ON `stock_levels` (`scope`, `flavour`)',
      ],
    },
  ];

  for (const collection of wanted) {
    if (collections.some((existing) => existing.name === collection.name)) continue;
    await asAdmin('/api/collections', {
      method: 'POST',
      body: JSON.stringify({ ...collection, listRule: null, viewRule: null }),
    });
  }
}

/* --------------------------------------------------------------------- users */

function toUser(record: Record<string, unknown>): PocketBaseUser {
  const role = String(record.role ?? 'customer');
  return {
    id: String(record.id),
    email: String(record.email),
    name: String(record.name ?? ''),
    role: (role === '' ? 'customer' : role) as UserRole,
  };
}

export async function findUserByEmail(email: string): Promise<PocketBaseUser | null> {
  const result = await asAdmin<PocketBaseListResult<Record<string, unknown>>>(
    `/api/collections/users/records?perPage=1&filter=${encodeURIComponent(`email="${email.toLowerCase()}"`)}`,
  );
  const first = result.items[0];
  return first ? toUser(first) : null;
}

export async function getUser(id: string): Promise<PocketBaseUser | null> {
  try {
    const record = await asAdmin<Record<string, unknown>>(
      `/api/collections/users/records/${encodeURIComponent(id)}`,
    );
    return toUser(record);
  } catch (error) {
    if (error instanceof PocketBaseRefusal && error.status === 404) return null;
    throw error;
  }
}

export async function createUser(input: {
  email: string;
  password: string;
  name: string;
  role: UserRole;
}): Promise<PocketBaseUser> {
  const record = await asAdmin<Record<string, unknown>>('/api/collections/users/records', {
    method: 'POST',
    body: JSON.stringify({
      email: input.email.toLowerCase(),
      password: input.password,
      passwordConfirm: input.password,
      name: input.name,
      role: input.role,
      emailVisibility: false,
      verified: true,
    }),
  });
  return toUser(record);
}

export async function authenticateUser(
  email: string,
  password: string,
): Promise<PocketBaseUser | null> {
  const response = await callRaw('/api/collections/users/auth-with-password', {
    method: 'POST',
    body: JSON.stringify({ identity: email.toLowerCase(), password }),
  });
  if (response.status === 400) return null;
  if (!response.ok) throw new PocketBaseRefusal(response.status, await response.json());
  const payload = (await response.json()) as { record: Record<string, unknown> };
  return toUser(payload.record);
}

/* ----------------------------------------------------------------- addresses */

function toAddress(record: Record<string, unknown>): PocketBaseAddress {
  return {
    id: String(record.id),
    user: String(record.user),
    name: String(record.name),
    line1: String(record.line1),
    line2: String(record.line2 ?? ''),
    city: String(record.city),
    province: String(record.province),
    postal_code: String(record.postal_code),
    is_default: record.is_default === true,
  };
}

export async function listAddresses(userId: string): Promise<PocketBaseAddress[]> {
  const result = await asAdmin<PocketBaseListResult<Record<string, unknown>>>(
    `/api/collections/addresses/records?perPage=200&sort=-is_default,created&filter=${encodeURIComponent(`user="${userId}"`)}`,
  );
  return result.items.map(toAddress);
}

export async function getAddress(id: string): Promise<PocketBaseAddress | null> {
  try {
    return toAddress(
      await asAdmin<Record<string, unknown>>(
        `/api/collections/addresses/records/${encodeURIComponent(id)}`,
      ),
    );
  } catch (error) {
    if (error instanceof PocketBaseRefusal && error.status === 404) return null;
    throw error;
  }
}

export async function createAddress(
  input: Omit<PocketBaseAddress, 'id'>,
): Promise<PocketBaseAddress> {
  const record = await asAdmin<Record<string, unknown>>('/api/collections/addresses/records', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return toAddress(record);
}

export async function updateAddress(
  id: string,
  patch: Partial<Omit<PocketBaseAddress, 'id' | 'user'>>,
): Promise<PocketBaseAddress> {
  const record = await asAdmin<Record<string, unknown>>(
    `/api/collections/addresses/records/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
  return toAddress(record);
}

/** Keeps exactly one default address per account. */
export async function clearOtherDefaults(userId: string, keepId: string): Promise<void> {
  for (const address of await listAddresses(userId)) {
    if (address.id !== keepId && address.is_default) {
      await updateAddress(address.id, { is_default: false });
    }
  }
}

/* ------------------------------------------------------------------- reviews */

function toReview(record: Record<string, unknown>): PocketBaseReview {
  return {
    id: String(record.id),
    scope: String(record.scope),
    flavour: String(record.flavour),
    user: String(record.user),
    rating: Number(record.rating),
    body: String(record.body),
    status: String(record.status) as ReviewStatus,
    created: String(record.created),
  };
}

export async function listReviews(filter: {
  flavour?: string;
  status?: ReviewStatus;
}): Promise<PocketBaseReview[]> {
  const parts = [`scope="${env.databaseName}"`];
  if (filter.flavour) parts.push(`flavour="${filter.flavour}"`);
  if (filter.status) parts.push(`status="${filter.status}"`);
  const result = await asAdmin<PocketBaseListResult<Record<string, unknown>>>(
    `/api/collections/reviews/records?perPage=200&sort=-created&filter=${encodeURIComponent(parts.join(' && '))}`,
  );
  return result.items.map(toReview);
}

export async function getReview(id: string): Promise<PocketBaseReview | null> {
  try {
    const review = toReview(
      await asAdmin<Record<string, unknown>>(
        `/api/collections/reviews/records/${encodeURIComponent(id)}`,
      ),
    );
    return review.scope === env.databaseName ? review : null;
  } catch (error) {
    if (error instanceof PocketBaseRefusal && error.status === 404) return null;
    throw error;
  }
}

export async function createReview(input: {
  flavour: string;
  user: string;
  rating: number;
  body: string;
}): Promise<PocketBaseReview | 'already_reviewed'> {
  try {
    const record = await asAdmin<Record<string, unknown>>('/api/collections/reviews/records', {
      method: 'POST',
      body: JSON.stringify({ ...input, scope: env.databaseName, status: 'pending' }),
    });
    return toReview(record);
  } catch (error) {
    if (error instanceof PocketBaseRefusal && error.status === 400) return 'already_reviewed';
    throw error;
  }
}

export async function setReviewStatus(
  id: string,
  status: ReviewStatus,
): Promise<PocketBaseReview> {
  return toReview(
    await asAdmin<Record<string, unknown>>(
      `/api/collections/reviews/records/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify({ status }) },
    ),
  );
}

/* -------------------------------------------------------------- stock levels */

export async function publishStockLevel(flavour: string, stockLeft: number): Promise<void> {
  const filter = encodeURIComponent(`scope="${env.databaseName}" && flavour="${flavour}"`);
  const existing = await asAdmin<PocketBaseListResult<Record<string, unknown>>>(
    `/api/collections/stock_levels/records?perPage=1&filter=${filter}`,
  );
  const found = existing.items[0];
  if (found) {
    await asAdmin(`/api/collections/stock_levels/records/${String(found.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ stock_left: stockLeft }),
    });
    return;
  }
  await asAdmin('/api/collections/stock_levels/records', {
    method: 'POST',
    body: JSON.stringify({ scope: env.databaseName, flavour, stock_left: stockLeft }),
  });
}

export interface RealtimeChange {
  collection: 'stock_levels' | 'reviews';
  record: Record<string, unknown>;
}

/**
 * Follows PocketBase's realtime feed for this process's scope and calls `onChange`
 * for every stock level and review it reports, reconnecting while it is unreachable.
 */
export function followRealtime(onChange: (change: RealtimeChange) => void): void {
  let stopped = false;

  const connect = async (): Promise<void> => {
    const token = adminToken ?? (await adminAuth());
    const response = await fetch(`${env.pocketbase.url}/api/realtime`, {
      headers: { authorization: token, accept: 'text/event-stream' },
    });
    if (!response.ok || !response.body) throw new Error(`realtime answered ${response.status}`);
    markService('pocketbase', true);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!stopped) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        let eventName = 'message';
        const dataLines: string[] = [];
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length === 0) continue;
        const payload = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
        if (eventName === 'PB_CONNECT') {
          await callRaw('/api/realtime', {
            method: 'POST',
            token,
            body: JSON.stringify({
              clientId: String(payload.clientId),
              subscriptions: ['stock_levels', 'reviews'],
            }),
          });
          continue;
        }
        const record = payload.record as Record<string, unknown> | undefined;
        if (!record || record.scope !== env.databaseName) continue;
        if (eventName === 'stock_levels' || eventName === 'reviews') {
          onChange({ collection: eventName, record });
        }
      }
    }
  };

  const loop = () => {
    if (stopped) return;
    connect()
      .catch(() => markService('pocketbase', false))
      .finally(() => setTimeout(loop, 3_000));
  };
  loop();
  process.once('beforeExit', () => {
    stopped = true;
  });
}
