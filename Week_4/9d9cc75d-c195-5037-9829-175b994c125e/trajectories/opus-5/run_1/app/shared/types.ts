export type FieldType = 'boolean' | 'number' | 'date' | 'text';
export type FieldKind = 'dimension' | 'measure';
export type Role = 'viewer' | 'explorer' | 'creator';
export type Agg = 'SUM' | 'AVG' | 'MEDIAN' | 'MIN' | 'MAX' | 'COUNT' | 'COUNT_UNIQUE';
export type DateLevel = 'year' | 'month' | 'week' | 'day';
export type TableCalcKind = 'run_total' | 'prev_diff' | 'share' | 'rank';
export type ComputeUsing = 'table_across' | 'table_down' | 'pane_down' | 'chosen';
export type ChartType = 'automatic' | 'bar' | 'line' | 'scatter' | 'text_table' | 'heat_map';
export type FilterStep = 'source' | 'context' | 'dimension' | 'top' | 'measure' | 'table_calc';

export interface TableCalcSpec {
  kind: TableCalcKind;
  using: ComputeUsing;
  fields: string[];
}

export interface DatePill {
  field: string;
  level: DateLevel;
}

export type DimensionPill = string | DatePill;

export interface MeasurePill {
  field: string;
  agg: Agg;
  table_calc: TableCalcSpec | null;
}

export type Pill = DimensionPill | MeasurePill;

export interface FilterSpec {
  field: string;
  step: FilterStep;
  values?: unknown[];
  n?: number | string | null;
  by?: MeasurePill | null;
  min?: number | null;
  max?: number | null;
  agg?: Agg | null;
  table_calc?: TableCalcSpec | null;
  level?: DateLevel | null;
}

export interface ReferenceLineSpec {
  type: 'average' | 'median' | 'constant';
  value: number | null;
  parameter: string | null;
}

export interface SheetSpec {
  name: string;
  rows: Pill[];
  columns: Pill[];
  color: Pill | null;
  size: Pill | null;
  label: Pill[];
  detail: Pill[];
  filters: FilterSpec[];
  chart: ChartType;
  totals: boolean;
  reference_lines: ReferenceLineSpec[];
  trend: boolean;
  sort: Record<string, 'asc' | 'desc' | 'measure'>;
}

export interface SourceField {
  id: string;
  name: string;
  table: string;
  type: FieldType;
  kind: FieldKind;
  continuous: boolean;
  hidden: boolean;
  derived?: DerivedSpec | null;
}

export type DerivedSpec =
  | { kind: 'bin'; base: string; size: number }
  | { kind: 'group'; base: string; groups: { name: string; members: string[] }[] };

export interface SourceTableInfo {
  name: string;
  rows: number;
  sha256: string;
  columns: { id: string; name: string; type: FieldType; kind: FieldKind; continuous: boolean }[];
}

export interface RelationSpec {
  left_table: string;
  left_key: string;
  right_table: string;
  right_key: string;
}

export interface ScheduleSpec {
  every_minutes: number;
  kind: 'full' | 'incremental';
  key: string | null;
  next_run_at?: string | null;
}

export interface SourceDoc {
  id: string;
  name: string;
  project: string;
  version: number;
  tables: SourceTableInfo[];
  relation: RelationSpec | null;
  fields: SourceField[];
  hierarchy: { name: string; fields: string[] } | null;
  entitlements: { field: string | null; users: Record<string, unknown[]> };
  schedule: (ScheduleSpec & { next_run_at: string | null }) | null;
  notices: string[];
}

export interface QueryColumn {
  name: string;
  role: 'dimension' | 'measure';
}

export interface QueryResult {
  gen: number;
  chart: 'none' | 'bar' | 'line' | 'scatter' | 'text_table' | 'heat_map';
  columns: QueryColumn[];
  rows: (string | number | boolean | null)[][];
  total: (string | number | null)[] | null;
  reference_lines: { type: string; value: number | null }[];
  trend: { slope: number; intercept: number } | null;
  notices: string[];
}

export interface ParameterDoc {
  id: string;
  name: string;
  type: 'number' | 'text' | 'list';
  value: unknown;
  values: string[];
}

export interface SetDoc {
  id: string;
  name: string;
  field: string;
  members: unknown[] | null;
  top: { n: number | string; by: MeasurePill } | null;
}

export interface DashboardAction {
  name: string;
  type: 'filter' | 'highlight' | 'set_parameter' | 'change_set';
  source: string;
  targets: string[];
  field: string;
  parameter: string | null;
  set: string | null;
}

export interface LayoutNode {
  sheet?: string;
  fixed?: number | null;
  type?: 'horizontal' | 'vertical';
  children?: LayoutNode[];
}

export interface DashboardObject {
  sheet: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  floating: boolean;
}

export interface DashboardDoc {
  id: string;
  name: string;
  workbook: string;
  layout: LayoutNode;
  floating: { sheet: string; x: number; y: number; w: number; h: number }[];
  phone_order: string[];
  phone_heights: Record<string, number>;
  actions: DashboardAction[];
  objects: DashboardObject[];
}
