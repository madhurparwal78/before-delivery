import type { CellValue, Column } from "./types.ts";

const NUMBER_SHAPE = /^-?\d+(\.\d+)?$/;
const DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Number cells hold whole hundredths, so totals never pass through a float. */
export function parseHundredths(text: string): number | null {
  if (!NUMBER_SHAPE.test(text)) return null;
  const negative = text.startsWith("-");
  const [whole = "0", decimals = ""] = text.replace("-", "").split(".");
  const hundredths = Number(whole) * 100 + Number(decimals.padEnd(3, "0").slice(0, 2)) + (Number(decimals[2] ?? "0") >= 5 ? 1 : 0);
  return negative ? -hundredths : hundredths;
}

function formatHundredths(value: number): string {
  const size = Math.abs(value);
  return `${value < 0 ? "-" : ""}${Math.floor(size / 100)}.${String(size % 100).padStart(2, "0")}`;
}

export function isCalendarDate(text: string): boolean {
  const match = DATE_SHAPE.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function cellText(column: Column, value: CellValue | undefined): string {
  if (value === null || value === undefined || value === "") return column.type === "checkbox" ? "false" : "";
  if (column.type === "number") return formatHundredths(Number(value));
  return String(value);
}

export type CellRow = { id: string; cells: Record<string, CellValue | undefined> };

export const rowMatches = (row: CellRow, columns: readonly Column[], filter: string): boolean => {
  const wanted = filter.toLowerCase();
  return columns.some((column) => cellText(column, row.cells[column.id]).toLowerCase().includes(wanted));
};

/** A column total: the sum over the given rows, empty cells counted as 0. */
export function columnTotal(rows: readonly CellRow[], columnId: string): string {
  return formatHundredths(rows.reduce((sum, row) => sum + Number(row.cells[columnId] ?? 0), 0));
}

export function untitledTableName(used: ReadonlySet<string>): string {
  if (!used.has("Untitled table")) return "Untitled table";
  let number = 2;
  while (used.has(`Untitled table ${number}`)) number += 1;
  return `Untitled table ${number}`;
}

export function parseOptions(text: string): string[] {
  return [...new Set(text.split(",").map((option) => option.trim()).filter(Boolean))];
}

/** The row title on a board card: the first text column, or `Untitled`. */
export function rowTitle(row: CellRow, columns: readonly Column[]): string {
  const first = columns.find((column) => column.type === "text");
  return (first && String(row.cells[first.id] ?? "")) || "Untitled";
}

type CellEditError = "Enter a number." | "Enter a date as YYYY-MM-DD.";

/** Turns editor text into a stored cell value, or the published field message. */
export function parseCellEdit(column: Column, text: string): { value: CellValue } | { error: CellEditError } {
  if (column.type === "number") {
    if (text === "") return { value: null };
    const value = parseHundredths(text);
    return value === null ? { error: "Enter a number." } : { value };
  }
  if (column.type === "date") {
    if (text === "") return { value: null };
    return isCalendarDate(text) ? { value: text } : { error: "Enter a date as YYYY-MM-DD." };
  }
  return { value: text };
}
