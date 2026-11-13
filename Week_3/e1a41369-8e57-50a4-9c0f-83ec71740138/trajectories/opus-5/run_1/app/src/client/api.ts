import type {
  ActionResult,
  ChatMessage,
  ImportRecord,
  Invite,
  LedgerEntry,
  Party,
  Player,
  Quest,
  Task,
  TaskLists,
} from '../shared/types.js';

export class ApiFailure extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(`request failed with ${status}`);
    this.status = status;
    this.body = body;
  }

  get name_(): string {
    return typeof this.body.error === 'string' ? this.body.error : '';
  }

  get fieldErrors(): Record<string, string> {
    const errors = this.body.errors;
    if (typeof errors !== 'object' || errors === null) return {};
    return errors as Record<string, string>;
  }
}

async function request<Result>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Result> {
  const init: RequestInit = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers = { ...init.headers, 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (response.status === 204) return undefined as Result;
  const text = await response.text();
  const parsed = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
  if (!response.ok) throw new ApiFailure(response.status, parsed);
  return parsed as Result;
}

export function newIdempotencyKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export const api = {
  me: () => request<Player>('GET', '/api/me'),
  signup: (username: string, password: string) =>
    request<Player>('POST', '/api/auth/signup', { username, password }),
  login: (username: string, password: string) =>
    request<Player>('POST', '/api/auth/login', { username, password }),
  logout: () => request<void>('POST', '/api/auth/logout'),
  settings: (patch: { timeZone?: string; dayStartHour?: number; resting?: boolean }) =>
    request<Player>('PATCH', '/api/settings', patch),
  ackNotice: (id: string) => request<void>('POST', `/api/notices/${id}/ack`),

  tasks: () => request<TaskLists>('GET', '/api/tasks'),
  createTask: (body: Record<string, unknown>) => request<Task>('POST', '/api/tasks', body),
  editTask: (id: string, body: Record<string, unknown>) => request<Task>('PATCH', `/api/tasks/${id}`, body),
  deleteTask: (id: string) => request<void>('DELETE', `/api/tasks/${id}`),
  moveTask: (id: string, position: number) =>
    request<{ tasks: Task[] }>('POST', `/api/tasks/${id}/move`, { position }),
  score: (id: string, direction: 'up' | 'down') =>
    request<ActionResult>('POST', `/api/tasks/${id}/score`, { direction }, {
      'Idempotency-Key': newIdempotencyKey(),
    }),
  complete: (id: string) =>
    request<ActionResult>('POST', `/api/tasks/${id}/complete`, {}, { 'Idempotency-Key': newIdempotencyKey() }),
  uncomplete: (id: string) =>
    request<ActionResult>('POST', `/api/tasks/${id}/uncomplete`, {}, { 'Idempotency-Key': newIdempotencyKey() }),
  checkItem: (taskId: string, itemId: string, checked: boolean) =>
    request<Task>('PATCH', `/api/tasks/${taskId}/checklist/${itemId}`, { checked }),
  buy: (id: string) =>
    request<ActionResult>('POST', `/api/rewards/${id}/buy`, {}, { 'Idempotency-Key': newIdempotencyKey() }),
  ledger: () => request<{ balance: number; entries: LedgerEntry[] }>('GET', '/api/gold/ledger'),

  party: () => request<{ party: Party | null }>('GET', '/api/party'),
  formParty: (name: string) => request<Party>('POST', '/api/parties', { name }),
  invite: (partyId: string, username: string) =>
    request<{ id: string }>('POST', `/api/parties/${partyId}/invites`, { username }),
  invites: () => request<{ invites: Invite[] }>('GET', '/api/invites'),
  acceptInvite: (id: string) => request<Party>('POST', `/api/invites/${id}/accept`),
  declineInvite: (id: string) => request<void>('POST', `/api/invites/${id}/decline`),
  leaveParty: (partyId: string) => request<void>('POST', `/api/parties/${partyId}/leave`),

  questFixtures: () =>
    request<{ quests: { name: string; boss: string; maxHealth: number }[] }>('GET', '/api/quest-fixtures'),
  inviteQuest: (partyId: string, quest: string) =>
    request<Quest>('POST', `/api/parties/${partyId}/quests`, { quest }),
  quest: (id: string) => request<Quest>('GET', `/api/quests/${id}`),
  acceptQuest: (id: string) => request<Quest>('POST', `/api/quests/${id}/accept`),
  declineQuest: (id: string) => request<Quest>('POST', `/api/quests/${id}/decline`),
  beginQuest: (id: string) => request<Quest>('POST', `/api/quests/${id}/begin`),
  abandonQuest: (id: string) => request<Quest>('POST', `/api/quests/${id}/abandon`),
  history: () => request<{ quests: Quest[] }>('GET', '/api/history'),

  chat: (partyId: string) => request<{ messages: ChatMessage[] }>('GET', `/api/parties/${partyId}/chat`),
  sendChat: (partyId: string, text: string) =>
    request<ChatMessage>('POST', `/api/parties/${partyId}/chat`, { text }),

  imports: () => request<{ imports: ImportRecord[] }>('GET', '/api/imports'),
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<ImportRecord>('POST', '/api/imports', form);
  },
  uploadBanner: (partyId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ bannerUrl: string }>('PUT', `/api/parties/${partyId}/banner`, form);
  },
};
