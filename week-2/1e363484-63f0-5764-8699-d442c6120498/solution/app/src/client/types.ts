// Shapes of the API bodies the screens display. Every value is the server's; screens only format.

export type ProjectRole = "viewer" | "analyst" | "sealer";
export type FigureStatus = "sealed" | "broken" | "superseded";

export interface Person {
  id: string;
  name: string;
  email: string;
  org_role: "admin" | "steward" | "member";
}

export interface Summary {
  sealed_net_tco2e: string;
  buffer_tco2e: string;
  intact_count: number;
  broken_count: number;
  superseded_count: number;
}

export interface ProjectListItem {
  slug: string;
  name: string;
  kind: string;
  floor_pct: string;
  buffer_pct: string;
  role: ProjectRole;
  summary: Summary;
}

export type Point = [number, number];

export interface Sensor {
  id: string;
  kind: "tower" | "satellite";
  polygon: Point[];
}

export interface Project {
  slug: string;
  name: string;
  kind: string;
  code: string;
  floor_pct: string;
  buffer_pct: string;
  lead_person_id: string;
  boundary: Point[];
  boundary_area_m2: number;
  sensors: Sensor[];
  record_start: string | null;
  record_end: string | null;
  role: ProjectRole;
  summary: Summary;
}

export interface Contribution {
  sensor_id: string;
  kind: "tower" | "satellite";
  area_m2: number;
  qualifying_half_hours: number;
  half_hours: number;
  co2_tco2e: string;
  ch4_tco2e: string;
  net_tco2e: string;
}

interface Derived {
  start: string;
  end: string;
  sensor_ids: string[];
  coverage_pct: string;
  floor_pct: string;
  net_tco2e: string;
  co2_tco2e: string;
  ch4_tco2e: string;
  buffer_pct: string;
  buffer_tco2e: string;
  credited_tco2e: string;
  readings_count: number;
  fingerprint: string;
  contributions: Contribution[];
}

export interface Preview extends Derived {
  sealable: boolean;
  blocked_reason: null | "below_coverage_floor" | "overlaps_sealed" | "already_sealed" | "role";
  blocking_figure_id: string | null;
}

export interface Figure extends Derived {
  id: string;
  project: string;
  status: FigureStatus;
  supersedes: string | null;
  superseded_by: string | null;
  sealed_at: string;
  sealed_by: string;
  checked_at: string;
  evidence: { readings_key: string; derivation_key: string };
}

export interface RederivedFigure extends Figure {
  rederived: { fingerprint: string; coverage_pct: string; net_tco2e: string; matches: boolean };
}

export interface LedgerEntry {
  id: string;
  figure_id: string;
  kind: "issuance" | "buffer" | "reversal";
  tco2e: string;
  reverses: string | null;
  recorded_at: string;
}

export interface Ledger {
  entries: LedgerEntry[];
  balance_tco2e: string;
  buffer_tco2e: string;
}

export interface TimelineDay {
  date: string;
  net_tco2e: string;
  coverage_pct: string;
}

export interface ReadingValues {
  fc: string;
  fch4: string;
  qc: number;
}

export interface MovedReading {
  sensor_id: string;
  interval_start: string;
  old: ReadingValues | null;
  new: ReadingValues;
  revised_at: string;
  batch_id: string;
}

export interface AuditTrail {
  figure_id: string;
  moved: MovedReading[];
}

export interface RegulatorLink {
  id: string;
  token: string;
  url: string;
  status: "live" | "expired" | "revoked";
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface PublicFigure {
  link: { status: "live"; expires_at: string };
  project: { name: string; kind: string };
  figure: RederivedFigure;
}
