// Frontend API client: one fetch helper with the app's error contract.

export type ApiErrorShape = {
  status: number;
  code: string | null;
  errors: Record<string, string> | null;
  extra: Record<string, unknown>;
};

export class ApiCallError extends Error {
  constructor(public shape: ApiErrorShape) {
    super(shape.code ?? "error");
  }
}

export class NetworkError extends Error {}

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  options: { idempotencyKey?: string; ifMatch?: number } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (options.idempotencyKey !== undefined) headers["Idempotency-Key"] = options.idempotencyKey;
  if (options.ifMatch !== undefined) headers["If-Match"] = `"${options.ifMatch}"`;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new NetworkError("network");
  }
  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!response.ok) {
    const obj = (parsed ?? {}) as Record<string, unknown>;
    const code = typeof obj.error === "string" ? obj.error : null;
    const errors = obj.errors && typeof obj.errors === "object" ? (obj.errors as Record<string, string>) : null;
    const extra: Record<string, unknown> = { ...obj };
    delete extra.error;
    delete extra.errors;
    throw new ApiCallError({ status: response.status, code, errors, extra });
  }
  return (parsed ?? {}) as T;
}

export type User = {
  id: string;
  email: string;
  display_name: string;
  role: "learner" | "coordinator" | "planner" | "author";
  organisation: { id: string; name: string; kind: string } | null;
  licence_number?: string;
  date_of_birth?: string;
};

export type ModuleSummary = {
  id: string;
  position: number;
  title: string;
  minutes: number;
  kind: "lesson" | "evaluation";
};

export type CourseModule = ModuleSummary & {
  body?: string;
  question?: { prompt: string; options: string[]; answer_index: number };
};

export type Cohort = {
  id: string;
  course_id: string;
  name: string;
  starts_on: string;
  close_date: string;
  closes_at: string;
  seat_cap: number;
  seats_remaining: number;
  open: boolean;
  roster?: Array<{ enrolment_id: string; nurse_name: string; state: string }>;
  waitlist?: Array<{ position: number; nurse_name: string; joined_at: string }>;
};

export type Course = {
  id: string;
  title: string;
  summary: string;
  format: "self_paced" | "cohort";
  state: "draft" | "in_review" | "published" | "withdrawn";
  list_price: string;
  total_minutes: number;
  contact_hours: string;
  version: number;
  author: { id: string; display_name: string };
  modules?: CourseModule[];
  cohorts?: Cohort[];
};

export type Quote = {
  list_price: string;
  employer_share: string;
  learner_share: string;
  coverage_percent: string;
  sponsor: string | null;
};

export type Enrolment = {
  id: string;
  course_id: string;
  course_title: string;
  cohort_id: string | null;
  state: "held" | "confirmed" | "completed" | "certified" | "refunded" | "withdrawn";
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
  modules: Array<{ id: string; title: string; minutes: number; kind: string; status: "verified" | "unverified" }>;
};

export type Certificate = {
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
  versions: Array<{ version: number; state: string; sealed_on: string | null; nurse_name: string }>;
};

export type RefundRequest = {
  id: string;
  enrolment_id: string;
  nurse_name: string;
  course_title: string;
  state: "pending" | "approved" | "declined";
  reason: string;
  requested_at: string;
  refund_total: string | null;
  employer_refund: string | null;
  learner_refund: string | null;
  decided_by: { id: string; display_name: string } | null;
  decided_at: string | null;
  decision_note: string | null;
};

export type Pack = {
  id: string;
  course_id: string;
  course_title: string;
  seats_purchased: number;
  balance: number;
  price_total: string;
  purchased_at: string;
  expires_at: string;
  state: "active" | "expired";
};

export type Coverage = {
  coverage_percent: string;
  scheduled: { coverage_percent: string; effective_on: string } | null;
};

export type Dashboard = {
  seats_purchased: number;
  seats_assigned: number;
  seats_available: number;
  seats_expired: number;
  completions: number;
  hours_awarded: string;
  coverage: Coverage;
};

export type ShareLink = {
  id: string;
  url: string;
  state: "active" | "revoked" | "expired";
  created_at: string;
  expires_at: string;
};

export type VerificationCertificate = {
  serial: string;
  nurse_name: string;
  course_title: string;
  contact_hours: string;
  issued_on: string;
  state: "sealed" | "revoked";
  provider: string;
  accreditation_statement: string;
};
