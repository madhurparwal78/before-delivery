import {
  AssignmentsPayload,
  BoardPayload,
  CredentialRecord,
  DryRun,
  InvoicesPayload,
  OfferPagePayload,
  PreferencesPayload,
  Quote,
  Rates,
  RequestObject,
  SessionUser,
  SystemStatus,
  TimesheetQueueRow,
} from './types';

export interface ApiFailure {
  code: string;
  message: string;
  fields?: Record<string, string>;
  holder?: { id: string; name: string };
  quote?: Quote;
  offer_status?: string;
  from?: string;
  gate?: string;
}

export class ApiCallError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.failure = failure;
  }
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const shape = payload as { error?: { code?: string; message?: string } } & Record<string, unknown>;
    throw new ApiCallError({
      code: shape?.error?.code ?? 'internal',
      message: shape?.error?.message ?? 'Something went wrong.',
      fields: shape?.fields as Record<string, string> | undefined,
      holder: shape?.holder as { id: string; name: string } | undefined,
      quote: shape?.quote as Quote | undefined,
      offer_status: shape?.offer_status as string | undefined,
      from: shape?.from as string | undefined,
      gate: shape?.gate as string | undefined,
    });
  }
  return payload as T;
}

export const api = {
  signIn: (email: string, passcode: string) =>
    call<{ user: SessionUser }>('POST', '/api/session', { email, passcode }),
  signOut: () => call<void>('DELETE', '/api/session'),
  me: () => call<{ user: SessionUser }>('GET', '/api/me'),
  systemStatus: () => call<SystemStatus>('GET', '/api/system/status'),

  board: () => call<BoardPayload>('GET', '/api/board'),
  dryRun: (seatId: string, interpreterId: string) =>
    call<DryRun>('POST', `/api/seats/${seatId}/dry-run`, { interpreter_id: interpreterId }),
  pin: (seatId: string, interpreterId: string) =>
    call<{ request: RequestObject }>('POST', `/api/seats/${seatId}/offers`, {
      interpreter_id: interpreterId,
    }),

  requests: () => call<{ requests: RequestObject[] }>('GET', '/api/requests'),
  request: (id: string) => call<{ request: RequestObject }>('GET', `/api/requests/${id}`),
  createRequest: (body: Record<string, unknown>) =>
    call<{ request: RequestObject }>('POST', '/api/requests', body),
  updateRequest: (id: string, body: Record<string, unknown>) =>
    call<{ request: RequestObject }>('PATCH', `/api/requests/${id}`, body),
  submitRequest: (id: string) =>
    call<{ request: RequestObject }>('POST', `/api/requests/${id}/submit`, {}),
  uploadPrep: async (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    const response = await fetch(`/api/requests/${id}/prep`, { method: 'POST', body: form });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const shape = payload as { error?: { code?: string; message?: string } };
      throw new ApiCallError({
        code: shape?.error?.code ?? 'internal',
        message: shape?.error?.message ?? 'Something went wrong.',
      });
    }
    return payload as { file: { id: string; filename: string } };
  },
  cancellationQuote: (id: string) =>
    call<{ quote: Quote }>('GET', `/api/requests/${id}/cancellation-quote`),
  cancelRequest: (id: string, expectedFee: string, key: string) =>
    call<{ request: RequestObject; quote: Quote }>(
      'POST',
      `/api/requests/${id}/cancel`,
      { expected_fee: expectedFee, reason: 'Cancelled by the requesting organisation' },
      { 'Idempotency-Key': key },
    ),
  consumers: () => call<{ consumers: { id: string; name: string }[] }>('GET', '/api/consumers'),
  consumerPreferences: (id: string) =>
    call<{ consumer: { id: string; name: string }; preferred: string[]; blocked: string[] }>(
      'GET',
      `/api/consumers/${id}/preferences`,
    ),

  offer: (token: string) => call<OfferPagePayload>('GET', `/api/offers/${token}`),
  acceptOffer: (token: string) =>
    call<{ offer: { status: string }; request: { ref: string; status: string } }>(
      'POST',
      `/api/offers/${token}/accept`,
      {},
    ),
  declineOffer: (token: string) =>
    call<{ offer: { status: string }; request: { ref: string; status: string } }>(
      'POST',
      `/api/offers/${token}/decline`,
      {},
    ),

  assignments: () => call<AssignmentsPayload>('GET', '/api/interpreters/me/assignments'),
  submitTimesheet: (
    seatId: string,
    body: { actual_start: string; actual_end: string; signature_name: string },
    key: string,
  ) =>
    call<{ timesheet: { billed_hours: string } }>(
      'POST',
      `/api/seats/${seatId}/timesheet`,
      body,
      { 'Idempotency-Key': key },
    ),
  credentials: () => call<{ credentials: CredentialRecord[] }>('GET', '/api/interpreters/me/credentials'),
  addCredential: async (fields: { type: string; number: string; expires_on: string }, scan: File) => {
    const form = new FormData();
    form.append('type', fields.type);
    form.append('number', fields.number);
    form.append('expires_on', fields.expires_on);
    form.append('scan', scan, scan.name);
    const response = await fetch('/api/interpreters/me/credentials', { method: 'POST', body: form });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const shape = payload as { error?: { code?: string; message?: string } } & Record<string, unknown>;
      throw new ApiCallError({
        code: shape?.error?.code ?? 'internal',
        message: shape?.error?.message ?? 'Something went wrong.',
        fields: shape?.fields as Record<string, string> | undefined,
      });
    }
    return payload as { credential: CredentialRecord };
  },

  timesheetQueue: () => call<{ timesheets: TimesheetQueueRow[] }>('GET', '/api/timesheets?status=submitted'),
  approveTimesheet: (id: string, key: string) =>
    call<{ timesheet: { amount: string; billed_hours: string }; request: { ref: string } }>(
      'POST',
      `/api/timesheets/${id}/approve`,
      {},
      { 'Idempotency-Key': key },
    ),
  rates: () => call<{ rates: Rates }>('GET', '/api/rates'),
  saveRates: (body: Partial<Rates>) => call<{ rates: Rates }>('PUT', '/api/rates', body),
  invoices: (orgId: string) => call<InvoicesPayload>('GET', `/api/orgs/${orgId}/invoices`),

  preferences: () => call<PreferencesPayload>('GET', '/api/consumers/me/preferences'),
  savePreferences: (preferred: string[], blocked: string[]) =>
    call<{ preferred: string[]; blocked: string[] }>('PUT', '/api/consumers/me/preferences', {
      preferred,
      blocked,
    }),
};
