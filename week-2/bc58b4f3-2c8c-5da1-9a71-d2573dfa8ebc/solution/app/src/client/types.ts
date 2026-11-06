// Shapes of the API answers the screens read.

export type Role = "scheduler" | "org_admin" | "dispatcher" | "billing_lead" | "interpreter";

export interface User {
  id: string;
  name: string;
  role: Role;
  initials: string;
  org: { code: string; name: string } | null;
}

export type AssignmentStatus =
  | "draft"
  | "released"
  | "partially_covered"
  | "covered"
  | "served"
  | "verified"
  | "invoiced"
  | "cancelled";

interface SeatView {
  seat: number;
  status: "open" | "held" | "served";
  interpreter_initials?: string | null;
  interpreter_name?: string | null;
}

export interface Cancellation {
  cancelled_at: string;
  fee_applies: boolean;
  business_minutes_notice: number;
  fee_cents: number;
}

export interface Billing {
  status: "none" | "ready" | "queued" | "posted";
  invoice_id: string | null;
  total_cents: number | null;
}

/** Any of the four assignment views; the fields beyond the offer view depend on the caller. */
export interface Assignment {
  number: string;
  status: AssignmentStatus;
  language: string;
  setting: string;
  city: string;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  seats: SeatView[];
  street_address?: string;
  patient_initials?: string;
  medical_notes?: string;
  scheduler?: { name: string; phone: string | null };
  cancellation?: Cancellation | null;
  billing?: Billing;
  org?: { code: string; name: string };
}

export interface CoverageAssignment {
  number: string;
  status: AssignmentStatus;
  org_code: string;
  setting: string;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  seats: SeatView[];
}

interface CoverageLanguage {
  code: string;
  name: string;
  uncovered_minutes: number;
  assignments: CoverageAssignment[];
}

export interface Coverage {
  week_start: string;
  languages: CoverageLanguage[];
}

export interface QueueItem {
  number: string;
  org_code: string;
  kind: "service" | "late_cancellation";
  start_at: string;
  total_cents: number;
  billing: Billing;
}

export interface RateEntry {
  org: string;
  service_line: "asl" | "spoken";
  effective_from: string;
  hourly_rate_cents: number;
  mileage_cents_per_mile: number;
}

export interface Scheduler {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}
