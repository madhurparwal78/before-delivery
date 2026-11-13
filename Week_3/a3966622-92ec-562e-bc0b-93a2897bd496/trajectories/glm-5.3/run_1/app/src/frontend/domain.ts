// Browser-side domain helpers. The browser renders the server's results; the
// functions below only format what the server returned.

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
  required_mm: number;
  margin_mm: number;
  pinch: boolean;
}

export interface Line {
  label: string;
  quantity: number;
  unit_cents: number;
  amount_cents: number;
  tariff_revision: string;
}

export interface Plan {
  tide_version: number;
  boarding_at: string;
  draught_mm: number;
  required_mm: number;
  waypoints: PlanWaypoint[];
  pinch: { waypoint_id: string; margin_mm: number };
  window_state: 'open' | 'closed';
  estimate: { tariff_revision: string; lines: Line[]; total_cents: number };
}

export interface Move {
  ref: string;
  version: number;
  status: string;
  detained: boolean;
  agency_code: string;
  vessel: { id: string; name: string; imo: string; length_m: number; gross_tonnage: number; block_coefficient: number };
  draught_mm: number;
  draught: { metres: string; feet: string };
  speed_kn: number;
  duty_minutes: number;
  boarding_at: string;
  committed: { boarding_at: string; pinch_waypoint: string; margin_mm: number; tide_version: number } | null;
  pilot: { id: string; name: string } | null;
  notice: { state: 'on_time' | 'late'; cutoff_at: string; cutoff_utc_offset: string };
  server_now: string;
  late_amendments: number;
  detention: { open: boolean; seconds: number };
  notices: { kind: string; to: string; state: 'pending' | 'sent' }[];
  billing: { state: 'none' | 'pending' | 'posted'; invoice_id: string | null; invoice_ids: string[] };
  lines: Line[];
  ladder_reports: string[];
  history: { at: string; status: string; by: string }[];
  dispatcher_notes?: string[];
  rest_override?: { reason: string } | null;
}

export interface Invoice {
  id: string;
  move_ref: string;
  agency_code: string;
  state: 'pending' | 'issued';
  number: string | null;
  balance_cents: number | null;
  lines: Line[];
  total_cents: number;
  charge_state: 'pending' | 'posted';
}

export interface Vessel {
  id: string;
  name: string;
  imo: string;
  length_m: number;
  gross_tonnage: number;
  block_coefficient: number;
  default_speed_kn: number;
  default_draught_mm: number;
}

export interface User {
  id: string;
  name: string;
  role: 'dispatcher' | 'agent' | 'pilot' | 'clerk';
  agency_code: string | null;
}

export interface PortInfo {
  port: string;
  zone: string;
  now: string;
  store_date: string;
  tide_version: number;
  step_minutes: number;
  waypoints: {
    id: string; name: string; distance_nm: number; sounded_depth_mm: number;
    confined: boolean; time_offset_minutes: number; height_offset_mm: number;
    speed_limit_kn: number | null;
  }[];
}

export interface Eligibility {
  boarding_at: string;
  next_eligible: string | null;
  turn: { pilot_id: string; name: string; position: number; licence_class: string; eligible: boolean; reasons: string[]; rest_until: string | null }[];
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
  filed_at: string;
}

export interface TariffRevision {
  label: string;
  effective_at: string;
  draft_foot_cents: number;
  minimum_cents: number;
  tonnage_bands: { from_gt: number; to_gt: number | null; cents: number }[];
  night_percent: number;
  detention_half_hour_cents: number;
  detention_allowance_half_hours: number;
  cancellation_cents: number;
  moves?: string[];
  id?: string;
}

// Metres show two decimals with the sign applied after rounding the size.
export function mmToMetres(mm: number): string {
  const size = Math.round(Math.abs(mm) / 10) / 100;
  return `${mm < 0 && size !== 0 ? '-' : ''}${size.toFixed(2)}`;
}

export function mmToDraughtMetres(mm: number): string {
  return (Math.abs(mm) / 1000).toFixed(3);
}

export function mmToFeetInches(mm: number): string {
  const quarters = Math.round((Math.abs(mm) / 25.4) * 4);
  const totalInches = Math.floor(quarters / 4);
  const quarterPart = quarters % 4;
  const ft = Math.floor(totalInches / 12);
  const inchPart = totalInches % 12;
  const frac = quarterPart === 0 ? '' : quarterPart === 1 ? '.25' : quarterPart === 2 ? '.5' : '.75';
  return `${mm < 0 ? '-' : ''}${ft} ft ${inchPart}${frac} in`;
}

export function clearanceCell(mm: number): string {
  return `${mmToMetres(mm)} m / ${mmToFeetInches(mm)}`;
}

// A margin always shows its sign, even when it rounds to zero.
export function marginMetres(mm: number): string {
  const size = Math.round(Math.abs(mm) / 10) / 100;
  return `${mm < 0 ? '-' : '+'}${size.toFixed(2)}`;
}

export function money(cents: number): string {
  const size = Math.abs(cents);
  const whole = Math.floor(size / 100);
  const frac = String(size % 100).padStart(2, '0');
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}$${grouped}.${frac}`;
}

export function moneyPlain(cents: number): string {
  const size = Math.abs(cents);
  const whole = Math.floor(size / 100);
  const frac = String(size % 100).padStart(2, '0');
  return `${cents < 0 ? '-' : ''}${whole}.${frac}`;
}

// The move's notice cutoff in the published display format.
export function noticeCutoffShown(move: Move): string {
  const [date, time] = move.notice.cutoff_at.split(' ');
  return `${date} ${time} ${move.notice.cutoff_utc_offset === '-03:00' ? 'ADT' : 'AST'}`;
}

export function noticeVerdictShown(move: Move): string {
  return move.notice.state === 'on_time'
    ? 'Notice on time - no cancellation charge'
    : "Under 2 hours' notice - cancellation charge applies";
}

// The published notices, rendered character for character.
export const LATE_CANCELLATION_NOTICE = "Cancelled late - under 2 hours' notice. The cancellation charge applies.";
export const LATE_AMENDMENT_NOTICE = "Late amendment - under 2 hours' notice. The cancellation charge applies.";

export function chargesText(move: Move): string {
  if (move.billing.state === 'none') return 'No charges';
  if (move.billing.state === 'pending') return 'Charges pending';
  return 'Charges posted';
}

// "2026-11-07T06:00" -> "2026-11-07 06:00 port time"
export function boardingShown(value: string): string {
  return value.replace('T', ' ');
}

export function arrivalZone(offset: string): string {
  return offset === '-03:00' ? 'ADT' : 'AST';
}

// Draught in feet and inches to whole millimetres.
export function feetInchesToMm(ft: number, inches: number): number {
  return Math.floor(ft * 25.4 * 12 + inches * 25.4);
}

export function metresToMm(metres: number): number {
  return Math.floor(metres * 1000);
}

export const LADDER_DEFECT_CHECKBOXES: { code: string; name: string }[] = [
  { code: 'side_ropes', name: 'Side ropes' },
  { code: 'steps', name: 'Steps' },
  { code: 'spreaders', name: 'Spreaders' },
  { code: 'securing', name: 'Securing points' },
  { code: 'climb_height', name: 'Climb over 9 metres' },
  { code: 'man_ropes', name: 'Man ropes' },
  { code: 'deck_access', name: 'Deck access' },
  { code: 'lighting', name: 'Lighting' },
];
