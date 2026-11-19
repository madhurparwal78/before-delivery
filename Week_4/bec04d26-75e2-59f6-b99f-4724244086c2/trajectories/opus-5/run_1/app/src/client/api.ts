import {
  ClientRecord,
  MeResponse,
  Reminder,
  ReturnRecord,
  ReturnsResponse,
  StateRecord,
  User,
} from '../shared/types';

export interface ApiFailure {
  status: number;
  body: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(`api ${failure.status}`);
  }

  get fieldErrors(): Record<string, string> {
    const errors = this.failure.body.errors;
    if (errors === null || typeof errors !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(errors as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  }

  get code(): string | null {
    const error = this.failure.body.error;
    return typeof error === 'string' ? error : null;
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
  const raw = await response.text();
  const parsed: unknown = raw.length > 0 ? JSON.parse(raw) : {};
  if (!response.ok) {
    throw new ApiError({
      status: response.status,
      body:
        parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {},
    });
  }
  return parsed as T;
}

export const api = {
  me: () => request<MeResponse>('GET', '/api/me'),
  signUp: (body: { display_name: string; email: string; password: string }) =>
    request<{ practice_id: string; user: User }>('POST', '/api/auth/signup', body),
  signIn: (body: { email: string; password: string }) =>
    request<{ user: User }>('POST', '/api/auth/signin', body),
  signOut: () => request<void>('POST', '/api/auth/signout', {}),
  patchPractice: (reminder_hour: number) =>
    request<{ reminder_hour: number }>('PATCH', '/api/practice', { reminder_hour }),
  states: () => request<StateRecord[]>('GET', '/api/states'),
  saveHolidays: (code: string, holidays: string[]) =>
    request<StateRecord>('PUT', `/api/states/${encodeURIComponent(code)}/holidays`, { holidays }),
  publishEdition: (code: string, body: Record<string, unknown>) =>
    request<{ recalculated: string[] }>(
      'POST',
      `/api/states/${encodeURIComponent(code)}/editions`,
      body,
    ),
  clients: () => request<ClientRecord[]>('GET', '/api/clients'),
  addClient: (body: {
    name: string;
    owner: { display_name: string; email: string; password: string };
  }) => request<ClientRecord>('POST', '/api/clients', body),
  register: (
    clientId: string,
    body: { state: string; frequency: string; first_period: string },
  ) =>
    request<{ returns: ReturnRecord[] }>(
      'POST',
      `/api/clients/${encodeURIComponent(clientId)}/registrations`,
      body,
    ),
  returns: (search: string) => request<ReturnsResponse>('GET', `/api/returns${search}`),
  getReturn: (id: string) => request<ReturnRecord>('GET', `/api/returns/${encodeURIComponent(id)}`),
  saveAmounts: (id: string, body: { version: number; gross_sales: string; tax_due: string }) =>
    request<ReturnRecord>('PATCH', `/api/returns/${encodeURIComponent(id)}`, body),
  prepare: (id: string, body: { version: number; gross_sales: string; tax_due: string }) =>
    request<ReturnRecord>('POST', `/api/returns/${encodeURIComponent(id)}/prepare`, body),
  approve: (id: string, version: number) =>
    request<ReturnRecord>('POST', `/api/returns/${encodeURIComponent(id)}/approve`, { version }),
  sendBack: (id: string, version: number, reason: string) =>
    request<ReturnRecord>('POST', `/api/returns/${encodeURIComponent(id)}/send-back`, {
      version,
      reason,
    }),
  file: (id: string, version: number) =>
    request<ReturnRecord>('POST', `/api/returns/${encodeURIComponent(id)}/file`, { version }),
  extend: (id: string, version: number) =>
    request<ReturnRecord>('POST', `/api/returns/${encodeURIComponent(id)}/extension`, { version }),
  amend: (
    id: string,
    body: { version: number; gross_sales: string; tax_due: string; note?: string },
  ) => request<ReturnRecord>('POST', `/api/returns/${encodeURIComponent(id)}/amend`, body),
  reminders: (id: string) =>
    request<Reminder[]>('GET', `/api/returns/${encodeURIComponent(id)}/reminders`),
};
