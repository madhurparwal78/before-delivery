export type PersonObject = { personId: string; displayName: string; colour: string; role?: string };

export type SessionPerson = {
  personId: string;
  displayName: string;
  email: string;
  colour: string;
  isConsultant: boolean;
};

export type DocumentSummary = {
  id: string;
  title: string;
  client: string;
  role: string;
  updatedAt: string;
  owner: PersonObject;
};

export type Span = { at: number; length: number };

export type SnapshotSuggestion = {
  id: string;
  kind: 'insert' | 'delete' | 'replace';
  author: PersonObject;
  inserted: Span | null;
  deleted: Span | null;
  contentDeleted: boolean;
  status: string;
  createdAt: string;
};

export type SnapshotComment = {
  id: string;
  author: PersonObject;
  body: string;
  mentions: PersonObject[];
  anchor: Span | null;
  contentDeleted: boolean;
  status: string;
  replies: { id: string; author: PersonObject; body: string; createdAt: string }[];
  createdAt: string;
};

export type Snapshot = {
  id: string;
  title: string;
  client: string;
  revision: number;
  savedRevision: number;
  saveState: 'saved' | 'saving' | 'failed';
  myAccess: { role: string; mode: 'editing' | 'suggesting' | 'viewing'; accessEndsAt: string | null };
  text: string;
  blocks: { style: string; at: number; length: number }[];
  marks: { type: string; at: number; length: number; href?: string }[];
  suggestions: SnapshotSuggestion[];
  comments: SnapshotComment[];
  people: PersonObject[];
};

export type Notice = {
  id: string;
  kind: string;
  documentId: string;
  documentTitle: string;
  actor: PersonObject | null;
  role?: string;
  commentId?: string;
  text: string;
  read: boolean;
  createdAt: string;
};

export class ApiError extends Error {
  constructor(public status: number, public code: string, public fields?: Record<string, string>) {
    super(code);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = data as { error?: string; fields?: Record<string, string> } | null;
    throw new ApiError(res.status, err?.error ?? 'error', err?.fields);
  }
  return data as T;
}

export const api = {
  session: (): Promise<{ person: SessionPerson }> => request('GET', '/api/session'),
  signIn: (email: string, password: string): Promise<{ person: SessionPerson }> => request('POST', '/api/session', { email, password }),
  signOut: (): Promise<void> => request('DELETE', '/api/session'),
  documents: (view?: string, q?: string): Promise<{ documents: DocumentSummary[] }> =>
    request('GET', `/api/documents?${view ? `view=${view}&` : ''}${q !== undefined ? `q=${encodeURIComponent(q)}` : ''}`),
  createDocument: (title: string, client: string): Promise<DocumentSummary> =>
    request('POST', '/api/documents', { title, client }),
  snapshot: (id: string): Promise<Snapshot> => request('GET', `/api/documents/${id}`),
  patchDocument: (id: string, patch: { title?: string; client?: string }): Promise<DocumentSummary> =>
    request('PATCH', `/api/documents/${id}`, patch),
  deleteDocument: (id: string): Promise<void> => request('DELETE', `/api/documents/${id}`),
  shares: (id: string): Promise<{ shares: Record<string, unknown>[] }> => request('GET', `/api/documents/${id}/shares`),
  addShare: (id: string, email: string, role: string, endsAt: string | null): Promise<Record<string, unknown>> =>
    request('POST', `/api/documents/${id}/shares`, { email, role, endsAt }),
  updateShare: (id: string, shareId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> =>
    request('PATCH', `/api/documents/${id}/shares/${shareId}`, patch),
  removeShare: (id: string, shareId: string): Promise<void> => request('DELETE', `/api/documents/${id}/shares/${shareId}`),
  people: (id: string, q?: string): Promise<{ people: PersonObject[] }> =>
    request('GET', `/api/documents/${id}/people${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  decide: (id: string, suggestionId: string, decision: string): Promise<Record<string, unknown>> =>
    request('POST', `/api/documents/${id}/suggestions/${suggestionId}/decision`, { decision }),
  decideAll: (id: string, decision: string): Promise<Record<string, unknown>> =>
    request('POST', `/api/documents/${id}/decisions`, { decision }),
  addComment: (id: string, body: unknown): Promise<SnapshotComment> =>
    request('POST', `/api/documents/${id}/comments`, body),
  resolveComment: (id: string, commentId: string): Promise<SnapshotComment> =>
    request('POST', `/api/documents/${id}/comments/${commentId}/resolve`, {}),
  reopenComment: (id: string, commentId: string): Promise<SnapshotComment> =>
    request('POST', `/api/documents/${id}/comments/${commentId}/reopen`, {}),
  notices: (): Promise<{ unread: number; notices: Notice[] }> => request('GET', '/api/notices'),
  readNotice: (noticeId: string): Promise<Notice> => request('POST', `/api/notices/${noticeId}/read`, {}),
};
