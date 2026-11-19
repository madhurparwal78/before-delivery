export type Role = 'trader' | 'builder' | 'market_admin' | 'org_owner' | 'founder_operator';
export type MarketKind = 'pair' | 'event';
export type MarketStatus = 'listed' | 'trading' | 'halted' | 'closed' | 'resolved' | 'settled';
export type Outcome = 'yes' | 'no';
export type OrderMode = 'spot' | 'margin';
export type OrderSide = 'buy' | 'sell';
export type OrderStatus = 'resting' | 'partially_filled' | 'filled' | 'cancelled' | 'liquidated';
export type Plan = 'sandbox' | 'builder' | 'desk';
export type BillingState = 'active' | 'payment_failed' | 'downgraded';

export interface Me {
  id: string;
  username: string;
  display_name: string;
  email: string;
  roles: Role[];
  venue: { id: string; slug: string; name: string; time_zone: string } | null;
}

export interface Market {
  id: string;
  kind: MarketKind;
  symbol: string;
  title: string;
  status: MarketStatus;
  closes_at: string | null;
  outcome: Outcome | null;
  last_price: number | null;
  open_interest: number;
  taker_fee_bps: number;
  maker_fee_bps: number;
  server_time?: string;
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
  mode: OrderMode | null;
  side: OrderSide;
  outcome: Outcome | null;
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
  mode: OrderMode | null;
  side: OrderSide;
  outcome: Outcome | null;
  price: number;
  quantity: number;
  filled_quantity: number;
  remaining_quantity: number;
  status: OrderStatus;
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
  member?: { id: string; display_name: string; email: string };
}

export interface Positions {
  spot: { market_id: string; quantity: number; reserved: number }[];
  margin: {
    id: string;
    market_id: string;
    side: 'long' | 'short';
    quantity: number;
    cost_cents: number;
    collateral_cents: number;
    status: 'open' | 'closed' | 'liquidated';
    equity_cents: number;
    maintenance_cents: number;
  }[];
  event: { market_id: string; outcome: Outcome; quantity: number }[];
}

export interface Invoice {
  id: string;
  number: string;
  invoice_date: string;
  amount_cents: number;
  balance_cents: number;
  items: { description: string; amount_cents: number; start_date: string | null; end_date: string | null }[];
}

export interface Billing {
  plan: Plan;
  effective_plan: Plan;
  state: BillingState;
  overdue_state: string;
  rate_per_second: number;
  pending_plan: Plan | null;
  pending_effective_date: string | null;
  provider: 'ok' | 'unavailable';
  invoices: Invoice[];
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  created_at: string;
  revoked_at: string | null;
}

export interface DeliveryAttempt {
  message_id: string;
  event_type: string;
  event_id: string | null;
  status: 'succeeded' | 'pending' | 'failed';
  response_status: number | null;
  timestamp: string;
}

export interface Webhooks {
  endpoint: { url: string; svix_endpoint_id: string; signing_secret: string } | null;
  delivery: 'ok' | 'delayed';
  attempts: DeliveryAttempt[];
}

export interface VenueTotals {
  members: number;
  open_orders: number;
  deposits_cents: number;
  refunds_cents: number;
  fees_cents: number;
  volume_cents_today: number;
  open_interest_contracts: number;
}

export interface VenueSummary {
  volume_cents_today: number;
  open_interest_contracts: number;
  flagship_market_id: string | null;
}

export interface MemberSummary {
  id: string;
  display_name: string;
  email: string;
  roles: Role[];
}

export interface StatementRecord {
  id: string;
  month: string;
  created_at: string;
}

export interface DocumentRecord {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
  member?: { id: string; display_name: string };
}

export interface PlatformVenue {
  id: string;
  slug: string;
  name: string;
  time_zone: string;
  member_count: number;
  created_at: string;
}

export interface ProviderHealth {
  providers: Record<string, 'up' | 'down'>;
  checked_at: string;
}

export class RequestFailed extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly fields: Record<string, string>,
    readonly extra: Record<string, unknown>,
  ) {
    super(code);
  }
}

/** The browser talks only to the app's own origin. */
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const parsed = text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    const { error, errors, ...extra } = parsed;
    throw new RequestFailed(
      response.status,
      typeof error === 'string' ? error : 'unknown',
      (errors as Record<string, string> | undefined) ?? {},
      extra,
    );
  }
  return parsed as T;
}

export const get = <T>(path: string): Promise<T> => request<T>('GET', path);
export const post = <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body);
export const put = <T>(path: string, body?: unknown): Promise<T> => request<T>('PUT', path, body);
export const patch = <T>(path: string, body?: unknown): Promise<T> => request<T>('PATCH', path, body);
export const del = <T>(path: string): Promise<T> => request<T>('DELETE', path);

export async function uploadDocument(file: File): Promise<DocumentRecord> {
  const form = new FormData();
  form.append('document', file);
  const response = await fetch('/api/me/documents', { method: 'POST', body: form });
  const text = await response.text();
  const parsed = text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    const { error, errors, ...extra } = parsed;
    throw new RequestFailed(
      response.status,
      typeof error === 'string' ? error : 'unknown',
      (errors as Record<string, string> | undefined) ?? {},
      extra,
    );
  }
  return parsed as unknown as DocumentRecord;
}
