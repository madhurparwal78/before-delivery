// Domain types shared by the server, the engine and the browser. The wire shapes follow the brief's API section.

export type ValueType = 'boolean' | 'number' | 'date' | 'text';
export type FieldKind = 'dimension' | 'measure';
export type Role = 'viewer' | 'explorer' | 'creator';

/** A cell of a table or of a query result. Date cells in tables are UTC epoch milliseconds. */
export type Cell = string | number | boolean | null;

export type Agg = 'SUM' | 'AVG' | 'MEDIAN' | 'MIN' | 'MAX' | 'COUNT' | 'COUNT_UNIQUE';
export type DateLevel = 'year' | 'month' | 'week' | 'day';
export type TableCalcKind = 'run_total' | 'prev_diff' | 'share' | 'rank';
export type TableCalcUsing = 'table_across' | 'table_down' | 'pane_down' | 'chosen';

export interface TableCalc {
  kind: TableCalcKind;
  using: TableCalcUsing;
  fields: string[];
}

export interface MeasurePill {
  field: string;
  agg: Agg;
  table_calc: TableCalc | null;
}

interface DatePill {
  field: string;
  level: DateLevel;
}

/** A dimension pill is the field name, or a date pill. A measure pill is always an object with `agg`. */
export type DimensionPill = string | DatePill;
export type Pill = DimensionPill | MeasurePill;

export type FilterStep = 'source' | 'context' | 'dimension' | 'top' | 'measure' | 'table_calc';

export interface Filter {
  field: string;
  step: FilterStep;
  values: Cell[];
  /** Top N count, or `@<parameter>` */
  n: number | string | null;
  by: MeasurePill | null;
  min: number | null;
  max: number | null;
  agg: Agg | null;
  table_calc: TableCalc | null;
}

export type ChartChoice = 'automatic' | 'bar' | 'line' | 'scatter' | 'text_table' | 'heat_map';
export type ChartKind = 'bar' | 'line' | 'scatter' | 'text_table' | 'heat_map';
export type SortMode = 'asc' | 'desc' | 'measure';
export type ReferenceLineType = 'average' | 'median' | 'constant';

export interface ReferenceLine {
  type: ReferenceLineType;
  value: number | null;
  parameter: string | null;
}

export interface SheetShape {
  name: string;
  rows: Pill[];
  columns: Pill[];
  color: Pill | null;
  size: Pill | null;
  label: Pill[];
  detail: Pill[];
  filters: Filter[];
  chart: ChartChoice;
  totals: boolean;
  reference_lines: ReferenceLine[];
  trend: boolean;
  sort: Record<string, SortMode>;
}

export type ParameterType = 'number' | 'text' | 'list';
export type ParameterValue = string | number;

export interface ParameterDef {
  id: string;
  name: string;
  type: ParameterType;
  value: ParameterValue;
  values: string[];
}

export interface SetDef {
  id: string;
  name: string;
  field: string;
  members?: Cell[];
  top?: { n: number | string; by: MeasurePill };
}

export interface CalculationDef {
  id: string;
  name: string;
  formula: string;
}

/** A sheet as the sheet routes answer it. `version` is the workbook's, or a personal copy's own; `copy` marks the caller's copy. */
export interface SheetDetail extends SheetShape {
  id: string;
  workbook: string;
  version: number;
  copy: boolean;
  /** formulas shown with current field names */
  calculations: CalculationDef[];
}

// ---- queries

export interface QueryRequest {
  filters: Filter[];
  parameters: Record<string, ParameterValue>;
  sets: Record<string, Cell[]>;
}

export interface QueryColumn {
  name: string;
  role: 'dimension' | 'measure';
  /** present on a measure whose values are fractions that display as a percent: a Percent of total pill or a `SHARE` formula */
  share?: true;
}

export interface ReferenceValue {
  type: ReferenceLineType;
  value: number | null;
}

export interface QueryResult {
  gen: number;
  chart: ChartKind | 'none';
  columns: QueryColumn[];
  /** one row per mark, in mark order; dimensions first, then measures; raw values (shares are fractions) */
  rows: Cell[][];
  /** aligned with `columns`: null under dimensions, a number under a measure, `'n/a'` under a table calculation */
  total: (number | string | null)[] | null;
  reference_lines: ReferenceValue[];
  trend: { slope: number; intercept: number } | null;
  notices: string[];
}

export interface FormulaCheckValid {
  valid: true;
  type: ValueType;
  aggregate: boolean;
}
export interface FormulaCheckInvalid {
  valid: false;
  message: string;
  line: number | null;
  column: number | null;
}
export type FormulaCheck = FormulaCheckValid | FormulaCheckInvalid;

// ---- sources

export interface SourceColumn {
  id: string;
  name: string;
  type: ValueType;
  kind: FieldKind;
  continuous: boolean;
}

export interface SourceTable {
  name: string;
  rows: number;
  sha256: string;
  columns: SourceColumn[];
}

export interface SourceField {
  id: string;
  name: string;
  table: string | null;
  type: ValueType;
  kind: FieldKind;
  continuous: boolean;
  hidden: boolean;
}

export interface Relation {
  left_table: string;
  left_key: string;
  right_table: string;
  right_key: string;
}

export interface Schedule {
  every_minutes: number;
  kind: 'full' | 'incremental';
  key: string | null;
  next_run_at: string | null;
}

export interface Entitlements {
  field: string | null;
  users: Record<string, string[]>;
}

export interface Source {
  id: string;
  name: string;
  version: number;
  tables: SourceTable[];
  relation: Relation | null;
  fields: SourceField[];
  hierarchy: { name: string; fields: string[] } | null;
  entitlements: Entitlements;
  schedule: Schedule | null;
  notices: string[];
}

export type ExtractStateName = 'live' | 'refreshing' | 'refresh_failed';

export interface Extract {
  state: ExtractStateName;
  stale: boolean;
  last_success_at: string | null;
  last_failure_at: string | null;
  next_run_at: string | null;
  rows: number;
}

// ---- dashboards

export interface LayoutSheet {
  sheet: string;
  fixed: number | null;
}
export interface LayoutContainer {
  type: 'horizontal' | 'vertical';
  children: (LayoutSheet | LayoutContainer)[];
}

export interface FloatingObject {
  sheet: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ActionType = 'filter' | 'highlight' | 'set_parameter' | 'change_set';

export interface DashboardAction {
  name: string;
  type: ActionType;
  source: string;
  targets: string[];
  field: string;
  parameter: string | null;
  set: string | null;
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

export interface DashboardBody {
  name: string;
  layout: LayoutContainer;
  floating: FloatingObject[];
  phone_order: string[];
  phone_heights: Record<string, number>;
  actions: DashboardAction[];
}

export interface Dashboard extends DashboardBody {
  id: string;
  /** the workbook id: its parameters and sets drive the dashboard's controls */
  workbook: string;
  objects: DashboardObject[];
  version?: number;
}

// ---- exports and inbox

export type ExportKind = 'pdf' | 'png' | 'csv';
export type ExportStatus = 'queued' | 'rendering' | 'ready' | 'failed';

export interface ExportJob {
  id: string;
  kind: ExportKind;
  status: ExportStatus;
  progress: 0 | 50 | 100;
  download: string | null;
}

export interface InboxItem {
  id: string;
  text: string;
  created_at: string;
  read: boolean;
}
