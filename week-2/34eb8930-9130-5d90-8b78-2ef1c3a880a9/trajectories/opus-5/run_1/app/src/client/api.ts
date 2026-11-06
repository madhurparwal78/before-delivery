import type { Comment, DocumentSummary, Notice, Person, ShareEntry, Snapshot } from '../shared/types.js';

export interface ApiFailure {
  status: number;
  code: string;
  fields?: Record<string, string>;
}

export class ApiError extends Error implements ApiFailure {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(failure: ApiFailure) {
    super(failure.code);
    this.status = failure.status;
    this.code = failure.code;
    if (failure.fields) this.fields = failure.fields;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new ApiError({
      status: response.status,
      code: typeof payload.error === 'string' ? payload.error : 'invalid',
      fields: payload.fields as Record<string, string> | undefined,
    });
  }
  return payload as T;
}

export interface SessionPerson {
  personId: string;
  displayName: string;
  email: string;
  colour: string;
  isConsultant: boolean;
}

export const api = {
  signIn: (email: string, password: string) => request<{ person: SessionPerson }>('POST', '/api/session', { email, password }),
  session: () => request<{ person: SessionPerson }>('GET', '/api/session'),
  signOut: () => request<void>('DELETE', '/api/session'),
  documents: (view?: 'recent' | 'mine' | 'shared', q?: string) => {
    const params = new URLSearchParams();
    if (view) params.set('view', view);
    if (q) params.set('q', q);
    const query = params.toString();
    return request<{ documents: DocumentSummary[] }>('GET', `/api/documents${query ? `?${query}` : ''}`);
  },
  createDocument: (title: string, client: string) => request<DocumentSummary>('POST', '/api/documents', { title, client }),
  snapshot: (id: string) => request<Snapshot>('GET', `/api/documents/${encodeURIComponent(id)}`),
  renameDocument: (id: string, body: { title?: string; client?: string }) =>
    request<DocumentSummary>('PATCH', `/api/documents/${encodeURIComponent(id)}`, body),
  deleteDocument: (id: string) => request<void>('DELETE', `/api/documents/${encodeURIComponent(id)}`),
  shares: (id: string) => request<{ shares: ShareEntry[] }>('GET', `/api/documents/${encodeURIComponent(id)}/shares`),
  addShare: (id: string, body: { email: string; role: string; endsAt: string | null }) =>
    request<ShareEntry>('POST', `/api/documents/${encodeURIComponent(id)}/shares`, body),
  patchShare: (id: string, shareId: string, body: { role?: string; endsAt?: string | null }) =>
    request<ShareEntry>('PATCH', `/api/documents/${encodeURIComponent(id)}/shares/${encodeURIComponent(shareId)}`, body),
  removeShare: (id: string, shareId: string) =>
    request<void>('DELETE', `/api/documents/${encodeURIComponent(id)}/shares/${encodeURIComponent(shareId)}`),
  people: (id: string, q: string) =>
    request<{ people: Person[] }>('GET', `/api/documents/${encodeURIComponent(id)}/people?q=${encodeURIComponent(q)}`),
  comment: (id: string, body: { anchor?: { at: number; length: number } | null; body: string; mentions: string[]; parentId?: string }) =>
    request<Comment>('POST', `/api/documents/${encodeURIComponent(id)}/comments`, body),
  resolveComment: (id: string, commentId: string) =>
    request<Comment>('POST', `/api/documents/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}/resolve`, {}),
  reopenComment: (id: string, commentId: string) =>
    request<Comment>('POST', `/api/documents/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}/reopen`, {}),
  notices: () => request<{ unread: number; notices: Notice[] }>('GET', '/api/notices'),
  readNotice: (noticeId: string) => request<Notice>('POST', `/api/notices/${encodeURIComponent(noticeId)}/read`, {}),
};
