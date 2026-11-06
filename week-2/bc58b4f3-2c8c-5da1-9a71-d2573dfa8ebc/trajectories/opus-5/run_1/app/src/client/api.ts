import type {
  ApiErrorBody,
  AssignmentView,
  BillingQueueItem,
  CancellationQuote,
  CoverageResponse,
  RateCardEntry,
  SchedulerEntry,
  SessionUser,
} from '../shared/contract.js';

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error.message ?? 'Request failed');
    this.name = 'ApiFailure';
    this.status = status;
    this.code = body?.error.code ?? 'internal';
    this.fields = body?.error.fields ?? {};
  }
}

export class NetworkFailure extends Error {
  constructor() {
    super('Network failure');
    this.name = 'NetworkFailure';
  }
}

interface SendOptions {
  body?: unknown;
  headers?: Record<string, string>;
  form?: FormData;
}

async function send<T>(method: string, path: string, options: SendOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  let payload: BodyInit | undefined;
  if (options.form !== undefined) {
    payload = options.form;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new NetworkFailure();
  }

  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  const parsed: unknown = text === '' ? null : JSON.parse(text);
  if (!response.ok) {
    throw new ApiFailure(response.status, parsed as ApiErrorBody | null);
  }
  return parsed as T;
}

export const api = {
  signIn: (email: string, password: string) =>
    send<{ user: SessionUser }>('POST', '/api/session', { body: { email, password } }),
  signOut: () => send<void>('DELETE', '/api/session'),
  me: () => send<{ user: SessionUser }>('GET', '/api/me'),

  assignments: (search: string) =>
    send<{ assignments: AssignmentView[] }>(
      'GET',
      `/api/assignments${search === '' ? '' : `?q=${encodeURIComponent(search)}`}`,
    ),
  assignment: (number: string) => send<AssignmentView>('GET', `/api/assignments/${number}`),
  createAssignment: (body: Record<string, unknown>, idempotencyKey: string) =>
    send<AssignmentView>('POST', '/api/assignments', {
      body,
      headers: { 'idempotency-key': idempotencyKey },
    }),
  changeAssignment: (number: string, body: Record<string, unknown>) =>
    send<AssignmentView>('PATCH', `/api/assignments/${number}`, { body }),
  release: (number: string) =>
    send<{ assignment: AssignmentView; offers_sent: number }>(
      'POST',
      `/api/assignments/${number}/release`,
      { body: {} },
    ),
  cancellationQuote: (number: string) =>
    send<CancellationQuote>('GET', `/api/assignments/${number}/cancellation-quote`),
  cancel: (number: string) =>
    send<AssignmentView>('POST', `/api/assignments/${number}/cancel`, { body: {} }),

  offers: () => send<{ offers: AssignmentView[] }>('GET', '/api/offers'),
  mySeats: () => send<{ assignments: AssignmentView[] }>('GET', '/api/my-seats'),
  claim: (number: string, seat: number) =>
    send<AssignmentView>('POST', `/api/assignments/${number}/seats/${seat}/claim`, { body: {} }),
  giveBack: (number: string, seat: number) =>
    send<AssignmentView>('POST', `/api/assignments/${number}/seats/${seat}/give-back`, { body: {} }),
  verify: (number: string, seat: number, form: FormData) =>
    send<AssignmentView>('POST', `/api/assignments/${number}/seats/${seat}/verification`, { form }),
  verificationLink: (number: string, seat: number) =>
    send<{ url: string; expires_in_seconds: number }>(
      'GET',
      `/api/assignments/${number}/seats/${seat}/verification-link`,
    ),

  coverage: (week: string) => send<CoverageResponse>('GET', `/api/coverage?week=${week}`),

  billingQueue: () => send<{ items: BillingQueueItem[] }>('GET', '/api/billing/queue'),
  postInvoice: (number: string) =>
    send<{ billing: { status: string; invoice_id: string | null; total_cents: number | null } }>(
      'POST',
      `/api/assignments/${number}/invoice`,
      { body: {} },
    ),
  rateCards: (org: string) => send<{ entries: RateCardEntry[] }>('GET', `/api/rate-cards?org=${org}`),
  addRateCard: (body: Record<string, unknown>) =>
    send<RateCardEntry>('POST', '/api/rate-cards', { body }),

  schedulers: () => send<{ schedulers: SchedulerEntry[] }>('GET', '/api/org/schedulers'),
  addScheduler: (body: Record<string, unknown>) =>
    send<SchedulerEntry>('POST', '/api/org/schedulers', { body }),
  removeScheduler: (id: number) => send<void>('DELETE', `/api/org/schedulers/${id}`),
};
