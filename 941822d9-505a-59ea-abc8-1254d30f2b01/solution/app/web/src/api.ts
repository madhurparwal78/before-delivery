// The one fetch wrapper: same-origin JSON, typed failures for the brief's error shape.

export type Role = "learner" | "coordinator" | "planner" | "author";

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  organisation: { id: string; name: string; kind: "provider" | "hospital" } | null;
}

interface ModuleSummary {
  id: string;
  position: number;
  title: string;
  minutes: number;
  kind: "lesson" | "evaluation";
  body?: string;
  question?: { prompt: string; options: string[]; answer_index: number };
}

export interface Cohort {
  id: string;
  course_id: string;
  name: string;
  starts_on: string;
  close_date: string;
  closes_at: string;
  seat_cap: number;
  seats_remaining: number;
  open: boolean;
  roster?: { enrolment_id: string; nurse_name: string; state: string }[];
  waitlist?: { position: number; nurse_name: string; joined_at: string }[];
}

export type CourseState = "draft" | "in_review" | "published" | "withdrawn";

export interface Course {
  id: string;
  title: string;
  summary: string;
  format: "self_paced" | "cohort";
  state: CourseState;
  list_price: string;
  total_minutes: number;
  contact_hours: string;
  version: number;
  author: { id: string; display_name: string };
  modules?: ModuleSummary[];
  cohorts?: Cohort[];
}

export interface Quote {
  list_price: string;
  employer_share: string;
  learner_share: string;
  coverage_percent: string;
  sponsor: string | null;
}

export type EnrolmentState = "held" | "confirmed" | "completed" | "certified" | "refunded" | "withdrawn";

export interface Enrolment {
  id: string;
  course_id: string;
  course_title: string;
  cohort_id: string | null;
  state: EnrolmentState;
  funding: "card" | "co_pay" | "seat";
  assignment_id: string | null;
  list_price: string;
  employer_share: string;
  learner_share: string;
  enrolled_at: string;
  verified_minutes: number;
  total_minutes: number;
  progress_percent: number;
  certificate_id: string | null;
  modules: { id: string; title: string; minutes: number; kind: "lesson" | "evaluation"; status: "verified" | "unverified" }[];
}

export interface Certificate {
  id: string;
  serial: string;
  state: "sealing" | "sealed" | "revoked";
  version: number;
  reissue_pending: boolean;
  nurse_name: string;
  course_title: string;
  contact_hours: string;
  issued_on: string | null;
  enrolment_id: string;
  verified_module_count: number;
  versions: { version: number; state: string; sealed_on: string | null; nurse_name: string }[];
}

export interface ShareLink {
  id: string;
  url: string;
  state: "active" | "revoked" | "expired";
  created_at: string;
  expires_at: string;
}

export interface Pack {
  id: string;
  course_id: string;
  course_title: string;
  seats_purchased: number;
  balance: number;
  price_total: string;
  purchased_at: string;
  expires_at: string;
  state: "active" | "expired";
}

export interface LedgerEntry {
  movement_id: string;
  kind: "purchase" | "assignment" | "return" | "expiry";
  account: string;
  seats: number;
  assignment_id: string | null;
  posted_at: string;
}

export interface Coverage {
  coverage_percent: string;
  scheduled: { coverage_percent: string; effective_on: string } | null;
}

export interface Dashboard {
  seats_purchased: number;
  seats_assigned: number;
  seats_available: number;
  seats_expired: number;
  completions: number;
  hours_awarded: string;
  coverage: Coverage;
}

export interface Nurse {
  id: string;
  display_name: string;
  email: string;
  seats_held: number;
  hours_completed: string;
}

export interface RefundRequest {
  id: string;
  enrolment_id: string;
  nurse_name: string;
  course_title: string;
  state: "pending" | "approved" | "declined";
  reason: string;
  requested_at: string;
  refund_total: string;
  employer_refund: string;
  learner_refund: string;
  decided_by: { id: string; display_name: string } | null;
  decided_at: string | null;
  decision_note: string | null;
}

export interface Verified {
  serial: string;
  nurse_name: string;
  course_title: string;
  contact_hours: string;
  issued_on: string;
  state: "sealed" | "revoked";
  provider: string;
  accreditation_statement: string;
}

/** A non-2xx answer in the brief's error shape. */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly fields: Record<string, string>,
    readonly body: Record<string, unknown>,
  ) {
    super(code);
  }
}

/** The request never reached Credwell. */
export class NetworkFailure extends Error {}

type Listener = () => void;
const unauthenticated: Listener[] = [];
export const onUnauthenticated = (listener: Listener): void => {
  unauthenticated.push(listener);
};

export async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new NetworkFailure("network");
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : {};
  const data = parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  if (response.ok) return data as T;
  if (response.status === 401) unauthenticated.forEach((listener) => listener());
  const errors = data.errors;
  const fields: Record<string, string> = {};
  if (errors !== null && typeof errors === "object") {
    for (const [field, message] of Object.entries(errors)) if (typeof message === "string") fields[field] = message;
  }
  throw new ApiFailure(response.status, typeof data.error === "string" ? data.error : "validation", fields, data);
}

export const newIdempotencyKey = (): string => `credwell-${crypto.randomUUID()}`;
