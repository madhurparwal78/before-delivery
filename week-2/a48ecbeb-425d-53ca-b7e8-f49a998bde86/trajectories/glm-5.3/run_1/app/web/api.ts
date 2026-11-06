export interface Flavour {
  slug: string;
  name: string;
  can_price_cents: number;
  limited: boolean;
  subscribable: boolean;
  stock_left: number;
}

export interface QuoteLine {
  flavour: string;
  quantity: number;
  unit_price_cents: number;
  goods_cents: number;
  discount_cents: number;
  deposit_cents: number;
}

export interface Quote {
  province: string;
  subscribe: boolean;
  lines: QuoteLine[];
  goods_cents: number;
  discount_cents: number;
  discounted_goods_cents: number;
  shipping_cents: number;
  deposit_cents: number;
  taxes: { name: string; rate: string; cents: number }[];
  total_cents: number;
  free_shipping: { threshold_cents: number; remaining_cents: number; progress_percent: number };
}

export interface CartSlotView {
  flavour: string | null;
  status: string;
}

export interface CartView {
  slots: (CartSlotView | null)[];
  count: number;
  province: string;
  subscribe: boolean;
  cadence: string;
  hold: { status: 'active' | 'expired' | 'none'; expires_at: string | null };
  server_time: string;
}

export interface Address {
  id: string;
  name: string;
  line1: string;
  line2: string;
  city: string;
  province: string;
  postal_code: string;
  is_default: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface OrderView {
  number: string;
  status: string;
  refund_status: string;
  placed_at: string;
  province: string;
  subscription_id: string | null;
  lines: QuoteLine[];
  goods_cents: number;
  discount_cents: number;
  discounted_goods_cents: number;
  shipping_cents: number;
  deposit_cents: number;
  taxes: { name: string; rate: string; cents: number }[];
  total_cents: number;
  refunded_cents: number;
  refundable_cents: number;
  ship_to: { name: string; line1: string; line2: string; city: string; province: string; postal_code: string };
  refunds: { id: string; status: string; amount_cents: number; reason: string; split: Record<string, unknown>; created_at: string }[];
  thank_you_url: string;
  invoice_url: string;
}

export interface ChangeView {
  id: string;
  kind: string;
  status: 'pending_provider' | 'applied' | 'rejected';
  effective_date: string;
  requested_at: string;
}

export interface SubscriptionView {
  id: string;
  plan: string;
  plan_label: string;
  cadence: string;
  state: 'active' | 'paused' | 'past_due' | 'cancel_pending' | 'cancelled';
  next_renewal_date: string;
  billing_end_date: string | null;
  pause: { from: string; resumes_on: string } | null;
  skip: { date: string } | null;
  change_cutoff: string;
  changes_apply_to: string;
  pending_change: ChangeView | null;
  last_change: ChangeView | null;
  dunning: { step: string; failed_at: string; next_retry_at: string | null; shipments_held: boolean; cancels_at: string } | null;
  card: { brand: string; last4: string };
}

export interface ApiErrorBody {
  error: string;
  message?: string;
  fields?: Record<string, string>;
  [k: string]: unknown;
}

export class ApiError extends Error {
  status: number;
  code: string;
  fields: Record<string, string>;
  body: ApiErrorBody;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message ?? `Request failed (${status})`);
    this.status = status;
    this.code = body.error ?? 'error';
    this.fields = body.fields ?? {};
    this.body = body;
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (init?.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, {
    method: init?.method ?? (init?.json !== undefined ? 'POST' : 'GET'),
    headers,
    body,
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    throw new ApiError(res.status, (parsed as ApiErrorBody) ?? { error: 'error', message: `Request failed (${res.status})` });
  }
  return parsed as T;
}

export function dollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function provinceName(code: string): string {
  const names: Record<string, string> = {
    AB: 'Alberta',
    BC: 'British Columbia',
    MB: 'Manitoba',
    NB: 'New Brunswick',
    NL: 'Newfoundland and Labrador',
    NS: 'Nova Scotia',
    NT: 'Northwest Territories',
    NU: 'Nunavut',
    ON: 'Ontario',
    PE: 'Prince Edward Island',
    QC: 'Quebec',
    SK: 'Saskatchewan',
    YT: 'Yukon',
  };
  return names[code] ?? code;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') {
      node.className = String(value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'dataset') {
      for (const [dk, dv] of Object.entries(value as Record<string, string>)) {
        (node as unknown as Record<string, string>).dataset[dk] = dv;
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value as EventListener);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function announceStatus(region: Element, message: string): void {
  const live = region.querySelector('[data-live-text]') ?? region;
  if (live === region) {
    region.textContent = '';
    region.append(el('span', { 'data-live-text': true, text: message }));
  } else {
    live.textContent = message;
  }
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const FLAVOUR_COLOURS: Record<string, { label: string; band?: string }> = {
  'guava-lime': { label: '#e88fa2', band: '#cfe37a' },
  'yuzu-ginger': { label: '#f2c14e' },
  'passionfruit-basil': { label: '#8a63b5' },
  'cacao-orange': { label: '#5a3a2b', band: '#e88a3c' },
};

export function flavourOf(slugs: Flavour[], name: string): Flavour | undefined {
  return slugs.find((f) => f.name === name);
}
