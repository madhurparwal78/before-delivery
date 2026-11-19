import { config } from '../config/runtime.js';
import type { Person, PersonKind, StaffRole } from '../domain/types.js';

class DirectoryDown extends Error {}

interface PBRecord {
  id: string;
  email?: string;
  name?: string;
  firm?: string;
  kind?: string;
  staffRole?: string;
}

let adminToken: string | null = null;
let adminTokenExpiry = 0;

let directoryUp = true;
export const directoryStatus = (): 'up' | 'down' => (directoryUp ? 'up' : 'down');

function baseUrl(): string { return config.pocketbase.url.replace(/\/$/, ''); }

async function pbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  try {
    const res = await fetch(`${baseUrl()}${path}`, { signal: AbortSignal.timeout(5000), ...init });
    if (res.status === 401) throw new DirectoryDown();
    if (!res.ok) {
      const err = new Error(`pb ${res.status}`) as Error & { status: number };
      err.status = res.status;
      throw err;
    }
    directoryUp = true;
    return await res.json();
  } catch (err) {
    if (err instanceof DirectoryDown) throw err;
    if ((err as { status?: number }).status) throw err;
    directoryUp = false;
    throw new DirectoryDown();
  }
}

export class DirectoryAuthError extends Error {}

async function ensureAdminToken(): Promise<string> {
  if (adminToken && Date.now() < adminTokenExpiry - 60_000) return adminToken;
  const res = await fetch(`${baseUrl()}/api/admins/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: config.pocketbase.adminEmail, password: config.pocketbase.adminPassword }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new DirectoryDown();
  const data = (await res.json()) as { token: string };
  adminToken = data.token;
  adminTokenExpiry = Date.now() + 12 * 60 * 60 * 1000;
  directoryUp = true;
  return adminToken;
}

const FIELD_DEFS = [
  { name: 'name', type: 'text', required: false, presentable: false, unique: false, options: { min: null, max: null, pattern: '' } },
  { name: 'firm', type: 'text', required: false, presentable: false, unique: false, options: { min: null, max: null, pattern: '' } },
  { name: 'kind', type: 'text', required: false, presentable: false, unique: false, options: { min: null, max: null, pattern: '' } },
  { name: 'staffRole', type: 'text', required: false, presentable: false, unique: false, options: { min: null, max: null, pattern: '' } },
];

export async function ensureDirectoryFields(): Promise<void> {
  const token = await ensureAdminToken();
  const col = (await pbFetch('/api/collections/users', { headers: { Authorization: token } })) as {
    schema: Array<{ name: string; type: string; options: Record<string, unknown> }>;
  };
  const existing = new Set(col.schema.map(f => f.name));
  const avatar = col.schema.find(f => f.name === 'avatar');
  const needed = FIELD_DEFS.filter(f => !existing.has(f.name));
  if (needed.length === 0) return;
  const fullSchema = [
    ...col.schema.filter(f => ['name', 'avatar'].includes(f.name)).map(f => ({
      system: false, name: f.name, type: f.type, required: false, presentable: false, unique: false, options: f.options,
    })),
    ...needed,
  ];
  await pbFetch('/api/collections/users', {
    method: 'PATCH',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema: fullSchema }),
  });
}

export async function probeDirectory(): Promise<'up' | 'down'> {
  try {
    const res = await fetch(`${baseUrl()}/api/health`, { signal: AbortSignal.timeout(5000) });
    directoryUp = res.ok;
  } catch {
    directoryUp = false;
  }
  return directoryStatus();
}

function toPerson(rec: PBRecord): Person {
  const kind: PersonKind = rec.kind === 'partner' ? 'partner' : 'staff';
  const staffRole = kind === 'staff' && (rec.staffRole === 'engineer' || rec.staffRole === 'controller' || rec.staffRole === 'admin')
    ? rec.staffRole as StaffRole : null;
  return {
    id: rec.id,
    name: rec.name ?? '',
    email: rec.email ?? '',
    firm: rec.firm ?? '',
    kind,
    staffRole,
  };
}

export async function authenticate(email: string, password: string): Promise<Person> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/api/collections/users/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: email, password }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    directoryUp = false;
    throw new DirectoryDown();
  }
  if (res.status === 404 || res.status === 400) {
    const data = (await res.json()) as { code?: number };
    if (data.code === 404 || res.status === 400) {
      directoryUp = true;
      throw new DirectoryAuthError();
    }
  }
  if (!res.ok) {
    directoryUp = true;
    throw new DirectoryAuthError();
  }
  const data = (await res.json()) as { record?: PBRecord };
  if (!data.record) throw new DirectoryAuthError();
  directoryUp = true;
  return toPerson(data.record);
}

export async function searchPeople(q: string, kind?: PersonKind): Promise<Person[]> {
  const token = await ensureAdminToken();
  const filter = kind ? `(name~"${q}" || firm~"${q}" || email~"${q}") && kind="${kind}"` : `(name~"${q}" || firm~"${q}" || email~"${q}")`;
  const data = (await pbFetch(`/api/collections/users/records?filter=${encodeURIComponent(filter)}&perPage=20&sort=name`, {
    headers: { Authorization: token },
  })) as { items?: PBRecord[] };
  return (data.items ?? []).map(toPerson);
}

export async function upsertPerson(person: Person, password: string): Promise<Person> {
  try {
    const token = await ensureAdminToken();
    const existing = (await pbFetch(`/api/collections/users/records?filter=${encodeURIComponent(`email="${person.email}"`)}&perPage=1`, {
      headers: { Authorization: token },
    })) as { items?: PBRecord[] };
    if ((existing.items ?? []).length > 0) {
      const first = (existing.items ?? [])[0];
      if (!first) throw new DirectoryDown();
      return toPerson(first);
    }
    const res = await fetch(`${baseUrl()}/api/collections/users/records`, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: person.email, password, passwordConfirm: password, name: person.name, firm: person.firm, kind: person.kind, staffRole: person.staffRole ?? '' }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error('seed person create failed');
    const data = (await res.json()) as PBRecord;
    return toPerson(data);
  } catch (err) {
    if (err instanceof DirectoryDown) throw err;
    throw err;
  }
}
