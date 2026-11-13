import { config } from '../config.ts';
import type { NoticeKind } from '../../shared/types.ts';

export class PocketBaseUnavailable extends Error {}
export class PocketBaseRejected extends Error {
  readonly status: number;
  readonly data: unknown;

  constructor(status: number, data: unknown) {
    super(`PocketBase answered ${status}`);
    this.status = status;
    this.data = data;
  }
}

export interface PocketBaseUser {
  id: string;
  email: string;
  team_name: string;
}

export interface PocketBaseNotice {
  id: string;
  manager: string;
  kind: NoticeKind;
  gameweek: number;
  message: string;
  read: boolean;
  created: string;
}

interface PocketBaseListResponse<T> {
  items: T[];
}

let adminToken: string | null = null;

const callRaw = async (
  path: string,
  init: { method?: string; body?: unknown; token?: string | null },
): Promise<{ status: number; data: unknown }> => {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.token) headers.Authorization = init.token;
  let response: Response;
  try {
    response = await fetch(new URL(path, config.pocketbase.url), {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new PocketBaseUnavailable('PocketBase is unreachable');
  }
  const text = await response.text();
  const data: unknown = text === '' ? null : JSON.parse(text);
  return { status: response.status, data };
};

const authenticateAdmin = async (): Promise<string> => {
  const { status, data } = await callRaw('/api/admins/auth-with-password', {
    method: 'POST',
    body: { identity: config.pocketbase.adminEmail, password: config.pocketbase.adminPassword },
  });
  if (status !== 200) throw new PocketBaseRejected(status, data);
  adminToken = (data as { token: string }).token;
  return adminToken;
};

const asAdmin = async (
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> => {
  const token = adminToken ?? (await authenticateAdmin());
  const first = await callRaw(path, { ...init, token });
  if (first.status === 401 || first.status === 403) {
    const retry = await callRaw(path, { ...init, token: await authenticateAdmin() });
    if (retry.status >= 400) throw new PocketBaseRejected(retry.status, retry.data);
    return retry.data;
  }
  if (first.status >= 400) throw new PocketBaseRejected(first.status, first.data);
  return first.data;
};

const NOTICE_SCHEMA = [
  { name: 'manager', type: 'text', required: true },
  { name: 'kind', type: 'text', required: true },
  { name: 'gameweek', type: 'number', required: false },
  { name: 'message', type: 'text', required: true },
  { name: 'read', type: 'bool', required: false },
];

export const ensureNoticesCollection = async (): Promise<void> => {
  const list = (await asAdmin(
    '/api/collections?perPage=200',
  )) as PocketBaseListResponse<{ name: string }>;
  if (list.items.some((item) => item.name === 'notices')) return;
  await asAdmin('/api/collections', {
    method: 'POST',
    body: { name: 'notices', type: 'base', schema: NOTICE_SCHEMA },
  });
};

export const createUser = async (
  email: string,
  password: string,
  teamName: string,
): Promise<PocketBaseUser> => {
  const created = (await asAdmin('/api/collections/users/records', {
    method: 'POST',
    body: {
      email,
      password,
      passwordConfirm: password,
      emailVisibility: true,
      verified: true,
      name: teamName,
    },
  })) as { id: string; email: string };
  return { id: created.id, email: created.email, team_name: teamName };
};

export const authenticateUser = async (
  email: string,
  password: string,
): Promise<PocketBaseUser | null> => {
  const { status, data } = await callRaw('/api/collections/users/auth-with-password', {
    method: 'POST',
    body: { identity: email, password },
  });
  if (status === 400 || status === 401 || status === 403) return null;
  if (status >= 400) throw new PocketBaseRejected(status, data);
  const record = (data as { record: { id: string; email: string; name?: string } }).record;
  return { id: record.id, email: record.email, team_name: record.name ?? '' };
};

export const findUserByEmail = async (email: string): Promise<PocketBaseUser | null> => {
  const filter = encodeURIComponent(`email="${email.replace(/"/g, '')}"`);
  const list = (await asAdmin(
    `/api/collections/users/records?perPage=1&filter=${filter}`,
  )) as PocketBaseListResponse<{ id: string; email: string; name?: string }>;
  const record = list.items[0];
  return record === undefined
    ? null
    : { id: record.id, email: record.email, team_name: record.name ?? '' };
};

export const writeNotice = async (notice: {
  manager: string;
  kind: NoticeKind;
  gameweek: number;
  message: string;
}): Promise<string> => {
  const created = (await asAdmin('/api/collections/notices/records', {
    method: 'POST',
    body: { ...notice, read: false },
  })) as { id: string };
  return created.id;
};

export const listNotices = async (pbUserId: string): Promise<PocketBaseNotice[]> => {
  const filter = encodeURIComponent(`manager="${pbUserId}"`);
  const list = (await asAdmin(
    `/api/collections/notices/records?perPage=200&sort=-created,-id&filter=${filter}`,
  )) as PocketBaseListResponse<PocketBaseNotice>;
  return list.items;
};

export const markAllRead = async (pbUserId: string): Promise<void> => {
  const unread = (await listNotices(pbUserId)).filter((notice) => !notice.read);
  for (const notice of unread) {
    await asAdmin(`/api/collections/notices/records/${notice.id}`, {
      method: 'PATCH',
      body: { read: true },
    });
  }
};

export const ensureOperatorUser = async (
  email: string,
  password: string,
  teamName: string,
): Promise<PocketBaseUser> => {
  const existing = await findUserByEmail(email);
  if (existing !== null) return existing;
  return createUser(email, password, teamName);
};
