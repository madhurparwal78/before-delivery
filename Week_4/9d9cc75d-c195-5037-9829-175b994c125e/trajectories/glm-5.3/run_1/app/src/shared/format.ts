import { displayNumber, displayShare, displayDate, displayMonth, displayYear, roundAway } from "./display.js";

export type FieldType = "number" | "text" | "date" | "boolean";

/** The scalar a mark or a cell holds: number, text, date (ms), boolean or null. */
export type Scalar = number | string | boolean | null;

export function formatValue(type: FieldType, v: Scalar): string {
  if (v === null || v === undefined) return "(null)";
  if (type === "number") return displayNumber(v as number);
  if (type === "date") {
    const ms = typeof v === "number" ? v : Date.parse(String(v));
    return displayDate(ms);
  }
  if (type === "boolean") return v ? "true" : "false";
  return String(v);
}

/** The caption of a measure pill: field name for SUM, otherwise {AGG} {field}. */
export function measureCaption(field: string, agg: string, tableCalc: string | null): string {
  let base = agg === "SUM" ? field : `${agg} ${field}`;
  if (tableCalc === "run_total") base = `Running total of ${base}`;
  else if (tableCalc === "prev_diff") base = `Difference from previous of ${base}`;
  else if (tableCalc === "share") base = `Percent of total of ${base}`;
  else if (tableCalc === "rank") base = `Rank of ${base}`;
  return base;
}

export function isShareTableCalc(kind: string | null): boolean {
  return kind === "share";
}

/** Formatted text for any scalar, used in tooltips and twins. */
export function formatScalar(type: FieldType, v: Scalar, isShare: boolean): string {
  if (v === null || v === undefined) return "(null)";
  if (isShare) return displayShare(v as number);
  if (type === "number") return displayNumber(v as number);
  if (type === "date") {
    const ms = typeof v === "number" ? v : Date.parse(String(v));
    return displayDate(ms);
  }
  if (type === "boolean") return v ? "true" : "false";
  return String(v);
}

/** Raw value in a twin or mark cell: shares as fractions, dates as YYYY-MM-DD. */
export function rawForTwin(type: FieldType, v: Scalar, isShare: boolean): string | number | null {
  if (v === null || v === undefined) return null;
  if (isShare) return roundAway(v as number, 9);
  if (type === "date") {
    const ms = typeof v === "number" ? v : Date.parse(String(v));
    return displayDate(ms);
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  return v;
}
