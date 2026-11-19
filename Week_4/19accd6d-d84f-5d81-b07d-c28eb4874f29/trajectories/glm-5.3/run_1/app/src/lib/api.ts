import type { ApiError, ClientConfig, FileRecord, ImportResult, InviteInfo, RecipeSummary, RecipeVersion, Snapshot, Team, User } from '../../shared/protocol.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: ApiError['details'],
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, opts: { raw?: undefined } | { raw: 'bytes'; bytes?: Uint8Array; headers?: Record<string, string> } = {}): Promise<T> {
  let res: Response;
  if ('raw' in opts && opts.raw === 'bytes') {
    res = await fetch(path, {
      method,
      headers: opts.headers,
      body: method === 'GET' ? undefined : (opts.bytes as BodyInit),
    });
  } else {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json; charset=utf-8' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const data = JSON.parse(text) as { error?: ApiError } & Record<string, unknown>;
    if (!res.ok) {
      throw new HttpError(res.status, data.error?.code ?? 'unknown', data.error?.message ?? 'Something went wrong.', data.error?.details);
    }
    return data as T;
  }
  if (!res.ok) {
    throw new HttpError(res.status, 'unknown', text || 'Something went wrong.');
  }
  return text as unknown as T;
}

export const api = {
  health: () => request<{ status: string }>('GET', '/api/health'),
  config: () => request<ClientConfig>('GET', '/api/config'),

  signup: (displayName: string, email: string, password: string) =>
    request<{ user: User }>('POST', '/api/auth/signup', { displayName, email, password }),
  verify: (token: string) => request<{ user: User }>('POST', '/api/auth/verify', { token }),
  signin: (email: string, password: string) => request<{ user: User }>('POST', '/api/auth/signin', { email, password }),
  signout: () => request<void>('POST', '/api/auth/signout'),
  me: () => request<{ user: User; teams: { id: string; name: string; role: 'owner' | 'member' }[] }>('GET', '/api/me'),

  recipes: () => request<{ recipes: RecipeSummary[] }>('GET', '/api/recipes'),
  createRecipe: (body: { name: string; owner: { type: 'user' | 'team'; id?: string }; tags: string; note: string; steps: unknown[] }) =>
    request<{ recipe: RecipeSummary; version: RecipeVersion }>('POST', '/api/recipes', body),
  recipe: (id: string) => request<{ recipe: RecipeSummary; versions: RecipeVersion[] }>('GET', `/api/recipes/${id}`),
  version: (id: string, n: number) => request<{ version: RecipeVersion }>('GET', `/api/recipes/${id}/versions/${n}`),
  saveVersion: (id: string, body: { baseVersion: number; name: string; note: string; tags: string; steps: unknown[] }) =>
    request<{ recipe: RecipeSummary; version: RecipeVersion }>('POST', `/api/recipes/${id}/versions`, body),
  restore: (id: string, version: number, baseVersion: number) =>
    request<{ recipe: RecipeSummary; version: RecipeVersion }>('POST', `/api/recipes/${id}/restore`, { version, baseVersion }),
  compare: (id: string, from: number, to: number) =>
    request<{ changes: string[] }>('GET', `/api/recipes/${id}/compare?from=${from}&to=${to}`),
  opened: (id: string) => request<void>('POST', `/api/recipes/${id}/opened`),

  search: (q: string) => request<{ results: RecipeSummary[]; total: number }>('GET', `/api/search?q=${encodeURIComponent(q)}`),

  uploadFile: (name: string, bytes: Uint8Array) =>
    request<{ file: FileRecord }>('POST', '/api/files', undefined, { raw: 'bytes', bytes, headers: { 'X-File-Name': encodeURIComponent(name) } }),
  file: (id: string) => request<string>('GET', `/api/files/${id}`),

  createSnapshot: (body: { steps: unknown[]; recipe: { id: string; version: number; name: string } | null; inputBase64?: string; fileId?: string; outputBase64: string; ttl: string }) =>
    request<{ snapshot: Snapshot; serverTime: string }>('POST', '/api/snapshots', body),
  snapshot: (token: string) => request<{ snapshot: Snapshot; serverTime: string }>('GET', `/api/snapshots/${token}`),
  snapshotInput: (token: string) => fetch(`/api/snapshots/${token}/input`),
  snapshotOutput: (token: string) => fetch(`/api/snapshots/${token}/output`),
  revokeSnapshot: (token: string) => request<void>('DELETE', `/api/snapshots/${token}`),

  importText: (text: string, owner: { type: 'user' | 'team'; id?: string }) =>
    request<{ import: ImportResult }>('POST', '/api/imports', { text, owner }),

  teams: () => request<{ teams: { id: string; name: string; role: string }[] }>('GET', '/api/me'),
  createTeam: (name: string) => request<{ team: Team }>('POST', '/api/teams', { name }),
  team: (id: string) => request<{ team: Team }>('GET', `/api/teams/${id}`),
  invite: (teamId: string, email: string) => request<{ invite: { email: string; expiresAt: string } }>('POST', `/api/teams/${teamId}/invites`, { email }),
  inviteInfo: (token: string) => request<{ invite: InviteInfo }>('GET', `/api/invites/${token}`),
  acceptInvite: (token: string) => request<{ team: Team }>('POST', `/api/invites/${token}/accept`),
  removeMember: (teamId: string, userId: string) => request<void>('DELETE', `/api/teams/${teamId}/members/${userId}`),
};

export async function downloadBytes(res: Promise<Response> | Response): Promise<Uint8Array> {
  const r = await ('status' in res ? Promise.resolve(res) : res);
  if (!r.ok) {
    let message = 'Download failed.';
    try {
      const data = (await r.json()) as { error?: ApiError };
      message = data.error?.message ?? message;
    } catch { /* not JSON */ }
    throw new HttpError(r.status, 'download_failed', message);
  }
  return new Uint8Array(await r.arrayBuffer());
}
