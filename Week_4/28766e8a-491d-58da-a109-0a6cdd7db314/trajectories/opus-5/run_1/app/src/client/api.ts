import type { DiagramDocument, Role } from '../shared/document.js';

export interface ApiFailure {
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
}

export class ApiRequestError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.failure = failure;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const payload: unknown = text.length === 0 ? null : JSON.parse(text);
  if (!response.ok) {
    const error =
      payload !== null && typeof payload === 'object' && 'error' in payload
        ? (payload as { error: { code: string; message: string; fields?: Record<string, string> } }).error
        : { code: 'internal', message: 'Something went wrong.' };
    throw new ApiRequestError({ status: response.status, ...error });
  }
  return payload as T;
}

export interface Me {
  user: { id: string; email: string; name: string };
}

export interface DiagramListItem {
  id: string;
  title: string;
  role: Role;
  updatedAt: string;
}

export interface MemberRecord {
  userId: string;
  email: string;
  name: string;
  role: Role;
  status: 'active';
}

export interface InviteRecord {
  id: string;
  email: string;
  role: 'editor' | 'viewer';
  status: 'emailed' | 'email_not_sent' | 'expired';
  expiresAt: string;
}

export interface CommentRecord {
  id: string;
  shape: string;
  page: string;
  author: { id: string; name: string };
  text: string;
  resolved: boolean;
  anchored: boolean;
  parent: string | null;
  createdAt: string;
}

export interface VersionRecord {
  id: string;
  number: number;
  name: string | null;
  displayName: string;
  author: { id: string; name: string };
  createdAt: string;
  seq: number;
}

export interface ExportRecord {
  id: string;
  status: 'rendering' | 'ready' | 'storage_unavailable';
  format: 'png' | 'svg';
  page: string;
  seq: number;
  requestedBy: string;
  width: number | null;
  height: number | null;
  createdAt: string;
}

export const api = {
  me: () => request<Me>('GET', '/api/me'),
  signIn: (email: string, password: string) =>
    request<Me>('POST', '/api/auth/signin', { email, password }),
  signUp: (name: string, email: string, password: string) =>
    request<Me>('POST', '/api/auth/signup', { name, email, password }),
  signOut: () => request<void>('POST', '/api/auth/signout'),

  diagrams: () => request<{ diagrams: DiagramListItem[] }>('GET', '/api/diagrams'),
  createDiagram: (title: string) =>
    request<{ diagram: { id: string; title: string }; document: DiagramDocument }>(
      'POST',
      '/api/diagrams',
      { title },
    ),
  document: (diagramId: string) =>
    request<DiagramDocument>('GET', `/api/diagrams/${diagramId}/document`),

  members: (diagramId: string) =>
    request<{ members: MemberRecord[]; invites: InviteRecord[] }>(
      'GET',
      `/api/diagrams/${diagramId}/members`,
    ),
  invite: (diagramId: string, email: string, role: 'editor' | 'viewer') =>
    request<{ invite: InviteRecord }>('POST', `/api/diagrams/${diagramId}/invites`, { email, role }),
  resendInvite: (diagramId: string, inviteId: string) =>
    request<{ invite: InviteRecord }>(
      'POST',
      `/api/diagrams/${diagramId}/invites/${inviteId}/resend`,
    ),
  revokeInvite: (diagramId: string, inviteId: string) =>
    request<void>('DELETE', `/api/diagrams/${diagramId}/invites/${inviteId}`),
  setMemberRole: (diagramId: string, userId: string, role: 'editor' | 'viewer') =>
    request<{ member: MemberRecord }>('PATCH', `/api/diagrams/${diagramId}/members/${userId}`, { role }),
  removeMember: (diagramId: string, userId: string) =>
    request<void>('DELETE', `/api/diagrams/${diagramId}/members/${userId}`),

  comments: (diagramId: string) =>
    request<{ comments: CommentRecord[] }>('GET', `/api/diagrams/${diagramId}/comments`),
  addComment: (diagramId: string, shape: string, text: string, parent: string | null) =>
    request<{ comment: CommentRecord }>('POST', `/api/diagrams/${diagramId}/comments`, {
      shape,
      text,
      parent,
    }),
  resolveComment: (diagramId: string, commentId: string) =>
    request<{ comment: CommentRecord }>(
      'POST',
      `/api/diagrams/${diagramId}/comments/${commentId}/resolve`,
    ),

  versions: (diagramId: string) =>
    request<{ versions: VersionRecord[] }>('GET', `/api/diagrams/${diagramId}/versions`),
  saveVersion: (diagramId: string, name: string | null) =>
    request<{ version: VersionRecord }>('POST', `/api/diagrams/${diagramId}/versions`, { name }),
  version: (diagramId: string, versionId: string) =>
    request<{ version: VersionRecord; document: DiagramDocument }>(
      'GET',
      `/api/diagrams/${diagramId}/versions/${versionId}`,
    ),
  restoreVersion: (diagramId: string, versionId: string) =>
    request<{ version: VersionRecord; seq: number }>(
      'POST',
      `/api/diagrams/${diagramId}/versions/${versionId}/restore`,
    ),

  exports: (diagramId: string) =>
    request<{ exports: ExportRecord[] }>('GET', `/api/diagrams/${diagramId}/exports`),
  createExport: (
    diagramId: string,
    settings: { page: string; format: 'png' | 'svg'; scale: 1 | 2; background: 'white' | 'transparent' },
  ) => request<ExportRecord>('POST', `/api/diagrams/${diagramId}/exports`, settings),
  exportState: (exportId: string) => request<ExportRecord>('GET', `/api/exports/${exportId}`),
  retryExport: (exportId: string) => request<ExportRecord>('POST', `/api/exports/${exportId}/retry`),
};
