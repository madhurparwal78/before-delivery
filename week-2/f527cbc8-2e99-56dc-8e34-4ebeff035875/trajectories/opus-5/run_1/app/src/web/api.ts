/** The API client. Nothing here works out whether something is open, late or lapsed:
 *  the server's answer is rendered as it stands. */

export interface ApiFailure {
  status: number;
  code: string;
  errors?: Record<string, string>;
  rowErrors?: { line: number; column: string; code: string }[];
  retryAfter?: number;
  extra: Record<string, unknown>;
  network: boolean;
}

export class ApiError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(`${failure.status} ${failure.code}`);
    this.name = 'ApiError';
    this.failure = failure;
  }
}

export interface RequestOptions {
  body?: unknown;
  raw?: BodyInit;
  contentType?: string;
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let payload: BodyInit | undefined;
  if (options.raw !== undefined) {
    payload = options.raw;
    if (options.contentType !== undefined) headers['content-type'] = options.contentType;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }
  if (options.idempotencyKey !== undefined) headers['idempotency-key'] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError({ status: 0, code: 'network', extra: {}, network: true });
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text !== '') {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (response.ok) return parsed as T;

  const body = (parsed ?? {}) as Record<string, unknown>;
  const retryAfterHeader = response.headers.get('retry-after');
  throw new ApiError({
    status: response.status,
    code: typeof body.error === 'string' ? body.error : 'unknown',
    errors:
      typeof body.errors === 'object' && body.errors !== null && !Array.isArray(body.errors)
        ? (body.errors as Record<string, string>)
        : undefined,
    rowErrors: Array.isArray(body.errors)
      ? (body.errors as { line: number; column: string; code: string }[])
      : undefined,
    retryAfter: retryAfterHeader === null ? undefined : Number(retryAfterHeader),
    extra: body,
    network: false,
  });
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, options?: RequestOptions): Promise<T> => request<T>('POST', path, options),
  put: <T>(path: string, options?: RequestOptions): Promise<T> => request<T>('PUT', path, options),
  patch: <T>(path: string, options?: RequestOptions): Promise<T> => request<T>('PATCH', path, options),
  delete: <T>(path: string, options?: RequestOptions): Promise<T> => request<T>('DELETE', path, options),
};

/* ---- Shapes the browser reads ---- */

export interface Me {
  id: string;
  name: string;
  email: string;
  role: 'farrier' | 'apprentice' | 'owner' | 'barn_manager';
}

export interface Practice {
  name: string;
  time_zone: string;
  today: string;
}

export interface Slot {
  id: string;
  time: string;
  state: 'open' | 'taken';
  my_booking_id?: string | null;
}

export interface BarnDay {
  id: string;
  barn: { id: string; name: string };
  business_date: string;
  start_time: string;
  time_zone: string;
  starts_at: string;
  cancellation_cutoff_at: string;
  slot_count: number;
  slot_minutes: number;
  booked_count: number;
  trip_fee_cents?: number;
  status: 'draft' | 'published' | 'full' | 'in_progress' | 'closed' | 'cancelled';
  slots: Slot[];
}

export interface Horse {
  id: string;
  name: string;
  barn: { id: string; name: string };
  stall: string;
  cycle_weeks: number;
  last_worked_date: string | null;
  next_due_date: string | null;
  due_status: 'current' | 'due' | 'overdue' | 'unknown';
  owner?: { id: string; name: string; email: string; phone: string | null };
}

export interface BookingRow {
  booking_id: string;
  number?: number;
  slot_time: string;
  horse_id?: string;
  horse_name: string;
  stall: string;
  status?: string;
  owner_name?: string;
  owner_email?: string;
  owner_phone?: string | null;
  trip_share_cents?: number | null;
  visit_id?: string | null;
  visit_status?: string | null;
  invoice_status?: string | null;
  invoice_total_cents?: number | null;
}

export interface Booking {
  id: string;
  number: number;
  status: string;
  barn_day_id: string;
  slot_id: string;
  slot_time: string;
  horse: { id: string; name: string };
  hold_expires_at: string | null;
  trip_share_cents: number | null;
  offer: boolean;
  deposit_cents: number;
  payment_id: string | null;
}

export interface Photo {
  id: string;
  visit_id: string;
  hoof: string;
  phase: 'before' | 'after';
  content_type: string;
  width: number;
  height: number;
  url: string;
  url_expires_at: string;
  thumbnail_status: 'pending' | 'ready' | 'failed';
  thumbnail_url: string | null;
}

