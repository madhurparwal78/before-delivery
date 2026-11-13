// The browser's only door to the server: same-origin JSON calls in the brief's error shape.

import type { Currency } from "../shared/money.js";
import type { MembershipStatus, SessionStatus, Tier } from "../shared/copy.js";
import type { ExhibitKey } from "../shared/exhibits.js";
import type { ItemStatus } from "../shared/lifecycle.js";

export type Role = "visitor" | "curator" | "lead_curator" | "manager";
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
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
export interface TimelineEvent {
  id: string;
  year: number;
  title: string;
  summary: string;
  chapter: number;
  source_ids: string[];
}
export interface ChapterDetail extends ChapterSummary {
  body: string;
  viewpoints: number[];
  exhibit: ExhibitKey | null;
  narration: { media_url: string; transcript: string } | null;
  plates: { media_url: string; caption: string }[];
  events: TimelineEvent[];
}
export interface Source {
  id: string;
  citation: string;
  cited_by: string[];
}
export interface SearchResult {
  type: "chapter" | "event";
  id: string;
  title: string;
  chapter: number;
}
export interface Path {
  resolved: number[];
  last_chapter: number | null;
  last_exhibit: string;
}
export interface Bookmark {
  id: string;
  target_type: "chapter" | "event";
  target_id: string;
  title: string;
}
export interface Session {
  id: string;
  title: string;
  starts_at: string;
  starts_at_display: string;
  duration_minutes: number;
  capacity: number;
  seats_left: number;
  status: SessionStatus;
  booking_closes_at: string;
  price_minor?: number;
  currency?: Currency;
}
export interface Order {
  id: string;
  receipt_number: string;
  kind: "ticket" | "donation" | "membership_join" | "membership_upgrade";
  description: string;
  currency: Currency;
  amount_minor: number;
  refunded_minor: number;
  status: "settled" | "partially_refunded" | "refunded";
  settled_at: string;
  card_last4: string;
  receipt_url: string;
}
export interface LedgerOrder extends Order {
  user_email: string;
  killbill_invoice_id: string;
  killbill_payment_id: string;
  refunds: { id: string; amount_minor: number; reason: string; at: string }[];
  notes: { id: string; text: string; author_email: string; at: string }[];
}
export interface Membership {
  tier: Tier;
  tier_name: string;
  status: MembershipStatus;
  currency: Currency;
  price_minor: number;
  charged_through: string | null;
  pending: { kind: "downgrade"; tier: Tier; effective_on: string } | { kind: "cancel"; effective_on: string } | null;
  amount_due_minor: number | null;
  next_charge: { on: string; amount_minor: number } | null;
  card_last4: string | null;
}
export interface Catalog {
  currencies: Currency[];
  ticket: { prices: Record<Currency, number> };
  tiers: { tier: Tier; name: string; prices: Record<Currency, number>; scheduled_changes: { currency: Currency; amount_minor: number; effective_on: string }[] }[];
  donation: { min_minor: Record<Currency, number>; max_minor: Record<Currency, number> };
}
export interface StudioItem {
  id: string;
  type: "chapter" | "event";
  title: string;
  status: ItemStatus;
  owner_email: string;
  publish_at: string | null;
  chapter: number;
}

interface ApiErrorBody {
  code: string;
  message: string;
  fields?: Record<string, string>;
}

/** A refusal or outage the server answered in the error shape. */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly error: ApiErrorBody,
  ) {
    super(error.message);
  }
}

/** The request left but no reply came back (connection dropped). */
export class LostReply extends Error {}

interface CallOptions {
  method?: string;
  body?: unknown;
  key?: string;
  form?: FormData;
}

export async function api<T>(path: string, options: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.key) headers["Idempotency-Key"] = options.key;
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? (options.body !== undefined || options.form ? "POST" : "GET"),
      headers,
      body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
      credentials: "same-origin",
    });
  } catch {
    throw new LostReply("no reply");
  }
  if (response.status === 204) return undefined as T;
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new LostReply("unreadable reply");
  }
  if (!response.ok) throw new ApiFailure(response.status, (payload as { error: ApiErrorBody }).error);
  return payload as T;
}

/** A fresh Idempotency-Key (getRandomValues works on plain-http origins too). */
export const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * The supporter's Kill Bill account currency once a payment attempt has fixed it, declined or not,
 * as the server reads it (brief: Business rules › Account currency).
 */
export async function fixedCurrency(): Promise<{ membership: Membership | null; currency: Currency | null }> {
  const { membership, account_currency } = await api<{ membership: Membership | null; account_currency: Currency | null }>("/api/me/membership");
  return { membership, currency: account_currency ?? membership?.currency ?? null };
}
