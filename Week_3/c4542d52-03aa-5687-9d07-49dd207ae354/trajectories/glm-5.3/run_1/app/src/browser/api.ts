// The browser never decides a status, a deadline or a remaining time from its own clock.
// Everything on screen comes from the API or the socket.

export interface Person {
  id: string;
  name: string;
  first_name: string;
  email: string;
  role: 'founder_admin' | 'board_member' | 'option_holder' | 'leaver' | 'investor';
  access: string;
  departure: { terminated_at: string; termination_date: string; window_ends_at: string | null; warnings_at: string[] } | null;
}

export interface Tranche {
  month: number;
  date: string;
  cumulative: number;
  state: 'vested' | 'unvested' | 'cancelled';
  cost_at_strike: string;
  vested_ownership: string;
}

export interface Grant {
  id: string;
  holder_id: string;
  holder_name: string;
  options: number;
  strike: string;
  vesting_type: 'standard' | 'monthly';
  vesting_start: string | null;
  state: 'draft' | 'board_queue' | 'approved' | 'offered' | 'accepted' | 'expired';
  draft_version: number;
  votes: { approve: number; decline: number };
  offered_at: string | null;
  offer_expires_at: string | null;
  offer_warning_at: string | null;
  accepted_at: string | null;
  agreement: { status: string; document_id: string | null };
  vested: number;
  exercised: number;
  cancelled: number;
  forfeited: number;
  in_open_orders: number;
  exercisable: number;
  next_tranche: { date: string; cumulative: number } | null;
  exercise_window_ends_at: string | null;
  schedule: Tranche[];
  server_date: string;
  server_time: string;
}

export interface Order {
  id: string;
  grant_id: string;
  holder_id: string;
  options: number;
  strike: string;
  cost: string;
  idempotency_key: string;
  state: 'pending' | 'held' | 'issued' | 'cancelled';
  placed_at: string;
  issued_at: string | null;
  payment: { id: string; status: string; amount_cents: number; currency: string; reference: string; confirmed_at: string | null } | null;
  notice: { document_id: string; status: string } | null;
}

export interface CapRow {
  key: string;
  label: string;
  issued_shares: number;
  options_outstanding: number;
  fully_diluted: number;
  ownership: string;
}

export interface CapTable {
  fully_diluted_total: number;
  rows: CapRow[];
  total_ownership: string;
}

export interface TenderMine {
  nda: { status: string; document_id: string | null };
  draft_shares: string | null;
  submission: { shares: number; submitted_at: string; sequence: number } | null;
  projected_allocation: number | null;
  allocation: number | null;
  proceeds: string | null;
  issued_shares?: number;
}

export interface Tender {
  id: string;
  title: string;
  buyer: string;
  price_per_share: string;
  share_cap: number;
  closes_at: string;
  state: 'open' | 'closed' | 'allocated';
  total_tendered: number;
  remaining_cap: number;
  oversubscribed_by: number;
  server_time: string;
  mine?: TenderMine;
  submissions?: Array<{ holder_id: string; holder_name: string; shares: number; submitted_at: string; sequence: number; allocation: number | null; proceeds: string | null }>;
}

export interface DocumentRec {
  id: string;
  kind: string;
  title: string;
  owner_id: string;
  status: string;
  sha256: string | null;
  vault_key: string;
  created_at: string;
  version: number;
  supersedes: string | null;
  superseded_by: string | null;
}

export interface LedgerEntry {
  id: string;
  at: string;
  holder_id: string | null;
  holder_name: string;
  kind: string;
  class: string;
  shares_delta: number;
  options_delta: number;
  reference: string;
}

export interface ScenarioResult {
  fully_diluted_before: number;
  unallocated_pool_before: number;
  pool_top_up: number;
  price_per_share: string;
  new_shares: number;
  fully_diluted_after: number;
  new_investor_percent: string;
  pool_after_percent: string;
  dilution_percent: string;
  investment_used: string;
  fmv_per_share: string | null;
  price_to_fmv: string | null;
}

export interface ApiError {
  error: { code: string; message: string };
  fields?: Record<string, string>;
}

export async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'same-origin',
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = body as ApiError | null;
    const e = new Error(err?.error?.message ?? 'Something went wrong on our side. Your register has not changed.') as Error & {
      status?: number;
      code?: string;
      fields?: Record<string, string>;
      body?: unknown;
    };
    e.status = res.status;
    e.code = err?.error?.code ?? 'internal_error';
    e.fields = err?.fields;
    e.body = body;
    throw e;
  }
  return body;
}

export function get<T>(path: string): Promise<T> {
  return api(path) as Promise<T>;
}

export function post<T>(path: string, body?: unknown, key?: string): Promise<T> {
  return api(path, {
    method: 'POST',
    headers: key ? { 'Idempotency-Key': key } : undefined,
    body: body === undefined ? '{}' : JSON.stringify(body),
  }) as Promise<T>;
}

export function put<T>(path: string, body?: unknown): Promise<T> {
  return api(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }) as Promise<T>;
}

export function patch<T>(path: string, body?: unknown): Promise<T> {
  return api(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }) as Promise<T>;
}

export function del<T>(path: string): Promise<T> {
  return api(path, { method: 'DELETE' }) as Promise<T>;
}
