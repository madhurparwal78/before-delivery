export interface Me {
  id: string;
  username: string;
  display_name: string;
  email: string;
  roles: string[];
  venue: { id: string; slug: string; name: string; time_zone: string } | null;
}

export interface Market {
  id: string;
  kind: 'pair' | 'event';
  symbol: string;
  title: string;
  status: string;
  closes_at: string | null;
  outcome: 'yes' | 'no' | null;
  last_price: number | null;
  open_interest: number;
  taker_fee_bps: number;
  maker_fee_bps: number;
}

export interface Level {
  price: number;
  quantity: number;
  spot_quantity?: number;
  margin_quantity?: number;
}

export interface Book {
  market_id: string;
  sequence: number;
  last_price: number | null;
  bids: Level[];
  asks: Level[];
}

export interface Fill {
  id: string;
  order_id: string;
  market_id: string;
  mode: 'spot' | 'margin' | null;
  side: 'buy' | 'sell';
  outcome: 'yes' | 'no' | null;
  price: number;
  quantity: number;
  notional_cents: number;
  fee_cents: number;
  liquidity: 'maker' | 'taker';
  filled_at: string;
}

export interface Order {
  id: string;
  market_id: string;
  mode: 'spot' | 'margin' | null;
  side: 'buy' | 'sell';
  outcome: 'yes' | 'no' | null;
  price: number;
  quantity: number;
  filled_quantity: number;
  remaining_quantity: number;
  status: 'resting' | 'partially_filled' | 'filled' | 'cancelled' | 'liquidated';
  hold_cents: number;
  taker_fee_bps: number;
  maker_fee_bps: number;
  created_at: string;
  fills: Fill[];
}

export interface Balance {
  available_cents: number;
  held_cents: number;
  collateral_cents: number;
  total_cents: number;
}

export interface Deposit {
  id: string;
  amount_cents: number;
  refunded_cents: number;
  status: 'succeeded' | 'declined';
  card_last4: string;
  killbill_payment_id: string | null;
  created_at: string;
}

export interface Statement {
  id: string;
  month: string;
  created_at: string;
}

export interface ApiKey {
  id: string;
  name: string;
  created_at: string;
  revoked_at: string | null;
}

export interface Invoice {
  id: string;
  number: string;
  invoice_date: string;
  amount_cents: number;
  balance_cents: number;
  items: { description: string; amount_cents: number; start_date: string; end_date: string }[];
}

export interface Billing {
  plan: 'sandbox' | 'builder' | 'desk';
  effective_plan: 'sandbox' | 'builder' | 'desk';
  state: 'active' | 'payment_failed' | 'downgraded';
  overdue_state: string | null;
  rate_per_second: number;
  pending_plan: 'sandbox' | 'builder' | 'desk' | null;
  pending_effective_date: string | null;
  provider: 'ok' | 'unavailable';
  invoices: Invoice[];
}

export interface WebhookInfo {
  endpoint: { url: string; svix_endpoint_id: string; signing_secret: string } | null;
  delivery: 'ok' | 'delayed';
  attempts: { message_id: string; event_type: string; event_id: string; status: string; response_status: number | null; timestamp: string }[];
}

export interface Positions {
  spot: { market_id: string; quantity: number; reserved: number }[];
  margin: { id: string; market_id: string; side: 'long' | 'short'; quantity: number; cost_cents: number; collateral_cents: number; status: string; equity_cents: number; maintenance_cents: number }[];
  event: { market_id: string; outcome: 'yes' | 'no'; quantity: number }[];
}

export interface Totals {
  members: number;
  open_orders: number;
  deposits_cents: number;
  refunds_cents: number;
  fees_cents: number;
  volume_cents_today: number;
  open_interest_contracts: number;
}

export interface Summary {
  volume_cents_today: number;
  open_interest_contracts: number;
  flagship_market_id: string | null;
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly fields: Record<string, string> | null) {
    super(code);
  }
}

async function request<T>(method: string, path: string, body?: unknown, idempotencyKey?: string, raw?: boolean): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const init: RequestInit = { method, headers, credentials: 'same-origin' };
  if (body !== undefined) {
    init.body = body instanceof FormData ? body : JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (raw) {
    return { status: res.status, blob: await res.blob() } as unknown as T;
  }
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = data as { error?: string; errors?: Record<string, string> } | null;
    throw new ApiError(res.status, err?.error ?? `http_${res.status}`, err?.errors ?? null);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, idempotencyKey?: string) => request<T>('POST', path, body, idempotencyKey),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  postRaw: <T>(path: string, body?: unknown) => request<T>('POST', path, body, undefined, true),
};

export async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (!res.ok) throw new ApiError(res.status, 'download_failed', null);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
