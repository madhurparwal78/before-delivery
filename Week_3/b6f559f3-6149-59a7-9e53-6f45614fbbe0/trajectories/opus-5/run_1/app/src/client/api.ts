import type { ClientConfig } from '../server/config';
import type { AssetRecord, JsonValue, SceneDocument } from '../shared/types';

export interface ApiFailure {
  error: string;
  message: string;
  errors?: Record<string, string>;
  status: number;
}

export class RequestFailed extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.failure = failure;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json', ...init.headers };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text.length > 0 ? (JSON.parse(text) as Record<string, JsonValue>) : {};
  if (!response.ok) {
    throw new RequestFailed({
      error: String(parsed.error ?? 'error'),
      message: String(parsed.message ?? 'Something went wrong.'),
      errors: (parsed.errors as Record<string, string> | undefined) ?? undefined,
      status: response.status,
    });
  }
  return parsed as T;
}

export interface ProjectSummary {
  id: string;
  name: string;
  workspaceId: string;
  status: string;
  role: 'Owner' | 'Editor' | 'Viewer';
  layerCount: number;
  liveVersion: number | null;
  editorCount: number;
  viewerCount: number;
  trashedAt: string | null;
  purgeAt: string | null;
}

export interface MeResponse {
  user: { id: string; name: string; email: string };
  workspaces: { id: string; name: string; role: string }[];
}

export interface VersionRecord {
  number: number;
  status: string;
  publishedAt: string;
  publishedBy: string;
  sha256: string;
  notice: 'sent' | 'queued';
}

export interface MemberRecord {
  personId: string;
  name: string;
  email: string;
  role: string;
}

export interface InviteRecord {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
}

export const api = {
  config: (): Promise<{ config: ClientConfig }> => request('GET', '/api/config'),
  me: (): Promise<MeResponse> => request('GET', '/api/me'),
  signIn: (email: string, password: string): Promise<MeResponse> =>
    request('POST', '/api/session', { email, password }),
  signOut: (): Promise<void> => request('DELETE', '/api/session'),
  projects: (status: 'active' | 'trashed'): Promise<{ projects: ProjectSummary[] }> =>
    request('GET', `/api/projects?status=${status}`),
  createProject: (workspaceId: string, name: string): Promise<{ project: ProjectSummary }> =>
    request('POST', '/api/projects', { workspaceId, name }),
  project: (
    id: string,
  ): Promise<{ project: ProjectSummary; document: SceneDocument; assets: AssetRecord[] }> =>
    request('GET', `/api/projects/${id}`),
  trashProject: (id: string): Promise<{ project: ProjectSummary }> =>
    request('DELETE', `/api/projects/${id}`),
  restoreProject: (id: string): Promise<{ project: ProjectSummary }> =>
    request('POST', `/api/projects/${id}/restore`, {}),
  ops: (
    id: string,
    body: { opId: string; sceneId: string; changes: JsonValue[] },
  ): Promise<{
    opId: string;
    seq: number;
    undoDepth: number;
    redoDepth: number;
    ids: Record<string, string>;
    variableDeleteCounts: Record<string, number>;
  }> => request('POST', `/api/projects/${id}/ops`, body),
  undo: (id: string, opId: string): Promise<{ undoDepth: number; redoDepth: number }> =>
    request('POST', `/api/projects/${id}/undo`, { opId }),
  redo: (id: string, opId: string): Promise<{ undoDepth: number; redoDepth: number }> =>
    request('POST', `/api/projects/${id}/redo`, { opId }),
  takeLock: (id: string, layerId: string): Promise<unknown> =>
    request('PUT', `/api/projects/${id}/layers/${layerId}/lock`),
  releaseLock: (id: string, layerId: string): Promise<void> =>
    request('DELETE', `/api/projects/${id}/layers/${layerId}/lock`),
  locks: (id: string): Promise<{ locks: { layerId: string; personId: string; name: string }[] }> =>
    request('GET', `/api/projects/${id}/locks`),
  versions: (id: string): Promise<{ versions: VersionRecord[] }> =>
    request('GET', `/api/projects/${id}/versions`),
  publish: (
    id: string,
    key: string,
    fromVersion?: number,
  ): Promise<{ version: VersionRecord }> =>
    request(
      'POST',
      `/api/projects/${id}/versions`,
      fromVersion === undefined ? {} : { fromVersion },
      { 'Idempotency-Key': key },
    ),
  members: (id: string): Promise<{ members: MemberRecord[]; invites: InviteRecord[] }> =>
    request('GET', `/api/projects/${id}/members`),
  invite: (id: string, email: string, role: string): Promise<{ invite: InviteRecord }> =>
    request('POST', `/api/projects/${id}/invites`, { email, role }),
  removeMember: (id: string, personId: string): Promise<void> =>
    request('DELETE', `/api/projects/${id}/members/${personId}`),
  invitePreview: (
    token: string,
  ): Promise<{ projectName: string; role: string; email: string; accountExists: boolean }> =>
    request('GET', `/api/invites/${token}`),
  acceptInvite: (
    token: string,
    body: Record<string, JsonValue>,
  ): Promise<{ projectId: string; role: string }> =>
    request('POST', `/api/invites/${token}/accept`, body),
  async upload(
    projectId: string,
    kind: 'image' | 'svg' | 'model',
    file: File,
  ): Promise<{ asset: AssetRecord }> {
    const form = new FormData();
    form.set('kind', kind);
    form.set('file', file);
    const response = await fetch(`/api/projects/${projectId}/assets`, {
      method: 'POST',
      body: form,
    });
    const parsed = (await response.json()) as Record<string, JsonValue>;
    if (!response.ok) {
      throw new RequestFailed({
        error: String(parsed.error ?? 'error'),
        message: String(parsed.message ?? 'Upload failed.'),
        errors: (parsed.errors as Record<string, string> | undefined) ?? undefined,
        status: response.status,
      });
    }
    return parsed as unknown as { asset: AssetRecord };
  },
  async importJson(workspaceId: string, file: File): Promise<{ project: ProjectSummary }> {
    const form = new FormData();
    form.set('workspaceId', workspaceId);
    form.set('file', file);
    const response = await fetch('/api/imports', { method: 'POST', body: form });
    const parsed = (await response.json()) as Record<string, JsonValue>;
    if (!response.ok) {
      throw new RequestFailed({
        error: String(parsed.error ?? 'error'),
        message: String(parsed.message ?? 'Import failed.'),
        errors: (parsed.errors as Record<string, string> | undefined) ?? undefined,
        status: response.status,
      });
    }
    return parsed as unknown as { project: ProjectSummary };
  },
};
