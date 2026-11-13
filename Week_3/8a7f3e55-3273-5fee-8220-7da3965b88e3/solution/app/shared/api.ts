export type Role = "coordinator" | "interpreter" | "requester" | "billing_manager";

export type Setting = "medical" | "educational" | "legal" | "workplace";

export type BookingStatus =
  | "submitted"
  | "open"
  | "partially_covered"
  | "covered"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "cancelled_late";

export type CoverageState = "covered" | "partly_covered" | "uncovered";

export type OpenCallStatus = "none" | "open" | "closed";

export type SyncStatus = "synced" | "pending_sync";

export type ErrorCode =
  | "unauthenticated"
  | "invalid_credentials"
  | "forbidden"
  | "cross_origin"
  | "access_ended"
  | "not_found"
  | "invalid_transition"
  | "seat_filled"
  | "already_holding"
  | "schedule_conflict"
  | "not_qualified"
  | "open_call_closed"
  | "already_team"
  | "quote_changed"
  | "pending_sync"
  | "week_closed"
  | "total_mismatch"
  | "rate_would_reprice"
  | "link_expired"
  | "payload_too_large"
  | "unsupported_type"
  | "validation"
  | "idempotency_in_progress"
  | "idempotency_key_reused"
  | "billing_unavailable"
  | "storage_unavailable"
  | "internal_error";

export interface ApiErrorBody {
  error: ErrorCode;
  message: string;
  fields?: Record<string, string>;
  status?: BookingStatus;
  quote?: Quote;
  pending_line_refs?: string[];
  relayline_total_cents?: number;
  billing_total_cents?: number;
  earliest_allowed?: string;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  org_id: string | null;
}

export interface Agency {
  name: string;
  time_zone: string;
  now: string;
  today: string;
  solo_threshold_minutes: number;
  open_call_lead_minutes: number;
  prep_access_grace_minutes: number;
  prep_link_ttl_seconds: number;
  upload_limit_bytes: number;
  max_files_per_booking: number;
  accepted_types: string[];
}

export interface CoordinatorHolder {
  id: string;
  name: string;
  initials: string;
  credentials: { code: string; expires_on: string }[];
  phone: string;
  email: string;
  home_city: string;
  pay_rate_cents: number;
}

export interface BillingHolder {
  id: string;
  name: string;
  initials: string;
  credentials: string[];
}

export interface RequesterHolder {
  name: string;
  initials: string;
  credentials: string[];
}

export interface InterpreterHolder extends RequesterHolder {
  is_me: boolean;
}

export type Holder = CoordinatorHolder | BillingHolder | RequesterHolder | InterpreterHolder;

export interface RotationEntry {
  index: number;
  kind: "turn" | "gap";
  seat: number | null;
  holder_name: string | null;
  holder_initials: string | null;
  start: string;
  end: string;
  label: "relief needed" | "uncovered" | null;
}

export interface Rotation {
  mode: "solo" | "team";
  interval_minutes: number;
  threshold_minutes: number;
  coverage_text: string;
  turns: RotationEntry[];
}

export interface Material {
  id: string;
  name: string;
  size_bytes: number;
  content_type: string;
  sha256: string;
  uploaded_at: string;
}

export interface Charge {
  line_ref: string;
  kind: "completed" | "late_cancellation";
  amount_cents: number;
  sync_status: SyncStatus;
}

export interface Booking {
  id: string;
  ref: string;
  org_name: string;
  setting: Setting;
  title: string;
  location: string;
  onsite_contact_name: string;
  onsite_contact_phone: string;
  consumer_name: string;
  start: string;
  end: string;
  duration_minutes: number;
  status: BookingStatus;
  seat_count: number;
  open_call_status: OpenCallStatus;
  open_call_closes_at: string | null;
  coverage: { state: CoverageState; covered_minutes: number; percent: number };
  seats: { seat: number; holder: Holder | null }[];
  rotation: Rotation;
  materials: Material[];
  org_id?: string;
  requester_name?: string;
  requester_notes?: string;
  charge?: Charge | null;
  created_at?: string;
}

export interface Quote {
  late: boolean;
  cutoff: string;
  interpreter_count: number;
  billable_minutes: number;
  charge_cents: number;
}

export interface InvoiceLine {
  line_ref: string;
  booking_id: string;
  booking_ref: string;
  org_id: string;
  kind: "completed" | "late_cancellation";
  assignment_date: string;
  rate_effective_from: string;
  hourly_rate_cents: number;
  team_surcharge_bp: number;
  basis_minutes: number;
  billable_minutes: number;
  interpreter_count: number;
  time_amount_cents: number;
  mileage_miles: number;
  mileage_cents_per_mile: number;
  mileage_amount_cents: number;
  amount_cents: number;
  billing_amount_cents: number | null;
  billing_week: string;
  sync_status: SyncStatus;
  created_at: string;
}

export interface WeekStatement {
  org_id: string;
  org_name: string;
  week_start: string;
  status: "open" | "closed";
  lines: InvoiceLine[];
  relayline_total_cents: number;
  billing_total_cents: number | null;
  billing_reachable: boolean;
  closed_at: string | null;
}

export interface ContractRate {
  effective_from: string;
  hourly_rate_cents: number;
  team_surcharge_bp: number;
  mileage_cents_per_mile: number;
}

export interface Contract {
  id: string;
  org_id: string;
  org_name: string;
  minimum_minutes: number;
  increment_minutes: number;
  rotation_interval_minutes: number;
  rates: ContractRate[];
}

export interface AuditEntry {
  at: string;
  actor_name: string;
  action: string;
  from_status: BookingStatus | null;
  to_status: BookingStatus;
  seat: number | null;
  interpreter_name: string | null;
}

export type InterpreterChoice = CoordinatorHolder & { qualified: boolean | null; busy: boolean | null };

export interface PrepLink {
  url: string;
  expires_at: string;
}
