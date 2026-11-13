/** Client API helpers: fetch with the single error shape and session cookie. */

export interface ApiErrorShape {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

export class ApiFailure extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly fields: Record<string, string> | undefined;
  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.message = message;
    this.fields = fields;
  }
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface Preferences {
  motion: boolean;
  sound: boolean;
}

export interface ChapterSummary {
  id: string;
  number: number;
  numeral: string;
  title: string;
  era: string;
  catalogue_number: string;
  sightline_deg: number;
  resolved: boolean;
}

export interface ChapterDetail extends ChapterSummary {
  body: string;
  viewpoints: number[];
  exhibit: string | null;
  narration: { media_url: string; transcript: string } | null;
  plates: Array<{ media_url: string; caption: string }>;
  events: TimelineEvent[];
}

export interface TimelineEvent {
  id: string;
  year: number;
  title: string;
  summary: string;
  chapter: number;
  source_ids: string[];
}

export interface Session {
  id: string;
  title: string;
  starts_at: string;
  starts_at_display: string;
  duration_minutes: number;
  capacity: number;
  seats_left: number;
  status: 'on_sale' | 'closed' | 'held' | 'cancelled';
  booking_closes_at: string;
  price_minor?: number;
  currency?: string;
}

export interface Order {
  id: string;
  receipt_number: string;
  kind: string;
  description: string;
  currency: string;
  amount_minor: number;
  refunded_minor: number;
  status: string;
  settled_at: string;
  card_last4: string;
  receipt_url: string;
}

export interface Membership {
  tier: string;
  tier_name: string;
  status: 'active' | 'pending_change' | 'overdue' | 'cancelled';
  currency: string;
  price_minor: number;
  charged_through: string | null;
  pending: { kind: 'downgrade'; tier: string; effective_on: string } | { kind: 'cancel'; effective_on: string } | null;
  amount_due_minor: number | null;
  next_charge: { on: string; amount_minor: number } | null;
  card_last4: string | null;
}

export interface Catalog {
  currencies: string[];
  ticket: { prices: Record<string, number> };
  tiers: Array<{
    tier: string;
    name: string;
    prices: Record<string, number>;
    scheduled_changes: Array<{ currency: string; amount_minor: number; effective_on: string }>;
  }>;
  donation: { min_minor: Record<string, number>; max_minor: Record<string, number> };
}

async function request<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? null : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) {
    const shape = (parsed ?? {}) as ApiErrorShape;
    if (shape.error) {
      throw new ApiFailure(res.status, shape.error.code, shape.error.message, shape.error.fields);
    }
    throw new ApiFailure(res.status, 'network', 'Something went wrong.', undefined);
  }
  return (parsed ?? {}) as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, key?: string): Promise<T> => request<T>('POST', path, body, key),
  put: <T>(path: string, body?: unknown, key?: string): Promise<T> => request<T>('PUT', path, body, key),
  delete: <T>(path: string): Promise<T> => request<T>('DELETE', path),
};

/** Money formatting in the published format. */
export function formatPrice(minor: number, currency: string): string {
  const sign = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency === 'USD' ? '$' : '¥';
  if (currency === 'JPY') {
    return `${sign}${withThousands(minor)}`;
  }
  const major = Math.trunc(minor / 100);
  const cents = Math.abs(minor % 100);
  return `${sign}${withThousands(major)}.${String(cents).padStart(2, '0')}`;
}

function withThousands(n: number): string {
  const neg = n < 0 ? '-' : '';
  const digits = String(Math.abs(Math.trunc(n)));
  const groups: string[] = [];
  for (let i = digits.length; i > 0; i -= 3) groups.unshift(digits.slice(Math.max(0, i - 3), i));
  return neg + groups.join(',');
}

/** A Lisbon date like "30 Nov 2026" from a YYYY-MM-DD. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function displayDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function randomKey(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
  let out = '';
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}
