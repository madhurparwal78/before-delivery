// Same-origin JSON calls. HTTP errors come back as values (the brief's error shape); only a
// network failure throws.

export interface ApiError {
  error: string;
  message: string;
  errors?: Record<string, string>;
  missing?: string[];
  waitlist?: { tier: "bench" | "atelier"; open: boolean };
}

type Reply<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiError };

export async function call<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<Reply<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? null : body instanceof FormData ? body : JSON.stringify(body),
  });
  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;
  if (response.ok) return { ok: true, status: response.status, data: parsed as T };
  return { ok: false, status: response.status, error: (parsed ?? { error: "unknown", message: "Something went wrong." }) as ApiError };
}

export function newKey(): string {
  return crypto.randomUUID();
}

export type Tier = "bench" | "atelier";
export type Role = "practitioner" | "clinic" | "director" | "registrar" | "frontdesk";

export interface Account {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Hold {
  expires_at: string;
  seconds_remaining: number;
  duration_seconds: number;
}

export interface Reservation {
  id: string;
  bench: string;
  tier: Tier;
  state: string;
  group_id: string | null;
  buyer: { name: string; kind: "practitioner" | "clinic" };
  attendee: { name: string; email: string; accepted: boolean } | null;
  price_cents: number;
  paid_cents: number;
  balance_cents: number;
  refund_due_cents: number | null;
  hold: Hold | null;
  payment_pending: string | null;
  licence_status: string;
  passport_status: string;
  checked_in: { day1: boolean; day2: boolean };
  documents: string[];
}

export interface Group {
  id: string;
  state: string;
  reservations: Reservation[];
  invoice: { kb_invoice_id: string | null; items: { bench: string; amount_cents: number }[]; total_cents: number } | null;
}

export interface Offer {
  id: string;
  bench: string;
  tier: Tier;
  state: string;
  seconds_remaining: number;
}

export interface MyReservation extends Reservation {
  relationship: ("buyer" | "attendee" | "assignee")[];
}

export interface Me {
  account: Account;
  reservations: MyReservation[];
  groups: Group[];
  waitlist: { tier: Tier; position: number } | null;
  offers: Offer[];
  server_time: string;
  venue_date: string;
  deposits_open: boolean;
}

export interface BenchInfo {
  label: string;
  row: string;
  number: number;
  tier: Tier;
  state: "open" | "held" | "held_by_you" | "offered_to_you" | "sold" | "yours";
}

export interface Benches {
  server_time: string;
  venue_date: string;
  deposits_open: boolean;
  seats_total: number;
  seats_remaining: number;
  held: number;
  sold: number;
  tiers: { bench: { remaining: number }; atelier: { remaining: number; cap: number; active: number; sold_out: boolean } };
  benches: BenchInfo[];
}

export interface Session {
  id: string;
  number: number;
  day: number;
  title: string;
  format: string;
  minutes: number;
  outcomes: string;
}

export interface Evening {
  id: string;
  title: string;
  day: number;
  tier: string;
  starts_at?: string;
  venue?: string;
  description?: string;
  gated?: boolean;
}

export interface Hotel {
  id: string;
  name: string;
  distance: string;
  rate: string;
  map_url: string;
}

interface Faq {
  id: string;
  question: string;
  answer: string;
  sort: number;
}

export interface Content {
  sessions: Session[];
  hospitality: Evening[];
  hotels: Hotel[];
  faq: Faq[];
}
