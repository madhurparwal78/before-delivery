import type {
  ApiErrorBody,
  Credential,
  CredentialForReview,
  ErrorCode,
  Invoice,
  Quote,
  RequestView,
  Seat,
  SeatOnRequest,
  SessionUser,
} from '../shared/types.js';

export const UNREACHABLE_COPY = "Couldn't reach Crosshand Relay. Check your connection and try again.";

export class RequestFailed extends Error {
  readonly code: ErrorCode | 'unreachable';
  readonly fields: Record<string, string>;
  readonly quote: Quote | null;

  constructor(code: ErrorCode | 'unreachable', message: string, fields?: Record<string, string>, quote?: Quote) {
    super(message);
    this.name = 'RequestFailed';
    this.code = code;
    this.fields = fields ?? {};
    this.quote = quote ?? null;
  }
}

async function call<Result>(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<Result> {
  const headers: Record<string, string> = { ...extraHeaders };
  let payload: string | undefined;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new RequestFailed('unreachable', UNREACHABLE_COPY);
  }
  if (response.status === 204) return undefined as Result;
  const text = await response.text();
  if (!response.ok) {
    let parsed: ApiErrorBody | null = null;
    try {
      parsed = JSON.parse(text) as ApiErrorBody;
    } catch {
      parsed = null;
    }
    if (parsed === null) throw new RequestFailed('unreachable', UNREACHABLE_COPY);
    throw new RequestFailed(parsed.error.code, parsed.error.message, parsed.error.fields, parsed.error.quote);
  }
  return JSON.parse(text) as Result;
}

export const api = {
  signIn: (email: string, password: string) =>
    call<{ user: SessionUser }>('POST', '/api/session', { email, password }),
  me: () => call<{ user: SessionUser }>('GET', '/api/me'),
  signOut: () => call<void>('DELETE', '/api/session'),

  requests: (query: string) => call<{ requests: RequestView[] }>('GET', `/api/requests${query}`),
  request: (id: string) => call<RequestView>('GET', `/api/requests/${id}`),
  createRequest: (fields: Record<string, unknown>) =>
    call<RequestView>('POST', '/api/requests', fields),
  updateRequest: (id: string, fields: Record<string, unknown>) =>
    call<RequestView>('PATCH', `/api/requests/${id}`, fields),
  submitRequest: (id: string) => call<RequestView>('POST', `/api/requests/${id}/submit`, {}),
  saveStaffing: (id: string, fields: Record<string, unknown>) =>
    call<RequestView>('PATCH', `/api/requests/${id}/staffing`, fields),
  broadcast: (id: string) => call<{ emailed: number }>('POST', `/api/requests/${id}/broadcast`, {}),
  complete: (id: string, actualMinutes: number) =>
    call<RequestView>('POST', `/api/requests/${id}/complete`, { actual_minutes: actualMinutes }),
  cancellationQuote: (id: string) => call<Quote>('GET', `/api/requests/${id}/cancellation-quote`),
  cancel: (id: string, expectedFee: string, key: string) =>
    call<{ request: RequestView; invoice: Invoice | null }>(
      'POST',
      `/api/requests/${id}/cancel`,
      { expected_fee: expectedFee },
      { 'idempotency-key': key },
    ),
  close: (id: string, key: string) =>
    call<{ request: RequestView; invoice: Invoice }>(
      'POST',
      `/api/requests/${id}/close`,
      {},
      { 'idempotency-key': key },
    ),

  openSeats: () => call<{ open_seats: SeatOnRequest[] }>('GET', '/api/open-seats'),
  assignments: () => call<{ assignments: SeatOnRequest[] }>('GET', '/api/assignments'),
  claim: (seatId: string) =>
    call<{ seat: Seat; request: RequestView }>('POST', `/api/seats/${seatId}/claim`, {}),

  invoices: (query: string) => call<{ invoices: Invoice[] }>('GET', `/api/invoices${query}`),

  myCredentials: () => call<{ credentials: Credential[] }>('GET', '/api/me/credentials'),
  reviewCredentials: (status: string) =>
    call<{ credentials: CredentialForReview[] }>('GET', `/api/credentials?status=${status}`),
  verifyCredential: (id: string, expiresOn: string) =>
    call<Credential>('POST', `/api/credentials/${id}/verify`, { expires_on: expiresOn }),
  credentialFile: (id: string) =>
    call<{ url: string; expires_in_seconds: number }>('GET', `/api/credentials/${id}/file`),

  uploadCertificate: async (credentialType: string, file: File): Promise<Credential> => {
    const form = new FormData();
    form.set('credential_type', credentialType);
    form.set('file', file);
    let response: Response;
    try {
      response = await fetch('/api/me/credentials', {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
      });
    } catch {
      throw new RequestFailed('unreachable', UNREACHABLE_COPY);
    }
    const text = await response.text();
    if (!response.ok) {
      let parsed: ApiErrorBody | null = null;
      try {
        parsed = JSON.parse(text) as ApiErrorBody;
      } catch {
        parsed = null;
      }
      if (parsed === null) throw new RequestFailed('unreachable', UNREACHABLE_COPY);
      throw new RequestFailed(parsed.error.code, parsed.error.message, parsed.error.fields);
    }
    return JSON.parse(text) as Credential;
  },
};

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
