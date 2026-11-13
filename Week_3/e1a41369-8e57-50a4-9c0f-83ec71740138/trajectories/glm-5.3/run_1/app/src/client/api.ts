import { QUEST_FIXTURES, WEEKDAYS, bandOf, experienceToLevel, type Band, type Difficulty, type TaskType, type Weekday } from '../shared/rules.js';
import type { ChatMessage, ImportRecord, Party, Player, Quest, StrikeEvent, Task, LedgerEntry, ActionResult, Notice } from '../shared/types.js';

export type { ChatMessage, ImportRecord, Party, Player, Quest, StrikeEvent, Task, LedgerEntry, ActionResult, Notice };
export { QUEST_FIXTURES, WEEKDAYS, bandOf, experienceToLevel };
export type { Band, Difficulty, TaskType, Weekday };

export interface TasksBody {
  habits: Task[];
  dailies: Task[];
  todos: Task[];
  rewards: Task[];
}

export interface ApiErrorBody {
  error?: string;
  errors?: Record<string, string>;
}

export class ApiFailure extends Error {
  status: number;
  body: ApiErrorBody;
  constructor(status: number, body: ApiErrorBody) {
    super(`request failed with ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new ApiFailure(res.status, body ?? {});
  }
  return body as T;
}

export const api = {
  signup: (username: string, password: string) =>
    request<Player>('/api/auth/signup', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) =>
    request<Player>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  me: () => request<Player>('/api/me'),
  settings: (patch: { timeZone?: string; dayStartHour?: number; resting?: boolean }) =>
    request<Player>('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
  ackNotice: (id: string) => request<void>(`/api/notices/${id}/ack`, { method: 'POST' }),
  tasks: () => request<TasksBody>('/api/tasks'),
  createTask: (body: Record<string, unknown>) =>
    request<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(body) }),
  editTask: (id: string, body: Record<string, unknown>) =>
    request<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTask: (id: string) => request<void>(`/api/tasks/${id}`, { method: 'DELETE' }),
  moveTask: (id: string, position: number) =>
    request<{ tasks: Task[] }>(`/api/tasks/${id}/move`, { method: 'POST', body: JSON.stringify({ position }) }),
  score: (id: string, direction: 'up' | 'down', idemKey?: string) =>
    request<ActionResult>(`/api/tasks/${id}/score`, {
      method: 'POST',
      headers: idemKey ? { 'Idempotency-Key': idemKey } : undefined,
      body: JSON.stringify({ direction }),
    }),
  complete: (id: string, idemKey?: string) =>
    request<ActionResult>(`/api/tasks/${id}/complete`, {
      method: 'POST',
      headers: idemKey ? { 'Idempotency-Key': idemKey } : undefined,
      body: JSON.stringify({}),
    }),
  uncomplete: (id: string, idemKey?: string) =>
    request<ActionResult>(`/api/tasks/${id}/uncomplete`, {
      method: 'POST',
      headers: idemKey ? { 'Idempotency-Key': idemKey } : undefined,
      body: JSON.stringify({}),
    }),
  tickChecklist: (taskId: string, itemId: string, checked: boolean) =>
    request<Task>(`/api/tasks/${taskId}/checklist/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ checked }),
    }),
  buy: (id: string, idemKey?: string) =>
    request<ActionResult>(`/api/rewards/${id}/buy`, {
      method: 'POST',
      headers: idemKey ? { 'Idempotency-Key': idemKey } : undefined,
      body: JSON.stringify({}),
    }),
  ledger: () => request<{ balance: number; entries: LedgerEntry[] }>('/api/gold/ledger'),
  party: () => request<{ party: Party | null }>('/api/party'),
  formParty: (name: string) =>
    request<Party>('/api/parties', { method: 'POST', body: JSON.stringify({ name }) }),
  invite: (partyId: string, username: string) =>
    request<{ id: string; party: Party; username: string }>(`/api/parties/${partyId}/invites`, {
      method: 'POST',
      body: JSON.stringify({ username }),
    }),
  invites: () => request<{ invites: { id: string; partyId: string; partyName: string; from: string }[] }>('/api/invites'),
  acceptInvite: (id: string) => request<Party>(`/api/invites/${id}/accept`, { method: 'POST' }),
  declineInvite: (id: string) => request<void>(`/api/invites/${id}/decline`, { method: 'POST' }),
  leaveParty: (partyId: string) => request<void>(`/api/parties/${partyId}/leave`, { method: 'POST' }),
  questFixtures: () =>
    request<{
      quests: { name: string; boss: string; maxHealth: number; power: number; rewardGold: number; rewardExperience: number }[];
    }>('/api/quest-fixtures'),
  inviteQuest: (partyId: string, quest: string) =>
    request<Quest>(`/api/parties/${partyId}/quests`, { method: 'POST', body: JSON.stringify({ quest }) }),
  quest: (id: string) => request<Quest>(`/api/quests/${id}`),
  acceptQuest: (id: string) => request<Quest>(`/api/quests/${id}/accept`, { method: 'POST' }),
  declineQuest: (id: string) => request<Quest>(`/api/quests/${id}/decline`, { method: 'POST' }),
  beginQuest: (id: string) => request<Quest>(`/api/quests/${id}/begin`, { method: 'POST' }),
  abandonQuest: (id: string) => request<Quest>(`/api/quests/${id}/abandon`, { method: 'POST' }),
  chat: (partyId: string) => request<{ messages: ChatMessage[] }>(`/api/parties/${partyId}/chat`),
  sendChat: (partyId: string, text: string) =>
    request<ChatMessage>(`/api/parties/${partyId}/chat`, { method: 'POST', body: JSON.stringify({ text }) }),
  history: () => request<{ quests: Quest[] }>('/api/history'),
  imports: () => request<{ imports: ImportRecord[] }>('/api/imports'),
  importFile: (file: File, onProgress?: () => void) => {
    const form = new FormData();
    form.append('file', file);
    return fetch('/api/imports', { method: 'POST', body: form }).then(async (res) => {
      onProgress?.();
      const text = await res.text();
      const body = text ? JSON.parse(text) : undefined;
      if (!res.ok) throw new ApiFailure(res.status, body ?? {});
      return body as ImportRecord;
    });
  },
  uploadBanner: (partyId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return fetch(`/api/parties/${partyId}/banner`, { method: 'PUT', body: form }).then(async (res) => {
      const text = await res.text();
      const body = text ? JSON.parse(text) : undefined;
      if (!res.ok) throw new ApiFailure(res.status, body ?? {});
      return body as { bannerUrl: string };
    });
  },
};

/** Format a number with one decimal (health, damage). */
export function fmt1(x: number): string {
  return (Math.round(x * 10) / 10).toFixed(1);
}

/** Format gold with two decimals. */
export function fmtGold(x: number): string {
  return (Math.round(x * 100) / 100).toFixed(2);
}

/** The true minus sign for strike lines and damage chips. */
export const MINUS = '−';
