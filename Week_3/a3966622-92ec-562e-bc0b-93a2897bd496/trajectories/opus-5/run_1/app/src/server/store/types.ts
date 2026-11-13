import type { Line, TariffRevision } from '../../domain/tariff.ts';
import type { MoveStatus } from '../../domain/moves.ts';
import type { EligibilityReason, LicenceClass } from '../../domain/rest.ts';
import type { TideEvent } from '../../domain/tide.ts';

export type Role = 'dispatcher' | 'clerk' | 'agent' | 'pilot';

export type UserRecord = {
  id: string;
  email: string;
  password: string;
  name: string;
  role: Role;
  agency_code: string | null;
  pilot_id: string | null;
};

export type AgencyRecord = { code: string; name: string; killbill_account_id: string | null };

export type VesselRecord = {
  id: string;
  name: string;
  imo: string;
  agency_code: string;
  length_m: number;
  gross_tonnage: number;
  block_coefficient: number;
  speed_kn: number;
  draught_mm: number;
};

export type PilotRecord = {
  id: string;
  name: string;
  licence_class: LicenceClass;
  user_id: string;
};

/** A seeded duty has no move, and it counts for every rest rule. */
export type SeededDutyRecord = {
  id: string;
  pilot_id: string;
  start_at: string;
  minutes: number;
};

export type CommittedWindow = {
  boarding_at: string;
  pinch_waypoint: string;
  margin_mm: number;
  tide_version: number;
};

export type MoveDuty = { pilot_id: string; start_at: string; end_at: string };

export type HistoryEntry = { at: string; status: string; by: string };

export type DispatcherNote = { at: string; by: string; note: string };

export type RestOverrideRecord = {
  id: string;
  move_ref: string;
  pilot_id: string;
  reason: string;
  by: string;
  at: string;
};

export type BillingEventKindRecord = 'Completed' | 'Cancelled late' | 'Refused at ladder';

export type BillingEventRecord = {
  kind: BillingEventKindRecord;
  at: string;
  invoice_id: string;
};

export type MoveRecord = {
  ref: string;
  version: number;
  status: MoveStatus;
  agency_code: string;
  vessel_id: string;
  length_m: number;
  gross_tonnage: number;
  block_coefficient: number;
  draught_mm: number;
  speed_kn: number;
  duty_minutes: number;
  boarding_at: string;
  committed: CommittedWindow | null;
  pilot_id: string | null;
  pilot_history: string[];
  duty: MoveDuty | null;
  late_amendments: number;
  detention_open_since: string | null;
  detention_seconds: number;
  notice_ids: string[];
  billing_events: BillingEventRecord[];
  ladder_report_ids: string[];
  history: HistoryEntry[];
  corrections: { at: string; by: string; text: string }[];
  dispatcher_notes: DispatcherNote[];
  rest_override_id: string | null;
  created_at: string;
};

export type PhotoRecord = {
  id: string;
  move_ref: string;
  agency_code: string;
  uploaded_by: string;
  sha256: string;
  size_bytes: number;
  content_type: string;
  key: string;
};

export type PilotCardRecord = {
  card_id: string;
  vessel_id: string;
  sha256: string;
  size_bytes: number;
  key: string;
  uploaded_at: string;
};

export type LadderReportRecord = {
  id: string;
  move_ref: string;
  compliant: boolean;
  defects: string[];
  refused: boolean;
  location: 'deck' | 'pilot_boat';
  note: string;
  photo_ids: string[];
  filed_by: string;
  filed_at: string;
};

export type InvoiceRecord = {
  id: string;
  move_ref: string;
  agency_code: string;
  event_kind: BillingEventKindRecord;
  state: 'pending' | 'issued';
  number: string | null;
  balance_cents: number | null;
  balance_confirmed_at: string | null;
  lines: Line[];
  total_cents: number;
  charge_state: 'pending' | 'posted';
  killbill_invoice_id: string | null;
  issue_requested: boolean;
  created_at: string;
};

export type NoticeKind =
  | 'Order confirmation'
  | 'Assignment notice'
  | 'Order amended'
  | 'Order cancelled'
  | 'Assignment withdrawn'
  | 'Ladder notice';

export type NoticeRecord = {
  id: string;
  move_ref: string;
  kind: NoticeKind;
  to: string[];
  subject: string;
  body: string;
  photo_ids: string[];
  state: 'pending' | 'sent';
  created_at: string;
  sent_at: string | null;
};

export type StepRecord = {
  id: string;
  kind: 'charge_post' | 'invoice_commit' | 'notice_send';
  target_id: string;
  state: 'pending' | 'done';
  attempts: number;
  last_attempt_at: string | null;
  last_error: string | null;
};

export type TideRevisionRecord = {
  date: string;
  events: TideEvent[];
  version: number;
  published_at: string;
};

export type SkipRecord = {
  pilot_id: string;
  reasons: EligibilityReason[];
  move_ref: string;
  at: string;
};

export type IdempotencyRecord = {
  key: string;
  user_id: string;
  method: string;
  path: string;
  body_hash: string;
  status: number;
  response: unknown;
  created_at: string;
};

export type SessionRecord = { token: string; user_id: string; created_at: string };

export type StoreState = {
  schema: 1;
  created_at: string;
  store_date: string;
  tide_version: number;
  counters: Record<string, number>;
  users: UserRecord[];
  agencies: AgencyRecord[];
  vessels: VesselRecord[];
  pilots: PilotRecord[];
  turn_order: string[];
  seeded_duties: SeededDutyRecord[];
  moves: MoveRecord[];
  photos: PhotoRecord[];
  pilot_cards: PilotCardRecord[];
  ladder_reports: LadderReportRecord[];
  invoices: InvoiceRecord[];
  notices: NoticeRecord[];
  steps: StepRecord[];
  tide_revisions: TideRevisionRecord[];
  tariff_revisions: TariffRevision[];
  skips: SkipRecord[];
  rest_overrides: RestOverrideRecord[];
  idempotency: IdempotencyRecord[];
  sessions: SessionRecord[];
};
