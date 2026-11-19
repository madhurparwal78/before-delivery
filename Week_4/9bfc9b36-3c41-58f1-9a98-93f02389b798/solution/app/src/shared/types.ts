/** The wire shapes of the API. The server builds them, the browser reads them. */

export type Role = "sailmaker" | "loft-hand" | "yacht-owner";
export type DimensionKey = "I" | "J" | "P" | "E" | "LL" | "LP";
export const DIMENSION_KEYS: readonly DimensionKey[] = ["I", "J", "P", "E", "LL", "LP"];
export type Sail = "mainsail" | "headsail";
export type DrawingStatus = "measuring" | "remeasure" | "drawn" | "nested" | "cutting" | "cut" | "pending_store" | "issued";
export type Step = "measure" | "draw" | "nest" | "confirm";
export const STEPS: readonly Step[] = ["measure", "draw", "nest", "confirm"];

export interface Person {
  email: string;
  display_name: string;
}

export interface Account {
  id: string;
  email: string;
  display_name: string;
  role: Role;
}

export interface Photo {
  key?: string;
  size: number;
  sha256: string;
  content_type?: string;
}

export interface Measurement {
  id: string;
  value_mm: number;
  value_in: string;
  measured_on: string;
  source: "sailmaker" | "submission";
  submission_id: string | null;
  photo: Photo | null;
}

export interface Dimension {
  key: DimensionKey;
  value_mm: number | null;
  value_in: string | null;
  status: "measured" | "remeasure";
  remeasure_due: string | null;
  measurements: Measurement[];
}

export interface AreaFigure {
  area_mm2: number;
  area_m2: string;
  area_ft2: string;
  basis: string;
}

export interface Boat {
  code: string;
  name: string;
  class_name: string;
  owner: Person;
  notes?: string;
  revision?: number;
  foretriangle: AreaFigure;
  dimensions: Dimension[];
}

export type Outline = [number, number][];

interface LaidPanel {
  claim_id: string;
  stock_code: string;
  x_mm: number;
  y_mm: number;
  rotation: 0 | 180;
}

export interface Panel {
  number: number;
  outline: Outline;
  length_mm: number;
  width_mm: number;
  area_mm2: number;
  area_m2: string;
  area_ft2: string;
  laid?: LaidPanel | null;
  cut: boolean;
}

interface CutSheetRef {
  sha256: string;
  size: number;
  key?: string;
  superseded_by: string | null;
}

export interface Drawing {
  code: string;
  boat_code: string;
  boat_name: string;
  sail: Sail;
  cloth_code?: string;
  lot?: string | null;
  status: DrawingStatus;
  step?: Step;
  ruleset_version?: number | null;
  assigned_to?: Person | null;
  luff_mm?: number;
  foot_mm?: number;
  area: AreaFigure | null;
  panels: Panel[];
  claim_ids?: string[];
  cut_sheet: CutSheetRef | null;
  predecessor: string | null;
  successor: string | null;
}

export interface Submission {
  id: string;
  boat_code: string;
  dimension: DimensionKey;
  value_mm: number;
  value_in: string;
  as_submitted: string;
  measured_on: string;
  note: string;
  status: "pending" | "accepted" | "rejected" | "reversed";
  submitted_by: Person;
  submitted_at: string;
  decided_at: string | null;
  decided_by?: string | null;
  reason: string | null;
}

export interface RuleSet {
  version: number;
  effective_at: string;
  current: boolean;
  seam_overlap_mm: number;
  roach_permille: number;
  tolerance_mm: number;
  min_offcut_width_mm: number;
  min_offcut_length_mm: number;
  revision: number;
}

export interface Cloth {
  code: string;
  name: string;
  weight: string;
  width_mm: number;
  usable_width_mm: number;
  rate_pence_per_m2: number;
}

