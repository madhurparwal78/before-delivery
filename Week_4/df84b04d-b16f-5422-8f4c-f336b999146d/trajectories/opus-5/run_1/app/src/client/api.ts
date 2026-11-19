import type {
  Bullet,
  MeResponse,
  OutlineView,
  SearchResult,
  ShareRow,
  Suggestion
} from '../shared/types.js';

export interface ApiFailure {
  status: number;
  error?: string;
  message?: string;
  errors?: Record<string, string>;
  current?: { text: string; revision: number };
  editor?: { name: string };
}

export class ApiCallError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure.message ?? failure.error ?? 'request failed');
  }
}

async function call<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
  if (!response.ok) {
    throw new ApiCallError({ status: response.status, ...parsed });
  }
  return parsed as T;
}

export const api = {
  me: () => call<MeResponse>('GET', '/api/me'),
  setHideCompleted: (hideCompleted: boolean) =>
    call<MeResponse>('PATCH', '/api/me', { hideCompleted }),
  signUp: (name: string, email: string, password: string) =>
    call<{ status: string }>('POST', '/api/signup', { name, email, password }),
  confirm: (email: string, code: string) =>
    call<{ user: { id: string } }>('POST', '/api/signup/confirm', { email, code }),
  signIn: (email: string, password: string) =>
    call<{ user: { id: string } }>('POST', '/api/session', { email, password }),
  signOut: () => call<void>('DELETE', '/api/session'),
  outline: (root: string | null) =>
    call<OutlineView>('GET', `/api/outline${root === null ? '' : `?root=${encodeURIComponent(root)}`}`),
  bullet: (id: string) => call<{ bullet: Bullet }>('GET', `/api/bullets/${encodeURIComponent(id)}`),
  create: (input: {
    parentId: string | null;
    afterId: string | null;
    text: string;
    splitFrom?: { id: string; text: string; revision: number };
  }) => call<{ bullet: Bullet; seq: number }>('POST', '/api/bullets', { ...input }),
  patch: (id: string, input: Record<string, unknown>) =>
    call<{ bullet: Bullet; seq: number }>('PATCH', `/api/bullets/${encodeURIComponent(id)}`, input),
  remove: (id: string) =>
    call<{ result: string; count: number; seq: number }>(
      'DELETE',
      `/api/bullets/${encodeURIComponent(id)}`
    ),
  move: (id: string, request: Record<string, unknown>) =>
    call<{ bullet: Bullet; seq: number }>(
      'POST',
      `/api/bullets/${encodeURIComponent(id)}/move`,
      request
    ),
  mirror: (id: string, request: Record<string, unknown> = {}) =>
    call<{ bullet: Bullet; seq: number }>(
      'POST',
      `/api/bullets/${encodeURIComponent(id)}/mirror`,
      request
    ),
  undo: (root: string | null) =>
    call<{ step: string; bulletId: string; seq: number }>(
      'POST',
      `/api/undo${root === null ? '' : `?root=${encodeURIComponent(root)}`}`,
      {}
    ),
  redo: (root: string | null) =>
    call<{ step: string; bulletId: string; seq: number }>(
      'POST',
      `/api/redo${root === null ? '' : `?root=${encodeURIComponent(root)}`}`,
      {}
    ),
  search: (query: string, root: string | null) =>
    call<SearchResult>(
      'GET',
      `/api/search?q=${encodeURIComponent(query)}${root === null ? '' : `&root=${encodeURIComponent(root)}`}`
    ),
  suggest: (kind: 'tag' | 'mention', prefix: string, root: string | null) =>
    call<{ suggestions: Suggestion[] }>(
      'GET',
      `/api/suggest?kind=${kind}&prefix=${encodeURIComponent(prefix)}${root === null ? '' : `&root=${encodeURIComponent(root)}`}`
    ),
  shares: (bulletId: string) =>
    call<{ shares: ShareRow[] }>('GET', `/api/bullets/${encodeURIComponent(bulletId)}/shares`),
  invite: (bulletId: string, email: string) =>
    call<{ share: ShareRow }>('POST', `/api/bullets/${encodeURIComponent(bulletId)}/shares`, {
      email
    }),
  retryInvite: (shareId: string) =>
    call<{ share: ShareRow }>('POST', `/api/shares/${encodeURIComponent(shareId)}/retry`, {}),
  removeShare: (shareId: string) =>
    call<{ share: ShareRow }>('DELETE', `/api/shares/${encodeURIComponent(shareId)}`),
  invitation: (token: string) =>
    call<{ email: string; bulletText: string; inviter: { name: string }; status: string }>(
      'GET',
      `/api/invitations/${encodeURIComponent(token)}`
    ),
  acceptInvitation: (token: string) =>
    call<{ bulletId: string }>(
      'POST',
      `/api/invitations/${encodeURIComponent(token)}/accept`,
      {}
    )
};

export function failureOf(error: unknown): ApiFailure | null {
  return error instanceof ApiCallError ? error.failure : null;
}
