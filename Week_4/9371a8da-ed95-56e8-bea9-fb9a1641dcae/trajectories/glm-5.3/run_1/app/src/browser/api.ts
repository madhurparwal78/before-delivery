import type {
  UserShape, ProjectSummary, FileSummary, TextFile, Suggestion, Thread,
  LedgerEntry, Label, Member, Invite, ShareLink, CitationReport, ExportShape, Role,
} from '../shared/types.js';

export interface ApiErrorShape {
  status: number;
  code: string;
  errors?: Record<string, string>;
  current?: { file: TextFile };
  suggestion?: Suggestion;
  readiness?: { openSuggestions: number; openThreads: number; undefinedCitations: number; duplicateKeys: number };
  retryAfterSeconds?: number;
  status_word?: string;
  projectId?: string;
  statusText?: string;
}

export class ApiFailure {
  constructor(public shape: ApiErrorShape) {}
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body instanceof FormData
      ? init?.headers
      : { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try { body = JSON.parse(text); } catch { body = undefined; }
  }
  if (!res.ok) {
    throw new ApiFailure({
      status: res.status,
      code: (body as { error?: string } | undefined)?.error ?? 'network',
      errors: (body as { errors?: Record<string, string> } | undefined)?.errors,
      current: (body as { current?: { file: TextFile } } | undefined)?.current,
      suggestion: (body as { suggestion?: Suggestion } | undefined)?.suggestion,
      readiness: (body as { readiness?: ApiErrorShape['readiness'] } | undefined)?.readiness,
      retryAfterSeconds: (body as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds,
      projectId: (body as { projectId?: string } | undefined)?.projectId,
    });
  }
  return body as T;
}

export const getProjects = () => api<{ projects: ProjectSummary[] }>('/api/projects');
export const postSession = (email: string, password: string) =>
  api<{ user: UserShape }>('/api/session', { method: 'POST', body: JSON.stringify({ email, password }) });
export const deleteSession = () => api<void>('/api/session', { method: 'DELETE' });
export const getMe = () => api<{ user: UserShape; workspace: { id: string; name: string; role: string } | null }>('/api/me');
export const patchMe = (displayName: string) =>
  api<{ user: UserShape }>('/api/me', { method: 'PATCH', body: JSON.stringify({ displayName }) });
export const postProject = (title: string, template: string) =>
  api<{ project: ProjectSummary }>('/api/projects', { method: 'POST', body: JSON.stringify({ title, template }) });
export const getProject = (pid: string) =>
  api<{ project: ProjectSummary; files: FileSummary[] }>(`/api/projects/${pid}`);
export const getFile = (pid: string, fid: string) => api<{ file: FileSummary }>(`/api/projects/${pid}/files/${fid}`);
export const putFile = (pid: string, fid: string, content: string, baseRevision: number, idemKey?: string) =>
  api<{ file: TextFile; projectRevision: number }>(`/api/projects/${pid}/files/${fid}`, {
    method: 'PUT',
    headers: idemKey ? { 'Content-Type': 'application/json', 'Idempotency-Key': idemKey } : { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, baseRevision }),
  });
export const postFile = (pid: string, path: string, content: string) =>
  api<{ file: TextFile; projectRevision: number }>(`/api/projects/${pid}/files`, {
    method: 'POST', body: JSON.stringify({ path, content }),
  });
export const patchFile = (pid: string, fid: string, path: string) =>
  api<{ file: FileSummary; projectRevision: number }>(`/api/projects/${pid}/files/${fid}`, {
    method: 'PATCH', body: JSON.stringify({ path }),
  });
export const deleteFile = (pid: string, fid: string) =>
  api<{ projectRevision: number }>(`/api/projects/${pid}/files/${fid}`, { method: 'DELETE' });
export const uploadAsset = (pid: string, file: File, folder?: string) => {
  const form = new FormData();
  form.append('file', file);
  if (folder !== undefined) form.append('folder', folder);
  return api<{ file: FileSummary; projectRevision: number }>(`/api/projects/${pid}/assets`, {
    method: 'POST', body: form,
  });
};
export const getRevisionsN = (pid: string, n: number) =>
  api<{ projectRevision: number; files: { id: string; path: string; kind: string; size: number; sha256: string }[] }>(`/api/projects/${pid}/revisions/${n}`);

export const getReview = (pid: string) =>
  api<{ suggestions: Suggestion[]; threads: Thread[]; openSuggestions: number }>(`/api/projects/${pid}/review`);
export const postSuggestion = (pid: string, fid: string, baseRevision: number, from: number, to: number, inserted: string) =>
  api<{ suggestion: Suggestion }>(`/api/projects/${pid}/files/${fid}/suggestions`, {
    method: 'POST', body: JSON.stringify({ baseRevision, from, to, inserted }),
  });