export interface Stock {
  code: string;
  kind: "roll" | "offcut";
  cloth_code: string;
  lot: string;
  width_mm: number;
  usable_width_mm: number;
  remaining_mm: number;
  remaining_in: string;
  free_mm: number;
  after_laid_mm: number;
  after_laid_in: string;
  on_hand_mm2: number;
  on_hand_m2: string;
  on_hand_ft2: string;
  shelf_location: string;
  note: string;
  last_count: { counted_mm: number; at: string } | null;
  revision: number;
}

export interface StockSummary {
  rolls: number;
  offcuts: number;
  on_hand_mm2: number;
  on_hand_m2: string;
  on_hand_ft2: string;
}

export interface Lay {
  panel_number: number;
  x_mm: number;
  y_mm: number;
  rotation: 0 | 180;
  outline: Outline;
}

export interface NextPosition {
  panel_number: number;
  x_mm: number | null;
  y_mm: number | null;
  rotation: 0 | 180 | null;
}

export interface Claim {
  id: string;
  stock_code: string;
  drawing_code: string;
  holder: Person;
  length_mm: number;
  status: "held" | "cut" | "lapsed" | "released";
  taken_at: string;
  expires_at: string;
  seconds_remaining: number;
  used_mm: number;
  lays: Lay[];
  next_positions: NextPosition[];
}

export interface LedgerLine {
  line_id: number;
  pair_id: string;
  posted_at: string;
  account: string;
  amount_mm2: number;
  stock_code: string;
  drawing_code: string;
  actor_email: string;
  reason: string;
}

export interface LedgerFooter {
  stock_code: string | null;
  remaining_mm: number | null;
  remaining_in: string | null;
  offcut_count: number;
  on_hand_mm2: number;
  on_hand_m2: string;
  on_hand_ft2: string;
  lines: number;
}

export interface Grant {
  id: string;
  drawing_code: string;
  owner: Person;
  status: "granted" | "withdrawn";
  granted_at: string;
  ends_at: string | null;
  withdrawn_at: string | null;
}

export interface Authority {
  id: string;
  loft_hand: Person;
  valid_from: string;
  valid_until: string | null;
  status: "in_force" | "not_yet" | "ended";
}

export interface AuditRow {
  id: string;
  at: string;
  actor_email: string;
  action: string;
  target: string;
  before: string | null;
  after: string | null;
  reason: string | null;
}

export interface SailAccountEntry {
  id: string;
  kind: "payment" | "credit_note";
  amount_pence: number;
  at: string;
  note: string | null;
  reason: string | null;
  recorded_by?: string;
}

export interface SailAccount {
  drawing_code: string;
  status: "deposit_due" | "balance_due" | "settled";
  cloth_code: string;
  rate_pence_per_m2: number;
  area_mm2: number;
  charge_pence: number;
  tax_rate_percent: number;
  tax_pence: number;
  total_pence: number;
  deposit_pence: number;
  paid_pence: number;
  credited_pence: number;
  balance_pence: number;
  entries: SailAccountEntry[];
}

export interface StandingRow {
  rank: number;
  owner_email: string;
  owner_name: string;
  counted: number;
  accepted: number;
  rejected: number;
  reversed: number;
  streak: number;
  standing: "True tape" | "Steady tape" | "New tape";
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
  total: number;
}

export interface LedgerPage extends Page<LedgerLine> {
  footer: LedgerFooter;
}

export interface SessionBody {
  account: Account;
  access_token: string;
  expires_in: number;
}

export interface LayResult {
  claim: Claim;
  stock: Stock;
  drawing_status: DrawingStatus;
}

export interface CutResult extends LayResult {
  offcut: Stock | null;
  pairs: { pair_id: string; lines: [LedgerLine, LedgerLine] }[];
}

export interface BulkResult {
  id: string;
  outcome: "applied" | "refused";
  reason: null | "already_decided" | "not_found" | "reason_required" | "invalid_decision";
  status: string | null;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  winner?: { display_name: string; claim_id: string };
}
