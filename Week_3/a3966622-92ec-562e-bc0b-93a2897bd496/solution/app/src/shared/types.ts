// The published API shapes, shared by the server that writes them and the browser that reads them.

export type Role = "dispatcher" | "pilot" | "agent" | "clerk";

export type MoveStatus =
  | "Ordered"
  | "Window committed"
  | "Pilot assigned"
  | "Pilot away"
  | "On board"
  | "Completed"
  | "Invoiced"
  | "Cancelled"
  | "Cancelled late"
  | "Refused at ladder";

export type MoveAction =
  | "commit"
  | "assign"
  | "amend"
  | "cancel"
  | "reorder"
  | "pilot_away"
  | "boarding"
  | "complete"
  | "start_detention"
  | "stop_detention"
  | "ladder_report";

export type ServiceName = "billing" | "storage" | "mail";
export type ServiceStates = Record<ServiceName, "up" | "down">;

export interface SessionUser {
  id: string;
  name: string;
  role: Role;
  agency_code: string | null;
}

export interface Waypoint {
  id: string;
  name: string;
  distance_nm: number;
  sounded_depth_mm: number;
  confined: boolean;
  time_offset_minutes: number;
  height_offset_mm: number;
  speed_limit_kn: number | null;
}

export interface PortInfo {
  port: string;
  zone: string;
  now: string;
  store_date: string;
  tide_version: number;
  step_minutes: number;
  berth_nm: number;
  waypoints: Waypoint[];
}

export interface Line {
  label: string;
  quantity: number;
  unit_cents: number;
  amount_cents: number;
  tariff_revision: string;
}

export interface PlanWaypoint {
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
}

export interface Plan {
  tide_version: number;
  boarding_at: string;
  draught_mm: number;
  required_mm: number;
  waypoints: PlanWaypoint[];
  pinch: { waypoint_id: string; margin_mm: number };
  window_state: "open" | "closed";
  estimate: { tariff_revision: string; lines: Line[]; total_cents: number };
}

export interface VesselSummary {
  id: string;
  name: string;
  imo: string;
  length_m: number;
  gross_tonnage: number;
  block_coefficient: number;
}

export interface Vessel extends VesselSummary {
  agency_code: string;
  speed_kn: number;
  draught_mm: number;
  pilot_card: { card_id: string; sha256: string; size_bytes: number } | null;
}

export interface NoticeState {
  kind: string;
  to: string;
  state: "pending" | "sent";
}

export interface HistoryEntry {
  at: string;
  status: MoveStatus;
  by: string;
  note?: string;
}

export interface Move {
  ref: string;
  version: number;
  status: MoveStatus;
  detained: boolean;
  agency_code: string;
  vessel: VesselSummary;
  draught_mm: number;
  draught: { metres: string; feet: string };
  speed_kn: number;
  duty_minutes: number;
  boarding_at: string;
  committed: { boarding_at: string; pinch_waypoint: string; margin_mm: number; tide_version: number } | null;
  pilot: { id: string; name: string } | null;
  notice: { state: "on_time" | "late"; cutoff_at: string; cutoff_utc_offset: string };
  server_now: string;
  late_amendments: number;
  detention: { open: boolean; seconds: number };
  notices: NoticeState[];
  billing: { state: "none" | "pending" | "posted"; invoice_id: string | null; invoice_ids: string[] };
  lines: Line[];
  ladder_reports: string[];
  history: HistoryEntry[];
  dispatcher_notes?: { at: string; by: string; text: string }[];
  rest_override?: { reason: string; pilot_id: string; by: string; at: string } | null;
  priced_by: { tariff_revision: string; total_cents: number };
  actions: MoveAction[];
  window_returned?: boolean;
  late_notice?: boolean;
}

export interface TurnEntry {
  pilot_id: string;
  name: string;
  position: number;
  licence_class: string;
  eligible: boolean;
  reasons: string[];
  rest_breach: boolean;
  rest_until: string | null;
}

export interface Eligibility {
  boarding_at: string;
  next_eligible: string | null;
  turn: TurnEntry[];
}

export interface Pilot {
  id: string;
  name: string;
  licence_class: string;
  position: number;
  on_duty: boolean;
  rest_until: string | null;
}

export interface Invoice {
  id: string;
  move_ref: string;
  agency_code: string;
  state: "pending" | "issued";
  number: string | null;
  balance_cents: number | null;
  balance_confirmed_at: string | null;
  lines: Line[];
  total_cents: number;
  charge_state: "pending" | "posted";
}

export interface TonnageBand {
  from_gt: number;
  to_gt: number | null;
  cents: number;
}

export interface TariffRevision {
  id: string;
  label: string;
  effective_at: string;
  draft_foot_cents: number;
  minimum_cents: number;
  tonnage_bands: TonnageBand[];
  night_percent: number;
  detention_half_hour_cents: number;
  detention_allowance_half_hours: number;
  cancellation_cents: number;
  moves: string[];
}

export interface StoredPhoto {
  photo_id: string;
  sha256: string;
  size_bytes: number;
}

export interface LadderReport {
  id: string;
  move_ref: string;
  compliant: boolean;
  defects: string[];
  refused: boolean;
  location: "deck" | "pilot_boat";
  note: string;
  photos: StoredPhoto[];
  filed_by: string;
  filed_at: string;
}

export const DEFECTS: readonly { code: string; name: string }[] = [
  { code: "side_ropes", name: "Side ropes" },
  { code: "steps", name: "Steps" },
  { code: "spreaders", name: "Spreaders" },
  { code: "securing", name: "Securing points" },
  { code: "climb_height", name: "Climb over 9 metres" },
  { code: "man_ropes", name: "Man ropes" },
  { code: "deck_access", name: "Deck access" },
  { code: "lighting", name: "Lighting" },
];

export interface ApiErrorBody {
  error: string;
  message: string;
  errors?: Record<string, string>;
  current?: Move;
  plan?: Plan;
  turn?: TurnEntry[];
  next_eligible?: string | null;
}
