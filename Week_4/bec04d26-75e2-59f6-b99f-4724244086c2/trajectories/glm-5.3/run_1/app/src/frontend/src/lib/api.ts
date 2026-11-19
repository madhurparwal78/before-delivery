import type { ReturnJson, MeJson, UserJson, ReturnsEnvelope } from '../../../shared/types';

export interface LiveEvent {
  kind: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string | null,
    public errors: Record<string, string>,
    public body: Record<string, unknown> | null,
  ) {
    super(code ?? String(status));
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'same-origin',
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const body = text === '' ? null : safeJson(text);
  if (!response.ok) {
    const code = body !== null && typeof body === 'object' && 'error' in body
      ? String((body as { error: unknown }).error)
      : null;
    const errors = body !== null && typeof body === 'object' && 'errors' in body
      ? (body as { errors: Record<string, string> }).errors
      : {};
    throw new ApiError(response.status, code, errors, body as Record<string, unknown>);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  me: () => request<MeJson>('/api/me'),
  signUp: (body: { display_name: string; email: string; password: string }) =>
    request<{ practice_id: string; user: UserJson }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  signIn: (body: { email: string; password: string }) =>
    request<{ user: UserJson }>('/api/auth/signin', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  signOut: () => request<void>('/api/auth/signout', { method: 'POST' }),
  saveReminderHour: (reminder_hour: number) =>
    request<{ reminder_hour: number }>('/api/practice', {
      method: 'PATCH',
      body: JSON.stringify({ reminder_hour }),
    }),
  states: () => request<import('../../../shared/types').StateJson[]>('/api/states'),
  saveHolidays: (code: string, holidays: string[]) =>
    request<import('../../../shared/types').StateJson>(`/api/states/${code}/holidays`, {
      method: 'PUT',
      body: JSON.stringify({ holidays }),
    }),
  publishEdition: (code: string, body: Record<string, unknown>) =>
    request<{ edition: import('../../../shared/types').EditionJson; recalculated: string[] }>(
      `/api/states/${code}/editions`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  clients: () => request<import('../../../shared/types').ClientJson[]>('/api/clients'),
  addClient: (body: { name: string; owner: { display_name: string; email: string; password: string } }) =>
    request<import('../../../shared/types').ClientJson>('/api/clients', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  register: (clientId: string, body: { state: string; frequency: string; first_period: string }) =>
    request<{ registration: import('../../../shared/types').RegistrationJson; returns: ReturnJson[] }>(
      `/api/clients/${clientId}/registrations`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  returns: (query: string) => request<ReturnsEnvelope>(`/api/returns${query}`),
  oneReturn: (id: string) => request<ReturnJson>(`/api/returns/${id}`),
  saveAmounts: (id: string, body: Record<string, unknown>) =>
    request<ReturnJson>(`/api/returns/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  prepare: (id: string, body: Record<string, unknown>) =>
    request<ReturnJson>(`/api/returns/${id}/prepare`, { method: 'POST', body: JSON.stringify(body) }),
  approve: (id: string, body: Record<string, unknown>) =>
    request<ReturnJson>(`/api/returns/${id}/approve`, { method: 'POST', body: JSON.stringify(body) }),
  sendBack: (id: string, body: Record<string, unknown>) =>
    request<ReturnJson>(`/api/returns/${id}/send-back`, { method: 'POST', body: JSON.stringify(body) }),
  file: (id: string, body: Record<string, unknown>) =>
    request<ReturnJson>(`/api/returns/${id}/file`, { method: 'POST', body: JSON.stringify(body) }),
  extension: (id: string, body: Record<string, unknown>) =>
    request<ReturnJson>(`/api/returns/${id}/extension`, { method: 'POST', body: JSON.stringify(body) }),
  amend: (id: string, body: Record<string, unknown>) =>
    request<ReturnJson>(`/api/returns/${id}/amend`, { method: 'POST', body: JSON.stringify(body) }),
  reminders: (id: string) =>
    request<import('../../../shared/types').ReminderJson[]>(`/api/returns/${id}/reminders`),
};