export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  angle: number;
}

export interface HoofMarks {
  hoof: string;
  version: number;
  hoof_wall: Line;
  pastern: Line;
  alignment: string;
  saved_by?: { id: string; name: string; role: string };
  saved_at?: string;
  restored_from?: number | null;
}

export interface InvoiceItem {
  description: string;
  amount_cents: number;
}

export interface Invoice {
  id: string;
  kind: 'visit' | 'trip';
  status: 'pending' | 'unpaid' | 'paid';
  horse: { id: string; name: string };
  business_date: string;
  items: InvoiceItem[];
  total_cents: number;
  balance_cents: number;
  killbill_invoice_id: string | null;
  dunning_state: 'none' | 'past_due' | 'retry_1' | 'retry_2' | 'blocked' | 'cleared';
  reconciliation: 'unchecked' | 'matched' | 'mismatch' | 'unavailable';
}

export interface Visit {
  id: string;
  status: 'open' | 'closed' | 'invoice_pending' | 'invoiced';
  horse: { id: string; name: string };
  booking_id: string | null;
  business_date: string;
  note: string | null;
  photos: Photo[];
  marks: HoofMarks[];
  invoice: Invoice | null;
}

export interface ComparisonSide {
  visit_id?: string;
  business_date: string;
  photo: Photo | null;
  hoof_wall: Line;
  pastern: Line;
  alignment: string;
}

export interface Comparison {
  horse?: { id: string; name: string };
  hoof: string;
  previous: ComparisonSide;
  current: ComparisonSide;
  difference: { hoof_wall: number; pastern: number };
  readout: [string, string, string];
  marked_visits?: { visit_id: string; business_date: string }[];
}

export interface Allocation {
  barn_day_id: string;
  trip_fee_cents: number;
  shares: {
    booking_id: string;
    number: number;
    horse: { id: string; name: string };
    status: string;
    initial_cents: number | null;
    share_cents: number | null;
  }[];
  adjustments: {
    seq: number;
    booking_id: string;
    number: number;
    delta_cents: number;
    cause_booking_id: string;
    at: string;
  }[];
}

export interface WaitlistEntry {
  id: string;
  position: number;
  horse: { id: string; name: string };
  joined_at: string;
}

export interface PriceList {
  id: string;
  effective_from: string;
  deposit_cents: number;
  prices: Record<string, number>;
}

export interface ApiToken {
  id: string;
  name: string;
  scope: 'read_only' | 'billing';
  created_at: string;
  token?: string;
}

export interface VetLink {
  id: string;
  vet_name: string;
  vet_email: string;
  status: 'active' | 'revoked' | 'expired';
  expires_at: string;
  view_count: number;
  previous_date: string | null;
  current_date: string | null;
}

export interface VetLinkView {
  at: string;
  address: string;
  outcome: 'viewed' | 'expired' | 'revoked';
  user_agent: string;
  previous_date: string | null;
  current_date: string | null;
}

export interface Dashboard {
  month: string;
  billed_cents: number;
  collected_cents: number;
  refunded_cents: number;
  outstanding_cents: number;
  overdue_horses: number;
  rows: { date: string; billed_cents: number; collected_cents: number; refunded_cents: number }[];
}

export interface Job {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'succeeded' | 'dead';
  attempts: number;
  max_attempts: number;
  run_at: string;
  last_error: string | null;
  result: { key?: string; url?: string; url_expires_at?: string } | null;
}

export interface VetPage {
  horse: { name: string };
  previous_date: string;
  current_date: string;
  expires_at: string;
  hooves: Record<string, Comparison | null>;
}

export interface Reconciliation {
  status: 'matched' | 'mismatch' | 'unavailable';
  app: { total: number; paid: number; refunded: number; balance: number };
  killbill: { total: number; paid: number; refunded: number; balance: number } | null;
  differences: { field: string; app_cents: number; killbill_cents: number }[];
}

export interface CancellationPreview {
  late: boolean;
  cutoff_at: string;
  deposit_cents: number;
  deposit_outcome: 'refund' | 'keep' | 'none';
}

export interface CancellationResult {
  booking: Booking;
  trip_share_applies: boolean;
  decided_at: string;
  deposit_outcome: 'refund' | 'keep' | 'none';
  refunded_cents: number;
}
