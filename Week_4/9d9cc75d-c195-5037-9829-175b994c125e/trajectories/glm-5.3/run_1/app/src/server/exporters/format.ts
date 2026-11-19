import type { SerializedView } from "../routes/exports.js";
import { displayDate, displayMonth, displayNumber, displayYear } from "../../shared/display.js";

export function formatCell(type: string, v: unknown): string {
  if (v === null || v === undefined) return "(null)";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (type === "date") return displayDate(v);
    if (type === "number") return String(v);
    return String(v);
  }
  return String(v);
}

export function displayCell(type: string, v: unknown): string {
  if (v === null || v === undefined) return "(null)";
  if (typeof v === "number") return displayNumber(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/** A display value for a dimension, honouring date levels. */
export function dimCellText(type: string, level: string | null, v: unknown): string {
  if (v === null || v === undefined) return "(null)";
  if (typeof v === "number" && level) {
    if (level === "month") return displayMonth(v);
    if (level === "year") return displayYear(v);
    return displayDate(v);
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

export function viewMeasures(v: SerializedView): string[] {
  return v.measures.map((m) => m.caption);
}
