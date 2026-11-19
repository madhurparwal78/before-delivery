export interface Grade {
  letter: string;
  label: string;
}

export interface PenGrid {
  columns: number;
  rows: number;
  panel_width_m: number;
  panel_height_m: number;
}

export interface Repair {
  id?: string;
  method: string;
  note: string;
  source?: string;
  proposal_id?: string | null;
  recorded_at: string;
}

export interface Still {
  id: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  file_name: string;
}

export interface EditLock {
  device_id: string;
  device_name: string;
  expires_in_s: number;
}

export interface Defect {
  id: string;
  pen_id: string;
  removed: boolean;
  label?: string;
  type?: string;
  bearing_deg?: number;
  depth_m?: number;
  chart_x_m?: number;
  chart_y_m?: number;
  cell?: string;
  size?: Record<string, number>;
  area_cm2?: number | null;
  patch_area_m2?: number | null;
  note?: string;
  private_note?: string;
  status?: string;
  version?: number;
  repairs?: Repair[];
  stills?: Still[];
  lock?: EditLock | null;
  updated_at?: string;
}

export interface Panel {
  cell: string;
  fouling_cover_pct: number;
}

export interface Pen {
  id: string;
  farm_id: string;
  farm_name: string;
  site_code: string;
  site_name: string;
  pen_no: number;
  name: string;
  circumference_m: number;
  net_depth_m: number;
  grid: PenGrid;
  grade: Grade;
  open_defects: number;
  max_fouling_cover_pct: number;
  panels?: Panel[];
  defects?: Defect[];
  latest_revision: { number: number; published_at: string } | null;
}

export interface Farm {
  id: string;
  name: string;
  day_rate: { amount: number; currency: string };
  sites: { code: string; name: string; latitude: number; longitude: number }[];
  pen_ids: string[];
}

export interface DeviceRow {
  id: string;
  name: string;
  online: boolean;
}

export interface ForecastHour {
  time: string;
  current_m_s: number;
  wave_m: number;
  within_limits: boolean;
}

export interface Clearance {
  result: string;
  message: string;
  checked_at: string;
  issued_at: string | null;
  hours: ForecastHour[];
}

export interface TrackSample {
  t_s: number;
  bearing_deg: number;
  depth_m: number;
}

export interface SonarCapture {
  id: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  file_name: string;
}

export interface Dive {
  id: string;
  pen_id: string;
  status: string;
  planned_start: string;
  planned_minutes: number;
  diver_certificate_no: string;
  clearance: Clearance | null;
  started_at: string | null;
  finished_at: string | null;
  elapsed_s: number | null;
  track: TrackSample[];
  sonar: SonarCapture[];
}

export interface ImportRow {
  row: number;
  defect_id?: string;
  site_code?: string;
  pen_no?: string;
  reason?: string;
}

export interface LegacyImport {
  id: string;
  farm_id: string;
  file_name: string;
  sha256: string;
  size_bytes: number;
  imported_at: string;
  rows: number;
  created: ImportRow[];
  merged: ImportRow[];
  already_imported: ImportRow[];
  orphans: ImportRow[];
  invalid: ImportRow[];
}

export interface Revision {
  number: number;
  published_at: string;
  sha256: string;
  size_bytes: number;
  grade: Grade;
  open_defects: number;
}

export interface ReportLink {
  id: string;
  pen_id: string;
  token: string;
  path: string;
  url: string;
  status: "active" | "revoked" | "expired";
  created_at: string;
  expires_at: string;
  expires_in_s: number;
}

export interface Proposal {
  id: string;
  defect_id: string;
  method: string;
  note: string;
  status: string;
}

export interface CopilotAnswer {
  id: string;
  question: string;
  text: string | null;
  focus: string[];
  dropped_ids: string[];
  rejected_calls: { tool_call_id: string; reason: string }[];
  proposals: Proposal[];
}

export interface PublicReport {
  pen: {
    name: string;
    site_name: string;
    farm_name: string;
    circumference_m: number;
    net_depth_m: number;
    grid: PenGrid;
  };
  grade: Grade;
  open_defects: number;
  max_fouling_cover_pct: number;
  panels: Panel[];
  defects: Defect[];
  latest_revision: { number: number; published_at: string } | null;
  link: { status: string; expires_at: string; expires_in_s: number };
}

/// The pen's geometry as the stage and the chart renderers want it.
export function penShape(pen: {
  circumference_m: number;
  net_depth_m: number;
  grid: PenGrid;
}): { circumference_m: number; net_depth_m: number; columns: number; rows: number } {
  return {
    circumference_m: pen.circumference_m,
    net_depth_m: pen.net_depth_m,
    columns: pen.grid.columns,
    rows: pen.grid.rows,
  };
}
