import { ClientOp } from './ops';
import { ChartType, MemberRole, SeasonState } from './workbook';
import { NumberFormat } from './values';

export interface ApiErrorBody {
  error: { code: string; message: string };
  fields?: Record<string, string>;
  limit?: number;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  stationId: string;
  stationName: string;
  timeZone: string;
}

export interface WorkbookSummary {
  id: string;
  name: string;
  state: SeasonState;
  closesAt: string | null;
  closesAtUtc: string | null;
  updatedAt: string;
  sheetCount: number;
}

export interface CellDto {
  input: string;
  value: number | string | boolean | null;
  display: string;
  format: { numberFormat: NumberFormat; bold: boolean };
  error?: string;
}

export interface SheetDto {
  id: string;
  name: string;
  position: number;
  cells: Record<string, CellDto>;
}

export interface ChartDto {
  id: string;
  sheetId: string;
  type: ChartType;
  title: string;
  range: string;
  categories: string[];
  series: { name: string; values: (number | null)[] }[];
}

export interface WorkbookSnapshotDto extends WorkbookSummary {
  timeZone: string;
  headSeq: number;
  myRole: MemberRole;
  sheets: SheetDto[];
  charts: ChartDto[];
}

export interface DependentDto {
  sheetId: string;
  sheetName: string;
  cell: string;
  depth: number;
  value: number | string | boolean | null;
  display: string;
  error?: string;
}

export type OpRejectionReason =
  | 'season_locked'
  | 'season_archived'
  | 'role_cannot_edit'
  | 'sheet_missing'
  | 'invalid_op';

export type OpResult =
  | {
      opId: string;
      status: 'applied';
      seq: number;
      cell?: { sheetId: string; cell: string; value: number | string | boolean | null; display: string; error?: string };
      dependents?: DependentDto[];
    }
  | {
      opId: string;
      status: 'conflict';
      conflictId: string;
      current: { input: string; author: { id: string; name: string } };
    }
  | { opId: string; status: 'rejected'; reason: OpRejectionReason; conflictId: string | null };

export interface SyncResponse {
  batch: { key: string; deviceId: string; headSeq: number };
  results: OpResult[];
}

export interface SyncRequest {
  deviceId: string;
  baseSeq: number;
  ops: ClientOp[];
}

export interface ConflictDto {
  id: string;
  kind: 'conflict' | 'rejected';
  ref: string;
  sheetId: string;
  cell: string;
  myInput: string;
  currentInput: string;
  currentAuthor: { id: string; name: string } | null;
  reason: string | null;
  createdAt: string;
}

export interface VersionDto {
  id: string;
  number: number;
  label: string;
  kind: 'saved' | 'restore' | 'before_restore';
  seq: number;
  createdAt: string;
  createdBy: { id: string; name: string };
}

export interface ExportDto {
  id: string;
  format: 'xlsx' | 'csv';
  sheetId: string | null;
  fileName: string;
  status: 'pending' | 'waiting_for_storage' | 'ready';
  createdAt: string;
  readyAt: string | null;
}

export interface ShareLinkDto {
  id: string;
  url: string;
  expiresAt: string;
  status: 'active' | 'expired' | 'revoked';
}

export interface ShareViewDto {
  workbook: {
    name: string;
    stationName: string;
    state: SeasonState;
    expiresAt: string;
    sheets: {
      name: string;
      position: number;
      cells: Record<string, Omit<CellDto, 'input'>>;
    }[];
    charts: {
      sheetName: string;
      type: ChartType;
      title: string;
      categories: string[];
      series: { name: string; values: (number | null)[] }[];
    }[];
  };
}

export interface MemberDto {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  status: 'invited' | 'active';
}

export interface StationDto {
  id: string;
  name: string;
  timeZone: string;
}

export interface ServiceStatusDto {
  storage: 'up' | 'down';
  mail: 'up' | 'down';
  checkedAt: string;
}

export interface LimitsDto {
  maxJsonBytes: number;
  maxImportBytes: number;
  maxImportExpandedBytes: number;
  maxCompressionRatio: number;
  maxImportCells: number;
  maxSheets: number;
  maxColumns: number;
  maxRows: number;
  maxInputChars: number;
  maxFormulaNodes: number;
  maxFormulaCells: number;
  maxDependencyDepth: number;
  maxOpsPerBatch: number;
  maxSearchChars: number;
}

export const REJECTION_TEXT: Record<string, string> = {
  season_locked: 'the season is closed',
  season_archived: 'the workbook is archived',
  role_cannot_edit: "your role can't make this edit right now",
  sheet_missing: 'that sheet no longer exists',
  invalid_op: 'the edit was not valid',
  conflict_resolved: 'that conflict was already resolved',
};
