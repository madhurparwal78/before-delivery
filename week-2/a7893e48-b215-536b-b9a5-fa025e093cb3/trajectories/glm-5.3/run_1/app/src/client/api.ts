export interface ApiErrorShape {
  error: string;
  message: string;
  fields?: Record<string, string>;
  dates?: string[];
  blocker?: { state: string; start_at: string; end_at: string; label: string; date: string };
  from?: string;
  action?: string;
  limit_bytes?: number;
}

export class HttpError {
  status: number;
  body: ApiErrorShape;
  constructor(status: number, body: ApiErrorShape) {
    this.status = status;
    this.body = body;
  }
}

export async function api<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!res.ok) throw new HttpError(res.status, data as ApiErrorShape);
  return data as T;
}

export interface DaySegment {
  start_at: string;
  end_at: string;
  state: "booked" | "held" | "yours_booked" | "yours_held";
  label: string;
  booking_id: string | null;
  hold_id: string | null;
  renter_business: string | null;
}

export interface DayStation {
  id: string;
  name: string;
  rate_cents: number;
  segments: DaySegment[];
}

export interface DayData {
  site_id: string;
  date: string;
  time_zone: string;
  hours: number;
  ticks: { at: string; label: string; zone: string }[];
  pack_minutes_available: number | null;
  stations: DayStation[];
}

export interface HoldOccurrence {
  date: string;
  start: string;
  end: string;
  start_at: string;
  end_at: string;
  minutes: number;
}

export interface Hold {
  id: string;
  status: "held" | "expired" | "confirmed";
  station_id: string;
  site_id: string;
  renter_id: string;
  created_at: string;
  expires_at: string;
  occurrences: HoldOccurrence[];
  quote: {
    pack_minutes_available: number | null;
    pack_minutes: number;
    card_minutes: number;
    card_cents: number;
    deposit_cents: number;
  };
}

export interface Booking {
  id: string;
  hold_id: string;
  site_id: string;
  station_id: string;
  station_name: string;
  renter_id: string;
  renter_business: string;
  status: string;
  start_at: string;
  end_at: string;
  local_start: string;
  local_end: string;
  minutes: number;
  pack_minutes: number;
  card_minutes: number;
  card_cents: number;
  deposit_cents: number;
  paid: boolean;
  balance_due_cents: number;
  balance_due_by: string | null;
  policy: { version_id: string; notice_hours: number; effective_from: string };
  confirmed_at: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  overrun_minutes: number;
  overrun_cents: number;
  cleaning_fee_cents: number;
  terms: string;
}

export interface SiteInfo {
  id: string;
  name: string;
  time_zone: string;
  deposit_cents: number;
  cleaning_fee_cents: number;
  stations: { id: string; name: string; rate_cents: number }[];
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "renter" | "front_desk" | "manager";
  operator_id: string;
  site_ids: string[];
  renter_id: string | null;
}

export interface StatusInfo {
  billing: "ok" | "delayed";
  mail: "ok" | "delayed";
  queued_emails: number;
}

export const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
export const hours = (minutes: number): string => (minutes / 60).toFixed(2);

export function keyId(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  for (let i = 0; i < 16; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export const todayStr = (): string => new Date().toISOString().slice(0, 10);
