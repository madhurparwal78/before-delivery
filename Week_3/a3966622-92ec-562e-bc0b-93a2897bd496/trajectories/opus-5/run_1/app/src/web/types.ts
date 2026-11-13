export type Role = 'dispatcher' | 'clerk' | 'agent' | 'pilot';

export type SessionUser = {
  id: string;
  name: string;
  role: Role;
  agency_code: string | null;
};

export type Line = {
  label: string;
  quantity: number;
  unit_cents: number;
  amount_cents: number;
  tariff_revision: string;
};

export type PlanWaypoint = {
  id: string;
  name: string;
  distance_nm: number;
  sounded_depth_mm: number;
  confined: boolean;
  speed_limit_kn: number | null;
  leg_speed_kn: number;
  arrival_at: string;
  arrival_utc_offset: string;
  tide_mm: number;
  squat_mm: number;
  clearance_mm: number;
  margin_mm: number;
  pinch: boolean;
};

export type Plan = {
  tide_version: number;
  boarding_at: string;
  draught_mm: number;
  required_mm: number;
  waypoints: PlanWaypoint[];
  pinch: { waypoint_id: string; margin_mm: number };
  window_state: 'open' | 'closed';
  estimate: { tariff_revision: string; lines: Line[]; total_cents: number };
};

export type Move = {
  ref: string;
  version: number;
  status: string;
  detained: boolean;
  agency_code: string;
  vessel: {
    id: string;
    name: string;
    imo: string;
    length_m: number;
    gross_tonnage: number;
    block_coefficient: number;
  };
  draught_mm: number;
  draught: { metres: string; feet: string };
  speed_kn: number;
  duty_minutes: number;
  boarding_at: string;
  committed: {
    boarding_at: string;
    pinch_waypoint: string;
    margin_mm: number;
    tide_version: number;
  } | null;
  pilot: { id: string; name: string } | null;
  notice: { state: 'on_time' | 'late'; cutoff_at: string; cutoff_utc_offset: string };
  server_now: string;
  late_amendments: number;
  detention: { open: boolean; seconds: number };
  notices: { kind: string; to: string; state: 'pending' | 'sent' }[];
  billing: {
    state: 'none' | 'pending' | 'posted';
    invoice_id: string | null;
    invoice_ids: string[];
  };
  priced_by: string;
  total_cents: number;
  lines: Line[];
  ladder_reports: string[];
  corrections: { at: string; by: string; text: string }[];
  history: { at: string; status: string; by: string }[];
  dispatcher_notes?: { at: string; by: string; note: string }[];
  rest_override?: {
    id: string;
    move_ref: string;
    pilot_id: string;
    reason: string;
    by: string;
    at: string;
  } | null;
  window_returned?: boolean;
  late_notice?: boolean;
};

export type Vessel = {
  id: string;
  name: string;
  imo: string;
  agency_code: string;
  length_m: number;
  gross_tonnage: number;
  block_coefficient: number;
  speed_kn: number;
  draught_mm: number;
  pilot_card_id: string | null;
};

export type TurnEntry = {
  pilot_id: string;
  name: string;
  position: number;
  licence_class: string;
  eligible: boolean;
  reasons: string[];
  rest_until: string | null;
};

export type Eligibility = {
  boarding_at: string;
  next_eligible: string | null;
  turn: TurnEntry[];
};

export type PilotRow = {
  id: string;
  name: string;
  licence_class: string;
  position: number;
  on_duty: boolean;
  rest_until: string | null;
};

export type OpenWindow = { from: string; to: string };

export type WindowsReply = { date: string; tide_version: number; windows: OpenWindow[] };

export type ServiceSnapshot = { billing: 'up' | 'down'; storage: 'up' | 'down'; mail: 'up' | 'down' };

export type PortReply = {
  port: string;
  zone: string;
  now: string;
  store_date: string;
  tide_version: number;
  step_minutes: number;
};

export type TariffRevision = {
  id: string;
  label: string;
  effective_at: string;
  draft_foot_cents: number;
  minimum_cents: number;
  tonnage_bands: { from_gt: number; to_gt: number | null; cents: number }[];
  night_percent: number;
  detention_half_hour_cents: number;
  detention_allowance_half_hours: number;
  cancellation_cents: number;
  moves: string[];
};

export type Invoice = {
  id: string;
  move_ref: string;
  agency_code: string;
  state: 'pending' | 'issued';
  number: string | null;
  balance_cents: number | null;
  balance_confirmed_at: string | null;
  lines: Line[];
  total_cents: number;
  charge_state: 'pending' | 'posted';
};

export type LadderReport = {
  id: string;
  move_ref: string;
  compliant: boolean;
  defects: string[];
  refused: boolean;
  location: 'deck' | 'pilot_boat';
  note: string;
  photos: { photo_id: string; sha256: string; size_bytes: number }[];
  filed_by: string;
  filed_at: string;
};

export type ErrorBody = {
  error: string;
  message: string;
  errors?: Record<string, string>;
  current?: Move;
  plan?: Plan;
  turn?: TurnEntry[];
};
