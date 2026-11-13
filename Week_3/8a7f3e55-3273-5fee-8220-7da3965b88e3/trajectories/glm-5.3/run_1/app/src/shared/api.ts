// API wire types shared by the server and the browser client.
import type { BookingStatus, CoverageState, LineKind, OpenCallStatus, SyncStatus } from './terms.js';

export interface Credential {
  code: string;
  expires_on: string;
}

export interface HolderCard {
  id?: string;
  name: string;
  initials: string;
  credentials: Array<{ code: string; expires_on: string }> | string[];
  is_me?: boolean;
  phone?: string;
  email?: string;
  home_city?: string;
  pay_rate_cents?: number;
}

export interface RotationTurn {
  index: number;
  kind: 'turn' | 'gap';
  seat: number | null;
  holder_name: string | null;
  holder_initials: string | null;
  start: string;
  end: string;
  label: string | null;
}

export interface Rotation {
  mode: 'team' | 'solo';
  interval_minutes: number;
  threshold_minutes: number;
  coverage_text: string;
  turns: RotationTurn[];
}

export interface CoverageInfo {
  state: CoverageState;
  covered_minutes: number;
  percent: number;
}

export interface MaterialInfo {
  id: string;
  name: string;
  size_bytes: number;
  content_type: string;
  sha256: string;
  uploaded_at: string;
}

export interface SeatInfo {
  seat: number;
  holder: HolderCard | null;
}

export interface ChargeInfo {
  line_ref: string;
  kind: LineKind;
  amount_cents: number;
  sync_status: SyncStatus;
}

export interface Booking {
  id: string;
  ref: string;
  org_id?: string;
  org_name: string;
  setting: string;
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
  coverage: CoverageInfo;
  seats: SeatInfo[];
  rotation: Rotation;
  materials: MaterialInfo[];
  requester_name?: string;
  requester_notes?: string;
  charge?: ChargeInfo | null;
  created_at?: string;
}

export interface AgencyInfo {
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

export interface MeInfo {
  id: string;
  name: string;
  email: string;
  role: string;
  org_id: string | null;
}

export interface QuoteInfo {
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
  kind: LineKind;
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
  status: 'open' | 'closed';
  lines: InvoiceLine[];
  relayline_total_cents: number;
  billing_total_cents: number | null;
  billing_reachable: boolean;
  closed_at: string | null;
}

export interface AuditEntry {
  at: string;
  actor_name: string;
  action: string;
  from_status: BookingStatus | null;
  to_status: BookingStatus | null;
  seat: number | null;
  interpreter_name: string | null;
}

export interface InterpreterChoice {
  id: string;
  name: string;
  initials: string;
  credentials: Array<{ code: string; expires_on: string }>;
  phone: string;
  email: string;
  home_city: string;
  pay_rate_cents: number;
  qualified: boolean | null;
  busy: boolean | null;
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

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  status?: string;
  quote?: QuoteInfo;
  pending_line_refs?: string[];
  relayline_total_cents?: number;
  billing_total_cents?: number;
  earliest_allowed?: string;
}
