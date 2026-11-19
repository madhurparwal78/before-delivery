// Shared types mirroring the server's objects.

export type DefectType = 'hole' | 'tear' | 'chafe' | 'fouling';

export interface Size {
  width_cm?: number; height_cm?: number;
  length_cm?: number; gap_cm?: number;
  width_m?: number; height_m?: number;
}

export interface Repair { id: string; method: string; note: string; source: string; proposal_id: string | null; recorded_at: string; }
export interface Still { id: string; content_type: string; size_bytes: number; sha256: string; file_name: string; }
export interface Lock { device_id: string; device_name: string; expires_in_s: number; }

export interface Defect {
  id: string; pen_id: string; type: DefectType;
  bearing_deg: number; depth_m: number;
  chart_x_m: number; chart_y_m: number; cell: string;
  size: Size; area_cm2: number | null; patch_area_m2: number | null;
  note: string; private_note: string;
  status: 'open' | 'repaired'; removed: boolean;
  version: number; repairs: Repair[]; stills: Still[];
  lock: Lock | null; updated_at: string;
}

export interface Placeholder { id: string; pen_id: string; removed: true; label: 'Defect removed'; }
export type AnyDefect = Defect | Placeholder;

export interface PenGrid { columns: number; rows: number; panel_width_m: number; panel_height_m: number; }
export interface Panel { cell: string; fouling_cover_pct: number; }

export interface Pen {
  id: string; farm_id: string; farm_name: string;
  site_code: string; site_name: string; pen_no: number;
  name: string; circumference_m: number; net_depth_m: number;
  grid: PenGrid;
  grade: { letter: string; label: string };
  open_defects: number; max_fouling_cover_pct: number;
  panels: Panel[]; defects: AnyDefect[];
  latest_revision: { number: number; published_at: string } | null;
}

export interface Farm {
  id: string; name: string;
  day_rate: { amount: number; currency: string };
  sites: { code: string; name: string; latitude: number; longitude: number }[];
  pen_ids: string[];
}

export interface Device { id: string; name: string; online: boolean; }

export interface Hour { time: string; current_m_s: number; wave_m: number; within_limits: boolean; }
export interface Clearance {
  result: 'GO' | 'NO-GO' | 'Forecast stale' | 'Forecast unavailable';
  message: string; checked_at: string; issued_at: string | null; hours: Hour[];
}

export interface TrackSample { t_s: number; bearing_deg: number; depth_m: number; }
export interface SonarCapture { id: string; content_type: string; size_bytes: number; sha256: string; file_name: string; }

export interface Dive {
  id: string; pen_id: string;
  status: 'planned' | 'cleared' | 'started' | 'recorded';
  planned_start: string; planned_minutes: number; diver_certificate_no: string;
  clearance: Clearance | null;
  started_at: string | null; finished_at: string | null;
  elapsed_s: number | null; track: TrackSample[]; sonar: SonarCapture[];
}

export interface ImportRow { row: number; defect_id?: string; site_code?: string; pen_no?: string; reason?: string; }
export interface Import {
  id: string; farm_id: string; file_name: string; sha256: string;
  size_bytes: number; imported_at: string; rows: number;
  created: ImportRow[]; merged: ImportRow[]; already_imported: ImportRow[];
  orphans: ImportRow[]; invalid: ImportRow[];
}

export interface Revision { number: number; published_at: string; sha256: string; size_bytes: number; grade: string; open_defects: number; }
export interface Link { id: string; pen_id: string; token: string; path: string; url: string; status: 'active' | 'revoked' | 'expired'; created_at: string; expires_at: string; expires_in_s: number; }

export interface Proposal { id: string; defect_id: string; method: string; note: string; status: string; }
export interface CopilotAnswer {
  id: string; question: string; text: string;
  focus: string[]; dropped_ids: string[];
  rejected_calls: { tool_call_id: string; reason: string }[];
  proposals: Proposal[];
}

export interface HistoryEntry {
  at: string; device_id: string; device_name: string; action: string;
  changes: Record<string, { before: unknown; after: unknown }>;
  detail: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    details?: Record<string, unknown>;
  };
}
