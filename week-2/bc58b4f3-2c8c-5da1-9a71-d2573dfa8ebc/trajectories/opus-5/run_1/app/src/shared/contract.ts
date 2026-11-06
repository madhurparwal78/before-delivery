export type Role = 'scheduler' | 'org_admin' | 'dispatcher' | 'billing_lead' | 'interpreter';

export type AssignmentStatus =
  | 'draft'
  | 'released'
  | 'partially_covered'
  | 'covered'
  | 'served'
  | 'verified'
  | 'invoiced'
  | 'cancelled';

export type SeatStatus = 'open' | 'held' | 'served';

export type BillingStatus = 'none' | 'ready' | 'queued' | 'posted';

export type Setting = 'hospital' | 'clinic' | 'school';

export type ServiceLine = 'asl' | 'spoken';

export type ChargeKind = 'service' | 'late_cancellation';

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  draft: 'Awaiting release',
  released: 'Open',
  partially_covered: 'Partly covered',
  covered: 'Covered',
  served: 'Served',
  verified: 'Verified',
  invoiced: 'Invoiced',
  cancelled: 'Cancelled',
};

export const BILLING_STATUS_LABELS: Record<Exclude<BillingStatus, 'none'>, string> = {
  ready: 'Ready',
  queued: 'Queued',
  posted: 'Posted',
};

export const SETTING_LABELS: Record<Setting, string> = {
  hospital: 'Hospital',
  clinic: 'Clinic',
  school: 'School',
};

export interface SessionUser {
  id: number;
  name: string;
  role: Role;
  initials: string;
  org: { code: string; name: string } | null;
}

export interface SeatView {
  seat: number;
  status: SeatStatus;
  interpreter_initials?: string | null;
  interpreter_name?: string | null;
}

export interface CancellationView {
  cancelled_at: string;
  fee_applies: boolean;
  business_minutes_notice: number;
  fee_cents: number;
}

export interface AssignmentBillingView {
  status: BillingStatus;
  invoice_id: string | null;
  total_cents: number | null;
}

export interface AssignmentView {
  number: string;
  status: AssignmentStatus;
  language: string;
  setting: Setting;
  city: string;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  seats: SeatView[];
  street_address?: string;
  patient_initials?: string;
  medical_notes?: string;
  scheduler?: { name: string; phone: string };
  cancellation?: CancellationView | null;
  billing?: AssignmentBillingView;
  org?: { code: string; name: string };
}

export interface CoverageAssignment {
  number: string;
  status: AssignmentStatus;
  org_code: string;
  setting: Setting;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  seats: SeatView[];
}

export interface CoverageLanguage {
  code: string;
  name: string;
  uncovered_minutes: number;
  assignments: CoverageAssignment[];
}

export interface CoverageResponse {
  week_start: string;
  languages: CoverageLanguage[];
}

export interface CancellationQuote {
  fee_applies: boolean;
  business_minutes_notice: number;
  fee_cents: number;
}

export interface ChargeLine {
  seat: number;
  actual_minutes: number | null;
  billable_minutes: number;
  amount_cents: number;
  round_trip_miles: number;
  billable_miles: number;
  mileage_cents: number;
}

export interface ChargesResponse {
  number: string;
  kind: ChargeKind;
  rate: { effective_from: string; hourly_rate_cents: number; mileage_cents_per_mile: number };
  lines: ChargeLine[];
  total_cents: number;
}

export interface BillingQueueItem {
  number: string;
  org_code: string;
  kind: ChargeKind;
  start_at: string;
  total_cents: number;
  billing: AssignmentBillingView;
}

export interface RateCardEntry {
  org: string;
  service_line: ServiceLine;
  effective_from: string;
  hourly_rate_cents: number;
  mileage_cents_per_mile: number;
}

export interface SchedulerEntry {
  id: number;
  name: string;
  email: string;
  phone: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

export interface ScreenEntry {
  label: string;
  path: string;
}

/** The screens each role may reach, in navigation order; the first one is its landing screen. */
export const SCREENS_BY_ROLE: Record<Role, ScreenEntry[]> = {
  scheduler: [{ label: 'Requests', path: '/requests' }],
  org_admin: [
    { label: 'Requests', path: '/requests' },
    { label: 'Schedulers', path: '/org' },
  ],
  dispatcher: [{ label: 'Board', path: '/board' }],
  interpreter: [
    { label: 'Open seats', path: '/offers' },
    { label: 'My seats', path: '/my-seats' },
  ],
  billing_lead: [{ label: 'Billing', path: '/billing' }],
};

/** Every path the app shell answers on. Anything else is not ours to serve. */
export const CLIENT_ROUTES: readonly string[] = [
  '/',
  ...new Set(Object.values(SCREENS_BY_ROLE).flatMap((screens) => screens.map((screen) => screen.path))),
];

export const LANGUAGE_NAMES: Record<string, string> = {
  asl: 'ASL',
  es: 'Spanish',
  vi: 'Vietnamese',
  so: 'Somali',
  ar: 'Arabic',
};

export const MAX_JSON_BODY_BYTES = 65536;
export const MAX_FORM_FILE_BYTES = 5_000_000;
export const MAX_UPLOAD_BODY_BYTES = 5_100_000;
export const VERIFICATION_LINK_TTL_SECONDS = 60;
export const REFRESH_INTERVAL_MS = 3000;
