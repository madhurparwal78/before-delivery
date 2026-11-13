// Row shapes shared by the routes modules.

export interface ModelRecord {
  code: string;
  kind: string;
  rated_lumens: number;
  rated_hours: number;
  native_width: number;
  native_height: number;
  rated_watts: number;
  ratio_min: string | null;
  ratio_max: string | null;
  shift_across_max: string | null;
  shift_down_max: string | null;
}

export interface SiteRecord {
  id: string;
  name: string;
  width_metres: string;
  height_metres: string;
  columns: number;
  rows: number;
  show_at: Date;
  demo: boolean;
  residual_metres: string | null;
}

export interface LayoutRecord {
  id: string;
  site_id: string;
  name: string;
  version: number;
  layout_hash: string;
  sheet_status: 'Draft' | 'Issued' | 'Out of step' | 'Withdrawn';
}

export interface PlacementRow {
  id: string;
  body_serial: string | null;
  hold_id: string | null;
  model: string | null;
  lens_serial: string;
  aim_across: string;
  aim_down: string;
  body_across: string;
  body_down: string;
  standoff: string;
  ratio: string;
  shift_across: string;
  shift_down: string;
  circuit_id: string;
}

export interface EnrichedPlacement extends PlacementRow {
  status: 'Bodied' | 'On hold' | 'Needs a body';
}
