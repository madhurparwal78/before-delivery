// Browser access to the API, and the resource shapes it returns.

export type Role = "coordinator" | "volunteer" | "member";
export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
}
export interface Membership {
  status: "pending-payment" | "active" | "lapsed";
  tier: "pay-what-you-can" | "standard" | "supporter";
  active_until: string | null;
  ends_at_term: boolean;
}
export type PartState = "hung" | "out" | "missing";
export type ItemStatus = "on-wall" | "reserved" | "out" | "pending-photo" | "incomplete" | "held";
export type LoanStatus = "reserved" | "out" | "pending-photo" | "returned-partial" | "returned-complete";
export interface Part {
  id: number;
  item_id: number;
  name: string;
  shape: string;
  col: number;
  row: number;
  width: number;
  height: number;
  state: PartState;
}
export interface Item {
  id: number;
  tag: string;
  name: string;
  replacement_cost_cents: number;
  status: ItemStatus;
  due_date: string | null;
  hold_queue_length: number;
  parts: Part[];
}
export interface Counts {
  on_wall: number;
  out: number;
  missing: number;
}
export interface Board {
  counts: Counts;
  columns: number;
  rows: number;
  items: Item[];
}
export interface Photo {
  id: number;
  event: "checkout" | "checkin";
  content_type: string;
  byte_size: number;
  sha256: string;
  captured_at: string;
  received_at: string;
  url: string;
}
export interface FeeRules {
  late_fee_cents: number;
  damage_fee_cents: number;
  replacement_costs_cents: Record<string, number>;
}
export type Grade = "good" | "worn" | "damaged";
export interface Loan {
  id: number;
  ref: string;
  member_id: number;
  member_name: string;
  status: LoanStatus;
  checked_out_at: string | null;
  due_date: string | null;
  due_by: string | null;
  fee_rules: FeeRules | null;
  open_days_late: number | null;
  late_fee_so_far_cents: number | null;
  returned_at: string | null;
  items: Array<{ id: number; tag: string; name: string; grade: Grade | null }>;
  parts: Part[];
  missing_parts: string[];
  photos: Photo[];
  fee_id: number | null;
}
export interface FeeLine {
  item_id: number;
  kind: "late" | "damage";
  open_days: number | null;
  amount_cents: number;
  description: string;
}
export interface Fee {
  id: number;
  loan_id: number;
  loan_ref: string;
  member_id: number;
  status: "raised" | "settled" | "waived-by-coordinator";
  total_cents: number;
  lines: FeeLine[];
  killbill_invoice_id: string;
  waiver: null | { status: "requested" | "approved" | "declined"; reason: string; requested_at: string; decided_at: string | null };
}
export interface Hold {
  id: number;
  item_id: number;
  member_id: number;
  status: "queued" | "ready" | "collected" | "cancelled";
  position: number | null;
  placed_at: string;
}
export interface Hours {
  weekday: string;
  opens: string;
  closes: string;
}
export interface CalendarInfo {
  time_zone: string;
  hours: Hours[];
  closures: Array<{ date: string; reason: string }>;
  next_open_days: string[];
}
export interface Settings {
  time_zone: string;
  late_fee_cents: number;
  damage_fee_cents: number;
  loan_period_days: number;
}
export interface MemberSummary {
  id: number;
  name: string;
  email: string;
  membership_status: Membership["status"];
}
export interface ServiceStatus {
  storage: "up" | "down";
  billing: "up" | "down";
}

export interface Answer<T> {
  status: number;
  body: T;
  error: string;
  fields: Record<string, string>;
}

export const SESSION_ENDED = "Your session has ended. Sign in again.";

export interface MultipartBody {
  body: Uint8Array<ArrayBuffer>;
  contentType: string;
}

const isMultipart = (body: unknown): body is MultipartBody => typeof body === "object" && body !== null && "contentType" in body && "body" in body;

export async function request<T>(method: string, path: string, body?: unknown): Promise<Answer<T>> {
  const init: RequestInit = { method, credentials: "same-origin", headers: {} };
  if (isMultipart(body)) {
    init.body = body.body;
    init.headers = { "Content-Type": body.contentType };
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  try {
    const response = await fetch(path, init);
    const text = await response.text();
    const parsed = (text ? JSON.parse(text) : {}) as T & { error?: string; fields?: Record<string, string> };
    return { status: response.status, body: parsed, error: parsed.error ?? "", fields: parsed.fields ?? {} };
  } catch {
    return { status: 0, body: {} as T, error: "The desk could not reach Pegworth. Check the connection and try again.", fields: {} };
  }
}

export function sessionEnded(answer: Answer<unknown>): boolean {
  return answer.status === 401 && answer.error === SESSION_ENDED;
}
