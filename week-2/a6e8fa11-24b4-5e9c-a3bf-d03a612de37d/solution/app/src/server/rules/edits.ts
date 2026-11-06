// The edit check order (Business rules · Edit check order): shape, season, role, sheet, content, conflict.
// Sync runs all six; re-apply runs checks 2–4 through `seasonRoleSheet`.
import { type Op } from "../../shared/ops.js";
import { LIMITS } from "../../shared/limits.js";
import { parseArea, parseCell } from "../../shared/refs.js";
import { canAddSheet, chartArea, chartTitleAllowed, sheetNameAllowed } from "../../shared/sheets.js";
import { isNumberFormat } from "../../shared/values.js";
import { type DerivedWorkbook, type WorkbookRow, isUuid } from "../workbook.js";
import { type EditKind } from "../../shared/roles.js";
import { type Role, canEdit } from "./roles.js";
import { editBlock } from "./season.js";

export type Reason = "season_locked" | "season_archived" | "role_cannot_edit" | "sheet_missing" | "invalid_op";

const FIELDS: Record<Op["type"], readonly string[]> = {
  setCell: ["opId", "type", "sheetId", "cell", "input"],
  setFormat: ["opId", "type", "sheetId", "range", "format"],
  addSheet: ["opId", "type", "sheetId", "name"],
  renameSheet: ["opId", "type", "sheetId", "name"],
  addChart: ["opId", "type", "chartId", "sheetId", "chartType", "title", "range"],
  removeChart: ["opId", "type", "chartId"],
};

const isString = (v: unknown): v is string => typeof v === "string";

function formatShape(v: unknown): boolean {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  if (keys.length === 0 || keys.some((k) => k !== "numberFormat" && k !== "bold")) return false;
  const f = v as Record<string, unknown>;
  return (f.numberFormat === undefined || isNumberFormat(f.numberFormat)) && (f.bold === undefined || typeof f.bold === "boolean");
}

/** Check 1: the op has exactly its type's fields, each of the right type. */
export function opShape(raw: Record<string, unknown>): Op | null {
  const type = raw.type;
  if (!isString(type) || !(type in FIELDS)) return null;
  const fields = FIELDS[type as Op["type"]];
  const keys = Object.keys(raw);
  if (keys.length !== fields.length || !fields.every((f) => keys.includes(f))) return null;
  switch (type as Op["type"]) {
    case "setCell":
      return isString(raw.sheetId) && isString(raw.cell) && parseCell(raw.cell) !== null && isString(raw.input) && raw.input.length <= LIMITS.maxInputChars
        ? (raw as unknown as Op)
        : null;
    case "setFormat":
      return isString(raw.sheetId) && isString(raw.range) && parseArea(raw.range) !== null && formatShape(raw.format) ? (raw as unknown as Op) : null;
    case "addSheet":
      return isUuid(raw.sheetId) && isString(raw.name) ? (raw as unknown as Op) : null;
    case "renameSheet":
      return isString(raw.sheetId) && isString(raw.name) ? (raw as unknown as Op) : null;
    case "addChart":
      return isUuid(raw.chartId) && isString(raw.sheetId) && (raw.chartType === "bar" || raw.chartType === "line") && isString(raw.title) && chartTitleAllowed(raw.title) && isString(raw.range)
        ? (raw as unknown as Op)
        : null;
    case "removeChart":
      return isString(raw.chartId) ? (raw as unknown as Op) : null;
  }
}

function kindOf(op: Op): EditKind {
  return op.type === "setCell" || op.type === "setFormat" ? "cell" : "structure";
}

/** Checks 2, 3 and 4: season, role, sheet. */
export function seasonRoleSheet(row: WorkbookRow, role: Role, op: Op, derived: DerivedWorkbook, now: Date): Exclude<Reason, "invalid_op"> | null {
  const season = editBlock(row.state, row.closes_at_utc, now);
  if (season) return season;
  if (!canEdit(role, kindOf(op), row.state)) return "role_cannot_edit";
  if (op.type !== "addSheet" && "sheetId" in op && !derived.engine.sheetById(op.sheetId)) return "sheet_missing";
  return null;
}

/** Check 5: the content rules for sheets and charts. */
export function contentAllowed(op: Op, derived: DerivedWorkbook): boolean {
  const engine = derived.engine;
  switch (op.type) {
    case "addSheet":
      return !engine.sheetById(op.sheetId) && canAddSheet(engine) && sheetNameAllowed(engine, op.name, null);
    case "renameSheet":
      return sheetNameAllowed(engine, op.name, op.sheetId);
    case "addChart":
      return !engine.chartById(op.chartId) && chartArea(engine, op.sheetId, op.range, false) !== null;
    case "removeChart":
      return engine.chartById(op.chartId) !== undefined;
    default:
      return true;
  }
}

/** Check 6 (setCell only): the cell changed after the batch's base sequence by someone else. */
export function conflicts(op: Op, derived: DerivedWorkbook, baseSeq: number, memberId: string): boolean {
  return op.type === "setCell" && derived.changedByOther(op.sheetId, op.cell, baseSeq, memberId);
}

/** Rejections of a cell edit that its author keeps in the conflict tray. */
export function keptInTray(op: Op, reason: Reason): boolean {
  return op.type === "setCell" && (reason === "season_locked" || reason === "season_archived" || reason === "role_cannot_edit");
}
