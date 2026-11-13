import type {
  ApiErrorBody,
  BoardPayload,
  BoardSummary,
  Card,
  PermissionLogEntry,
  Role,
  SearchReply,
} from '../shared/protocol.js';

export interface ApiReply<T> {
  status: number;
  body: T;
  headers: Record<string, string>;
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<ApiReply<T>> {
  const isJson = body !== undefined;
  const response = await fetch(path, {
    method,
    headers: {
      ...(isJson ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders,
    },
    body: isJson ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return { status: response.status, body: parsed as T, headers };
}

export interface CardWriteResult {
  ok: boolean;
  card?: Card;
  counts?: { listId: string; count: number }[];
  openCards?: number;
  error?: ApiErrorBody;
}

export interface ReplyOutcome<T> {
  status: number;
  body: T | ApiErrorBody;
}

export const api = {
  signIn(email: string, password: string, next?: string): Promise<ApiReply<{ user: { userId: string; displayName: string; initials: string; colour: string }; redirectTo: string } | ApiErrorBody>> {
    return request('POST', '/api/session', { email, password, ...(next !== undefined ? { next } : {}) });
  },
  signOut(): Promise<ApiReply<null>> {
    return request('DELETE', '/api/session');
  },
  me(): Promise<ApiReply<{ userId: string; displayName: string; initials: string; colour: string; email: string; workspaces: { id: string; name: string; parentName: string; timeZone: string; role: string }[] } | ApiErrorBody>> {
    return request('GET', '/api/me');
  },
  changePassword(currentPassword: string, newPassword: string): Promise<ApiReply<{ signedOutSessions: number } | ApiErrorBody>> {
    return request('POST', '/api/account/password', { currentPassword, newPassword });
  },
  serviceStatus(): Promise<ApiReply<{ live: string; storage: string } | ApiErrorBody>> {
    return request('GET', '/api/service-status');
  },
  workspaceBoards(workspaceId: string): Promise<ApiReply<{ boards: BoardSummary[] } | ApiErrorBody>> {
    return request('GET', `/api/workspaces/${encodeURIComponent(workspaceId)}/boards`);
  },
  board(boardId: string, listParam?: string): Promise<ApiReply<BoardPayload | ApiErrorBody>> {
    const suffix = listParam ? `?list=${encodeURIComponent(listParam)}` : '';
    return request('GET', `/api/boards/${encodeURIComponent(boardId)}${suffix}`);
  },
  boardMembers(boardId: string): Promise<ApiReply<{ members: { displayName: string; initials: string; colour: string; userId?: string; role?: Role; phone?: string; email?: string }[] } | ApiErrorBody>> {
    return request('GET', `/api/boards/${encodeURIComponent(boardId)}/members`);
  },
  boardCandidates(boardId: string): Promise<ApiReply<{ people: { userId: string; displayName: string }[] } | ApiErrorBody>> {
    return request('GET', `/api/boards/${encodeURIComponent(boardId)}/candidates`);
  },
  addBoardMember(boardId: string, userId: string, role: Role): Promise<ApiReply<unknown | ApiErrorBody>> {
    return request('POST', `/api/boards/${encodeURIComponent(boardId)}/members`, { userId, role });
  },
  changeBoardMemberRole(boardId: string, userId: string, role: Role): Promise<ApiReply<unknown | ApiErrorBody>> {
    return request('PATCH', `/api/boards/${encodeURIComponent(boardId)}/members/${encodeURIComponent(userId)}`, { role });
  },
  removeBoardMember(boardId: string, userId: string): Promise<ApiReply<unknown | ApiErrorBody>> {
    return request('DELETE', `/api/boards/${encodeURIComponent(boardId)}/members/${encodeURIComponent(userId)}`);
  },
  patchBoard(boardId: string, changes: { name?: string; visibility?: string }): Promise<ApiReply<{ board: { id: string; name: string; visibility: string } } | ApiErrorBody>> {
    return request('PATCH', `/api/boards/${encodeURIComponent(boardId)}`, changes);
  },
  createBoard(workspaceId: string, name: string, visibility: 'workspace' | 'private'): Promise<ApiReply<{ board: { id: string; name: string; visibility: string } } | ApiErrorBody>> {
    return request('POST', `/api/workspaces/${encodeURIComponent(workspaceId)}/boards`, { name, visibility });
  },
  createList(boardId: string, name: string): Promise<ApiReply<{ list: { id: string; name: string; count: number; cards: never[] } } | ApiErrorBody>> {
    return request('POST', `/api/boards/${encodeURIComponent(boardId)}/lists`, { name });
  },
  renameList(listId: string, name: string): Promise<ApiReply<{ list: { id: string; name: string } } | ApiErrorBody>> {
    return request('PATCH', `/api/lists/${encodeURIComponent(listId)}`, { name });
  },
  createCard(listId: string, title: string, idempotencyKey?: string): Promise<ApiReply<{ card: Card; counts: { listId: string; count: number }[]; openCards: number } | ApiErrorBody>> {
    return request('POST', `/api/lists/${encodeURIComponent(listId)}/cards`, { title }, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined);
  },
  getCard(cardId: string): Promise<ApiReply<{ card: Card } | ApiErrorBody>> {
    return request('GET', `/api/cards/${encodeURIComponent(cardId)}`);
  },
  saveCard(cardId: string, version: number, fields: Record<string, unknown>): Promise<ApiReply<{ card: Card } | ApiErrorBody>> {
    return request('PATCH', `/api/cards/${encodeURIComponent(cardId)}`, { version, ...fields });
  },
  moveCard(cardId: string, toListId: string, position: number, version: number): Promise<ApiReply<{ card: Card; counts: { listId: string; count: number }[]; openCards: number } | ApiErrorBody>> {
    return request('POST', `/api/cards/${encodeURIComponent(cardId)}/move`, { toListId, position, version });
  },
  setCardStatus(cardId: string, status: string, version: number): Promise<ApiReply<{ card: Card; counts: { listId: string; count: number }[]; openCards: number } | ApiErrorBody>> {
    return request('POST', `/api/cards/${encodeURIComponent(cardId)}/status`, { status, version });
  },
  setPrivateMembers(cardId: string, userIds: string[]): Promise<ApiReply<{ card: Card } | ApiErrorBody>> {
    return request('PUT', `/api/cards/${encodeURIComponent(cardId)}/private-members`, { userIds });
  },
  deleteCard(cardId: string): Promise<ApiReply<null | ApiErrorBody>> {
    return request('DELETE', `/api/cards/${encodeURIComponent(cardId)}`);
  },
  addChecklistItem(cardId: string, text: string): Promise<ApiReply<{ item: { id: string; text: string; done: boolean } } | ApiErrorBody>> {
    return request('POST', `/api/cards/${encodeURIComponent(cardId)}/checklist`, { text });
  },
  updateChecklistItem(itemId: string, changes: { text?: string; done?: boolean }): Promise<ApiReply<{ item: { id: string; text: string; done: boolean } } | ApiErrorBody>> {
    return request('PATCH', `/api/checklist-items/${encodeURIComponent(itemId)}`, changes);
  },
  deleteChecklistItem(itemId: string): Promise<ApiReply<null | ApiErrorBody>> {
    return request('DELETE', `/api/checklist-items/${encodeURIComponent(itemId)}`);
  },
  search(workspaceId: string, q: string): Promise<ApiReply<SearchReply | ApiErrorBody>> {
    return request('GET', `/api/workspaces/${encodeURIComponent(workspaceId)}/search?q=${encodeURIComponent(q)}`);
  },
  permissionLog(workspaceId: string): Promise<ApiReply<{ entries: PermissionLogEntry[] } | ApiErrorBody>> {
    return request('GET', `/api/workspaces/${encodeURIComponent(workspaceId)}/permission-log`);
  },
  uploadAttachment(cardId: string, file: File): Promise<ApiReply<{ attachment: { id: string; filename: string; contentType: string; size: number; uploadedAt: string; uploadedBy: { displayName: string } } } | ApiErrorBody>> {
    return new Promise((resolve) => {
      const form = new FormData();
      form.append('file', file);
      void fetch(`/api/cards/${encodeURIComponent(cardId)}/attachments`, {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
      }).then(async (response) => {
        const text = await response.text();
        let parsed: unknown = null;
        if (text.length > 0) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = null;
          }
        }
        resolve({ status: response.status, body: parsed as never, headers: {} });
      }).catch(() => {
        resolve({ status: 0, body: { error: 'network' } as ApiErrorBody, headers: {} });
      });
    });
  },
  deleteAttachment(attachmentId: string): Promise<ApiReply<null | ApiErrorBody>> {
    return request('DELETE', `/api/attachments/${encodeURIComponent(attachmentId)}`);
  },
};

export function isApiError(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && 'error' in value;
}
