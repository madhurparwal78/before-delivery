import type { Cadence, FlavourSlug, ProvinceCode } from '../../shared/catalogue.js';
import type { Quote } from '../../shared/quote.js';
import type { RefundSplit } from '../../shared/refundSplit.js';

export interface ApiFailure {
  error: string;
  message: string;
  fields?: Record<string, string>;
  stock_left?: number;
  limit?: 'crate' | 'drop';
  committed?: number;
}

export class ApiCallError extends Error {
  constructor(
    readonly status: number,
    readonly failure: ApiFailure,
  ) {
    super(failure.message);
    this.name = 'ApiCallError';
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiCallError(0, { error: 'offline', message: 'The shop is unreachable.' });
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const payload = text === '' ? null : (JSON.parse(text) as unknown);
  if (!response.ok) throw new ApiCallError(response.status, payload as ApiFailure);
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>('POST', path, body, headers),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'customer' | 'fulfilment' | 'support' | 'owner';
}

export interface FlavourSummary {
  slug: FlavourSlug;
  name: string;
  can_price_cents: number;
  limited: boolean;
  subscribable: boolean;
  stock_left: number;
}

export interface CrateSlot {
  flavour: FlavourSlug;
  status: 'held';
}

export interface CartPayload {
  slots: Array<CrateSlot | null>;
  count: number;
  province: ProvinceCode;
  subscribe: boolean;
  cadence: Cadence;
  hold: { status: 'active' | 'expired' | 'none'; expires_at: string | null };
  server_time: string;
}

export interface AddressPayload {
  id: string;
  name: string;
  line1: string;
  line2: string;
  city: string;
  province: ProvinceCode;
  postal_code: string;
  is_default: boolean;
}

export interface RefundPayload {
  id: string;
  status: 'pending_provider' | 'applied' | 'rejected';
  amount_cents: number;
  reason: string;
  split: RefundSplit;
  created_at: string;
}

export interface OrderPayload {
  number: string;
  status: 'paid' | 'picking' | 'packed' | 'shipped' | 'refunded';
  refund_status: 'none' | 'partially_refunded' | 'refunded';
  placed_at: string;
  province: ProvinceCode;
  subscription_id: string | null;
  lines: Quote['lines'];
  goods_cents: number;
  discount_cents: number;
  discounted_goods_cents: number;
  shipping_cents: number;
  deposit_cents: number;
  taxes: Quote['taxes'];
  total_cents: number;
  refunded_cents: number;
  refundable_cents: number;
  ship_to: {
    name: string;
    line1: string;
    line2: string;
    city: string;
    province: ProvinceCode;
    postal_code: string;
  };
  refunds: RefundPayload[];
  thank_you_url: string;
  invoice_url: string;
}

export interface ChangePayload {
  id: string;
  kind: 'pause' | 'resume' | 'skip' | 'swap' | 'cancel';
  status: 'pending_provider' | 'applied' | 'rejected';
  effective_date: string | null;
  requested_at: string;
}

export interface SubscriptionPayload {
  id: string;
  plan: string;
  plan_label: string;
  cadence: Cadence;
  state: 'active' | 'paused' | 'past_due' | 'cancel_pending' | 'cancelled';
  next_renewal_date: string | null;
  billing_end_date: string | null;
  pause: { from: string; resumes_on: string } | null;
  skip: { date: string } | null;
  change_cutoff: string | null;
  changes_apply_to: string | null;
  pending_change: ChangePayload | null;
  last_change: ChangePayload | null;
  dunning: {
    step: string;
    failed_at: string;
    next_retry_at: string | null;
    shipments_held: boolean;
    cancels_at: string;
  } | null;
  card: { brand: string; last4: string };
}

export interface ReviewPayload {
  id: string;
  rating: number;
  body: string;
  author_first_name: string;
  created_at: string;
}

export interface StockistPayload {
  name: string;
  address: string;
  city: string;
  province: string;
  lat: number;
  lng: number;
  distance_km: number | null;
}

export interface ApplicationPayload {
  id: string;
  status: 'submitted' | 'approved' | 'declined';
  business_name: string;
  submitted_at: string;
  contact_name?: string;
  email?: string;
  province?: string;
}

export interface StockRow {
  flavour: FlavourSlug;
  received: number;
  sold: number;
  returned: number;
  on_hand: number;
  reserved: number;
  available: number;
  released: number | null;
}

export type ServiceStatuses = Record<
  'killbill' | 'postgres' | 'pocketbase' | 'minio' | 'mailpit',
  'up' | 'down'
>;

export interface OwnerSettings {
  provinces: Array<{
    code: ProvinceCode;
    name: string;
    shipping_cents: number;
    free_shipping_threshold_cents: number;
    deposit_cents_per_can: number;
    taxes: Array<{ name: string; rate: string }>;
  }>;
  drop: { flavour: FlavourSlug; can_price_cents: number; released: number };
}

export interface PendingReview extends ReviewPayload {
  flavour: FlavourSlug;
  flavour_name: string;
  status: string;
}
