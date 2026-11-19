import type { RecipeStep } from '../shared/recipe.js';

export interface ApiFailure {
  code: string;
  message: string;
  status: number;
  details: Record<string, unknown> | null;
}

export class ApiCallError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.failure = failure;
  }

  fields(): Record<string, string> {
    const fields = this.failure.details?.['fields'];
    return typeof fields === 'object' && fields !== null ? (fields as Record<string, string>) : {};
  }
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
  }
  const response = await fetch(path, init);
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = (payload['error'] ?? {}) as { code?: string; message?: string };
    throw new ApiCallError({
      code: error.code ?? 'server_error',
      message: error.message ?? 'Something went wrong.',
      status: response.status,
      details: (payload['details'] as Record<string, unknown> | undefined) ?? null,
    });
  }
  return payload as T;
}

export interface ClientConfig {
  autobakeMs: number;
  regexBudgetMs: number;
  inputMaxBytes: number;
  fileMaxBytes: number;
  outputDisplayBytes: number;
  versionsKept: number;
  teamMax: number;
  shareTtlChoices: string[];
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  verified: boolean;
}

export interface TeamMembership {
  id: string;
  name: string;
  role: 'owner' | 'member';
}

export interface RecipeSummary {
  id: string;
  name: string;
  owner: { type: 'user' | 'team'; id: string; name: string };
  latestVersion: number;
  tags: string[];
  updatedAt: string;
  lastUsedAt: string;
}

export interface VersionBody {
  n: number;
  name: string;
  note: string;
  tags: string[];
  steps: RecipeStep[];
  author: { id: string; displayName: string };
  createdAt: string;
}

export interface SnapshotBody {
  token: string;
  status: 'pending' | 'active' | 'expired' | 'revoked';
  createdAt: string;
  expiresAt: string;
  recipe: { name: string; version: number | null; steps: RecipeStep[] } | null;
  inputBytes: number;
  outputBytes: number;
  url: string;
}

export interface TeamBody {
  id: string;
  name: string;
  owner: string;
  members: { id: string; displayName: string; email: string; role: 'owner' | 'member' }[];
  invites?: { email: string; expiresAt: string }[];
}

export const api = {
  config: (): Promise<ClientConfig> => send('GET', '/api/config'),
  me: (): Promise<{ user: User; teams: TeamMembership[] }> => send('GET', '/api/me'),
  signup: (body: { displayName: string; email: string; password: string }): Promise<{ user: User }> =>
    send('POST', '/api/auth/signup', body),
  verify: (token: string): Promise<{ user: User }> => send('POST', '/api/auth/verify', { token }),
  signin: (body: { email: string; password: string }): Promise<{ user: User }> =>
    send('POST', '/api/auth/signin', body),
  signout: (): Promise<void> => send('POST', '/api/auth/signout'),
  recipes: (): Promise<{ recipes: RecipeSummary[] }> => send('GET', '/api/recipes'),
  createRecipe: (body: {
    name: string;
    owner: { type: string; id: string };
    tags: string[];
    note: string;
    steps: RecipeStep[];
  }): Promise<{ recipe: RecipeSummary; version: VersionBody }> => send('POST', '/api/recipes', body),
  recipe: (id: string): Promise<{ recipe: RecipeSummary; versions: Omit<VersionBody, 'steps'>[] }> =>
    send('GET', `/api/recipes/${id}`),
  version: (id: string, n: number): Promise<{ version: VersionBody }> =>
    send('GET', `/api/recipes/${id}/versions/${n}`),
  saveVersion: (
    id: string,
    body: { baseVersion: number; name: string; note: string; tags: string[]; steps: RecipeStep[] },
  ): Promise<{ recipe: RecipeSummary; version: VersionBody }> => send('POST', `/api/recipes/${id}/versions`, body),
  restoreVersion: (
    id: string,
    body: { version: number; baseVersion: number },
  ): Promise<{ recipe: RecipeSummary; version: VersionBody }> => send('POST', `/api/recipes/${id}/restore`, body),
  compare: (id: string, from: number, to: number): Promise<{ changes: string[] }> =>
    send('GET', `/api/recipes/${id}/compare?from=${from}&to=${to}`),
  opened: (id: string): Promise<void> => send('POST', `/api/recipes/${id}/opened`),
  search: (query: string): Promise<{ results: RecipeSummary[]; total: number }> =>
    send('GET', `/api/search?q=${encodeURIComponent(query)}`),
  createSnapshot: (body: {
    steps: RecipeStep[];
    recipe: { id: string; version: number | null } | null;
    inputBase64?: string;
    fileId?: string;
    outputBase64: string;
    ttl: string;
  }): Promise<{ snapshot: SnapshotBody }> => send('POST', '/api/snapshots', body),
  snapshot: (token: string): Promise<{ snapshot: SnapshotBody; serverTime: string }> =>
    send('GET', `/api/snapshots/${token}`),
  revokeSnapshot: (token: string): Promise<void> => send('DELETE', `/api/snapshots/${token}`),
  importText: (body: {
    text: string;
    owner: { type: string; id: string };
  }): Promise<{
    import: {
      status: 'created' | 'already_imported';
      recipe: RecipeSummary;
      version: number;
      lineCount?: number;
      message?: string;
    };
  }> => send('POST', '/api/imports', body),
  createTeam: (name: string): Promise<{ team: TeamBody }> => send('POST', '/api/teams', { name }),
  team: (id: string): Promise<{ team: TeamBody }> => send('GET', `/api/teams/${id}`),
  invite: (id: string, email: string): Promise<{ invite: { email: string; expiresAt: string } }> =>
    send('POST', `/api/teams/${id}/invites`, { email }),
  inviteDetails: (token: string): Promise<{ invite: { teamName: string; inviterName: string; email: string } }> =>
    send('GET', `/api/invites/${token}`),
  acceptInvite: (token: string): Promise<{ team: TeamBody }> => send('POST', `/api/invites/${token}/accept`),
  removeMember: (teamId: string, userId: string): Promise<void> =>
    send('DELETE', `/api/teams/${teamId}/members/${userId}`),
};

/** Uploads one file's bytes and answers with its stored record. */
export async function uploadFile(
  name: string,
  bytes: Uint8Array,
): Promise<{ file: { id: string; name: string; bytes: number; sha256: string } }> {
  const response = await fetch('/api/files', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-file-name': name },
    body: bytes.slice().buffer as ArrayBuffer,
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = (payload['error'] ?? {}) as { code?: string; message?: string };
    throw new ApiCallError({
      code: error.code ?? 'server_error',
      message: error.message ?? 'Something went wrong.',
      status: response.status,
      details: null,
    });
  }
  return payload as { file: { id: string; name: string; bytes: number; sha256: string } };
}

export async function fetchBytes(path: string): Promise<Uint8Array> {
  const response = await fetch(path);
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const error = (payload['error'] ?? {}) as { code?: string; message?: string };
    throw new ApiCallError({
      code: error.code ?? 'server_error',
      message: error.message ?? 'Something went wrong.',
      status: response.status,
      details: null,
    });
  }
  return new Uint8Array(await response.arrayBuffer());
}