export const postAccept = (pid: string, sid: string) =>
  api<{ suggestion: Suggestion; file: TextFile; projectRevision: number; openSuggestions: number }>(`/api/projects/${pid}/suggestions/${sid}/accept`, {
    method: 'POST', body: '{}',
  });
export const postReject = (pid: string, sid: string) =>
  api<{ suggestion: Suggestion; projectRevision: number; openSuggestions: number }>(`/api/projects/${pid}/suggestions/${sid}/reject`, {
    method: 'POST', body: '{}',
  });
export const postThread = (pid: string, fid: string, baseRevision: number, from: number, to: number, body: string) =>
  api<{ thread: Thread }>(`/api/projects/${pid}/files/${fid}/threads`, {
    method: 'POST', body: JSON.stringify({ baseRevision, from, to, body }),
  });
export const postComment = (pid: string, tid: string, body: string) =>
  api<{ comment: { id: string; author: { id: string; displayName: string; handle: string }; body: string; createdAt: string } }>(`/api/projects/${pid}/threads/${tid}/comments`, {
    method: 'POST', body: JSON.stringify({ body }),
  });
export const postResolve = (pid: string, tid: string) =>
  api<{ thread: Thread }>(`/api/projects/${pid}/threads/${tid}/resolve`, { method: 'POST', body: '{}' });

export const getHistory = (pid: string) =>
  api<{ entries: LedgerEntry[] }>(`/api/projects/${pid}/history`);
export const getLabels = (pid: string) => api<{ labels: Label[] }>(`/api/projects/${pid}/labels`);
export const postLabel = (pid: string, name: string, projectRevision?: number) =>
  api<{ label: Label }>(`/api/projects/${pid}/labels`, {
    method: 'POST', body: JSON.stringify(projectRevision === undefined ? { name } : { name, projectRevision }),
  });
export const postRestore = (pid: string, lid: string) =>
  api<{ projectRevision: number; entry: LedgerEntry }>(`/api/projects/${pid}/labels/${lid}/restore`, {
    method: 'POST', body: '{}',
  });
export const getCitations = (pid: string) => api<CitationReport>(`/api/projects/${pid}/citations`);
export const postExport = (pid: string) =>
  api<{ export: ExportShape }>(`/api/projects/${pid}/exports`, { method: 'POST', body: '{}' });

export const getMembers = (pid: string) => api<{ members: Member[] }>(`/api/projects/${pid}/members`);
export const patchMember = (pid: string, uid: string, role: Role) =>
  api<{ member: Member }>(`/api/projects/${pid}/members/${uid}`, { method: 'PATCH', body: JSON.stringify({ role }) });
export const deleteMember = (pid: string, uid: string) =>
  api<void>(`/api/projects/${pid}/members/${uid}`, { method: 'DELETE' });
export const getInvites = (pid: string) => api<{ invites: Invite[] }>(`/api/projects/${pid}/invites`);
export const postInvite = (pid: string, email: string, role: Role) =>
  api<{ invite: Invite }>(`/api/projects/${pid}/invites`, { method: 'POST', body: JSON.stringify({ email, role }) });
export const postRevokeInvite = (pid: string, iid: string) =>
  api<{ invite: Invite }>(`/api/projects/${pid}/invites/${iid}/revoke`, { method: 'POST', body: '{}' });
export const getInviteToken = (token: string) =>
  api<{ invite: { projectTitle: string; role: Role; inviterName: string; email: string; expiresAt: string } }>(`/api/invites/${token}`);
export const postAcceptInvite = (token: string, displayName: string, password: string) =>
  api<{ user: UserShape; projectId: string; role: Role }>(`/api/invites/${token}/accept`, {
    method: 'POST', body: JSON.stringify({ displayName, password }),
  });

export const getShareLink = (pid: string) => api<{ shareLink: ShareLink | null }>(`/api/projects/${pid}/share-link`);
export const postShareLink = (pid: string) => api<{ shareLink: ShareLink }>(`/api/projects/${pid}/share-link`, { method: 'POST', body: '{}' });
export const deleteShareLink = (pid: string) => api<void>(`/api/projects/${pid}/share-link`, { method: 'DELETE' });

// Share draft
export const getShareProject = (token: string) =>
  api<{ project: { title: string; projectRevision: number }; files: FileSummary[] }>(`/api/share/${token}`);
export const getShareFile = (token: string, fid: string) =>
  api<{ file: FileSummary }>(`/api/share/${token}/files/${fid}`);
export const getShareReview = (token: string) =>
  api<{ suggestions: Suggestion[]; threads: Thread[]; openSuggestions: number }>(`/api/share/${token}/review`);
export const getShareCitations = (token: string) => api<CitationReport>(`/api/share/${token}/citations`);
