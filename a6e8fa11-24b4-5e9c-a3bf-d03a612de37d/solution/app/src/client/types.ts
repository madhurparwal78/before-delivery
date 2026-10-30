// Response shapes of the API, as the browser reads them.
import { type ChartType } from "../shared/engine.js";
import { type CellFormat } from "../shared/values.js";

import { type Role, type SeasonState } from "../shared/roles.js";

export type { Role, SeasonState };

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
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

interface SnapshotCell {
  input: string;
  value: number | string | boolean | null;
  display: string;
  format: CellFormat;
  error?: string;
}

interface SnapshotSheet {
  id: string;
  name: string;
  position: number;
  cells: Record<string, SnapshotCell>;
}

interface SnapshotChart {
  id: string;
  sheetId: string;
  type: ChartType;
  title: string;
  range: string;
  categories: string[];
  series: Array<{ name: string; values: Array<number | null> }>;
}

export interface Snapshot extends WorkbookSummary {
  timeZone: string;
  headSeq: number;
  myRole: Role;
  sheets: SnapshotSheet[];
  charts: SnapshotChart[];
}

export interface Conflict {
  id: string;
  kind: "conflict" | "rejected";
  ref: string;
  sheetId: string;
  cell: string;
  myInput: string;
  currentInput: string;
  currentAuthor: { id: string; name: string } | null;
  reason: "season_locked" | "season_archived" | "role_cannot_edit" | null;
  createdAt: string;
}

export interface Version {
  id: string;
  number: number;
  label: string;
  kind: "saved" | "restore" | "before_restore";
  seq: number;
  createdAt: string;
  createdBy: { id: string; name: string };
}

export interface ExportItem {
  id: string;
  format: "xlsx" | "csv";
  sheetId: string | null;
  fileName: string;
  status: "pending" | "waiting_for_storage" | "ready";
  createdAt: string;
  readyAt: string | null;
}

export interface ShareLink {
  id: string;
  url: string;
  expiresAt: string;
  status: "active" | "expired" | "revoked";
}

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: "invited" | "active";
}

export interface Limits {
  maxImportBytes: number;
  maxImportExpandedBytes: number;
  maxCompressionRatio: number;
  maxSheets: number;
  maxImportCells: number;
  maxRows: number;
}

export interface ServiceStatus {
  storage: "up" | "down";
  mail: "up" | "down";
}
