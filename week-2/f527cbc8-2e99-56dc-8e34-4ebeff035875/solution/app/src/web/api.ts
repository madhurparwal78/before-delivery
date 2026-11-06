// The browser's view of the API: record types as the server prints them, and one request function that turns every
// answer into a result (brief: Backend, API).
import type { BookingStatus, DayStatus } from "../shared/transitions";

export type { BookingStatus, DayStatus };

export type Role = "farrier" | "apprentice" | "owner" | "barn_manager";
export type Hoof = "LF" | "RF" | "LH" | "RH";
export type Phase = "before" | "after";
export type VisitStatus = "open" | "closed" | "invoice_pending" | "invoiced";
type InvoiceStatus = "pending" | "unpaid" | "paid";
export type WorkCode = "trim" | "front_reset" | "full_reset" | "front_new" | "full_new";
export type Alignment = "aligned" | "broken-back" | "broken-forward";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Practice {
  name: string;
  time_zone: string;
  today: string;
  outstanding_alert?: { id: number; threshold_cents: number; at: string } | null;
}

export interface Barn {
  id: string;
  name: string;
  trip_fee_cents: number;
}

export interface Slot {
  id: string;
  time: string;
  state: "open" | "taken";
  my_booking_id?: string | null;
}

export interface BarnDay {
  id: string;
  barn: { id: string; name: string };
  business_date: string;
  start_time: string;
  time_zone: string;
  starts_at: string;
  cancellation_cutoff_at: string;
  slot_count: number;
  slot_minutes: number;
  booked_count: number;
  trip_fee_cents?: number;
  status: DayStatus;
  slots: Slot[];
}

export interface Booking {
  id: string;
  number: number;
  status: BookingStatus;
  barn_day_id: string;
  slot_id: string;
  slot_time: string;
  horse: { id: string; name: string };
  hold_expires_at: string | null;
  trip_share_cents: number | null;
  offer: boolean;
  deposit_cents: number;
  payment_id: string | null;
}

/** One booking-list row; which keys are present depends on the caller's role (brief: API, Barn days). */
export interface SheetRow {
  booking_id?: string;
  number?: number;
  slot_time: string;
  horse_id?: string;
  horse_name: string;
  stall: string;
  status?: BookingStatus;
  owner_name?: string;
  owner_email?: string;
  owner_phone?: string;
  trip_share_cents?: number | null;
  visit_id?: string | null;
  visit_status?: VisitStatus | null;
  invoice_status?: InvoiceStatus | null;
  invoice_total_cents?: number | null;
}

export interface Allocation {
  barn_day_id: string;
  trip_fee_cents: number;
  shares: Array<{ booking_id: string; number: number; horse: { id: string; name: string }; status: BookingStatus; initial_cents: number; share_cents: number }>;
  adjustments: Array<{ seq: number; booking_id: string; number: number; delta_cents: number; cause_booking_id: string; at: string }>;
}

export interface WaitlistEntry {
  id: string;
  position: number;
  horse: { id: string; name: string };
  joined_at: string;
}

export interface Horse {
  id: string;
  name: string;
  barn: { id: string; name: string };
  stall: string;
  cycle_weeks: number;
  last_worked_date: string | null;
  next_due_date: string | null;
  due_status: "current" | "due" | "overdue" | "unknown";
  owner?: { id: string; name: string; email: string; phone: string };
}

export interface Photo {
  id: string;
  visit_id: string;
  hoof: Hoof;
  phase: Phase;
  content_type: string;
  width: number;
  height: number;
  url: string;
  url_expires_at: string;
  thumbnail_status: "pending" | "ready" | "failed";
  thumbnail_url: string | null;
}

export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface MarkedLine extends Line {
  angle: number;
}

export interface HoofMarks {
  hoof: Hoof;
  version: number;
  hoof_wall: MarkedLine;
  pastern: MarkedLine;
  alignment: Alignment;
  saved_by?: { id: string; name: string; role: Role };
  saved_at?: string;
  restored_from?: number | null;
}

export interface MarksVersion {
  version: number;
  hoof_wall: MarkedLine;
  pastern: MarkedLine;
  alignment: Alignment;
  saved_by: { id: string; name: string; role: Role };
  saved_at: string;
  restored_from: number | null;
}

export interface UploadSession {
  id: string;
  hoof: Hoof;
  phase: Phase;
  size_bytes: number;
  chunk_bytes: number;
  offset: number;
  expires_at: string;
}

export interface Invoice {
  id: string;
  kind: "visit" | "trip";
  status: InvoiceStatus;
  horse: { id: string; name: string };
  business_date: string;
  items: { description: string; amount_cents: number }[];
  total_cents: number;
  balance_cents: number;
  killbill_invoice_id: string | null;
  dunning_state: DunningState;
  dunning_next_try: string | null;
  reconciliation: "unchecked" | "matched" | "mismatch" | "unavailable";
}

export type DunningState = "none" | "past_due" | "retry_1" | "retry_2" | "blocked" | "cleared";

