// Domain types shared by the store, the API and the pending-step engine.

export type Role = 'dispatcher' | 'agent' | 'pilot' | 'clerk';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  agency_code: string | null;
}

export interface Agency {
  code: string;
  name: string;
}

export interface Vessel {
  id: string;
  name: string;
  imo: string;
  agency_code: string;
  length_m: number;
  gross_tonnage: number;
  block_coefficient: number;
  default_speed_kn: number;
  default_draught_mm: number;
}

export interface Pilot {
  id: string;
  name: string;
  licence_class: 'A' | 'B' | 'C';
  email: string;
}

export type MoveStatus =
  | 'Ordered'
  | 'Window committed'
  | 'Pilot assigned'
  | 'Pilot away'
  | 'On board'
  | 'Completed'
  | 'Invoiced'
  | 'Cancelled'
  | 'Cancelled late'
  | 'Refused at ladder';

export interface CommittedValues {
  boarding_ms: number;
  pinch_waypoint: string;
  margin_mm: number;
  tide_version: number;
}

export interface NoticeRecord {
  kind: string;
  to: string;
  state: 'pending' | 'sent';
  move_ref: string;
  // Pending-step bookkeeping; never serialized to clients.
  subject: string;
  body: string;
  attempt: number;
  photo_keys: string[];
}

export interface StoredLine {
  label: string;
  quantity: number;
  unit_cents: number;
  amount_cents: number;
  tariff_revision: string;
}

export interface StoredBillingEvent {
  kind: 'Completed' | 'Cancelled late' | 'Refused at ladder';
  lines: StoredLine[];
  total_cents: number;
  invoice_id: string;
  at_ms: number;
}

export interface HistoryEntry {
  at_ms: number;
  status: MoveStatus;
  by: string;
}

export interface Move {
  ref: string;
  version: number;
  status: MoveStatus;
  agency_code: string;
  vessel_id: string;
  draught_mm: number;
  speed_kn: number;
  duty_minutes: number;
  block_coefficient: number;
  length_m: number;
  gross_tonnage: number;
  boarding_ms: number;
  committed: CommittedValues | null;
  pilot_id: string | null;
  notices: NoticeRecord[];
  billing_events: StoredBillingEvent[];
  late_amendments: number;
  detention_spans: { start_ms: number; end_ms: number }[];
  detention_open: boolean;
  ladder_report_ids: string[];
  history: HistoryEntry[];
  dispatcher_notes: string[];
  rest_override: { reason: string; by: string; at_ms: number } | null;
  correction: string | null;
  created_ms: number;
}

export interface StoredPhoto {
  id: string;
  move_ref: string | null;
  uploader_id: string;
  sha256: string;
  size_bytes: number;
  content_type: string;
  key: string;
  stored: boolean;
}

export interface PilotCard {
  id: string;
  vessel_id: string;
  uploader_id: string;
  sha256: string;
  size_bytes: number;
  content_type: string;
  key: string;
  at_ms: number;
}

export interface LadderReport {
  id: string;
  move_ref: string;
  compliant: boolean;
  defects: string[];
  refused: boolean;
  location: 'deck' | 'pilot_boat';
  note: string;
  photos: { photo_id: string; sha256: string; size_bytes: number }[];
  filed_by: string;
  filed_at_ms: number;
}

export interface Invoice {
  id: string;
  move_ref: string;
  agency_code: string;
  event_kind: 'Completed' | 'Cancelled late' | 'Refused at ladder';
  lines: StoredLine[];
  total_cents: number;
  charge_state: 'pending' | 'posted';
  state: 'pending' | 'issued';
  number: string | null;
  balance_cents: number | null;
  kb_invoice_id: string | null;
  billing_event_index: number;
}

export interface SkipRecord {
  pilot_id: string;
  reasons: string[];
  move_ref: string;
  at_ms: number;
}

export interface OverrideRecord {
  id: string;
  move_ref: string;
  pilot_id: string;
  reason: string;
  by: string;
  at_ms: number;
}

export interface Session {
  token: string;
  user_id: string;
  created_ms: number;
}

export interface IdempotencyRecord {
  user_id: string;
  key: string;
  method: string;
  path: string;
  body_fingerprint: string;
  status: number;
  body: string;
  state: 'in_progress' | 'finished';
  at_ms: number;
}

export interface PendingStep {
  id: string;
  kind: 'charge_post' | 'invoice_commit' | 'notice_send';
  payload: string;
  state: 'pending' | 'done';
  attempts: number;
  attempt_token: string | null;
  at_ms: number;
}

export interface TideRevisionRow {
  date: string;
  events: string;
  version: number;
}

export interface TariffRevisionRow {
  id: string;
  label: string;
  effective_ms: number;
  effective_at: string;
  body: string;
}
