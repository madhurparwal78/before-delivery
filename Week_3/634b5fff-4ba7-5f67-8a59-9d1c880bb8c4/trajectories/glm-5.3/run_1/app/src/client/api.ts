/** The one API client. Every call goes through here. */

export class ApiError extends Error {
  code: string;
  status: number;
  fields?: Record<string, string>;
  extra?: Record<string, unknown>;
  constructor(status: number, code: string, fields?: Record<string, string>, extra?: Record<string, unknown>) {
    super(code);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.extra = extra;
  }
}

async function request<T>(path: string, init?: RequestInit & { idempotencyKey?: string; holdToken?: string; orderToken?: string }): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;
  if (init?.holdToken) headers['X-Hold-Token'] = init.holdToken;
  if (init?.orderToken) headers['X-Order-Token'] = init.orderToken;
  const res = await fetch(path, {
    ...init,
    headers: {
      ...((init?.body as unknown) ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; fields?: Record<string, string> } })?.error;
    throw new ApiError(res.status, err?.code ?? 'not_found', err?.fields, body ?? undefined);
  }
  return body as T;
}

export const api = {
  edition: () => request<{
    edition: number; priceOre: number; netOre: number; vatOre: number; courierOre: number; totalOre: number;
    charityName: string; rateBasisPoints: number; charityOre: number; closesAt: string; salesOpen: boolean;
  }>('/api/edition'),
  shelf: () => request<{
    salesPaused: boolean; remaining: number; boxes: { number: number; plate: string; state: string }[];
  }>('/api/shelf'),
  box: (number: number) => request<{ number: number; plate: string; state: string; artUrl: string | null }>(`/api/boxes/${number}`),
  search: (q: string) => request<{ hits: Record<string, unknown>[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  takeHold: (number: number, holdToken?: string) => request<{ number: number; plate: string; holdToken: string; holdMs: number; remainingMs: number }>(
    '/api/holds',
    { method: 'POST', body: JSON.stringify({ number }), holdToken },
  ),
  holdRemaining: (number: number, holdToken: string) => request<{ number: number; state: string; holdMs: number; remainingMs: number }>(
    `/api/holds/${number}`,
    { holdToken },
  ),
  releaseHold: (number: number, holdToken: string) => request<unknown>(`/api/holds/${number}`, { method: 'DELETE', holdToken }),
  checkout: (body: unknown, holdToken: string, idempotencyKey: string) => request<{
    reference: string; orderToken: string; paymentState: string; boxState: string; holdRemainingMs: number | null;
    challenge?: { id: string; expiresInMs: number };
    transfer?: { iban: string; paymentReference: string; amountOre: number; deadlineAt: string };
  }>('/api/checkout', { method: 'POST', body: JSON.stringify(body), holdToken, idempotencyKey }),
  answerChallenge: (reference: string, body: unknown, holdToken: string) => request<{
    reference: string; orderToken: string; paymentState: string; boxState: string; holdRemainingMs: number | null;
  }>(`/api/checkout/${reference}/challenge`, { method: 'POST', body: JSON.stringify(body), holdToken }),
  order: (reference: string, token: string) => request<{
    reference: string; number: number; plate: string; method: string; paymentState: string; boxState: string;
    totalOre: number; charityOre: number;
    transfer: { iban: string; paymentReference: string; amountOre: number; deadlineAt: string } | null;
    certificate: { state: string };
  }>(`/api/orders/${reference}?token=${encodeURIComponent(token)}`),
  lookup: (reference: string, email: string) => request<{ reference: string; orderToken: string }>(
    '/api/orders/lookup',
    { method: 'POST', body: JSON.stringify({ reference, email }) },
  ),
  staff: {
    me: () => request<{ username: string; roles: string[] }>('/api/staff/me'),
    search: (q: string) => request<{ hits: Record<string, unknown>[]; degraded: boolean }>(`/api/staff/search?q=${encodeURIComponent(q)}`),
    orders: () => request<{ orders: Record<string, unknown>[] }>('/api/staff/orders'),
    pack: (reference: string) => request<unknown>(`/api/staff/orders/${reference}/pack`, { method: 'POST' }),
    backOnShelf: (number: number) => request<unknown>(`/api/staff/boxes/${number}/back-on-shelf`, { method: 'POST' }),
    deadLetters: () => request<{ events: Record<string, unknown>[] }>('/api/staff/dead-letters'),
    retryDead: (eventId: string) => request<unknown>(`/api/staff/dead-letters/${encodeURIComponent(eventId)}/retry`, { method: 'POST' }),
    dismissDead: (eventId: string, note: string) => request<unknown>(`/api/staff/dead-letters/${encodeURIComponent(eventId)}/dismiss`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),
    ledgerOrders: () => request<{ orders: Record<string, unknown>[] }>('/api/staff/ledger/orders'),
    ledger: (reference: string) => request<Record<string, unknown>>(`/api/staff/orders/${reference}/ledger`),
    refund: (reference: string, amountOre: number, key: string) => request<Record<string, unknown>>(
      `/api/staff/orders/${reference}/refunds`,
      { method: 'POST', body: JSON.stringify({ amountOre }), idempotencyKey: key },
    ),
    refundRemainder: (reference: string) => request<{ amountOre: number }>(`/api/staff/orders/${reference}/refund-remainder`),
    rates: () => request<{ rates: Record<string, unknown>[] }>('/api/staff/charity-rates'),
    scheduleRate: (rateBasisPoints: number, effectiveFrom: string) => request<unknown>('/api/staff/charity-rates', {
      method: 'POST', body: JSON.stringify({ rateBasisPoints, effectiveFrom }),
    }),
    statements: () => request<{ statements: Record<string, unknown>[] }>('/api/staff/statements'),
    issueStatement: (month: string) => request<Record<string, unknown>>('/api/staff/statements', {
      method: 'POST', body: JSON.stringify({ month }),
    }),
    saveEndpoint: (url: string) => request<unknown>('/api/staff/charity-endpoint', {
      method: 'PUT', body: JSON.stringify({ url }),
    }),
    deliveries: () => request<{ deliveries: Record<string, unknown>[] }>('/api/staff/deliveries'),
    stock: () => request<{ remaining: number; thresholds: number[] }>('/api/staff/stock'),
    status: () => request<{ eventsWaiting: boolean; alertsWaiting: boolean }>('/api/staff/status'),
  },
};