export interface ReadBack {
  status: "matched" | "mismatch" | "unavailable";
}

export interface Visit {
  id: string;
  status: VisitStatus;
  horse: { id: string; name: string };
  booking_id: string | null;
  business_date: string;
  note: string;
  photos: Photo[];
  marks: HoofMarks[];
  invoice: Invoice | null;
}

export interface ComparisonSide {
  business_date: string;
  photo: Pick<Photo, "hoof" | "phase" | "content_type" | "width" | "height" | "url" | "url_expires_at">;
  hoof_wall: MarkedLine;
  pastern: MarkedLine;
  alignment: Alignment;
}

/** The comparison of one hoof between two marked visits; the horse panel and the vet page share this shape. */
export interface Comparison {
  hoof: Hoof;
  previous: ComparisonSide & { visit_id?: string };
  current: ComparisonSide & { visit_id?: string };
  difference: { hoof_wall: number; pastern: number };
  readout: [string, string, string];
  marked_visits?: { visit_id: string; business_date: string }[];
}

export interface VetLinkEntry {
  id: string;
  vet_name: string;
  vet_email: string;
  status: "active" | "revoked" | "expired";
  expires_at: string;
  view_count: number;
  /** The live pair's business dates at the moment of the read. */
  previous_date: string | null;
  current_date: string | null;
}

export interface LinkView {
  at: string;
  address: string;
  outcome: "viewed" | "expired" | "revoked";
  user_agent: string;
  /** The pair served, for a `viewed` row; null otherwise. */
  previous_date: string | null;
  current_date: string | null;
}

export interface VetView {
  horse: { name: string };
  previous_date: string;
  current_date: string;
  expires_at: string;
  hooves: Record<Hoof, Comparison | null>;
}

export type Prices = Record<WorkCode, number>;

export interface PriceList {
  id: string;
  effective_from: string;
  deposit_cents: number;
  prices: Prices;
}

export interface ApiToken {
  id: string;
  name: string;
  scope: "read_only" | "billing";
  created_at: string;
}

export interface DashboardData {
  month: string;
  billed_cents: number;
  collected_cents: number;
  refunded_cents: number;
  outstanding_cents: number;
  overdue_horses: number;
  rows: { date: string; billed_cents: number; collected_cents: number; refunded_cents: number }[];
}

export interface Job {
  id: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "dead";
  attempts: number;
  max_attempts: number;
  run_at: string;
  last_error: string | null;
  result: { key?: string; url?: string; url_expires_at?: string; photo_id?: string } | null;
}

export interface ImportResult {
  created_owners: number;
  matched_owners: number;
  created_horses: number;
  updated_horses: number;
}

export interface ImportError {
  line: number;
  column: string;
  code: string;
}

export interface ErrorBody {
  error: string;
  errors?: Record<string, string>;
  from?: string;
  action?: string;
  current?: HoofMarks | null;
  decline_code?: string;
  remaining_bytes?: number;
  offset?: number;
  import_errors?: ImportError[];
}

type Result<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ErrorBody; retryAfter: number | null };

/** The error code for a request that never got an answer. */
export const NETWORK = "network";

let onSignedOut: () => void = () => undefined;

/** Called once by the shell: what happens when the session is gone (any 401 outside sign-in). */
export function whenSignedOut(handler: () => void): void {
  onSignedOut = handler;
}

interface RequestOptions {
  body?: unknown;
  form?: FormData;
  /** A raw body with its content type (CSV import, upload chunks). */
  raw?: { data: Blob; type: string };
  headers?: Record<string, string>;
  idempotencyKey?: string;
}

export async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<Result<T>> {
  const headers: Record<string, string> = { accept: "application/json", ...options.headers };
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.raw) {
    headers["content-type"] = options.raw.type;
    body = options.raw.data;
  } else if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: "same-origin" });
  } catch {
    return { ok: false, status: 0, error: { error: NETWORK }, retryAfter: null };
  }
  const text = await response.text().catch(() => "");
  const parsed: unknown = text ? safeParse(text) : null;
  if (response.ok) return { ok: true, status: response.status, data: parsed as T };
  if (response.status === 401 && path !== "/api/session") onSignedOut();
  const error = errorBody(parsed, response.status);
  const retry = Number(response.headers.get("retry-after"));
  return { ok: false, status: response.status, error, retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null };
}

/** An import refusal carries its rows in `errors` as a list; every other refusal keeps the field map. */
function errorBody(parsed: unknown, status: number): ErrorBody {
  if (!parsed || typeof parsed !== "object" || !("error" in parsed)) return { error: `http_${status}` };
  const body = parsed as ErrorBody & { errors?: unknown };
  if (Array.isArray(body.errors)) {
    const { errors, ...rest } = body;
    return { ...rest, import_errors: errors as ImportError[] };
  }
  return body as ErrorBody;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const get = <T>(path: string): Promise<Result<T>> => request<T>("GET", path);

/** A fresh idempotency key (crypto.getRandomValues works on plain-http origins too). */
export function freshKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
