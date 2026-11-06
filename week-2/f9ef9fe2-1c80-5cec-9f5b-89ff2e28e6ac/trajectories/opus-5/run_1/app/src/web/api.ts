import type {
  ApiError as ApiErrorBody,
  Booking,
  ComplianceDocument,
  Hold,
  Invoice,
  Kitchen,
  LoomView,
  MemberSummary,
  Movement,
  Quote,
  RateCard,
  Series,
  SeriesOccurrence,
  StatusView,
  UsageReport,
  User,
  Cell,
} from '../shared/types';

export class ApiFailure extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }

  field(name: string): string | undefined {
    return this.body.errors ? this.body.errors[name] : undefined;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey !== undefined) headers['Idempotency-Key'] = idempotencyKey;
  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new ApiFailure(response.status, payload as ApiErrorBody);
  return payload as T;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export const api = {
  status: () => request<StatusView>('GET', '/api/status'),
  me: () => request<{ user: User }>('GET', '/api/me'),
  signIn: (email: string, password: string) =>
    request<{ user: User }>('POST', '/api/session', { email, password }),
  signOut: () => request<void>('DELETE', '/api/session'),
  kitchen: (kitchenId: string) => request<{ kitchen: Kitchen }>('GET', `/api/kitchens/${kitchenId}`),
  saveCutoff: (kitchenId: string, sameDayCutoff: string) =>
    request<{ kitchen: Kitchen }>('PATCH', `/api/kitchens/${kitchenId}/settings`, {
      same_day_cutoff: sameDayCutoff,
    }),
  loom: (kitchenId: string, date: string, memberId?: string | null) =>
    request<LoomView>(
      'GET',
      `/api/kitchens/${kitchenId}/loom?date=${date}${memberId ? `&member_id=${memberId}` : ''}`,
    ),
  members: (kitchenId: string) =>
    request<{ members: MemberSummary[] }>('GET', `/api/kitchens/${kitchenId}/members`),
  member: (memberId: string) =>
    request<{ member: MemberSummary }>('GET', `/api/members/${memberId}`),
  quote: (input: { date: string; cells: Cell[]; use_pack: boolean; member_id?: string | null }) =>
    request<{ quote: Quote; taken: Cell[]; papers: Cell[] }>('POST', '/api/quotes', {
      date: input.date,
      cells: input.cells,
      use_pack: input.use_pack,
      ...(input.member_id ? { member_id: input.member_id } : {}),
    }),
  placeHold: (input: { date: string; cells: Cell[]; member_id?: string | null }) =>
    request<{ hold: Hold; taken: Cell[] }>('POST', '/api/holds', {
      date: input.date,
      cells: input.cells,
      ...(input.member_id ? { member_id: input.member_id } : {}),
    }),
  hold: (holdId: string) => request<{ hold: Hold }>('GET', `/api/holds/${holdId}`),
  releaseHold: (holdId: string) => request<{ hold: Hold }>('DELETE', `/api/holds/${holdId}`),
  confirmHold: (holdId: string, usePack: boolean, quotedTotalCents: number, key: string) =>
    request<{ booking: Booking; invoice: Invoice }>(
      'POST',
      `/api/holds/${holdId}/confirm`,
      { use_pack: usePack, quoted_total_cents: quotedTotalCents },
      key,
    ),
  seriesQuote: (input: {
    station_ids: string[];
    start: string;
    end: string;
    first_date: string;
    weeks: number;
    use_pack: boolean;
    member_id?: string | null;
  }) =>
    request<{ occurrences: SeriesOccurrence[]; total_cents: number; total: string }>(
      'POST',
      '/api/series/quote',
      input,
    ),
  createSeries: (
    input: {
      station_ids: string[];
      start: string;
      end: string;
      first_date: string;
      weeks: number;
      use_pack: boolean;
      quoted_total_cents: number;
      member_id?: string | null;
    },
    key: string,
  ) =>
    request<{ series: Series; bookings: Booking[]; invoice: Invoice }>(
      'POST',
      '/api/series',
      input,
      key,
    ),
  bookings: (date?: string) =>
    request<{ bookings: Booking[] }>('GET', `/api/bookings${date ? `?date=${date}` : ''}`),
  booking: (bookingId: string) =>
    request<{ booking: Booking }>('GET', `/api/bookings/${bookingId}`),
  cancelBooking: (bookingId: string) =>
    request<{
      booking: Booking;
      refund: { pack_quarters: number; amount_cents: number; amount: string };
    }>('POST', `/api/bookings/${bookingId}/cancel`, {}),
  bookingStep: (bookingId: string, step: 'check-in' | 'complete' | 'no-show') =>
    request<{ booking: Booking }>('POST', `/api/bookings/${bookingId}/${step}`, {}),
  pack: (memberId: string) =>
    request<{ balance_quarters: number; balance_hours: string; movements: Movement[] }>(
      'GET',
      `/api/members/${memberId}/pack`,
    ),
  buyPack: (memberId: string, key: string) =>
    request<{ movement: Movement; invoice: Invoice; balance_quarters: number }>(
      'POST',
      `/api/members/${memberId}/packs`,
      {},
      key,
    ),
  invoices: () => request<{ invoices: Invoice[] }>('GET', '/api/invoices'),
  invoice: (invoiceId: string) =>
    request<{ invoice: Invoice }>('GET', `/api/invoices/${invoiceId}`),
  documents: () => request<{ documents: ComplianceDocument[] }>('GET', '/api/documents'),
  uploadDocument: (form: FormData) =>
    fetch('/api/documents', { method: 'POST', body: form, credentials: 'same-origin' }).then(
      async (response) => {
        const payload = (await response.json()) as unknown;
        if (!response.ok) throw new ApiFailure(response.status, payload as ApiErrorBody);
        return payload as { document: ComplianceDocument };
      },
    ),
  reviewDocument: (documentId: string, action: 'verify' | 'reject', reason?: string) =>
    request<{ document: ComplianceDocument }>(
      'POST',
      `/api/documents/${documentId}/${action}`,
      reason === undefined ? {} : { reason },
    ),
  rateCards: (kitchenId: string) =>
    request<{ rate_cards: RateCard[] }>('GET', `/api/kitchens/${kitchenId}/rate-cards`),
  addRateCard: (
    kitchenId: string,
    input: {
      effective_from: string;
      tier_rates_cents: number[];
      station_surcharges_cents: Record<string, number>;
      cancellation_window_hours: number;
      pack_price_cents: number;
    },
  ) => request<{ rate_card: RateCard }>('POST', `/api/kitchens/${kitchenId}/rate-cards`, input),
  usage: (kitchenId: string, month: string) =>
    request<UsageReport>('GET', `/api/kitchens/${kitchenId}/reports/usage?month=${month}`),
};

export async function openDocumentFile(documentId: string): Promise<void> {
  const response = await fetch(`/api/documents/${documentId}/file`, {
    credentials: 'same-origin',
  });
  if (!response.ok) {
    const payload = (await response.json()) as ApiErrorBody;
    throw new ApiFailure(response.status, payload);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
