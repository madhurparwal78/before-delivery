import { config } from '../config.js';
import type { Person, PersonKind, StaffRole } from '../../shared/types.js';

export class DirectoryDown extends Error {}
export class BadCredentials extends Error {}

const TIMEOUT_MS = 4_000;
const USERS_COLLECTION = 'users';

let up = true;
const listeners = new Set<(value: boolean) => void>();

const markDown = (): void => {
  if (up) {
    up = false;
    for (const listener of listeners) listener(false);
  }
};

const markUp = (): void => {
  if (!up) {
    up = true;
    for (const listener of listeners) listener(true);
  }
};

export const directoryUp = (): boolean => up;
export const onDirectoryChange = (listener: (value: boolean) => void): void => {
  listeners.add(listener);
};

interface CallOptions {
  method: string;
  path: string;
  body?: unknown;
  token?: string;
  allowStatuses?: number[];
}

const call = async (options: CallOptions): Promise<{ status: number; json: unknown }> => {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.token !== undefined) headers.authorization = options.token;
  let response: Response;
  try {
    response = await fetch(`${config.pocketbase.url}${options.path}`, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    markDown();
    throw new DirectoryDown('directory unreachable');
  }
  if (response.status >= 500) {
    markDown();
    throw new DirectoryDown(`directory answered ${response.status}`);
  }
  markUp();
  const text = await response.text();
  const json: unknown = text === '' ? null : JSON.parse(text);
  const allowed = options.allowStatuses ?? [];
  if (!response.ok && !allowed.includes(response.status)) {
    throw new Error(`directory ${options.method} ${options.path} failed: ${response.status} ${text}`);
  }
  return { status: response.status, json };
};

let adminToken: string | null = null;

const authenticateAdmin = async (): Promise<string> => {
  const result = await call({
    method: 'POST',
    path: '/api/admins/auth-with-password',
    body: { identity: config.pocketbase.adminEmail, password: config.pocketbase.adminPassword },
  });
  const token = (result.json as { token?: unknown }).token;
  if (typeof token !== 'string') throw new Error('directory did not return an admin token');
  adminToken = token;
  return token;
};

const asAdmin = async <T>(work: (token: string) => Promise<T>): Promise<T> => {
  const token = adminToken ?? (await authenticateAdmin());
  try {
    return await work(token);
  } catch (error) {
    if (error instanceof DirectoryDown) throw error;
    adminToken = null;
    return work(await authenticateAdmin());
  }
};

interface UserRecord {
  id: string;
  email: string;
  name?: string;
  firm?: string;
  kind?: string;
  staffRole?: string;
}

const asPerson = (record: UserRecord): Person => {
  const kind: PersonKind = record.kind === 'partner' ? 'partner' : 'staff';
  const role = record.staffRole;
  const staffRole: StaffRole | null =
    kind === 'staff' && (role === 'engineer' || role === 'controller' || role === 'admin')
      ? role
      : null;
  return {
    id: record.id,
    name: record.name ?? record.email,
    email: record.email,
    firm: record.firm ?? '',
    kind,
    staffRole,
  };
};

interface SchemaField {
  name: string;
  type: string;
  required?: boolean;
  options?: Record<string, unknown>;
}

/** Adds the fields the app needs to the directory's people collection, idempotently. */
export const ensureDirectoryFields = async (): Promise<void> => {
  await asAdmin(async (token) => {
    const current = await call({
      method: 'GET',
      path: `/api/collections/${USERS_COLLECTION}`,
      token,
    });
    const collection = current.json as { id: string; schema: SchemaField[] };
    const wanted: SchemaField[] = [
      { name: 'name', type: 'text', options: {} },
      { name: 'firm', type: 'text', options: {} },
      {
        name: 'kind',
        type: 'select',
        options: { maxSelect: 1, values: ['staff', 'partner'] },
      },
      {
        name: 'staffRole',
        type: 'select',
        options: { maxSelect: 1, values: ['engineer', 'controller', 'admin'] },
      },
      {
        name: 'avatar',
        type: 'file',
        options: { maxSelect: 1, maxSize: 5_242_880, mimeTypes: ['image/png', 'image/jpeg'] },
      },
    ];
    const schema = collection.schema.slice();
    let changed = false;
    for (const field of wanted) {
      if (!schema.some((existing) => existing.name === field.name)) {
        schema.push(field);
        changed = true;
      }
    }
    if (changed) {
      await call({
        method: 'PATCH',
        path: `/api/collections/${collection.id}`,
        body: { schema },
        token,
      });
    }
  });
};

export const authenticatePerson = async (email: string, password: string): Promise<Person> => {
  const result = await call({
    method: 'POST',
    path: `/api/collections/${USERS_COLLECTION}/auth-with-password`,
    body: { identity: email, password },
    allowStatuses: [400, 401, 403, 404],
  });
  if (result.status !== 200) throw new BadCredentials('bad credentials');
  const record = (result.json as { record?: UserRecord }).record;
  if (record === undefined) throw new BadCredentials('bad credentials');
  return asPerson(record);
};

const escapeFilter = (value: string): string => value.replace(/["\\]/g, (c) => `\\${c}`);

export const searchPeople = async (query: string, kind: PersonKind | null): Promise<Person[]> => {
  const escaped = escapeFilter(query);
  const clauses = [`(name ~ "${escaped}" || firm ~ "${escaped}" || email ~ "${escaped}")`];
  if (kind !== null) clauses.push(`kind = "${kind}"`);
  return asAdmin(async (token) => {
    const result = await call({
      method: 'GET',
      path: `/api/collections/${USERS_COLLECTION}/records?perPage=20&page=1&sort=name&filter=${encodeURIComponent(
        clauses.join(' && '),
      )}`,
      token,
    });
    const items = (result.json as { items?: UserRecord[] }).items ?? [];
    return items.map(asPerson);
  });
};

export const fetchPerson = async (id: string): Promise<Person | null> =>
  asAdmin(async (token) => {
    const result = await call({
      method: 'GET',
      path: `/api/collections/${USERS_COLLECTION}/records/${encodeURIComponent(id)}`,
      token,
      allowStatuses: [404],
    });
    if (result.status === 404) return null;
    return asPerson(result.json as UserRecord);
  });

export const upsertPerson = async (
  person: Omit<Person, 'id'> & { password: string },
): Promise<Person> =>
  asAdmin(async (token) => {
    const found = await call({
      method: 'GET',
      path: `/api/collections/${USERS_COLLECTION}/records?perPage=1&filter=${encodeURIComponent(
        `email = "${escapeFilter(person.email)}"`,
      )}`,
      token,
    });
    const existing = ((found.json as { items?: UserRecord[] }).items ?? [])[0];
    const fields = {
      email: person.email,
      emailVisibility: true,
      verified: true,
      name: person.name,
      firm: person.firm,
      kind: person.kind,
      staffRole: person.staffRole ?? '',
    };
    if (existing !== undefined) {
      const updated = await call({
        method: 'PATCH',
        path: `/api/collections/${USERS_COLLECTION}/records/${existing.id}`,
        body: { ...fields, password: person.password, passwordConfirm: person.password },
        token,
      });
      return asPerson(updated.json as UserRecord);
    }
    const created = await call({
      method: 'POST',
      path: `/api/collections/${USERS_COLLECTION}/records`,
      body: { ...fields, password: person.password, passwordConfirm: person.password },
      token,
    });
    return asPerson(created.json as UserRecord);
  });

export const probeDirectory = async (): Promise<boolean> => {
  try {
    await call({ method: 'GET', path: '/api/health' });
    return true;
  } catch {
    return false;
  }
};
